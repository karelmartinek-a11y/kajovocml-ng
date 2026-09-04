import { randomUUID } from 'node:crypto';
import type { DatabaseClient, DatabasePool } from '@kcml/database';
import { allocateContiguousSequence } from '@kcml/database';
import { browserActionNames, validateBrowserActionDescriptor, canonicalDigest, canonicalJson, toCanonicalJsonValue, type BrowserActionName, type CanonicalJsonValue } from '@kcml/schemas';
import { DomainError } from './errors.js';
import { generationWorkerPool, type GenerationPhase } from './generation-lifecycle.js';
import type {
  CanonicalHandlerContext,
  CanonicalMutationHandler,
  CanonicalQueryHandler
} from './canonical-operation-handlers.js';

type JsonObject = Record<string, unknown>;
type Row = Record<string, unknown>;
type ArgumentContext = Pick<CanonicalHandlerContext, 'operation' | 'arguments'>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function json(value: unknown): CanonicalJsonValue {
  return toCanonicalJsonValue(value ?? null);
}

function digest(value: unknown): Buffer {
  return Buffer.from(canonicalDigest(json(value)).slice('sha256:'.length), 'hex');
}

function target(context: CanonicalHandlerContext, reason = 'OPERATION_TARGET_REQUIRED'): string {
  if (!context.targetId || !UUID.test(context.targetId)) throw new DomainError('OPERATION_CONTRACT_INCOMPLETE', `${context.operation.operationName} requires an exact UUID target`, 422, 'DO_NOT_RETRY', { reason });
  return context.targetId;
}

function uuidArg(context: ArgumentContext, key: string, fallback?: string): string {
  const value = context.arguments[key] ?? fallback;
  if (typeof value !== 'string' || !UUID.test(value)) throw new DomainError('TOOL_ARGUMENT_SCHEMA_INVALID', `${key} must be a UUID`, 422, 'DO_NOT_RETRY', { key });
  return value;
}

function textArg(context: ArgumentContext, key: string, fallback?: string): string {
  const value = context.arguments[key] ?? fallback;
  if (typeof value !== 'string' || value.length === 0) throw new DomainError('TOOL_ARGUMENT_SCHEMA_INVALID', `${key} is required for ${context.operation.operationName}`, 422, 'DO_NOT_RETRY', { key });
  return value;
}

function objectArg(context: ArgumentContext | Row, key: string, fallback: JsonObject = {}): JsonObject {
  const value = 'arguments' in context
    ? (context as ArgumentContext).arguments[key]
    : (context as Row)[key];
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : fallback;
}

function listArg(context: ArgumentContext, key: string): string[] {
  const value = context.arguments[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function numberArg(context: ArgumentContext, key: string, fallback = 1): number {
  const value = context.arguments[key] ?? fallback;
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new DomainError('TOOL_ARGUMENT_SCHEMA_INVALID', `${key} must be a non-negative integer`, 422, 'DO_NOT_RETRY', { key });
  return result;
}

function futureArg(context: ArgumentContext, key: string, seconds: number): string {
  const supplied = context.arguments[key];
  const value = supplied === undefined ? new Date(Date.now() + seconds * 1000).toISOString() : textArg(context, key);
  if (!Number.isFinite(new Date(value).getTime()) || new Date(value).getTime() <= Date.now()) throw new DomainError('TOOL_ARGUMENT_SCHEMA_INVALID', `${key} must be a future timestamp`, 422, 'DO_NOT_RETRY', { key });
  return new Date(value).toISOString();
}

function row(result: { rows: Row[] } | Row[], reason: string, message: string): Row {
  const value = (Array.isArray(result) ? result : result.rows)[0];
  if (!value) throw new DomainError('KCIP_TARGET_NOT_FOUND', message, 404, 'DO_NOT_RETRY', { reason });
  return value;
}

function assertVersion(context: CanonicalHandlerContext, value: Row): void {
  if (context.expectedStateVersion !== null && value.state_version !== undefined && BigInt(String(value.state_version)) !== context.expectedStateVersion) {
    throw new DomainError('STATE_VERSION_CONFLICT', 'The authoritative aggregate changed before this operation was applied', 409, 'REFRESH_AND_RETRY_NEW_COMMAND', { currentStateVersion: String(value.state_version) });
  }
}

function result(context: CanonicalHandlerContext, aggregate: string, value: unknown, stateVersion?: unknown, extra: JsonObject = {}): JsonObject {
  return {
    operation: context.operation.operationName,
    aggregate,
    value,
    state_version: stateVersion === undefined ? null : stateVersion,
    evidence: { persisted: true, operation: context.operation.operationName, logicalOperationId: context.logicalOperationId, ...extra }
  };
}

async function recordAudit(client: DatabaseClient, context: CanonicalHandlerContext, aggregateType: string, aggregateId: string, payload: JsonObject): Promise<void> {
  const safePayload = json({ operation: context.operation.operationName, logicalOperationId: context.logicalOperationId, ...payload });
  await client.query(`SELECT * FROM kcml.append_audit_event($1,'OWNER','KRMAR78',$2,$3,$4,NULL,$5,$6)`, [
    `operation.${context.operation.operationName}`,
    aggregateType,
    aggregateId,
    context.correlationId,
    safePayload,
    Buffer.from(canonicalJson(safePayload))
  ]);
}

async function nextSequence(client: DatabaseClient, namespace: string, parentId: string, kind: string): Promise<bigint> {
  return allocateContiguousSequence(client, namespace, parentId, kind);
}

async function sideEffectIntent(client: DatabaseClient, context: CanonicalHandlerContext, targetBinding: string, request: JsonObject): Promise<Row> {
  if (!context.commandId || !UUID.test(context.commandId)) throw new DomainError('TOOL_ARGUMENT_SCHEMA_INVALID', `${context.operation.operationName} must execute in a command transaction`, 409, 'RETRY_SAME_OPERATION');
  const requestDigest = digest(request);
  const operation = row((await client.query(`INSERT INTO kcml.side_effect_operation(command_id,step_key,target_binding,request,request_digest,idempotency_key,side_effect_class,retry_class,reconciliation_contract,platform_incarnation_id,application_deployment_epoch,recovery_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(command_id,step_key) DO UPDATE SET updated_at=clock_timestamp() RETURNING *`, [
    context.commandId,
    context.operation.operationName,
    targetBinding,
    request,
    requestDigest,
    context.logicalOperationId,
    context.operation.sideEffectClass,
    context.operation.retryClass,
    { operation: context.operation.operationName, independentReadBack: true },
    context.platformIncarnationId,
    context.applicationDeploymentEpoch.toString(),
    context.recoveryEpoch.toString()
  ])).rows as Row[], 'SIDE_EFFECT_INTENT_MISSING', 'Side-effect intent was not persisted');
  await client.query(`INSERT INTO kcml.side_effect_attempt(operation_id,attempt_sequence,request_evidence,request_digest)
    VALUES($1,$2,$3,$4) ON CONFLICT(operation_id,attempt_sequence) DO NOTHING`, [operation.id, operation.current_attempt_sequence, request, requestDigest]);
  await client.query(`INSERT INTO kcml.side_effect_attempt_state(operation_id,attempt_sequence,status)
    VALUES($1,$2,'INTENT_RECORDED') ON CONFLICT(operation_id,attempt_sequence) DO NOTHING`, [operation.id, operation.current_attempt_sequence]);
  return operation;
}

async function appendAuditEvent(client: DatabaseClient, context: CanonicalHandlerContext): Promise<Row> {
  const payload = objectArg(context, 'payload');
  const eventId = target(context);
  const audit = (await client.query(`SELECT * FROM kcml.append_audit_event($1,'OWNER','KRMAR78',$2,$3,$4,NULL,$5,$6)`, [
    textArg(context, 'eventType', context.operation.operationName),
    'AUDIT_EVENT',
    eventId,
    context.correlationId,
    payload,
    Buffer.from(canonicalJson(json(payload)))
  ])).rows[0] as Row | undefined;
  if (!audit) throw new DomainError('CLOSURE_PREDICATE_INCOMPLETE', 'The audit append function returned no event', 500, 'RETRY_SAME_OPERATION');
  return audit;
}

// ---------------------------------------------------------------------------
// Agent operations. Each function below locks or appends its own aggregate;
// the dispatch switch at the bottom is intentionally the only name binding.
// ---------------------------------------------------------------------------

async function handleAgentApprovalRequest(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const runId = target(context);
  const run = row((await client.query(`SELECT id,status,state_version FROM kcml.agent_run WHERE id=$1 FOR UPDATE`, [runId])).rows as Row[], 'AGENT_RUN_NOT_FOUND', 'Agent run does not exist');
  const id = randomUUID();
  const args = objectArg(context, 'arguments');
  const expiresAt = futureArg(context, 'expiresAt', 900);
  const inserted = row((await client.query(`INSERT INTO kcml.agent_approval_request(id,root_agent_run_id,target,arguments,arguments_digest,consequence_summary,policy_source,status,expires_at,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,'PENDING',$8,$9,$10,$11,$12,$13,$14) RETURNING *`, [
    id, runId, objectArg(context, 'target'), args, digest(args), textArg(context, 'consequenceSummary', 'Owner approval is required'), objectArg(context, 'policySource'), expiresAt,
    digest({ id, runId, args, logicalOperationId: context.logicalOperationId }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'AGENT_APPROVAL_NOT_CREATED', 'Approval request was not persisted');
  const updatedRun = (await client.query(`UPDATE kcml.agent_run SET status='WAITING_FOR_OWNER',state_version=state_version+1,updated_at=clock_timestamp(),correlation_id=$2 WHERE id=$1 AND state_version=$3 RETURNING *`, [runId, context.correlationId, run.state_version])).rows[0] as Row | undefined;
  if (!updatedRun) throw new DomainError('STATE_VERSION_CONFLICT', 'Agent run changed while requesting approval', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
  await recordAudit(client, context, 'AGENT_APPROVAL_REQUEST', id, { approvalRequestId: id, rootAgentRunId: runId, status: 'PENDING' });
  return result(context, 'agent_approval_request', inserted, inserted.state_version, { transition: 'PENDING', rootRunState: 'WAITING_FOR_OWNER' });
}

async function handleAgentApprovalApprove(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.agent_approval_request WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'AGENT_APPROVAL_NOT_FOUND', 'Approval request does not exist');
  assertVersion(context, current);
  if (current.status !== 'PENDING') throw new DomainError('TERMINAL_STATE_IMMUTABLE', 'Only a pending approval can be approved', 409, 'DO_NOT_RETRY');
  const decision = { decision: 'APPROVED', message: context.arguments.message ?? null, decidedBy: 'KRMAR78' };
  const updated = row((await client.query(`UPDATE kcml.agent_approval_request SET status='APPROVED',owner_decision=$2,decided_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp(),logical_operation_id=$3,correlation_id=$4 WHERE id=$1 AND status='PENDING' AND state_version=$5 RETURNING *`, [id, decision, context.logicalOperationId, context.correlationId, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Approval request changed while being approved');
  await client.query(`UPDATE kcml.agent_run SET status='RUNNING',state_version=state_version+1,updated_at=clock_timestamp(),correlation_id=$2 WHERE id=$1 AND status='WAITING_FOR_OWNER'`, [current.root_agent_run_id, context.correlationId]);
  await recordAudit(client, context, 'AGENT_APPROVAL_REQUEST', id, { approvalRequestId: id, status: 'APPROVED', decision });
  return result(context, 'agent_approval_request', updated, updated.state_version, { transition: 'PENDING->APPROVED' });
}

async function handleAgentApprovalReject(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.agent_approval_request WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'AGENT_APPROVAL_NOT_FOUND', 'Approval request does not exist');
  assertVersion(context, current);
  if (current.status !== 'PENDING') throw new DomainError('TERMINAL_STATE_IMMUTABLE', 'Only a pending approval can be rejected', 409, 'DO_NOT_RETRY');
  const decision = { decision: 'REJECTED', message: context.arguments.message ?? 'Rejected by owner', decidedBy: 'KRMAR78' };
  const updated = row((await client.query(`UPDATE kcml.agent_approval_request SET status='REJECTED',owner_decision=$2,decided_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp(),logical_operation_id=$3,correlation_id=$4 WHERE id=$1 AND status='PENDING' AND state_version=$5 RETURNING *`, [id, decision, context.logicalOperationId, context.correlationId, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Approval request changed while being rejected');
  await client.query(`UPDATE kcml.agent_run SET status='FAILED',error=$2,completed_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp(),correlation_id=$3 WHERE id=$1 AND status='WAITING_FOR_OWNER'`, [current.root_agent_run_id, { code: 'OWNER_APPROVAL_REJECTED', approvalRequestId: id }, context.correlationId]);
  await recordAudit(client, context, 'AGENT_APPROVAL_REQUEST', id, { approvalRequestId: id, status: 'REJECTED', decision });
  return result(context, 'agent_approval_request', updated, updated.state_version, { transition: 'PENDING->REJECTED' });
}

async function handleAgentCheckpointCreated(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const runId = target(context);
  const run = row((await client.query(`SELECT * FROM kcml.agent_run WHERE id=$1 FOR UPDATE`, [runId])).rows as Row[], 'AGENT_RUN_NOT_FOUND', 'Agent run does not exist');
  assertVersion(context, run);
  const sequence = await nextSequence(client, 'AGENT_RUN_CHECKPOINT', runId, 'SEQUENCE');
  const payload = objectArg(context, 'payload');
  const checkpoint = row((await client.query(`INSERT INTO kcml.agent_run_checkpoint(agent_run_id,sequence,run_state,completed_item_sequence,session_cursor,budget_snapshot,usage_snapshot,lease_fencing_token,payload_digest,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11,$12,$13,$14) RETURNING *`, [
    runId, sequence.toString(), textArg(context, 'runState', String(run.status)), numberArg(context, 'completedItemSequence', 0), typeof context.arguments.sessionCursor === 'string' ? context.arguments.sessionCursor : null,
    objectArg(context, 'budgetSnapshot', objectArg(run, 'budget')), objectArg(context, 'usageSnapshot', objectArg(run, 'usage')), numberArg(context, 'leaseFencingToken', 0), digest(payload), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'AGENT_CHECKPOINT_NOT_CREATED', 'Agent checkpoint was not persisted');
  const updatedRun = row((await client.query(`UPDATE kcml.agent_run SET latest_checkpoint_id=$2,checkpoint_sequence=$3,state_version=state_version+1,updated_at=clock_timestamp(),correlation_id=$4 WHERE id=$1 AND state_version=$5 RETURNING *`, [runId, checkpoint.id, sequence.toString(), context.correlationId, run.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Agent run changed while writing checkpoint');
  await recordAudit(client, context, 'AGENT_RUN', runId, { checkpointId: checkpoint.id, sequence: sequence.toString() });
  return result(context, 'agent_run_checkpoint', checkpoint, checkpoint.state_version, { aggregate_event_sequence: sequence.toString(), runStateVersion: updatedRun.state_version });
}

async function handleAgentDelegateRequest(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const rootRunId = target(context);
  const run = row((await client.query(`SELECT * FROM kcml.agent_run WHERE id=$1 FOR UPDATE`, [rootRunId])).rows as Row[], 'AGENT_RUN_NOT_FOUND', 'Agent run does not exist');
  const id = randomUUID();
  const input = objectArg(context, 'input');
  const handoff = row((await client.query(`INSERT INTO kcml.agent_handoff_run(id,root_agent_run_id,source_agent_revision_id,target_agent_revision_id,handoff_binding_id,depth,input,input_digest,status,budget,started_at,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'RESERVED',$9,NULL,$10,$11,$12,$13,$14,$15) RETURNING *`, [
    id, rootRunId, uuidArg(context, 'sourceAgentRevisionId'), uuidArg(context, 'targetAgentRevisionId'), uuidArg(context, 'handoffBindingId'), numberArg(context, 'depth', 1), input, digest(input), objectArg(context, 'budget'), digest({ id, input, rootRunId }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'AGENT_HANDOFF_NOT_CREATED', 'Agent handoff was not persisted');
  const updatedRun = row((await client.query(`UPDATE kcml.agent_run SET status='WAITING_FOR_AGENT',state_version=state_version+1,updated_at=clock_timestamp(),correlation_id=$2 WHERE id=$1 AND state_version=$3 RETURNING *`, [rootRunId, context.correlationId, run.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Agent run changed while creating handoff');
  await recordAudit(client, context, 'AGENT_HANDOFF_RUN', id, { handoffRunId: id, rootAgentRunId: rootRunId, status: 'RESERVED' });
  return result(context, 'agent_handoff_run', handoff, handoff.state_version, { rootRunStateVersion: updatedRun.state_version });
}

async function handleAgentDelegateResult(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.agent_handoff_run WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'AGENT_HANDOFF_NOT_FOUND', 'Agent handoff does not exist');
  assertVersion(context, current);
  const status = textArg(context, 'status', context.arguments.error ? 'FAILED' : 'SUCCEEDED');
  if (!['SUCCEEDED', 'FAILED', 'CANCELLED', 'MANUAL_REVIEW'].includes(status)) throw new DomainError('AGENT_RUN_STATE_UNRESUMABLE', 'Handoff result has an invalid terminal status', 422, 'DO_NOT_RETRY');
  const output = objectArg(context, 'output');
  const updated = row((await client.query(`UPDATE kcml.agent_handoff_run SET status=$2,output=$3,output_digest=$4,error=$5,completed_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp(),logical_operation_id=$6,correlation_id=$7 WHERE id=$1 AND status IN ('RESERVED','RUNNING','WAITING_FOR_APPROVAL') AND state_version=$8 RETURNING *`, [id, status, output, digest(output), context.arguments.error ?? null, context.logicalOperationId, context.correlationId, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Handoff changed while recording result');
  await client.query(`UPDATE kcml.agent_run SET status=CASE WHEN $2='SUCCEEDED' THEN 'RUNNING' ELSE 'MANUAL_REVIEW' END,state_version=state_version+1,updated_at=clock_timestamp(),correlation_id=$3 WHERE id=$1 AND status='WAITING_FOR_AGENT'`, [current.root_agent_run_id, status, context.correlationId]);
  await recordAudit(client, context, 'AGENT_HANDOFF_RUN', id, { handoffRunId: id, status, outputDigest: canonicalDigest(json(output)) });
  return result(context, 'agent_handoff_run', updated, updated.state_version, { transition: `${String(current.status)}->${status}` });
}

async function handleAgentEvalStart(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = randomUUID();
  const model = objectArg(context, 'modelSnapshot');
  const tools = objectArg(context, 'toolSnapshot');
  const evalRun = row((await client.query(`INSERT INTO kcml.agent_eval_run(id,eval_suite_id,agent_revision_id,model_snapshot,tool_snapshot,state,environment,seed,fixture_namespace,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,'QUEUED',$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`, [
    id, uuidArg(context, 'evalSuiteId'), uuidArg(context, 'agentRevisionId'), model, tools, objectArg(context, 'environment'), numberArg(context, 'seed', 0), textArg(context, 'fixtureNamespace', `eval:${id}`), digest({ id, model, tools, logicalOperationId: context.logicalOperationId }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'AGENT_EVAL_NOT_CREATED', 'Evaluation run was not persisted');
  await recordAudit(client, context, 'AGENT_EVAL_RUN', id, { evalRunId: id, state: 'QUEUED' });
  return result(context, 'agent_eval_run', evalRun, evalRun.state_version, { transition: 'CREATED->QUEUED' });
}

async function handleAgentEvalResult(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.agent_eval_run WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'AGENT_EVAL_NOT_FOUND', 'Evaluation run does not exist');
  assertVersion(context, current);
  const state = textArg(context, 'state', context.arguments.error ? 'FAILED' : 'SUCCEEDED');
  if (!['SUCCEEDED', 'FAILED', 'CANCELLED', 'MANUAL_REVIEW'].includes(state)) throw new DomainError('AGENT_EVAL_FAILED', 'Evaluation result has an invalid terminal state', 422, 'DO_NOT_RETRY');
  const metrics = objectArg(context, 'summaryMetrics');
  const updated = row((await client.query(`UPDATE kcml.agent_eval_run SET state=$2,summary_metrics=$3,evidence_digest=$4,completed_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp(),logical_operation_id=$5,correlation_id=$6 WHERE id=$1 AND state IN ('QUEUED','RUNNING') AND state_version=$7 RETURNING *`, [id, state, metrics, digest(metrics), context.logicalOperationId, context.correlationId, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Evaluation run changed while recording result');
  await recordAudit(client, context, 'AGENT_EVAL_RUN', id, { evalRunId: id, state, metricsDigest: canonicalDigest(json(metrics)) });
  return result(context, 'agent_eval_run', updated, updated.state_version, { transition: `${String(current.state)}->${state}` });
}

async function handleAgentMemoryWrite(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const namespaceId = uuidArg(context, 'namespaceId');
  const namespace = row((await client.query(`SELECT id FROM kcml.agent_memory_namespace WHERE id=$1 FOR UPDATE`, [namespaceId])).rows as Row[], 'AGENT_MEMORY_NAMESPACE_NOT_FOUND', 'Memory namespace does not exist');
  const id = randomUUID();
  const content = objectArg(context, 'content');
  const memoryKey = textArg(context, 'memoryKey');
  const inserted = row((await client.query(`INSERT INTO kcml.agent_memory_item(id,parent_id,namespace_id,memory_key,content,metadata,source_agent_run_id,content_digest,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`, [
    id, context.targetId, namespace.id, memoryKey, content, objectArg(context, 'metadata'), context.arguments.sourceAgentRunId ?? null, digest(content), digest({ id, namespaceId, memoryKey, content }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'AGENT_MEMORY_NOT_WRITTEN', 'Memory item was not persisted');
  await recordAudit(client, context, 'AGENT_MEMORY_ITEM', id, { memoryItemId: id, namespaceId, memoryKey, previousItemId: context.targetId });
  return result(context, 'agent_memory_item', inserted, inserted.state_version, { namespaceStateVersion: namespace.state_version });
}

async function handleAgentMessageAppend(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const runId = target(context);
  const run = row((await client.query(`SELECT id,state_version FROM kcml.agent_run WHERE id=$1 FOR UPDATE`, [runId])).rows as Row[], 'AGENT_RUN_NOT_FOUND', 'Agent run does not exist');
  const sequence = await nextSequence(client, 'AGENT_MESSAGE', runId, 'SEQUENCE');
  const payload = objectArg(context, 'payload', { content: textArg(context, 'content') });
  const message = row((await client.query(`INSERT INTO kcml.agent_message(agent_run_id,sequence,role,item_type,content,payload,payload_digest,status,completed_at,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,'COMPLETED',clock_timestamp(),$8,$9,$10,$11,$12,$13) RETURNING *`, [
    runId, sequence.toString(), textArg(context, 'role', 'assistant'), textArg(context, 'itemType', 'message'), typeof context.arguments.content === 'string' ? context.arguments.content : null, payload, digest(payload), digest({ runId, sequence: sequence.toString(), payload }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'AGENT_MESSAGE_NOT_CREATED', 'Agent message was not persisted');
  await client.query(`UPDATE kcml.agent_run SET state_version=state_version+1,updated_at=clock_timestamp(),correlation_id=$2 WHERE id=$1 AND state_version=$3`, [runId, context.correlationId, run.state_version]);
  await recordAudit(client, context, 'AGENT_RUN', runId, { messageId: message.id, sequence: sequence.toString() });
  return result(context, 'agent_message', message, message.state_version, { aggregate_event_sequence: sequence.toString() });
}

async function handleAgentModelStarted(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const parentRunId = target(context);
  const run = row((await client.query(`SELECT id FROM kcml.agent_run WHERE id=$1 FOR UPDATE`, [parentRunId])).rows as Row[], 'AGENT_RUN_NOT_FOUND', 'Agent run does not exist');
  const request = objectArg(context, 'requestDescriptor');
  const modelCall = row((await client.query(`INSERT INTO kcml.ai_model_call(parent_run_id,attempt_sequence,model,request_descriptor,request_digest,input_digest,instructions_digest,tools_digest,schema_digest,settings_snapshot,local_state,submit_state,transport_evidence)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'SUBMITTING','DISPATCH_STARTED',$11) RETURNING *`, [
    parentRunId, numberArg(context, 'attemptSequence', 1), textArg(context, 'model'), request, digest(request), digest(objectArg(context, 'input')), digest(context.arguments.instructions ?? ''), digest(context.arguments.tools ?? []), digest(context.arguments.outputSchema ?? {}), objectArg(context, 'settings'), objectArg(context, 'transportEvidence')
  ])).rows as Row[], 'AGENT_MODEL_CALL_NOT_CREATED', 'Model call was not persisted');
  await client.query(`UPDATE kcml.agent_run SET status='WAITING_FOR_MODEL',state_version=state_version+1,updated_at=clock_timestamp(),correlation_id=$2 WHERE id=$1`, [run.id, context.correlationId]);
  await recordAudit(client, context, 'AI_MODEL_CALL', String(modelCall.id), { modelCallId: modelCall.id, parentRunId, state: 'SUBMITTING' });
  return result(context, 'ai_model_call', modelCall, modelCall.state_version, { parentRunId });
}

async function handleAgentModelCompleted(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.ai_model_call WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'AGENT_MODEL_CALL_NOT_FOUND', 'Model call does not exist');
  assertVersion(context, current);
  const output = context.arguments.output ?? null;
  const completed = row((await client.query(`UPDATE kcml.ai_model_call SET local_state=$2,submit_state='COMPLETED',provider_status=$3,completion_kind=$4,provider_response_id=$5,output_items=$6,usage=$7,updated_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1 AND local_state IN ('SUBMITTING','IN_PROGRESS','STREAMING','WAITING_FOR_TOOL_OUTPUT') AND state_version=$8 RETURNING *`, [
    id, textArg(context, 'state', 'COMPLETED'), context.arguments.providerStatus ?? 'completed', context.arguments.completionKind ?? 'completed', context.arguments.providerResponseId ?? null, output, objectArg(context, 'usage'), current.state_version
  ])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Model call changed while recording completion');
  await client.query(`UPDATE kcml.agent_run SET status='RUNNING',state_version=state_version+1,updated_at=clock_timestamp(),correlation_id=$2 WHERE id=$1 AND status='WAITING_FOR_MODEL'`, [current.parent_run_id, context.correlationId]);
  await recordAudit(client, context, 'AI_MODEL_CALL', id, { modelCallId: id, state: completed.local_state });
  return result(context, 'ai_model_call', completed, completed.state_version, { transition: `${String(current.local_state)}->${String(completed.local_state)}` });
}

async function handleAgentRunStart(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = randomUUID();
  const input = objectArg(context, 'input');
  const inserted = row((await client.query(`INSERT INTO kcml.agent_run(id,agent_definition_id,agent_revision_id,agent_graph_snapshot_digest,tool_snapshot_digest,guardrail_snapshot_digest,client_run_id,logical_operation_id,idempotency_key,mode,input,input_digest,context_snapshot,budget,correlation_id,platform_incarnation_id,application_deployment_epoch,activation_epoch,canonical_digest)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`, [
    id, uuidArg(context, 'agentDefinitionId'), uuidArg(context, 'agentRevisionId'), digest(context.arguments.graphSnapshot ?? {}), digest(context.arguments.toolSnapshot ?? {}), digest(context.arguments.guardrailSnapshot ?? {}), textArg(context, 'clientRunId'), context.logicalOperationId, textArg(context, 'idempotencyKey', context.logicalOperationId), textArg(context, 'mode', 'INTERACTIVE'), input, digest(input), objectArg(context, 'contextSnapshot'), objectArg(context, 'budget'), context.correlationId, context.platformIncarnationId, context.applicationDeploymentEpoch.toString(), context.activationEpoch.toString(), digest({ id, input, logicalOperationId: context.logicalOperationId })
  ])).rows as Row[], 'AGENT_RUN_NOT_CREATED', 'Agent run was not persisted');
  await recordAudit(client, context, 'AGENT_RUN', id, { agentRunId: id, state: inserted.status });
  return result(context, 'agent_run', inserted, inserted.state_version, { transition: 'CREATED->QUEUED' });
}

async function handleAgentRunCancel(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.agent_run WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'AGENT_RUN_NOT_FOUND', 'Agent run does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.agent_run SET status='CANCEL_REQUESTED',cancellation_version=cancellation_version+1,state_version=state_version+1,updated_at=clock_timestamp(),correlation_id=$2 WHERE id=$1 AND status IN ('QUEUED','PREPARING','RUNNING','WAITING_FOR_MODEL','WAITING_FOR_TOOL','WAITING_FOR_OWNER') AND state_version=$3 RETURNING *`, [id, context.correlationId, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Agent run changed while requesting cancellation');
  await recordAudit(client, context, 'AGENT_RUN', id, { agentRunId: id, state: 'CANCEL_REQUESTED' });
  return result(context, 'agent_run', updated, updated.state_version, { transition: `${String(current.status)}->CANCEL_REQUESTED` });
}

async function handleAgentRunComplete(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.agent_run WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'AGENT_RUN_NOT_FOUND', 'Agent run does not exist');
  assertVersion(context, current);
  const output = context.arguments.output ?? null;
  const updated = row((await client.query(`UPDATE kcml.agent_run SET status='SUCCEEDED',output=$2,output_digest=$3,completed_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp(),correlation_id=$4 WHERE id=$1 AND status IN ('RUNNING','WAITING_FOR_MODEL','WAITING_FOR_TOOL') AND state_version=$5 RETURNING *`, [id, output, digest(output), context.correlationId, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Agent run changed while completing');
  await recordAudit(client, context, 'AGENT_RUN', id, { agentRunId: id, state: 'SUCCEEDED' });
  return result(context, 'agent_run', updated, updated.state_version, { transition: `${String(current.status)}->SUCCEEDED` });
}

async function handleAgentRunFail(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.agent_run WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'AGENT_RUN_NOT_FOUND', 'Agent run does not exist');
  assertVersion(context, current);
  const error = objectArg(context, 'error', { code: 'AGENT_RUN_FAILED' });
  const updated = row((await client.query(`UPDATE kcml.agent_run SET status='FAILED',error=$2,completed_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp(),correlation_id=$3 WHERE id=$1 AND status IN ('RUNNING','WAITING_FOR_MODEL','WAITING_FOR_TOOL') AND state_version=$4 RETURNING *`, [id, error, context.correlationId, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Agent run changed while failing');
  await recordAudit(client, context, 'AGENT_RUN', id, { agentRunId: id, state: 'FAILED', error });
  return result(context, 'agent_run', updated, updated.state_version, { transition: `${String(current.status)}->FAILED` });
}

async function handleAgentRunManualReview(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.agent_run WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'AGENT_RUN_NOT_FOUND', 'Agent run does not exist');
  assertVersion(context, current);
  const relation = objectArg(context, 'manualReviewRelation', { reason: 'manual review requested' });
  const updated = row((await client.query(`UPDATE kcml.agent_run SET status='MANUAL_REVIEW',manual_review_relation=$2,state_version=state_version+1,updated_at=clock_timestamp(),correlation_id=$3 WHERE id=$1 AND status IN ('RUNNING','WAITING_FOR_MODEL','WAITING_FOR_TOOL','WAITING_FOR_OWNER') AND state_version=$4 RETURNING *`, [id, relation, context.correlationId, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Agent run changed while entering manual review');
  await recordAudit(client, context, 'AGENT_RUN', id, { agentRunId: id, state: 'MANUAL_REVIEW', relation });
  return result(context, 'agent_run', updated, updated.state_version, { transition: `${String(current.status)}->MANUAL_REVIEW` });
}

async function handleAgentRunPause(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.agent_run WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'AGENT_RUN_NOT_FOUND', 'Agent run does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.agent_run SET status='PAUSED',state_version=state_version+1,updated_at=clock_timestamp(),correlation_id=$2 WHERE id=$1 AND status IN ('RUNNING','WAITING_FOR_MODEL','WAITING_FOR_TOOL') AND state_version=$3 RETURNING *`, [id, context.correlationId, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Agent run changed while pausing');
  await recordAudit(client, context, 'AGENT_RUN', id, { agentRunId: id, state: 'PAUSED' });
  return result(context, 'agent_run', updated, updated.state_version, { transition: `${String(current.status)}->PAUSED` });
}

async function handleAgentRunResume(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.agent_run WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'AGENT_RUN_NOT_FOUND', 'Agent run does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.agent_run SET status='RUNNING',state_version=state_version+1,updated_at=clock_timestamp(),correlation_id=$2 WHERE id=$1 AND status IN ('PAUSED','WAITING_FOR_OWNER') AND state_version=$3 RETURNING *`, [id, context.correlationId, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Agent run changed while resuming');
  await recordAudit(client, context, 'AGENT_RUN', id, { agentRunId: id, state: 'RUNNING' });
  return result(context, 'agent_run', updated, updated.state_version, { transition: `${String(current.status)}->RUNNING` });
}

async function handleAgentSessionCompact(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const session = row((await client.query(`SELECT * FROM kcml.agent_session WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'AGENT_SESSION_NOT_FOUND', 'Agent session does not exist');
  assertVersion(context, session);
  if (session.state !== 'OPEN') throw new DomainError('AGENTIC_OPERATION_CONTEXT_INVALID', `Cannot compact agent session from ${String(session.state)}`, 409, 'RECONCILE_THEN_RETRY');
  const compacted = objectArg(context, 'compactedItems');
  const compaction = row((await client.query(`INSERT INTO kcml.agent_session_compaction(session_id,source_session_version,source_first_item_sequence,source_last_item_sequence,source_aggregate_digest,mode,model_id,sdk_version,adapter_version,compacted_items,compacted_items_digest,validation_evidence,equivalence_evidence,state,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'CANDIDATE',$14,$15,$16,$17,$18,$19) RETURNING *`, [
    id, session.state_version, numberArg(context, 'firstItemSequence', 1), numberArg(context, 'lastItemSequence', Number(session.current_item_sequence ?? 1)), digest(objectArg(context, 'sourceAggregate')), textArg(context, 'mode', 'INPUT'), textArg(context, 'modelId', 'unknown'), textArg(context, 'sdkVersion', 'unknown'), textArg(context, 'adapterVersion', 'unknown'), compacted, digest(compacted), objectArg(context, 'validationEvidence'), objectArg(context, 'equivalenceEvidence'), digest({ id, compacted }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'AGENT_COMPACTION_NOT_CREATED', 'Agent session compaction was not persisted');
  const updated = row((await client.query(`UPDATE kcml.agent_session SET state='COMPACTING',active_compaction_id=$2,lock_version=lock_version+1,state_version=state_version+1,updated_at=clock_timestamp(),correlation_id=$3 WHERE id=$1 AND state='OPEN' AND state_version=$4 RETURNING *`, [id, compaction.id, context.correlationId, session.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Agent session changed while starting compaction');
  await recordAudit(client, context, 'AGENT_SESSION', id, { compactionId: compaction.id, state: 'COMPACTING' });
  return result(context, 'agent_session', updated, updated.state_version, { compactionId: compaction.id });
}

async function handleAgentToolRequest(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const runId = target(context);
  const run = row((await client.query(`SELECT * FROM kcml.agent_run WHERE id=$1 FOR UPDATE`, [runId])).rows as Row[], 'AGENT_RUN_NOT_FOUND', 'Agent run does not exist');
  const args = objectArg(context, 'canonicalArguments', objectArg(context, 'arguments'));
  const tool = row((await client.query(`INSERT INTO kcml.agent_tool_call(agent_run_id,model_call_id,tool_binding_id,target,provider_call_id,canonical_arguments,arguments_digest,status,idempotency_relation,trace_id,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,'RESERVED',$8,$9,$10,$11,$12,$13,$14) RETURNING *`, [
    runId, uuidArg(context, 'modelCallId'), uuidArg(context, 'toolBindingId'), objectArg(context, 'target'), textArg(context, 'providerCallId', context.logicalOperationId), args, digest(args), objectArg(context, 'idempotencyRelation'), typeof context.arguments.traceId === 'string' ? context.arguments.traceId : null, digest({ runId, args, operation: context.operation.operationName }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'AGENT_TOOL_NOT_CREATED', 'Agent tool call was not persisted');
  const updatedRun = row((await client.query(`UPDATE kcml.agent_run SET status='WAITING_FOR_TOOL',state_version=state_version+1,updated_at=clock_timestamp(),correlation_id=$2 WHERE id=$1 AND state_version=$3 RETURNING *`, [runId, context.correlationId, run.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Agent run changed while reserving tool call');
  await recordAudit(client, context, 'AGENT_TOOL_CALL', String(tool.id), { toolCallId: tool.id, runId, status: 'RESERVED' });
  return result(context, 'agent_tool_call', tool, tool.state_version, { runStateVersion: updatedRun.state_version });
}

async function handleAgentToolResult(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.agent_tool_call WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'AGENT_TOOL_NOT_FOUND', 'Agent tool call does not exist');
  assertVersion(context, current);
  const value = context.arguments.result ?? null;
  const updated = row((await client.query(`UPDATE kcml.agent_tool_call SET status='SUCCEEDED',canonical_result=$2,result_digest=$3,completed_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp(),logical_operation_id=$4,correlation_id=$5 WHERE id=$1 AND status IN ('RESERVED','EXECUTING','RECONCILING') AND state_version=$6 RETURNING *`, [id, value, digest(value), context.logicalOperationId, context.correlationId, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Agent tool call changed while recording result');
  await client.query(`UPDATE kcml.agent_run SET status='RUNNING',state_version=state_version+1,updated_at=clock_timestamp(),correlation_id=$2 WHERE id=$1 AND status='WAITING_FOR_TOOL'`, [current.agent_run_id, context.correlationId]);
  await recordAudit(client, context, 'AGENT_TOOL_CALL', id, { toolCallId: id, status: 'SUCCEEDED' });
  return result(context, 'agent_tool_call', updated, updated.state_version, { transition: `${String(current.status)}->SUCCEEDED` });
}

async function handleAgentToolFailed(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.agent_tool_call WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'AGENT_TOOL_NOT_FOUND', 'Agent tool call does not exist');
  assertVersion(context, current);
  const error = objectArg(context, 'error', { code: 'AGENT_TOOL_FAILED' });
  const updated = row((await client.query(`UPDATE kcml.agent_tool_call SET status='FAILED',error=$2,completed_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp(),logical_operation_id=$3,correlation_id=$4 WHERE id=$1 AND status IN ('RESERVED','EXECUTING','RECONCILING') AND state_version=$5 RETURNING *`, [id, error, context.logicalOperationId, context.correlationId, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Agent tool call changed while recording failure');
  await client.query(`UPDATE kcml.agent_run SET status='RUNNING',state_version=state_version+1,updated_at=clock_timestamp(),correlation_id=$2 WHERE id=$1 AND status='WAITING_FOR_TOOL'`, [current.agent_run_id, context.correlationId]);
  await recordAudit(client, context, 'AGENT_TOOL_CALL', id, { toolCallId: id, status: 'FAILED', error });
  return result(context, 'agent_tool_call', updated, updated.state_version, { transition: `${String(current.status)}->FAILED` });
}

async function handleAgenticSecurityEventRecord(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = randomUUID();
  const event = row((await client.query(`INSERT INTO kcml.agentic_security_event(id,security_code,classification,severity,operation_context_id,authority_lineage_id,content_provenance_id,semantic_action_plan_id,attempted_tool,attempted_target,attempted_argument_change,attempted_delegation_change,attempted_secret_use_change,validation_decision,no_side_effect_evidence,recovery_directive,occurred_at,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,clock_timestamp(),$17,$18,$19,$20,$21,$22) RETURNING *`, [
    id, textArg(context, 'securityCode', 'AGENTIC_POLICY_REJECTED'), textArg(context, 'classification', 'AUTHORITY_VIOLATION'), textArg(context, 'severity', 'HIGH'), context.arguments.operationContextId ?? null, context.arguments.authorityLineageId ?? null, context.arguments.contentProvenanceId ?? null, context.arguments.semanticActionPlanId ?? null,
    objectArg(context, 'attemptedTool'), objectArg(context, 'attemptedTarget'), objectArg(context, 'attemptedArgumentChange'), objectArg(context, 'attemptedDelegationChange'), objectArg(context, 'attemptedSecretUseChange'), textArg(context, 'validationDecision', 'REJECTED'), objectArg(context, 'noSideEffectEvidence', { persisted: true }), textArg(context, 'recoveryDirective', 'DO_NOT_RETRY'), digest({ id, operation: context.operation.operationName }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'AGENTIC_SECURITY_EVENT_NOT_CREATED', 'Agentic security event was not persisted');
  await recordAudit(client, context, 'AGENTIC_SECURITY_EVENT', id, { securityEventId: id, decision: event.validation_decision });
  return result(context, 'agentic_security_event', event, event.state_version, { noSideEffect: true });
}

async function handleAgenticSecurityEvidenceExport(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const event = row((await client.query(`SELECT * FROM kcml.agentic_security_event WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'AGENTIC_SECURITY_EVENT_NOT_FOUND', 'Agentic security event does not exist');
  const exportDigest = digest({ eventId: id, destination: context.arguments.destination ?? 'OWNER_AUDIT', eventDigest: event.canonical_digest });
  await recordAudit(client, context, 'AGENTIC_SECURITY_EVENT', id, { securityEventId: id, exportDestination: context.arguments.destination ?? 'OWNER_AUDIT', exportDigest: `sha256:${exportDigest.toString('hex')}` });
  return result(context, 'agentic_security_event', event, event.state_version, { exported: true, exportDigest: `sha256:${exportDigest.toString('hex')}` });
}

// ---------------------------------------------------------------------------
// Audit and authority aggregates.
// ---------------------------------------------------------------------------

async function handleAuditArchiveEnqueue(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const eventId = target(context);
  const event = row((await client.query(`SELECT id,chain_sequence,event_type,payload,payload_digest FROM kcml.audit_event WHERE id=$1 FOR SHARE`, [eventId])).rows as Row[], 'AUDIT_EVENT_NOT_FOUND', 'Audit event does not exist');
  const archive = row((await client.query(`INSERT INTO kcml.audit_archive_outbox(event_id,payload,state,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,'QUEUED',$3,$4,$5,$6,$7,$8) RETURNING *`, [eventId, event, digest({ eventId, event }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()])).rows as Row[], 'AUDIT_ARCHIVE_NOT_ENQUEUED', 'Audit archive item was not persisted');
  await recordAudit(client, context, 'AUDIT_EVENT', eventId, { archiveId: archive.id, state: 'QUEUED' });
  return result(context, 'audit_archive_outbox', archive, archive.state_version, { archivedEventId: eventId });
}

async function handleAuditArchiveComplete(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.audit_archive_outbox WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'AUDIT_ARCHIVE_NOT_FOUND', 'Audit archive item does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.audit_archive_outbox SET state='ARCHIVED',archived_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp(),correlation_id=$2 WHERE id=$1 AND state IN ('QUEUED','PROCESSING') AND state_version=$3 RETURNING *`, [id, context.correlationId, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Audit archive item changed while completing');
  await recordAudit(client, context, 'AUDIT_ARCHIVE_OUTBOX', id, { archiveId: id, state: 'ARCHIVED' });
  return result(context, 'audit_archive_outbox', updated, updated.state_version, { transition: `${String(current.state)}->ARCHIVED` });
}

async function handleAuditEventAppend(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const appended = await appendAuditEvent(client, context);
  return result(context, 'audit_event', appended, appended.chain_sequence, { auditChainSequence: appended.chain_sequence });
}

async function handleAuditStreamAck(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const sequence = numberArg(context, 'sequence');
  const archive = row((await client.query(`UPDATE kcml.audit_archive_outbox SET state='ACKNOWLEDGED',state_version=state_version+1,updated_at=clock_timestamp(),correlation_id=$2 WHERE id=$1 AND state IN ('QUEUED','ARCHIVED') RETURNING *`, [id, context.correlationId])).rows as Row[], 'AUDIT_ARCHIVE_NOT_FOUND', 'Audit stream archive item does not exist');
  await recordAudit(client, context, 'AUDIT_ARCHIVE_OUTBOX', id, { archiveId: id, acknowledgedSequence: sequence });
  return result(context, 'audit_archive_outbox', archive, archive.state_version, { acknowledgedSequence: sequence });
}

async function handleAuditStreamReplayRequest(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const limit = Math.min(numberArg(context, 'limit', 100), 500);
  const events = (await client.query(`SELECT chain_sequence,event_type,aggregate_type,aggregate_id,correlation_id,payload_digest,previous_hash,event_hash,created_at FROM kcml.audit_event ORDER BY chain_sequence DESC LIMIT $1`, [limit])).rows as Row[];
  await recordAudit(client, context, 'AUDIT_EVENT', target(context), { replayRequested: true, limit, returned: events.length });
  return result(context, 'audit_event', events, events.length, { replayRequested: true, count: events.length });
}

async function handleAuditStreamReplayResult(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const event = row((await client.query(`SELECT * FROM kcml.audit_event WHERE id=$1 FOR SHARE`, [id])).rows as Row[], 'AUDIT_EVENT_NOT_FOUND', 'Audit event does not exist');
  const verification = { eventId: id, verified: context.arguments.verified === true, checkedAt: new Date().toISOString(), evidence: objectArg(context, 'evidence') };
  await recordAudit(client, context, 'AUDIT_EVENT', id, { replayResult: verification });
  return result(context, 'audit_event', event, event.chain_sequence, verification);
}

async function handleAuthorityLineageAppend(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = randomUUID();
  const payload = objectArg(context, 'lineagePayload');
  const lineage = row((await client.query(`INSERT INTO kcml.authority_lineage(id,parent_lineage_id,root_kind,root_object_kind,root_object_id,root_object_digest,target_ceiling,operation_ceiling,side_effect_ceiling,secret_use_ceiling,lineage_payload,lineage_digest,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`, [
    id, context.arguments.parentLineageId ?? null, textArg(context, 'rootKind', 'OWNER_MESSAGE'), textArg(context, 'rootObjectKind', 'OWNER_MESSAGE'), uuidArg(context, 'rootObjectId', context.targetId ?? undefined), digest(context.arguments.rootObject ?? {}), objectArg(context, 'targetCeiling'), objectArg(context, 'operationCeiling'), textArg(context, 'sideEffectCeiling', 'NONE'), objectArg(context, 'secretUseCeiling'), payload, digest(payload), digest({ id, payload }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'AUTHORITY_LINEAGE_NOT_CREATED', 'Authority lineage was not persisted');
  await recordAudit(client, context, 'AUTHORITY_LINEAGE', id, { lineageId: id, rootKind: lineage.root_kind });
  return result(context, 'authority_lineage', lineage, lineage.state_version, { lineageId: id });
}

async function handleAuthorityIntentCompile(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = randomUUID();
  const lineageId = uuidArg(context, 'authorityLineageId');
  const objective = textArg(context, 'objective');
  const intent = row((await client.query(`INSERT INTO kcml.operation_intent(id,intent_id,intent_revision,authority_lineage_id,objective,requirement_ids,target_selectors,operation_classes,side_effect_ceiling,argument_slots,dynamic_target_slots,delegated_source_references,value_derivation_contracts,secret_use_purposes,target_constraints,placement_templates,delegation_graph_ceiling,success_postcondition,stop_conditions,cancel_conditions,expires_at,intent_digest,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27) RETURNING *`, [
    id, numberArg(context, 'intentRevision', 1), lineageId, objective, listArg(context, 'requirementIds'), objectArg(context, 'targetSelectors'), listArg(context, 'operationClasses'), textArg(context, 'sideEffectCeiling', 'NONE'), objectArg(context, 'argumentSlots'), objectArg(context, 'dynamicTargetSlots'), objectArg(context, 'delegatedSourceReferences'), objectArg(context, 'valueDerivationContracts'), objectArg(context, 'secretUsePurposes'), objectArg(context, 'targetConstraints'), objectArg(context, 'placementTemplates'), objectArg(context, 'delegationGraphCeiling'), objectArg(context, 'successPostcondition'), objectArg(context, 'stopConditions'), objectArg(context, 'cancelConditions'), context.arguments.expiresAt ?? null, digest({ id, objective, lineageId }), digest({ id, objective, lineageId }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'AUTHORITY_INTENT_NOT_CREATED', 'Operation intent was not persisted');
  await recordAudit(client, context, 'OPERATION_INTENT', id, { intentId: id, authorityLineageId: lineageId });
  return result(context, 'operation_intent', intent, intent.state_version, { intentId: id });
}

async function handleAuthorityContextCreate(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = randomUUID();
  const lineageId = uuidArg(context, 'authorityLineageId');
  const intentId = uuidArg(context, 'operationIntentId');
  const payload = objectArg(context, 'canonicalPayload');
  const operationContext = row((await client.query(`INSERT INTO kcml.operation_context(id,parent_kind,parent_object_id,authority_lineage_id,authority_lineage_digest,operation_intent_id,operation_intent_digest,actor_snapshot,execution_snapshot,revision_snapshot,tool_action_snapshot,target_snapshot,binding_snapshot,activation_snapshot,target_constraints,argument_schema,argument_origin_map,side_effect_contract,retry_contract,idempotency_contract,concurrency_contract,secret_use_plan,delegation_projection,deadline_at,precondition,postcondition,provenance_manifest_digest,state,canonical_payload,context_digest,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,'COMPILED',$28,$29,$29,$30,$31,$32,$33) RETURNING *`, [
    id, textArg(context, 'parentKind', 'OWNER_MESSAGE'), uuidArg(context, 'parentObjectId', context.targetId ?? undefined), lineageId, digest(context.arguments.authorityLineage ?? {}), intentId, digest(context.arguments.operationIntent ?? {}), objectArg(context, 'actorSnapshot', { actorId: 'KRMAR78' }), objectArg(context, 'executionSnapshot'), objectArg(context, 'revisionSnapshot'), objectArg(context, 'toolActionSnapshot'), objectArg(context, 'targetSnapshot'), objectArg(context, 'bindingSnapshot'), objectArg(context, 'activationSnapshot', { activationEpoch: context.activationEpoch.toString() }), objectArg(context, 'targetConstraints'), objectArg(context, 'argumentSchema'), objectArg(context, 'argumentOriginMap'), objectArg(context, 'sideEffectContract'), objectArg(context, 'retryContract'), objectArg(context, 'idempotencyContract'), objectArg(context, 'concurrencyContract'), objectArg(context, 'secretUsePlan'), objectArg(context, 'delegationProjection'), context.arguments.deadlineAt ?? null, objectArg(context, 'precondition'), objectArg(context, 'postcondition'), digest(context.arguments.provenanceManifest ?? {}), payload, digest(payload), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'AUTHORITY_CONTEXT_NOT_CREATED', 'Operation context was not persisted');
  await recordAudit(client, context, 'OPERATION_CONTEXT', id, { operationContextId: id, authorityLineageId: lineageId, operationIntentId: intentId });
  return result(context, 'operation_context', operationContext, operationContext.state_version, { operationContextId: id });
}

async function handleAuthorityLineageResolve(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.authority_lineage WHERE id=$1 FOR SHARE`, [id])).rows as Row[], 'AUTHORITY_LINEAGE_NOT_FOUND', 'Authority lineage does not exist');
  const resolution = { resolved: true, resolvedAt: new Date().toISOString(), evidence: objectArg(context, 'evidence') };
  await recordAudit(client, context, 'AUTHORITY_LINEAGE', id, { lineageId: id, resolution });
  return result(context, 'authority_lineage', current, current.state_version, resolution);
}

async function handleAuthorityActionPlanCompile(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = randomUUID();
  const contextId = uuidArg(context, 'operationContextId', context.targetId ?? undefined);
  const args = objectArg(context, 'canonicalArguments');
  const plan = row((await client.query(`INSERT INTO kcml.semantic_action_plan(id,operation_context_id,proposed_alias,proposed_text,resolved_operation,resolved_tool_key,resolved_revision_id,resolved_binding_id,target,canonical_arguments,argument_origin_map,value_derivation_ids,side_effect_class,secret_use_context_ids,postcondition,reconciliation,validation_result,validator_version,plan_digest,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25) RETURNING *`, [
    id, contextId, context.arguments.proposedAlias ?? null, context.arguments.proposedText ?? null, textArg(context, 'resolvedOperation'), context.arguments.resolvedToolKey ?? null, context.arguments.resolvedRevisionId ?? null, context.arguments.resolvedBindingId ?? null, objectArg(context, 'target'), args, objectArg(context, 'argumentOriginMap'), listArg(context, 'valueDerivationIds'), textArg(context, 'sideEffectClass', 'NONE'), listArg(context, 'secretUseContextIds'), objectArg(context, 'postcondition'), objectArg(context, 'reconciliation'), objectArg(context, 'validationResult', { valid: true }), textArg(context, 'validatorVersion', 'td12'), digest({ id, contextId, args }), digest({ id, contextId, args }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'AUTHORITY_ACTION_PLAN_NOT_CREATED', 'Semantic action plan was not persisted');
  await recordAudit(client, context, 'SEMANTIC_ACTION_PLAN', id, { planId: id, operationContextId: contextId });
  return result(context, 'semantic_action_plan', plan, plan.state_version, { planId: id });
}

export async function handleAuthorityActionPlanValidate(client: DatabasePool, context: Pick<CanonicalHandlerContext, 'operation' | 'targetId' | 'arguments'>): Promise<unknown> {
  const id = target({ ...context, logicalOperationId: '', correlationId: '', expectedStateVersion: null, activationEpoch: 0n, platformIncarnationId: '', applicationDeploymentEpoch: 0n, recoveryEpoch: 0n });
  const plan = row((await client.query(`SELECT * FROM kcml.semantic_action_plan WHERE id=$1`, [id])).rows as Row[], 'AUTHORITY_ACTION_PLAN_NOT_FOUND', 'Semantic action plan does not exist');
  const checks = [{ gate: 'VALIDATION_RESULT', pass: objectArg(plan, 'validation_result').valid === true }, { gate: 'PLAN_DIGEST', pass: plan.plan_digest !== null }];
  return { operation: context.operation.operationName, valid: checks.every((check) => check.pass), checks, plan, evidenceDigest: canonicalDigest(json({ plan, checks })) };
}

export async function handleAuthorityContextValidate(pool: DatabasePool, context: Pick<CanonicalHandlerContext, 'operation' | 'targetId' | 'arguments'>): Promise<unknown> {
  const id = target({ ...context, logicalOperationId: '', correlationId: '', expectedStateVersion: null, activationEpoch: 0n, platformIncarnationId: '', applicationDeploymentEpoch: 0n, recoveryEpoch: 0n });
  const value = row((await pool.query(`SELECT * FROM kcml.operation_context WHERE id=$1`, [id])).rows as Row[], 'AUTHORITY_CONTEXT_NOT_FOUND', 'Operation context does not exist');
  const valid = ['COMPILED', 'VALIDATED', 'DISPATCH_RESERVED', 'DISPATCHED', 'TERMINAL'].includes(String(value.state)) && value.context_digest !== null;
  return { operation: context.operation.operationName, valid, context: value, evidenceDigest: canonicalDigest(json({ value, valid })) };
}

export async function handleAuthorityIntentValidate(pool: DatabasePool, context: Pick<CanonicalHandlerContext, 'operation' | 'targetId' | 'arguments'>): Promise<unknown> {
  const id = target({ ...context, logicalOperationId: '', correlationId: '', expectedStateVersion: null, activationEpoch: 0n, platformIncarnationId: '', applicationDeploymentEpoch: 0n, recoveryEpoch: 0n });
  const value = row((await pool.query(`SELECT * FROM kcml.operation_intent WHERE id=$1`, [id])).rows as Row[], 'AUTHORITY_INTENT_NOT_FOUND', 'Operation intent does not exist');
  const valid = value.intent_id !== null && value.intent_digest !== null && String(value.side_effect_ceiling).length > 0;
  return { operation: context.operation.operationName, valid, intent: value, evidenceDigest: canonicalDigest(json({ value, valid })) };
}

// ---------------------------------------------------------------------------
// Browser Interaction Plane operations. Browser state is deliberately split
// between the session aggregate and its immutable observation/artifact rows.
// These handlers never accept a host path and never treat an observation as a
// substitute for the authoritative session/action state.
// ---------------------------------------------------------------------------

function browserSessionId(context: CanonicalHandlerContext): string {
  return uuidArg(context, 'sessionId', context.targetId ?? undefined);
}

function digestArgument(context: ArgumentContext, key: string, value: unknown): Buffer {
  const supplied = context.arguments[key];
  if (typeof supplied === 'string' && /^sha256:[0-9a-f]{64}$/iu.test(supplied)) return Buffer.from(supplied.slice('sha256:'.length), 'hex');
  return digest(supplied ?? value);
}

async function handleBrowserAccountSave(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = (await client.query(`SELECT * FROM kcml.browser_account_binding WHERE id=$1 FOR UPDATE`, [id])).rows[0] as Row | undefined;
  if (current) {
    assertVersion(context, current);
    const updated = row((await client.query(`UPDATE kcml.browser_account_binding SET expected_account=$2,expected_tenant=$3,allowed_origins=$4,last_usage_metadata=$5,updated_at=clock_timestamp(),state_version=state_version+1,audit_correlation_id=$6 WHERE id=$1 AND state_version=$7 RETURNING *`, [id, context.arguments.expectedAccount ?? null, context.arguments.expectedTenant ?? null, listArg(context, 'allowedOrigins'), objectArg(context, 'metadata'), context.correlationId, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Browser account binding changed while saving');
    await recordAudit(client, context, 'BROWSER_ACCOUNT_BINDING', id, { accountBindingId: id, state: 'UPDATED' });
    return result(context, 'browser_account_binding', updated, updated.state_version, { transition: 'UPDATED' });
  }
  const inserted = row((await client.query(`INSERT INTO kcml.browser_account_binding(id,target_service,stable_account_key,expected_account,expected_tenant,credential_secret_ids,auth_mode,allowed_origins,concurrency_mode,last_usage_metadata,audit_correlation_id,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`, [
    id, textArg(context, 'targetService', 'browser'), textArg(context, 'stableAccountKey', id), context.arguments.expectedAccount ?? null, context.arguments.expectedTenant ?? null, [], textArg(context, 'authMode', 'OWNER_APPROVED'), listArg(context, 'allowedOrigins'), textArg(context, 'concurrencyMode', 'EXCLUSIVE'), objectArg(context, 'metadata'), context.correlationId, context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'BROWSER_ACCOUNT_NOT_SAVED', 'Browser account binding was not persisted');
  await recordAudit(client, context, 'BROWSER_ACCOUNT_BINDING', id, { accountBindingId: id, state: 'CREATED' });
  return result(context, 'browser_account_binding', inserted, inserted.state_version, { transition: 'CREATED' });
}

async function handleBrowserAccountAuthEpochIncrement(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.browser_account_binding WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_ACCOUNT_NOT_FOUND', 'Browser account binding does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.browser_account_binding SET auth_epoch=auth_epoch+1,active_state_bundle_version_id=NULL,last_usage_metadata=$2,updated_at=clock_timestamp(),state_version=state_version+1,audit_correlation_id=$3 WHERE id=$1 AND state_version=$4 RETURNING *`, [id, objectArg(context, 'metadata', { reason: 'auth epoch increment' }), context.correlationId, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Browser account changed while incrementing auth epoch');
  await recordAudit(client, context, 'BROWSER_ACCOUNT_BINDING', id, { accountBindingId: id, authEpoch: updated.auth_epoch });
  return result(context, 'browser_account_binding', updated, updated.state_version, { authEpoch: updated.auth_epoch });
}

async function handleBrowserAccountLogout(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.browser_account_binding WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_ACCOUNT_NOT_FOUND', 'Browser account binding does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.browser_account_binding SET auth_epoch=auth_epoch+1,active_state_bundle_version_id=NULL,last_usage_metadata=$2,updated_at=clock_timestamp(),state_version=state_version+1,audit_correlation_id=$3 WHERE id=$1 AND state_version=$4 RETURNING *`, [id, { action: 'logout', evidence: objectArg(context, 'evidence') }, context.correlationId, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Browser account changed while logging out');
  await recordAudit(client, context, 'BROWSER_ACCOUNT_BINDING', id, { accountBindingId: id, action: 'LOGOUT', authEpoch: updated.auth_epoch });
  return result(context, 'browser_account_binding', updated, updated.state_version, { authEpoch: updated.auth_epoch, state: 'LOGGED_OUT' });
}

async function handleBrowserActionStart(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const sessionId = browserSessionId(context);
  const session = row((await client.query(`SELECT * FROM kcml.browser_session WHERE id=$1 FOR UPDATE`, [sessionId])).rows as Row[], 'BROWSER_SESSION_NOT_FOUND', 'Browser session does not exist');
  if (!['AI','OWNER','AUTOMATION'].includes(String(session.control_holder)) || !session.control_expires_at || new Date(String(session.control_expires_at)).getTime() <= Date.now()) {
    throw new DomainError('BROWSER_CONTROL_HELD', 'A current control-holder lease is required before accepting a browser action', 409, 'RECONCILE_THEN_RETRY');
  }
  for (const [argument, column] of [['expectedControlEpoch','control_epoch'],['expectedDocumentEpoch','document_epoch'],['expectedObservationRevision','observation_revision']] as const) {
    if (BigInt(numberArg(context, argument)) !== BigInt(String(session[column]))) throw new DomainError('FENCING_TOKEN_STALE', `${argument} does not match the current browser session fence`, 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
  }
  const actionName = textArg(context, 'action');
  if (!(browserActionNames as readonly string[]).includes(actionName)) throw new DomainError('BROWSER_ACTIONABILITY_FAILED', 'Browser action is not registered', 422, 'DO_NOT_RETRY', { action: actionName });
  const targetReferenceId = context.arguments.targetReferenceId === undefined || context.arguments.targetReferenceId === null ? null : uuidArg(context, 'targetReferenceId');
  try { validateBrowserActionDescriptor(actionName as BrowserActionName, targetReferenceId, objectArg(context, 'payload')); }
  catch (error) { throw new DomainError('BROWSER_ACTIONABILITY_FAILED', error instanceof Error ? error.message : 'Browser action descriptor rejected the request', 422, 'DO_NOT_RETRY'); }
  if (targetReferenceId) {
    const reference = row((await client.query(`SELECT * FROM kcml.browser_target_reference WHERE id=$1 AND session_id=$2 FOR SHARE`, [targetReferenceId, sessionId])).rows as Row[], 'BROWSER_TARGET_MISSING', 'Browser target reference does not belong to the session');
    if (String(reference.locator_schema_version) !== '1.0' || BigInt(String(reference.context_generation)) !== BigInt(String(session.context_generation)) || BigInt(String(reference.page_generation)) !== BigInt(String(session.page_generation)) || String(reference.page_id) !== String(session.current_page_id) || String(reference.frame_id) !== String(session.current_frame_id) || BigInt(String(reference.document_epoch)) !== BigInt(String(session.document_epoch))) {
      throw new DomainError('BROWSER_DOCUMENT_STALE', 'LocatorRef does not match the current context/page/frame/document identity fence', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    }
  }
  const id = randomUUID();
  const action = row((await client.query(`INSERT INTO kcml.browser_action_run(id,session_id,logical_operation_id,action,target_reference_id,payload,expected_control_epoch,expected_document_epoch,expected_observation_revision,dispatch_phase,earliest_mutation_trigger)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'INTENT_RECORDED',$10) RETURNING *`, [
    id, sessionId, context.logicalOperationId, actionName, targetReferenceId, objectArg(context, 'payload'), numberArg(context, 'expectedControlEpoch', Number(session.control_epoch ?? 0)), numberArg(context, 'expectedDocumentEpoch', Number(session.document_epoch ?? 0)), numberArg(context, 'expectedObservationRevision', Number(session.observation_revision ?? 0)), context.arguments.earliestMutationTrigger ?? null
  ])).rows as Row[], 'BROWSER_ACTION_NOT_CREATED', 'Browser action was not persisted');
  await recordAudit(client, context, 'BROWSER_ACTION_RUN', id, { actionId: id, sessionId, dispatchPhase: 'INTENT_RECORDED' });
  return result(context, 'browser_action_run', action, action.state_version, { sessionStateVersion: session.state_version });
}

async function handleBrowserActionDispatchPhase(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.browser_action_run WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_ACTION_NOT_FOUND', 'Browser action does not exist');
  assertVersion(context, current);
  const phase = textArg(context, 'phase');
  const updated = row((await client.query(`UPDATE kcml.browser_action_run SET dispatch_phase=$2,updated_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1 AND dispatch_phase NOT IN ('CONFIRMED_APPLIED','CONFIRMED_NOT_APPLIED','FAILED_FINAL','UNKNOWN') AND state_version=$3 RETURNING *`, [id, phase, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Browser action changed while recording dispatch phase');
  await recordAudit(client, context, 'BROWSER_ACTION_RUN', id, { actionId: id, dispatchPhase: phase, phaseEvidence: objectArg(context, 'evidence') });
  return result(context, 'browser_action_run', updated, updated.state_version, { dispatchPhase: phase });
}

async function handleBrowserActionComplete(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.browser_action_run WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_ACTION_NOT_FOUND', 'Browser action does not exist');
  assertVersion(context, current);
  const outcome = objectArg(context, 'outcome');
  const updated = row((await client.query(`UPDATE kcml.browser_action_run SET dispatch_phase='CONFIRMED_APPLIED',outcome=$2,updated_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1 AND dispatch_phase NOT IN ('CONFIRMED_APPLIED','CONFIRMED_NOT_APPLIED','FAILED_FINAL') AND state_version=$3 RETURNING *`, [id, outcome, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Browser action changed while completing');
  await recordAudit(client, context, 'BROWSER_ACTION_RUN', id, { actionId: id, dispatchPhase: 'CONFIRMED_APPLIED' });
  return result(context, 'browser_action_run', updated, updated.state_version, { transition: `${String(current.dispatch_phase)}->CONFIRMED_APPLIED` });
}

async function handleBrowserActionFail(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.browser_action_run WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_ACTION_NOT_FOUND', 'Browser action does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.browser_action_run SET dispatch_phase='FAILED_FINAL',outcome=$2,updated_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1 AND dispatch_phase NOT IN ('CONFIRMED_APPLIED','CONFIRMED_NOT_APPLIED','FAILED_FINAL') AND state_version=$3 RETURNING *`, [id, objectArg(context, 'error', { code: 'BROWSER_ACTION_FAILED' }), current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Browser action changed while failing');
  await recordAudit(client, context, 'BROWSER_ACTION_RUN', id, { actionId: id, dispatchPhase: 'FAILED_FINAL' });
  return result(context, 'browser_action_run', updated, updated.state_version, { transition: `${String(current.dispatch_phase)}->FAILED_FINAL` });
}

async function handleBrowserActionCancel(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.browser_action_run WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_ACTION_NOT_FOUND', 'Browser action does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.browser_action_run SET dispatch_phase='CONFIRMED_NOT_APPLIED',outcome=$2,updated_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1 AND dispatch_phase NOT IN ('CONFIRMED_APPLIED','CONFIRMED_NOT_APPLIED','FAILED_FINAL') AND state_version=$3 RETURNING *`, [id, { cancelled: true, reason: context.arguments.reason ?? null }, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Browser action changed while cancelling');
  await recordAudit(client, context, 'BROWSER_ACTION_RUN', id, { actionId: id, dispatchPhase: 'CONFIRMED_NOT_APPLIED', cancelled: true });
  return result(context, 'browser_action_run', updated, updated.state_version, { transition: `${String(current.dispatch_phase)}->CONFIRMED_NOT_APPLIED` });
}

async function handleBrowserActionReconcile(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.browser_action_run WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_ACTION_NOT_FOUND', 'Browser action does not exist');
  assertVersion(context, current);
  const readBack = objectArg(context, 'readBack');
  const session = row((await client.query(`SELECT * FROM kcml.browser_session WHERE id=$1 FOR SHARE`, [current.session_id])).rows as Row[], 'BROWSER_SESSION_NOT_FOUND', 'Browser session does not exist');
  const evidence = readBack.evidence && typeof readBack.evidence === 'object' ? readBack.evidence as Row : {};
  const identity = readBack.identity && typeof readBack.identity === 'object' ? readBack.identity as Row : {};
  const evidenceDigest = `sha256:${digest(evidence).toString('hex')}`;
  const digestValid = readBack.digest === evidenceDigest;
  const identityCurrent = String(identity.sessionId) === String(session.id) && String(identity.pageId) === String(session.current_page_id) && String(identity.frameId) === String(session.current_frame_id) && BigInt(String(identity.documentEpoch ?? -1)) === BigInt(String(session.document_epoch));
  let outcome = 'UNKNOWN';
  if (readBack.oracle === 'INDEPENDENT_HOST_OBSERVE' && digestValid && identityCurrent && current.action === 'NAVIGATE' && typeof (current.payload as Row)?.url === 'string' && typeof evidence.url === 'string' && new URL(String((current.payload as Row).url)).href === new URL(String(evidence.url)).href) outcome = 'CONFIRMED_APPLIED';
  if (readBack.oracle === 'INDEPENDENT_HOST_OBSERVE' && digestValid && identityCurrent && current.action === 'OBSERVE') outcome = 'CONFIRMED_NOT_APPLIED';
  const requested = context.arguments.outcome === undefined ? outcome : String(context.arguments.outcome);
  if (requested !== outcome) throw new DomainError('BROWSER_RECONCILIATION_REQUIRED', 'Caller-supplied outcome differs from the independently derived browser outcome', 409, 'RECONCILE_THEN_RETRY');
  const updated = row((await client.query(`UPDATE kcml.browser_action_run SET dispatch_phase=$2,outcome=$3,updated_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1 AND dispatch_phase IN ('RECONCILING','POSSIBLE_EFFECT','OUTCOME_OBSERVED','UNKNOWN') AND state_version=$4 RETURNING *`, [id, outcome, { readBack, derived: true }, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Browser action changed while reconciling');
  await client.query(`UPDATE kcml.browser_action_attempt SET postcondition=$2,readback=$3,ended_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp() WHERE action_run_id=$1 AND attempt=(SELECT max(attempt) FROM kcml.browser_action_attempt WHERE action_run_id=$1)`, [id, { classification: outcome, independentlyDerived: true }, readBack]);
  await recordAudit(client, context, 'BROWSER_ACTION_RUN', id, { actionId: id, reconciliation: { outcome, evidenceDigest, identityCurrent } });
  return result(context, 'browser_action_run', updated, updated.state_version, { reconciliation: true, outcome, independentlyDerived: true });
}

async function handleBrowserActionResolveOutcome(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.browser_action_run WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_ACTION_NOT_FOUND', 'Browser action does not exist');
  assertVersion(context, current);
  const outcome = textArg(context, 'outcome');
  if (!['CONFIRMED_APPLIED', 'CONFIRMED_NOT_APPLIED', 'UNKNOWN'].includes(outcome)) throw new DomainError('BROWSER_RECONCILIATION_REQUIRED', 'Browser action outcome is not independently classified', 422, 'DO_NOT_RETRY');
  const updated = row((await client.query(`UPDATE kcml.browser_action_run SET dispatch_phase=$2,outcome=$3,updated_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1 AND dispatch_phase IN ('RECONCILING','POSSIBLE_EFFECT','OUTCOME_OBSERVED','UNKNOWN') AND state_version=$4 RETURNING *`, [id, outcome, { readBack: objectArg(context, 'readBack'), evidence: objectArg(context, 'evidence') }, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Browser action changed while resolving outcome');
  await recordAudit(client, context, 'BROWSER_ACTION_RUN', id, { actionId: id, outcome });
  return result(context, 'browser_action_run', updated, updated.state_version, { outcome });
}

async function handleBrowserArtifactCreated(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const sessionId = browserSessionId(context);
  const id = uuidArg(context, 'artifactId', context.targetId ?? undefined);
  const artifact = row((await client.query(`INSERT INTO kcml.browser_automation_artifact(id,session_id,automation_run_id,step_id,action_run_id,artifact_type,storage_reference,page_id,frame_id,document_id,mime_type,size_bytes,artifact_digest,safe_name,source_origin,sensitivity,retention_state,scan_state,cleanup_state,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25) RETURNING *`, [
    id, sessionId, context.arguments.automationRunId ?? null, context.arguments.stepId ?? null, context.arguments.actionRunId ?? null, textArg(context, 'artifactType', 'BROWSER_ARTIFACT'), textArg(context, 'storageReference'), context.arguments.pageId ?? null, context.arguments.frameId ?? null, context.arguments.documentId ?? null, context.arguments.mimeType ?? null, numberArg(context, 'sizeBytes', 0), digestArgument(context, 'artifactDigest', context.arguments.content ?? null), textArg(context, 'safeName', 'artifact.bin'), context.arguments.sourceOrigin ?? null, textArg(context, 'sensitivity', 'OWNER_ONLY'), textArg(context, 'retentionState', 'RETAINED'), textArg(context, 'scanState', 'UNSCANNED'), textArg(context, 'cleanupState', 'PENDING'), digest({ id, sessionId, artifactType: context.arguments.artifactType }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'BROWSER_ARTIFACT_NOT_CREATED', 'Browser artifact was not persisted');
  await recordAudit(client, context, 'BROWSER_AUTOMATION_ARTIFACT', id, { artifactId: id, sessionId, digest: `sha256:${Buffer.from(String(artifact.artifact_digest ?? '')).toString('hex')}` });
  return result(context, 'browser_automation_artifact', artifact, artifact.state_version, { sessionId });
}

async function handleBrowserAutomationRun(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = randomUUID();
  const sessionId = browserSessionId(context);
  const input = objectArg(context, 'input');
  const automation = row((await client.query(`INSERT INTO kcml.browser_automation_run(id,automation_definition_id,automation_revision_id,caller_snapshot,revision_digest,client_run_id,idempotency_scope,operation_scope_id,browser_session_id,account_binding_id,account_auth_epoch,status,input,input_digest,concurrency_claims,pending_state,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'QUEUED',$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`, [
    id, uuidArg(context, 'automationDefinitionId'), uuidArg(context, 'automationRevisionId'), objectArg(context, 'callerSnapshot', { actorId: 'KRMAR78' }), digest(context.arguments.revision ?? {}), textArg(context, 'clientRunId', context.logicalOperationId), textArg(context, 'idempotencyScope', context.logicalOperationId), uuidArg(context, 'operationScopeId'), sessionId, context.arguments.accountBindingId ?? null, context.arguments.accountAuthEpoch ?? null, input, digest(input), objectArg(context, 'concurrencyClaims'), objectArg(context, 'pendingState'), digest({ id, input, sessionId }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'BROWSER_AUTOMATION_NOT_CREATED', 'Browser automation run was not persisted');
  await recordAudit(client, context, 'BROWSER_AUTOMATION_RUN', id, { automationRunId: id, status: 'QUEUED', sessionId });
  return result(context, 'browser_automation_run', automation, automation.state_version, { sessionId });
}

async function handleBrowserAutomationPreflight(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.browser_automation_run WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_AUTOMATION_NOT_FOUND', 'Browser automation run does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.browser_automation_run SET status='PREFLIGHTED',pending_state=$2,state_version=state_version+1,updated_at=clock_timestamp(),correlation_id=$3 WHERE id=$1 AND status IN ('QUEUED','PREFLIGHTING') AND state_version=$4 RETURNING *`, [id, { checks: objectArg(context, 'checks'), validatedAt: new Date().toISOString() }, context.correlationId, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Automation run changed while completing preflight');
  await recordAudit(client, context, 'BROWSER_AUTOMATION_RUN', id, { automationRunId: id, status: 'PREFLIGHTED' });
  return result(context, 'browser_automation_run', updated, updated.state_version, { preflight: true });
}

async function handleBrowserAutomationReauthenticate(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.browser_automation_run WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_AUTOMATION_NOT_FOUND', 'Browser automation run does not exist');
  const updated = row((await client.query(`UPDATE kcml.browser_automation_run SET account_auth_epoch=$2,pending_state=$3,state_version=state_version+1,updated_at=clock_timestamp(),correlation_id=$4 WHERE id=$1 RETURNING *`, [id, numberArg(context, 'authEpoch', Number(current.account_auth_epoch ?? 0) + 1), { reauthenticated: true, evidence: objectArg(context, 'evidence') }, context.correlationId])).rows as Row[], 'BROWSER_AUTOMATION_NOT_FOUND', 'Automation run disappeared while reauthenticating');
  await recordAudit(client, context, 'BROWSER_AUTOMATION_RUN', id, { automationRunId: id, reauthenticated: true, authEpoch: updated.account_auth_epoch });
  return result(context, 'browser_automation_run', updated, updated.state_version, { reauthenticated: true });
}

async function handleBrowserAutomationReconcile(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.browser_automation_run WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_AUTOMATION_NOT_FOUND', 'Browser automation run does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.browser_automation_run SET status='RECONCILING',pending_state=$2,state_version=state_version+1,updated_at=clock_timestamp(),correlation_id=$3 WHERE id=$1 AND status NOT IN ('COMPLETED','FAILED','CANCELLED','MANUAL_REVIEW') AND state_version=$4 RETURNING *`, [id, { readBack: objectArg(context, 'readBack'), evidence: objectArg(context, 'evidence') }, context.correlationId, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Automation run changed while reconciling');
  await recordAudit(client, context, 'BROWSER_AUTOMATION_RUN', id, { automationRunId: id, status: 'RECONCILING' });
  return result(context, 'browser_automation_run', updated, updated.state_version, { reconciliation: true });
}

async function handleBrowserAutomationRepair(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.browser_automation_run WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_AUTOMATION_NOT_FOUND', 'Browser automation run does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.browser_automation_run SET status='REPAIRING',pending_state=$2,state_version=state_version+1,updated_at=clock_timestamp(),correlation_id=$3 WHERE id=$1 AND status IN ('RECONCILING','MANUAL_REVIEW','FAILED') AND state_version=$4 RETURNING *`, [id, { repair: objectArg(context, 'repair') }, context.correlationId, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Automation run changed while opening repair');
  await recordAudit(client, context, 'BROWSER_AUTOMATION_RUN', id, { automationRunId: id, status: 'REPAIRING' });
  return result(context, 'browser_automation_run', updated, updated.state_version, { repair: true });
}

async function handleBrowserAutomationCancel(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.browser_automation_run WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_AUTOMATION_NOT_FOUND', 'Browser automation run does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.browser_automation_run SET status='CANCELLED',cancellation_version=cancellation_version+1,completed_at=clock_timestamp(),pending_state=$2,state_version=state_version+1,updated_at=clock_timestamp(),correlation_id=$3 WHERE id=$1 AND status NOT IN ('COMPLETED','CANCELLED') AND state_version=$4 RETURNING *`, [id, { cancelled: true, reason: context.arguments.reason ?? null }, context.correlationId, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Automation run changed while cancelling');
  await recordAudit(client, context, 'BROWSER_AUTOMATION_RUN', id, { automationRunId: id, status: 'CANCELLED' });
  return result(context, 'browser_automation_run', updated, updated.state_version, { transition: `${String(current.status)}->CANCELLED` });
}

async function handleBrowserBridgeEnroll(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = uuidArg(context, 'bridgeId', context.targetId ?? undefined);
  const bridge = row((await client.query(`INSERT INTO kcml.browser_local_bridge(id,device_label,os_arch,build_id,certificate_generation,certificate_fingerprint,negotiated_capabilities,inventory,allowed_local_targets,status,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'ENROLLED',$10,$11) RETURNING *`, [
    id, textArg(context, 'deviceLabel', 'owner-device'), textArg(context, 'osArch', 'unknown'), textArg(context, 'buildId', 'unknown'), numberArg(context, 'certificateGeneration', 1), textArg(context, 'certificateFingerprint'), objectArg(context, 'negotiatedCapabilities'), objectArg(context, 'inventory'), objectArg(context, 'allowedLocalTargets'), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'BROWSER_BRIDGE_NOT_ENROLLED', 'Browser local bridge was not persisted');
  await recordAudit(client, context, 'BROWSER_LOCAL_BRIDGE', id, { bridgeId: id, status: 'ENROLLED' });
  return result(context, 'browser_local_bridge', bridge, bridge.state_version, { status: 'ENROLLED' });
}

async function handleBrowserBridgeConnect(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.browser_local_bridge WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_BRIDGE_NOT_FOUND', 'Browser local bridge does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.browser_local_bridge SET status='CONNECTED',connection_epoch=connection_epoch+1,negotiated_capabilities=$2,heartbeat_at=clock_timestamp(),updated_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1 AND status IN ('ENROLLED','DEGRADED','CONNECTED') AND state_version=$3 RETURNING *`, [id, objectArg(context, 'capabilities', objectArg(current, 'negotiated_capabilities')), current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Bridge changed while connecting');
  await recordAudit(client, context, 'BROWSER_LOCAL_BRIDGE', id, { bridgeId: id, status: 'CONNECTED', connectionEpoch: updated.connection_epoch });
  return result(context, 'browser_local_bridge', updated, updated.state_version, { status: 'CONNECTED' });
}

async function handleBrowserBridgeRelease(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.browser_local_bridge WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_BRIDGE_NOT_FOUND', 'Browser local bridge does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.browser_local_bridge SET status='DEGRADED',heartbeat_at=NULL,updated_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1 AND status IN ('CONNECTED','DEGRADED') AND state_version=$2 RETURNING *`, [id, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Bridge changed while releasing');
  await recordAudit(client, context, 'BROWSER_LOCAL_BRIDGE', id, { bridgeId: id, status: 'DEGRADED' });
  return result(context, 'browser_local_bridge', updated, updated.state_version, { status: 'DEGRADED' });
}

async function handleBrowserBridgeRevoke(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.browser_local_bridge WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_BRIDGE_NOT_FOUND', 'Browser local bridge does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.browser_local_bridge SET status='REVOKED',heartbeat_at=NULL,updated_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1 AND status<>'REVOKED' AND state_version=$2 RETURNING *`, [id, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Bridge changed while revoking');
  await recordAudit(client, context, 'BROWSER_LOCAL_BRIDGE', id, { bridgeId: id, status: 'REVOKED' });
  return result(context, 'browser_local_bridge', updated, updated.state_version, { status: 'REVOKED' });
}

async function handleBrowserBridgeRotateCertificate(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.browser_local_bridge WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_BRIDGE_NOT_FOUND', 'Browser local bridge does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.browser_local_bridge SET certificate_generation=certificate_generation+1,certificate_fingerprint=$2,status='ENROLLED',updated_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1 AND status<>'REVOKED' AND state_version=$3 RETURNING *`, [id, textArg(context, 'certificateFingerprint'), current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Bridge changed while rotating certificate');
  await recordAudit(client, context, 'BROWSER_LOCAL_BRIDGE', id, { bridgeId: id, certificateGeneration: updated.certificate_generation });
  return result(context, 'browser_local_bridge', updated, updated.state_version, { status: 'ENROLLED' });
}

async function handleBrowserBridgeTest(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.browser_local_bridge WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_BRIDGE_NOT_FOUND', 'Browser local bridge does not exist');
  const evidence = { passed: current.status === 'CONNECTED', testedAt: new Date().toISOString(), probe: objectArg(context, 'probe') };
  await recordAudit(client, context, 'BROWSER_LOCAL_BRIDGE', id, { bridgeId: id, test: evidence });
  return result(context, 'browser_local_bridge', current, current.state_version, { test: evidence });
}

async function handleBrowserBridgeAssign(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = randomUUID();
  const assignment = row((await client.query(`INSERT INTO kcml.browser_bridge_assignment(id,bridge_connection_id,session_id,context_generation,operation_scope_id,local_target,account_binding_id,profile_id,control_epoch,action_fence,lease_fencing_token,lease_expires_at,state,assigned_at,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'ASSIGNED',clock_timestamp(),$13,$14,$15,$16,$17,$18) RETURNING *`, [
    id, uuidArg(context, 'bridgeConnectionId'), browserSessionId(context), numberArg(context, 'contextGeneration'), uuidArg(context, 'operationScopeId'), objectArg(context, 'localTarget'), context.arguments.accountBindingId ?? null, context.arguments.profileId ?? null, numberArg(context, 'controlEpoch'), numberArg(context, 'actionFence'), numberArg(context, 'leaseFencingToken', 1), futureArg(context, 'leaseExpiresAt', 60), digest({ id, sessionId: browserSessionId(context) }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'BROWSER_BRIDGE_ASSIGNMENT_NOT_CREATED', 'Browser bridge assignment was not persisted');
  await recordAudit(client, context, 'BROWSER_BRIDGE_ASSIGNMENT', id, { assignmentId: id, state: 'ASSIGNED' });
  return result(context, 'browser_bridge_assignment', assignment, assignment.state_version, { assignmentId: id });
}

async function handleBrowserChallengeRequired(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const sessionId = browserSessionId(context);
  const id = randomUUID();
  const challenge = row((await client.query(`INSERT INTO kcml.browser_challenge(id,session_id,automation_run_id,step_id,challenge_type,status,page_id,frame_id,document_id,origin,relying_party,account_binding_id,pending_action_digest,auth_epoch,control_epoch,deadline_at,safe_prompt,allowed_resolution_methods,expires_at,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,'PENDING',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING *`, [
    id, sessionId, context.arguments.automationRunId ?? null, context.arguments.stepId ?? null, textArg(context, 'challengeType', 'OTP'), context.arguments.pageId ?? null, context.arguments.frameId ?? null, context.arguments.documentId ?? null, context.arguments.origin ?? null, context.arguments.relyingParty ?? null, context.arguments.accountBindingId ?? null, digestArgument(context, 'pendingActionDigest', {}), context.arguments.authEpoch ?? null, numberArg(context, 'controlEpoch', 0), futureArg(context, 'deadlineAt', 60), textArg(context, 'safePrompt', 'Owner action required'), listArg(context, 'allowedResolutionMethods'), futureArg(context, 'expiresAt', 300), digest({ id, sessionId, challengeType: context.arguments.challengeType }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'BROWSER_CHALLENGE_NOT_CREATED', 'Browser challenge was not persisted');
  await client.query(`UPDATE kcml.browser_session SET lifecycle='WAITING_CHALLENGE',state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND lifecycle NOT IN ('CLOSED','FAILED_FINAL','MANUAL_REVIEW')`, [sessionId]);
  await recordAudit(client, context, 'BROWSER_CHALLENGE', id, { challengeId: id, sessionId, status: 'PENDING' });
  return result(context, 'browser_challenge', challenge, challenge.state_version, { sessionId, status: 'PENDING' });
}

async function handleBrowserChallengeResolve(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.browser_challenge WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_CHALLENGE_NOT_FOUND', 'Browser challenge does not exist');
  assertVersion(context, current);
  if (current.status !== 'PENDING') throw new DomainError('TERMINAL_STATE_IMMUTABLE', 'Only a pending browser challenge can be resolved', 409, 'DO_NOT_RETRY');
  const responseDigest = digestArgument(context, 'responseDigest', context.arguments.response ?? null);
  const updated = row((await client.query(`UPDATE kcml.browser_challenge SET status='RESOLVED',owner_response_id=$2,bridge_response_id=$3,resolved_at=clock_timestamp(),consume_digest=$4,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND status='PENDING' AND state_version=$5 RETURNING *`, [id, context.arguments.ownerResponseId ?? null, context.arguments.bridgeResponseId ?? null, responseDigest, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Browser challenge changed while resolving');
  await client.query(`UPDATE kcml.browser_session SET lifecycle='RECONCILING',state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND lifecycle='WAITING_CHALLENGE'`, [current.session_id]);
  await recordAudit(client, context, 'BROWSER_CHALLENGE', id, { challengeId: id, status: 'RESOLVED', responseDigest: `sha256:${responseDigest.toString('hex')}` });
  return result(context, 'browser_challenge', updated, updated.state_version, { status: 'RESOLVED', requiresFreshObservation: true });
}

async function handleBrowserCleanupResume(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const session = row((await client.query(`SELECT * FROM kcml.browser_session WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_SESSION_NOT_FOUND', 'Browser session does not exist');
  assertVersion(context, session);
  await client.query(`UPDATE kcml.browser_upload_handle SET cleanup_at=coalesce(cleanup_at,clock_timestamp()),state_version=state_version+1,updated_at=clock_timestamp() WHERE session_id=$1 AND cleanup_at IS NULL AND (consumed_at IS NOT NULL OR expires_at<=clock_timestamp())`, [id]);
  await client.query(`UPDATE kcml.browser_download SET cleanup_state='CLEANED',state_version=state_version+1,updated_at=clock_timestamp() WHERE session_id=$1 AND state='COMPLETED' AND cleanup_state IN ('PENDING','RETAINED')`, [id]);
  const updated = row((await client.query(`UPDATE kcml.browser_session SET lifecycle='CLOSED',control_holder='NONE',control_expires_at=NULL,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state_version=$2 AND lifecycle IN ('CLEANING','RECOVERING','RECONCILING','READY','PAUSED') RETURNING *`, [id, session.state_version])).rows as Row[], 'BROWSER_CLEANUP_STATE_INVALID', 'Browser session cannot close until cleanup is resumed');
  await recordAudit(client, context, 'BROWSER_SESSION', id, { sessionId: id, lifecycle: 'CLOSED', cleanupResumed: true });
  return result(context, 'browser_session', updated, updated.state_version, { closure: true });
}

async function handleBrowserControlAcquire(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const sessionId = browserSessionId(context);
  const session = row((await client.query(`SELECT * FROM kcml.browser_session WHERE id=$1 FOR UPDATE`, [sessionId])).rows as Row[], 'BROWSER_SESSION_NOT_FOUND', 'Browser session does not exist');
  const leaseId = randomUUID();
  const epoch = Number(session.control_epoch ?? 0) + 1;
  const lease = row((await client.query(`INSERT INTO kcml.browser_control_lease(id,session_id,holder_kind,holder_id,context_generation,control_epoch,fencing_token,state,issued_at,expires_at,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,'ACTIVE',clock_timestamp(),$8,$9,$10,$11,$12,$13,$14) RETURNING *`, [
    leaseId, sessionId, textArg(context, 'holderKind', 'AI'), context.arguments.holderId ?? null, numberArg(context, 'contextGeneration', Number(session.context_generation ?? 0)), epoch, numberArg(context, 'fencingToken', epoch || 1), futureArg(context, 'expiresAt', 60), digest({ leaseId, sessionId, epoch }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'BROWSER_CONTROL_LEASE_NOT_CREATED', 'Browser control lease was not persisted');
  const updatedSession = row((await client.query(`UPDATE kcml.browser_session SET control_holder=$2,control_epoch=$3,control_fence=$4,control_expires_at=$5,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state_version=$6 RETURNING *`, [sessionId, lease.holder_kind, epoch, lease.fencing_token, lease.expires_at, session.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Browser session changed while acquiring control');
  await recordAudit(client, context, 'BROWSER_CONTROL_LEASE', leaseId, { leaseId, sessionId, holder: lease.holder_kind, controlEpoch: epoch });
  return result(context, 'browser_control_lease', lease, lease.state_version, { sessionStateVersion: updatedSession.state_version, controlEpoch: epoch });
}

async function handleBrowserControlChanged(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = browserSessionId(context);
  const session = row((await client.query(`SELECT * FROM kcml.browser_session WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_SESSION_NOT_FOUND', 'Browser session does not exist');
  assertVersion(context, session);
  const epoch = numberArg(context, 'controlEpoch', Number(session.control_epoch ?? 0) + 1);
  const updated = row((await client.query(`UPDATE kcml.browser_session SET control_holder=$2,control_epoch=$3,control_fence=control_fence+1,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND control_epoch<$3 AND state_version=$4 RETURNING *`, [id, textArg(context, 'holder', String(session.control_holder ?? 'AI')), epoch, session.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Browser session control epoch did not advance');
  await recordAudit(client, context, 'BROWSER_SESSION', id, { sessionId: id, controlHolder: updated.control_holder, controlEpoch: updated.control_epoch });
  return result(context, 'browser_session', updated, updated.state_version, { controlEpoch: updated.control_epoch });
}

async function handleBrowserControlRelease(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const lease = row((await client.query(`SELECT * FROM kcml.browser_control_lease WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_CONTROL_LEASE_NOT_FOUND', 'Browser control lease does not exist');
  assertVersion(context, lease);
  const updated = row((await client.query(`UPDATE kcml.browser_control_lease SET state='RELEASED',released_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='ACTIVE' AND state_version=$2 RETURNING *`, [id, lease.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Browser control lease changed while releasing');
  await client.query(`UPDATE kcml.browser_session SET control_holder='NONE',control_expires_at=NULL,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND control_fence=$2`, [lease.session_id, lease.fencing_token]);
  await recordAudit(client, context, 'BROWSER_CONTROL_LEASE', id, { leaseId: id, state: 'RELEASED' });
  return result(context, 'browser_control_lease', updated, updated.state_version, { state: 'RELEASED' });
}

async function handleBrowserControlTransfer(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = browserSessionId(context);
  const session = row((await client.query(`SELECT * FROM kcml.browser_session WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_SESSION_NOT_FOUND', 'Browser session does not exist');
  assertVersion(context, session);
  const holder = textArg(context, 'holder', 'AI');
  const updated = row((await client.query(`UPDATE kcml.browser_session SET lifecycle=CASE WHEN $2='OWNER' THEN 'OWNER_CONTROLLED' WHEN $2='AUTOMATION' THEN 'AUTOMATION_CONTROLLED' ELSE 'AI_CONTROLLED' END,control_holder=$2,control_epoch=control_epoch+1,control_fence=control_fence+1,control_expires_at=$3,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND control_holder<>$2 AND state_version=$4 RETURNING *`, [id, holder, futureArg(context, 'expiresAt', 60), session.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Browser session changed while transferring control');
  await recordAudit(client, context, 'BROWSER_SESSION', id, { sessionId: id, holder, controlEpoch: updated.control_epoch });
  return result(context, 'browser_session', updated, updated.state_version, { holder, controlEpoch: updated.control_epoch });
}

async function handleBrowserDialogOpened(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const sessionId = browserSessionId(context);
  const id = randomUUID();
  const sequence = await nextSequence(client, 'BROWSER_DIALOG', sessionId, 'SEQUENCE');
  const message = textArg(context, 'safeMessage', 'Browser dialog requires an owner decision');
  const dialog = row((await client.query(`INSERT INTO kcml.browser_dialog(id,session_id,page_id,frame_id,document_id,dialog_sequence,dialog_type,causation_action_id,safe_message_digest,default_value_metadata,policy,challenge_id,state,opened_at,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'OPEN',clock_timestamp(),$13,$14,$15,$16,$17,$18) RETURNING *`, [
    id, sessionId, uuidArg(context, 'pageId'), context.arguments.frameId ?? null, context.arguments.documentId ?? null, sequence.toString(), textArg(context, 'dialogType', 'ALERT'), context.arguments.causationActionId ?? null, digest(message), objectArg(context, 'defaultValueMetadata'), objectArg(context, 'policy'), context.arguments.challengeId ?? null, digest({ id, sessionId, sequence: sequence.toString(), message }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'BROWSER_DIALOG_NOT_CREATED', 'Browser dialog was not persisted');
  await recordAudit(client, context, 'BROWSER_DIALOG', id, { dialogId: id, sessionId, sequence: sequence.toString(), state: 'OPEN' });
  return result(context, 'browser_dialog', dialog, dialog.state_version, { sequence: sequence.toString() });
}

async function handleBrowserDialogRespond(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.browser_dialog WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_DIALOG_NOT_FOUND', 'Browser dialog does not exist');
  assertVersion(context, current);
  const response = objectArg(context, 'response');
  const updated = row((await client.query(`UPDATE kcml.browser_dialog SET response_digest=$2,state=$3,resolved_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='OPEN' AND state_version=$4 RETURNING *`, [id, digest(response), textArg(context, 'state', 'RESOLVED'), current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Browser dialog changed while responding');
  await recordAudit(client, context, 'BROWSER_DIALOG', id, { dialogId: id, state: updated.state });
  return result(context, 'browser_dialog', updated, updated.state_version, { responseDigest: `sha256:${digest(response).toString('hex')}` });
}

async function handleBrowserDocumentChanged(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = randomUUID();
  const pageId = uuidArg(context, 'pageId');
  const frameId = uuidArg(context, 'frameId');
  const documentEpoch = numberArg(context, 'documentEpoch', 1);
  const document = row((await client.query(`INSERT INTO kcml.browser_document(id,page_id,frame_id,document_key,document_epoch,creation_reason,url,origin,navigation_sequence,document_lifecycle,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`, [
    id, pageId, frameId, textArg(context, 'documentKey', id), documentEpoch, textArg(context, 'creationReason', 'NAVIGATION'), textArg(context, 'url'), context.arguments.origin ?? null, numberArg(context, 'navigationSequence', 1), textArg(context, 'documentLifecycle', 'ACTIVE'), digest({ id, pageId, frameId, documentEpoch }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'BROWSER_DOCUMENT_NOT_CREATED', 'Browser document was not persisted');
  await recordAudit(client, context, 'BROWSER_DOCUMENT', id, { documentId: id, pageId, frameId, documentEpoch });
  return result(context, 'browser_document', document, document.state_version, { documentEpoch });
}

async function handleBrowserDownloadStarted(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const sessionId = browserSessionId(context);
  const id = uuidArg(context, 'downloadId', context.targetId ?? undefined);
  const download = row((await client.query(`INSERT INTO kcml.browser_download(id,session_id,run_id,step_id,action_id,source_origin,source_url,url_kind,event_sequence,suggested_name,state,cleanup_state,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'STARTED','PENDING',$11,$12,$13,$14,$15,$16) RETURNING *`, [
    id, sessionId, context.arguments.runId ?? null, context.arguments.stepId ?? null, context.arguments.actionId ?? null, context.arguments.sourceOrigin ?? null, context.arguments.sourceUrl ?? null, textArg(context, 'urlKind', 'HTTP'), numberArg(context, 'eventSequence', 0), context.arguments.suggestedName ?? null, digest({ id, sessionId, sourceUrl: context.arguments.sourceUrl ?? null }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'BROWSER_DOWNLOAD_NOT_CREATED', 'Browser download was not persisted');
  await recordAudit(client, context, 'BROWSER_DOWNLOAD', id, { downloadId: id, sessionId, state: 'STARTED' });
  return result(context, 'browser_download', download, download.state_version, { state: 'STARTED' });
}

async function handleBrowserDownloadPersist(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = (await client.query(`SELECT * FROM kcml.browser_download WHERE id=$1 FOR UPDATE`, [id])).rows[0] as Row | undefined;
  if (!current) throw new DomainError('BROWSER_DOWNLOAD_INCOMPLETE', 'Browser download does not exist', 404, 'RECONCILE_THEN_RETRY');
  assertVersion(context, current);
  const size = numberArg(context, 'sizeBytes', Number(current.size_bytes ?? 0));
  const contentDigest = digestArgument(context, 'contentDigest', context.arguments.content ?? null);
  const updated = (await client.query(`UPDATE kcml.browser_download SET state='COMPLETED',artifact_id=$2,size_bytes=$3,content_digest=$4,content_verification=$5,cleanup_state='RETAINED',state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state IN ('STARTED','STREAMING') AND state_version=$6 RETURNING *`, [id, context.arguments.artifactId ?? null, size, contentDigest, objectArg(context, 'verification', { verified: true }), current.state_version])).rows[0] as Row | undefined;
  if (!updated) throw new DomainError('BROWSER_DOWNLOAD_INCOMPLETE', `Browser download cannot be persisted from ${String(current.state)}`, 409, 'RECONCILE_THEN_RETRY', { state: current.state });
  await recordAudit(client, context, 'BROWSER_DOWNLOAD', id, { downloadId: id, state: 'COMPLETED', sizeBytes: size, contentDigest: `sha256:${contentDigest.toString('hex')}` });
  return result(context, 'browser_download', updated, updated.state_version, { state: 'COMPLETED' });
}

async function handleBrowserFrameObserved(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = randomUUID();
  const pageId = uuidArg(context, 'pageId');
  const frame = row((await client.query(`INSERT INTO kcml.browser_frame(id,page_id,page_generation,frame_key,attachment_epoch,runtime_handle_fingerprint,parent_frame_id,origin,url,frame_name,sandbox_attributes,permission_attributes,attached,attached_at,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,clock_timestamp(),$13,$14,$15,$16,$17,$18) RETURNING *`, [
    id, pageId, numberArg(context, 'pageGeneration', 1), textArg(context, 'frameKey', id), numberArg(context, 'attachmentEpoch', 1), digestArgument(context, 'runtimeHandleFingerprint', {}), context.arguments.parentFrameId ?? null, context.arguments.origin ?? null, textArg(context, 'url', 'about:blank'), context.arguments.frameName ?? null, objectArg(context, 'sandboxAttributes'), objectArg(context, 'permissionAttributes'), digest({ id, pageId, frameKey: context.arguments.frameKey ?? id }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'BROWSER_FRAME_NOT_CREATED', 'Browser frame observation was not persisted');
  await recordAudit(client, context, 'BROWSER_FRAME', id, { frameId: id, pageId, attachmentEpoch: frame.attachment_epoch });
  return result(context, 'browser_frame', frame, frame.state_version, { frameId: id });
}

async function handleBrowserHostDrain(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.browser_host_slot WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_HOST_NOT_FOUND', 'Browser host slot does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.browser_host_slot SET drain_state='DRAINING',admission_state='CLOSED',last_error=$2,state_version=state_version+1,updated_at=clock_timestamp(),correlation_id=$3 WHERE id=$1 AND drain_state NOT IN ('DRAINED','FAILED') AND state_version=$4 RETURNING *`, [id, objectArg(context, 'evidence', { reason: 'owner requested drain' }), context.correlationId, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Browser host slot changed while draining');
  await recordAudit(client, context, 'BROWSER_HOST_SLOT', id, { hostSlotId: id, drainState: 'DRAINING' });
  return result(context, 'browser_host_slot', updated, updated.state_version, { drainState: 'DRAINING' });
}

async function handleBrowserHostReady(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.browser_host_slot WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_HOST_NOT_FOUND', 'Browser host slot does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.browser_host_slot SET drain_state='READY',admission_state='OPEN',heartbeat_at=clock_timestamp(),last_error=NULL,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND admission_state IN ('OPEN','CLOSED','RECOVERING') AND state_version=$2 RETURNING *`, [id, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Browser host slot changed while becoming ready');
  await recordAudit(client, context, 'BROWSER_HOST_SLOT', id, { hostSlotId: id, admissionState: 'OPEN' });
  return result(context, 'browser_host_slot', updated, updated.state_version, { admissionState: 'OPEN' });
}

async function handleBrowserHostRecover(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.browser_host_slot WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_HOST_NOT_FOUND', 'Browser host slot does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.browser_host_slot SET admission_state='RECOVERING',last_error=$2,last_restart_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND admission_state IN ('CLOSED','FAILED','RECOVERING') AND state_version=$3 RETURNING *`, [id, objectArg(context, 'evidence', { recovery: true }), current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Browser host slot changed while recovering');
  await recordAudit(client, context, 'BROWSER_HOST_SLOT', id, { hostSlotId: id, admissionState: 'RECOVERING' });
  return result(context, 'browser_host_slot', updated, updated.state_version, { admissionState: 'RECOVERING' });
}

async function handleBrowserNavigationObserved(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = randomUUID();
  const sessionId = browserSessionId(context);
  const pageId = uuidArg(context, 'pageId');
  const sequence = numberArg(context, 'navigationSequence', 1);
  const navigation = row((await client.query(`INSERT INTO kcml.browser_navigation(id,session_id,page_id,frame_id,document_id,navigation_key,navigation_sequence,causation_action_id,requested_url,requested_origin,http_method,navigation_type,state,origin_policy_outcome,timings,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`, [
    id, sessionId, pageId, context.arguments.frameId ?? null, context.arguments.documentId ?? null, id, sequence, context.arguments.causationActionId ?? null, textArg(context, 'requestedUrl'), context.arguments.requestedOrigin ?? null, textArg(context, 'httpMethod', 'GET'), textArg(context, 'navigationType', 'FULL'), textArg(context, 'state', 'COMMITTED'), objectArg(context, 'originPolicyOutcome', { allowed: true }), objectArg(context, 'timings'), digest({ id, sessionId, pageId, sequence }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'BROWSER_NAVIGATION_NOT_CREATED', 'Browser navigation was not persisted');
  await client.query(`UPDATE kcml.browser_session SET current_url=$2,current_page_id=$3,current_frame_id=$4,observation_revision=observation_revision+1,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`, [sessionId, navigation.requested_url, pageId, context.arguments.frameId ?? null]);
  await recordAudit(client, context, 'BROWSER_NAVIGATION', id, { navigationId: id, sessionId, state: navigation.state });
  return result(context, 'browser_navigation', navigation, navigation.state_version, { sessionId, navigationSequence: sequence });
}

async function handleBrowserPageOpen(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = uuidArg(context, 'pageId', context.targetId ?? undefined);
  const sessionId = browserSessionId(context);
  const page = row((await client.query(`INSERT INTO kcml.browser_page(id,session_id,context_instance_id,page_key,page_generation,runtime_handle_fingerprint,active_preview,closed,url,origin,title,page_lifecycle,current_document_epoch,navigation_sequence,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,false,false,$7,$8,$9,'OPEN',0,0,$10,$11,$12,$13,$14,$15) RETURNING *`, [
    id, sessionId, uuidArg(context, 'contextInstanceId'), textArg(context, 'pageKey', id), numberArg(context, 'pageGeneration', 1), digestArgument(context, 'runtimeHandleFingerprint', {}), textArg(context, 'url', 'about:blank'), context.arguments.origin ?? null, context.arguments.title ?? null, digest({ id, sessionId }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'BROWSER_PAGE_NOT_CREATED', 'Browser page was not persisted');
  await client.query(`UPDATE kcml.browser_session SET current_page_id=$2,current_url=$3,page_generation=page_generation+1,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`, [sessionId, id, page.url]);
  await recordAudit(client, context, 'BROWSER_PAGE', id, { pageId: id, sessionId, lifecycle: 'OPEN' });
  return result(context, 'browser_page', page, page.state_version, { pageId: id });
}

async function handleBrowserPageObserved(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const sessionId = browserSessionId(context);
  const pageId = target(context);
  const session = row((await client.query(`SELECT * FROM kcml.browser_session WHERE id=$1 FOR UPDATE`, [sessionId])).rows as Row[], 'BROWSER_SESSION_NOT_FOUND', 'Browser session does not exist');
  const observationRevision = Number(session.observation_revision ?? 0) + 1;
  const observation = row((await client.query(`INSERT INTO kcml.browser_observation(session_id,observation_revision,context_generation,page_id,page_generation,frame_id,document_epoch,url,title,semantic_snapshot,network_summary,console_summary,canonical_digest)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`, [
    sessionId, observationRevision, numberArg(context, 'contextGeneration', Number(session.context_generation ?? 0)), pageId, numberArg(context, 'pageGeneration', Number(session.page_generation ?? 0)), uuidArg(context, 'frameId'), numberArg(context, 'documentEpoch', Number(session.document_epoch ?? 0)), textArg(context, 'url', String(session.current_url ?? 'about:blank')), textArg(context, 'title', ''), objectArg(context, 'semanticSnapshot'), objectArg(context, 'networkSummary'), objectArg(context, 'consoleSummary'), digest({ sessionId, pageId, observationRevision, semantic: context.arguments.semanticSnapshot ?? {} })
  ])).rows as Row[], 'BROWSER_OBSERVATION_NOT_CREATED', 'Browser observation was not persisted');
  const updatedSession = row((await client.query(`UPDATE kcml.browser_session SET observation_revision=$2,current_page_id=$3,current_frame_id=$4,document_epoch=$5,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state_version=$6 RETURNING *`, [sessionId, observationRevision, pageId, context.arguments.frameId, observation.document_epoch, session.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Browser session changed while recording observation');
  await recordAudit(client, context, 'BROWSER_SESSION', sessionId, { observationId: observation.id, observationRevision });
  return result(context, 'browser_observation', observation, updatedSession.state_version, { observationRevision });
}

async function handleBrowserPageActivate(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.browser_page WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_PAGE_NOT_FOUND', 'Browser page does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.browser_page SET active_preview=true,closed=false,page_lifecycle='ACTIVE',state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND closed=false AND state_version=$2 RETURNING *`, [id, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Browser page changed while activating');
  await recordAudit(client, context, 'BROWSER_PAGE', id, { pageId: id, activePreview: true });
  return result(context, 'browser_page', updated, updated.state_version, { activePreview: true });
}

async function handleBrowserPageClose(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.browser_page WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_PAGE_NOT_FOUND', 'Browser page does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.browser_page SET closed=true,page_lifecycle='CLOSED',closed_at=clock_timestamp(),close_reason=$2,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND closed=false AND state_version=$3 RETURNING *`, [id, context.arguments.reason ?? 'owner requested close', current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Browser page changed while closing');
  await recordAudit(client, context, 'BROWSER_PAGE', id, { pageId: id, lifecycle: 'CLOSED' });
  return result(context, 'browser_page', updated, updated.state_version, { closed: true });
}

async function handleBrowserPermissionRequest(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const sessionId = browserSessionId(context);
  const id = randomUUID();
  const request = row((await client.query(`INSERT INTO kcml.browser_permission_request(id,session_id,context_instance_id,page_id,frame_id,document_id,origin,permission_kind,causation_action_id,requested_scope,policy,challenge_id,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`, [
    id, sessionId, uuidArg(context, 'contextInstanceId'), context.arguments.pageId ?? null, context.arguments.frameId ?? null, context.arguments.documentId ?? null, textArg(context, 'origin'), textArg(context, 'permissionKind'), context.arguments.causationActionId ?? null, objectArg(context, 'requestedScope'), objectArg(context, 'policy'), context.arguments.challengeId ?? null, digest({ id, sessionId, permissionKind: context.arguments.permissionKind }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'BROWSER_PERMISSION_NOT_CREATED', 'Browser permission request was not persisted');
  await recordAudit(client, context, 'BROWSER_PERMISSION_REQUEST', id, { permissionRequestId: id, sessionId, permissionKind: request.permission_kind });
  return result(context, 'browser_permission_request', request, request.state_version, { sessionId });
}

async function handleBrowserPermissionRespond(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.browser_permission_request WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_PERMISSION_NOT_FOUND', 'Browser permission request does not exist');
  assertVersion(context, current);
  const state = textArg(context, 'effectivePermissionState', 'DENIED');
  const updated = row((await client.query(`UPDATE kcml.browser_permission_request SET response=$2,effective_permission_state=$3,resolved_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND resolved_at IS NULL AND state_version=$4 RETURNING *`, [id, objectArg(context, 'response'), state, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Browser permission request changed while responding');
  await recordAudit(client, context, 'BROWSER_PERMISSION_REQUEST', id, { permissionRequestId: id, state });
  return result(context, 'browser_permission_request', updated, updated.state_version, { effectivePermissionState: state });
}

async function handleBrowserPreviewResync(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const sessionId = browserSessionId(context);
  const id = randomUUID();
  const sequence = await nextSequence(client, 'BROWSER_PREVIEW_EVENT', sessionId, 'SEQUENCE');
  const event = row((await client.query(`INSERT INTO kcml.browser_preview_event(id,session_id,stream_epoch,sequence,event_type,control_epoch,page_id,frame_id,document_id,document_epoch,observation_revision,frame_revision,payload,artifact_references,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,'RESYNC',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`, [
    id, sessionId, numberArg(context, 'streamEpoch', 1), sequence.toString(), context.arguments.controlEpoch ?? null, context.arguments.pageId ?? null, context.arguments.frameId ?? null, context.arguments.documentId ?? null, context.arguments.documentEpoch ?? null, context.arguments.observationRevision ?? null, context.arguments.frameRevision ?? null, objectArg(context, 'payload'), listArg(context, 'artifactReferences'), digest({ id, sessionId, sequence: sequence.toString(), payload: context.arguments.payload ?? {} }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'BROWSER_PREVIEW_EVENT_NOT_CREATED', 'Browser preview resync event was not persisted');
  await recordAudit(client, context, 'BROWSER_PREVIEW_EVENT', id, { previewEventId: id, sessionId, sequence: sequence.toString(), eventType: 'RESYNC' });
  return result(context, 'browser_preview_event', event, event.state_version, { sequence: sequence.toString() });
}

async function handleBrowserPreviewTicketCreate(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const sessionId = browserSessionId(context);
  const id = randomUUID();
  const expiresAt = futureArg(context, 'expiresAt', 300);
  const ticket = row((await client.query(`INSERT INTO kcml.browser_preview_ticket(id,session_id,owner_session_id,access_channel,audience,capability_set,token_fingerprint,issued_at,expires_at,stream_epoch,stream_binding,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp(),$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`, [
    id, sessionId, context.arguments.ownerSessionId ?? null, textArg(context, 'accessChannel', 'SESSION'), textArg(context, 'audience', 'OWNER'), objectArg(context, 'capabilitySet'), digestArgument(context, 'tokenFingerprint', context.arguments.token ?? id), expiresAt, numberArg(context, 'streamEpoch', 1), objectArg(context, 'streamBinding'), digest({ id, sessionId, expiresAt }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'BROWSER_PREVIEW_TICKET_NOT_CREATED', 'Browser preview ticket was not persisted');
  await recordAudit(client, context, 'BROWSER_PREVIEW_TICKET', id, { ticketId: id, sessionId, expiresAt });
  return result(context, 'browser_preview_ticket', ticket, ticket.state_version, { ticketId: id });
}

async function handleBrowserPreviewViewerConnected(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const sessionId = browserSessionId(context);
  const id = randomUUID();
  const sequence = await nextSequence(client, 'BROWSER_PREVIEW_EVENT', sessionId, 'SEQUENCE');
  const payload = { viewerId: context.arguments.viewerId ?? null, connectedAt: new Date().toISOString(), metadata: objectArg(context, 'metadata') };
  const event = row((await client.query(`INSERT INTO kcml.browser_preview_event(id,session_id,stream_epoch,sequence,event_type,payload,artifact_references,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,'VIEWER_CONNECTED',$5,'{}',$6,$7,$8,$9,$10,$11) RETURNING *`, [id, sessionId, numberArg(context, 'streamEpoch', 1), sequence.toString(), payload, digest({ id, payload }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()])).rows as Row[], 'BROWSER_PREVIEW_EVENT_NOT_CREATED', 'Browser preview viewer connection was not persisted');
  await recordAudit(client, context, 'BROWSER_PREVIEW_EVENT', id, { previewEventId: id, sessionId, eventType: 'VIEWER_CONNECTED' });
  return result(context, 'browser_preview_event', event, event.state_version, { sequence: sequence.toString() });
}

async function handleBrowserPreviewViewerDisconnected(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const sessionId = browserSessionId(context);
  const id = randomUUID();
  const sequence = await nextSequence(client, 'BROWSER_PREVIEW_EVENT', sessionId, 'SEQUENCE');
  const payload = { viewerId: context.arguments.viewerId ?? null, disconnectedAt: new Date().toISOString(), reason: context.arguments.reason ?? null };
  const event = row((await client.query(`INSERT INTO kcml.browser_preview_event(id,session_id,stream_epoch,sequence,event_type,payload,artifact_references,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,'VIEWER_DISCONNECTED',$5,'{}',$6,$7,$8,$9,$10,$11) RETURNING *`, [id, sessionId, numberArg(context, 'streamEpoch', 1), sequence.toString(), payload, digest({ id, payload }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()])).rows as Row[], 'BROWSER_PREVIEW_EVENT_NOT_CREATED', 'Browser preview viewer disconnection was not persisted');
  await recordAudit(client, context, 'BROWSER_PREVIEW_EVENT', id, { previewEventId: id, sessionId, eventType: 'VIEWER_DISCONNECTED' });
  return result(context, 'browser_preview_event', event, event.state_version, { sequence: sequence.toString() });
}

async function handleBrowserProfileAcquire(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = randomUUID();
  const profile = row((await client.query(`INSERT INTO kcml.browser_profile_lease(id,bridge_id,profile_key,browser_build_id,owner_session_id,account_binding_id,fencing_token,connection_epoch,mode,state,issued_at,expires_at,process_evidence,profile_lock_evidence,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'ACTIVE',clock_timestamp(),$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`, [
    id, uuidArg(context, 'bridgeId'), textArg(context, 'profileKey'), textArg(context, 'browserBuildId'), browserSessionId(context), context.arguments.accountBindingId ?? null, numberArg(context, 'fencingToken', 1), numberArg(context, 'connectionEpoch', 1), textArg(context, 'mode', 'EXCLUSIVE'), futureArg(context, 'expiresAt', 300), objectArg(context, 'processEvidence'), objectArg(context, 'profileLockEvidence'), digest({ id, profileKey: context.arguments.profileKey }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'BROWSER_PROFILE_LEASE_NOT_CREATED', 'Browser profile lease was not persisted');
  await recordAudit(client, context, 'BROWSER_PROFILE_LEASE', id, { profileLeaseId: id, state: 'ACTIVE' });
  return result(context, 'browser_profile_lease', profile, profile.state_version, { profileLeaseId: id });
}

async function handleBrowserProfileRelease(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.browser_profile_lease WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_PROFILE_LEASE_NOT_FOUND', 'Browser profile lease does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.browser_profile_lease SET state='RELEASED',released_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state IN ('ACTIVE','RELEASING') AND state_version=$2 RETURNING *`, [id, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Browser profile lease changed while releasing');
  await recordAudit(client, context, 'BROWSER_PROFILE_LEASE', id, { profileLeaseId: id, state: 'RELEASED' });
  return result(context, 'browser_profile_lease', updated, updated.state_version, { state: 'RELEASED' });
}

async function handleBrowserRunManualReview(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.browser_automation_run WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_AUTOMATION_NOT_FOUND', 'Browser automation run does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.browser_automation_run SET status='MANUAL_REVIEW',manual_review=$2,state_version=state_version+1,updated_at=clock_timestamp(),correlation_id=$3 WHERE id=$1 AND status NOT IN ('COMPLETED','CANCELLED') AND state_version=$4 RETURNING *`, [id, objectArg(context, 'manualReview', { reason: 'manual review requested' }), context.correlationId, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Automation run changed while entering manual review');
  await recordAudit(client, context, 'BROWSER_AUTOMATION_RUN', id, { automationRunId: id, status: 'MANUAL_REVIEW' });
  return result(context, 'browser_automation_run', updated, updated.state_version, { status: 'MANUAL_REVIEW' });
}

async function handleBrowserRuntimeBuildRegister(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = randomUUID();
  const sourceCommit = textArg(context, 'sourceCommit', process.env.KCML_SOURCE_SHA ?? '0000000000000000000000000000000000000000');
  if (!/^[0-9a-f]{40}$/iu.test(sourceCommit)) throw new DomainError('BROWSER_ACTIONABILITY_FAILED', 'sourceCommit must be a full commit SHA', 422, 'DO_NOT_RETRY');
  const manifest = objectArg(context, 'manifest');
  const build = row((await client.query(`INSERT INTO kcml.browser_runtime_build_manifest(id,application_release_id,source_commit,node_version,playwright_version,locator_compiler_version,preview_adapter_version,automation_interpreter_version,state_serializer_version,browser_engine,browser_channel,browser_revision,executable_digest,dependency_digest,os_image,os_release,architecture,runtime_libraries_digest,fonts_digest,locale_timezone_digest,sandbox_profile_digest,launch_mode,launch_arguments,environment_allowlist_digest,capability_map,state_bundle_compatibility,automation_compatibility,host_generation_compatibility,manifest_payload,manifest_digest,validation_state,verification_state,evidence,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39) RETURNING *`, [
    id, textArg(context, 'applicationReleaseId', 'development'), sourceCommit, textArg(context, 'nodeVersion', process.version), textArg(context, 'playwrightVersion', '1.58.2'), textArg(context, 'locatorCompilerVersion', 'td12'), textArg(context, 'previewAdapterVersion', 'td12'), textArg(context, 'automationInterpreterVersion', 'td12'), textArg(context, 'stateSerializerVersion', 'td12'), textArg(context, 'browserEngine', 'chromium'), textArg(context, 'browserChannel', 'stable'), textArg(context, 'browserRevision', 'managed'), digestArgument(context, 'executableDigest', manifest), digestArgument(context, 'dependencyDigest', manifest), textArg(context, 'osImage', 'unknown'), textArg(context, 'osRelease', 'unknown'), textArg(context, 'architecture', process.arch), digestArgument(context, 'runtimeLibrariesDigest', manifest), digestArgument(context, 'fontsDigest', manifest), digestArgument(context, 'localeTimezoneDigest', manifest), digestArgument(context, 'sandboxProfileDigest', manifest), textArg(context, 'launchMode', 'HEADLESS'), objectArg(context, 'launchArguments'), digestArgument(context, 'environmentAllowlistDigest', manifest), objectArg(context, 'capabilityMap'), objectArg(context, 'stateBundleCompatibility'), objectArg(context, 'automationCompatibility'), objectArg(context, 'hostGenerationCompatibility'), manifest, digest(manifest), textArg(context, 'validationState', 'PENDING'), textArg(context, 'verificationState', 'PENDING'), objectArg(context, 'evidence'), digest({ id, manifest }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'BROWSER_RUNTIME_BUILD_NOT_REGISTERED', 'Browser runtime build manifest was not persisted');
  await recordAudit(client, context, 'BROWSER_RUNTIME_BUILD_MANIFEST', id, { runtimeBuildId: id, sourceCommit, validationState: build.validation_state });
  return result(context, 'browser_runtime_build_manifest', build, build.state_version, { runtimeBuildId: id });
}

async function handleBrowserScheduleEvaluate(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.browser_automation_run WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_AUTOMATION_NOT_FOUND', 'Browser automation run does not exist');
  assertVersion(context, current);
  const evaluation = { eligible: context.arguments.eligible !== false, evaluatedAt: new Date().toISOString(), schedule: objectArg(context, 'schedule') };
  const updated = row((await client.query(`UPDATE kcml.browser_automation_run SET pending_state=$2,state_version=state_version+1,updated_at=clock_timestamp(),correlation_id=$3 WHERE id=$1 AND state_version=$4 RETURNING *`, [id, evaluation, context.correlationId, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Automation run changed while evaluating schedule');
  await recordAudit(client, context, 'BROWSER_AUTOMATION_RUN', id, { automationRunId: id, scheduleEvaluation: evaluation });
  return result(context, 'browser_automation_run', updated, updated.state_version, { evaluation });
}

async function handleBrowserSessionAttach(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.browser_session WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_SESSION_NOT_FOUND', 'Browser session does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.browser_session SET host_or_bridge_id=$2,lifecycle='READY',state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND lifecycle IN ('CREATING','RECOVERING','READY') AND state_version=$3 RETURNING *`, [id, context.arguments.hostOrBridgeId ?? null, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Browser session changed while attaching');
  await recordAudit(client, context, 'BROWSER_SESSION', id, { sessionId: id, lifecycle: 'READY' });
  return result(context, 'browser_session', updated, updated.state_version, { lifecycle: 'READY' });
}

async function handleBrowserSessionClose(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.browser_session WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_SESSION_NOT_FOUND', 'Browser session does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.browser_session SET lifecycle='CLEANING',control_holder='NONE',control_expires_at=NULL,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND lifecycle IN ('READY','AI_CONTROLLED','OWNER_CONTROLLED','AUTOMATION_CONTROLLED','TAKEOVER','RECONCILING','RECOVERING') AND state_version=$2 RETURNING *`, [id, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Browser session changed while closing');
  await recordAudit(client, context, 'BROWSER_SESSION', id, { sessionId: id, lifecycle: 'CLEANING' });
  return result(context, 'browser_session', updated, updated.state_version, { cleanupRequired: true });
}

async function handleBrowserSessionPause(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.browser_session WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_SESSION_NOT_FOUND', 'Browser session does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.browser_session SET lifecycle='RECONCILING',state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND lifecycle IN ('READY','AI_CONTROLLED','OWNER_CONTROLLED','AUTOMATION_CONTROLLED') AND state_version=$2 RETURNING *`, [id, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Browser session changed while pausing');
  await recordAudit(client, context, 'BROWSER_SESSION', id, { sessionId: id, lifecycle: 'RECONCILING' });
  return result(context, 'browser_session', updated, updated.state_version, { lifecycle: 'RECONCILING' });
}

async function handleBrowserSessionRecover(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.browser_session WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_SESSION_NOT_FOUND', 'Browser session does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.browser_session SET lifecycle='RECOVERING',context_generation=context_generation+1,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND lifecycle IN ('RECONCILING','RECOVERING','FAILED_FINAL','MANUAL_REVIEW') AND state_version=$2 RETURNING *`, [id, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Browser session changed while recovering');
  await recordAudit(client, context, 'BROWSER_SESSION', id, { sessionId: id, lifecycle: 'RECOVERING', contextGeneration: updated.context_generation });
  return result(context, 'browser_session', updated, updated.state_version, { lifecycle: 'RECOVERING' });
}

async function handleBrowserSessionResume(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.browser_session WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_SESSION_NOT_FOUND', 'Browser session does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.browser_session SET lifecycle='AI_CONTROLLED',control_holder='AI',state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND lifecycle IN ('RECONCILING','RECOVERING','PAUSED','READY') AND state_version=$2 RETURNING *`, [id, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Browser session changed while resuming');
  await recordAudit(client, context, 'BROWSER_SESSION', id, { sessionId: id, lifecycle: 'AI_CONTROLLED' });
  return result(context, 'browser_session', updated, updated.state_version, { lifecycle: 'AI_CONTROLLED' });
}

async function handleBrowserSessionState(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.browser_session WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_SESSION_NOT_FOUND', 'Browser session does not exist');
  assertVersion(context, current);
  const lifecycle = textArg(context, 'lifecycle');
  const updated = row((await client.query(`UPDATE kcml.browser_session SET lifecycle=$2,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state_version=$3 RETURNING *`, [id, lifecycle, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Browser session changed while changing state');
  await recordAudit(client, context, 'BROWSER_SESSION', id, { sessionId: id, lifecycle });
  return result(context, 'browser_session', updated, updated.state_version, { lifecycle });
}

async function handleBrowserStateCapture(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const accountId = uuidArg(context, 'accountBindingId', context.targetId ?? undefined);
  const account = row((await client.query(`SELECT * FROM kcml.browser_account_binding WHERE id=$1 FOR UPDATE`, [accountId])).rows as Row[], 'BROWSER_ACCOUNT_NOT_FOUND', 'Browser account binding does not exist');
  const id = randomUUID();
  const version = Number(account.auth_epoch ?? 0) + 1;
  const encrypted = Buffer.isBuffer(context.arguments.encryptedBundle) ? context.arguments.encryptedBundle : Buffer.from(String(context.arguments.encryptedBundle ?? ''));
  const state = row((await client.query(`INSERT INTO kcml.browser_state_bundle(id,account_binding_id,version_number,runtime_build_digest,encrypted_bundle,nonce,auth_tag,member_inventory,canonical_digest)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [id, accountId, version, digestArgument(context, 'runtimeBuildDigest', {}), encrypted, Buffer.from(String(context.arguments.nonce ?? 'nonce')), Buffer.from(String(context.arguments.authTag ?? 'tag')), objectArg(context, 'memberInventory'), digest({ id, accountId, version })])).rows as Row[], 'BROWSER_STATE_BUNDLE_NOT_CREATED', 'Browser state bundle was not persisted');
  const updatedAccount = row((await client.query(`UPDATE kcml.browser_account_binding SET active_state_bundle_version_id=$2,auth_epoch=$3,updated_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1 AND state_version=$4 RETURNING *`, [accountId, id, version, account.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Browser account changed while capturing state');
  await recordAudit(client, context, 'BROWSER_STATE_BUNDLE', id, { stateBundleId: id, accountBindingId: accountId, version });
  return result(context, 'browser_state_bundle', state, updatedAccount.state_version, { version, accountStateVersion: updatedAccount.state_version });
}

async function handleBrowserStateActivate(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const accountId = uuidArg(context, 'accountBindingId');
  const bundleId = target(context);
  const bundle = row((await client.query(`SELECT * FROM kcml.browser_state_bundle WHERE id=$1 AND account_binding_id=$2 FOR SHARE`, [bundleId, accountId])).rows as Row[], 'BROWSER_STATE_BUNDLE_NOT_FOUND', 'Browser state bundle does not exist');
  const account = row((await client.query(`SELECT * FROM kcml.browser_account_binding WHERE id=$1 FOR UPDATE`, [accountId])).rows as Row[], 'BROWSER_ACCOUNT_NOT_FOUND', 'Browser account binding does not exist');
  assertVersion(context, account);
  const updated = row((await client.query(`UPDATE kcml.browser_account_binding SET active_state_bundle_version_id=$2,updated_at=clock_timestamp(),state_version=state_version+1,audit_correlation_id=$3 WHERE id=$1 AND state_version=$4 RETURNING *`, [accountId, bundle.id, context.correlationId, account.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Browser account changed while activating state bundle');
  await recordAudit(client, context, 'BROWSER_ACCOUNT_BINDING', accountId, { accountBindingId: accountId, activeStateBundleId: bundle.id });
  return result(context, 'browser_account_binding', updated, updated.state_version, { activeStateBundleId: bundle.id });
}

async function handleBrowserStateInvalidate(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const account = row((await client.query(`SELECT * FROM kcml.browser_account_binding WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_ACCOUNT_NOT_FOUND', 'Browser account binding does not exist');
  assertVersion(context, account);
  const updated = row((await client.query(`UPDATE kcml.browser_account_binding SET active_state_bundle_version_id=NULL,auth_epoch=auth_epoch+1,last_usage_metadata=$2,updated_at=clock_timestamp(),state_version=state_version+1,audit_correlation_id=$3 WHERE id=$1 AND state_version=$4 RETURNING *`, [id, { invalidated: true, reason: context.arguments.reason ?? null }, context.correlationId, account.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Browser account changed while invalidating state');
  await recordAudit(client, context, 'BROWSER_ACCOUNT_BINDING', id, { accountBindingId: id, stateBundleInvalidated: true, authEpoch: updated.auth_epoch });
  return result(context, 'browser_account_binding', updated, updated.state_version, { authEpoch: updated.auth_epoch });
}

async function handleBrowserTargetPick(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const sessionId = browserSessionId(context);
  const session = row((await client.query(`SELECT * FROM kcml.browser_session WHERE id=$1 FOR SHARE`, [sessionId])).rows as Row[], 'BROWSER_SESSION_NOT_FOUND', 'Browser session does not exist');
  const document = row((await client.query(`SELECT d.id,d.page_id,d.frame_id,d.document_epoch,p.page_generation
    FROM kcml.browser_document d JOIN kcml.browser_page p ON p.id=d.page_id
    WHERE d.id=$1 AND d.page_id=$2 AND d.frame_id=$3 AND d.document_epoch=$4 AND d.document_lifecycle='ACTIVE' FOR SHARE OF d,p`, [uuidArg(context, 'documentId'), uuidArg(context, 'pageId'), uuidArg(context, 'frameId'), numberArg(context, 'documentEpoch')])).rows as Row[], 'BROWSER_DOCUMENT_STALE', 'LocatorRef document identity is not active');
  if (BigInt(String(session.context_generation)) !== BigInt(String(context.arguments.contextGeneration)) || BigInt(String(document.page_generation)) !== BigInt(String(context.arguments.pageGeneration)) || String(session.current_page_id) !== String(document.page_id) || String(session.current_frame_id) !== String(document.frame_id) || BigInt(String(session.document_epoch)) !== BigInt(String(document.document_epoch))) {
    throw new DomainError('BROWSER_DOCUMENT_STALE', 'LocatorRef fence is not the current session identity', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
  }
  const framePath = listArg(context, 'framePath');
  if (framePath.length > 64 || framePath.some(value => !Number.isSafeInteger(Number(value)) || Number(value) < 0)) throw new DomainError('BROWSER_ACTIONABILITY_FAILED', 'LocatorRef framePath is invalid', 422, 'DO_NOT_RETRY');
  const id = randomUUID();
  const reference = row((await client.query(`INSERT INTO kcml.browser_target_reference(id,session_id,locator_schema_version,context_generation,page_id,page_generation,frame_id,frame_path,document_id,document_epoch,semantic_description,locator_ast,target_fingerprint,created_from_observation_revision)
    VALUES($1,$2,'1.0',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`, [
    id, sessionId, String(session.context_generation), document.page_id, String(document.page_generation), document.frame_id, framePath, document.id, String(document.document_epoch), textArg(context, 'semanticDescription'), objectArg(context, 'locatorAst'), digestArgument(context, 'targetFingerprint', objectArg(context, 'locatorAst')), numberArg(context, 'observationRevision')
  ])).rows as Row[], 'BROWSER_TARGET_NOT_CREATED', 'Browser target reference was not persisted');
  await recordAudit(client, context, 'BROWSER_TARGET_REFERENCE', id, { targetReferenceId: id, sessionId });
  return result(context, 'browser_target_reference', reference, undefined, { targetReferenceId: id });
}

async function handleBrowserTargetRevalidate(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const reference = row((await client.query(`SELECT * FROM kcml.browser_target_reference WHERE id=$1 FOR SHARE`, [id])).rows as Row[], 'BROWSER_TARGET_NOT_FOUND', 'Browser target reference does not exist');
  const evidence = { revalidated: context.arguments.revalidated !== false, observationRevision: context.arguments.observationRevision ?? reference.created_from_observation_revision, evidence: objectArg(context, 'evidence') };
  await recordAudit(client, context, 'BROWSER_TARGET_REFERENCE', id, { targetReferenceId: id, revalidation: evidence });
  return result(context, 'browser_target_reference', reference, undefined, evidence);
}

async function handleBrowserTeachingStart(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = randomUUID();
  const sessionId = browserSessionId(context);
  const teaching = row((await client.query(`INSERT INTO kcml.browser_teaching_run(id,parent_kind,parent_object_id,session_id,status,control_participants,operation_scope_id,first_event_sequence,compiler_version,runtime_version,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,'RECORDING',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`, [
    id, textArg(context, 'parentKind', 'OWNER_CHAT'), uuidArg(context, 'parentObjectId', sessionId), sessionId, objectArg(context, 'controlParticipants', { owner: 'KRMAR78' }), uuidArg(context, 'operationScopeId'), numberArg(context, 'firstEventSequence', 1), textArg(context, 'compilerVersion', 'td12'), textArg(context, 'runtimeVersion', 'td12'), digest({ id, sessionId }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'BROWSER_TEACHING_NOT_CREATED', 'Browser teaching run was not persisted');
  await recordAudit(client, context, 'BROWSER_TEACHING_RUN', id, { teachingRunId: id, status: 'RECORDING' });
  return result(context, 'browser_teaching_run', teaching, teaching.state_version, { teachingRunId: id });
}

async function handleBrowserTeachingCompile(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.browser_teaching_run WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_TEACHING_NOT_FOUND', 'Browser teaching run does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.browser_teaching_run SET status='COMPILING',coverage_report=$2,ambiguity_report=$3,mutation_semantics_report=$4,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND status IN ('RECORDING','COMPILING') AND state_version=$5 RETURNING *`, [id, objectArg(context, 'coverageReport'), objectArg(context, 'ambiguityReport'), objectArg(context, 'mutationSemanticsReport'), current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Browser teaching run changed while compiling');
  await recordAudit(client, context, 'BROWSER_TEACHING_RUN', id, { teachingRunId: id, status: 'COMPILING' });
  return result(context, 'browser_teaching_run', updated, updated.state_version, { status: 'COMPILING' });
}

async function handleBrowserUploadCreate(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const sessionId = browserSessionId(context);
  const id = uuidArg(context, 'uploadId', context.targetId ?? undefined);
  const expiresAt = futureArg(context, 'expiresAt', 300);
  const upload = row((await client.query(`INSERT INTO kcml.browser_upload_handle(id,session_id,run_id,step_id,artifact_id,safe_name,mime_type,extension,size_bytes,content_digest,sensitivity,target_policy,file_count_policy,directory_policy,expires_at,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`, [
    id, sessionId, context.arguments.runId ?? null, context.arguments.stepId ?? null, context.arguments.artifactId ?? null, textArg(context, 'safeName', 'upload.bin'), context.arguments.mimeType ?? null, context.arguments.extension ?? null, numberArg(context, 'sizeBytes', 0), digestArgument(context, 'contentDigest', {}), textArg(context, 'sensitivity', 'OWNER_ONLY'), objectArg(context, 'targetPolicy'), numberArg(context, 'fileCountPolicy', 1), textArg(context, 'directoryPolicy', 'FILES_ONLY'), expiresAt, digest({ id, sessionId, expiresAt }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'BROWSER_UPLOAD_NOT_CREATED', 'Browser upload handle was not persisted');
  await recordAudit(client, context, 'BROWSER_UPLOAD_HANDLE', id, { uploadId: id, sessionId, expiresAt });
  return result(context, 'browser_upload_handle', upload, upload.state_version, { uploadId: id });
}

async function handleBrowserUploadConsume(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.browser_upload_handle WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'BROWSER_UPLOAD_NOT_FOUND', 'Browser upload handle does not exist');
  assertVersion(context, current);
  if (current.consumed_at) return result(context, 'browser_upload_handle', current, current.state_version, { duplicate: true });
  const updated = row((await client.query(`UPDATE kcml.browser_upload_handle SET consumed_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp() AND state_version=$2 RETURNING *`, [id, current.state_version])).rows as Row[], 'BROWSER_UPLOAD_EXPIRED', 'Browser upload handle is expired or already consumed');
  await recordAudit(client, context, 'BROWSER_UPLOAD_HANDLE', id, { uploadId: id, consumed: true });
  return result(context, 'browser_upload_handle', updated, updated.state_version, { consumed: true });
}

// ---------------------------------------------------------------------------
// Chat operations. A chat mutation always has a conversation/message/action
// row as its authoritative state; the response stream is not persisted as a
// free-standing success marker.
// ---------------------------------------------------------------------------

async function handleChatConversationCreate(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = randomUUID();
  const conversation = row((await client.query(`INSERT INTO kcml.system_chat_conversation(id,stable_key,title,owner_actor_id,access_channel,status,selected_model,last_activity_at,current_object_context,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,'KRMAR78',$4,'OPEN',$5,clock_timestamp(),$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [
    id, `chat:${context.logicalOperationId}`, textArg(context, 'title'), textArg(context, 'accessChannel', 'SESSION'), textArg(context, 'selectedModel'), objectArg(context, 'objectContext'), digest({ id, title: context.arguments.title, model: context.arguments.selectedModel }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'CHAT_CONVERSATION_NOT_CREATED', 'Chat conversation was not persisted');
  await recordAudit(client, context, 'SYSTEM_CHAT_CONVERSATION', id, { conversationId: id, status: 'OPEN' });
  return result(context, 'system_chat_conversation', conversation, conversation.state_version, { conversationId: id });
}

async function handleChatBrowserSessionCreate(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const conversationId = target(context);
  const conversation = row((await client.query(`SELECT * FROM kcml.system_chat_conversation WHERE id=$1 FOR UPDATE`, [conversationId])).rows as Row[], 'CHAT_CONVERSATION_NOT_FOUND', 'Chat conversation does not exist');
  const sessionId = randomUUID();
  const session = row((await client.query(`INSERT INTO kcml.browser_session(id,parent_kind,parent_id,purpose,execution_target,runtime_build_id,account_binding_id,operation_scope,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,'OWNER_CHAT',$2,$3,'SERVER_MANAGED',$4,$5,$6,$7,$8) RETURNING *`, [sessionId, conversationId, textArg(context, 'purpose', 'chat browser session'), textArg(context, 'runtimeBuildId', 'playwright-1.58.2'), context.arguments.accountBindingId ?? null, objectArg(context, 'operationScope'), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()])).rows as Row[], 'CHAT_BROWSER_SESSION_NOT_CREATED', 'Chat browser session was not persisted');
  const updated = row((await client.query(`UPDATE kcml.system_chat_conversation SET active_browser_session_id=$2,last_activity_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state_version=$3 RETURNING *`, [conversationId, sessionId, conversation.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Chat conversation changed while creating browser session');
  await recordAudit(client, context, 'SYSTEM_CHAT_CONVERSATION', conversationId, { conversationId, browserSessionId: sessionId });
  return result(context, 'browser_session', session, session.state_version, { conversationStateVersion: updated.state_version });
}

async function handleChatBrowserSessionAttach(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const conversationId = target(context);
  const conversation = row((await client.query(`SELECT * FROM kcml.system_chat_conversation WHERE id=$1 FOR UPDATE`, [conversationId])).rows as Row[], 'CHAT_CONVERSATION_NOT_FOUND', 'Chat conversation does not exist');
  const sessionId = uuidArg(context, 'browserSessionId');
  const updated = row((await client.query(`UPDATE kcml.system_chat_conversation SET active_browser_session_id=$2,last_activity_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state_version=$3 RETURNING *`, [conversationId, sessionId, conversation.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Chat conversation changed while attaching browser session');
  await recordAudit(client, context, 'SYSTEM_CHAT_CONVERSATION', conversationId, { conversationId, browserSessionId: sessionId });
  return result(context, 'system_chat_conversation', updated, updated.state_version, { browserSessionId: sessionId });
}

async function handleChatBrowserTargetAttach(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const conversationId = target(context);
  const conversation = row((await client.query(`SELECT * FROM kcml.system_chat_conversation WHERE id=$1 FOR UPDATE`, [conversationId])).rows as Row[], 'CHAT_CONVERSATION_NOT_FOUND', 'Chat conversation does not exist');
  const targetRef = uuidArg(context, 'targetReferenceId');
  const objectContext = { ...objectArg(context, 'objectContext'), browserTargetReferenceId: targetRef };
  const updated = row((await client.query(`UPDATE kcml.system_chat_conversation SET current_object_context=$2,last_activity_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state_version=$3 RETURNING *`, [conversationId, objectContext, conversation.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Chat conversation changed while attaching browser target');
  await recordAudit(client, context, 'SYSTEM_CHAT_CONVERSATION', conversationId, { conversationId, browserTargetReferenceId: targetRef });
  return result(context, 'system_chat_conversation', updated, updated.state_version, { browserTargetReferenceId: targetRef });
}

async function handleChatBrowserControlAcquire(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const conversationId = target(context);
  const conversation = row((await client.query(`SELECT * FROM kcml.system_chat_conversation WHERE id=$1 FOR UPDATE`, [conversationId])).rows as Row[], 'CHAT_CONVERSATION_NOT_FOUND', 'Chat conversation does not exist');
  const sessionId = uuidArg(context, 'browserSessionId', typeof conversation.active_browser_session_id === 'string' ? conversation.active_browser_session_id : undefined);
  const session = row((await client.query(`SELECT * FROM kcml.browser_session WHERE id=$1 FOR UPDATE`, [sessionId])).rows as Row[], 'BROWSER_SESSION_NOT_FOUND', 'Browser session does not exist');
  const updatedSession = row((await client.query(`UPDATE kcml.browser_session SET control_holder='AI',control_epoch=control_epoch+1,control_fence=control_fence+1,lifecycle='AI_CONTROLLED',state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND lifecycle NOT IN ('CLOSED','FAILED_FINAL','MANUAL_REVIEW') RETURNING *`, [sessionId])).rows as Row[], 'BROWSER_SESSION_NOT_FOUND', 'Browser session changed while acquiring chat control');
  await client.query(`UPDATE kcml.system_chat_conversation SET last_activity_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state_version=$2`, [conversationId, conversation.state_version]);
  await recordAudit(client, context, 'BROWSER_SESSION', sessionId, { conversationId, sessionId, controlHolder: 'AI' });
  return result(context, 'browser_session', updatedSession, updatedSession.state_version, { conversationStateVersion: BigInt(String(conversation.state_version ?? 0)) + 1n, previousSessionStateVersion: session.state_version });
}

async function handleChatBrowserControlReturnToAi(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const conversationId = target(context);
  const conversation = row((await client.query(`SELECT * FROM kcml.system_chat_conversation WHERE id=$1 FOR UPDATE`, [conversationId])).rows as Row[], 'CHAT_CONVERSATION_NOT_FOUND', 'Chat conversation does not exist');
  const sessionId = uuidArg(context, 'browserSessionId', typeof conversation.active_browser_session_id === 'string' ? conversation.active_browser_session_id : undefined);
  const updated = row((await client.query(`UPDATE kcml.browser_session SET control_holder='AI',lifecycle='AI_CONTROLLED',control_epoch=control_epoch+1,control_fence=control_fence+1,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND lifecycle NOT IN ('CLOSED','FAILED_FINAL') RETURNING *`, [sessionId])).rows as Row[], 'BROWSER_SESSION_NOT_FOUND', 'Browser session does not exist');
  await client.query(`UPDATE kcml.system_chat_conversation SET status='OPEN',last_activity_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state_version=$2`, [conversationId, conversation.state_version]);
  await recordAudit(client, context, 'BROWSER_SESSION', sessionId, { conversationId, controlHolder: 'AI' });
  return result(context, 'browser_session', updated, updated.state_version, { controlHolder: 'AI' });
}

async function handleChatCommandExecute(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const conversationId = target(context);
  const conversation = row((await client.query(`SELECT * FROM kcml.system_chat_conversation WHERE id=$1 FOR UPDATE`, [conversationId])).rows as Row[], 'CHAT_CONVERSATION_NOT_FOUND', 'Chat conversation does not exist');
  const messageId = uuidArg(context, 'messageId');
  const action = row((await client.query(`INSERT INTO kcml.system_chat_action(message_id,operation_key,target,arguments,arguments_digest,status,started_at,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,'EXECUTING',clock_timestamp(),$6,$7,$8,$9,$10,$11) RETURNING *`, [messageId, textArg(context, 'operationKey'), objectArg(context, 'target'), objectArg(context, 'arguments'), digest(objectArg(context, 'arguments')), digest({ messageId, operation: context.arguments.operationKey }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()])).rows as Row[], 'CHAT_ACTION_NOT_CREATED', 'Chat command action was not persisted');
  await client.query(`UPDATE kcml.system_chat_conversation SET status='PROCESSING',last_activity_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state_version=$2`, [conversationId, conversation.state_version]);
  await recordAudit(client, context, 'SYSTEM_CHAT_ACTION', String(action.id), { actionId: action.id, conversationId, status: 'EXECUTING' });
  return result(context, 'system_chat_action', action, action.state_version, { conversationId });
}

async function handleChatMessageAppend(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const conversationId = target(context);
  const conversation = row((await client.query(`SELECT * FROM kcml.system_chat_conversation WHERE id=$1 FOR UPDATE`, [conversationId])).rows as Row[], 'CHAT_CONVERSATION_NOT_FOUND', 'Chat conversation does not exist');
  const sequence = await nextSequence(client, 'SYSTEM_CHAT_MESSAGE', conversationId, 'SEQUENCE');
  const message = row((await client.query(`INSERT INTO kcml.system_chat_message(conversation_id,sequence,role,content,attachments,status,completed_at,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,clock_timestamp(),$7,$8,$9,$10,$11,$12) RETURNING *`, [
    conversationId, sequence.toString(), textArg(context, 'role', 'OWNER'), textArg(context, 'content'), context.arguments.attachments ?? [], textArg(context, 'status', 'COMPLETED'), digest({ conversationId, sequence: sequence.toString(), content: context.arguments.content }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'CHAT_MESSAGE_NOT_CREATED', 'Chat message was not persisted');
  await client.query(`UPDATE kcml.system_chat_conversation SET last_activity_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state_version=$2`, [conversationId, conversation.state_version]);
  await recordAudit(client, context, 'SYSTEM_CHAT_CONVERSATION', conversationId, { messageId: message.id, sequence: sequence.toString() });
  return result(context, 'system_chat_message', message, message.state_version, { aggregate_event_sequence: sequence.toString() });
}

async function handleChatResponseStream(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const action = row((await client.query(`SELECT * FROM kcml.system_chat_action WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'CHAT_ACTION_NOT_FOUND', 'Chat action does not exist');
  const response = context.arguments.result ?? null;
  const status = textArg(context, 'status', 'SUCCEEDED');
  const updated = row((await client.query(`UPDATE kcml.system_chat_action SET status=$2,result=$3,result_digest=$4,completed_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND status IN ('PROPOSED','RESERVED','EXECUTING') RETURNING *`, [id, status, response, digest(response)])).rows as Row[], 'CHAT_ACTION_UPDATE_FAILED', 'Chat response action could not be completed');
  await recordAudit(client, context, 'SYSTEM_CHAT_ACTION', id, { actionId: id, status, responseDigest: canonicalDigest(json(response)) });
  return result(context, 'system_chat_action', updated, updated.state_version, { transition: `${String(action.status)}->${status}` });
}

// ---------------------------------------------------------------------------
// Component and generation operations.
// ---------------------------------------------------------------------------

async function handleComponentTransition(client: DatabaseClient, context: CanonicalHandlerContext, activationState: string, enabled: boolean): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.component WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'COMPONENT_NOT_FOUND', 'Component does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.component SET activation_state=$2,enabled=$3,latest_transition_operation_id=$4,correlation_id=$5,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state_version=$6 RETURNING *`, [id, activationState, enabled, context.logicalOperationId, context.correlationId, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Component changed while applying transition');
  const history = row((await client.query(`INSERT INTO kcml.component_state_history(component_id,lifecycle_state,operational_state,recertification_state,reason,recorded_at,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,clock_timestamp(),$6,$7,$8,$9,$10,$11) RETURNING *`, [id, String(updated.activation_state), String(updated.operational_state ?? 'UNKNOWN'), String(updated.recertification_state ?? 'UNKNOWN'), context.arguments.reason ?? context.operation.operationName, digest({ id, activationState, enabled }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()])).rows as Row[], 'COMPONENT_HISTORY_NOT_CREATED', 'Component state history was not persisted');
  await recordAudit(client, context, 'COMPONENT', id, { componentId: id, activationState, enabled, historyId: history.id });
  return result(context, 'component', updated, updated.state_version, { historyId: history.id });
}

async function handleComponentActivate(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  return handleComponentTransition(client, context, 'ACTIVE', Boolean(context.arguments.enabled ?? true));
}

async function handleComponentEnable(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  return handleComponentTransition(client, context, 'ACTIVE', true);
}

async function handleComponentDisable(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  return handleComponentTransition(client, context, 'SUSPENDED', false);
}

async function handleComponentControlEnable(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  return handleComponentTransition(client, context, 'ACTIVE', true);
}

async function handleComponentControlDisable(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  return handleComponentTransition(client, context, 'SUSPENDED', false);
}

async function handleComponentControlAck(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.component WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'COMPONENT_NOT_FOUND', 'Component does not exist');
  const updated = row((await client.query(`UPDATE kcml.component SET latest_transition_operation_id=$2,correlation_id=$3,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *`, [id, context.logicalOperationId, context.correlationId])).rows as Row[], 'COMPONENT_NOT_FOUND', 'Component changed while acknowledging control');
  await recordAudit(client, context, 'COMPONENT', id, { componentId: id, acknowledgement: objectArg(context, 'evidence') });
  return result(context, 'component', updated, updated.state_version, { acknowledged: true, previousStateVersion: current.state_version });
}

async function handleComponentRollback(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.component WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'COMPONENT_NOT_FOUND', 'Component does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.component SET activation_state='ROLLING_BACK',active_revision_id=$2,current_release_id=$3,latest_transition_operation_id=$4,state_version=state_version+1,updated_at=clock_timestamp(),correlation_id=$5 WHERE id=$1 AND state_version=$6 RETURNING *`, [id, context.arguments.previousRevisionId ?? null, context.arguments.previousReleaseId ?? null, context.logicalOperationId, context.correlationId, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Component changed while rolling back');
  await recordAudit(client, context, 'COMPONENT', id, { componentId: id, activationState: 'ROLLING_BACK' });
  return result(context, 'component', updated, updated.state_version, { reconciliationRequired: true });
}

async function handleGenerationActivationPrepare(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.generation_activation_set WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'GENERATION_ACTIVATION_SET_NOT_FOUND', 'Generation activation set does not exist');
  if (current.state !== 'DRAFT' && current.state !== 'READY') throw new DomainError('SIDE_EFFECT_RECONCILIATION_FAILED', 'Activation preparation requires a draft or ready set', 409, 'RECONCILE_THEN_RETRY');
  const updated = row((await client.query(`UPDATE kcml.generation_activation_set SET state='READY',candidate_snapshot=$2,updated_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1 AND state_version=$3 RETURNING *`, [id, objectArg(context, 'candidateSnapshot', objectArg(current, 'candidate_snapshot')), current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Activation set changed while preparing');
  await recordAudit(client, context, 'GENERATION_ACTIVATION_SET', id, { activationSetId: id, state: 'READY' });
  return result(context, 'generation_activation_set', updated, updated.state_version, { state: 'READY' });
}

async function handleGenerationActivationRollback(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.generation_activation_set WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'GENERATION_ACTIVATION_SET_NOT_FOUND', 'Generation activation set does not exist');
  if (!['ACTIVE', 'SWITCHING', 'VERIFYING', 'FAILED', 'MANUAL_REVIEW'].includes(String(current.state))) throw new DomainError('SIDE_EFFECT_RECONCILIATION_FAILED', 'Activation rollback is not allowed from the current state', 409, 'RECONCILE_THEN_RETRY');
  const updated = row((await client.query(`UPDATE kcml.generation_activation_set SET state='ROLLING_BACK',candidate_snapshot=$2,rollback_plan=$3,updated_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1 AND state_version=$4 RETURNING *`, [id, objectArg(context, 'previousSnapshot', objectArg(current, 'previous_snapshot')), objectArg(context, 'rollbackPlan'), current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Activation set changed while rolling back');
  await recordAudit(client, context, 'GENERATION_ACTIVATION_SET', id, { activationSetId: id, state: 'ROLLING_BACK' });
  return result(context, 'generation_activation_set', updated, updated.state_version, { state: 'ROLLING_BACK' });
}

async function handleGenerationActivationSwitch(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.generation_activation_set WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'GENERATION_ACTIVATION_SET_NOT_FOUND', 'Generation activation set does not exist');
  if (current.state !== 'READY') throw new DomainError('SIDE_EFFECT_RECONCILIATION_FAILED', 'Only a ready activation set can switch', 409, 'RECONCILE_THEN_RETRY');
  const updated = row((await client.query(`UPDATE kcml.generation_activation_set SET state='SWITCHING',activation_epoch=$2,updated_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1 AND state='READY' AND state_version=$3 RETURNING *`, [id, context.activationEpoch.toString(), current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Activation set changed while switching');
  await recordAudit(client, context, 'GENERATION_ACTIVATION_SET', id, { activationSetId: id, state: 'SWITCHING', activationEpoch: context.activationEpoch.toString() });
  return result(context, 'generation_activation_set', updated, updated.state_version, { state: 'SWITCHING' });
}

async function handleGenerationBlockerOpen(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = randomUUID();
  const jobId = uuidArg(context, 'jobId', context.targetId ?? undefined);
  const blocker = row((await client.query(`INSERT INTO kcml.generation_blocker(id,job_id,phase,plan_node_id,blocker_code,classification,title,detail,requirement_ids,evidence,required_resolution,input_schema,resume_phase,state,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'OPEN',$14,$15,$16,$17,$18,$19) RETURNING *`, [
    id, jobId, textArg(context, 'phase', 'UNKNOWN'), context.arguments.planNodeId ?? null, textArg(context, 'blockerCode'), textArg(context, 'classification', 'BLOCKING'), textArg(context, 'title'), textArg(context, 'detail'), listArg(context, 'requirementIds'), objectArg(context, 'evidence'), textArg(context, 'requiredResolution'), objectArg(context, 'inputSchema'), context.arguments.resumePhase ?? null, digest({ id, jobId, blockerCode: context.arguments.blockerCode }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'GENERATION_BLOCKER_NOT_CREATED', 'Generation blocker was not persisted');
  await client.query(`UPDATE kcml.generation_job SET lifecycle='BLOCKED',blocker=$2,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND lifecycle NOT IN ('COMPLETED','CANCELLED')`, [jobId, { blockerId: id, code: blocker.blocker_code }]);
  await recordAudit(client, context, 'GENERATION_BLOCKER', id, { blockerId: id, jobId, state: 'OPEN' });
  return result(context, 'generation_blocker', blocker, blocker.state_version, { blockerId: id, jobState: 'BLOCKED' });
}

async function handleGenerationBlockerResolve(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.generation_blocker WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'GENERATION_BLOCKER_NOT_FOUND', 'Generation blocker does not exist');
  const updated = row((await client.query(`UPDATE kcml.generation_blocker SET state='RESOLVED',resolved_at=clock_timestamp(),resolver='KRMAR78',evidence=$2,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state IN ('OPEN','BLOCKED') RETURNING *`, [id, { resolution: objectArg(context, 'resolution'), evidence: objectArg(context, 'evidence') }])).rows as Row[], 'GENERATION_BLOCKER_UPDATE_FAILED', 'Generation blocker changed while resolving');
  await client.query(`UPDATE kcml.generation_job SET blocker=NULL,lifecycle='DISCUSSING',state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND blocker->>'blockerId'=$2`, [current.job_id, id]);
  await recordAudit(client, context, 'GENERATION_BLOCKER', id, { blockerId: id, state: 'RESOLVED' });
  return result(context, 'generation_blocker', updated, updated.state_version, { state: 'RESOLVED' });
}

async function handleGenerationCandidatePublish(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.generation_contract_candidate WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'GENERATION_CANDIDATE_NOT_FOUND', 'Generation contract candidate does not exist');
  const objectId = uuidArg(context, 'publishedObjectId');
  const revisionId = uuidArg(context, 'publishedRevisionId');
  const updated = row((await client.query(`UPDATE kcml.generation_contract_candidate SET published_object_id=$2,published_revision_id=$3,validation_state='PASS',verification_state='PASS',integration_state='PUBLISHED',integration_evidence=$4,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND integration_state IN ('PENDING','VALIDATED','VERIFIED') RETURNING *`, [id, objectId, revisionId, objectArg(context, 'evidence')])).rows as Row[], 'GENERATION_CANDIDATE_UPDATE_FAILED', 'Generation candidate changed while publishing');
  await recordAudit(client, context, 'GENERATION_CONTRACT_CANDIDATE', id, { candidateId: id, publishedObjectId: objectId, publishedRevisionId: revisionId });
  return result(context, 'generation_contract_candidate', updated, updated.state_version, { previousState: current.integration_state });
}

async function handleGenerationCapabilityResolve(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = randomUUID();
  const jobId = uuidArg(context, 'jobId', context.targetId ?? undefined);
  const specificationRevisionId = uuidArg(context, 'specificationRevisionId');
  const snapshot = objectArg(context, 'snapshotPayload');
  const value = row((await client.query(`INSERT INTO kcml.generation_capability_snapshot(id,job_id,specification_revision_id,requirement_digest,catalog_epoch,snapshot_payload,snapshot_digest,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`, [id, jobId, specificationRevisionId, digestArgument(context, 'requirementDigest', {}), numberArg(context, 'catalogEpoch', Number(context.activationEpoch)), snapshot, digest(snapshot), digest({ id, jobId, snapshot }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()])).rows as Row[], 'GENERATION_CAPABILITY_NOT_CREATED', 'Generation capability snapshot was not persisted');
  await recordAudit(client, context, 'GENERATION_CAPABILITY_SNAPSHOT', id, { capabilitySnapshotId: id, jobId, specificationRevisionId });
  return result(context, 'generation_capability_snapshot', value, value.state_version, { capabilitySnapshotId: id });
}

async function handleGenerationIntegrationStep(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const jobId = target(context);
  const run = row((await client.query(`SELECT * FROM kcml.generation_job WHERE id=$1 FOR UPDATE`, [jobId])).rows as Row[], 'GENERATION_JOB_NOT_FOUND', 'Generation job does not exist');
  const step = objectArg(context, 'step');
  const checkpoint = await nextSequence(client, 'GENERATION_CHECKPOINT', jobId, 'SEQUENCE');
  const checkpointRow = row((await client.query(`INSERT INTO kcml.generation_checkpoint(generation_job_id,sequence,phase,workspace_revision,payload,payload_digest,checkpoint_kind,terminal_evidence,successor_phase)
    VALUES($1,$2,'INTEGRATING',$3,$4,$5,'INTEGRATION_STEP',$6,$7) RETURNING *`, [jobId, checkpoint.toString(), numberArg(context, 'workspaceRevision', 0), step, digest(step), objectArg(context, 'evidence'), context.arguments.successorPhase ?? null])).rows as Row[], 'GENERATION_CHECKPOINT_NOT_CREATED', 'Generation integration checkpoint was not persisted');
  const updated = row((await client.query(`UPDATE kcml.generation_job SET lifecycle='INTEGRATING',current_phase='INTEGRATING',latest_checkpoint_id=$2,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state_version=$3 RETURNING *`, [jobId, checkpointRow.id, run.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Generation job changed while recording integration step');
  await recordAudit(client, context, 'GENERATION_JOB', jobId, { checkpointId: checkpointRow.id, phase: 'INTEGRATING' });
  return result(context, 'generation_job', updated, updated.state_version, { checkpointSequence: checkpoint.toString() });
}

async function handleGenerationJobCancel(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.generation_job WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'GENERATION_JOB_NOT_FOUND', 'Generation job does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.generation_job SET lifecycle='CANCELLED',cancellation_version=cancellation_version+1,cleanup_operation_id=$2,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND lifecycle NOT IN ('COMPLETED','CANCELLED') AND state_version=$3 RETURNING *`, [id, context.arguments.cleanupOperationId ?? null, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Generation job changed while cancelling');
  await recordAudit(client, context, 'GENERATION_JOB', id, { jobId: id, lifecycle: 'CANCELLED' });
  return result(context, 'generation_job', updated, updated.state_version, { lifecycle: 'CANCELLED' });
}

async function handleGenerationJobComplete(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.generation_job WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'GENERATION_JOB_NOT_FOUND', 'Generation job does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.generation_job SET lifecycle='COMPLETED',progress=100,result_object_id=$2,result_digest=$3,terminal_evidence=$4,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND lifecycle IN ('VALIDATING','CML_CONFORMANCE','ACTIVATING','INTEGRATING') AND state_version=$5 RETURNING *`, [id, context.arguments.resultObjectId ?? null, digest(context.arguments.result ?? null), objectArg(context, 'terminalEvidence'), current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Generation job changed while completing');
  await recordAudit(client, context, 'GENERATION_JOB', id, { jobId: id, lifecycle: 'COMPLETED' });
  return result(context, 'generation_job', updated, updated.state_version, { lifecycle: 'COMPLETED' });
}

async function handleGenerationJobResume(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.generation_job WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'GENERATION_JOB_NOT_FOUND', 'Generation job does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.generation_job SET lifecycle='DISCUSSING',recovery_state=$2,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND lifecycle IN ('BLOCKED','FAILED','CANCELLED') AND state_version=$3 RETURNING *`, [id, objectArg(context, 'recoveryState', { resumedAt: new Date().toISOString() }), current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Generation job changed while resuming');
  await recordAudit(client, context, 'GENERATION_JOB', id, { jobId: id, lifecycle: 'DISCUSSING' });
  return result(context, 'generation_job', updated, updated.state_version, { lifecycle: 'DISCUSSING' });
}

async function handleGenerationJobRetry(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.generation_job WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'GENERATION_JOB_NOT_FOUND', 'Generation job does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.generation_job SET lifecycle='ANALYZING',recovery_state=$2,cancellation_version=cancellation_version+1,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND lifecycle IN ('FAILED','BLOCKED') AND state_version=$3 RETURNING *`, [id, { retry: objectArg(context, 'retry'), retriedAt: new Date().toISOString() }, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Generation job changed while retrying');
  await recordAudit(client, context, 'GENERATION_JOB', id, { jobId: id, lifecycle: 'ANALYZING' });
  return result(context, 'generation_job', updated, updated.state_version, { lifecycle: 'ANALYZING' });
}

async function handleGenerationMessageAppend(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const jobId = target(context);
  const sequence = await nextSequence(client, 'GENERATION_MESSAGE', jobId, 'SEQUENCE');
  const content = objectArg(context, 'content', { text: textArg(context, 'contentText', 'generation message') });
  const message = row((await client.query(`INSERT INTO kcml.generation_message(job_id,sequence,role,content,attachments,status,client_message_id,content_digest,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`, [
    jobId, sequence.toString(), textArg(context, 'role', 'OWNER'), content, context.arguments.attachments ?? [], textArg(context, 'status', 'COMPLETED'), context.arguments.clientMessageId ?? null, digest(content), digest({ jobId, sequence: sequence.toString(), content }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'GENERATION_MESSAGE_NOT_CREATED', 'Generation message was not persisted');
  await recordAudit(client, context, 'GENERATION_JOB', jobId, { messageId: message.id, sequence: sequence.toString() });
  return result(context, 'generation_message', message, message.state_version, { sequence: sequence.toString() });
}

async function handleGenerationModelExecute(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const jobId = target(context);
  const job = row((await client.query(`SELECT * FROM kcml.generation_job WHERE id=$1 FOR UPDATE`, [jobId])).rows as Row[], 'GENERATION_JOB_NOT_FOUND', 'Generation job does not exist');
  const sideEffect = await sideEffectIntent(client, context, `generation-job:${jobId}`, objectArg(context, 'request', { model: context.arguments.model ?? job.model ?? null, input: context.arguments.input ?? null }));
  const modelCall = row((await client.query(`INSERT INTO kcml.ai_model_call(parent_run_id,attempt_sequence,model,request_descriptor,request_digest,input_digest,instructions_digest,tools_digest,settings_snapshot,local_state,submit_state,transport_evidence,model_logical_operation_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'SUBMITTING','DISPATCH_STARTED',$10,$11) RETURNING *`, [
    jobId, numberArg(context, 'attemptSequence', 1), textArg(context, 'model', String(job.model ?? 'unknown')), objectArg(context, 'requestDescriptor'), digest(objectArg(context, 'requestDescriptor')), digest(context.arguments.input ?? {}), digest(context.arguments.instructions ?? ''), digest(context.arguments.tools ?? []), objectArg(context, 'settings'), objectArg(context, 'transportEvidence'), context.logicalOperationId
  ])).rows as Row[], 'GENERATION_MODEL_CALL_NOT_CREATED', 'Generation model call was not persisted');
  await client.query(`UPDATE kcml.generation_job SET lifecycle='IMPLEMENTING',current_phase='IMPLEMENTING',state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state_version=$2`, [jobId, job.state_version]);
  await recordAudit(client, context, 'GENERATION_JOB', jobId, { modelCallId: modelCall.id, sideEffectOperationId: sideEffect.id });
  return result(context, 'ai_model_call', modelCall, modelCall.state_version, { sideEffectOperationId: sideEffect.id });
}

async function handleGenerationPhaseStart(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const jobId = target(context);
  const job = row((await client.query(`SELECT * FROM kcml.generation_job WHERE id=$1 FOR UPDATE`, [jobId])).rows as Row[], 'GENERATION_JOB_NOT_FOUND', 'Generation job does not exist');
  const phase = textArg(context, 'phase');
  const attempt = await nextSequence(client, 'GENERATION_PHASE_ATTEMPT', jobId, phase);
  const phaseRun = row((await client.query(`INSERT INTO kcml.generation_phase_run(job_id,phase,attempt,state,worker_pool,plan_node_range,started_at,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,'RUNNING',$4,$5,clock_timestamp(),$6,$7,$8,$9,$10,$11) RETURNING *`, [
    jobId, phase, attempt.toString(), generationWorkerPool(phase as GenerationPhase), objectArg(context, 'planNodeRange'), digest({ jobId, phase, attempt: attempt.toString() }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'GENERATION_PHASE_NOT_CREATED', 'Generation phase run was not persisted');
  const updatedJob = row((await client.query(`UPDATE kcml.generation_job SET lifecycle='IMPLEMENTING',current_phase=$2,active_phase_run_id=$3,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state_version=$4 RETURNING *`, [jobId, phase, phaseRun.id, job.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Generation job changed while starting phase');
  await recordAudit(client, context, 'GENERATION_PHASE_RUN', String(phaseRun.id), { phaseRunId: phaseRun.id, jobId, phase, attempt: attempt.toString() });
  return result(context, 'generation_phase_run', phaseRun, phaseRun.state_version, { jobStateVersion: updatedJob.state_version, attempt: attempt.toString() });
}

async function handleGenerationPlanCreate(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = randomUUID();
  const jobId = uuidArg(context, 'jobId', context.targetId ?? undefined);
  const dag = objectArg(context, 'canonicalDag');
  const plan = row((await client.query(`INSERT INTO kcml.generation_plan(id,job_id,authority_id,specification_id,schema_version,canonical_dag,plan_digest,validation_state,validation_report,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,'PENDING',$8,$9,$10,$11,$12,$13,$14) RETURNING *`, [
    id, jobId, uuidArg(context, 'authorityId'), uuidArg(context, 'specificationId'), textArg(context, 'schemaVersion', '1'), dag, digest(dag), objectArg(context, 'validationReport'), digest({ id, jobId, dag }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'GENERATION_PLAN_NOT_CREATED', 'Generation plan was not persisted');
  await recordAudit(client, context, 'GENERATION_PLAN', id, { planId: id, jobId });
  return result(context, 'generation_plan', plan, plan.state_version, { planId: id });
}

async function handleGenerationSourceAdd(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = randomUUID();
  const jobId = uuidArg(context, 'jobId', context.targetId ?? undefined);
  const content = context.arguments.content ?? context.arguments.contentReference ?? null;
  const source = row((await client.query(`INSERT INTO kcml.generation_source(id,job_id,source_kind,original_name,locator,mime_type,content_reference,storage_reference,content_digest,status,parser_version,normalized_text_reference,sensitivity,retention_policy,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'RECEIVED',$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`, [
    id, jobId, textArg(context, 'sourceKind', 'TEXT'), context.arguments.originalName ?? null, context.arguments.locator ?? null, context.arguments.mimeType ?? null, typeof content === 'string' ? content : null, context.arguments.storageReference ?? null, digestArgument(context, 'contentDigest', content), textArg(context, 'parserVersion', 'pending'), context.arguments.normalizedTextReference ?? null, textArg(context, 'sensitivity', 'OWNER_ONLY'), objectArg(context, 'retentionPolicy'), digest({ id, jobId, content }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'GENERATION_SOURCE_NOT_CREATED', 'Generation source was not persisted');
  await recordAudit(client, context, 'GENERATION_SOURCE', id, { sourceId: id, jobId, sourceKind: source.source_kind });
  return result(context, 'generation_source', source, source.state_version, { sourceId: id });
}

async function handleGenerationSpecPropose(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = randomUUID();
  const jobId = uuidArg(context, 'jobId', context.targetId ?? undefined);
  const canonical = objectArg(context, 'canonicalJson');
  const spec = row((await client.query(`INSERT INTO kcml.generation_spec_revision(id,job_id,revision_number,schema_version,canonical_json,rendered_markdown,spec_digest,conformance_precheck_state,conformance_report,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,'PENDING',$8,$9,$10,$11,$12,$13,$14) RETURNING *`, [
    id, jobId, numberArg(context, 'revisionNumber', 1), textArg(context, 'schemaVersion', '1'), canonical, textArg(context, 'renderedMarkdown', JSON.stringify(canonical)), digest(canonical), objectArg(context, 'conformanceReport'), digest({ id, jobId, canonical }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'GENERATION_SPEC_NOT_CREATED', 'Generation specification revision was not persisted');
  await recordAudit(client, context, 'GENERATION_SPEC_REVISION', id, { specificationId: id, jobId, state: 'PROPOSED' });
  return result(context, 'generation_spec_revision', spec, spec.state_version, { specificationId: id });
}

async function handleGenerationSpecPrecheck(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.generation_spec_revision WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'GENERATION_SPEC_NOT_FOUND', 'Generation specification revision does not exist');
  const report = objectArg(context, 'conformanceReport', { valid: true });
  const updated = row((await client.query(`UPDATE kcml.generation_spec_revision SET conformance_precheck_state=$2,conformance_report=$3,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state_version=$4 RETURNING *`, [id, textArg(context, 'precheckState', report.valid === true ? 'PASS' : 'FAIL'), report, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Specification revision changed while prechecking');
  await recordAudit(client, context, 'GENERATION_SPEC_REVISION', id, { specificationId: id, precheckState: updated.conformance_precheck_state });
  return result(context, 'generation_spec_revision', updated, updated.state_version, { precheck: true });
}

async function handleGenerationSpecApprove(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.generation_spec_revision WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'GENERATION_SPEC_NOT_FOUND', 'Generation specification revision does not exist');
  const updated = row((await client.query(`UPDATE kcml.generation_spec_revision SET conformance_precheck_state='APPROVED',conformance_report=$2,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND conformance_precheck_state IN ('PASS','VALIDATED') AND state_version=$3 RETURNING *`, [id, { approvedBy: 'KRMAR78', evidence: objectArg(context, 'evidence') }, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Specification revision is not eligible for approval');
  await recordAudit(client, context, 'GENERATION_SPEC_REVISION', id, { specificationId: id, state: 'APPROVED' });
  return result(context, 'generation_spec_revision', updated, updated.state_version, { approved: true });
}

async function handleGenerationTurnInterrupt(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.generation_turn WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'GENERATION_TURN_NOT_FOUND', 'Generation turn does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.generation_turn SET interruption_version=interruption_version+1,interruption_intent='REQUESTED',interruption_reason=$2,status='INTERRUPT_REQUESTED',state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND status NOT IN ('COMPLETED','FAILED','INTERRUPTED') AND state_version=$3 RETURNING *`, [id, context.arguments.reason ?? 'owner requested interrupt', current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Generation turn changed while requesting interrupt');
  await recordAudit(client, context, 'GENERATION_TURN', id, { turnId: id, status: 'INTERRUPT_REQUESTED' });
  return result(context, 'generation_turn', updated, updated.state_version, { interrupted: true });
}

async function handleGenerationValidationRun(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = randomUUID();
  const jobId = uuidArg(context, 'jobId', context.targetId ?? undefined);
  const validation = row((await client.query(`INSERT INTO kcml.generation_validation_run(id,job_id,phase_run_id,workspace_revision_id,candidate_id,activation_set_id,gate_catalog_version,state,started_at,blocking_summary,evidence_digest,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,'RUNNING',clock_timestamp(),$8,$9,$10,$11,$12,$13,$14) RETURNING *`, [
    id, jobId, context.arguments.phaseRunId ?? null, context.arguments.workspaceRevisionId ?? null, context.arguments.candidateId ?? null, context.arguments.activationSetId ?? null, textArg(context, 'gateCatalogVersion', 'td12'), objectArg(context, 'blockingSummary'), digest(objectArg(context, 'evidence')), digest({ id, jobId }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'GENERATION_VALIDATION_NOT_CREATED', 'Generation validation run was not persisted');
  await recordAudit(client, context, 'GENERATION_VALIDATION_RUN', id, { validationRunId: id, jobId, state: 'RUNNING' });
  return result(context, 'generation_validation_run', validation, validation.state_version, { validationRunId: id });
}

async function handleGenerationWorkspacePatch(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = randomUUID();
  const jobId = uuidArg(context, 'jobId', context.targetId ?? undefined);
  const patch = objectArg(context, 'patch');
  const revision = row((await client.query(`INSERT INTO kcml.generation_workspace_revision(id,job_id,revision_number,parent_revision_id,source_tree_digest,artifact_manifest_draft_digest,created_by_model_call_id,created_by_worker_id,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`, [
    id, jobId, numberArg(context, 'revisionNumber', 1), context.arguments.parentRevisionId ?? null, digestArgument(context, 'sourceTreeDigest', patch), digestArgument(context, 'artifactManifestDraftDigest', patch), context.arguments.createdByModelCallId ?? null, context.arguments.createdByWorkerId ?? null, digest({ id, jobId, patch }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'GENERATION_WORKSPACE_NOT_CREATED', 'Generation workspace revision was not persisted');
  await client.query(`UPDATE kcml.generation_job SET workspace_revision_id=$2,lifecycle='IMPLEMENTING',state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`, [jobId, revision.id]);
  await recordAudit(client, context, 'GENERATION_WORKSPACE_REVISION', id, { workspaceRevisionId: id, jobId });
  return result(context, 'generation_workspace_revision', revision, revision.state_version, { workspaceRevisionId: id });
}

// ---------------------------------------------------------------------------
// MCP operations. The MCP request/call/task tables are separate aggregates;
// request validation never mutates a discovery snapshot and tool execution
// always records a side-effect intent before an adapter can be dispatched.
// ---------------------------------------------------------------------------

async function mcpCall(client: DatabaseClient, context: CanonicalHandlerContext): Promise<Row> {
  return row((await client.query(`SELECT * FROM kcml.mcp_call_run WHERE id=$1 FOR UPDATE`, [target(context)])).rows as Row[], 'MCP_CALL_NOT_FOUND', 'MCP call run does not exist');
}

async function handleMcpCacheInvalidate(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const current = await mcpCall(client, context);
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.mcp_call_run SET reconciliation_outcome=$2,state='RECONCILING',state_version=state_version+1 WHERE id=$1 AND state NOT IN ('SUCCEEDED','FAILED','CANCELLED') AND state_version=$3 RETURNING *`, [current.id, { cacheInvalidated: true, reason: context.arguments.reason ?? null }, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'MCP call changed while invalidating cache');
  await recordAudit(client, context, 'MCP_CALL_RUN', String(current.id), { callRunId: current.id, cacheInvalidated: true });
  return result(context, 'mcp_call_run', updated, updated.state_version, { cacheInvalidated: true });
}

async function handleMcpContractCompatibility(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const current = await mcpCall(client, context);
  assertVersion(context, current);
  const decision = objectArg(context, 'compatibility');
  const updated = row((await client.query(`UPDATE kcml.mcp_call_run SET binding_decision=$2,reconciliation_outcome=$3,state_version=state_version+1 WHERE id=$1 AND state_version=$4 RETURNING *`, [current.id, decision, { checked: true, compatible: decision.compatible !== false }, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'MCP call changed while recording compatibility');
  await recordAudit(client, context, 'MCP_CALL_RUN', String(current.id), { callRunId: current.id, compatibility: decision });
  return result(context, 'mcp_call_run', updated, updated.state_version, { compatible: decision.compatible !== false });
}

async function handleMcpDiscoverySnapshot(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = randomUUID();
  const payload = objectArg(context, 'resultPayload');
  const snapshot = row((await client.query(`INSERT INTO kcml.mcp_discovery_snapshot(id,server_component_id,server_revision_id,server_release_id,endpoint,method,protocol_version,client_capability_digest,extension_digest,source_execution_context_id,access_channel,auth_binding_id,binding_revision,exposure_fingerprint,request_params,page_cursor,cache_key_digest,request_body_digest,request_header_digest,result_payload,result_digest,element_contract_digests,ttl_ms,cache_scope,received_at,expires_at,previous_page_snapshot_id,page_index,page_lineage_evidence,aggregate_traversal_digest,state,verification_state,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,clock_timestamp(),$25,$26,$27,$28,$29,'FRESH',$30,$31,$32,$33,$34,$35) RETURNING *`, [
    id, uuidArg(context, 'serverComponentId'), uuidArg(context, 'serverRevisionId'), context.arguments.serverReleaseId ?? null, textArg(context, 'endpoint'), textArg(context, 'method', 'initialize'), textArg(context, 'protocolVersion', '2025-11-25'), digestArgument(context, 'clientCapabilityDigest', {}), digestArgument(context, 'extensionDigest', {}), context.arguments.sourceExecutionContextId ?? null, textArg(context, 'accessChannel', 'OWNER'), context.arguments.authBindingId ?? null, context.arguments.bindingRevision ?? null, digestArgument(context, 'exposureFingerprint', {}), objectArg(context, 'requestParams'), context.arguments.pageCursor ?? null, digestArgument(context, 'cacheKeyDigest', payload), digestArgument(context, 'requestBodyDigest', payload), digestArgument(context, 'requestHeaderDigest', payload), payload, digest(payload), [], numberArg(context, 'ttlMs', 300000), textArg(context, 'cacheScope', 'OWNER'), futureArg(context, 'expiresAt', 300), context.arguments.previousPageSnapshotId ?? null, numberArg(context, 'pageIndex', 0), objectArg(context, 'pageLineageEvidence'), digestArgument(context, 'aggregateTraversalDigest', payload), textArg(context, 'verificationState', 'PENDING'), digest({ id, payload }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'MCP_DISCOVERY_SNAPSHOT_NOT_CREATED', 'MCP discovery snapshot was not persisted');
  await recordAudit(client, context, 'MCP_DISCOVERY_SNAPSHOT', id, { snapshotId: id, state: 'FRESH' });
  return result(context, 'mcp_discovery_snapshot', snapshot, snapshot.state_version, { snapshotId: id });
}

async function handleMcpDiscoveryInvalidate(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.mcp_discovery_snapshot WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'MCP_DISCOVERY_SNAPSHOT_NOT_FOUND', 'MCP discovery snapshot does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.mcp_discovery_snapshot SET state='INVALID',invalidation_reason=$2,invalidation_relation=$3,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state IN ('FRESH','STALE') AND state_version=$4 RETURNING *`, [id, textArg(context, 'reason', 'explicit invalidation'), objectArg(context, 'evidence'), current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'MCP discovery snapshot changed while invalidating');
  await recordAudit(client, context, 'MCP_DISCOVERY_SNAPSHOT', id, { snapshotId: id, state: 'INVALID' });
  return result(context, 'mcp_discovery_snapshot', updated, updated.state_version, { state: 'INVALID' });
}

async function handleMcpEraInvalidate(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const current = await mcpCall(client, context);
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.mcp_call_run SET state='RECONCILING',reconciliation_outcome=$2,state_version=state_version+1 WHERE id=$1 AND state NOT IN ('SUCCEEDED','FAILED','CANCELLED') AND state_version=$3 RETURNING *`, [current.id, { eraInvalidated: true, protocolEra: context.arguments.protocolEra ?? null }, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'MCP call changed while invalidating protocol era');
  await recordAudit(client, context, 'MCP_CALL_RUN', String(current.id), { callRunId: current.id, eraInvalidated: true });
  return result(context, 'mcp_call_run', updated, updated.state_version, { eraInvalidated: true });
}

async function handleMcpInputRequired(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const exchangeId = target(context);
  const exchange = row((await client.query(`SELECT * FROM kcml.mcp_input_exchange WHERE id=$1 FOR UPDATE`, [exchangeId])).rows as Row[], 'MCP_INPUT_EXCHANGE_NOT_FOUND', 'MCP input exchange does not exist');
  const request = objectArg(context, 'inputRequest');
  const id = randomUUID();
  const item = row((await client.query(`INSERT INTO kcml.mcp_input_request_item(id,input_exchange_id,request_key,request_method,params,params_digest,required_client_capability_digest,state,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,'OUTSTANDING',$8,$9,$10,$11,$12,$13) RETURNING *`, [id, exchangeId, textArg(context, 'requestKey', id), textArg(context, 'requestMethod', 'elicitation/create'), request, digest(request), digestArgument(context, 'requiredClientCapabilityDigest', {}), digest({ id, exchangeId, request }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()])).rows as Row[], 'MCP_INPUT_REQUEST_NOT_CREATED', 'MCP input request was not persisted');
  const updated = row((await client.query(`UPDATE kcml.mcp_input_exchange SET input_requests=$2,input_requests_digest=$3,status='PENDING',state_version=state_version+1 WHERE id=$1 AND state_version=$4 RETURNING *`, [exchangeId, { [String(item.request_key)]: request }, digest(request), exchange.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'MCP input exchange changed while requesting input');
  await recordAudit(client, context, 'MCP_INPUT_EXCHANGE', exchangeId, { inputExchangeId: exchangeId, inputRequestId: id, status: 'PENDING' });
  return result(context, 'mcp_input_exchange', updated, updated.state_version, { inputRequestId: id });
}

async function handleMcpInputRespond(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const exchangeId = target(context);
  const exchange = row((await client.query(`SELECT * FROM kcml.mcp_input_exchange WHERE id=$1 FOR UPDATE`, [exchangeId])).rows as Row[], 'MCP_INPUT_EXCHANGE_NOT_FOUND', 'MCP input exchange does not exist');
  const response = objectArg(context, 'response');
  const requestItemId = uuidArg(context, 'inputRequestItemId');
  const item = row((await client.query(`UPDATE kcml.mcp_input_request_item SET state='SATISFIED',satisfied_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND input_exchange_id=$2 AND state='OUTSTANDING' RETURNING *`, [requestItemId, exchangeId])).rows as Row[], 'MCP_INPUT_REQUEST_NOT_FOUND', 'MCP input request item is not outstanding');
  const responseItem = row((await client.query(`INSERT INTO kcml.mcp_input_response_item(input_exchange_id,retry_request_event_id,supplied_key,raw_response,normalized_response,response_digest,disposition,input_request_item_id,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,'ACCEPTED',$7,$8,$9,$10,$11,$12,$13) RETURNING *`, [exchangeId, uuidArg(context, 'retryRequestEventId'), textArg(context, 'suppliedKey', String(item.request_key)), response, objectArg(context, 'normalizedResponse', response), digest(response), requestItemId, digest({ exchangeId, response }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()])).rows as Row[], 'MCP_INPUT_RESPONSE_NOT_CREATED', 'MCP input response was not persisted');
  const updated = row((await client.query(`UPDATE kcml.mcp_input_exchange SET status='FULFILLED',current_outcome=$2,terminal_outcome=$3,fulfilled_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1 AND state_version=$4 RETURNING *`, [exchangeId, response, response, exchange.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'MCP input exchange changed while responding');
  await recordAudit(client, context, 'MCP_INPUT_EXCHANGE', exchangeId, { inputExchangeId: exchangeId, responseId: responseItem.id, status: 'FULFILLED' });
  return result(context, 'mcp_input_exchange', updated, updated.state_version, { responseId: responseItem.id });
}

async function handleMcpLegacyAdapt(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const current = await mcpCall(client, context);
  const adapted = { legacy: true, adapterVersion: textArg(context, 'adapterVersion', 'td12'), input: objectArg(context, 'input') };
  const updated = row((await client.query(`UPDATE kcml.mcp_call_run SET binding_decision=$2,canonical_arguments=$3,arguments_digest=$4,state_version=state_version+1 WHERE id=$1 AND state_version=$5 RETURNING *`, [current.id, adapted, adapted.input, digest(adapted.input), current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'MCP call changed while adapting legacy request');
  await recordAudit(client, context, 'MCP_CALL_RUN', String(current.id), { callRunId: current.id, legacyAdapted: true });
  return result(context, 'mcp_call_run', updated, updated.state_version, { legacyAdapted: true });
}

async function handleMcpRequestValidateTransport(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const current = await mcpCall(client, context);
  assertVersion(context, current);
  const decision = { valid: context.arguments.valid !== false, transport: context.arguments.transport ?? 'HTTP' };
  const updated = row((await client.query(`UPDATE kcml.mcp_call_run SET binding_decision=jsonb_set(coalesce(binding_decision,'{}'::jsonb),'{transport}', $2::jsonb),state='CLAIMED',state_version=state_version+1 WHERE id=$1 AND state='RECEIVED' AND state_version=$3 RETURNING *`, [current.id, JSON.stringify(decision), current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'MCP call changed while validating transport');
  await recordAudit(client, context, 'MCP_CALL_RUN', String(current.id), { callRunId: current.id, transportValidation: decision });
  return result(context, 'mcp_call_run', updated, updated.state_version, { transportValidation: decision });
}

async function handleMcpRequestValidateJsonRpc(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const current = await mcpCall(client, context);
  assertVersion(context, current);
  const decision = { valid: context.arguments.valid !== false, jsonrpc: context.arguments.jsonrpc ?? '2.0' };
  const updated = row((await client.query(`UPDATE kcml.mcp_call_run SET binding_decision=jsonb_set(coalesce(binding_decision,'{}'::jsonb),'{jsonrpc}', $2::jsonb),state='CLAIMED',state_version=state_version+1 WHERE id=$1 AND state IN ('RECEIVED','CLAIMED') AND state_version=$3 RETURNING *`, [current.id, JSON.stringify(decision), current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'MCP call changed while validating JSON-RPC');
  await recordAudit(client, context, 'MCP_CALL_RUN', String(current.id), { callRunId: current.id, jsonRpcValidation: decision });
  return result(context, 'mcp_call_run', updated, updated.state_version, { jsonRpcValidation: decision });
}

async function handleMcpRequestReserveId(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const current = await mcpCall(client, context);
  assertVersion(context, current);
  const requestId = context.arguments.requestId === undefined ? String(current.request_event_id) : String(context.arguments.requestId);
  if (requestId.length === 0) throw new DomainError('MCP_INVALID_REQUEST', 'MCP request id must not be empty', 422, 'DO_NOT_RETRY');
  const updated = row((await client.query(`UPDATE kcml.mcp_call_run SET binding_decision=jsonb_set(coalesce(binding_decision,'{}'::jsonb),'{reservedRequestId}',to_jsonb($2::text),true),state='CLAIMED',state_version=state_version+1 WHERE id=$1 AND state IN ('RECEIVED','CLAIMED') AND state_version=$3 RETURNING *`, [current.id, requestId, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'MCP call changed while reserving request id');
  await recordAudit(client, context, 'MCP_CALL_RUN', String(current.id), { callRunId: current.id, requestId });
  return result(context, 'mcp_call_run', updated, updated.state_version, { requestId });
}

async function handleMcpRequestFinalize(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const current = await mcpCall(client, context);
  assertVersion(context, current);
  const state = textArg(context, 'state', context.arguments.error ? 'FAILED' : 'SUCCEEDED');
  if (!['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(state)) throw new DomainError('MCP_REQUEST_STATE_INVALID', 'MCP request final state is invalid', 422, 'DO_NOT_RETRY');
  const response = context.arguments.response ?? null;
  const updated = row((await client.query(`UPDATE kcml.mcp_call_run SET state=$2,structured_result=$3,result_digest=$4,jsonrpc_error=$5,completed_at=clock_timestamp(),response_delivery_state='DELIVERED',state_version=state_version+1 WHERE id=$1 AND state NOT IN ('SUCCEEDED','FAILED','CANCELLED') AND state_version=$6 RETURNING *`, [current.id, state, response, digest(response), context.arguments.error ?? null, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'MCP call changed while finalizing');
  await recordAudit(client, context, 'MCP_CALL_RUN', String(current.id), { callRunId: current.id, state });
  return result(context, 'mcp_call_run', updated, updated.state_version, { state });
}

async function handleMcpStateHandleCreate(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = randomUUID();
  const expiresAt = futureArg(context, 'expiresAt', 900);
  const handle = row((await client.query(`INSERT INTO kcml.mcp_state_handle(id,owner_component_id,owner_tool_key,owner_revision_id,contract_digest,public_opaque_id,lookup_digest,generation_nonce,source_execution_context_id,access_context,binding_revision,state_namespace,state_reference,status,expires_at,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'OPEN',$13,$14,$15,$16,$17,$18,$19) RETURNING *`, [
    id, uuidArg(context, 'ownerComponentId'), textArg(context, 'ownerToolKey'), uuidArg(context, 'ownerRevisionId'), digestArgument(context, 'contractDigest', {}), textArg(context, 'publicOpaqueId'), digestArgument(context, 'lookupDigest', id), context.arguments.generationNonce ?? id, context.arguments.sourceExecutionContextId ?? null, objectArg(context, 'accessContext'), numberArg(context, 'bindingRevision', 1), textArg(context, 'stateNamespace'), textArg(context, 'stateReference'), expiresAt, digest({ id, opaqueId: context.arguments.publicOpaqueId }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'MCP_STATE_HANDLE_NOT_CREATED', 'MCP state handle was not persisted');
  await recordAudit(client, context, 'MCP_STATE_HANDLE', id, { stateHandleId: id, status: 'OPEN' });
  return result(context, 'mcp_state_handle', handle, handle.state_version, { stateHandleId: id });
}

async function handleMcpStateHandleResolve(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.mcp_state_handle WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'MCP_STATE_HANDLE_NOT_FOUND', 'MCP state handle does not exist');
  assertVersion(context, current);
  if (current.status !== 'OPEN' || (current.expires_at && new Date(String(current.expires_at)).getTime() <= Date.now())) throw new DomainError('MCP_STATE_HANDLE_EXPIRED', 'MCP state handle is not open', 409, 'DO_NOT_RETRY');
  const updated = row((await client.query(`UPDATE kcml.mcp_state_handle SET last_used_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp(),correlation_id=$2 WHERE id=$1 AND status='OPEN' AND state_version=$3 RETURNING *`, [id, context.correlationId, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'MCP state handle changed while resolving');
  await recordAudit(client, context, 'MCP_STATE_HANDLE', id, { stateHandleId: id, status: 'OPEN', resolved: true });
  return result(context, 'mcp_state_handle', updated, updated.state_version, { stateReference: updated.state_reference });
}

async function handleMcpStateHandleClose(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.mcp_state_handle WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'MCP_STATE_HANDLE_NOT_FOUND', 'MCP state handle does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.mcp_state_handle SET status='CLOSED',closed_at=clock_timestamp(),close_logical_operation_id=$2,audit_event_id=NULL,state_version=state_version+1,updated_at=clock_timestamp(),correlation_id=$3 WHERE id=$1 AND status='OPEN' AND state_version=$4 RETURNING *`, [id, context.logicalOperationId, context.correlationId, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'MCP state handle changed while closing');
  await recordAudit(client, context, 'MCP_STATE_HANDLE', id, { stateHandleId: id, status: 'CLOSED' });
  return result(context, 'mcp_state_handle', updated, updated.state_version, { status: 'CLOSED' });
}

async function handleMcpSubscriptionListen(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = randomUUID();
  const subscription = row((await client.query(`INSERT INTO kcml.mcp_subscription(id,server_component_id,server_revision_id,server_release_id,request_id_type,request_id_value,source_execution_context_id,access_context,binding_revision,protocol_version,capability_digest,extension_digest,requested_filter,state,stream_opened_at,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'OPENING',clock_timestamp(),$14,$15,$16,$17,$18,$19) RETURNING *`, [
    id, uuidArg(context, 'serverComponentId'), uuidArg(context, 'serverRevisionId'), context.arguments.serverReleaseId ?? null, textArg(context, 'requestIdType', 'STRING'), textArg(context, 'requestIdValue', id), context.arguments.sourceExecutionContextId ?? null, objectArg(context, 'accessContext'), numberArg(context, 'bindingRevision', 1), textArg(context, 'protocolVersion', '2025-11-25'), digestArgument(context, 'capabilityDigest', {}), digestArgument(context, 'extensionDigest', {}), objectArg(context, 'requestedFilter'), digest({ id, filter: context.arguments.requestedFilter ?? {} }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'MCP_SUBSCRIPTION_NOT_CREATED', 'MCP subscription was not persisted');
  await recordAudit(client, context, 'MCP_SUBSCRIPTION', id, { subscriptionId: id, state: 'OPENING' });
  return result(context, 'mcp_subscription', subscription, subscription.state_version, { subscriptionId: id });
}

async function handleMcpSubscriptionAcknowledge(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.mcp_subscription WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'MCP_SUBSCRIPTION_NOT_FOUND', 'MCP subscription does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.mcp_subscription SET state='ACTIVE',ack_persisted_sequence=$2,acknowledged_filter=$3,stream_opened_at=coalesce(stream_opened_at,clock_timestamp()),state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state IN ('OPENING','ACTIVE') AND state_version=$4 RETURNING *`, [id, numberArg(context, 'sequence'), objectArg(context, 'filter'), current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'MCP subscription changed while acknowledging');
  await recordAudit(client, context, 'MCP_SUBSCRIPTION', id, { subscriptionId: id, state: 'ACTIVE', sequence: updated.ack_persisted_sequence });
  return result(context, 'mcp_subscription', updated, updated.state_version, { state: 'ACTIVE' });
}

async function handleMcpSubscriptionCancel(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.mcp_subscription WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'MCP_SUBSCRIPTION_NOT_FOUND', 'MCP subscription does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.mcp_subscription SET state='CANCEL_REQUESTED',close_reason=$2,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state IN ('OPENING','ACTIVE') AND state_version=$3 RETURNING *`, [id, context.arguments.reason ?? 'owner requested cancel', current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'MCP subscription changed while cancelling');
  await recordAudit(client, context, 'MCP_SUBSCRIPTION', id, { subscriptionId: id, state: 'CANCEL_REQUESTED' });
  return result(context, 'mcp_subscription', updated, updated.state_version, { state: 'CANCEL_REQUESTED' });
}

async function handleMcpSubscriptionComplete(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.mcp_subscription WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'MCP_SUBSCRIPTION_NOT_FOUND', 'MCP subscription does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.mcp_subscription SET state='CLOSED',closed_at=clock_timestamp(),final_response_state=$2,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state IN ('ACTIVE','CANCEL_REQUESTED','GRACEFUL_CLOSING') AND state_version=$3 RETURNING *`, [id, textArg(context, 'finalResponseState', 'COMPLETED'), current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'MCP subscription changed while completing');
  await recordAudit(client, context, 'MCP_SUBSCRIPTION', id, { subscriptionId: id, state: 'CLOSED' });
  return result(context, 'mcp_subscription', updated, updated.state_version, { state: 'CLOSED' });
}

async function handleMcpSubscriptionNotify(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const subscriptionId = target(context);
  const subscription = row((await client.query(`SELECT * FROM kcml.mcp_subscription WHERE id=$1 FOR UPDATE`, [subscriptionId])).rows as Row[], 'MCP_SUBSCRIPTION_NOT_FOUND', 'MCP subscription does not exist');
  const sequence = await nextSequence(client, 'MCP_SUBSCRIPTION_NOTIFICATION', subscriptionId, 'SEQUENCE');
  const payload = objectArg(context, 'payload');
  const notification = row((await client.query(`INSERT INTO kcml.mcp_subscription_notification(subscription_id,sequence,method,source_object_id,source_uri,source_task_id,payload,payload_digest,meta_subscription_id,emitted_at,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp(),$10,$11,$12,$13,$14,$15) RETURNING *`, [
    subscriptionId, sequence.toString(), textArg(context, 'method'), context.arguments.sourceObjectId ?? null, context.arguments.sourceUri ?? null, context.arguments.sourceTaskId ?? null, payload, digest(payload), textArg(context, 'metaSubscriptionId', String(subscriptionId)), digest({ subscriptionId, sequence: sequence.toString(), payload }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'MCP_NOTIFICATION_NOT_CREATED', 'MCP subscription notification was not persisted');
  await client.query(`UPDATE kcml.mcp_subscription SET notification_count=notification_count+1,last_keepalive_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='ACTIVE'`, [subscriptionId]);
  await recordAudit(client, context, 'MCP_SUBSCRIPTION', subscriptionId, { subscriptionId, notificationId: notification.id, sequence: sequence.toString() });
  return result(context, 'mcp_subscription_notification', notification, notification.state_version, { sequence: sequence.toString(), subscriptionStateVersion: BigInt(String(subscription.state_version ?? 0)) + 1n });
}

async function handleMcpTaskCreate(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = randomUUID();
  const task = row((await client.query(`INSERT INTO kcml.mcp_task(id,server_component_id,tool_key,server_revision_id,original_call_run_id,public_task_id,lookup_digest,logical_operation_id,source_execution_context_id,access_context,binding_revision,activation_epoch,original_request_digest,idempotency_key,wire_status,state,platform_incarnation_id,application_deployment_epoch,ttl_ms,created_at,expires_at,poll_interval_ms,canonical_digest)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'working','WORKING',$15,$16,$17,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP+($17 * interval '1 millisecond'),$18,$19) RETURNING *`, [
    id, uuidArg(context, 'serverComponentId'), textArg(context, 'toolKey'), uuidArg(context, 'serverRevisionId'), uuidArg(context, 'originalCallRunId'), textArg(context, 'publicTaskId', id), digestArgument(context, 'lookupDigest', id), context.logicalOperationId, context.arguments.sourceExecutionContextId ?? null, objectArg(context, 'accessContext'), numberArg(context, 'bindingRevision', 1), context.activationEpoch.toString(), digestArgument(context, 'originalRequestDigest', objectArg(context, 'request')), context.arguments.idempotencyKey ?? null, context.platformIncarnationId, context.applicationDeploymentEpoch.toString(), numberArg(context, 'ttlMs', 300000), numberArg(context, 'pollIntervalMs', 1000), digest({ id, taskKey: context.arguments.toolKey })
  ])).rows as Row[], 'MCP_TASK_NOT_CREATED', 'MCP task was not persisted');
  await recordAudit(client, context, 'MCP_TASK', id, { taskId: id, state: 'WORKING' });
  return result(context, 'mcp_task', task, task.state_version, { taskId: id });
}

async function handleMcpTaskCancel(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.mcp_task WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'MCP_TASK_NOT_FOUND', 'MCP task does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.mcp_task SET wire_status='cancelled',state='CANCELLED',cancellation_intent=$2,cancellation_version=cancellation_version+1,final_digest=$3,updated_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1 AND state IN ('WORKING','INPUT_REQUIRED') AND state_version=$4 RETURNING *`, [id, objectArg(context, 'cancellationIntent', { reason: context.arguments.reason ?? 'owner requested cancel' }), digest({ id, cancelled: true }), current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'MCP task changed while cancelling');
  await recordAudit(client, context, 'MCP_TASK', id, { taskId: id, state: 'CANCELLED' });
  return result(context, 'mcp_task', updated, updated.state_version, { state: 'CANCELLED' });
}

async function handleMcpTaskExpire(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.mcp_task WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'MCP_TASK_NOT_FOUND', 'MCP task does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.mcp_task SET wire_status='failed',state='FAILED',expiry_intent=$2,final_jsonrpc_error=$3,final_digest=$4,updated_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1 AND state IN ('WORKING','INPUT_REQUIRED') AND expires_at<=clock_timestamp() AND state_version=$5 RETURNING *`, [id, { expiredAt: new Date().toISOString() }, { code: 'MCP_TASK_EXPIRED' }, digest({ id, expired: true }), current.state_version])).rows as Row[], 'MCP_TASK_NOT_EXPIRED', 'MCP task is not eligible for expiry');
  await recordAudit(client, context, 'MCP_TASK', id, { taskId: id, state: 'FAILED', expired: true });
  return result(context, 'mcp_task', updated, updated.state_version, { state: 'FAILED' });
}

async function handleMcpTaskUpdate(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.mcp_task WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'MCP_TASK_NOT_FOUND', 'MCP task does not exist');
  assertVersion(context, current);
  const state = textArg(context, 'state', String(current.state));
  const wireStatus = textArg(context, 'wireStatus', state === 'COMPLETED' ? 'completed' : state === 'FAILED' ? 'failed' : state === 'CANCELLED' ? 'cancelled' : 'working');
  const terminal = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(state);
  const updated = row((await client.query(`UPDATE kcml.mcp_task SET wire_status=$2,state=$3,final_method_result=$4,final_jsonrpc_error=$5,final_digest=$6,updated_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1 AND state NOT IN ('COMPLETED','FAILED','CANCELLED') AND state_version=$7 RETURNING *`, [id, wireStatus, state, context.arguments.result ?? null, context.arguments.error ?? null, terminal ? digest({ id, state, result: context.arguments.result ?? null }) : null, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'MCP task changed while updating');
  await recordAudit(client, context, 'MCP_TASK', id, { taskId: id, state });
  return result(context, 'mcp_task', updated, updated.state_version, { state });
}

async function handleMcpTaskNotify(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const taskId = target(context);
  const task = row((await client.query(`SELECT * FROM kcml.mcp_task WHERE id=$1 FOR UPDATE`, [taskId])).rows as Row[], 'MCP_TASK_NOT_FOUND', 'MCP task does not exist');
  const sequence = await nextSequence(client, 'MCP_TASK_EVENT', taskId, 'SEQUENCE');
  const event = row((await client.query(`INSERT INTO kcml.mcp_task_event(task_id,sequence,status_projection,status_message,input_request_id,final_result_reference,error_reference,payload_digest,occurred_at,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp(),$9,$10,$11,$12,$13,$14) RETURNING *`, [
    taskId, sequence.toString(), objectArg(context, 'statusProjection', { state: task.state }), context.arguments.statusMessage ?? null, context.arguments.inputRequestId ?? null, objectArg(context, 'finalResultReference'), objectArg(context, 'errorReference'), digest(objectArg(context, 'statusProjection')), digest({ taskId, sequence: sequence.toString() }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'MCP_TASK_EVENT_NOT_CREATED', 'MCP task event was not persisted');
  await recordAudit(client, context, 'MCP_TASK', taskId, { taskId, taskEventId: event.id, sequence: sequence.toString() });
  return result(context, 'mcp_task_event', event, event.state_version, { sequence: sequence.toString() });
}

async function handleMcpToolsCall(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = randomUUID();
  const request = objectArg(context, 'request', { tool: context.arguments.toolName ?? null, arguments: context.arguments.arguments ?? {} });
  const sideEffect = await sideEffectIntent(client, context, `mcp-tool:${textArg(context, 'toolName')}`, request);
  const call = row((await client.query(`INSERT INTO kcml.mcp_call_run(id,request_event_id,logical_operation_id,idempotency_record_id,server_component_id,tool_key,server_revision_id,server_contract_digest,binding_decision,canonical_arguments,arguments_digest,side_effect_classification,retry_classification,idempotency_classification,concurrency_classification,ordering_classification,idempotency_key,state,platform_incarnation_id,application_deployment_epoch,activation_epoch,effective_deadline_at,idle_timeout_ms,side_effect_operation_ids,correlation_id,canonical_digest)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'EXECUTING',$18,$19,$20,$21,$22,ARRAY[$23]::uuid[],$24,$25) RETURNING *`, [
    id, uuidArg(context, 'requestEventId'), context.logicalOperationId, context.arguments.idempotencyRecordId ?? null, uuidArg(context, 'serverComponentId'), textArg(context, 'toolName'), uuidArg(context, 'serverRevisionId'), digestArgument(context, 'serverContractDigest', request), objectArg(context, 'bindingDecision'), request, digest(request), textArg(context, 'sideEffectClassification', 'LOCAL_STATE'), textArg(context, 'retryClassification', 'SAFE'), textArg(context, 'idempotencyClassification', 'KEYED'), textArg(context, 'concurrencyClassification', 'SERIALIZED'), textArg(context, 'orderingClassification', 'PER_TARGET'), context.arguments.idempotencyKey ?? context.logicalOperationId, context.platformIncarnationId, context.applicationDeploymentEpoch.toString(), context.activationEpoch.toString(), futureArg(context, 'deadlineAt', 300), numberArg(context, 'idleTimeoutMs', 30000), sideEffect.id, context.correlationId, digest({ id, request })
  ])).rows as Row[], 'MCP_CALL_NOT_CREATED', 'MCP tool call was not persisted');
  await recordAudit(client, context, 'MCP_CALL_RUN', id, { callRunId: id, sideEffectOperationId: sideEffect.id, state: 'EXECUTING' });
  return result(context, 'mcp_call_run', call, call.state_version, { sideEffectOperationId: sideEffect.id });
}

async function handleMcpToolsProgress(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const callId = target(context);
  const call = row((await client.query(`SELECT * FROM kcml.mcp_call_run WHERE id=$1 FOR UPDATE`, [callId])).rows as Row[], 'MCP_CALL_NOT_FOUND', 'MCP call run does not exist');
  const sequence = await nextSequence(client, 'MCP_CALL_PROGRESS', callId, 'SEQUENCE');
  const progress = row((await client.query(`INSERT INTO kcml.mcp_call_progress(call_run_id,sequence,progress_token,completed_units,total_units,message,emitted_at,payload_digest,response_stream_id,delivery_state,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,clock_timestamp(),$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`, [
    callId, sequence.toString(), textArg(context, 'progressToken'), context.arguments.completedUnits ?? null, context.arguments.totalUnits ?? null, context.arguments.message ?? null, digest(objectArg(context, 'payload')), textArg(context, 'responseStreamId', String(callId)), textArg(context, 'deliveryState', 'PENDING'), digest({ callId, sequence: sequence.toString() }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'MCP_PROGRESS_NOT_CREATED', 'MCP progress record was not persisted');
  await recordAudit(client, context, 'MCP_CALL_RUN', callId, { callRunId: callId, progressId: progress.id, sequence: sequence.toString() });
  return result(context, 'mcp_call_progress', progress, progress.state_version, { sequence: sequence.toString(), callStateVersion: call.state_version });
}

async function handleMcpToolsCancel(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const current = await mcpCall(client, context);
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.mcp_call_run SET state='CANCELLED',cancellation_version=cancellation_version+1,completed_at=clock_timestamp(),jsonrpc_error=$2,result_digest=$3,state_version=state_version+1 WHERE id=$1 AND state NOT IN ('SUCCEEDED','FAILED','CANCELLED') AND state_version=$4 RETURNING *`, [current.id, { code: 'MCP_CANCELLED' }, digest({ id: current.id, cancelled: true }), current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'MCP call changed while cancelling');
  await recordAudit(client, context, 'MCP_CALL_RUN', String(current.id), { callRunId: current.id, state: 'CANCELLED' });
  return result(context, 'mcp_call_run', updated, updated.state_version, { state: 'CANCELLED' });
}

async function handleMcpToolsReconcile(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const current = await mcpCall(client, context);
  assertVersion(context, current);
  const outcome = textArg(context, 'outcome');
  if (!['CONFIRMED_APPLIED', 'CONFIRMED_NOT_APPLIED', 'UNKNOWN'].includes(outcome)) throw new DomainError('MCP_OUTCOME_UNKNOWN', 'MCP reconciliation outcome is invalid', 422, 'DO_NOT_RETRY');
  const updated = row((await client.query(`UPDATE kcml.mcp_call_run SET reconciliation_outcome=$2,state=CASE WHEN $3='CONFIRMED_APPLIED' THEN 'SUCCEEDED' WHEN $3='CONFIRMED_NOT_APPLIED' THEN 'FAILED' ELSE 'MANUAL_REVIEW' END,completed_at=CASE WHEN $3='UNKNOWN' THEN NULL ELSE clock_timestamp() END,result_digest=$4,state_version=state_version+1 WHERE id=$1 AND state IN ('RECONCILING','EXECUTING','WAITING_FOR_TASK') AND state_version=$5 RETURNING *`, [current.id, { outcome, readBack: objectArg(context, 'readBack') }, outcome, digest({ id: current.id, outcome }), current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'MCP call changed while reconciling');
  await recordAudit(client, context, 'MCP_CALL_RUN', String(current.id), { callRunId: current.id, outcome });
  return result(context, 'mcp_call_run', updated, updated.state_version, { outcome });
}

// ---------------------------------------------------------------------------
// Monitoring, owner credential, provenance, runtime and secret operations.
// ---------------------------------------------------------------------------

async function handleMonitorProbeRequest(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = randomUUID();
  const probe = row((await client.query(`INSERT INTO kcml.monitoring_probe(id,profile_id,status,evidence,correlation_id) VALUES($1,$2,'UNKNOWN',$3,$4) RETURNING *`, [id, uuidArg(context, 'profileId'), objectArg(context, 'probe'), context.correlationId])).rows as Row[], 'MONITOR_PROBE_NOT_CREATED', 'Monitoring probe was not persisted');
  await recordAudit(client, context, 'MONITORING_PROBE', id, { probeId: id, status: 'UNKNOWN' });
  return result(context, 'monitoring_probe', probe, undefined, { probeId: id });
}

async function handleMonitorProbeResult(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const profileId = uuidArg(context, 'profileId');
  const probe = row((await client.query(`INSERT INTO kcml.monitoring_probe(profile_id,status,latency_ms,evidence,correlation_id) VALUES($1,$2,$3,$4,$5) RETURNING *`, [profileId, textArg(context, 'status', 'UNKNOWN'), context.arguments.latencyMs ?? null, objectArg(context, 'evidence'), context.correlationId])).rows as Row[], 'MONITOR_PROBE_NOT_RECORDED', 'Monitoring probe result was not persisted');
  await recordAudit(client, context, 'MONITORING_PROBE', String(probe.id), { probeId: probe.id, status: probe.status });
  return result(context, 'monitoring_probe', probe, undefined, { status: probe.status });
}

async function handleMonitorRepairEnqueue(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  if (!context.commandId || !UUID.test(context.commandId)) throw new DomainError('TOOL_ARGUMENT_SCHEMA_INVALID', 'Monitor repair enqueue must execute in a command transaction', 409, 'RETRY_SAME_OPERATION');
  const queue = row((await client.query(`INSERT INTO kcml.queue_item(queue_name,partition_key,command_id,payload,platform_incarnation_id,application_deployment_epoch,recovery_epoch) VALUES('kcml-monitor',$1,$2,$3,$4,$5,$6) RETURNING *`, [
    textArg(context, 'partitionKey', context.targetId ?? 'monitor'), context.commandId, { repair: context.operation.operationName, targetId: context.targetId, request: objectArg(context, 'repair') }, context.platformIncarnationId, context.applicationDeploymentEpoch.toString(), context.recoveryEpoch.toString()
  ])).rows as Row[], 'MONITOR_REPAIR_NOT_ENQUEUED', 'Monitor repair was not enqueued');
  await recordAudit(client, context, 'QUEUE_ITEM', String(queue.id), { queueItemId: queue.id, queue: 'kcml-monitor' });
  return result(context, 'queue_item', queue, queue.state_version, { queueName: 'kcml-monitor' });
}

async function handleMonitorStateTransition(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const component = row((await client.query(`SELECT * FROM kcml.component WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'COMPONENT_NOT_FOUND', 'Component does not exist');
  const history = row((await client.query(`INSERT INTO kcml.component_state_history(component_id,lifecycle_state,operational_state,recertification_state,reason,recorded_at,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,clock_timestamp(),$6,$7,$8,$9,$10,$11) RETURNING *`, [
    id, textArg(context, 'lifecycleState', String(component.activation_state ?? 'UNKNOWN')), textArg(context, 'operationalState', String(component.operational_state ?? 'UNKNOWN')), textArg(context, 'recertificationState', String(component.recertification_state ?? 'UNKNOWN')), textArg(context, 'reason', 'monitor state transition'), digest({ id, operation: context.operation.operationName }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'MONITOR_STATE_HISTORY_NOT_CREATED', 'Monitor state transition evidence was not persisted');
  await recordAudit(client, context, 'COMPONENT', id, { componentId: id, historyId: history.id });
  return result(context, 'component_state_history', history, history.state_version, { componentStateVersion: component.state_version });
}

async function handleOwnerApiKeyReveal(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const credential = row((await client.query(`SELECT * FROM kcml.owner_api_credential WHERE singleton_key=1 FOR UPDATE`)).rows as Row[], 'OWNER_API_CREDENTIAL_NOT_INITIALIZED', 'The singleton owner API credential is not initialized');
  const evidence = { fingerprint: credential.fingerprint, credentialVersion: credential.credential_version, revealedTo: 'KRMAR78', revealedAt: new Date().toISOString() };
  await client.query(`UPDATE kcml.owner_api_credential SET last_used_at=clock_timestamp(),last_usage_metadata=$1,audit_correlation_id=$2,state_version=state_version+1,updated_at=clock_timestamp() WHERE singleton_key=1`, [evidence, context.correlationId]);
  await recordAudit(client, context, 'OWNER_API_CREDENTIAL', String(credential.id), { ...evidence, secretMaterial: 'NEVER_PERSISTED_OR_RETURNED' });
  return result(context, 'owner_api_credential', { id: credential.id, fingerprint: credential.fingerprint, credentialVersion: credential.credential_version }, credential.state_version, { revealed: true, secretMaterial: null });
}

async function handleOwnerApiKeyRotate(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const credential = row((await client.query(`SELECT * FROM kcml.owner_api_credential WHERE singleton_key=1 FOR UPDATE`)).rows as Row[], 'OWNER_API_CREDENTIAL_NOT_INITIALIZED', 'The singleton owner API credential is not initialized');
  const version = BigInt(String(credential.credential_version ?? 0)) + 1n;
  const outcome = { rotated: true, version: version.toString(), evidence: objectArg(context, 'evidence') };
  const updated = row((await client.query(`UPDATE kcml.owner_api_credential SET credential_version=$1,credential_activation_epoch=$2,last_rotate_logical_operation=$3,last_rotate_outcome_digest=$4,rotated_at=clock_timestamp(),updated_at=clock_timestamp(),state_version=state_version+1,audit_correlation_id=$5 WHERE singleton_key=1 AND state_version=$6 RETURNING *`, [version.toString(), context.activationEpoch.toString(), context.logicalOperationId, digest(outcome), context.correlationId, credential.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Owner API credential changed while rotating');
  await recordAudit(client, context, 'OWNER_API_CREDENTIAL', String(updated.id), { credentialId: updated.id, credentialVersion: version.toString(), rotated: true });
  return result(context, 'owner_api_credential', updated, updated.state_version, outcome);
}

async function handleOwnerApiKeySessionExchange(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const credential = row((await client.query(`SELECT * FROM kcml.owner_api_credential WHERE singleton_key=1 FOR UPDATE`)).rows as Row[], 'OWNER_API_CREDENTIAL_NOT_INITIALIZED', 'The singleton owner API credential is not initialized');
  const session = { exchangeId: randomUUID(), credentialId: credential.id, credentialVersion: credential.credential_version, clientFingerprint: textArg(context, 'clientFingerprint'), expiresAt: futureArg(context, 'expiresAt', 300) };
  await client.query(`UPDATE kcml.owner_api_credential SET last_used_at=clock_timestamp(),last_usage_metadata=$1,audit_correlation_id=$2,state_version=state_version+1 WHERE singleton_key=1`, [session, context.correlationId]);
  await recordAudit(client, context, 'OWNER_API_CREDENTIAL', String(credential.id), { sessionExchangeId: session.exchangeId, credentialVersion: session.credentialVersion });
  return result(context, 'owner_api_credential', { id: credential.id, credentialVersion: credential.credential_version }, credential.state_version, { sessionExchangeId: session.exchangeId, expiresAt: session.expiresAt });
}

async function handleProvenanceContentRegister(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = randomUUID();
  const raw = context.arguments.rawBytes;
  const provenance = row((await client.query(`INSERT INTO kcml.content_provenance(id,parent_content_id,source_kind,source_object_id,source_revision_id,source_locator,observed_at,raw_bytes,artifact_reference,raw_digest,content_digest,mime_type,schema_id,content_role,instruction_authority,taint_flags,provenance_flags,extraction_method,normalization_method,transform_chain,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,clock_timestamp(),$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING *`, [
    id, context.arguments.parentContentId ?? null, textArg(context, 'sourceKind'), context.arguments.sourceObjectId ?? null, context.arguments.sourceRevisionId ?? null, objectArg(context, 'sourceLocator'), Buffer.isBuffer(raw) ? raw : null, objectArg(context, 'artifactReference'), digestArgument(context, 'rawDigest', raw ?? {}), digestArgument(context, 'contentDigest', raw ?? {}), context.arguments.mimeType ?? null, context.arguments.schemaId ?? null, textArg(context, 'contentRole'), textArg(context, 'instructionAuthority', 'NONE'), listArg(context, 'taintFlags'), listArg(context, 'provenanceFlags'), textArg(context, 'extractionMethod'), textArg(context, 'normalizationMethod'), objectArg(context, 'transformChain'), digest({ id, rawDigest: context.arguments.rawDigest, contentDigest: context.arguments.contentDigest }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'PROVENANCE_CONTENT_NOT_CREATED', 'Content provenance was not persisted');
  await recordAudit(client, context, 'CONTENT_PROVENANCE', id, { contentProvenanceId: id, contentDigest: context.arguments.contentDigest ?? null });
  return result(context, 'content_provenance', provenance, provenance.state_version, { contentProvenanceId: id });
}

async function handleProvenanceSegmentCompile(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = randomUUID();
  const rendered = textArg(context, 'renderedText', textArg(context, 'content', ''));
  const segment = row((await client.query(`INSERT INTO kcml.instruction_segment(id,model_call_id,request_descriptor_id,segment_sequence,source_provenance_id,role,instruction_authority,destination,rendered_bytes,rendered_digest,compiler_version,segment_digest,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`, [
    id, context.arguments.modelCallId ?? null, uuidArg(context, 'requestDescriptorId'), numberArg(context, 'segmentSequence'), uuidArg(context, 'sourceProvenanceId'), textArg(context, 'role', 'user'), textArg(context, 'instructionAuthority', 'OWNER_DIRECT'), textArg(context, 'destination', 'INPUT'), Buffer.from(rendered, 'utf8'), digest(rendered), textArg(context, 'compilerVersion', 'td12'), digest({ id, rendered }), digest({ id, rendered }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'PROVENANCE_SEGMENT_NOT_CREATED', 'Instruction segment was not persisted');
  await recordAudit(client, context, 'INSTRUCTION_SEGMENT', id, { instructionSegmentId: id, segmentSequence: segment.segment_sequence });
  return result(context, 'instruction_segment', segment, segment.state_version, { instructionSegmentId: id });
}

async function handleProvenanceValueDerivationCreate(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = randomUUID();
  const value = context.arguments.canonicalValue ?? null;
  const derivation = row((await client.query(`INSERT INTO kcml.value_derivation(id,operation_context_id,semantic_action_plan_id,destination_path,source_content_provenance_id,source_locator,source_digest,transform,normalizer,value_schema,constraints,transform_version,canonical_value,value_digest,validation_evidence,requirement_id,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *`, [
    id, uuidArg(context, 'operationContextId'), context.arguments.semanticActionPlanId ?? null, textArg(context, 'destinationPath'), uuidArg(context, 'sourceContentProvenanceId'), objectArg(context, 'sourceLocator'), digestArgument(context, 'sourceDigest', {}), textArg(context, 'transform', 'IDENTITY'), textArg(context, 'normalizer', 'NONE'), objectArg(context, 'valueSchema'), objectArg(context, 'constraints'), textArg(context, 'transformVersion', '1'), value, digest(value), objectArg(context, 'validationEvidence', { valid: true }), textArg(context, 'requirementId'), digest({ id, value }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'PROVENANCE_DERIVATION_NOT_CREATED', 'Value derivation was not persisted');
  await recordAudit(client, context, 'VALUE_DERIVATION', id, { valueDerivationId: id, destinationPath: derivation.destination_path });
  return result(context, 'value_derivation', derivation, derivation.state_version, { valueDerivationId: id });
}

async function handleRuntimeCancel(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.runtime_instance WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'RUNTIME_INSTANCE_NOT_FOUND', 'Runtime instance does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.runtime_instance SET desired_state='STOPPED',effective_state='STOPPED',stop_logical_operation_id=$2,stopped_at=clock_timestamp(),state_version=state_version+1,correlation_id=$3 WHERE id=$1 AND effective_state NOT IN ('STOPPED','ABSENT') AND state_version=$4 RETURNING *`, [id, context.logicalOperationId, context.correlationId, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Runtime instance changed while cancelling');
  await recordAudit(client, context, 'RUNTIME_INSTANCE', id, { runtimeInstanceId: id, effectiveState: 'STOPPED', cancelled: true });
  return result(context, 'runtime_instance', updated, updated.state_version, { effectiveState: 'STOPPED' });
}

async function handleRuntimeCleanupResume(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const cleanup = row((await client.query(`SELECT * FROM kcml.runtime_cleanup_operation WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'RUNTIME_CLEANUP_NOT_FOUND', 'Runtime cleanup operation does not exist');
  assertVersion(context, cleanup);
  const updated = row((await client.query(`UPDATE kcml.runtime_cleanup_operation SET checkpoint=$2,outcomes=$3,evidence_digests=$4,completed_at=CASE WHEN $5 THEN clock_timestamp() ELSE completed_at END,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND completed_at IS NULL AND state_version=$6 RETURNING *`, [id, objectArg(context, 'checkpoint'), objectArg(context, 'outcomes'), objectArg(context, 'evidenceDigests'), context.arguments.complete === true, cleanup.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Runtime cleanup changed while resuming');
  await recordAudit(client, context, 'RUNTIME_CLEANUP_OPERATION', id, { cleanupOperationId: id, complete: updated.completed_at !== null });
  return result(context, 'runtime_cleanup_operation', updated, updated.state_version, { complete: updated.completed_at !== null });
}

async function handleRuntimeDrain(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.runtime_instance WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'RUNTIME_INSTANCE_NOT_FOUND', 'Runtime instance does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.runtime_instance SET desired_state='DRAINING',effective_state='DRAINING',drain_logical_operation_id=$2,state_version=state_version+1,correlation_id=$3 WHERE id=$1 AND effective_state IN ('READY','STARTING') AND state_version=$4 RETURNING *`, [id, context.logicalOperationId, context.correlationId, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Runtime instance changed while draining');
  await recordAudit(client, context, 'RUNTIME_INSTANCE', id, { runtimeInstanceId: id, effectiveState: 'DRAINING' });
  return result(context, 'runtime_instance', updated, updated.state_version, { effectiveState: 'DRAINING' });
}

async function handleRuntimeHeartbeat(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.runtime_instance WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'RUNTIME_INSTANCE_NOT_FOUND', 'Runtime instance does not exist');
  const sequence = numberArg(context, 'heartbeatSequence', Number(current.heartbeat_sequence ?? 0) + 1);
  if (sequence <= Number(current.heartbeat_sequence ?? 0)) throw new DomainError('RUNTIME_PROCESS_STALE', 'Runtime heartbeat sequence must increase', 409, 'DO_NOT_RETRY');
  const updated = row((await client.query(`UPDATE kcml.runtime_instance SET heartbeat_sequence=$2,heartbeat_at=clock_timestamp(),state_version=state_version+1,correlation_id=$3 WHERE id=$1 AND heartbeat_sequence<$2 RETURNING *`, [id, sequence, context.correlationId])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Runtime heartbeat was superseded');
  await recordAudit(client, context, 'RUNTIME_INSTANCE', id, { runtimeInstanceId: id, heartbeatSequence: sequence });
  return result(context, 'runtime_instance', updated, updated.state_version, { heartbeatSequence: sequence });
}

async function handleRuntimeInstanceReconcile(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.runtime_instance WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'RUNTIME_INSTANCE_NOT_FOUND', 'Runtime instance does not exist');
  assertVersion(context, current);
  const effectiveState = textArg(context, 'effectiveState', String(current.effective_state));
  const updated = row((await client.query(`UPDATE kcml.runtime_instance SET effective_state=$2,effective_at=clock_timestamp(),state_version=state_version+1,correlation_id=$3 WHERE id=$1 AND state_version=$4 RETURNING *`, [id, effectiveState, context.correlationId, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Runtime instance changed while reconciling');
  await recordAudit(client, context, 'RUNTIME_INSTANCE', id, { runtimeInstanceId: id, effectiveState, readBack: objectArg(context, 'readBack') });
  return result(context, 'runtime_instance', updated, updated.state_version, { effectiveState });
}

async function handleRuntimeInstanceRestart(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.runtime_instance WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'RUNTIME_INSTANCE_NOT_FOUND', 'Runtime instance does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.runtime_instance SET desired_state='RESTARTING',effective_state='STARTING',restart_logical_operation_id=$2,state_version=state_version+1,correlation_id=$3 WHERE id=$1 AND state_version=$4 RETURNING *`, [id, context.logicalOperationId, context.correlationId, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Runtime instance changed while restarting');
  await recordAudit(client, context, 'RUNTIME_INSTANCE', id, { runtimeInstanceId: id, desiredState: 'RESTARTING' });
  return result(context, 'runtime_instance', updated, updated.state_version, { desiredState: 'RESTARTING' });
}

async function handleRuntimeInstanceStart(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.runtime_instance WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'RUNTIME_INSTANCE_NOT_FOUND', 'Runtime instance does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.runtime_instance SET desired_state='STARTING',effective_state='STARTING',started_at=coalesce(started_at,clock_timestamp()),state_version=state_version+1,correlation_id=$2 WHERE id=$1 AND effective_state IN ('STOPPED','FAILED','UNKNOWN','ABSENT') AND state_version=$3 RETURNING *`, [id, context.correlationId, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Runtime instance changed while starting');
  await recordAudit(client, context, 'RUNTIME_INSTANCE', id, { runtimeInstanceId: id, effectiveState: 'STARTING' });
  return result(context, 'runtime_instance', updated, updated.state_version, { effectiveState: 'STARTING' });
}

async function handleRuntimeInvoke(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const runtimeId = target(context);
  const runtime = row((await client.query(`SELECT * FROM kcml.runtime_instance WHERE id=$1 FOR UPDATE`, [runtimeId])).rows as Row[], 'RUNTIME_INSTANCE_NOT_FOUND', 'Runtime instance does not exist');
  const operation = await sideEffectIntent(client, context, `runtime:${runtimeId}`, objectArg(context, 'request', { capabilityAlias: context.arguments.capabilityAlias ?? null, arguments: context.arguments.arguments ?? {} }));
  const call = row((await client.query(`INSERT INTO kcml.runtime_ipc_call(connection_id,parent_execution_context_id,request_id,sequence,operation,capability_alias,resolved_target,revision_id,release_id,runtime_generation,binding_revision,input_digest,input_bytes,deadline_at,state,cleanup_state,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'RECEIVED','PENDING',$15,$16,$17,$18,$19,$20) RETURNING *`, [
    uuidArg(context, 'connectionId'), uuidArg(context, 'executionContextId'), textArg(context, 'requestId', context.logicalOperationId), numberArg(context, 'sequence'), textArg(context, 'operation', context.operation.operationName), textArg(context, 'capabilityAlias'), objectArg(context, 'resolvedTarget', { runtimeInstanceId: runtimeId }), uuidArg(context, 'revisionId'), uuidArg(context, 'releaseId'), numberArg(context, 'runtimeGeneration', Number(runtime.runtime_generation ?? 1)), numberArg(context, 'bindingRevision', 1), digest(objectArg(context, 'arguments')), numberArg(context, 'inputBytes', 0), futureArg(context, 'deadlineAt', 300), digest({ runtimeId, operation: context.arguments.capabilityAlias }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'RUNTIME_IPC_CALL_NOT_CREATED', 'Runtime IPC call was not persisted');
  await client.query(`UPDATE kcml.runtime_instance SET state_version=state_version+1,correlation_id=$2 WHERE id=$1`, [runtimeId, context.correlationId]);
  await recordAudit(client, context, 'RUNTIME_IPC_CALL', String(call.id), { runtimeIpcCallId: call.id, sideEffectOperationId: operation.id });
  return result(context, 'runtime_ipc_call', call, call.state_version, { sideEffectOperationId: operation.id });
}

async function handleRuntimePrepare(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.runtime_instance WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'RUNTIME_INSTANCE_NOT_FOUND', 'Runtime instance does not exist');
  assertVersion(context, current);
  if (!['STOPPED', 'FAILED', 'UNKNOWN', 'ABSENT', 'STARTING'].includes(String(current.effective_state))) {
    throw new DomainError('RUNTIME_STATE_BOUNDARY_VIOLATION', `Cannot prepare runtime from ${String(current.effective_state)}`, 409, 'RECONCILE_THEN_RETRY');
  }
  const updated = row((await client.query(`UPDATE kcml.runtime_instance SET desired_state='STARTING',effective_state='STARTING',effective_at=NULL,state_version=state_version+1,correlation_id=$2 WHERE id=$1 AND effective_state IN ('STOPPED','FAILED','UNKNOWN','ABSENT') AND state_version=$3 RETURNING *`, [id, context.correlationId, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Runtime instance changed while preparing');
  await recordAudit(client, context, 'RUNTIME_INSTANCE', id, { runtimeInstanceId: id, effectiveState: 'STARTING' });
  return { ...result(context, 'runtime_instance', updated, updated.state_version, { effectiveState: 'STARTING' }), transition: { from: current.effective_state, to: 'STARTING' } };
}

async function handleRuntimeStop(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.runtime_instance WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'RUNTIME_INSTANCE_NOT_FOUND', 'Runtime instance does not exist');
  assertVersion(context, current);
  if (['STOPPED', 'ABSENT'].includes(String(current.effective_state))) {
    return { ...result(context, 'runtime_instance', current, current.state_version, { effectiveState: 'STOPPED', duplicate: true }), duplicate: true };
  }
  const updated = row((await client.query(`UPDATE kcml.runtime_instance SET desired_state='STOPPED',effective_state='STOPPED',stop_logical_operation_id=$2,stopped_at=clock_timestamp(),state_version=state_version+1,correlation_id=$3 WHERE id=$1 AND effective_state<>'STOPPED' AND state_version=$4 RETURNING *`, [id, context.logicalOperationId, context.correlationId, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Runtime instance changed while stopping');
  await recordAudit(client, context, 'RUNTIME_INSTANCE', id, { runtimeInstanceId: id, effectiveState: 'STOPPED' });
  return result(context, 'runtime_instance', updated, updated.state_version, { effectiveState: 'STOPPED' });
}

async function handleSecretBind(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = randomUUID();
  const binding = row((await client.query(`INSERT INTO kcml.secret_binding(id,secret_id,source_object_kind,source_object_id,source_revision_id,usage_purpose,target_id,account_id,version_selector,resolved_version_policy,binding_revision,binding_digest,activation_set_id,expires_at,invalidation_policy,audit_metadata,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`, [
    id, uuidArg(context, 'secretId'), textArg(context, 'sourceObjectKind'), uuidArg(context, 'sourceObjectId'), uuidArg(context, 'sourceRevisionId'), textArg(context, 'usagePurpose'), context.arguments.targetId ?? null, context.arguments.accountId ?? null, objectArg(context, 'versionSelector'), textArg(context, 'resolvedVersionPolicy', 'ACTIVE_ONLY'), numberArg(context, 'bindingRevision', 1), digestArgument(context, 'bindingDigest', {}), context.arguments.activationSetId ?? null, context.arguments.expiresAt ?? null, objectArg(context, 'invalidationPolicy'), objectArg(context, 'auditMetadata'), digest({ id, secretId: context.arguments.secretId }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'SECRET_BINDING_NOT_CREATED', 'Secret binding was not persisted');
  await recordAudit(client, context, 'SECRET_BINDING', id, { bindingId: id, secretId: binding.secret_id });
  return result(context, 'secret_binding', binding, binding.state_version, { bindingId: id });
}

async function handleSecretResolve(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = randomUUID();
  const resolution = row((await client.query(`INSERT INTO kcml.secret_resolution(id,execution_context_id,secret_id,binding_id,binding_revision,binding_digest,requested_stable_name,requested_purpose,requested_target,resolved_secret_version_id,secret_activation_epoch,source_revision_id,target_revision_id,source_activation_epoch,target_activation_epoch,state,expires_at,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'RESERVED',$16,$17,$18,$19,$20,$21,$22) RETURNING *`, [
    id, uuidArg(context, 'executionContextId'), uuidArg(context, 'secretId'), uuidArg(context, 'bindingId'), numberArg(context, 'bindingRevision', 1), digestArgument(context, 'bindingDigest', {}), textArg(context, 'requestedStableName'), textArg(context, 'requestedPurpose'), objectArg(context, 'requestedTarget'), context.arguments.resolvedSecretVersionId ?? null, context.arguments.secretActivationEpoch ?? null, context.arguments.sourceRevisionId ?? null, context.arguments.targetRevisionId ?? null, context.arguments.sourceActivationEpoch ?? null, context.arguments.targetActivationEpoch ?? null, futureArg(context, 'expiresAt', 300), digest({ id, secretId: context.arguments.secretId }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'SECRET_RESOLUTION_NOT_CREATED', 'Secret resolution was not persisted');
  await recordAudit(client, context, 'SECRET_RESOLUTION', id, { resolutionId: id, state: 'RESERVED' });
  return result(context, 'secret_resolution', resolution, resolution.state_version, { resolutionId: id });
}

async function handleSecretRotate(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.secret_record WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'SECRET_NOT_FOUND', 'Secret record does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.secret_record SET secret_activation_epoch=secret_activation_epoch+1,metadata=$2,updated_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1 AND lifecycle='ACTIVE' AND state_version=$3 RETURNING *`, [id, { ...objectArg(current, 'metadata'), rotation: objectArg(context, 'evidence') }, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Secret record changed while rotating');
  await recordAudit(client, context, 'SECRET_RECORD', id, { secretId: id, secretActivationEpoch: updated.secret_activation_epoch });
  return result(context, 'secret_record', updated, updated.state_version, { rotationRequested: true });
}

async function handleSecretUnbind(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.secret_binding WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'SECRET_BINDING_NOT_FOUND', 'Secret binding does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.secret_binding SET lifecycle='RETIRED',retired_at=clock_timestamp(),invalidation_policy=$2,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND lifecycle='ACTIVE' AND state_version=$3 RETURNING *`, [id, objectArg(context, 'invalidationPolicy', { reason: context.arguments.reason ?? 'unbind' }), current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Secret binding changed while unbinding');
  await recordAudit(client, context, 'SECRET_BINDING', id, { bindingId: id, lifecycle: 'RETIRED' });
  return result(context, 'secret_binding', updated, updated.state_version, { lifecycle: 'RETIRED' });
}

async function handleSecretUseContextCreate(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = randomUUID();
  const useContext = row((await client.query(`INSERT INTO kcml.secret_use_context(id,operation_context_id,semantic_action_plan_id,secret_binding_alias,secret_binding_revision,declared_purpose,consumer,target_component_id,external_target_id,target_origin,account_id,tenant_id,allowed_placement,argument_path,lifetime,attempt,expected_recipient_contract,use_digest,resolution_evidence,result_evidence,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26) RETURNING *`, [
    id, uuidArg(context, 'operationContextId'), context.arguments.semanticActionPlanId ?? null, textArg(context, 'secretBindingAlias'), numberArg(context, 'secretBindingRevision', 1), textArg(context, 'declaredPurpose'), objectArg(context, 'consumer'), context.arguments.targetComponentId ?? null, context.arguments.externalTargetId ?? null, context.arguments.targetOrigin ?? null, context.arguments.accountId ?? null, context.arguments.tenantId ?? null, textArg(context, 'allowedPlacement', 'RUNTIME_VALUE'), textArg(context, 'argumentPath', '$'), textArg(context, 'lifetime', 'COMMAND'), numberArg(context, 'attempt', 1), objectArg(context, 'expectedRecipientContract'), digest({ id, alias: context.arguments.secretBindingAlias }), objectArg(context, 'resolutionEvidence'), objectArg(context, 'resultEvidence'), digest({ id, alias: context.arguments.secretBindingAlias }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
  ])).rows as Row[], 'SECRET_USE_CONTEXT_NOT_CREATED', 'Secret use context was not persisted');
  await recordAudit(client, context, 'SECRET_USE_CONTEXT', id, { secretUseContextId: id, alias: useContext.secret_binding_alias });
  return result(context, 'secret_use_context', useContext, useContext.state_version, { secretUseContextId: id });
}

async function handleSecretVersionActivate(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const versionId = target(context);
  const version = row((await client.query(`SELECT * FROM kcml.secret_version WHERE id=$1 FOR UPDATE`, [versionId])).rows as Row[], 'SECRET_VERSION_NOT_FOUND', 'Secret version does not exist');
  const secret = row((await client.query(`SELECT * FROM kcml.secret_record WHERE id=$1 FOR UPDATE`, [version.secret_id])).rows as Row[], 'SECRET_NOT_FOUND', 'Secret record does not exist');
  const updatedVersion = row((await client.query(`UPDATE kcml.secret_version SET lifecycle='ACTIVE',activated_at=clock_timestamp(),activation_logical_operation_id=$2 WHERE id=$1 AND lifecycle='CREATED' RETURNING *`, [versionId, context.logicalOperationId])).rows as Row[], 'SECRET_VERSION_STATE_INVALID', 'Secret version cannot be activated');
  const updatedSecret = row((await client.query(`UPDATE kcml.secret_record SET active_version_id=$2,secret_activation_epoch=secret_activation_epoch+1,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state_version=$3 RETURNING *`, [secret.id, versionId, secret.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Secret record changed while activating version');
  await recordAudit(client, context, 'SECRET_RECORD', String(secret.id), { secretId: secret.id, versionId, secretActivationEpoch: updatedSecret.secret_activation_epoch });
  return result(context, 'secret_version', updatedVersion, updatedSecret.state_version, { activeVersionId: versionId });
}

async function handleSecretVersionCreate(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = randomUUID();
  const secretId = uuidArg(context, 'secretId', context.targetId ?? undefined);
  const versionNumber = numberArg(context, 'versionNumber', 1);
  const ciphertext = Buffer.isBuffer(context.arguments.ciphertext) ? context.arguments.ciphertext : Buffer.from(String(context.arguments.ciphertext ?? ''));
  const nonce = Buffer.isBuffer(context.arguments.nonce) ? context.arguments.nonce : Buffer.alloc(12);
  const authTag = Buffer.isBuffer(context.arguments.authTag) ? context.arguments.authTag : Buffer.alloc(16);
  const version = row((await client.query(`INSERT INTO kcml.secret_version(id,secret_id,version_number,ciphertext,nonce,auth_tag,key_id,fingerprint,value_digest,lifecycle,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'CREATED',$10) RETURNING *`, [id, secretId, versionNumber, ciphertext, nonce, authTag, textArg(context, 'keyId', 'kcml-key'), textArg(context, 'fingerprint', `version-${versionNumber}`), digestArgument(context, 'valueDigest', ciphertext), uuidArg(context, 'createdBy', context.logicalOperationId)])).rows as Row[], 'SECRET_VERSION_NOT_CREATED', 'Secret version was not persisted');
  await recordAudit(client, context, 'SECRET_VERSION', id, { secretVersionId: id, secretId, versionNumber });
  return result(context, 'secret_version', version, undefined, { secretVersionId: id });
}

async function handleSelfTestRegisteredElementRun(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const runId = target(context);
  const run = row((await client.query(`SELECT * FROM kcml.self_test_run WHERE id=$1 FOR UPDATE`, [runId])).rows as Row[], 'SELF_TEST_RUN_NOT_FOUND', 'Self-test run does not exist');
  const sequence = await nextSequence(client, 'SELF_TEST_CASE_RESULT', runId, 'SEQUENCE');
  const evidence = row((await client.query(`INSERT INTO kcml.self_test_case_result(test_run_id,sequence,evidence_kind,artifact_path,payload,canonical_digest) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [
    runId, sequence.toString(), textArg(context, 'evidenceKind'), context.arguments.artifactPath ?? null, objectArg(context, 'evidence'), digest(objectArg(context, 'evidence'))
  ])).rows as Row[], 'SELF_TEST_EVIDENCE_NOT_CREATED', 'Self-test evidence was not persisted');
  await recordAudit(client, context, 'SELF_TEST_RUN', runId, { testRunId: runId, evidenceId: evidence.id, sequence: sequence.toString() });
  return result(context, 'self_test_case_result', evidence, run.state_version, { sequence: sequence.toString() });
}

async function handleSelfTestRunCancel(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.self_test_run WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'SELF_TEST_RUN_NOT_FOUND', 'Self-test run does not exist');
  assertVersion(context, current);
  const updated = row((await client.query(`UPDATE kcml.self_test_run SET status='CANCELLED',completed_at=clock_timestamp(),updated_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1 AND status IN ('QUEUED','RUNNING','MANUAL_REVIEW') AND state_version=$2 RETURNING *`, [id, current.state_version])).rows as Row[], 'STATE_VERSION_CONFLICT', 'Self-test run changed while cancelling');
  await recordAudit(client, context, 'SELF_TEST_RUN', id, { testRunId: id, status: 'CANCELLED' });
  return result(context, 'self_test_run', updated, updated.state_version, { status: 'CANCELLED' });
}

async function handleSelfTestRunCleanup(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = target(context);
  const current = row((await client.query(`SELECT * FROM kcml.self_test_run WHERE id=$1 FOR UPDATE`, [id])).rows as Row[], 'SELF_TEST_RUN_NOT_FOUND', 'Self-test run does not exist');
  assertVersion(context, current);
  if (!['PASS', 'FAIL', 'CANCELLED', 'NOT_EXECUTED_ENVIRONMENTAL'].includes(String(current.status))) throw new DomainError('OPERATION_CONTRACT_INCOMPLETE', 'Self-test cleanup requires a terminal run', 409, 'RECONCILE_THEN_RETRY');
  const evidence = { closed: true, status: current.status, cleanup: objectArg(context, 'cleanup') };
  await recordAudit(client, context, 'SELF_TEST_RUN', id, { testRunId: id, cleanup: evidence });
  return result(context, 'self_test_run', current, current.state_version, evidence);
}

function queryId(context: Pick<CanonicalHandlerContext, 'operation' | 'targetId' | 'arguments'>): string {
  if (!context.targetId || !UUID.test(context.targetId)) throw new DomainError('AGENTIC_DYNAMIC_TARGET_UNBOUND', `${context.operation.operationName} requires an exact UUID target`, 422, 'DO_NOT_RETRY');
  return context.targetId;
}

function queryResult(context: Pick<CanonicalHandlerContext, 'operation' | 'targetId' | 'arguments'>, key: string, value: unknown, extra: JsonObject = {}): JsonObject {
  return { operation: context.operation.operationName, [key]: value, ...extra, evidenceDigest: canonicalDigest(json(value)) };
}

export async function handleAgentMemoryRead(pool: DatabasePool, context: Pick<CanonicalHandlerContext, 'operation' | 'targetId' | 'arguments'>): Promise<unknown> {
  const id = queryId(context);
  const rows = (await pool.query(`SELECT * FROM kcml.agent_memory_item WHERE id=$1 AND deleted_at IS NULL`, [id])).rows as Row[];
  if (!rows[0]) throw new DomainError('AGENT_RUN_STATE_UNRESUMABLE', 'Memory item does not exist', 404, 'DO_NOT_RETRY');
  return queryResult(context, 'memory', rows[0], { contentDigest: rows[0].content_digest });
}

export async function handleAgentRunStatus(pool: DatabasePool, context: Pick<CanonicalHandlerContext, 'operation' | 'targetId' | 'arguments'>): Promise<unknown> {
  const id = queryId(context);
  const run = row((await pool.query(`SELECT id,status,input,output,usage,error,manual_review_relation,state_version,checkpoint_sequence,activation_epoch,platform_incarnation_id,application_deployment_epoch,created_at,started_at,completed_at,canonical_digest FROM kcml.agent_run WHERE id=$1`, [id])).rows as Row[], 'AGENT_RUN_NOT_FOUND', 'Agent run does not exist');
  return queryResult(context, 'run', run, { terminal: ['SUCCEEDED', 'FAILED', 'CANCELLED', 'MANUAL_REVIEW'].includes(String(run.status)) });
}

export async function handleAgentStateReport(pool: DatabasePool, context: Pick<CanonicalHandlerContext, 'operation' | 'targetId' | 'arguments'>): Promise<unknown> {
  const id = queryId(context);
  const run = row((await pool.query(`SELECT id,status,state_version,latest_checkpoint_id,checkpoint_sequence,pending_side_effect_ids,activation_epoch,correlation_id,canonical_digest FROM kcml.agent_run WHERE id=$1`, [id])).rows as Row[], 'AGENT_RUN_NOT_FOUND', 'Agent run does not exist');
  return queryResult(context, 'state', run, { state: run.status });
}

export async function handleBrowserAccountVerify(pool: DatabasePool, context: Pick<CanonicalHandlerContext, 'operation' | 'targetId' | 'arguments'>): Promise<unknown> {
  const id = queryId(context);
  const account = row((await pool.query(`SELECT * FROM kcml.browser_account_binding WHERE id=$1`, [id])).rows as Row[], 'BROWSER_ACCOUNT_NOT_FOUND', 'Browser account binding does not exist');
  const valid = account.active_state_bundle_version_id !== null && account.expires_at === null || new Date(String(account.expires_at)).getTime() > Date.now();
  return queryResult(context, 'account', account, { valid, authEpoch: account.auth_epoch });
}

export async function handleBrowserActionStatus(pool: DatabasePool, context: Pick<CanonicalHandlerContext, 'operation' | 'targetId' | 'arguments'>): Promise<unknown> {
  const id = queryId(context);
  const action = row((await pool.query(`SELECT * FROM kcml.browser_action_run WHERE id=$1`, [id])).rows as Row[], 'BROWSER_ACTION_NOT_FOUND', 'Browser action does not exist');
  return queryResult(context, 'action', action, { terminal: ['CONFIRMED_APPLIED', 'CONFIRMED_NOT_APPLIED', 'FAILED_FINAL'].includes(String(action.dispatch_phase)) });
}

export async function handleBrowserAuthVerify(pool: DatabasePool, context: Pick<CanonicalHandlerContext, 'operation' | 'targetId' | 'arguments'>): Promise<unknown> {
  const id = queryId(context);
  const attempt = row((await pool.query(`SELECT * FROM kcml.browser_auth_attempt WHERE id=$1`, [id])).rows as Row[], 'BROWSER_AUTH_ATTEMPT_NOT_FOUND', 'Browser authentication attempt does not exist');
  const valid = ['SUCCEEDED', 'VERIFIED', 'COMPLETED'].includes(String(attempt.state));
  return queryResult(context, 'authAttempt', attempt, { valid });
}

export async function handleBrowserAutomationVerify(pool: DatabasePool, context: Pick<CanonicalHandlerContext, 'operation' | 'targetId' | 'arguments'>): Promise<unknown> {
  const id = queryId(context);
  const run = row((await pool.query(`SELECT * FROM kcml.browser_automation_run WHERE id=$1`, [id])).rows as Row[], 'BROWSER_AUTOMATION_NOT_FOUND', 'Browser automation run does not exist');
  const valid = ['COMPLETED', 'SUCCEEDED'].includes(String(run.status)) && run.output_digest !== null;
  return queryResult(context, 'automation', run, { valid });
}

export async function handleBrowserDownloadVerify(pool: DatabasePool, context: Pick<CanonicalHandlerContext, 'operation' | 'targetId' | 'arguments'>): Promise<unknown> {
  const id = queryId(context);
  const download = row((await pool.query(`SELECT * FROM kcml.browser_download WHERE id=$1`, [id])).rows as Row[], 'BROWSER_DOWNLOAD_NOT_FOUND', 'Browser download does not exist');
  const valid = download.state === 'COMPLETED' && download.artifact_id !== null && download.size_bytes !== null && download.content_digest !== null && objectArg(download, 'content_verification').verified === true;
  return queryResult(context, 'download', download, { valid });
}

export async function handleBrowserRuntimeBuildVerify(pool: DatabasePool, context: Pick<CanonicalHandlerContext, 'operation' | 'targetId' | 'arguments'>): Promise<unknown> {
  const id = queryId(context);
  const build = row((await pool.query(`SELECT * FROM kcml.browser_runtime_build_manifest WHERE id=$1`, [id])).rows as Row[], 'BROWSER_RUNTIME_BUILD_NOT_FOUND', 'Browser runtime build manifest does not exist');
  const valid = build.validation_state === 'PASS' && build.verification_state === 'PASS';
  return queryResult(context, 'runtimeBuild', build, { valid });
}

export async function handleBrowserSessionObserve(pool: DatabasePool, context: Pick<CanonicalHandlerContext, 'operation' | 'targetId' | 'arguments'>): Promise<unknown> {
  const id = queryId(context);
  const session = row((await pool.query(`SELECT * FROM kcml.browser_session WHERE id=$1`, [id])).rows as Row[], 'BROWSER_SESSION_NOT_FOUND', 'Browser session does not exist');
  return queryResult(context, 'session', session, { lifecycle: session.lifecycle });
}

export async function handleBrowserStateVerify(pool: DatabasePool, context: Pick<CanonicalHandlerContext, 'operation' | 'targetId' | 'arguments'>): Promise<unknown> {
  const id = queryId(context);
  const account = row((await pool.query(`SELECT * FROM kcml.browser_account_binding WHERE id=$1`, [id])).rows as Row[], 'BROWSER_ACCOUNT_NOT_FOUND', 'Browser account binding does not exist');
  const bundleId = account.active_state_bundle_version_id;
  const bundle = bundleId ? (await pool.query(`SELECT * FROM kcml.browser_state_bundle WHERE id=$1 AND account_binding_id=$2`, [bundleId, id])).rows[0] as Row | undefined : undefined;
  const valid = Boolean(bundle && bundle.canonical_digest && account.auth_epoch !== undefined);
  return queryResult(context, 'state', { account, bundle: bundle ?? null }, { valid });
}

export async function handleGenerationPlanValidate(pool: DatabasePool, context: Pick<CanonicalHandlerContext, 'operation' | 'targetId' | 'arguments'>): Promise<unknown> {
  const id = queryId(context);
  const plan = row((await pool.query(`SELECT * FROM kcml.generation_plan WHERE id=$1`, [id])).rows as Row[], 'GENERATION_PLAN_NOT_FOUND', 'Generation plan does not exist');
  const checks = [{ gate: 'DAG_PRESENT', pass: Boolean(plan.canonical_dag) }, { gate: 'VALIDATION_STATE', pass: ['PASS', 'VALID', 'SUCCEEDED'].includes(String(plan.validation_state)) }];
  return queryResult(context, 'plan', plan, { valid: checks.every((check) => check.pass), checks });
}

export async function handleGenerationWorkspaceValidate(pool: DatabasePool, context: Pick<CanonicalHandlerContext, 'operation' | 'targetId' | 'arguments'>): Promise<unknown> {
  const id = queryId(context);
  const workspace = row((await pool.query(`SELECT * FROM kcml.generation_workspace_revision WHERE id=$1`, [id])).rows as Row[], 'GENERATION_WORKSPACE_NOT_FOUND', 'Generation workspace revision does not exist');
  const valid = Boolean(workspace.source_tree_digest);
  return queryResult(context, 'workspace', workspace, { valid });
}

export async function handleMcpContractValidate(pool: DatabasePool, context: Pick<CanonicalHandlerContext, 'operation' | 'targetId' | 'arguments'>): Promise<unknown> {
  const id = queryId(context);
  const call = row((await pool.query(`SELECT id,server_contract_digest,binding_decision,canonical_arguments,arguments_digest,state_version FROM kcml.mcp_call_run WHERE id=$1`, [id])).rows as Row[], 'MCP_CALL_NOT_FOUND', 'MCP call run does not exist');
  const valid = call.server_contract_digest !== null && call.arguments_digest !== null;
  return queryResult(context, 'contract', call, { valid });
}

export async function handleMcpEraProbe(pool: DatabasePool, context: Pick<CanonicalHandlerContext, 'operation' | 'targetId' | 'arguments'>): Promise<unknown> {
  const id = queryId(context);
  const call = row((await pool.query(`SELECT id,state,binding_decision,server_contract_digest,canonical_digest FROM kcml.mcp_call_run WHERE id=$1`, [id])).rows as Row[], 'MCP_CALL_NOT_FOUND', 'MCP call run does not exist');
  return queryResult(context, 'era', call, { supported: true });
}

export async function handleMcpLegacyProbe(pool: DatabasePool, context: Pick<CanonicalHandlerContext, 'operation' | 'targetId' | 'arguments'>): Promise<unknown> {
  const id = queryId(context);
  const call = row((await pool.query(`SELECT id,state,binding_decision,canonical_arguments FROM kcml.mcp_call_run WHERE id=$1`, [id])).rows as Row[], 'MCP_CALL_NOT_FOUND', 'MCP call run does not exist');
  return queryResult(context, 'legacy', call, { adapterAvailable: true });
}

export async function handleMcpPromptsGet(pool: DatabasePool, context: Pick<CanonicalHandlerContext, 'operation' | 'targetId' | 'arguments'>): Promise<unknown> {
  const name = textArg({ ...context, operation: context.operation }, 'name', String(context.targetId ?? ''));
  const prompts = (await pool.query(`SELECT id,component_id,revision_id,prompt_name,title,description,arguments,contract_digest FROM kcml.component_prompt_contract WHERE lifecycle='ACTIVE' AND prompt_name=$1 ORDER BY id`, [name])).rows as Row[];
  return queryResult(context, 'prompts', prompts, { count: prompts.length, name });
}

export async function handleMcpPromptsList(pool: DatabasePool, context: Pick<CanonicalHandlerContext, 'operation' | 'targetId' | 'arguments'>): Promise<unknown> {
  const prompts = (await pool.query(`SELECT id,component_id,revision_id,prompt_name,title,description,arguments,contract_digest FROM kcml.component_prompt_contract WHERE lifecycle='ACTIVE' ORDER BY prompt_name,id`)).rows as Row[];
  return queryResult(context, 'prompts', prompts, { count: prompts.length });
}

export async function handleMcpResourcesList(pool: DatabasePool, context: Pick<CanonicalHandlerContext, 'operation' | 'targetId' | 'arguments'>): Promise<unknown> {
  const resources = (await pool.query(`SELECT id,component_id,revision_id,resource_uri,name,title,description,mime_type,contract_digest FROM kcml.component_resource_contract WHERE lifecycle='ACTIVE' ORDER BY resource_uri,id`)).rows as Row[];
  return queryResult(context, 'resources', resources, { count: resources.length });
}

export async function handleMcpResourcesRead(pool: DatabasePool, context: Pick<CanonicalHandlerContext, 'operation' | 'targetId' | 'arguments'>): Promise<unknown> {
  const uri = textArg({ ...context, operation: context.operation }, 'uri', String(context.targetId ?? ''));
  const resource = row((await pool.query(`SELECT id,component_id,revision_id,resource_uri,name,title,description,mime_type,contract_digest FROM kcml.component_resource_contract WHERE lifecycle='ACTIVE' AND resource_uri=$1 ORDER BY id LIMIT 1`, [uri])).rows as Row[], 'MCP_RESOURCE_NOT_FOUND', 'MCP resource does not exist');
  return queryResult(context, 'resource', resource, { uri });
}

export async function handleMcpResourcesTemplatesList(pool: DatabasePool, context: Pick<CanonicalHandlerContext, 'operation' | 'targetId' | 'arguments'>): Promise<unknown> {
  const resources = (await pool.query(`SELECT id,component_id,revision_id,resource_uri,name,title,description,mime_type,contract_digest FROM kcml.component_resource_contract WHERE lifecycle='ACTIVE' AND resource_uri LIKE '%{%' ORDER BY resource_uri,id`)).rows as Row[];
  return queryResult(context, 'templates', resources, { count: resources.length });
}

export async function handleMcpServerDiscover(pool: DatabasePool, context: Pick<CanonicalHandlerContext, 'operation' | 'targetId' | 'arguments'>): Promise<unknown> {
  const components = (await pool.query(`SELECT id,code,description,active_revision_id,current_activation_epoch FROM kcml.component WHERE lifecycle='ACTIVE' ORDER BY code,id`)).rows as Row[];
  return queryResult(context, 'servers', components, { protocolVersion: '2025-11-25', count: components.length });
}

export async function handleMcpTaskGet(pool: DatabasePool, context: Pick<CanonicalHandlerContext, 'operation' | 'targetId' | 'arguments'>): Promise<unknown> {
  const id = queryId(context);
  const task = row((await pool.query(`SELECT * FROM kcml.mcp_task WHERE id=$1`, [id])).rows as Row[], 'MCP_TASK_NOT_FOUND', 'MCP task does not exist');
  return queryResult(context, 'task', task, { terminal: ['COMPLETED', 'FAILED', 'CANCELLED'].includes(String(task.state)) });
}

export async function handleMcpToolsList(pool: DatabasePool, context: Pick<CanonicalHandlerContext, 'operation' | 'targetId' | 'arguments'>): Promise<unknown> {
  const tools = (await pool.query(`SELECT id,component_id,revision_id,tool_name,title,description,input_schema,output_schema,scope,side_effect_policy,retry_policy,idempotency_policy,concurrency_policy,contract_digest FROM kcml.component_tool_contract WHERE lifecycle='ACTIVE' ORDER BY tool_name,id`)).rows as Row[];
  return queryResult(context, 'tools', tools, { count: tools.length });
}

export async function handleMcpWireVerify(pool: DatabasePool, context: Pick<CanonicalHandlerContext, 'operation' | 'targetId' | 'arguments'>): Promise<unknown> {
  const id = queryId(context);
  const request = row((await pool.query(`SELECT * FROM kcml.mcp_request_event WHERE id=$1`, [id])).rows as Row[], 'MCP_REQUEST_NOT_FOUND', 'MCP request event does not exist');
  const valid = request.request_body_digest !== null && request.request_headers_digest !== null && request.final_response_state !== null;
  return queryResult(context, 'request', request, { valid });
}

export async function handleRuntimeReadyReport(pool: DatabasePool, context: Pick<CanonicalHandlerContext, 'operation' | 'targetId' | 'arguments'>): Promise<unknown> {
  const id = queryId(context);
  const runtime = row((await pool.query(`SELECT id,runtime_generation,desired_state,effective_state,ready_sequence,heartbeat_sequence,effective_at,heartbeat_at,state_version,activation_epoch,platform_incarnation_id,application_deployment_epoch,canonical_digest FROM kcml.runtime_instance WHERE id=$1`, [id])).rows as Row[], 'RUNTIME_INSTANCE_NOT_FOUND', 'Runtime instance does not exist');
  const ready = runtime.desired_state === 'READY' && runtime.effective_state === 'READY' && Number(runtime.ready_sequence) > 0;
  return queryResult(context, 'runtime', runtime, { ready });
}

export async function handleRuntimeStateReport(pool: DatabasePool, context: Pick<CanonicalHandlerContext, 'operation' | 'targetId' | 'arguments'>): Promise<unknown> {
  const id = queryId(context);
  const runtime = row((await pool.query(`SELECT * FROM kcml.runtime_instance WHERE id=$1`, [id])).rows as Row[], 'RUNTIME_INSTANCE_NOT_FOUND', 'Runtime instance does not exist');
  return queryResult(context, 'runtime', runtime, { state: runtime.effective_state });
}

/**
 * Exact mutation dispatch for the operations that were previously only
 * catalogued. This is intentionally a switch, rather than a registry or a
 * implicit resolver: every operation name is reviewed at a concrete
 * persistence boundary and points at a named function.
 */
export function exactMutationHandlerFor(operationName: string): CanonicalMutationHandler | undefined {
  switch (operationName) {
    case 'agent.approval.approve': return handleAgentApprovalApprove;
    case 'agent.approval.reject': return handleAgentApprovalReject;
    case 'agent.approval.request': return handleAgentApprovalRequest;
    case 'agent.checkpoint.created': return handleAgentCheckpointCreated;
    case 'agent.delegate.request': return handleAgentDelegateRequest;
    case 'agent.delegate.result': return handleAgentDelegateResult;
    case 'agent.eval.result': return handleAgentEvalResult;
    case 'agent.eval.start': return handleAgentEvalStart;
    case 'agent.memory.write': return handleAgentMemoryWrite;
    case 'agent.message.append': return handleAgentMessageAppend;
    case 'agent.model.completed': return handleAgentModelCompleted;
    case 'agent.model.started': return handleAgentModelStarted;
    case 'agent.run.cancel': return handleAgentRunCancel;
    case 'agent.run.complete': return handleAgentRunComplete;
    case 'agent.run.fail': return handleAgentRunFail;
    case 'agent.run.manualReview': return handleAgentRunManualReview;
    case 'agent.run.pause': return handleAgentRunPause;
    case 'agent.run.resume': return handleAgentRunResume;
    case 'agent.run.start': return handleAgentRunStart;
    case 'agent.session.compact': return handleAgentSessionCompact;
    case 'agent.tool.failed': return handleAgentToolFailed;
    case 'agent.tool.request': return handleAgentToolRequest;
    case 'agent.tool.result': return handleAgentToolResult;
    case 'agentic.security.event.record': return handleAgenticSecurityEventRecord;
    case 'agentic.security.evidence.export': return handleAgenticSecurityEvidenceExport;
    case 'audit.archive.complete': return handleAuditArchiveComplete;
    case 'audit.archive.enqueue': return handleAuditArchiveEnqueue;
    case 'audit.event.append': return handleAuditEventAppend;
    case 'audit.stream.ack': return handleAuditStreamAck;
    case 'audit.stream.replay.request': return handleAuditStreamReplayRequest;
    case 'audit.stream.replay.result': return handleAuditStreamReplayResult;
    case 'authority.actionPlan.compile': return handleAuthorityActionPlanCompile;
    case 'authority.context.create': return handleAuthorityContextCreate;
    case 'authority.intent.compile': return handleAuthorityIntentCompile;
    case 'authority.lineage.append': return handleAuthorityLineageAppend;
    case 'authority.lineage.resolve': return handleAuthorityLineageResolve;
    case 'browser.account.authEpoch.increment': return handleBrowserAccountAuthEpochIncrement;
    case 'browser.account.logout': return handleBrowserAccountLogout;
    case 'browser.account.save': return handleBrowserAccountSave;
    case 'browser.action.cancel': return handleBrowserActionCancel;
    case 'browser.action.complete': return handleBrowserActionComplete;
    case 'browser.action.dispatchPhase': return handleBrowserActionDispatchPhase;
    case 'browser.action.fail': return handleBrowserActionFail;
    case 'browser.action.reconcile': return handleBrowserActionReconcile;
    case 'browser.action.resolveOutcome': return handleBrowserActionResolveOutcome;
    case 'browser.action.start': return handleBrowserActionStart;
    case 'browser.artifact.created': return handleBrowserArtifactCreated;
    case 'browser.automation.cancel': return handleBrowserAutomationCancel;
    case 'browser.automation.preflight': return handleBrowserAutomationPreflight;
    case 'browser.automation.reauthenticate': return handleBrowserAutomationReauthenticate;
    case 'browser.automation.reconcile': return handleBrowserAutomationReconcile;
    case 'browser.automation.repair': return handleBrowserAutomationRepair;
    case 'browser.automation.run': return handleBrowserAutomationRun;
    case 'browser.bridge.assign': return handleBrowserBridgeAssign;
    case 'browser.bridge.connect': return handleBrowserBridgeConnect;
    case 'browser.bridge.enroll': return handleBrowserBridgeEnroll;
    case 'browser.bridge.release': return handleBrowserBridgeRelease;
    case 'browser.bridge.revoke': return handleBrowserBridgeRevoke;
    case 'browser.bridge.rotateCertificate': return handleBrowserBridgeRotateCertificate;
    case 'browser.bridge.test': return handleBrowserBridgeTest;
    case 'browser.challenge.required': return handleBrowserChallengeRequired;
    case 'browser.challenge.resolve': return handleBrowserChallengeResolve;
    case 'browser.cleanup.resume': return handleBrowserCleanupResume;
    case 'browser.control.acquire': return handleBrowserControlAcquire;
    case 'browser.control.changed': return handleBrowserControlChanged;
    case 'browser.control.release': return handleBrowserControlRelease;
    case 'browser.control.transfer': return handleBrowserControlTransfer;
    case 'browser.dialog.opened': return handleBrowserDialogOpened;
    case 'browser.dialog.respond': return handleBrowserDialogRespond;
    case 'browser.document.changed': return handleBrowserDocumentChanged;
    case 'browser.download.persist': return handleBrowserDownloadPersist;
    case 'browser.download.started': return handleBrowserDownloadStarted;
    case 'browser.frame.observed': return handleBrowserFrameObserved;
    case 'browser.host.drain': return handleBrowserHostDrain;
    case 'browser.host.ready': return handleBrowserHostReady;
    case 'browser.host.recover': return handleBrowserHostRecover;
    case 'browser.navigation.observed': return handleBrowserNavigationObserved;
    case 'browser.page.activate': return handleBrowserPageActivate;
    case 'browser.page.close': return handleBrowserPageClose;
    case 'browser.page.observed': return handleBrowserPageObserved;
    case 'browser.page.open': return handleBrowserPageOpen;
    case 'browser.permission.request': return handleBrowserPermissionRequest;
    case 'browser.permission.respond': return handleBrowserPermissionRespond;
    case 'browser.preview.resync': return handleBrowserPreviewResync;
    case 'browser.preview.ticket.create': return handleBrowserPreviewTicketCreate;
    case 'browser.preview.viewer.connected': return handleBrowserPreviewViewerConnected;
    case 'browser.preview.viewer.disconnected': return handleBrowserPreviewViewerDisconnected;
    case 'browser.profile.acquire': return handleBrowserProfileAcquire;
    case 'browser.profile.release': return handleBrowserProfileRelease;
    case 'browser.run.manualReview': return handleBrowserRunManualReview;
    case 'browser.runtimeBuild.register': return handleBrowserRuntimeBuildRegister;
    case 'browser.schedule.evaluate': return handleBrowserScheduleEvaluate;
    case 'browser.session.attach': return handleBrowserSessionAttach;
    case 'browser.session.close': return handleBrowserSessionClose;
    case 'browser.session.pause': return handleBrowserSessionPause;
    case 'browser.session.recover': return handleBrowserSessionRecover;
    case 'browser.session.resume': return handleBrowserSessionResume;
    case 'browser.session.state': return handleBrowserSessionState;
    case 'browser.state.activate': return handleBrowserStateActivate;
    case 'browser.state.capture': return handleBrowserStateCapture;
    case 'browser.state.invalidate': return handleBrowserStateInvalidate;
    case 'browser.target.pick': return handleBrowserTargetPick;
    case 'browser.target.revalidate': return handleBrowserTargetRevalidate;
    case 'browser.teaching.compile': return handleBrowserTeachingCompile;
    case 'browser.teaching.start': return handleBrowserTeachingStart;
    case 'browser.upload.consume': return handleBrowserUploadConsume;
    case 'browser.upload.create': return handleBrowserUploadCreate;
    case 'chat.browser.control.acquire': return handleChatBrowserControlAcquire;
    case 'chat.browser.control.returnToAi': return handleChatBrowserControlReturnToAi;
    case 'chat.browser.session.attach': return handleChatBrowserSessionAttach;
    case 'chat.browser.session.create': return handleChatBrowserSessionCreate;
    case 'chat.browser.target.attach': return handleChatBrowserTargetAttach;
    case 'chat.command.execute': return handleChatCommandExecute;
    case 'chat.conversation.create': return handleChatConversationCreate;
    case 'chat.message.append': return handleChatMessageAppend;
    case 'chat.response.stream': return handleChatResponseStream;
    case 'component.activate': return handleComponentActivate;
    case 'component.control.ack': return handleComponentControlAck;
    case 'component.control.disable': return handleComponentControlDisable;
    case 'component.control.enable': return handleComponentControlEnable;
    case 'component.disable': return handleComponentDisable;
    case 'component.enable': return handleComponentEnable;
    case 'component.rollback': return handleComponentRollback;
    case 'generation.activation.prepare': return handleGenerationActivationPrepare;
    case 'generation.activation.rollback': return handleGenerationActivationRollback;
    case 'generation.activation.switch': return handleGenerationActivationSwitch;
    case 'generation.blocker.open': return handleGenerationBlockerOpen;
    case 'generation.blocker.resolve': return handleGenerationBlockerResolve;
    case 'generation.candidate.publish': return handleGenerationCandidatePublish;
    case 'generation.capability.resolve': return handleGenerationCapabilityResolve;
    case 'generation.integration.step': return handleGenerationIntegrationStep;
    case 'generation.job.cancel': return handleGenerationJobCancel;
    case 'generation.job.complete': return handleGenerationJobComplete;
    case 'generation.job.resume': return handleGenerationJobResume;
    case 'generation.job.retry': return handleGenerationJobRetry;
    case 'generation.message.append': return handleGenerationMessageAppend;
    case 'generation.model.execute': return handleGenerationModelExecute;
    case 'generation.phase.start': return handleGenerationPhaseStart;
    case 'generation.plan.create': return handleGenerationPlanCreate;
    case 'generation.source.add': return handleGenerationSourceAdd;
    case 'generation.spec.approve': return handleGenerationSpecApprove;
    case 'generation.spec.precheck': return handleGenerationSpecPrecheck;
    case 'generation.spec.propose': return handleGenerationSpecPropose;
    case 'generation.turn.interrupt': return handleGenerationTurnInterrupt;
    case 'generation.validation.run': return handleGenerationValidationRun;
    case 'generation.workspace.patch': return handleGenerationWorkspacePatch;
    case 'mcp.cache.invalidate': return handleMcpCacheInvalidate;
    case 'mcp.contract.compatibility': return handleMcpContractCompatibility;
    case 'mcp.discovery.invalidate': return handleMcpDiscoveryInvalidate;
    case 'mcp.discovery.snapshot': return handleMcpDiscoverySnapshot;
    case 'mcp.era.invalidate': return handleMcpEraInvalidate;
    case 'mcp.input.required': return handleMcpInputRequired;
    case 'mcp.input.respond': return handleMcpInputRespond;
    case 'mcp.legacy.adapt': return handleMcpLegacyAdapt;
    case 'mcp.request.finalize': return handleMcpRequestFinalize;
    case 'mcp.request.reserveId': return handleMcpRequestReserveId;
    case 'mcp.request.validateJsonRpc': return handleMcpRequestValidateJsonRpc;
    case 'mcp.request.validateTransport': return handleMcpRequestValidateTransport;
    case 'mcp.stateHandle.close': return handleMcpStateHandleClose;
    case 'mcp.stateHandle.create': return handleMcpStateHandleCreate;
    case 'mcp.stateHandle.resolve': return handleMcpStateHandleResolve;
    case 'mcp.subscription.acknowledge': return handleMcpSubscriptionAcknowledge;
    case 'mcp.subscription.cancel': return handleMcpSubscriptionCancel;
    case 'mcp.subscription.complete': return handleMcpSubscriptionComplete;
    case 'mcp.subscription.listen': return handleMcpSubscriptionListen;
    case 'mcp.subscription.notify': return handleMcpSubscriptionNotify;
    case 'mcp.task.cancel': return handleMcpTaskCancel;
    case 'mcp.task.create': return handleMcpTaskCreate;
    case 'mcp.task.expire': return handleMcpTaskExpire;
    case 'mcp.task.notify': return handleMcpTaskNotify;
    case 'mcp.task.update': return handleMcpTaskUpdate;
    case 'mcp.tools.call': return handleMcpToolsCall;
    case 'mcp.tools.cancel': return handleMcpToolsCancel;
    case 'mcp.tools.progress': return handleMcpToolsProgress;
    case 'mcp.tools.reconcile': return handleMcpToolsReconcile;
    case 'monitor.probe.request': return handleMonitorProbeRequest;
    case 'monitor.probe.result': return handleMonitorProbeResult;
    case 'monitor.repair.enqueue': return handleMonitorRepairEnqueue;
    case 'monitor.state.transition': return handleMonitorStateTransition;
    case 'ownerApiKey.reveal': return handleOwnerApiKeyReveal;
    case 'ownerApiKey.rotate': return handleOwnerApiKeyRotate;
    case 'ownerApiKey.session.exchange': return handleOwnerApiKeySessionExchange;
    case 'provenance.content.register': return handleProvenanceContentRegister;
    case 'provenance.segment.compile': return handleProvenanceSegmentCompile;
    case 'provenance.valueDerivation.create': return handleProvenanceValueDerivationCreate;
    case 'runtime.cancel': return handleRuntimeCancel;
    case 'runtime.cleanup.resume': return handleRuntimeCleanupResume;
    case 'runtime.drain': return handleRuntimeDrain;
    case 'runtime.heartbeat': return handleRuntimeHeartbeat;
    case 'runtime.instance.reconcile': return handleRuntimeInstanceReconcile;
    case 'runtime.instance.restart': return handleRuntimeInstanceRestart;
    case 'runtime.instance.start': return handleRuntimeInstanceStart;
    case 'runtime.invoke': return handleRuntimeInvoke;
    case 'runtime.prepare': return handleRuntimePrepare;
    case 'runtime.stop': return handleRuntimeStop;
    case 'secret.bind': return handleSecretBind;
    case 'secret.resolve': return handleSecretResolve;
    case 'secret.rotate': return handleSecretRotate;
    case 'secret.unbind': return handleSecretUnbind;
    case 'secret.useContext.create': return handleSecretUseContextCreate;
    case 'secret.version.activate': return handleSecretVersionActivate;
    case 'secret.version.create': return handleSecretVersionCreate;
    case 'selfTest.registeredElement.run': return handleSelfTestRegisteredElementRun;
    case 'selfTest.run.cancel': return handleSelfTestRunCancel;
    case 'selfTest.run.cleanup': return handleSelfTestRunCleanup;
    default: return undefined;
  }
}

/** Exact consistent-read dispatch for the thirty previously unbound reads. */
export function exactQueryHandlerFor(operationName: string): CanonicalQueryHandler | undefined {
  switch (operationName) {
    case 'agent.memory.read': return handleAgentMemoryRead;
    case 'agent.run.status': return handleAgentRunStatus;
    case 'agent.state.report': return handleAgentStateReport;
    case 'authority.actionPlan.validate': return handleAuthorityActionPlanValidate;
    case 'authority.context.validate': return handleAuthorityContextValidate;
    case 'authority.intent.validate': return handleAuthorityIntentValidate;
    case 'browser.account.verify': return handleBrowserAccountVerify;
    case 'browser.action.status': return handleBrowserActionStatus;
    case 'browser.auth.verify': return handleBrowserAuthVerify;
    case 'browser.automation.verify': return handleBrowserAutomationVerify;
    case 'browser.download.verify': return handleBrowserDownloadVerify;
    case 'browser.runtimeBuild.verify': return handleBrowserRuntimeBuildVerify;
    case 'browser.session.observe': return handleBrowserSessionObserve;
    case 'browser.state.verify': return handleBrowserStateVerify;
    case 'generation.plan.validate': return handleGenerationPlanValidate;
    case 'generation.workspace.validate': return handleGenerationWorkspaceValidate;
    case 'mcp.contract.validate': return handleMcpContractValidate;
    case 'mcp.era.probe': return handleMcpEraProbe;
    case 'mcp.legacy.probe': return handleMcpLegacyProbe;
    case 'mcp.prompts.get': return handleMcpPromptsGet;
    case 'mcp.prompts.list': return handleMcpPromptsList;
    case 'mcp.resources.list': return handleMcpResourcesList;
    case 'mcp.resources.read': return handleMcpResourcesRead;
    case 'mcp.resources.templates.list': return handleMcpResourcesTemplatesList;
    case 'mcp.server.discover': return handleMcpServerDiscover;
    case 'mcp.task.get': return handleMcpTaskGet;
    case 'mcp.tools.list': return handleMcpToolsList;
    case 'mcp.wire.verify': return handleMcpWireVerify;
    case 'runtime.ready.report': return handleRuntimeReadyReport;
    case 'runtime.state.report': return handleRuntimeStateReport;
    default: return undefined;
  }
}
