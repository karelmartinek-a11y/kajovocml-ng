import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

const { Pool } = pg;

export type DatabasePool = pg.Pool;
export type DatabaseClient = pg.PoolClient;

export interface DatabaseOptions {
  connectionString?: string;
  applicationName?: string;
  max?: number;
}

export function createDatabasePool(options: DatabaseOptions = {}): DatabasePool {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL;
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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET TRANSACTION ISOLATION LEVEL ${isolation}`);
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
  let left = 0x811c9dc5;
  let right = 0x01000193;
  for (const char of `${namespace}\u0000${identity}`) {
    left = Math.imul(left ^ char.charCodeAt(0), 0x01000193);
    right = Math.imul(right ^ char.charCodeAt(0), 0x5bd1e995);
  }
  return [left | 0, right | 0];
}

export async function lockAdvisory(client: DatabaseClient, namespace: string, identity: string): Promise<void> {
  const [left, right] = advisoryKey(namespace, identity);
  await client.query('SELECT pg_advisory_xact_lock($1, $2)', [left, right]);
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
  const result = await client.query<{ fingerprint: Buffer }>(`WITH schema_rows AS (
    SELECT n.nspname, c.relname, c.relkind, a.attnum, a.attname, pg_catalog.format_type(a.atttypid,a.atttypmod) AS data_type,
           a.attnotnull, coalesce(pg_get_expr(ad.adbin,ad.adrelid),'') AS default_expr
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef ad ON ad.adrelid=c.oid AND ad.adnum=a.attnum
    WHERE n.nspname='kcml' AND c.relkind IN ('r','p','v','m','S')
    ORDER BY c.relname,a.attnum
  ) SELECT digest(convert_to(coalesce(jsonb_agg(to_jsonb(schema_rows))::text,'[]'),'UTF8'),'sha256') AS fingerprint FROM schema_rows`);
  const fingerprint = result.rows[0]?.fingerprint;
  if (!fingerprint) throw new Error('DATABASE_SCHEMA_FINGERPRINT_UNAVAILABLE');
  return fingerprint;
}

export async function verifyDatabaseContract(pool: DatabasePool): Promise<{ ok: true; checks: Record<string, boolean> }> {
  const result = await pool.query<{
    owner_count: string;
    credential_count: string;
    incarnation_count: string;
    deployment_count: string;
    audit_count: string;
    extensions_ok: boolean;
    entity_count: string;
  }>(`SELECT
      (SELECT count(*)::text FROM kcml.owner_identity) owner_count,
      (SELECT count(*)::text FROM kcml.owner_api_credential) credential_count,
      (SELECT count(*)::text FROM kcml.platform_incarnation) incarnation_count,
      (SELECT count(*)::text FROM kcml.application_deployment_head) deployment_count,
      (SELECT count(*)::text FROM kcml.audit_head) audit_count,
      EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto')
        AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citext') extensions_ok,
      (SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='kcml' AND c.relkind IN ('r','p')) entity_count`);
  const row = result.rows[0];
  const checks = {
    ownerSingleton: row?.owner_count === '1',
    apiCredentialSingleton: row?.credential_count === '1',
    platformSingleton: row?.incarnation_count === '1',
    deploymentSingleton: row?.deployment_count === '1',
    auditSingleton: row?.audit_count === '1',
    requiredExtensions: row?.extensions_ok === true,
    chapter25PhysicalEntityFloor: Number(row?.entity_count ?? 0) >= 220
  };
  if (Object.values(checks).some((value) => !value)) throw new Error(`Database contract failed: ${JSON.stringify(checks)}`);
  return { ok: true, checks };
}

export { pg };
