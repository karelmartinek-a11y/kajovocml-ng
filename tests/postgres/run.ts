import { createDatabasePool, loadBaseline, loadForwardMigrations, verifyDatabaseContract } from '@kcml/database';
import { readFile } from 'node:fs/promises';
import { runPostgresContractMatrix } from './contract-matrix.js';

if (!process.env.DATABASE_URL) {
  console.log('NOT_EXECUTED_ENVIRONMENTAL: PostgreSQL integration requires DATABASE_URL');
  process.exit(0);
}

const pool = createDatabasePool({ applicationName: 'postgres-integration' });
try {
  await pool.query(await loadBaseline());
  const forwardMigrations=await loadForwardMigrations();
  for (const migration of forwardMigrations) {
    if (migration.phasePlan.join(',')!=='EXPAND,VALIDATE,ACTIVATE'||migration.transactionMode!=='TRANSACTIONAL'||Buffer.from(migration.checksum).length!==32) throw new Error(`FORWARD_MIGRATION_METADATA_INVALID:${migration.filename}`);
    await pool.query(migration.sql);
  }
  await verifyDatabaseContract(pool);
  const heartbeatLineageColumns=(await pool.query(`SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema='kcml' AND table_name='platform_worker_heartbeat' AND column_name IN ('platform_incarnation_id','heartbeat_sequence','nonce') AND is_nullable='NO'`)).rows[0];
  if(Number(heartbeatLineageColumns?.count)!==3)throw new Error('PLATFORM_WORKER_HEARTBEAT_LINEAGE_COLUMNS_INVALID');
  const recoveryHead=(await pool.query(`SELECT state,recovery_epoch,database_start_identity,kcml.current_database_start_identity() AS current_database_start_identity,ready_evidence_digest FROM kcml.platform_recovery_head WHERE singleton_key=1`)).rows[0];
  if(recoveryHead?.state!=='READY'||BigInt(recoveryHead.recovery_epoch)!==1n||!Buffer.from(recoveryHead.database_start_identity).equals(Buffer.from(recoveryHead.current_database_start_identity))||Buffer.from(recoveryHead.ready_evidence_digest).length!==32)throw new Error('PLATFORM_RECOVERY_BOOTSTRAP_AUTHORITY_INVALID');
  const commandGuardStorage=(await pool.query(`SELECT
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='kcml' AND table_name='concurrency_claim' AND column_name='recovery_epoch' AND is_nullable='NO') AS claim_recovery_epoch,
    to_regclass('kcml.domain_command_execution_checkpoint') IS NOT NULL AS checkpoint_table,
    EXISTS(SELECT 1 FROM pg_trigger trigger JOIN pg_class relation ON relation.oid=trigger.tgrelid JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='kcml' AND relation.relname='domain_command_execution_checkpoint' AND trigger.tgname='immutable_row' AND NOT trigger.tgisinternal) AS checkpoint_immutable,
    to_regclass('kcml.platform_recovery_attempt') IS NOT NULL AS recovery_attempt_table,
    to_regclass('kcml.platform_recovery_item') IS NOT NULL AS recovery_item_table,
    EXISTS(SELECT 1 FROM pg_constraint constraint_record JOIN pg_class relation ON relation.oid=constraint_record.conrelid JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='kcml' AND relation.relname='platform_recovery_item' AND constraint_record.contype='u' AND pg_get_constraintdef(constraint_record.oid) LIKE 'UNIQUE (recovery_attempt_id, owner_kind, owner_id, classification_revision)%') AS recovery_item_unique`)).rows[0];
  if(!commandGuardStorage?.claim_recovery_epoch||!commandGuardStorage.checkpoint_table||!commandGuardStorage.checkpoint_immutable||!commandGuardStorage.recovery_attempt_table||!commandGuardStorage.recovery_item_table||!commandGuardStorage.recovery_item_unique)throw new Error('COMMAND_RECOVERY_GUARD_STORAGE_INVALID');
  const infrastructureKey=`postgres-infra-${Date.now()}`;const authority=(await pool.query(`SELECT platform.platform_incarnation_id,deployment.current_epoch,recovery.recovery_epoch FROM kcml.platform_incarnation platform CROSS JOIN kcml.application_deployment_head deployment CROSS JOIN kcml.platform_recovery_head recovery WHERE platform.singleton_key=1 AND deployment.singleton_key=1 AND recovery.singleton_key=1`)).rows[0];
  const firstCapacity=(await pool.query(`INSERT INTO kcml.capacity_reservation(capacity_kind,reservation_key,reservation_class,owner_kind,owner_id,reserved_units,fencing_token,recovery_epoch,expires_at,platform_incarnation_id,application_deployment_epoch)
    VALUES('TEST',$1,'REGULAR','POSTGRES_TEST',$1,1,1,$2,clock_timestamp()+interval '1 minute',$3,$4) RETURNING id`,[infrastructureKey,authority.recovery_epoch,authority.platform_incarnation_id,authority.current_epoch])).rows[0];
  let duplicateCapacityRejected=false;try{await pool.query(`INSERT INTO kcml.capacity_reservation(capacity_kind,reservation_key,reservation_class,owner_kind,owner_id,reserved_units,fencing_token,recovery_epoch,expires_at,platform_incarnation_id,application_deployment_epoch)
    VALUES('TEST',$1,'REGULAR','POSTGRES_TEST',$1,1,2,$2,clock_timestamp()+interval '1 minute',$3,$4)`,[infrastructureKey,authority.recovery_epoch,authority.platform_incarnation_id,authority.current_epoch]);}catch(error){duplicateCapacityRejected=typeof error==='object'&&error!==null&&'code' in error&&error.code==='23505';}
  await pool.query(`UPDATE kcml.capacity_reservation SET released_at=clock_timestamp(),release_evidence_digest=digest('postgres-test-release','sha256'),state_version=state_version+1 WHERE id=$1`,[firstCapacity.id]);if(!duplicateCapacityRejected)throw new Error('CAPACITY_ACTIVE_UNIQUENESS_NOT_ENFORCED');
  let directPublishedArtifactRejected=false;try{await pool.query(`INSERT INTO kcml.artifact_publication(artifact_owner_kind,artifact_owner_id,logical_name,publication_revision,artifact_state,temp_path_identity,expected_size,expected_digest,mime_type,recovery_epoch,fencing_token,platform_incarnation_id,application_deployment_epoch)
    VALUES('POSTGRES_TEST',$1,'invalid',1,'PUBLISHED',$1,0,digest('','sha256'),'application/octet-stream',$2,1,$3,$4)`,[infrastructureKey,authority.recovery_epoch,authority.platform_incarnation_id,authority.current_epoch]);}catch(error){directPublishedArtifactRejected=typeof error==='object'&&error!==null&&'code' in error&&error.code==='23514';}
  const publication=(await pool.query(`INSERT INTO kcml.artifact_publication(artifact_owner_kind,artifact_owner_id,logical_name,publication_revision,artifact_state,temp_path_identity,expected_size,expected_digest,mime_type,recovery_epoch,fencing_token,platform_incarnation_id,application_deployment_epoch)
    VALUES('POSTGRES_TEST',$1,'empty.bin',1,'INTENT_RECORDED',$1,0,digest('','sha256'),'application/octet-stream',$2,1,$3,$4) RETURNING id`,[infrastructureKey,authority.recovery_epoch,authority.platform_incarnation_id,authority.current_epoch])).rows[0];
  let duplicatePublicationRejected=false;try{await pool.query(`INSERT INTO kcml.artifact_publication(artifact_owner_kind,artifact_owner_id,logical_name,publication_revision,artifact_state,temp_path_identity,expected_size,expected_digest,mime_type,recovery_epoch,fencing_token,platform_incarnation_id,application_deployment_epoch)
    VALUES('POSTGRES_TEST',$1,'empty.bin',1,'INTENT_RECORDED',$1,0,digest('','sha256'),'application/octet-stream',$2,2,$3,$4)`,[infrastructureKey,authority.recovery_epoch,authority.platform_incarnation_id,authority.current_epoch]);}catch(error){duplicatePublicationRejected=typeof error==='object'&&error!==null&&'code' in error&&error.code==='23505';}
  await pool.query(`UPDATE kcml.artifact_publication SET artifact_state='WRITING',state_version=state_version+1 WHERE id=$1`,[publication.id]);
  await pool.query(`UPDATE kcml.artifact_publication SET artifact_state='FILE_FSYNCED',file_fsynced_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1`,[publication.id]);
  await pool.query(`UPDATE kcml.artifact_publication SET artifact_state='VALIDATED',validation_evidence='{"size":0,"digest":"verified"}'::jsonb,final_content_address='sha256:empty',final_size=0,final_digest=digest('','sha256'),state_version=state_version+1 WHERE id=$1`,[publication.id]);
  await pool.query(`UPDATE kcml.artifact_publication SET artifact_state='PARENT_FSYNCED',parent_directory_fsynced_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1`,[publication.id]);
  await pool.query(`UPDATE kcml.artifact_publication SET artifact_state='RENAMED',renamed_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1`,[publication.id]);
  const publicationClient=await pool.connect();try{await publicationClient.query('BEGIN');const published=(await publicationClient.query(`UPDATE kcml.artifact_publication SET artifact_state='PUBLISHED',pointer_committed_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1 RETURNING final_digest`,[publication.id])).rows[0];await publicationClient.query(`INSERT INTO kcml.artifact_current_pointer(artifact_owner_kind,artifact_owner_id,logical_name,publication_id,final_digest,pointer_revision) VALUES('POSTGRES_TEST',$1,'empty.bin',$2,$3,1)`,[infrastructureKey,publication.id,published.final_digest]);await publicationClient.query('COMMIT');}catch(error){await publicationClient.query('ROLLBACK').catch(()=>undefined);throw error;}finally{publicationClient.release();}
  let currentPointerCleanupRejected=false;try{await pool.query(`UPDATE kcml.artifact_publication SET artifact_state='CLEANUP_PENDING',state_version=state_version+1 WHERE id=$1`,[publication.id]);}catch(error){currentPointerCleanupRejected=typeof error==='object'&&error!==null&&'code' in error&&['23503','23514'].includes(String(error.code));}
  if(!directPublishedArtifactRejected||!duplicatePublicationRejected||!currentPointerCleanupRejected)throw new Error('ARTIFACT_PUBLICATION_PHYSICAL_PROTOCOL_INVALID');
  const schemaContracts = JSON.parse(await readFile('contracts/ssot-surface/postgres-schema-contracts.json', 'utf8')) as {
    records: Array<{
      tableName: string;
      ssotContractDigest: string;
      columns: Array<{ name: string; dataType: string; notNull: boolean; hasDefault: boolean; references: [string, string] | null }>;
      indexes: Array<{ name: string; unique: boolean }>;
      constraints: Array<{ name: string; kind: string }>;
    }>;
  };
  if (schemaContracts.records.length !== 220) throw new Error(`SSOT_SCHEMA_CONTRACT_CARDINALITY:${schemaContracts.records.length}`);
  const catalogColumns = await pool.query<{ table_name: string; column_name: string; data_type: string; not_null: boolean; has_default: boolean }>(`SELECT
    c.relname AS table_name,a.attname AS column_name,pg_catalog.format_type(a.atttypid,a.atttypmod) AS data_type,
    a.attnotnull AS not_null,(ad.oid IS NOT NULL) AS has_default
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef ad ON ad.adrelid=c.oid AND ad.adnum=a.attnum
    WHERE n.nspname='kcml' AND c.relkind IN ('r','p')`);
  const columnByTable = new Map<string, Map<string, (typeof catalogColumns.rows)[number]>>();
  for (const column of catalogColumns.rows) {
    const table = columnByTable.get(column.table_name) ?? new Map();
    table.set(column.column_name, column);
    columnByTable.set(column.table_name, table);
  }
  const catalogIndexes = await pool.query<{ table_name: string; index_name: string; unique: boolean }>(`SELECT
    table_class.relname AS table_name,index_class.relname AS index_name,index.indisunique AS unique
    FROM pg_index index JOIN pg_class table_class ON table_class.oid=index.indrelid
    JOIN pg_namespace namespace ON namespace.oid=table_class.relnamespace
    JOIN pg_class index_class ON index_class.oid=index.indexrelid WHERE namespace.nspname='kcml'`);
  const indexByTable = new Map<string, Map<string, boolean>>();
  for (const index of catalogIndexes.rows) {
    const table = indexByTable.get(index.table_name) ?? new Map();
    table.set(index.index_name, index.unique);
    indexByTable.set(index.table_name, table);
  }
  const catalogConstraints = await pool.query<{ table_name: string; constraint_name: string; kind: string }>(`SELECT
    relation.relname AS table_name,constraint_record.conname AS constraint_name,
    CASE constraint_record.contype WHEN 'f' THEN 'FOREIGN_KEY' WHEN 'c' THEN 'CHECK' WHEN 'u' THEN 'UNIQUE' ELSE 'OTHER' END AS kind
    FROM pg_constraint constraint_record JOIN pg_class relation ON relation.oid=constraint_record.conrelid
    JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='kcml'`);
  const constraintByTable = new Map<string, Map<string, string>>();
  for (const constraint of catalogConstraints.rows) {
    const table = constraintByTable.get(constraint.table_name) ?? new Map();
    table.set(constraint.constraint_name, constraint.kind);
    constraintByTable.set(constraint.table_name, table);
  }
  const catalogReferences = await pool.query<{ table_name: string; column_name: string; target_table: string; target_column: string }>(`SELECT
    source_relation.relname AS table_name,source_attribute.attname AS column_name,
    target_relation.relname AS target_table,target_attribute.attname AS target_column
    FROM pg_constraint constraint_record
    JOIN pg_class source_relation ON source_relation.oid=constraint_record.conrelid
    JOIN pg_namespace namespace ON namespace.oid=source_relation.relnamespace
    JOIN pg_class target_relation ON target_relation.oid=constraint_record.confrelid
    JOIN unnest(constraint_record.conkey) WITH ORDINALITY source_key(attnum,ordinality) ON true
    JOIN unnest(constraint_record.confkey) WITH ORDINALITY target_key(attnum,ordinality) ON target_key.ordinality=source_key.ordinality
    JOIN pg_attribute source_attribute ON source_attribute.attrelid=source_relation.oid AND source_attribute.attnum=source_key.attnum
    JOIN pg_attribute target_attribute ON target_attribute.attrelid=target_relation.oid AND target_attribute.attnum=target_key.attnum
    WHERE namespace.nspname='kcml' AND constraint_record.contype='f'`);
  const references = new Set(catalogReferences.rows.map((reference) => `${reference.table_name}.${reference.column_name}->${reference.target_table}.${reference.target_column}`));
  const comments = await pool.query<{ table_name: string; comment: string | null }>(`SELECT relation.relname AS table_name,obj_description(relation.oid,'pg_class') AS comment
    FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname='kcml' AND relation.relkind IN ('r','p')`);
  const commentByTable = new Map(comments.rows.map((row) => [row.table_name, row.comment]));
  const failures: string[] = [];
  for (const contract of schemaContracts.records) {
    const actualColumns = columnByTable.get(contract.tableName);
    if (!actualColumns) { failures.push(`${contract.tableName}:TABLE_MISSING`); continue; }
    const expectedNames = new Set(contract.columns.map((column) => column.name));
    for (const actualName of actualColumns.keys()) if (!expectedNames.has(actualName)) failures.push(`${contract.tableName}.${actualName}:UNDECLARED_COLUMN`);
    for (const expected of contract.columns) {
      const actual = actualColumns.get(expected.name);
      if (!actual) { failures.push(`${contract.tableName}.${expected.name}:COLUMN_MISSING`); continue; }
      if (actual.data_type !== expected.dataType) failures.push(`${contract.tableName}.${expected.name}:TYPE:${actual.data_type}!=${expected.dataType}`);
      if (actual.not_null !== expected.notNull) failures.push(`${contract.tableName}.${expected.name}:NOT_NULL:${actual.not_null}!=${expected.notNull}`);
      if (actual.has_default !== expected.hasDefault) failures.push(`${contract.tableName}.${expected.name}:DEFAULT_PRESENCE:${actual.has_default}!=${expected.hasDefault}`);
      if (expected.references && !references.has(`${contract.tableName}.${expected.name}->${expected.references[0]}.${expected.references[1]}`)) failures.push(`${contract.tableName}.${expected.name}:FK_MISSING:${expected.references.join('.')}`);
    }
    for (const expected of contract.indexes) {
      const actualUnique = indexByTable.get(contract.tableName)?.get(expected.name);
      if (actualUnique === undefined) failures.push(`${contract.tableName}.${expected.name}:INDEX_MISSING`);
      else if (actualUnique !== expected.unique) failures.push(`${contract.tableName}.${expected.name}:INDEX_UNIQUENESS_MISMATCH`);
    }
    for (const expected of contract.constraints) {
      const actualKind = constraintByTable.get(contract.tableName)?.get(expected.name);
      if (!actualKind) failures.push(`${contract.tableName}.${expected.name}:CONSTRAINT_MISSING`);
      else if (actualKind !== expected.kind) failures.push(`${contract.tableName}.${expected.name}:CONSTRAINT_KIND:${actualKind}!=${expected.kind}`);
    }
    const expectedComment = `SSOT_CURRENT.md chapter 25 entity ${contract.tableName}; contract sha256 ${contract.ssotContractDigest.slice('sha256:'.length)}`;
    if (commentByTable.get(contract.tableName) !== expectedComment) failures.push(`${contract.tableName}:SSOT_CONTRACT_COMMENT_MISMATCH`);
  }
  if (failures.length) throw new Error(`SSOT_POSTGRES_SCHEMA_CONTRACT_FAILED (${failures.length})\n${failures.slice(0,100).join('\n')}`);
  await pool.query('TRUNCATE kcml.domain_idempotency_record, kcml.queue_item CASCADE');
  const key = `ci-${Date.now()}`;
  const inserts = await Promise.allSettled(Array.from({ length: 16 }, () => pool.query(`INSERT INTO kcml.domain_idempotency_record(scope_digest,key_digest,canonical_key,request_digest,logical_operation_id,command_id,expires_at)
    VALUES(digest('scope','sha256'),digest($1,'sha256'),$1,digest($1,'sha256'),gen_random_uuid(),gen_random_uuid(),clock_timestamp()+interval '1 hour') RETURNING id`, [key])));
  if (inserts.filter((value) => value.status === 'fulfilled').length !== 1) throw new Error('IDEMPOTENCY_UNIQUENESS_FAILED');
  await pool.query(`INSERT INTO kcml.queue_item(queue_name,partition_key,payload,available_at,platform_incarnation_id,application_deployment_epoch) SELECT 'test',$1,jsonb_build_object('n',value),clock_timestamp(),p.platform_incarnation_id,d.current_epoch FROM generate_series(1,40) value CROSS JOIN kcml.platform_incarnation p CROSS JOIN kcml.application_deployment_head d WHERE p.singleton_key=1 AND d.singleton_key=1`, [key]);
  const clients = await Promise.all([pool.connect(), pool.connect(), pool.connect(), pool.connect()]);
  const claimed = await Promise.all(clients.map(async (client) => { await client.query('BEGIN'); const result = await client.query(`SELECT id FROM kcml.queue_item WHERE queue_name='test' AND status='READY' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 10`); await client.query(`UPDATE kcml.queue_item SET status='CLAIMED',lease_owner=gen_random_uuid(),lease_fencing_token=lease_fencing_token+1,lease_expires_at=clock_timestamp()+interval '1 minute' WHERE id=ANY($1::uuid[])`, [result.rows.map((row) => row.id)]); await client.query('COMMIT'); client.release(); return result.rows.map((row) => row.id); }));
  const ids = claimed.flat(); if (ids.length !== 40 || new Set(ids).size !== 40) throw new Error('SKIP_LOCKED_EXCLUSIVITY_FAILED');
  await pool.query(`DELETE FROM kcml.queue_item WHERE queue_name='test' AND partition_key=$1`,[key]);
  await pool.query(`DELETE FROM kcml.domain_idempotency_record WHERE canonical_key=$1`,[key]);
  await runPostgresContractMatrix(pool);
  const verifiedColumnCount = schemaContracts.records.reduce((total, contract) => total + contract.columns.length, 0);
  const verifiedIndexCount = schemaContracts.records.reduce((total, contract) => total + contract.indexes.length, 0);
  const verifiedConstraintCount = schemaContracts.records.reduce((total, contract) => total + contract.constraints.length, 0);
  console.log(`POSTGRES_INTEGRATION: PASS entities=${schemaContracts.records.length} columns=${verifiedColumnCount} indexes=${verifiedIndexCount} constraints=${verifiedConstraintCount} recoveryEpoch=${recoveryHead.recovery_epoch}`);
} finally { await pool.end(); }
