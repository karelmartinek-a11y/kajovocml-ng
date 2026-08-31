#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ssotPath = join(root, 'SSOT_CURRENT.md');
const checkOnly = process.argv.includes('--check');
const encoder = new TextEncoder();

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function sha(value) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function slug(value) {
  return value.normalize('NFC').toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '') || 'root';
}

function domainFor(chapter, text) {
  const source = `${chapter} ${text}`.toLowerCase();
  const matches = [
    ['OPENAI', /openai|responses api|agents sdk/u],
    ['BROWSER', /browser|playwright|chromium|firefox|webkit|kbpp/u],
    ['POSTGRES', /postgres|transaction|database|sql|constraint|lease|fencing/u],
    ['RUNTIME', /runtime|systemd|linux|uds|ipc|sandbox|cgroup|seccomp/u],
    ['MCP', /\bmcp\b|json-rpc|mrtr/u],
    ['KCIP', /\bkcip\b|pulse protocol/u],
    ['SECURITY', /secret|security|credential|mfa|authority|provenance/u],
    ['GENERATION', /generation|generov|workspace|candidate/u],
    ['DEPLOYMENT', /deploy|release|rollback|backup|restore|nginx|tls|dns/u],
    ['TESTING', /test|acceptance|chaos|fault|oracle|closure/u],
    ['UI', /\bui\b|obrazov|viewport|typograf|tlačít/u],
    ['MONITORING', /monitor|alert|audit|log/u],
    ['AGENT', /agent|handoff|memory/u]
  ];
  return matches.find(([, pattern]) => pattern.test(source))?.[0] ?? 'CORE';
}

function normativeLevel(statement) {
  const lower = statement.toLowerCase();
  if (/nesmí|zakáz|nemůže|není přípust|must not/u.test(lower)) return 'MUST_NOT';
  if (/musí|povinn|vyžaduje|platí|shall/u.test(lower)) return 'MUST';
  if (/should not/u.test(lower)) return 'SHOULD_NOT';
  if (/should|má být|prefer/u.test(lower)) return 'SHOULD';
  if (/může|may/u.test(lower)) return 'MAY';
  return 'DECLARATIVE_CONTRACT';
}

function normalizeStatement(value) {
  return value.normalize('NFC').replace(/\r\n?/gu, '\n').replace(/[ \t]+/gu, ' ').trim();
}

function parseSsot(text) {
  const lines = text.split('\n');
  const atoms = [];
  const operations = [];
  const errors = new Set();
  let chapter = '0';
  let heading = 'SSOT';
  let headingAtom = 0;
  let inFence = false;
  let fenceLanguage = '';
  let inOperationCatalog = false;
  let paragraph = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const statement = normalizeStatement(paragraph.join(' '));
    paragraph = [];
    if (statement.length > 0) atoms.push({ chapter, heading, ordinal: ++headingAtom, statement, context: 'paragraph' });
  };

  for (const raw of lines) {
    const headingMatch = /^(#{1,6})\s+(.+)$/u.exec(raw);
    if (headingMatch && !inFence) {
      flushParagraph();
      heading = normalizeStatement(headingMatch[2]);
      chapter = /^(\d+(?:\.\d+)*)/u.exec(heading)?.[1] ?? chapter;
      headingAtom = 0;
      inOperationCatalog = chapter === '42' || chapter.startsWith('42.');
      continue;
    }
    const fence = /^```\s*([^\s]*)/u.exec(raw);
    if (fence) {
      flushParagraph();
      inFence = !inFence;
      fenceLanguage = inFence ? fence[1] : '';
      continue;
    }
    const trimmed = raw.trim();
    if (!trimmed) {
      flushParagraph();
      continue;
    }

    for (const code of trimmed.matchAll(/\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/gu)) errors.add(code[0]);

    if (inFence) {
      if (/^[a-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+$/u.test(trimmed) && inOperationCatalog) operations.push(trimmed);
      if (fenceLanguage === 'text' || fenceLanguage === 'json' || fenceLanguage === 'sql' || fenceLanguage === 'ini' || fenceLanguage === '') {
        atoms.push({ chapter, heading, ordinal: ++headingAtom, statement: trimmed, context: `code:${fenceLanguage || 'text'}` });
      }
      continue;
    }

    if (/^\|.*\|$/u.test(trimmed)) {
      if (!/^\|?[\s:|-]+\|?$/u.test(trimmed)) atoms.push({ chapter, heading, ordinal: ++headingAtom, statement: trimmed, context: 'table-row' });
      continue;
    }
    const list = /^(?:[-*+] |\d+[.)] )(.+)$/u.exec(trimmed);
    if (list) {
      flushParagraph();
      atoms.push({ chapter, heading, ordinal: ++headingAtom, statement: normalizeStatement(list[1]), context: 'list-item' });
      continue;
    }
    paragraph.push(trimmed);
  }
  flushParagraph();
  return { atoms, operations: [...new Set(operations)], errors: [...errors].sort() };
}

function operationFamily(name) {
  return name.split('.')[0].toUpperCase();
}

function operationMutates(name) {
  return !/(?:\.list|\.get|\.read|\.status|\.query|\.inspect|\.observe|\.discover|\.view|\.catalog|\.evidence|\.verify|\.validate|\.probe|\.report)$/.test(name);
}

function exposureFor(name) {
  if (/^(component\.heartbeat|component\.state\.|component\.control\.|runtime\.|mcp\.request\.|mcp\.subscription\.notify|audit\.stream\.)/u.test(name)) return 'INTERNAL_PROTOCOL';
  if (/^(monitor\.|audit\.|browser\.host\.|browser\.runtimeBuild\.|browser\.frame\.|browser\.document\.|browser\.navigation\.)/u.test(name)) return 'AUTOMATED_MAINTENANCE';
  if (/^(mcp\.|browser\.bridge\.)/u.test(name)) return 'PUBLIC_PROTOCOL';
  if (!operationMutates(name)) return 'OWNER_QUERY';
  return 'OWNER_COMMAND';
}

function rootFor(name) {
  const family = name.split('.')[0];
  const map = {
    component: 'COMPONENT', runtime: 'RUNTIME_INSTANCE', mcp: 'MCP_CALL_RUN', agent: 'AGENT_RUN', secret: 'SECRET_RECORD',
    monitor: 'OPERATIONAL_ALERT', browser: 'BROWSER_SESSION', audit: 'AUDIT_HEAD', chat: 'SYSTEM_CHAT_CONVERSATION',
    ownerApiKey: 'OWNER_IDENTITY', selfTest: 'SELF_TEST_RUN', generation: 'GENERATION_JOB', authority: 'AGENT_RUN', provenance: 'AGENT_RUN', agentic: 'AGENT_RUN'
  };
  const root = map[family];
  if (!root) throw new Error(`NO_AGGREGATE_ROOT_FOR_OPERATION:${name}`);
  return root;
}

function rootForDomain(domain) {
  return {
    OPENAI: 'AGENT_RUN', BROWSER: 'BROWSER_SESSION', RUNTIME: 'RUNTIME_INSTANCE', MCP: 'MCP_CALL_RUN', KCIP: 'COMPONENT',
    SECURITY: 'OWNER_IDENTITY', GENERATION: 'GENERATION_JOB', DEPLOYMENT: 'DEPLOYMENT_RUN', TESTING: 'SELF_TEST_RUN',
    MONITORING: 'OPERATIONAL_ALERT', AGENT: 'AGENT_RUN'
  }[domain] ?? null;
}

function surfaceFor(name) {
  const family = name.split('.')[0];
  return {
    component: 'registered-elements', runtime: 'technical-bindings', mcp: 'mcp', agent: 'agents', secret: 'secrets',
    monitor: 'monitoring', browser: 'browser', audit: 'audit', chat: 'chat', ownerApiKey: 'api', selfTest: 'tests',
    generation: 'generation', authority: 'audit', provenance: 'audit'
  }[family] ?? 'dashboard';
}

function makeRequirement(atom) {
  const domain = domainFor(atom.chapter, atom.statement);
  const subject = `${atom.chapter}:${slug(atom.heading)}`;
  const identity = canonical({
    domain,
    canonicalSubjectKey: subject,
    normalizedNormativeStatement: atom.statement,
    normalizedContext: atom.context,
    normativeLevel: normativeLevel(atom.statement)
  });
  const digest = sha(identity);
  const requirementId = `KCML-REQ-${domain}-${digest.slice(7)}`;
  const sourceRef = `ssot://${atom.chapter}/${slug(atom.heading)}/atom-${atom.ordinal}`;
  return {
    requirementId,
    shortName: `${domain.toLowerCase()}-${atom.chapter}-${atom.ordinal}`,
    domain,
    normativeLevel: normativeLevel(atom.statement),
    authorityRoot: 'SSOT_CURRENT.md',
    ownerIntentRelation: 'OWNER_APPROVED_PRODUCT_CONTRACT',
    canonicalStatement: atom.statement,
    authoritySourceRefs: [sourceRef],
    specializationSourceRefs: [],
    subjectKind: atom.context,
    subjectId: subject,
    domainModule: null,
    aggregateRoots: [],
    stateMachineIds: [],
    operationIds: [],
    apiOperationIds: [],
    uiSurfaceIds: [],
    chatCapabilityIds: [],
    persistenceObjectIds: [],
    bindingIds: [],
    errorCodeIds: [],
    testCaseIds: [],
    acceptanceGateIds: [],
    runtimeEvidenceKinds: [],
    artifactIds: [],
    closurePredicateIds: [],
    status: 'UNMAPPED',
    supersedes: [],
    supersededBy: [],
    canonicalDigest: digest
  };
}

function makeOperation(name, requirementIds) {
  const operationId = `OP-${name.toUpperCase().replaceAll('.', '-')}`;
  const mutates = operationMutates(name);
  const exposureClass = exposureFor(name);
  const sideEffectClass = mutates ? (/delete|deregister|revoke|close|rollback|cancel/u.test(name) ? 'DESTRUCTIVE' : 'LOCAL_STATE_IDEMPOTENT') : 'READ_ONLY';
  return {
    operationId, operationName: name, operationRevision: 1, operationFamily: operationFamily(name), exposureClass,
    canonicalWriterId: `WRITER-${operationFamily(name)}`, aggregateRoot: rootFor(name),
    commandSchemaRef: 'contracts/registry-schemas/operation-command.schema.json', responseSchemaRef: 'contracts/registry-schemas/operation-response.schema.json',
    expectedStates: ['CURRENT'], expectedStateVersionPolicy: mutates ? 'REQUIRED_CAS_OR_COMMUTATIVE_APPEND' : 'READ_CURRENT',
    stateMachineId: `SM-${rootFor(name)}`, allowedTransitionIds: [],
    idempotencyScope: mutates ? 'OPERATION_CALLER_TARGET_KEY' : 'NONE', idempotencyKeySource: mutates ? 'Idempotency-Key' : 'NONE',
    requestDigestProfile: 'KCML-CANONICAL-JSON/1', concurrencyScope: mutates ? rootFor(name) : 'NONE',
    concurrencyKeyDerivation: mutates ? 'TARGET_AGGREGATE_ID' : 'NONE', concurrencyClaimPoint: mutates ? 'ACCEPTANCE' : 'NONE',
    deadlinePolicy: 'ABSOLUTE_BOUNDED', sideEffectClass, subsystemSideEffectClass: sideEffectClass,
    retryClass: mutates ? 'EVIDENCE_DRIVEN' : 'SAFE_READ', retryDirectiveMapRef: 'ERR-RETRY-REGISTRY',
    transactionProfileId: mutates ? 'ONLINE_MUTATION' : 'CONSISTENT_READ', orderedLockPlanId: mutates ? 'LOCK-PLAN-CANONICAL-51-6' : 'LOCK-PLAN-READ',
    fencingPolicy: mutates ? 'CURRENT_PLATFORM_DEPLOYMENT_RECOVERY_STATE_VERSION' : 'NONE', checkpointPolicy: mutates ? 'PRE_AND_POST_SIDE_EFFECT' : 'NONE',
    possibleEffectTrigger: mutates ? 'DOMAIN_COMMIT_OR_DECLARED_ADAPTER_TRIGGER' : 'NONE', reconciliationOracleId: mutates ? 'ORACLE-SIDE-EFFECT' : 'ORACLE-READ',
    cancellationPolicy: mutates ? 'MONOTONIC_INTENT_AND_RECONCILIATION' : 'ABORT_READ', terminalOutcomes: mutates ? ['SUCCEEDED', 'FAILED_FINAL', 'CANCELLED_FINAL', 'MANUAL_REVIEW'] : ['SUCCEEDED'],
    auditEventTypes: [`${name}.requested`, `${name}.completed`], outboxPurposes: mutates ? ['DOMAIN_EVENT'] : [],
    successorPolicy: mutates ? 'UNIQUE_IF_DECLARED' : 'NONE', cleanupPolicy: mutates ? 'CLOSURE_REQUIRED' : 'NONE', activationRelation: 'PIN_CURRENT_EPOCH',
    apiOperationIds: [`API-${name}`], uiActionIds: exposureClass.startsWith('OWNER_') ? [`UI-ACTION-${name}`] : [],
    chatCapabilityIds: exposureClass.startsWith('OWNER_') ? [`CHAT-${name}`] : [], selfTestCaseIds: [`SELFTEST-${name}`],
    acceptanceGateIds: ['GATE-OPERATION-CATALOG'], requirementIds, authoritySourceRefs: ['ssot://42/kcip-operation-catalog/operation'],
    canonicalDigest: sha(canonical({ name, mutates, exposureClass, sideEffectClass }))
  };
}

const stateMachineSpecs = [
  ['COMPONENT', ['DRAFT', 'REVIEW', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'QUARANTINED', 'RETIRED', 'DEREGISTERED'], ['DEREGISTERED']],
  ['GENERATION_JOB', ['DISCUSSING', 'ANALYZING', 'IMPLEMENTING', 'INTEGRATING', 'VALIDATING', 'CML_CONFORMANCE', 'ACTIVATING', 'COMPLETED', 'BLOCKED', 'FAILED', 'CANCELLED'], ['COMPLETED', 'FAILED', 'CANCELLED']],
  ['AGENT_RUN', ['QUEUED', 'PREPARING', 'RUNNING', 'WAITING_FOR_MODEL', 'WAITING_FOR_TOOL', 'WAITING_FOR_OWNER', 'PAUSED', 'CANCEL_REQUESTED', 'MANUAL_REVIEW', 'SUCCEEDED', 'FAILED', 'CANCELLED'], ['SUCCEEDED', 'FAILED', 'CANCELLED']],
  ['MCP_CALL_RUN', ['RECEIVED', 'CLAIMED', 'EXECUTING', 'WAITING_FOR_INPUT', 'WAITING_FOR_TASK', 'RECONCILING', 'CANCEL_REQUESTED', 'MANUAL_REVIEW', 'SUCCEEDED', 'FAILED', 'CANCELLED'], ['SUCCEEDED', 'FAILED', 'CANCELLED']],
  ['MCP_TASK', ['WORKING', 'INPUT_REQUIRED', 'COMPLETED', 'FAILED', 'CANCELLED'], ['COMPLETED', 'FAILED', 'CANCELLED']],
  ['BROWSER_SESSION', ['CREATING', 'READY', 'ACTIVE', 'CHALLENGE_REQUIRED', 'PAUSED', 'RECOVERING', 'CLOSING', 'CLOSED', 'FAILED', 'EXPIRED'], ['CLOSED', 'FAILED', 'EXPIRED']],
  ['BROWSER_ACTION', ['QUEUED', 'VALIDATING', 'CLAIMED', 'INTENT_RECORDED', 'DISPATCHING', 'VERIFYING', 'RECONCILING', 'MANUAL_REVIEW', 'SUCCEEDED', 'FAILED', 'CANCELLED'], ['SUCCEEDED', 'FAILED', 'CANCELLED']],
  ['SIDE_EFFECT', ['INTENT_RECORDED', 'DISPATCHING', 'OUTCOME_RECORDED', 'RECONCILING', 'CONFIRMED_APPLIED', 'CONFIRMED_NOT_APPLIED', 'FAILED_FINAL', 'UNKNOWN'], ['CONFIRMED_APPLIED', 'CONFIRMED_NOT_APPLIED', 'FAILED_FINAL']],
  ['ACTIVATION_SET', ['DRAFT', 'READY', 'SWITCHING', 'VERIFYING', 'ACTIVE', 'ROLLING_BACK', 'ROLLBACK_VERIFYING', 'ROLLED_BACK', 'FAILED', 'MANUAL_REVIEW'], ['ROLLED_BACK', 'FAILED']],
  ['DEPLOYMENT_RUN', ['QUEUED', 'PREPARING', 'BACKED_UP', 'MIGRATING', 'STAGING', 'SWITCHING', 'RESTARTING', 'VERIFYING', 'ACTIVE', 'ROLLING_BACK', 'ROLLED_BACK', 'FAILED', 'MANUAL_REVIEW'], ['ACTIVE', 'ROLLED_BACK', 'FAILED']],
  ['CLEANUP_OPERATION', ['PENDING', 'REVOKING_ADMISSION', 'RECONCILING', 'CAPTURING_FINAL_EVIDENCE', 'RELEASING_BROWSER_RESOURCES', 'RELEASING_PLATFORM_RESOURCES', 'MANUAL_REVIEW', 'COMPLETE', 'FAILED'], ['COMPLETE', 'FAILED']],
  ['PLATFORM_RECOVERY', ['STARTING', 'RECONCILING', 'READY', 'BLOCKED', 'MANUAL_REVIEW'], []],
  ['AI_MODEL_CALL', ['QUEUED', 'SUBMITTING', 'IN_PROGRESS', 'STREAMING', 'WAITING_FOR_TOOL_OUTPUT', 'COMPLETED', 'INCOMPLETE', 'REFUSED', 'CANCEL_REQUESTED', 'CANCELLED', 'FAILED', 'EXPIRED'], ['COMPLETED', 'INCOMPLETE', 'REFUSED', 'CANCELLED', 'FAILED', 'EXPIRED']],
  ['RUNTIME_INSTANCE', ['PREPARING', 'STARTING', 'READY', 'RUNNING', 'DRAINING', 'STOPPED', 'FAILED', 'MANUAL_REVIEW'], ['STOPPED', 'FAILED']],
  ['SECRET_RECORD', ['ACTIVE', 'ROTATING', 'RETIRED', 'CLOSED', 'FAILED'], ['RETIRED', 'CLOSED', 'FAILED']],
  ['OPERATIONAL_ALERT', ['OPEN', 'ACKNOWLEDGED', 'SUPPRESSED', 'RESOLVED', 'CLOSED'], ['RESOLVED', 'CLOSED']],
  ['AUDIT_HEAD', ['ACTIVE', 'VERIFYING', 'ARCHIVING', 'FAILED'], ['FAILED']],
  ['SYSTEM_CHAT_CONVERSATION', ['ACTIVE', 'CANCEL_REQUESTED', 'CANCELLED', 'CLOSED', 'FAILED'], ['CANCELLED', 'CLOSED', 'FAILED']],
  ['OWNER_IDENTITY', ['ACTIVE', 'MFA_ENROLLING', 'MFA_ACTIVE', 'RECOVERY_ROTATING', 'LOCKED'], ['LOCKED']],
  ['SELF_TEST_RUN', ['QUEUED', 'RUNNING', 'PASS', 'FAIL', 'CANCELLED', 'NOT_EXECUTED_ENVIRONMENTAL'], ['PASS', 'FAIL', 'CANCELLED', 'NOT_EXECUTED_ENVIRONMENTAL']]
];

function makeStateMachine([kind, states, terminalStates], operationRecords) {
  const operationIds = operationRecords.filter((op) => op.aggregateRoot === kind).map((op) => op.operationId);
  const transitions = [];
  return {
    stateMachineId: `SM-${kind}`, aggregateKind: kind, aggregateRootTable: kind.toLowerCase(), canonicalWriterId: `WRITER-${kind}`,
    initialStates: [states[0]], states, terminalStates, suspendedDecisionStates: states.filter((s) => s === 'MANUAL_REVIEW' || s === 'BLOCKED'),
    recoveryStates: states.filter((s) => /RECOVER|RECONCIL|MANUAL|BLOCKED/u.test(s)), transitions, forbiddenTransitionPolicy: 'DENY_BY_DEFAULT',
    stateVersionField: 'state_version', cancellationVersionField: 'cancellation_version', fencingFields: ['platform_incarnation_id', 'application_deployment_epoch', 'current_fencing_token'],
    activationFields: ['activation_epoch', 'binding_set_revision_id'], linearizationProfile: 'POSTGRES_SINGLE_COMMIT', lateEvidencePolicy: 'APPEND_ONLY_NO_STATE_CHANGE',
    closurePredicateId: `CLOSURE-${kind}`, operationIds, requirementIds: [], acceptanceGateIds: ['GATE-STATE-MACHINES'],
    authoritySourceRefs: ['ssot://49/formalni-korektnost-stavu-soubehu-a-obnovy/state-machine'], canonicalDigest: sha(canonical({ kind, states, terminalStates, operationIds }))
  };
}

const gates = [
  'ARCH_CROSS_CHAPTER_CONSISTENT', 'ARCH_NORMATIVE_AMBIGUITY_CLOSED', 'ARCH_SINGLE_WRITER_COMPLETE', 'ARCH_OPERATION_LIFECYCLE_COMPLETE',
  'ARCH_POSTGRES_CONTRACT_COMPLETE', 'ARCH_RUNTIME_BOUNDARY_COMPLETE', 'ARCH_PROTOCOL_SEMANTICS_COMPLETE', 'ARCH_OPENAI_LIFECYCLE_COMPLETE',
  'ARCH_BROWSER_LIFECYCLE_COMPLETE', 'ARCH_AGENTIC_AUTHORITY_COMPLETE', 'ARCH_FAILURE_RECOVERY_CONSISTENT', 'ARCH_CONTRACT_PACK_DERIVABLE',
  'ARCH_TRACEABILITY_COMPLETE', 'ARCH_ACCEPTANCE_MACHINE_CHECKABLE', 'ARCH_CLOSURE_PREDICATES_COMPLETE', 'ARCH_NO_OWNER_DECISION_PENDING',
  'ARCH_REPOSITORY_OWNERSHIP_COMPLETE', 'ARCH_EXPOSURE_PARITY_COMPLETE', 'GATE-CONTRACT-PACK', 'GATE-OPERATION-CATALOG', 'GATE-STATE-MACHINES',
  'TRUSTED_RUNTIME_BOUNDARY', 'POSTGRES_CHAOS_PASS', 'OPENAI_CHAOS_PASS', 'BROWSER_CHAOS_PASS', 'PRODUCTION_SHAPED_PASS'
];

const schemas = {
  'common-record.schema.json': {
    $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'kcml://registry/common-record', type: 'object',
    required: ['canonicalDigest'], properties: { canonicalDigest: { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' } }
  },
  'operation-command.schema.json': {
    $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'kcml://operation/command', type: 'object', additionalProperties: false,
    required: ['operation', 'target', 'arguments'], properties: { operation: { type: 'string' }, target: { type: ['string', 'null'] }, arguments: { type: 'object' }, expectedStateVersion: { type: ['integer', 'null'], minimum: 0 } }
  },
  'operation-response.schema.json': {
    $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'kcml://operation/response', type: 'object', additionalProperties: true,
    required: ['correlationId', 'logicalOperationId', 'resultDigest'], properties: { correlationId: { type: 'string', format: 'uuid' }, logicalOperationId: { type: 'string', format: 'uuid' }, resultDigest: { type: 'string' } }
  }
};

async function collectArtifacts(directory = root) {
  const ignored = new Set(['node_modules', 'dist', '.git', 'artifacts']);
  const entries = await readdir(directory, { withFileTypes: true });
  const output = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await collectArtifacts(path));
    else if (entry.isFile() && entry.name !== 'pnpm-lock.yaml' && !path.includes('/contracts/registries/')) output.push(path);
  }
  return output;
}

async function main() {
  const ssotBytes = await readFile(ssotPath);
  const ssot = ssotBytes.toString('utf8');
  const parsed = parseSsot(ssot);
  const requirementMap = new Map();
  for (const atom of parsed.atoms) {
    const record = makeRequirement(atom);
    const existing = requirementMap.get(record.requirementId);
    if (existing) {
      existing.authoritySourceRefs = [...new Set([...existing.authoritySourceRefs, ...record.authoritySourceRefs])].sort();
    } else {
      requirementMap.set(record.requirementId, record);
    }
  }
  const requirements = [...requirementMap.values()].sort((a, b) => a.requirementId.localeCompare(b.requirementId));
  const operations = parsed.operations.map((name) => makeOperation(name, []));
  const stateMachines = stateMachineSpecs.map((spec) => makeStateMachine(spec, operations));
  const postgres = operations.filter((operation) => operation.transactionProfileId !== 'CONSISTENT_READ').map((operation) => ({
    postgresContractId: `PG-${operation.operationId}`, operationId: operation.operationId, transactionProfileId: operation.transactionProfileId,
    isolationLevel: 'READ COMMITTED', transactionSegments: operation.sideEffectClass === 'LOCAL_STATE_IDEMPOTENT' ? ['T1', 'T3'] : ['T1', 'D', 'T2', 'T3'],
    orderedAdvisoryLocks: ['PLATFORM_RECOVERY_BARRIER'], orderedRowLocks: ['PLATFORM', 'DEPLOYMENT', 'IDEMPOTENCY', 'ACTIVATION_DOMAIN', 'AGGREGATE', 'CONCURRENCY', 'CHILD', 'AUDIT'],
    absentRowGuard: 'PARENT_HEAD_AND_UNIQUE_INDEX', readAfterLockGuards: ['DB_TIME', 'STATE_VERSION', 'RECOVERY_EPOCH', 'ACTIVATION_EPOCH'],
    stateVersionCas: true, fencingPredicate: true, platformIncarnationPredicate: true, applicationDeploymentEpochPredicate: true, bindingActivationPredicate: true,
    uniqueConstraints: ['IDEMPOTENCY_SCOPE_KEY', 'LOGICAL_OPERATION'], checkConstraints: ['NON_NEGATIVE_VERSIONS', 'DIGEST_LENGTH'], foreignKeys: ['PARENT_OWNERSHIP'],
    deferredConstraintTriggers: ['TERMINAL_CLOSURE'], idempotencyUniqueness: 'SCOPE_KEY', sequenceAllocation: 'LOCKED_HEAD_INCREMENT', outboxWrites: ['DOMAIN_EVENT'], inboxWrites: [],
    successorReservation: 'UNIQUE_DECLARED_EDGE', successorEnqueue: 'SAME_COMMIT', externalEffectSplit: 'T1_D_E_T2_T3', sqlstateRetryMap: 'ERR-RETRY-REGISTRY',
    migrationImplications: ['FORWARD_ONLY_EXPAND_MIGRATE_VALIDATE_ACTIVATE_CONTRACT'], rollbackCompatibility: 'PREVIOUS_RELEASE_READS_FORWARD_SCHEMA',
    parallelTestIds: [`PG-CONCURRENT-${operation.operationId}`], crashTestIds: [`CRASH-${operation.operationId}`], requirementIds: operation.requirementIds,
    authoritySourceRefs: ['ssot://51/postgresql-transakcni-soubehovy-a-migracni-kontrakt/operation'], canonicalDigest: sha(canonical({ operationId: operation.operationId, profile: operation.transactionProfileId }))
  }));
  const runtimes = ['WEB_API', 'RUNTIME_GATEWAY', 'RUNTIME_HOST', 'GENERATED_HANDLER', 'SECRET_BROKER', 'STATE_BROKER', 'EGRESS_GATEWAY', 'BROWSER_WORKER', 'BROWSER_HOST', 'BRIDGE_GATEWAY', 'OWNER_DEVICE_BRIDGE', 'WORKER'].map((runtimeType) => ({
    runtimeBoundaryId: `RUNTIME-${runtimeType}`, runtimeType, processIdentity: 'KERNEL_SYSTEMD_DB_TUPLE', systemdUnit: `kcml-${runtimeType.toLowerCase().replaceAll('_', '-')}.service`,
    osUser: `kcml-${runtimeType.toLowerCase().replaceAll('_', '-')}`, osGroup: `kcml-${runtimeType.toLowerCase().replaceAll('_', '-')}`, socketOrCapabilityChannels: runtimeType === 'GENERATED_HANDLER' ? ['ANONYMOUS_FD_3'] : ['SYSTEMD_UDS'],
    peerIdentityContract: 'SO_PEERCRED_PIDFD_BOOT_START_INVOCATION_CGROUP', executionContextSource: 'SERVER_COMMITTED',
    allowedNetworkFamilies: runtimeType === 'GENERATED_HANDLER' ? [] : ['AF_UNIX'], allowedEndpoints: [], allowedFilesystemRead: ['/opt/kajovocml-ng/current'],
    allowedFilesystemWrite: runtimeType === 'GENERATED_HANDLER' ? ['/tmp', '/run', '/work'] : ['/var/lib/kajovocml-ng'], allowedCredentials: runtimeType === 'GENERATED_HANDLER' ? [] : ['SYSTEMD_SCOPED'],
    allowedInheritedFds: runtimeType === 'GENERATED_HANDLER' ? [0, 1, 2, 3] : [0, 1, 2], allowedCapabilities: [], seccompProfileDigest: sha(canonical({ runtimeType, profile: 'SYSTEMD_SECCOMP_ALLOWLIST_V1' })),
    namespaceProfileDigest: sha(canonical({ runtimeType, profile: 'SYSTEMD_NAMESPACE_ISOLATION_V1' })), cgroupProfile: 'FINITE_LIMITS',
    prohibitedResources: runtimeType === 'GENERATED_HANDLER' ? ['NETWORK', 'POSTGRES', 'BROKERS', 'BROWSER_HOST', 'HOST_RUN', 'OWNER_API_KEY'] : ['UNDECLARED_RESOURCE'],
    lifecycleStateMachineId: 'SM-RUNTIME_INSTANCE', runtimeGenerationPolicy: 'MONOTONIC', serviceGenerationPolicy: 'SYSTEMD_INVOCATION_ID', staleProcessFencing: 'ALL_WRITES',
    shutdownDrainKillPolicy: 'DRAIN_TERM_KILL_CGROUP_EMPTY', childProcessPolicy: runtimeType === 'GENERATED_HANDLER' ? 'BROKERED_ALIAS_ONLY' : 'DECLARED',
    cleanupPredicateId: 'CLOSURE-RUNTIME_INSTANCE', auditEvidence: ['PEER', 'PROCESS', 'FD', 'NAMESPACE', 'CGROUP'], testIds: [`RUNTIME-TEST-${runtimeType}`],
    requirementIds: [], authoritySourceRefs: ['ssot://50/trusted-runtime-boundary-a-linux-ipc-security/runtime'], canonicalDigest: sha(canonical({ runtimeType }))
  }));
  const errorRecords = parsed.errors.map((code) => ({
    errorCodeId: `ERR-${code}`, code, namespace: code.split('_')[0], classification: /UNKNOWN|CONFLICT|INCOMPLETE/u.test(code) ? 'MANUAL_OR_REFRESH' : 'FIXED',
    canonicalMeaning: code, sideEffectPoint: /OUTCOME|SUBMIT/u.test(code) ? 'POSSIBLE_EFFECT' : 'PRE_DISPATCH', terminalityRule: 'STATE_MACHINE_DEFINED',
    recoveryRuleKind: /OUTCOME|SUBMIT/u.test(code) ? 'EVIDENCE_DECISION_TABLE' : 'FIXED', fixedRetryDirective: /OUTCOME|SUBMIT/u.test(code) ? null : 'DO_NOT_RETRY',
    recoveryDecisionTableId: /OUTCOME|SUBMIT/u.test(code) ? 'RECOVERY-DECISION-POSSIBLE-EFFECT' : null, sameLogicalOperationRequired: true,
    refreshRequired: /STALE/u.test(code), reconciliationRequired: /OUTCOME|SUBMIT/u.test(code), manualReviewRequired: /UNKNOWN/u.test(code),
    requiredSnapshotFields: ['stateVersion', 'activationEpoch', 'recoveryEpoch'], affectedObjectKinds: ['COMPONENT','RUNTIME_INSTANCE','MCP_CALL_RUN','AGENT_RUN','SECRET_RECORD','OPERATIONAL_ALERT','BROWSER_SESSION','GENERATION_JOB','DEPLOYMENT_RUN','SELF_TEST_RUN'], httpMappings: [409], kcipMappings: ['ERROR'], mcpMappings: [-32603],
    uiMessageKey: `errors.${code}`, canonicalOwnerActions: ['OPEN_EVIDENCE'], auditEvidenceKinds: ['ERROR'], testCaseIds: [`ERROR-${code}`], requirementIds: [],
    authoritySourceRefs: ['ssot://32/stable-error-catalog/error'], canonicalDigest: sha(canonical({ code }))
  }));
  const gateRecords = gates.map((gateId) => ({
    gateId, gateKind: gateId.startsWith('ARCH_') ? 'ARCHITECTURE' : 'VALIDATION', blocking: true, subjectScope: 'RELEASE', inputs: ['SSOT', 'CONTRACT_PACK', 'SOURCE', 'TEST_EVIDENCE'], inputDigests: [],
    evaluatorId: `EVALUATOR-${gateId}`, evaluatorVersion: 1, evaluatorDigest: sha(gateId), environmentProfile: gateId.includes('RUNTIME') ? 'SYSTEMD_RUNTIME' : 'BUILD',
    requiredEvidence: ['MACHINE_RESULT'], dependencies: [], passPredicate: 'ALL_OBLIGATIONS_PASS', failCodes: ['GATE_FAILED'], notApplicablePredicate: 'FALSE',
    resultSchemaRef: 'contracts/registry-schemas/common-record.schema.json', requirementIds: [], authoritySourceRefs: ['ssot://55/architecture-readiness-gate-registry/gate'], canonicalDigest: sha(canonical({ gateId }))
  }));
  const closure = stateMachines.map((machine) => ({
    closurePredicateId: `CLOSURE-${machine.aggregateKind}`, rootKind: machine.aggregateKind, terminalStates: machine.terminalStates,
    requiredChildPredicates: ['NO_AUTHORITY_BEARING_PENDING_CHILD'], forbiddenPendingChildKinds: ['LEASE', 'SIDE_EFFECT', 'QUEUE', 'CLEANUP'], forbiddenProvisionalKinds: ['RUNTIME', 'IDENTITY', 'BINDING', 'POINTER'],
    leaseAndFencePredicate: 'NO_ACTIVE_OR_STALE_LEASE', sideEffectPredicate: 'ALL_KNOWN_TERMINAL', pointerAndEpochPredicate: 'NO_MIXED_EPOCH', runtimeProcessPredicate: 'NO_AUTHORITY_PROCESS',
    bindingPredicate: 'CURRENT_EXACT', queueOutboxInboxPredicate: 'NO_MANDATORY_GAP', artifactFilesystemPredicate: 'ALL_REFERENCES_MATCH_DIGEST', cleanupPredicate: 'COMPLETE',
    auditEvidencePredicate: 'CHAIN_VALID', manualReviewPredicate: 'NONE', directQueryIds: [`QUERY-CLOSURE-${machine.aggregateKind}`], passExpression: 'AND_ALL_PREDICATES',
    failureCode: 'TERMINAL_CLOSURE_INCOMPLETE', requirementIds: [], authoritySourceRefs: ['ssot://55/closure-predicate-registry/predicate'], canonicalDigest: sha(canonical({ kind: machine.aggregateKind, terminal: machine.terminalStates }))
  }));
  const exposure = operations.map((operation) => ({
    operationId: operation.operationId, exposureClass: operation.exposureClass, apiOperationIds: operation.apiOperationIds,
    uiSurfaceIds: [`UI-${surfaceFor(operation.operationName)}`], uiActionIds: operation.uiActionIds, chatCapabilityIds: operation.chatCapabilityIds,
    auditEventTypes: operation.auditEventTypes, selfTestCaseIds: operation.selfTestCaseIds, acceptanceGateIds: operation.acceptanceGateIds,
    parentOperationId: operation.exposureClass === 'INTERNAL_PROTOCOL' ? 'OP-COMPONENT-REGISTER' : null, notApplicableReasons: [], requirementIds: operation.requirementIds,
    canonicalDigest: sha(canonical({ operation: operation.operationId, exposure: operation.exposureClass }))
  }));
  const authorities = [...new Set(operations.map((operation) => operation.aggregateRoot))].map((kind) => ({
    authorityObjectKind: kind, canonicalWriterId: `WRITER-${kind}`, ownerModule: 'packages/domain', ownerServiceOrWorker: 'CANONICAL_OPERATION_SERVICE',
    stateMachineId: `SM-${kind}`, allowedOperationIds: operations.filter((operation) => operation.aggregateRoot === kind).map((operation) => operation.operationId),
    authoritativePersistence: ['POSTGRESQL'], acceptedEvidenceProducers: ['TRUSTED_ADAPTER'], prohibitedDirectWriters: ['UI', 'MODEL', 'GENERATED_HANDLER', 'PROVIDER', 'FILESYSTEM'],
    projectionConsumers: ['API', 'UI', 'CHAT', 'MONITORING'], closurePredicateId: `CLOSURE-${kind}`, requirementIds: [],
    authoritySourceRefs: ['ssot://55/authority-ownership-registry/single-writer'], canonicalDigest: sha(canonical({ kind }))
  }));
  // Do not emit inferred directory-level records as traceability evidence. The registry stays empty
  // until a file-level mapping is backed by content digests and bidirectional requirement evidence.
  const artifacts = [];

  const registries = [
    ['REQUIREMENT_REGISTRY', 'requirements/requirements.json', requirements],
    ['OPERATION_CATALOG', 'operations/operations.json', operations],
    ['STATE_MACHINE_REGISTRY', 'state-machines/state-machines.json', stateMachines],
    ['POSTGRES_CONTRACT_MATRIX', 'postgres/postgres-contracts.json', []],
    ['RUNTIME_BOUNDARY_MATRIX', 'runtime-boundaries/runtime-boundaries.json', []],
    ['BINDING_REGISTRY', 'bindings/bindings.json', []],
    ['AUTHORITY_OWNERSHIP_REGISTRY', 'authority/authority-ownership.json', []],
    ['ERROR_RETRY_REGISTRY', 'errors/errors.json', []],
    ['FAULT_CATALOG', 'faults/faults.json', []],
    ['RECOVERY_ORACLE_REGISTRY', 'recovery-oracles/recovery-oracles.json', [{ recoveryOracleId: 'ORACLE-SIDE-EFFECT', subjectId: 'SIDE_EFFECT', observedAuthoritativeStateSchema: 'SIDE_EFFECT_EVIDENCE', requiredEvidence: ['INTENT', 'DISPATCH', 'READ_BACK'], forbiddenEvidenceAssumptions: ['PROCESS_MEMORY', 'MISSING_LOG'], rules: [], defaultOutcome: 'MANUAL_REVIEW', manualReviewSchemaRef: 'contracts/registry-schemas/operation-command.schema.json', conflictingOperationBlockKeys: ['RESOURCE'], closurePredicateId: 'CLOSURE-SIDE_EFFECT', testCaseIds: ['TEST-RECOVERY-ORACLE'], requirementIds: [], authoritySourceRefs: ['ssot://54/recovery-oracle/oracle'], canonicalDigest: sha('ORACLE-SIDE-EFFECT') }]],
    ['CLOSURE_PREDICATE_REGISTRY', 'closure-predicates/closure-predicates.json', []],
    ['ACCEPTANCE_GATE_REGISTRY', 'acceptance-gates/acceptance-gates.json', gateRecords],
    ['EXPOSURE_PARITY_REGISTRY', 'exposure-parity/exposure-parity.json', []],
    ['ARTIFACT_TRACE_REGISTRY', 'artifact-trace/artifact-trace.json', artifacts]
  ];

  const outputs = new Map();
  for (const [name, schema] of Object.entries(schemas)) outputs.set(`contracts/registry-schemas/${name}`, `${canonical(schema)}\n`);
  const schemaManifest = { schemaVersion: '1.0', schemas: Object.keys(schemas).sort().map((name) => ({ ref: `contracts/registry-schemas/${name}`, digest: sha(canonical(schemas[name])) })) };
  schemaManifest.digest = sha(canonical(schemaManifest));
  outputs.set('contracts/registry-schemas/bundle-manifest.json', `${canonical(schemaManifest)}\n`);

  const registryManifest = [];
  for (const [kind, dataRefSuffix, records] of registries) {
    const data = { schemaVersion: '1.0', kind, records };
    const path = `contracts/registries/${dataRefSuffix}`;
    const bytes = `${canonical(data)}\n`;
    outputs.set(path, bytes);
    registryManifest.push({ kind, schemaRef: 'contracts/registry-schemas/common-record.schema.json', dataRef: path, recordCount: records.length, digest: sha(bytes) });
  }

  const scriptBytes = await readFile(fileURLToPath(import.meta.url));
  const manifest = {
    schemaVersion: '1.0', ssotVersion: '2026.08.30.8', ssotDigest: sha(ssotBytes), canonicalization: 'KCML-CANONICAL-JSON/1',
    schemaBundleRef: 'contracts/registry-schemas/bundle-manifest.json', schemaBundleDigest: schemaManifest.digest,
    generatedBy: { compilerId: 'kcml-contract-pack', compilerVersion: '1.0.0', compilerDigest: sha(scriptBytes) }, registries: registryManifest, packDigest: null
  };
  manifest.packDigest = sha(canonical({ ...manifest, packDigest: null }) + registryManifest.map((item) => item.digest).join(''));
  outputs.set('contracts/registries/manifest.json', `${canonical(manifest)}\n`);
  const blockers = [
    { code: 'BINDING_REGISTRY_EMPTY', summary: 'Exact active binding records have not been compiled.' },
    { code: 'FAULT_CATALOG_EMPTY', summary: 'Mandatory failure injection points have not been compiled.' },
    { code: 'RECOVERY_ORACLE_RULES_EMPTY', summary: 'Recovery decision rules have not been compiled.' },
    { code: 'POSTGRES_CONTRACT_MATRIX_EMPTY', summary: 'Verified per-operation PostgreSQL contracts have not been compiled.' },
    { code: 'RUNTIME_BOUNDARY_MATRIX_EMPTY', summary: 'Verified runtime boundary records have not been compiled.' },
    { code: 'AUTHORITY_OWNERSHIP_REGISTRY_EMPTY', summary: 'Verified single-writer ownership records have not been compiled.' },
    { code: 'ERROR_RETRY_REGISTRY_EMPTY', summary: 'Verified error and retry records have not been compiled.' },
    { code: 'CLOSURE_PREDICATE_REGISTRY_EMPTY', summary: 'Executable closure predicates have not been compiled.' },
    { code: 'EXPOSURE_PARITY_REGISTRY_EMPTY', summary: 'Verified exposure parity records have not been compiled.' },
    { code: 'ARTIFACT_TRACE_EMPTY', summary: 'File-level artifact trace evidence has not been compiled.' },
    { code: 'ARCHITECTURE_EVALUATORS_NOT_EXECUTABLE', summary: 'Architecture gate predicates do not have executable evaluators.' }
  ];
  outputs.set('contracts/registries/architecture-readiness.json', `${canonical({
    schemaVersion: '1.0', status: 'FAIL', ssotDigest: manifest.ssotDigest, packDigest: manifest.packDigest, blockers,
    gates: gates.filter((gate) => gate.startsWith('ARCH_')).map((gateId) => ({ gateId, status: 'FAIL', evaluator: null, evidenceDigest: null, blockers: blockers.map((blocker) => blocker.code) }))
  })}\n`);

  const mismatches = [];
  for (const [path, contents] of outputs) {
    const absolute = join(root, path);
    if (checkOnly) {
      let existing = '';
      try { existing = await readFile(absolute, 'utf8'); } catch { mismatches.push(`${path}: missing`); continue; }
      if (existing !== contents) mismatches.push(`${path}: drift`);
    } else {
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, contents, { encoding: 'utf8', mode: 0o644 });
    }
  }
  if (mismatches.length > 0) throw new Error(`CONTRACT_PACK_DRIFT\n${mismatches.join('\n')}`);
  const actualArtifacts = await collectArtifacts();
  process.stdout.write(`${checkOnly ? 'verified' : 'generated'} requirements=${requirements.length} operations=${operations.length} files=${outputs.size} repositoryArtifacts=${actualArtifacts.length} pack=${manifest.packDigest}\n`);
}

await main();
