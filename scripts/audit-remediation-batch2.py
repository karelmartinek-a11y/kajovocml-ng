#!/usr/bin/env python3
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def replace_once(path:str, old:str, new:str)->None:
    p=ROOT/path
    text=p.read_text(encoding='utf-8')
    count=text.count(old)
    if count!=1:
        raise SystemExit(f'{path}: expected one marker, found {count}: {old[:180]!r}')
    p.write_text(text.replace(old,new,1),encoding='utf-8')

# SQL-001 agent_tool_call: application_deployment_epoch is the 16th target column.
replace_once('packages/domain/src/exact-operation-handlers.ts',
"VALUES($1,$2,$3,$4,$5,$6,$7,'RESERVED',$8,$9,$10,$11,$12,$13,$14) RETURNING *`, [\n    runId, uuidArg(context, 'modelCallId')",
"VALUES($1,$2,$3,$4,$5,$6,$7,'RESERVED',$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`, [\n    runId, uuidArg(context, 'modelCallId')")

# SQL-002 operation_context: the final deployment epoch bind was present but had no placeholder.
replace_once('packages/domain/src/exact-operation-handlers.ts',
"$27,'COMPILED',$28,$29,$29,$30,$31,$32,$33) RETURNING *`, [",
"$27,'COMPILED',$28,$29,$29,$30,$31,$32,$33,$34) RETURNING *`, [")

# SQL-003 generation_validation_run: deployment epoch is the final target column.
replace_once('packages/domain/src/exact-operation-handlers.ts',
"$7,'RUNNING',clock_timestamp(),$8,$9,$10,$11,$12,$13,$14) RETURNING *`, [\n    id, jobId, context.arguments.phaseRunId",
"$7,'RUNNING',clock_timestamp(),$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`, [\n    id, jobId, context.arguments.phaseRunId")

# SQL-004 mcp_discovery_snapshot: latency_ms is mandatory and receives an explicit measured/default value.
replace_once('packages/domain/src/exact-operation-handlers.ts',
"page_lineage_evidence,aggregate_traversal_digest,state,verification_state,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)\n    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,clock_timestamp(),$25,$26,$27,$28,$29,'FRESH',$30,$31,$32,$33,$34,$35) RETURNING *`, [",
"page_lineage_evidence,aggregate_traversal_digest,state,latency_ms,verification_state,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)\n    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,clock_timestamp(),$25,$26,$27,$28,$29,'FRESH',$30,$31,$32,$33,$34,$35,$36) RETURNING *`, [")
replace_once('packages/domain/src/exact-operation-handlers.ts',
"digestArgument(context, 'aggregateTraversalDigest', payload), textArg(context, 'verificationState', 'PENDING'), digest({ id, payload }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()",
"digestArgument(context, 'aggregateTraversalDigest', payload), numberArg(context, 'latencyMs', 0), textArg(context, 'verificationState', 'PENDING'), digest({ id, payload }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()")

# SQL-005 mcp_state_handle: state_reference must occupy $13 and OPEN is the status literal.
replace_once('packages/domain/src/exact-operation-handlers.ts',
"VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'OPEN',$13,$14,$15,$16,$17,$18,$19) RETURNING *`, [",
"VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'OPEN',$14,$15,$16,$17,$18,$19,$20) RETURNING *`, [")

# SQL-006 content_provenance: deployment epoch bind lacked its target placeholder.
replace_once('packages/domain/src/exact-operation-handlers.ts',
"$18,$19,$20,$21,$22,$23,$24) RETURNING *`, [\n    id, context.arguments.parentContentId ?? null, textArg(context, 'sourceKind')",
"$18,$19,$20,$21,$22,$23,$24,$25) RETURNING *`, [\n    id, context.arguments.parentContentId ?? null, textArg(context, 'sourceKind')")

# SQL-007 secret_binding: deployment epoch bind lacked $22.
replace_once('packages/domain/src/exact-operation-handlers.ts',
"VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`, [\n    id, uuidArg(context, 'secretId')",
"VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *`, [\n    id, uuidArg(context, 'secretId')")

# SQL-008 detailed generation.phase.start: bind the allocated attempt at $4.
replace_once('packages/domain/src/canonical-operation-handlers.ts',
"[phaseRunId, jobId, phase, generationWorkerPool(phase as GenerationPhase), context.arguments.workerId ?? context.logicalOperationId, fence.toString(),",
"[phaseRunId, jobId, phase, attempt.toString(), generationWorkerPool(phase as GenerationPhase), context.arguments.workerId ?? context.logicalOperationId, fence.toString(),")

# SQL-009 detailed generation.message.append: canonical_digest is mandatory and distinct from content_digest.
p=ROOT/'packages/domain/src/canonical-operation-handlers.ts'
t=p.read_text(encoding='utf-8')
old="INSERT INTO kcml.generation_message(job_id,sequence,role,content,attachments,status,content_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)"
new="INSERT INTO kcml.generation_message(job_id,sequence,role,content,attachments,status,content_digest,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)"
if t.count(old)!=1: raise SystemExit(f'canonical generation_message column marker count={t.count(old)}')
t=t.replace(old,new,1)
# The detailed path uses content digest immediately before lineage fields; duplicate that digest as canonical row digest.
needle="digest(content), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()"
if t.count(needle)!=1: raise SystemExit(f'canonical generation_message bind marker count={t.count(needle)}')
t=t.replace(needle,"digest(content), digest({ jobId, sequence: sequence.toString(), role: context.arguments.role ?? 'OWNER', content: context.arguments.content, attachments: context.arguments.attachments ?? [] }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()",1)
# Add one placeholder to the generation_message VALUES list only.
marker="VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`"
if t.count(marker)!=1: raise SystemExit(f'canonical generation_message values marker count={t.count(marker)}')
t=t.replace(marker,"VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`",1)
p.write_text(t,encoding='utf-8')

# RUN-010: STARTING is an idempotent in-progress prepare, not a second transition.
replace_once('packages/domain/src/exact-operation-handlers.ts',
"  if (!['STOPPED', 'FAILED', 'UNKNOWN', 'ABSENT', 'STARTING'].includes(String(current.effective_state))) {\n    throw new DomainError('RUNTIME_STATE_BOUNDARY_VIOLATION', `Cannot prepare runtime from ${String(current.effective_state)}`, 409, 'RECONCILE_THEN_RETRY');\n  }\n  const updated = row((await client.query(`UPDATE kcml.runtime_instance SET desired_state='STARTING'",
"  if (String(current.effective_state) === 'STARTING') return { ...result(context, 'runtime_instance', current, current.state_version, { effectiveState: 'STARTING', inProgress: true }), transition: { from: 'STARTING', to: 'STARTING' } };\n  if (!['STOPPED', 'FAILED', 'UNKNOWN', 'ABSENT'].includes(String(current.effective_state))) {\n    throw new DomainError('RUNTIME_STATE_BOUNDARY_VIOLATION', `Cannot prepare runtime from ${String(current.effective_state)}`, 409, 'RECONCILE_THEN_RETRY');\n  }\n  const updated = row((await client.query(`UPDATE kcml.runtime_instance SET desired_state='STARTING'")

# BROWSER facade follow-up: domain_command exposes error, not a nonexistent failure column.
replace_once('packages/browser-interaction/src/index.ts',"SELECT c.status,c.failure,checkpoint.output","SELECT c.status,c.error,checkpoint.output")
replace_once('packages/browser-interaction/src/index.ts',"failure: command.failure ?? null","failure: command.error ?? null")

# DB-002/DB-003: fingerprint integrity objects too, and startup verifies every compiled table/column contract rather than only counts.
p=ROOT/'packages/database/src/index.ts'
t=p.read_text(encoding='utf-8')
start=t.index('export async function databaseSchemaFingerprint')
end=t.index('\nexport { pg };', start)
replacement=r'''export async function databaseSchemaFingerprint(client: DatabaseClient | DatabasePool): Promise<Buffer> {
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
'''
p.write_text(t[:start]+replacement+t[end:],encoding='utf-8')

# DB-004: filter admission/claim-invalid queue items before LIMIT 1 and lock the selected queue row with SKIP LOCKED.
p=ROOT/'packages/domain/src/operations.ts';t=p.read_text(encoding='utf-8')
old="""const candidateResult=await client.query(`SELECT q.id,q.command_id FROM kcml.queue_item q JOIN kcml.domain_command c ON c.id=q.command_id
        WHERE q.queue_name=ANY($1) AND ($5::text[] IS NULL OR c.operation_name=ANY($5)) AND q.available_at<=clock_timestamp()
          AND (q.status='READY' OR (q.status='CLAIMED' AND q.lease_expires_at<=clock_timestamp()))
          AND q.platform_incarnation_id=$2 AND q.application_deployment_epoch=$3 AND q.recovery_epoch=$4
          AND c.platform_incarnation_id=$2 AND c.application_deployment_epoch=$3 AND c.recovery_epoch=$4
        ORDER BY q.priority,q.available_at,q.id LIMIT 1`,[this.options.queueNames,recoveryHead.platform_incarnation_id,recoveryHead.current_epoch,recoveryHead.recovery_epoch,this.options.allowedOperations??null]);const candidate=candidateResult.rows[0];if(!candidate)return null;"""
new="""const candidateResult=await client.query(`SELECT q.id,q.command_id FROM kcml.queue_item q
        JOIN kcml.domain_command c ON c.id=q.command_id
        JOIN kcml.domain_command_activation_domain admission ON admission.domain_command_id=c.id
        JOIN kcml.concurrency_claim claim ON claim.id=c.concurrency_claim_id
        LEFT JOIN kcml.domain_command_execution_checkpoint checkpoint ON checkpoint.command_id=c.id
        WHERE q.queue_name=ANY($1) AND ($5::text[] IS NULL OR c.operation_name=ANY($5)) AND q.available_at<=clock_timestamp()
          AND (q.status='READY' OR (q.status='CLAIMED' AND q.lease_expires_at<=clock_timestamp()))
          AND q.platform_incarnation_id=$2 AND q.application_deployment_epoch=$3 AND q.recovery_epoch=$4
          AND c.platform_incarnation_id=$2 AND c.application_deployment_epoch=$3 AND c.recovery_epoch=$4
          AND claim.released_at IS NULL AND claim.logical_operation_id=c.logical_operation_id
          AND claim.fencing_token=c.concurrency_fencing_token AND q.concurrency_fencing_token=c.concurrency_fencing_token
          AND claim.platform_incarnation_id=$2 AND claim.application_deployment_epoch=$3 AND claim.recovery_epoch=$4
          AND (admission.state='ADMITTED' OR (admission.state='TERMINAL' AND checkpoint.command_id IS NOT NULL))
        ORDER BY q.priority,q.available_at,q.id FOR UPDATE OF q SKIP LOCKED LIMIT 1`,[this.options.queueNames,recoveryHead.platform_incarnation_id,recoveryHead.current_epoch,recoveryHead.recovery_epoch,this.options.allowedOperations??null]);const candidate=candidateResult.rows[0];if(!candidate)return null;"""
if t.count(old)!=1:raise SystemExit(f'operations candidate marker count={t.count(old)}')
t=t.replace(old,new,1)
# DB-005: execution deadline is rechecked under the worker transaction before the first side effect/checkpoint.
old2="""      if(checkpoint){
        if(!await checkpointRecoveryAuthorized(client,row,checkpoint))throw new DomainError('CHECKPOINT_DIGEST_INVALID','Persisted command checkpoint does not match current logical operation lineage or an exact terminal-replay recovery classification',409,'MANUAL_REVIEW');
        return checkpoint.output;
      }
      const output=await apply(client,head);"""
new2="""      if(checkpoint){
        if(!await checkpointRecoveryAuthorized(client,row,checkpoint))throw new DomainError('CHECKPOINT_DIGEST_INVALID','Persisted command checkpoint does not match current logical operation lineage or an exact terminal-replay recovery classification',409,'MANUAL_REVIEW');
        return checkpoint.output;
      }
      const deadline=(await client.query(`SELECT deadline_at FROM kcml.domain_command WHERE id=$1 FOR UPDATE`,[row.command_id])).rows[0]?.deadline_at;
      if(deadline&&new Date(String(deadline)).getTime()<=Date.now())throw new DomainError('KCIP_DEADLINE_EXCEEDED','Command deadline elapsed before execution began',408,'DO_NOT_RETRY');
      const output=await apply(client,head);"""
if t.count(old2)!=1:raise SystemExit(f'operations deadline marker count={t.count(old2)}')
t=t.replace(old2,new2,1)
p.write_text(t,encoding='utf-8')

print('audit remediation batch2 applied')
