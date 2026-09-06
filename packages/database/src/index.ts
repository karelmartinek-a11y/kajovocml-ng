import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

const { Pool } = pg;

export type DatabasePool = pg.Pool;
export type DatabaseClient = pg.PoolClient;

export type TransactionProfileId =
  | 'ONLINE_MUTATION'
  | 'WORKER_COMMIT'
  | 'ACTIVATION_SWITCH'
  | 'CONSISTENT_READ'
  | 'CLOSURE_SNAPSHOT'
  | 'SERIALIZABLE_PREDICATE';

export interface TransactionProfile {
  id: TransactionProfileId;
  isolation: 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';
  readOnly: boolean;
  deferrable: boolean;
  lockTimeout: string;
  statementTimeout: string;
  idleInTransactionSessionTimeout: string;
}

export const TRANSACTION_PROFILES: Readonly<Record<TransactionProfileId, TransactionProfile>> = {
  ONLINE_MUTATION: { id: 'ONLINE_MUTATION', isolation: 'READ COMMITTED', readOnly: false, deferrable: false, lockTimeout: '1500ms', statementTimeout: '10s', idleInTransactionSessionTimeout: '10s' },
  WORKER_COMMIT: { id: 'WORKER_COMMIT', isolation: 'READ COMMITTED', readOnly: false, deferrable: false, lockTimeout: '3000ms', statementTimeout: '15s', idleInTransactionSessionTimeout: '15s' },
  ACTIVATION_SWITCH: { id: 'ACTIVATION_SWITCH', isolation: 'READ COMMITTED', readOnly: false, deferrable: false, lockTimeout: '5000ms', statementTimeout: '30s', idleInTransactionSessionTimeout: '30s' },
  CONSISTENT_READ: { id: 'CONSISTENT_READ', isolation: 'REPEATABLE READ', readOnly: true, deferrable: false, lockTimeout: '3000ms', statementTimeout: '60s', idleInTransactionSessionTimeout: '60s' },
  CLOSURE_SNAPSHOT: { id: 'CLOSURE_SNAPSHOT', isolation: 'SERIALIZABLE', readOnly: true, deferrable: true, lockTimeout: '5000ms', statementTimeout: '120s', idleInTransactionSessionTimeout: '120s' },
  SERIALIZABLE_PREDICATE: { id: 'SERIALIZABLE_PREDICATE', isolation: 'SERIALIZABLE', readOnly: false, deferrable: false, lockTimeout: '3000ms', statementTimeout: '15s', idleInTransactionSessionTimeout: '15s' }
};

export interface DatabaseOptions {
  connectionString?: string;
  applicationName?: string;
  max?: number;
}

export function createDatabasePool(options: DatabaseOptions = {}): DatabasePool {
  const credentialPath = process.env.KCML_DATABASE_URL_FILE ?? (process.env.CREDENTIALS_DIRECTORY ? resolve(process.env.CREDENTIALS_DIRECTORY, 'database-url') : undefined);
  const connectionString = options.connectionString ?? process.env.DATABASE_URL ?? (credentialPath ? readFileSync(credentialPath, 'utf8').trim() : undefined);
  if (!connectionString) throw new Error('DATABASE_URL is required');
  return new Pool({
    connectionString,
    application_name: options.applicationName ?? process.env.KCML_SERVICE_NAME ?? 'kcml-service',
    max: options.max ?? Number(process.env.KCML_DB_POOL_MAX ?? 12),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    keepAlive: true,
    ssl: process.env.KCML_DATABASE_TLS === 'require' ? { rejectUnauthorized: true } : undefined
  });
}

export async function inTransaction<T>(
  pool: DatabasePool,
  isolation: 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE',
  body: (client: DatabaseClient) => Promise<T>
): Promise<T> {
  const profile: TransactionProfileId = isolation === 'READ COMMITTED'
    ? 'ONLINE_MUTATION'
    : isolation === 'REPEATABLE READ' ? 'CONSISTENT_READ' : 'SERIALIZABLE_PREDICATE';
  return inTransactionProfile(pool, profile, body);
}

/** Execute one exact SSOT 51.2 transaction profile. */
export async function inTransactionProfile<T>(
  pool: DatabasePool,
  profileId: TransactionProfileId,
  body: (client: DatabaseClient) => Promise<T>
): Promise<T> {
  const profile = TRANSACTION_PROFILES[profileId];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET TRANSACTION ISOLATION LEVEL ${profile.isolation}`);
    if (profile.readOnly) await client.query('SET TRANSACTION READ ONLY');
    if (profile.deferrable) await client.query('SET TRANSACTION DEFERRABLE');
    await client.query(`SET LOCAL lock_timeout = '${profile.lockTimeout}'`);
    await client.query(`SET LOCAL statement_timeout = '${profile.statementTimeout}'`);
    await client.query(`SET LOCAL idle_in_transaction_session_timeout = '${profile.idleInTransactionSessionTimeout}'`);
    await client.query("SET LOCAL application_name = 'kcml-transaction'");
    const value = await body(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Read-only snapshot used by terminal closure oracles.  `DEFERRABLE` is
 * intentional: a closure report must observe a safe serializable snapshot or
 * fail before it starts evaluating predicates.  It must never silently fall
 * back to a weaker isolation level.
 */
export async function inSerializableReadOnlyDeferrable<T>(
  pool: DatabasePool,
  body: (client: DatabaseClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE, READ ONLY, DEFERRABLE');
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '15s'");
    const value = await body(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function withSerializableRetry<T>(
  pool: DatabasePool,
  body: (client: DatabaseClient) => Promise<T>,
  maxAttempts = 4
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await inTransaction(pool, 'SERIALIZABLE', body);
    } catch (error) {
      lastError = error;
      const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
      if (!['40001', '40P01'].includes(code) || attempt === maxAttempts) throw error;
      await new Promise((done) => setTimeout(done, 15 * attempt * attempt));
    }
  }
  throw lastError;
}

export async function allocateContiguousSequence(
  client: DatabaseClient,
  sequenceNamespace: string,
  parentUuid: string,
  sequenceKind: string
): Promise<bigint> {
  await client.query(`INSERT INTO kcml.sequence_allocator(sequence_namespace,parent_uuid,sequence_kind,last_sequence)
    VALUES($1,$2,$3,0) ON CONFLICT (sequence_namespace,parent_uuid,sequence_kind) DO NOTHING`, [sequenceNamespace, parentUuid, sequenceKind]);
  const result = await client.query<{ last_sequence: string }>(`UPDATE kcml.sequence_allocator
    SET last_sequence=last_sequence+1,state_version=state_version+1,updated_at=clock_timestamp()
    WHERE sequence_namespace=$1 AND parent_uuid=$2 AND sequence_kind=$3 RETURNING last_sequence::text`, [sequenceNamespace, parentUuid, sequenceKind]);
  const value = result.rows[0]?.last_sequence;
  if (!value) throw new Error('SEQUENCE_ALLOCATOR_FAILED');
  return BigInt(value);
}

export async function databaseNow(client: DatabaseClient): Promise<Date> {
  const result = await client.query<{ now: Date }>('SELECT clock_timestamp() AS now');
  const value = result.rows[0]?.now;
  if (!value) throw new Error('PostgreSQL did not return clock_timestamp');
  return value;
}

export function advisoryKey(namespace: string, identity: string): [number, number] {
  const namespaceId = ADVISORY_NAMESPACE_IDS[namespace];
  if (namespaceId === undefined) throw new Error(`ADVISORY_NAMESPACE_INVALID:${namespace}`);
  const digest = createHash('sha256').update(`${namespace}\u0000${identity}`, 'utf8').digest();
  return [namespaceId, digest.readInt32BE(0)];
}

export const ADVISORY_NAMESPACE_IDS: Readonly<Record<string, number>> = {
  BOOTSTRAP_SINGLETON: 1001,
  COMPONENT_CODE: 1010,
  SECRET_STABLE_NAME: 1020,
  IDEMPOTENCY_SCOPE: 1030,
  CONCURRENCY_CLAIM: 1040,
  ACTIVATION_DOMAIN: 1050,
  BROWSER_CONTROL: 1060,
  CLEANUP_REMEDIATION: 1070,
  SCHEDULE_OCCURRENCE: 1080,
  INBOUND_EVENT: 1090,
  SCHEMA_MIGRATION: 1100,
  PLATFORM_RECOVERY_BARRIER: 1110
};

export async function lockAdvisory(client: DatabaseClient, namespace: string, identity: string): Promise<void> {
  const [left, right] = advisoryKey(namespace, identity);
  await client.query('SELECT pg_advisory_xact_lock($1, $2)', [left, right]);
}

export async function lockAdvisoryShared(client: DatabaseClient, namespace: string, identity: string): Promise<void> {
  const [left, right] = advisoryKey(namespace, identity);
  await client.query('SELECT pg_advisory_xact_lock_shared($1, $2)', [left, right]);
}

export type LockClass =
  | 'ADVISORY'
  | 'PLATFORM'
  | 'DEPLOYMENT'
  | 'OWNER_CREDENTIAL'
  | 'ACTIVATION_HEAD'
  | 'IDEMPOTENCY'
  | 'ACTIVATION_DOMAIN'
  | 'AGGREGATE'
  | 'CONCURRENCY'
  | 'SEQUENCE'
  | 'CHILD'
  | 'QUEUE'
  | 'OUTBOX'
  | 'INBOX'
  | 'AUDIT';

const LOCK_CLASS_ORDER: Readonly<Record<LockClass, number>> = {
  ADVISORY: 10,
  PLATFORM: 20,
  DEPLOYMENT: 21,
  OWNER_CREDENTIAL: 22,
  ACTIVATION_HEAD: 23,
  IDEMPOTENCY: 30,
  ACTIVATION_DOMAIN: 40,
  AGGREGATE: 50,
  CONCURRENCY: 60,
  SEQUENCE: 70,
  CHILD: 80,
  QUEUE: 90,
  OUTBOX: 91,
  INBOX: 92,
  AUDIT: 100
};

/**
 * Debug/test guard for the global lock order from SSOT 51.6.
 * It is deliberately independent of a connection or ORM, so the same guard
 * can be used by every canonical writer and in two-connection concurrency
 * fixtures. A lower class (or a lower key within one class) is a defect.
 */
export class LockOrderGuard {
  #lastOrder = -1;
  #lastKey = '';
  readonly acquired: Array<{ lockClass: LockClass; key: string }> = [];

  public acquire(lockClass: LockClass, key = ''): void {
    const order = LOCK_CLASS_ORDER[lockClass];
    if (order < this.#lastOrder || (order === this.#lastOrder && key < this.#lastKey)) {
      throw new Error(`LOCK_ORDER_VIOLATION:${lockClass}:${key}:after:${this.#lastKey}`);
    }
    this.#lastOrder = order;
    this.#lastKey = key;
    this.acquired.push({ lockClass, key });
  }
}

export async function lockAdvisoryOrdered(
  client: DatabaseClient,
  guard: LockOrderGuard,
  namespace: string,
  identity: string
): Promise<void> {
  const [namespaceId, key] = advisoryKey(namespace, identity);
  guard.acquire('ADVISORY', `${namespaceId}:${key}`);
  await client.query('SELECT pg_advisory_xact_lock($1, $2)', [namespaceId, key]);
}

export async function lockRowsOrdered<T extends pg.QueryResultRow = pg.QueryResultRow>(
  client: DatabaseClient,
  guard: LockOrderGuard,
  lockClass: Exclude<LockClass, 'ADVISORY'>,
  key: string,
  query: string,
  values: readonly unknown[] = []
): Promise<pg.QueryResult<T>> {
  guard.acquire(lockClass, key);
  return client.query<T>(query, [...values]);
}

export async function loadBaseline(): Promise<string> {
  const directory = resolve(process.cwd(), 'database/baseline');
  const names = (await readdir(directory)).filter((name) => /^\d{14}_.+\.sql$/u.test(name)).sort();
  if (!names.length) throw new Error('DATABASE_BASELINE_MISSING');
  const parts = await Promise.all(names.map(async (name) => `-- SOURCE:${name}\n${await readFile(resolve(directory, name), 'utf8')}`));
  return `${parts.join('\n\n')}\n`;
}

export interface ForwardMigration {
  version: string;
  filename: string;
  sql: string;
  checksum: Buffer;
  phasePlan: Array<'EXPAND' | 'MIGRATE' | 'VALIDATE' | 'ACTIVATE' | 'CONTRACT'>;
  transactionMode: 'TRANSACTIONAL' | 'NON_TRANSACTIONAL_FENCED';
}

function migrationMetadata(sql: string, filename: string): Pick<ForwardMigration, 'phasePlan' | 'transactionMode'> {
  const phaseMatch = sql.match(/^--\s*KCML_PHASE_PLAN:\s*([A-Z, ]+)\s*$/mu);
  const modeMatch = sql.match(/^--\s*KCML_TRANSACTION_MODE:\s*(TRANSACTIONAL|NON_TRANSACTIONAL_FENCED)\s*$/mu);
  if (!phaseMatch || !modeMatch) throw new Error(`MIGRATION_METADATA_MISSING:${filename}`);
  const allowed = new Set(['EXPAND', 'MIGRATE', 'VALIDATE', 'ACTIVATE', 'CONTRACT']);
  const phasePlan = (phaseMatch[1] ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  if (!phasePlan.length || phasePlan.some((phase) => !allowed.has(phase))) throw new Error(`MIGRATION_PHASE_PLAN_INVALID:${filename}`);
  if (!phasePlan.includes('EXPAND') || !phasePlan.includes('VALIDATE') || !phasePlan.includes('ACTIVATE')) throw new Error(`MIGRATION_PHASE_PLAN_INCOMPLETE:${filename}`);
  return { phasePlan: phasePlan as ForwardMigration['phasePlan'], transactionMode: modeMatch[1] as ForwardMigration['transactionMode'] };
}

export async function loadForwardMigrations(): Promise<ForwardMigration[]> {
  const directory = resolve(process.cwd(), 'database/migrations');
  const names = (await readdir(directory)).filter((name) => /^\d{14}_.+\.sql$/u.test(name)).sort();
  const migrations: ForwardMigration[] = [];
  const seen = new Set<string>();
  for (const filename of names) {
    const version = filename.slice(0, 14);
    if (seen.has(version)) throw new Error(`DUPLICATE_MIGRATION_VERSION:${version}`);
    seen.add(version);
    const sql = await readFile(resolve(directory, filename), 'utf8');
    const metadata = migrationMetadata(sql, filename);
    migrations.push({ version, filename, sql, checksum: createHash('sha256').update(sql).digest(), ...metadata });
  }
  return migrations;
}

export async function databaseSchemaFingerprint(client: DatabaseClient | DatabasePool): Promise<Buffer> {
  const result = await client.query<{ fingerprint: Buffer }>(`WITH objects AS (
    SELECT 'COLUMN'::text AS kind, format('%I.%I.%s',n.nspname,c.relname,a.attnum) AS identity,
      concat_ws('|',c.relkind,a.attname,pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull,coalesce(pg_get_expr(ad.adbin,ad.adrelid),'')) AS definition
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef ad ON ad.adrelid=c.oid AND ad.adnum=a.attnum
    WHERE n.nspname='kcml' AND c.relkind IN ('r','p','v','m','S')
    UNION ALL
    SELECT 'CONSTRAINT',format('%I.%I.%s',n.nspname,c.relname,con.conname),pg_get_constraintdef(con.oid,true)
    FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='kcml'
    UNION ALL
    SELECT 'INDEX',format('%I.%I',n.nspname,i.relname),pg_get_indexdef(i.oid)
    FROM pg_class i JOIN pg_namespace n ON n.oid=i.relnamespace JOIN pg_index x ON x.indexrelid=i.oid WHERE n.nspname='kcml'
    UNION ALL
    SELECT 'TRIGGER',format('%I.%I.%s',n.nspname,c.relname,t.tgname),pg_get_triggerdef(t.oid,true)
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='kcml' AND NOT t.tgisinternal
    UNION ALL
    SELECT 'ROUTINE',format('%I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),pg_get_functiondef(p.oid)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='kcml' AND p.prokind IN ('f','p')
    UNION ALL
    SELECT 'POLICY',format('%I.%I.%s',schemaname,tablename,policyname),concat_ws('|',permissive,roles::text,cmd,qual,with_check)
    FROM pg_policies WHERE schemaname='kcml'
  ) SELECT digest(convert_to(coalesce(jsonb_agg(jsonb_build_object('kind',kind,'identity',identity,'definition',definition) ORDER BY kind,identity)::text,'[]'),'UTF8'),'sha256') AS fingerprint FROM objects`);
  const fingerprint = result.rows[0]?.fingerprint;
  if (!fingerprint) throw new Error('DATABASE_SCHEMA_FINGERPRINT_UNAVAILABLE');
  return fingerprint;
}

interface CompiledSchemaContract {
  tableName: string;
  columns: Array<{ name: string; notNull?: boolean }>;
}

export async function verifyDatabaseContract(pool: DatabasePool): Promise<{ ok: true; checks: Record<string, boolean> }> {
  const contractPath=resolve(process.cwd(),'contracts/ssot-surface/postgres-schema-contracts.json');
  const compiled=JSON.parse(await readFile(contractPath,'utf8')) as { records?: CompiledSchemaContract[] };
  if(!Array.isArray(compiled.records)||compiled.records.length===0)throw new Error('DATABASE_COMPILED_SCHEMA_CONTRACT_MISSING');
  const actual=await pool.query<{table_name:string;column_name:string;is_nullable:'YES'|'NO'}>(`SELECT table_name,column_name,is_nullable FROM information_schema.columns WHERE table_schema='kcml' ORDER BY table_name,ordinal_position`);
  const actualColumns=new Map<string,Map<string,'YES'|'NO'>>();
  for(const row of actual.rows){const columns=actualColumns.get(row.table_name)??new Map<string,'YES'|'NO'>();columns.set(row.column_name,row.is_nullable);actualColumns.set(row.table_name,columns);}
  const missingTables:string[]=[];const missingColumns:string[]=[];const nullabilityMismatches:string[]=[];
  for(const record of compiled.records){const table=actualColumns.get(record.tableName);if(!table){missingTables.push(record.tableName);continue;}for(const column of record.columns){const nullable=table.get(column.name);if(nullable===undefined)missingColumns.push(`${record.tableName}.${column.name}`);else if(column.notNull===true&&nullable!=='NO')nullabilityMismatches.push(`${record.tableName}.${column.name}`);}}
  const integrity=await pool.query<{constraints:string;indexes:string;triggers:string;routines:string}>(`SELECT
    (SELECT count(*)::text FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='kcml') constraints,
    (SELECT count(*)::text FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_namespace n ON n.oid=i.relnamespace WHERE n.nspname='kcml') indexes,
    (SELECT count(*)::text FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='kcml' AND NOT t.tgisinternal) triggers,
    (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='kcml' AND p.prokind IN ('f','p')) routines`);
  const singleton=await pool.query<{owner_count:string;credential_count:string;incarnation_count:string;deployment_count:string;audit_count:string;extensions_ok:boolean}>(`SELECT
    (SELECT count(*)::text FROM kcml.owner_identity) owner_count,(SELECT count(*)::text FROM kcml.owner_api_credential) credential_count,
    (SELECT count(*)::text FROM kcml.platform_incarnation) incarnation_count,(SELECT count(*)::text FROM kcml.application_deployment_head) deployment_count,
    (SELECT count(*)::text FROM kcml.audit_head) audit_count,EXISTS(SELECT 1 FROM pg_extension WHERE extname='pgcrypto') AND EXISTS(SELECT 1 FROM pg_extension WHERE extname='citext') extensions_ok`);
  const row=singleton.rows[0];const i=integrity.rows[0];
  const checks={ownerSingleton:row?.owner_count==='1',apiCredentialSingleton:row?.credential_count==='1',platformSingleton:row?.incarnation_count==='1',deploymentSingleton:row?.deployment_count==='1',auditSingleton:row?.audit_count==='1',requiredExtensions:row?.extensions_ok===true,compiledTablesComplete:missingTables.length===0,compiledColumnsComplete:missingColumns.length===0,compiledNullabilityComplete:nullabilityMismatches.length===0,integrityConstraints:Number(i?.constraints??0)>0,integrityIndexes:Number(i?.indexes??0)>0,integrityTriggers:Number(i?.triggers??0)>0,integrityRoutines:Number(i?.routines??0)>0};
  if(Object.values(checks).some((value)=>!value))throw new Error(`Database contract failed: ${JSON.stringify({checks,missingTables:missingTables.slice(0,20),missingColumns:missingColumns.slice(0,20),nullabilityMismatches:nullabilityMismatches.slice(0,20)})}`);
  await databaseSchemaFingerprint(pool);
  return {ok:true,checks};
}

export { pg };
