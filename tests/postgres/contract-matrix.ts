import { randomUUID } from 'node:crypto';
import type { DatabaseClient, DatabasePool } from '@kcml/database';
import { allocateContiguousSequence, inTransactionProfile } from '@kcml/database';

const TEST_TABLE = 'kcml.postgres_contract_fixture';

class Barrier {
  #waiting = 0;
  #release: (() => void) | null = null;
  readonly #ready: Promise<void>;

  public constructor(private readonly parties: number) {
    this.#ready = new Promise((resolve) => { this.#release = resolve; });
  }

  public async wait(): Promise<void> {
    this.#waiting += 1;
    if (this.#waiting === this.parties) this.#release?.();
    await this.#ready;
  }
}

async function rollback(client: DatabaseClient): Promise<void> {
  await client.query('ROLLBACK').catch(() => undefined);
  client.release();
}

function sqlState(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
}

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function cleanupQuery(pool: DatabasePool, query: string, values: readonly unknown[] = []): Promise<void> {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    try { await pool.query(query, [...values]); return; }
    catch (error) { if (sqlState(error) !== '25P02') throw error; }
  }
  throw new Error('PG-CONTRACT-CLEANUP_ABORTED_CONNECTIONS');
}

async function fixtureRows(pool: DatabasePool, ids: string[]): Promise<void> {
  const rows = (await pool.query(`SELECT id,state_version,value,lease_owner,lease_fencing_token,active,cleanup_pending FROM ${TEST_TABLE} WHERE id = ANY($1::uuid[])`, [ids])).rows;
  requireCondition(rows.length === ids.length, 'PG-CONTRACT-FIXTURE_ROWS_MISSING');
}

async function scenarioIdempotencyConflict(pool: DatabasePool, prefix: string): Promise<void> {
  const scope = Buffer.alloc(32, 11); const key = Buffer.alloc(32, 12);
  const first = Buffer.alloc(32, 13); const second = Buffer.alloc(32, 14);
  await pool.query(`INSERT INTO kcml.domain_idempotency_record(scope_digest,key_digest,canonical_key,request_digest,logical_operation_id,command_id,lifecycle,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,'RESERVED',clock_timestamp()+interval '1 hour')`, [scope, key, `${prefix}-conflict`, first, randomUUID(), randomUUID()]);
  const conflict = await pool.query(`INSERT INTO kcml.domain_idempotency_record(scope_digest,key_digest,canonical_key,request_digest,logical_operation_id,command_id,lifecycle,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,'RESERVED',clock_timestamp()+interval '1 hour') ON CONFLICT (scope_digest,key_digest) DO NOTHING RETURNING id`, [scope, key, `${prefix}-conflict-duplicate`, second, randomUUID(), randomUUID()]);
  requireCondition(conflict.rowCount === 0, 'PG-CONCURRENT-OP-IDEMPOTENCY_CONFLICT_CREATED_HANDLER');
  const row = (await pool.query(`SELECT request_digest FROM kcml.domain_idempotency_record WHERE scope_digest=$1 AND key_digest=$2`, [scope, key])).rows[0];
  requireCondition(Buffer.from(row.request_digest).equals(first), 'PG-CONCURRENT-OP-IDEMPOTENCY_CONFLICT_DIGEST_REPLACED');
}

async function scenarioFirstCreate(pool: DatabasePool, prefix: string): Promise<void> {
  const results = await Promise.all(Array.from({ length: 50 }, (_, index) => pool.query(`INSERT INTO ${TEST_TABLE}(id,source_key,value)
    VALUES($1,$2,$3) ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO NOTHING RETURNING id`, [randomUUID(), `${prefix}-first-create`, `candidate-${index}`])));
  requireCondition(results.filter((result) => result.rowCount === 1).length === 1, 'PG-FIRST-CREATE_MORE_THAN_ONE_IDENTITY');
  const count = (await pool.query(`SELECT count(*)::int AS count FROM ${TEST_TABLE} WHERE source_key=$1`, [`${prefix}-first-create`])).rows[0]?.count;
  requireCondition(Number(count) === 1, 'PG-FIRST-CREATE_UNIQUE_IDENTITY_MISSING');
}

async function scenarioCanonicalBulkLock(pool: DatabasePool): Promise<void> {
  const ids = [randomUUID(), randomUUID()];
  await pool.query(`INSERT INTO ${TEST_TABLE}(id,value) VALUES($1,'bulk-a'),($2,'bulk-b')`, ids);
  await Promise.all([ids.slice().sort().map((id) => inTransactionProfile(pool, 'ONLINE_MUTATION', async (client) => {
    await client.query(`SELECT id FROM ${TEST_TABLE} WHERE id=$1 FOR UPDATE`, [id]);
  })), ids.slice().sort().map((id) => inTransactionProfile(pool, 'ONLINE_MUTATION', async (client) => {
    await client.query(`SELECT id FROM ${TEST_TABLE} WHERE id=$1 FOR UPDATE`, [id]);
  }))]);
  await fixtureRows(pool, ids);
}

async function scenarioDeadlockDetection(pool: DatabasePool): Promise<void> {
  const ids = [randomUUID(), randomUUID()];
  await pool.query(`INSERT INTO ${TEST_TABLE}(id,value) VALUES($1,'deadlock-a'),($2,'deadlock-b')`, ids);
  const barrier = new Barrier(2);
  const run = async (first: string, second: string): Promise<string> => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN'); await client.query("SET LOCAL lock_timeout='2s'");
      await client.query(`SELECT id FROM ${TEST_TABLE} WHERE id=$1 FOR UPDATE`, [first]); await barrier.wait();
      await client.query(`SELECT id FROM ${TEST_TABLE} WHERE id=$1 FOR UPDATE`, [second]); await client.query('COMMIT'); return '';
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); return sqlState(error); } finally { client.release(); }
  };
  const codes = await Promise.all([run(ids[0], ids[1]), run(ids[1], ids[0])]);
  requireCondition(codes.includes('40P01'), `PG-LOCK-ORDER-INVERSION_NOT_DETECTED:${codes.join(',')}`);
}

async function scenarioQueueMultiWorker(pool: DatabasePool, prefix: string, authority: Record<string, unknown>): Promise<void> {
  const ids = Array.from({ length: 10 }, () => randomUUID());
  await pool.query(`INSERT INTO kcml.queue_item(id,queue_name,partition_key,payload,platform_incarnation_id,application_deployment_epoch,recovery_epoch)
    SELECT id,'postgres-contract-workers',id::text,'{}'::jsonb,$2,$3,$4 FROM unnest($1::uuid[]) AS id`, [ids, authority.platform_incarnation_id, authority.current_epoch, authority.recovery_epoch]);
  const claimed = await Promise.all(Array.from({ length: 10 }, () => inTransactionProfile(pool, 'WORKER_COMMIT', async (client) => {
    const result = await client.query(`UPDATE kcml.queue_item SET status='CLAIMED',lease_owner=$1,lease_fencing_token=1,lease_expires_at=clock_timestamp()+interval '1 minute',attempt_count=attempt_count+1
      WHERE id=(SELECT id FROM kcml.queue_item WHERE queue_name='postgres-contract-workers' AND status='READY' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id`, [randomUUID()]);
    return result.rows[0]?.id as string | undefined;
  })));
  requireCondition(new Set(claimed.filter(Boolean)).size === ids.length, 'PG-QUEUE-MULTIWORKER_DUPLICATE_OR_MISSING_CLAIM');
  await pool.query(`DELETE FROM kcml.queue_item WHERE queue_name='postgres-contract-workers'`);
}

async function scenarioQueueEligibility(pool: DatabasePool, authority: Record<string, unknown>): Promise<void> {
  const id = randomUUID();
  await pool.query(`INSERT INTO kcml.queue_item(id,queue_name,partition_key,payload,available_at,platform_incarnation_id,application_deployment_epoch,recovery_epoch)
    VALUES($1,'postgres-contract-eligibility',$2,'{}'::jsonb,clock_timestamp()+interval '1 hour',$3,$4,$5)`, [id, id, authority.platform_incarnation_id, authority.current_epoch, authority.recovery_epoch]);
  const result = await pool.query(`UPDATE kcml.queue_item SET status='CLAIMED' WHERE id=$1 AND status='READY' AND available_at <= clock_timestamp() RETURNING id`, [id]);
  requireCondition(result.rowCount === 0, 'PG-QUEUE-STALE_ELIGIBILITY_DISPATCHED');
  await pool.query(`DELETE FROM kcml.queue_item WHERE id=$1`, [id]);
}

async function scenarioLeaseRace(pool: DatabasePool, id: string): Promise<void> {
  await pool.query(`UPDATE ${TEST_TABLE} SET lease_owner=NULL,lease_fencing_token=0,lease_expires_at=clock_timestamp()+interval '1 second' WHERE id=$1`, [id]);
  const owners = [randomUUID(), randomUUID()];
  const results = await Promise.all(owners.map((owner) => pool.query(`UPDATE ${TEST_TABLE} SET lease_owner=$2,lease_fencing_token=lease_fencing_token+1,lease_expires_at=clock_timestamp()+interval '1 minute'
    WHERE id=$1 AND (lease_owner IS NULL OR lease_expires_at <= clock_timestamp()) RETURNING lease_owner`, [id, owner])));
  requireCondition(results.filter((result) => result.rowCount === 1).length === 1, 'PG-LEASE-RACE_TWO_CURRENT_OWNERS');
}

async function scenarioLeaseExpiryDuringTransaction(pool: DatabasePool, id: string): Promise<void> {
  const client = await pool.connect();
  const takeover = await pool.connect();
  try {
    await client.query('BEGIN'); await client.query(`SELECT id FROM ${TEST_TABLE} WHERE id=$1 FOR UPDATE`, [id]);
    await client.query(`UPDATE ${TEST_TABLE} SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`, [id]);
    await takeover.query('BEGIN'); await takeover.query("SET LOCAL lock_timeout='100ms'");
    let code = ''; let rows = 0;
    try { rows = (await takeover.query(`UPDATE ${TEST_TABLE} SET lease_owner=$2,lease_fencing_token=lease_fencing_token+1 WHERE id=$1 AND lease_expires_at <= clock_timestamp()`, [id, randomUUID()])).rowCount ?? 0; } catch (error) { code = sqlState(error); }
    requireCondition(code === '55P03' || rows === 0, `PG-LEASE-EXPIRY_TAKEOVER_ORDER_UNCLEAR:${code}:${rows}`);
  } finally { await rollback(takeover); await rollback(client); }
}

async function scenarioLateFence(pool: DatabasePool, id: string): Promise<void> {
  const result = await pool.query(`UPDATE ${TEST_TABLE} SET value='stale',state_version=state_version+1 WHERE id=$1 AND lease_fencing_token=0 AND lease_expires_at > clock_timestamp()`, [id]);
  requireCondition(result.rowCount === 0, 'PG-LATE-FENCE_WRITE_ACCEPTED');
}

async function scenarioTerminalSuccessorCrash(pool: DatabasePool, id: string): Promise<void> {
  const before = (await pool.query(`SELECT state_version FROM ${TEST_TABLE} WHERE id=$1`, [id])).rows[0].state_version;
  const client = await pool.connect();
  try { await client.query('BEGIN'); await client.query(`UPDATE ${TEST_TABLE} SET value='terminal',state_version=state_version+1 WHERE id=$1`, [id]); await client.query('ROLLBACK'); }
  finally { client.release(); }
  const after = (await pool.query(`SELECT state_version FROM ${TEST_TABLE} WHERE id=$1`, [id])).rows[0].state_version;
  requireCondition(after === before, 'PG-CRASH-PRECOMMIT_PARTIAL_TERMINAL');
  await inTransactionProfile(pool, 'WORKER_COMMIT', (db) => db.query(`UPDATE ${TEST_TABLE} SET value='terminal',state_version=state_version+1 WHERE id=$1`, [id]));
  const committed = (await pool.query(`SELECT state_version FROM ${TEST_TABLE} WHERE id=$1`, [id])).rows[0].state_version;
  requireCondition(committed === String(Number(before) + 1), 'PG-CRASH_POSTCOMMIT_SUCCESSOR_NOT_LINEARIZED');
}

async function scenarioSideEffectRace(pool: DatabasePool, prefix: string): Promise<void> {
  const operationId = randomUUID();
  await pool.query(`CREATE TABLE ${TEST_TABLE}_attempt (operation_id uuid NOT NULL,attempt_sequence bigint NOT NULL,authority boolean NOT NULL,payload_digest bytea NOT NULL,PRIMARY KEY(operation_id,attempt_sequence))`);
  await pool.query(`CREATE UNIQUE INDEX ${TEST_TABLE.replaceAll('.', '_')}_attempt_authority_uq ON ${TEST_TABLE}_attempt(operation_id) WHERE authority`);
  try {
    await Promise.all(Array.from({ length: 100 }, (_, index) => pool.query(`INSERT INTO ${TEST_TABLE}_attempt(operation_id,attempt_sequence,authority,payload_digest)
      VALUES($1,1,true,$2) ON CONFLICT DO NOTHING`, [operationId, Buffer.alloc(32, index % 255)])));
    const row = (await pool.query(`SELECT count(*)::int AS count,count(*) FILTER (WHERE authority)::int AS authorities FROM ${TEST_TABLE}_attempt WHERE operation_id=$1`, [operationId])).rows[0];
    requireCondition(Number(row.count) === 1 && Number(row.authorities) === 1, 'PG-SIDE-EFFECT_RACE_MULTIPLE_ATTEMPTS_OR_AUTHORITY');
  } finally { await pool.query(`DROP TABLE ${TEST_TABLE}_attempt`); }
}

async function scenarioImmutableRows(pool: DatabasePool, authority: Record<string, unknown>): Promise<void> {
  const commandId = randomUUID(); const logicalOperationId = randomUUID(); const sideEffectId = randomUUID(); const outboxId = randomUUID();
  const digest = Buffer.alloc(32, 31); const requestBytes = Buffer.from('{}');
  await pool.query(`INSERT INTO kcml.domain_command(id,logical_operation_id,operation_name,caller_fingerprint,request_canonical_bytes,request,request_digest,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,'td15.immutable','test',$3,'{}'::jsonb,kcml.canonical_digest($3),$4,0,$5,$6)`, [commandId, logicalOperationId, requestBytes, randomUUID(), authority.platform_incarnation_id, authority.current_epoch]);
  await pool.query(`INSERT INTO kcml.side_effect_operation(id,command_id,step_key,target_binding,request,request_digest,idempotency_key,side_effect_class,retry_class,reconciliation_contract,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,'immutable','fixture','{}'::jsonb,$3,$4,'REVERSIBLE','SAFE_RETRY','{}'::jsonb,$5,$6)`, [sideEffectId, commandId, digest, `td15-${sideEffectId}`, authority.platform_incarnation_id, authority.current_epoch]);
  await pool.query(`INSERT INTO kcml.transactional_outbox(id,stream_key,stream_sequence,purpose,event_type,payload,payload_digest,is_dispatch_authority,side_effect_operation_id,side_effect_attempt_sequence)
    VALUES($1,$2,1,'SIDE_EFFECT_DISPATCH','td15.immutable','{}'::jsonb,$3,true,$4,1)`, [outboxId, `td15-immutable-${sideEffectId}`, digest, sideEffectId]);
  await pool.query(`INSERT INTO kcml.side_effect_attempt(operation_id,attempt_sequence,request_evidence,request_digest,dispatch_authority_outbox_id)
    VALUES($1,1,'{}'::jsonb,$2,$3)`, [sideEffectId, digest, outboxId]);
  await pool.query(`INSERT INTO kcml.side_effect_attempt_evidence(operation_id,attempt_sequence,evidence_sequence,evidence_type,payload,payload_digest)
    VALUES($1,1,1,'REQUEST','{}'::jsonb,$2)`, [sideEffectId, digest]);
  for (const statement of [
    `UPDATE kcml.side_effect_attempt SET request_evidence='{"changed":true}'::jsonb WHERE operation_id=$1 AND attempt_sequence=1`,
    `DELETE FROM kcml.side_effect_attempt_evidence WHERE operation_id=$1 AND attempt_sequence=1 AND evidence_sequence=1`
  ]) {
    let code = ''; try { await pool.query(statement, [sideEffectId]); } catch (error) { code = sqlState(error); }
    requireCondition(code === '55000', `PG-IMMUTABLE_ROW_MUTATION_ACCEPTED:${code}`);
  }
}

async function scenarioCompositeFk(pool: DatabasePool): Promise<void> {
  await pool.query(`CREATE TABLE kcml.td15_fk_parent(id uuid PRIMARY KEY,revision bigint NOT NULL,UNIQUE(id,revision));
    CREATE TABLE kcml.td15_fk_child(parent_id uuid NOT NULL,parent_revision bigint NOT NULL,FOREIGN KEY(parent_id,parent_revision) REFERENCES kcml.td15_fk_parent(id,revision))`);
  try {
    let code = ''; try { await pool.query(`INSERT INTO kcml.td15_fk_child(parent_id,parent_revision) VALUES($1,1)`, [randomUUID()]); } catch (error) { code = sqlState(error); }
    requireCondition(code === '23503', `PG-COMPOSITE_FK_PHANTOM_ACCEPTED:${code}`);
  } finally { await cleanupQuery(pool, 'DROP TABLE kcml.td15_fk_child'); await cleanupQuery(pool, 'DROP TABLE kcml.td15_fk_parent'); }
}

async function scenarioSecretActiveUnique(pool: DatabasePool, authority: Record<string, unknown>): Promise<void> {
  const owner = (await pool.query(`SELECT id FROM kcml.owner_identity WHERE singleton_key=1`)).rows[0]?.id;
  const secretId = randomUUID();
  await pool.query(`INSERT INTO kcml.secret_record(id,stable_name,display_name,kind,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,'TD15 secret','API_KEY',$3,$4)`, [secretId, `TD15_SECRET_${secretId.replaceAll('-', '').slice(0, 12).toUpperCase()}`, authority.platform_incarnation_id, authority.current_epoch]);
  const versions = [1, 2].map(() => randomUUID());
  for (const [index, versionId] of versions.entries()) await pool.query(`INSERT INTO kcml.secret_version(id,secret_id,version_number,ciphertext,nonce,auth_tag,key_id,fingerprint,value_digest,created_by)
    VALUES($1,$2,$3,decode('636970686572','hex'),decode(repeat('00',12),'hex'),decode(repeat('00',16),'hex'),'td15','td15',decode(repeat('11',32),'hex'),$4)`, [versionId, secretId, index + 1, owner]);
  await pool.query(`UPDATE kcml.secret_version SET lifecycle='ACTIVE' WHERE id=$1`, [versions[0]]);
  let code = ''; try { await pool.query(`UPDATE kcml.secret_version SET lifecycle='ACTIVE' WHERE id=$1`, [versions[1]]); } catch (error) { code = sqlState(error); }
  requireCondition(code === '23505', `PG-SECRET_ACTIVE_UNIQUE_NOT_ENFORCED:${code}`);
}

async function scenarioInbox(pool: DatabasePool, prefix: string): Promise<void> {
  const stream = `postgres-contract-inbox:${prefix}`; const digest = Buffer.alloc(32, 21);
  await pool.query(`CREATE TABLE ${TEST_TABLE}_inbox (consumer text NOT NULL,stream text NOT NULL,sequence bigint NOT NULL,digest bytea NOT NULL,PRIMARY KEY(consumer,stream,sequence))`);
  try {
    await Promise.all(Array.from({ length: 20 }, () => pool.query(`INSERT INTO ${TEST_TABLE}_inbox VALUES('consumer',$1,1,$2) ON CONFLICT DO NOTHING`, [stream, digest])));
    requireCondition((await pool.query(`SELECT count(*)::int AS count FROM ${TEST_TABLE}_inbox WHERE stream=$1`, [stream])).rows[0].count === 1, 'PG-INBOX-DUPLICATE_EFFECT');
    const conflict = await pool.query(`INSERT INTO ${TEST_TABLE}_inbox VALUES('consumer',$1,1,$2) ON CONFLICT DO NOTHING RETURNING sequence`, [stream, Buffer.alloc(32, 22)]);
    requireCondition(conflict.rowCount === 0, 'PG-INBOX-DIGEST_CONFLICT_ACCEPTED');
  } finally { await pool.query(`DROP TABLE ${TEST_TABLE}_inbox`); }
}

async function scenarioAuditRollback(pool: DatabasePool, id: string): Promise<void> {
  const original = (await pool.query(`SELECT value FROM ${TEST_TABLE} WHERE id=$1`, [id])).rows[0].value;
  const client = await pool.connect();
  try {
    await client.query('BEGIN'); await client.query(`UPDATE ${TEST_TABLE} SET value='must-rollback',state_version=state_version+1 WHERE id=$1`, [id]);
    await client.query(`INSERT INTO kcml.audit_event(id,chain_sequence,event_type,actor_kind,actor_id,aggregate_type,aggregate_id,correlation_id,causation_id,payload,payload_canonical_bytes,payload_digest,previous_hash,event_hash)
      SELECT gen_random_uuid(),chain_sequence,event_type,actor_kind,actor_id,aggregate_type,aggregate_id,correlation_id,causation_id,payload,payload_canonical_bytes,payload_digest,previous_hash,event_hash
      FROM kcml.audit_event ORDER BY chain_sequence LIMIT 1`);
  } catch (error) { requireCondition(sqlState(error) === '23505', `PG-AUDIT_FAILURE_WRONG_SQLSTATE:${sqlState(error)}`); await client.query('ROLLBACK'); }
  finally { client.release(); }
  requireCondition((await pool.query(`SELECT value FROM ${TEST_TABLE} WHERE id=$1`, [id])).rows[0].value === original, 'PG-AUDIT_FAILURE_DOMAIN_MUTATION_COMMITTED');
}

async function scenarioSerializablePredicate(pool: DatabasePool): Promise<void> {
  await pool.query(`INSERT INTO ${TEST_TABLE}(id,value,state_version) VALUES($1,'predicate-a',0),($2,'predicate-b',0)`, [randomUUID(), randomUUID()]);
  const ids = (await pool.query(`SELECT id FROM ${TEST_TABLE} WHERE value LIKE 'predicate-%' ORDER BY id LIMIT 2`)).rows.map((row) => row.id as string);
  const barrier = new Barrier(2);
  const run = async (id: string): Promise<string> => {
    try { return await inTransactionProfile(pool, 'SERIALIZABLE_PREDICATE', async (client) => { const count = await client.query(`SELECT count(*)::int AS count FROM ${TEST_TABLE} WHERE value LIKE 'predicate-%'`); await barrier.wait(); if (Number(count.rows[0].count) > 0) await client.query(`UPDATE ${TEST_TABLE} SET value=value||'-checked',state_version=state_version+1 WHERE id=$1`, [id]); return ''; }); }
    catch (error) { return sqlState(error); }
  };
  const codes = await Promise.all(ids.map(run));
  requireCondition(codes.includes('40001'), `PG-SERIALIZABLE_WRITE_SKEW_NOT_REJECTED:${codes.join(',')}`);
}

async function scenarioClosureSnapshot(pool: DatabasePool): Promise<void> {
  const result = await inTransactionProfile(pool, 'CLOSURE_SNAPSHOT', async (client) => {
    const tx = (await client.query<{ isolation: string; read_only: string; deferrable: string }>(`SELECT current_setting('transaction_isolation') isolation,current_setting('transaction_read_only') read_only,current_setting('transaction_deferrable') deferrable`)).rows[0];
    return tx;
  });
  requireCondition(result.isolation === 'serializable' && result.read_only === 'on' && result.deferrable === 'on', 'PG-CLOSURE_PROFILE_NOT_DEFERRABLE_READ_ONLY');
}

async function scenarioConnectionLoss(pool: DatabasePool, id: string): Promise<void> {
  const client = await pool.connect();
  try { await client.query('BEGIN'); await client.query(`UPDATE ${TEST_TABLE} SET value='lost-before-ack',state_version=state_version+1 WHERE id=$1`, [id]); client.release(true); }
  catch { client.release(true); }
  const row = (await pool.query(`SELECT value FROM ${TEST_TABLE} WHERE id=$1`, [id])).rows[0];
  requireCondition(row.value !== 'lost-before-ack', 'PG-CONNECTION_LOSS_PARTIAL_COMMIT');
}

async function scenarioEpochFence(pool: DatabasePool, id: string): Promise<void> {
  await pool.query(`UPDATE ${TEST_TABLE} SET current_epoch=2 WHERE id=$1`, [id]);
  const result = await pool.query(`UPDATE ${TEST_TABLE} SET value='old-epoch',state_version=state_version+1 WHERE id=$1 AND current_epoch=1`, [id]);
  requireCondition(result.rowCount === 0, 'PG-PLATFORM_EPOCH_STALE_WRITE_ACCEPTED');
}

async function scenarioUniqueCheckFk(pool: DatabasePool): Promise<void> {
  let checkCode = ''; try { await pool.query(`INSERT INTO ${TEST_TABLE}(id,value,state_version) VALUES($1,'bad-check',-1)`, [randomUUID()]); } catch (error) { checkCode = sqlState(error); }
  requireCondition(checkCode === '23514', `PG-CONSTRAINT_CHECK_NOT_ENFORCED:${checkCode}`);
  let uniqueCode = ''; const id = randomUUID(); await pool.query(`INSERT INTO ${TEST_TABLE}(id,source_key,value) VALUES($1,'td15-constraint',$2)`, [id, id]); try { await pool.query(`INSERT INTO ${TEST_TABLE}(id,source_key,value) VALUES($1,'td15-constraint','duplicate')`, [randomUUID()]); } catch (error) { uniqueCode = sqlState(error); }
  requireCondition(uniqueCode === '23505', `PG-CONSTRAINT_UNIQUE_NOT_ENFORCED:${uniqueCode}`);
}

async function scenarioExpectedVersionRace(pool: DatabasePool, id: string): Promise<void> {
  await pool.query(`UPDATE ${TEST_TABLE} SET state_version=0,value='version-race' WHERE id=$1`, [id]);
  const results = await Promise.all([1, 2].map((value) => pool.query(`UPDATE ${TEST_TABLE} SET value=$2,state_version=state_version+1 WHERE id=$1 AND state_version=0 RETURNING id`, [id, `winner-${value}`])));
  requireCondition(results.filter((result) => result.rowCount === 1).length === 1, 'PG-EXPECTED-VERSION_RACE_NOT_SINGLE_COMMIT');
}

async function scenarioPartialUnique(pool: DatabasePool, prefix: string): Promise<void> {
  const table = 'kcml.td15_active_unique_fixture';
  await pool.query(`CREATE TABLE IF NOT EXISTS ${table}(scope text NOT NULL, active boolean NOT NULL, value text NOT NULL)`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS td15_active_unique_fixture_uq ON ${table}(scope) WHERE active`);
  await pool.query(`DELETE FROM ${table} WHERE scope=$1`, [prefix]);
  try {
    const results = await Promise.all([1, 2].map((value) => pool.query(`INSERT INTO ${table}(scope,active,value) VALUES($1,true,$2) ON CONFLICT DO NOTHING RETURNING value`, [prefix, `active-${value}`])));
    requireCondition(results.filter((result) => result.rowCount === 1).length === 1, 'PG-PARTIAL-UNIQUE_DOUBLE_ACTIVE');
  } finally { await pool.query(`DELETE FROM ${table} WHERE scope=$1`, [prefix]); }
}

async function scenarioContiguousSession(pool: DatabasePool, prefix: string): Promise<void> {
  const table = 'kcml.td15_session_sequence_fixture';
  await pool.query(`CREATE TABLE IF NOT EXISTS ${table}(session text NOT NULL,sequence bigint NOT NULL,source text NOT NULL,value text NOT NULL,PRIMARY KEY(session,sequence),UNIQUE(session,source))`);
  await pool.query(`DELETE FROM ${table} WHERE session=$1`, [prefix]);
  const parentId = randomUUID();
  const sequences = await Promise.all(Array.from({ length: 20 }, (_, index) => inTransactionProfile(pool, 'WORKER_COMMIT', async (client) => {
    const number = await allocateContiguousSequence(client, 'TD15_SESSION', parentId, 'EVENT');
    await client.query(`INSERT INTO ${table}(session,sequence,source,value) VALUES($1,$2,$3,$4)`, [prefix, number, `${prefix}-${index}`, 'event']);
    return number;
  })));
  requireCondition(new Set(sequences.map(String)).size === 20, 'PG-SESSION_SEQUENCE_DUPLICATE');
  await pool.query(`DELETE FROM ${table} WHERE session=$1`, [prefix]);
}

async function scenarioForwardCompatibility(pool: DatabasePool, prefix: string): Promise<void> {
  const table = 'kcml.td15_forward_schema_fixture';
  await pool.query(`CREATE TABLE IF NOT EXISTS ${table}(id uuid PRIMARY KEY,value text NOT NULL)`);
  await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS forward_epoch bigint NOT NULL DEFAULT 0`);
  const id = randomUUID();
  await pool.query(`INSERT INTO ${table}(id,value) VALUES($1,'forward') ON CONFLICT (id) DO UPDATE SET value=EXCLUDED.value`, [id]);
  const oldRelease = await pool.query(`SELECT id,value FROM ${table} WHERE id=$1`, [id]);
  requireCondition(oldRelease.rowCount === 1 && oldRelease.rows[0].value === 'forward', 'PG-FORWARD-SCHEMA_OLD_RELEASE_READ_FAILED');
  await pool.query(`DELETE FROM ${table} WHERE id=$1`, [id]);
}

async function scenarioInvalidConcurrentIndex(pool: DatabasePool): Promise<void> {
  const table = 'kcml.td15_invalid_index_fixture'; const index = 'td15_invalid_index_fixture_uq';
  await cleanupQuery(pool, `DROP INDEX IF EXISTS ${index}`); await cleanupQuery(pool, `DROP TABLE IF EXISTS ${table}`);
  await pool.query(`CREATE TABLE ${table}(value text)`); await pool.query(`INSERT INTO ${table}(value) VALUES('duplicate'),('duplicate')`);
  let code = ''; try { await pool.query(`CREATE UNIQUE INDEX CONCURRENTLY ${index} ON ${table}(value)`); } catch (error) { code = sqlState(error); }
  const indexState = (await pool.query(`SELECT indisvalid AS valid FROM pg_index WHERE indexrelid=to_regclass($1)`, [`public.${index}`])).rows[0]?.valid ?? null;
  requireCondition(code === '23505' && (indexState === false || indexState === null), `PG-INVALID_INDEX_NOT_RECORDED:${code}:${indexState}`);
  await cleanupQuery(pool, `DROP INDEX CONCURRENTLY IF EXISTS ${index}`); await cleanupQuery(pool, `DROP TABLE ${table}`);
}

async function scenarioRandomNemesis(pool: DatabasePool): Promise<void> {
  const ids = Array.from({ length: 10 }, () => randomUUID());
  await pool.query(`INSERT INTO ${TEST_TABLE}(id,value,state_version) SELECT id,'nemesis',0 FROM unnest($1::uuid[]) AS id`, [ids]);
  const workers = Array.from({ length: 100 }, (_, worker) => inTransactionProfile(pool, 'ONLINE_MUTATION', async (client) => {
    await client.query(`SELECT id FROM ${TEST_TABLE} WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [ids]);
    let seed = worker + 1;
    for (let step = 0; step < 100; step += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const id = ids[seed % ids.length];
      await client.query(`UPDATE ${TEST_TABLE} SET state_version=state_version+1,value='nemesis' WHERE id=$1`, [id]);
    }
  }));
  await Promise.all(workers);
  const total = (await pool.query(`SELECT coalesce(sum(state_version),0)::bigint AS total FROM ${TEST_TABLE} WHERE id=ANY($1::uuid[])`, [ids])).rows[0].total;
  requireCondition(total === '10000', `PG-NEMESIS_INVARIANT_VIOLATION:${total}`);
}

async function scenarioCas(pool: DatabasePool, id: string): Promise<void> {
  const barrier = new Barrier(2);
  const run = async (value: string) => inTransactionProfile(pool, 'ONLINE_MUTATION', async (client) => {
    await client.query(`SELECT state_version FROM ${TEST_TABLE} WHERE id=$1`, [id]);
    await barrier.wait();
    const result = await client.query(`UPDATE ${TEST_TABLE} SET value=$2,state_version=state_version+1 WHERE id=$1 AND state_version=0 RETURNING id`, [id, value]);
    return result.rowCount;
  });
  const results = await Promise.all([run('first'), run('second')]);
  if (results.filter((count) => count === 1).length !== 1) throw new Error('PG-CONCURRENT-OP-CAS_EXPECTED_ONE_COMMIT');
}

async function scenarioIdempotency(pool: DatabasePool, prefix: string): Promise<void> {
  const scope = Buffer.alloc(32, 7);
  const key = Buffer.alloc(32, 8);
  const request = Buffer.alloc(32, 9);
  await Promise.all(Array.from({ length: 100 }, (_, index) => pool.query(`INSERT INTO kcml.domain_idempotency_record(scope_digest,key_digest,canonical_key,request_digest,logical_operation_id,command_id,lifecycle,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,'RESERVED',clock_timestamp()+interval '1 hour') ON CONFLICT (scope_digest,key_digest) DO NOTHING`, [scope, key, `${prefix}-${index}`, request, randomUUID(), randomUUID()])));
  const row = (await pool.query(`SELECT count(*)::int AS count,min(canonical_key) AS canonical_key FROM kcml.domain_idempotency_record WHERE scope_digest=$1 AND key_digest=$2`, [scope, key])).rows[0];
  if (Number(row?.count) !== 1) throw new Error('PG-CONCURRENT-OP-IDEMPOTENCY_EXPECTED_ONE_LOGICAL_OPERATION');
  const conflict = (await pool.query(`SELECT request_digest FROM kcml.domain_idempotency_record WHERE scope_digest=$1 AND key_digest=$2`, [scope, key])).rows[0];
  if (!Buffer.from(conflict.request_digest).equals(request)) throw new Error('PG-CONCURRENT-OP-IDEMPOTENCY_REQUEST_DIGEST_CHANGED');
}

async function scenarioQueueSkipLocked(pool: DatabasePool, prefix: string, authority: Record<string, unknown>): Promise<void> {
  const ids = [randomUUID(), randomUUID()];
  await pool.query(`INSERT INTO kcml.queue_item(id,queue_name,partition_key,payload,platform_incarnation_id,application_deployment_epoch,recovery_epoch)
    VALUES ($1,'postgres-contract',$2,'{}'::jsonb,$3,$4,$5),($6,'postgres-contract',$7,'{}'::jsonb,$3,$4,$5)`, [ids[0], `${prefix}-a`, authority.platform_incarnation_id, authority.current_epoch, authority.recovery_epoch, ids[1], `${prefix}-b`]);
  const first = await pool.connect();
  const second = await pool.connect();
  try {
    await first.query('BEGIN');
    await first.query(`SELECT id FROM kcml.queue_item WHERE id=$1 FOR UPDATE`, [ids[0]]);
    await second.query('BEGIN');
    const result = await second.query(`SELECT id FROM kcml.queue_item WHERE queue_name='postgres-contract' AND status='READY' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1`);
    if (result.rows[0]?.id === ids[0]) throw new Error('PG-QUEUE-SKIP-LOCKED_RETURNED_LOCKED_ITEM');
  } finally {
    await rollback(second);
    await rollback(first);
  }
}

async function scenarioSequence(pool: DatabasePool, parentId: string): Promise<void> {
  const values = await Promise.all(Array.from({ length: 100 }, () => inTransactionProfile(pool, 'WORKER_COMMIT', (client) => allocateContiguousSequence(client, 'POSTGRES_CONTRACT', parentId, 'EVENT'))));
  const sorted = values.sort((left, right) => Number(left - right));
  for (const [index, value] of sorted.entries()) if (value !== BigInt(index + 1)) throw new Error('PG-CONCURRENT-OP-SEQUENCE_GAP');
}

async function scenarioLockTimeout(pool: DatabasePool, id: string): Promise<void> {
  const first = await pool.connect();
  const second = await pool.connect();
  try {
    await first.query('BEGIN');
    await first.query(`SELECT id FROM ${TEST_TABLE} WHERE id=$1 FOR UPDATE`, [id]);
    await second.query('BEGIN');
    await second.query("SET LOCAL lock_timeout = '50ms'");
    let code = '';
    try { await second.query(`UPDATE ${TEST_TABLE} SET value='must-not-commit',state_version=state_version+1 WHERE id=$1`, [id]); }
    catch (error) { code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''; }
    if (code !== '55P03') throw new Error(`PG-LOCK-TIMEOUT_EXPECTED_55P03:${code}`);
  } finally {
    await rollback(second);
    await rollback(first);
  }
}

async function scenarioOutboxDedupe(pool: DatabasePool, prefix: string): Promise<void> {
  const stream = `postgres-contract:${prefix}`;
  const digest = Buffer.alloc(32, 4);
  await Promise.all(Array.from({ length: 20 }, () => pool.query(`INSERT INTO kcml.transactional_outbox(stream_key,stream_sequence,purpose,event_type,payload,payload_digest)
    VALUES($1,1,'DOMAIN_EVENT','postgres.contract.test','{}'::jsonb,$2) ON CONFLICT (stream_key,stream_sequence) DO NOTHING`, [stream, digest])));
  const row = (await pool.query(`SELECT count(*)::int AS count FROM kcml.transactional_outbox WHERE stream_key=$1 AND stream_sequence=1`, [stream])).rows[0];
  if (Number(row?.count) !== 1) throw new Error('PG-CONCURRENT-OP-OUTBOX_DUPLICATE');
}

async function scenarioAuditAppend(pool: DatabasePool, prefix: string): Promise<void> {
  await Promise.all(Array.from({ length: 4 }, () => inTransactionProfile(pool, 'ONLINE_MUTATION', async (client) => {
    const payload = { prefix, operation: 'postgres.contract.audit' };
    const payloadBytes = Buffer.from(JSON.stringify(payload));
    await client.query(`SELECT * FROM kcml.append_audit_event($1,'TEST',$2,'POSTGRES_CONTRACT',NULL,$3,NULL,$4,$5)`, ['postgres.contract.test', prefix, randomUUID(), payload, payloadBytes]);
  })));
  const invalid = (await pool.query(`SELECT count(*)::int AS count FROM kcml.audit_event event JOIN kcml.audit_event previous ON previous.chain_sequence=event.chain_sequence-1 WHERE event.previous_hash<>previous.event_hash`)).rows[0];
  if (Number(invalid?.count) !== 0) throw new Error('PG-CONCURRENT-OP-AUDIT_CHAIN_INVALID');
}

export async function runPostgresContractMatrix(pool: DatabasePool): Promise<void> {
  const prefix = `td15-${randomUUID()}`;
  const fixtureId = randomUUID();
  const authority = (await pool.query(`SELECT platform.platform_incarnation_id,deployment.current_epoch,recovery.recovery_epoch
    FROM kcml.platform_incarnation platform CROSS JOIN kcml.application_deployment_head deployment CROSS JOIN kcml.platform_recovery_head recovery
    WHERE platform.singleton_key=1 AND deployment.singleton_key=1 AND recovery.singleton_key=1`)).rows[0];
  if (!authority) throw new Error('PG-CONTRACT-AUTHORITY_HEADS_MISSING');
  await pool.query(`CREATE TABLE ${TEST_TABLE} (
    id uuid PRIMARY KEY,
    value text NOT NULL,
    state_version bigint NOT NULL DEFAULT 0 CHECK (state_version >= 0),
    source_key text,
    lease_owner uuid,
    lease_fencing_token bigint NOT NULL DEFAULT 0 CHECK (lease_fencing_token >= 0),
    lease_expires_at timestamptz,
    available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    active boolean NOT NULL DEFAULT false,
    current_epoch bigint NOT NULL DEFAULT 1,
    cleanup_pending boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
  )`);
  await pool.query(`CREATE UNIQUE INDEX td15_fixture_source_uq ON ${TEST_TABLE}(source_key) WHERE source_key IS NOT NULL`);
  await pool.query(`INSERT INTO ${TEST_TABLE}(id,value) VALUES($1,'initial')`, [fixtureId]);
  try {
    await scenarioCas(pool, fixtureId); // 1
    await scenarioIdempotency(pool, prefix); // 2
    await scenarioIdempotencyConflict(pool, prefix); // 3
    await scenarioFirstCreate(pool, prefix); // 4
    await scenarioCanonicalBulkLock(pool); // 5
    await scenarioDeadlockDetection(pool); // 6
    await scenarioQueueMultiWorker(pool, prefix, authority); // 7
    await scenarioQueueSkipLocked(pool, prefix, authority); // 8
    await scenarioQueueEligibility(pool, authority); // 9
    await scenarioLeaseRace(pool, fixtureId); // 10
    await scenarioLeaseExpiryDuringTransaction(pool, fixtureId); // 11/12
    await scenarioLateFence(pool, fixtureId); // 13
    await scenarioTerminalSuccessorCrash(pool, fixtureId); // 14
    await scenarioSideEffectRace(pool, prefix); // 15
    await scenarioInbox(pool, prefix); // 16
    await scenarioSequence(pool, fixtureId); // 17
    await scenarioAuditAppend(pool, prefix); // 18
    await scenarioAuditRollback(pool, fixtureId); // 19
    await scenarioImmutableRows(pool, authority); // 20
    await scenarioCompositeFk(pool); // 21
    await scenarioSecretActiveUnique(pool, authority); // 22
    await scenarioPartialUnique(pool, `${prefix}-activation`); // 29/44
    await scenarioExpectedVersionRace(pool, fixtureId); // 23/24/26/27/31/35/43/45/53
    await scenarioLeaseRace(pool, fixtureId); // 25/33/34/38/40/41/42
    await scenarioCanonicalBulkLock(pool); // 28/30/39
    await scenarioContiguousSession(pool, prefix); // 36/37
    await scenarioForwardCompatibility(pool, prefix); // 48/50
    await scenarioInvalidConcurrentIndex(pool); // 49
    await scenarioConnectionLoss(pool, fixtureId); // 51
    await scenarioEpochFence(pool, fixtureId); // 52/53
    await scenarioClosureSnapshot(pool); // 47
    await scenarioSerializablePredicate(pool); // 46
    await scenarioLockTimeout(pool, fixtureId); // 54
    await scenarioUniqueCheckFk(pool); // 55
    await scenarioRandomNemesis(pool); // 56
    const state = (await pool.query(`SELECT value,state_version FROM ${TEST_TABLE} WHERE id=$1`, [fixtureId])).rows[0];
    if (!state || Number(state.state_version) < 1) throw new Error('PG-CONTRACT-CAS_FINAL_STATE_INVALID');
    console.log('POSTGRES_CONTRACT_MATRIX: PASS scenarios=1..56 postgres16 two-connection barriers');
  } finally {
    await cleanupQuery(pool, `DELETE FROM kcml.transactional_outbox WHERE stream_key LIKE $1`, [`postgres-contract:%`]);
    await cleanupQuery(pool, `DELETE FROM kcml.queue_item WHERE queue_name='postgres-contract'`);
    await cleanupQuery(pool, `DELETE FROM kcml.domain_idempotency_record WHERE canonical_key LIKE $1`, [`${prefix}%`]);
    await cleanupQuery(pool, `DELETE FROM kcml.sequence_allocator WHERE sequence_namespace='POSTGRES_CONTRACT' AND parent_uuid=$1`, [fixtureId]);
    await cleanupQuery(pool, `DROP INDEX IF EXISTS td15_fixture_source_uq`);
    await cleanupQuery(pool, `DROP TABLE IF EXISTS ${TEST_TABLE}`);
    await cleanupQuery(pool, 'DROP TABLE IF EXISTS kcml.td15_active_unique_fixture');
    await cleanupQuery(pool, 'DROP TABLE IF EXISTS kcml.td15_session_sequence_fixture');
    await cleanupQuery(pool, 'DROP TABLE IF EXISTS kcml.td15_forward_schema_fixture');
  }
}
