import { createDatabasePool, loadBaseline, verifyDatabaseContract } from '@kcml/database';

if (!process.env.DATABASE_URL) {
  console.log('NOT_EXECUTED_ENVIRONMENTAL: PostgreSQL integration requires DATABASE_URL');
  process.exit(0);
}

const pool = createDatabasePool({ applicationName: 'postgres-integration' });
try {
  await pool.query(await loadBaseline());
  await verifyDatabaseContract(pool);
  await pool.query('TRUNCATE kcml.domain_idempotency_record, kcml.queue_item, kcml.process_lease CASCADE');
  const key = `ci-${Date.now()}`;
  const inserts = await Promise.allSettled(Array.from({ length: 16 }, () => pool.query(`INSERT INTO kcml.domain_idempotency_record(scope_digest,idempotency_key,request_digest,logical_operation_id,command_id,expires_at) VALUES(digest('scope','sha256'),$1,digest($1,'sha256'),gen_random_uuid(),gen_random_uuid(),clock_timestamp()+interval '1 hour') RETURNING id`, [key])));
  if (inserts.filter((value) => value.status === 'fulfilled').length !== 1) throw new Error('IDEMPOTENCY_UNIQUENESS_FAILED');
  await pool.query(`INSERT INTO kcml.queue_item(queue_name,partition_key,payload,available_at,platform_incarnation_id,application_deployment_epoch) SELECT 'test',$1,jsonb_build_object('n',value),clock_timestamp(),p.platform_incarnation_id,d.current_epoch FROM generate_series(1,40) value CROSS JOIN kcml.platform_incarnation p CROSS JOIN kcml.application_deployment_head d WHERE p.singleton_key=1 AND d.singleton_key=1`, [key]);
  const clients = await Promise.all([pool.connect(), pool.connect(), pool.connect(), pool.connect()]);
  const claimed = await Promise.all(clients.map(async (client) => { await client.query('BEGIN'); const result = await client.query(`SELECT id FROM kcml.queue_item WHERE queue_name='test' AND status='READY' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 10`); await client.query(`UPDATE kcml.queue_item SET status='CLAIMED',lease_owner=gen_random_uuid(),lease_fencing_token=lease_fencing_token+1,lease_expires_at=clock_timestamp()+interval '1 minute' WHERE id=ANY($1::uuid[])`, [result.rows.map((row) => row.id)]); await client.query('COMMIT'); client.release(); return result.rows.map((row) => row.id); }));
  const ids = claimed.flat(); if (ids.length !== 40 || new Set(ids).size !== 40) throw new Error('SKIP_LOCKED_EXCLUSIVITY_FAILED');
  console.log('POSTGRES_INTEGRATION: PASS');
} finally { await pool.end(); }
