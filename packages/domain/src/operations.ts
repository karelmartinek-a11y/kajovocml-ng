import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseClient, DatabasePool } from '@kcml/database';
import { allocateContiguousSequence, inTransactionProfile, lockAdvisory } from '@kcml/database';
import { authorityForOperation, loadAuthorityOwnershipRegistry, loadOperationCatalog, loadRegistry, validateAuthorityOwnership, validateExposureParity, type AuthorityOwnershipRecord, type ExposureParityContract, type OperationContract, type StateMachineContract } from '@kcml/contract-pack';
import { canonicalDigest, canonicalJson, operationCommandSchema, sha256, type CanonicalJsonValue, type OperationResult } from '@kcml/schemas';
import { canonicalizeDomainError, DomainError } from './errors.js';
import { assertOperationHandlerCoverage, operationHandlerFor } from './operation-handler-catalog.js';
import { exactComponentMutationOperations, exactComponentQueryOperations, executeExactComponentMutation, executeExactComponentQuery } from './component-operations.js';
import { exactRuntimeQueryOperations, executeExactRuntimeQuery } from './runtime-operations.js';
import { lockAndVerifyPlatformRecovery, type RecoveryAuthorityHead } from './recovery-authority.js';
import { exactSecretQueryOperations, executeExactSecretQuery } from './secret-operations.js';
import { exactSelfTestQueryOperations, executeExactSelfTestQuery } from './self-test-operations.js';
import { exactMonitorMutationOperations, exactMonitorQueryOperations, executeExactMonitorMutation, executeExactMonitorQuery } from './monitor-operations.js';
import { mutationHandlerFor, queryHandlerFor, validateCanonicalOperationCommand } from './canonical-operation-handlers.js';
import { createGenerationJob } from './generation-lifecycle.js';

function requiredSourceSha(): string {
  const value = process.env.KCML_SOURCE_SHA;
  if (!value || !/^[0-9a-f]{40}$/iu.test(value)) throw new Error('KCML_SOURCE_SHA_REQUIRED');
  return value.toLowerCase();
}

type JsonObject = Record<string, unknown>;

function jsonSafe(value: unknown): CanonicalJsonValue {
  return JSON.parse(JSON.stringify(value, (_key,item)=>typeof item==='bigint'?item.toString():item)) as CanonicalJsonValue;
}

function digestBytes(digest: string): Buffer { return Buffer.from(digest.replace(/^sha256:/u,''),'hex'); }
function dbUuid(value: unknown): string | null { return typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(value)?value:null; }

function operationDomainKey(operation:OperationContract,targetId:string|null,args:JsonObject):string{
  const kind=operation.aggregateRoot.toLowerCase();
  if(targetId)return `${kind}:${targetId}`;
  if(operation.operationName==='monitor.alert.open'){
    const sourceObjectType=typeof args.sourceObjectType==='string'?args.sourceObjectType:'invalid-source-type';
    const sourceObjectId=typeof args.sourceObjectId==='string'?args.sourceObjectId:'invalid-source-id';
    const alertType=typeof args.alertType==='string'?args.alertType:'invalid-alert-type';
    const conditionDigest=typeof args.conditionDigest==='string'?args.conditionDigest:'invalid-condition-digest';
    return `${kind}:episode:${canonicalDigest(jsonSafe({sourceObjectType,sourceObjectId,alertType,conditionDigest}))}`;
  }
  const creationIdentity=typeof args.stableKey==='string'?args.stableKey:typeof args.code==='string'?args.code:operation.operationName;
  return `${kind}:create:${creationIdentity}`;
}
function permitsClosedComponentAdmission(operationName:string):boolean{return new Set(['component.suspend','component.quarantine','component.restore','component.recertify','component.deregister','component.heartbeat','component.state.report','component.activate','component.enable','component.disable','component.rollback','component.control.enable','component.control.disable','component.control.ack']).has(operationName);}
async function reserveConcurrencyClaim(client:DatabaseClient,operation:OperationContract,domainKey:string,logicalOperationId:string,ownerInstanceId:string,applicationDeploymentEpoch:bigint,recoveryEpoch:bigint):Promise<{id:string;fencingToken:bigint}>{
  await lockAdvisory(client,'CONCURRENCY_CLAIM',domainKey);
  const scopeKeyDigest=createHash('sha256').update(domainKey).digest();
  const current=(await client.query(`SELECT * FROM kcml.concurrency_claim WHERE scope_kind=$1 AND scope_key_digest=$2 FOR UPDATE`,[operation.concurrencyScope,scopeKeyDigest])).rows[0];
  if(current&&!current.released_at)throw new DomainError(new Date(current.expires_at).getTime()>Date.now()?'CONCURRENCY_CLAIM_BUSY':'CONCURRENCY_CLAIM_RECOVERY_REQUIRED','A nonterminal concurrency claim cannot be stolen by a new logical operation',409,'RECONCILE_THEN_RETRY',{scope:operation.concurrencyScope,domainKey,ownerLogicalOperationId:current.logical_operation_id,expiresAt:current.expires_at,fencingToken:String(current.fencing_token)});
  const fencingToken=BigInt(current?.fencing_token??0)+1n;
  const id=current?.id??randomUUID();
  if(current)await client.query(`UPDATE kcml.concurrency_claim SET scope_key=$2,logical_operation_id=$3,owner_instance_id=$4,fencing_token=$5,acquired_at=clock_timestamp(),heartbeat_at=clock_timestamp(),expires_at=clock_timestamp()+interval '5 minutes',released_at=NULL,state_version=state_version+1,platform_incarnation_id=$4,application_deployment_epoch=$6,recovery_epoch=$7 WHERE id=$1`,[id,domainKey,logicalOperationId,ownerInstanceId,fencingToken.toString(),applicationDeploymentEpoch.toString(),recoveryEpoch.toString()]);
  else await client.query(`INSERT INTO kcml.concurrency_claim(id,scope_kind,scope_key,scope_key_digest,logical_operation_id,owner_instance_id,fencing_token,acquired_at,heartbeat_at,expires_at,platform_incarnation_id,application_deployment_epoch,recovery_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '5 minutes',$6,$8,$9)`,[id,operation.concurrencyScope,domainKey,scopeKeyDigest,logicalOperationId,ownerInstanceId,fencingToken.toString(),applicationDeploymentEpoch.toString(),recoveryEpoch.toString()]);
  return {id,fencingToken};
}
async function terminalizeCommandGuards(client:DatabaseClient,commandId:string,logicalOperationId:string,claimId:string|null):Promise<void>{
  const relation=(await client.query(`UPDATE kcml.domain_command_activation_domain SET state='TERMINAL',terminal_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp()
    WHERE domain_command_id=$1 AND state<>'TERMINAL' RETURNING activation_domain_id`,[commandId])).rows[0];
  if(relation)await client.query(`UPDATE kcml.activation_domain_head SET pending_mutating_operation_count=pending_mutating_operation_count-1,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND pending_mutating_operation_count>0`,[relation.activation_domain_id]);
  if(claimId)await client.query(`UPDATE kcml.concurrency_claim SET released_at=clock_timestamp(),heartbeat_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1 AND logical_operation_id=$2 AND released_at IS NULL`,[claimId,logicalOperationId]);
}

const SAFE_ENTITY = /^[a-z][a-z0-9_]*$/u;
function entityTable(entity:string):string{if(!SAFE_ENTITY.test(entity))throw new DomainError('OPERATION_ENTITY_INVALID',`Invalid handler entity ${entity}`,500);return `"${entity}"`;}
async function entityColumns(client:DatabaseClient|DatabasePool,entity:string):Promise<Set<string>>{const result=await client.query(`SELECT a.attname AS name FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='kcml' AND c.relname=$1 AND a.attnum>0 AND NOT a.attisdropped`,[entity]);if(!result.rows.length)throw new DomainError('OPERATION_ENTITY_STORAGE_MISSING',`Physical SSOT table kcml.${entity} is missing`,503,'DO_NOT_RETRY');return new Set(result.rows.map(row=>String(row.name)));}
async function entityRowForUpdate(client:DatabaseClient,entity:string,targetId:string):Promise<Record<string,unknown>|null>{const table=entityTable(entity);const columns=await entityColumns(client,entity);const predicate=columns.has('id')?'t.id::text=$1':columns.has('stable_key')?'t.stable_key=$1':null;if(!predicate)throw new DomainError('OPERATION_ENTITY_NOT_ADDRESSABLE',`${entity} has no addressable identity`,500,'DO_NOT_RETRY');const result=await client.query(`SELECT to_jsonb(t) AS row FROM kcml.${table} t WHERE ${predicate} FOR UPDATE`,[targetId]);return result.rows[0]?.row??null;}
function workerAggregateEntity(operationName:string):string{const handler=operationHandlerFor(operationName);return operationName==='component.revision.publish'?'component':handler.entity;}
async function lockWorkerAggregate(client:DatabaseClient,row:any):Promise<void>{
  if(!row.target_id)return;
  const entity=workerAggregateEntity(String(row.operation_name));
  const aggregate=await entityRowForUpdate(client,entity,String(row.target_id));
  if(!aggregate)throw new DomainError('TARGET_NOT_FOUND',`${entity} target does not exist`,404,'DO_NOT_RETRY');
}
async function verifyWorkerClaimAndAdmission(client:DatabaseClient,row:any,allowedAdmissionStates:readonly string[]=['ADMITTED'],heartbeatClaim=true):Promise<void>{
  const admissionIdentity=(await client.query(`SELECT id,activation_domain_id,pinned_activation_epoch,state FROM kcml.domain_command_activation_domain WHERE domain_command_id=$1`,[row.command_id])).rows[0];
  if(!admissionIdentity)throw new DomainError('ACTIVATION_DOMAIN_ADMISSION_MISSING','Command has no activation-domain admission',409,'RECONCILE_THEN_RETRY');
  const head=(await client.query(`SELECT * FROM kcml.activation_domain_head WHERE id=$1 FOR UPDATE`,[admissionIdentity.activation_domain_id])).rows[0];
  if(!head)throw new DomainError('ACTIVATION_DOMAIN_HEAD_MISSING','Command activation-domain head is missing',409,'RECONCILE_THEN_RETRY');
  await lockWorkerAggregate(client,row);
  const claim=(await client.query(`SELECT * FROM kcml.concurrency_claim WHERE id=$1 FOR UPDATE`,[row.concurrency_claim_id])).rows[0];
  const claimLineageCurrent=claim&&String(claim.platform_incarnation_id)===String(row.platform_incarnation_id)&&BigInt(claim.application_deployment_epoch)===BigInt(row.application_deployment_epoch)&&BigInt(claim.recovery_epoch)===BigInt(row.recovery_epoch);
  if(!claim||claim.released_at||!claimLineageCurrent||String(claim.logical_operation_id)!==String(row.logical_operation_id)||BigInt(claim.fencing_token)!==BigInt(row.concurrency_fencing_token))throw new DomainError('CONCURRENCY_FENCE_LOST','Worker no longer owns the current aggregate concurrency fence and lineage',409,'RECONCILE_THEN_RETRY');
  const admission=(await client.query(`SELECT * FROM kcml.domain_command_activation_domain WHERE id=$1 FOR UPDATE`,[admissionIdentity.id])).rows[0];
  const activationCurrent=admission&&BigInt(admission.pinned_activation_epoch)===BigInt(head.current_activation_epoch)&&BigInt(admission.pinned_activation_epoch)===BigInt(row.activation_epoch);
  if(!admission||!allowedAdmissionStates.includes(String(admission.state))||!activationCurrent)throw new DomainError('ACTIVATION_DOMAIN_ADMISSION_STALE','Command activation-domain admission or pinned activation epoch is not current',409,'RECONCILE_THEN_RETRY',{state:admission?.state??null,allowedAdmissionStates,pinnedActivationEpoch:admission?.pinned_activation_epoch??null,currentActivationEpoch:head.current_activation_epoch});
  if(heartbeatClaim)await client.query(`UPDATE kcml.concurrency_claim SET heartbeat_at=clock_timestamp(),expires_at=clock_timestamp()+interval '5 minutes',state_version=state_version+1 WHERE id=$1 AND fencing_token=$2 AND recovery_epoch=$3`,[claim.id,claim.fencing_token,claim.recovery_epoch]);
}
async function checkpointRecoveryAuthorized(client:DatabaseClient,row:any,checkpoint:any):Promise<boolean>{
  if(String(checkpoint.logical_operation_id)!==String(row.logical_operation_id)||String(checkpoint.concurrency_claim_id)!==String(row.concurrency_claim_id)||BigInt(checkpoint.concurrency_fencing_token)>BigInt(row.concurrency_fencing_token))return false;
  if(BigInt(checkpoint.recovery_epoch)===BigInt(row.recovery_epoch))return true;
  const recoveryItem=(await client.query(`SELECT item.id FROM kcml.platform_recovery_head head JOIN kcml.platform_recovery_item item ON item.recovery_attempt_id=head.current_attempt_id
    WHERE head.singleton_key=1 AND head.state='READY' AND head.recovery_epoch=$1 AND item.owner_kind='DOMAIN_COMMAND' AND item.owner_id=$2 AND item.classification='TERMINAL_REPLAY' AND item.blocking=false`,[row.recovery_epoch,String(row.command_id)])).rows[0];
  return Boolean(recoveryItem);
}

export interface CommandContext { callerFingerprint:string; actorId:string; correlationId:string; causationId?:string|null; idempotencyKey?:string|null; recoveryFence?:{recoveryEpoch:bigint;fencingToken:bigint}; }

export class OperationCatalogService {
  readonly #byName = new Map<string, OperationContract>();
  private constructor(readonly operations: readonly OperationContract[], readonly authorities: readonly AuthorityOwnershipRecord[]) { for(const operation of operations)this.#byName.set(operation.operationName,operation); }
  public static async load(repositoryRoot=process.cwd()):Promise<OperationCatalogService>{const [catalog,authorityRegistry,stateMachineRegistry,exposureRegistry]=await Promise.all([loadOperationCatalog(repositoryRoot),loadAuthorityOwnershipRegistry(repositoryRoot),loadRegistry<StateMachineContract>('STATE_MACHINE_REGISTRY',repositoryRoot),loadRegistry<ExposureParityContract>('EXPOSURE_PARITY_REGISTRY',repositoryRoot)]);assertOperationHandlerCoverage(catalog.records);validateAuthorityOwnership(catalog.records,authorityRegistry.records,stateMachineRegistry.records);validateExposureParity(catalog.records,exposureRegistry.records);return new OperationCatalogService(catalog.records,authorityRegistry.records);}
  public get(name:string):OperationContract{const operation=this.#byName.get(name);if(!operation)throw new DomainError('OPERATION_NOT_FOUND',`Unknown operation ${name}`,404);return operation;}
  public authorityFor(operation:OperationContract):AuthorityOwnershipRecord{return authorityForOperation(operation.operationId,this.authorities);}
  public publicView():unknown[]{return this.operations.map(({operationName,operationId,operationRevision,operationFamily,exposureClass,sideEffectClass,retryClass,canonicalDigest,expectedStateVersionPolicy,idempotencyKeySource})=>({operationName,operationId,operationRevision,operationFamily,exposureClass,sideEffectClass,retryClass,canonicalDigest,expectedStateVersionPolicy,idempotencyKeySource}));}
}

export class CanonicalOperationService {
  public constructor(private readonly pool:DatabasePool,readonly catalog:OperationCatalogService){}

  public async execute(operationName:string,commandInput:unknown,context:CommandContext):Promise<OperationResult>{
    const operation=this.catalog.get(operationName);
    this.catalog.authorityFor(operation);
    const command=operationCommandSchema.parse({...((commandInput??{}) as object),operation:operationName});
    validateCanonicalOperationCommand(operation, command.targetId, command.arguments);
    if(command.deadlineAt&&new Date(command.deadlineAt)<=new Date())throw new DomainError('DEADLINE_EXCEEDED','The absolute command deadline has elapsed',408);
    if(operation.sideEffectClass==='READ_ONLY'||operation.exposureClass==='OWNER_QUERY')return this.executeQuery(operation,command.targetId,command.arguments,context);
    if(!context.idempotencyKey)throw new DomainError('IDEMPOTENCY_KEY_REQUIRED','Idempotency-Key is required for mutating operations',400);
    const safeCommand=jsonSafe({...command,expectedStateVersion:command.expectedStateVersion?.toString()??null,expectedActivationEpoch:command.expectedActivationEpoch?.toString()??null});
    const requestBytes=Buffer.from(canonicalJson(safeCommand));
    const requestDigest=digestBytes(sha256(requestBytes));
    const logicalOperationId=randomUUID();
    const commandId=randomUUID();
    const scopeText=`${context.callerFingerprint}\u0000${operationName}\u0000${command.targetId??'none'}`;
    const scopeDigest=createHash('sha256').update(scopeText).digest();
    const keyDigest=createHash('sha256').update(context.idempotencyKey).digest();

    return inTransactionProfile(this.pool,'ONLINE_MUTATION',async(client)=>{
      await lockAdvisory(client,'IDEMPOTENCY_SCOPE',`${scopeDigest.toString('hex')}:${keyDigest.toString('hex')}`);
      const recoveryHead=await lockAndVerifyPlatformRecovery(client);
      if(context.recoveryFence && (context.recoveryFence.recoveryEpoch!==BigInt(recoveryHead.recovery_epoch)||context.recoveryFence.fencingToken!==BigInt(recoveryHead.recovery_fencing_token)))throw new DomainError('RECOVERY_FENCE_LOST','Recovery action was not admitted with the current recovery fence',409,'RECONCILE_THEN_RETRY');
      const activationResult=await client.query(`SELECT current_epoch AS activation_epoch FROM kcml.activation_head WHERE singleton_key=1 FOR SHARE`);
      const heads={...recoveryHead,activation_epoch:activationResult.rows[0]?.activation_epoch};
      if(heads.activation_epoch===undefined)throw new DomainError('AUTHORITY_HEADS_MISSING','Activation authority head is missing',503,'RETRY_SAME_OPERATION');

      const claimed=await client.query(`INSERT INTO kcml.domain_idempotency_record(scope_digest,key_digest,canonical_key,request_digest,logical_operation_id,command_id,lifecycle,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,'RESERVED',clock_timestamp()+interval '30 days')
        ON CONFLICT (scope_digest,key_digest) DO NOTHING RETURNING id`,[scopeDigest,keyDigest,context.idempotencyKey,requestDigest,logicalOperationId,commandId]);
      const replay=await client.query(`SELECT * FROM kcml.domain_idempotency_record WHERE scope_digest=$1 AND key_digest=$2 FOR UPDATE`,[scopeDigest,keyDigest]);
      const idempotency=replay.rows[0];
      if(!idempotency)throw new DomainError('IDEMPOTENCY_CLAIM_FAILED','Idempotency claim could not be locked',500);
      if(!Buffer.from(idempotency.request_digest).equals(requestDigest))throw new DomainError('IDEMPOTENCY_CONFLICT','Idempotency key was used with a different request',409,'DO_NOT_RETRY');
      if(claimed.rowCount===0){
        if(idempotency.response_body)return {...idempotency.response_body,metadata:{...idempotency.response_body.metadata,idempotencyReplay:true}} as OperationResult;
        return this.acceptedResult(String(idempotency.command_id),String(idempotency.logical_operation_id),context.correlationId,0n,0n,BigInt(heads.activation_epoch),true,{commandId:idempotency.command_id,status:'ACCEPTED'});
      }

      if(command.expectedActivationEpoch!==null&&command.expectedActivationEpoch!==BigInt(heads.activation_epoch))throw new DomainError('ACTIVATION_EPOCH_CONFLICT','Activation epoch changed',409,'REFRESH_AND_RETRY_NEW_COMMAND');
      const domainKey=operationDomainKey(operation,command.targetId,command.arguments);
      await lockAdvisory(client,'ACTIVATION_DOMAIN',domainKey);
      await client.query(`INSERT INTO kcml.activation_domain_head(domain_key,current_activation_epoch,barrier_state,pending_mutating_operation_count,platform_incarnation_id,application_deployment_epoch,recovery_epoch)
        VALUES($1,$2,'OPEN',0,$3,$4,$5) ON CONFLICT(domain_key) DO NOTHING`,[domainKey,heads.activation_epoch,heads.platform_incarnation_id,heads.current_epoch,heads.recovery_epoch]);
      const domainHead=(await client.query(`SELECT * FROM kcml.activation_domain_head WHERE domain_key=$1 FOR UPDATE`,[domainKey])).rows[0];
      if(!domainHead)throw new DomainError('ACTIVATION_DOMAIN_HEAD_MISSING','Activation domain head could not be reserved',500,'DO_NOT_RETRY');
      if(domainHead.barrier_state!=='OPEN'&&!permitsClosedComponentAdmission(operationName))throw new DomainError('ACTIVATION_DOMAIN_CLOSED','Mutating admission is closed for this activation domain',409,'RETRY_SAME_OPERATION',{domainKey,barrierState:domainHead.barrier_state});
      if(command.targetId&&command.expectedStateVersion!==null){
        const handler=operationHandlerFor(operationName);
        const admissionEntity=operationName==='component.revision.publish'?'component':handler.entity;
        const target=await entityRowForUpdate(client,admissionEntity,command.targetId);
        if(!target)throw new DomainError('TARGET_NOT_FOUND','Target does not exist',404,'DO_NOT_RETRY');
        if(target.state_version!==undefined&&BigInt(String(target.state_version))!==command.expectedStateVersion)throw new DomainError('STATE_VERSION_CONFLICT','Target state changed',409,'REFRESH_AND_RETRY_NEW_COMMAND');
      }
      const concurrencyClaim=await reserveConcurrencyClaim(client,operation,domainKey,logicalOperationId,heads.platform_incarnation_id,BigInt(heads.current_epoch),BigInt(heads.recovery_epoch));

      await client.query(`INSERT INTO kcml.domain_command(id,logical_operation_id,operation_name,operation_revision,target_id,caller_fingerprint,request_canonical_bytes,request,request_digest,expected_state_version,expected_activation_epoch,status,correlation_id,causation_id,deadline_at,activation_epoch,platform_incarnation_id,application_deployment_epoch,recovery_epoch,concurrency_claim_id,concurrency_fencing_token)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'ACCEPTED',$12,$13,$14,$15,$16,$17,$18,$19,$20)`,[commandId,logicalOperationId,operationName,operation.operationRevision,command.targetId,context.callerFingerprint,requestBytes,safeCommand,requestDigest,command.expectedStateVersion?.toString(),command.expectedActivationEpoch?.toString(),context.correlationId,context.causationId??null,command.deadlineAt,heads.activation_epoch,heads.platform_incarnation_id,heads.current_epoch,heads.recovery_epoch,concurrencyClaim.id,concurrencyClaim.fencingToken.toString()]);
      const admissionPayload={commandId,activationDomainId:domainHead.id,pinnedActivationEpoch:String(domainHead.current_activation_epoch),operationClass:'MUTATING'};const admissionDigest=digestBytes(canonicalDigest(jsonSafe(admissionPayload)));
      await client.query(`INSERT INTO kcml.domain_command_activation_domain(stable_key,display_name,domain_command_id,activation_domain_id,pinned_activation_epoch,operation_class,state,admitted_at,evidence_digest,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
        VALUES($1,$2,$3,$4,$5,'MUTATING','ADMITTED',clock_timestamp(),$6,$6,$7,$8,$5,$9,$10)`,[`admission:${commandId}`,operationName,commandId,domainHead.id,domainHead.current_activation_epoch,admissionDigest,logicalOperationId,context.correlationId,heads.platform_incarnation_id,heads.current_epoch]);
      await client.query(`UPDATE kcml.activation_domain_head SET pending_mutating_operation_count=pending_mutating_operation_count+1,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`,[domainHead.id]);
      await client.query(`INSERT INTO kcml.queue_item(queue_name,partition_key,command_id,payload,platform_incarnation_id,application_deployment_epoch,recovery_epoch,concurrency_claim_id,concurrency_fencing_token)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[queueFor(operation),command.targetId??operation.operationFamily,commandId,{commandId,operationName},heads.platform_incarnation_id,heads.current_epoch,heads.recovery_epoch,concurrencyClaim.id,concurrencyClaim.fencingToken.toString()]);
      const eventPayload={commandId,logicalOperationId,operationName,targetId:command.targetId};
      const sequence=await nextStreamSequence(client,`command:${commandId}`);
      await client.query(`INSERT INTO kcml.transactional_outbox(stream_key,stream_sequence,purpose,event_type,aggregate_id,payload,payload_digest,recovery_epoch) VALUES($1,$2,'DOMAIN_EVENT',$3,$4,$5,$6,$7)`,[`command:${commandId}`,sequence.toString(),'domain.command.accepted',command.targetId,eventPayload,digestBytes(canonicalDigest(jsonSafe(eventPayload))),heads.recovery_epoch]);
      const response=this.acceptedResult(commandId,logicalOperationId,context.correlationId,0n,sequence,BigInt(heads.activation_epoch),false,{commandId,status:'ACCEPTED'});
      const safeResponse=jsonSafe(response);const responseDigest=digestBytes(canonicalDigest(safeResponse));
      await client.query(`UPDATE kcml.domain_idempotency_record SET lifecycle='EXECUTING',response_status=202,response_body=$2,response_digest=$3,updated_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1`,[idempotency.id,safeResponse,responseDigest]);
      await audit(client,'domain.command.accepted',context.actorId,'DOMAIN_COMMAND',commandId,context.correlationId,context.causationId??null,eventPayload);
      return response;
    });
  }

  private async executeQuery(operation:OperationContract,targetId:string|null,args:JsonObject,context:CommandContext):Promise<OperationResult>{
    let result:unknown;
    if(exactComponentQueryOperations.has(operation.operationName))result=await executeExactComponentQuery(this.pool,operation.operationName,targetId,args);
    else if(exactRuntimeQueryOperations.has(operation.operationName))result=await executeExactRuntimeQuery(this.pool,operation.operationName,targetId,args);
    else if(exactSecretQueryOperations.has(operation.operationName))result=await executeExactSecretQuery(this.pool,operation.operationName,targetId,args);
    else if(exactSelfTestQueryOperations.has(operation.operationName))result=await executeExactSelfTestQuery(this.pool,operation.operationName,targetId,args);
    else if(exactMonitorQueryOperations.has(operation.operationName))result=await executeExactMonitorQuery(this.pool,operation.operationName,targetId,args);
    else if(operation.operationName==='audit.integrity.verify')result=await verifyAuditChain(this.pool);
    else result=await queryHandlerFor(operation)(this.pool,{operation,targetId,arguments:args});
    return this.acceptedResult(randomUUID(),randomUUID(),context.correlationId,0n,0n,await currentActivationEpoch(this.pool),false,result,'SUCCEEDED');
  }

  private acceptedResult(commandId:string,logicalOperationId:string,correlationId:string,stateVersion:bigint,eventSequence:bigint,activationEpoch:bigint,idempotencyReplay:boolean,result:unknown,status:'ACCEPTED'|'SUCCEEDED'='ACCEPTED'):OperationResult{
    const safeResult=jsonSafe(result);
    return {status,metadata:{correlationId,logicalOperationId,commandId,stateVersion,eventSequence,activationEpoch,resultDigest:canonicalDigest(safeResult),idempotencyReplay,serverTime:new Date().toISOString()},result,error:null};
  }
}

function queueFor(operation:OperationContract):string{return operationHandlerFor(operation.operationName).queue;}
async function verifyAuditChain(pool:DatabasePool):Promise<{valid:true;eventCount:number;lastSequence:string;lastHash:string}>{
  const events=await pool.query(`SELECT chain_sequence,event_type,payload_canonical_bytes,payload_digest,previous_hash,event_hash FROM kcml.audit_event ORDER BY chain_sequence`);
  const headResult=await pool.query(`SELECT last_sequence,last_hash FROM kcml.audit_head WHERE singleton_key=1`);
  const head=headResult.rows[0];
  if(!head)throw new DomainError('AUDIT_HEAD_MISSING','Audit head is missing',503,'DO_NOT_RETRY');
  let previous=Buffer.alloc(32);
  let expectedSequence=1n;
  for(const event of events.rows){
    const sequence=BigInt(event.chain_sequence);
    if(sequence!==expectedSequence)throw new DomainError('AUDIT_SEQUENCE_GAP',`Expected audit sequence ${expectedSequence} but found ${sequence}`,409,'DO_NOT_RETRY');
    const storedPrevious=Buffer.from(event.previous_hash);
    if(!storedPrevious.equals(previous))throw new DomainError('AUDIT_PREVIOUS_HASH_MISMATCH',`Audit chain predecessor mismatch at ${sequence}`,409,'DO_NOT_RETRY');
    const payloadDigest=createHash('sha256').update(Buffer.from(event.payload_canonical_bytes)).digest();
    if(!payloadDigest.equals(Buffer.from(event.payload_digest)))throw new DomainError('AUDIT_PAYLOAD_DIGEST_MISMATCH',`Audit payload digest mismatch at ${sequence}`,409,'DO_NOT_RETRY');
    const sequenceBytes=Buffer.alloc(8); sequenceBytes.writeBigInt64BE(sequence);
    const calculated=createHash('sha256').update(Buffer.concat([previous,sequenceBytes,Buffer.from(String(event.event_type),'utf8'),payloadDigest])).digest();
    if(!calculated.equals(Buffer.from(event.event_hash)))throw new DomainError('AUDIT_EVENT_HASH_MISMATCH',`Audit event hash mismatch at ${sequence}`,409,'DO_NOT_RETRY');
    previous=calculated; expectedSequence+=1n;
  }
  const lastSequence=expectedSequence-1n;
  if(BigInt(head.last_sequence)!==lastSequence||!Buffer.from(head.last_hash).equals(previous))throw new DomainError('AUDIT_HEAD_MISMATCH','Audit head does not match the terminal chain event',409,'DO_NOT_RETRY');
  return {valid:true,eventCount:events.rows.length,lastSequence:lastSequence.toString(),lastHash:previous.toString('hex')};
}
async function currentActivationEpoch(pool:DatabasePool):Promise<bigint>{const result=await pool.query(`SELECT current_epoch FROM kcml.activation_head WHERE singleton_key=1`);return BigInt(result.rows[0].current_epoch);}
async function nextStreamSequence(client:DatabaseClient,stream:string):Promise<bigint>{const commandId=stream.startsWith('command:')?stream.slice('command:'.length):stream;if(!/^[0-9a-f-]{36}$/iu.test(commandId))throw new DomainError('OUTBOX_STREAM_PARENT_INVALID','Authoritative outbox stream must be UUID-addressable',500);return allocateContiguousSequence(client,'TRANSACTIONAL_OUTBOX',commandId,'STREAM_SEQUENCE');}
async function audit(client:DatabaseClient,eventType:string,actorId:string,aggregateType:string,aggregateId:string,correlationId:string,causationId:string|null,payload:JsonObject):Promise<void>{const bytes=Buffer.from(canonicalJson(jsonSafe(payload)));await client.query(`SELECT * FROM kcml.append_audit_event($1,'OWNER',$2,$3,$4,$5,$6,$7,$8)`,[eventType,actorId,aggregateType,aggregateId,correlationId,causationId,payload,bytes]);}

export type WorkerFaultPoint='AFTER_COMMAND_CHECKPOINT_BEFORE_TERMINAL';
export interface WorkerOptions {queueNames:readonly string[];workerId:string;leaseSeconds?:number;faultInjector?:(point:WorkerFaultPoint,context:Readonly<{commandId:string;logicalOperationId:string;operationName:string}>)=>void|Promise<void>;}

export class CanonicalCommandWorker {
  public constructor(private readonly pool:DatabasePool,private readonly catalog:OperationCatalogService,private readonly options:WorkerOptions){}
  public async runOnce():Promise<boolean>{
    const claim=await inTransactionProfile(this.pool,'WORKER_COMMIT',async(client)=>{
      const recoveryHead=await lockAndVerifyPlatformRecovery(client);
      const candidateResult=await client.query(`SELECT q.id,q.command_id FROM kcml.queue_item q JOIN kcml.domain_command c ON c.id=q.command_id
        WHERE q.queue_name=ANY($1) AND q.available_at<=clock_timestamp()
          AND (q.status='READY' OR (q.status='CLAIMED' AND q.lease_expires_at<=clock_timestamp()))
          AND q.platform_incarnation_id=$2 AND q.application_deployment_epoch=$3 AND q.recovery_epoch=$4
          AND c.platform_incarnation_id=$2 AND c.application_deployment_epoch=$3 AND c.recovery_epoch=$4
        ORDER BY q.priority,q.available_at,q.id LIMIT 1`,[this.options.queueNames,recoveryHead.platform_incarnation_id,recoveryHead.current_epoch,recoveryHead.recovery_epoch]);const candidate=candidateResult.rows[0];if(!candidate)return null;
      const guard=(await client.query(`SELECT relation.id AS admission_id,relation.activation_domain_id,relation.state AS admission_state,c.operation_name,c.target_id,c.logical_operation_id,c.concurrency_claim_id,c.concurrency_fencing_token,c.activation_epoch
        FROM kcml.domain_command c JOIN kcml.domain_command_activation_domain relation ON relation.domain_command_id=c.id WHERE c.id=$1`,[candidate.command_id])).rows[0];if(!guard)return null;
      await client.query(`SELECT id FROM kcml.activation_domain_head WHERE id=$1 FOR UPDATE`,[guard.activation_domain_id]);
      await lockWorkerAggregate(client,guard);
      const concurrencyClaim=(await client.query(`SELECT * FROM kcml.concurrency_claim WHERE id=$1 FOR UPDATE`,[guard.concurrency_claim_id])).rows[0];
      const claimCurrent=concurrencyClaim&&!concurrencyClaim.released_at&&String(concurrencyClaim.logical_operation_id)===String(guard.logical_operation_id)&&BigInt(concurrencyClaim.fencing_token)===BigInt(guard.concurrency_fencing_token)&&String(concurrencyClaim.platform_incarnation_id)===recoveryHead.platform_incarnation_id&&BigInt(concurrencyClaim.application_deployment_epoch)===BigInt(recoveryHead.current_epoch)&&BigInt(concurrencyClaim.recovery_epoch)===BigInt(recoveryHead.recovery_epoch);
      if(!claimCurrent)return null;
      const admission=(await client.query(`SELECT * FROM kcml.domain_command_activation_domain WHERE id=$1 FOR UPDATE`,[guard.admission_id])).rows[0];
      const checkpointExists=Number((await client.query(`SELECT count(*)::int AS count FROM kcml.domain_command_execution_checkpoint WHERE command_id=$1`,[candidate.command_id])).rows[0]?.count??0)===1;
      if(!admission||(admission.state!=='ADMITTED'&&!(admission.state==='TERMINAL'&&checkpointExists)))return null;
      const row=(await client.query(`SELECT q.*,c.operation_name,c.request,c.correlation_id,c.target_id,c.logical_operation_id,c.activation_epoch,c.state_version AS command_state_version,c.concurrency_fencing_token AS command_concurrency_fencing_token,
          c.platform_incarnation_id AS command_platform_incarnation_id,c.application_deployment_epoch AS command_application_deployment_epoch,c.recovery_epoch AS command_recovery_epoch
        FROM kcml.queue_item q JOIN kcml.domain_command c ON c.id=q.command_id WHERE q.id=$1 FOR UPDATE OF q`,[candidate.id])).rows[0];if(!row)return null;
      const queueClaimable=row.status==='READY'||(row.status==='CLAIMED'&&row.lease_expires_at&&new Date(row.lease_expires_at).getTime()<=Date.now());
      const queueFenceCurrent=BigInt(row.concurrency_fencing_token)===BigInt(concurrencyClaim.fencing_token)&&BigInt(row.command_concurrency_fencing_token)===BigInt(concurrencyClaim.fencing_token);
      if(!queueClaimable||!queueFenceCurrent)return null;
      const claimToken=BigInt(concurrencyClaim.fencing_token)+1n;const leaseToken=BigInt(row.lease_fencing_token)+1n;
      const claimUpdate=await client.query(`UPDATE kcml.concurrency_claim SET owner_instance_id=$2,fencing_token=$3,heartbeat_at=clock_timestamp(),expires_at=clock_timestamp()+interval '5 minutes',state_version=state_version+1
        WHERE id=$1 AND logical_operation_id=$4 AND fencing_token=$5 AND recovery_epoch=$6 AND released_at IS NULL`,[concurrencyClaim.id,this.options.workerId,claimToken.toString(),row.logical_operation_id,concurrencyClaim.fencing_token,recoveryHead.recovery_epoch]);
      if(claimUpdate.rowCount!==1)return null;
      const queueUpdate=await client.query(`UPDATE kcml.queue_item SET status='CLAIMED',lease_owner=$2,lease_fencing_token=$3,lease_expires_at=clock_timestamp()+make_interval(secs=>$4),attempt_count=attempt_count+1,concurrency_fencing_token=$5,state_version=state_version+1,updated_at=clock_timestamp()
        WHERE id=$1 AND recovery_epoch=$6`,[row.id,this.options.workerId,leaseToken.toString(),this.options.leaseSeconds??60,claimToken.toString(),recoveryHead.recovery_epoch]);
      const commandUpdate=await client.query(`UPDATE kcml.domain_command SET status='RUNNING',concurrency_fencing_token=$2,state_version=state_version+1 WHERE id=$1 AND recovery_epoch=$3 AND status IN ('ACCEPTED','RUNNING')`,[row.command_id,claimToken.toString(),recoveryHead.recovery_epoch]);
      if(queueUpdate.rowCount!==1||commandUpdate.rowCount!==1)throw new DomainError('WORKER_CLAIM_CAS_FAILED','Worker claim could not atomically advance queue and command fences',409,'RECONCILE_THEN_RETRY');
      return {...row,lease_owner:this.options.workerId,lease_fencing_token:leaseToken,concurrency_fencing_token:claimToken};
    });
    if(!claim)return false;
    let output:unknown;
    try{output=await this.applyCommand(claim);}
    catch(error){await this.fail(claim,error);return true;}
    await this.options.faultInjector?.('AFTER_COMMAND_CHECKPOINT_BEFORE_TERMINAL',{commandId:String(claim.command_id),logicalOperationId:String(claim.logical_operation_id),operationName:String(claim.operation_name)});
    await this.complete(claim,output);
    return true;
  }

  private async applyCommand(row:any):Promise<unknown>{
    const operation=this.catalog.get(row.operation_name);this.catalog.authorityFor(operation);const handler=operationHandlerFor(operation.operationName);const args=(row.request.arguments??{}) as JsonObject;
    if(row.queue_name!==handler.queue)throw new DomainError('OPERATION_QUEUE_BINDING_MISMATCH',`${operation.operationName} was delivered on ${row.queue_name}, expected ${handler.queue}`,409,'DO_NOT_RETRY');
    if(handler.strategy==='CONSISTENT_QUERY')throw new DomainError('READ_OPERATION_QUEUED',`${operation.operationName} must execute on the consistent-read path`,409,'DO_NOT_RETRY');
    return this.applyInCommandTransaction(row,async(client,head)=>{
      if(operation.operationName==='generation.job.create')return createGenerationJob(client,args,{platformIncarnationId:head.platform_incarnation_id,applicationDeploymentEpoch:BigInt(head.current_epoch),logicalOperationId:row.logical_operation_id,correlationId:row.correlation_id});
      if(operation.operationName==='browser.session.create')return this.createBrowserSession(client,head,args,row);
      if(operation.operationName==='selfTest.run.start')return this.createTestRun(client,head,args,row);
      if(exactMonitorMutationOperations.has(operation.operationName))return executeExactMonitorMutation(client,{
        operationName:operation.operationName,targetId:row.target_id,arguments:args,
        expectedStateVersion:row.request.expectedStateVersion===null||row.request.expectedStateVersion===undefined?null:BigInt(row.request.expectedStateVersion),
        logicalOperationId:row.logical_operation_id,correlationId:row.correlation_id,activationEpoch:BigInt(row.activation_epoch),platformIncarnationId:head.platform_incarnation_id,
        applicationDeploymentEpoch:BigInt(head.current_epoch),recoveryEpoch:BigInt(head.recovery_epoch)
      });
      if(exactComponentMutationOperations.has(operation.operationName))return executeExactComponentMutation(client,{
        operationName:operation.operationName,targetId:row.target_id,arguments:args,
        expectedStateVersion:row.request.expectedStateVersion===null||row.request.expectedStateVersion===undefined?null:BigInt(row.request.expectedStateVersion),
        logicalOperationId:row.logical_operation_id,correlationId:row.correlation_id,platformIncarnationId:head.platform_incarnation_id,applicationDeploymentEpoch:BigInt(head.current_epoch)
      });
      return mutationHandlerFor(operation)(client,{
        operation,
        commandId: row.command_id,
        targetId:row.target_id,
        arguments:args,
        logicalOperationId:row.logical_operation_id,
        correlationId:row.correlation_id,
        expectedStateVersion:row.request.expectedStateVersion===null||row.request.expectedStateVersion===undefined?null:BigInt(row.request.expectedStateVersion),
        activationEpoch:BigInt(row.activation_epoch),
        platformIncarnationId:head.platform_incarnation_id,
        applicationDeploymentEpoch:BigInt(head.current_epoch),
        recoveryEpoch:BigInt(head.recovery_epoch)
      });
    });
  }

  private async applyInCommandTransaction(row:any,apply:(client:DatabaseClient,head:RecoveryAuthorityHead)=>Promise<unknown>):Promise<unknown>{
    return inTransactionProfile(this.pool,'WORKER_COMMIT',async(client)=>{
      const head=await lockAndVerifyPlatformRecovery(client);
      if(BigInt(row.recovery_epoch)!==BigInt(head.recovery_epoch))throw new DomainError('STALE_RECOVERY_EPOCH','Worker command recovery epoch is stale',409,'RECONCILE_THEN_RETRY');
      const checkpoint=(await client.query(`SELECT * FROM kcml.domain_command_execution_checkpoint WHERE command_id=$1`,[row.command_id])).rows[0];
      await verifyWorkerClaimAndAdmission(client,row,checkpoint?['ADMITTED','TERMINAL']:['ADMITTED']);
      if(checkpoint){
        if(!await checkpointRecoveryAuthorized(client,row,checkpoint))throw new DomainError('COMMAND_CHECKPOINT_LINEAGE_CONFLICT','Persisted command checkpoint does not match current logical operation lineage or an exact terminal-replay recovery classification',409,'MANUAL_REVIEW');
        return checkpoint.output;
      }
      const output=await apply(client,head);const safeOutput=jsonSafe(output);
      await client.query(`INSERT INTO kcml.domain_command_execution_checkpoint(command_id,logical_operation_id,checkpoint_state,output,output_digest,concurrency_claim_id,concurrency_fencing_token,recovery_epoch,platform_incarnation_id,application_deployment_epoch)
        VALUES($1,$2,'APPLIED',$3,digest(convert_to($3::jsonb::text,'UTF8'),'sha256'),$4,$5,$6,$7,$8)`,[row.command_id,row.logical_operation_id,safeOutput,row.concurrency_claim_id,row.concurrency_fencing_token,row.recovery_epoch,head.platform_incarnation_id,head.current_epoch]);
      return safeOutput;
    });
  }

  private async createGeneration(client:DatabaseClient,head:RecoveryAuthorityHead,args:JsonObject,row:any):Promise<unknown>{return createGenerationJob(client,args,{platformIncarnationId:head.platform_incarnation_id,applicationDeploymentEpoch:BigInt(head.current_epoch),logicalOperationId:row.logical_operation_id,correlationId:row.correlation_id});}
  private async createBrowserSession(client:DatabaseClient,head:RecoveryAuthorityHead,args:JsonObject,row:any):Promise<unknown>{const result=await client.query(`INSERT INTO kcml.browser_session(parent_kind,parent_id,purpose,execution_target,runtime_build_id,account_binding_id,operation_scope,current_url,platform_incarnation_id,application_deployment_epoch)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)RETURNING *`,[args.parentKind??'OWNER_CHAT',dbUuid(args.parentId)??row.logical_operation_id,args.purpose??'OWNER browser session',args.executionTarget??'SERVER_MANAGED',args.runtimeBuildId??process.env.KCML_BROWSER_RUNTIME_BUILD??'playwright-1.58.2',dbUuid(args.accountBindingId),args.operationScope??{},args.targetUrl??null,head.platform_incarnation_id,head.current_epoch]);return result.rows[0];}
  private async createTestRun(client:DatabaseClient,head:RecoveryAuthorityHead,args:JsonObject,_row:any):Promise<unknown>{const env=jsonSafe({releaseId:process.env.KCML_RELEASE_ID??'development',sourceSha:requiredSourceSha()});const result=await client.query(`INSERT INTO kcml.self_test_run(suite_key,run_kind,source_sha,release_id,environment_digest,seed,platform_incarnation_id,application_deployment_epoch)VALUES($1,$2,$3,$4,$5,$6,$7,$8)RETURNING *`,[args.suiteKey??'self-test',args.runKind??'SELF_TEST',requiredSourceSha(),process.env.KCML_RELEASE_ID??'development',digestBytes(canonicalDigest(env)),args.seed??null,head.platform_incarnation_id,head.current_epoch]);return result.rows[0];}
  private async complete(row:any,output:unknown):Promise<void>{await inTransactionProfile(this.pool,'WORKER_COMMIT',async(client)=>{
    const recoveryHead=await lockAndVerifyPlatformRecovery(client);if(BigInt(row.recovery_epoch)!==BigInt(recoveryHead.recovery_epoch))throw new DomainError('STALE_RECOVERY_EPOCH','Worker terminal write recovery epoch is stale',409,'RECONCILE_THEN_RETRY');
    const checkpoint=(await client.query(`SELECT * FROM kcml.domain_command_execution_checkpoint WHERE command_id=$1`,[row.command_id])).rows[0];
    if(!checkpoint||!await checkpointRecoveryAuthorized(client,row,checkpoint))throw new DomainError('COMMAND_CHECKPOINT_MISSING','Successful terminalization requires the exact immutable execution checkpoint from the same recovery epoch or an authorized terminal-replay classification',409,'RECONCILE_THEN_RETRY');
    await verifyWorkerClaimAndAdmission(client,row,['ADMITTED','TERMINAL'],false);
    const locked=await client.query(`SELECT * FROM kcml.queue_item WHERE id=$1 FOR UPDATE`,[row.id]);const current=locked.rows[0];
    if(current.status!=='CLAIMED'||current.lease_owner!==this.options.workerId||BigInt(current.lease_fencing_token)!==BigInt(row.lease_fencing_token))throw new DomainError('QUEUE_FENCE_LOST','Queue claim fence is no longer current',409,'RECONCILE_THEN_RETRY');
    const safeOutput=jsonSafe(checkpoint.output);if(canonicalDigest(safeOutput)!==canonicalDigest(jsonSafe(output)))throw new DomainError('COMMAND_CHECKPOINT_OUTPUT_CONFLICT','Worker output differs from immutable execution checkpoint',409,'MANUAL_REVIEW');const outputRecord=typeof checkpoint.output==='object'&&checkpoint.output!==null?checkpoint.output as Record<string,unknown>:{};
    const stateVersion=BigInt(String(outputRecord.state_version??0));const eventSequence=BigInt(String(outputRecord.aggregate_event_sequence??0));const activationEpoch=BigInt(String(outputRecord.current_activation_epoch??outputRecord.activation_epoch??0));
    const terminalResponse:OperationResult={status:'SUCCEEDED',metadata:{correlationId:row.correlation_id,logicalOperationId:row.logical_operation_id,commandId:row.command_id,stateVersion,eventSequence,activationEpoch,resultDigest:canonicalDigest(safeOutput),idempotencyReplay:false,serverTime:new Date().toISOString()},result:safeOutput,error:null};
    const safeTerminal=jsonSafe(terminalResponse);const terminalDigest=digestBytes(canonicalDigest(safeTerminal));
    await client.query(`UPDATE kcml.domain_command SET status='SUCCEEDED',result=$2,error=NULL,completed_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1`,[row.command_id,safeOutput]);
    await client.query(`UPDATE kcml.domain_idempotency_record SET lifecycle='SUCCEEDED',response_status=200,response_body=$2,response_digest=$3,terminal_outcome_digest=$3,completed_at=clock_timestamp(),updated_at=clock_timestamp(),state_version=state_version+1 WHERE command_id=$1`,[row.command_id,safeTerminal,terminalDigest]);
    await client.query(`UPDATE kcml.queue_item SET status='SUCCEEDED',lease_owner=NULL,lease_expires_at=NULL,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`,[row.id]);
    await terminalizeCommandGuards(client,row.command_id,row.logical_operation_id,row.concurrency_claim_id??null);
    await audit(client,'domain.command.succeeded',this.options.workerId,'DOMAIN_COMMAND',row.command_id,row.correlation_id,null,{commandId:row.command_id,operationName:row.operation_name,resultDigest:canonicalDigest(safeOutput)});
  });}
  private async fail(row:any,error:unknown):Promise<void>{const message=error instanceof Error?error.message:String(error);await inTransactionProfile(this.pool,'WORKER_COMMIT',async(client)=>{
    const recoveryHead=await lockAndVerifyPlatformRecovery(client);if(BigInt(row.recovery_epoch)!==BigInt(recoveryHead.recovery_epoch))throw new DomainError('STALE_RECOVERY_EPOCH','Worker failure write recovery epoch is stale',409,'RECONCILE_THEN_RETRY');
    const checkpointExists=Number((await client.query(`SELECT count(*)::int AS count FROM kcml.domain_command_execution_checkpoint WHERE command_id=$1`,[row.command_id])).rows[0]?.count??0)>0;
    if(checkpointExists)throw new DomainError('APPLIED_COMMAND_CANNOT_FAIL','An applied command with immutable checkpoint must resume terminal replay instead of becoming failed',409,'RECONCILE_THEN_RETRY');
    await verifyWorkerClaimAndAdmission(client,row,['ADMITTED'],false);
    const locked=await client.query(`SELECT * FROM kcml.queue_item WHERE id=$1 FOR UPDATE`,[row.id]);const current=locked.rows[0];if(!current||current.status!=='CLAIMED'||current.lease_owner!==this.options.workerId)return;
    const canonicalError = canonicalizeDomainError(error);
    // A domain handler may expose a narrower, exact contract code while the
    // transport projection is still supplied by the stable error registry.
    // Never turn its explicit DO_NOT_RETRY terminality into a retry merely
    // because the projection is conservative.
    const effectiveRetryDirective=error instanceof DomainError?error.retryDirective:canonicalError.retryDirective;
    const effectiveCode=error instanceof DomainError?error.code:canonicalError.code;
    const retry=Number(current.attempt_count)<Number(current.max_attempts)&&effectiveRetryDirective!=='DO_NOT_RETRY';
    if(retry){
      await client.query(`UPDATE kcml.queue_item SET status='READY',available_at=clock_timestamp()+make_interval(secs=>least(300,power(2,attempt_count)::int)),lease_owner=NULL,lease_expires_at=NULL,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`,[row.id]);
      await client.query(`UPDATE kcml.domain_command SET status='ACCEPTED',error=$2,state_version=state_version+1 WHERE id=$1`,[row.command_id,{code:canonicalError.code,message,classification:canonicalError.classification,sideEffectPoint:canonicalError.sideEffectPoint,retryDirective:canonicalError.retryDirective,recordDigest:canonicalError.recordDigest,details:error instanceof DomainError?error.details:null}]);
    }else{
      const failure={code:effectiveCode,message,classification:canonicalError.classification,sideEffectPoint:canonicalError.sideEffectPoint,retryDirective:effectiveRetryDirective,recordDigest:canonicalError.recordDigest,details:error instanceof DomainError?error.details:null};
      const failureDigest=canonicalDigest(jsonSafe(failure));const terminalResponse:OperationResult={status:'FAILED_FINAL',metadata:{correlationId:row.correlation_id,logicalOperationId:row.logical_operation_id,commandId:row.command_id,stateVersion:0n,eventSequence:0n,activationEpoch:0n,resultDigest:failureDigest,idempotencyReplay:false,serverTime:new Date().toISOString()},result:null,error:failure};
      const safeTerminal=jsonSafe(terminalResponse);const terminalDigest=digestBytes(canonicalDigest(safeTerminal));
      await client.query(`UPDATE kcml.queue_item SET status='FAILED_FINAL',lease_owner=NULL,lease_expires_at=NULL,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`,[row.id]);
      await client.query(`UPDATE kcml.domain_command SET status='FAILED_FINAL',error=$2,completed_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1`,[row.command_id,failure]);
      await client.query(`UPDATE kcml.domain_idempotency_record SET lifecycle='FAILED_FINAL',response_status=$2,response_body=$3,response_digest=$4,terminal_outcome_digest=$4,completed_at=clock_timestamp(),updated_at=clock_timestamp(),state_version=state_version+1 WHERE command_id=$1`,[row.command_id,canonicalError.record.httpMappings[0] ?? (error instanceof DomainError ? error.httpStatus : 500),safeTerminal,terminalDigest]);
      await terminalizeCommandGuards(client,row.command_id,row.logical_operation_id,row.concurrency_claim_id??null);
    }
  });}
}
