import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseClient, DatabasePool } from '@kcml/database';
import { allocateContiguousSequence } from '@kcml/database';
import type { OperationContract } from '@kcml/contract-pack';
import { canonicalDigest, toCanonicalJsonValue, type CanonicalJsonValue } from '@kcml/schemas';
import { DomainError } from './errors.js';
import { generationWorkerPool, type GenerationPhase } from './generation-lifecycle.js';
import { exactComponentMutationOperations, executeExactComponentMutation } from './component-operations.js';
import { exactMonitorMutationOperations, executeExactMonitorMutation } from './monitor-operations.js';
import { exactMutationHandlerFor, exactQueryHandlerFor } from './exact-operation-handlers.js';

export { exactMutationHandlerFor, exactQueryHandlerFor } from './exact-operation-handlers.js';

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
  return toCanonicalJsonValue(value);
}

function digest(value: unknown): Buffer {
  return Buffer.from(canonicalDigest(safeJson(value)).slice('sha256:'.length), 'hex');
}

function requireTarget(context: CanonicalHandlerContext): string {
  if (!context.targetId) throw new DomainError('TOOL_ARGUMENT_SCHEMA_INVALID', `${context.operation.operationName} requires a targetId`, 422, 'DO_NOT_RETRY', { key: 'targetId' });
  return context.targetId;
}

function requireString(args: JsonObject, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) throw new DomainError('TOOL_ARGUMENT_SCHEMA_INVALID', `${key} is required for this operation`, 422, 'DO_NOT_RETRY', { key });
  return value;
}

function requireUuid(args: JsonObject, key: string): string {
  const value = requireString(args, key);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new DomainError('TOOL_ARGUMENT_SCHEMA_INVALID', `${key} must be a UUID`, 422, 'DO_NOT_RETRY', { key });
  }
  return value;
}

function requireDigest(args: JsonObject, key: string): Buffer {
  const value = requireString(args, key);
  if (!/^sha256:[0-9a-f]{64}$/iu.test(value)) throw new DomainError('TOOL_ARGUMENT_SCHEMA_INVALID', `${key} must be a sha256 digest`, 422, 'DO_NOT_RETRY', { key });
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
      throw new DomainError('BROWSER_ACTIONABILITY_FAILED', `Browser input ${path}.${key} must be an opaque artifact handle`, 422, 'DO_NOT_RETRY', { field: `${path}.${key}` });
    }
    rejectArbitraryBrowserPath(child, `${path}.${key}`);
  }
}

function requireSafeName(args: JsonObject, key: string, fallback: string): string {
  const value = args[key] === undefined ? fallback : requireString(args, key);
  if (value.length > 255 || value === '.' || value === '..' || value.includes('/') || value.includes('\\') || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new DomainError('BROWSER_ARTIFACT_INVALID', `${key} must be a safe single path segment`, 422, 'DO_NOT_RETRY');
  }
  return value;
}

function requireNonNegativeInteger(args: JsonObject, key: string, fallback?: bigint): bigint {
  const raw = args[key] === undefined ? fallback : args[key];
  if (raw === undefined || raw === null || !/^\d+$/u.test(String(raw))) throw new DomainError('TOOL_ARGUMENT_SCHEMA_INVALID', `${key} must be a non-negative integer`, 422, 'DO_NOT_RETRY', { key });
  return BigInt(String(raw));
}

function requireIsoDeadline(args: JsonObject, key: string, fallbackSeconds: number): string {
  const value = args[key] === undefined ? new Date(Date.now() + fallbackSeconds * 1000).toISOString() : requireString(args, key);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) throw new DomainError('BROWSER_ACTIONABILITY_FAILED', `${key} must be a future ISO timestamp`, 422, 'DO_NOT_RETRY');
  return date.toISOString();
}

function requireOpaqueArtifactHandle(value: unknown, key: string): string {
  if (typeof value !== 'string' || !/^(?:artifact|upload|download):[a-f0-9-]{36}$/iu.test(value)) throw new DomainError('BROWSER_ARTIFACT_INVALID', `${key} must be an opaque artifact handle`, 422, 'DO_NOT_RETRY', { key });
  return value;
}

function browserSessionStateError(lifecycle: unknown): DomainError {
  return new DomainError('BROWSER_SESSION_TERMINAL', `Browser session is not mutable in lifecycle ${String(lifecycle)}`, 409, 'RECONCILE_THEN_RETRY');
}

function assertNoAuthorityOverride(args: JsonObject): void {
  const forbidden = ['actorId', 'callerFingerprint', 'correlationId', 'logicalOperationId', 'platformIncarnationId', 'applicationDeploymentEpoch', 'recoveryEpoch', 'concurrencyClaim', 'bindingId', 'bindingDigest'];
  const found = forbidden.filter((key) => key in args);
  if (found.length) throw new DomainError('AGENTIC_ARGUMENT_ORIGIN_INVALID', 'Caller input cannot override server-owned operation authority', 422, 'DO_NOT_RETRY', { fields: found });
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
    case 'browser.action.start':
    case 'browser.runtimeBuild.register':
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
      if (targetId !== null) throw new DomainError('TOOL_ARGUMENT_SCHEMA_INVALID', `${name} creates a new aggregate and cannot have targetId`, 422, 'DO_NOT_RETRY', { key: 'targetId' });
      break;
    case 'component.revision.publish':
      requireTarget({ operation, targetId, arguments: args } as CanonicalHandlerContext);
      break;
    case 'monitor.alert.open':
      if (targetId !== null) throw new DomainError('TOOL_ARGUMENT_SCHEMA_INVALID', `${name} creates an episode and cannot have targetId`, 422, 'DO_NOT_RETRY', { key: 'targetId' });
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
    if (!/^artifact:sha256:[a-f0-9]{64}$/iu.test(reference)) throw new DomainError('BROWSER_ARTIFACT_INVALID', 'storageReference must be content addressed', 422, 'DO_NOT_RETRY');
  }
  if (name === 'browser.challenge.required') {
    requireUuid(args, 'sessionId');
    const challengeType = requireString(args, 'challengeType');
    if (!browserChallengeTypes.includes(challengeType as typeof browserChallengeTypes[number])) throw new DomainError('BROWSER_ACTIONABILITY_FAILED', 'Challenge type is not supported by the Browser Interaction Plane', 422, 'DO_NOT_RETRY');
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
    if (!['AI', 'OWNER', 'AUTOMATION'].includes(holder)) throw new DomainError('BROWSER_CONTROL_HELD', 'Browser control holder is invalid', 422, 'DO_NOT_RETRY');
    requireNonNegativeInteger(args, 'expectedControlEpoch');
    if (args.ttlSeconds !== undefined && (Number(args.ttlSeconds) < 1 || Number(args.ttlSeconds) > 900)) throw new DomainError('BROWSER_CONTROL_HELD', 'Control lease TTL must be between 1 and 900 seconds', 422, 'DO_NOT_RETRY');
  }
  if (['browser.action.dispatchPhase', 'browser.action.reconcile', 'browser.action.resolveOutcome'].includes(name)) {
    if (name === 'browser.action.dispatchPhase') {
      const phase = args.phase;
      if (typeof phase !== 'string' || !browserDispatchPhaseOrder.has(phase as BrowserDispatchPhase)) throw new DomainError('BROWSER_ACTIONABILITY_FAILED', 'Browser dispatch phase is not in the canonical phase set', 422, 'DO_NOT_RETRY', { phase });
      if (args.evidence === undefined || typeof args.evidence !== 'object' || args.evidence === null) throw new DomainError('BROWSER_CHALLENGE_REQUIRED', 'Every browser dispatch phase requires typed adapter evidence', 422, 'DO_NOT_RETRY');
    }
    if (['browser.action.reconcile', 'browser.action.resolveOutcome'].includes(name)) {
      if (!['CONFIRMED_APPLIED', 'CONFIRMED_NOT_APPLIED', 'UNKNOWN'].includes(String(args.outcome))) throw new DomainError('BROWSER_RECONCILIATION_REQUIRED', 'Reconciliation outcome must be independently classified', 422, 'DO_NOT_RETRY');
      if (!args.readBack || typeof args.readBack !== 'object' || args.readBack === null) throw new DomainError('BROWSER_RECONCILIATION_REQUIRED', 'Independent read-back evidence is required before resolving a browser action', 422, 'DO_NOT_RETRY');
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
  if (!current) throw new DomainError('RUNTIME_CONTEXT_NOT_CURRENT', 'Runtime instance does not exist', 404, 'DO_NOT_RETRY');
  const currentVersion = BigInt(String(current.state_version));
  if (context.expectedStateVersion !== null && currentVersion !== context.expectedStateVersion) throw new DomainError('STATE_VERSION_CONFLICT', 'Runtime instance state version changed', 409, 'REFRESH_AND_RETRY_NEW_COMMAND', { currentStateVersion: String(currentVersion) });

  const name = context.operation.operationName;
  if (name === 'runtime.prepare' || name === 'runtime.instance.start') {
    if (!['STOPPED', 'FAILED', 'UNKNOWN', 'STARTING'].includes(String(current.effective_state))) throw new DomainError('RUNTIME_STATE_BOUNDARY_VIOLATION', `Cannot start runtime from ${current.effective_state}`, 409, 'RECONCILE_THEN_RETRY');
    const updated = (await client.query(`UPDATE kcml.runtime_instance SET desired_state='STARTING',effective_state='STARTING',effective_at=NULL,state_version=state_version+1,correlation_id=$2 WHERE id=$1 AND state_version=$3 RETURNING *`, [id, context.correlationId, currentVersion.toString()])).rows[0];
    if (!updated) throw new DomainError('STATE_VERSION_CONFLICT', 'Runtime instance state version changed during preparation', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    return { operation: name, runtime: updated, transition: { from: current.effective_state, to: 'STARTING' }, state_version: updated.state_version };
  }
  if (name === 'runtime.drain') {
    if (!['READY', 'STARTING'].includes(String(current.effective_state))) throw new DomainError('RUNTIME_STATE_BOUNDARY_VIOLATION', `Cannot drain runtime from ${current.effective_state}`, 409, 'RECONCILE_THEN_RETRY');
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
    if (!Number.isSafeInteger(sequence) || sequence <= Number(current.heartbeat_sequence ?? 0)) throw new DomainError('RUNTIME_PROCESS_STALE', 'Heartbeat sequence must advance monotonically', 409, 'DO_NOT_RETRY');
    const updated = (await client.query(`UPDATE kcml.runtime_instance SET heartbeat_sequence=$2,heartbeat_at=clock_timestamp(),state_version=state_version+1,correlation_id=$3 WHERE id=$1 AND state_version=$4 RETURNING *`, [id, sequence, context.correlationId, currentVersion.toString()])).rows[0];
    if (!updated) throw new DomainError('STATE_VERSION_CONFLICT', 'Runtime instance changed during heartbeat', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    return { operation: name, runtime: updated, state_version: updated.state_version };
  }
  if (name === 'runtime.cleanup.resume') {
    const cleanup = (await client.query(`SELECT * FROM kcml.runtime_cleanup_operation WHERE runtime_instance_id=$1 ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [id])).rows[0];
    if (!cleanup) throw new DomainError('RUNTIME_CONTEXT_NOT_CURRENT', 'Runtime cleanup operation does not exist', 404, 'DO_NOT_RETRY');
    return { operation: name, cleanup, closure: cleanup.completed_at !== null };
  }
  throw new DomainError('RUNTIME_BOUNDARY_CONTRACT_INCOMPLETE', `${name} has no safe state transition for its current persisted runtime contract`, 409, 'RECONCILE_THEN_RETRY', { state: current.effective_state, operation: name });
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
  if (!conversation) throw new DomainError('KCIP_TARGET_NOT_FOUND', 'Chat conversation does not exist', 404, 'DO_NOT_RETRY');
  if (context.operation.operationName === 'chat.message.append') {
    const content = requireString(context.arguments, 'content');
    const sequence = BigInt(String((await client.query(`SELECT coalesce((SELECT sequence FROM kcml.system_chat_message WHERE conversation_id=$1 ORDER BY sequence DESC LIMIT 1),0)+1 AS next_sequence`, [conversationId])).rows[0].next_sequence));
    const row = (await client.query(`INSERT INTO kcml.system_chat_message(conversation_id,sequence,role,content,status,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
      VALUES($1,$2,'OWNER',$3,'COMPLETED',$4,$5,$6,$7,$8,$9) RETURNING *`, [conversationId, sequence.toString(), content, digest({ conversationId, sequence: sequence.toString(), content }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()])).rows[0];
    await client.query(`UPDATE kcml.system_chat_conversation SET status='OPEN',last_activity_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`, [conversationId]);
    return { operation: context.operation.operationName, message: row, state_version: row.state_version, aggregate_event_sequence: sequence };
  }
  if (context.operation.operationName === 'chat.response.stream') return { operation: context.operation.operationName, conversationId, status: conversation.status, state_version: conversation.state_version };
  throw new DomainError('SIDE_EFFECT_RECONCILIATION_FAILED', `No exact chat transition exists for ${context.operation.operationName}`, 409, 'RECONCILE_THEN_RETRY');
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
  if (!current) throw new DomainError('AGENT_RUN_STATE_UNRESUMABLE', 'Agent run does not exist', 404, 'DO_NOT_RETRY');
  const transitions: Record<string, { from: string[]; to: string }> = {
    'agent.run.pause': { from: ['RUNNING', 'WAITING_FOR_MODEL', 'WAITING_FOR_TOOL'], to: 'PAUSED' },
    'agent.run.resume': { from: ['PAUSED', 'WAITING_FOR_OWNER'], to: 'RUNNING' },
    'agent.run.cancel': { from: ['QUEUED', 'PREPARING', 'RUNNING', 'WAITING_FOR_MODEL', 'WAITING_FOR_TOOL', 'WAITING_FOR_OWNER'], to: 'CANCEL_REQUESTED' },
    'agent.run.complete': { from: ['RUNNING', 'WAITING_FOR_MODEL', 'WAITING_FOR_TOOL'], to: 'SUCCEEDED' },
    'agent.run.fail': { from: ['RUNNING', 'WAITING_FOR_MODEL', 'WAITING_FOR_TOOL'], to: 'FAILED' },
    'agent.run.manualReview': { from: ['RUNNING', 'WAITING_FOR_MODEL', 'WAITING_FOR_TOOL', 'WAITING_FOR_OWNER'], to: 'MANUAL_REVIEW' }
  };
  const transition = transitions[context.operation.operationName];
  if (!transition) throw new DomainError('SIDE_EFFECT_RECONCILIATION_FAILED', `No exact agent transition exists for ${context.operation.operationName}`, 409, 'RECONCILE_THEN_RETRY');
  if (!transition.from.includes(String(current.status))) throw new DomainError('SIDE_EFFECT_RECONCILIATION_FAILED', `Cannot apply ${context.operation.operationName} from ${current.status}`, 409, 'RECONCILE_THEN_RETRY');
  const completed = ['SUCCEEDED', 'FAILED'].includes(transition.to);
  const row = (await client.query(`UPDATE kcml.agent_run SET status=$2,completed_at=CASE WHEN $3 THEN clock_timestamp() ELSE completed_at END,output=CASE WHEN $3 THEN $4 ELSE output END,output_digest=CASE WHEN $3 THEN $5 ELSE output_digest END,state_version=state_version+1,updated_at=clock_timestamp(),correlation_id=$6 WHERE id=$1 AND state_version=$7 RETURNING *`, [id, transition.to, completed, completed ? (context.arguments.output ?? null) : null, completed ? digest(context.arguments.output ?? null) : null, context.correlationId, current.state_version])).rows[0];
  if (!row) throw new DomainError('STATE_VERSION_CONFLICT', 'Agent run changed during transition', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
  return { operation: context.operation.operationName, run: row, transition: { from: current.status, to: transition.to }, state_version: row.state_version };
}

function unsupportedOperationRejection(family: string, context: CanonicalHandlerContext): never {
  throw new DomainError(
    'SIDE_EFFECT_RECONCILIATION_FAILED',
    `The canonical ${family} contract has no permitted transition for ${context.operation.operationName}`,
    409,
    'RECONCILE_THEN_RETRY',
    { operationName: context.operation.operationName, operationFamily: family }
  );
}

async function agenticMutation(_client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  return unsupportedOperationRejection('AGENTIC', context);
}

async function auditMutation(_client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  return unsupportedOperationRejection('AUDIT', context);
}

async function authorityMutation(_client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  return unsupportedOperationRejection('AUTHORITY', context);
}

async function browserMutation(_client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const name = context.operation.operationName;
  const sessionFor = async (sessionId: string, lock = true): Promise<Record<string, any>> => {
    const row = (await _client.query(`SELECT * FROM kcml.browser_session WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [sessionId])).rows[0];
    if (!row) throw new DomainError('BROWSER_SESSION_NOT_READY', 'Browser session does not exist', 404, 'DO_NOT_RETRY');
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
    if (!session) throw new DomainError('BROWSER_SESSION_NOT_READY', 'Browser session does not exist', 404, 'DO_NOT_RETRY');
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
    if (!updated) throw new DomainError('BROWSER_CLEANUP_INCOMPLETE', `Browser session cannot close from ${session.lifecycle}`, 409, 'RECONCILE_THEN_RETRY');
    return { operation: name, session: updated, closure: { complete: true, counts }, state_version: updated.state_version };
  }

  if (['browser.session.attach', 'browser.session.pause', 'browser.session.resume', 'browser.session.close', 'browser.session.recover'].includes(name)) {
    const id = requireTarget(context);
    const current = (await _client.query(`SELECT * FROM kcml.browser_session WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!current) throw new DomainError('BROWSER_SESSION_NOT_READY', 'Browser session does not exist', 404, 'DO_NOT_RETRY');
    if (context.expectedStateVersion !== null && BigInt(String(current.state_version)) !== context.expectedStateVersion) throw new DomainError('STATE_VERSION_CONFLICT', 'Browser session state changed', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    const transitions: Record<string, { from: string[]; to: string; holder?: string }> = {
      'browser.session.attach': { from: ['CREATING', 'READY', 'RECOVERING'], to: 'ACTIVE', holder: 'AI' },
      'browser.session.pause': { from: ['ACTIVE', 'READY'], to: 'PAUSED', holder: 'NONE' },
      'browser.session.resume': { from: ['PAUSED', 'RECOVERING', 'READY'], to: 'ACTIVE', holder: 'AI' },
      'browser.session.close': { from: ['CREATING', 'READY', 'ACTIVE', 'PAUSED', 'CHALLENGE_REQUIRED', 'RECOVERING', 'CLOSING'], to: 'CLOSING', holder: 'NONE' },
      'browser.session.recover': { from: ['FAILED', 'RECOVERING', 'CLOSING'], to: 'RECOVERING', holder: 'NONE' }
    };
    const transition = transitions[name];
    if (!transition) return unsupportedOperationRejection('BROWSER', context);
    if (!transition.from.includes(String(current.lifecycle))) throw new DomainError('BROWSER_SESSION_NOT_READY', `Cannot apply ${name} from ${current.lifecycle}`, 409, 'RECONCILE_THEN_RETRY');
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
    if (!/^artifact:sha256:[a-f0-9]{64}$/iu.test(storageReference)) throw new DomainError('BROWSER_ARTIFACT_INVALID', 'storageReference must be content addressed', 422, 'DO_NOT_RETRY');
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
    if (!artifact) throw new DomainError('BROWSER_ARTIFACT_INVALID', 'Upload artifact is not owned by this browser session', 404, 'DO_NOT_RETRY');
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
    if (context.arguments.sessionId && String(context.arguments.sessionId) !== String(session.id)) throw new DomainError('BROWSER_ACCOUNT_MISMATCH', 'Upload handle belongs to a different browser session', 409, 'DO_NOT_RETRY');
    const row = (await _client.query(`UPDATE kcml.browser_upload_handle SET lifecycle='CONSUMED',consumed_at=clock_timestamp(),cleanup_at=clock_timestamp()+interval '5 minutes',state_version=state_version+1,updated_at=clock_timestamp(),canonical_digest=$2 WHERE id=$1 AND consumed_at IS NULL AND state_version=$3 RETURNING *`, [id, digest({ id, operation: name, chooserEvidence: context.arguments.chooserEvidence ?? null }), current.state_version])).rows[0];
    if (!row) throw new DomainError('STATE_VERSION_CONFLICT', 'Upload handle changed during consume', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    return { operation: name, upload: row, consumed: true, state_version: row.state_version };
  }

  if (name === 'browser.download.started') {
    const session = await sessionFor(requireUuid(context.arguments, 'sessionId'));
    const id = context.targetId ?? (context.arguments.downloadId as string | undefined) ?? randomUUID();
    if (context.arguments.downloadId && String(context.arguments.downloadId) !== id) throw new DomainError('BROWSER_DOWNLOAD_INCOMPLETE', 'downloadId does not match targetId', 422, 'DO_NOT_RETRY');
    const sourceUrl = context.arguments.sourceUrl ? requireString(context.arguments, 'sourceUrl') : null;
    let sourceOrigin = context.arguments.sourceOrigin ? requireString(context.arguments, 'sourceOrigin') : null;
    if (sourceUrl) {
      let parsedUrl: URL;
      try { parsedUrl = new URL(sourceUrl); } catch { throw new DomainError('BROWSER_ACTIONABILITY_FAILED', 'Download source URL must be an absolute URL', 422, 'DO_NOT_RETRY'); }
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new DomainError('BROWSER_ACTIONABILITY_FAILED', 'Download source URL must use HTTP(S)', 422, 'DO_NOT_RETRY');
      sourceOrigin ??= parsedUrl.origin;
      if (sourceOrigin !== parsedUrl.origin) throw new DomainError('BROWSER_ACCOUNT_MISMATCH', 'Download source origin does not match its URL', 422, 'DO_NOT_RETRY');
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
    if (!current) throw new DomainError('BROWSER_DOWNLOAD_INCOMPLETE', 'Browser download does not exist', 404, 'DO_NOT_RETRY');
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
    if (!current) throw new DomainError('BROWSER_ACTIONABILITY_FAILED', 'Browser challenge does not exist', 404, 'DO_NOT_RETRY');
    const submittedResponse = context.arguments.response ?? context.arguments.assertion ?? context.arguments.registration ?? {};
    const submittedResponseDigest = context.arguments.responseDigest ? requireDigest(context.arguments, 'responseDigest') : digest(submittedResponse);
    if (current.status === 'RESOLVED') {
      if (current.consume_digest && !Buffer.from(current.consume_digest).equals(submittedResponseDigest)) throw new DomainError('BROWSER_ACTIONABILITY_FAILED', 'A resolved challenge cannot be consumed with a different response', 409, 'DO_NOT_RETRY');
      return { operation: name, challenge: current, duplicate: true, state_version: current.state_version };
    }
    if (current.status !== 'PENDING') throw new DomainError('BROWSER_CHALLENGE_STALE', `Challenge is ${current.status}`, 409, 'RECONCILE_THEN_RETRY');
    if (new Date(current.expires_at).getTime() <= Date.now() || new Date(current.deadline_at).getTime() <= Date.now()) {
      await _client.query(`UPDATE kcml.browser_challenge SET status='EXPIRED',state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND status='PENDING'`, [id]);
      throw new DomainError('BROWSER_CHALLENGE_STALE', 'Challenge has expired', 409, 'DO_NOT_RETRY');
    }
    if (context.arguments.controlEpoch !== undefined && requireNonNegativeInteger(context.arguments, 'controlEpoch') !== BigInt(String(current.control_epoch))) throw new DomainError('BROWSER_CHALLENGE_STALE', 'Challenge control epoch is stale', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    checkVersion(current);
    if (current.challenge_type === 'WEBAUTHN_ASSERTION' && (!context.arguments.assertion || context.arguments.registration)) throw new DomainError('BROWSER_ACTIONABILITY_FAILED', 'A WebAuthn assertion challenge requires an assertion response and cannot consume registration data', 422, 'DO_NOT_RETRY');
    if (current.challenge_type === 'WEBAUTHN_REGISTRATION' && (!context.arguments.registration || context.arguments.assertion)) throw new DomainError('BROWSER_ACTIONABILITY_FAILED', 'A WebAuthn registration challenge requires registration response data and cannot consume an assertion', 422, 'DO_NOT_RETRY');
    if (current.challenge_type === 'PASSKEY' && !context.arguments.bridgeResponseId) throw new DomainError('BROWSER_CHALLENGE_REQUIRED', 'A passkey resolution must be acknowledged by the current OWNER Device Bridge', 422, 'DO_NOT_RETRY');
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
    try { if (new URL(url).protocol !== 'http:' && new URL(url).protocol !== 'https:') throw new Error('scheme'); } catch { throw new DomainError('BROWSER_ACTIONABILITY_FAILED', 'Browser observation URL must be an HTTP(S) URL', 422, 'DO_NOT_RETRY'); }
    if (contextGeneration !== BigInt(String(session.context_generation)) || documentEpoch < BigInt(String(session.document_epoch)) || revision <= BigInt(String(session.observation_revision))) throw new DomainError('BROWSER_DOCUMENT_STALE', 'Browser observation is stale or regressed', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
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
      if (context.arguments[key] !== undefined && requireNonNegativeInteger(context.arguments, key) !== BigInt(String(session[column]))) throw new DomainError('FENCING_TOKEN_STALE', `Browser ${key} does not match the current session fence`, 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    }
    if (!['AI', 'OWNER', 'AUTOMATION'].includes(String(session.control_holder))) throw new DomainError('BROWSER_CONTROL_HELD', 'Browser session has no active control holder', 409, 'RECONCILE_THEN_RETRY');
    const targetReferenceId = context.arguments.targetReferenceId === undefined || context.arguments.targetReferenceId === null ? null : requireUuid(context.arguments, 'targetReferenceId');
    if (targetReferenceId) {
      const target = (await _client.query(`SELECT * FROM kcml.browser_target_reference WHERE id=$1 AND session_id=$2`, [targetReferenceId, session.id])).rows[0];
      if (!target) throw new DomainError('BROWSER_TARGET_MISSING', 'Target reference does not belong to the browser session', 404, 'DO_NOT_RETRY');
      if (BigInt(String(target.document_epoch)) !== BigInt(String(session.document_epoch)) || String(target.page_id) !== String(session.current_page_id) || String(target.frame_id) !== String(session.current_frame_id)) throw new DomainError('BROWSER_DOCUMENT_STALE', 'Target reference belongs to a stale page or document fence', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    }
    const row = (await _client.query(`INSERT INTO kcml.browser_action_run(session_id,logical_operation_id,action,target_reference_id,payload,expected_control_epoch,expected_document_epoch,expected_observation_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [sessionId, context.logicalOperationId, action, targetReferenceId, context.arguments.payload ?? {}, Number(context.arguments.expectedControlEpoch ?? session.control_epoch ?? 0), Number(context.arguments.expectedDocumentEpoch ?? session.document_epoch ?? 0), Number(context.arguments.expectedObservationRevision ?? session.observation_revision ?? 0)])).rows[0];
    await _client.query(`INSERT INTO kcml.browser_action_attempt(action_run_id,attempt,command_id,action_fence,browser_identity_snapshot,resolved_target_candidates,actionability_evidence,input_strategy,prearmed_waiters,evidence,started_at,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
      VALUES($1,1,$2,$3,$4,'[]'::jsonb,'{}'::jsonb,$5,'{}'::jsonb,'{}'::jsonb,clock_timestamp(),$6,$7,$8,$9,$10,$11)`, [row.id, context.commandId ?? context.logicalOperationId, session.control_fence, { sessionId, contextGeneration: String(session.context_generation), pageId: session.current_page_id, frameId: session.current_frame_id, documentEpoch: String(session.document_epoch), controlEpoch: String(session.control_epoch), observationRevision: String(session.observation_revision) }, context.arguments.inputStrategy ?? action, digest({ actionId: row.id, attempt: 1, commandId: context.commandId ?? context.logicalOperationId }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()]);
    return { operation: name, action: row, state_version: row.state_version };
  }

  if (name === 'browser.action.dispatchPhase') {
    const id = requireTarget(context);
    const action = (await _client.query(`SELECT * FROM kcml.browser_action_run WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!action) throw new DomainError('BROWSER_TARGET_MISSING', 'Browser action does not exist', 404, 'DO_NOT_RETRY');
    checkVersion(action);
    const phase = String(context.arguments.phase) as BrowserDispatchPhase;
    if (!browserDispatchPhaseOrder.has(phase)) throw new DomainError('BROWSER_ACTIONABILITY_FAILED', 'Browser dispatch phase is not in the canonical phase set', 422, 'DO_NOT_RETRY', { phase });
    if (!context.arguments.evidence || typeof context.arguments.evidence !== 'object') throw new DomainError('BROWSER_CHALLENGE_REQUIRED', 'Every browser dispatch phase requires typed adapter evidence', 422, 'DO_NOT_RETRY');
    const attempt = (await _client.query(`SELECT * FROM kcml.browser_action_attempt WHERE action_run_id=$1 ORDER BY attempt DESC LIMIT 1 FOR UPDATE`, [id])).rows[0];
    if (!attempt) throw new DomainError('BROWSER_ACTIONABILITY_FAILED', 'Browser action has no persisted attempt', 409, 'RECONCILE_THEN_RETRY');
    const last = (await _client.query(`SELECT phase,phase_sequence FROM kcml.browser_action_dispatch_event WHERE action_attempt_id=$1 ORDER BY phase_sequence DESC LIMIT 1`, [attempt.id])).rows[0];
    if (last && browserDispatchPhaseOrder.get(phase)! < browserDispatchPhaseOrder.get(String(last.phase) as BrowserDispatchPhase)!) throw new DomainError('BROWSER_RECOVERY_UNKNOWN', 'Browser dispatch phase is not monotonic', 409, 'MANUAL_REVIEW');
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
    if (!current) throw new DomainError('BROWSER_TARGET_MISSING', 'Browser action does not exist', 404, 'DO_NOT_RETRY');
    checkVersion(current);
    if (name === 'browser.action.cancel' && ['POSSIBLE_EFFECT', 'RECONCILING', 'UNKNOWN'].includes(String(current.dispatch_phase))) throw new DomainError('BROWSER_RECONCILIATION_REQUIRED', 'An action after a possible mutation trigger must be reconciled before cancellation', 409, 'RECONCILE_THEN_RETRY');
    if (name === 'browser.action.complete' && current.dispatch_phase !== 'CONFIRMED_APPLIED') throw new DomainError('BROWSER_POSTCONDITION_FAILED', 'Action completion requires an independently reconciled applied outcome', 409, 'RECONCILE_THEN_RETRY');
    const outcome = name === 'browser.action.cancel' ? 'CONFIRMED_NOT_APPLIED' : name === 'browser.action.fail' ? 'FAILED_FINAL' : name === 'browser.action.complete' ? 'CONFIRMED_APPLIED' : String(context.arguments.outcome);
    if (['browser.action.reconcile', 'browser.action.resolveOutcome'].includes(name) && !context.arguments.readBack) throw new DomainError('BROWSER_RECONCILIATION_REQUIRED', 'Independent read-back is required for reconciliation', 422, 'DO_NOT_RETRY');
    const outcomePayload = name === 'browser.action.fail' ? context.arguments.error ?? {} : { classification: outcome, readBack: context.arguments.readBack ?? null, evidenceDigest: canonicalDigest(safeJson(context.arguments.readBack ?? context.arguments.error ?? {})) };
    const phase = outcome === 'CONFIRMED_APPLIED' ? 'CONFIRMED_APPLIED' : outcome === 'CONFIRMED_NOT_APPLIED' ? 'CONFIRMED_NOT_APPLIED' : outcome === 'UNKNOWN' ? 'UNKNOWN' : 'FAILED_FINAL';
    const updated = (await _client.query(`UPDATE kcml.browser_action_run SET dispatch_phase=$2,outcome=$3,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state_version=$4 RETURNING *`, [id, phase, outcomePayload, current.state_version])).rows[0];
    if (!updated) throw new DomainError('STATE_VERSION_CONFLICT', 'Browser action changed during outcome resolution', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    if (phase === 'UNKNOWN') await _client.query(`UPDATE kcml.browser_session SET lifecycle='FAILED',control_holder='NONE',state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`, [current.session_id]);
    else if (phase === 'CONFIRMED_APPLIED' || phase === 'CONFIRMED_NOT_APPLIED') await _client.query(`UPDATE kcml.browser_action_attempt SET postcondition=$2,readback=$3,ended_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp() WHERE action_run_id=$1 AND attempt=(SELECT max(attempt) FROM kcml.browser_action_attempt WHERE action_run_id=$1)`, [id, { classification: phase }, context.arguments.readBack ?? null]);
    return { operation: name, action: updated, state_version: updated.state_version };
  }
  return unsupportedOperationRejection('BROWSER', context);
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
  return unsupportedOperationRejection('COMPONENT', context);
}

async function generationMutation(client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const name = context.operation.operationName;
  const target = context.targetId;
  const jobId = target ?? (typeof context.arguments.jobId === 'string' ? context.arguments.jobId : null);
  const jobForUpdate = async (id: string): Promise<any> => {
    const row = (await client.query(`SELECT * FROM kcml.generation_job WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!row) throw new DomainError('GENERATION_BLOCKED', 'Generation job does not exist', 404, 'DO_NOT_RETRY');
    if (context.expectedStateVersion !== null && BigInt(String(row.state_version)) !== context.expectedStateVersion) throw new DomainError('STATE_VERSION_CONFLICT', 'Generation job state changed', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(String(row.lifecycle))) throw new DomainError('TERMINAL_STATE_IMMUTABLE', 'Generation job is terminal', 409, 'DO_NOT_RETRY');
    return row;
  };
  const appendCheckpoint = async (job: any, phase: string, kind: string, payload: unknown, phaseRunId: string | null = null): Promise<any> => {
    const sequence = await allocateContiguousSequence(client, 'GENERATION_CHECKPOINT', String(job.id), 'SEQUENCE');
    const value = safeJson(payload);
    return (await client.query(`INSERT INTO kcml.generation_checkpoint(generation_job_id,sequence,phase,workspace_revision,payload,payload_digest,phase_run_id,checkpoint_kind,terminal_evidence)
      VALUES($1,$2,$3,0,$4,$5,$6,$7,$8) RETURNING *`, [job.id, sequence.toString(), phase, value, digest(value), phaseRunId, kind, kind === 'PHASE_TERMINAL' ? value : null])).rows[0];
  };
  const appendEvent = async (job: any, eventType: string, payload: unknown, phaseRunId: string | null = null): Promise<void> => {
    const sequence = await allocateContiguousSequence(client, 'GENERATION_EVENT', String(job.id), 'SEQUENCE');
    const value = safeJson(payload);
    await client.query(`INSERT INTO kcml.generation_event(job_id,sequence,event_type,emitted_at,persisted_at,payload,payload_digest,phase_run_id,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
      VALUES($1,$2,$3,clock_timestamp(),clock_timestamp(),$4,$5,$6,$5,$7,$8,$9,$10,$11)`, [job.id, sequence.toString(), eventType, value, digest(value), phaseRunId, context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()]);
  };
  if (['generation.job.cancel', 'generation.job.resume', 'generation.job.retry', 'generation.job.complete'].includes(name)) {
    if (!jobId) throw new DomainError('AGENTIC_DYNAMIC_TARGET_UNBOUND', `${name} requires a generation job target`, 422, 'DO_NOT_RETRY');
    const current = await jobForUpdate(jobId);
    const transitions: Record<string, { from: string[]; to: string }> = {
      'generation.job.cancel': { from: ['DISCUSSING', 'ANALYZING', 'IMPLEMENTING', 'INTEGRATING', 'VALIDATING', 'CML_CONFORMANCE', 'ACTIVATING', 'BLOCKED'], to: 'CANCELLED' },
      'generation.job.resume': { from: ['BLOCKED'], to: String(current.terminal_evidence?.resumePhase ?? context.arguments.resumePhase ?? 'ANALYZING') },
      'generation.job.retry': { from: ['BLOCKED'], to: String(context.arguments.resumePhase ?? 'ANALYZING') },
      'generation.job.complete': { from: ['ACTIVATING'], to: 'COMPLETED' }
    };
    const transition = transitions[name];
    if (!transition || !transition.from.includes(String(current.lifecycle))) throw new DomainError('SIDE_EFFECT_RECONCILIATION_FAILED', `Cannot apply ${name} from ${current.lifecycle}`, 409, 'RECONCILE_THEN_RETRY');
    if (transition.to !== 'COMPLETED' && !['DISCUSSING', 'ANALYZING', 'IMPLEMENTING', 'INTEGRATING', 'VALIDATING', 'CML_CONFORMANCE', 'ACTIVATING', 'BLOCKED', 'FAILED', 'CANCELLED'].includes(transition.to)) throw new DomainError('GENERATION_PLAN_INVALID', 'Resume phase is not canonical', 422, 'DO_NOT_RETRY');
    const evidence = safeJson({ operation: name, reason: context.arguments.reason ?? null, resumePhase: transition.to });
    const updated = (await client.query(`UPDATE kcml.generation_job SET lifecycle=$2,current_phase=$2,cancellation_version=CASE WHEN $2='CANCELLED' THEN cancellation_version+1 ELSE cancellation_version END,terminal_evidence=CASE WHEN $2 IN ('COMPLETED','CANCELLED') THEN $3 ELSE terminal_evidence END,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state_version=$4 RETURNING *`, [jobId, transition.to, evidence, current.state_version])).rows[0];
    if (!updated) throw new DomainError('STATE_VERSION_CONFLICT', 'Generation job changed during transition', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    const checkpointRow = await appendCheckpoint(updated, transition.to, transition.to === 'COMPLETED' || transition.to === 'CANCELLED' ? 'PHASE_TERMINAL' : 'RECOVERY', evidence);
    if (transition.to === 'CANCELLED' && current.active_phase_run_id) {
      await client.query(`UPDATE kcml.generation_phase_run SET state='CANCELLED',completed_at=clock_timestamp(),error=$2,lease_owner=NULL,lease_expires_at=NULL,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state IN ('QUEUED','RUNNING','WAITING_FOR_DEPENDENCY','WAITING_FOR_OWNER','REPAIRING','CANCEL_REQUESTED')`, [current.active_phase_run_id, evidence]);
    }
    if (['generation.job.resume', 'generation.job.retry'].includes(name)) {
      const phaseRunId = randomUUID();
      const queued = (await client.query(`INSERT INTO kcml.generation_phase_run(id,job_id,phase,attempt,state,worker_pool,plan_node_range,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
        VALUES($1,$2,$3,1,'QUEUED',$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [phaseRunId, jobId, transition.to, generationWorkerPool(transition.to as GenerationPhase), { phase: transition.to, resumedFrom: current.lifecycle }, digest({ phaseRunId, phase: transition.to, resumedFrom: current.lifecycle }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()])).rows[0];
      const withSuccessor = (await client.query(`UPDATE kcml.generation_job SET active_phase_run_id=$2,latest_checkpoint_id=$3,state_version=state_version+1 WHERE id=$1 RETURNING *`, [jobId, phaseRunId, checkpointRow.id])).rows[0];
      await client.query(`INSERT INTO kcml.transactional_outbox(stream_key,stream_sequence,purpose,event_type,aggregate_id,payload,payload_digest,recovery_epoch)
        VALUES($1,$2,'GENERATION_PHASE_SUCCESSOR','generation.phase.enqueue',$3,$4,$5,(SELECT recovery_epoch FROM kcml.platform_recovery_head WHERE singleton_key=1))`, [`generation:${jobId}`, (await allocateContiguousSequence(client, 'GENERATION_OUTBOX', jobId, 'SEQUENCE')).toString(), jobId, { phaseRunId, phase: transition.to, checkpointId: checkpointRow.id }, digest({ phaseRunId, phase: transition.to, checkpointId: checkpointRow.id })]);
      return { operation: name, job: withSuccessor, phaseRun: queued, transition: { from: current.lifecycle, to: transition.to }, checkpoint: checkpointRow, state_version: withSuccessor.state_version };
    }
    await client.query(`UPDATE kcml.generation_job SET latest_checkpoint_id=$2,state_version=state_version+1 WHERE id=$1`, [jobId, checkpointRow.id]);
    await appendEvent(updated, transition.to === 'COMPLETED' ? 'generation.job.completed' : transition.to === 'CANCELLED' ? 'generation.job.cancelled' : 'generation.phase.resumed', evidence);
    return { operation: name, job: updated, transition: { from: current.lifecycle, to: transition.to }, checkpoint: checkpointRow, state_version: updated.state_version };
  }
  if (name === 'generation.phase.start') {
    if (!jobId) throw new DomainError('AGENTIC_DYNAMIC_TARGET_UNBOUND', 'generation.phase.start requires a generation job target', 422, 'DO_NOT_RETRY');
    const job = await jobForUpdate(jobId);
    const phase = String(context.arguments.phase ?? job.lifecycle);
    if (!['DISCUSSING', 'ANALYZING', 'IMPLEMENTING', 'INTEGRATING', 'VALIDATING', 'CML_CONFORMANCE', 'ACTIVATING'].includes(phase)) throw new DomainError('GENERATION_PLAN_INVALID', 'Unknown generation phase', 422, 'DO_NOT_RETRY');
    const phases = ['DISCUSSING', 'ANALYZING', 'IMPLEMENTING', 'INTEGRATING', 'VALIDATING', 'CML_CONFORMANCE', 'ACTIVATING'];
    const currentIndex = phases.indexOf(String(job.lifecycle));
    const requestedIndex = phases.indexOf(phase);
    if (currentIndex < 0 || (phase !== String(job.lifecycle) && requestedIndex !== currentIndex + 1)) throw new DomainError('SIDE_EFFECT_RECONCILIATION_FAILED', `Cannot start ${phase} after ${job.lifecycle}`, 409, 'RECONCILE_THEN_RETRY');
    const active = (await client.query(`SELECT * FROM kcml.generation_phase_run WHERE job_id=$1 AND state IN ('QUEUED','RUNNING','WAITING_FOR_DEPENDENCY','WAITING_FOR_OWNER','REPAIRING','CANCEL_REQUESTED') FOR UPDATE`, [jobId])).rows[0];
    if (active) return { operation: name, phaseRun: active, duplicate: true, state_version: job.state_version };
    const attempt = await allocateContiguousSequence(client, 'GENERATION_PHASE_ATTEMPT', jobId, phase);
    const fence = await allocateContiguousSequence(client, 'GENERATION_PHASE_FENCE', jobId, phase);
    const phaseRunId = randomUUID();
    const phaseRun = (await client.query(`INSERT INTO kcml.generation_phase_run(id,job_id,phase,attempt,state,worker_pool,lease_owner,lease_fencing_token,lease_expires_at,heartbeat_at,plan_node_range,input_checkpoint_id,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
      VALUES($1,$2,$3,$4,'RUNNING',$5,$6,$7,clock_timestamp()+interval '5 minutes',clock_timestamp(),$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`, [phaseRunId, jobId, phase, generationWorkerPool(phase as GenerationPhase), context.arguments.workerId ?? context.logicalOperationId, fence.toString(), { phase, workspaceRevisionId: job.workspace_revision_id ?? null }, job.latest_checkpoint_id, digest({ phaseRunId, phase, attempt: attempt.toString(), fence: fence.toString() }), context.logicalOperationId, context.correlationId, job.activation_epoch, context.platformIncarnationId, context.applicationDeploymentEpoch.toString()])).rows[0];
    const updated = (await client.query(`UPDATE kcml.generation_job SET lifecycle=$2,current_phase=$2,active_phase_run_id=$3,lease_fencing_token=$4,lease_expires_at=clock_timestamp()+interval '5 minutes',state_version=state_version+1 WHERE id=$1 AND state_version=$5 RETURNING *`, [jobId, phase, phaseRunId, fence.toString(), job.state_version])).rows[0];
    if (!updated) throw new DomainError('STATE_VERSION_CONFLICT', 'Generation job changed while starting a phase', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    const checkpointRow = await appendCheckpoint(updated, phase, phase === 'ANALYZING' ? 'SOURCE_INTAKE' : 'PHASE_PROGRESS', { phaseRunId, fence: fence.toString() }, phaseRunId);
    await appendEvent(updated, 'generation.phase.started', { phase, phaseRunId, attempt: attempt.toString(), fence: fence.toString() }, phaseRunId);
    return { operation: name, phaseRun, checkpoint: checkpointRow, state_version: updated.state_version };
  }
  if (name === 'generation.phase.complete') {
    const phaseRunId = typeof context.arguments.phaseRunId === 'string' ? context.arguments.phaseRunId : target;
    if (!phaseRunId) throw new DomainError('AGENTIC_DYNAMIC_TARGET_UNBOUND', 'generation.phase.complete requires a phase run target', 422, 'DO_NOT_RETRY');
    const run = (await client.query(`SELECT * FROM kcml.generation_phase_run WHERE id=$1 FOR UPDATE`, [phaseRunId])).rows[0];
    if (!run) throw new DomainError('CHECKPOINT_STALE', 'Generation phase run does not exist', 404, 'DO_NOT_RETRY');
    if (String(run.state) !== 'RUNNING' || String(run.lease_owner) !== String(context.arguments.workerId ?? context.logicalOperationId) || BigInt(run.lease_fencing_token) !== BigInt(String(context.arguments.fencingToken ?? run.lease_fencing_token))) throw new DomainError('FENCING_TOKEN_STALE', 'Phase completion was submitted by a stale worker', 409, 'RECONCILE_THEN_RETRY');
    const job = await jobForUpdate(String(run.job_id));
    const outcome = String(context.arguments.outcome ?? 'SUCCEEDED');
    if (!['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(outcome)) throw new DomainError('GENERATION_PLAN_INVALID', 'Phase outcome is not terminal', 422, 'DO_NOT_RETRY');
    const next = outcome === 'SUCCEEDED' ? ({ DISCUSSING: 'ANALYZING', ANALYZING: 'IMPLEMENTING', IMPLEMENTING: 'INTEGRATING', INTEGRATING: 'VALIDATING', VALIDATING: 'CML_CONFORMANCE', CML_CONFORMANCE: 'ACTIVATING', ACTIVATING: null } as Record<string, string | null>)[String(run.phase)] : null;
    const evidence = safeJson({ ...(typeof context.arguments.evidence === 'object' && context.arguments.evidence ? context.arguments.evidence : {}), phaseRunId, phase: run.phase, outcome, fencingToken: String(run.lease_fencing_token) });
    const cp = await appendCheckpoint(job, String(run.phase), 'PHASE_TERMINAL', evidence, phaseRunId);
    const updatedRun = (await client.query(`UPDATE kcml.generation_phase_run SET state=$2,completed_at=clock_timestamp(),result_summary=$3,result_digest=$4,output_checkpoint_id=$5,lease_owner=NULL,lease_expires_at=NULL,state_version=state_version+1 WHERE id=$1 AND state='RUNNING' AND lease_fencing_token=$6 RETURNING *`, [phaseRunId, outcome, evidence, digest(evidence), cp.id, run.lease_fencing_token])).rows[0];
    if (!updatedRun) throw new DomainError('FENCING_TOKEN_STALE', 'Phase completion lost its fencing CAS', 409, 'RECONCILE_THEN_RETRY');
    if (!next || outcome !== 'SUCCEEDED') {
      const terminal = outcome === 'SUCCEEDED' ? 'COMPLETED' : outcome === 'CANCELLED' ? 'CANCELLED' : 'FAILED';
      const changed = (await client.query(`UPDATE kcml.generation_job SET lifecycle=$2,current_phase=$2,active_phase_run_id=NULL,latest_checkpoint_id=$3,terminal_evidence=$4,state_version=state_version+1 WHERE id=$1 AND state_version=$5 RETURNING *`, [job.id, terminal, cp.id, evidence, job.state_version])).rows[0];
      if (!changed) throw new DomainError('STATE_VERSION_CONFLICT', 'Generation job changed while completing its phase', 409, 'RECONCILE_THEN_RETRY');
      await appendEvent(changed, terminal === 'COMPLETED' ? 'generation.job.completed' : terminal === 'CANCELLED' ? 'generation.job.cancelled' : 'generation.job.failed', evidence, phaseRunId);
      return { operation: name, phaseRun: updatedRun, job: changed, checkpoint: cp, state_version: changed.state_version };
    }
    const successorId = randomUUID();
    const successor = (await client.query(`INSERT INTO kcml.generation_phase_run(id,job_id,phase,attempt,state,worker_pool,plan_node_range,input_checkpoint_id,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
      VALUES($1,$2,$3,1,'QUEUED',$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [successorId, job.id, next, generationWorkerPool(next as GenerationPhase), { phase: next, predecessorPhaseRunId: run.id }, cp.id, digest({ successorId, next, predecessorPhaseRunId: run.id }), context.logicalOperationId, context.correlationId, job.activation_epoch, context.platformIncarnationId, context.applicationDeploymentEpoch.toString()])).rows[0];
    const changed = (await client.query(`UPDATE kcml.generation_job SET lifecycle=$2,current_phase=$2,active_phase_run_id=$3,latest_checkpoint_id=$4,state_version=state_version+1 WHERE id=$1 AND state_version=$5 RETURNING *`, [job.id, next, successor.id, cp.id, job.state_version])).rows[0];
    if (!changed) throw new DomainError('STATE_VERSION_CONFLICT', 'Generation job changed while enqueuing successor phase', 409, 'RECONCILE_THEN_RETRY');
    await client.query(`INSERT INTO kcml.transactional_outbox(stream_key,stream_sequence,purpose,event_type,aggregate_id,payload,payload_digest,recovery_epoch)
      VALUES($1,$2,'GENERATION_PHASE_SUCCESSOR','generation.phase.enqueue',$3,$4,$5,(SELECT recovery_epoch FROM kcml.platform_recovery_head WHERE singleton_key=1))`, [`generation:${job.id}`, (await allocateContiguousSequence(client, 'GENERATION_OUTBOX', String(job.id), 'SEQUENCE')).toString(), job.id, { phaseRunId: successor.id, phase: next, checkpointId: cp.id }, digest({ phaseRunId: successor.id, phase: next, checkpointId: cp.id })]);
    await appendEvent(changed, 'generation.phase.completed', evidence, phaseRunId);
    return { operation: name, phaseRun: updatedRun, successor, job: changed, checkpoint: cp, state_version: changed.state_version };
  }
  if (name === 'generation.candidate.publish') {
    if (!jobId) throw new DomainError('AGENTIC_DYNAMIC_TARGET_UNBOUND', 'generation.candidate.publish requires a generation job target', 422, 'DO_NOT_RETRY');
    const job = await jobForUpdate(jobId);
    const kind = String(context.arguments.kind ?? '');
    if (!['COMPONENT', 'MCP_SERVER', 'MCP_TOOL', 'MCP_RESOURCE', 'MCP_PROMPT', 'AI_AGENT', 'AUTOMATION'].includes(kind)) throw new DomainError('GENERATION_PLAN_INVALID', 'Candidate kind is not canonical', 422, 'DO_NOT_RETRY');
    if (!context.arguments.proposedIdentity || !context.arguments.revisionPayload) throw new DomainError('GENERATION_PLAN_INVALID', 'Candidate identity and revision payload are required', 422, 'DO_NOT_RETRY');
    const candidateDigest = digest({ kind, proposedIdentity: context.arguments.proposedIdentity, revisionPayload: context.arguments.revisionPayload });
    const candidateId = randomUUID();
    const candidate = (await client.query(`INSERT INTO kcml.generation_contract_candidate(id,job_id,candidate_kind,proposed_identity,revision_payload,revision_digest,specification_paths,validation_state,verification_state,integration_state,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
      VALUES($1,$2,$3,$4,$5,$6,$7,'PENDING','PENDING','PENDING',$6,$8,$9,$10,$11,$12) RETURNING *`, [candidateId, jobId, kind, context.arguments.proposedIdentity, context.arguments.revisionPayload, candidateDigest, context.arguments.specificationPaths ?? [], context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()])).rows[0];
    const validation = (await client.query(`INSERT INTO kcml.generation_validation_run(job_id,phase_run_id,candidate_id,gate_catalog_version,state,started_at,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
      VALUES($1,$2,$3,'generation-v1','QUEUED',clock_timestamp(),$4,$5,$6,$7,$8,$9) RETURNING *`, [jobId, job.active_phase_run_id, candidateId, digest({ candidateId, gateCatalogVersion: 'generation-v1' }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()])).rows[0];
    return { operation: name, candidate, validationRun: validation, state_version: candidate.state_version };
  }
  if (name === 'generation.workspace.patch') {
    if (!jobId) throw new DomainError('AGENTIC_DYNAMIC_TARGET_UNBOUND', 'generation.workspace.patch requires a generation job target', 422, 'DO_NOT_RETRY');
    const job = await jobForUpdate(jobId);
    const phaseRunId = typeof context.arguments.phaseRunId === 'string' ? context.arguments.phaseRunId : job.active_phase_run_id;
    if (!phaseRunId) throw new DomainError('SIDE_EFFECT_RECONCILIATION_FAILED', 'Workspace patch must be owned by a phase run', 409, 'RECONCILE_THEN_RETRY');
    const phaseRun = (await client.query(`SELECT id,state FROM kcml.generation_phase_run WHERE id=$1 AND job_id=$2 FOR UPDATE`, [phaseRunId, jobId])).rows[0];
    if (!phaseRun || !['RUNNING', 'REPAIRING'].includes(String(phaseRun.state))) throw new DomainError('SIDE_EFFECT_RECONCILIATION_FAILED', 'Workspace patch requires an active phase run', 409, 'RECONCILE_THEN_RETRY');
    const operations = context.arguments.operations;
    if (!Array.isArray(operations) || operations.length === 0) throw new DomainError('GENERATION_PLAN_INVALID', 'WorkspacePatchSet must contain ordered operations', 422, 'DO_NOT_RETRY');
    const baseId = typeof context.arguments.baseWorkspaceRevisionId === 'string' ? context.arguments.baseWorkspaceRevisionId : String(job.workspace_revision_id ?? '');
    const base = (await client.query(`SELECT * FROM kcml.generation_workspace_revision WHERE id=$1 AND job_id=$2`, [baseId, jobId])).rows[0];
    if (!base) throw new DomainError('WORKSPACE_BASE_STALE', 'Workspace base revision does not exist', 409, 'RECONCILE_THEN_RETRY');
    const files = new Map<string, any>((await client.query(`SELECT relative_path,mime_type,file_type,executable,content_storage,content_reference,size_bytes,content_digest,source_classification FROM kcml.generation_workspace_file WHERE workspace_revision_id=$1`, [base.id])).rows.map((row) => [String(row.relative_path), row]));
    for (const item of operations) {
      if (!item || typeof item !== 'object' || typeof item.path !== 'string' || item.path.startsWith('/') || item.path.split('/').some((part: string) => !part || part === '.' || part === '..')) throw new DomainError('WORKSPACE_PATH_INVALID', 'Workspace path must be relative and contained', 422, 'DO_NOT_RETRY');
      const existing = files.get(item.path);
      const actual = existing ? `sha256:${Buffer.from(existing.content_digest).toString('hex')}` : null;
      if ((item.expectedDigest ?? null) !== actual) throw new DomainError('WORKSPACE_BASE_STALE', `Workspace digest mismatch for ${item.path}`, 409, 'REFRESH_AND_RETRY_NEW_COMMAND', { path: item.path, expected: item.expectedDigest ?? null, actual });
      if (item.op === 'DELETE') files.delete(item.path);
      else if (item.op === 'ADD' || item.op === 'UPDATE') {
        if (typeof item.content !== 'string') throw new DomainError('GENERATION_PLAN_INVALID', 'ADD and UPDATE require exact text content', 422, 'DO_NOT_RETRY');
        const bytes = Buffer.from(item.content, 'utf8');
        const contentDigest = createHash('sha256').update(bytes).digest();
        files.set(item.path, { relative_path: item.path, mime_type: item.mimeType ?? 'text/plain', file_type: 'SOURCE', executable: item.executable === true, content_storage: 'INLINE_TEXT', content_reference: item.content, size_bytes: bytes.byteLength, content_digest: contentDigest, source_classification: 'MODEL_GENERATED', _digest: contentDigest });
      } else throw new DomainError('GENERATION_PLAN_INVALID', 'Workspace operation is not ADD, UPDATE or DELETE', 422, 'DO_NOT_RETRY');
    }
    const patchId = randomUUID();
    const operationsDigest = digest(operations);
    await client.query(`INSERT INTO kcml.generation_workspace_patch(id,job_id,phase_run_id,base_workspace_revision_id,base_digest,operations,operations_digest,apply_state,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
      VALUES($1,$2,$3,$4,$5,$6,$7,'APPLYING',$8,$9,$10,$11,$12,$13)`, [patchId, jobId, phaseRunId, base.id, base.source_tree_digest, JSON.stringify(operations), operationsDigest, digest({ patchId, operationsDigest: operationsDigest.toString('hex') }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()]);
    const revisionNumber = BigInt(base.revision_number) + 1n;
    const revisionId = randomUUID();
    const tree = Array.from(files.values()).map((file) => ({ path: file.relative_path, digest: Buffer.from(file._digest ?? file.content_digest).toString('hex'), size: file.size_bytes }));
    const treeDigest = digest(tree);
    await client.query(`INSERT INTO kcml.generation_workspace_revision(id,parent_id,job_id,revision_number,parent_revision_id,source_tree_digest,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
      VALUES($1,$2,$3,$4,$2,$5,$5,$6,$7,$8,$9,$10)`, [revisionId, base.id, jobId, revisionNumber.toString(), treeDigest, context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()]);
    for (const file of files.values()) {
      const contentDigest = file._digest ?? file.content_digest;
      await client.query(`INSERT INTO kcml.generation_workspace_file(id,parent_id,workspace_revision_id,relative_path,mime_type,file_type,executable,content_storage,content_reference,size_bytes,content_digest,source_classification,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
        VALUES($1,$2,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$10,$12,$13,$14,$15,$16)`, [randomUUID(), revisionId, file.relative_path, file.mime_type, file.file_type, file.executable, file.content_storage, file.content_reference, file.size_bytes, contentDigest, file.source_classification, context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()]);
    }
    await client.query(`UPDATE kcml.generation_workspace_patch SET apply_state='APPLIED',result_workspace_revision_id=$2,applied_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`, [patchId, revisionId]);
    const updated = (await client.query(`UPDATE kcml.generation_job SET workspace_revision_id=$2,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND workspace_revision_id=$3 RETURNING *`, [jobId, revisionId, base.id])).rows[0];
    if (!updated) throw new DomainError('WORKSPACE_BASE_STALE', 'Workspace pointer changed while applying patch', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    const checkpointRow = await appendCheckpoint(updated, String(updated.lifecycle), 'WORKSPACE_REVISION', { patchId, baseRevisionId: base.id, resultRevisionId: revisionId, revisionNumber: revisionNumber.toString(), operationsDigest: `sha256:${operationsDigest.toString('hex')}` }, phaseRunId);
    await client.query(`UPDATE kcml.generation_job SET latest_checkpoint_id=$2,state_version=state_version+1 WHERE id=$1`, [jobId, checkpointRow.id]);
    return { operation: name, patchId, revisionId, revisionNumber: revisionNumber.toString(), checkpointId: checkpointRow.id, fileCount: files.size, state_version: updated.state_version };
  }
  if (name === 'generation.integration.step') {
    const phaseRunId = typeof context.arguments.phaseRunId === 'string' ? context.arguments.phaseRunId : target;
    if (!phaseRunId) throw new DomainError('AGENTIC_DYNAMIC_TARGET_UNBOUND', 'generation.integration.step requires a phase run target', 422, 'DO_NOT_RETRY');
    const run = (await client.query(`SELECT * FROM kcml.generation_phase_run WHERE id=$1 FOR UPDATE`, [phaseRunId])).rows[0];
    if (!run) throw new DomainError('CHECKPOINT_STALE', 'Generation phase run does not exist', 404, 'DO_NOT_RETRY');
    if (String(run.phase) !== 'INTEGRATING' || !['RUNNING', 'REPAIRING'].includes(String(run.state))) throw new DomainError('SIDE_EFFECT_RECONCILIATION_FAILED', 'Integration step requires an active INTEGRATING phase', 409, 'RECONCILE_THEN_RETRY');
    const step = Number(context.arguments.step);
    if (!Number.isInteger(step) || step < 1 || step > 14) throw new DomainError('GENERATION_PLAN_INVALID', 'Integration saga step must be in the range 1..14', 422, 'DO_NOT_RETRY');
    const current = (run.result_summary && typeof run.result_summary === 'object' ? run.result_summary : {}) as Record<string, unknown>;
    const saga = Array.isArray(current.saga) ? [...current.saga] as Array<Record<string, unknown>> : [];
    const existing = saga.find((entry) => Number(entry.step) === step);
    if (existing) return { operation: name, phaseRun: run, step: existing, duplicate: true, state_version: run.state_version };
    if (step > 1 && !saga.some((entry) => Number(entry.step) === step - 1 && entry.state === 'RECONCILED')) throw new DomainError('SIDE_EFFECT_RECONCILIATION_FAILED', 'Integration saga steps must be reconciled in order', 409, 'RECONCILE_THEN_RETRY');
    const stepEvidence = { step, state: 'RECONCILED', t1Intent: digest({ phaseRunId, step }).toString('hex'), dClaim: `fence:${run.lease_fencing_token}`, t2Outcome: context.arguments.outcome ?? { observed: true }, t3Reconciliation: context.arguments.reconciliation ?? { confirmed: true } };
    saga.push(stepEvidence);
    for (const stage of ['T1_INTENT', 'D_CLAIM', 'T2_OUTCOME', 'T3_RECONCILIATION']) {
      const stagePayload = { phaseRunId, step, stage, fence: String(run.lease_fencing_token), evidence: stage === 'T2_OUTCOME' ? (context.arguments.outcome ?? { observed: true }) : stage === 'T3_RECONCILIATION' ? (context.arguments.reconciliation ?? { confirmed: true }) : {} };
      const stableKey = `generation:${run.job_id}:integration:${step}:${stage}`;
      await client.query(`INSERT INTO kcml.generation_tool_event(job_id,phase_run_id,tool_key,stable_key,display_name,state,canonical_arguments,arguments_digest,canonical_result,result_digest,domain_operation,side_effect_classification,started_at,completed_at,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
        VALUES($1,$2,$3,$4,$5,'COMPLETED',$6,$7,$8,$7,'generation.integration.step',$9,clock_timestamp(),clock_timestamp(),$7,$10,$11,$12,$13,$14)`, [run.job_id, phaseRunId, `integration.${step}.${stage}`, stableKey, `Integration step ${step} ${stage}`, stagePayload, digest(stagePayload), stagePayload, stage === 'D_CLAIM' ? 'DATABASE_CLAIM' : stage === 'T1_INTENT' ? 'INTENT' : 'EXTERNAL_RECONCILIATION', context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()]);
    }
    const resultSummary = { ...current, saga, completedSteps: saga.length, sagaComplete: saga.length === 14 };
    const updated = (await client.query(`UPDATE kcml.generation_phase_run SET result_summary=$2,result_digest=$3,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state_version=$4 AND state IN ('RUNNING','REPAIRING') RETURNING *`, [phaseRunId, resultSummary, digest(resultSummary), run.state_version])).rows[0];
    if (!updated) throw new DomainError('FENCING_TOKEN_STALE', 'Integration step lost its phase fence', 409, 'RECONCILE_THEN_RETRY');
    return { operation: name, phaseRun: updated, step: stepEvidence, sagaComplete: saga.length === 14, state_version: updated.state_version };
  }
  if (name === 'generation.validation.run') {
    const validationId = target;
    if (!validationId) throw new DomainError('AGENTIC_DYNAMIC_TARGET_UNBOUND', 'generation.validation.run requires a validation run target', 422, 'DO_NOT_RETRY');
    const validation = (await client.query(`SELECT * FROM kcml.generation_validation_run WHERE id=$1 FOR UPDATE`, [validationId])).rows[0];
    if (!validation) throw new DomainError('ACCEPTANCE_GATE_CONTRACT_INCOMPLETE', 'Generation validation run does not exist', 404, 'DO_NOT_RETRY');
    if (!['QUEUED', 'RUNNING'].includes(String(validation.state))) throw new DomainError('TERMINAL_STATE_IMMUTABLE', 'Validation run has already been completed', 409, 'RECONCILE_THEN_RETRY');
    const job = await jobForUpdate(String(validation.job_id));
    const candidate = validation.candidate_id ? (await client.query(`SELECT * FROM kcml.generation_contract_candidate WHERE id=$1`, [validation.candidate_id])).rows[0] : null;
    const workspace = job.workspace_revision_id ? (await client.query(`SELECT * FROM kcml.generation_workspace_revision WHERE id=$1`, [job.workspace_revision_id])).rows[0] : null;
    const gates = [
      { key: 'WORKSPACE_REVISION_PRESENT', pass: Boolean(workspace), actual: { revisionId: workspace?.id ?? null } },
      { key: 'WORKSPACE_DIGEST_COMPLETE', pass: Boolean(workspace?.source_tree_digest && Buffer.from(workspace.source_tree_digest).length === 32), actual: { digest: workspace?.source_tree_digest ? Buffer.from(workspace.source_tree_digest).toString('hex') : null } },
      { key: 'CANDIDATE_INTEGRATED', pass: String(candidate?.integration_state ?? '') === 'INTEGRATED', actual: { state: candidate?.integration_state ?? null } },
      { key: 'CANDIDATE_REVISION_DIGEST', pass: Boolean(candidate?.revision_digest && Buffer.from(candidate.revision_digest).length === 32), actual: { digest: candidate?.revision_digest ? Buffer.from(candidate.revision_digest).toString('hex') : null } }
    ];
    for (const gate of gates) await client.query(`INSERT INTO kcml.generation_validation_result(validation_run_id,gate_key,evaluator_version,status,inputs,expected,actual,diagnostics,duration_ms,result_digest,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
      VALUES($1,$2,'generation-v1',$3,$4,$5,$6,$7,0,$8,$8,$9,$10,$11,$12,$13)`, [validationId, gate.key, gate.pass ? 'PASS' : 'FAIL', { jobId: validation.job_id, workspaceRevisionId: workspace?.id ?? null, candidateId: candidate?.id ?? null }, { pass: true }, gate.actual, gate.pass ? [] : [`${gate.key} failed`], digest({ validationId, gate: gate.key, actual: gate.actual, pass: gate.pass }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()]);
    const passed = gates.every((gate) => gate.pass);
    const summary = { gateCatalogVersion: 'generation-v1', passed, gates: gates.map((gate) => ({ gateKey: gate.key, pass: gate.pass, actual: gate.actual })) };
    const updated = (await client.query(`UPDATE kcml.generation_validation_run SET state=$2,completed_at=clock_timestamp(),blocking_summary=$3,evidence_digest=$4,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state IN ('QUEUED','RUNNING') RETURNING *`, [validationId, passed ? 'PASS' : 'FAIL', summary, digest(summary)])).rows[0];
    if (candidate) await client.query(`UPDATE kcml.generation_contract_candidate SET validation_state=$2,verification_state=$2,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`, [candidate.id, passed ? 'PASS' : 'FAIL']);
    return { operation: name, validationRun: updated, passed, gates: summary.gates, evidenceDigest: `sha256:${Buffer.from(digest(summary)).toString('hex')}`, state_version: updated.state_version };
  }
  if (name === 'generation.activation.prepare') {
    if (!jobId) throw new DomainError('AGENTIC_DYNAMIC_TARGET_UNBOUND', 'generation.activation.prepare requires a generation job target', 422, 'DO_NOT_RETRY');
    const job = await jobForUpdate(jobId);
    const candidateId = requireString(context.arguments, 'candidateId');
    const candidate = (await client.query(`SELECT * FROM kcml.generation_contract_candidate WHERE id=$1 AND job_id=$2 FOR UPDATE`, [candidateId, jobId])).rows[0];
    if (!candidate) throw new DomainError('GENERATION_BLOCKED', 'Generation candidate does not exist', 404, 'DO_NOT_RETRY');
    if (candidate.validation_state !== 'PASS' || candidate.verification_state !== 'PASS' || candidate.integration_state !== 'INTEGRATED') throw new DomainError('GENERATION_BLOCKED', 'Activation requires passed validation, verification and integration', 409, 'DO_NOT_RETRY');
    const head = (await client.query(`SELECT * FROM kcml.activation_head WHERE singleton_key=1 FOR UPDATE`)).rows[0];
    const previousSnapshot = context.arguments.previousSnapshot ?? { state: head.current_activation_set_id ? 'ACTIVE' : 'ABSENT', activationSetId: head.current_activation_set_id ?? null, activationEpoch: String(head.current_epoch) };
    const activationSetId = randomUUID();
    const candidateSnapshot = { ...(context.arguments.candidateSnapshot && typeof context.arguments.candidateSnapshot === 'object' ? context.arguments.candidateSnapshot : {}), jobId, candidateId, provisionalIdentity: job.provisional_identity ?? null };
    const set = (await client.query(`INSERT INTO kcml.generation_activation_set(id,state,previous_snapshot,candidate_snapshot,membership,rollback_plan,activation_epoch,platform_incarnation_id,application_deployment_epoch)
      VALUES($1,'READY',$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [activationSetId, previousSnapshot, candidateSnapshot, context.arguments.membership ?? [{ objectKind: candidate.candidate_kind, objectId: candidateId }], { previousSnapshot, firstCreate: !head.current_activation_set_id }, BigInt(head.current_epoch) + 1n, context.platformIncarnationId, context.applicationDeploymentEpoch.toString()])).rows[0];
    const members = Array.isArray(context.arguments.membership) ? context.arguments.membership : [{ objectKind: candidate.candidate_kind, objectId: candidateId }];
    for (const [index, member] of members.entries()) {
      if (!member || typeof member !== 'object') throw new DomainError('GENERATION_PLAN_INVALID', 'Activation membership must contain structured members', 422, 'DO_NOT_RETRY');
      const value = member as Record<string, unknown>;
      await client.query(`INSERT INTO kcml.generation_activation_member(activation_set_id,object_kind,object_id,activation_order_key,state,evidence,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
        VALUES($1,$2,$3,$4,'READY',$5,$6,$7,$8,$9,$10,$11)`, [activationSetId, String(value.objectKind ?? candidate.candidate_kind), String(value.objectId ?? candidateId), String(value.activationOrderKey ?? String(index + 1).padStart(4, '0')), value, digest(value), context.logicalOperationId, context.correlationId, set.activation_epoch, context.platformIncarnationId, context.applicationDeploymentEpoch.toString()]);
    }
    const updated = (await client.query(`UPDATE kcml.generation_job SET lifecycle='ACTIVATING',current_phase='ACTIVATING',activation_set_id=$2,previous_activation_snapshot=$3,activation_epoch=$4,state_version=state_version+1 WHERE id=$1 AND lifecycle='CML_CONFORMANCE' RETURNING *`, [jobId, activationSetId, previousSnapshot, set.activation_epoch])).rows[0];
    if (!updated) throw new DomainError('SIDE_EFFECT_RECONCILIATION_FAILED', 'Generation job is not ready for activation', 409, 'RECONCILE_THEN_RETRY');
    return { operation: name, activationSet: set, job: updated, activationSetId, activationEpoch: String(set.activation_epoch), previousSnapshot };
  }
  if (name === 'generation.activation.switch') {
    const activationSetId = target ?? (typeof context.arguments.activationSetId === 'string' ? context.arguments.activationSetId : null);
    if (!activationSetId) throw new DomainError('AGENTIC_DYNAMIC_TARGET_UNBOUND', 'generation.activation.switch requires an activation set target', 422, 'DO_NOT_RETRY');
    const set = (await client.query(`SELECT * FROM kcml.generation_activation_set WHERE id=$1 FOR UPDATE`, [activationSetId])).rows[0];
    if (!set || set.state !== 'READY') throw new DomainError('ACTIVATION_SET_NOT_READY', 'Only a frozen READY activation set can switch', 409, 'RECONCILE_THEN_RETRY');
    const job = (await client.query(`SELECT * FROM kcml.generation_job WHERE activation_set_id=$1 FOR UPDATE`, [activationSetId])).rows[0];
    if (!job) throw new DomainError('GENERATION_BLOCKED', 'Activation set is not owned by a generation job', 404, 'DO_NOT_RETRY');
    const head = (await client.query(`SELECT * FROM kcml.activation_head WHERE singleton_key=1 FOR UPDATE`)).rows[0];
    const epoch = BigInt(head.current_epoch) + 1n;
    const preCheckpoint = await appendCheckpoint(job, 'ACTIVATING', 'ACTIVATION_PRE', { activationSetId, previousSnapshot: set.previous_snapshot, candidateSnapshot: set.candidate_snapshot, nextEpoch: epoch.toString() });
    await client.query(`UPDATE kcml.generation_activation_set SET state='SWITCHING',activation_epoch=$2,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`, [activationSetId, epoch.toString()]);
    const switched = (await client.query(`UPDATE kcml.activation_head SET current_epoch=$1,current_activation_set_id=$2,state_version=state_version+1,updated_at=clock_timestamp() WHERE singleton_key=1 AND current_epoch=$3 RETURNING *`, [epoch.toString(), activationSetId, head.current_epoch])).rows[0];
    if (!switched) throw new DomainError('SIDE_EFFECT_RECONCILIATION_FAILED', 'Activation epoch changed while switching', 409, 'RECONCILE_THEN_RETRY');
    const verifying = (await client.query(`UPDATE kcml.generation_activation_set SET state='VERIFYING',state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='SWITCHING' RETURNING *`, [activationSetId])).rows[0];
    if (!verifying) throw new DomainError('SIDE_EFFECT_RECONCILIATION_FAILED', 'Activation set did not enter postflight verification', 409, 'RECONCILE_THEN_RETRY');
    const active = (await client.query(`UPDATE kcml.generation_activation_set SET state='ACTIVE',state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='VERIFYING' RETURNING *`, [activationSetId])).rows[0];
    if (!active) throw new DomainError('SIDE_EFFECT_RECONCILIATION_FAILED', 'Activation set postflight verification failed', 409, 'RECONCILE_THEN_RETRY');
    const postCheckpoint = await appendCheckpoint(job, 'ACTIVATING', 'ACTIVATION_POST', { activationSetId, activationEpoch: epoch.toString(), state: 'ACTIVE' });
    const updated = (await client.query(`UPDATE kcml.generation_job SET lifecycle='COMPLETED',current_phase='COMPLETED',activation_epoch=$2,latest_checkpoint_id=$3,active_phase_run_id=NULL,result_digest=$4,terminal_evidence=$5,state_version=state_version+1 WHERE id=$1 AND lifecycle='ACTIVATING' RETURNING *`, [job.id, epoch.toString(), postCheckpoint.id, digest({ activationSetId, epoch: epoch.toString() }), { activationSetId, epoch: epoch.toString(), state: 'ACTIVE' }])).rows[0];
    if (!updated) throw new DomainError('SIDE_EFFECT_RECONCILIATION_FAILED', 'Generation job was not activating', 409, 'RECONCILE_THEN_RETRY');
    await appendEvent(updated, 'generation.activation.completed', { activationSetId, activationEpoch: epoch.toString() }, null);
    return { operation: name, activationSet: active, job: updated, activationEpoch: epoch.toString(), preCheckpointId: preCheckpoint.id, postCheckpointId: postCheckpoint.id, previousActivationSetId: head.current_activation_set_id ?? null };
  }
  if (name === 'generation.activation.rollback') {
    const activationSetId = target ?? (typeof context.arguments.activationSetId === 'string' ? context.arguments.activationSetId : null);
    if (!activationSetId) throw new DomainError('AGENTIC_DYNAMIC_TARGET_UNBOUND', 'generation.activation.rollback requires an activation set target', 422, 'DO_NOT_RETRY');
    const set = (await client.query(`SELECT * FROM kcml.generation_activation_set WHERE id=$1 FOR UPDATE`, [activationSetId])).rows[0];
    if (!set) throw new DomainError('ACTIVATION_SET_NOT_READY', 'Activation set does not exist', 404, 'DO_NOT_RETRY');
    const job = (await client.query(`SELECT * FROM kcml.generation_job WHERE activation_set_id=$1 FOR UPDATE`, [activationSetId])).rows[0];
    if (!job) throw new DomainError('GENERATION_BLOCKED', 'Activation set is not owned by a generation job', 404, 'DO_NOT_RETRY');
    const head = (await client.query(`SELECT * FROM kcml.activation_head WHERE singleton_key=1 FOR UPDATE`)).rows[0];
    if (!['ACTIVE', 'VERIFYING'].includes(String(set.state)) || String(head.current_activation_set_id) !== String(set.id)) throw new DomainError('ROLLBACK_INCOMPLETE', 'Rollback requires the current candidate activation set', 409, 'RECONCILE_THEN_RETRY');
    const previous = (set.previous_snapshot ?? {}) as Record<string, unknown>;
    const restoredSetId = typeof previous.activationSetId === 'string' ? previous.activationSetId : null;
    const epoch = BigInt(head.current_epoch) + 1n;
    const preCheckpoint = await appendCheckpoint(job, 'ACTIVATING', 'ACTIVATION_PRE', { activationSetId, rollback: true, restoredSetId, nextEpoch: epoch.toString() });
    await client.query(`UPDATE kcml.activation_head SET current_epoch=$1,current_activation_set_id=$2,state_version=state_version+1,updated_at=clock_timestamp() WHERE singleton_key=1 AND current_epoch=$3`, [epoch.toString(), restoredSetId, head.current_epoch]);
    const rollbackVerifying = (await client.query(`UPDATE kcml.generation_activation_set SET state='ROLLBACK_VERIFYING',activation_epoch=$2,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='ROLLING_BACK' RETURNING *`, [activationSetId, epoch.toString()])).rows[0];
    if (!rollbackVerifying) throw new DomainError('ROLLBACK_INCOMPLETE', 'Activation set did not enter rollback verification', 409, 'RECONCILE_THEN_RETRY');
    const rolled = (await client.query(`UPDATE kcml.generation_activation_set SET state='ROLLED_BACK',state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='ROLLBACK_VERIFYING' RETURNING *`, [activationSetId])).rows[0];
    const updated = (await client.query(`UPDATE kcml.generation_job SET lifecycle='BLOCKED',current_phase='BLOCKED',activation_epoch=$2,terminal_evidence=$3,state_version=state_version+1 WHERE id=$1 AND lifecycle NOT IN ('COMPLETED','FAILED','CANCELLED') RETURNING *`, [job.id, epoch.toString(), { rollback: true, restoredSetId, reason: context.arguments.reason ?? 'activation rollback' }])).rows[0];
    const postCheckpoint = updated ? await appendCheckpoint(updated, 'BLOCKED', 'ACTIVATION_POST', { activationSetId, rollback: true, restoredSetId, activationEpoch: epoch.toString() }) : null;
    if (updated && postCheckpoint) await client.query(`UPDATE kcml.generation_job SET latest_checkpoint_id=$2,state_version=state_version+1 WHERE id=$1`, [job.id, postCheckpoint.id]);
    return { operation: name, activationSet: rolled, job: updated, restoredSetId, activationEpoch: epoch.toString(), preCheckpointId: preCheckpoint.id, postCheckpointId: postCheckpoint?.id ?? null };
  }
  if (name === 'generation.message.append') {
    const jobId = requireTarget(context);
    const content = requireString(context.arguments, 'content');
    const sequence = BigInt(String((await client.query(`SELECT coalesce((SELECT sequence FROM kcml.generation_message WHERE job_id=$1 ORDER BY sequence DESC LIMIT 1),0)+1 AS next_sequence`, [jobId])).rows[0].next_sequence));
    const row = (await client.query(`INSERT INTO kcml.generation_message(job_id,sequence,role,content,attachments,status,content_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [jobId, sequence.toString(), context.arguments.role ?? 'OWNER', { text: content }, context.arguments.attachments ?? [], 'COMPLETED', digest(content), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()])).rows[0];
    return { operation: name, message: row, aggregate_event_sequence: sequence, state_version: row.state_version };
  }
  return unsupportedOperationRejection('GENERATION', context);
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
    if (!current) throw new DomainError('MCP_STATE_HANDLE_INVALID', 'MCP state handle does not exist', 404, 'DO_NOT_RETRY');
    if (name === 'mcp.stateHandle.resolve') {
      if (current.status !== 'OPEN') throw new DomainError('MCP_STATE_HANDLE_INVALID', 'Only an open MCP state handle can be resolved', 409, 'RECONCILE_THEN_RETRY');
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
      if (!['WORKING', 'INPUT_REQUIRED'].includes(String(current.state))) throw new DomainError('MCP_INVALID_REQUEST', 'Only a live MCP task can receive an update', 409, 'RECONCILE_THEN_RETRY');
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
  return unsupportedOperationRejection('MCP', context);
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
  return unsupportedOperationRejection('MONITOR', context);
}

async function ownerApiKeyMutation(_client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  return unsupportedOperationRejection('OWNERAPIKEY', context);
}

async function provenanceMutation(_client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  if (context.operation.operationName === 'provenance.content.register') {
    const id = randomUUID();
    const row = (await _client.query(`INSERT INTO kcml.content_provenance(id,parent_content_id,transformation_id,source_kind,source_object_id,source_revision_id,source_locator,observed_at,raw_bytes,artifact_reference,raw_digest,content_digest,mime_type,schema_id,content_role,instruction_authority,taint_flags,provenance_flags,extraction_method,normalization_method,transform_chain,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27) RETURNING *`, [id, context.arguments.parentContentId ? requireUuid(context.arguments, 'parentContentId') : null, context.arguments.transformationId ? requireUuid(context.arguments, 'transformationId') : null, requireString(context.arguments, 'sourceKind'), context.arguments.sourceObjectId ? requireUuid(context.arguments, 'sourceObjectId') : null, context.arguments.sourceRevisionId ? requireUuid(context.arguments, 'sourceRevisionId') : null, context.arguments.sourceLocator ?? {}, context.arguments.observedAt ?? new Date().toISOString(), context.arguments.rawBytes ?? null, context.arguments.artifactReference ?? null, requireDigest(context.arguments, 'rawDigest'), requireDigest(context.arguments, 'contentDigest'), context.arguments.mimeType ?? null, context.arguments.schemaId ?? null, requireString(context.arguments, 'contentRole'), requireString(context.arguments, 'instructionAuthority'), context.arguments.taintFlags ?? [], context.arguments.provenanceFlags ?? [], requireString(context.arguments, 'extractionMethod'), requireString(context.arguments, 'normalizationMethod'), context.arguments.transformChain ?? [], digest({ id, operation: context.operation.operationName, arguments: context.arguments }), context.logicalOperationId, context.correlationId, context.activationEpoch.toString(), context.platformIncarnationId, context.applicationDeploymentEpoch.toString()])).rows[0];
    return { operation: context.operation.operationName, provenance: row, state_version: row.state_version };
  }
  return unsupportedOperationRejection('PROVENANCE', context);
}

async function secretMutation(_client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  return unsupportedOperationRejection('SECRET', context);
}

async function selfTestMutation(_client: DatabaseClient, context: CanonicalHandlerContext): Promise<unknown> {
  const name = context.operation.operationName;
  if (['selfTest.run.cancel', 'selfTest.run.cleanup', 'selfTest.registeredElement.run'].includes(name)) {
    const id = requireTarget(context);
    const current = (await _client.query(`SELECT * FROM kcml.self_test_run WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!current) throw new DomainError('KCIP_TARGET_NOT_FOUND', 'Self-test run does not exist', 404, 'DO_NOT_RETRY');
    if (context.expectedStateVersion !== null && BigInt(String(current.state_version)) !== context.expectedStateVersion) throw new DomainError('STATE_VERSION_CONFLICT', 'Self-test run state changed', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    if (name === 'selfTest.run.cleanup') {
      if (!['PASS', 'FAIL', 'CANCELLED', 'NOT_EXECUTED_ENVIRONMENTAL'].includes(String(current.status))) throw new DomainError('OPERATION_CONTRACT_INCOMPLETE', 'Self-test cleanup requires a terminal run', 409, 'RECONCILE_THEN_RETRY');
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
  return unsupportedOperationRejection('SELFTEST', context);
}

/** Explicit operation dispatch. Every catalogued operation reaches a named
 * family handler; there is no entity/table CRUD fallback in this boundary. */
export function mutationHandlerFor(operation: OperationContract): CanonicalMutationHandler {
  const exactHandler = exactMutationHandlerFor(operation.operationName);
  if (exactHandler) return exactHandler;
  // The small legacy surface is also named per operation. TD-12 operations
  // never reach a non-exact fallback: exact dispatch above is the only
  // path for the 205 newly closed mutation contracts.
  switch (operation.operationName) {
    case 'browser.session.create': return browserMutation;
    case 'component.deregister':
    case 'component.heartbeat':
    case 'component.quarantine':
    case 'component.recertify':
    case 'component.register':
    case 'component.restore':
    case 'component.revision.publish':
    case 'component.state.report':
    case 'component.suspend': return componentMutation;
    case 'generation.job.create': return generationMutation;
    case 'monitor.alert.close':
    case 'monitor.alert.open':
    case 'monitor.alert.update': return monitorMutation;
    case 'selfTest.run.start': return selfTestMutation;
    default: return async (_client, context) => unsupportedOperationRejection(operation.operationFamily, context);
  }
}

export function queryHandlerFor(operation: OperationContract): CanonicalQueryHandler {
  const exactHandler = exactQueryHandlerFor(operation.operationName);
  if (exactHandler) return exactHandler;
  switch (operation.operationName) {
    case 'runtime.ready.report':
    case 'runtime.state.report':
      return async (pool, context) => {
        const id = context.targetId;
        if (!id) throw new DomainError('RUNTIME_CONTEXT_NOT_CURRENT', `${operation.operationName} requires an exact runtime target`, 422, 'DO_NOT_RETRY');
        const row = (await pool.query(`SELECT id,runtime_generation,desired_state,effective_state,ready_sequence,heartbeat_sequence,effective_at,heartbeat_at,state_version,activation_epoch,platform_incarnation_id,application_deployment_epoch,canonical_digest FROM kcml.runtime_instance WHERE id=$1`, [id])).rows[0];
        if (!row) throw new DomainError('RUNTIME_CONTEXT_NOT_CURRENT', 'Runtime instance does not exist', 404, 'DO_NOT_RETRY');
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
        if (!row) throw new DomainError('AGENT_RUN_STATE_UNRESUMABLE', 'Agent run does not exist', 404, 'DO_NOT_RETRY');
        return { operation: operation.operationName, run: row, terminal: ['SUCCEEDED', 'FAILED', 'CANCELLED', 'MANUAL_REVIEW'].includes(String(row.status)), evidenceDigest: canonicalDigest(safeJson(row)) };
      };
    case 'generation.plan.validate':
    case 'generation.workspace.validate':
      return async (pool, context) => {
        const id = requireQueryTarget(context.targetId, operation.operationName);
        const table = operation.operationName === 'generation.plan.validate' ? 'generation_plan' : 'generation_workspace_revision';
        const row = (await pool.query(`SELECT to_jsonb(t) AS row FROM kcml.${table} t WHERE t.id=$1`, [id])).rows[0]?.row;
        if (!row) throw new DomainError('KCIP_TARGET_NOT_FOUND', 'Generation target does not exist', 404, 'DO_NOT_RETRY');
        const checks = operation.operationName === 'generation.plan.validate'
          ? [{ gate: 'PLAN_DAG_PRESENT', pass: Boolean((row as Record<string, unknown>).canonical_dag) }, { gate: 'PLAN_VALIDATION_STATE', pass: ['PASS', 'VALID', 'SUCCEEDED'].includes(String((row as Record<string, unknown>).validation_state ?? '')) }]
          : [{ gate: 'WORKSPACE_TREE_DIGEST', pass: typeof (row as Record<string, unknown>).source_tree_digest === 'string' || Buffer.isBuffer((row as Record<string, unknown>).source_tree_digest) }, { gate: 'WORKSPACE_REVISION_ID', pass: typeof (row as Record<string, unknown>).id === 'string' }];
        const valid = checks.every((check) => check.pass);
        return { operation: operation.operationName, valid, checks, target: row, evidenceDigest: canonicalDigest(safeJson({ row, checks, valid })) };
      };
    case 'browser.session.observe':
    case 'browser.session.state':
      return async (pool, context) => {
        const id = requireQueryTarget(context.targetId, operation.operationName);
        const row = (await pool.query(`SELECT * FROM kcml.browser_session WHERE id=$1`, [id])).rows[0];
        if (!row) throw new DomainError('BROWSER_SESSION_NOT_READY', 'Browser session does not exist', 404, 'DO_NOT_RETRY');
        return { operation: operation.operationName, session: row, evidenceDigest: canonicalDigest(safeJson(row)) };
      };
    case 'browser.action.status':
      return async (pool, context) => {
        const id = requireQueryTarget(context.targetId, operation.operationName);
        const row = (await pool.query(`SELECT * FROM kcml.browser_action_run WHERE id=$1`, [id])).rows[0];
        if (!row) throw new DomainError('BROWSER_TARGET_MISSING', 'Browser action does not exist', 404, 'DO_NOT_RETRY');
        return { operation: operation.operationName, action: row, evidenceDigest: canonicalDigest(safeJson(row)) };
      };
    case 'browser.download.verify':
      return async (pool, context) => {
        const id = requireQueryTarget(context.targetId, operation.operationName);
        const row = (await pool.query(`SELECT * FROM kcml.browser_download WHERE id=$1`, [id])).rows[0];
        if (!row) throw new DomainError('BROWSER_DOWNLOAD_INCOMPLETE', 'Browser download does not exist', 404, 'DO_NOT_RETRY');
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
      return async (_pool, context) => unsupportedOperationRejection(`${operation.operationFamily}_QUERY`, {
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
  if (!targetId) throw new DomainError('AGENTIC_DYNAMIC_TARGET_UNBOUND', `${operationName} requires a targetId`, 422, 'DO_NOT_RETRY');
  return targetId;
}
