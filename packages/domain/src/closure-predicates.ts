import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { kill } from 'node:process';
import type { DatabaseClient, DatabasePool } from '@kcml/database';
import { inSerializableReadOnlyDeferrable } from '@kcml/database';
import { loadRegistry, type RegistryRecord } from '@kcml/contract-pack';
import { canonicalDigest, type CanonicalJsonValue } from '@kcml/schemas';
import { verifyAuditChainClient } from './audit-integrity.js';

/**
 * Closure is deliberately a small interpreter.  A registry record contains
 * the serialized AST, while the evaluator below is the only place allowed to
 * interpret it.  This prevents a display string from becoming an oracle.
 */
export type ClosureAst =
  | { op: 'AND' | 'OR'; args: ClosureAst[] }
  | { op: 'NOT'; arg: ClosureAst }
  | { predicate: string }
  | { literal: boolean };

export type ClosurePredicateName =
  | 'terminal_state'
  | 'children_closed'
  | 'lease_and_fence'
  | 'side_effects_known'
  | 'pointer_and_epoch'
  | 'bindings_exact'
  | 'queue_outbox_inbox_closed'
  | 'runtime_process_closed'
  | 'artifacts_filesystem_closed'
  | 'cleanup_complete'
  | 'audit_evidence_valid'
  | 'manual_review_empty';

const KNOWN_PREDICATES = new Set<ClosurePredicateName>([
  'terminal_state', 'children_closed', 'lease_and_fence', 'side_effects_known',
  'pointer_and_epoch', 'bindings_exact', 'queue_outbox_inbox_closed',
  'runtime_process_closed', 'artifacts_filesystem_closed', 'cleanup_complete',
  'audit_evidence_valid', 'manual_review_empty'
]);

export interface ClosureRegistryRecord extends RegistryRecord {
  closurePredicateId: string;
  rootKind: string;
  terminalStates: string[];
  requiredChildPredicates: string[];
  forbiddenPendingChildKinds: string[];
  forbiddenProvisionalKinds: string[];
  leaseAndFencePredicate: string;
  sideEffectPredicate: string;
  pointerAndEpochPredicate: string;
  runtimeProcessPredicate: string;
  bindingPredicate: string;
  queueOutboxInboxPredicate: string;
  artifactFilesystemPredicate: string;
  cleanupPredicate: string;
  auditEvidencePredicate: string;
  manualReviewPredicate: string;
  directQueryIds: string[];
  passExpression: string;
  failureCode: string;
}

export interface ClosureDatabaseEvidence {
  root: { id: string | null; state: string | null; exists: boolean; stateVersion: string | null };
  children: { pendingCommands: number; provisionalChildren: number; pendingApprovals: number; pendingTasks: number };
  leases: { active: number; stale: number; unfenced: number };
  effects: Array<{ id: string; status: string; possibleEffect: boolean; manualReview: boolean }>;
  pointers: { mixedEpoch: number; activePointer: number; pendingSwitches: number };
  bindings: { active: number; stale: number; unresolved: number };
  delivery: { pendingQueue: number; pendingOutbox: number; inboxGaps: number };
  runtime: { processes: Array<{ id: string; pid: number; active: boolean; cgroupPath: string }>; sockets: Array<{ id: string; path: string | null; active: boolean }>; contexts: number };
  artifacts: Array<{ id: string; state: string; tempPath: string; finalPath: string | null; expectedDigest: string }>;
  cleanup: { incomplete: number; liveResources: number };
  audit: { invalidStreams: number; missingTerminalEvent: number };
  manualReview: { objects: number; conflicts: number };
}

export interface RuntimeInventory {
  processes: Array<{ id: string; pid: number; active: boolean; cgroupPath?: string; rootKind?: string; rootId?: string | null }>;
  sockets: Array<{ id: string; path: string | null; active: boolean; rootKind?: string; rootId?: string | null }>;
  cgroups: Array<{ path: string; populated: boolean; rootKind?: string; rootId?: string | null }>;
}

export interface FilesystemInventory {
  artifacts: Array<{ id: string; path: string; present: boolean; size?: number; digest?: string }>;
}

export interface ExternalReadBack {
  effectId: string;
  available: boolean;
  consistent: boolean;
  digest?: string;
  evidence?: CanonicalJsonValue;
}

export interface ClosureProbeOptions {
  runtimeInventory?: (evidence: ClosureDatabaseEvidence, rootKind: string, rootId: string | null) => Promise<RuntimeInventory> | RuntimeInventory;
  filesystemInventory?: (evidence: ClosureDatabaseEvidence, rootKind: string, rootId: string | null) => Promise<FilesystemInventory> | FilesystemInventory;
  externalReadBack?: (effect: { id: string; status: string; possibleEffect: boolean; manualReview: boolean }, rootKind: string, rootId: string | null) => Promise<ExternalReadBack> | ExternalReadBack;
}

export interface ClosurePredicateResult {
  name: ClosurePredicateName;
  passed: boolean;
  evidenceDigest: string;
  details: CanonicalJsonValue;
}

export interface ClosureReport {
  rootKind: string;
  rootId: string | null;
  closurePredicateId: string;
  closureVersion: number;
  passed: boolean;
  failureCode: string | null;
  predicates: ClosurePredicateResult[];
  failingPredicates: ClosurePredicateName[];
  queryEvidence: Array<{ queryId: string; digest: string }>;
  inventory: { orphanCount: number; orphanInventory: CanonicalJsonValue[]; runtime: RuntimeInventory; filesystem: FilesystemInventory; external: ExternalReadBack[] };
  database: ClosureDatabaseEvidence;
  reportDigest: string;
}

const rootState: Record<string, { table: string; column: string; terminal: string[] }> = {
  ACTIVATION_SET: { table: 'generation_activation_set', column: 'state', terminal: ['ROLLED_BACK', 'FAILED'] },
  AGENT_RUN: { table: 'agent_run', column: 'status', terminal: ['SUCCEEDED', 'FAILED', 'CANCELLED'] },
  AI_MODEL_CALL: { table: 'ai_model_call', column: 'submit_state', terminal: ['COMPLETED', 'FAILED_FINAL', 'CANCELLED'] },
  AUDIT_HEAD: { table: 'audit_head', column: 'singleton_key', terminal: ['1'] },
  BROWSER_ACTION: { table: 'browser_action_run', column: 'dispatch_phase', terminal: ['CONFIRMED_APPLIED', 'CONFIRMED_NOT_APPLIED', 'FAILED_FINAL'] },
  BROWSER_SESSION: { table: 'browser_session', column: 'lifecycle', terminal: ['CLOSED', 'FAILED_FINAL', 'EXPIRED'] },
  CLEANUP_OPERATION: { table: 'cleanup_operation', column: 'status', terminal: ['CLOSED', 'FAILED'] },
  COMPONENT: { table: 'component', column: 'lifecycle', terminal: ['DEREGISTERED'] },
  DEPLOYMENT_RUN: { table: 'deployment_run', column: 'status', terminal: ['ACTIVE', 'ROLLED_BACK', 'FAILED'] },
  GENERATION_JOB: { table: 'generation_job', column: 'lifecycle', terminal: ['COMPLETED', 'SUCCEEDED', 'FAILED', 'FAILED_FINAL', 'CANCELLED', 'CANCELLED_FINAL'] },
  MCP_CALL_RUN: { table: 'mcp_call_run', column: 'state', terminal: ['SUCCEEDED', 'FAILED', 'CANCELLED'] },
  MCP_TASK: { table: 'mcp_task', column: 'state', terminal: ['COMPLETED', 'FAILED', 'CANCELLED'] },
  OPERATIONAL_ALERT: { table: 'operational_alert', column: 'status', terminal: ['CLOSED'] },
  OWNER_IDENTITY: { table: 'owner_identity', column: 'singleton_key', terminal: ['1'] },
  PLATFORM_RECOVERY: { table: 'platform_recovery_head', column: 'state', terminal: [] },
  RUNTIME_INSTANCE: { table: 'runtime_instance', column: 'effective_state', terminal: ['STOPPED', 'FAILED', 'ABSENT'] },
  SECRET_RECORD: { table: 'secret_record', column: 'lifecycle', terminal: ['CLOSED'] },
  SELF_TEST_RUN: { table: 'self_test_run', column: 'status', terminal: ['PASS', 'FAIL', 'CANCELLED', 'NOT_EXECUTED_ENVIRONMENTAL'] },
  SIDE_EFFECT: { table: 'side_effect_operation', column: 'status', terminal: ['CONFIRMED_APPLIED', 'CONFIRMED_NOT_APPLIED', 'FAILED_FINAL'] },
  SYSTEM_CHAT_CONVERSATION: { table: 'system_chat_conversation', column: 'status', terminal: ['CLOSED', 'FAILED'] }
};

function safeJson(value: unknown): CanonicalJsonValue {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : Buffer.isBuffer(item) ? item.toString('hex') : item)) as CanonicalJsonValue;
}

function digest(value: unknown): string { return canonicalDigest(safeJson(value)); }

function emptyDatabaseEvidence(): ClosureDatabaseEvidence {
  return {
    root: { id: null, state: null, exists: false, stateVersion: null },
    children: { pendingCommands: 0, provisionalChildren: 0, pendingApprovals: 0, pendingTasks: 0 },
    leases: { active: 0, stale: 0, unfenced: 0 }, effects: [],
    pointers: { mixedEpoch: 0, activePointer: 0, pendingSwitches: 0 },
    bindings: { active: 0, stale: 0, unresolved: 0 },
    delivery: { pendingQueue: 0, pendingOutbox: 0, inboxGaps: 0 },
    runtime: { processes: [], sockets: [], contexts: 0 }, artifacts: [],
    cleanup: { incomplete: 0, liveResources: 0 }, audit: { invalidStreams: 0, missingTerminalEvent: 0 },
    manualReview: { objects: 0, conflicts: 0 }
  };
}

async function queryOne(client: DatabaseClient, text: string, values: unknown[] = []): Promise<Record<string, unknown> | undefined> {
  return (await client.query(text, values)).rows[0] as Record<string, unknown> | undefined;
}

function numberValue(value: unknown): number { return Number(value ?? 0); }
function stringValue(value: unknown): string { return String(value ?? ''); }

async function readDatabaseEvidence(client: DatabaseClient, rootKind: string, rootId: string | null): Promise<ClosureDatabaseEvidence> {
  const evidence = emptyDatabaseEvidence();
  const config = rootState[rootKind];
  if (!config) return evidence;
  const root = config.table === 'audit_head' || config.table === 'owner_identity'
    ? await queryOne(client, `SELECT singleton_key::text AS id, singleton_key::text AS root_state, true AS exists, state_version::text AS state_version FROM kcml.${config.table} WHERE singleton_key=1`)
    : config.table === 'platform_recovery_head'
      ? await queryOne(client, `SELECT singleton_key::text AS id, state AS root_state, true AS exists, state_version::text AS state_version FROM kcml.platform_recovery_head WHERE singleton_key=1`)
      : await queryOne(client, `SELECT id::text, ${config.column}::text AS root_state, true AS exists, state_version::text AS state_version FROM kcml.${config.table} WHERE id=$1`, [rootId]);
  if (root) evidence.root = { id: stringValue(root.id), state: root.root_state === undefined ? null : stringValue(root.root_state), exists: root.exists === true, stateVersion: root.state_version === undefined ? null : stringValue(root.state_version) };

  const children = await queryOne(client, `SELECT
    count(*) FILTER (WHERE c.status NOT IN ('SUCCEEDED','FAILED_FINAL','CANCELLED_FINAL') AND c.target_id=$1)::int AS pending_commands,
    count(*) FILTER (WHERE c.status='MANUAL_REVIEW' AND c.target_id=$1)::int AS manual_commands,
    count(*) FILTER (WHERE c.target_id=$1 AND c.expected_activation_epoch IS NOT NULL AND c.status NOT IN ('SUCCEEDED','FAILED_FINAL','CANCELLED_FINAL'))::int AS provisional_children
    FROM kcml.domain_command c`, [rootId]);
  evidence.children.pendingCommands = numberValue(children?.pending_commands);
  evidence.children.provisionalChildren = numberValue(children?.provisional_children);
  evidence.manualReview.objects += numberValue(children?.manual_commands);

  const lease = await queryOne(client, `SELECT
    count(*) FILTER (WHERE released_at IS NULL)::int AS active,
    count(*) FILTER (WHERE released_at IS NULL AND expires_at <= CURRENT_TIMESTAMP)::int AS stale,
    count(*) FILTER (WHERE released_at IS NULL AND (fencing_token IS NULL OR fencing_token <= 0))::int AS unfenced
    FROM kcml.concurrency_claim WHERE logical_operation_id IN (SELECT logical_operation_id FROM kcml.domain_command WHERE target_id=$1)`, [rootId]);
  evidence.leases = { active: numberValue(lease?.active), stale: numberValue(lease?.stale), unfenced: numberValue(lease?.unfenced) };

  const effects = await client.query(`SELECT e.id::text, e.status, e.reconciliation_contract, e.compensation_contract
    FROM kcml.side_effect_operation e JOIN kcml.domain_command c ON c.id=e.command_id WHERE c.target_id=$1 OR e.id::text=$1 ORDER BY e.id`, [rootId]);
  evidence.effects = effects.rows.map((row) => ({ id: stringValue(row.id), status: stringValue(row.status), possibleEffect: !['CONFIRMED_NOT_APPLIED', 'FAILED_FINAL'].includes(stringValue(row.status)), manualReview: stringValue(row.status) === 'UNKNOWN' || stringValue(row.status) === 'RECONCILING' || stringValue(row.status) === 'MANUAL_REVIEW' || Boolean(row.compensation_contract) && stringValue(row.status) === 'CONFIRMED_APPLIED' }));
  evidence.manualReview.objects += evidence.effects.filter((item) => item.manualReview).length;

  const pointers = await queryOne(client, `SELECT
    (SELECT count(*) FROM kcml.artifact_current_pointer p LEFT JOIN kcml.artifact_publication a ON a.id=p.publication_id AND a.artifact_state='PUBLISHED' AND a.final_digest=p.final_digest WHERE p.artifact_owner_id=$1 AND a.id IS NULL)::int AS mixed_epoch,
    (SELECT count(*) FROM kcml.artifact_current_pointer WHERE artifact_owner_id=$1)::int AS active_pointer,
    (SELECT count(*) FROM kcml.activation_domain_barrier b JOIN kcml.activation_domain_head h ON h.id=b.activation_domain_id WHERE b.state IN ('REQUESTED','DRAINING','CLOSED') AND h.domain_key LIKE '%'||$1::text||'%')::int AS pending_switches`, [rootId]);
  evidence.pointers = { mixedEpoch: numberValue(pointers?.mixed_epoch), activePointer: numberValue(pointers?.active_pointer), pendingSwitches: numberValue(pointers?.pending_switches) };

  if (rootKind === 'COMPONENT') {
    const bindings = await queryOne(client, `SELECT count(*) FILTER (WHERE lifecycle='ACTIVE' AND retired_at IS NULL AND deleted_at IS NULL)::int AS active,
      count(*) FILTER (WHERE lifecycle='ACTIVE' AND (binding_revision <= 0 OR binding_digest IS NULL))::int AS unresolved
      FROM kcml.component_contract_binding WHERE source_component_id=$1 OR target_component_id=$1`, [rootId]);
    evidence.bindings = { active: numberValue(bindings?.active), stale: 0, unresolved: numberValue(bindings?.unresolved) };
  } else if (rootKind === 'BROWSER_SESSION') {
    const bindings = await queryOne(client, `SELECT count(*) FILTER (WHERE revoked_at IS NULL AND deleted_at IS NULL)::int AS active,
      count(*) FILTER (WHERE revoked_at IS NULL AND deleted_at IS NULL AND activation_epoch < 0)::int AS stale
      FROM kcml.browser_session_binding WHERE session_id=$1`, [rootId]);
    evidence.bindings = { active: numberValue(bindings?.active), stale: numberValue(bindings?.stale), unresolved: 0 };
  } else if (rootKind === 'SECRET_RECORD') {
    const bindings = await queryOne(client, `SELECT count(*) FILTER (WHERE lifecycle='ACTIVE' AND deleted_at IS NULL)::int AS active,
      count(*) FILTER (WHERE lifecycle='ACTIVE' AND expires_at IS NOT NULL AND expires_at<=CURRENT_TIMESTAMP)::int AS stale
      FROM kcml.secret_binding WHERE secret_id=$1`, [rootId]);
    evidence.bindings = { active: numberValue(bindings?.active), stale: numberValue(bindings?.stale), unresolved: 0 };
  }
  if (rootKind === 'AGENT_RUN') {
    const pending = await queryOne(client, `SELECT count(*) FILTER (WHERE status='PENDING')::int AS approvals FROM kcml.agent_approval_request WHERE root_agent_run_id=$1`, [rootId]);
    evidence.children.pendingApprovals = numberValue(pending?.approvals);
  }
  if (rootKind === 'MCP_CALL_RUN') {
    const pending = await queryOne(client, `SELECT count(*) FILTER (WHERE status NOT IN ('CONSUMED','EXPIRED','INVALIDATED'))::int AS exchanges FROM kcml.mcp_input_exchange WHERE call_run_id=$1`, [rootId]);
    evidence.children.pendingTasks = numberValue(pending?.exchanges);
  }
  if (rootKind === 'MCP_TASK') {
    const pending = await queryOne(client, `SELECT count(*) FILTER (WHERE state NOT IN ('COMPLETED','FAILED','CANCELLED'))::int AS tasks FROM kcml.mcp_task WHERE id=$1`, [rootId]);
    evidence.children.pendingTasks = numberValue(pending?.tasks);
  }

  const delivery = await queryOne(client, `SELECT
    (SELECT count(*) FROM kcml.queue_item q LEFT JOIN kcml.domain_command c ON c.id=q.command_id WHERE q.status IN ('READY','CLAIMED') AND (q.command_id=$1 OR c.target_id=$1))::int AS pending_queue,
    (SELECT count(*) FROM kcml.transactional_outbox o WHERE o.status IN ('PENDING','CLAIMED') AND (o.aggregate_id=$1 OR o.side_effect_operation_id IN (SELECT id FROM kcml.side_effect_operation WHERE command_id IN (SELECT id FROM kcml.domain_command WHERE target_id=$1))))::int AS pending_outbox,
    (SELECT count(*) FROM (
      SELECT consumer_id, stream_key, stream_sequence,
        lag(stream_sequence) OVER (PARTITION BY consumer_id, stream_key ORDER BY stream_sequence) AS previous_sequence
      FROM kcml.transactional_inbox
    ) inbox WHERE previous_sequence IS NOT NULL AND stream_sequence <> previous_sequence + 1)::int AS inbox_gaps`, [rootId]);
  evidence.delivery = { pendingQueue: numberValue(delivery?.pending_queue), pendingOutbox: numberValue(delivery?.pending_outbox), inboxGaps: numberValue(delivery?.inbox_gaps) };

  const runtime = await client.query(`SELECT p.id::text, p.linux_pid, (p.exited_at IS NULL) AS active, p.cgroup_path,
      'PROCESS' AS item_kind, NULL::text AS socket_path
    FROM kcml.runtime_process_identity p LEFT JOIN kcml.runtime_instance r ON r.id=p.runtime_instance_id
    WHERE r.id=$1 OR r.component_id=$1
    UNION ALL
    SELECT c.id::text, c.peer_pid, (c.state IN ('OPENING','ACTIVE','DRAINING')) AS active, c.peer_cgroup_path,
      'SOCKET' AS item_kind, c.canonical_path AS socket_path
    FROM kcml.runtime_ipc_connection c LEFT JOIN kcml.runtime_instance r ON r.id=c.runtime_instance_id
    WHERE r.id=$1`, [rootId]);
  evidence.runtime.processes = runtime.rows.filter((row) => row.item_kind === 'PROCESS').map((row) => ({ id: stringValue(row.id), pid: numberValue(row.linux_pid), active: row.active === true, cgroupPath: stringValue(row.cgroup_path) }));
  evidence.runtime.sockets = runtime.rows.filter((row) => row.item_kind === 'SOCKET').map((row) => ({ id: stringValue(row.id), path: row.socket_path === null ? null : stringValue(row.socket_path), active: row.active === true }));
  const contexts = await queryOne(client, `SELECT count(*)::int AS count FROM kcml.runtime_execution_context WHERE source_object_id=$1 AND completed_at IS NULL`, [rootId]);
  evidence.runtime.contexts = numberValue(contexts?.count);

  const artifacts = await client.query(`SELECT id::text,artifact_state,temp_path_identity,final_content_address,expected_digest FROM kcml.artifact_publication WHERE artifact_owner_id=$1 ORDER BY id`, [rootId]);
  evidence.artifacts = artifacts.rows.map((row) => ({ id: stringValue(row.id), state: stringValue(row.artifact_state), tempPath: stringValue(row.temp_path_identity), finalPath: row.final_content_address === null ? null : stringValue(row.final_content_address), expectedDigest: Buffer.isBuffer(row.expected_digest) ? `sha256:${row.expected_digest.toString('hex')}` : stringValue(row.expected_digest) }));

  const cleanup = await queryOne(client, `SELECT
    (SELECT count(*) FROM kcml.cleanup_operation WHERE parent_id=$1 AND status NOT IN ('CLOSED','FAILED'))::int AS incomplete,
    (SELECT count(*) FROM kcml.cleanup_resource r JOIN kcml.cleanup_operation o ON o.id=r.cleanup_operation_id WHERE o.parent_id=$1 AND r.status NOT IN ('VERIFIED_ABSENT','RETAINED_EVIDENCE'))::int AS live_resources`, [rootId]);
  evidence.cleanup = { incomplete: numberValue(cleanup?.incomplete), liveResources: numberValue(cleanup?.live_resources) };

  let invalidAuditStreams = 0;
  try { await verifyAuditChainClient(client); } catch { invalidAuditStreams += 1; }
  const componentAudit = await queryOne(client, `SELECT count(*)::int AS count FROM kcml.component_audit_stream WHERE component_id=$1 AND integrity_state<>'VALID'`, [rootId]);
  invalidAuditStreams += numberValue(componentAudit?.count);
  let missingTerminalEvent = 0;
  if (rootId && evidence.root.exists && config.terminal.includes(String(evidence.root.state))) {
    const terminalAudit = await queryOne(client, `SELECT count(*)::int AS count FROM kcml.audit_event WHERE aggregate_id=$1 AND (
      payload->>'state'=ANY($2::text[]) OR payload->>'status'=ANY($2::text[]) OR payload->>'lifecycle'=ANY($2::text[]) OR payload->>'dispatchPhase'=ANY($2::text[]) OR payload->>'effectiveState'=ANY($2::text[]) OR
      event_type ~* '(succeeded|completed|closed|cancelled|failed|activated|rolled.?back|deregistered|stopped|pass)'
    )`, [rootId, config.terminal]);
    missingTerminalEvent = numberValue(terminalAudit?.count) > 0 ? 0 : 1;
  }
  evidence.audit = { invalidStreams: invalidAuditStreams, missingTerminalEvent };
  const manual = await queryOne(client, `SELECT
    (SELECT count(*) FROM kcml.domain_command WHERE target_id=$1 AND status='MANUAL_REVIEW')::int +
    (SELECT count(*) FROM kcml.side_effect_operation e JOIN kcml.domain_command c ON c.id=e.command_id WHERE c.target_id=$1 AND e.status='UNKNOWN')::int AS objects,
    (SELECT count(*) FROM kcml.side_effect_attempt_state s JOIN kcml.side_effect_operation e ON e.id=s.operation_id JOIN kcml.domain_command c ON c.id=e.command_id WHERE c.target_id=$1 AND s.status='UNKNOWN')::int AS conflicts`, [rootId]);
  evidence.manualReview.objects += numberValue(manual?.objects); evidence.manualReview.conflicts = numberValue(manual?.conflicts);
  return evidence;
}

export function parseClosureAst(serialized: string): ClosureAst {
  let value: unknown;
  try { value = JSON.parse(serialized); } catch { throw new Error('CLOSURE_PASS_EXPRESSION_INVALID_JSON'); }
  const validate = (candidate: unknown): ClosureAst => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('CLOSURE_PASS_EXPRESSION_INVALID_NODE');
    const node = candidate as Record<string, unknown>;
    if (typeof node.predicate === 'string' && KNOWN_PREDICATES.has(node.predicate as ClosurePredicateName) && Object.keys(node).length === 1) return { predicate: node.predicate } as ClosureAst;
    if (typeof node.literal === 'boolean' && Object.keys(node).length === 1) return { literal: node.literal };
    if ((node.op === 'AND' || node.op === 'OR') && Array.isArray(node.args) && node.args.length > 0) return { op: node.op, args: node.args.map(validate) };
    if (node.op === 'NOT' && node.arg !== undefined && Object.keys(node).length === 2) return { op: 'NOT', arg: validate(node.arg) };
    throw new Error('CLOSURE_PASS_EXPRESSION_UNKNOWN_NODE');
  };
  return validate(value);
}

export function evaluateClosureAst(ast: ClosureAst, values: Readonly<Record<ClosurePredicateName, boolean>>): boolean {
  if ('literal' in ast) return ast.literal;
  if ('predicate' in ast) return values[ast.predicate as ClosurePredicateName];
  if (ast.op === 'NOT') return !evaluateClosureAst(ast.arg, values);
  return ast.op === 'AND' ? ast.args.every((item) => evaluateClosureAst(item, values)) : ast.args.some((item) => evaluateClosureAst(item, values));
}

function processIsAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try { kill(pid, 0); return true; }
  catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : '';
    if (code === 'ESRCH') return false;
    return true;
  }
}

async function cgroupPopulated(cgroupPath: string): Promise<boolean> {
  if (!cgroupPath) return true;
  const path = cgroupPath.startsWith('/sys/fs/cgroup/') ? cgroupPath : `/sys/fs/cgroup${cgroupPath.startsWith('/') ? '' : '/'}${cgroupPath}`;
  try {
    const events = await readFile(`${path}/cgroup.events`, 'utf8');
    const populated = /^populated\s+1$/mu.test(events);
    const procs = await readFile(`${path}/cgroup.procs`, 'utf8');
    return populated || procs.trim().length > 0;
  } catch {
    return true;
  }
}

async function defaultRuntimeInventory(evidence: ClosureDatabaseEvidence): Promise<RuntimeInventory> {
  const processes = evidence.runtime.processes.map((item) => ({ ...item, active: item.active ? processIsAlive(item.pid) : false }));
  const sockets = await Promise.all(evidence.runtime.sockets.map(async (item) => {
    if (!item.path) return item;
    try { await lstat(item.path); return { ...item, active: true }; } catch { return { ...item, active: false }; }
  }));
  const cgroupPaths = [...new Set(evidence.runtime.processes.map((item) => item.cgroupPath).filter(Boolean))];
  const cgroups = await Promise.all(cgroupPaths.map(async (path) => ({ path, populated: await cgroupPopulated(path) })));
  return { processes, sockets, cgroups };
}

async function fileDigest(path: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return `sha256:${hash.digest('hex')}`;
}

async function defaultFilesystemInventory(evidence: ClosureDatabaseEvidence): Promise<FilesystemInventory> {
  const artifacts: FilesystemInventory['artifacts'] = [];
  for (const item of evidence.artifacts) {
    const paths = item.state === 'PUBLISHED' ? [item.finalPath].filter((value): value is string => Boolean(value)) : [item.tempPath];
    for (const path of paths) {
      try {
        const stat = await lstat(path);
        if (item.state === 'PUBLISHED') artifacts.push({ id: item.id, path, present: true, size: stat.size, digest: await fileDigest(path) }); else artifacts.push({ id: item.id, path, present: true, size: stat.size });
      } catch { artifacts.push({ id: item.id, path, present: false }); }
    }
  }
  return { artifacts };
}

export async function evaluateClosureRecord(record: ClosureRegistryRecord, database: ClosureDatabaseEvidence, rootId: string | null, options: ClosureProbeOptions = {}): Promise<ClosureReport> {
  const runtime = await (options.runtimeInventory?.(database, record.rootKind, rootId) ?? defaultRuntimeInventory(database));
  const filesystem = await (options.filesystemInventory?.(database, record.rootKind, rootId) ?? defaultFilesystemInventory(database));
  const external: ExternalReadBack[] = [];
  for (const effect of database.effects) if (effect.possibleEffect) external.push(await (options.externalReadBack?.(effect, record.rootKind, rootId) ?? { effectId: effect.id, available: false, consistent: false }));
  const runtimeClosed = runtime.processes.every((item) => !item.active) && runtime.sockets.every((item) => !item.active) && runtime.cgroups.every((item) => !item.populated) && database.runtime.contexts === 0;
  const artifactClosed = database.artifacts.every((item) => { const observed=filesystem.artifacts.find((artifact)=>artifact.id===item.id); if(item.state==='PUBLISHED')return Boolean(observed?.present)&&Boolean(item.expectedDigest)&&observed?.digest===item.expectedDigest; if(item.state==='CLEANED'||item.state==='FAILED')return !observed?.present; return false; });
  const activePointerForbidden = ['COMPONENT', 'BROWSER_SESSION', 'RUNTIME_INSTANCE', 'SECRET_RECORD'].includes(record.rootKind) && database.pointers.activePointer > 0;
  const values: Record<ClosurePredicateName, boolean> = {
    terminal_state: database.root.exists && record.terminalStates.includes(String(database.root.state)),
    children_closed: database.children.pendingCommands === 0 && database.children.provisionalChildren === 0 && database.children.pendingApprovals === 0 && database.children.pendingTasks === 0,
    lease_and_fence: database.leases.active === 0 && database.leases.stale === 0 && database.leases.unfenced === 0,
    side_effects_known: database.effects.every((effect) => ['CONFIRMED_APPLIED', 'CONFIRMED_NOT_APPLIED', 'FAILED_FINAL'].includes(effect.status)) && external.every((item) => item.available && item.consistent),
    pointer_and_epoch: database.pointers.mixedEpoch === 0 && database.pointers.pendingSwitches === 0 && !activePointerForbidden,
    bindings_exact: database.bindings.active === 0 && database.bindings.stale === 0 && database.bindings.unresolved === 0,
    queue_outbox_inbox_closed: database.delivery.pendingQueue === 0 && database.delivery.pendingOutbox === 0 && database.delivery.inboxGaps === 0,
    runtime_process_closed: runtimeClosed,
    artifacts_filesystem_closed: artifactClosed,
    cleanup_complete: database.cleanup.incomplete === 0 && database.cleanup.liveResources === 0,
    audit_evidence_valid: database.audit.invalidStreams === 0 && database.audit.missingTerminalEvent === 0,
    manual_review_empty: database.manualReview.objects === 0 && database.manualReview.conflicts === 0
  };
  const ast = parseClosureAst(record.passExpression);
  const predicates = [...KNOWN_PREDICATES].map((name) => ({ name, passed: values[name], evidenceDigest: digest({ name, value: values[name], database, runtime, filesystem, external }), details: safeJson({ value: values[name] }) }));
  const orphanInventory = [
    ...(database.children.pendingCommands > 0 ? [safeJson({ kind: 'PENDING_COMMAND', count: database.children.pendingCommands })] : []),
    ...(database.children.provisionalChildren > 0 ? [safeJson({ kind: 'PROVISIONAL_CHILD', count: database.children.provisionalChildren })] : []),
    ...(database.children.pendingApprovals > 0 ? [safeJson({ kind: 'PENDING_APPROVAL', count: database.children.pendingApprovals })] : []),
    ...(database.children.pendingTasks > 0 ? [safeJson({ kind: 'PENDING_TASK', count: database.children.pendingTasks })] : []),
    ...(database.leases.active > 0 ? [safeJson({ kind: 'ACTIVE_LEASE', count: database.leases.active })] : []),
    ...(database.leases.stale > 0 ? [safeJson({ kind: 'STALE_LEASE', count: database.leases.stale })] : []),
    ...(database.leases.unfenced > 0 ? [safeJson({ kind: 'UNFENCED_LEASE', count: database.leases.unfenced })] : []),
    ...(database.effects.some((item) => !['CONFIRMED_APPLIED', 'CONFIRMED_NOT_APPLIED', 'FAILED_FINAL'].includes(item.status)) ? [safeJson({ kind: 'UNRESOLVED_SIDE_EFFECT', ids: database.effects.filter((item) => !['CONFIRMED_APPLIED', 'CONFIRMED_NOT_APPLIED', 'FAILED_FINAL'].includes(item.status)).map((item) => item.id) })] : []),
    ...(database.pointers.mixedEpoch > 0 ? [safeJson({ kind: 'MIXED_POINTER_EPOCH', count: database.pointers.mixedEpoch })] : []),
    ...(database.pointers.pendingSwitches > 0 ? [safeJson({ kind: 'PENDING_POINTER_SWITCH', count: database.pointers.pendingSwitches })] : []),
    ...(database.bindings.active > 0 ? [safeJson({ kind: 'ACTIVE_BINDING', count: database.bindings.active })] : []),
    ...(database.bindings.stale > 0 ? [safeJson({ kind: 'STALE_BINDING', count: database.bindings.stale })] : []),
    ...(database.bindings.unresolved > 0 ? [safeJson({ kind: 'UNRESOLVED_BINDING', count: database.bindings.unresolved })] : []),
    ...(database.delivery.pendingQueue > 0 ? [safeJson({ kind: 'PENDING_QUEUE', count: database.delivery.pendingQueue })] : []),
    ...(database.delivery.pendingOutbox > 0 ? [safeJson({ kind: 'PENDING_OUTBOX', count: database.delivery.pendingOutbox })] : []),
    ...(database.delivery.inboxGaps > 0 ? [safeJson({ kind: 'INBOX_SEQUENCE_GAP', count: database.delivery.inboxGaps })] : []),
    ...(database.cleanup.incomplete > 0 ? [safeJson({ kind: 'INCOMPLETE_CLEANUP', count: database.cleanup.incomplete })] : []),
    ...(database.cleanup.liveResources > 0 ? [safeJson({ kind: 'LIVE_CLEANUP_RESOURCE', count: database.cleanup.liveResources })] : []),
    ...(activePointerForbidden ? [safeJson({ kind: 'ACTIVE_POINTER', count: database.pointers.activePointer })] : []),
    ...runtime.processes.filter((item) => item.active).map((item) => safeJson({ kind: 'PROCESS', id: item.id, pid: item.pid })),
    ...runtime.sockets.filter((item) => item.active).map((item) => safeJson({ kind: 'SOCKET', id: item.id, path: item.path })),
    ...(runtime.cgroups.filter((item) => item.populated).map((item) => safeJson({ kind: 'CGROUP', path: item.path }))),
    ...(database.runtime.contexts > 0 ? [safeJson({ kind: 'EXECUTION_CONTEXT', count: database.runtime.contexts })] : []),
    ...filesystem.artifacts.filter((item) => item.present && !database.artifacts.some((artifact) => artifact.id === item.id && artifact.state === 'PUBLISHED')).map((item) => safeJson({ kind: 'ARTIFACT', id: item.id, path: item.path })),
    ...(database.audit.invalidStreams > 0 ? [safeJson({ kind: 'INVALID_AUDIT_STREAM', count: database.audit.invalidStreams })] : []),
    ...(database.audit.missingTerminalEvent > 0 ? [safeJson({ kind: 'MISSING_TERMINAL_AUDIT_EVENT', count: database.audit.missingTerminalEvent })] : []),
    ...(database.manualReview.conflicts > 0 ? [safeJson({ kind: 'MANUAL_REVIEW_CONFLICT', count: database.manualReview.conflicts })] : []),
    ...(database.manualReview.objects > 0 ? [safeJson({ kind: 'MANUAL_REVIEW_OBJECT', count: database.manualReview.objects })] : []),
    ...database.effects.filter((item) => item.manualReview).map((item) => safeJson({ kind: 'MANUAL_REVIEW_EFFECT', id: item.id }))
  ];
  const passed = evaluateClosureAst(ast, values) && record.failureCode === 'TERMINAL_CLOSURE_INCOMPLETE' && orphanInventory.length === 0;
  const reportCore = { rootKind: record.rootKind, rootId, closurePredicateId: record.closurePredicateId, closureVersion: 1, passed, failureCode: passed ? null : record.failureCode, predicates, failingPredicates: predicates.filter((item) => !item.passed).map((item) => item.name), queryEvidence: record.directQueryIds.map((queryId) => ({ queryId, digest: digest({ queryId, database, runtime, filesystem, external }) })), inventory: { orphanCount: orphanInventory.length, orphanInventory, runtime, filesystem, external }, database };
  return { ...reportCore, reportDigest: digest(reportCore) };
}

export async function evaluateClosure(pool: DatabasePool, record: ClosureRegistryRecord, rootId: string | null, options: ClosureProbeOptions = {}): Promise<ClosureReport> {
  const database = await inSerializableReadOnlyDeferrable(pool, (client) => readDatabaseEvidence(client, record.rootKind, rootId));
  return evaluateClosureRecord(record, database, rootId, options);
}

export async function loadClosureRecords(repositoryRoot = process.cwd()): Promise<ClosureRegistryRecord[]> {
  const registry = await loadRegistry<ClosureRegistryRecord>('CLOSURE_PREDICATE_REGISTRY', repositoryRoot);
  return registry.records;
}

export async function closureReportForRoot(pool: DatabasePool, rootKind: string, rootId: string | null, repositoryRoot = process.cwd(), options: ClosureProbeOptions = {}): Promise<ClosureReport> {
  const record = (await loadClosureRecords(repositoryRoot)).find((candidate) => candidate.rootKind === rootKind && candidate.lifecycle === 'ACTIVE');
  if (!record) throw new Error(`CLOSURE_RECORD_NOT_FOUND:${rootKind}`);
  return evaluateClosure(pool, record, rootId, options);
}

export function closureAstForPredicates(names: readonly ClosurePredicateName[] = [...KNOWN_PREDICATES]): string {
  return JSON.stringify({ op: 'AND', args: names.map((predicate) => ({ predicate })) });
}

export const closurePredicateNames = [...KNOWN_PREDICATES] as readonly ClosurePredicateName[];

/** Every registry query ID is backed by this versioned production evaluator. */
export const closureDirectQueryIds = Object.fromEntries(Object.keys(rootState).map((rootKind) => [
  rootKind,
  [`QUERY-CLOSURE-${rootKind}-DB-V1`, `QUERY-CLOSURE-${rootKind}-RUNTIME-V1`, `QUERY-CLOSURE-${rootKind}-FILESYSTEM-V1`, `QUERY-CLOSURE-${rootKind}-EXTERNAL-V1`]
])) as Record<string, readonly string[]>;
