import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseClient, DatabasePool } from '@kcml/database';
import { allocateContiguousSequence, inTransaction, lockAdvisory } from '@kcml/database';
import { loadOperationCatalog, type OperationContract } from '@kcml/contract-pack';
import { canonicalDigest, canonicalJson, operationCommandSchema, sha256, type CanonicalJsonValue, type OperationResult } from '@kcml/schemas';
import { DomainError } from './errors.js';
import { assertOperationHandlerCoverage, operationHandlerFor } from './operation-handler-catalog.js';

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

const SAFE_ENTITY = /^[a-z][a-z0-9_]*$/u;
function entityTable(entity:string):string{if(!SAFE_ENTITY.test(entity))throw new DomainError('OPERATION_ENTITY_INVALID',`Invalid handler entity ${entity}`,500);return `"${entity}"`;}
function snakeKey(value:string):string{return value.replace(/([a-z0-9])([A-Z])/g,'$1_$2').replace(/[^a-zA-Z0-9_]+/g,'_').toLowerCase();}
async function entityColumns(client:DatabaseClient|DatabasePool,entity:string):Promise<Set<string>>{const result=await client.query(`SELECT a.attname AS name FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='kcml' AND c.relname=$1 AND a.attnum>0 AND NOT a.attisdropped`,[entity]);if(!result.rows.length)throw new DomainError('OPERATION_ENTITY_STORAGE_MISSING',`Physical SSOT table kcml.${entity} is missing`,503,'DO_NOT_RETRY');return new Set(result.rows.map(row=>String(row.name)));}
async function entityRowForUpdate(client:DatabaseClient,entity:string,targetId:string):Promise<Record<string,unknown>|null>{const table=entityTable(entity);const columns=await entityColumns(client,entity);const predicate=columns.has('id')?'t.id::text=$1':columns.has('stable_key')?'t.stable_key=$1':null;if(!predicate)throw new DomainError('OPERATION_ENTITY_NOT_ADDRESSABLE',`${entity} has no addressable identity`,500,'DO_NOT_RETRY');const result=await client.query(`SELECT to_jsonb(t) AS row FROM kcml.${table} t WHERE ${predicate} FOR UPDATE`,[targetId]);return result.rows[0]?.row??null;}
async function readEntity(pool:DatabasePool,entity:string,targetId:string|null,limit:number):Promise<unknown>{const table=entityTable(entity);const columns=await entityColumns(pool,entity);if(targetId){const predicate=columns.has('id')?'t.id::text=$1':columns.has('stable_key')?'t.stable_key=$1':null;if(!predicate)throw new DomainError('OPERATION_ENTITY_NOT_ADDRESSABLE',`${entity} has no addressable identity`,500,'DO_NOT_RETRY');return (await pool.query(`SELECT to_jsonb(t) AS row FROM kcml.${table} t WHERE ${predicate} LIMIT 1`,[targetId])).rows[0]?.row??null;}const bounded=Math.max(1,Math.min(limit,500));const order=columns.has('updated_at')?' ORDER BY t.updated_at DESC':columns.has('created_at')?' ORDER BY t.created_at DESC':'';return (await pool.query(`SELECT to_jsonb(t) AS row FROM kcml.${table} t${order} LIMIT $1`,[bounded])).rows.map(row=>row.row);}
async function mutateOperationEntity(client:DatabaseClient,entity:string,targetId:string|null,args:JsonObject,verb:string,metadata:JsonObject,head:Record<string,unknown>):Promise<unknown>{const table=entityTable(entity);const columns=await entityColumns(client,entity);if(targetId){const current=await entityRowForUpdate(client,entity,targetId);if(!current)throw new DomainError('TARGET_NOT_FOUND',`${entity} target does not exist`,404);const values:unknown[]=[targetId];const updates:string[]=[];if(columns.has('document')){values.push(jsonSafe({...args,...metadata}));updates.push(`document=t.document || $${values.length}::jsonb`);}else{for(const [key,value] of Object.entries(args)){const column=snakeKey(key);if(!columns.has(column)||['id','state_version','created_at','updated_at','platform_incarnation_id','application_deployment_epoch'].includes(column))continue;values.push(value);updates.push(`"${column}"=$${values.length}`);}}
    const stateColumn=['lifecycle','status','state'].find(column=>columns.has(column));if(stateColumn){values.push(lifecycleForVerb(verb,String(current[stateColumn]??'ACTIVE')));updates.push(`"${stateColumn}"=$${values.length}`);}if(columns.has('application_deployment_epoch')){values.push(head.current_epoch);updates.push(`application_deployment_epoch=$${values.length}`);}if(columns.has('state_version'))updates.push('state_version=t.state_version+1');if(columns.has('updated_at'))updates.push('updated_at=clock_timestamp()');if(!updates.length)throw new DomainError('OPERATION_ENTITY_IMMUTABLE',`${entity} does not expose mutable fields for ${verb}`,409,'DO_NOT_RETRY');const predicate=columns.has('id')?'t.id::text=$1':'t.stable_key=$1';return (await client.query(`UPDATE kcml.${table} AS t SET ${updates.join(',')} WHERE ${predicate} RETURNING to_jsonb(t) AS row`,values)).rows[0]?.row??null;}
  const id=randomUUID();const values=new Map<string,unknown>();for(const [key,value] of Object.entries(args)){const column=snakeKey(key);if(columns.has(column)&&!['state_version','created_at','updated_at','platform_incarnation_id','application_deployment_epoch'].includes(column))values.set(column,value);}if(columns.has('id')&&!values.has('id'))values.set('id',id);const stableKey=String(args.stableKey??args.code??args.name??`${entity}-${id.slice(0,8)}`);if(columns.has('stable_key')&&!values.has('stable_key'))values.set('stable_key',stableKey);if(columns.has('display_name')&&!values.has('display_name'))values.set('display_name',String(args.displayName??args.name??stableKey));if(columns.has('document'))values.set('document',jsonSafe({...args,...metadata}));if(columns.has('lifecycle')&&!values.has('lifecycle'))values.set('lifecycle',lifecycleForVerb(verb,'DRAFT'));if(columns.has('platform_incarnation_id'))values.set('platform_incarnation_id',head.platform_incarnation_id);if(columns.has('application_deployment_epoch'))values.set('application_deployment_epoch',head.current_epoch);const names=[...values.keys()];if(!names.length)throw new DomainError('OPERATION_ENTITY_INSERT_UNSUPPORTED',`${entity} has no writable insert surface`,422,'DO_NOT_RETRY');const params=[...values.values()];const placeholders=params.map((_,i)=>`$${i+1}`);try{return (await client.query(`INSERT INTO kcml.${table} AS t (${names.map(name=>`"${name}"`).join(',')}) VALUES(${placeholders.join(',')}) RETURNING to_jsonb(t) AS row`,params)).rows[0]?.row??null;}catch(error){if(error instanceof Error&&/null value in column|violates not-null constraint/u.test(error.message))throw new DomainError('OPERATION_REQUIRED_FIELDS_MISSING',`${entity} requires additional SSOT fields for ${verb}`,422,'DO_NOT_RETRY',{cause:error.message});throw error;}}

export interface CommandContext { callerFingerprint:string; actorId:string; correlationId:string; causationId?:string|null; idempotencyKey?:string|null; }

export class OperationCatalogService {
  readonly #byName = new Map<string, OperationContract>();
  private constructor(readonly operations: readonly OperationContract[]) { for(const operation of operations)this.#byName.set(operation.operationName,operation); }
  public static async load(repositoryRoot=process.cwd()):Promise<OperationCatalogService>{const catalog=await loadOperationCatalog(repositoryRoot);assertOperationHandlerCoverage(catalog.records);return new OperationCatalogService(catalog.records);}
  public get(name:string):OperationContract{const operation=this.#byName.get(name);if(!operation)throw new DomainError('OPERATION_NOT_FOUND',`Unknown operation ${name}`,404);return operation;}
  public publicView():unknown[]{return this.operations.map(({operationName,operationId,operationRevision,operationFamily,exposureClass,sideEffectClass,retryClass,canonicalDigest,expectedStateVersionPolicy,idempotencyKeySource})=>({operationName,operationId,operationRevision,operationFamily,exposureClass,sideEffectClass,retryClass,canonicalDigest,expectedStateVersionPolicy,idempotencyKeySource}));}
}

export class CanonicalOperationService {
  public constructor(private readonly pool:DatabasePool,readonly catalog:OperationCatalogService){}

  public async execute(operationName:string,commandInput:unknown,context:CommandContext):Promise<OperationResult>{
    const operation=this.catalog.get(operationName);
    const command=operationCommandSchema.parse({...((commandInput??{}) as object),operation:operationName});
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

    return inTransaction(this.pool,'SERIALIZABLE',async(client)=>{
      await lockAdvisory(client,'IDEMPOTENCY_SCOPE',`${scopeDigest.toString('hex')}:${keyDigest.toString('hex')}`);
      const headsResult=await client.query(`SELECT p.platform_incarnation_id,d.current_epoch,a.current_epoch AS activation_epoch
        FROM kcml.platform_incarnation p CROSS JOIN kcml.application_deployment_head d CROSS JOIN kcml.activation_head a
        WHERE p.singleton_key=1 AND d.singleton_key=1 AND a.singleton_key=1 FOR SHARE OF p,d,a`);
      const heads=headsResult.rows[0];
      if(!heads)throw new DomainError('AUTHORITY_HEADS_MISSING','Platform authority heads are missing',503,'RETRY_SAME_OPERATION');

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
      if(command.targetId&&command.expectedStateVersion!==null){
        const handler=operationHandlerFor(operationName);
        const target=await entityRowForUpdate(client,handler.entity,command.targetId);
        if(!target)throw new DomainError('TARGET_NOT_FOUND','Target does not exist',404,'DO_NOT_RETRY');
        if(target.state_version!==undefined&&BigInt(String(target.state_version))!==command.expectedStateVersion)throw new DomainError('STATE_VERSION_CONFLICT','Target state changed',409,'REFRESH_AND_RETRY_NEW_COMMAND');
      }

      await client.query(`INSERT INTO kcml.domain_command(id,logical_operation_id,operation_name,operation_revision,target_id,caller_fingerprint,request_canonical_bytes,request,request_digest,expected_state_version,expected_activation_epoch,status,correlation_id,causation_id,deadline_at,activation_epoch,platform_incarnation_id,application_deployment_epoch)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'ACCEPTED',$12,$13,$14,$15,$16,$17)`,[commandId,logicalOperationId,operationName,operation.operationRevision,command.targetId,context.callerFingerprint,requestBytes,safeCommand,requestDigest,command.expectedStateVersion?.toString(),command.expectedActivationEpoch?.toString(),context.correlationId,context.causationId??null,command.deadlineAt,heads.activation_epoch,heads.platform_incarnation_id,heads.current_epoch]);
      await client.query(`INSERT INTO kcml.queue_item(queue_name,partition_key,command_id,payload,platform_incarnation_id,application_deployment_epoch)
        VALUES($1,$2,$3,$4,$5,$6)`,[queueFor(operation),command.targetId??operation.operationFamily,commandId,{commandId,operationName},heads.platform_incarnation_id,heads.current_epoch]);
      const eventPayload={commandId,logicalOperationId,operationName,targetId:command.targetId};
      const sequence=await nextStreamSequence(client,`command:${commandId}`);
      await client.query(`INSERT INTO kcml.transactional_outbox(stream_key,stream_sequence,purpose,event_type,aggregate_id,payload,payload_digest) VALUES($1,$2,'DOMAIN_EVENT',$3,$4,$5,$6)`,[`command:${commandId}`,sequence.toString(),'domain.command.accepted',command.targetId,eventPayload,digestBytes(canonicalDigest(jsonSafe(eventPayload)))]);
      const response=this.acceptedResult(commandId,logicalOperationId,context.correlationId,0n,sequence,BigInt(heads.activation_epoch),false,{commandId,status:'ACCEPTED'});
      const responseDigest=digestBytes(canonicalDigest(jsonSafe(response)));
      await client.query(`UPDATE kcml.domain_idempotency_record SET lifecycle='EXECUTING',response_status=202,response_body=$2,response_digest=$3,updated_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1`,[idempotency.id,response,responseDigest]);
      await audit(client,'domain.command.accepted',context.actorId,'DOMAIN_COMMAND',commandId,context.correlationId,context.causationId??null,eventPayload);
      return response;
    });
  }

  private async executeQuery(operation:OperationContract,targetId:string|null,args:JsonObject,context:CommandContext):Promise<OperationResult>{
    let result:unknown;
    if(operation.operationName.endsWith('catalog.list'))result=this.catalog.publicView();
    else if(operation.operationName==='audit.integrity.verify')result=await verifyAuditChain(this.pool);
    else if(operation.operationFamily==='AUDIT')result=(await this.pool.query(`SELECT id,chain_sequence,event_type,actor_kind,actor_id,aggregate_type,aggregate_id,correlation_id,payload,encode(previous_hash,'hex') previous_hash,encode(event_hash,'hex') event_hash,created_at FROM kcml.audit_event ORDER BY chain_sequence DESC LIMIT $1`,[Math.min(Number(args.limit??100),500)])).rows;
    else if(operation.operationFamily==='SELFTEST')result=(await this.pool.query(`SELECT * FROM kcml.self_test_run ORDER BY created_at DESC LIMIT 100`)).rows;
    else if(operation.operationFamily==='MCP'&&operation.operationName.includes('tools.list'))result=this.catalog.publicView().filter((candidate:any)=>candidate.operationFamily==='MCP');
    else if(operation.operationFamily==='RUNTIME')result=(await this.pool.query(`SELECT * FROM kcml.runtime_instance ORDER BY started_at DESC LIMIT 100`)).rows;
    else {const handler=operationHandlerFor(operation.operationName);result=await readEntity(this.pool,handler.entity,targetId,Math.min(Number(args.limit??50),200));}
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

export interface WorkerOptions {queueNames:readonly string[];workerId:string;leaseSeconds?:number;}

export class CanonicalCommandWorker {
  public constructor(private readonly pool:DatabasePool,private readonly catalog:OperationCatalogService,private readonly options:WorkerOptions){}
  public async runOnce():Promise<boolean>{
    const claim=await inTransaction(this.pool,'READ COMMITTED',async(client)=>{
      const rowResult=await client.query(`SELECT q.*,c.operation_name,c.request,c.correlation_id,c.target_id,c.logical_operation_id,c.state_version AS command_state_version
        FROM kcml.queue_item q JOIN kcml.domain_command c ON c.id=q.command_id
        WHERE q.queue_name=ANY($1) AND q.status='READY' AND q.available_at<=clock_timestamp()
        ORDER BY q.priority,q.available_at,q.id FOR UPDATE OF q SKIP LOCKED LIMIT 1`,[this.options.queueNames]);const row=rowResult.rows[0];if(!row)return null;
      const heads=await client.query(`SELECT p.platform_incarnation_id,d.current_epoch FROM kcml.platform_incarnation p CROSS JOIN kcml.application_deployment_head d WHERE p.singleton_key=1 AND d.singleton_key=1 FOR SHARE OF p,d`);const head=heads.rows[0];
      if(row.platform_incarnation_id!==head.platform_incarnation_id||BigInt(row.application_deployment_epoch)!==BigInt(head.current_epoch)){await client.query(`UPDATE kcml.queue_item SET status='DEAD_LETTER',state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`,[row.id]);return null;}
      const token=BigInt(row.lease_fencing_token)+1n;await client.query(`UPDATE kcml.queue_item SET status='CLAIMED',lease_owner=$2,lease_fencing_token=$3,lease_expires_at=clock_timestamp()+make_interval(secs=>$4),attempt_count=attempt_count+1,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`,[row.id,this.options.workerId,token.toString(),this.options.leaseSeconds??60]);
      await client.query(`UPDATE kcml.domain_command SET status='RUNNING',state_version=state_version+1 WHERE id=$1 AND status='ACCEPTED'`,[row.command_id]);return {...row,lease_fencing_token:token};
    });
    if(!claim)return false;
    try{const output=await this.applyCommand(claim);await this.complete(claim,output);}
    catch(error){await this.fail(claim,error);}
    return true;
  }

  private async applyCommand(row:any):Promise<unknown>{
    const operation=this.catalog.get(row.operation_name);const handler=operationHandlerFor(operation.operationName);const args=(row.request.arguments??{}) as JsonObject;const verb=operation.operationName.split('.').at(-1)??'execute';
    if(row.queue_name!==handler.queue)throw new DomainError('OPERATION_QUEUE_BINDING_MISMATCH',`${operation.operationName} was delivered on ${row.queue_name}, expected ${handler.queue}`,409,'DO_NOT_RETRY');
    if(handler.strategy==='CONSISTENT_QUERY')throw new DomainError('READ_OPERATION_QUEUED',`${operation.operationName} must execute on the consistent-read path`,409,'DO_NOT_RETRY');
    if(operation.operationName==='generation.job.create')return this.createGeneration(args);
    if(operation.operationName==='browser.session.create')return this.createBrowserSession(args,row);
    if(operation.operationName==='monitor.alert.open')return this.openAlert(args);
    if(operation.operationName==='selfTest.run.start')return this.createTestRun(args);
    return inTransaction(this.pool,'SERIALIZABLE',async(client)=>{
      const head=(await client.query(`SELECT p.platform_incarnation_id,d.current_epoch FROM kcml.platform_incarnation p CROSS JOIN kcml.application_deployment_head d WHERE p.singleton_key=1 AND d.singleton_key=1 FOR SHARE OF p,d`)).rows[0] as Record<string,unknown>;
      return mutateOperationEntity(client,handler.entity,row.target_id,args,verb,{lastOperation:operation.operationName,lastCorrelationId:row.correlation_id,handlerEntity:handler.entity,handlerStrategy:handler.strategy,operationContractDigest:handler.contractDigest},head);
    });
  }

  private async createGeneration(args:JsonObject):Promise<unknown>{return inTransaction(this.pool,'SERIALIZABLE',async(client)=>{const head=(await client.query(`SELECT p.platform_incarnation_id,d.current_epoch FROM kcml.platform_incarnation p CROSS JOIN kcml.application_deployment_head d WHERE p.singleton_key=1 AND d.singleton_key=1`)).rows[0];const result=await client.query(`INSERT INTO kcml.generation_job(mode,objective,target_object_ids,source_artifact_ids,model,platform_incarnation_id,application_deployment_epoch)VALUES($1,$2,$3,$4,$5,$6,$7)RETURNING *`,[args.mode??'CREATE',args.objective??'OWNER generation request',args.targetObjectIds??[],args.sourceArtifactIds??[],args.model??null,head.platform_incarnation_id,head.current_epoch]);return result.rows[0];});}
  private async createBrowserSession(args:JsonObject,row:any):Promise<unknown>{return inTransaction(this.pool,'SERIALIZABLE',async(client)=>{const head=(await client.query(`SELECT p.platform_incarnation_id,d.current_epoch FROM kcml.platform_incarnation p CROSS JOIN kcml.application_deployment_head d WHERE p.singleton_key=1 AND d.singleton_key=1`)).rows[0];const result=await client.query(`INSERT INTO kcml.browser_session(parent_kind,parent_id,purpose,execution_target,runtime_build_id,account_binding_id,operation_scope,current_url,platform_incarnation_id,application_deployment_epoch)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)RETURNING *`,[args.parentKind??'OWNER_CHAT',dbUuid(args.parentId)??row.logical_operation_id,args.purpose??'OWNER browser session',args.executionTarget??'SERVER_MANAGED',args.runtimeBuildId??process.env.KCML_BROWSER_RUNTIME_BUILD??'playwright-1.58.2',dbUuid(args.accountBindingId),args.operationScope??{},args.targetUrl??null,head.platform_incarnation_id,head.current_epoch]);return result.rows[0];});}
  private async openAlert(args:JsonObject):Promise<unknown>{return inTransaction(this.pool,'SERIALIZABLE',async(client)=>{const head=(await client.query(`SELECT p.platform_incarnation_id,d.current_epoch FROM kcml.platform_incarnation p CROSS JOIN kcml.application_deployment_head d WHERE p.singleton_key=1 AND d.singleton_key=1`)).rows[0];const now=new Date();const result=await client.query(`INSERT INTO kcml.operational_alert(fingerprint,severity,title,evidence,first_seen_at,last_seen_at,platform_incarnation_id,application_deployment_epoch)VALUES($1,$2,$3,$4,$5,$5,$6,$7)ON CONFLICT(fingerprint)WHERE status IN('OPEN','ACKNOWLEDGED')DO UPDATE SET last_seen_at=EXCLUDED.last_seen_at,occurrence_count=kcml.operational_alert.occurrence_count+1,evidence=EXCLUDED.evidence,state_version=kcml.operational_alert.state_version+1,updated_at=clock_timestamp()RETURNING *`,[args.fingerprint??canonicalDigest(jsonSafe(args)),args.severity??'WARNING',args.title??'Monitor alert',args.evidence??args,now,head.platform_incarnation_id,head.current_epoch]);return result.rows[0];});}
  private async createTestRun(args:JsonObject):Promise<unknown>{return inTransaction(this.pool,'SERIALIZABLE',async(client)=>{const head=(await client.query(`SELECT p.platform_incarnation_id,d.current_epoch FROM kcml.platform_incarnation p CROSS JOIN kcml.application_deployment_head d WHERE p.singleton_key=1 AND d.singleton_key=1`)).rows[0];const env=jsonSafe({releaseId:process.env.KCML_RELEASE_ID??'development',sourceSha:requiredSourceSha()});const result=await client.query(`INSERT INTO kcml.self_test_run(suite_key,run_kind,source_sha,release_id,environment_digest,seed,platform_incarnation_id,application_deployment_epoch)VALUES($1,$2,$3,$4,$5,$6,$7,$8)RETURNING *`,[args.suiteKey??'self-test',args.runKind??'SELF_TEST',requiredSourceSha(),process.env.KCML_RELEASE_ID??'development',digestBytes(canonicalDigest(env)),args.seed??null,head.platform_incarnation_id,head.current_epoch]);return result.rows[0];});}
  private async complete(row:any,output:unknown):Promise<void>{await inTransaction(this.pool,'SERIALIZABLE',async(client)=>{const locked=await client.query(`SELECT * FROM kcml.queue_item WHERE id=$1 FOR UPDATE`,[row.id]);const current=locked.rows[0];if(current.status!=='CLAIMED'||current.lease_owner!==this.options.workerId||BigInt(current.lease_fencing_token)!==BigInt(row.lease_fencing_token))throw new DomainError('QUEUE_FENCE_LOST','Queue claim fence is no longer current',409,'RECONCILE_THEN_RETRY');await client.query(`UPDATE kcml.domain_command SET status='SUCCEEDED',result=$2,completed_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1`,[row.command_id,jsonSafe(output)]);await client.query(`UPDATE kcml.domain_idempotency_record SET lifecycle='SUCCEEDED',terminal_outcome_digest=$2,completed_at=clock_timestamp(),updated_at=clock_timestamp(),state_version=state_version+1 WHERE command_id=$1`,[row.command_id,digestBytes(canonicalDigest(jsonSafe(output)))]);await client.query(`UPDATE kcml.queue_item SET status='SUCCEEDED',lease_owner=NULL,lease_expires_at=NULL,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`,[row.id]);await audit(client,'domain.command.succeeded',this.options.workerId,'DOMAIN_COMMAND',row.command_id,row.correlation_id,null,{commandId:row.command_id,operationName:row.operation_name,resultDigest:canonicalDigest(jsonSafe(output))});});}
  private async fail(row:any,error:unknown):Promise<void>{const message=error instanceof Error?error.message:String(error);await inTransaction(this.pool,'SERIALIZABLE',async(client)=>{const locked=await client.query(`SELECT * FROM kcml.queue_item WHERE id=$1 FOR UPDATE`,[row.id]);const current=locked.rows[0];if(!current||current.status!=='CLAIMED'||current.lease_owner!==this.options.workerId)return;const retry=Number(current.attempt_count)<Number(current.max_attempts)&&!(error instanceof DomainError&&error.retryDirective==='DO_NOT_RETRY');if(retry){await client.query(`UPDATE kcml.queue_item SET status='READY',available_at=clock_timestamp()+make_interval(secs=>least(300,power(2,attempt_count)::int)),lease_owner=NULL,lease_expires_at=NULL,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`,[row.id]);await client.query(`UPDATE kcml.domain_command SET status='ACCEPTED',error=$2,state_version=state_version+1 WHERE id=$1`,[row.command_id,{code:'WORKER_RETRY',message}]);}else{await client.query(`UPDATE kcml.queue_item SET status='FAILED_FINAL',lease_owner=NULL,lease_expires_at=NULL,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`,[row.id]);await client.query(`UPDATE kcml.domain_command SET status='FAILED_FINAL',error=$2,completed_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1`,[row.command_id,{code:error instanceof DomainError?error.code:'COMMAND_FAILED',message}]);await client.query(`UPDATE kcml.domain_idempotency_record SET lifecycle='FAILED_FINAL',terminal_outcome_digest=$2,completed_at=clock_timestamp(),updated_at=clock_timestamp(),state_version=state_version+1 WHERE command_id=$1`,[row.command_id,digestBytes(canonicalDigest(jsonSafe({code:error instanceof DomainError?error.code:'COMMAND_FAILED',message})))]);}});}
}

function lifecycleForVerb(verb:string,current:string):string{if(['activate','enable','restore','complete','approve','connect','ready'].includes(verb))return'ACTIVE';if(['disable','suspend','pause','drain'].includes(verb))return'SUSPENDED';if(['quarantine'].includes(verb))return'QUARANTINED';if(['deregister','close','revoke','cancel','expire','stop','fail'].includes(verb))return'CLOSED';if(['publish','validate','verify','preflight','compile'].includes(verb))return'VERIFIED';return current==='DRAFT'?'ACTIVE':current;}
