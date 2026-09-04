import { randomUUID } from 'node:crypto';
import type { DatabaseClient, DatabasePool } from '@kcml/database';
import { inTransaction } from '@kcml/database';
import { canonicalDigest, type CanonicalJsonValue } from '@kcml/schemas';
import { DomainError } from './errors.js';

type RecoveryState='STARTING'|'RECONCILING'|'READY'|'BLOCKED'|'MANUAL_REVIEW';
type RecoveryClassification='TERMINAL_REPLAY'|'RESUME'|'RECONCILE'|'CANCEL'|'CLEANUP'|'MANUAL_REVIEW';
interface RecoveryAuthority {attemptId:string;recoveryEpoch:bigint;fencingToken:bigint;databaseStartIdentity:Buffer;platformIncarnationId:string;deploymentEpoch:bigint;}
interface InventoryRecord {ownerKind:string;ownerId:string;snapshot:CanonicalJsonValue;}

const TERMINAL_COMMAND_STATES=['SUCCEEDED','FAILED_FINAL','CANCELLED_FINAL'];
const TERMINAL_SIDE_EFFECT_STATES=['CONFIRMED_APPLIED','CONFIRMED_NOT_APPLIED','FAILED_FINAL'];

const MANUAL_INVENTORY_QUERIES:readonly {ownerKind:string;table:string;predicate:string;snapshot:string;ownerIdExpr?:string}[]=[
  {ownerKind:'SIDE_EFFECT_OPERATION',table:'side_effect_operation',predicate:`status NOT IN ('CONFIRMED_APPLIED','CONFIRMED_NOT_APPLIED','FAILED_FINAL')`,snapshot:`jsonb_build_object('status',status,'stateVersion',state_version,'recoveryEpoch',recovery_epoch)`},
  {ownerKind:'SIDE_EFFECT_ATTEMPT',table:'side_effect_attempt_state',ownerIdExpr:`operation_id::text||':'||attempt_sequence::text`,predicate:`status NOT IN ('CONFIRMED_APPLIED','CONFIRMED_NOT_APPLIED','FAILED_FINAL')`,snapshot:`jsonb_build_object('operationId',operation_id,'attemptSequence',attempt_sequence,'status',status,'stateVersion',state_version)`},
  {ownerKind:'AI_MODEL_CALL',table:'ai_model_call',predicate:`submit_state NOT IN ('COMPLETED','FAILED_FINAL')`,snapshot:`jsonb_build_object('submitState',submit_state,'stateVersion',state_version,'providerResponseId',provider_response_id)`},
  {ownerKind:'AGENT_RUN',table:'agent_run',predicate:`status NOT IN ('SUCCEEDED','FAILED','CANCELLED')`,snapshot:`jsonb_build_object('status',status,'stateVersion',state_version,'leaseFence',lease_fencing_token)`},
  {ownerKind:'AGENT_TOOL_CALL',table:'agent_tool_call',predicate:`status NOT IN ('SUCCEEDED','FAILED','CANCELLED')`,snapshot:`jsonb_build_object('status',status,'stateVersion',state_version,'runId',agent_run_id)`},
  {ownerKind:'AGENT_HANDOFF_RUN',table:'agent_handoff_run',predicate:`status NOT IN ('SUCCEEDED','FAILED','CANCELLED')`,snapshot:`jsonb_build_object('status',status,'stateVersion',state_version,'rootRunId',root_agent_run_id)`},
  {ownerKind:'MCP_CALL_RUN',table:'mcp_call_run',predicate:`state NOT IN ('SUCCEEDED','FAILED','CANCELLED')`,snapshot:`jsonb_build_object('state',state,'stateVersion',state_version,'leaseFence',lease_fencing_token)`},
  {ownerKind:'MCP_TASK',table:'mcp_task',predicate:`state NOT IN ('COMPLETED','FAILED','CANCELLED')`,snapshot:`jsonb_build_object('state',state,'stateVersion',state_version,'leaseFence',lease_fencing_token)`},
  {ownerKind:'MCP_INPUT_EXCHANGE',table:'mcp_input_exchange',predicate:`status NOT IN ('CONSUMED','EXPIRED','INVALIDATED')`,snapshot:`jsonb_build_object('status',status,'stateVersion',state_version,'exchangeSequence',exchange_sequence)`},
  {ownerKind:'BROWSER_SESSION',table:'browser_session',predicate:`lifecycle NOT IN ('CLOSED','FAILED','EXPIRED')`,snapshot:`jsonb_build_object('lifecycle',lifecycle,'stateVersion',state_version,'controlFence',control_fence,'contextGeneration',context_generation)`},
  {ownerKind:'BROWSER_ACTION_RUN',table:'browser_action_run',predicate:`dispatch_phase NOT IN ('CONFIRMED_APPLIED','CONFIRMED_NOT_APPLIED','FAILED_FINAL')`,snapshot:`jsonb_build_object('dispatchPhase',dispatch_phase,'stateVersion',state_version,'sideEffectOperationId',side_effect_operation_id)`},
  {ownerKind:'BROWSER_AUTOMATION_RUN',table:'browser_automation_run',predicate:`completed_at IS NULL`,snapshot:`jsonb_build_object('status',status,'stateVersion',state_version,'leaseFence',lease_fencing_token)`},
  {ownerKind:'BROWSER_CHALLENGE',table:'browser_challenge',predicate:`status='PENDING'`,snapshot:`jsonb_build_object('status',status,'stateVersion',state_version,'challengeType',challenge_type)`},
  {ownerKind:'BROWSER_AUTH_ATTEMPT',table:'browser_auth_attempt',predicate:`completed_at IS NULL`,snapshot:`jsonb_build_object('state',state,'stateVersion',state_version,'challengeId',challenge_id)`},
  {ownerKind:'BROWSER_DOWNLOAD',table:'browser_download',predicate:`state NOT IN ('COMPLETED','FAILED','CANCELLED') OR cleanup_state IS DISTINCT FROM 'COMPLETE'`,snapshot:`jsonb_build_object('state',state,'cleanupState',cleanup_state,'stateVersion',state_version)`},
  {ownerKind:'BROWSER_UPLOAD_HANDLE',table:'browser_upload_handle',predicate:`cleanup_at IS NULL AND (consumed_at IS NULL OR expires_at>clock_timestamp())`,snapshot:`jsonb_build_object('consumedAt',consumed_at,'expiresAt',expires_at,'cleanupAt',cleanup_at,'stateVersion',state_version)`},
  {ownerKind:'RUNTIME_INSTANCE',table:'runtime_instance',predicate:`effective_state NOT IN ('ABSENT','STOPPED','FAILED')`,snapshot:`jsonb_build_object('effectiveState',effective_state,'runtimeGeneration',runtime_generation,'stateVersion',state_version)`},
  {ownerKind:'RUNTIME_PROCESS_IDENTITY',table:'runtime_process_identity',predicate:`exited_at IS NULL`,snapshot:`jsonb_build_object('runtimeInstanceId',runtime_instance_id,'runtimeGeneration',runtime_generation,'linuxPid',linux_pid,'stateVersion',state_version)`},
  {ownerKind:'RUNTIME_EXECUTION_CONTEXT',table:'runtime_execution_context',predicate:`completed_at IS NULL`,snapshot:`jsonb_build_object('state',state,'stateVersion',state_version,'executionKind',execution_kind)`},
  {ownerKind:'RUNTIME_IPC_CALL',table:'runtime_ipc_call',predicate:`state NOT IN ('SUCCEEDED','FAILED','CANCELLED')`,snapshot:`jsonb_build_object('state',state,'stateVersion',state_version,'sequence',sequence)`},
  {ownerKind:'RUNTIME_IPC_CONNECTION',table:'runtime_ipc_connection',predicate:`state NOT IN ('CLOSED','REJECTED')`,snapshot:`jsonb_build_object('state',state,'stateVersion',state_version,'inflightCount',inflight_count)`},
  {ownerKind:'RUNTIME_CLEANUP_OPERATION',table:'runtime_cleanup_operation',predicate:`completed_at IS NULL`,snapshot:`jsonb_build_object('lifecycle',lifecycle,'stateVersion',state_version,'fencingToken',fencing_token)`},
  {ownerKind:'GENERATION_JOB',table:'generation_job',predicate:`lifecycle NOT IN ('SUCCEEDED','FAILED_FINAL','CANCELLED_FINAL')`,snapshot:`jsonb_build_object('lifecycle',lifecycle,'stateVersion',state_version,'leaseFence',lease_fencing_token)`},
  {ownerKind:'GENERATION_PHASE_RUN',table:'generation_phase_run',predicate:`completed_at IS NULL`,snapshot:`jsonb_build_object('phase',phase,'state',state,'stateVersion',state_version,'leaseFence',lease_fencing_token)`},
  {ownerKind:'GENERATION_ACTIVATION_SET',table:'generation_activation_set',predicate:`state IN ('SWITCHING','VERIFYING','ROLLING_BACK','ROLLBACK_VERIFYING','MANUAL_REVIEW')`,snapshot:`jsonb_build_object('state',state,'stateVersion',state_version,'activationEpoch',activation_epoch)`},
  {ownerKind:'DEPLOYMENT_RUN',table:'deployment_run',predicate:`status NOT IN ('SUCCEEDED','ROLLED_BACK','FAILED')`,snapshot:`jsonb_build_object('status',status,'stateVersion',state_version,'leaseFence',lease_fencing_token)`},
  {ownerKind:'CLEANUP_OPERATION',table:'cleanup_operation',predicate:`status<>'CLOSED'`,snapshot:`jsonb_build_object('status',status,'stateVersion',state_version)`},
  {ownerKind:'CLEANUP_RESOURCE',table:'cleanup_resource',predicate:`status NOT IN ('VERIFIED_ABSENT','RETAINED_EVIDENCE')`,snapshot:`jsonb_build_object('status',status,'stateVersion',state_version,'cleanupOperationId',cleanup_operation_id)`},
  {ownerKind:'CONFIGURATION_APPLY_RUN',table:'configuration_apply_run',predicate:`completed_at IS NULL`,snapshot:`jsonb_build_object('state',state,'stateVersion',state_version,'leaseFence',lease_fencing_token)`},
  {ownerKind:'SCHEMA_MIGRATION',table:'schema_migration',predicate:`state NOT IN ('APPLIED','FAILED')`,snapshot:`jsonb_build_object('state',state,'stateVersion',state_version,'version',version,'leaseFence',lease_fencing_token)`},
  {ownerKind:'OPERATION_CONTEXT',table:'operation_context',predicate:`state IN ('DISPATCH_RESERVED','DISPATCHED','MANUAL_REVIEW')`,snapshot:`jsonb_build_object('state',state,'stateVersion',state_version,'activationEpoch',activation_epoch)`},
  {ownerKind:'CAPACITY_RESERVATION',table:'capacity_reservation',predicate:`released_at IS NULL`,snapshot:`jsonb_build_object('capacityKind',capacity_kind,'reservationClass',reservation_class,'reservedUnits',reserved_units,'fencingToken',fencing_token,'recoveryEpoch',recovery_epoch,'stateVersion',state_version)`},
  {ownerKind:'ARTIFACT_PUBLICATION',table:'artifact_publication',predicate:`artifact_state NOT IN ('PUBLISHED','CLEANED','FAILED')`,snapshot:`jsonb_build_object('artifactState',artifact_state,'publicationRevision',publication_revision,'fencingToken',fencing_token,'recoveryEpoch',recovery_epoch,'stateVersion',state_version)`}
] as const;

const INVENTORY_LOCK_TABLES=[
  'domain_command','queue_item','concurrency_claim','domain_command_activation_domain','activation_domain_head','domain_command_execution_checkpoint','transactional_outbox',
  ...MANUAL_INVENTORY_QUERIES.map((query)=>query.table),'platform_recovery_item','platform_recovery_attempt'
].filter((table,index,all)=>all.indexOf(table)===index).sort();

function safeJson(value:unknown):CanonicalJsonValue{return JSON.parse(JSON.stringify(value,(_key,item)=>typeof item==='bigint'?item.toString():Buffer.isBuffer(item)?item.toString('hex'):item)) as CanonicalJsonValue;}
function digestBytes(value:CanonicalJsonValue):Buffer{return Buffer.from(canonicalDigest(value).slice('sha256:'.length),'hex');}
function recordDigest(record:InventoryRecord):Buffer{return digestBytes(safeJson({ownerKind:record.ownerKind,ownerId:record.ownerId,snapshot:record.snapshot}));}

async function exclusiveRecoveryLock(client:DatabaseClient):Promise<void>{await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('PLATFORM_RECOVERY_BARRIER',0))`);}

async function schemaConstraintDigest(client:DatabaseClient):Promise<Buffer>{
  const rows=(await client.query(`SELECT namespace.nspname AS schema_name,relation.relname AS table_name,constraint_record.conname AS constraint_name,pg_get_constraintdef(constraint_record.oid,true) AS definition
    FROM pg_constraint constraint_record JOIN pg_class relation ON relation.oid=constraint_record.conrelid JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname='kcml' ORDER BY relation.relname,constraint_record.conname`)).rows;
  return digestBytes(safeJson(rows));
}

async function commandInventoryRecord(client:DatabaseClient,commandId:string):Promise<InventoryRecord|null>{
  const row=(await client.query(`SELECT command.id::text AS owner_id,jsonb_build_object(
      'status',command.status,'stateVersion',command.state_version,'recoveryEpoch',command.recovery_epoch,'fence',command.concurrency_fencing_token,
      'queueStatus',queue.status,'queueStateVersion',queue.state_version,'queueRecoveryEpoch',queue.recovery_epoch,'queueFence',queue.concurrency_fencing_token,
      'checkpoint',checkpoint.command_id IS NOT NULL,'admissionState',relation.state,
      'nonterminalSideEffects',(SELECT count(*) FROM kcml.side_effect_operation effect WHERE effect.command_id=command.id AND effect.status<>ALL($2::text[]))) AS snapshot
    FROM kcml.domain_command command LEFT JOIN kcml.queue_item queue ON queue.command_id=command.id
    LEFT JOIN kcml.domain_command_execution_checkpoint checkpoint ON checkpoint.command_id=command.id
    LEFT JOIN kcml.domain_command_activation_domain relation ON relation.domain_command_id=command.id
    WHERE command.id=$1 AND command.status<>ALL($3::text[])`,[commandId,TERMINAL_SIDE_EFFECT_STATES,TERMINAL_COMMAND_STATES])).rows[0];
  return row?{ownerKind:'DOMAIN_COMMAND',ownerId:String(row.owner_id),snapshot:safeJson(row.snapshot)}:null;
}

async function outboxInventoryRecord(client:DatabaseClient,outboxId:string):Promise<InventoryRecord|null>{
  const row=(await client.query(`SELECT id::text AS owner_id,jsonb_build_object('status',status,'stateVersion',state_version,'recoveryEpoch',recovery_epoch,'dispatchAuthority',is_dispatch_authority,'sideEffectOperationId',side_effect_operation_id,'deliveryFence',delivery_fencing_token) AS snapshot
    FROM kcml.transactional_outbox WHERE id=$1 AND status IN ('PENDING','CLAIMED')`,[outboxId])).rows[0];
  return row?{ownerKind:'TRANSACTIONAL_OUTBOX',ownerId:String(row.owner_id),snapshot:safeJson(row.snapshot)}:null;
}

async function collectInventory(client:DatabaseClient):Promise<InventoryRecord[]>{
  const records:InventoryRecord[]=[];
  const commandIds=(await client.query(`SELECT id::text AS id FROM kcml.domain_command WHERE status<>ALL($1::text[]) ORDER BY id`,[TERMINAL_COMMAND_STATES])).rows;
  for(const row of commandIds){const record=await commandInventoryRecord(client,String(row.id));if(record)records.push(record);}
  const outboxIds=(await client.query(`SELECT id::text AS id FROM kcml.transactional_outbox WHERE status IN ('PENDING','CLAIMED') ORDER BY id`)).rows;
  for(const row of outboxIds){const record=await outboxInventoryRecord(client,String(row.id));if(record)records.push(record);}
  for(const query of MANUAL_INVENTORY_QUERIES){
    const ownerIdExpr=query.ownerIdExpr??'id::text';const result=await client.query(`SELECT ${ownerIdExpr} AS owner_id,${query.snapshot} AS snapshot FROM kcml.${query.table} WHERE ${query.predicate} ORDER BY ${ownerIdExpr}`);
    for(const row of result.rows)records.push({ownerKind:query.ownerKind,ownerId:String(row.owner_id),snapshot:safeJson(row.snapshot)});
  }
  const orphanQueues=await client.query(`SELECT queue.id::text AS owner_id,jsonb_build_object('status',queue.status,'commandId',queue.command_id,'stateVersion',queue.state_version,'recoveryEpoch',queue.recovery_epoch) AS snapshot
    FROM kcml.queue_item queue LEFT JOIN kcml.domain_command command ON command.id=queue.command_id
    WHERE queue.status IN ('READY','CLAIMED') AND (command.id IS NULL OR command.status=ANY($1::text[])) ORDER BY queue.id`,[TERMINAL_COMMAND_STATES]);
  for(const row of orphanQueues.rows)records.push({ownerKind:'ORPHAN_QUEUE_ITEM',ownerId:String(row.owner_id),snapshot:safeJson(row.snapshot)});
  const orphanClaims=await client.query(`SELECT claim.id::text AS owner_id,jsonb_build_object('logicalOperationId',claim.logical_operation_id,'fence',claim.fencing_token,'recoveryEpoch',claim.recovery_epoch,'stateVersion',claim.state_version) AS snapshot
    FROM kcml.concurrency_claim claim LEFT JOIN kcml.domain_command command ON command.logical_operation_id=claim.logical_operation_id
    WHERE claim.released_at IS NULL AND (command.id IS NULL OR command.status=ANY($1::text[])) ORDER BY claim.id`,[TERMINAL_COMMAND_STATES]);
  for(const row of orphanClaims.rows)records.push({ownerKind:'ORPHAN_CONCURRENCY_CLAIM',ownerId:String(row.owner_id),snapshot:safeJson(row.snapshot)});
  return records.sort((left,right)=>left.ownerKind.localeCompare(right.ownerKind)||left.ownerId.localeCompare(right.ownerId));
}

async function insertRecoveryItem(client:DatabaseClient,authority:RecoveryAuthority,record:InventoryRecord,classification:RecoveryClassification,blocking:boolean,successorKind:string|null,successorId:string|null,evidence:CanonicalJsonValue):Promise<void>{
  await client.query(`INSERT INTO kcml.platform_recovery_item(recovery_attempt_id,owner_kind,owner_id,classification,inventory_digest,successor_kind,successor_id,blocking,evidence,recovery_epoch,recovery_fencing_token)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(recovery_attempt_id,owner_kind,owner_id,classification_revision) DO NOTHING`,[authority.attemptId,record.ownerKind,record.ownerId,classification,recordDigest(record),successorKind,successorId,blocking,evidence,authority.recoveryEpoch.toString(),authority.fencingToken.toString()]);
}

export interface PlatformRecoveryResult {state:RecoveryState;attemptId:string;recoveryEpoch:bigint;inventoryCount:number;classificationCounts:Record<string,number>;unresolvedObjectIds:string[];evidenceDigest:string;}
export type PlatformRecoveryFaultPoint='AFTER_RECOVERY_STARTING'|'AFTER_RECOVERY_RECONCILING'|'BEFORE_RECOVERY_READY_TRANSITION';
export interface PlatformRecoveryCoordinatorOptions {faultInjector?:(point:PlatformRecoveryFaultPoint,context:Readonly<{attemptId:string;recoveryEpoch:bigint;fencingToken:bigint}>)=>void|Promise<void>;}

export class PlatformRecoveryCoordinator {
  public constructor(private readonly pool:DatabasePool,private readonly options:PlatformRecoveryCoordinatorOptions={}){}

  public async recover(workerId:string):Promise<PlatformRecoveryResult>{
    if(!/^[0-9a-f-]{36}$/iu.test(workerId))throw new DomainError('AGENTIC_OPERATION_CONTEXT_INVALID','Recovery worker identity must be a UUID',500,'DO_NOT_RETRY');
    const authority=await this.beginOrTakeOver(workerId);
    await this.options.faultInjector?.('AFTER_RECOVERY_STARTING',{attemptId:authority.attemptId,recoveryEpoch:authority.recoveryEpoch,fencingToken:authority.fencingToken});
    await this.enterReconciling(authority,workerId);
    await this.options.faultInjector?.('AFTER_RECOVERY_RECONCILING',{attemptId:authority.attemptId,recoveryEpoch:authority.recoveryEpoch,fencingToken:authority.fencingToken});
    await this.classifyCommands(authority,workerId);
    await this.classifyOutbox(authority,workerId);
    await this.classifyCurrentDeployment(authority,workerId);
    await this.classifyAiModelCalls(authority,workerId);
    await this.classifySafeBrowserCleanup(authority,workerId);
    await this.classifyRemainingInventory(authority,workerId);
    await this.options.faultInjector?.('BEFORE_RECOVERY_READY_TRANSITION',{attemptId:authority.attemptId,recoveryEpoch:authority.recoveryEpoch,fencingToken:authority.fencingToken});
    return this.finalize(authority,workerId);
  }

  private async beginOrTakeOver(workerId:string):Promise<RecoveryAuthority>{return inTransaction(this.pool,'SERIALIZABLE',async(client)=>{
    await exclusiveRecoveryLock(client);
    const current=(await client.query(`SELECT head.*,kcml.current_database_start_identity() AS current_database_start_identity,platform.platform_incarnation_id AS current_platform_incarnation_id,deployment.current_epoch
      FROM kcml.platform_recovery_head head CROSS JOIN kcml.platform_incarnation platform CROSS JOIN kcml.application_deployment_head deployment
      WHERE head.singleton_key=1 AND platform.singleton_key=1 AND deployment.singleton_key=1 FOR UPDATE OF head,platform,deployment`)).rows[0];
    if(!current)throw new DomainError('PLATFORM_RECOVERY_IN_PROGRESS','Platform recovery authority is missing',503,'DO_NOT_RETRY');
    const currentIdentity=Buffer.from(current.current_database_start_identity);const platformId=String(current.current_platform_incarnation_id);const deploymentEpoch=BigInt(current.current_epoch);
    const currentAttempt=current.current_attempt_id?(await client.query(`SELECT * FROM kcml.platform_recovery_attempt WHERE id=$1 FOR UPDATE`,[current.current_attempt_id])).rows[0]:null;
    const attemptReusable=currentAttempt&&!currentAttempt.finished_at&&Buffer.from(currentAttempt.database_start_identity).equals(currentIdentity)&&String(currentAttempt.platform_incarnation_id)===platformId&&BigInt(currentAttempt.application_deployment_epoch)===deploymentEpoch;
    if(attemptReusable){
      const fence=BigInt(currentAttempt.lease_fencing_token)+1n;
      await client.query(`UPDATE kcml.platform_recovery_attempt SET lease_owner=$2,lease_fencing_token=$3,lease_expires_at=clock_timestamp()+interval '2 minutes',state_version=state_version+1 WHERE id=$1`,[currentAttempt.id,workerId,fence.toString()]);
      await client.query(`UPDATE kcml.platform_recovery_head SET current_fencing_token=$2,state_version=state_version+1,updated_at=clock_timestamp() WHERE singleton_key=1 AND current_attempt_id=$1`,[currentAttempt.id,fence.toString()]);
      return {attemptId:String(currentAttempt.id),recoveryEpoch:BigInt(currentAttempt.recovery_epoch),fencingToken:fence,databaseStartIdentity:currentIdentity,platformIncarnationId:platformId,deploymentEpoch};
    }
    if(currentAttempt&&!currentAttempt.finished_at){
      if(currentAttempt.state==='STARTING')await client.query(`UPDATE kcml.platform_recovery_attempt SET state='RECONCILING',state_version=state_version+1 WHERE id=$1`,[currentAttempt.id]);
      await client.query(`UPDATE kcml.platform_recovery_attempt SET state='BLOCKED',finished_at=clock_timestamp(),unresolved_object_ids=jsonb_build_array('SUPERSEDED_AUTHORITY_LINEAGE'),evidence_digest=digest(convert_to('SUPERSEDED_AUTHORITY_LINEAGE','UTF8'),'sha256'),state_version=state_version+1 WHERE id=$1`,[currentAttempt.id]);
    }
    const attemptId=randomUUID();const recoveryEpoch=BigInt(current.recovery_epoch)+1n;const fence=BigInt(current.current_fencing_token)+1n;const constraintDigest=await schemaConstraintDigest(client);
    await client.query(`INSERT INTO kcml.platform_recovery_attempt(id,database_start_identity,platform_incarnation_id,application_deployment_epoch,recovery_epoch,state,lease_owner,lease_fencing_token,lease_expires_at,schema_constraint_digest)
      VALUES($1,$2,$3,$4,$5,'STARTING',$6,$7,clock_timestamp()+interval '2 minutes',$8)`,[attemptId,currentIdentity,platformId,deploymentEpoch.toString(),recoveryEpoch.toString(),workerId,fence.toString(),constraintDigest]);
    await client.query(`UPDATE kcml.platform_recovery_head SET database_start_identity=$2,platform_incarnation_id=$3,application_deployment_epoch=$4,recovery_epoch=$5,state='STARTING',state_version=state_version+1,current_attempt_id=$6,current_fencing_token=$7,ready_evidence_digest=NULL,updated_at=clock_timestamp() WHERE singleton_key=$1`,[1,currentIdentity,platformId,deploymentEpoch.toString(),recoveryEpoch.toString(),attemptId,fence.toString()]);
    return {attemptId,recoveryEpoch,fencingToken:fence,databaseStartIdentity:currentIdentity,platformIncarnationId:platformId,deploymentEpoch};
  });}

  private async enterReconciling(authority:RecoveryAuthority,workerId:string):Promise<void>{await inTransaction(this.pool,'SERIALIZABLE',async(client)=>{
    await exclusiveRecoveryLock(client);
    const attempt=(await client.query(`SELECT * FROM kcml.platform_recovery_attempt WHERE id=$1 FOR UPDATE`,[authority.attemptId])).rows[0];
    if(!attempt||String(attempt.lease_owner)!==workerId||BigInt(attempt.lease_fencing_token)!==authority.fencingToken)throw new DomainError('FENCING_TOKEN_STALE','Recovery attempt fence is not current',409,'RECONCILE_THEN_RETRY');
    if(attempt.state==='STARTING')await client.query(`UPDATE kcml.platform_recovery_attempt SET state='RECONCILING',lease_expires_at=clock_timestamp()+interval '2 minutes',state_version=state_version+1 WHERE id=$1`,[authority.attemptId]);
    await client.query(`UPDATE kcml.platform_recovery_head SET state='RECONCILING',state_version=state_version+1,updated_at=clock_timestamp() WHERE singleton_key=1 AND current_attempt_id=$1 AND current_fencing_token=$2`,[authority.attemptId,authority.fencingToken.toString()]);
  });}

  private async classifyCommands(authority:RecoveryAuthority,workerId:string):Promise<void>{
    const ids=(await this.pool.query(`SELECT id::text AS id FROM kcml.domain_command WHERE status<>ALL($1::text[]) ORDER BY id`,[TERMINAL_COMMAND_STATES])).rows.map((row)=>String(row.id));
    for(const commandId of ids)await inTransaction(this.pool,'SERIALIZABLE',async(client)=>{
      await exclusiveRecoveryLock(client);await this.assertFence(client,authority,workerId);
      const already=Number((await client.query(`SELECT count(*)::int AS count FROM kcml.platform_recovery_item WHERE recovery_attempt_id=$1 AND owner_kind='DOMAIN_COMMAND' AND owner_id=$2`,[authority.attemptId,commandId])).rows[0]?.count??0)>0;if(already)return;
      const identity=(await client.query(`SELECT command.*,relation.id AS admission_id,relation.activation_domain_id,relation.state AS admission_state FROM kcml.domain_command command LEFT JOIN kcml.domain_command_activation_domain relation ON relation.domain_command_id=command.id WHERE command.id=$1`,[commandId])).rows[0];if(!identity||TERMINAL_COMMAND_STATES.includes(String(identity.status)))return;
      if(identity.activation_domain_id)await client.query(`SELECT id FROM kcml.activation_domain_head WHERE id=$1 FOR UPDATE`,[identity.activation_domain_id]);
      const claim=identity.concurrency_claim_id?(await client.query(`SELECT * FROM kcml.concurrency_claim WHERE id=$1 FOR UPDATE`,[identity.concurrency_claim_id])).rows[0]:null;
      const command=(await client.query(`SELECT * FROM kcml.domain_command WHERE id=$1 FOR UPDATE`,[commandId])).rows[0];
      const queue=(await client.query(`SELECT * FROM kcml.queue_item WHERE command_id=$1 AND status IN ('READY','CLAIMED') FOR UPDATE`,[commandId])).rows[0];
      const checkpoint=(await client.query(`SELECT * FROM kcml.domain_command_execution_checkpoint WHERE command_id=$1`,[commandId])).rows[0];
      const effects=(await client.query(`SELECT status FROM kcml.side_effect_operation WHERE command_id=$1 ORDER BY id FOR UPDATE`,[commandId])).rows;
      const effectUncertain=effects.some((effect)=>!TERMINAL_SIDE_EFFECT_STATES.includes(String(effect.status)));
      const claimValid=claim&&!claim.released_at&&String(claim.logical_operation_id)===String(command.logical_operation_id);
      let classification:RecoveryClassification='MANUAL_REVIEW';let blocking=true;let evidence:CanonicalJsonValue=safeJson({reason:'COMMAND_RECOVERY_INVENTORY_INCOMPLETE',queuePresent:Boolean(queue),claimValid:Boolean(claimValid),effectUncertain});
      if(queue&&claimValid&&!effectUncertain){
        classification=checkpoint?'TERMINAL_REPLAY':'RESUME';blocking=false;const nextFence=BigInt(claim.fencing_token)+1n;
        await client.query(`UPDATE kcml.concurrency_claim SET owner_instance_id=$2,fencing_token=$3,heartbeat_at=clock_timestamp(),expires_at=clock_timestamp()+interval '5 minutes',released_at=NULL,state_version=state_version+1,platform_incarnation_id=$4,application_deployment_epoch=$5,recovery_epoch=$6 WHERE id=$1`,[claim.id,workerId,nextFence.toString(),authority.platformIncarnationId,authority.deploymentEpoch.toString(),authority.recoveryEpoch.toString()]);
        await client.query(`UPDATE kcml.domain_command SET status='ACCEPTED',platform_incarnation_id=$2,application_deployment_epoch=$3,recovery_epoch=$4,concurrency_fencing_token=$5,state_version=state_version+1 WHERE id=$1`,[commandId,authority.platformIncarnationId,authority.deploymentEpoch.toString(),authority.recoveryEpoch.toString(),nextFence.toString()]);
        await client.query(`UPDATE kcml.queue_item SET status='READY',available_at=clock_timestamp(),lease_owner=NULL,lease_expires_at=NULL,platform_incarnation_id=$2,application_deployment_epoch=$3,recovery_epoch=$4,concurrency_fencing_token=$5,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`,[queue.id,authority.platformIncarnationId,authority.deploymentEpoch.toString(),authority.recoveryEpoch.toString(),nextFence.toString()]);
        if(identity.activation_domain_id)await client.query(`UPDATE kcml.activation_domain_head SET platform_incarnation_id=$2,application_deployment_epoch=$3,recovery_epoch=$4,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`,[identity.activation_domain_id,authority.platformIncarnationId,authority.deploymentEpoch.toString(),authority.recoveryEpoch.toString()]);
        evidence=safeJson({reason:checkpoint?'IMMUTABLE_APPLY_CHECKPOINT_PRESENT':'NO_APPLY_CHECKPOINT_AND_NO_POSSIBLE_EXTERNAL_EFFECT',queueId:String(queue.id),previousCommandStatus:String(command.status),previousQueueStatus:String(queue.status),successorFence:nextFence.toString()});
      }
      const record=await commandInventoryRecord(client,commandId);if(!record)return;
      await insertRecoveryItem(client,authority,record,classification,blocking,blocking?null:'QUEUE_ITEM',blocking?null:String(queue.id),evidence);
    });
  }

  private async classifyOutbox(authority:RecoveryAuthority,workerId:string):Promise<void>{
    const ids=(await this.pool.query(`SELECT id::text AS id FROM kcml.transactional_outbox WHERE status IN ('PENDING','CLAIMED') ORDER BY id`)).rows.map((row)=>String(row.id));
    for(const outboxId of ids)await inTransaction(this.pool,'SERIALIZABLE',async(client)=>{
      await exclusiveRecoveryLock(client);await this.assertFence(client,authority,workerId);
      const already=Number((await client.query(`SELECT count(*)::int AS count FROM kcml.platform_recovery_item WHERE recovery_attempt_id=$1 AND owner_kind='TRANSACTIONAL_OUTBOX' AND owner_id=$2`,[authority.attemptId,outboxId])).rows[0]?.count??0)>0;if(already)return;
      const outbox=(await client.query(`SELECT * FROM kcml.transactional_outbox WHERE id=$1 AND status IN ('PENDING','CLAIMED') FOR UPDATE`,[outboxId])).rows[0];if(!outbox)return;
      const uncertain=Boolean(outbox.is_dispatch_authority)||Boolean(outbox.side_effect_operation_id);
      if(!uncertain)await client.query(`UPDATE kcml.transactional_outbox SET status='PENDING',delivery_owner=NULL,delivery_lease_expires_at=NULL,recovery_epoch=$2,state_version=state_version+1 WHERE id=$1`,[outboxId,authority.recoveryEpoch.toString()]);
      const record=await outboxInventoryRecord(client,outboxId);if(!record)return;
      await insertRecoveryItem(client,authority,record,uncertain?'MANUAL_REVIEW':'RESUME',uncertain,uncertain?null:'TRANSACTIONAL_OUTBOX',uncertain?null:outboxId,safeJson({reason:uncertain?'POSSIBLE_EXTERNAL_DISPATCH_REQUIRES_RECONCILIATION':'IDEMPOTENT_DOMAIN_EVENT_DELIVERY_RESUME',previousStatus:String(outbox.status)}));
    });
  }

  private async classifyCurrentDeployment(authority:RecoveryAuthority,workerId:string):Promise<void>{await inTransaction(this.pool,'SERIALIZABLE',async(client)=>{
    await exclusiveRecoveryLock(client);await this.assertFence(client,authority,workerId);
    const current=(await client.query(`SELECT run.*,head.current_epoch,head.current_release_id,head.source_sha AS current_source_sha,head.deployment_id
      FROM kcml.application_deployment_head head JOIN kcml.deployment_run run ON run.id=head.deployment_id
      WHERE head.singleton_key=1 AND run.status IN ('PLANNED','PREFLIGHT','BACKUP','MIGRATING','INSTALLING','SWITCHING','VERIFYING','ROLLING_BACK') FOR UPDATE OF head,run`)).rows[0];
    if(!current)return;
    const exactCurrent=BigInt(current.current_epoch)===authority.deploymentEpoch&&BigInt(current.deployment_epoch)===authority.deploymentEpoch&&String(current.release_id)===String(current.current_release_id)&&String(current.source_sha)===String(current.current_source_sha)&&String(current.platform_incarnation_id)===authority.platformIncarnationId;
    if(!exactCurrent)return;
    const record=(await collectInventory(client)).find((item)=>item.ownerKind==='DEPLOYMENT_RUN'&&item.ownerId===String(current.id));if(!record)return;
    const existing=Number((await client.query(`SELECT count(*)::int AS count FROM kcml.platform_recovery_item WHERE recovery_attempt_id=$1 AND owner_kind='DEPLOYMENT_RUN' AND owner_id=$2`,[authority.attemptId,String(current.id)])).rows[0]?.count??0)>0;
    if(!existing)await insertRecoveryItem(client,authority,record,'RESUME',false,'DEPLOYMENT_RUN',String(current.id),safeJson({reason:'CURRENT_DEPLOYMENT_HEAD_EXACTLY_MATCHES_IN_FLIGHT_RUN',releaseId:String(current.release_id),sourceSha:String(current.source_sha),deploymentEpoch:String(current.deployment_epoch),status:String(current.status)}));
  });}

  private async classifyAiModelCalls(authority:RecoveryAuthority,workerId:string):Promise<void>{
    const ids=(await this.pool.query(`SELECT id::text AS id FROM kcml.ai_model_call WHERE submit_state NOT IN ('COMPLETED','FAILED_FINAL') ORDER BY id`)).rows.map((row)=>String(row.id));
    for(const callId of ids)await inTransaction(this.pool,'SERIALIZABLE',async(client)=>{
      await exclusiveRecoveryLock(client);await this.assertFence(client,authority,workerId);
      const call=(await client.query(`SELECT * FROM kcml.ai_model_call WHERE id=$1 FOR UPDATE`,[callId])).rows[0];
      if(!call||['COMPLETED','FAILED_FINAL'].includes(String(call.submit_state)))return;
      const existing=Number((await client.query(`SELECT count(*)::int AS count FROM kcml.platform_recovery_item WHERE recovery_attempt_id=$1 AND owner_kind='AI_MODEL_CALL' AND owner_id=$2`,[authority.attemptId,callId])).rows[0]?.count??0)>0;
      if(existing)return;
      const record:InventoryRecord={ownerKind:'AI_MODEL_CALL',ownerId:callId,snapshot:safeJson({submitState:call.submit_state,stateVersion:call.state_version,providerResponseId:call.provider_response_id})};
      const hasProviderResponse=typeof call.provider_response_id==='string'&&call.provider_response_id.length>0;
      await insertRecoveryItem(client,authority,record,hasProviderResponse?'RESUME':'MANUAL_REVIEW',!hasProviderResponse,hasProviderResponse?'AI_MODEL_CALL':null,hasProviderResponse?callId:null,safeJson({
        reason:hasProviderResponse?'PROVIDER_RESPONSE_ID_PRESENT_CANONICAL_RETRIEVE_REQUIRED':'PROVIDER_RESPONSE_ID_MISSING_OUTCOME_UNKNOWN',
        providerResponseId:call.provider_response_id??null
      }));
    });
  }

  private async classifySafeBrowserCleanup(authority:RecoveryAuthority,workerId:string):Promise<void>{
    const ids=(await this.pool.query(`SELECT session.id::text AS id FROM kcml.browser_session session
      WHERE session.lifecycle NOT IN ('CLOSED','FAILED','EXPIRED')
        AND NOT EXISTS(SELECT 1 FROM kcml.browser_session_dispatch_lease lease WHERE lease.session_id=session.id AND lease.released_at IS NULL)
        AND NOT EXISTS(SELECT 1 FROM kcml.browser_action_run action WHERE action.session_id=session.id AND action.dispatch_phase NOT IN ('CONFIRMED_APPLIED','CONFIRMED_NOT_APPLIED','FAILED_FINAL'))
        AND NOT EXISTS(SELECT 1 FROM kcml.browser_challenge challenge WHERE challenge.session_id=session.id AND challenge.status='PENDING')
        AND NOT EXISTS(SELECT 1 FROM kcml.browser_download download WHERE download.session_id=session.id AND (download.state NOT IN ('COMPLETED','FAILED','CANCELLED') OR download.cleanup_state IS DISTINCT FROM 'COMPLETE'))
        AND NOT EXISTS(SELECT 1 FROM kcml.browser_upload_handle upload WHERE upload.session_id=session.id AND upload.cleanup_at IS NULL AND (upload.consumed_at IS NULL OR upload.expires_at>clock_timestamp()))
      ORDER BY session.id`)).rows.map((row)=>String(row.id));
    for(const sessionId of ids)await inTransaction(this.pool,'SERIALIZABLE',async(client)=>{
      await exclusiveRecoveryLock(client);await this.assertFence(client,authority,workerId);
      const existing=Number((await client.query(`SELECT count(*)::int AS count FROM kcml.platform_recovery_item WHERE recovery_attempt_id=$1 AND owner_kind='BROWSER_SESSION' AND owner_id=$2`,[authority.attemptId,sessionId])).rows[0]?.count??0)>0;if(existing)return;
      const record=(await collectInventory(client)).find((item)=>item.ownerKind==='BROWSER_SESSION'&&item.ownerId===sessionId);if(!record)return;
      const safe=(await client.query(`SELECT session.lifecycle,session.state_version,
          NOT EXISTS(SELECT 1 FROM kcml.browser_session_dispatch_lease lease WHERE lease.session_id=session.id AND lease.released_at IS NULL) AS no_active_lease,
          NOT EXISTS(SELECT 1 FROM kcml.browser_action_run action WHERE action.session_id=session.id AND action.dispatch_phase NOT IN ('CONFIRMED_APPLIED','CONFIRMED_NOT_APPLIED','FAILED_FINAL')) AS no_uncertain_action,
          NOT EXISTS(SELECT 1 FROM kcml.browser_challenge challenge WHERE challenge.session_id=session.id AND challenge.status='PENDING') AS no_pending_challenge,
          NOT EXISTS(SELECT 1 FROM kcml.browser_download download WHERE download.session_id=session.id AND (download.state NOT IN ('COMPLETED','FAILED','CANCELLED') OR download.cleanup_state IS DISTINCT FROM 'COMPLETE')) AS no_pending_download,
          NOT EXISTS(SELECT 1 FROM kcml.browser_upload_handle upload WHERE upload.session_id=session.id AND upload.cleanup_at IS NULL AND (upload.consumed_at IS NULL OR upload.expires_at>clock_timestamp())) AS no_live_upload
        FROM kcml.browser_session session WHERE session.id=$1 FOR UPDATE`,[sessionId])).rows[0];
      if(!safe||!safe.no_active_lease||!safe.no_uncertain_action||!safe.no_pending_challenge||!safe.no_pending_download||!safe.no_live_upload)return;
      await insertRecoveryItem(client,authority,record,'CLEANUP',false,'BROWSER_SESSION',sessionId,safeJson({reason:'NO_HOST_AUTHORITY_OR_UNCERTAIN_BROWSER_EFFECT',lifecycle:String(safe.lifecycle),stateVersion:String(safe.state_version),oracle:{noActiveLease:true,noUncertainAction:true,noPendingChallenge:true,noPendingDownload:true,noLiveUpload:true}}));
    });
  }

  private async classifyRemainingInventory(authority:RecoveryAuthority,workerId:string):Promise<void>{await inTransaction(this.pool,'SERIALIZABLE',async(client)=>{
    await exclusiveRecoveryLock(client);await this.assertFence(client,authority,workerId);
    const inventory=await collectInventory(client);
    for(const record of inventory){
      const existing=Number((await client.query(`SELECT count(*)::int AS count FROM kcml.platform_recovery_item WHERE recovery_attempt_id=$1 AND owner_kind=$2 AND owner_id=$3`,[authority.attemptId,record.ownerKind,record.ownerId])).rows[0]?.count??0)>0;
      if(!existing)await insertRecoveryItem(client,authority,record,'MANUAL_REVIEW',true,null,null,safeJson({reason:'NO_AUTOMATIC_RECOVERY_ORACLE_IMPLEMENTED_FOR_AUTHORITY_KIND',ownerKind:record.ownerKind}));
    }
    const stableInventory=await collectInventory(client);const digest=digestBytes(safeJson(stableInventory));const watermark=safeJson({count:stableInventory.length,kinds:Object.fromEntries([...new Set(stableInventory.map((record)=>record.ownerKind))].sort().map((kind)=>[kind,stableInventory.filter((record)=>record.ownerKind===kind).length]))});
    await client.query(`UPDATE kcml.platform_recovery_attempt SET first_inventory_digest=$2,inventory_watermark=$3,lease_expires_at=clock_timestamp()+interval '2 minutes',state_version=state_version+1 WHERE id=$1`,[authority.attemptId,digest,watermark]);
  });}

  private async finalize(authority:RecoveryAuthority,workerId:string):Promise<PlatformRecoveryResult>{return inTransaction(this.pool,'SERIALIZABLE',async(client)=>{
    await exclusiveRecoveryLock(client);await this.assertFence(client,authority,workerId);
    for(const table of INVENTORY_LOCK_TABLES)await client.query(`LOCK TABLE kcml.${table} IN SHARE MODE`);
    const attempt=(await client.query(`SELECT * FROM kcml.platform_recovery_attempt WHERE id=$1 FOR UPDATE`,[authority.attemptId])).rows[0];
    const inventory=await collectInventory(client);const stableDigest=digestBytes(safeJson(inventory));const digestStable=attempt.first_inventory_digest&&Buffer.from(attempt.first_inventory_digest).equals(stableDigest);
    const items=(await client.query(`SELECT * FROM kcml.platform_recovery_item WHERE recovery_attempt_id=$1 ORDER BY owner_kind,owner_id`,[authority.attemptId])).rows;
    const itemByOwner=new Map(items.map((item)=>[`${item.owner_kind}\u0000${item.owner_id}`,item]));const missing:string[]=[];const changed:string[]=[];
    for(const record of inventory){const item=itemByOwner.get(`${record.ownerKind}\u0000${record.ownerId}`);if(!item)missing.push(`${record.ownerKind}:${record.ownerId}`);else if(!Buffer.from(item.inventory_digest).equals(recordDigest(record)))changed.push(`${record.ownerKind}:${record.ownerId}`);}
    const blockers=items.filter((item)=>item.blocking).map((item)=>`${item.owner_kind}:${item.owner_id}`);const nonBlockingOwners=new Set(items.filter((item)=>!item.blocking).map((item)=>`${item.owner_kind}:${item.owner_id}`));const currentConstraintDigest=await schemaConstraintDigest(client);const schemaStable=Buffer.from(attempt.schema_constraint_digest).equals(currentConstraintDigest);
    const unresolved=[...new Set([...missing.filter((id)=>!nonBlockingOwners.has(id)),...changed.filter((id)=>!nonBlockingOwners.has(id)),...blockers,...(!digestStable?['INVENTORY_DIGEST_CHANGED']:[]),...(!schemaStable?['SCHEMA_CONSTRAINT_DIGEST_CHANGED']:[])])].sort();
    const counts:Record<string,number>={};for(const item of items)counts[String(item.classification)]=(counts[String(item.classification)]??0)+1;
    const state:RecoveryState=unresolved.length===0?'READY':blockers.length>0?'MANUAL_REVIEW':'BLOCKED';
    const evidence=safeJson({attemptId:authority.attemptId,recoveryEpoch:authority.recoveryEpoch.toString(),databaseStartIdentity:authority.databaseStartIdentity.toString('hex'),platformIncarnationId:authority.platformIncarnationId,deploymentEpoch:authority.deploymentEpoch.toString(),inventoryCount:inventory.length,inventoryDigest:stableDigest.toString('hex'),digestStable,schemaConstraintDigest:currentConstraintDigest.toString('hex'),schemaStable,classificationCounts:counts,unresolved});const evidenceDigest=digestBytes(evidence);
    await client.query(`UPDATE kcml.platform_recovery_attempt SET state=$2,finished_at=clock_timestamp(),stable_inventory_digest=$3,classification_counts=$4,unresolved_object_ids=$5,evidence_digest=$6,lease_expires_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1`,[authority.attemptId,state,stableDigest,counts,JSON.stringify(unresolved),evidenceDigest]);
    await client.query(`UPDATE kcml.platform_recovery_head SET state=$2,ready_evidence_digest=$3,state_version=state_version+1,updated_at=clock_timestamp() WHERE singleton_key=1 AND current_attempt_id=$1 AND current_fencing_token=$4`,[authority.attemptId,state,state==='READY'?evidenceDigest:null,authority.fencingToken.toString()]);
    return {state,attemptId:authority.attemptId,recoveryEpoch:authority.recoveryEpoch,inventoryCount:inventory.length,classificationCounts:counts,unresolvedObjectIds:unresolved,evidenceDigest:`sha256:${evidenceDigest.toString('hex')}`};
  });}

  private async assertFence(client:DatabaseClient,authority:RecoveryAuthority,workerId:string):Promise<void>{
    const row=(await client.query(`SELECT attempt.lease_owner,attempt.lease_fencing_token,attempt.state,head.current_attempt_id,head.current_fencing_token,head.recovery_epoch
      FROM kcml.platform_recovery_attempt attempt JOIN kcml.platform_recovery_head head ON head.current_attempt_id=attempt.id WHERE attempt.id=$1 AND head.singleton_key=1 FOR UPDATE OF attempt,head`,[authority.attemptId])).rows[0];
    if(!row||String(row.lease_owner)!==workerId||BigInt(row.lease_fencing_token)!==authority.fencingToken||String(row.current_attempt_id)!==authority.attemptId||BigInt(row.current_fencing_token)!==authority.fencingToken||BigInt(row.recovery_epoch)!==authority.recoveryEpoch||row.state!=='RECONCILING')throw new DomainError('FENCING_TOKEN_STALE','Recovery worker no longer owns the current attempt fence',409,'RECONCILE_THEN_RETRY');
  }
}
