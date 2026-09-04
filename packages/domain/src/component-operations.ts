import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseClient, DatabasePool } from '@kcml/database';
import { canonicalDigest, type CanonicalJsonValue } from '@kcml/schemas';
import { z } from 'zod';
import { DomainError } from './errors.js';

type JsonObject = Record<string, unknown>;

function jsonSafe(value: unknown): CanonicalJsonValue {
  return JSON.parse(JSON.stringify(value)) as CanonicalJsonValue;
}

function digestBytes(value: unknown): Buffer {
  return Buffer.from(canonicalDigest(jsonSafe(value)).slice('sha256:'.length), 'hex');
}

const registerSchema = z.object({
  stableKey: z.string().min(1).max(256),
  kcmlNumber: z.string().min(1).max(128),
  code: z.string().min(1).max(128),
  hostname: z.string().min(1).max(253).nullable().optional(),
  displayName: z.string().min(1).max(256),
  description: z.string().max(10_000).nullable().optional(),
  category: z.string().min(1).max(128),
  role: z.string().min(1).max(128),
  contacts: z.array(z.record(z.string(), z.unknown())).max(64).default([]),
  criticality: z.string().min(1).max(64),
  runtimeIdentityKind: z.string().min(1).max(128)
}).strict();

const revisionPublishSchema = z.object({
  semanticVersion: z.string().regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u),
  canonicalManifest: z.record(z.string(), z.unknown()),
  sourceProvenance: z.record(z.string(), z.unknown())
}).strict();

const heartbeatSchema = z.object({
  componentCode: z.string().min(1),
  executionId: z.string().uuid(),
  releaseId: z.string().uuid(),
  runtimeId: z.string().uuid(),
  serviceGeneration: z.string().min(1),
  runtimeGeneration: z.coerce.bigint().nonnegative(),
  activationEpoch: z.coerce.bigint().nonnegative(),
  bindingSetRevision: z.string().uuid(),
  heartbeatSequence: z.coerce.bigint().positive(),
  lifecycleMode: z.enum(['ACTIVE','SUSPENDED','QUARANTINED','RETIRED']),
  operationalState: z.enum(['UNKNOWN','DISABLED','HEALTHY','DEGRADED','UNHEALTHY','MAINTENANCE','QUARANTINED','RETIRED']),
  ready: z.boolean(),
  dependencySummary: z.record(z.string(), z.unknown()),
  queueDepth: z.number().int().nonnegative(),
  activeRuns: z.number().int().nonnegative(),
  resourceUsage: z.object({ cpuMillis: z.number().nonnegative(), memoryMiB: z.number().nonnegative(), openFiles: z.number().int().nonnegative() }).strict(),
  lastSuccessfulOperationAt: z.string().datetime({ offset: true }).nullable(),
  emittedAt: z.string().datetime({ offset: true }),
  nonce: z.string().min(1).max(512)
}).strict();

const componentRevisionQuerySchema=z.object({revisionId:z.string().uuid()}).strict();
const componentVerifyQuerySchema=z.object({revisionId:z.string().uuid(),releaseId:z.string().uuid().nullable().optional()}).strict();
const componentStateQuerySchema=z.object({
  stateKeys:z.array(z.enum(['lifecycle','activation','operational','monitoring','recertification'])).min(1).max(32),
  consistency:z.enum(['CURRENT_PROJECTION','LATEST_VALID_OBSERVATION']),
  expectedRevisionId:z.string().uuid(),
  expectedReleaseId:z.string().uuid(),
  expectedBindingSetRevisionId:z.string().uuid(),
  expectedActivationEpoch:z.coerce.bigint().nonnegative()
}).strict();
const componentStateReportSchema=z.object({observations:z.array(z.object({
  stateKey:z.string().min(1).max(256),payload:z.unknown(),schemaDigest:z.string().regex(/^sha256:[0-9a-f]{64}$/u),payloadDigest:z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  observedAt:z.string().datetime({offset:true}),emittedAt:z.string().datetime({offset:true}),releaseId:z.string().uuid(),runtimeId:z.string().uuid(),runtimeGeneration:z.coerce.bigint().nonnegative(),
  activationEpoch:z.coerce.bigint().nonnegative(),bindingSetRevisionId:z.string().uuid(),sourceSequence:z.coerce.bigint().positive()
}).strict()).min(1).max(64)}).strict();
const componentSuspendSchema=z.object({reason:z.string().min(1).max(2000),evidenceDigest:z.string().regex(/^sha256:[0-9a-f]{64}$/u)}).strict();
const componentQuarantineSchema=z.object({reason:z.string().min(1).max(2000),evidenceDigest:z.string().regex(/^sha256:[0-9a-f]{64}$/u)}).strict();
const componentRestoreSchema=z.object({targetLifecycle:z.enum(['SUSPENDED','ACTIVE']),reason:z.string().min(1).max(2000),evidenceDigest:z.string().regex(/^sha256:[0-9a-f]{64}$/u)}).strict();
const componentRecertifySchema=z.object({reason:z.string().min(1).max(2000),evidenceDigest:z.string().regex(/^sha256:[0-9a-f]{64}$/u)}).strict();
const componentDeregisterSchema=z.object({reason:z.string().min(1).max(2000),evidenceDigest:z.string().regex(/^sha256:[0-9a-f]{64}$/u)}).strict();

const componentClosureQueryCatalog = {
  version: 1,
  rootKind: 'COMPONENT',
  terminalState: 'DEREGISTERED',
  predicates: [
    'COMPONENT_RETIRED_WITHOUT_ACTIVE_POINTER_OR_ROUTE',
    'NO_AUTHORITY_RUNTIME_OR_LIVE_PROCESS',
    'NO_ACTIVE_CONTRACT_BINDING',
    'NO_ACTIVE_CONCURRENCY_CLAIM',
    'NO_PENDING_SIDE_EFFECT',
    'NO_OTHER_NONTERMINAL_COMMAND',
    'ADMISSION_BARRIER_CLOSED',
    'COMPONENT_AUDIT_STREAM_VALID'
  ]
} as const;

export const exactComponentMutationOperations = new Set([
  'component.register',
  'component.revision.publish',
  'component.heartbeat',
  'component.state.report',
  'component.suspend',
  'component.quarantine',
  'component.restore',
  'component.recertify',
  'component.deregister'
]);
export const exactComponentQueryOperations = new Set(['component.validate','component.verify','component.state.query']);

export interface ComponentOperationContext {
  operationName: string;
  targetId: string | null;
  arguments: JsonObject;
  expectedStateVersion: bigint | null;
  logicalOperationId: string;
  correlationId: string;
  platformIncarnationId: string;
  applicationDeploymentEpoch: bigint;
}

export async function executeExactComponentQuery(pool:DatabasePool,operationName:string,targetId:string|null,argumentsValue:JsonObject):Promise<unknown>{
  if(!targetId)throw new DomainError('AGENTIC_DYNAMIC_TARGET_UNBOUND',`${operationName} requires an exact component target`,422,'DO_NOT_RETRY');
  if(operationName==='component.validate'){
    const parsed=componentRevisionQuerySchema.safeParse(argumentsValue);if(!parsed.success)throw new DomainError('OPERATION_CONTRACT_INCOMPLETE','Component validation query arguments are invalid',422,'DO_NOT_RETRY',parsed.error.issues);
    const revision=(await pool.query(`SELECT r.*,c.state_version AS component_state_version FROM kcml.component_revision r JOIN kcml.component c ON c.id=r.component_id WHERE r.id=$1 AND r.component_id=$2`,[parsed.data.revisionId,targetId])).rows[0];
    if(!revision)throw new DomainError('REVISION_STALE','Component revision does not exist',404,'DO_NOT_RETRY');
    const calculated=digestBytes(revision.canonical_manifest);const valid=calculated.equals(Buffer.from(revision.manifest_digest))&&revision.validation_state==='VALID';
    return {componentId:targetId,revisionId:revision.id,valid,validationState:revision.validation_state,manifestDigest:`sha256:${Buffer.from(revision.manifest_digest).toString('hex')}`,componentStateVersion:String(revision.component_state_version),evidence:revision.validation_evidence};
  }
  if(operationName==='component.verify'){
    const parsed=componentVerifyQuerySchema.safeParse(argumentsValue);if(!parsed.success)throw new DomainError('OPERATION_CONTRACT_INCOMPLETE','Component verification query arguments are invalid',422,'DO_NOT_RETRY',parsed.error.issues);
    const revision=(await pool.query(`SELECT * FROM kcml.component_revision WHERE id=$1 AND component_id=$2`,[parsed.data.revisionId,targetId])).rows[0];
    if(!revision)throw new DomainError('REVISION_STALE','Component revision does not exist',404,'DO_NOT_RETRY');
    const gateResult=await pool.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE status='PASS' AND (expires_at IS NULL OR expires_at>clock_timestamp()))::int AS passed,
      count(*) FILTER(WHERE status<>'PASS' OR (expires_at IS NOT NULL AND expires_at<=clock_timestamp()))::int AS blocking FROM kcml.component_readiness_gate WHERE component_id=$1 AND ($2::uuid IS NULL OR release_id=$2)`,[targetId,parsed.data.releaseId??null]);
    const gates=gateResult.rows[0];const eligible=revision.validation_state==='VALID'&&revision.verification_state==='VERIFIED'&&Number(gates.total)>0&&Number(gates.blocking)===0;
    return {componentId:targetId,revisionId:revision.id,releaseId:parsed.data.releaseId??null,eligible,validationState:revision.validation_state,verificationState:revision.verification_state,gates:{total:Number(gates.total),passed:Number(gates.passed),blocking:Number(gates.blocking)}};
  }
  if(operationName==='component.state.query'){
    const parsed=componentStateQuerySchema.safeParse(argumentsValue);if(!parsed.success)throw new DomainError('OPERATION_CONTRACT_INCOMPLETE','Component state query arguments are invalid',422,'DO_NOT_RETRY',parsed.error.issues);
    const component=(await pool.query(`SELECT * FROM kcml.component WHERE id=$1`,[targetId])).rows[0];if(!component)throw new DomainError('KCIP_TARGET_NOT_FOUND','Component does not exist',404,'DO_NOT_RETRY');
    const current=String(component.active_revision_id)===parsed.data.expectedRevisionId&&String(component.current_release_id)===parsed.data.expectedReleaseId&&String(component.active_binding_set_revision_id)===parsed.data.expectedBindingSetRevisionId&&BigInt(component.current_activation_epoch)===parsed.data.expectedActivationEpoch;
    if(!current)throw new DomainError('CAPABILITY_SNAPSHOT_STALE','Requested component snapshot is no longer current',409,'REFRESH_AND_RETRY_NEW_COMMAND');
    const values:Record<string,unknown>={lifecycle:component.lifecycle,activation:component.activation_state,operational:component.operational_state,monitoring:component.monitoring_state,recertification:component.recertification_state};
    return {componentId:targetId,consistency:parsed.data.consistency,stateVersion:String(component.state_version),aggregateEventSequence:String(component.aggregate_event_sequence),revisionId:component.active_revision_id,releaseId:component.current_release_id,bindingSetRevisionId:component.active_binding_set_revision_id,activationEpoch:String(component.current_activation_epoch),observedAt:component.updated_at,states:parsed.data.stateKeys.map((key)=>({key,value:values[key],staleness:'CURRENT_PROJECTION'}))};
  }
  throw new DomainError('OPERATION_CONTRACT_INCOMPLETE',`No exact component query handler exists for ${operationName}`,501,'DO_NOT_RETRY');
}

async function lockComponent(client: DatabaseClient, id: string, expectedStateVersion: bigint | null): Promise<Record<string, unknown>> {
  const row = (await client.query(`SELECT * FROM kcml.component WHERE id=$1 FOR UPDATE`, [id])).rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new DomainError('KCIP_TARGET_NOT_FOUND', 'Component target does not exist', 404, 'DO_NOT_RETRY');
  if (expectedStateVersion === null) throw new DomainError('STATE_VERSION_CONFLICT', 'Component mutation requires expectedStateVersion', 428, 'REFRESH_AND_RETRY_NEW_COMMAND');
  if (BigInt(String(row.state_version)) !== expectedStateVersion) throw new DomainError('STATE_VERSION_CONFLICT', 'Component state changed before command execution', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
  if (row.lifecycle === 'DEREGISTERED') throw new DomainError('TERMINAL_STATE_IMMUTABLE', 'Deregistered component is immutable', 409, 'DO_NOT_RETRY');
  return row;
}

async function appendComponentAuditEvent(client: DatabaseClient, context: ComponentOperationContext, component: Record<string, unknown>, eventKey: string, payload: CanonicalJsonValue, stateChange: CanonicalJsonValue | null): Promise<{ id: string; duplicate: boolean }> {
  const payloadDigest = digestBytes(payload);
  const streamPayload = { componentId: component.id, kind: 'COMPONENT_AUDIT_STREAM' };
  await client.query(`INSERT INTO kcml.component_audit_stream(stable_key,display_name,component_id,first_sequence,last_sequence,gap_state,replay_state,current_hash,integrity_state,canonical_digest,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,0,0,'CONTIGUOUS','CURRENT',$4,'VALID',$5,$6,$7)
    ON CONFLICT(component_id) DO NOTHING`, [`component-audit:${component.id}`,`Component audit ${component.code}`,component.id,Buffer.alloc(32),digestBytes(streamPayload),context.platformIncarnationId,context.applicationDeploymentEpoch.toString()]);
  const stream=(await client.query(`SELECT * FROM kcml.component_audit_stream WHERE component_id=$1 FOR UPDATE`,[component.id])).rows[0];
  if(!stream)throw new DomainError('CLOSURE_PREDICATE_INCOMPLETE','Component audit stream could not be reserved',500,'DO_NOT_RETRY');
  const existing=(await client.query(`SELECT id,payload_digest FROM kcml.component_audit_event WHERE stable_key=$1 AND deleted_at IS NULL`,[eventKey])).rows[0];
  if(existing){
    if(!Buffer.from(existing.payload_digest).equals(payloadDigest))throw new DomainError('OPERATION_CONTRACT_INCOMPLETE','The same component observation sequence has a different payload digest',409,'DO_NOT_RETRY');
    return {id:existing.id,duplicate:true};
  }
  const sequence=BigInt(stream.last_sequence)+1n;const sequenceBytes=Buffer.alloc(8);sequenceBytes.writeBigInt64BE(sequence);
  const previousHash=Buffer.from(stream.current_hash);const eventHash=createHash('sha256').update(Buffer.concat([previousHash,sequenceBytes,payloadDigest])).digest();
  const eventId=randomUUID();
  await client.query(`INSERT INTO kcml.component_audit_event(id,stable_key,display_name,stream_id,sequence,workflow,step,actor,service,classifications,payload,access_channel,protocol,state_change,payload_digest,previous_hash,event_hash,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,'OBSERVATION_ACCEPTED',$7,'RUNTIME_GATEWAY',$8,$9,'TRUSTED_RUNTIME','KCIP',$10,$11,$12,$13,$11,$14,$15,$16,$17,$18)`,[
      eventId,eventKey,context.operationName,stream.id,sequence.toString(),context.operationName,{kind:'TRUSTED_RUNTIME',executionId:(payload as JsonObject).executionId},JSON.stringify(['COMPONENT_OBSERVATION']),payload,stateChange,payloadDigest,previousHash,eventHash,context.logicalOperationId,context.correlationId,String(component.current_activation_epoch??0),context.platformIncarnationId,context.applicationDeploymentEpoch.toString()
    ]);
  await client.query(`UPDATE kcml.component_audit_stream SET first_sequence=CASE WHEN first_sequence=0 THEN $2 ELSE first_sequence END,last_sequence=$2,current_hash=$3,integrity_state='VALID',state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`,[stream.id,sequence.toString(),eventHash]);
  return {id:eventId,duplicate:false};
}

function validateBoundedStatePayload(schema:unknown,payload:unknown):boolean{
  if(typeof schema!=='object'||schema===null||Array.isArray(schema))return false;const contract=schema as JsonObject;
  if(contract.type!=='object'||typeof payload!=='object'||payload===null||Array.isArray(payload))return false;const value=payload as JsonObject;
  const required=Array.isArray(contract.required)?contract.required.filter((item):item is string=>typeof item==='string'):[];if(required.some((key)=>!(key in value)))return false;
  const properties=typeof contract.properties==='object'&&contract.properties!==null&&!Array.isArray(contract.properties)?contract.properties as Record<string,unknown>:{};
  if(contract.additionalProperties===false&&Object.keys(value).some((key)=>!(key in properties)))return false;
  for(const [key,propertySchema] of Object.entries(properties)){
    if(!(key in value)||typeof propertySchema!=='object'||propertySchema===null||Array.isArray(propertySchema))continue;const rule=propertySchema as JsonObject;const item=value[key];
    if(Array.isArray(rule.enum)&&!rule.enum.some((candidate)=>JSON.stringify(candidate)===JSON.stringify(item)))return false;
    if(rule.type==='string'&&typeof item!=='string')return false;if(rule.type==='boolean'&&typeof item!=='boolean')return false;if(rule.type==='integer'&&(!Number.isInteger(item)))return false;if(rule.type==='number'&&typeof item!=='number')return false;
  }
  return true;
}

async function setComponentAdmissionBarrier(client:DatabaseClient,context:ComponentOperationContext,componentId:string,state:'OPEN'|'CLOSED'):Promise<void>{
  await client.query(`INSERT INTO kcml.activation_domain_head(domain_key,current_activation_epoch,barrier_state,pending_mutating_operation_count,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,0,$2,0,$3,$4) ON CONFLICT(domain_key) DO UPDATE SET barrier_state=EXCLUDED.barrier_state,state_version=kcml.activation_domain_head.state_version+1,updated_at=clock_timestamp(),platform_incarnation_id=EXCLUDED.platform_incarnation_id,application_deployment_epoch=EXCLUDED.application_deployment_epoch`,
  [`component:${componentId}`,state,context.platformIncarnationId,context.applicationDeploymentEpoch.toString()]);
}

async function assertCurrentReadiness(client:DatabaseClient,componentId:string,releaseId:unknown):Promise<void>{
  const gates=(await client.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE status<>'PASS' OR (expires_at IS NOT NULL AND expires_at<=clock_timestamp()))::int AS blocking FROM kcml.component_readiness_gate WHERE component_id=$1 AND release_id=$2`,[componentId,releaseId])).rows[0];
  if(Number(gates?.total??0)===0||Number(gates?.blocking??0)>0)throw new DomainError('ACTIVATION_SET_NOT_READY','Current component release does not have fresh PASS for every readiness gate',409,'DO_NOT_RETRY');
}

async function transitionComponentLifecycle(client:DatabaseClient,context:ComponentOperationContext,component:Record<string,unknown>,toLifecycle:string,reason:string,evidenceDigest:string,projection:Partial<Record<'operational_state'|'recertification_state',string>>={}):Promise<Record<string,unknown>>{
  const operational=projection.operational_state??String(component.operational_state);const recertification=projection.recertification_state??String(component.recertification_state);
  await appendComponentAuditEvent(client,context,component,`lifecycle:${context.logicalOperationId}:${toLifecycle}`,jsonSafe({componentId:component.id,fromLifecycle:component.lifecycle,toLifecycle,reason,evidenceDigest}),jsonSafe({fromLifecycle:component.lifecycle,toLifecycle,operationalState:operational,recertificationState:recertification}));
  const updated=(await client.query(`UPDATE kcml.component SET lifecycle=$2,operational_state=$3,recertification_state=$4,logical_operation_id=$5,correlation_id=$6,latest_transition_operation_id=$5,
    state_version=state_version+1,aggregate_event_sequence=aggregate_event_sequence+1,updated_at=clock_timestamp(),application_deployment_epoch=$7 WHERE id=$1 RETURNING *`,
  [component.id,toLifecycle,operational,recertification,context.logicalOperationId,context.correlationId,context.applicationDeploymentEpoch.toString()])).rows[0] as Record<string,unknown>;
  const historyPayload={componentId:component.id,fromLifecycle:component.lifecycle,toLifecycle,operationalState:operational,recertificationState:recertification,reason,evidenceDigest,stateVersion:String(updated.state_version),aggregateEventSequence:String(updated.aggregate_event_sequence)};
  await client.query(`INSERT INTO kcml.component_state_history(component_id,lifecycle_state,operational_state,recertification_state,reason,recorded_at,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,clock_timestamp(),$6,$7,$8,$9,$10,$11)`,[component.id,toLifecycle,operational,recertification,reason,digestBytes(historyPayload),context.logicalOperationId,context.correlationId,String(component.current_activation_epoch??0),context.platformIncarnationId,context.applicationDeploymentEpoch.toString()]);
  return updated;
}

export async function executeExactComponentMutation(client: DatabaseClient, context: ComponentOperationContext): Promise<unknown> {
  if (context.operationName === 'component.register') {
    if (context.targetId) throw new DomainError('AGENTIC_DYNAMIC_TARGET_UNBOUND', 'Component registration creates a new aggregate', 422, 'DO_NOT_RETRY');
    const parsed = registerSchema.safeParse(context.arguments);
    if (!parsed.success) throw new DomainError('OPERATION_CONTRACT_INCOMPLETE', 'Component registration arguments do not match the exact contract', 422, 'DO_NOT_RETRY', parsed.error.issues);
    const input = parsed.data;
    const id = randomUUID();
    const canonicalPayload = {
      id,
      stableKey: input.stableKey,
      kcmlNumber: input.kcmlNumber,
      code: input.code,
      hostname: input.hostname ?? null,
      displayName: input.displayName,
      description: input.description ?? null,
      category: input.category,
      role: input.role,
      contacts: input.contacts,
      criticality: input.criticality,
      runtimeIdentityKind: input.runtimeIdentityKind,
      lifecycle: 'DRAFT',
      activationState: 'INACTIVE',
      operationalState: 'UNKNOWN',
      monitoringState: 'NOT_CONFIGURED',
      recertificationState: 'NOT_DUE'
    };
    try {
      return (await client.query(`INSERT INTO kcml.component(
        id,stable_key,kcml_number,code,hostname,display_name,description,category,role,contacts,criticality,runtime_identity_kind,
        lifecycle,activation_state,operational_state,monitoring_state,recertification_state,enabled,ingress_enabled,pulse_enabled,egress_enabled,
        canonical_digest,logical_operation_id,correlation_id,platform_incarnation_id,application_deployment_epoch)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'DRAFT','INACTIVE','UNKNOWN','NOT_CONFIGURED','NOT_DUE',false,false,false,false,$13,$14,$15,$16,$17)
        RETURNING *`, [
        id,input.stableKey,input.kcmlNumber,input.code,input.hostname ?? null,input.displayName,input.description ?? null,input.category,input.role,JSON.stringify(input.contacts),input.criticality,input.runtimeIdentityKind,
        digestBytes(canonicalPayload),context.logicalOperationId,context.correlationId,context.platformIncarnationId,context.applicationDeploymentEpoch.toString()
      ])).rows[0];
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') throw new DomainError('IDEMPOTENCY_CONFLICT', 'Component stable key, KCML number, code or hostname already exists', 409, 'DO_NOT_RETRY');
      throw error;
    }
  }

  if (context.operationName === 'component.heartbeat') {
    if (!context.targetId) throw new DomainError('AGENTIC_DYNAMIC_TARGET_UNBOUND', 'Heartbeat requires an exact component target', 422, 'DO_NOT_RETRY');
    const parsed=heartbeatSchema.safeParse(context.arguments);
    if(!parsed.success)throw new DomainError('OPERATION_CONTRACT_INCOMPLETE','Heartbeat payload does not match the exact KCIP contract',422,'DO_NOT_RETRY',parsed.error.issues);
    const input=parsed.data;
    const component=(await client.query(`SELECT * FROM kcml.component WHERE id=$1 FOR UPDATE`,[context.targetId])).rows[0] as Record<string,unknown>|undefined;
    if(!component)throw new DomainError('KCIP_TARGET_NOT_FOUND','Heartbeat component does not exist',404,'DO_NOT_RETRY');
    if(input.componentCode!==component.code)throw new DomainError('OPERATION_CONTRACT_INCOMPLETE','Heartbeat componentCode does not match the target component',409,'DO_NOT_RETRY');
    const payload=jsonSafe({...input,runtimeGeneration:input.runtimeGeneration.toString(),activationEpoch:input.activationEpoch.toString(),heartbeatSequence:input.heartbeatSequence.toString()});
    const eventKey=`heartbeat:${context.targetId}:${input.runtimeGeneration}:${input.heartbeatSequence}`;
    const runtime=(await client.query(`SELECT * FROM kcml.runtime_instance WHERE id=$1 AND component_id=$2 FOR UPDATE`,[input.runtimeId,context.targetId])).rows[0];
    const lineageCurrent=Boolean(runtime)
      && String(component.current_release_id)===input.releaseId
      && String(component.active_binding_set_revision_id)===input.bindingSetRevision
      && BigInt(String(component.current_activation_epoch))===input.activationEpoch
      && String(runtime.release_id)===input.releaseId
      && String(runtime.binding_set_revision_id)===input.bindingSetRevision
      && BigInt(runtime.runtime_generation)===input.runtimeGeneration
      && BigInt(runtime.activation_epoch)===input.activationEpoch
      && String(runtime.platform_incarnation_id)===context.platformIncarnationId
      && BigInt(runtime.application_deployment_epoch)===context.applicationDeploymentEpoch;
    const event=await appendComponentAuditEvent(client,context,component,eventKey,payload,{lineageCurrent,operationalState:input.operationalState,ready:input.ready});
    if(event.duplicate)return {eventId:event.id,duplicate:true,stale:!lineageCurrent,projected:false};
    let projected=false;
    if(lineageCurrent&&input.heartbeatSequence>BigInt(runtime.heartbeat_sequence)){
      await client.query(`UPDATE kcml.runtime_instance SET heartbeat_sequence=$2,heartbeat_at=clock_timestamp(),effective_state=CASE WHEN $3 THEN effective_state ELSE 'DEGRADED' END,state_version=state_version+1 WHERE id=$1`,[runtime.id,input.heartbeatSequence.toString(),input.ready]);
      if(component.operational_state!==input.operationalState){
        await client.query(`UPDATE kcml.component SET operational_state=$2,monitoring_state=CASE WHEN $3 THEN 'HEALTHY' ELSE 'DEGRADED' END,logical_operation_id=$4,correlation_id=$5,
          latest_transition_operation_id=$4,state_version=state_version+1,aggregate_event_sequence=aggregate_event_sequence+1,updated_at=clock_timestamp() WHERE id=$1`,[context.targetId,input.operationalState,input.ready,context.logicalOperationId,context.correlationId]);
        const historyPayload={componentId:context.targetId,lifecycleState:component.lifecycle,operationalState:input.operationalState,recertificationState:component.recertification_state,reason:'CURRENT_HEARTBEAT_PROJECTION',eventId:event.id};
        await client.query(`INSERT INTO kcml.component_state_history(component_id,lifecycle_state,operational_state,recertification_state,reason,recorded_at,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
          VALUES($1,$2,$3,$4,$5,clock_timestamp(),$6,$7,$8,$9,$10,$11)`,[context.targetId,component.lifecycle,input.operationalState,component.recertification_state,'CURRENT_HEARTBEAT_PROJECTION',digestBytes(historyPayload),context.logicalOperationId,context.correlationId,input.activationEpoch.toString(),context.platformIncarnationId,context.applicationDeploymentEpoch.toString()]);
        projected=true;
      }
    }
    return {eventId:event.id,duplicate:false,stale:!lineageCurrent,projected,acceptedSequence:input.heartbeatSequence.toString()};
  }

  if(context.operationName==='component.state.report'){
    if(!context.targetId)throw new DomainError('AGENTIC_DYNAMIC_TARGET_UNBOUND','State report requires an exact component target',422,'DO_NOT_RETRY');
    const parsed=componentStateReportSchema.safeParse(context.arguments);if(!parsed.success)throw new DomainError('STATE_MACHINE_CONTRACT_INCOMPLETE','State report does not match the exact observation contract',422,'DO_NOT_RETRY',parsed.error.issues);
    const component=(await client.query(`SELECT * FROM kcml.component WHERE id=$1 FOR UPDATE`,[context.targetId])).rows[0] as Record<string,unknown>|undefined;if(!component)throw new DomainError('KCIP_TARGET_NOT_FOUND','State-report component does not exist',404,'DO_NOT_RETRY');
    const results=[];
    for(const observation of parsed.data.observations){
      const contract=(await client.query(`SELECT * FROM kcml.component_state_contract WHERE component_id=$1 AND revision_id=$2 AND state_key=$3 AND lifecycle='ACTIVE' AND deleted_at IS NULL`,[context.targetId,component.active_revision_id,observation.stateKey])).rows[0];
      if(!contract)throw new DomainError('STATE_MACHINE_CONTRACT_INCOMPLETE',`No active state contract exists for ${observation.stateKey}`,422,'DO_NOT_RETRY');
      if(`sha256:${Buffer.from(contract.contract_digest).toString('hex')}`!==observation.schemaDigest)throw new DomainError('RUNTIME_DIGEST_MISMATCH','State report schema digest is not current',409,'DO_NOT_RETRY');
      const payloadDigest=canonicalDigest(jsonSafe(observation.payload));if(payloadDigest!==observation.payloadDigest)throw new DomainError('RUNTIME_DIGEST_MISMATCH','State report payload digest is invalid',422,'DO_NOT_RETRY');
      if(!validateBoundedStatePayload(contract.schema,observation.payload))throw new DomainError('MODEL_OUTPUT_SCHEMA_INVALID','State report payload violates its exact bounded schema',422,'DO_NOT_RETRY');
      const runtime=(await client.query(`SELECT * FROM kcml.runtime_instance WHERE id=$1 AND component_id=$2 FOR UPDATE`,[observation.runtimeId,context.targetId])).rows[0];
      const lineageCurrent=Boolean(runtime)&&String(component.current_release_id)===observation.releaseId&&String(component.active_binding_set_revision_id)===observation.bindingSetRevisionId&&BigInt(String(component.current_activation_epoch))===observation.activationEpoch&&String(runtime.release_id)===observation.releaseId&&BigInt(runtime.runtime_generation)===observation.runtimeGeneration&&BigInt(runtime.activation_epoch)===observation.activationEpoch;
      const payload=jsonSafe({...observation,runtimeGeneration:observation.runtimeGeneration.toString(),activationEpoch:observation.activationEpoch.toString(),sourceSequence:observation.sourceSequence.toString()});
      const event=await appendComponentAuditEvent(client,context,component,`state:${context.targetId}:${observation.runtimeGeneration}:${observation.sourceSequence}:${observation.stateKey}`,payload,{lineageCurrent,stateKey:observation.stateKey});
      let projected=false;
      if(lineageCurrent&&!event.duplicate&&typeof observation.payload==='object'&&observation.payload!==null&&!Array.isArray(observation.payload)){
        const value=(observation.payload as JsonObject).value;
        const projection=observation.stateKey==='operational'?['operational_state',['UNKNOWN','DISABLED','HEALTHY','DEGRADED','UNHEALTHY','MAINTENANCE','QUARANTINED','RETIRED']]
          :observation.stateKey==='monitoring'?['monitoring_state',['NOT_CONFIGURED','PENDING','HEALTHY','DEGRADED','FAILED']]
          :observation.stateKey==='recertification'?['recertification_state',['NOT_DUE','DUE','OVERDUE','IN_REVIEW','PASSED','FAILED']]:null;
        if(projection&&typeof value==='string'&&(projection[1] as string[]).includes(value)&&component[projection[0] as string]!==value){
          const column=projection[0] as string;await client.query(`UPDATE kcml.component SET ${column}=$2,logical_operation_id=$3,correlation_id=$4,latest_transition_operation_id=$3,state_version=state_version+1,aggregate_event_sequence=aggregate_event_sequence+1,updated_at=clock_timestamp() WHERE id=$1`,[context.targetId,value,context.logicalOperationId,context.correlationId]);projected=true;component[column]=value;
        }
      }
      results.push({stateKey:observation.stateKey,eventId:event.id,duplicate:event.duplicate,stale:!lineageCurrent,projected});
    }
    return {componentId:context.targetId,observations:results};
  }

  if(context.operationName==='component.suspend'){
    if(!context.targetId)throw new DomainError('AGENTIC_DYNAMIC_TARGET_UNBOUND','Suspend requires an exact component target',422,'DO_NOT_RETRY');const parsed=componentSuspendSchema.safeParse(context.arguments);if(!parsed.success)throw new DomainError('OPERATION_CONTRACT_INCOMPLETE','Suspend arguments are invalid',422,'DO_NOT_RETRY',parsed.error.issues);
    const component=await lockComponent(client,context.targetId,context.expectedStateVersion);if(component.lifecycle!=='ACTIVE')throw new DomainError('STATE_MACHINE_CONTRACT_INCOMPLETE','Only ACTIVE component can be suspended',409,'DO_NOT_RETRY');
    await setComponentAdmissionBarrier(client,context,context.targetId,'CLOSED');return transitionComponentLifecycle(client,context,component,'SUSPENDED',parsed.data.reason,parsed.data.evidenceDigest,{operational_state:'MAINTENANCE'});
  }

  if(context.operationName==='component.quarantine'){
    if(!context.targetId)throw new DomainError('AGENTIC_DYNAMIC_TARGET_UNBOUND','Quarantine requires an exact component target',422,'DO_NOT_RETRY');const parsed=componentQuarantineSchema.safeParse(context.arguments);if(!parsed.success)throw new DomainError('OPERATION_CONTRACT_INCOMPLETE','Quarantine arguments are invalid',422,'DO_NOT_RETRY',parsed.error.issues);
    const component=await lockComponent(client,context.targetId,context.expectedStateVersion);if(!['ACTIVE','SUSPENDED'].includes(String(component.lifecycle)))throw new DomainError('STATE_MACHINE_CONTRACT_INCOMPLETE','Only ACTIVE or SUSPENDED component can be quarantined',409,'DO_NOT_RETRY');
    await setComponentAdmissionBarrier(client,context,context.targetId,'CLOSED');return transitionComponentLifecycle(client,context,component,'QUARANTINED',parsed.data.reason,parsed.data.evidenceDigest,{operational_state:'QUARANTINED',recertification_state:'DUE'});
  }

  if(context.operationName==='component.restore'){
    if(!context.targetId)throw new DomainError('AGENTIC_DYNAMIC_TARGET_UNBOUND','Restore requires an exact component target',422,'DO_NOT_RETRY');const parsed=componentRestoreSchema.safeParse(context.arguments);if(!parsed.success)throw new DomainError('OPERATION_CONTRACT_INCOMPLETE','Restore arguments are invalid',422,'DO_NOT_RETRY',parsed.error.issues);
    const component=await lockComponent(client,context.targetId,context.expectedStateVersion);
    if(component.lifecycle==='QUARANTINED'&&parsed.data.targetLifecycle==='SUSPENDED'){await setComponentAdmissionBarrier(client,context,context.targetId,'CLOSED');return transitionComponentLifecycle(client,context,component,'SUSPENDED',parsed.data.reason,parsed.data.evidenceDigest,{operational_state:'MAINTENANCE'});}
    if(component.lifecycle==='SUSPENDED'&&parsed.data.targetLifecycle==='ACTIVE'){
      if(component.activation_state!=='ACTIVE'||!component.enabled)throw new DomainError('ACTIVATION_EPOCH_STALE','Restore to ACTIVE requires current effective activation',409,'DO_NOT_RETRY');await assertCurrentReadiness(client,context.targetId,component.current_release_id);await setComponentAdmissionBarrier(client,context,context.targetId,'OPEN');return transitionComponentLifecycle(client,context,component,'ACTIVE',parsed.data.reason,parsed.data.evidenceDigest,{operational_state:'HEALTHY'});
    }
    throw new DomainError('OPERATION_CONTRACT_INCOMPLETE',`Restore cannot transition ${String(component.lifecycle)} to ${parsed.data.targetLifecycle}`,409,'DO_NOT_RETRY');
  }

  if(context.operationName==='component.recertify'){
    if(!context.targetId)throw new DomainError('AGENTIC_DYNAMIC_TARGET_UNBOUND','Recertification requires an exact component target',422,'DO_NOT_RETRY');const parsed=componentRecertifySchema.safeParse(context.arguments);if(!parsed.success)throw new DomainError('OPERATION_CONTRACT_INCOMPLETE','Recertification arguments are invalid',422,'DO_NOT_RETRY',parsed.error.issues);
    const component=await lockComponent(client,context.targetId,context.expectedStateVersion);if(component.lifecycle!=='QUARANTINED')throw new DomainError('STATE_MACHINE_CONTRACT_INCOMPLETE','Recertification activation requires QUARANTINED lifecycle',409,'DO_NOT_RETRY');if(component.activation_state!=='ACTIVE'||!component.enabled)throw new DomainError('ACTIVATION_EPOCH_STALE','Recertification requires current effective activation',409,'DO_NOT_RETRY');
    await assertCurrentReadiness(client,context.targetId,component.current_release_id);await setComponentAdmissionBarrier(client,context,context.targetId,'OPEN');return transitionComponentLifecycle(client,context,component,'ACTIVE',parsed.data.reason,parsed.data.evidenceDigest,{operational_state:'HEALTHY',recertification_state:'PASSED'});
  }

  if(context.operationName==='component.deregister'){
    if(!context.targetId)throw new DomainError('AGENTIC_DYNAMIC_TARGET_UNBOUND','Deregistration requires an exact component target',422,'DO_NOT_RETRY');const parsed=componentDeregisterSchema.safeParse(context.arguments);if(!parsed.success)throw new DomainError('OPERATION_CONTRACT_INCOMPLETE','Deregistration arguments are invalid',422,'DO_NOT_RETRY',parsed.error.issues);
    let component=await lockComponent(client,context.targetId,context.expectedStateVersion);
    if(component.lifecycle!=='RETIRED')throw new DomainError('STATE_MACHINE_CONTRACT_INCOMPLETE','Deregistration only finalizes the normative RETIRED to DEREGISTERED edge after retirement closure',409,'DO_NOT_RETRY');
    await setComponentAdmissionBarrier(client,context,context.targetId,'CLOSED');
    const currentAdmission=(await client.query(`UPDATE kcml.domain_command_activation_domain relation SET state='TERMINAL',terminal_at=clock_timestamp(),state_version=relation.state_version+1,updated_at=clock_timestamp()
      FROM kcml.domain_command command WHERE relation.domain_command_id=command.id AND command.logical_operation_id=$1 AND relation.state='ADMITTED' RETURNING relation.activation_domain_id`,[context.logicalOperationId])).rows[0];
    if(currentAdmission)await client.query(`UPDATE kcml.activation_domain_head SET pending_mutating_operation_count=pending_mutating_operation_count-1,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND pending_mutating_operation_count>0`,[currentAdmission.activation_domain_id]);
    await client.query(`SELECT id FROM kcml.runtime_instance WHERE component_id=$1 ORDER BY id FOR UPDATE`,[context.targetId]);
    await client.query(`SELECT id FROM kcml.component_contract_binding WHERE source_component_id=$1 OR target_component_id=$1 ORDER BY id FOR UPDATE`,[context.targetId]);
    await client.query(`SELECT id FROM kcml.concurrency_claim WHERE scope_key IN ($1,$2) AND released_at IS NULL ORDER BY id FOR UPDATE`,[context.targetId,`component:${context.targetId}`]);
    await client.query(`SELECT s.id FROM kcml.side_effect_operation s JOIN kcml.domain_command d ON d.id=s.command_id WHERE d.target_id=$1 ORDER BY s.id FOR UPDATE OF s`,[context.targetId]);
    const inventory=(await client.query(`SELECT
      count(*) FILTER (WHERE r.effective_state NOT IN ('STOPPED','FAILED'))::int AS authority_runtime_count,
      count(*) FILTER (WHERE p.id IS NOT NULL AND p.exited_at IS NULL)::int AS live_process_count
      FROM kcml.runtime_instance r LEFT JOIN kcml.runtime_process_identity p ON p.runtime_instance_id=r.id AND p.exited_at IS NULL WHERE r.component_id=$1`,[context.targetId])).rows[0];
    const activeBindingCount=Number((await client.query(`SELECT count(*)::int AS count FROM kcml.component_contract_binding WHERE (source_component_id=$1 OR target_component_id=$1) AND lifecycle='ACTIVE' AND retired_at IS NULL AND deleted_at IS NULL`,[context.targetId])).rows[0]?.count??0);
    const activeClaimCount=Number((await client.query(`SELECT count(*)::int AS count FROM kcml.concurrency_claim WHERE scope_key IN ($1,$2) AND released_at IS NULL AND logical_operation_id<>$3`,[context.targetId,`component:${context.targetId}`,context.logicalOperationId])).rows[0]?.count??0);
    const pendingSideEffectCount=Number((await client.query(`SELECT count(*)::int AS count FROM kcml.side_effect_operation s JOIN kcml.domain_command d ON d.id=s.command_id WHERE d.target_id=$1 AND s.status NOT IN ('CONFIRMED_APPLIED','CONFIRMED_NOT_APPLIED','FAILED_FINAL')`,[context.targetId])).rows[0]?.count??0);
    const otherCommandCount=Number((await client.query(`SELECT count(*)::int AS count FROM kcml.domain_command WHERE target_id=$1 AND logical_operation_id<>$2 AND status NOT IN ('SUCCEEDED','FAILED_FINAL','CANCELLED_FINAL')`,[context.targetId,context.logicalOperationId])).rows[0]?.count??0);
    const barrier=(await client.query(`SELECT barrier_state,pending_mutating_operation_count,state_version FROM kcml.activation_domain_head WHERE domain_key=$1 FOR UPDATE`,[`component:${context.targetId}`])).rows[0];
    const auditStream=(await client.query(`SELECT last_sequence,integrity_state,state_version FROM kcml.component_audit_stream WHERE component_id=$1 FOR UPDATE`,[context.targetId])).rows[0];
    const predicateResults={
      passed: component.active_revision_id===null&&component.current_release_id===null&&component.active_binding_set_revision_id===null&&BigInt(String(component.current_activation_epoch))===0n&&component.activation_state!=='ACTIVE'&&!component.enabled&&!component.ingress_enabled&&!component.pulse_enabled&&!component.egress_enabled&&
        Number(inventory?.authority_runtime_count??0)===0&&Number(inventory?.live_process_count??0)===0&&activeBindingCount===0&&activeClaimCount===0&&pendingSideEffectCount===0&&otherCommandCount===0&&barrier?.barrier_state==='CLOSED'&&Number(barrier?.pending_mutating_operation_count??0)===0&&(!auditStream||auditStream.integrity_state==='VALID'),
      componentRetiredWithoutActivePointerOrRoute:component.active_revision_id===null&&component.current_release_id===null&&component.active_binding_set_revision_id===null&&BigInt(String(component.current_activation_epoch))===0n&&component.activation_state!=='ACTIVE'&&!component.enabled&&!component.ingress_enabled&&!component.pulse_enabled&&!component.egress_enabled,
      authorityRuntimeCount:Number(inventory?.authority_runtime_count??0),liveProcessCount:Number(inventory?.live_process_count??0),activeBindingCount,activeClaimCount,pendingSideEffectCount,otherCommandCount,
      admissionBarrierClosed:barrier?.barrier_state==='CLOSED'&&Number(barrier?.pending_mutating_operation_count??0)===0,auditStreamValid:!auditStream||auditStream.integrity_state==='VALID'
    };
    if(!predicateResults.passed)throw new DomainError('CLOSURE_PREDICATE_INCOMPLETE','Deregistration closure predicate did not pass against authoritative PostgreSQL state',409,'DO_NOT_RETRY',predicateResults);
    const inventoryWatermarks={runtimeRows:Number((await client.query(`SELECT count(*)::int AS count FROM kcml.runtime_instance WHERE component_id=$1`,[context.targetId])).rows[0]?.count??0),bindingRows:Number((await client.query(`SELECT count(*)::int AS count FROM kcml.component_contract_binding WHERE source_component_id=$1 OR target_component_id=$1`,[context.targetId])).rows[0]?.count??0),auditLastSequence:String(auditStream?.last_sequence??0),componentStateVersion:String(component.state_version),componentEventSequence:String(component.aggregate_event_sequence),barrierStateVersion:String(barrier?.state_version??0)};
    const closureEvidence={catalog:componentClosureQueryCatalog,inventoryWatermarks,predicateResults,componentId:context.targetId,terminalStateVersion:(BigInt(String(component.state_version))+1n).toString()};
    const closureResultDigest=digestBytes(closureEvidence);const closureCatalogDigest=digestBytes(componentClosureQueryCatalog);
    await client.query(`INSERT INTO kcml.terminal_closure_evidence(terminal_root_kind,terminal_root_id,terminal_state_version,closure_version,blocking_query_catalog_digest,inventory_watermarks,predicate_results,result_digest,logical_operation_id,correlation_id,platform_incarnation_id,application_deployment_epoch)
      VALUES('COMPONENT',$1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10)`,[context.targetId,(BigInt(String(component.state_version))+1n).toString(),closureCatalogDigest,inventoryWatermarks,predicateResults,closureResultDigest,context.logicalOperationId,context.correlationId,context.platformIncarnationId,context.applicationDeploymentEpoch.toString()]);
    const terminalPayload={componentId:context.targetId,fromLifecycle:'RETIRED',toLifecycle:'DEREGISTERED',reason:parsed.data.reason,evidenceDigest:parsed.data.evidenceDigest,closureResultDigest:`sha256:${closureResultDigest.toString('hex')}`};
    await appendComponentAuditEvent(client,context,component,`lifecycle:${context.logicalOperationId}:DEREGISTERED`,jsonSafe(terminalPayload),jsonSafe({fromLifecycle:'RETIRED',toLifecycle:'DEREGISTERED'}));
    component=(await client.query(`UPDATE kcml.component SET lifecycle='DEREGISTERED',deregistered_at=clock_timestamp(),logical_operation_id=$2,correlation_id=$3,latest_transition_operation_id=$2,state_version=state_version+1,aggregate_event_sequence=aggregate_event_sequence+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *`,[context.targetId,context.logicalOperationId,context.correlationId])).rows[0];
    await client.query(`INSERT INTO kcml.component_state_history(component_id,lifecycle_state,operational_state,recertification_state,reason,recorded_at,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch) VALUES($1,'DEREGISTERED','RETIRED',$2,$3,clock_timestamp(),$4,$5,$6,0,$7,$8)`,[context.targetId,component.recertification_state,parsed.data.reason,digestBytes(terminalPayload),context.logicalOperationId,context.correlationId,context.platformIncarnationId,context.applicationDeploymentEpoch.toString()]);
    return component;
  }

  if (context.operationName === 'component.revision.publish') {
    if (!context.targetId) throw new DomainError('AGENTIC_DYNAMIC_TARGET_UNBOUND', 'Revision publication requires a component target', 422, 'DO_NOT_RETRY');
    const parsed = revisionPublishSchema.safeParse(context.arguments);
    if (!parsed.success) throw new DomainError('OPERATION_CONTRACT_INCOMPLETE', 'Component revision arguments do not match the exact contract', 422, 'DO_NOT_RETRY', parsed.error.issues);
    const input = parsed.data;
    const component = await lockComponent(client, context.targetId, context.expectedStateVersion);
    if (!['DRAFT','REVIEW'].includes(String(component.lifecycle))) throw new DomainError('STATE_MACHINE_CONTRACT_INCOMPLETE', 'Revision can only be published while component is DRAFT or REVIEW', 409, 'DO_NOT_RETRY');
    if (Object.keys(input.canonicalManifest).length === 0) throw new DomainError('OPERATION_CONTRACT_INCOMPLETE', 'Canonical component manifest cannot be empty', 422, 'DO_NOT_RETRY');
    const revisionId = randomUUID();
    const manifestDigest = digestBytes(input.canonicalManifest);
    const validationEvidence = { validator: 'KCML_COMPONENT_MANIFEST_V1', schemaValid: true, manifestDigest: `sha256:${manifestDigest.toString('hex')}` };
    const canonicalPayload = { componentId: context.targetId, revisionId, semanticVersion: input.semanticVersion, canonicalManifest: input.canonicalManifest, sourceProvenance: input.sourceProvenance, validationEvidence };
    let revision: unknown;
    try {
      revision = (await client.query(`INSERT INTO kcml.component_revision(
        id,parent_id,component_id,stable_key,display_name,semantic_version,canonical_manifest,manifest_digest,source_provenance,
        validation_state,validation_evidence,verification_state,verification_evidence,canonical_digest,logical_operation_id,correlation_id,platform_incarnation_id,application_deployment_epoch)
        VALUES($1,$2,$2,$3,$4,$5,$6,$7,$8,'VALID',$9,'PENDING',$10,$11,$12,$13,$14,$15) RETURNING *`, [
        revisionId,context.targetId,`${String(component.stable_key)}@${input.semanticVersion}`,`${String(component.display_name)} ${input.semanticVersion}`,input.semanticVersion,input.canonicalManifest,manifestDigest,input.sourceProvenance,
        validationEvidence,{reason:'ACTIVATION_VERIFICATION_NOT_EXECUTED'},digestBytes(canonicalPayload),context.logicalOperationId,context.correlationId,context.platformIncarnationId,context.applicationDeploymentEpoch.toString()
      ])).rows[0];
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') throw new DomainError('REVISION_STALE', 'Semantic version or manifest digest already exists for this component', 409, 'DO_NOT_RETRY');
      throw error;
    }
    await client.query(`UPDATE kcml.component SET lifecycle=CASE WHEN lifecycle='REVIEW' THEN 'DRAFT' ELSE lifecycle END,
      latest_transition_operation_id=$2,logical_operation_id=$2,correlation_id=$3,state_version=state_version+1,
      aggregate_event_sequence=aggregate_event_sequence+1,updated_at=clock_timestamp(),application_deployment_epoch=$4 WHERE id=$1`,
    [context.targetId,context.logicalOperationId,context.correlationId,context.applicationDeploymentEpoch.toString()]);
    return revision;
  }

  throw new DomainError('OPERATION_CONTRACT_INCOMPLETE', `No exact component mutation handler exists for ${context.operationName}`, 501, 'DO_NOT_RETRY');
}
