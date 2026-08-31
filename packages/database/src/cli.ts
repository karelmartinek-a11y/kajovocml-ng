#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { advisoryKey, createDatabasePool, databaseSchemaFingerprint, loadBaseline, loadForwardMigrations, verifyDatabaseContract, type DatabaseClient } from './index.js';

const command = process.argv[2];
const pool = createDatabasePool({ applicationName: 'kcml-database-cli', max: 2 });
const releaseId = process.env.KCML_RELEASE_ID ?? 'development';
const buildId = process.env.KCML_BUILD_ID ?? process.env.KCML_SOURCE_SHA ?? 'development';

async function heads(client: DatabaseClient) {
  const result = await client.query(`SELECT p.platform_incarnation_id,d.current_epoch AS deployment_epoch
    FROM kcml.platform_incarnation p CROSS JOIN kcml.application_deployment_head d
    WHERE p.singleton_key=1 AND d.singleton_key=1`);
  if (!result.rows[0]) throw new Error('MIGRATION_PLATFORM_HEADS_MISSING');
  return result.rows[0] as { platform_incarnation_id: string; deployment_epoch: string };
}

async function recordGreenfieldBaseline(checksum: Buffer): Promise<void> {
  const client = await pool.connect();
  try {
    const existing = await client.query(`SELECT checksum,state FROM kcml.schema_migration WHERE version='00000000000000'`);
    if (existing.rows[0]) {
      if (!Buffer.from(existing.rows[0].checksum).equals(checksum)) throw new Error('BASELINE_CHECKSUM_MISMATCH');
      if (existing.rows[0].state !== 'APPLIED') throw new Error(`BASELINE_LEDGER_NOT_APPLIED:${existing.rows[0].state}`);
      return;
    }
    await client.query('BEGIN');
    const [left, right] = advisoryKey('SCHEMA_MIGRATION', '00000000000000');
    await client.query('SELECT pg_advisory_xact_lock($1,$2)', [left, right]);
    const current = await heads(client);
    const schemaFingerprint = await databaseSchemaFingerprint(client);
    await client.query(`INSERT INTO kcml.schema_migration(
      version,checksum,previous_checksum,release_id,build_id,phase_plan,current_phase,state,transaction_mode,
      platform_incarnation_id,application_deployment_epoch,schema_fingerprint,evidence,started_at,completed_at,terminal_at)
      VALUES('00000000000000',$1,NULL,$2,$3,$4,'ACTIVATE','APPLIED','TRANSACTIONAL',$5,$6,$7,$8,clock_timestamp(),clock_timestamp(),clock_timestamp())`,
      [checksum, releaseId, buildId, JSON.stringify(['EXPAND','VALIDATE','ACTIVATE']), current.platform_incarnation_id, current.deployment_epoch, schemaFingerprint,
        { kind: 'GREENFIELD_BASELINE', source: 'database/baseline', files: 'ordered *.sql' }]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function applyForwardMigration(migration: Awaited<ReturnType<typeof loadForwardMigrations>>[number], previousChecksum: Buffer): Promise<Buffer> {
  const existing = await pool.query(`SELECT checksum,state FROM kcml.schema_migration WHERE version=$1`, [migration.version]);
  if (existing.rows[0]) {
    if (!Buffer.from(existing.rows[0].checksum).equals(migration.checksum)) throw new Error(`MIGRATION_CHECKSUM_MISMATCH:${migration.version}`);
    if (existing.rows[0].state === 'APPLIED') return migration.checksum;
    throw new Error(`MIGRATION_REQUIRES_MANUAL_REVIEW:${migration.version}:${existing.rows[0].state}`);
  }

  const leaseOwner = randomUUID();
  const claim = await pool.connect();
  try {
    await claim.query('BEGIN');
    const [left, right] = advisoryKey('SCHEMA_MIGRATION', migration.version);
    await claim.query('SELECT pg_advisory_xact_lock($1,$2)', [left, right]);
    const current = await heads(claim);
    await claim.query(`SELECT 1 FROM kcml.platform_incarnation WHERE singleton_key=1 FOR SHARE`);
    await claim.query(`SELECT 1 FROM kcml.application_deployment_head WHERE singleton_key=1 FOR SHARE`);
    const active = await claim.query(`SELECT version FROM kcml.schema_migration WHERE terminal_at IS NULL FOR UPDATE`);
    if (active.rows.length) throw new Error(`ANOTHER_SCHEMA_MIGRATION_ACTIVE:${active.rows[0].version}`);
    await claim.query(`INSERT INTO kcml.schema_migration(
      version,checksum,previous_checksum,release_id,build_id,phase_plan,current_phase,state,transaction_mode,lease_owner,
      lease_fencing_token,lease_acquired_at,lease_expires_at,platform_incarnation_id,application_deployment_epoch,started_at,evidence)
      VALUES($1,$2,$3,$4,$5,$6,$7,'RUNNING',$8,$9,1,clock_timestamp(),clock_timestamp()+interval '15 minutes',$10,$11,clock_timestamp(),$12)`,
      [migration.version,migration.checksum,previousChecksum,releaseId,buildId,JSON.stringify(migration.phasePlan),migration.phasePlan[0],migration.transactionMode,leaseOwner,current.platform_incarnation_id,current.deployment_epoch,{ filename: migration.filename }]);
    await claim.query('COMMIT');
  } catch (error) {
    await claim.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    claim.release();
  }

  try {
    // Each migration owns its declared transactional/non-transactional DDL boundaries.
    await pool.query(migration.sql);
    const finalizer = await pool.connect();
    try {
      await finalizer.query('BEGIN');
      const [left, right] = advisoryKey('SCHEMA_MIGRATION', migration.version);
      await finalizer.query('SELECT pg_advisory_xact_lock($1,$2)', [left, right]);
      const current = await heads(finalizer);
      const schemaFingerprint = await databaseSchemaFingerprint(finalizer);
      const result = await finalizer.query(`UPDATE kcml.schema_migration SET state='APPLIED',current_phase=$2,completed_at=clock_timestamp(),terminal_at=clock_timestamp(),
        schema_fingerprint=$3,checkpoint=$4,evidence=evidence || $5::jsonb,state_version=state_version+1
        WHERE version=$1 AND state='RUNNING' AND lease_owner=$6 AND platform_incarnation_id=$7 AND application_deployment_epoch=$8`,
        [migration.version,migration.phasePlan.at(-1),schemaFingerprint,{ phase: migration.phasePlan.at(-1), complete: true },JSON.stringify({ outcome: 'APPLIED' }),leaseOwner,current.platform_incarnation_id,current.deployment_epoch]);
      if (result.rowCount !== 1) throw new Error(`MIGRATION_FINALIZE_FENCE_REJECTED:${migration.version}`);
      await finalizer.query('COMMIT');
    } catch (error) {
      await finalizer.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      finalizer.release();
    }
    return migration.checksum;
  } catch (error) {
    await pool.query(`UPDATE kcml.schema_migration SET state='FAILED',terminal_at=clock_timestamp(),completed_at=clock_timestamp(),error=$2,evidence=evidence || $3::jsonb,state_version=state_version+1
      WHERE version=$1 AND state='RUNNING' AND lease_owner=$4`, [migration.version,{ message: error instanceof Error ? error.message : String(error) },JSON.stringify({ outcome: 'FAILED' }),leaseOwner]).catch(() => undefined);
    throw error;
  }
}

try {
  if (command === 'migrate') {
    const baseline = await loadBaseline();
    const baselineChecksum = createHash('sha256').update(baseline).digest();
    await pool.query(baseline);
    await recordGreenfieldBaseline(baselineChecksum);
    let previousChecksum: Buffer = Buffer.from(baselineChecksum);
    for (const migration of await loadForwardMigrations()) previousChecksum = await applyForwardMigration(migration, previousChecksum);
    process.stdout.write(`Applied/verified greenfield baseline and forward migration chain sha256:${previousChecksum.toString('hex')}\n`);
  } else if (command === 'verify') {
    const result = await verifyDatabaseContract(pool);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stderr.write('Usage: cli.ts migrate|verify\n');
    process.exitCode = 2;
  }
} finally {
  await pool.end();
}
