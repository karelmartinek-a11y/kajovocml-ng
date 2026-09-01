#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ssotPath = join(root, 'SSOT_CURRENT.md');
const checkOnly = process.argv.includes('--check');
const encoder = new TextEncoder();

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

const stableCompare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const stableSort = (values) => [...values].sort(stableCompare);

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

const explicitlyMutatingOperations = new Set(['component.state.report']);
function operationMutates(name) {
  if (explicitlyMutatingOperations.has(name)) return true;
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

const bindingKinds = [
  'CONTRACT_BINDING', 'SECRET_BINDING', 'EXTERNAL_TARGET_BINDING', 'EXTERNAL_AUTH_BINDING',
  'AGENT_TOOL_BINDING', 'BROWSER_ACCOUNT_BINDING', 'BROWSER_PROFILE_ASSIGNMENT',
  'ACTIVATION_SET_MEMBERSHIP', 'ROUTE_BINDING'
];

const bindingKindRequirementIds = {
  CONTRACT_BINDING: ['KCML-REQ-CORE-421aefb2968128abbe831a2ef3d5c63a199595038b6cc4ff910dd4bf4802e1e1'],
  SECRET_BINDING: ['KCML-REQ-SECURITY-6af4ceba4a3e915b580e931d302b75b927dd857e46cc39131fcf4d33930cf0fd'],
  EXTERNAL_TARGET_BINDING: ['KCML-REQ-CORE-328f753d2c136ceeb60f6859f1c4bb0a0f56140f2389b2a7e766457f3df1acdf'],
  EXTERNAL_AUTH_BINDING: ['KCML-REQ-CORE-57be2cf60d6f17482c741fe487507bb0cf58d034f43392194d08e1717c31e13b'],
  AGENT_TOOL_BINDING: ['KCML-REQ-AGENT-34c0c9a8b09fa943672fddbab16e8ff1fdc86e5d275ded9b47f11b9bf3b63f99'],
  BROWSER_ACCOUNT_BINDING: ['KCML-REQ-BROWSER-3362f2a21945b83cf4d84b565b496a1320b959202cf489cc1cb329fc19e6cfaf'],
  BROWSER_PROFILE_ASSIGNMENT: ['KCML-REQ-BROWSER-ba7132830ccdb318cc8ca7092d3eb00346c6afcfdcb245eed72c5738bd150edf'],
  ACTIVATION_SET_MEMBERSHIP: ['KCML-REQ-CORE-bc266cfe7d593f96435b4b3fc09668b63a6db1888b802dc8beb993fe98c123d2'],
  ROUTE_BINDING: ['KCML-REQ-CORE-99a2e88530be6914dc5187021b5fcd3e73febb0c287e166d6aa9e271976df128']
};

const bindingFieldRequirementIds = [
  'KCML-REQ-CORE-0d75563211934c9b82c89d47a99731bfd8f3a6513168e164c65fc09a72f48fba',
  'KCML-REQ-CORE-d73facb7d458a75161fe8996ec03baefae6b83b3fd378047d83529446917457a',
  'KCML-REQ-CORE-df8da19075fc114792785c02392a032c669459ef8bc13b988e0866345c7c74f9',
  'KCML-REQ-CORE-29556598c0436420931013ca687bf4b19ee4461ec33f2a59533523f8ab36994b',
  'KCML-REQ-CORE-d9260a1ec9106d24ac2bcbbdf6e9a0790925fdf2ab21b89f2271b85a41de0c99',
  'KCML-REQ-CORE-a74366a2262e18db31baf53680eff6acf94cf7b341cfab7b2695e897be7d3a39',
  'KCML-REQ-CORE-13513949bc78124858099fad6fa12911062d1ee91a65996d4347402c1b5e7583',
  'KCML-REQ-CORE-042479d02ca66a51642533cd310d4f5410bf769dc12dd826b0e681373919dc40',
  'KCML-REQ-CORE-8838e2d10f7e34437df50893bbb004ee99bae56ebf3ca6d305910d36e7dec1bd',
  'KCML-REQ-CORE-6cb97c27a342689dd61b97177719bc297ab97f5c105d64eecaff26d9e73d4201',
  'KCML-REQ-CORE-7935b8b51787e6d717606cb08e3fb2ab38da7c35e6ad5984c813177df5a04c7b',
  'KCML-REQ-SECURITY-68dff0ec0ec368717a1f695eddfc15f6115db3bd73c9bcf8a3ceb36ab187fa53',
  'KCML-REQ-CORE-54aba225c966c631f7d315ca1bdbe1386a4ed9377e2259b2a5cbf0f19c29c368',
  'KCML-REQ-POSTGRES-5ab6ee19ad6d84a1d6f99a8f98db06b3826431de680e28024618e6ae0df40f40',
  'KCML-REQ-CORE-60e7f02edcc39e91a7c6881e45330270918b9b5b32af9749d3715fa6bcd823ee',
  'KCML-REQ-CORE-c65dd3c14865f6f4707839c4c93aebab568e59169ca45b0c663b46ca14a3203c',
  'KCML-REQ-CORE-ea6dea417c0c0d78758e03ccb4ee8b4c3ae43379e5a442d82462e3edf7d564b0',
  'KCML-REQ-CORE-de2708b7bb566f514a59b7fec24207216cef12db33bc2a4e576518b5ab7a7334',
  'KCML-REQ-CORE-80cba055f24b6b4614c360962a529c648abc334f399602f42ed4ed67ca829461',
  'KCML-REQ-CORE-ab1a0bcfcb6390cb079d9bd6b4a040ea968da84eae724a7ff590086fae27e722',
  'KCML-REQ-CORE-d6cbe58de65f116a67d4fddce90f15c1a832d7b15601c5d8dd50a39a8c26673a',
  'KCML-REQ-SECURITY-164bfc267f83d2535b6d653859cc923d91077c07bdc451a3900dcfdf7ffc9392',
  'KCML-REQ-CORE-249dafee2c01c94ef561c04757f03a9de9e956e74515264653df11d6d613a547',
  'KCML-REQ-CORE-3c0895db94035cd636be2d56f3d907f4a918c4323007b68cb34eea8d8d87410c'
];

function bindingKindForOperation(operation) {
  // Every operation exposure is a route binding. Other binding kinds are
  // declared below against their concrete SSOT persistence objects; they are
  // never inferred from an operation family.
  return 'ROUTE_BINDING';
}

function makeBindingRecord(operation, kind, requirements) {
  const operationId = operation.operationId;
  const bindingId = `BIND-${operationId}`;
  const target = operation.apiOperationIds[0] ?? operation.operationName;
  const bindingIdentity = { bindingId, bindingKind: kind, bindingRevision: 1, sourceRevisionId: 'CANONICAL_OPERATION_SERVICE', targetRevisionId: operationId, targetOperationOrRoute: target, purpose: `operation:${operation.operationName}`, bindingSetRevision: `BINDING-SET-REVISION-${operationId}`, activationSetId: `ACTIVATION-SET-${operationId}`, activationEpoch: 1 };
  return {
    bindingId, bindingKind: kind, bindingRevision: 1, bindingDigest: sha(canonical(bindingIdentity)),
    sourceObjectId: 'CANONICAL_OPERATION_SERVICE', sourceRevisionId: 'CANONICAL_OPERATION_SERVICE', targetObjectId: operation.aggregateRoot,
    targetRevisionId: operationId, targetOperationOrRoute: target, contractSchemaDigest: operation.canonicalDigest,
    secretVersionSelector: kind === 'SECRET_BINDING' ? { selector: 'ACTIVE' } : null,
    externalTargetOrOrigin: ['EXTERNAL_TARGET_BINDING', 'EXTERNAL_AUTH_BINDING', 'BROWSER_ACCOUNT_BINDING'].includes(kind) ? `https://${kind.toLowerCase()}.invalid` : null,
    accountOrTenantConstraint: ['BROWSER_ACCOUNT_BINDING', 'BROWSER_PROFILE_ASSIGNMENT'].includes(kind) ? { account: `account-${kind.toLowerCase()}`, tenant: 'default' } : null,
    purpose: `operation:${operation.operationName}`, lifecycle: 'ACTIVE', bindingSetRevision: `BINDING-SET-REVISION-${operationId}`,
    activationSetId: `ACTIVATION-SET-${operationId}`, activationEpoch: 1, validFrom: '1970-01-01T00:00:00.000Z', validUntil: null,
    canonicalWriterId: operation.canonicalWriterId, targetOperationId: operationId, routeOperationId: target, contractDigest: operation.canonicalDigest,
    exact: true, authoritySourceRefs: ['ssot://55.10/55-10-binding-registry/atom-1', 'ssot://55.10/55-10-binding-registry/atom-36'],
    requirementIds: stableSort([...new Set([...operation.requirementIds, ...(bindingKindRequirementIds[kind] ?? []), ...requirements])])
  };
}

function makeBindingKindCoverageRecords() {
  const concreteKinds = [
    { kind: 'CONTRACT_BINDING', sourceObjectId: 'component', sourceRevisionId: 'component_revision', targetObjectId: 'component_contract_binding', targetRevisionId: 'component_contract_binding', target: 'component_contract_binding', contract: 'component-contract-binding' },
    { kind: 'SECRET_BINDING', sourceObjectId: 'secret_record', sourceRevisionId: 'secret_version', targetObjectId: 'secret_binding', targetRevisionId: 'secret_binding', target: 'secret_binding', contract: 'secret-binding' },
    { kind: 'EXTERNAL_TARGET_BINDING', sourceObjectId: 'component', sourceRevisionId: 'component_revision', targetObjectId: 'external_target', targetRevisionId: 'external_target_binding', target: 'external_target_binding', contract: 'external-target-binding' },
    { kind: 'EXTERNAL_AUTH_BINDING', sourceObjectId: 'component', sourceRevisionId: 'component_revision', targetObjectId: 'external_auth_binding', targetRevisionId: 'external_auth_binding', target: 'external_auth_binding', contract: 'external-auth-binding' },
    { kind: 'AGENT_TOOL_BINDING', sourceObjectId: 'agent_definition', sourceRevisionId: 'agent_revision', targetObjectId: 'agent_tool_binding', targetRevisionId: 'agent_tool_binding', target: 'agent_tool_binding', contract: 'agent-tool-binding' },
    { kind: 'BROWSER_ACCOUNT_BINDING', sourceObjectId: 'browser_automation_definition', sourceRevisionId: 'browser_automation_revision', targetObjectId: 'browser_account_binding', targetRevisionId: 'browser_account_binding', target: 'browser_account_binding', contract: 'browser-account-binding' },
    { kind: 'BROWSER_PROFILE_ASSIGNMENT', sourceObjectId: 'browser_automation_definition', sourceRevisionId: 'browser_automation_revision', targetObjectId: 'browser_session_binding', targetRevisionId: 'browser_session_binding', target: 'browser_session_binding', contract: 'browser-profile-assignment' },
    { kind: 'ACTIVATION_SET_MEMBERSHIP', sourceObjectId: 'generation_activation_set', sourceRevisionId: 'generation_activation_set', targetObjectId: 'generation_activation_member', targetRevisionId: 'generation_activation_member', target: 'generation_activation_member', contract: 'activation-set-membership' }
  ];
  return concreteKinds.map(({ kind, sourceObjectId, sourceRevisionId, targetObjectId, targetRevisionId, target, contract }) => {
    const bindingId = `BINDING-KIND-${kind}`;
    const bindingIdentity = { bindingId, bindingKind: kind, bindingRevision: 1, sourceRevisionId, targetRevisionId, targetOperationOrRoute: target, purpose: `registry:${kind}`, bindingSetRevision: `BINDING-SET-REVISION-${kind}`, activationSetId: `ACTIVATION-SET-${kind}`, activationEpoch: 1 };
    return {
      bindingId, bindingKind: kind, bindingRevision: 1, bindingDigest: sha(canonical(bindingIdentity)), sourceObjectId,
      sourceRevisionId, targetObjectId, targetRevisionId, targetOperationOrRoute: target, contractSchemaDigest: sha(`schema:${contract}`), secretVersionSelector: kind === 'SECRET_BINDING' ? { selector: 'ACTIVE' } : null,
      externalTargetOrOrigin: null, accountOrTenantConstraint: ['BROWSER_ACCOUNT_BINDING', 'BROWSER_PROFILE_ASSIGNMENT'].includes(kind) ? { accountBinding: 'browser_account_binding', profileAssignment: 'browser_session_binding' } : null,
      purpose: `registry:${kind}`, lifecycle: 'ACTIVE', bindingSetRevision: `BINDING-SET-REVISION-${kind}`, activationSetId: `ACTIVATION-SET-${kind}`,
      activationEpoch: 1, validFrom: '1970-01-01T00:00:00.000Z', validUntil: null, canonicalWriterId: 'WRITER-BINDING_SET',
      targetOperationId: null, routeOperationId: null, contractDigest: sha(`contract:${kind}`), exact: true,
      authoritySourceRefs: ['ssot://55.10/55-10-binding-registry/atom-1', 'ssot://55.10/55-10-binding-registry/atom-36'],
      requirementIds: stableSort([...bindingKindRequirementIds[kind], ...bindingFieldRequirementIds])
    };
  });
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
  ['OPERATIONAL_ALERT', ['OPEN', 'ACKNOWLEDGED', 'SUPPRESSED', 'CLOSED'], ['CLOSED']],
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

const sourceEvidenceSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'kcml://registry/source-evidence', type: 'object', additionalProperties: false,
  required: ['sourceRef', 'relationKind', 'canonicalRecordId', 'canonicalRequirementIds', 'relationDigest'],
  properties: {
    sourceRef: { type: 'string', pattern: '^ssot://[^.].*$' },
    relationKind: { enum: ['AUTHORITY', 'SPECIALIZATION', 'REFERENCE'] },
    canonicalRecordId: { type: 'string', minLength: 1 },
    canonicalRequirementIds: { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true },
    relationDigest: { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' }
  }
};

const commonRecordProperties = {
  recordId: { type: 'string', minLength: 1 }, recordKind: { type: 'string', minLength: 1 }, schemaVersion: { const: '1.0' },
  authoritySourceRefs: { type: 'array', items: { type: 'string', pattern: '^ssot://[^.].*$' }, minItems: 1, uniqueItems: true },
  sourceRelations: { type: 'array', items: { $ref: 'kcml://registry/source-evidence' }, minItems: 1 },
  requirementIds: { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true },
  canonicalName: { type: 'string', minLength: 1 }, canonicalDigest: { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' },
  lifecycle: { enum: ['ACTIVE', 'SUPERSEDED', 'RETIRED'] }, supersedes: { type: 'array', items: { type: 'string' }, uniqueItems: true },
  supersededBy: { type: 'array', items: { type: 'string' }, uniqueItems: true }, extensions: { type: 'object' }
};
const commonRequired = ['recordId', 'recordKind', 'schemaVersion', 'authoritySourceRefs', 'sourceRelations', 'requirementIds', 'canonicalName', 'canonicalDigest', 'lifecycle', 'supersedes', 'supersededBy', 'extensions'];
const arrayField = { type: 'array' };
const stringField = { type: 'string' };
const booleanField = { type: 'boolean' };

const registrySchemaRequirements = {
  REQUIREMENT_REGISTRY: ['requirementId', 'shortName', 'domain', 'normativeLevel', 'authorityRoot', 'ownerIntentRelation', 'canonicalStatement', 'specializationSourceRefs', 'subjectKind', 'subjectId', 'domainModule', 'aggregateRoots', 'stateMachineIds', 'operationIds', 'apiOperationIds', 'uiSurfaceIds', 'chatCapabilityIds', 'persistenceObjectIds', 'bindingIds', 'errorCodeIds', 'testCaseIds', 'acceptanceGateIds', 'runtimeEvidenceKinds', 'artifactIds', 'closurePredicateIds', 'status'],
  OPERATION_CATALOG: ['operationId', 'operationName', 'operationRevision', 'operationFamily', 'exposureClass', 'canonicalWriterId', 'aggregateRoot', 'commandSchemaRef', 'responseSchemaRef', 'expectedStates', 'expectedStateVersionPolicy', 'stateMachineId', 'allowedTransitionIds', 'idempotencyScope', 'idempotencyKeySource', 'requestDigestProfile', 'concurrencyScope', 'concurrencyKeyDerivation', 'concurrencyClaimPoint', 'deadlinePolicy', 'sideEffectClass', 'subsystemSideEffectClass', 'retryClass', 'retryDirectiveMapRef', 'transactionProfileId', 'orderedLockPlanId', 'fencingPolicy', 'checkpointPolicy', 'possibleEffectTrigger', 'reconciliationOracleId', 'cancellationPolicy', 'terminalOutcomes', 'auditEventTypes', 'outboxPurposes', 'successorPolicy', 'cleanupPolicy', 'activationRelation', 'apiOperationIds', 'uiActionIds', 'chatCapabilityIds', 'selfTestCaseIds', 'acceptanceGateIds'],
  STATE_MACHINE_REGISTRY: ['stateMachineId', 'aggregateKind', 'aggregateRootTable', 'canonicalWriterId', 'initialStates', 'states', 'terminalStates', 'suspendedDecisionStates', 'recoveryStates', 'transitions', 'forbiddenTransitionPolicy', 'stateVersionField', 'cancellationVersionField', 'fencingFields', 'activationFields', 'linearizationProfile', 'lateEvidencePolicy', 'closurePredicateId', 'operationIds', 'acceptanceGateIds'],
  POSTGRES_CONTRACT_MATRIX: ['postgresContractId', 'operationId', 'transactionProfileId', 'isolationLevel', 'transactionSegments', 'orderedAdvisoryLocks', 'orderedRowLocks', 'absentRowGuard', 'readAfterLockGuards', 'stateVersionCas', 'fencingPredicate', 'platformIncarnationPredicate', 'applicationDeploymentEpochPredicate', 'bindingActivationPredicate', 'uniqueConstraints', 'checkConstraints', 'foreignKeys', 'deferredConstraintTriggers', 'idempotencyUniqueness', 'sequenceAllocation', 'outboxWrites', 'inboxWrites', 'successorReservation', 'successorEnqueue', 'externalEffectSplit', 'sqlstateRetryMap', 'migrationImplications', 'rollbackCompatibility', 'parallelTestIds', 'crashTestIds'],
  RUNTIME_BOUNDARY_MATRIX: ['runtimeBoundaryId', 'runtimeType', 'processIdentity', 'systemdUnit', 'osUser', 'osGroup', 'socketOrCapabilityChannels', 'peerIdentityContract', 'executionContextSource', 'allowedNetworkFamilies', 'allowedEndpoints', 'allowedFilesystemRead', 'allowedFilesystemWrite', 'allowedCredentials', 'allowedInheritedFds', 'allowedCapabilities', 'seccompProfileDigest', 'namespaceProfileDigest', 'cgroupProfile', 'prohibitedResources', 'lifecycleStateMachineId', 'runtimeGenerationPolicy', 'serviceGenerationPolicy', 'staleProcessFencing', 'shutdownDrainKillPolicy', 'childProcessPolicy', 'cleanupPredicateId', 'auditEvidence', 'testIds'],
  BINDING_REGISTRY: ['bindingId', 'bindingKind', 'bindingRevision', 'bindingDigest', 'sourceObjectId', 'sourceRevisionId', 'targetObjectId', 'targetRevisionId', 'targetOperationOrRoute', 'contractSchemaDigest', 'secretVersionSelector', 'externalTargetOrOrigin', 'accountOrTenantConstraint', 'purpose', 'lifecycle', 'bindingSetRevision', 'activationSetId', 'activationEpoch', 'validFrom', 'validUntil', 'canonicalWriterId', 'targetOperationId', 'routeOperationId', 'contractDigest', 'exact'],
  AUTHORITY_OWNERSHIP_REGISTRY: ['authorityObjectKind', 'canonicalWriterId', 'ownerModule', 'ownerServiceOrWorker', 'stateMachineId', 'allowedOperationIds', 'authoritativePersistence', 'acceptedEvidenceProducers', 'prohibitedDirectWriters', 'projectionConsumers', 'closurePredicateId'],
  ERROR_RETRY_REGISTRY: ['errorCodeId', 'code', 'namespace', 'classification', 'canonicalMeaning', 'sideEffectPoint', 'terminalityRule', 'recoveryRuleKind', 'fixedRetryDirective', 'recoveryDecisionTableId', 'sameLogicalOperationRequired', 'refreshRequired', 'reconciliationRequired', 'manualReviewRequired', 'requiredSnapshotFields', 'affectedObjectKinds', 'httpMappings', 'kcipMappings', 'mcpMappings', 'uiMessageKey', 'canonicalOwnerActions', 'auditEvidenceKinds', 'testCaseIds'],
  FAULT_CATALOG: ['faultPointId', 'faultPointName', 'operationId', 'stateMachineId', 'phase', 'side', 'sourceLocation', 'possibleEffectClass', 'applicableFaultKinds', 'expectedRecoveryOracleId', 'expectedCanonicalOutcomeClasses', 'requiredDirectStateQueries', 'requiredCleanupChecks', 'testCaseIds', 'coverageStatus'],
  RECOVERY_ORACLE_REGISTRY: ['recoveryOracleId', 'subjectId', 'observedAuthoritativeStateSchema', 'requiredEvidence', 'forbiddenEvidenceAssumptions', 'rules', 'defaultOutcome', 'manualReviewSchemaRef', 'conflictingOperationBlockKeys', 'closurePredicateId', 'testCaseIds'],
  CLOSURE_PREDICATE_REGISTRY: ['closurePredicateId', 'rootKind', 'terminalStates', 'requiredChildPredicates', 'forbiddenPendingChildKinds', 'forbiddenProvisionalKinds', 'leaseAndFencePredicate', 'sideEffectPredicate', 'pointerAndEpochPredicate', 'runtimeProcessPredicate', 'bindingPredicate', 'queueOutboxInboxPredicate', 'artifactFilesystemPredicate', 'cleanupPredicate', 'auditEvidencePredicate', 'manualReviewPredicate', 'directQueryIds', 'passExpression', 'failureCode'],
  ACCEPTANCE_GATE_REGISTRY: ['gateId', 'gateKind', 'blocking', 'subjectScope', 'inputs', 'inputDigests', 'evaluatorId', 'evaluatorVersion', 'evaluatorDigest', 'environmentProfile', 'requiredEvidence', 'dependencies', 'passPredicate', 'failCodes', 'notApplicablePredicate', 'resultSchemaRef'],
  EXPOSURE_PARITY_REGISTRY: ['operationId', 'exposureClass', 'apiOperationIds', 'uiSurfaceIds', 'uiActionIds', 'chatCapabilityIds', 'auditEventTypes', 'selfTestCaseIds', 'acceptanceGateIds', 'parentOperationId', 'notApplicableReasons'],
  ARTIFACT_TRACE_REGISTRY: ['artifactId', 'artifactKind', 'repositoryPath', 'contentDigest', 'ownerModule', 'operationIds', 'stateMachineIds', 'registryRecordIds', 'testIds', 'releaseIds', 'generatedFrom', 'generationToolDigest', 'lifecycle']
};
const registrySchemaFilenames = {
  REQUIREMENT_REGISTRY: 'requirement-registry.schema.json', OPERATION_CATALOG: 'operation-catalog.schema.json', STATE_MACHINE_REGISTRY: 'state-machine-registry.schema.json',
  POSTGRES_CONTRACT_MATRIX: 'postgres-contract-matrix.schema.json', RUNTIME_BOUNDARY_MATRIX: 'runtime-boundary-matrix.schema.json', BINDING_REGISTRY: 'binding-registry.schema.json',
  AUTHORITY_OWNERSHIP_REGISTRY: 'authority-ownership-registry.schema.json', ERROR_RETRY_REGISTRY: 'error-retry-registry.schema.json', FAULT_CATALOG: 'fault-catalog.schema.json',
  RECOVERY_ORACLE_REGISTRY: 'recovery-oracle-registry.schema.json', CLOSURE_PREDICATE_REGISTRY: 'closure-predicate-registry.schema.json', ACCEPTANCE_GATE_REGISTRY: 'acceptance-gate-registry.schema.json',
  EXPOSURE_PARITY_REGISTRY: 'exposure-parity-registry.schema.json', ARTIFACT_TRACE_REGISTRY: 'artifact-trace-registry.schema.json'
};

const schemaField = (field) => field === 'bindingKind' ? { enum: ['CONTRACT_BINDING', 'SECRET_BINDING', 'EXTERNAL_TARGET_BINDING', 'EXTERNAL_AUTH_BINDING', 'AGENT_TOOL_BINDING', 'BROWSER_ACCOUNT_BINDING', 'BROWSER_PROFILE_ASSIGNMENT', 'ACTIVATION_SET_MEMBERSHIP', 'ROUTE_BINDING'] } : field === 'bindingRevision' ? { type: 'integer', minimum: 1 } : field === 'activationEpoch' ? { type: 'integer', minimum: 0 } : field === 'sourceLocation' ? { type: 'object', required: ['repositoryPath', 'symbol', 'marker', 'line', 'symbolDigest'], properties: { repositoryPath: stringField, symbol: stringField, marker: stringField, line: { type: 'integer', minimum: 1 }, symbolDigest: { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' } }, additionalProperties: false } : field === 'secretVersionSelector' || field === 'accountOrTenantConstraint' ? { type: ['object', 'null'] } : ['targetRevisionId', 'targetOperationId', 'routeOperationId', 'externalTargetOrOrigin', 'validFrom', 'validUntil'].includes(field) ? { type: ['string', 'null'] } : field.endsWith('Ids') || field.endsWith('Refs') || field.endsWith('States') || field.endsWith('Kinds') || field.endsWith('Types') || field.endsWith('Fields') || field.endsWith('Locks') || field.endsWith('Predicates') || field.endsWith('Writes') || field.endsWith('Outcomes') || field.endsWith('Evidence') || field.endsWith('Digests') || field === 'transitions' || field === 'rules' || field === 'inputs' || field === 'dependencies' || field === 'failCodes' || field === 'httpMappings' || field === 'kcipMappings' || field === 'mcpMappings' || field === 'allowedInheritedFds' || field === 'notApplicableReasons' || field === 'requiredChildPredicates' || field === 'forbiddenPendingChildKinds' || field === 'forbiddenProvisionalKinds' || field === 'directQueryIds' || field === 'terminalOutcomes' || field === 'auditEventTypes' || field === 'outboxPurposes' || field === 'auditEvidence' || field === 'expectedCanonicalOutcomeClasses' ? arrayField : field === 'generationToolDigest' ? { type: ['string', 'null'] } : field === 'blocking' || field.endsWith('Predicate') || field === 'stateVersionCas' || field === 'fencingPredicate' || field === 'platformIncarnationPredicate' || field === 'applicationDeploymentEpochPredicate' || field === 'bindingActivationPredicate' || field === 'exact' || field.endsWith('Required') || field === 'refreshRequired' || field === 'reconciliationRequired' || field === 'manualReviewRequired' || field === 'sameLogicalOperationRequired' ? booleanField : field === 'operationRevision' || field === 'evaluatorVersion' ? { type: 'integer' } : stringField;

function makeRegistrySchema(kind) {
  const properties = { ...commonRecordProperties, recordKind: { const: kind } };
  for (const field of registrySchemaRequirements[kind]) if (!(field in properties)) properties[field] = schemaField(field);
  return { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: `kcml://registry/${kind.toLowerCase()}`, type: 'object', additionalProperties: true, required: [...commonRequired, ...registrySchemaRequirements[kind]], properties };
}

const schemas = {
  'source-evidence.schema.json': sourceEvidenceSchema,
  'common-record.schema.json': { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'kcml://registry/common-record', type: 'object', required: commonRequired, properties: { ...commonRecordProperties } },
  'operation-command.schema.json': {
    $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'kcml://operation/command', type: 'object', additionalProperties: false,
    required: ['operation', 'targetId', 'arguments'], properties: { operation: { type: 'string' }, targetId: { type: ['string', 'null'], format: 'uuid' }, arguments: { type: 'object' }, expectedStateVersion: { type: ['integer', 'null'], minimum: 0 }, expectedActivationEpoch: { type: ['integer', 'null'], minimum: 0 }, deadlineAt: { type: ['string', 'null'], format: 'date-time' } }
  },
  'operation-response.schema.json': {
    $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'kcml://operation/response', type: 'object', additionalProperties: true,
    required: ['correlationId', 'logicalOperationId', 'resultDigest'], properties: { correlationId: { type: 'string', format: 'uuid' }, logicalOperationId: { type: 'string', format: 'uuid' }, resultDigest: { type: 'string' } }
  }
};
for (const kind of Object.keys(registrySchemaRequirements)) schemas[registrySchemaFilenames[kind]] = makeRegistrySchema(kind);

async function collectArtifacts(directory = root) {
  const ignored = new Set(['node_modules', 'dist', '.git', 'artifacts']);
  const entries = await readdir(directory, { withFileTypes: true });
  const output = [];
  for (const entry of entries.sort((a, b) => stableCompare(a.name, b.name))) {
    if (ignored.has(entry.name) || entry.name.startsWith('._')) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await collectArtifacts(path));
    else if (entry.isFile() && !path.includes('/contracts/registries/') && !path.includes('/contracts/registry-schemas/') && relative(root, path) !== 'contracts/testing/fault-catalog/catalog.json') output.push(path);
  }
  return output;
}

async function loadFaultPointDeclarations(operations) {
  const declarationPath = 'packages/domain/src/fault-declarations.ts';
  const source = await readFile(join(root, declarationPath), 'utf8');
  const match = source.match(/export const faultPointDeclarations = (\[[\s\S]*?\]) as const satisfies readonly FaultPointDeclaration\[\];/u);
  if (!match) throw new Error('FAULT_DECLARATIONS_SOURCE_NOT_EXPLICIT_JSON');
  let declarations;
  try { declarations = runInNewContext(`(${match[1]})`, Object.create(null), { timeout: 1000 }); } catch (error) { throw new Error(`FAULT_DECLARATIONS_SOURCE_INVALID:${error instanceof Error ? error.message : String(error)}`); }
  if (!Array.isArray(declarations) || declarations.length === 0) throw new Error('FAULT_DECLARATIONS_EMPTY');
  const ids = new Set();
  const names = new Set();
  const records = [];
  for (const declaration of declarations) {
    if (!declaration || typeof declaration !== 'object') throw new Error('FAULT_DECLARATION_INVALID');
    if (ids.has(declaration.faultPointId)) throw new Error(`FAULT_POINT_DUPLICATE:${declaration.faultPointId}`);
    if (names.has(declaration.faultPointName)) throw new Error(`FAULT_POINT_NAME_DUPLICATE:${declaration.faultPointName}`);
    ids.add(declaration.faultPointId); names.add(declaration.faultPointName);
    if (!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9.-]*)+\.(before|after)$/u.test(declaration.faultPointName)) throw new Error(`FAULT_POINT_NAME_INVALID:${declaration.faultPointName}`);
    if (!declaration.sourceLocation || typeof declaration.sourceLocation !== 'object') throw new Error(`FAULT_SOURCE_LOCATION_MISSING:${declaration.faultPointId}`);
    const operation = operations.find((candidate) => candidate.operationName === declaration.operationName);
    if (!operation) throw new Error(`FAULT_OPERATION_MISSING:${declaration.faultPointId}:${declaration.operationName}`);
    const sourcePath = declaration.sourceLocation.repositoryPath;
    const sourceBytes = await readFile(join(root, sourcePath), 'utf8');
    const lines = sourceBytes.split('\n');
    const line = lines.findIndex((candidate) => candidate.includes(declaration.sourceLocation.marker));
    if (line < 0) throw new Error(`FAULT_SOURCE_MARKER_MISSING:${declaration.faultPointId}:${declaration.sourceLocation.marker}`);
    const sourceLocation = { ...declaration.sourceLocation, line: line + 1, symbolDigest: sha(lines[line]) };
    records.push({ ...declaration, sourceLocation, operationId: operation.operationId, stateMachineId: declaration.stateMachineId, requirementIds: stableSort([...new Set([...(operation.requirementIds ?? []), ...(declaration.requirementIds ?? [])])]), authoritySourceRefs: stableSort(declaration.authoritySourceRefs) });
  }
  return records.sort((left, right) => stableCompare(left.faultPointId, right.faultPointId));
}

function registryRecordId(kind, record) {
  const fields = {
    REQUIREMENT_REGISTRY: 'requirementId', OPERATION_CATALOG: 'operationId', STATE_MACHINE_REGISTRY: 'stateMachineId',
    POSTGRES_CONTRACT_MATRIX: 'postgresContractId', RUNTIME_BOUNDARY_MATRIX: 'runtimeBoundaryId', BINDING_REGISTRY: 'bindingId',
    AUTHORITY_OWNERSHIP_REGISTRY: 'authorityObjectKind', ERROR_RETRY_REGISTRY: 'errorCodeId', FAULT_CATALOG: 'faultPointId',
    RECOVERY_ORACLE_REGISTRY: 'recoveryOracleId', CLOSURE_PREDICATE_REGISTRY: 'closurePredicateId', ACCEPTANCE_GATE_REGISTRY: 'gateId',
    EXPOSURE_PARITY_REGISTRY: 'operationId', ARTIFACT_TRACE_REGISTRY: 'artifactId'
  };
  const id = record[fields[kind]];
  if (typeof id !== 'string' || id.length === 0) throw new Error(`REGISTRY_RECORD_ID_MISSING:${kind}`);
  return id;
}

function makeSourceEvidence(sourceRef, relationKind, canonicalRecordId, canonicalRequirementIds) {
  const relation = { sourceRef, relationKind, canonicalRecordId, canonicalRequirementIds: stableSort([...new Set(canonicalRequirementIds)]) };
  return { ...relation, relationDigest: sha(canonical(relation)) };
}

function decorateRecord(kind, record) {
  const recordId = registryRecordId(kind, record);
  const requirementIds = stableSort([...new Set(record.requirementIds ?? [])]);
  const authoritySourceRefs = stableSort([...new Set(record.authoritySourceRefs ?? [])]);
  if (authoritySourceRefs.length === 0) throw new Error(`REGISTRY_AUTHORITY_SOURCE_MISSING:${kind}:${recordId}`);
  const decorated = {
    ...record,
    recordId,
    recordKind: kind,
    schemaVersion: '1.0',
    authoritySourceRefs,
    sourceRelations: authoritySourceRefs.map((sourceRef) => makeSourceEvidence(sourceRef, 'AUTHORITY', recordId, requirementIds)),
    requirementIds,
    canonicalName: record.canonicalName ?? record.operationName ?? record.shortName ?? recordId,
    lifecycle: record.lifecycle ?? 'ACTIVE',
    supersedes: stableSort(record.supersedes ?? []),
    supersededBy: stableSort(record.supersededBy ?? []),
    extensions: record.extensions ?? {}
  };
  const { canonicalDigest: _ignored, ...identity } = decorated;
  return { ...decorated, canonicalDigest: sha(canonical(identity)) };
}

async function main() {
  const ssotBytes = await readFile(ssotPath);
  const ssot = ssotBytes.toString('utf8');
  const compilerDigest = sha(await readFile(fileURLToPath(import.meta.url)));
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
  const requirements = [...requirementMap.values()].sort((a, b) => stableCompare(a.requirementId, b.requirementId));
  const requirementByStatement = new Map(requirements.map((requirement) => [requirement.canonicalStatement, requirement]));
  const operations = parsed.operations.map((name) => {
    const requirement = requirementByStatement.get(name);
    const operation = makeOperation(name, requirement ? [requirement.requirementId] : []);
    if (requirement) {
      requirement.domainModule = 'packages/domain';
      requirement.aggregateRoots = [operation.aggregateRoot];
      requirement.stateMachineIds = [`SM-${operation.aggregateRoot}`];
      requirement.operationIds = [operation.operationId];
      requirement.apiOperationIds = operation.apiOperationIds;
      requirement.uiSurfaceIds = operation.uiActionIds;
      requirement.chatCapabilityIds = operation.chatCapabilityIds;
      requirement.persistenceObjectIds = [operation.aggregateRoot];
      requirement.bindingIds = [`BIND-${operation.operationId}`];
      requirement.testCaseIds = [`TEST-OPERATION-CATALOG-${operation.operationId}`];
      requirement.acceptanceGateIds = ['GATE-OPERATION-CATALOG'];
      requirement.closurePredicateIds = [`CLOSURE-${operation.aggregateRoot}`];
      requirement.status = 'ACTIVE';
    }
    return operation;
  });
  const faultPoints = await loadFaultPointDeclarations(operations);
  const generatedFaultTestCatalog = { schemaVersion: '1.0', generatedFrom: 'packages/domain/src/fault-declarations.ts', generationToolDigest: compilerDigest, faultPoints: faultPoints.map(({ operationName: _operationName, ...point }) => ({ ...point, expectedOutcome: point.expectedCanonicalOutcomeClasses.join('|') })) };
  const generatedFaultTestCatalogBytes = `${canonical(generatedFaultTestCatalog)}\n`;
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
  const runtimeMatrixSourcePath = 'deploy/runtime/runtime-boundary-manifest.json';
  const runtimeMatrixSource = JSON.parse(await readFile(join(root, runtimeMatrixSourcePath), 'utf8'));
  if (runtimeMatrixSource.schemaVersion !== '1.0' || !Array.isArray(runtimeMatrixSource.runtimeTypes) || runtimeMatrixSource.runtimeTypes.length === 0) {
    throw new Error('RUNTIME_BOUNDARY_MATRIX_SOURCE_INVALID');
  }
  const runtimeTestPath = 'tests/runtime-boundary/matrix.test.ts';
  const runtimeTestLines = (await readFile(join(root, runtimeTestPath), 'utf8')).split('\n');
  const runtimeRecords = [];
  const runtimeEvidenceRecords = [];
  const runtimeTypeIds = new Set();
  for (const sourceRecord of runtimeMatrixSource.runtimeTypes) {
    if (runtimeTypeIds.has(sourceRecord.runtimeType)) throw new Error(`RUNTIME_BOUNDARY_DUPLICATE_TYPE:${sourceRecord.runtimeType}`);
    runtimeTypeIds.add(sourceRecord.runtimeType);
    const requiredFields = ['runtimeBoundaryId', 'runtimeType', 'processIdentity', 'systemdUnit', 'osUser', 'osGroup', 'socketOrCapabilityChannels', 'peerIdentityContract', 'executionContextSource', 'allowedNetworkFamilies', 'allowedEndpoints', 'allowedFilesystemRead', 'allowedFilesystemWrite', 'allowedCredentials', 'allowedInheritedFds', 'allowedCapabilities', 'cgroupProfile', 'prohibitedResources', 'lifecycleStateMachineId', 'runtimeGenerationPolicy', 'serviceGenerationPolicy', 'staleProcessFencing', 'shutdownDrainKillPolicy', 'childProcessPolicy', 'cleanupPredicateId', 'auditEvidence', 'testIds', 'requirementRefs', 'evidence'];
    for (const field of requiredFields) if (!(field in sourceRecord)) throw new Error(`RUNTIME_BOUNDARY_FIELD_MISSING:${sourceRecord.runtimeType}:${field}`);
    if (sourceRecord.prohibitedResources.length === 0) throw new Error(`RUNTIME_BOUNDARY_PROHIBITIONS_EMPTY:${sourceRecord.runtimeType}`);
    const evidence = sourceRecord.evidence;
    const concreteSourcePaths = evidence.sourcePaths.filter((sourcePath) => sourcePath !== runtimeMatrixSourcePath);
    if (concreteSourcePaths.length === 0) throw new Error(`RUNTIME_BOUNDARY_CONCRETE_SOURCE_MISSING:${sourceRecord.runtimeType}`);
    for (const sourcePath of evidence.sourcePaths) {
      await readFile(join(root, sourcePath));
    }
    for (const marker of evidence.sourceMarkers) {
      let found = false;
      for (const sourcePath of concreteSourcePaths) {
        const lines = (await readFile(join(root, sourcePath), 'utf8')).split('\n');
        const lineIndex = lines.findIndex((line) => line.includes(marker));
        if (lineIndex >= 0) {
          found = true;
          break;
        }
      }
      if (!found) throw new Error(`RUNTIME_BOUNDARY_SOURCE_MARKER_MISSING:${sourceRecord.runtimeType}:${marker}`);
    }
    const testLineIndex = runtimeTestLines.findIndex((line) => line.includes(evidence.testMarker));
    if (testLineIndex < 0) throw new Error(`RUNTIME_BOUNDARY_TEST_MARKER_MISSING:${sourceRecord.runtimeType}:${evidence.testMarker}`);
    const requirementIds = [];
    for (const requirementRef of sourceRecord.requirementRefs) {
      const requirement = requirements.find((candidate) => candidate.authoritySourceRefs.includes(requirementRef));
      if (!requirement) throw new Error(`RUNTIME_BOUNDARY_REQUIREMENT_MISSING:${sourceRecord.runtimeType}:${requirementRef}`);
      requirementIds.push(requirement.requirementId);
    }
    const record = { ...sourceRecord };
    delete record.requirementRefs;
    delete record.evidence;
    record.requirementIds = [...new Set(requirementIds)].sort();
    record.authoritySourceRefs = [...new Set([...(runtimeMatrixSource.authoritySourceRefs ?? []), ...sourceRecord.requirementRefs])].sort();
    if (record.runtimeType === 'GENERATED_HANDLER') {
      const launcherBytes = await readFile(join(root, 'deploy/runtime/kcml-sandbox-launcher.c'));
      record.seccompProfileDigest = sha(launcherBytes);
      record.namespaceProfileDigest = sha(canonical({ source: 'deploy/runtime/kcml-sandbox-launcher.c', profile: 'KCML_GENERATED_HANDLER_NAMESPACE_PROFILE_V1' }));
      record.seccompProfileDigestSource = 'deploy/runtime/kcml-sandbox-launcher.c:KCML_GENERATED_NODE_SECCOMP_PROFILE_V1';
      record.namespaceProfileDigestSource = 'deploy/runtime/kcml-sandbox-launcher.c:KCML_GENERATED_HANDLER_NAMESPACE_PROFILE_V1';
    } else {
      const unitSourcePath = sourceRecord.evidence.sourcePaths.find((sourcePath) => /\.service(?:\.in)?$/u.test(sourcePath)) ?? sourceRecord.evidence.sourcePaths[0];
      const unitBytes = await readFile(join(root, unitSourcePath));
      record.seccompProfileDigest = sha(unitBytes);
      record.namespaceProfileDigest = sha(unitBytes);
      record.seccompProfileDigestSource = unitSourcePath;
      record.namespaceProfileDigestSource = unitSourcePath;
    }
    record.canonicalDigest = sha(canonical(record));
    runtimeRecords.push(record);
    runtimeEvidenceRecords.push({ sourceRecord, requirementIds, testLineIndex });
  }
  const runtimes = runtimeRecords;
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
    authoritySourceRefs: ['ssot://55/ui-api-chat-audit-self-test-parity/exposure-parity'],
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
  const addArtifact = (repositoryPath, bytes, options = {}) => {
    const contentDigest = sha(bytes);
    const artifactId = `ART-${sha(`${repositoryPath}\u0000${contentDigest}`).slice(7)}`;
    const ownerModule = repositoryPath.split('/')[0] === 'packages' ? repositoryPath.split('/').slice(0, 2).join('/') : repositoryPath.split('/')[0];
    artifacts.push({ artifactId, artifactKind: options.artifactKind ?? 'REPOSITORY_FILE', repositoryPath, contentDigest, ownerModule,
      operationIds: [], stateMachineIds: [], registryRecordIds: [], testIds: [], releaseIds: [], generatedFrom: options.generatedFrom ?? [], generationToolDigest: options.generationToolDigest ?? null,
      lifecycle: 'ACTIVE', requirementIds: [], evidenceRefs: [`file://${repositoryPath}`], reverseTraceRequired: true, traceAnchors: [],
      authoritySourceRefs: options.authoritySourceRefs ?? ['ssot://55/artifact-traceability/file-level'], canonicalDigest: sha(canonical({ repositoryPath, contentDigest })) });
  };
  for (const artifactPath of await collectArtifacts()) {
    const bytes = await readFile(artifactPath);
    const repositoryPath = relative(root, artifactPath).replaceAll('\\', '/');
    // Content digests remain the evidence identity; artifact IDs additionally
    // include the repository path so identical project configuration files do
    // not collapse into duplicate registry records.
    addArtifact(repositoryPath, bytes);
  }
  addArtifact('contracts/testing/fault-catalog/catalog.json', generatedFaultTestCatalogBytes, { artifactKind: 'GENERATED_FAULT_CATALOG', generatedFrom: ['packages/domain/src/fault-declarations.ts'], generationToolDigest: compilerDigest, authoritySourceRefs: ['ssot://55.11/fault-catalog'] });
  const faultCatalogArtifact = artifacts.at(-1);
  const faultRequirementIds = stableSort([...new Set(faultPoints.flatMap((point) => point.requirementIds))]);
  if (!faultCatalogArtifact) throw new Error('FAULT_CATALOG_ARTIFACT_MISSING');
  faultCatalogArtifact.requirementIds = faultRequirementIds;
  faultCatalogArtifact.operationIds = stableSort([...new Set(faultPoints.map((point) => point.operationId))]);
  faultCatalogArtifact.registryRecordIds = faultPoints.map((point) => point.faultPointId).sort();
  faultCatalogArtifact.testIds = stableSort([...new Set(faultPoints.flatMap((point) => point.testCaseIds))]);
  for (const requirementId of faultRequirementIds) {
    const requirement = requirementMap.get(requirementId);
    if (!requirement) throw new Error(`FAULT_REQUIREMENT_MISSING:${requirementId}`);
    requirement.artifactIds = stableSort([...new Set([...(requirement.artifactIds ?? []), faultCatalogArtifact.artifactId])]);
  }
  const artifactByPath = new Map(artifacts.map((artifact) => [artifact.repositoryPath, artifact]));
  const touchedTraceArtifacts = new Set();
  const traceArtifact = (repositoryPath) => {
    const artifact = artifactByPath.get(repositoryPath);
    if (!artifact) throw new Error(`TRACE_ARTIFACT_MISSING:${repositoryPath}`);
    artifact.traceAnchors ??= [];
    touchedTraceArtifacts.add(artifact);
    return artifact;
  };
  const appendTrace = (artifact, requirementId, locator, symbol, snippet) => {
    artifact.traceAnchors.push({ requirementId, locator, symbol, snippetDigest: sha(snippet) });
    artifact.requirementIds.push(requirementId);
  };
  const runtimeMatrixArtifact = traceArtifact(runtimeMatrixSourcePath);
  const runtimeTestArtifact = traceArtifact(runtimeTestPath);
  const runtimeMatrixLines = (await readFile(join(root, runtimeMatrixSourcePath), 'utf8')).split('\n');
  for (const { sourceRecord, requirementIds, testLineIndex } of runtimeEvidenceRecords) {
    for (const requirementId of requirementIds) {
      const requirement = requirementMap.get(requirementId);
      if (!requirement) throw new Error(`RUNTIME_BOUNDARY_REQUIREMENT_LOOKUP_FAILED:${sourceRecord.runtimeType}:${requirementId}`);
      requirement.domainModule = 'packages/runtime-boundary';
      requirement.runtimeEvidenceKinds = ['RUNTIME_BOUNDARY_MATRIX', 'SYSTEMD_UNIT_IDENTITY', 'LINUX_BEHAVIORAL_EVIDENCE'];
      requirement.testCaseIds = [...new Set(sourceRecord.testIds)];
      requirement.acceptanceGateIds = ['TRUSTED_RUNTIME_BOUNDARY', 'GATE-CONTRACT-PACK'];
      const evidenceArtifacts = new Set([runtimeMatrixArtifact.artifactId, runtimeTestArtifact.artifactId]);
      for (const sourcePath of sourceRecord.evidence.sourcePaths) evidenceArtifacts.add(traceArtifact(sourcePath).artifactId);
      requirement.artifactIds = [...evidenceArtifacts].sort();
      requirement.status = 'ACTIVE';
      const runtimeMatrixLineIndex = runtimeMatrixLines.findIndex((line) => line.includes(`"runtimeBoundaryId": "${sourceRecord.runtimeBoundaryId}"`));
      if (runtimeMatrixLineIndex < 0) throw new Error(`RUNTIME_BOUNDARY_MATRIX_LOCATOR_MISSING:${sourceRecord.runtimeType}`);
      appendTrace(runtimeMatrixArtifact, requirementId, `${runtimeMatrixSourcePath}:${runtimeMatrixLineIndex + 1}`, sourceRecord.runtimeBoundaryId, runtimeMatrixLines[runtimeMatrixLineIndex]);
      appendTrace(runtimeTestArtifact, requirementId, `${runtimeTestPath}:${testLineIndex + 1}`, sourceRecord.evidence.testMarker, runtimeTestLines[testLineIndex]);
      for (const marker of sourceRecord.evidence.sourceMarkers) {
        for (const sourcePath of sourceRecord.evidence.sourcePaths.filter((candidate) => candidate !== runtimeMatrixSourcePath)) {
          const sourceLines = (await readFile(join(root, sourcePath), 'utf8')).split('\n');
          const sourceLineIndex = sourceLines.findIndex((line) => line.includes(marker));
          if (sourceLineIndex >= 0) {
            appendTrace(traceArtifact(sourcePath), requirementId, `${sourcePath}:${sourceLineIndex + 1}`, marker, sourceLines[sourceLineIndex]);
            break;
          }
        }
      }
    }
  }
  const handlerPath = 'packages/domain/src/operation-handler-catalog.ts';
  const testPath = 'tests/operations/catalog-coverage.test.ts';
  const handlerArtifact = traceArtifact(handlerPath);
  const testArtifact = traceArtifact(testPath);
  const handlerLines = (await readFile(join(root, handlerPath), 'utf8')).split('\n');
  const testLines = (await readFile(join(root, testPath), 'utf8')).split('\n');
  const testLineIndex = testLines.findIndex((line) => line.includes('it.each(catalog.records'));
  if (testLineIndex < 0) throw new Error('OPERATION_TRACE_TEST_ANCHOR_MISSING');
  for (const operation of operations) {
    const requirement = requirementMap.get(operation.requirementIds[0]);
    if (!requirement) throw new Error(`OPERATION_REQUIREMENT_MISSING:${operation.operationName}`);
    const lineIndex = handlerLines.findIndex((line) => line.includes(`{operation:'${operation.operationName}'`));
    if (lineIndex < 0) throw new Error(`OPERATION_HANDLER_TRACE_ANCHOR_MISSING:${operation.operationName}`);
    appendTrace(handlerArtifact, requirement.requirementId, `${handlerPath}:${lineIndex + 1}`, operation.operationName, handlerLines[lineIndex]);
    appendTrace(testArtifact, requirement.requirementId, `${testPath}:${testLineIndex + 1}`, `TEST-OPERATION-CATALOG-${operation.operationId}`, testLines[testLineIndex]);
    handlerArtifact.operationIds.push(operation.operationId);
    testArtifact.operationIds.push(operation.operationId);
    testArtifact.testIds.push(`TEST-OPERATION-CATALOG-${operation.operationId}`);
    handlerArtifact.registryRecordIds.push(operation.operationId);
    requirement.artifactIds = [handlerArtifact.artifactId, testArtifact.artifactId];
    requirement.runtimeEvidenceKinds = ['DECLARED_HANDLER_BINDING', 'CATALOG_STRUCTURE_TEST'];
  }

  const bindingRegistryPath = 'packages/domain/src/binding-registry.ts';
  const bindingRegistryTestPath = 'tests/bindings/registry.test.ts';
  const bindingRegistryArtifact = traceArtifact(bindingRegistryPath);
  const bindingRegistryTestArtifact = traceArtifact(bindingRegistryTestPath);
  const bindingRegistryLines = (await readFile(join(root, bindingRegistryPath), 'utf8')).split('\n');
  const bindingRegistryTestLines = (await readFile(join(root, bindingRegistryTestPath), 'utf8')).split('\n');
  const bindingSourceLineIndex = bindingRegistryLines.findIndex((line) => line.includes('export function pinRuntimeBinding'));
  const bindingTestLineIndex = bindingRegistryTestLines.findIndex((line) => line.includes("describe('TD-04 exact binding registry and runtime pinning'"));
  if (bindingSourceLineIndex < 0 || bindingTestLineIndex < 0) throw new Error('BINDING_REGISTRY_TRACE_ANCHOR_MISSING');
  const bindingRequirementIds = stableSort([...new Set([...Object.values(bindingKindRequirementIds).flat(), ...bindingFieldRequirementIds])]);
  for (const requirementId of bindingRequirementIds) {
    const requirement = requirementMap.get(requirementId);
    if (!requirement) throw new Error(`BINDING_REGISTRY_REQUIREMENT_LOOKUP_FAILED:${requirementId}`);
    appendTrace(bindingRegistryArtifact, requirementId, `${bindingRegistryPath}:${bindingSourceLineIndex + 1}`, 'pinRuntimeBinding', bindingRegistryLines[bindingSourceLineIndex]);
    appendTrace(bindingRegistryTestArtifact, requirementId, `${bindingRegistryTestPath}:${bindingTestLineIndex + 1}`, 'TD-04 exact binding registry and runtime pinning', bindingRegistryTestLines[bindingTestLineIndex]);
    requirement.artifactIds = stableSort([...new Set([...requirement.artifactIds, bindingRegistryArtifact.artifactId, bindingRegistryTestArtifact.artifactId])]);
    requirement.testCaseIds = stableSort([...new Set([...requirement.testCaseIds, 'TEST-BINDING-REGISTRY-EXACT-PINNING'])]);
    requirement.runtimeEvidenceKinds = stableSort([...new Set([...requirement.runtimeEvidenceKinds, 'EXACT_BINDING_REGISTRY', 'RUNTIME_BINDING_PIN'])]);
  }
  bindingRegistryArtifact.operationIds.push(...operations.map((operation) => operation.operationId));
  bindingRegistryArtifact.registryRecordIds.push(...operations.map((operation) => `BIND-${operation.operationId}`), ...bindingKinds.map((kind) => `BINDING-KIND-${kind}`));
  bindingRegistryTestArtifact.testIds.push('TEST-BINDING-REGISTRY-EXACT-PINNING');

  const exactOperationEvidence = [
    { operationName: 'component.register', sourcePath: 'packages/domain/src/component-operations.ts', sourceMarker: "context.operationName === 'component.register'", testPath: 'tests/integration/run.ts', testMarker: 'COMPONENT_TERMINAL_REPLAY_INCOMPLETE', testCaseId: 'TEST-COMPONENT-REGISTER-LIFECYCLE' },
    { operationName: 'component.revision.publish', sourcePath: 'packages/domain/src/component-operations.ts', sourceMarker: "context.operationName === 'component.revision.publish'", testPath: 'tests/integration/run.ts', testMarker: 'COMPONENT_REVISION_LIFECYCLE_INVALID', testCaseId: 'TEST-COMPONENT-REVISION-PUBLISH-LIFECYCLE' },
    { operationName: 'component.heartbeat', sourcePath: 'packages/domain/src/component-operations.ts', sourceMarker: "context.operationName === 'component.heartbeat'", testPath: 'tests/integration/run.ts', testMarker: 'COMPONENT_HEARTBEAT_CONFLICT_NOT_TERMINAL', testCaseId: 'TEST-COMPONENT-HEARTBEAT-DEDUPE-STALE-CONFLICT' },
    { operationName: 'component.validate', sourcePath: 'packages/domain/src/component-operations.ts', sourceMarker: "operationName==='component.validate'", testPath: 'tests/integration/run.ts', testMarker: 'COMPONENT_VALIDATE_QUERY_INVALID', testCaseId: 'TEST-COMPONENT-VALIDATE-QUERY' },
    { operationName: 'component.verify', sourcePath: 'packages/domain/src/component-operations.ts', sourceMarker: "operationName==='component.verify'", testPath: 'tests/integration/run.ts', testMarker: 'COMPONENT_VERIFY_GATE_INCORRECT', testCaseId: 'TEST-COMPONENT-VERIFY-GATE' },
    { operationName: 'component.state.query', sourcePath: 'packages/domain/src/component-operations.ts', sourceMarker: "operationName==='component.state.query'", testPath: 'tests/integration/run.ts', testMarker: 'COMPONENT_STATE_QUERY_STALE_SNAPSHOT_ACCEPTED', testCaseId: 'TEST-COMPONENT-STATE-QUERY-SNAPSHOT-FENCE' },
    { operationName: 'component.state.report', sourcePath: 'packages/domain/src/component-operations.ts', sourceMarker: "context.operationName==='component.state.report'", testPath: 'tests/integration/run.ts', testMarker: 'COMPONENT_STATE_REPORT_CONFLICT_NOT_TERMINAL', testCaseId: 'TEST-COMPONENT-STATE-REPORT-DEDUPE-SCHEMA-LINEAGE' },
    { operationName: 'component.suspend', sourcePath: 'packages/domain/src/component-operations.ts', sourceMarker: "context.operationName==='component.suspend'", testPath: 'tests/integration/run.ts', testMarker: 'COMPONENT_SUSPEND_BARRIER_INVALID', testCaseId: 'TEST-COMPONENT-SUSPEND-ADMISSION-BARRIER' },
    { operationName: 'component.quarantine', sourcePath: 'packages/domain/src/component-operations.ts', sourceMarker: "context.operationName==='component.quarantine'", testPath: 'tests/integration/run.ts', testMarker: 'COMPONENT_QUARANTINE_PROJECTION_INVALID', testCaseId: 'TEST-COMPONENT-QUARANTINE-PROJECTION' },
    { operationName: 'component.restore', sourcePath: 'packages/domain/src/component-operations.ts', sourceMarker: "context.operationName==='component.restore'", testPath: 'tests/integration/run.ts', testMarker: 'COMPONENT_RESTORE_ACTIVE_INVALID', testCaseId: 'TEST-COMPONENT-RESTORE-READINESS-BARRIER' },
    { operationName: 'component.recertify', sourcePath: 'packages/domain/src/component-operations.ts', sourceMarker: "context.operationName==='component.recertify'", testPath: 'tests/integration/run.ts', testMarker: 'COMPONENT_RECERTIFY_INVALID', testCaseId: 'TEST-COMPONENT-RECERTIFY-READINESS' },
    { operationName: 'component.deregister', sourcePath: 'packages/domain/src/component-operations.ts', sourceMarker: "context.operationName==='component.deregister'", testPath: 'tests/integration/run.ts', testMarker: 'COMPONENT_DEREGISTER_CLOSURE_EVIDENCE_INCOMPLETE', testCaseId: 'TEST-COMPONENT-DEREGISTER-TERMINAL-CLOSURE' },
    { operationName: 'runtime.boundary.verify', sourcePath: 'packages/domain/src/runtime-operations.ts', sourceMarker: 'async function verifyRuntimeBoundary', testPath: 'tests/integration/run.ts', testMarker: 'RUNTIME_BOUNDARY_EXACT_VERIFICATION_INVALID', testCaseId: 'TEST-RUNTIME-BOUNDARY-PERSISTED-AUTHORITY', runtimeEvidenceKinds: ['EXACT_OPERATION_HANDLER','POSTGRES_CONSISTENT_READ_INTEGRATION','NEGATIVE_INVARIANT_EVALUATION'] },
    { operationName: 'runtime.connection.inspect', sourcePath: 'packages/domain/src/runtime-operations.ts', sourceMarker: 'async function inspectRuntimeConnection', testPath: 'tests/integration/run.ts', testMarker: 'RUNTIME_CONNECTION_EXACT_INSPECTION_INVALID', testCaseId: 'TEST-RUNTIME-CONNECTION-EVIDENCE-INSPECTION', runtimeEvidenceKinds: ['EXACT_OPERATION_HANDLER','POSTGRES_CONSISTENT_READ_INTEGRATION','IPC_EVIDENCE_CORRELATION'] },
    { operationName: 'secret.usage.report', sourcePath: 'packages/domain/src/secret-operations.ts', sourceMarker: 'async function reportSecretUsage', testPath: 'tests/integration/run.ts', testMarker: 'SECRET_USAGE_REPORT_INVALID', testCaseId: 'TEST-SECRET-USAGE-CONSISTENT-SNAPSHOT', runtimeEvidenceKinds: ['EXACT_OPERATION_HANDLER','POSTGRES_CONSISTENT_READ_INTEGRATION','SECRET_VALUE_NON_DISCLOSURE'] },
    { operationName: 'ownerApiKey.read', sourcePath: 'packages/domain/src/secret-operations.ts', sourceMarker: 'async function readOwnerApiKey', testPath: 'tests/integration/run.ts', testMarker: 'OWNER_API_KEY_READ_INVALID', testCaseId: 'TEST-OWNER-API-KEY-POINTER-CONSISTENCY', runtimeEvidenceKinds: ['EXACT_OPERATION_HANDLER','POSTGRES_CONSISTENT_READ_INTEGRATION','SECRET_VALUE_NON_DISCLOSURE'] },
    { operationName: 'selfTest.catalog.list', sourcePath: 'packages/domain/src/self-test-operations.ts', sourceMarker: 'async function listCatalog', testPath: 'tests/integration/run.ts', testMarker: 'SELF_TEST_CATALOG_LIST_INVALID', testCaseId: 'TEST-SELF-TEST-CATALOG-EXACT-CONTRACTS', runtimeEvidenceKinds: ['EXACT_OPERATION_HANDLER','POSTGRES_CONSISTENT_READ_INTEGRATION','SELF_TEST_CATALOG_EVIDENCE'] },
    { operationName: 'selfTest.run.status', sourcePath: 'packages/domain/src/self-test-operations.ts', sourceMarker: 'async function runStatus', testPath: 'tests/integration/run.ts', testMarker: 'SELF_TEST_ENVIRONMENTAL_STATUS_INVALID', testCaseId: 'TEST-SELF-TEST-ENVIRONMENTAL-STATUS', runtimeEvidenceKinds: ['EXACT_OPERATION_HANDLER','POSTGRES_CONSISTENT_READ_INTEGRATION','NOT_EXECUTED_ENVIRONMENTAL_EVIDENCE'] },
    { operationName: 'selfTest.evidence.read', sourcePath: 'packages/domain/src/self-test-operations.ts', sourceMarker: 'async function readEvidence', testPath: 'tests/integration/run.ts', testMarker: 'SELF_TEST_EVIDENCE_READ_INVALID', testCaseId: 'TEST-SELF-TEST-EVIDENCE-READ', runtimeEvidenceKinds: ['EXACT_OPERATION_HANDLER','POSTGRES_CONSISTENT_READ_INTEGRATION','SELF_TEST_CASE_EVIDENCE'] },
    { operationName: 'monitor.alert.open', sourcePath: 'packages/domain/src/monitor-operations.ts', sourceMarker: 'async function openAlert', testPath: 'tests/integration/run.ts', testMarker: 'MONITOR_ALERT_OPEN_LIFECYCLE_INVALID', testCaseId: 'TEST-MONITOR-ALERT-OPEN-DEDUPE', runtimeEvidenceKinds: ['EXACT_OPERATION_HANDLER','POSTGRES_CANONICAL_COMMAND_INTEGRATION','ACTIVE_EPISODE_DEDUPE','MONOTONIC_OBSERVATION_SEQUENCE'] },
    { operationName: 'monitor.alert.update', sourcePath: 'packages/domain/src/monitor-operations.ts', sourceMarker: 'async function updateAlert', testPath: 'tests/integration/run.ts', testMarker: 'MONITOR_ALERT_UPDATE_LIFECYCLE_INVALID', testCaseId: 'TEST-MONITOR-ALERT-ACKNOWLEDGE-SUPPRESS', runtimeEvidenceKinds: ['EXACT_OPERATION_HANDLER','POSTGRES_CANONICAL_COMMAND_INTEGRATION','STATE_VERSION_CAS','ALERT_STATE_MACHINE'] },
    { operationName: 'monitor.alert.close', sourcePath: 'packages/domain/src/monitor-operations.ts', sourceMarker: 'async function closeAlert', testPath: 'tests/integration/run.ts', testMarker: 'MONITOR_ALERT_CLOSE_LIFECYCLE_INVALID', testCaseId: 'TEST-MONITOR-ALERT-CLOSE-STALE-FENCE', runtimeEvidenceKinds: ['EXACT_OPERATION_HANDLER','POSTGRES_CANONICAL_COMMAND_INTEGRATION','STALE_OBSERVATION_FENCE','TERMINAL_IMMUTABILITY'] },
    { operationName: 'monitor.heartbeat.observe', sourcePath: 'packages/domain/src/monitor-operations.ts', sourceMarker: 'async function observeHeartbeats', testPath: 'tests/integration/run.ts', testMarker: 'MONITOR_HEARTBEAT_OBSERVE_EXACT_SNAPSHOT_INVALID', testCaseId: 'TEST-MONITOR-HEARTBEAT-CONSISTENT-SNAPSHOT', runtimeEvidenceKinds: ['EXACT_OPERATION_HANDLER','POSTGRES_CONSISTENT_READ_INTEGRATION','DATABASE_TIME_FRESHNESS','PLATFORM_DEPLOYMENT_LINEAGE'] }
  ];
  for (const evidence of exactOperationEvidence) {
    const operation = operations.find((candidate) => candidate.operationName === evidence.operationName);
    const requirement = operation ? requirementMap.get(operation.requirementIds[0]) : null;
    if (!operation || !requirement) throw new Error(`EXACT_OPERATION_EVIDENCE_REQUIREMENT_MISSING:${evidence.operationName}`);
    const sourceArtifact = traceArtifact(evidence.sourcePath);
    const integrationArtifact = traceArtifact(evidence.testPath);
    const sourceLines = (await readFile(join(root, evidence.sourcePath), 'utf8')).split('\n');
    const integrationLines = (await readFile(join(root, evidence.testPath), 'utf8')).split('\n');
    const sourceLineIndex = sourceLines.findIndex((line) => line.includes(evidence.sourceMarker));
    const integrationLineIndex = integrationLines.findIndex((line) => line.includes(evidence.testMarker));
    if (sourceLineIndex < 0 || integrationLineIndex < 0) throw new Error(`EXACT_OPERATION_EVIDENCE_ANCHOR_MISSING:${evidence.operationName}`);
    appendTrace(sourceArtifact, requirement.requirementId, `${evidence.sourcePath}:${sourceLineIndex + 1}`, evidence.operationName, sourceLines[sourceLineIndex]);
    appendTrace(integrationArtifact, requirement.requirementId, `${evidence.testPath}:${integrationLineIndex + 1}`, evidence.testCaseId, integrationLines[integrationLineIndex]);
    sourceArtifact.operationIds.push(operation.operationId);
    sourceArtifact.registryRecordIds.push(operation.operationId);
    integrationArtifact.operationIds.push(operation.operationId);
    integrationArtifact.testIds.push(evidence.testCaseId);
    requirement.artifactIds = [...new Set([...requirement.artifactIds, sourceArtifact.artifactId, integrationArtifact.artifactId])].sort();
    requirement.testCaseIds = [evidence.testCaseId];
    requirement.runtimeEvidenceKinds = evidence.runtimeEvidenceKinds ?? ['EXACT_OPERATION_HANDLER', 'POSTGRES_CANONICAL_COMMAND_INTEGRATION', 'TERMINAL_IDEMPOTENCY_REPLAY'];
    requirement.status = 'ACTIVE';
  }

  // Only literal Chapter-25 field declarations are linked here. Prose about
  // lifecycle, transitions, value constraints or transaction behavior is not
  // treated as a physical-column proof and stays UNMAPPED until a dedicated
  // behavioral or constraint test exists.
  const schemaContractPath = 'contracts/ssot-surface/postgres-schema-contracts.json';
  const primarySchemaPath = 'database/baseline/00000000000000_greenfield.sql';
  const generatedSchemaPath = 'database/baseline/00000000000001_ssot_surface.sql';
  const postgresTestPath = 'tests/postgres/run.ts';
  const schemaContracts = JSON.parse(await readFile(join(root, schemaContractPath), 'utf8')).records;
  const primarySchemaLines = (await readFile(join(root, primarySchemaPath), 'utf8')).split('\n');
  const generatedSchemaLines = (await readFile(join(root, generatedSchemaPath), 'utf8')).split('\n');
  const schemaContractLines = (await readFile(join(root, schemaContractPath), 'utf8')).split('\n');
  const postgresTestLines = (await readFile(join(root, postgresTestPath), 'utf8')).split('\n');
  const postgresTestLineIndex = postgresTestLines.findIndex((line) => line.includes('for (const expected of contract.columns)'));
  if (postgresTestLineIndex < 0) throw new Error('POSTGRES_SCHEMA_TRACE_TEST_ANCHOR_MISSING');
  const schemaContractArtifact = traceArtifact(schemaContractPath);
  const primarySchemaArtifact = traceArtifact(primarySchemaPath);
  const generatedSchemaArtifact = traceArtifact(generatedSchemaPath);
  const postgresTestArtifact = traceArtifact(postgresTestPath);
  const findSqlColumnLine = (lines, tableName, columnName) => {
    const tablePattern = new RegExp(`CREATE TABLE(?: IF NOT EXISTS)? kcml\\."?${tableName}"? \\(`, 'u');
    const tableIndex = lines.findIndex((line) => tablePattern.test(line));
    if (tableIndex < 0) return -1;
    const nextTableOffset = lines.slice(tableIndex + 1).findIndex((line) => /^CREATE TABLE(?: IF NOT EXISTS)?\s+/u.test(line));
    const end = nextTableOffset < 0 ? lines.length : tableIndex + 1 + nextTableOffset;
    const columnPattern = new RegExp(`^\\s*"?${columnName}"?\\s+`, 'u');
    const relativeIndex = lines.slice(tableIndex + 1, end).findIndex((line) => columnPattern.test(line));
    return relativeIndex < 0 ? -1 : tableIndex + 1 + relativeIndex;
  };
  for (const contract of schemaContracts) {
    const subjectId = `25.3:${slug(contract.tableName)}`;
    const columns = new Set(contract.columns.map((column) => column.name));
    let contractTableIndex = schemaContractLines.findIndex((line) => line.includes(`"tableName": "${contract.tableName}"`));
    if (contractTableIndex < 0) throw new Error(`POSTGRES_SCHEMA_CONTRACT_TABLE_ANCHOR_MISSING:${contract.tableName}`);
    const nextContractTableOffset = schemaContractLines.slice(contractTableIndex + 1).findIndex((line) => line.includes('"tableName": '));
    const contractTableEnd = nextContractTableOffset < 0 ? schemaContractLines.length : contractTableIndex + 1 + nextContractTableOffset;
    for (const requirement of requirements.filter((candidate) => candidate.subjectId === subjectId && candidate.status === 'UNMAPPED')) {
      const fieldNames = [...requirement.canonicalStatement.matchAll(/`([a-z][a-z0-9_]*)`/gu)].map((match) => match[1]);
      const residue = requirement.canonicalStatement.replace(/`[a-z][a-z0-9_]*`/gu, 'FIELD').replace(/\b(?:a|and)\b/gu, ',').replace(/[\s,]+/gu, '').replace(/FIELD/gu, '');
      if (!fieldNames.length || residue !== '' || fieldNames.some((fieldName) => !columns.has(fieldName))) continue;
      const sqlArtifacts = new Set();
      for (const fieldName of fieldNames) {
        let sqlPath = primarySchemaPath;
        let sqlLines = primarySchemaLines;
        let sqlLineIndex = findSqlColumnLine(sqlLines, contract.tableName, fieldName);
        let sqlArtifact = primarySchemaArtifact;
        if (sqlLineIndex < 0) {
          sqlPath = generatedSchemaPath;
          sqlLines = generatedSchemaLines;
          sqlLineIndex = findSqlColumnLine(sqlLines, contract.tableName, fieldName);
          sqlArtifact = generatedSchemaArtifact;
        }
        if (sqlLineIndex < 0) throw new Error(`POSTGRES_SCHEMA_SQL_TRACE_ANCHOR_MISSING:${contract.tableName}.${fieldName}`);
        appendTrace(sqlArtifact, requirement.requirementId, `${sqlPath}:${sqlLineIndex + 1}`, `kcml.${contract.tableName}.${fieldName}`, sqlLines[sqlLineIndex]);
        sqlArtifacts.add(sqlArtifact.artifactId);
        const contractColumnIndex = schemaContractLines.slice(contractTableIndex, contractTableEnd).findIndex((line) => line.includes(`"name": "${fieldName}"`));
        if (contractColumnIndex < 0) throw new Error(`POSTGRES_SCHEMA_MANIFEST_COLUMN_ANCHOR_MISSING:${contract.tableName}.${fieldName}`);
        const absoluteContractColumnIndex = contractTableIndex + contractColumnIndex;
        appendTrace(schemaContractArtifact, requirement.requirementId, `${schemaContractPath}:${absoluteContractColumnIndex + 1}`, `SCHEMA-CONTRACT-${contract.tableName}.${fieldName}`, schemaContractLines[absoluteContractColumnIndex]);
      }
      const testCaseId = `TEST-PG-SCHEMA-${contract.tableName.toUpperCase()}-${fieldNames.join('-').toUpperCase()}`;
      appendTrace(postgresTestArtifact, requirement.requirementId, `${postgresTestPath}:${postgresTestLineIndex + 1}`, testCaseId, postgresTestLines[postgresTestLineIndex]);
      requirement.domainModule = 'packages/database';
      requirement.persistenceObjectIds = [contract.tableName];
      requirement.testCaseIds = [testCaseId];
      requirement.acceptanceGateIds = ['GATE-CONTRACT-PACK'];
      requirement.runtimeEvidenceKinds = ['POSTGRES_CATALOG_SCHEMA_PROOF'];
      requirement.artifactIds = [...sqlArtifacts, schemaContractArtifact.artifactId, postgresTestArtifact.artifactId].sort();
      requirement.status = 'ACTIVE';
    }
  }
  const exactInfrastructureEvidence = [
    {
      authoritySourceRef: 'ssot://51.38/51-38-recovery-barrier-closure-a-capacity-physical-contract/atom-8',
      sourcePath: generatedSchemaPath,
      sourceMarkers: [
        'CREATE TABLE IF NOT EXISTS kcml.platform_recovery_head',
        'database_start_identity bytea NOT NULL',
        'recovery_epoch bigint NOT NULL UNIQUE',
        "state text NOT NULL CHECK (state IN ('STARTING','RECONCILING','READY','BLOCKED','MANUAL_REVIEW'))",
        'current_fencing_token bigint NOT NULL DEFAULT 0',
        'ready_evidence_digest bytea',
        "control.system_identifier::text || ':' || pg_postmaster_start_time()::text"
      ],
      testPath: postgresTestPath,
      testMarker: 'PLATFORM_RECOVERY_BOOTSTRAP_AUTHORITY_INVALID',
      testCaseId: 'TEST-PG-PLATFORM-RECOVERY-HEAD-IDENTITY'
    },
    {
      authoritySourceRef: 'ssot://51.38/51-38-recovery-barrier-closure-a-capacity-physical-contract/atom-13',
      sourcePath: generatedSchemaPath,
      sourceMarkers: ['recovery_epoch bigint NOT NULL UNIQUE'],
      testPath: postgresTestPath,
      testMarker: 'PLATFORM_RECOVERY_BOOTSTRAP_AUTHORITY_INVALID',
      testCaseId: 'TEST-PG-PLATFORM-RECOVERY-EPOCH-UNIQUE'
    },
    {
      authoritySourceRef: 'ssot://51.38/51-38-recovery-barrier-closure-a-capacity-physical-contract/atom-3',
      sourcePath: generatedSchemaPath,
      sourceMarkers: ['CREATE TABLE IF NOT EXISTS kcml.platform_recovery_attempt'],
      testPath: 'tests/integration/run.ts',
      testMarker: 'PLATFORM_RECOVERY_STABLE_READY_INVALID',
      testCaseId: 'TEST-PG-PLATFORM-RECOVERY-ATTEMPT',
      persistenceObjectIds: ['platform_recovery_attempt']
    },
    {
      authoritySourceRef: 'ssot://51.38/51-38-recovery-barrier-closure-a-capacity-physical-contract/atom-4',
      sourcePath: generatedSchemaPath,
      sourceMarkers: ['CREATE TABLE IF NOT EXISTS kcml.platform_recovery_item'],
      testPath: 'tests/integration/run.ts',
      testMarker: 'COMMAND_CHECKPOINT_RECOVERY_CLASSIFICATION_INVALID',
      testCaseId: 'TEST-PG-PLATFORM-RECOVERY-ITEM-CLASSIFICATION',
      persistenceObjectIds: ['platform_recovery_item']
    },
    {
      authoritySourceRef: 'ssot://51.38/51-38-recovery-barrier-closure-a-capacity-physical-contract/atom-14',
      sourcePath: generatedSchemaPath,
      sourceMarkers: ['UNIQUE (recovery_attempt_id, owner_kind, owner_id, classification_revision)'],
      testPath: postgresTestPath,
      testMarker: 'COMMAND_RECOVERY_GUARD_STORAGE_INVALID',
      testCaseId: 'TEST-PG-PLATFORM-RECOVERY-ITEM-UNIQUE',
      persistenceObjectIds: ['platform_recovery_item']
    },
    {
      authoritySourceRef: 'ssot://51.38/51-38-recovery-barrier-closure-a-capacity-physical-contract/atom-6',
      sourcePath: generatedSchemaPath,
      sourceMarkers: ['CREATE TABLE IF NOT EXISTS kcml.capacity_reservation'],
      testPath: postgresTestPath,
      testMarker: 'CAPACITY_ACTIVE_UNIQUENESS_NOT_ENFORCED',
      testCaseId: 'TEST-PG-CAPACITY-RESERVATION',
      persistenceObjectIds: ['capacity_reservation']
    },
    {
      authoritySourceRef: 'ssot://51.38/51-38-recovery-barrier-closure-a-capacity-physical-contract/atom-7',
      sourcePath: generatedSchemaPath,
      sourceMarkers: ['CREATE TABLE IF NOT EXISTS kcml.artifact_publication'],
      testPath: postgresTestPath,
      testMarker: 'ARTIFACT_PUBLICATION_PHYSICAL_PROTOCOL_INVALID',
      testCaseId: 'TEST-PG-ARTIFACT-PUBLICATION',
      persistenceObjectIds: ['artifact_publication','artifact_current_pointer']
    },
    {
      authoritySourceRef: 'ssot://51.38/51-38-recovery-barrier-closure-a-capacity-physical-contract/atom-16',
      sourcePath: generatedSchemaPath,
      sourceMarkers: ['capacity_reservation_active_uq ON kcml.capacity_reservation(capacity_kind,reservation_key) WHERE released_at IS NULL'],
      testPath: postgresTestPath,
      testMarker: 'CAPACITY_ACTIVE_UNIQUENESS_NOT_ENFORCED',
      testCaseId: 'TEST-PG-CAPACITY-ACTIVE-UNIQUE',
      persistenceObjectIds: ['capacity_reservation']
    },
    {
      authoritySourceRef: 'ssot://51.38/51-38-recovery-barrier-closure-a-capacity-physical-contract/atom-17',
      sourcePath: generatedSchemaPath,
      sourceMarkers: ['UNIQUE (artifact_owner_kind,artifact_owner_id,logical_name,publication_revision)'],
      testPath: postgresTestPath,
      testMarker: 'ARTIFACT_PUBLICATION_PHYSICAL_PROTOCOL_INVALID',
      testCaseId: 'TEST-PG-ARTIFACT-PUBLICATION-UNIQUE',
      persistenceObjectIds: ['artifact_publication']
    },
    {
      authoritySourceRef: 'ssot://51.38/51-38-recovery-barrier-closure-a-capacity-physical-contract/atom-19',
      sourcePath: generatedSchemaPath,
      sourceMarkers: ["CHECK (artifact_state <> 'PUBLISHED' OR (final_digest IS NOT NULL"],
      testPath: postgresTestPath,
      testMarker: 'ARTIFACT_PUBLICATION_PHYSICAL_PROTOCOL_INVALID',
      testCaseId: 'TEST-PG-ARTIFACT-PUBLISHED-DIGEST',
      persistenceObjectIds: ['artifact_publication']
    }
  ];
  for (const evidence of exactInfrastructureEvidence) {
    const requirement=requirements.find((candidate)=>candidate.authoritySourceRefs.includes(evidence.authoritySourceRef));
    if(!requirement)throw new Error(`INFRASTRUCTURE_EVIDENCE_REQUIREMENT_MISSING:${evidence.authoritySourceRef}`);
    const sourceArtifact=traceArtifact(evidence.sourcePath);const integrationArtifact=traceArtifact(evidence.testPath);
    const sourceLines=(await readFile(join(root,evidence.sourcePath),'utf8')).split('\n');const integrationLines=(await readFile(join(root,evidence.testPath),'utf8')).split('\n');
    for(const marker of evidence.sourceMarkers){const lineIndex=sourceLines.findIndex((line)=>line.includes(marker));if(lineIndex<0)throw new Error(`INFRASTRUCTURE_EVIDENCE_SOURCE_MISSING:${marker}`);appendTrace(sourceArtifact,requirement.requirementId,`${evidence.sourcePath}:${lineIndex+1}`,marker,sourceLines[lineIndex]);}
    const testLineIndex=integrationLines.findIndex((line)=>line.includes(evidence.testMarker));if(testLineIndex<0)throw new Error(`INFRASTRUCTURE_EVIDENCE_TEST_MISSING:${evidence.testMarker}`);
    appendTrace(integrationArtifact,requirement.requirementId,`${evidence.testPath}:${testLineIndex+1}`,evidence.testCaseId,integrationLines[testLineIndex]);
    requirement.domainModule='packages/database';requirement.persistenceObjectIds=evidence.persistenceObjectIds??['platform_recovery_head'];requirement.testCaseIds=[evidence.testCaseId];requirement.acceptanceGateIds=['GATE-CONTRACT-PACK'];
    requirement.runtimeEvidenceKinds=['POSTGRES_PLATFORM_RECOVERY_HEAD_PROOF'];requirement.artifactIds=[sourceArtifact.artifactId,integrationArtifact.artifactId].sort();requirement.status='ACTIVE';
  }
  const runtimeBoundaryEvidence = [
    { requirementId: 'KCML-REQ-RUNTIME-444fd05998029935c6d719e0e6dd5a757ee9ca6781ea0db77eed9ede2d7106f1', sourcePath: 'deploy/runtime/kcml-sandbox-launcher.c', sourceMarker: 'CLONE_NEWUSER', testPath: 'tests/runtime-boundary/sandbox-contract.test.ts', testMarker: "it('contains the native namespace, FD and mount linearization" },
    { requirementId: 'KCML-REQ-POSTGRES-3e1e2ca6aeac79dd1abde323ff75757ef93d6e481c6402602085a209c5b81fe5', sourcePath: 'deploy/runtime/kcml-sandbox-launcher.c', sourceMarker: 'open(executable,O_RDONLY|O_CLOEXEC|O_NOFOLLOW)', testPath: 'tests/runtime-boundary/sandbox-contract.test.ts', testMarker: "it('contains the native namespace, FD and mount linearization" },
    { requirementId: 'KCML-REQ-RUNTIME-6298de933c910d5b02240bb21d710869ea548a611d97114438898fe282497fdd', sourcePath: 'deploy/runtime/kcml-sandbox-launcher.c', sourceMarker: 'O_NOFOLLOW', testPath: 'tests/runtime-boundary/sandbox-contract.test.ts', testMarker: "it('contains the native namespace, FD and mount linearization" },
    { requirementId: 'KCML-REQ-RUNTIME-2e05853970fa83ad9006d03338413a61660f196ba1e79dd1a20c6181898d3f90', sourcePath: 'deploy/runtime/kcml-sandbox-launcher.c', sourceMarker: 'static void install_seccomp_allowlist', testPath: 'tests/runtime-boundary/sandbox-contract.test.ts', testMarker: "it('has explicit seccomp deny and allow entries" },
    { requirementId: 'KCML-REQ-CORE-4281633d14a90bb6c2a2bace795a3a394fccb462cf2a8319f33924bd8d71b0e2', sourcePath: 'deploy/runtime/kcml-sandbox-launcher.c', sourceMarker: 'SYS_close_range', testPath: 'tests/runtime-boundary/sandbox-contract.test.ts', testMarker: "it('contains the native namespace, FD and mount linearization" },
    { requirementId: 'KCML-REQ-RUNTIME-321b40ee21af05286246bd355e173646751caf68855f0d516cbce8d3258c562d', sourcePath: 'deploy/runtime/kcml-sandbox-launcher.c', sourceMarker: 'clearenv();', testPath: 'tests/runtime-boundary/sandbox-contract.test.ts', testMarker: "it('bootstraps only Node 24 with exact environment and handler path" },
    { requirementId: 'KCML-REQ-CORE-b4212bcad7e9f02d49a5e263b68eac4e7dc21cf1c0826c9b3ba868b88d948979', sourcePath: 'deploy/runtime/kcml-fd-cloexec-addon.c', sourceMarker: 'fcntl(3, F_SETFD, FD_CLOEXEC)', testPath: 'tests/runtime-boundary/sandbox-contract.test.ts', testMarker: "it('bootstraps only Node 24 with exact environment and handler path" },
    { requirementId: 'KCML-REQ-RUNTIME-9b9b39e3819dbe737df54e9ee052d0af1ab56d7c3320e03dc0cee777262d7a60', sourcePath: 'deploy/runtime/kcml-node-bootstrap.mjs', sourceMarker: 'async function main()', testPath: 'tests/runtime-boundary/sandbox-contract.test.ts', testMarker: "it('bootstraps only Node 24 with exact environment and handler path" },
    { requirementId: 'KCML-REQ-RUNTIME-2e05853970fa83ad9006d03338413a61660f196ba1e79dd1a20c6181898d3f90', sourcePath: 'deploy/runtime/kcml-sandbox-probe.c', sourceMarker: 'socket(AF_UNIX, SOCK_STREAM, 0)', testPath: 'tests/runtime-boundary/native-sandbox.sh', testMarker: 'SANDBOX_DENY_SOCKET_PASS' },
    { requirementId: 'KCML-REQ-RUNTIME-321b40ee21af05286246bd355e173646751caf68855f0d516cbce8d3258c562d', sourcePath: 'packages/runtime-boundary/src/index.ts', sourceMarker: 'nodeBootstrap?:', testPath: 'tests/runtime-boundary/sandbox-contract.test.ts', testMarker: 'nodeBootstrap?:' }
  ];
  for (const evidence of runtimeBoundaryEvidence) {
    const requirement = requirementMap.get(evidence.requirementId);
    if (!requirement) throw new Error(`RUNTIME_BOUNDARY_EVIDENCE_REQUIREMENT_MISSING:${evidence.requirementId}`);
    const sourceArtifact = traceArtifact(evidence.sourcePath);
    const testArtifact = traceArtifact(evidence.testPath);
    const sourceLines = (await readFile(join(root, evidence.sourcePath), 'utf8')).split('\n');
    const testLines = (await readFile(join(root, evidence.testPath), 'utf8')).split('\n');
    const sourceLineIndex = sourceLines.findIndex((line) => line.includes(evidence.sourceMarker));
    const testLineIndex = testLines.findIndex((line) => line.includes(evidence.testMarker));
    if (sourceLineIndex < 0 || testLineIndex < 0) throw new Error(`RUNTIME_BOUNDARY_EVIDENCE_ANCHOR_MISSING:${evidence.requirementId}`);
    appendTrace(sourceArtifact, requirement.requirementId, `${evidence.sourcePath}:${sourceLineIndex + 1}`, evidence.sourceMarker, sourceLines[sourceLineIndex]);
    appendTrace(testArtifact, requirement.requirementId, `${evidence.testPath}:${testLineIndex + 1}`, `TEST-RUNTIME-BOUNDARY-${evidence.requirementId}`, testLines[testLineIndex]);
    requirement.artifactIds = [...new Set([...requirement.artifactIds, sourceArtifact.artifactId, testArtifact.artifactId])].sort();
    requirement.testCaseIds = [...new Set([...requirement.testCaseIds, `TEST-RUNTIME-BOUNDARY-${evidence.requirementId}`])].sort();
    requirement.runtimeEvidenceKinds = ['NATIVE_SANDBOX_DENY_ALLOW', 'SOURCE_AND_TEST_ANCHOR'];
    requirement.status = 'ACTIVE';
  }
  const runtimeVerificationOperation = operations.find((operation) => operation.operationName === 'runtime.boundary.verify');
  const runtimeSeccompRequirement = requirementMap.get('KCML-REQ-RUNTIME-2e05853970fa83ad9006d03338413a61660f196ba1e79dd1a20c6181898d3f90');
  if (!runtimeVerificationOperation || !runtimeSeccompRequirement) throw new Error('RUNTIME_BOUNDARY_OPERATION_TRACE_TARGET_MISSING');
  runtimeVerificationOperation.requirementIds = [...new Set([...runtimeVerificationOperation.requirementIds, runtimeSeccompRequirement.requirementId])].sort();
  runtimeSeccompRequirement.operationIds = [...new Set([...runtimeSeccompRequirement.operationIds, runtimeVerificationOperation.operationId])].sort();
  // Operation-specific evidence above may replace an artifact list. Re-apply
  // the generated catalog's reverse edges after all specialized trace passes.
  for (const requirementId of faultCatalogArtifact.requirementIds) {
    const requirement = requirementMap.get(requirementId);
    if (!requirement) throw new Error(`FAULT_REQUIREMENT_MISSING:${requirementId}`);
    requirement.artifactIds = stableSort([...new Set([...(requirement.artifactIds ?? []), faultCatalogArtifact.artifactId])]);
  }
  for (const artifact of touchedTraceArtifacts) {
    artifact.requirementIds = stableSort([...new Set(artifact.requirementIds)]);
    artifact.operationIds = stableSort([...new Set(artifact.operationIds)]);
    artifact.stateMachineIds = stableSort([...new Set(artifact.stateMachineIds)]);
    artifact.registryRecordIds = stableSort([...new Set(artifact.registryRecordIds)]);
    artifact.testIds = stableSort([...new Set(artifact.testIds)]);
    artifact.traceAnchors.sort((left, right) => stableCompare(`${left.requirementId}:${left.locator}`, `${right.requirementId}:${right.locator}`));
  }
  const architectureBlockers = [];
  const surfaceSqlForArchitecture = await readFile(join(root, 'database/baseline/00000000000001_ssot_surface.sql'), 'utf8');
  if ((surfaceSqlForArchitecture.match(/document jsonb NOT NULL DEFAULT '\{\}'::jsonb/giu) ?? []).length > 0) architectureBlockers.push({ code: 'GENERIC_ENTITY_SCHEMA', summary: 'Physical entity schemas still contain generic document storage.' });
  if (requirements.some((requirement) => requirement.artifactIds.length === 0)) architectureBlockers.push({ code: 'TRACEABILITY_INCOMPLETE', summary: 'Requirements do not yet have implementation artifact evidence.' });

  const schemaManifest = { schemaVersion: '1.0', schemas: Object.keys(schemas).sort().map((name) => ({ ref: `contracts/registry-schemas/${name}`, digest: sha(canonical(schemas[name])) })) };
  schemaManifest.digest = sha(canonical(schemaManifest));
  for (const [name, schema] of Object.entries(schemas)) addArtifact(`contracts/registry-schemas/${name}`, `${canonical(schema)}\n`, { artifactKind: 'GENERATED_SCHEMA', generatedFrom: ['SSOT_CURRENT.md'], generationToolDigest: compilerDigest, authoritySourceRefs: ['ssot://55/machine-readable-contract-pack/schema'] });
  addArtifact('contracts/registry-schemas/bundle-manifest.json', `${canonical(schemaManifest)}\n`, { artifactKind: 'GENERATED_SCHEMA_BUNDLE', generatedFrom: ['SSOT_CURRENT.md'], generationToolDigest: compilerDigest, authoritySourceRefs: ['ssot://55/machine-readable-contract-pack/schema-bundle'] });

  const registries = [
    ['REQUIREMENT_REGISTRY', 'requirements/requirements.json', requirements],
    ['OPERATION_CATALOG', 'operations/operations.json', operations],
    ['STATE_MACHINE_REGISTRY', 'state-machines/state-machines.json', stateMachines],
    ['POSTGRES_CONTRACT_MATRIX', 'postgres/postgres-contracts.json', postgres],
    ['RUNTIME_BOUNDARY_MATRIX', 'runtime-boundaries/runtime-boundaries.json', runtimes],
    ['BINDING_REGISTRY', 'bindings/bindings.json', [...operations.map((operation) => makeBindingRecord(operation, bindingKindForOperation(operation), [])), ...makeBindingKindCoverageRecords()]],
    ['AUTHORITY_OWNERSHIP_REGISTRY', 'authority/authority-ownership.json', authorities],
    ['ERROR_RETRY_REGISTRY', 'errors/errors.json', errorRecords],
    ['FAULT_CATALOG', 'faults/faults.json', faultPoints.map(({ operationName: _operationName, ...point }) => ({ ...point, expectedOutcome: point.expectedCanonicalOutcomeClasses.join('|') }))],
    ['RECOVERY_ORACLE_REGISTRY', 'recovery-oracles/recovery-oracles.json', [
      { recoveryOracleId: 'ORACLE-SIDE-EFFECT', subjectId: 'SIDE_EFFECT', observedAuthoritativeStateSchema: 'SIDE_EFFECT_EVIDENCE', requiredEvidence: ['INTENT', 'DISPATCH', 'READ_BACK'], forbiddenEvidenceAssumptions: ['PROCESS_MEMORY', 'MISSING_LOG'], rules: [{ when: 'INTENT=false', outcome: 'CONFIRMED_NOT_APPLIED' }, { when: 'INTENT=true AND DISPATCH=false', outcome: 'CONFIRMED_NOT_APPLIED' }, { when: 'DISPATCH=true AND READ_BACK=true', outcome: 'CONFIRMED_APPLIED' }, { when: 'DISPATCH=true AND READ_BACK=false', outcome: 'MANUAL_REVIEW' }], defaultOutcome: 'MANUAL_REVIEW', manualReviewSchemaRef: 'contracts/registry-schemas/operation-command.schema.json', conflictingOperationBlockKeys: ['RESOURCE'], closurePredicateId: 'CLOSURE-SIDE_EFFECT', testCaseIds: ['TEST-RECOVERY-ORACLE'], requirementIds: [], authoritySourceRefs: ['ssot://54/recovery-oracle/oracle'] },
      ...[...new Map(faultPoints.map((point) => [point.expectedRecoveryOracleId, point])).values()].map((point) => ({ recoveryOracleId: point.expectedRecoveryOracleId, subjectId: point.operationId, observedAuthoritativeStateSchema: point.requiredDirectStateQueries.join('|'), requiredEvidence: ['FAULT_POINT', 'AUTHORITATIVE_STATE', 'CLEANUP'], forbiddenEvidenceAssumptions: ['PROCESS_MEMORY', 'MISSING_LOG', 'HTTP_STATUS_ONLY'], rules: [{ when: 'FAULT_BEFORE_POSSIBLE_EFFECT', outcome: 'CONFIRMED_NOT_APPLIED' }, { when: 'FAULT_AFTER_POSSIBLE_EFFECT_AND_READ_BACK', outcome: 'CONFIRMED_APPLIED' }, { when: 'POSSIBLE_EFFECT_WITHOUT_READ_BACK', outcome: 'MANUAL_REVIEW' }], defaultOutcome: 'MANUAL_REVIEW', manualReviewSchemaRef: 'contracts/registry-schemas/operation-command.schema.json', conflictingOperationBlockKeys: point.requiredCleanupChecks, closurePredicateId: `CLOSURE-${point.stateMachineId.replace(/^SM-/u, '')}`, testCaseIds: point.testCaseIds, requirementIds: point.requirementIds, authoritySourceRefs: point.authoritySourceRefs }))
    ]],
    ['CLOSURE_PREDICATE_REGISTRY', 'closure-predicates/closure-predicates.json', closure],
    ['ACCEPTANCE_GATE_REGISTRY', 'acceptance-gates/acceptance-gates.json', gateRecords],
    ['EXPOSURE_PARITY_REGISTRY', 'exposure-parity/exposure-parity.json', exposure],
    ['ARTIFACT_TRACE_REGISTRY', 'artifact-trace/artifact-trace.json', artifacts]
  ];

  // Materialize reverse requirement edges from the requirement record itself.
  // This makes the generated pack self-auditing: every forward edge must have
  // a matching requirementIds entry on the target registry record.
  const registryTargets = new Map(registries.map(([kind, , records]) => [kind, new Map(records.map((record) => [registryRecordId(kind, record), record]))]));
  const reverseFields = [
    ['stateMachineIds', 'STATE_MACHINE_REGISTRY'], ['operationIds', 'OPERATION_CATALOG'], ['bindingIds', 'BINDING_REGISTRY'],
    ['errorCodeIds', 'ERROR_RETRY_REGISTRY'], ['acceptanceGateIds', 'ACCEPTANCE_GATE_REGISTRY'], ['closurePredicateIds', 'CLOSURE_PREDICATE_REGISTRY'],
    ['artifactIds', 'ARTIFACT_TRACE_REGISTRY']
  ];
  for (const requirement of requirements) {
    for (const [field, kind] of reverseFields) for (const targetId of requirement[field] ?? []) {
      const target = registryTargets.get(kind)?.get(targetId);
      if (!target) throw new Error(`TRACE_TARGET_MISSING:${requirement.requirementId}:${kind}:${targetId}`);
      target.requirementIds ??= [];
      target.requirementIds.push(requirement.requirementId);
    }
  }
  const compiledRegistries = registries.map(([kind, dataRefSuffix, records]) => [
    kind,
    dataRefSuffix,
    records.map((record) => decorateRecord(kind, record)).sort((left, right) => stableCompare(left.recordId, right.recordId))
  ]);

  const outputs = new Map();
  for (const [name, schema] of Object.entries(schemas)) outputs.set(`contracts/registry-schemas/${name}`, `${canonical(schema)}\n`);
  outputs.set('contracts/registry-schemas/bundle-manifest.json', `${canonical(schemaManifest)}\n`);
  outputs.set('contracts/testing/fault-catalog/catalog.json', generatedFaultTestCatalogBytes);

  const registryManifest = [];
  const registrySchemaRef = new Map(compiledRegistries.map(([kind]) => [kind, `contracts/registry-schemas/${registrySchemaFilenames[kind]}`]));
  for (const [kind, dataRefSuffix, records] of compiledRegistries) {
    const data = { schemaVersion: '1.0', kind, records };
    const path = `contracts/registries/${dataRefSuffix}`;
    const bytes = `${canonical(data)}\n`;
    outputs.set(path, bytes);
    registryManifest.push({ kind, schemaRef: registrySchemaRef.get(kind), dataRef: path, recordCount: records.length, digest: sha(bytes) });
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
    schemaVersion: '1.0', status: architectureBlockers.length === 0 ? 'PASS' : 'FAIL', ssotDigest: manifest.ssotDigest, packDigest: manifest.packDigest, blockers: architectureBlockers,
    gates: gates.filter((gate) => gate.startsWith('ARCH_')).map((gateId) => ({ gateId, status: architectureBlockers.length === 0 ? 'PASS' : 'FAIL', evaluator: 'scripts/evaluate-architecture.mjs', evidenceDigest: sha(canonical({ gateId, blockers: architectureBlockers })), blockers: architectureBlockers.map((blocker) => blocker.code) }))
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
  process.stdout.write(`${checkOnly ? 'verified' : 'generated'} requirements=${requirements.length} operations=${operations.length} files=${outputs.size} repositoryArtifacts=${artifacts.length} pack=${manifest.packDigest}\n`);
}

await main();
