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
  /** Exact command identity used by immutable browser dispatch evidence. */
  commandId?: string;
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

const browserDispatchPhases = [
  'COMMAND_ACCEPTED',
  'TARGET_RESOLVED',
  'ACTIONABILITY_PASSED',
  'INPUT_SEQUENCE_STARTED',
  'MUTATION_TRIGGER_POSSIBLY_ISSUED',
  'NAVIGATION_OR_REQUEST_OBSERVED',
  'METHOD_RETURNED',
  'POST_OBSERVATION_CAPTURED'
] as const;
type BrowserDispatchPhase = typeof browserDispatchPhases[number];
const browserDispatchPhaseOrder = new Map<BrowserDispatchPhase, number>(browserDispatchPhases.map((phase, index) => [phase, index + 1]));
const browserChallengeTypes = ['CAPTCHA', 'OTP', 'PUSH', 'WEBAUTHN_ASSERTION', 'WEBAUTHN_REGISTRATION', 'PASSKEY', 'CLIENT_CERTIFICATE'] as const;

function rejectArbitraryBrowserPath(value: unknown, path = 'arguments'): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectArbitraryBrowserPath(item, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:path|filePath|hostPath|tempPath|destinationPath|downloadPath|uploadPath)$/iu.test(key)) {
      throw new DomainError('BROWSER_ARBITRARY_PATH_DENIED', `Browser input ${path}.${key} must be an opaque artifact handle`, 422, 'DO_NOT_RETRY', { field: `${path}.${key}` });
    }
    rejectArbitraryBrowserPath(child, `${path}.${key}`);
  }
}

function requireSafeName(args: JsonObject, key: string, fallback: string): string {
  const value = args[key] === undefined ? fallback : requireString(args, key);
  if (value.length > 255 || value === '.' || value === '..' || value.includes('/') || value.includes('\\') || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new DomainError('BROWSER_ARTIFACT_NAME_INVALID', `${key} must be a safe single path segment`, 422, 'DO_NOT_RETRY');
  }
  return value;
}

function requireNonNegativeInteger(args: JsonObject, key: string, fallback?: bigint): bigint {
  const raw = args[key] === undefined ? fallback : args[key];
  if (raw === undefined || raw === null || !/^\d+$/u.test(String(raw))) throw new DomainError('OPERATION_ARGUMENT_INVALID', `${key} must be a non-negative integer`, 422, 'DO_NOT_RETRY', { key });
  return BigInt(String(raw));
}

function requireIsoDeadline(args: JsonObject, key: string, fallbackSeconds: number): string {
  const value = args[key] === undefined ? new Date(Date.now() + fallbackSeconds * 1000).toISOString() : requireString(args, key);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) throw new DomainError('BROWSER_DEADLINE_INVALID', `${key} must be a future ISO timestamp`, 422, 'DO_NOT_RETRY');
  return date.toISOString();
}

function requireOpaqueArtifactHandle(value: unknown, key: string): string {
  if (typeof value !== 'string' || !/^(?:artifact|upload|download):[a-f0-9-]{36}$/iu.test(value)) throw new DomainError('BROWSER_ARTIFACT_HANDLE_INVALID', `${key} must be an opaque artifact handle`, 422, 'DO_NOT_RETRY', { key });
  return value;
}

function browserSessionStateError(lifecycle: unknown): DomainError {
  return new DomainError('BROWSER_SESSION_TERMINAL', `Browser session is not mutable in lifecycle ${String(lifecycle)}`, 409, 'RECONCILE_THEN_RETRY');
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
  if (operation.operationFamily === 'BROWSER') rejectArbitraryBrowserPath(args);
  const name = operation.operationName;
  if (operation.sideEffectClass === 'READ_ONLY' || operation.exposureClass === 'OWNER_QUERY') return;

  switch (name) {
    case 'component.register':
    case 'generation.job.create':
    case 'browser.session.create':
    case 'browser.upload.create':
    case 'browser.download.started':
    case 'browser.artifact.created':
    case 'browser.challenge.required':
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
    if (args.targetReferenceId !== undefined && args.targetReferenceId !== null) requireUuid(args, 'targetReferenceId');
  }
  if (name === 'browser.upload.create') {
    requireUuid(args, 'sessionId');
    requireUuid(args, 'artifactId');
    if (args.contentDigest !== undefined) requireDigest(args, 'contentDigest');
    if (args.sizeBytes !== undefined) requireNonNegativeInteger(args, 'sizeBytes');
  }
  if (name === 'browser.download.started') {
    requireUuid(args, 'sessionId');
    if (targetId === null) requireUuid(args, 'downloadId');
    if (args.downloadId !== undefined) requireUuid(args, 'downloadId');
    if (args.tempHandle !== undefined) requireOpaqueArtifactHandle(args.tempHandle, 'tempHandle');
  }
  if (name === 'browser.download.persist') {
    requireUuid(args, 'artifactId');
    requireDigest(args, 'contentDigest');
    requireNonNegativeInteger(args, 'sizeBytes');
  }
  if (name === 'browser.artifact.created') {
    requireUuid(args, 'sessionId');
    if (args.artifactId !== undefined) requireUuid(args, 'artifactId');
    requireDigest(args, 'artifactDigest');
    requireNonNegativeInteger(args, 'sizeBytes');
    requireSafeName(args, 'safeName', 'artifact.bin');
    const reference = requireString(args, 'storageReference');
    if (!/^artifact:sha256:[a-f0-9]{64}$/iu.test(reference)) throw new DomainError('BROWSER_ARTIFACT_HANDLE_INVALID', 'storageReference must be content addressed', 422, 'DO_NOT_RETRY');
  }
  if (name === 'browser.challenge.required') {
    requireUuid(args, 'sessionId');
    const challengeType = requireString(args, 'challengeType');
    if (!browserChallengeTypes.includes(challengeType as typeof browserChallengeTypes[number])) throw new DomainError('BROWSER_CHALLENGE_TYPE_INVALID', 'Challenge type is not supported by the Browser Interaction Plane', 422, 'DO_NOT_RETRY');
    requireDigest(args, 'pendingActionDigest');
    requireNonNegativeInteger(args, 'controlEpoch');
    requireIsoDeadline(args, 'deadlineAt', 300);
    requireIsoDeadline(args, 'expiresAt', 300);
    requireString(args, 'safePrompt');
  }
  if (name === 'browser.challenge.resolve') {
    if (args.responseDigest !== undefined) requireDigest(args, 'responseDigest');
    if (args.controlEpoch !== undefined) requireNonNegativeInteger(args, 'controlEpoch');
    if (args.ownerResponseId !== undefined) requireUuid(args, 'ownerResponseId');
    if (args.bridgeResponseId !== undefined) requireUuid(args, 'bridgeResponseId');
  }
  if (name === 'browser.control.transfer') {
    const holder = requireString(args, 'holder');
    if (!['AI', 'OWNER', 'AUTOMATION'].includes(holder)) throw new DomainError('BROWSER_CONTROL_HOLDER_INVALID', 'Browser control holder is invalid', 422, 'DO_NOT_RETRY');
    requireNonNegativeInteger(args, 'expectedControlEpoch');
    if (args.ttlSeconds !== undefined && (Number(args.ttlSeconds) < 1 || Number(args.ttlSeconds) > 900)) throw new DomainError('BROWSER_CONTROL_TTL_INVALID', 'Control lease TTL must be between 1 and 900 seconds', 422, 'DO_NOT_RETRY');
  }
  if (['browser.action.dispatchPhase', 'browser.action.reconcile', 'browser.action.resolveOutcome'].includes(name)) {
    if (name === 'browser.action.dispatchPhase') {
      const phase = args.phase;
      if (typeof phase !== 'string' || !browserDispatchPhaseOrder.has(phase as BrowserDispatchPhase)) throw new DomainError('BROWSER_DISPATCH_PHASE_INVALID', 'Browser dispatch phase is not in the canonical phase set', 422, 'DO_NOT_RETRY', { phase });
      if (args.evidence === undefined || typeof args.evidence !== 'object' || args.evidence === null) throw new DomainError('BROWSER_DISPATCH_EVIDENCE_REQUIRED', 'Every browser dispatch phase requires typed adapter evidence', 422, 'DO_NOT_RETRY');
    }
    if (['browser.action.reconcile', 'browser.action.resolveOutcome'].includes(name)) {
      if (!['CONFIRMED_APPLIED', 'CONFIRMED_NOT_APPLIED', 'UNKNOWN'].includes(String(args.outcome))) throw new DomainError('BROWSER_RECONCILIATION_OUTCOME_INVALID', 'Reconciliation outcome must be independently classified', 422, 'DO_NOT_RETRY');
      if (!args.readBack || typeof args.readBack !== 'object' || args.readBack === null) throw new DomainError('BROWSER_READBACK_REQUIRED', 'Independent read-back evidence is required before resolving a browser action', 422, 'DO_NOT_RETRY');
    }
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
  const sessionFor = async (sessionId: string, lock = true): Promise<Record<string, any>> => {
    const row = (await _client.query(`SELECT * FROM kcml.browser_session WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [sessionId])).rows[0];
    if (!row) throw new DomainError('BROWSER_SESSION_NOT_FOUND', 'Browser session does not exist', 404, 'DO_NOT_RETRY');
    if (['CLOSED', 'FAILED', 'EXPIRED', 'MANUAL_REVIEW'].includes(String(row.lifecycle))) throw browserSessionStateError(row.lifecycle);
    return row;
  };
  const expectedVersion = context.expectedStateVersion;
  const checkVersion = (row: Record<string, any>) => {
    if (expectedVersion !== null && BigInt(String(row.state_version)) !== expectedVersion) throw new DomainError('STATE_VERSION_CONFLICT', 'Browser state changed', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
  };

  if (name === 'browser.cleanup.resume') {
    const id = requireTarget(context);
    const session = (await _client.query(`SELECT * FROM kcml.browser_session WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!session) throw new DomainError('BROWSER_SESSION_NOT_FOUND', 'Browser session does not exist', 404, 'DO_NOT_RETRY');
    checkVersion(session);
    await _client.query(`UPDATE kcml.browser_upload_handle SET lifecycle='CLEANED',cleanup_at=coalesce(cleanup_at,clock_timestamp()),state_version=state_version+1,updated_at=clock_timestamp() WHERE session_id=$1 AND cleanup_at IS NULL AND (consumed_at IS NOT NULL OR expires_at<=clock_timestamp())`, [id]);
    await _client.query(`UPDATE kcml.browser_download SET cleanup_state='CLEANED',state_version=state_version+1,updated_at=clock_timestamp() WHERE session_id=$1 AND state='COMPLETED' AND cleanup_state IN ('PENDING','RETAINED')`, [id]);
    await _client.query(`UPDATE kcml.browser_challenge SET status='CANCELLED',resolved_at=coalesce(resolved_at,clock_timestamp()),state_version=state_version+1,updated_at=clock_timestamp() WHERE session_id=$1 AND status='PENDING'`, [id]);
    await _client.query(`UPDATE kcml.browser_automation_artifact SET cleanup_state='REMOVED',deleted_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp() WHERE session_id=$1 AND cleanup_state NOT IN ('REMOVED','FAILED')`, [id]);
    const pending = (await _client.query(`SELECT
      (SELECT count(*) FROM kcml.browser_upload_handle WHERE session_id=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp()) AS uploads,
      (SELECT count(*) FROM kcml.browser_download WHERE session_id=$1 AND state IN ('STARTED','STREAMING')) AS downloads,
      (SELECT count(*) FROM kcml.browser_action_run WHERE session_id=$1 AND dispatch_phase NOT IN ('CONFIRMED_APPLIED','CONFIRMED_NOT_APPLIED','FAILED_FINAL')) AS actions,
      (SELECT count(*) FROM kcml.browser_challenge WHERE session_id=$1 AND status='PENDING') AS challenges,
      (SELECT count(*) FROM kcml.browser_automation_artifact WHERE session_id=$1 AND cleanup_state NOT IN ('REMOVED','FAILED')) AS artifacts`, [id])).rows[0];
    const counts = Object.fromEntries(Object.entries(pending ?? {}).map(([key, value]) => [key, Number(value)]));
    const pendingCount = Object.values(counts).reduce((sum, value) => sum + value, 0);
    if (pendingCount > 0) throw new DomainError('BROWSER_CLEANUP_INCOMPLETE', 'Browser session cannot close while owned resources remain pending', 409, 'RECONCILE_THEN_RETRY', { counts });
    const updated = (await _client.query(`UPDATE kcml.browser_session SET lifecycle='CLOSED',control_holder='NONE',control_expires_at=NULL,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state_version=$2 AND lifecycle IN ('CLOSING','READY','PAUSED','RECOVERING') RETURNING *`, [id, session.state_version])).rows[0];
    if (!updated) throw new DomainError('BROWSER_CLEANUP_STATE_INVALID', `Browser session cannot close from ${session.lifecycle}`, 409, 'RECONCILE_THEN_RETRY');
    return { operation: name, session: updated, closure: { complete: true, counts }, state_version: updated.state_version };
  }

  if (['browser.session.attach', 'browser.session.pause', 'browser.session.resume', 'browser.session.close', 'browser.session.recover'].includes(name)) {
    const id = requireTarget(context);
    const current = (await _client.query(`SELECT * FROM kcml.browser_session WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!current) throw new DomainError('BROWSER_SESSION_NOT_FOUND', 'Browser session does not exist', 404, 'DO_NOT_RETRY');
    if (context.expectedStateVersion !== null && BigInt(String(current.state_version)) !== context.expectedStateVersion) throw new DomainError('STATE_VERSION_CONFLICT', 'Browser session state changed', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    const transitions: Record<string, { from: string[]; to: string; holder?: string }> = {
      'browser.session.attach': { from: ['CREATING', 'READY', 'RECOVERING'], to: 'ACTIVE', holder: 'AI' },
      'browser.session.pause': { from: ['ACTIVE', 'READY'], to: 'PAUSED', holder: 'NONE' },
      'browser.session.resume': { from: ['PAUSED', 'RECOVERING', 'READY'], to: 'ACTIVE', holder: 'AI' },
      'browser.session.close': { from: ['CREATING', 'READY', 'ACTIVE', 'PAUSED', 'CHALLENGE_REQUIRED', 'RECOVERING', 'CLOSING'], to: 'CLOSING', holder: 'NONE' },
      'browser.session.recover': { from: ['FAILED', 'RECOVERING', 'CLOSING'], to: 'RECOVERING', holder: 'NONE' }
    };
    const transition = transitions[name];
    if (!transition) return exactFamilyRejection('BROWSER', context);
    if (!transition.from.includes(String(current.lifecycle))) throw new DomainError('BROWSER_SESSION_STATE_INVALID', `Cannot apply ${name} from ${current.lifecycle}`, 409, 'RECONCILE_THEN_RETRY');
    const updated = (await _client.query(`UPDATE kcml.browser_session SET lifecycle=$2,control_holder=$3,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state_version=$4 RETURNING *`, [id, transition.to, transition.holder ?? current.control_holder, current.state_version])).rows[0];
    if (!updated) throw new DomainError('STATE_VERSION_CONFLICT', 'Browser session changed during transition', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    return { operation: name, session: updated, transition: { from: current.lifecycle, to: transition.to }, state_version: updated.state_version };
  }

  if (name === 'browser.artifact.created') {
    const session = await sessionFor(requireUuid(context.arguments, 'sessionId'));
    const artifactDigest = requireDigest(context.arguments, 'artifactDigest');
    const size = requireNonNegativeInteger(context.arguments, 'sizeBytes');
    const safeName = requireSafeName(context.arguments, 'safeName', 'artifact.bin');
    const storageReference = requireString(context.arguments, 'storageReference');
    if (!/^artifact:sha256:[a-f0-9]{64}$/iu.test(storageReference)) throw new DomainError('BROWSER_ARTIFACT_HANDLE_INVALID', 'storageReference must be content addressed', 422, 'DO_NOT_RETRY');
    const row = (await _client.query(`INSERT INTO kcml.browser_automation_artifact(id,session_id,automation_run_id,step_id,action_run_id,artifact_type,storage_reference,page_id,frame_id,document_id,mime_type,size_bytes,artifact_digest,safe_name,source_origin,sensitivity,retention_state,scan_state,cleanup_state,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'RETAIN_UNTIL_OWNER_POLICY','VERIFIED','AVAILABLE',$17,$18,$19,$20,$21,$22) RETURNING *`, [
      context.arguments.artifactId ?? randomUUID(), session.id, context.arguments.automationRunId ?? null, context.arguments.stepId ?? null, context.arguments.actionRunId ?? null,
      requireString(context.arguments, 'artifactType'), storageReference, context.arguments.pageId ?? null, context.arguments.frameId ?? null, context.arguments.documentId ?? null,
      context.arguments.mimeType ?? null, size.toString(), artifactDigest, safeName, context.arguments.sourceOrigin ?? null, context.arguments.sensitivity ?? 'NORMAL',
      digest({ storageReference, artifactDigest: `sha256:${artifactDigest.toString('hex')}`, size: size.toString(), safeName }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
    ])).rows[0];
    return { operation: name, artifact: row, state_version: row.state_version, evidence: { contentAddressed: true, size: size.toString(), digest: `sha256:${artifactDigest.toString('hex')}` } };
  }

  if (name === 'browser.upload.create') {
    const session = await sessionFor(requireUuid(context.arguments, 'sessionId'));
    const artifactId = requireUuid(context.arguments, 'artifactId');
    const artifact = (await _client.query(`SELECT * FROM kcml.browser_automation_artifact WHERE id=$1 AND session_id=$2 AND cleanup_state NOT IN ('REMOVED','FAILED')`, [artifactId, session.id])).rows[0];
    if (!artifact) throw new DomainError('BROWSER_ARTIFACT_NOT_FOUND', 'Upload artifact is not owned by this browser session', 404, 'DO_NOT_RETRY');
    const suppliedDigest = context.arguments.contentDigest ? requireDigest(context.arguments, 'contentDigest') : Buffer.from(artifact.artifact_digest);
    if (!suppliedDigest.equals(Buffer.from(artifact.artifact_digest))) throw new DomainError('BROWSER_ARTIFACT_INVALID', 'Upload digest does not match the persisted artifact', 409, 'DO_NOT_RETRY');
    const size = context.arguments.sizeBytes === undefined ? BigInt(String(artifact.size_bytes)) : requireNonNegativeInteger(context.arguments, 'sizeBytes');
    if (size !== BigInt(String(artifact.size_bytes))) throw new DomainError('BROWSER_ARTIFACT_INVALID', 'Upload size does not match the persisted artifact', 409, 'DO_NOT_RETRY');
    const expiresAt = requireIsoDeadline(context.arguments, 'expiresAt', 300);
    const row = (await _client.query(`INSERT INTO kcml.browser_upload_handle(id,session_id,run_id,step_id,artifact_id,safe_name,mime_type,extension,size_bytes,content_digest,sensitivity,target_policy,file_count_policy,directory_policy,expires_at,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`, [
      context.arguments.uploadId ?? randomUUID(), session.id, context.arguments.runId ?? null, context.arguments.stepId ?? null, artifactId,
      requireSafeName(context.arguments, 'safeName', String(artifact.safe_name)), context.arguments.mimeType ?? artifact.mime_type ?? null, context.arguments.extension ?? null,
      size.toString(), suppliedDigest, artifact.sensitivity ?? 'NORMAL', context.arguments.targetPolicy ?? {}, Number(context.arguments.fileCountPolicy ?? 1), context.arguments.directoryPolicy ?? 'DENY', expiresAt,
      digest({ artifactId, size: size.toString(), contentDigest: suppliedDigest.toString('hex'), expiresAt }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
    ])).rows[0];
    return { operation: name, upload: row, state_version: row.state_version, evidence: { artifactId, digest: `sha256:${suppliedDigest.toString('hex')}`, size: size.toString(), expiresAt } };
  }

  if (name === 'browser.upload.consume') {
    const id = requireTarget(context);
    const current = (await _client.query(`SELECT * FROM kcml.browser_upload_handle WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!current) throw new DomainError('BROWSER_UPLOAD_HANDLE_INVALID', 'Upload handle does not exist', 404, 'DO_NOT_RETRY');
    if (current.consumed_at || current.lifecycle === 'CONSUMED') return { operation: name, upload: current, duplicate: true, state_version: current.state_version };
    if (new Date(current.expires_at).getTime() <= Date.now()) throw new DomainError('BROWSER_UPLOAD_HANDLE_INVALID', 'Upload handle has expired', 409, 'DO_NOT_RETRY');
    checkVersion(current);
    const session = await sessionFor(String(current.session_id));
    if (context.arguments.sessionId && String(context.arguments.sessionId) !== String(session.id)) throw new DomainError('BROWSER_SESSION_MISMATCH', 'Upload handle belongs to a different browser session', 409, 'DO_NOT_RETRY');
    const row = (await _client.query(`UPDATE kcml.browser_upload_handle SET lifecycle='CONSUMED',consumed_at=clock_timestamp(),cleanup_at=clock_timestamp()+interval '5 minutes',state_version=state_version+1,updated_at=clock_timestamp(),canonical_digest=$2 WHERE id=$1 AND consumed_at IS NULL AND state_version=$3 RETURNING *`, [id, digest({ id, operation: name, chooserEvidence: context.arguments.chooserEvidence ?? null }), current.state_version])).rows[0];
    if (!row) throw new DomainError('STATE_VERSION_CONFLICT', 'Upload handle changed during consume', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    return { operation: name, upload: row, consumed: true, state_version: row.state_version };
  }

  if (name === 'browser.download.started') {
    const session = await sessionFor(requireUuid(context.arguments, 'sessionId'));
    const id = context.targetId ?? (context.arguments.downloadId as string | undefined) ?? randomUUID();
    if (context.arguments.downloadId && String(context.arguments.downloadId) !== id) throw new DomainError('BROWSER_DOWNLOAD_ID_CONFLICT', 'downloadId does not match targetId', 422, 'DO_NOT_RETRY');
    const sourceUrl = context.arguments.sourceUrl ? requireString(context.arguments, 'sourceUrl') : null;
    let sourceOrigin = context.arguments.sourceOrigin ? requireString(context.arguments, 'sourceOrigin') : null;
    if (sourceUrl) {
      let parsedUrl: URL;
      try { parsedUrl = new URL(sourceUrl); } catch { throw new DomainError('BROWSER_URL_INVALID', 'Download source URL must be an absolute URL', 422, 'DO_NOT_RETRY'); }
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new DomainError('BROWSER_URL_INVALID', 'Download source URL must use HTTP(S)', 422, 'DO_NOT_RETRY');
      sourceOrigin ??= parsedUrl.origin;
      if (sourceOrigin !== parsedUrl.origin) throw new DomainError('BROWSER_ORIGIN_MISMATCH', 'Download source origin does not match its URL', 422, 'DO_NOT_RETRY');
    }
    const row = (await _client.query(`INSERT INTO kcml.browser_download(id,session_id,run_id,step_id,action_id,source_origin,source_url,url_kind,event_sequence,suggested_name,safe_name,mime_type,expected_size_bytes,state,temp_path_handle,cleanup_state,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'STARTED',$14,'RETAINED',$15,$16,$17,$18,$19,$20) RETURNING *`, [
      id, session.id, context.arguments.runId ?? null, context.arguments.stepId ?? null, context.arguments.actionId ?? null, sourceOrigin, sourceUrl, context.arguments.urlKind ?? 'HTTP',
      Number(context.arguments.eventSequence ?? 0), context.arguments.suggestedName ? requireSafeName(context.arguments, 'suggestedName', 'download.bin') : null, context.arguments.safeName ? requireSafeName(context.arguments, 'safeName', 'download.bin') : null,
      context.arguments.mimeType ?? null, context.arguments.expectedSizeBytes === undefined ? null : requireNonNegativeInteger(context.arguments, 'expectedSizeBytes').toString(), context.arguments.tempHandle ?? null,
      digest({ id, sourceOrigin, sourceUrl, eventSequence: context.arguments.eventSequence ?? 0 }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
    ])).rows[0];
    return { operation: name, download: row, state_version: row.state_version, evidence: { state: 'STARTED', sourceOrigin, sourceUrl } };
  }

  if (name === 'browser.download.persist') {
    const id = requireTarget(context);
    const current = (await _client.query(`SELECT * FROM kcml.browser_download WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!current) throw new DomainError('BROWSER_DOWNLOAD_NOT_FOUND', 'Browser download does not exist', 404, 'DO_NOT_RETRY');
    if (current.state === 'COMPLETED') return { operation: name, download: current, duplicate: true, state_version: current.state_version };
    if (!['STARTED', 'STREAMING'].includes(String(current.state))) throw new DomainError('BROWSER_DOWNLOAD_INCOMPLETE', `Download cannot be persisted from ${current.state}`, 409, 'RECONCILE_THEN_RETRY');
    checkVersion(current);
    const digestValue = requireDigest(context.arguments, 'contentDigest');
    const size = requireNonNegativeInteger(context.arguments, 'sizeBytes');
    if (current.expected_size_bytes !== null && BigInt(String(current.expected_size_bytes)) !== size) throw new DomainError('BROWSER_ARTIFACT_INVALID', 'Download size differs from the declared expected size', 409, 'DO_NOT_RETRY');
    const artifactId = requireUuid(context.arguments, 'artifactId');
    const artifact = (await _client.query(`SELECT artifact_digest,size_bytes,session_id,storage_reference FROM kcml.browser_automation_artifact WHERE id=$1`, [artifactId])).rows[0];
    if (!artifact || String(artifact.session_id) !== String(current.session_id) || !Buffer.from(artifact.artifact_digest).equals(digestValue) || BigInt(String(artifact.size_bytes)) !== size || !/^artifact:sha256:[a-f0-9]{64}$/iu.test(String(artifact.storage_reference))) throw new DomainError('BROWSER_ARTIFACT_INVALID', 'Download artifact evidence does not match the completed bytes', 409, 'DO_NOT_RETRY');
    const row = (await _client.query(`UPDATE kcml.browser_download SET state='COMPLETED',artifact_id=$2,size_bytes=$3,content_digest=$4,content_verification=$5,cleanup_state='PENDING',state_version=state_version+1,updated_at=clock_timestamp(),canonical_digest=$6 WHERE id=$1 AND state_version=$7 RETURNING *`, [id, artifactId, size.toString(), digestValue, { independentReadBack: context.arguments.readBack ?? null, verified: true }, digest({ id, artifactId, size: size.toString(), digest: digestValue.toString('hex') }), current.state_version])).rows[0];
    if (!row) throw new DomainError('STATE_VERSION_CONFLICT', 'Download changed during persistence', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    return { operation: name, download: row, state_version: row.state_version, evidence: { completed: true, artifactId, digest: `sha256:${digestValue.toString('hex')}`, size: size.toString() } };
  }

  if (name === 'browser.challenge.required') {
    const session = await sessionFor(requireUuid(context.arguments, 'sessionId'));
    const deadlineAt = requireIsoDeadline(context.arguments, 'deadlineAt', 300);
    const expiresAt = requireIsoDeadline(context.arguments, 'expiresAt', 300);
    const id = context.targetId ?? randomUUID();
    const row = (await _client.query(`INSERT INTO kcml.browser_challenge(id,session_id,automation_run_id,step_id,challenge_type,status,page_id,frame_id,document_id,origin,relying_party,account_binding_id,pending_action_digest,auth_epoch,control_epoch,deadline_at,safe_prompt,allowed_resolution_methods,expires_at,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
      VALUES($1,$2,$3,$4,$5,'PENDING',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING *`, [
      id, session.id, context.arguments.automationRunId ?? null, context.arguments.stepId ?? null, requireString(context.arguments, 'challengeType'), context.arguments.pageId ?? null, context.arguments.frameId ?? null, context.arguments.documentId ?? null,
      context.arguments.origin ?? null, context.arguments.relyingParty ?? null, context.arguments.accountBindingId ?? null, requireDigest(context.arguments, 'pendingActionDigest'), context.arguments.authEpoch === undefined ? null : requireNonNegativeInteger(context.arguments, 'authEpoch').toString(), requireNonNegativeInteger(context.arguments, 'controlEpoch').toString(), deadlineAt,
      requireString(context.arguments, 'safePrompt'), Array.isArray(context.arguments.allowedResolutionMethods) ? context.arguments.allowedResolutionMethods.map(String) : [], expiresAt, digest({ id, type: context.arguments.challengeType, pendingActionDigest: context.arguments.pendingActionDigest, deadlineAt, expiresAt }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()
    ])).rows[0];
    await _client.query(`UPDATE kcml.browser_session SET lifecycle='CHALLENGE_REQUIRED',state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND lifecycle NOT IN ('CLOSED','FAILED','EXPIRED')`, [session.id]);
    return { operation: name, challenge: row, state_version: row.state_version, evidence: { persisted: true, status: 'PENDING', challengeType: row.challenge_type } };
  }

  if (name === 'browser.challenge.resolve') {
    const id = requireTarget(context);
    const current = (await _client.query(`SELECT * FROM kcml.browser_challenge WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!current) throw new DomainError('BROWSER_CHALLENGE_NOT_FOUND', 'Browser challenge does not exist', 404, 'DO_NOT_RETRY');
    const submittedResponse = context.arguments.response ?? context.arguments.assertion ?? context.arguments.registration ?? {};
    const submittedResponseDigest = context.arguments.responseDigest ? requireDigest(context.arguments, 'responseDigest') : digest(submittedResponse);
    if (current.status === 'RESOLVED') {
      if (current.consume_digest && !Buffer.from(current.consume_digest).equals(submittedResponseDigest)) throw new DomainError('BROWSER_CHALLENGE_DUPLICATE_CONFLICT', 'A resolved challenge cannot be consumed with a different response', 409, 'DO_NOT_RETRY');
      return { operation: name, challenge: current, duplicate: true, state_version: current.state_version };
    }
    if (current.status !== 'PENDING') throw new DomainError('BROWSER_CHALLENGE_STALE', `Challenge is ${current.status}`, 409, 'RECONCILE_THEN_RETRY');
    if (new Date(current.expires_at).getTime() <= Date.now() || new Date(current.deadline_at).getTime() <= Date.now()) {
      await _client.query(`UPDATE kcml.browser_challenge SET status='EXPIRED',state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND status='PENDING'`, [id]);
      throw new DomainError('BROWSER_CHALLENGE_STALE', 'Challenge has expired', 409, 'DO_NOT_RETRY');
    }
    if (context.arguments.controlEpoch !== undefined && requireNonNegativeInteger(context.arguments, 'controlEpoch') !== BigInt(String(current.control_epoch))) throw new DomainError('BROWSER_CHALLENGE_STALE', 'Challenge control epoch is stale', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    checkVersion(current);
    if (current.challenge_type === 'WEBAUTHN_ASSERTION' && (!context.arguments.assertion || context.arguments.registration)) throw new DomainError('BROWSER_CHALLENGE_RESPONSE_INVALID', 'A WebAuthn assertion challenge requires an assertion response and cannot consume registration data', 422, 'DO_NOT_RETRY');
    if (current.challenge_type === 'WEBAUTHN_REGISTRATION' && (!context.arguments.registration || context.arguments.assertion)) throw new DomainError('BROWSER_CHALLENGE_RESPONSE_INVALID', 'A WebAuthn registration challenge requires registration response data and cannot consume an assertion', 422, 'DO_NOT_RETRY');
    if (current.challenge_type === 'PASSKEY' && !context.arguments.bridgeResponseId) throw new DomainError('BROWSER_PASSKEY_BRIDGE_REQUIRED', 'A passkey resolution must be acknowledged by the current OWNER Device Bridge', 422, 'DO_NOT_RETRY');
    const responseDigest = submittedResponseDigest;
    const row = (await _client.query(`UPDATE kcml.browser_challenge SET status='RESOLVED',resolved_at=clock_timestamp(),owner_response_id=$2,bridge_response_id=$3,consume_digest=$4,state_version=state_version+1,updated_at=clock_timestamp(),canonical_digest=$5 WHERE id=$1 AND status='PENDING' AND state_version=$6 RETURNING *`, [id, context.arguments.ownerResponseId ?? null, context.arguments.bridgeResponseId ?? null, responseDigest, digest({ id, responseDigest: responseDigest.toString('hex'), method: context.arguments.resolutionMethod ?? null }), current.state_version])).rows[0];
    if (!row) throw new DomainError('STATE_VERSION_CONFLICT', 'Challenge changed during resolution', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    await _client.query(`UPDATE kcml.browser_session SET lifecycle=CASE WHEN lifecycle='CHALLENGE_REQUIRED' THEN 'READY' ELSE lifecycle END,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`, [current.session_id]);
    return { operation: name, challenge: row, state_version: row.state_version, evidence: { resolved: true, responseDigest: `sha256:${responseDigest.toString('hex')}`, requiresFreshObservation: true } };
  }

  if (name === 'browser.page.observed') {
    const session = await sessionFor(requireTarget(context));
    const observation = context.arguments.observation && typeof context.arguments.observation === 'object' ? context.arguments.observation as JsonObject : context.arguments;
    const observationId = requireUuid(observation, 'observationId');
    const revision = requireNonNegativeInteger(observation, 'observationRevision');
    const contextGeneration = requireNonNegativeInteger(observation, 'contextGeneration');
    const pageId = requireUuid(observation, 'pageId');
    const frameId = requireUuid(observation, 'frameId');
    const documentEpoch = requireNonNegativeInteger(observation, 'documentEpoch');
    const url = requireString(observation, 'url');
    try { if (new URL(url).protocol !== 'http:' && new URL(url).protocol !== 'https:') throw new Error('scheme'); } catch { throw new DomainError('BROWSER_URL_INVALID', 'Browser observation URL must be an HTTP(S) URL', 422, 'DO_NOT_RETRY'); }
    if (contextGeneration !== BigInt(String(session.context_generation)) || documentEpoch < BigInt(String(session.document_epoch)) || revision <= BigInt(String(session.observation_revision))) throw new DomainError('BROWSER_OBSERVATION_FENCE_INVALID', 'Browser observation is stale or regressed', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    const digestValue = requireDigest(observation, 'digest');
    const row = (await _client.query(`INSERT INTO kcml.browser_observation(id,session_id,observation_revision,context_generation,page_id,page_generation,frame_id,document_epoch,url,title,semantic_snapshot,screenshot_artifact_id,network_summary,console_summary,canonical_digest,observed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`, [observationId, session.id, revision.toString(), contextGeneration.toString(), pageId, requireNonNegativeInteger(observation, 'pageGeneration').toString(), frameId, documentEpoch.toString(), url, requireString(observation, 'title'), observation.semanticSnapshot ?? {}, observation.screenshotArtifactId ?? null, observation.networkSummary ?? {}, observation.consoleSummary ?? {}, digestValue, observation.observedAt ?? new Date().toISOString()])).rows[0];
    const updated = (await _client.query(`UPDATE kcml.browser_session SET current_url=$2,current_page_id=$3,current_frame_id=$4,document_epoch=$5,observation_revision=$6,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state_version=$7 RETURNING *`, [session.id, url, pageId, frameId, documentEpoch.toString(), revision.toString(), session.state_version])).rows[0];
    if (!updated) throw new DomainError('STATE_VERSION_CONFLICT', 'Browser session changed while committing observation', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    return { operation: name, observation: row, session: updated, state_version: updated.state_version, evidence: { persisted: true, observationRevision: revision.toString() } };
  }

  if (name === 'browser.control.transfer') {
    const id = requireTarget(context);
    const current = await sessionFor(id);
    const expected = requireNonNegativeInteger(context.arguments, 'expectedControlEpoch');
    if (expected !== BigInt(String(current.control_epoch))) throw new DomainError('BROWSER_CONTROL_STALE', 'Browser control epoch is stale', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    const holder = requireString(context.arguments, 'holder');
    const ttlSeconds = Math.max(1, Math.min(900, Number(context.arguments.ttlSeconds ?? 300)));
    const updated = (await _client.query(`UPDATE kcml.browser_session SET control_holder=$2,control_epoch=control_epoch+1,control_fence=control_fence+1,control_expires_at=clock_timestamp()+make_interval(secs=>$4),lifecycle=CASE WHEN lifecycle IN ('READY','PAUSED') THEN 'ACTIVE' ELSE lifecycle END,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND control_epoch=$3 RETURNING *`, [id, holder, expected.toString(), ttlSeconds])).rows[0];
    if (!updated) throw new DomainError('BROWSER_CONTROL_STALE', 'Browser control changed during transfer', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    return { operation: name, session: updated, transition: { from: current.control_holder, to: holder }, state_version: updated.state_version };
  }

  if (name === 'browser.action.start') {
    const sessionId = requireUuid(context.arguments, 'sessionId');
    const action = requireString(context.arguments, 'action');
    const session = await sessionFor(sessionId);
    for (const [key, column] of [['expectedControlEpoch', 'control_epoch'], ['expectedDocumentEpoch', 'document_epoch'], ['expectedObservationRevision', 'observation_revision']] as const) {
      if (context.arguments[key] !== undefined && requireNonNegativeInteger(context.arguments, key) !== BigInt(String(session[column]))) throw new DomainError('BROWSER_FENCE_CONFLICT', `Browser ${key} does not match the current session fence`, 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    }
    if (!['AI', 'OWNER', 'AUTOMATION'].includes(String(session.control_holder))) throw new DomainError('BROWSER_CONTROL_UNAVAILABLE', 'Browser session has no active control holder', 409, 'RECONCILE_THEN_RETRY');
    const targetReferenceId = context.arguments.targetReferenceId === undefined || context.arguments.targetReferenceId === null ? null : requireUuid(context.arguments, 'targetReferenceId');
    if (targetReferenceId) {
      const target = (await _client.query(`SELECT * FROM kcml.browser_target_reference WHERE id=$1 AND session_id=$2`, [targetReferenceId, session.id])).rows[0];
      if (!target) throw new DomainError('BROWSER_TARGET_NOT_FOUND', 'Target reference does not belong to the browser session', 404, 'DO_NOT_RETRY');
      if (BigInt(String(target.document_epoch)) !== BigInt(String(session.document_epoch)) || String(target.page_id) !== String(session.current_page_id) || String(target.frame_id) !== String(session.current_frame_id)) throw new DomainError('BROWSER_TARGET_STALE', 'Target reference belongs to a stale page or document fence', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    }
    const row = (await _client.query(`INSERT INTO kcml.browser_action_run(session_id,logical_operation_id,action,target_reference_id,payload,expected_control_epoch,expected_document_epoch,expected_observation_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [sessionId, context.logicalOperationId, action, targetReferenceId, context.arguments.payload ?? {}, Number(context.arguments.expectedControlEpoch ?? session.control_epoch ?? 0), Number(context.arguments.expectedDocumentEpoch ?? session.document_epoch ?? 0), Number(context.arguments.expectedObservationRevision ?? session.observation_revision ?? 0)])).rows[0];
    await _client.query(`INSERT INTO kcml.browser_action_attempt(action_run_id,attempt,command_id,action_fence,browser_identity_snapshot,resolved_target_candidates,actionability_evidence,input_strategy,prearmed_waiters,evidence,started_at,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
      VALUES($1,1,$2,$3,$4,'[]'::jsonb,'{}'::jsonb,$5,'{}'::jsonb,'{}'::jsonb,clock_timestamp(),$6,$7,$8,$9,$10,$11)`, [row.id, context.commandId ?? context.logicalOperationId, session.control_fence, { sessionId, contextGeneration: String(session.context_generation), pageId: session.current_page_id, frameId: session.current_frame_id, documentEpoch: String(session.document_epoch), controlEpoch: String(session.control_epoch), observationRevision: String(session.observation_revision) }, context.arguments.inputStrategy ?? action, digest({ actionId: row.id, attempt: 1, commandId: context.commandId ?? context.logicalOperationId }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()]);
    return { operation: name, action: row, state_version: row.state_version };
  }

  if (name === 'browser.action.dispatchPhase') {
    const id = requireTarget(context);
    const action = (await _client.query(`SELECT * FROM kcml.browser_action_run WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!action) throw new DomainError('BROWSER_ACTION_NOT_FOUND', 'Browser action does not exist', 404, 'DO_NOT_RETRY');
    checkVersion(action);
    const phase = String(context.arguments.phase) as BrowserDispatchPhase;
    if (!browserDispatchPhaseOrder.has(phase)) throw new DomainError('BROWSER_DISPATCH_PHASE_INVALID', 'Browser dispatch phase is not in the canonical phase set', 422, 'DO_NOT_RETRY', { phase });
    if (!context.arguments.evidence || typeof context.arguments.evidence !== 'object') throw new DomainError('BROWSER_DISPATCH_EVIDENCE_REQUIRED', 'Every browser dispatch phase requires typed adapter evidence', 422, 'DO_NOT_RETRY');
    const attempt = (await _client.query(`SELECT * FROM kcml.browser_action_attempt WHERE action_run_id=$1 ORDER BY attempt DESC LIMIT 1 FOR UPDATE`, [id])).rows[0];
    if (!attempt) throw new DomainError('BROWSER_ACTION_ATTEMPT_MISSING', 'Browser action has no persisted attempt', 409, 'RECONCILE_THEN_RETRY');
    const last = (await _client.query(`SELECT phase,phase_sequence FROM kcml.browser_action_dispatch_event WHERE action_attempt_id=$1 ORDER BY phase_sequence DESC LIMIT 1`, [attempt.id])).rows[0];
    if (last && browserDispatchPhaseOrder.get(phase)! < browserDispatchPhaseOrder.get(String(last.phase) as BrowserDispatchPhase)!) throw new DomainError('BROWSER_DISPATCH_PHASE_REGRESSION', 'Browser dispatch phase is not monotonic', 409, 'MANUAL_REVIEW');
    if (last?.phase === phase) return { operation: name, action, duplicate: true, phase, state_version: action.state_version };
    const phaseSequence = Number(last?.phase_sequence ?? 0) + 1;
    const evidence = context.arguments.evidence as JsonObject;
    const evidenceDigest = digest(evidence);
    await _client.query(`INSERT INTO kcml.browser_action_dispatch_event(action_attempt_id,phase_sequence,phase,identity_snapshot,occurred_at,adapter_evidence_digest,event_digest,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
      VALUES($1,$2,$3,$4,clock_timestamp(),$5,$6,$7,$8,$9,$10,$11,$12)`, [attempt.id, phaseSequence, phase, context.arguments.identitySnapshot ?? attempt.browser_identity_snapshot, evidenceDigest, digest({ actionId: id, phase, phaseSequence, evidenceDigest: evidenceDigest.toString('hex') }), digest({ actionId: id, phase, phaseSequence, evidence }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()]);
    const actionPhase = phase === 'COMMAND_ACCEPTED' ? 'INTENT_RECORDED' : phase === 'TARGET_RESOLVED' ? 'TARGET_RESOLVED' : phase === 'ACTIONABILITY_PASSED' ? 'PRECONDITION_VERIFIED' : phase === 'INPUT_SEQUENCE_STARTED' ? 'DISPATCH_AUTHORIZED' : phase === 'MUTATION_TRIGGER_POSSIBLY_ISSUED' ? 'POSSIBLE_EFFECT' : phase === 'POST_OBSERVATION_CAPTURED' ? 'OUTCOME_OBSERVED' : 'RECONCILING';
    const row = (await _client.query(`UPDATE kcml.browser_action_run SET dispatch_phase=$2,earliest_mutation_trigger=CASE WHEN $2='POSSIBLE_EFFECT' THEN $3 ELSE earliest_mutation_trigger END,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state_version=$4 RETURNING *`, [id, actionPhase, context.arguments.mutationTrigger ?? phase, action.state_version])).rows[0];
    if (!row) throw new DomainError('STATE_VERSION_CONFLICT', 'Browser action changed during dispatch phase update', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    return { operation: name, action: row, phase, evidence, state_version: row.state_version };
  }

  if (['browser.action.cancel', 'browser.action.complete', 'browser.action.fail', 'browser.action.reconcile', 'browser.action.resolveOutcome'].includes(name)) {
    const id = requireTarget(context);
    const current = (await _client.query(`SELECT * FROM kcml.browser_action_run WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!current) throw new DomainError('BROWSER_ACTION_NOT_FOUND', 'Browser action does not exist', 404, 'DO_NOT_RETRY');
    checkVersion(current);
    if (name === 'browser.action.cancel' && ['POSSIBLE_EFFECT', 'RECONCILING', 'UNKNOWN'].includes(String(current.dispatch_phase))) throw new DomainError('BROWSER_RECONCILIATION_REQUIRED', 'An action after a possible mutation trigger must be reconciled before cancellation', 409, 'RECONCILE_THEN_RETRY');
    if (name === 'browser.action.complete' && current.dispatch_phase !== 'CONFIRMED_APPLIED') throw new DomainError('BROWSER_POSTCONDITION_FAILED', 'Action completion requires an independently reconciled applied outcome', 409, 'RECONCILE_THEN_RETRY');
    const outcome = name === 'browser.action.cancel' ? 'CONFIRMED_NOT_APPLIED' : name === 'browser.action.fail' ? 'FAILED_FINAL' : name === 'browser.action.complete' ? 'CONFIRMED_APPLIED' : String(context.arguments.outcome);
    if (['browser.action.reconcile', 'browser.action.resolveOutcome'].includes(name) && !context.arguments.readBack) throw new DomainError('BROWSER_READBACK_REQUIRED', 'Independent read-back is required for reconciliation', 422, 'DO_NOT_RETRY');
    const outcomePayload = name === 'browser.action.fail' ? context.arguments.error ?? {} : { classification: outcome, readBack: context.arguments.readBack ?? null, evidenceDigest: canonicalDigest(safeJson(context.arguments.readBack ?? context.arguments.error ?? {})) };
    const phase = outcome === 'CONFIRMED_APPLIED' ? 'CONFIRMED_APPLIED' : outcome === 'CONFIRMED_NOT_APPLIED' ? 'CONFIRMED_NOT_APPLIED' : outcome === 'UNKNOWN' ? 'UNKNOWN' : 'FAILED_FINAL';
    const updated = (await _client.query(`UPDATE kcml.browser_action_run SET dispatch_phase=$2,outcome=$3,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state_version=$4 RETURNING *`, [id, phase, outcomePayload, current.state_version])).rows[0];
    if (!updated) throw new DomainError('STATE_VERSION_CONFLICT', 'Browser action changed during outcome resolution', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    if (phase === 'UNKNOWN') await _client.query(`UPDATE kcml.browser_session SET lifecycle='FAILED',control_holder='NONE',state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`, [current.session_id]);
    else if (phase === 'CONFIRMED_APPLIED' || phase === 'CONFIRMED_NOT_APPLIED') await _client.query(`UPDATE kcml.browser_action_attempt SET postcondition=$2,readback=$3,ended_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp() WHERE action_run_id=$1 AND attempt=(SELECT max(attempt) FROM kcml.browser_action_attempt WHERE action_run_id=$1)`, [id, { classification: phase }, context.arguments.readBack ?? null]);
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
    case 'browser.download.verify':
      return async (pool, context) => {
        const id = requireQueryTarget(context.targetId, operation.operationName);
        const row = (await pool.query(`SELECT * FROM kcml.browser_download WHERE id=$1`, [id])).rows[0];
        if (!row) throw new DomainError('BROWSER_DOWNLOAD_NOT_FOUND', 'Browser download does not exist', 404, 'DO_NOT_RETRY');
        const complete = row.state === 'COMPLETED' && row.artifact_id !== null && row.size_bytes !== null && row.content_digest !== null && row.content_verification !== null;
        return { operation: operation.operationName, download: row, complete, verified: complete && row.content_verification.verified === true, evidenceDigest: canonicalDigest(safeJson(row)) };
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
