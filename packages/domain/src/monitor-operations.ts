import { randomUUID } from 'node:crypto';
import type { DatabaseClient, DatabasePool } from '@kcml/database';
import { allocateContiguousSequence, inTransaction } from '@kcml/database';
import { canonicalDigest, canonicalJson, type CanonicalJsonValue } from '@kcml/schemas';
import { z } from 'zod';
import { DomainError } from './errors.js';

type JsonObject = Record<string, unknown>;
type AlertRow = Record<string, any>;

function jsonSafe(value: unknown): CanonicalJsonValue {
  return JSON.parse(JSON.stringify(value, (_key,item)=>typeof item==='bigint'?item.toString():item)) as CanonicalJsonValue;
}
function digestBytes(value: unknown): Buffer { return Buffer.from(canonicalDigest(jsonSafe(value)).slice('sha256:'.length),'hex'); }
function digestInput(value:string):Buffer{return Buffer.from(value.slice('sha256:'.length),'hex');}
function iso(value:unknown):string|null{return value===null||value===undefined?null:new Date(value as string|number|Date).toISOString();}

const digestSchema=z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const openSchema=z.object({
  sourceObjectType:z.string().min(1).max(128),sourceObjectId:z.string().uuid(),alertType:z.string().min(1).max(256),conditionDigest:digestSchema,
  severity:z.enum(['WARNING','HIGH','CRITICAL']),title:z.string().min(1).max(512),detail:z.string().min(1).max(20_000),evidence:z.record(z.string(),z.unknown()),
  observedAt:z.string().datetime({offset:true}),sourceSequence:z.coerce.bigint().positive(),sourceReleaseId:z.string().uuid().nullable().optional(),
  sourceActivationEpoch:z.coerce.bigint().nonnegative(),recommendedAction:z.record(z.string(),z.unknown()).nullable().optional(),repairReference:z.string().min(1).max(1024).nullable().optional()
}).strict();
const observeSchema=z.object({
  action:z.literal('OBSERVE'),conditionDigest:digestSchema,severity:z.enum(['WARNING','HIGH','CRITICAL']).optional(),title:z.string().min(1).max(512).optional(),detail:z.string().min(1).max(20_000).optional(),
  evidence:z.record(z.string(),z.unknown()),observedAt:z.string().datetime({offset:true}),sourceSequence:z.coerce.bigint().positive(),sourceReleaseId:z.string().uuid().nullable().optional(),
  sourceActivationEpoch:z.coerce.bigint().nonnegative(),recommendedAction:z.record(z.string(),z.unknown()).nullable().optional(),repairReference:z.string().min(1).max(1024).nullable().optional()
}).strict();
const acknowledgeSchema=z.object({action:z.literal('ACKNOWLEDGE'),reason:z.string().min(1).max(4000),evidence:z.record(z.string(),z.unknown()).default({})}).strict();
const suppressSchema=z.object({action:z.literal('SUPPRESS'),reason:z.string().min(1).max(4000),suppressedUntil:z.string().datetime({offset:true}),evidence:z.record(z.string(),z.unknown()).default({})}).strict();
const updateSchema=z.discriminatedUnion('action',[observeSchema,acknowledgeSchema,suppressSchema]);
const closeSchema=z.object({conditionDigest:digestSchema,reason:z.string().min(1).max(4000),evidence:z.record(z.string(),z.unknown()),observedAt:z.string().datetime({offset:true}),sourceSequence:z.coerce.bigint().positive(),sourceReleaseId:z.string().uuid().nullable().optional(),sourceActivationEpoch:z.coerce.bigint().nonnegative()}).strict();
const booleanQuerySchema=z.union([z.boolean(),z.enum(['true','false'])]).transform(value=>value===true||value==='true');
const heartbeatObserveSchema=z.object({
  serviceName:z.string().min(1).max(256).optional(),instanceId:z.string().uuid().optional(),includeStale:booleanQuerySchema.default(true),limit:z.coerce.number().int().min(1).max(500).default(200)
}).strict();

export const exactMonitorMutationOperations=new Set(['monitor.alert.open','monitor.alert.update','monitor.alert.close']);
export const exactMonitorQueryOperations=new Set(['monitor.heartbeat.observe']);

export interface MonitorOperationContext {
  operationName:string;targetId:string|null;arguments:JsonObject;expectedStateVersion:bigint|null;logicalOperationId:string;correlationId:string;
  activationEpoch:bigint;platformIncarnationId:string;applicationDeploymentEpoch:bigint;recoveryEpoch:bigint;
}

function alertFingerprint(input:{sourceObjectType:string;sourceObjectId:string;alertType:string;conditionDigest:string}):string{
  return canonicalDigest(jsonSafe({sourceObjectType:input.sourceObjectType,sourceObjectId:input.sourceObjectId,alertType:input.alertType,conditionDigest:input.conditionDigest}));
}
function observationDigest(input:unknown):Buffer{return digestBytes({kind:'MONITOR_ALERT_OBSERVATION',input});}
function canonicalAlert(row:AlertRow):CanonicalJsonValue{
  return jsonSafe({
    id:row.id,episodeId:row.episode_id,sourceObjectType:row.source_object_type,sourceObjectId:row.source_object_id,alertType:row.alert_type,
    conditionDigest:`sha256:${Buffer.from(row.condition_digest).toString('hex')}`,fingerprint:row.fingerprint,severity:row.severity,status:row.status,title:row.title,detail:row.detail,
    evidence:row.evidence,correlationId:row.correlation_id,firstSeenAt:iso(row.first_seen_at),lastSeenAt:iso(row.last_seen_at),occurrenceCount:String(row.occurrence_count),
    latestSourceSequence:String(row.latest_source_sequence),latestObservationDigest:`sha256:${Buffer.from(row.latest_observation_digest).toString('hex')}`,
    sourceReleaseId:row.source_release_id,sourceActivationEpoch:String(row.source_activation_epoch),suppressedUntil:iso(row.suppressed_until),acknowledgedAt:iso(row.acknowledged_at),closedAt:iso(row.closed_at),
    recommendedAction:row.recommended_action,repairReference:row.repair_reference,stateVersion:String(row.state_version),logicalOperationId:row.logical_operation_id,
    platformIncarnationId:row.platform_incarnation_id,applicationDeploymentEpoch:String(row.application_deployment_epoch),recoveryEpoch:String(row.recovery_epoch)
  });
}
async function appendAlertEvidence(client:DatabaseClient,context:MonitorOperationContext,alertId:string,eventType:string,payload:JsonObject,emitDomainEvent:boolean):Promise<void>{
  const safePayload=jsonSafe(payload);const bytes=Buffer.from(canonicalJson(safePayload));
  await client.query(`SELECT * FROM kcml.append_audit_event($1,'SYSTEM','kcml-monitor','OPERATIONAL_ALERT',$2,$3,NULL,$4,$5)`,[eventType,alertId,context.correlationId,safePayload,bytes]);
  if(!emitDomainEvent)return;
  const sequence=await allocateContiguousSequence(client,'TRANSACTIONAL_OUTBOX',alertId,'STREAM_SEQUENCE');
  await client.query(`INSERT INTO kcml.transactional_outbox(stream_key,stream_sequence,purpose,event_type,aggregate_id,payload,payload_digest,recovery_epoch)
    VALUES($1,$2,'DOMAIN_EVENT',$3,$4,$5,$6,$7)`,[`alert:${alertId}`,sequence.toString(),eventType,alertId,safePayload,digestBytes(safePayload),context.recoveryEpoch.toString()]);
}
function assertCurrentActivation(context:MonitorOperationContext,sourceActivationEpoch:bigint):void{
  if(sourceActivationEpoch!==context.activationEpoch)throw new DomainError('ALERT_SOURCE_ACTIVATION_STALE','Alert observation is not from the command-pinned current activation epoch',409,'DO_NOT_RETRY',{sourceActivationEpoch:String(sourceActivationEpoch),currentActivationEpoch:String(context.activationEpoch)});
}
function targetUuid(context:MonitorOperationContext):string{
  if(!context.targetId||!z.string().uuid().safeParse(context.targetId).success)throw new DomainError('ALERT_TARGET_REQUIRED',`${context.operationName} requires an exact alert UUID`,422,'DO_NOT_RETRY');return context.targetId;
}
async function lockAlert(client:DatabaseClient,context:MonitorOperationContext):Promise<AlertRow>{
  const id=targetUuid(context);const row=(await client.query(`SELECT * FROM kcml.operational_alert WHERE id=$1 FOR UPDATE`,[id])).rows[0];
  if(!row)throw new DomainError('ALERT_NOT_FOUND','Operational alert does not exist',404,'DO_NOT_RETRY');
  if(context.expectedStateVersion===null)throw new DomainError('STATE_VERSION_REQUIRED','Alert mutation requires expectedStateVersion',428,'REFRESH_AND_RETRY_NEW_COMMAND');
  if(BigInt(row.state_version)!==context.expectedStateVersion)throw new DomainError('STATE_VERSION_CONFLICT','Alert state changed before command execution',409,'REFRESH_AND_RETRY_NEW_COMMAND');
  if(row.status==='CLOSED')throw new DomainError('ALERT_CLOSED_IMMUTABLE','Closed alert episode is terminal and immutable',409,'DO_NOT_RETRY');
  return row;
}
function assertObservationProgress(row:AlertRow,sourceSequence:bigint,observedAt:string,digest:Buffer):'NEW'|'DUPLICATE'|'STALE'{
  const current=BigInt(row.latest_source_sequence);
  if(sourceSequence<current)return 'STALE';
  if(sourceSequence===current){if(!Buffer.from(row.latest_observation_digest).equals(digest))throw new DomainError('ALERT_OBSERVATION_SEQUENCE_CONFLICT','The same alert source sequence has a different observation digest',409,'DO_NOT_RETRY');return 'DUPLICATE';}
  if(new Date(observedAt).getTime()<new Date(row.last_seen_at).getTime())throw new DomainError('ALERT_OBSERVATION_TIME_REGRESSION','A newer alert source sequence cannot move observed time backwards',409,'DO_NOT_RETRY');
  return 'NEW';
}
async function recordNonAdvancingObservation(client:DatabaseClient,context:MonitorOperationContext,row:AlertRow,disposition:'DUPLICATE'|'STALE',sourceSequence:bigint,observation:Buffer):Promise<unknown>{
  await appendAlertEvidence(client,context,row.id,`monitor.alert.observation.${disposition.toLowerCase()}`,{alertId:row.id,episodeId:row.episode_id,disposition,sourceSequence:String(sourceSequence),currentSourceSequence:String(row.latest_source_sequence),observationDigest:`sha256:${observation.toString('hex')}`,stateVersion:String(row.state_version)},false);
  return {...row,observationDisposition:disposition};
}
async function persistObservation(client:DatabaseClient,context:MonitorOperationContext,row:AlertRow,input:{conditionDigest:string;severity:string;title:string;detail:string;evidence:JsonObject;observedAt:string;sourceSequence:bigint;sourceReleaseId?:string|null|undefined;sourceActivationEpoch:bigint;recommendedAction?:JsonObject|null|undefined;repairReference?:string|null|undefined},observation:Buffer):Promise<unknown>{
  const suppressedExpired=row.status==='SUPPRESSED'&&row.suppressed_until!==null&&new Date(row.suppressed_until).getTime()<=new Date(input.observedAt).getTime();
  const nextStatus=suppressedExpired?(row.acknowledged_at?'ACKNOWLEDGED':'OPEN'):row.status;
  const next:AlertRow={...row,severity:input.severity,status:nextStatus,title:input.title,detail:input.detail,evidence:input.evidence,correlation_id:context.correlationId,last_seen_at:new Date(input.observedAt),occurrence_count:BigInt(row.occurrence_count)+1n,latest_source_sequence:input.sourceSequence,latest_observation_digest:observation,source_release_id:input.sourceReleaseId??null,source_activation_epoch:input.sourceActivationEpoch,suppressed_until:suppressedExpired?null:row.suppressed_until,recommended_action:input.recommendedAction===undefined?row.recommended_action:input.recommendedAction,repair_reference:input.repairReference===undefined?row.repair_reference:input.repairReference,logical_operation_id:context.logicalOperationId,state_version:BigInt(row.state_version)+1n,platform_incarnation_id:context.platformIncarnationId,application_deployment_epoch:context.applicationDeploymentEpoch,recovery_epoch:context.recoveryEpoch};
  next.canonical_digest=digestBytes(canonicalAlert(next));
  const updated=(await client.query(`UPDATE kcml.operational_alert SET severity=$2,status=$3,title=$4,detail=$5,evidence=$6,correlation_id=$7,last_seen_at=$8,occurrence_count=$9,
      latest_source_sequence=$10,latest_observation_digest=$11,source_release_id=$12,source_activation_epoch=$13,suppressed_until=$14,recommended_action=$15,repair_reference=$16,
      logical_operation_id=$17,canonical_digest=$18,state_version=$19,platform_incarnation_id=$20,application_deployment_epoch=$21,recovery_epoch=$22 WHERE id=$1 RETURNING *`,[
    row.id,next.severity,next.status,next.title,next.detail,next.evidence,next.correlation_id,next.last_seen_at,next.occurrence_count.toString(),next.latest_source_sequence.toString(),next.latest_observation_digest,next.source_release_id,next.source_activation_epoch.toString(),next.suppressed_until,next.recommended_action,next.repair_reference,next.logical_operation_id,next.canonical_digest,next.state_version.toString(),next.platform_incarnation_id,next.application_deployment_epoch.toString(),next.recovery_epoch.toString()
  ])).rows[0];
  await appendAlertEvidence(client,context,row.id,'monitor.alert.updated',{alertId:row.id,episodeId:row.episode_id,fromStatus:row.status,toStatus:updated.status,sourceSequence:String(updated.latest_source_sequence),occurrenceCount:String(updated.occurrence_count),stateVersion:String(updated.state_version),observationDigest:`sha256:${observation.toString('hex')}`},true);
  return {...updated,observationDisposition:'APPLIED'};
}

async function openAlert(client:DatabaseClient,context:MonitorOperationContext):Promise<unknown>{
  if(context.targetId!==null)throw new DomainError('ALERT_OPEN_TARGET_FORBIDDEN','monitor.alert.open creates or advances an alert episode by its exact dedupe scope',422,'DO_NOT_RETRY');
  if(context.expectedStateVersion!==null)throw new DomainError('ALERT_OPEN_STATE_VERSION_FORBIDDEN','Alert open does not accept expectedStateVersion before the episode identity is resolved',422,'DO_NOT_RETRY');
  const parsed=openSchema.safeParse(context.arguments);if(!parsed.success)throw new DomainError('ALERT_ARGUMENTS_INVALID','Alert open arguments do not match the exact contract',422,'DO_NOT_RETRY',parsed.error.issues);const input=parsed.data;
  assertCurrentActivation(context,input.sourceActivationEpoch);
  const fingerprint=alertFingerprint(input);const observation=observationDigest(input);
  const latest=(await client.query(`SELECT * FROM kcml.operational_alert WHERE fingerprint=$1 ORDER BY (status<>'CLOSED') DESC,last_seen_at DESC,created_at DESC LIMIT 1 FOR UPDATE`,[fingerprint])).rows[0] as AlertRow|undefined;
  if(latest){
    const disposition=assertObservationProgress(latest,input.sourceSequence,input.observedAt,observation);
    if(disposition!=='NEW')return recordNonAdvancingObservation(client,context,latest,disposition,input.sourceSequence,observation);
    if(latest.status!=='CLOSED')return persistObservation(client,context,latest,input,observation);
  }
  const id=randomUUID(),episodeId=randomUUID();const row:AlertRow={id,episode_id:episodeId,source_object_type:input.sourceObjectType,source_object_id:input.sourceObjectId,alert_type:input.alertType,condition_digest:digestInput(input.conditionDigest),fingerprint,severity:input.severity,status:'OPEN',title:input.title,detail:input.detail,evidence:input.evidence,correlation_id:context.correlationId,first_seen_at:new Date(input.observedAt),last_seen_at:new Date(input.observedAt),occurrence_count:1n,latest_source_sequence:input.sourceSequence,latest_observation_digest:observation,source_release_id:input.sourceReleaseId??null,source_activation_epoch:input.sourceActivationEpoch,suppressed_until:null,acknowledged_at:null,closed_at:null,recommended_action:input.recommendedAction??null,repair_reference:input.repairReference??null,logical_operation_id:context.logicalOperationId,state_version:1n,platform_incarnation_id:context.platformIncarnationId,application_deployment_epoch:context.applicationDeploymentEpoch,recovery_epoch:context.recoveryEpoch};row.canonical_digest=digestBytes(canonicalAlert(row));
  const created=(await client.query(`INSERT INTO kcml.operational_alert(id,episode_id,source_object_type,source_object_id,alert_type,condition_digest,fingerprint,severity,status,title,detail,evidence,correlation_id,
      first_seen_at,last_seen_at,occurrence_count,latest_source_sequence,latest_observation_digest,source_release_id,source_activation_epoch,recommended_action,repair_reference,logical_operation_id,canonical_digest,
      state_version,platform_incarnation_id,application_deployment_epoch,recovery_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'OPEN',$9,$10,$11,$12,$13,$13,1,$14,$15,$16,$17,$18,$19,$20,$21,1,$22,$23,$24) RETURNING *`,[
    id,episodeId,input.sourceObjectType,input.sourceObjectId,input.alertType,row.condition_digest,fingerprint,input.severity,input.title,input.detail,input.evidence,context.correlationId,row.first_seen_at,input.sourceSequence.toString(),observation,input.sourceReleaseId??null,input.sourceActivationEpoch.toString(),input.recommendedAction??null,input.repairReference??null,context.logicalOperationId,row.canonical_digest,context.platformIncarnationId,context.applicationDeploymentEpoch.toString(),context.recoveryEpoch.toString()
  ])).rows[0];
  await appendAlertEvidence(client,context,id,'monitor.alert.opened',{alertId:id,episodeId,sourceObjectType:input.sourceObjectType,sourceObjectId:input.sourceObjectId,alertType:input.alertType,conditionDigest:input.conditionDigest,severity:input.severity,sourceSequence:String(input.sourceSequence),stateVersion:'1',observationDigest:`sha256:${observation.toString('hex')}`},true);
  return {...created,observationDisposition:'APPLIED'};
}

async function updateAlert(client:DatabaseClient,context:MonitorOperationContext):Promise<unknown>{
  const parsed=updateSchema.safeParse(context.arguments);if(!parsed.success)throw new DomainError('ALERT_ARGUMENTS_INVALID','Alert update arguments do not match the exact contract',422,'DO_NOT_RETRY',parsed.error.issues);const input=parsed.data;const row=await lockAlert(client,context);
  if(input.action==='OBSERVE'){
    if(!Buffer.from(row.condition_digest).equals(digestInput(input.conditionDigest)))throw new DomainError('ALERT_CONDITION_MISMATCH','Observation condition digest does not identify the target alert episode',409,'DO_NOT_RETRY');
    assertCurrentActivation(context,input.sourceActivationEpoch);const full={conditionDigest:input.conditionDigest,severity:input.severity??row.severity,title:input.title??row.title,detail:input.detail??row.detail,evidence:input.evidence,observedAt:input.observedAt,sourceSequence:input.sourceSequence,sourceReleaseId:input.sourceReleaseId===undefined?row.source_release_id:input.sourceReleaseId,sourceActivationEpoch:input.sourceActivationEpoch,recommendedAction:input.recommendedAction,repairReference:input.repairReference};const observation=observationDigest(full);const disposition=assertObservationProgress(row,input.sourceSequence,input.observedAt,observation);if(disposition!=='NEW')return recordNonAdvancingObservation(client,context,row,disposition,input.sourceSequence,observation);return persistObservation(client,context,row,full,observation);
  }
  const now=(await client.query(`SELECT clock_timestamp() AS now`)).rows[0].now as Date;
  let status:string,suppressedUntil:Date|null=row.suppressed_until,acknowledgedAt:Date|null=row.acknowledged_at,eventType:string;
  if(input.action==='ACKNOWLEDGE'){
    if(row.status==='ACKNOWLEDGED')throw new DomainError('ALERT_ALREADY_ACKNOWLEDGED','Alert episode is already acknowledged',409,'DO_NOT_RETRY');status='ACKNOWLEDGED';suppressedUntil=null;acknowledgedAt=now;eventType='monitor.alert.acknowledged';
  }else{
    if(row.status==='SUPPRESSED')throw new DomainError('ALERT_ALREADY_SUPPRESSED','Alert episode is already suppressed',409,'DO_NOT_RETRY');suppressedUntil=new Date(input.suppressedUntil);if(suppressedUntil.getTime()<=new Date(now).getTime())throw new DomainError('ALERT_SUPPRESSION_INTERVAL_INVALID','suppressedUntil must be later than the authoritative database time',422,'DO_NOT_RETRY');status='SUPPRESSED';eventType='monitor.alert.suppressed';
  }
  const evidence={lastObservation:row.evidence,stateTransition:{action:input.action,reason:input.reason,evidence:input.evidence,at:new Date(now).toISOString()}};const next:AlertRow={...row,status,evidence,correlation_id:context.correlationId,suppressed_until:suppressedUntil,acknowledged_at:acknowledgedAt,logical_operation_id:context.logicalOperationId,state_version:BigInt(row.state_version)+1n,platform_incarnation_id:context.platformIncarnationId,application_deployment_epoch:context.applicationDeploymentEpoch,recovery_epoch:context.recoveryEpoch};next.canonical_digest=digestBytes(canonicalAlert(next));
  const updated=(await client.query(`UPDATE kcml.operational_alert SET status=$2,evidence=$3,correlation_id=$4,suppressed_until=$5,acknowledged_at=$6,logical_operation_id=$7,canonical_digest=$8,state_version=$9,
      platform_incarnation_id=$10,application_deployment_epoch=$11,recovery_epoch=$12 WHERE id=$1 RETURNING *`,[row.id,status,evidence,context.correlationId,suppressedUntil,acknowledgedAt,context.logicalOperationId,next.canonical_digest,next.state_version.toString(),context.platformIncarnationId,context.applicationDeploymentEpoch.toString(),context.recoveryEpoch.toString()])).rows[0];
  await appendAlertEvidence(client,context,row.id,eventType,{alertId:row.id,episodeId:row.episode_id,fromStatus:row.status,toStatus:status,reason:input.reason,stateVersion:String(updated.state_version),suppressedUntil:iso(updated.suppressed_until),acknowledgedAt:iso(updated.acknowledged_at)},true);return updated;
}

async function closeAlert(client:DatabaseClient,context:MonitorOperationContext):Promise<unknown>{
  const parsed=closeSchema.safeParse(context.arguments);if(!parsed.success)throw new DomainError('ALERT_ARGUMENTS_INVALID','Alert close arguments do not match the exact contract',422,'DO_NOT_RETRY',parsed.error.issues);const input=parsed.data;const row=await lockAlert(client,context);
  if(!Buffer.from(row.condition_digest).equals(digestInput(input.conditionDigest)))throw new DomainError('ALERT_CONDITION_MISMATCH','Close condition digest does not identify the target alert episode',409,'DO_NOT_RETRY');assertCurrentActivation(context,input.sourceActivationEpoch);
  const observation=observationDigest(input);const disposition=assertObservationProgress(row,input.sourceSequence,input.observedAt,observation);if(disposition!=='NEW')throw new DomainError('ALERT_STALE_CLOSE_FORBIDDEN','A duplicate or stale observation cannot close the current alert episode',409,'DO_NOT_RETRY',{disposition,currentSourceSequence:String(row.latest_source_sequence),sourceSequence:String(input.sourceSequence)});
  const now=(await client.query(`SELECT clock_timestamp() AS now`)).rows[0].now as Date;const evidence={lastObservation:row.evidence,closureObservation:input.evidence,reason:input.reason};const next:AlertRow={...row,status:'CLOSED',evidence,correlation_id:context.correlationId,last_seen_at:new Date(input.observedAt),latest_source_sequence:input.sourceSequence,latest_observation_digest:observation,source_release_id:input.sourceReleaseId??null,source_activation_epoch:input.sourceActivationEpoch,suppressed_until:null,closed_at:now,logical_operation_id:context.logicalOperationId,state_version:BigInt(row.state_version)+1n,platform_incarnation_id:context.platformIncarnationId,application_deployment_epoch:context.applicationDeploymentEpoch,recovery_epoch:context.recoveryEpoch};next.canonical_digest=digestBytes(canonicalAlert(next));
  const updated=(await client.query(`UPDATE kcml.operational_alert SET status='CLOSED',evidence=$2,correlation_id=$3,last_seen_at=$4,latest_source_sequence=$5,latest_observation_digest=$6,source_release_id=$7,
      source_activation_epoch=$8,suppressed_until=NULL,closed_at=$9,logical_operation_id=$10,canonical_digest=$11,state_version=$12,platform_incarnation_id=$13,application_deployment_epoch=$14,recovery_epoch=$15 WHERE id=$1 RETURNING *`,[
    row.id,evidence,context.correlationId,next.last_seen_at,input.sourceSequence.toString(),observation,next.source_release_id,input.sourceActivationEpoch.toString(),now,context.logicalOperationId,next.canonical_digest,next.state_version.toString(),context.platformIncarnationId,context.applicationDeploymentEpoch.toString(),context.recoveryEpoch.toString()
  ])).rows[0];
  const pendingDeliveries=Number((await client.query(`SELECT count(*)::int AS count FROM kcml.alert_delivery WHERE alert_id=$1 AND deleted_at IS NULL AND state NOT IN ('DELIVERED','FAILED_FINAL','CLOSED')`,[row.id])).rows[0]?.count??0);
  await appendAlertEvidence(client,context,row.id,'monitor.alert.closed',{alertId:row.id,episodeId:row.episode_id,fromStatus:row.status,toStatus:'CLOSED',reason:input.reason,sourceSequence:String(input.sourceSequence),stateVersion:String(updated.state_version),observationDigest:`sha256:${observation.toString('hex')}`,closureStatus:pendingDeliveries===0?'DOMAIN_TERMINAL':'PENDING_DELIVERY_CLOSURE',pendingDeliveries},true);
  return {...updated,closureStatus:pendingDeliveries===0?'DOMAIN_TERMINAL':'PENDING_DELIVERY_CLOSURE',pendingDeliveries};
}

export async function executeExactMonitorMutation(client:DatabaseClient,context:MonitorOperationContext):Promise<unknown>{
  if(context.operationName==='monitor.alert.open')return openAlert(client,context);
  if(context.operationName==='monitor.alert.update')return updateAlert(client,context);
  if(context.operationName==='monitor.alert.close')return closeAlert(client,context);
  throw new DomainError('MONITOR_OPERATION_NOT_EXACT',`Monitor operation ${context.operationName} has no exact mutation implementation`,500,'DO_NOT_RETRY');
}

function heartbeatIssueList(row:Record<string,any>,now:Date,currentPlatformIncarnationId:string,currentDeploymentEpoch:bigint):string[]{
  const issues:string[]=[];
  if(String(row.platform_incarnation_id)!==currentPlatformIncarnationId)issues.push('PLATFORM_INCARNATION_STALE');
  if(BigInt(row.deployment_epoch)!==currentDeploymentEpoch)issues.push('APPLICATION_DEPLOYMENT_EPOCH_STALE');
  if(BigInt(row.heartbeat_sequence)<=0n)issues.push('HEARTBEAT_SEQUENCE_INVALID');
  if(typeof row.nonce!=='string'||row.nonce.length===0)issues.push('HEARTBEAT_NONCE_MISSING');
  if(new Date(row.observed_at).getTime()>now.getTime())issues.push('HEARTBEAT_TIMESTAMP_IN_FUTURE');
  if(new Date(row.expires_at).getTime()<=now.getTime())issues.push('HEARTBEAT_EXPIRED');
  return issues;
}

function schedulerIssueList(row:Record<string,any>,now:Date,currentPlatformIncarnationId:string,currentDeploymentEpoch:bigint):string[]{
  const issues:string[]=[];
  if(String(row.platform_incarnation_id)!==currentPlatformIncarnationId)issues.push('PLATFORM_INCARNATION_STALE');
  if(BigInt(row.application_deployment_epoch)!==currentDeploymentEpoch)issues.push('APPLICATION_DEPLOYMENT_EPOCH_STALE');
  if(new Date(row.started_at).getTime()>now.getTime())issues.push('SCHEDULER_START_IN_FUTURE');
  if(row.completed_at!==null&&new Date(row.completed_at).getTime()<new Date(row.started_at).getTime())issues.push('SCHEDULER_COMPLETION_BEFORE_START');
  const activeLease=row.lease_owner!==null;
  if(activeLease&&(row.lease_fencing_token===null||row.lease_expires_at===null))issues.push('SCHEDULER_LEASE_INCOMPLETE');
  const freshnessDeadline=activeLease?row.lease_expires_at:row.next_run_at;
  if(freshnessDeadline===null||new Date(freshnessDeadline).getTime()<now.getTime())issues.push('SCHEDULER_HEARTBEAT_STALE');
  return issues;
}

async function observeHeartbeats(pool:DatabasePool,targetId:string|null,args:JsonObject):Promise<unknown>{
  if(targetId!==null)throw new DomainError('MONITOR_HEARTBEAT_TARGET_FORBIDDEN','monitor.heartbeat.observe uses exact service/instance selectors instead of an aggregate target',422,'DO_NOT_RETRY');
  const parsed=heartbeatObserveSchema.safeParse(args);if(!parsed.success)throw new DomainError('MONITOR_HEARTBEAT_ARGUMENTS_INVALID','Heartbeat observation arguments do not match the exact query contract',422,'DO_NOT_RETRY',parsed.error.issues);const input=parsed.data;
  return inTransaction(pool,'REPEATABLE READ',async client=>{
    await client.query('SET TRANSACTION READ ONLY');
    const authority=(await client.query(`SELECT clock_timestamp() AS database_now,p.platform_incarnation_id,d.current_epoch AS application_deployment_epoch,
        r.recovery_epoch,r.state AS recovery_state,r.database_start_identity=kcml.current_database_start_identity() AS database_identity_current,
        r.platform_incarnation_id=p.platform_incarnation_id AND r.application_deployment_epoch=d.current_epoch AS recovery_lineage_current
      FROM kcml.platform_incarnation p CROSS JOIN kcml.application_deployment_head d CROSS JOIN kcml.platform_recovery_head r
      WHERE p.singleton_key=1 AND d.singleton_key=1 AND r.singleton_key=1`)).rows[0];
    if(!authority)throw new DomainError('MONITOR_HEARTBEAT_AUTHORITY_MISSING','Current platform/deployment/recovery authority is unavailable',503,'DO_NOT_RETRY');
    const now=new Date(authority.database_now);const currentPlatformIncarnationId=String(authority.platform_incarnation_id);const currentDeploymentEpoch=BigInt(authority.application_deployment_epoch);
    const workerRows=(await client.query(`SELECT service_name,instance_id,release_id,source_sha,deployment_epoch,status,details,observed_at,expires_at,
        platform_incarnation_id,heartbeat_sequence,nonce
      FROM kcml.platform_worker_heartbeat
      WHERE ($1::text IS NULL OR service_name=$1) AND ($2::uuid IS NULL OR instance_id=$2)
      ORDER BY service_name,instance_id LIMIT $3`,[input.serviceName??null,input.instanceId??null,input.limit])).rows;
    const schedulerRows=(await client.query(`SELECT DISTINCT ON (worker_id) id,worker_id,started_at,completed_at,lease_owner,lease_fencing_token,lease_expires_at,error,next_run_at,
        state_version,activation_epoch,platform_incarnation_id,application_deployment_epoch,updated_at
      FROM kcml.monitoring_scheduler_heartbeat WHERE deleted_at IS NULL ORDER BY worker_id,started_at DESC,id DESC LIMIT $1`,[input.limit])).rows;
    const workers=workerRows.map((row)=>{const issues=heartbeatIssueList(row,now,currentPlatformIncarnationId,currentDeploymentEpoch);const fresh=issues.length===0;return{
      serviceName:row.service_name,instanceId:row.instance_id,releaseId:row.release_id,sourceSha:row.source_sha,applicationDeploymentEpoch:String(row.deployment_epoch),status:row.status,
      metadata:row.details,heartbeatSequence:String(row.heartbeat_sequence),nonce:row.nonce,heartbeatAt:iso(row.observed_at),expiresAt:iso(row.expires_at),platformIncarnationId:row.platform_incarnation_id,
      fresh,ready:fresh&&row.status==='READY',issues
    };}).filter(row=>input.includeStale||row.fresh);
    const scheduler=schedulerRows.map((row)=>{const issues=schedulerIssueList(row,now,currentPlatformIncarnationId,currentDeploymentEpoch);const fresh=issues.length===0;return{
      id:row.id,workerId:row.worker_id,startedAt:iso(row.started_at),completedAt:iso(row.completed_at),leaseOwner:row.lease_owner,leaseFencingToken:row.lease_fencing_token===null?null:String(row.lease_fencing_token),
      leaseExpiresAt:iso(row.lease_expires_at),lastError:row.error,nextRunAt:iso(row.next_run_at),heartbeatAt:iso(row.updated_at),stateVersion:String(row.state_version),activationEpoch:String(row.activation_epoch),
      platformIncarnationId:row.platform_incarnation_id,applicationDeploymentEpoch:String(row.application_deployment_epoch),fresh,issues
    };}).filter(row=>input.includeStale||row.fresh);
    const recoveryReady=authority.recovery_state==='READY'&&authority.database_identity_current===true&&authority.recovery_lineage_current===true;
    const evidence={selectors:{serviceName:input.serviceName??null,instanceId:input.instanceId??null,includeStale:input.includeStale,limit:input.limit},databaseNow:now.toISOString(),
      authority:{platformIncarnationId:currentPlatformIncarnationId,applicationDeploymentEpoch:String(currentDeploymentEpoch),recoveryEpoch:String(authority.recovery_epoch),recoveryState:authority.recovery_state,databaseIdentityCurrent:authority.database_identity_current,recoveryLineageCurrent:authority.recovery_lineage_current,recoveryReady},
      inventory:{workerCount:workers.length,freshWorkerCount:workers.filter(row=>row.fresh).length,readyWorkerCount:workers.filter(row=>row.ready).length,schedulerCount:scheduler.length,freshSchedulerCount:scheduler.filter(row=>row.fresh).length},workers,scheduler};
    return {...evidence,evidenceDigest:canonicalDigest(jsonSafe(evidence))};
  });
}

export async function executeExactMonitorQuery(pool:DatabasePool,operationName:string,targetId:string|null,args:JsonObject):Promise<unknown>{
  if(operationName==='monitor.heartbeat.observe')return observeHeartbeats(pool,targetId,args);
  throw new DomainError('MONITOR_OPERATION_NOT_EXACT',`Monitor operation ${operationName} has no exact query implementation`,500,'DO_NOT_RETRY');
}
