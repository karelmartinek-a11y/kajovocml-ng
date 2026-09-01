import { randomUUID } from 'node:crypto';
import type { DatabaseClient, DatabasePool } from '@kcml/database';
import type { OperationContract } from '@kcml/contract-pack';
import { canonicalDigest, type CanonicalJsonValue } from '@kcml/schemas';
import { DomainError } from './errors.js';
import { exactComponentMutationOperations, executeExactComponentMutation } from './component-operations.js';
import { exactMonitorMutationOperations, executeExactMonitorMutation } from './monitor-operations.js';

type JsonObject = Record<string, unknown>;

export interface CanonicalHandlerContext {
  operation: OperationContract;
  targetId: string | null;
  arguments: JsonObject;
  logicalOperationId: string;
  correlationId: string;
  expectedStateVersion: bigint | null;
  activationEpoch: bigint;
  platformIncarnationId: string;
  applicationDeploymentEpoch: bigint;
  recoveryEpoch: bigint;
}

export type CanonicalMutationHandler = (client: DatabaseClient, context: CanonicalHandlerContext) => Promise<unknown>;
export type CanonicalQueryHandler = (pool: DatabasePool, context: Pick<CanonicalHandlerContext, 'operation' | 'targetId' | 'arguments'>) => Promise<unknown>;

function safeJson(value: unknown): CanonicalJsonValue {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item)) as CanonicalJsonValue;
}

function digest(value: unknown): Buffer {
  return Buffer.from(canonicalDigest(safeJson(value)).slice('sha256:'.length), 'hex');
}

function requireTarget(context: CanonicalHandlerContext): string {
  if (!context.targetId) throw new DomainError('OPERATION_TARGET_REQUIRED', `${context.operation.operationName} requires a targetId`, 422, 'DO_NOT_RETRY');
  return context.targetId;
}

function requireString(args: JsonObject, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) throw new DomainError('OPERATION_ARGUMENT_REQUIRED', `${key} is required for this operation`, 422, 'DO_NOT_RETRY', { key });
  return value;
}

function requireUuid(args: JsonObject, key: string): string {
  const value = requireString(args, key);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new DomainError('OPERATION_ARGUMENT_INVALID', `${key} must be a UUID`, 422, 'DO_NOT_RETRY', { key });
  }
  return value;
}

function requireDigest(args: JsonObject, key: string): Buffer {
  const value = requireString(args, key);
  if (!/^sha256:[0-9a-f]{64}$/iu.test(value)) throw new DomainError('OPERATION_ARGUMENT_INVALID', `${key} must be a sha256 digest`, 422, 'DO_NOT_RETRY', { key });
  return Buffer.from(value.slice('sha256:'.length), 'hex');
}

function assertNoAuthorityOverride(args: JsonObject): void {
  const forbidden = ['actorId', 'callerFingerprint', 'correlationId', 'logicalOperationId', 'platformIncarnationId', 'applicationDeploymentEpoch', 'recoveryEpoch', 'concurrencyClaim', 'bindingId', 'bindingDigest'];
  const found = forbidden.filter((key) => key in args);
  if (found.length) throw new DomainError('OPERATION_AUTHORITY_OVERRIDE_FORBIDDEN', 'Caller input cannot override server-owned operation authority', 422, 'DO_NOT_RETRY', { fields: found });
}

/**
 * Validates the parts of the operation contract that are common to every
 * transport and the operation-specific command fields owned by this module.
 * The command envelope remains shared; business fields do not fall through to
 * a table-shaped writer.
 */
export function validateCanonicalOperationCommand(operation: OperationContract, targetId: string | null, args: JsonObject): void {
  assertNoAuthorityOverride(args);
  const name = operation.operationName;
  if (operation.sideEffectClass === 'READ_ONLY' || operation.exposureClass === 'OWNER_QUERY') return;

  switch (name) {
    case 'component.register':
    case 'generation.job.create':
    case 'browser.session.create':
    case 'agent.run.start':
    case 'chat.conversation.create':
    case 'mcp.stateHandle.create':
    case 'mcp.task.create':
    case 'provenance.content.register':
    case 'provenance.segment.compile':
    case 'provenance.valueDerivation.create':
    case 'selfTest.run.start':
      if (targetId !== null) throw new DomainError('OPERATION_TARGET_FORBIDDEN', `${name} creates a new aggregate and cannot have targetId`, 422, 'DO_NOT_RETRY');
      break;
    case 'component.revision.publish':
      requireTarget({ operation, targetId, arguments: args } as CanonicalHandlerContext);
      break;
    case 'monitor.alert.open':
      if (targetId !== null) throw new DomainError('OPERATION_TARGET_FORBIDDEN', `${name} creates an episode and cannot have targetId`, 422, 'DO_NOT_RETRY');
      break;
    default:
      requireTarget({ operation, targetId, arguments: args } as CanonicalHandlerContext);
      break;
  }

  if (name === 'runtime.invoke') requireString(args, 'capabilityAlias');
  if (name === 'mcp.tools.call') requireString(args, 'toolName');
  if (name === 'agent.run.start') {
    requireUuid(args, 'agentDefinitionId');
    requireUuid(args, 'agentRevisionId');
    requireString(args, 'clientRunId');
  }
  if (name === 'mcp.stateHandle.create') {
    requireUuid(args, 'ownerComponentId');
    requireUuid(args, 'ownerRevisionId');
    requireString(args, 'ownerToolKey');
    requireString(args, 'publicOpaqueId');
    requireString(args, 'stateNamespace');
    requireString(args, 'stateReference');
    requireDigest(args, 'contractDigest');
    requireDigest(args, 'lookupDigest');
  }
  if (name === 'mcp.task.create') {
    for (const key of ['serverComponentId', 'serverRevisionId', 'originalCallRunId']) requireUuid(args, key);
    for (const key of ['toolKey', 'publicTaskId']) requireString(args, key);
    requireDigest(args, 'lookupDigest');
    requireDigest(args, 'originalRequestDigest');
  }
  if (name === 'chat.conversation.create') {
    requireString(args, 'title');
    requireString(args, 'selectedModel');
  }
  if (name === 'browser.action.start') {
    requireUuid(args, 'sessionId');
    requireString(args, 'action');
  }
  if (name === 'browser.upload.create') {
    requireUuid(args, 'sessionId');
    requireString(args, 'artifactId');
  }
  if (name === 'browser.download.started') {
    requireUuid(args, 'sessionId');
    requireString(args, 'downloadId');
  }
  if (name === 'agent.message.append' || name === 'generation.message.append' || name === 'chat.message.append') requireString(args, 'content');
  if (name === 'provenance.content.register') {
    for (const key of ['sourceKind', 'contentRole', 'instructionAuthority', 'extractionMethod', 'normalizationMethod']) requireString(args, key);
    requireDigest(args, 'rawDigest');
    requireDigest(args, 'contentDigest');
  }
  if (name === 'selfTest.registeredElement.run') requireString(args, 'evidenceKind');
}

async function runtimeMutation(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const id = requireTarget(context);
  const current = (await client.query(`SELECT * FROM kcml.runtime_instance WHERE id=$1 FOR UPDATE`, [id])).rows[0] as Record<string, unknown> | undefined;
  if (!current) throw new DomainError('RUNTIME_INSTANCE_NOT_FOUND', 'Runtime instance does not exist', 404, 'DO_NOT_RETRY');
  const currentVersion = BigInt(String(current.state_version));
  if (context.expectedStateVersion !== null && currentVersion !== context.expectedStateVersion) throw new DomainError('STATE_VERSION_CONFLICT', 'Runtime instance state version changed', 409, 'REFRESH_AND_RETRY_NEW_COMMAND', { currentStateVersion: String(currentVersion) });

  const name = context.operation.operationName;
  if (name === 'runtime.prepare' || name === 'runtime.instance.start') {
    if (!['STOPPED', 'FAILED', 'UNKNOWN', 'STARTING'].includes(String(current.effective_state))) throw new DomainError('RUNTIME_STATE_INVALID', `Cannot start runtime from ${current.effective_state}`, 409, 'RECONCILE_THEN_RETRY');
    const updated = (await client.query(`UPDATE kcml.runtime_instance SET desired_state='STARTING',effective_state='STARTING',effective_at=NULL,state_version=state_version+1,correlation_id=$2 WHERE id=$1 AND state_version=$3 RETURNING *`, [id, context.correlationId, currentVersion.toString()])).rows[0];
    if (!updated) throw new DomainError('STATE_VERSION_CONFLICT', 'Runtime instance state version changed during preparation', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    return { operation: name, runtime: updated, transition: { from: current.effective_state, to: 'STARTING' }, state_version: updated.state_version };
  }
  if (name === 'runtime.drain') {
    if (!['READY', 'STARTING'].includes(String(current.effective_state))) throw new DomainError('RUNTIME_STATE_INVALID', `Cannot drain runtime from ${current.effective_state}`, 409, 'RECONCILE_THEN_RETRY');
    const updated = (await client.query(`UPDATE kcml.runtime_instance SET desired_state='DRAINING',effective_state='DRAINING',drain_logical_operation_id=$2,state_version=state_version+1,correlation_id=$3 WHERE id=$1 AND state_version=$4 RETURNING *`, [id, context.logicalOperationId, context.correlationId, currentVersion.toString()])).rows[0];
    if (!updated) throw new DomainError('STATE_VERSION_CONFLICT', 'Runtime instance changed during drain', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    return { operation: name, runtime: updated, transition: { from: current.effective_state, to: 'DRAINING' }, state_version: updated.state_version };
  }
  if (name === 'runtime.stop' || name === 'runtime.cancel') {
    if (current.effective_state === 'STOPPED') return { operation: name, runtime: current, duplicate: true, state_version: currentVersion };
    const updated = (await client.query(`UPDATE kcml.runtime_instance SET desired_state='STOPPED',effective_state='STOPPED',stopped_at=clock_timestamp(),stop_logical_operation_id=$2,state_version=state_version+1,correlation_id=$3 WHERE id=$1 AND state_version=$4 RETURNING *`, [id, context.logicalOperationId, context.correlationId, currentVersion.toString()])).rows[0];
    if (!updated) throw new DomainError('STATE_VERSION_CONFLICT', 'Runtime instance changed during stop', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    return { operation: name, runtime: updated, transition: { from: current.effective_state, to: 'STOPPED' }, state_version: updated.state_version };
  }
  if (name === 'runtime.instance.restart') {
    const updated = (await client.query(`UPDATE kcml.runtime_instance SET desired_state='RESTARTING',effective_state='STARTING',restart_logical_operation_id=$2,state_version=state_version+1,correlation_id=$3 WHERE id=$1 AND state_version=$4 RETURNING *`, [id, context.logicalOperationId, context.correlationId, currentVersion.toString()])).rows[0];
    if (!updated) throw new DomainError('STATE_VERSION_CONFLICT', 'Runtime instance changed during restart', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    return { operation: name, runtime: updated, transition: { from: current.effective_state, to: 'STARTING' }, state_version: updated.state_version };
  }
  if (name === 'runtime.heartbeat') {
    const sequence = Number(context.arguments.heartbeatSequence);
    if (!Number.isSafeInteger(sequence) || sequence <= Number(current.heartbeat_sequence ?? 0)) throw new DomainError('RUNTIME_HEARTBEAT_SEQUENCE_STALE', 'Heartbeat sequence must advance monotonically', 409, 'DO_NOT_RETRY');
    const updated = (await client.query(`UPDATE kcml.runtime_instance SET heartbeat_sequence=$2,heartbeat_at=clock_timestamp(),state_version=state_version+1,correlation_id=$3 WHERE id=$1 AND state_version=$4 RETURNING *`, [id, sequence, context.correlationId, currentVersion.toString()])).rows[0];
    if (!updated) throw new DomainError('STATE_VERSION_CONFLICT', 'Runtime instance changed during heartbeat', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    return { operation: name, runtime: updated, state_version: updated.state_version };
  }
  if (name === 'runtime.cleanup.resume') {
    const cleanup = (await client.query(`SELECT * FROM kcml.runtime_cleanup_operation WHERE runtime_instance_id=$1 ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [id])).rows[0];
    if (!cleanup) throw new DomainError('RUNTIME_CLEANUP_NOT_FOUND', 'Runtime cleanup operation does not exist', 404, 'DO_NOT_RETRY');
    return { operation: name, cleanup, closure: cleanup.completed_at !== null };
  }
  throw new DomainError('RUNTIME_OPERATION_CONTRACT_REJECTED', `${name} has no safe state transition for its current persisted runtime contract`, 409, 'RECONCILE_THEN_RETRY', { state: current.effective_state, operation: name });
}

async function chatMutation(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  if (context.operation.operationName === 'chat.conversation.create') {
    const title = requireString(context.arguments, 'title');
    const model = requireString(context.arguments, 'selectedModel');
    const id = randomUUID();
    const row = (await client.query(`INSERT INTO kcml.system_chat_conversation(id,stable_key,title,owner_actor_id,access_channel,status,selected_model,last_activity_at,current_object_context,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
      VALUES($1,$2,$3,'KRMAR78',$4,'OPEN',$5,clock_timestamp(),'{}'::jsonb,$6,$7,$8,$9,$10,$11) RETURNING *`, [id, `chat:${context.logicalOperationId}`, title, context.arguments.accessChannel === 'API_KEY' ? 'API_KEY' : 'SESSION', model, digest({ id, title, model, logicalOperationId: context.logicalOperationId }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()])).rows[0];
    return { operation: context.operation.operationName, conversation: row, state_version: row.state_version };
  }
  const conversationId = requireTarget(context);
  const conversation = (await client.query(`SELECT * FROM kcml.system_chat_conversation WHERE id=$1 FOR UPDATE`, [conversationId])).rows[0];
  if (!conversation) throw new DomainError('CHAT_CONVERSATION_NOT_FOUND', 'Chat conversation does not exist', 404, 'DO_NOT_RETRY');
  if (context.operation.operationName === 'chat.message.append') {
    const content = requireString(context.arguments, 'content');
    const sequence = BigInt(String((await client.query(`SELECT coalesce((SELECT sequence FROM kcml.system_chat_message WHERE conversation_id=$1 ORDER BY sequence DESC LIMIT 1),0)+1 AS next_sequence`, [conversationId])).rows[0].next_sequence));
    const row = (await client.query(`INSERT INTO kcml.system_chat_message(conversation_id,sequence,role,content,status,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
      VALUES($1,$2,'OWNER',$3,'COMPLETED',$4,$5,$6,$7,$8,$9) RETURNING *`, [conversationId, sequence.toString(), content, digest({ conversationId, sequence: sequence.toString(), content }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()])).rows[0];
    await client.query(`UPDATE kcml.system_chat_conversation SET status='OPEN',last_activity_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`, [conversationId]);
    return { operation: context.operation.operationName, message: row, state_version: row.state_version, aggregate_event_sequence: sequence };
  }
  if (context.operation.operationName === 'chat.response.stream') return { operation: context.operation.operationName, conversationId, status: conversation.status, state_version: conversation.state_version };
  throw new DomainError('CHAT_OPERATION_CONTRACT_REJECTED', `No exact chat transition exists for ${context.operation.operationName}`, 409, 'RECONCILE_THEN_RETRY');
}

async function agentMutation(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  if (context.operation.operationName === 'agent.run.start') {
    const agentDefinitionId = requireUuid(context.arguments, 'agentDefinitionId');
    const agentRevisionId = requireUuid(context.arguments, 'agentRevisionId');
    const clientRunId = requireString(context.arguments, 'clientRunId');
    const input = context.arguments.input && typeof context.arguments.input === 'object' ? context.arguments.input : {};
    const row = (await client.query(`INSERT INTO kcml.agent_run(agent_definition_id,agent_revision_id,agent_graph_snapshot_digest,tool_snapshot_digest,guardrail_snapshot_digest,client_run_id,logical_operation_id,idempotency_key,mode,input,input_digest,context_snapshot,budget,correlation_id,platform_incarnation_id,application_deployment_epoch,activation_epoch,canonical_digest)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`, [agentDefinitionId, agentRevisionId, digest(context.arguments.graphSnapshot ?? {}), digest(context.arguments.toolSnapshot ?? {}), digest(context.arguments.guardrailSnapshot ?? {}), clientRunId, context.logicalOperationId, context.arguments.idempotencyKey ?? context.logicalOperationId, context.arguments.mode ?? 'INTERACTIVE', input, digest(input), context.arguments.contextSnapshot ?? {}, context.arguments.budget ?? {}, context.correlationId, context.platformIncarnationId, context.applicationDeploymentEpoch.toString(), context.activationEpoch.toString(), digest({ agentDefinitionId, agentRevisionId, clientRunId, logicalOperationId: context.logicalOperationId })])).rows[0];
    return { operation: context.operation.operationName, run: row, state_version: row.state_version };
  }
  const id = requireTarget(context);
  const current = (await client.query(`SELECT * FROM kcml.agent_run WHERE id=$1 FOR UPDATE`, [id])).rows[0];
  if (!current) throw new DomainError('AGENT_RUN_NOT_FOUND', 'Agent run does not exist', 404, 'DO_NOT_RETRY');
  const transitions: Record<string, { from: string[]; to: string }> = {
    'agent.run.pause': { from: ['RUNNING', 'WAITING_FOR_MODEL', 'WAITING_FOR_TOOL'], to: 'PAUSED' },
    'agent.run.resume': { from: ['PAUSED', 'WAITING_FOR_OWNER'], to: 'RUNNING' },
    'agent.run.cancel': { from: ['QUEUED', 'PREPARING', 'RUNNING', 'WAITING_FOR_MODEL', 'WAITING_FOR_TOOL', 'WAITING_FOR_OWNER'], to: 'CANCEL_REQUESTED' },
    'agent.run.complete': { from: ['RUNNING', 'WAITING_FOR_MODEL', 'WAITING_FOR_TOOL'], to: 'SUCCEEDED' },
    'agent.run.fail': { from: ['RUNNING', 'WAITING_FOR_MODEL', 'WAITING_FOR_TOOL'], to: 'FAILED' },
    'agent.run.manualReview': { from: ['RUNNING', 'WAITING_FOR_MODEL', 'WAITING_FOR_TOOL', 'WAITING_FOR_OWNER'], to: 'MANUAL_REVIEW' }
  };
  const transition = transitions[context.operation.operationName];
  if (!transition) throw new DomainError('AGENT_OPERATION_CONTRACT_REJECTED', `No exact agent transition exists for ${context.operation.operationName}`, 409, 'RECONCILE_THEN_RETRY');
  if (!transition.from.includes(String(current.status))) throw new DomainError('AGENT_STATE_INVALID', `Cannot apply ${context.operation.operationName} from ${current.status}`, 409, 'RECONCILE_THEN_RETRY');
  const completed = ['SUCCEEDED', 'FAILED'].includes(transition.to);
  const row = (await client.query(`UPDATE kcml.agent_run SET status=$2,completed_at=CASE WHEN $3 THEN clock_timestamp() ELSE completed_at END,output=CASE WHEN $3 THEN $4 ELSE output END,output_digest=CASE WHEN $3 THEN $5 ELSE output_digest END,state_version=state_version+1,updated_at=clock_timestamp(),correlation_id=$6 WHERE id=$1 AND state_version=$7 RETURNING *`, [id, transition.to, completed, completed ? (context.arguments.output ?? null) : null, completed ? digest(context.arguments.output ?? null) : null, context.correlationId, current.state_version])).rows[0];
  if (!row) throw new DomainError('STATE_VERSION_CONFLICT', 'Agent run changed during transition', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
  return { operation: context.operation.operationName, run: row, transition: { from: current.status, to: transition.to }, state_version: row.state_version };
}

function exactFamilyRejection(family: string, context: CanonicalHandlerContext): never {
  throw new DomainError(
    `${family}_OPERATION_CONTRACT_REJECTED`,
    `The canonical ${family} contract has no permitted transition for ${context.operation.operationName}`,
    409,
    'RECONCILE_THEN_RETRY',
    { operationName: context.operation.operationName, operationFamily: family }
  );
}

async function agenticMutation(_client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  return exactFamilyRejection('AGENTIC', context);
}

async function auditMutation(_client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  return exactFamilyRejection('AUDIT', context);
}

async function authorityMutation(_client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  return exactFamilyRejection('AUTHORITY', context);
}

async function browserMutation(_client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const name = context.operation.operationName;
  if (['browser.session.attach', 'browser.session.pause', 'browser.session.resume', 'browser.session.close', 'browser.session.recover'].includes(name)) {
    const id = requireTarget(context);
    const current = (await _client.query(`SELECT * FROM kcml.browser_session WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!current) throw new DomainError('BROWSER_SESSION_NOT_FOUND', 'Browser session does not exist', 404, 'DO_NOT_RETRY');
    if (context.expectedStateVersion !== null && BigInt(String(current.state_version)) !== context.expectedStateVersion) throw new DomainError('STATE_VERSION_CONFLICT', 'Browser session state changed', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    const transitions: Record<string, { from: string[]; to: string; holder?: string }> = {
      'browser.session.attach': { from: ['CREATING', 'READY', 'RECONCILING', 'RECOVERING'], to: 'AI_CONTROLLED', holder: 'AI' },
      'browser.session.pause': { from: ['AI_CONTROLLED', 'AUTOMATION_CONTROLLED'], to: 'RECONCILING', holder: 'NONE' },
      'browser.session.resume': { from: ['RECONCILING', 'RECOVERING', 'TAKEOVER'], to: 'AI_CONTROLLED', holder: 'AI' },
      'browser.session.close': { from: ['CREATING', 'READY', 'AI_CONTROLLED', 'OWNER_CONTROLLED', 'AUTOMATION_CONTROLLED', 'TAKEOVER', 'RECONCILING', 'RECOVERING', 'CLEANING'], to: 'CLOSED', holder: 'NONE' },
      'browser.session.recover': { from: ['FAILED_FINAL', 'MANUAL_REVIEW', 'RECONCILING', 'RECOVERING'], to: 'RECOVERING', holder: 'NONE' }
    };
    const transition = transitions[name];
    if (!transition) return exactFamilyRejection('BROWSER', context);
    if (!transition.from.includes(String(current.lifecycle))) throw new DomainError('BROWSER_SESSION_STATE_INVALID', `Cannot apply ${name} from ${current.lifecycle}`, 409, 'RECONCILE_THEN_RETRY');
    const updated = (await _client.query(`UPDATE kcml.browser_session SET lifecycle=$2,control_holder=$3,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state_version=$4 RETURNING *`, [id, transition.to, transition.holder ?? current.control_holder, current.state_version])).rows[0];
    if (!updated) throw new DomainError('STATE_VERSION_CONFLICT', 'Browser session changed during transition', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    return { operation: name, session: updated, transition: { from: current.lifecycle, to: transition.to }, state_version: updated.state_version };
  }
  if (name === 'browser.action.start') {
    const sessionId = requireUuid(context.arguments, 'sessionId');
    const action = requireString(context.arguments, 'action');
    const row = (await _client.query(`INSERT INTO kcml.browser_action_run(session_id,logical_operation_id,action,target_reference_id,payload,expected_control_epoch,expected_document_epoch,expected_observation_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [sessionId, context.logicalOperationId, action, context.arguments.targetReferenceId ?? null, context.arguments.payload ?? {}, Number(context.arguments.expectedControlEpoch ?? 0), Number(context.arguments.expectedDocumentEpoch ?? 0), Number(context.arguments.expectedObservationRevision ?? 0)])).rows[0];
    return { operation: name, action: row, state_version: row.state_version };
  }
  if (['browser.action.cancel', 'browser.action.complete', 'browser.action.fail', 'browser.action.resolveOutcome'].includes(name)) {
    const id = requireTarget(context);
    const phase = name.endsWith('.cancel') ? 'CONFIRMED_NOT_APPLIED' : name.endsWith('.complete') ? 'CONFIRMED_APPLIED' : name.endsWith('.fail') ? 'FAILED_FINAL' : 'OUTCOME_OBSERVED';
    const updated = (await _client.query(`UPDATE kcml.browser_action_run SET dispatch_phase=$2,outcome=$3,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND ($4::bigint IS NULL OR state_version=$4) RETURNING *`, [id, phase, context.arguments.outcome ?? context.arguments.error ?? {}, context.expectedStateVersion?.toString() ?? null])).rows[0];
    if (!updated) throw new DomainError('BROWSER_ACTION_NOT_FOUND_OR_STALE', 'Browser action does not exist or its state version is stale', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    return { operation: name, action: updated, state_version: updated.state_version };
  }
  return exactFamilyRejection('BROWSER', context);
}

async function componentMutation(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  if (exactComponentMutationOperations.has(context.operation.operationName)) {
    return executeExactComponentMutation(client, {
      operationName: context.operation.operationName,
      targetId: context.targetId,
      arguments: context.arguments,
      expectedStateVersion: context.expectedStateVersion,
      logicalOperationId: context.logicalOperationId,
      correlationId: context.correlationId,
      platformIncarnationId: context.platformIncarnationId,
      applicationDeploymentEpoch: context.applicationDeploymentEpoch
    });
  }
  return exactFamilyRejection('COMPONENT', context);
}

async function generationMutation(_client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const name = context.operation.operationName;
  if (['generation.job.cancel', 'generation.job.resume', 'generation.job.retry', 'generation.job.complete'].includes(name)) {
    const id = requireTarget(context);
    const current = (await _client.query(`SELECT * FROM kcml.generation_job WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!current) throw new DomainError('GENERATION_JOB_NOT_FOUND', 'Generation job does not exist', 404, 'DO_NOT_RETRY');
    if (context.expectedStateVersion !== null && BigInt(String(current.state_version)) !== context.expectedStateVersion) throw new DomainError('STATE_VERSION_CONFLICT', 'Generation job state changed', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    const transitions: Record<string, { from: string[]; to: string }> = {
      'generation.job.cancel': { from: ['INTAKE', 'DISCOVERY', 'SPECIFICATION', 'APPROVAL_REQUIRED', 'PLANNING', 'IMPLEMENTING', 'VALIDATING', 'ACTIVATING', 'MANUAL_REVIEW'], to: 'CANCELLED_FINAL' },
      'generation.job.resume': { from: ['MANUAL_REVIEW'], to: 'DISCOVERY' },
      'generation.job.retry': { from: ['FAILED_FINAL', 'MANUAL_REVIEW'], to: 'DISCOVERY' },
      'generation.job.complete': { from: ['VALIDATING', 'ACTIVATING'], to: 'SUCCEEDED' }
    };
    const transition = transitions[name];
    if (!transition) return exactFamilyRejection('GENERATION', context);
    if (!transition.from.includes(String(current.lifecycle))) throw new DomainError('GENERATION_JOB_STATE_INVALID', `Cannot apply ${name} from ${current.lifecycle}`, 409, 'RECONCILE_THEN_RETRY');
    const updated = (await _client.query(`UPDATE kcml.generation_job SET lifecycle=$2,current_phase=$3,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state_version=$4 RETURNING *`, [id, transition.to, transition.to === 'SUCCEEDED' || transition.to === 'CANCELLED_FINAL' ? 'TERMINAL' : 'DISCOVERY', current.state_version])).rows[0];
    if (!updated) throw new DomainError('STATE_VERSION_CONFLICT', 'Generation job changed during transition', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    return { operation: name, job: updated, transition: { from: current.lifecycle, to: transition.to }, state_version: updated.state_version };
  }
  if (name === 'generation.message.append') {
    const jobId = requireTarget(context);
    const content = requireString(context.arguments, 'content');
    const sequence = BigInt(String((await _client.query(`SELECT coalesce((SELECT sequence FROM kcml.generation_message WHERE job_id=$1 ORDER BY sequence DESC LIMIT 1),0)+1 AS next_sequence`, [jobId])).rows[0].next_sequence));
    const row = (await _client.query(`INSERT INTO kcml.generation_message(job_id,sequence,role,content,attachments,status,content_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [jobId, sequence.toString(), context.arguments.role ?? 'OWNER', { text: content }, context.arguments.attachments ?? [], 'COMPLETED', digest(content), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()])).rows[0];
    return { operation: name, message: row, aggregate_event_sequence: sequence, state_version: row.state_version };
  }
  return exactFamilyRejection('GENERATION', context);
}

async function mcpMutation(_client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const name = context.operation.operationName;
  if (name === 'mcp.stateHandle.create') {
    const ownerComponentId = requireUuid(context.arguments, 'ownerComponentId');
    const ownerRevisionId = requireUuid(context.arguments, 'ownerRevisionId');
    const id = randomUUID();
    const row = (await _client.query(`INSERT INTO kcml.mcp_state_handle(id,owner_component_id,owner_tool_key,owner_revision_id,contract_digest,public_opaque_id,lookup_digest,generation_nonce,access_context,binding_revision,state_namespace,state_reference,status,expires_at,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'OPEN',clock_timestamp()+make_interval(secs=>$13),$14,$15,$16,$17,$18,$19) RETURNING *`, [id, ownerComponentId, requireString(context.arguments, 'ownerToolKey'), ownerRevisionId, requireDigest(context.arguments, 'contractDigest'), requireString(context.arguments, 'publicOpaqueId'), requireDigest(context.arguments, 'lookupDigest'), context.arguments.generationNonce ?? randomUUID(), context.arguments.accessContext ?? {}, Number(context.arguments.bindingRevision ?? 1), requireString(context.arguments, 'stateNamespace'), requireString(context.arguments, 'stateReference'), Number(context.arguments.ttlSeconds ?? 3600), digest({ id, operation: name, arguments: context.arguments }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()])).rows[0];
    return { operation: name, stateHandle: row, state_version: row.state_version };
  }
  if (['mcp.stateHandle.resolve', 'mcp.stateHandle.close'].includes(name)) {
    const id = requireTarget(context);
    const current = (await _client.query(`SELECT * FROM kcml.mcp_state_handle WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!current) throw new DomainError('MCP_STATE_HANDLE_NOT_FOUND', 'MCP state handle does not exist', 404, 'DO_NOT_RETRY');
    if (name === 'mcp.stateHandle.resolve') {
      if (current.status !== 'OPEN') throw new DomainError('MCP_STATE_HANDLE_NOT_OPEN', 'Only an open MCP state handle can be resolved', 409, 'RECONCILE_THEN_RETRY');
      return { operation: name, stateHandle: current, state_version: current.state_version };
    }
    if (current.status === 'CLOSED') return { operation: name, stateHandle: current, duplicate: true, state_version: current.state_version };
    const row = (await _client.query(`UPDATE kcml.mcp_state_handle SET status='CLOSED',closed_at=clock_timestamp(),close_logical_operation_id=$2,logical_operation_id=$2,correlation_id=$3,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND ($4::bigint IS NULL OR state_version=$4) RETURNING *`, [id, context.logicalOperationId, context.correlationId, context.expectedStateVersion?.toString() ?? null])).rows[0];
    if (!row) throw new DomainError('STATE_VERSION_CONFLICT', 'MCP state handle changed during close', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    return { operation: name, stateHandle: row, state_version: row.state_version };
  }
  if (name === 'mcp.task.create') {
    const id = randomUUID();
    const ttlMs = Number(context.arguments.ttlMs ?? 60_000);
    const row = (await _client.query(`INSERT INTO kcml.mcp_task(id,server_component_id,tool_key,server_revision_id,original_call_run_id,public_task_id,lookup_digest,logical_operation_id,source_execution_context_id,access_context,binding_revision,activation_epoch,original_request_digest,idempotency_key,wire_status,state,platform_incarnation_id,application_deployment_epoch,ttl_ms,expires_at,poll_interval_ms,canonical_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'working','WORKING',$15,$16,$17,clock_timestamp()+make_interval(secs=>$17/1000.0),$18,$19) RETURNING *`, [id, requireUuid(context.arguments, 'serverComponentId'), requireString(context.arguments, 'toolKey'), requireUuid(context.arguments, 'serverRevisionId'), requireUuid(context.arguments, 'originalCallRunId'), requireString(context.arguments, 'publicTaskId'), requireDigest(context.arguments, 'lookupDigest'), context.logicalOperationId, context.arguments.sourceExecutionContextId ? requireUuid(context.arguments, 'sourceExecutionContextId') : null, context.arguments.accessContext ?? {}, Number(context.arguments.bindingRevision ?? 1), context.activationEpoch.toString(), requireDigest(context.arguments, 'originalRequestDigest'), context.arguments.idempotencyKey ?? null, context.platformIncarnationId, context.applicationDeploymentEpoch.toString(), ttlMs, Number(context.arguments.pollIntervalMs ?? 1000), digest({ id, operation: name, arguments: context.arguments })])).rows[0];
    return { operation: name, task: row, state_version: row.state_version };
  }
  if (['mcp.task.cancel', 'mcp.task.expire', 'mcp.task.update'].includes(name)) {
    const id = requireTarget(context);
    const current = (await _client.query(`SELECT * FROM kcml.mcp_task WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!current) throw new DomainError('MCP_TASK_NOT_FOUND', 'MCP task does not exist', 404, 'DO_NOT_RETRY');
    if (context.expectedStateVersion !== null && BigInt(String(current.state_version)) !== context.expectedStateVersion) throw new DomainError('STATE_VERSION_CONFLICT', 'MCP task state changed', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    if (name === 'mcp.task.update') {
      if (!['WORKING', 'INPUT_REQUIRED'].includes(String(current.state))) throw new DomainError('MCP_TASK_STATE_INVALID', 'Only a live MCP task can receive an update', 409, 'RECONCILE_THEN_RETRY');
      const state = context.arguments.state === 'INPUT_REQUIRED' ? 'INPUT_REQUIRED' : 'WORKING';
      const row = (await _client.query(`UPDATE kcml.mcp_task SET state=$2,wire_status=$3,updated_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1 AND state_version=$4 RETURNING *`, [id, state, state === 'INPUT_REQUIRED' ? 'input_required' : 'working', current.state_version])).rows[0];
      if (!row) throw new DomainError('STATE_VERSION_CONFLICT', 'MCP task changed during update', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
      return { operation: name, task: row, state_version: row.state_version };
    }
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(String(current.state))) return { operation: name, task: current, duplicate: true, state_version: current.state_version };
    const finalState = name === 'mcp.task.cancel' ? 'CANCELLED' : 'FAILED';
    const row = (await _client.query(`UPDATE kcml.mcp_task SET state=$2,wire_status=$3,cancellation_intent=CASE WHEN $2='CANCELLED' THEN $4 ELSE cancellation_intent END,expiry_intent=CASE WHEN $2='FAILED' THEN $4 ELSE expiry_intent END,final_digest=$5,updated_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1 AND state_version=$6 RETURNING *`, [id, finalState, finalState === 'CANCELLED' ? 'cancelled' : 'failed', { logicalOperationId: context.logicalOperationId, reason: context.arguments.reason ?? name }, digest({ id, operation: name, reason: context.arguments.reason ?? null }), current.state_version])).rows[0];
    if (!row) throw new DomainError('STATE_VERSION_CONFLICT', 'MCP task changed during terminal transition', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    return { operation: name, task: row, state_version: row.state_version };
  }
  return exactFamilyRejection('MCP', context);
}

async function monitorMutation(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  if (exactMonitorMutationOperations.has(context.operation.operationName)) {
    return executeExactMonitorMutation(client, {
      operationName: context.operation.operationName,
      targetId: context.targetId,
      arguments: context.arguments,
      expectedStateVersion: context.expectedStateVersion,
      logicalOperationId: context.logicalOperationId,
      correlationId: context.correlationId,
      activationEpoch: context.activationEpoch,
      platformIncarnationId: context.platformIncarnationId,
      applicationDeploymentEpoch: context.applicationDeploymentEpoch,
      recoveryEpoch: context.recoveryEpoch
    });
  }
  return exactFamilyRejection('MONITOR', context);
}

async function ownerApiKeyMutation(_client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  return exactFamilyRejection('OWNERAPIKEY', context);
}

async function provenanceMutation(_client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  if (context.operation.operationName === 'provenance.content.register') {
    const id = randomUUID();
    const row = (await _client.query(`INSERT INTO kcml.content_provenance(id,parent_content_id,transformation_id,source_kind,source_object_id,source_revision_id,source_locator,observed_at,raw_bytes,artifact_reference,raw_digest,content_digest,mime_type,schema_id,content_role,instruction_authority,taint_flags,provenance_flags,extraction_method,normalization_method,transform_chain,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27) RETURNING *`, [id, context.arguments.parentContentId ? requireUuid(context.arguments, 'parentContentId') : null, context.arguments.transformationId ? requireUuid(context.arguments, 'transformationId') : null, requireString(context.arguments, 'sourceKind'), context.arguments.sourceObjectId ? requireUuid(context.arguments, 'sourceObjectId') : null, context.arguments.sourceRevisionId ? requireUuid(context.arguments, 'sourceRevisionId') : null, context.arguments.sourceLocator ?? {}, context.arguments.observedAt ?? new Date().toISOString(), context.arguments.rawBytes ?? null, context.arguments.artifactReference ?? null, requireDigest(context.arguments, 'rawDigest'), requireDigest(context.arguments, 'contentDigest'), context.arguments.mimeType ?? null, context.arguments.schemaId ?? null, requireString(context.arguments, 'contentRole'), requireString(context.arguments, 'instructionAuthority'), context.arguments.taintFlags ?? [], context.arguments.provenanceFlags ?? [], requireString(context.arguments, 'extractionMethod'), requireString(context.arguments, 'normalizationMethod'), context.arguments.transformChain ?? [], digest({ id, operation: context.operation.operationName, arguments: context.arguments }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()])).rows[0];
    return { operation: context.operation.operationName, provenance: row, state_version: row.state_version };
  }
  return exactFamilyRejection('PROVENANCE', context);
}

async function secretMutation(_client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  return exactFamilyRejection('SECRET', context);
}

async function selfTestMutation(_client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const name = context.operation.operationName;
  if (['selfTest.run.cancel', 'selfTest.run.cleanup', 'selfTest.registeredElement.run'].includes(name)) {
    const id = requireTarget(context);
    const current = (await _client.query(`SELECT * FROM kcml.self_test_run WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!current) throw new DomainError('SELF_TEST_RUN_NOT_FOUND', 'Self-test run does not exist', 404, 'DO_NOT_RETRY');
    if (context.expectedStateVersion !== null && BigInt(String(current.state_version)) !== context.expectedStateVersion) throw new DomainError('STATE_VERSION_CONFLICT', 'Self-test run state changed', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    if (name === 'selfTest.run.cleanup') {
      if (!['PASS', 'FAIL', 'CANCELLED', 'NOT_EXECUTED_ENVIRONMENTAL'].includes(String(current.status))) throw new DomainError('SELF_TEST_CLEANUP_STATE_INVALID', 'Self-test cleanup requires a terminal run', 409, 'RECONCILE_THEN_RETRY');
      return { operation: name, run: current, closure: current.completed_at !== null, state_version: current.state_version };
    }
    if (name === 'selfTest.registeredElement.run') {
      const sequence = BigInt(String((await _client.query(`SELECT coalesce((SELECT sequence FROM kcml.self_test_case_result WHERE test_run_id=$1 ORDER BY sequence DESC LIMIT 1),0)+1 AS next_sequence`, [id])).rows[0].next_sequence));
      const evidence = context.arguments.evidence ?? {};
      const result = (await _client.query(`INSERT INTO kcml.self_test_case_result(test_run_id,sequence,evidence_kind,payload,canonical_digest) VALUES($1,$2,$3,$4,$5) RETURNING *`, [id, sequence.toString(), requireString(context.arguments, 'evidenceKind'), evidence, digest(evidence)])).rows[0];
      return { operation: name, evidence: result, aggregate_event_sequence: sequence, state_version: current.state_version };
    }
    if (['PASS', 'FAIL', 'CANCELLED', 'NOT_EXECUTED_ENVIRONMENTAL'].includes(String(current.status))) return { operation: name, run: current, duplicate: true, state_version: current.state_version };
    const row = (await _client.query(`UPDATE kcml.self_test_run SET status='CANCELLED',completed_at=clock_timestamp(),updated_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1 AND state_version=$2 RETURNING *`, [id, current.state_version])).rows[0];
    if (!row) throw new DomainError('STATE_VERSION_CONFLICT', 'Self-test run changed during cancellation', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    return { operation: name, run: row, state_version: row.state_version };
  }
  return exactFamilyRejection('SELFTEST', context);
}

/** Explicit family dispatch. Every catalogued operation reaches a named
 * family handler; there is no entity/table CRUD fallback in this boundary. */
export function mutationHandlerFor(operation: OperationContract): CanonicalMutationHandler {
  switch (operation.operationFamily) {
    case 'RUNTIME': return runtimeMutation;
    case 'CHAT': return chatMutation;
    case 'AGENT': return agentMutation;
    case 'AGENTIC': return agenticMutation;
    case 'AUDIT': return auditMutation;
    case 'AUTHORITY': return authorityMutation;
    case 'BROWSER': return browserMutation;
    case 'COMPONENT': return componentMutation;
    case 'GENERATION': return generationMutation;
    case 'MCP': return mcpMutation;
    case 'MONITOR': return monitorMutation;
    case 'OWNERAPIKEY': return ownerApiKeyMutation;
    case 'PROVENANCE': return provenanceMutation;
    case 'SECRET': return secretMutation;
    case 'SELFTEST': return selfTestMutation;
    default: return async (_client, context) => exactFamilyRejection(operation.operationFamily, context);
  }
}

export function queryHandlerFor(operation: OperationContract): CanonicalQueryHandler {
  switch (operation.operationName) {
    case 'runtime.ready.report':
    case 'runtime.state.report':
      return async (pool, context) => {
        const id = context.targetId;
        if (!id) throw new DomainError('RUNTIME_TARGET_REQUIRED', `${operation.operationName} requires an exact runtime target`, 422, 'DO_NOT_RETRY');
        const row = (await pool.query(`SELECT id,runtime_generation,desired_state,effective_state,ready_sequence,heartbeat_sequence,effective_at,heartbeat_at,state_version,activation_epoch,platform_incarnation_id,application_deployment_epoch,canonical_digest FROM kcml.runtime_instance WHERE id=$1`, [id])).rows[0];
        if (!row) throw new DomainError('RUNTIME_INSTANCE_NOT_FOUND', 'Runtime instance does not exist', 404, 'DO_NOT_RETRY');
        return { operation: operation.operationName, runtime: row, ready: row.desired_state === 'READY' && row.effective_state === 'READY' && Number(row.ready_sequence) > 0, evidenceDigest: canonicalDigest(safeJson(row)) };
      };
    case 'mcp.server.discover':
      return async () => ({ operation: operation.operationName, protocolVersion: '2025-11-25', supportedVersions: ['2025-11-25', '2025-06-18', '2025-03-26'], serverInfo: { name: 'KájovoCML NG', version: '2026.8.30-8' }, evidenceDigest: canonicalDigest({ operation: operation.operationName, protocolVersion: '2025-11-25' }) });
    case 'mcp.tools.list':
      return async (pool) => {
        const rows = (await pool.query(`SELECT id,component_id,revision_id,tool_name,title,description,input_schema,output_schema,scope,side_effect_policy,retry_policy,idempotency_policy,concurrency_policy,contract_digest FROM kcml.component_tool_contract WHERE lifecycle='ACTIVE' AND deleted_at IS NULL ORDER BY tool_name,id`)).rows;
        return { operation: operation.operationName, tools: rows, count: rows.length, evidenceDigest: canonicalDigest(safeJson(rows)) };
      };
    case 'mcp.task.get':
      return async (pool, context) => {
        const id = requireQueryTarget(context.targetId, operation.operationName);
        const row = (await pool.query(`SELECT * FROM kcml.mcp_task WHERE id=$1`, [id])).rows[0];
        if (!row) throw new DomainError('MCP_TASK_NOT_FOUND', 'MCP task does not exist', 404, 'DO_NOT_RETRY');
        return { operation: operation.operationName, task: row, evidenceDigest: canonicalDigest(safeJson(row)) };
      };
    case 'agent.run.status':
    case 'agent.state.report':
      return async (pool, context) => {
        const id = requireQueryTarget(context.targetId, operation.operationName);
        const row = (await pool.query(`SELECT id,agent_definition_id,agent_revision_id,status,input,output,usage,error,manual_review_relation,state_version,checkpoint_sequence,activation_epoch,platform_incarnation_id,application_deployment_epoch,created_at,started_at,completed_at,canonical_digest FROM kcml.agent_run WHERE id=$1`, [id])).rows[0];
        if (!row) throw new DomainError('AGENT_RUN_NOT_FOUND', 'Agent run does not exist', 404, 'DO_NOT_RETRY');
        return { operation: operation.operationName, run: row, terminal: ['SUCCEEDED', 'FAILED', 'CANCELLED', 'MANUAL_REVIEW'].includes(String(row.status)), evidenceDigest: canonicalDigest(safeJson(row)) };
      };
    case 'generation.plan.validate':
    case 'generation.workspace.validate':
      return async (pool, context) => {
        const id = requireQueryTarget(context.targetId, operation.operationName);
        const table = operation.operationName === 'generation.plan.validate' ? 'generation_plan' : 'generation_workspace_revision';
        const row = (await pool.query(`SELECT to_jsonb(t) AS row FROM kcml.${table} t WHERE t.id=$1`, [id])).rows[0]?.row;
        if (!row) throw new DomainError('GENERATION_TARGET_NOT_FOUND', 'Generation target does not exist', 404, 'DO_NOT_RETRY');
        return { operation: operation.operationName, valid: true, target: row, evidenceDigest: canonicalDigest(safeJson(row)) };
      };
    case 'browser.session.observe':
    case 'browser.session.state':
      return async (pool, context) => {
        const id = requireQueryTarget(context.targetId, operation.operationName);
        const row = (await pool.query(`SELECT * FROM kcml.browser_session WHERE id=$1`, [id])).rows[0];
        if (!row) throw new DomainError('BROWSER_SESSION_NOT_FOUND', 'Browser session does not exist', 404, 'DO_NOT_RETRY');
        return { operation: operation.operationName, session: row, evidenceDigest: canonicalDigest(safeJson(row)) };
      };
    case 'browser.action.status':
      return async (pool, context) => {
        const id = requireQueryTarget(context.targetId, operation.operationName);
        const row = (await pool.query(`SELECT * FROM kcml.browser_action_run WHERE id=$1`, [id])).rows[0];
        if (!row) throw new DomainError('BROWSER_ACTION_NOT_FOUND', 'Browser action does not exist', 404, 'DO_NOT_RETRY');
        return { operation: operation.operationName, action: row, evidenceDigest: canonicalDigest(safeJson(row)) };
      };
    case 'audit.stream.replay.request':
      return async (pool, context) => {
        const limit = typeof context.arguments.limit === 'number' && Number.isSafeInteger(context.arguments.limit) && context.arguments.limit > 0 && context.arguments.limit <= 500 ? context.arguments.limit : 100;
        const rows = (await pool.query(`SELECT chain_sequence,event_type,aggregate_type,aggregate_id,correlation_id,payload_digest,previous_hash,event_hash,created_at FROM kcml.audit_event ORDER BY chain_sequence DESC LIMIT $1`, [limit])).rows;
        return { operation: operation.operationName, events: rows, count: rows.length, evidenceDigest: canonicalDigest(safeJson(rows)) };
      };
    default:
      return async (_pool, context) => exactFamilyRejection(`${operation.operationFamily}_QUERY`, {
        operation: context.operation,
        targetId: context.targetId,
        arguments: context.arguments,
        logicalOperationId: '',
        correlationId: '',
        expectedStateVersion: null,
        activationEpoch: 0n,
        platformIncarnationId: '',
        applicationDeploymentEpoch: 0n,
        recoveryEpoch: 0n
      });
  }
}

function requireQueryTarget(targetId: string | null, operationName: string): string {
  if (!targetId) throw new DomainError('OPERATION_TARGET_REQUIRED', `${operationName} requires a targetId`, 422, 'DO_NOT_RETRY');
  return targetId;
}
