#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contractFor } from './lib/postgres-operation-contract.mjs';

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
  let chapter = '0';
  let heading = 'SSOT';
  let headingAtom = 0;
  let inFence = false;
  let fenceLanguage = '';
  let inOperationCatalog = false;
  let paragraph = [];
  let paragraphStartLine = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const statement = normalizeStatement(paragraph.join(' '));
    paragraph = [];
    if (statement.length > 0) atoms.push({ chapter, heading, ordinal: ++headingAtom, statement, context: 'paragraph', sourceLine: paragraphStartLine });
    paragraphStartLine = null;
  };

  for (const [lineIndex, raw] of lines.entries()) {
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

    if (inFence) {
      if (/^[a-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+$/u.test(trimmed) && inOperationCatalog) operations.push(trimmed);
      if (fenceLanguage === 'text' || fenceLanguage === 'json' || fenceLanguage === 'sql' || fenceLanguage === 'ini' || fenceLanguage === '') {
        atoms.push({ chapter, heading, ordinal: ++headingAtom, statement: trimmed, context: `code:${fenceLanguage || 'text'}`, sourceLine: lineIndex + 1 });
      }
      continue;
    }

    if (/^\|.*\|$/u.test(trimmed)) {
      if (!/^\|?[\s:|-]+\|?$/u.test(trimmed)) atoms.push({ chapter, heading, ordinal: ++headingAtom, statement: trimmed, context: 'table-row', sourceLine: lineIndex + 1 });
      continue;
    }
    const list = /^(?:[-*+] |\d+[.)] )(.+)$/u.exec(trimmed);
    if (list) {
      flushParagraph();
      atoms.push({ chapter, heading, ordinal: ++headingAtom, statement: normalizeStatement(list[1]), context: 'list-item', sourceLine: lineIndex + 1 });
      continue;
    }
    if (paragraphStartLine === null) paragraphStartLine = lineIndex + 1;
    paragraph.push(trimmed);
  }
  flushParagraph();
  return { atoms, operations: [...new Set(operations)], errors: parseStableErrors(text) };
}

const retryDirectives = ['DO_NOT_RETRY', 'RETRY_SAME_OPERATION', 'REFRESH_AND_RETRY_NEW_COMMAND', 'RECONCILE_THEN_RETRY', 'MANUAL_REVIEW'];

/**
 * Chapter 32 is the sole authority for stable error identifiers.  In
 * particular, this deliberately does not scan arbitrary SSOT prose: status
 * markers such as `*_PASSED`, enum members, and example values are not error
 * codes.  Only the explicit catalog code fences in 32.6–32.8 are accepted.
 */
function parseStableErrors(text) {
  const errors = new Set();
  let inCatalog = false;
  let inFence = false;
  for (const raw of text.split('\n')) {
    if (/^### 32\.(?:6|7|8)\b/u.test(raw)) inCatalog = true;
    if (/^### 33\b/u.test(raw)) inCatalog = false;
    if (!inCatalog) continue;
    if (/^```/u.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) continue;
    const code = raw.trim();
    if (/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/u.test(code) && !retryDirectives.includes(code)) errors.add(code);
  }
  if (errors.size === 0) throw new Error('STABLE_ERROR_CATALOG_EMPTY');
  return [...errors].sort();
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
  if (/^(component\.heartbeat|component\.state\.|component\.control\.|runtime\.(?:prepare|ready\.report|state\.report|heartbeat|invoke|cancel|drain|stop|cleanup\.resume)$|mcp\.request\.|mcp\.subscription\.notify|audit\.stream\.)/u.test(name)) return 'INTERNAL_PROTOCOL';
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

const EXPOSURE_PARITY_SOURCE_REF = 'ssot://55.18/55-18-ui-api-chat-audit-a-self-test-parity/atom-1';
const EXPOSURE_SURFACE_SOURCE = {
  REST: { sourcePath: 'apps/server/src/ssot-router.ts', sourceMarker: 'export function registerCompiledSsotRoutes', symbol: 'registerCompiledSsotRoutes' },
  GRAPHQL: { sourcePath: null, sourceMarker: null, symbol: null },
  UI_ADAPTER: { sourcePath: 'apps/owner-ui/src/api.ts', sourceMarker: 'export function operation(', symbol: 'owner-ui.operation' },
  UI_ACTION: { sourcePath: 'apps/owner-ui/src/App.tsx', sourceMarker: 'function OperationDialog(', symbol: 'OperationDialog.submit' },
  UI_VIEW: { sourcePath: 'apps/owner-ui/src/App.tsx', sourceMarker: 'function OperationExplorer(', symbol: 'OperationExplorer' },
  CHAT: { sourcePath: 'apps/server/src/server.ts', sourceMarker: "app.post('/api/v1/chat/ask'", symbol: 'POST /api/v1/chat/ask' },
  AUDIT: { sourcePath: 'packages/domain/src/operations.ts', sourceMarker: 'async function audit(', symbol: 'CanonicalOperationService.audit' },
  SELF_TEST: { sourcePath: 'tests/operations/catalog-coverage.test.ts', sourceMarker: "it.each(catalog.records.map", symbol: 'OPERATION_COVERAGE_EVIDENCE' },
  KCIP: { sourcePath: 'packages/kcip/src/index.ts', sourceMarker: 'export function verifyKcipEnvelope(', symbol: 'verifyKcipEnvelope' },
  MCP: { sourcePath: 'packages/mcp-runtime/src/index.ts', sourceMarker: 'public async dispatch(', symbol: 'McpRuntime.dispatch' },
  BROWSER: { sourcePath: 'packages/browser-interaction/src/index.ts', sourceMarker: 'export class BrowserInteractionService', symbol: 'BrowserInteractionService' },
  GENERATION: { sourcePath: 'packages/domain/src/canonical-operation-handlers.ts', sourceMarker: 'async function generationMutation(', symbol: 'generationMutation' }
};

const UI_VIEW_BY_FAMILY = {
  COMPONENT: 'Catalog', RUNTIME: 'Tests', MCP: 'Mcp', AGENT: 'Agents', CHAT: 'Chat', SELFTEST: 'Tests',
  GENERATION: 'GenerationWorkspace', BROWSER: 'Browser', MONITOR: 'Monitoring', AUDIT: 'Audit', OWNERAPIKEY: 'ApiKey',
  SECRET: 'Secrets', AUTHORITY: 'Security', PROVENANCE: 'Audit', AGENTIC: 'Security'
};

function actualSurfaceBinding(surface, bindingId, target, source = EXPOSURE_SURFACE_SOURCE[surface]) {
  return { bindingId, target, sourcePath: source.sourcePath, sourceSymbol: source.symbol, sourceMarker: source.sourceMarker, status: 'APPLICABLE' };
}

function notApplicableSurfaceBinding(surface, reasonCode) {
  return { bindingId: `${surface}:NOT_APPLICABLE`, target: null, sourcePath: null, sourceSymbol: null, sourceMarker: null, status: 'NOT_APPLICABLE', reasonCode, supportingRequirementSourceRef: EXPOSURE_PARITY_SOURCE_REF };
}

function internalParentOperationName(name) {
  const exact = {
    'component.control.enable': 'component.enable', 'component.control.disable': 'component.disable', 'component.control.ack': 'component.register',
    'component.heartbeat': 'component.register', 'component.state.query': 'component.register', 'component.state.report': 'component.register',
    'runtime.prepare': 'runtime.instance.start', 'runtime.ready.report': 'runtime.instance.start', 'runtime.state.report': 'runtime.instance.start',
    'runtime.heartbeat': 'runtime.instance.start', 'runtime.invoke': 'runtime.instance.start', 'runtime.cancel': 'runtime.instance.start',
    'runtime.drain': 'runtime.instance.start', 'runtime.stop': 'runtime.instance.start', 'runtime.cleanup.resume': 'runtime.instance.start',
    'mcp.request.validateTransport': 'mcp.tools.call', 'mcp.request.validateJsonRpc': 'mcp.tools.call', 'mcp.request.reserveId': 'mcp.tools.call',
    'mcp.request.finalize': 'mcp.tools.call', 'mcp.subscription.notify': 'mcp.subscription.listen', 'audit.stream.ack': 'audit.integrity.verify',
    'audit.stream.replay.request': 'audit.integrity.verify', 'audit.stream.replay.result': 'audit.integrity.verify'
  };
  return exact[name] ?? null;
}

function buildExposureParity(name, operationFamily, exposureClass, routeRecords, operationId) {
  const directRoutes = routeRecords.filter((route) => route.operation === name);
  const dynamicRoute = routeRecords.find((route) => route.operation === '__DYNAMIC_OPERATION__');
  if (!dynamicRoute) throw new Error('EXPOSURE_PARITY_DYNAMIC_REST_ROUTE_MISSING');
  const routes = directRoutes.length > 0 ? directRoutes : [dynamicRoute];
  const restBindings = routes.map((route) => actualSurfaceBinding('REST', `REST_ROUTE:${route.routeKey}`, route.routeKey));
  const viewName = UI_VIEW_BY_FAMILY[operationFamily];
  if (!viewName) throw new Error(`EXPOSURE_PARITY_UI_VIEW_MISSING:${operationFamily}`);
  const uiViewSource = { ...EXPOSURE_SURFACE_SOURCE.UI_VIEW, sourceMarker: `function ${viewName}(`, symbol: viewName };
  const uiSurface = actualSurfaceBinding('UI_VIEW', `UI_VIEW:apps/owner-ui/src/App.tsx#${viewName}`, `/${surfaceFor(name)}`, uiViewSource);
  const uiAdapter = actualSurfaceBinding('UI_ADAPTER', 'UI_ADAPTER:apps/owner-ui/src/api.ts#operation', 'POST /operations/:operationKey/invoke');
  const uiAction = actualSurfaceBinding('UI_ACTION', 'UI_ACTION:apps/owner-ui/src/App.tsx#OperationDialog.submit', 'canonical-operation-command');
  const chat = actualSurfaceBinding('CHAT', 'CHAT_CAPABILITY:apps/server/src/server.ts#POST /api/v1/chat/ask', 'POST /api/v1/chat/ask');
  const audit = actualSurfaceBinding('AUDIT', `AUDIT_EVENT:${name}`, `${name}.requested|${name}.completed`);
  const selfTest = actualSurfaceBinding('SELF_TEST', 'TEST_CASE:tests/operations/catalog-coverage.test.ts#OPERATION_COVERAGE_EVIDENCE', operationId);
  const restApplicable = exposureClass !== 'INTERNAL_PROTOCOL';
  const surfaces = [
    ...(restApplicable ? restBindings : [notApplicableSurfaceBinding('REST', 'INTERNAL_PROTOCOL_NO_PUBLIC_ROUTE')]),
    notApplicableSurfaceBinding('GRAPHQL', 'GRAPHQL_SURFACE_NOT_DECLARED'),
    uiAdapter, uiSurface,
    ...(exposureClass === 'OWNER_COMMAND' ? [uiAction] : []),
    chat, audit, selfTest,
    ...((exposureClass === 'INTERNAL_PROTOCOL' || operationFamily === 'BROWSER') ? [actualSurfaceBinding('KCIP', 'KCIP_ENVELOPE:packages/kcip/src/index.ts#verifyKcipEnvelope', 'KCIP/1.0')] : [notApplicableSurfaceBinding('KCIP', 'KCIP_NOT_REQUIRED_BY_EXPOSURE')]),
    ...(operationFamily === 'MCP' ? [actualSurfaceBinding('MCP', 'MCP_DISPATCH:packages/mcp-runtime/src/index.ts#McpRuntime.dispatch', 'tools/call|tools/list')] : [notApplicableSurfaceBinding('MCP', 'MCP_NOT_APPLICABLE_OPERATION_FAMILY')]),
    ...(operationFamily === 'BROWSER' ? [actualSurfaceBinding('BROWSER', 'BROWSER_PLANE:packages/browser-interaction/src/index.ts#BrowserInteractionService', name)] : [notApplicableSurfaceBinding('BROWSER', 'BROWSER_NOT_APPLICABLE_OPERATION_FAMILY')]),
    ...(operationFamily === 'GENERATION' ? [actualSurfaceBinding('GENERATION', 'GENERATION_HANDLER:packages/domain/src/canonical-operation-handlers.ts#generationMutation', name)] : [notApplicableSurfaceBinding('GENERATION', 'GENERATION_NOT_APPLICABLE_OPERATION_FAMILY')])
  ];
  const parentName = exposureClass === 'INTERNAL_PROTOCOL' ? internalParentOperationName(name) : null;
  if (exposureClass === 'INTERNAL_PROTOCOL' && !parentName) throw new Error(`EXPOSURE_PARITY_INTERNAL_PARENT_MISSING:${name}`);
  return {
    apiOperationIds: restApplicable ? restBindings.map((binding) => binding.bindingId) : [],
    uiSurfaceIds: [uiSurface.bindingId],
    uiActionIds: exposureClass === 'OWNER_COMMAND' ? [uiAction.bindingId] : [],
    chatCapabilityIds: [chat.bindingId],
    selfTestCaseIds: [selfTest.bindingId],
    surfaceBindings: surfaces,
    parentOperationName: parentName
  };
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
    authorityOwnershipIds: [],
    status: 'ACTIVE',
    supersedes: [],
    supersededBy: [],
    canonicalDigest: digest
  };
}

function makeOperation(name, requirementIds, routeRecords) {
  const operationId = `OP-${name.toUpperCase().replaceAll('.', '-')}`;
  const mutates = operationMutates(name);
  const exposureClass = exposureFor(name);
  const operationFamilyName = operationFamily(name);
  const exposure = buildExposureParity(name, operationFamilyName, exposureClass, routeRecords, operationId);
  const sideEffectClass = mutates ? (/delete|deregister|revoke|close|rollback|cancel/u.test(name) ? 'DESTRUCTIVE' : 'LOCAL_STATE_IDEMPOTENT') : 'READ_ONLY';
  return {
    operationId, operationName: name, operationRevision: 1, operationFamily: operationFamilyName, exposureClass,
    canonicalWriterId: `WRITER-${operationFamilyName}`, aggregateRoot: rootFor(name),
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
    apiOperationIds: exposure.apiOperationIds, uiSurfaceIds: exposure.uiSurfaceIds, uiActionIds: exposure.uiActionIds,
    chatCapabilityIds: exposure.chatCapabilityIds, selfTestCaseIds: exposure.selfTestCaseIds, surfaceBindings: exposure.surfaceBindings,
    parentOperationName: exposure.parentOperationName,
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
  ['ACTIVATION_SET', ['DRAFT', 'READY', 'SWITCHING', 'VERIFYING', 'ACTIVE', 'ROLLING_BACK', 'ROLLBACK_VERIFYING', 'ROLLED_BACK', 'FAILED', 'MANUAL_REVIEW'], ['ROLLED_BACK', 'FAILED']],
  ['DEPLOYMENT_RUN', ['QUEUED', 'PREPARING', 'BACKED_UP', 'MIGRATING', 'STAGING', 'SWITCHING', 'RESTARTING', 'VERIFYING', 'ACTIVE', 'ROLLING_BACK', 'ROLLED_BACK', 'FAILED', 'MANUAL_REVIEW'], ['ACTIVE', 'ROLLED_BACK', 'FAILED']],
  ['CLEANUP_OPERATION', ['PENDING', 'REVOKING_ADMISSION', 'RECONCILING', 'CAPTURING_FINAL_EVIDENCE', 'RELEASING_BROWSER_RESOURCES', 'RELEASING_PLATFORM_RESOURCES', 'MANUAL_REVIEW', 'COMPLETE', 'FAILED'], ['COMPLETE', 'FAILED']],
  ['AI_MODEL_CALL', ['QUEUED', 'SUBMITTING', 'IN_PROGRESS', 'STREAMING', 'WAITING_FOR_TOOL_OUTPUT', 'COMPLETED', 'INCOMPLETE', 'REFUSED', 'CANCEL_REQUESTED', 'CANCELLED', 'FAILED', 'EXPIRED'], ['COMPLETED', 'INCOMPLETE', 'REFUSED', 'CANCELLED', 'FAILED', 'EXPIRED']],
  ['RUNTIME_INSTANCE', ['PREPARING', 'STARTING', 'READY', 'RUNNING', 'DRAINING', 'STOPPED', 'FAILED', 'MANUAL_REVIEW'], ['STOPPED', 'FAILED']],
  ['SECRET_RECORD', ['ACTIVE', 'ROTATING', 'RETIRED', 'CLOSED', 'FAILED'], ['RETIRED', 'CLOSED', 'FAILED']],
  ['OPERATIONAL_ALERT', ['OPEN', 'ACKNOWLEDGED', 'SUPPRESSED', 'CLOSED'], ['CLOSED']],
  ['AUDIT_HEAD', ['ACTIVE', 'VERIFYING', 'ARCHIVING', 'FAILED'], ['FAILED']],
  ['SYSTEM_CHAT_CONVERSATION', ['ACTIVE', 'CANCEL_REQUESTED', 'CANCELLED', 'CLOSED', 'FAILED'], ['CANCELLED', 'CLOSED', 'FAILED']],
  ['OWNER_IDENTITY', ['ACTIVE', 'MFA_ENROLLING', 'MFA_ACTIVE', 'RECOVERY_ROTATING', 'LOCKED'], ['LOCKED']],
  ['SELF_TEST_RUN', ['QUEUED', 'RUNNING', 'PASS', 'FAIL', 'CANCELLED', 'NOT_EXECUTED_ENVIRONMENTAL'], ['PASS', 'FAIL', 'CANCELLED', 'NOT_EXECUTED_ENVIRONMENTAL']],
  ['EXTERNAL_TARGET', ['DRAFT', 'ACTIVE', 'DEGRADED', 'DISABLED', 'RETIRED'], ['RETIRED']],
  ['GENERATION_ACTIVATION_SET', ['DRAFT', 'READY', 'SWITCHING', 'VERIFYING', 'ACTIVE', 'ROLLING_BACK', 'ROLLED_BACK', 'FAILED', 'MANUAL_REVIEW'], ['ROLLED_BACK', 'FAILED']],
  ['BINDING_SET', ['DRAFT', 'PUBLISHED', 'ACTIVE', 'RETIRED'], ['RETIRED']],
  ['SIDE_EFFECT', ['INTENT_RECORDED', 'DISPATCHING', 'OUTCOME_RECORDED', 'RECONCILING', 'CONFIRMED_APPLIED', 'CONFIRMED_NOT_APPLIED', 'FAILED_FINAL', 'UNKNOWN'], ['CONFIRMED_APPLIED', 'CONFIRMED_NOT_APPLIED', 'FAILED_FINAL']],
  ['QUEUE_WORK', ['READY', 'CLAIMED', 'DISPATCH_AUTHORIZED', 'RETRY_WAIT', 'RECONCILING', 'DELIVERED', 'FAILED_FINAL', 'CLOSED'], ['DELIVERED', 'FAILED_FINAL', 'CLOSED']],
  ['PLATFORM_RECOVERY', ['STARTING', 'RECONCILING', 'READY', 'BLOCKED', 'MANUAL_REVIEW'], ['READY', 'BLOCKED', 'MANUAL_REVIEW']],
  ['OPERATIONAL_SETTING', ['DRAFT', 'APPLYING', 'EFFECTIVE', 'FAILED'], ['EFFECTIVE', 'FAILED']],
  ['CONTRACT_REGISTRY', ['BUILDING', 'VERIFIED', 'DRIFTED', 'FAILED'], ['VERIFIED', 'DRIFTED', 'FAILED']]
];

const closurePredicateNames = [
  'terminal_state', 'children_closed', 'lease_and_fence', 'side_effects_known',
  'pointer_and_epoch', 'bindings_exact', 'queue_outbox_inbox_closed',
  'runtime_process_closed', 'artifacts_filesystem_closed', 'cleanup_complete',
  'audit_evidence_valid', 'manual_review_empty'
];
const closureRootSpecificChildren = {
  COMPONENT: ['NO_ACTIVE_CONTRACT_BINDING', 'NO_AUTHORITY_RUNTIME_OR_LIVE_PROCESS'],
  BROWSER_SESSION: ['NO_ACTIVE_CONTROL_LEASE', 'NO_OPEN_BROWSER_CONTEXT_OR_PAGE', 'NO_PENDING_UPLOAD_OR_DOWNLOAD'],
  RUNTIME_INSTANCE: ['NO_AUTHORITY_PROCESS', 'NO_OPEN_CAPABILITY_SOCKET', 'NO_ACTIVE_EXECUTION_CONTEXT'],
  SIDE_EFFECT: ['KNOWN_TERMINAL_OUTCOME', 'NO_UNKNOWN_EXTERNAL_EFFECT', 'NO_COMPENSATION_PENDING'],
  CLEANUP_OPERATION: ['ALL_RESOURCES_VERIFIED_ABSENT', 'NO_PENDING_CLEANUP_SIDE_EFFECT'],
  PLATFORM_RECOVERY: ['READY_INVENTORY_STABLE', 'NO_UNCLASSIFIED_RECOVERY_ITEM'],
  GENERATION_JOB: ['NO_PROVISIONAL_ARTIFACT', 'NO_PENDING_PHASE_OR_SUCCESSOR'],
  AGENT_RUN: ['NO_PENDING_TOOL_OR_HANDOFF', 'NO_UNRESOLVED_CONTEXT'],
  MCP_CALL_RUN: ['NO_PENDING_INPUT_OR_TASK', 'NO_SUBSCRIPTION_DELIVERY_GAP'],
  MCP_TASK: ['NO_PENDING_INPUT_REQUEST'],
  AI_MODEL_CALL: ['NO_PENDING_PROVIDER_ATTEMPT', 'NO_UNRECONCILED_OUTPUT'],
  DEPLOYMENT_RUN: ['NO_PARTIAL_DEPLOYMENT_POINTER', 'NO_PENDING_DEPLOYMENT_STEP'],
  ACTIVATION_SET: ['NO_PARTIAL_ACTIVATION_MEMBER', 'NO_PENDING_SWITCH'],
  SECRET_RECORD: ['NO_ACTIVE_SECRET_BINDING', 'NO_PENDING_INVALIDATION'],
  OPERATIONAL_ALERT: ['NO_PENDING_ALERT_DELIVERY'],
  SELF_TEST_RUN: ['NO_PENDING_CASE_RESULT'],
  SYSTEM_CHAT_CONVERSATION: ['NO_PENDING_CHAT_ACTION'],
  OWNER_IDENTITY: ['NO_ACTIVE_OWNER_CHILD_OPERATION'],
  AUDIT_HEAD: ['AUDIT_HEAD_CHAIN_COMPLETE']
};

function closureRecordFor(machine, requirementIds) {
  const root = machine.aggregateKind;
  const queryPrefix = `QUERY-CLOSURE-${root}`;
  const ast = JSON.stringify({ op: 'AND', args: closurePredicateNames.map((predicate) => ({ predicate })) });
  return {
    closurePredicateId: `CLOSURE-${root}`, rootKind: root, terminalStates: machine.terminalStates,
    requiredChildPredicates: closureRootSpecificChildren[root] ?? ['NO_AUTHORITY_BEARING_PENDING_CHILD'],
    forbiddenPendingChildKinds: ['LEASE', 'SIDE_EFFECT', 'QUEUE', 'OUTBOX', 'INBOX', 'CLEANUP', 'APPROVAL', 'TASK'],
    forbiddenProvisionalKinds: ['RUNTIME', 'IDENTITY', 'BINDING', 'POINTER', 'ARTIFACT', 'EXECUTION_CONTEXT'],
    leaseAndFencePredicate: 'lease_and_fence', sideEffectPredicate: 'side_effects_known', pointerAndEpochPredicate: 'pointer_and_epoch',
    runtimeProcessPredicate: 'runtime_process_closed', bindingPredicate: 'bindings_exact', queueOutboxInboxPredicate: 'queue_outbox_inbox_closed',
    artifactFilesystemPredicate: 'artifacts_filesystem_closed', cleanupPredicate: 'cleanup_complete', auditEvidencePredicate: 'audit_evidence_valid',
    manualReviewPredicate: 'manual_review_empty', directQueryIds: [`${queryPrefix}-DB-V1`, `${queryPrefix}-RUNTIME-V1`, `${queryPrefix}-FILESYSTEM-V1`, `${queryPrefix}-EXTERNAL-V1`],
    passExpression: ast, failureCode: 'TERMINAL_CLOSURE_INCOMPLETE', requirementIds, authoritySourceRefs: ['ssot://55.13/55-13-closure-predicate-registry/predicate', 'ssot://54.26/54-26-direct-state-oracle-a-orphan-inventory/oracle']
  };
}

function makeStateMachine([kind, states, terminalStates], operationRecords) {
  const operationIds = operationRecords.filter((op) => op.aggregateRoot === kind).map((op) => op.operationId);
  const transitions = states.slice(0, -1).map((from, index) => ({
    transitionId: `TRANSITION-${kind}-${from}-${states[index + 1]}`,
    fromState: from,
    toState: states[index + 1],
    operationIds,
    guard: 'CANONICAL_COMMAND_AND_CURRENT_FENCE'
  })).filter((transition) => !terminalStates.includes(transition.fromState));
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

const recoveryOracleAuthorityRefs = [
  'ssot://54.12/54-12-recovery-oracle/atom-1',
  'ssot://55.12/55-12-recovery-oracle-registry/atom-1'
];
const recoveryOracleRequiredEvidence = [
  'root state/version', 'idempotency record', 'lease/fence/incarnation/deployment/recovery epoch',
  'checkpoint lineage', 'dispatch intent/outbox/claim', 'adapter send phase', 'target idempotency handle',
  'external read-back', 'provider response/task ID', 'browser mutation phase/postcondition',
  'pointer/runtime effective inventory', 'cleanup inventory'
];
const recoveryOracleForbiddenEvidence = [
  'PROCESS_MEMORY', 'MISSING_LOG', 'TIMEOUT_TEXT', 'HTTP_STATUS', 'TRANSPORT_DISCONNECT', 'PROCESS_DEATH', 'EXCEPTION_TEXT'
];
const recoveryOracleRules = (subjectId, canonicalOperationName = null) => [
  { priority: 10, ruleId: `${subjectId}:TERMINAL_OUTCOME_KNOWN`, predicate: 'TERMINAL_OUTCOME_KNOWN', allowedAction: 'REPLAY_TERMINAL', canonicalOutcome: 'TERMINAL_REPLAY', retryDirective: 'RETRY_SAME_OPERATION', stateTransitionId: 'TERMINAL_REPLAY', requiredFencingGuards: ['CURRENT_RECOVERY_EPOCH', 'CURRENT_FENCE', 'IDEMPOTENCY_DIGEST'], evidenceToPersist: ['ROOT_SNAPSHOT', 'IDEMPOTENCY_OUTCOME', 'LINEAGE_SNAPSHOT'], canonicalOperationName },
  { priority: 20, ruleId: `${subjectId}:CHECKPOINT_RESUMABLE_BEFORE_DISPATCH`, predicate: 'CHECKPOINT_RESUMABLE_BEFORE_DISPATCH', allowedAction: 'RESUME_FROM_CHECKPOINT', canonicalOutcome: 'RESUMED', retryDirective: 'RETRY_SAME_OPERATION', stateTransitionId: 'RESUME_FROM_CHECKPOINT', requiredFencingGuards: ['CURRENT_RECOVERY_EPOCH', 'CURRENT_FENCE', 'CHECKPOINT_LINEAGE'], evidenceToPersist: ['ROOT_SNAPSHOT', 'CHECKPOINT_LINEAGE', 'DISPATCH_SNAPSHOT'], canonicalOperationName },
  { priority: 30, ruleId: `${subjectId}:CANCELABLE_BEFORE_DISPATCH`, predicate: 'CANCELABLE_BEFORE_DISPATCH', allowedAction: 'CANCEL_BEFORE_DISPATCH', canonicalOutcome: 'CANCELLED_BEFORE_DISPATCH', retryDirective: 'DO_NOT_RETRY', stateTransitionId: 'CANCEL_BEFORE_DISPATCH', requiredFencingGuards: ['CURRENT_RECOVERY_EPOCH', 'CURRENT_FENCE', 'NO_DISPATCH_INTENT'], evidenceToPersist: ['ROOT_SNAPSHOT', 'DISPATCH_SNAPSHOT'], canonicalOperationName },
  { priority: 40, ruleId: `${subjectId}:CONFIRMED_NOT_APPLIED`, predicate: 'CONFIRMED_NOT_APPLIED', allowedAction: 'RETRY_SAME_OPERATION', canonicalOutcome: 'CONFIRMED_NOT_APPLIED', retryDirective: 'RETRY_SAME_OPERATION', stateTransitionId: 'RETRY_AFTER_CONFIRMED_NOT_APPLIED', requiredFencingGuards: ['CURRENT_RECOVERY_EPOCH', 'CURRENT_FENCE', 'TARGET_IDEMPOTENCY_KEY'], evidenceToPersist: ['ROOT_SNAPSHOT', 'DISPATCH_SNAPSHOT', 'EXTERNAL_READ_BACK'], canonicalOperationName },
  { priority: 50, ruleId: `${subjectId}:COMPENSATION_REQUIRED`, predicate: 'COMPENSATION_REQUIRED', allowedAction: 'RUN_COMPENSATION', canonicalOutcome: 'COMPENSATION_REQUIRED', retryDirective: 'MANUAL_REVIEW', stateTransitionId: 'COMPENSATION_REQUIRED', requiredFencingGuards: ['CURRENT_RECOVERY_EPOCH', 'CURRENT_FENCE', 'CONFIRMED_EXTERNAL_OUTCOME'], evidenceToPersist: ['ROOT_SNAPSHOT', 'EXTERNAL_READ_BACK', 'LINEAGE_SNAPSHOT'], canonicalOperationName },
  { priority: 60, ruleId: `${subjectId}:CONFIRMED_APPLIED`, predicate: 'CONFIRMED_APPLIED', allowedAction: 'RECONCILE', canonicalOutcome: 'CONFIRMED_APPLIED', retryDirective: 'RECONCILE_THEN_RETRY', stateTransitionId: 'RECONCILE_CONFIRMED_APPLIED', requiredFencingGuards: ['CURRENT_RECOVERY_EPOCH', 'CURRENT_FENCE', 'INDEPENDENT_READ_BACK'], evidenceToPersist: ['ROOT_SNAPSHOT', 'DISPATCH_SNAPSHOT', 'EXTERNAL_READ_BACK'], canonicalOperationName },
  { priority: 70, ruleId: `${subjectId}:CLEANUP_PENDING`, predicate: 'CLEANUP_PENDING', allowedAction: 'RUN_CLEANUP', canonicalOutcome: 'CLEANUP_REQUIRED', retryDirective: 'RETRY_SAME_OPERATION', stateTransitionId: 'RESUME_CLEANUP', requiredFencingGuards: ['CURRENT_RECOVERY_EPOCH', 'CURRENT_FENCE', 'CLEANUP_INVENTORY'], evidenceToPersist: ['ROOT_SNAPSHOT', 'CLEANUP_INVENTORY', 'LINEAGE_SNAPSHOT'], canonicalOperationName },
  { priority: 80, ruleId: `${subjectId}:RECONCILIATION_REQUIRED`, predicate: 'RECONCILIATION_REQUIRED', allowedAction: 'RECONCILE', canonicalOutcome: 'UNKNOWN', retryDirective: 'MANUAL_REVIEW', stateTransitionId: 'ENTER_RECONCILING', requiredFencingGuards: ['CURRENT_RECOVERY_EPOCH', 'CURRENT_FENCE', 'NO_BLIND_RETRY'], evidenceToPersist: ['ROOT_SNAPSHOT', 'DISPATCH_SNAPSHOT', 'EXTERNAL_READ_BACK', 'LINEAGE_SNAPSHOT'], canonicalOperationName }
];

function makeRecoveryOracle(subjectId, closurePredicateId, requirementIds, canonicalOperationName = null) {
  return {
    recoveryOracleId: `ORACLE-${subjectId}`,
    subjectId,
    observedAuthoritativeStateSchema: 'RECOVERY_EVIDENCE_V1',
    requiredEvidence: recoveryOracleRequiredEvidence,
    forbiddenEvidenceAssumptions: recoveryOracleForbiddenEvidence,
    rules: recoveryOracleRules(subjectId, canonicalOperationName),
    defaultOutcome: 'MANUAL_REVIEW',
    manualReviewSchemaRef: 'contracts/registry-schemas/operation-command.schema.json',
    conflictingOperationBlockKeys: ['ACCOUNT', 'RESOURCE', 'LOGICAL_OPERATION'],
    closurePredicateId,
    testCaseIds: ['TEST-TD16-RECOVERY-ORACLE-TOTALITY', 'TEST-TD16-RECOVERY-ORACLE-MUTATION'],
    requirementIds,
    authoritySourceRefs: recoveryOracleAuthorityRefs,
    canonicalDigest: sha(canonical({ subjectId, rules: recoveryOracleRules(subjectId, canonicalOperationName) }))
  };
}

const errorClassifications = ['AUTHENTICATION', 'BINDING', 'VALIDATION', 'NOT_FOUND', 'CONFLICT', 'RATE_LIMIT', 'CAPACITY', 'TIMEOUT', 'DEPENDENCY', 'PROTOCOL', 'CANCELLED', 'MANUAL_REVIEW', 'INTERNAL'];
const errorSideEffectPoints = ['PRE_ADMISSION', 'PRE_DISPATCH', 'POSSIBLE_EFFECT', 'POST_COMMIT', 'EVIDENCE_ONLY'];

function errorClassification(code) {
  if (/(?:OUTCOME|UNKNOWN|RECONCILIATION|SUBMIT_OUTCOME)/u.test(code)) return 'MANUAL_REVIEW';
  if (/^KCIP_|^MCP_|PROTOCOL|HEADER|SEQUENCE|CURSOR/u.test(code)) return 'PROTOCOL';
  if (/AUTH|CREDENTIAL|SESSION|LOGIN|MFA|PASSWORD|API_KEY/u.test(code)) return 'AUTHENTICATION';
  if (/BINDING|DIGEST_STALE|TARGET_STALE|CAPABILITY_SNAPSHOT_STALE|REVISION_STALE|EPOCH_STALE/u.test(code)) return 'BINDING';
  if (/NOT_FOUND/u.test(code)) return 'NOT_FOUND';
  if (/RATE_LIMIT|THROTTL/u.test(code)) return 'RATE_LIMIT';
  if (/CAPACITY|EXHAUSTED|RESOURCE_EXHAUSTED|CONCURRENCY|PROFILE_LEASE_HELD|CONTROL_HELD/u.test(code)) return 'CAPACITY';
  if (/TIMEOUT|DEADLINE/u.test(code)) return 'TIMEOUT';
  if (/CANCEL/u.test(code)) return 'CANCELLED';
  if (/AUTHORITY|PROVENANCE|DEPUTY|SECRET_USE|SECURITY|SPOOF|INJECTION|ESCALATION/u.test(code)) return 'INTERNAL';
  if (/CONFLICT|STALE|TERMINAL|IN_PROGRESS|HELD|ALREADY|IMMUTABLE|CLOSED|EXPIRED/u.test(code)) return 'CONFLICT';
  if (/REQUIRED|INVALID|MISSING|UNSUPPORTED|NOT_FOUND|NOT_READY|FAILED|INCOMPLETE|UNRESUMABLE|UNAPPROVABLE|BLOCKED/u.test(code)) return 'VALIDATION';
  if (/DNS|TLS|PROVIDER|ENGINE|SOCKET|CHANNEL|SANDBOX|SECCOMP|CHILD|RUNTIME|BROWSER|FILESYSTEM/u.test(code)) return 'DEPENDENCY';
  return 'INTERNAL';
}

function errorSideEffectPoint(code) {
  if (/^SSOT_|^CONTRACT_|^REQUIREMENT_|^ORPHAN_|^OPERATION_CONTRACT_|^STATE_MACHINE_CONTRACT_|^POSTGRES_CONTRACT_|^RUNTIME_BOUNDARY_CONTRACT_|^BINDING_CONTRACT_|^ERROR_RECOVERY_CONTRACT_|^AUTHORITY_OWNERSHIP_CONFLICT$|^EXPOSURE_PARITY_|^ACCEPTANCE_GATE_|^CLOSURE_PREDICATE_|^ARCHITECTURE_READINESS_/u.test(code)) return 'PRE_ADMISSION';
  if (/(?:OUTCOME|RECONCILIATION|POSTCONDITION|SUBMIT|EFFECTIVE_UNKNOWN|RENDERER_CRASHED|DOWNLOAD_INCOMPLETE|UPLOAD_INCOMPLETE|BACKGROUND_CANCEL_UNCONFIRMED)/u.test(code)) return 'POSSIBLE_EFFECT';
  if (/^AUDIT_|^TERMINAL_STATE_IMMUTABLE$/u.test(code)) return 'EVIDENCE_ONLY';
  if (/^MCP_CANCELLED$|^KCIP_CANCELLED$|^RUNTIME_CANCELLED$|^BROWSER_SESSION_TERMINAL$/u.test(code)) return 'POST_COMMIT';
  return 'PRE_DISPATCH';
}

const refreshDirectiveCodes = new Set([
  'KCIP_TARGET_NOT_FOUND', 'KCIP_TARGET_STALE', 'KCIP_CONTRACT_DIGEST_STALE', 'KCIP_BINDING_STALE', 'KCIP_STATE_VERSION_CONFLICT', 'STATE_VERSION_CONFLICT',
  'MCP_DISCOVERY_STALE', 'MCP_REQUEST_STATE_EXPIRED', 'MCP_CURSOR_INVALID', 'MCP_STATE_HANDLE_EXPIRED', 'MCP_TASK_EXPIRED',
  'MCP_BINDING_STALE', 'MCP_CONTRACT_DIGEST_STALE', 'OPENAI_MODEL_CAPABILITY_UNSUPPORTED', 'MODEL_OUTPUT_SCHEMA_INVALID',
  'CAPABILITY_SNAPSHOT_STALE', 'SPECIFICATION_DIGEST_STALE', 'WORKSPACE_BASE_STALE', 'REVISION_STALE', 'BINDING_REVISION_STALE',
  'ACTIVATION_EPOCH_STALE', 'AGENT_APPROVAL_STALE', 'AGENT_CHECKPOINT_INCOMPATIBLE', 'RUNTIME_CONTEXT_NOT_CURRENT',
  'RUNTIME_RELEASE_STALE', 'RUNTIME_BINDING_STALE', 'RUNTIME_ACTIVATION_STALE', 'RUNTIME_CREDENTIAL_GENERATION_STALE',
  'BROWSER_RUNTIME_BUILD_INCOMPATIBLE', 'BROWSER_HOST_GENERATION_STALE', 'BROWSER_CONTEXT_GENERATION_STALE', 'BROWSER_CONTROL_STALE',
  'BROWSER_PAGE_STALE', 'BROWSER_FRAME_STALE', 'BROWSER_DOCUMENT_STALE', 'BROWSER_NAVIGATION_STALE', 'BROWSER_VIEWPORT_STALE',
  'BROWSER_TARGET_DRIFT', 'BROWSER_AUTH_EPOCH_STALE', 'BROWSER_CHALLENGE_STALE', 'BROWSER_STATE_BUNDLE_STALE', 'BROWSER_BRIDGE_CERTIFICATE_STALE',
  'BROWSER_BRIDGE_CONNECTION_STALE', 'PLATFORM_INCARNATION_STALE', 'CHECKPOINT_STALE', 'CHECKPOINT_DIGEST_INVALID'
]);
const reconcileDirectiveCodes = new Set([
  'KCIP_DEADLINE_EXCEEDED', 'KCIP_OUTCOME_UNKNOWN', 'MCP_DEADLINE_EXCEEDED', 'MCP_OUTCOME_UNKNOWN', 'OPENAI_TOOL_EFFECT_OUTCOME_UNKNOWN',
  'OPENAI_BACKGROUND_CANCEL_UNCONFIRMED', 'SIDE_EFFECT_OUTCOME_UNKNOWN', 'SIDE_EFFECT_RECONCILIATION_UNKNOWN', 'SIDE_EFFECT_RECONCILIATION_FAILED',
  'BROWSER_RECONCILIATION_REQUIRED', 'BROWSER_POSTCONDITION_FAILED', 'BROWSER_DOWNLOAD_INCOMPLETE', 'BROWSER_UPLOAD_INCOMPLETE',
  'CREDENTIAL_EXPIRED', 'CREDENTIAL_ROTATED', 'ROLLBACK_INCOMPLETE', 'CLEANUP_INCOMPLETE', 'RUNTIME_OUTCOME_UNKNOWN'
]);
const manualReviewDirectiveCodes = new Set([
  'MODEL_SUBMIT_OUTCOME_UNKNOWN', 'ACTIVATION_EFFECTIVE_UNKNOWN', 'RECOVERY_ORACLE_CONFLICT', 'BROWSER_RECOVERY_UNKNOWN',
  'PLATFORM_RECOVERY_BLOCKED', 'TERMINAL_CLOSURE_INCOMPLETE', 'RUNTIME_CHILD_CLEANUP_INCOMPLETE'
]);
const retrySameOperationCodes = new Set(['OPENAI_PROVIDER_TRANSIENT', 'PLATFORM_RECOVERY_IN_PROGRESS', 'QUEUE_CAPACITY_EXHAUSTED', 'STORAGE_CAPACITY_EXHAUSTED', 'KCIP_CAPACITY_EXHAUSTED', 'BROWSER_HOST_CAPACITY']);

function recoveryDecisionTable(code) {
  const tableId = `RECOVERY-${code}`;
  return {
    recoveryDecisionTableId: tableId,
    recoveryDecisionTable: {
      tableId,
      ordering: 'SPECIFIC_BEFORE_GENERAL',
      rules: [
        { ruleId: `${tableId}-NO_EFFECT`, predicate: 'effectOutcome=CONFIRMED_NOT_APPLIED', outcome: 'KNOWN_NOT_APPLIED', directive: 'RETRY_SAME_OPERATION' },
        { ruleId: `${tableId}-APPLIED`, predicate: 'effectOutcome=CONFIRMED_APPLIED', outcome: 'KNOWN_APPLIED', directive: 'DO_NOT_RETRY' },
        { ruleId: `${tableId}-POSSIBLE`, predicate: 'effectOutcome=POSSIBLE_EFFECT', outcome: 'RECONCILIATION_REQUIRED', directive: 'RECONCILE_THEN_RETRY' },
        { ruleId: `${tableId}-UNKNOWN`, predicate: 'effectOutcome=UNKNOWN', outcome: 'MANUAL_REVIEW_REQUIRED', directive: 'MANUAL_REVIEW' }
      ],
      defaultRule: { predicate: 'otherwise', outcome: 'MANUAL_REVIEW_REQUIRED', directive: 'MANUAL_REVIEW' },
      total: true,
      mutuallyExclusive: true
    }
  };
}

function stableErrorMeaning(code) {
  const explicit = {
    KCIP_MALFORMED_ENVELOPE: 'KCIP envelope framing or JSON is invalid before dispatch',
    KCIP_OUTCOME_UNKNOWN: 'KCIP external effect cannot be confirmed or disproved',
    MCP_HEADER_MISMATCH: 'required MCP routing header does not match the JSON-RPC body',
    MCP_PROTOCOL_VERSION_UNSUPPORTED: 'the requested MCP protocol version is not supported',
    OPENAI_PROVIDER_TRANSIENT: 'a transient provider failure occurred without ambiguous submission',
    MODEL_SUBMIT_OUTCOME_UNKNOWN: 'provider submission started without a persisted response handle or known outcome',
    BROWSER_RECOVERY_UNKNOWN: 'browser/account effect cannot be confirmed after a possible mutation',
    PLATFORM_RECOVERY_BLOCKED: 'startup reconciliation found an ambiguous or invalid platform state',
    ERROR_RECOVERY_CONTRACT_INCOMPLETE: 'the stable error and recovery contract is incomplete'
  };
  return explicit[code] ?? code.replaceAll('_', ' ').toLowerCase();
}

function fixedRetryDirective(code) {
  if (retrySameOperationCodes.has(code)) return 'RETRY_SAME_OPERATION';
  if (refreshDirectiveCodes.has(code)) return 'REFRESH_AND_RETRY_NEW_COMMAND';
  if (reconcileDirectiveCodes.has(code)) return 'RECONCILE_THEN_RETRY';
  if (manualReviewDirectiveCodes.has(code)) return 'MANUAL_REVIEW';
  return 'DO_NOT_RETRY';
}

function httpMapping(code, classification) {
  if (/^MCP_|^KCIP_/u.test(code) || classification === 'PROTOCOL') return [400];
  if (code.includes('NOT_FOUND')) return [404];
  if (classification === 'VALIDATION') return [422];
  if (classification === 'AUTHENTICATION') return [401];
  if (classification === 'CAPACITY') return [429];
  if (classification === 'TIMEOUT') return [504];
  if (classification === 'DEPENDENCY' || classification === 'INTERNAL') return [503];
  if (classification === 'MANUAL_REVIEW') return [409];
  return [409];
}

function mcpMapping(code) {
  const standard = new Map([
    ['MCP_PARSE_ERROR', -32700], ['MCP_INVALID_REQUEST', -32600], ['MCP_METHOD_NOT_FOUND', -32601], ['MCP_INVALID_PARAMS', -32602],
    ['MCP_TOOL_NOT_FOUND', -32602], ['MCP_TASK_NOT_FOUND', -32602], ['MCP_TASK_EXPIRED', -32602], ['MCP_CURSOR_INVALID', -32602],
    ['MCP_HEADER_MISMATCH', -32020], ['MCP_CLIENT_CAPABILITY_MISSING', -32021], ['MCP_TASK_CAPABILITY_REQUIRED', -32021], ['MCP_PROTOCOL_VERSION_UNSUPPORTED', -32022]
  ]);
  if (standard.has(code)) return [standard.get(code)];
  if (code.startsWith('MCP_')) return [-32603];
  return [];
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
const requirementTraceabilityExtension = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'status', 'requiredRelationKinds', 'relations', 'missingRelationKinds'],
  properties: {
    schemaVersion: { const: '1.0' },
    status: { enum: ['COMPLETE', 'INCOMPLETE'] },
    requiredRelationKinds: { type: 'array', items: { enum: ['SOURCE', 'MIGRATION', 'TEST', 'EVIDENCE'] }, uniqueItems: true },
    missingRelationKinds: { type: 'array', items: { enum: ['SOURCE', 'MIGRATION', 'TEST', 'EVIDENCE'] }, uniqueItems: true },
    relations: {
      type: 'object',
      additionalProperties: false,
      required: ['SOURCE', 'MIGRATION', 'TEST', 'EVIDENCE'],
      properties: Object.fromEntries(['SOURCE', 'MIGRATION', 'TEST', 'EVIDENCE'].map((kind) => [kind, {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['artifactId', 'repositoryPath', 'locator', 'symbol', 'snippetDigest'],
          properties: {
            artifactId: { type: 'string', minLength: 1 },
            repositoryPath: { type: 'string', minLength: 1 },
            locator: { type: 'string', minLength: 1 },
            symbol: { type: 'string', minLength: 1 },
            snippetDigest: { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' }
          }
        }
      }]))
    }
  }
};
const closurePredicateFields = new Set([
  'leaseAndFencePredicate', 'sideEffectPredicate', 'pointerAndEpochPredicate',
  'runtimeProcessPredicate', 'bindingPredicate', 'queueOutboxInboxPredicate',
  'artifactFilesystemPredicate', 'cleanupPredicate', 'auditEvidencePredicate',
  'manualReviewPredicate'
]);

const registrySchemaRequirements = {
  REQUIREMENT_REGISTRY: ['requirementId', 'shortName', 'domain', 'normativeLevel', 'authorityRoot', 'ownerIntentRelation', 'canonicalStatement', 'specializationSourceRefs', 'subjectKind', 'subjectId', 'domainModule', 'aggregateRoots', 'stateMachineIds', 'operationIds', 'apiOperationIds', 'uiSurfaceIds', 'chatCapabilityIds', 'persistenceObjectIds', 'bindingIds', 'errorCodeIds', 'testCaseIds', 'acceptanceGateIds', 'runtimeEvidenceKinds', 'artifactIds', 'closurePredicateIds', 'authorityOwnershipIds', 'status'],
  OPERATION_CATALOG: ['operationId', 'operationName', 'operationRevision', 'operationFamily', 'exposureClass', 'canonicalWriterId', 'aggregateRoot', 'commandSchemaRef', 'responseSchemaRef', 'expectedStates', 'expectedStateVersionPolicy', 'stateMachineId', 'allowedTransitionIds', 'idempotencyScope', 'idempotencyKeySource', 'requestDigestProfile', 'concurrencyScope', 'concurrencyKeyDerivation', 'concurrencyClaimPoint', 'deadlinePolicy', 'sideEffectClass', 'subsystemSideEffectClass', 'retryClass', 'retryDirectiveMapRef', 'transactionProfileId', 'orderedLockPlanId', 'fencingPolicy', 'checkpointPolicy', 'possibleEffectTrigger', 'reconciliationOracleId', 'cancellationPolicy', 'terminalOutcomes', 'auditEventTypes', 'outboxPurposes', 'successorPolicy', 'cleanupPolicy', 'activationRelation', 'apiOperationIds', 'uiSurfaceIds', 'uiActionIds', 'chatCapabilityIds', 'selfTestCaseIds', 'acceptanceGateIds', 'surfaceBindings'],
  STATE_MACHINE_REGISTRY: ['stateMachineId', 'aggregateKind', 'aggregateRootTable', 'canonicalWriterId', 'initialStates', 'states', 'terminalStates', 'suspendedDecisionStates', 'recoveryStates', 'transitions', 'forbiddenTransitionPolicy', 'stateVersionField', 'cancellationVersionField', 'fencingFields', 'activationFields', 'linearizationProfile', 'lateEvidencePolicy', 'closurePredicateId', 'operationIds', 'acceptanceGateIds'],
  POSTGRES_CONTRACT_MATRIX: ['postgresContractId', 'operationId', 'transactionProfileId', 'isolationLevel', 'transactionSegments', 'orderedAdvisoryLocks', 'orderedRowLocks', 'absentRowGuard', 'readAfterLockGuards', 'stateVersionCas', 'fencingPredicate', 'platformIncarnationPredicate', 'applicationDeploymentEpochPredicate', 'bindingActivationPredicate', 'uniqueConstraints', 'checkConstraints', 'foreignKeys', 'deferredConstraintTriggers', 'idempotencyUniqueness', 'sequenceAllocation', 'outboxWrites', 'inboxWrites', 'successorReservation', 'successorEnqueue', 'externalEffectSplit', 'sqlstateRetryMap', 'migrationImplications', 'rollbackCompatibility', 'parallelTestIds', 'crashTestIds'],
  RUNTIME_BOUNDARY_MATRIX: ['runtimeBoundaryId', 'runtimeType', 'processIdentity', 'systemdUnit', 'osUser', 'osGroup', 'socketOrCapabilityChannels', 'peerIdentityContract', 'executionContextSource', 'allowedNetworkFamilies', 'allowedEndpoints', 'allowedFilesystemRead', 'allowedFilesystemWrite', 'allowedCredentials', 'allowedInheritedFds', 'allowedCapabilities', 'seccompProfileDigest', 'namespaceProfileDigest', 'cgroupProfile', 'prohibitedResources', 'lifecycleStateMachineId', 'runtimeGenerationPolicy', 'serviceGenerationPolicy', 'staleProcessFencing', 'shutdownDrainKillPolicy', 'childProcessPolicy', 'cleanupPredicateId', 'auditEvidence', 'testIds'],
  BINDING_REGISTRY: ['bindingId', 'bindingKind', 'bindingRevision', 'bindingDigest', 'sourceObjectId', 'sourceRevisionId', 'targetObjectId', 'targetRevisionId', 'targetOperationOrRoute', 'contractSchemaDigest', 'secretVersionSelector', 'externalTargetOrOrigin', 'accountOrTenantConstraint', 'purpose', 'lifecycle', 'bindingSetRevision', 'activationSetId', 'activationEpoch', 'validFrom', 'validUntil', 'canonicalWriterId', 'targetOperationId', 'routeOperationId', 'contractDigest', 'exact'],
  AUTHORITY_OWNERSHIP_REGISTRY: ['authorityObjectKind', 'canonicalWriterId', 'ownerModule', 'ownerServiceOrWorker', 'stateMachineId', 'allowedOperationIds', 'authoritativePersistence', 'acceptedEvidenceProducers', 'prohibitedDirectWriters', 'projectionConsumers', 'closurePredicateId'],
  ERROR_RETRY_REGISTRY: ['errorCodeId', 'code', 'namespace', 'classification', 'canonicalMeaning', 'sideEffectPoint', 'terminalityRule', 'recoveryRuleKind', 'fixedRetryDirective', 'recoveryDecisionTableId', 'sameLogicalOperationRequired', 'refreshRequired', 'reconciliationRequired', 'manualReviewRequired', 'requiredSnapshotFields', 'affectedObjectKinds', 'httpMappings', 'kcipMappings', 'mcpMappings', 'uiMessageKey', 'canonicalOwnerActions', 'auditEvidenceKinds', 'testCaseIds'],
  FAULT_CATALOG: ['faultPointId', 'operationId', 'phase', 'faultKinds', 'expectedOutcome', 'testCaseIds'],
  RECOVERY_ORACLE_REGISTRY: ['recoveryOracleId', 'subjectId', 'observedAuthoritativeStateSchema', 'requiredEvidence', 'forbiddenEvidenceAssumptions', 'rules', 'defaultOutcome', 'manualReviewSchemaRef', 'conflictingOperationBlockKeys', 'closurePredicateId', 'testCaseIds'],
  CLOSURE_PREDICATE_REGISTRY: ['closurePredicateId', 'rootKind', 'terminalStates', 'requiredChildPredicates', 'forbiddenPendingChildKinds', 'forbiddenProvisionalKinds', 'leaseAndFencePredicate', 'sideEffectPredicate', 'pointerAndEpochPredicate', 'runtimeProcessPredicate', 'bindingPredicate', 'queueOutboxInboxPredicate', 'artifactFilesystemPredicate', 'cleanupPredicate', 'auditEvidencePredicate', 'manualReviewPredicate', 'directQueryIds', 'passExpression', 'failureCode'],
  ACCEPTANCE_GATE_REGISTRY: ['gateId', 'gateKind', 'blocking', 'subjectScope', 'inputs', 'inputDigests', 'evaluatorId', 'evaluatorVersion', 'evaluatorDigest', 'environmentProfile', 'requiredEvidence', 'dependencies', 'passPredicate', 'failCodes', 'notApplicablePredicate', 'resultSchemaRef'],
  EXPOSURE_PARITY_REGISTRY: ['operationId', 'exposureClass', 'apiOperationIds', 'uiSurfaceIds', 'uiActionIds', 'chatCapabilityIds', 'auditEventTypes', 'selfTestCaseIds', 'acceptanceGateIds', 'parentOperationId', 'notApplicableReasons', 'surfaceBindings'],
  ARTIFACT_TRACE_REGISTRY: ['artifactId', 'artifactKind', 'repositoryPath', 'contentDigest', 'ownerModule', 'operationIds', 'stateMachineIds', 'registryRecordIds', 'testIds', 'releaseIds', 'generatedFrom', 'generationToolDigest', 'lifecycle']
};
const registrySchemaFilenames = {
  REQUIREMENT_REGISTRY: 'requirement-registry.schema.json', OPERATION_CATALOG: 'operation-catalog.schema.json', STATE_MACHINE_REGISTRY: 'state-machine-registry.schema.json',
  POSTGRES_CONTRACT_MATRIX: 'postgres-contract-matrix.schema.json', RUNTIME_BOUNDARY_MATRIX: 'runtime-boundary-matrix.schema.json', BINDING_REGISTRY: 'binding-registry.schema.json',
  AUTHORITY_OWNERSHIP_REGISTRY: 'authority-ownership-registry.schema.json', ERROR_RETRY_REGISTRY: 'error-retry-registry.schema.json', FAULT_CATALOG: 'fault-catalog.schema.json',
  RECOVERY_ORACLE_REGISTRY: 'recovery-oracle-registry.schema.json', CLOSURE_PREDICATE_REGISTRY: 'closure-predicate-registry.schema.json', ACCEPTANCE_GATE_REGISTRY: 'acceptance-gate-registry.schema.json',
  EXPOSURE_PARITY_REGISTRY: 'exposure-parity-registry.schema.json', ARTIFACT_TRACE_REGISTRY: 'artifact-trace-registry.schema.json'
};

const schemaField = (field) => field === 'bindingKind' ? { enum: ['CONTRACT_BINDING', 'SECRET_BINDING', 'EXTERNAL_TARGET_BINDING', 'EXTERNAL_AUTH_BINDING', 'AGENT_TOOL_BINDING', 'BROWSER_ACCOUNT_BINDING', 'BROWSER_PROFILE_ASSIGNMENT', 'ACTIVATION_SET_MEMBERSHIP', 'ROUTE_BINDING'] } : field === 'bindingRevision' ? { type: 'integer', minimum: 1 } : field === 'activationEpoch' ? { type: 'integer', minimum: 0 } : field === 'secretVersionSelector' || field === 'accountOrTenantConstraint' ? { type: ['object', 'null'] } : ['targetRevisionId', 'targetOperationId', 'routeOperationId', 'externalTargetOrOrigin', 'validFrom', 'validUntil'].includes(field) ? { type: ['string', 'null'] } : closurePredicateFields.has(field) ? stringField : field.endsWith('Ids') || field.endsWith('Refs') || field.endsWith('States') || field.endsWith('Kinds') || field.endsWith('Types') || field.endsWith('Fields') || field.endsWith('Locks') || field.endsWith('Predicates') || field.endsWith('Writes') || field.endsWith('Outcomes') || field.endsWith('Evidence') || field === 'forbiddenEvidenceAssumptions' || field === 'conflictingOperationBlockKeys' || field.endsWith('Digests') || ['states', 'acceptedEvidenceProducers', 'authoritativePersistence', 'prohibitedDirectWriters', 'projectionConsumers'].includes(field) || field === 'transitions' || field === 'rules' || field === 'inputs' || field === 'dependencies' || field === 'failCodes' || field === 'httpMappings' || field === 'kcipMappings' || field === 'mcpMappings' || field === 'allowedInheritedFds' || field === 'notApplicableReasons' || field === 'surfaceBindings' || field === 'requiredChildPredicates' || field === 'forbiddenPendingChildKinds' || field === 'forbiddenProvisionalKinds' || field === 'directQueryIds' || field === 'terminalOutcomes' || field === 'auditEventTypes' || field === 'outboxPurposes' || field === 'auditEvidence' ? arrayField : field === 'generationToolDigest' ? { type: ['string', 'null'] } : field === 'blocking' || field.endsWith('Predicate') || field === 'stateVersionCas' || field === 'fencingPredicate' || field === 'platformIncarnationPredicate' || field === 'applicationDeploymentEpochPredicate' || field === 'bindingActivationPredicate' || field === 'exact' || field.endsWith('Required') || field === 'refreshRequired' || field === 'reconciliationRequired' || field === 'manualReviewRequired' || field === 'sameLogicalOperationRequired' ? booleanField : field === 'operationRevision' || field === 'evaluatorVersion' ? { type: 'integer' } : stringField;

function makeRegistrySchema(kind) {
  const properties = { ...commonRecordProperties, recordKind: { const: kind } };
  for (const field of registrySchemaRequirements[kind]) if (!(field in properties)) properties[field] = schemaField(field);
  if (kind === 'REQUIREMENT_REGISTRY') {
    properties.extensions = {
      type: 'object',
      properties: { 'kcml:traceability': requirementTraceabilityExtension },
      additionalProperties: true
    };
  }
  if (kind === 'ERROR_RETRY_REGISTRY') {
    properties.classification = { enum: errorClassifications };
    properties.sideEffectPoint = { enum: errorSideEffectPoints };
    properties.recoveryRuleKind = { enum: ['FIXED', 'EVIDENCE_DECISION_TABLE'] };
    properties.fixedRetryDirective = { type: ['string', 'null'], enum: [...retryDirectives, null] };
    properties.recoveryDecisionTableId = { type: ['string', 'null'] };
    properties.httpMappings = { type: 'array', items: { type: 'integer' } };
    properties.kcipMappings = { type: 'array', items: { type: ['string', 'integer'] } };
    properties.mcpMappings = { type: 'array', items: { type: ['string', 'integer'] } };
    properties.canonicalOwnerActions = { type: 'array', items: { type: 'string' }, minItems: 1 };
  }
  if (kind === 'RECOVERY_ORACLE_REGISTRY') {
    properties.rules = {
      type: 'array', minItems: 1,
      items: { type: 'object', additionalProperties: false, required: ['priority', 'predicate', 'allowedAction', 'canonicalOutcome', 'retryDirective', 'stateTransitionId', 'requiredFencingGuards', 'evidenceToPersist'], properties: {
        priority: { type: 'integer', minimum: 0 }, ruleId: { type: 'string', minLength: 1 }, predicate: { type: 'string', minLength: 1 },
        allowedAction: { enum: ['REPLAY_TERMINAL', 'RESUME_FROM_CHECKPOINT', 'RETRY_SAME_OPERATION', 'RECONCILE', 'CANCEL_BEFORE_DISPATCH', 'RUN_COMPENSATION', 'RUN_CLEANUP', 'MANUAL_REVIEW'] },
        canonicalOutcome: { type: 'string', minLength: 1 }, retryDirective: { type: 'string', minLength: 1 }, stateTransitionId: { type: 'string', minLength: 1 },
        requiredFencingGuards: { type: 'array', minItems: 1, items: { type: 'string' } }, evidenceToPersist: { type: 'array', minItems: 1, items: { type: 'string' } },
        canonicalOperationName: { type: ['string', 'null'] }
      } }
    };
    properties.requiredEvidence = { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } };
    properties.forbiddenEvidenceAssumptions = { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } };
    properties.conflictingOperationBlockKeys = { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } };
    properties.defaultOutcome = { enum: ['MANUAL_REVIEW'] };
  }
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
  const ignored = new Set(['node_modules', 'dist', '.git', 'artifacts', 'test-results', 'FORENSIC_AUDIT_CURRENT.md']);
  const entries = await readdir(directory, { withFileTypes: true });
  const output = [];
  for (const entry of entries.sort((a, b) => stableCompare(a.name, b.name))) {
    if (ignored.has(entry.name) || entry.name.startsWith('._')) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await collectArtifacts(path));
    else if (entry.isFile() && !path.includes('/contracts/registries/') && !path.includes('/contracts/registry-schemas/') && !path.includes('/contracts/traceability/')) output.push(path);
  }
  return output;
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
  const ssotSurface = JSON.parse(await readFile(join(root, 'contracts/ssot-surface/routes.json'), 'utf8'));
  if (ssotSurface.schemaVersion !== '1.0' || !Array.isArray(ssotSurface.records)) throw new Error('EXPOSURE_PARITY_REST_SURFACE_INVALID');
  const routeRecords = ssotSurface.records;
  const requirementMap = new Map();
  const requirementSourceLineById = new Map();
  const requirementSourceLineByRef = new Map();
  for (const atom of parsed.atoms) {
    const record = makeRequirement(atom);
    if (!requirementSourceLineById.has(record.requirementId)) requirementSourceLineById.set(record.requirementId, atom.sourceLine);
    for (const sourceRef of record.authoritySourceRefs) requirementSourceLineByRef.set(sourceRef, atom.sourceLine);
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
    const operation = makeOperation(name, requirement ? [requirement.requirementId] : [], routeRecords);
    if (requirement) {
      requirement.domainModule = 'packages/domain';
      requirement.aggregateRoots = [operation.aggregateRoot];
      requirement.stateMachineIds = [`SM-${operation.aggregateRoot}`];
      requirement.operationIds = [operation.operationId];
      requirement.apiOperationIds = operation.apiOperationIds;
      requirement.uiSurfaceIds = operation.uiSurfaceIds;
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
  const authoritySourcePath = 'contracts/authority/authority-ownership-source.json';
  const authoritySource = JSON.parse(await readFile(join(root, authoritySourcePath), 'utf8'));
  if (authoritySource.schemaVersion !== '1.0' || authoritySource.kind !== 'AUTHORITY_OWNERSHIP_SOURCE' || !Array.isArray(authoritySource.records)) throw new Error('AUTHORITY_SOURCE_INVALID');
  const ownershipMatches = (operationName, sourceRecord) => {
    const exact = (sourceRecord.operationNames ?? []).includes(operationName);
    const prefix = (sourceRecord.operationNamePrefixes ?? []).some((candidate) => operationName.startsWith(candidate));
    const excluded = (sourceRecord.operationNameExcludes ?? []).includes(operationName);
    return !excluded && (exact || prefix);
  };
  const ownershipMatchesForOperation = (operationName) => authoritySource.records.filter((record) => ownershipMatches(operationName, record));
  const stateMachines = stateMachineSpecs.map((spec) => makeStateMachine(spec, operations));
  const recoveryRequirementIds = requirements.filter((requirement) => requirement.authoritySourceRefs.some((sourceRef) => /^(ssot:\/\/(?:54\.12|55\.12|54\.28|2\.18)\/)/u.test(sourceRef))).map((requirement) => requirement.requirementId).sort();
  for (const operation of operations) operation.reconciliationOracleId = `ORACLE-${operation.operationId}`;
  const recoveryOracles = [
    ...operations.map((operation) => makeRecoveryOracle(operation.operationId, `CLOSURE-${operation.aggregateRoot}`, [...new Set([...recoveryRequirementIds, ...operation.requirementIds])].sort(), operation.operationName)),
    ...stateMachines.map((machine) => makeRecoveryOracle(machine.stateMachineId, machine.closurePredicateId, [...new Set([...recoveryRequirementIds, ...machine.requirementIds])].sort()))
  ];
  const postgres = operations.map((operation) => ({
    ...contractFor(operation), requirementIds: operation.requirementIds,
    authoritySourceRefs: ['ssot://51/postgresql-transakcni-soubehovy-a-migracni-kontrakt/operation']
  }));
  const runtimeMatrixSourcePath = 'contracts/normative/runtime-boundaries.source.json';
  const runtimeMatrixSource = JSON.parse(await readFile(join(root, runtimeMatrixSourcePath), 'utf8'));
  if (runtimeMatrixSource.schemaVersion !== '1.0' || runtimeMatrixSource.kind !== 'RUNTIME_BOUNDARY_NORMATIVE_SOURCE' || !Array.isArray(runtimeMatrixSource.runtimeTypes) || runtimeMatrixSource.runtimeTypes.length === 0) {
    throw new Error('RUNTIME_BOUNDARY_MATRIX_SOURCE_INVALID');
  }
  const runtimeRecords = [];
  const runtimeTypeIds = new Set();
  for (const sourceRecord of runtimeMatrixSource.runtimeTypes) {
    if (runtimeTypeIds.has(sourceRecord.runtimeType)) throw new Error(`RUNTIME_BOUNDARY_DUPLICATE_TYPE:${sourceRecord.runtimeType}`);
    runtimeTypeIds.add(sourceRecord.runtimeType);
    const requiredFields = ['runtimeBoundaryId', 'runtimeType', 'processIdentity', 'systemdUnit', 'osUser', 'osGroup', 'socketOrCapabilityChannels', 'peerIdentityContract', 'executionContextSource', 'allowedNetworkFamilies', 'allowedEndpoints', 'allowedFilesystemRead', 'allowedFilesystemWrite', 'allowedCredentials', 'allowedInheritedFds', 'allowedCapabilities', 'seccompProfileDigest', 'namespaceProfileDigest', 'cgroupProfile', 'prohibitedResources', 'lifecycleStateMachineId', 'runtimeGenerationPolicy', 'serviceGenerationPolicy', 'staleProcessFencing', 'shutdownDrainKillPolicy', 'childProcessPolicy', 'cleanupPredicateId', 'auditEvidence', 'testIds', 'requirementRefs'];
    for (const field of requiredFields) if (!(field in sourceRecord)) throw new Error(`RUNTIME_BOUNDARY_FIELD_MISSING:${sourceRecord.runtimeType}:${field}`);
    if (sourceRecord.prohibitedResources.length === 0) throw new Error(`RUNTIME_BOUNDARY_PROHIBITIONS_EMPTY:${sourceRecord.runtimeType}`);
    if (!/^sha256:[0-9a-f]{64}$/u.test(sourceRecord.seccompProfileDigest) || !/^sha256:[0-9a-f]{64}$/u.test(sourceRecord.namespaceProfileDigest)) throw new Error(`RUNTIME_BOUNDARY_PROFILE_DIGEST_INVALID:${sourceRecord.runtimeType}`);
    const requirementIds = [];
    for (const requirementRef of sourceRecord.requirementRefs) {
      const requirement = requirements.find((candidate) => candidate.authoritySourceRefs.includes(requirementRef));
      if (!requirement) throw new Error(`RUNTIME_BOUNDARY_REQUIREMENT_MISSING:${sourceRecord.runtimeType}:${requirementRef}`);
      requirementIds.push(requirement.requirementId);
    }
    const record = { ...sourceRecord };
    delete record.requirementRefs;
    record.requirementIds = [...new Set(requirementIds)].sort();
    record.authoritySourceRefs = [...new Set([...(runtimeMatrixSource.authoritySourceRefs ?? []), ...sourceRecord.requirementRefs])].sort();
    record.canonicalDigest = sha(canonical(record));
    runtimeRecords.push(record);
  }
  const runtimes = runtimeRecords;
  const errorRecords = parsed.errors.map((code) => {
    const classification = errorClassification(code);
    const sideEffectPoint = errorSideEffectPoint(code);
    const tableDriven = sideEffectPoint === 'POSSIBLE_EFFECT' && /(?:OUTCOME|RECONCILIATION|POSTCONDITION|SUBMIT|EFFECTIVE_UNKNOWN|RECOVERY_UNKNOWN)/u.test(code);
    const requirementIds = requirements.filter((requirement) => requirement.canonicalStatement === code).map((requirement) => requirement.requirementId);
    if (requirementIds.length === 0) throw new Error(`STABLE_ERROR_REQUIREMENT_MISSING:${code}`);
    const authoritySourceRefs = requirements.filter((requirement) => requirementIds.includes(requirement.requirementId)).flatMap((requirement) => requirement.authoritySourceRefs);
    const table = tableDriven ? recoveryDecisionTable(code) : { recoveryDecisionTableId: null, recoveryDecisionTable: null };
    return {
      errorCodeId: `ERR-${code}`, code, namespace: code.split('_')[0], classification,
      canonicalMeaning: stableErrorMeaning(code), sideEffectPoint, terminalityRule: sideEffectPoint === 'POST_COMMIT' ? 'REPLAY_CANONICAL_OUTCOME' : 'STATE_MACHINE_DEFINED',
      recoveryRuleKind: tableDriven ? 'EVIDENCE_DECISION_TABLE' : 'FIXED', fixedRetryDirective: tableDriven ? null : fixedRetryDirective(code),
      recoveryDecisionTableId: table.recoveryDecisionTableId, sameLogicalOperationRequired: sideEffectPoint === 'POSSIBLE_EFFECT' || tableDriven,
      refreshRequired: refreshDirectiveCodes.has(code), reconciliationRequired: tableDriven || reconcileDirectiveCodes.has(code), manualReviewRequired: tableDriven || manualReviewDirectiveCodes.has(code) || code.includes('UNKNOWN'),
      requiredSnapshotFields: ['stateVersion', 'activationEpoch', 'recoveryEpoch', 'logicalOperationId', 'correlationId'],
      affectedObjectKinds: ['COMPONENT','RUNTIME_INSTANCE','MCP_CALL_RUN','AGENT_RUN','SECRET_RECORD','OPERATIONAL_ALERT','BROWSER_SESSION','GENERATION_JOB','DEPLOYMENT_RUN','SELF_TEST_RUN'],
      httpMappings: httpMapping(code, classification), kcipMappings: ['ERROR'], mcpMappings: mcpMapping(code),
      uiMessageKey: `errors.${code}`, canonicalOwnerActions: tableDriven || manualReviewDirectiveCodes.has(code) ? ['OPEN_EVIDENCE', 'RESOLVE_OUTCOME'] : ['OPEN_EVIDENCE'],
      auditEvidenceKinds: ['ERROR', ...(tableDriven ? ['SIDE_EFFECT_OUTCOME', 'RECOVERY_DECISION'] : [])], testCaseIds: [`ERROR-${code}`], requirementIds,
      authoritySourceRefs, extensions: {
        recoveryDecisionTable: table.recoveryDecisionTable,
        reservation: { kind: 'SSOT_STABLE_WIRE_COMPATIBILITY', authority: 'SSOT_CURRENT.md chapter 32' }
      }
    };
  });
  const gateRecords = gates.map((gateId) => ({
    gateId, gateKind: gateId.startsWith('ARCH_') ? 'ARCHITECTURE' : 'VALIDATION', blocking: true, subjectScope: 'RELEASE', inputs: ['SSOT', 'CONTRACT_PACK', 'SOURCE', 'TEST_EVIDENCE'], inputDigests: [],
    evaluatorId: `EVALUATOR-${gateId}`, evaluatorVersion: 1, evaluatorDigest: sha(gateId), environmentProfile: gateId.includes('RUNTIME') ? 'SYSTEMD_RUNTIME' : 'BUILD',
    requiredEvidence: ['MACHINE_RESULT'], dependencies: [], passPredicate: 'ALL_OBLIGATIONS_PASS', failCodes: ['GATE_FAILED'], notApplicablePredicate: 'FALSE',
    resultSchemaRef: 'contracts/registry-schemas/common-record.schema.json', requirementIds: [], authoritySourceRefs: ['ssot://55/architecture-readiness-gate-registry/gate'], canonicalDigest: sha(canonical({ gateId }))
  }));
  const closureRequirementIds = stableSort(requirements.filter((requirement) => requirement.authoritySourceRefs.some((sourceRef) => /^(?:ssot:\/\/(?:48\.38|49\.34|51\.26|54\.26|55\.13)\/)/u.test(sourceRef))).map((requirement) => requirement.requirementId));
  const closure = stateMachines.map((machine) => closureRecordFor(machine, closureRequirementIds));
  const operationByName = new Map(operations.map((operation) => [operation.operationName, operation]));
  const exposure = operations.map((operation) => {
    for (const binding of operation.surfaceBindings) {
      if (binding.status === 'NOT_APPLICABLE') {
        if (!binding.reasonCode || binding.supportingRequirementSourceRef !== EXPOSURE_PARITY_SOURCE_REF) throw new Error(`EXPOSURE_PARITY_NOT_APPLICABLE_UNSUPPORTED:${operation.operationName}:${binding.bindingId}`);
        continue;
      }
      if (!binding.bindingId || /^(?:API|UI-ACTION|CHAT|SELFTEST)-/u.test(binding.bindingId)) throw new Error(`EXPOSURE_PARITY_SYNTHETIC_BINDING:${operation.operationName}:${binding.bindingId}`);
      if (!binding.sourcePath || !binding.sourceSymbol || !binding.sourceMarker) throw new Error(`EXPOSURE_PARITY_BINDING_SOURCE_MISSING:${operation.operationName}:${binding.bindingId}`);
      if (binding.bindingId.startsWith('REST_ROUTE:') && !routeRecords.some((route) => `REST_ROUTE:${route.routeKey}` === binding.bindingId)) throw new Error(`EXPOSURE_PARITY_ROUTE_BINDING_MISSING:${operation.operationName}:${binding.bindingId}`);
    }
    const parent = operation.parentOperationName ? operationByName.get(operation.parentOperationName) : null;
    if (operation.exposureClass === 'INTERNAL_PROTOCOL' && (!parent || parent.operationId === operation.operationId)) throw new Error(`EXPOSURE_PARITY_INTERNAL_PARENT_INVALID:${operation.operationName}`);
    const authoritySourceRefs = [EXPOSURE_PARITY_SOURCE_REF];
    return {
      operationId: operation.operationId, exposureClass: operation.exposureClass, apiOperationIds: operation.apiOperationIds,
      uiSurfaceIds: operation.uiSurfaceIds, uiActionIds: operation.uiActionIds, chatCapabilityIds: operation.chatCapabilityIds,
      auditEventTypes: operation.auditEventTypes, selfTestCaseIds: operation.selfTestCaseIds, acceptanceGateIds: operation.acceptanceGateIds,
      parentOperationId: parent?.operationId ?? null, notApplicableReasons: operation.surfaceBindings.filter((binding) => binding.status === 'NOT_APPLICABLE').map((binding) => ({ surface: binding.bindingId.split(':', 1)[0], reasonCode: binding.reasonCode, supportingRequirementSourceRef: binding.supportingRequirementSourceRef })),
      surfaceBindings: operation.surfaceBindings, requirementIds: operation.requirementIds, authoritySourceRefs
    };
  });
  const authorityRequirementIds = (sourceRefs) => [...new Set((sourceRefs ?? []).flatMap((sourceRef) => {
    const requirement = requirements.find((candidate) => candidate.authoritySourceRefs.includes(sourceRef));
    if (!requirement) throw new Error(`AUTHORITY_REQUIREMENT_SOURCE_MISSING:${sourceRef}`);
    return [requirement.requirementId];
  }))].sort();
  const authorities = authoritySource.records.map((sourceRecord) => {
    const allowedOperations = operations.filter((operation) => ownershipMatchesForOperation(operation.operationName).some((candidate) => candidate.authorityObjectKind === sourceRecord.authorityObjectKind));
    const requirementIds = authorityRequirementIds([...(authoritySource.authoritySourceRefs ?? []), ...(sourceRecord.requirementSourceRefs ?? [])]);
    if (requirementIds.length === 0) throw new Error(`AUTHORITY_REQUIREMENTS_EMPTY:${sourceRecord.authorityObjectKind}`);
    const stateMachine = stateMachines.find((candidate) => candidate.stateMachineId === sourceRecord.stateMachineId);
    if (!stateMachine) throw new Error(`AUTHORITY_STATE_MACHINE_MISSING:${sourceRecord.authorityObjectKind}:${sourceRecord.stateMachineId}`);
    return {
      authorityObjectKind: sourceRecord.authorityObjectKind,
      canonicalWriterId: sourceRecord.canonicalWriterId,
      ownerModule: sourceRecord.ownerModule,
      ownerServiceOrWorker: sourceRecord.ownerServiceOrWorker,
      stateMachineId: sourceRecord.stateMachineId,
      allowedOperationIds: allowedOperations.map((operation) => operation.operationId),
      authoritativePersistence: ['POSTGRESQL'],
      acceptedEvidenceProducers: ['TRUSTED_TYPED_EVIDENCE'],
      prohibitedDirectWriters: ['UI', 'MODEL', 'GENERATED_HANDLER', 'PROVIDER', 'BROWSER_EVENT', 'DEPLOYMENT_SCRIPT', 'TEST_HELPER', 'FILESYSTEM'],
      projectionConsumers: ['API', 'UI', 'CHAT', 'MONITORING'],
      closurePredicateId: `CLOSURE-${stateMachine.aggregateKind}`,
      requirementIds,
      authoritySourceRefs: [...new Set([...(authoritySource.authoritySourceRefs ?? []), ...(sourceRecord.requirementSourceRefs ?? [])])].sort(),
      canonicalDigest: sha(canonical({ authorityObjectKind: sourceRecord.authorityObjectKind, canonicalWriterId: sourceRecord.canonicalWriterId, ownerModule: sourceRecord.ownerModule, ownerServiceOrWorker: sourceRecord.ownerServiceOrWorker, stateMachineId: sourceRecord.stateMachineId, allowedOperationIds: allowedOperations.map((operation) => operation.operationId), requirementIds }))
    };
  });
  const authorityByOperation = new Map();
  for (const operation of operations) {
    const matches = authorities.filter((authority) => authority.allowedOperationIds.includes(operation.operationId));
    if (matches.length !== 1) throw new Error(`AUTHORITY_OPERATION_CARDINALITY:${operation.operationName}:${matches.length}`);
    const [owner] = matches;
    if (owner.canonicalWriterId !== operation.canonicalWriterId || owner.stateMachineId !== operation.stateMachineId) throw new Error(`AUTHORITY_OPERATION_CONTRACT_MISMATCH:${operation.operationName}`);
    authorityByOperation.set(operation.operationId, owner.authorityObjectKind);
  }
  for (const authority of authorities) for (const requirementId of authority.requirementIds) {
    const requirement = requirementMap.get(requirementId);
    if (!requirement) throw new Error(`AUTHORITY_REQUIREMENT_LOOKUP_FAILED:${authority.authorityObjectKind}:${requirementId}`);
    requirement.authorityOwnershipIds.push(authority.authorityObjectKind);
    requirement.domainModule ??= authority.ownerModule;
    requirement.stateMachineIds = [...new Set([...requirement.stateMachineIds, authority.stateMachineId])].sort();
    requirement.closurePredicateIds = [...new Set([...requirement.closurePredicateIds, authority.closurePredicateId])].sort();
    requirement.status = 'ACTIVE';
  }
  // Normative compilation ends at declared SSOT and versioned contract sources.
  // Implementation, test and runtime evidence is compiled/validated by the separate traceability layer.

  const schemaManifest = { schemaVersion: '1.0', schemas: Object.keys(schemas).sort().map((name) => ({ ref: `contracts/registry-schemas/${name}`, digest: sha(canonical(schemas[name])) })) };
  schemaManifest.digest = sha(canonical(schemaManifest));

  const registries = [
    ['REQUIREMENT_REGISTRY', 'requirements/requirements.json', requirements],
    ['OPERATION_CATALOG', 'operations/operations.json', operations],
    ['STATE_MACHINE_REGISTRY', 'state-machines/state-machines.json', stateMachines],
    ['POSTGRES_CONTRACT_MATRIX', 'postgres/postgres-contracts.json', postgres],
    ['RUNTIME_BOUNDARY_MATRIX', 'runtime-boundaries/runtime-boundaries.json', runtimes],
    ['BINDING_REGISTRY', 'bindings/bindings.json', [...operations.map((operation) => makeBindingRecord(operation, bindingKindForOperation(operation), [])), ...makeBindingKindCoverageRecords()]],
    ['AUTHORITY_OWNERSHIP_REGISTRY', 'authority/authority-ownership.json', authorities],
    ['ERROR_RETRY_REGISTRY', 'errors/errors.json', errorRecords],
    ['FAULT_CATALOG', 'faults/faults.json', operations.map((operation) => ({ faultPointId: `FAULT-${operation.operationId}`, operationId: operation.operationId, phase: 'PRE_AND_POST_SIDE_EFFECT', faultKinds: ['PROCESS_KILL','TIMEOUT','DUPLICATE','STALE_FENCE','DATABASE_RESTART'], expectedOutcome: 'RECOVERY_ORACLE', testCaseIds: [`FAULT-TEST-${operation.operationId}`], authoritySourceRefs: ['ssot://54/fault-catalog/fault-point'], requirementIds: operation.requirementIds, canonicalDigest: sha(canonical({ operationId: operation.operationId, phase: 'PRE_AND_POST_SIDE_EFFECT' })) }))],
    ['RECOVERY_ORACLE_REGISTRY', 'recovery-oracles/recovery-oracles.json', recoveryOracles],
    ['CLOSURE_PREDICATE_REGISTRY', 'closure-predicates/closure-predicates.json', closure],
    ['ACCEPTANCE_GATE_REGISTRY', 'acceptance-gates/acceptance-gates.json', gateRecords],
    ['EXPOSURE_PARITY_REGISTRY', 'exposure-parity/exposure-parity.json', exposure]
  ];

  // Materialize reverse requirement edges from the requirement record itself.
  // This makes the generated pack self-auditing: every forward edge must have
  // a matching requirementIds entry on the target registry record.
  const registryTargets = new Map(registries.map(([kind, , records]) => [kind, new Map(records.map((record) => [registryRecordId(kind, record), record]))]));
  const reverseFields = [
    ['stateMachineIds', 'STATE_MACHINE_REGISTRY'], ['operationIds', 'OPERATION_CATALOG'], ['bindingIds', 'BINDING_REGISTRY'],
    ['errorCodeIds', 'ERROR_RETRY_REGISTRY'], ['acceptanceGateIds', 'ACCEPTANCE_GATE_REGISTRY'], ['closurePredicateIds', 'CLOSURE_PREDICATE_REGISTRY'],
    ['authorityOwnershipIds', 'AUTHORITY_OWNERSHIP_REGISTRY']
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
  // Architecture readiness is produced by the evidence evaluator, never by the normative compiler.

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
  process.stdout.write(`${checkOnly ? 'verified' : 'generated'} requirements=${requirements.length} operations=${operations.length} files=${outputs.size} pack=${manifest.packDigest}\n`);
}

await main();
