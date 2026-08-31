import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseClient, DatabasePool } from '@kcml/database';
import { allocateContiguousSequence, inTransaction, lockAdvisory } from '@kcml/database';
import { canonicalJson, type CanonicalJsonValue } from '@kcml/schemas';
import { DomainError } from './errors.js';

const SAFE_IDENTIFIER = /^[a-z][a-z0-9_]*$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function ident(value: string): string {
  if (!SAFE_IDENTIFIER.test(value)) throw new DomainError('SSOT_ENTITY_INVALID', 'Entity identifier is outside the compiled SSOT surface', 500);
  return `"${value}"`;
}

function digest(value: string | Buffer): Buffer {
  return createHash('sha256').update(value).digest();
}

function snake(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^a-zA-Z0-9_]+/g, '_').toLowerCase();
}

function lifecycleForAction(action: string, current = 'ACTIVE'): string {
  if (/^(activate|enable|restore|resume|approve|complete|verify|connect|ready)$/u.test(action)) return 'ACTIVE';
  if (/^(disable|suspend|pause|drain|suppress)$/u.test(action)) return 'SUSPENDED';
  if (action === 'quarantine') return 'QUARANTINED';
  if (/^(delete|deregister|close|revoke|cancel|expire|stop|logout|invalidate)$/u.test(action)) return 'CLOSED';
  return current;
}

function jsonSafe(value: unknown): CanonicalJsonValue {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item)) as CanonicalJsonValue;
}

export interface SurfaceMutationInput {
  entity: string;
  routeKey: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  targetId: string | null;
  body: unknown;
  expectedStateVersion: bigint | null;
  idempotencyKey: string;
  callerFingerprint: string;
  actorId: string;
  correlationId: string;
}

interface ColumnInfo { name: string; nullable: boolean; hasDefault: boolean; generated: boolean; }

export class SsotSurfaceService {
  private readonly columnCache = new Map<string, Map<string, ColumnInfo>>();

  public constructor(private readonly pool: DatabasePool, private readonly allowedEntities: ReadonlySet<string>) {}

  private assertEntity(entity: string): void {
    if (!this.allowedEntities.has(entity)) throw new DomainError('SSOT_ENTITY_NOT_COMPILED', `Entity ${entity} is not in the compiled SSOT surface`, 500);
    ident(entity);
  }

  private async columns(client: DatabaseClient | DatabasePool, entity: string): Promise<Map<string, ColumnInfo>> {
    const cached = this.columnCache.get(entity);
    if (cached) return cached;
    const result = await client.query(`SELECT a.attname AS name, NOT a.attnotnull AS nullable, ad.adbin IS NOT NULL AS has_default, a.attgenerated <> '' AS generated
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      LEFT JOIN pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum
      WHERE n.nspname='kcml' AND c.relname=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`, [entity]);
    if (!result.rows.length) throw new DomainError('SSOT_ENTITY_STORAGE_MISSING', `Physical table kcml.${entity} is missing`, 503);
    const columns = new Map<string, ColumnInfo>(result.rows.map((row) => [String(row.name), { name: String(row.name), nullable: Boolean(row.nullable), hasDefault: Boolean(row.has_default), generated: Boolean(row.generated) }]));
    this.columnCache.set(entity, columns);
    return columns;
  }

  public async read(entity: string, targetId: string | null, limit = 200, scope: Readonly<Record<string, string>> = {}): Promise<unknown> {
    this.assertEntity(entity);
    const columns = await this.columns(this.pool, entity);
    const table = ident(entity);
    if (targetId && columns.has('id')) {
      const result = await this.pool.query(`SELECT to_jsonb(t) AS row FROM kcml.${table} t WHERE t.id::text=$1 LIMIT 1`, [targetId]);
      if (!result.rows[0]) throw new DomainError('RESOURCE_NOT_FOUND', `${entity} row does not exist`, 404);
      return result.rows[0].row;
    }
    if (targetId && columns.has('stable_key')) {
      const result = await this.pool.query(`SELECT to_jsonb(t) AS row FROM kcml.${table} t WHERE t.stable_key=$1 LIMIT 1`, [targetId]);
      if (!result.rows[0]) throw new DomainError('RESOURCE_NOT_FOUND', `${entity} row does not exist`, 404);
      return result.rows[0].row;
    }
    const predicates: string[] = [];
    const values: unknown[] = [];
    const usedColumns = new Set<string>();
    for (const [key, value] of Object.entries(scope)) {
      const candidates = [snake(key), key === 'parentId' ? 'parent_id' : '', key === 'id' ? 'parent_id' : ''].filter(Boolean);
      const column = candidates.find((candidate) => columns.has(candidate) && !usedColumns.has(candidate));
      if (!column) continue;
      usedColumns.add(column);
      values.push(value);
      predicates.push(`t.${ident(column)}::text=$${values.length}`);
    }
    if (columns.has('deleted_at')) predicates.push('t.deleted_at IS NULL');
    const bounded = Math.max(1, Math.min(500, limit));
    values.push(bounded);
    const order = columns.has('updated_at') ? ' ORDER BY t.updated_at DESC' : columns.has('created_at') ? ' ORDER BY t.created_at DESC' : '';
    const where = predicates.length ? ` WHERE ${predicates.join(' AND ')}` : '';
    const result = await this.pool.query(`SELECT to_jsonb(t) AS row FROM kcml.${table} t${where}${order} LIMIT $${values.length}`, values);
    return result.rows.map((row) => row.row);
  }

  public async mutate(input: SurfaceMutationInput): Promise<unknown> {
    this.assertEntity(input.entity);
    if (!input.idempotencyKey || input.idempotencyKey.length > 256) throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key is required for every SSOT mutation', 400, 'DO_NOT_RETRY');
    const requestBody = jsonSafe(input.body ?? {});
    const requestEnvelope = jsonSafe({ routeKey: input.routeKey, targetId: input.targetId, body: requestBody, expectedStateVersion: input.expectedStateVersion?.toString() ?? null });
    const requestBytes = Buffer.from(canonicalJson(requestEnvelope));
    const requestDigest = digest(requestBytes);
    const scopeDigest = digest(`SSOT-API-SURFACE/1\u0000${input.routeKey}\u0000${input.callerFingerprint}\u0000${input.targetId ?? '-'}`);
    const keyDigest = digest(input.idempotencyKey);
    const logicalOperationId = randomUUID();
    const commandId = randomUUID();

    return inTransaction(this.pool, 'SERIALIZABLE', async (client) => {
      await lockAdvisory(client, 'IDEMPOTENCY_SCOPE', `${scopeDigest.toString('hex')}:${keyDigest.toString('hex')}`);
      const heads = await client.query(`SELECT p.platform_incarnation_id,d.current_epoch AS deployment_epoch,a.current_epoch AS activation_epoch
        FROM kcml.platform_incarnation p CROSS JOIN kcml.application_deployment_head d CROSS JOIN kcml.activation_head a
        WHERE p.singleton_key=1 AND d.singleton_key=1 AND a.singleton_key=1 FOR SHARE OF p,d`);
      const head = heads.rows[0];
      if (!head) throw new DomainError('AUTHORITY_HEADS_MISSING', 'Platform authority heads are missing', 503, 'RETRY_SAME_OPERATION');

      const claimed = await client.query(`INSERT INTO kcml.domain_idempotency_record(scope_digest,key_digest,canonical_key,request_digest,logical_operation_id,command_id,lifecycle,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,'RESERVED',clock_timestamp()+interval '24 hours')
        ON CONFLICT (scope_digest,key_digest) DO NOTHING RETURNING id`, [scopeDigest, keyDigest, input.idempotencyKey, requestDigest, logicalOperationId, commandId]);
      const replay = await client.query(`SELECT * FROM kcml.domain_idempotency_record WHERE scope_digest=$1 AND key_digest=$2 FOR UPDATE`, [scopeDigest, keyDigest]);
      const idempotency = replay.rows[0];
      if (!idempotency) throw new DomainError('IDEMPOTENCY_CLAIM_FAILED', 'Idempotency claim could not be locked', 500);
      if (!Buffer.from(idempotency.request_digest).equals(requestDigest)) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Idempotency-Key was already used for a different canonical request', 409, 'DO_NOT_RETRY');
      if (claimed.rowCount === 0) {
        if (idempotency.response_body) {
          const stored = jsonSafe(idempotency.response_body) as Record<string, CanonicalJsonValue>;
          const meta = stored.meta && typeof stored.meta === 'object' && !Array.isArray(stored.meta) ? stored.meta as Record<string, CanonicalJsonValue> : {};
          return jsonSafe({ ...stored, meta: { ...meta, idempotencyReplay: true } });
        }
        throw new DomainError('IDEMPOTENT_OPERATION_IN_PROGRESS', 'The same logical mutation is already in progress', 409, 'RETRY_SAME_OPERATION');
      }

      const result = await this.applyMutation(client, input, requestBody, head);
      const eventPayload = jsonSafe({ routeKey: input.routeKey, entity: input.entity, logicalOperationId, commandId, targetId: input.targetId, result });
      const eventSequence = await allocateContiguousSequence(client, 'TRANSACTIONAL_OUTBOX', commandId, 'STREAM_SEQUENCE');
      const eventDigest = digest(Buffer.from(canonicalJson(eventPayload)));
      await client.query(`INSERT INTO kcml.transactional_outbox(stream_key,stream_sequence,purpose,event_type,aggregate_id,payload,payload_digest)
        VALUES($1,$2,'DOMAIN_EVENT','api.surface.mutation',$3,$4,$5)`, [`command:${commandId}`, eventSequence.toString(), input.targetId && UUID.test(input.targetId) ? input.targetId : null, eventPayload, eventDigest]);

      const stateVersion = result && typeof result === 'object' && !Array.isArray(result) && 'state_version' in result ? String((result as Record<string, unknown>).state_version ?? '0') : '0';
      const serverTimeResult = await client.query(`SELECT clock_timestamp() AS server_time`);
      const resultDigest = digest(Buffer.from(canonicalJson(jsonSafe(result)))).toString('hex');
      const responseBody = jsonSafe({ data: result, meta: { correlationId: input.correlationId, logicalOperationId, commandId, stateVersion, eventSequence: eventSequence.toString(), activationEpoch: String(head.activation_epoch), resultDigest: `sha256:${resultDigest}`, idempotencyReplay: false, serverTime: new Date(serverTimeResult.rows[0].server_time).toISOString() } });
      const responseBytes = Buffer.from(canonicalJson(responseBody));
      const responseDigest = digest(responseBytes);
      await client.query(`INSERT INTO kcml.domain_command(id,logical_operation_id,operation_name,target_id,caller_fingerprint,request_canonical_bytes,request,request_digest,expected_state_version,status,result,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch,completed_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'SUCCEEDED',$10,$11,$12,$13,$14,clock_timestamp())`, [commandId, logicalOperationId, `api:${input.routeKey}`, input.targetId && UUID.test(input.targetId) ? input.targetId : null, input.callerFingerprint, requestBytes, requestEnvelope, requestDigest, input.expectedStateVersion?.toString() ?? null, responseBody, input.correlationId, head.activation_epoch, head.platform_incarnation_id, head.deployment_epoch]);
      await client.query(`UPDATE kcml.domain_idempotency_record SET lifecycle='SUCCEEDED',response_status=$2,response_body=$3,response_digest=$4,terminal_outcome_digest=$4,completed_at=clock_timestamp(),updated_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1`, [idempotency.id, input.method === 'POST' && !input.targetId ? 201 : 200, responseBody, responseDigest]);
      const auditPayload = jsonSafe({ routeKey: input.routeKey, entity: input.entity, logicalOperationId, commandId, targetId: input.targetId, eventSequence: eventSequence.toString(), resultDigest: `sha256:${resultDigest}` });
      await client.query(`SELECT * FROM kcml.append_audit_event('api.surface.mutation','OWNER',$1,$2,$3,$4,NULL,$5,$6)`, [input.actorId, input.entity.toUpperCase(), input.targetId && UUID.test(input.targetId) ? input.targetId : null, input.correlationId, auditPayload, Buffer.from(canonicalJson(auditPayload))]);
      return responseBody;
    });
  }

  private async applyMutation(client: DatabaseClient, input: SurfaceMutationInput, body: CanonicalJsonValue, head: Record<string, unknown>): Promise<unknown> {
    const columns = await this.columns(client, input.entity);
    const table = ident(input.entity);
    const bodyObject = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, CanonicalJsonValue> : {};
    const action = input.routeKey.split(' ')[1]?.split('/').filter(Boolean).at(-1)?.replace(/^:/u, '') ?? input.method.toLowerCase();

    if (input.method === 'DELETE') {
      if (!input.targetId) throw new DomainError('TARGET_ID_REQUIRED', 'DELETE route requires a target identity', 400);
      if (!columns.has('deleted_at') || !columns.has('state_version')) throw new DomainError('SOFT_DELETE_NOT_SUPPORTED_BY_ENTITY', `${input.entity} has no SSOT tombstone contract`, 409, 'DO_NOT_RETRY');
      if (input.expectedStateVersion === null) throw new DomainError('EXPECTED_STATE_VERSION_REQUIRED', 'DELETE requires If-Match/expectedStateVersion', 428, 'REFRESH_AND_RETRY_NEW_COMMAND');
      const updates = ['deleted_at=clock_timestamp()', 'state_version=t.state_version+1'];
      if (columns.has('lifecycle')) updates.push("lifecycle='CLOSED'");
      if (columns.has('updated_at')) updates.push('updated_at=clock_timestamp()');
      const identity = columns.has('id') ? 't.id::text' : columns.has('stable_key') ? 't.stable_key' : null;
      if (!identity) throw new DomainError('SSOT_ENTITY_NOT_ADDRESSABLE', `${input.entity} has no addressable identity`, 500);
      const result = await client.query(`UPDATE kcml.${table} AS t SET ${updates.join(',')} WHERE ${identity}=$1 AND t.state_version=$2 RETURNING to_jsonb(t) AS row`, [input.targetId, input.expectedStateVersion.toString()]);
      if (!result.rows[0]) throw new DomainError('STATE_VERSION_CONFLICT_OR_NOT_FOUND', 'Delete target is missing or stale', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
      return result.rows[0].row;
    }

    if (!input.targetId) return this.insertRow(client, input.entity, columns, bodyObject, head);

    const targetResult = columns.has('id')
      ? await client.query(`SELECT to_jsonb(t) AS row FROM kcml.${table} t WHERE t.id::text=$1 FOR UPDATE`, [input.targetId])
      : columns.has('stable_key') ? await client.query(`SELECT to_jsonb(t) AS row FROM kcml.${table} t WHERE t.stable_key=$1 FOR UPDATE`, [input.targetId]) : { rows: [] };
    const current = targetResult.rows[0]?.row as Record<string, unknown> | undefined;
    if (!current) throw new DomainError('RESOURCE_NOT_FOUND', `${input.entity} target does not exist`, 404);
    if (current.state_version !== undefined && input.expectedStateVersion === null) throw new DomainError('EXPECTED_STATE_VERSION_REQUIRED', 'Mutation requires If-Match/expectedStateVersion', 428, 'REFRESH_AND_RETRY_NEW_COMMAND');
    if (input.expectedStateVersion !== null && current.state_version !== undefined && BigInt(String(current.state_version)) !== input.expectedStateVersion) throw new DomainError('STATE_VERSION_CONFLICT', `${input.entity} changed`, 409, 'REFRESH_AND_RETRY_NEW_COMMAND');

    if (columns.has('document')) {
      const values: unknown[] = [input.targetId, bodyObject];
      const updates = ['document=t.document || $2::jsonb'];
      if (columns.has('lifecycle')) {
        values.push(lifecycleForAction(action, String(current.lifecycle ?? 'ACTIVE')));
        updates.push(`lifecycle=$${values.length}`);
      }
      if (columns.has('application_deployment_epoch')) {
        values.push(head.deployment_epoch);
        updates.push(`application_deployment_epoch=$${values.length}`);
      }
      if (columns.has('state_version')) updates.push('state_version=t.state_version+1');
      if (columns.has('updated_at')) updates.push('updated_at=clock_timestamp()');
      if (columns.has('state_version')) values.push(input.expectedStateVersion?.toString() ?? null);
      const stateGuard = columns.has('state_version') ? ` AND t.state_version=$${values.length}` : '';
      const identity = columns.has('id') ? 't.id::text' : 't.stable_key';
      const result = await client.query(`UPDATE kcml.${table} AS t SET ${updates.join(',')} WHERE ${identity}=$1${stateGuard} RETURNING to_jsonb(t) AS row`, values);
      if (!result.rows[0]) throw new DomainError('STATE_VERSION_CONFLICT', `${input.entity} changed`, 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
      return result.rows[0].row;
    }

    const updates: string[] = [];
    const values: unknown[] = [input.targetId];
    for (const [key, value] of Object.entries(bodyObject)) {
      const column = snake(key);
      if (!columns.has(column) || ['id','state_version','created_at','updated_at','platform_incarnation_id','application_deployment_epoch'].includes(column) || columns.get(column)?.generated) continue;
      values.push(value);
      updates.push(`${ident(column)}=$${values.length}`);
    }
    const stateColumn = ['lifecycle','status','state'].find((column) => columns.has(column));
    if (stateColumn && !updates.some((value) => value.startsWith(`${ident(stateColumn)}=`))) {
      values.push(lifecycleForAction(action, String(current[stateColumn] ?? 'ACTIVE')));
      updates.push(`${ident(stateColumn)}=$${values.length}`);
    }
    if (columns.has('application_deployment_epoch')) { values.push(head.deployment_epoch); updates.push(`application_deployment_epoch=$${values.length}`); }
    if (columns.has('state_version')) updates.push('state_version=t.state_version+1');
    if (columns.has('updated_at')) updates.push('updated_at=clock_timestamp()');
    if (!updates.length) throw new DomainError('NO_MUTABLE_FIELDS', `${input.entity} mutation has no writable SSOT fields`, 422);
    if (columns.has('state_version')) values.push(input.expectedStateVersion?.toString() ?? null);
    const stateGuard = columns.has('state_version') ? ` AND t.state_version=$${values.length}` : '';
    const identity = columns.has('id') ? 't.id::text' : 't.stable_key';
    const result = await client.query(`UPDATE kcml.${table} AS t SET ${updates.join(',')} WHERE ${identity}=$1${stateGuard} RETURNING to_jsonb(t) AS row`, values);
    if (!result.rows[0]) throw new DomainError('STATE_VERSION_CONFLICT', `${input.entity} changed`, 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    return result.rows[0].row;
  }

  private async insertRow(client: DatabaseClient, entity: string, columns: Map<string, ColumnInfo>, body: Record<string, CanonicalJsonValue>, head: Record<string, unknown>): Promise<unknown> {
    const table = ident(entity);
    const valuesByColumn = new Map<string, unknown>();
    for (const [key, value] of Object.entries(body)) {
      const column = snake(key);
      if (columns.has(column) && !columns.get(column)?.generated && !['state_version','created_at','updated_at','platform_incarnation_id','application_deployment_epoch'].includes(column)) valuesByColumn.set(column, value);
    }
    if (columns.has('id') && !valuesByColumn.has('id')) valuesByColumn.set('id', randomUUID());
    if (columns.has('stable_key') && !valuesByColumn.has('stable_key')) valuesByColumn.set('stable_key', String(body.stableKey ?? body.code ?? body.name ?? `${entity}-${randomUUID().slice(0, 8)}`));
    if (columns.has('display_name') && !valuesByColumn.has('display_name')) valuesByColumn.set('display_name', String(body.displayName ?? body.name ?? valuesByColumn.get('stable_key') ?? entity));
    if (columns.has('document')) valuesByColumn.set('document', body);
    if (columns.has('platform_incarnation_id')) valuesByColumn.set('platform_incarnation_id', head.platform_incarnation_id);
    if (columns.has('application_deployment_epoch')) valuesByColumn.set('application_deployment_epoch', head.deployment_epoch);
    const requiredMissing = [...columns.values()].filter((column) => !column.nullable && !column.hasDefault && !column.generated && !valuesByColumn.has(column.name));
    if (requiredMissing.length) throw new DomainError('REQUIRED_ENTITY_FIELDS_MISSING', `${entity} requires fields: ${requiredMissing.map((column) => column.name).join(', ')}`, 422);
    const names = [...valuesByColumn.keys()];
    const values = [...valuesByColumn.values()];
    const placeholders = values.map((_value, index) => `$${index + 1}`);
    const result = await client.query(`INSERT INTO kcml.${table} AS t (${names.map(ident).join(',')}) VALUES(${placeholders.join(',')}) RETURNING to_jsonb(t) AS row`, values);
    return result.rows[0]?.row;
  }
}
