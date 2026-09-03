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
    status: 'UNMAPPED',
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
      authoritySourceRefs, extensions: { recoveryDecisionTable: table.recoveryDecisionTable }
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
  const paritySourcePaths = [...new Set(operations.flatMap((operation) => operation.surfaceBindings.filter((binding) => binding.status === 'APPLICABLE').map((binding) => binding.sourcePath).filter(Boolean)))];
  const paritySourceText = new Map();
  for (const sourcePath of paritySourcePaths) paritySourceText.set(sourcePath, await readFile(join(root, sourcePath), 'utf8'));
  const exposure = operations.map((operation) => {
    for (const binding of operation.surfaceBindings) {
      if (binding.status === 'NOT_APPLICABLE') {
        if (!binding.reasonCode || binding.supportingRequirementSourceRef !== EXPOSURE_PARITY_SOURCE_REF) throw new Error(`EXPOSURE_PARITY_NOT_APPLICABLE_UNSUPPORTED:${operation.operationName}:${binding.bindingId}`);
        continue;
      }
      if (!binding.bindingId || /^(?:API|UI-ACTION|CHAT|SELFTEST)-/u.test(binding.bindingId)) throw new Error(`EXPOSURE_PARITY_SYNTHETIC_BINDING:${operation.operationName}:${binding.bindingId}`);
      if (!binding.sourcePath || !binding.sourceSymbol || !binding.sourceMarker) throw new Error(`EXPOSURE_PARITY_BINDING_SOURCE_MISSING:${operation.operationName}:${binding.bindingId}`);
      const sourceText = paritySourceText.get(binding.sourcePath);
      if (!sourceText?.includes(binding.sourceMarker)) throw new Error(`EXPOSURE_PARITY_SOURCE_SYMBOL_MISSING:${operation.operationName}:${binding.sourcePath}:${binding.sourceMarker}`);
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
  const artifacts = [];
  const addArtifact = (repositoryPath, bytes, options = {}) => {
    const contentDigest = sha(bytes);
    const artifactId = `ART-${sha(`${repositoryPath}\u0000${contentDigest}`).slice(7)}`;
    const ownerModule = repositoryPath.split('/')[0] === 'packages' ? repositoryPath.split('/').slice(0, 2).join('/') : repositoryPath.split('/')[0];
    artifacts.push({ artifactId, artifactKind: options.artifactKind ?? 'REPOSITORY_FILE', repositoryPath, contentDigest, ownerModule,
      operationIds: options.operationIds ?? [], stateMachineIds: options.stateMachineIds ?? [], registryRecordIds: options.registryRecordIds ?? [], testIds: options.testIds ?? [], releaseIds: options.releaseIds ?? [], generatedFrom: options.generatedFrom ?? [], generationToolDigest: options.generationToolDigest ?? null,
      lifecycle: 'ACTIVE', requirementIds: options.requirementIds ?? [], evidenceRefs: [`file://${repositoryPath}`], reverseTraceRequired: true, traceAnchors: options.traceAnchors ?? [],
      authoritySourceRefs: options.authoritySourceRefs ?? ['ssot://55/artifact-traceability/file-level'], canonicalDigest: sha(canonical({ repositoryPath, contentDigest })) });
    for (const requirementId of options.requirementIds ?? []) {
      const requirement = requirementMap.get(requirementId);
      if (!requirement) throw new Error(`ARTIFACT_TRACE_REQUIREMENT_UNKNOWN:${repositoryPath}:${requirementId}`);
      requirement.artifactIds.push(artifactId);
    }
  };
  for (const artifactPath of await collectArtifacts()) {
    const bytes = await readFile(artifactPath);
    const repositoryPath = relative(root, artifactPath).replaceAll('\\', '/');
    // Content digests remain the evidence identity; artifact IDs additionally
    // include the repository path so identical project configuration files do
    // not collapse into duplicate registry records.
    addArtifact(repositoryPath, bytes);
  }
  // The source catalog is an input to this compiler, but it is also a
  // repository-owned traceability artifact. Register its four exact files
  // explicitly so file-level coverage cannot silently exclude the catalog
  // that defines the evidence boundary. These are anchored to the
  // traceability contract itself, never used as evidence for unrelated atoms.
  const traceabilityCatalogArtifacts = [
    ['contracts/traceability/artifact-trace-source.json', 'ssot://55.19/55-19-artifact-traceability-a-z-kaz-orphan-implementation/atom-1'],
    ['contracts/traceability/artifact-trace-source-overrides.json', 'ssot://55.19/55-19-artifact-traceability-a-z-kaz-orphan-implementation/atom-13'],
    ['contracts/traceability/artifact-trace-source-browser-overrides.json', 'ssot://55.19/55-19-artifact-traceability-a-z-kaz-orphan-implementation/atom-1'],
    ['contracts/traceability/artifact-trace-source-test-overrides.json', 'ssot://55.19/55-19-artifact-traceability-a-z-kaz-orphan-implementation/atom-1']
  ];
  const requirementTraceManifestPath = 'contracts/traceability/requirement-atom-trace/manifest.json';
  let requirementTraceManifest = JSON.parse(await readFile(join(root, requirementTraceManifestPath), 'utf8'));
  const expectedTraceRelationKinds = ['SOURCE', 'MIGRATION', 'TEST', 'EVIDENCE'];
  if (requirementTraceManifest.schemaVersion !== '1.0' || requirementTraceManifest.kind !== 'REQUIREMENT_ATOM_TRACE_SOURCE' || requirementTraceManifest.ssotDigest !== sha(ssotBytes) || canonical(requirementTraceManifest.relationKinds) !== canonical(expectedTraceRelationKinds) || !Array.isArray(requirementTraceManifest.shards)) {
    if (checkOnly) throw new Error('REQUIREMENT_ATOM_TRACE_MANIFEST_INVALID');
    // A deliberate SSOT revision invalidates the old atom trace by design.
    // Seed only the canonical requirement source, then regenerate the trace
    // through its sole generator before consuming it below. This keeps
    // `pnpm contracts:build` self-contained without hand-editing projections.
    const requirementsPath = join(root, 'contracts/registries/requirements/requirements.json');
    await writeFile(requirementsPath, `${canonical({ schemaVersion: '1.0', kind: 'REQUIREMENT_REGISTRY', records: requirements })}\n`, { encoding: 'utf8', mode: 0o644 });
    const { spawn } = await import('node:child_process');
    const traceExit = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['scripts/generate-requirement-trace.mjs'], { cwd: root, stdio: 'inherit' });
      child.once('error', reject);
      child.once('exit', (code) => resolve(code));
    });
    if (traceExit !== 0) throw new Error(`REQUIREMENT_ATOM_TRACE_REGENERATION_FAILED:${traceExit}`);
    requirementTraceManifest = JSON.parse(await readFile(join(root, requirementTraceManifestPath), 'utf8'));
    if (requirementTraceManifest.schemaVersion !== '1.0' || requirementTraceManifest.kind !== 'REQUIREMENT_ATOM_TRACE_SOURCE' || requirementTraceManifest.ssotDigest !== sha(ssotBytes) || canonical(requirementTraceManifest.relationKinds) !== canonical(expectedTraceRelationKinds) || !Array.isArray(requirementTraceManifest.shards)) throw new Error('REQUIREMENT_ATOM_TRACE_MANIFEST_INVALID');
  }
  const traceShardPaths = new Set();
  const traceShardDomains = new Set();
  const requirementTraceRecords = [];
  const traceabilityCatalogRequirement = requirements.find((candidate) => candidate.authoritySourceRefs.includes('ssot://55.19/55-19-artifact-traceability-a-z-kaz-orphan-implementation/atom-13'));
  if (!traceabilityCatalogRequirement) throw new Error('REQUIREMENT_ATOM_TRACE_MANIFEST_REQUIREMENT_MISSING');
  const manifestBytes = await readFile(join(root, requirementTraceManifestPath));
  addArtifact(requirementTraceManifestPath, manifestBytes, {
    artifactKind: 'REQUIREMENT_ATOM_TRACE_MANIFEST',
    requirementIds: [traceabilityCatalogRequirement.requirementId],
    traceAnchors: [{ requirementId: traceabilityCatalogRequirement.requirementId, locator: `${requirementTraceManifestPath}:1`, symbol: 'REQUIREMENT_ATOM_TRACE_MANIFEST', snippetDigest: sha(manifestBytes.toString('utf8').split('\n')[0]) }],
    authoritySourceRefs: [traceabilityCatalogRequirement.authoritySourceRefs[0]]
  });
  for (const shard of requirementTraceManifest.shards) {
    if (typeof shard.domain !== 'string' || shard.domain.length === 0 || traceShardDomains.has(shard.domain) || typeof shard.repositoryPath !== 'string' || shard.repositoryPath.length === 0 || traceShardPaths.has(shard.repositoryPath) || !/^contracts\/traceability\/requirement-atom-trace\/[^/]+\.jsonl$/u.test(shard.repositoryPath) || typeof shard.recordCount !== 'number' || !Number.isInteger(shard.recordCount) || shard.recordCount < 1 || typeof shard.contentDigest !== 'string') {
      throw new Error('REQUIREMENT_ATOM_TRACE_SHARD_INVALID');
    }
    traceShardDomains.add(shard.domain);
    traceShardPaths.add(shard.repositoryPath);
    const shardBytes = await readFile(join(root, shard.repositoryPath));
    if (sha(shardBytes) !== shard.contentDigest) throw new Error(`REQUIREMENT_ATOM_TRACE_SHARD_DIGEST_INVALID:${shard.repositoryPath}`);
    const shardLines = shardBytes.toString('utf8').split('\n');
    const records = [];
    for (const [lineIndex, line] of shardLines.entries()) {
      if (line.length === 0 && lineIndex === shardLines.length - 1) continue;
      if (line.length === 0) throw new Error(`REQUIREMENT_ATOM_TRACE_BLANK_LINE:${shard.repositoryPath}:${lineIndex + 1}`);
      let record;
      try { record = JSON.parse(line); } catch (error) { throw new Error(`REQUIREMENT_ATOM_TRACE_RECORD_INVALID:${shard.repositoryPath}:${lineIndex + 1}:${error.message}`); }
      if (!record || typeof record !== 'object' || typeof record.requirementId !== 'string' || typeof record.statementDigest !== 'string' || typeof record.authoritySourceRef !== 'string' || !record.relations || typeof record.relations !== 'object' || Array.isArray(record.relations)) throw new Error(`REQUIREMENT_ATOM_TRACE_RECORD_SHAPE_INVALID:${shard.repositoryPath}:${lineIndex + 1}`);
      records.push({ record, line, lineIndex });
    }
    if (records.length !== shard.recordCount) throw new Error(`REQUIREMENT_ATOM_TRACE_SHARD_COUNT_INVALID:${shard.repositoryPath}`);
    requirementTraceRecords.push(...records.map(({ record }) => record));
    addArtifact(shard.repositoryPath, shardBytes, {
      artifactKind: 'REQUIREMENT_ATOM_TRACE_SOURCE',
      requirementIds: records.map(({ record }) => record.requirementId),
      traceAnchors: records.map(({ record, line, lineIndex }) => ({ requirementId: record.requirementId, locator: `${shard.repositoryPath}:${lineIndex + 1}`, symbol: `REQUIREMENT_ATOM_TRACE:${record.requirementId}`, snippetDigest: sha(line) })),
      authoritySourceRefs: ['ssot://55.19/55-19-artifact-traceability-a-z-kaz-orphan-implementation/atom-13']
    });
  }
  if (requirementTraceManifest.records !== requirementTraceRecords.length) throw new Error('REQUIREMENT_ATOM_TRACE_RECORD_COUNT_INVALID');
  if (new Set(requirementTraceRecords.map((record) => record.requirementId)).size !== requirementTraceRecords.length) throw new Error('REQUIREMENT_ATOM_TRACE_REQUIREMENT_DUPLICATE');
  for (const [repositoryPath, authoritySourceRef] of traceabilityCatalogArtifacts) {
    const requirement = requirements.find((candidate) => candidate.authoritySourceRefs.includes(authoritySourceRef));
    if (!requirement) throw new Error(`TRACEABILITY_CATALOG_REQUIREMENT_MISSING:${authoritySourceRef}`);
    const bytes = await readFile(join(root, repositoryPath));
    const firstLine = bytes.toString('utf8').split('\n')[0];
    addArtifact(repositoryPath, bytes, {
      artifactKind: 'TRACEABILITY_SOURCE_CATALOG',
      requirementIds: [requirement.requirementId],
      traceAnchors: [{ requirementId: requirement.requirementId, locator: `${repositoryPath}:1`, symbol: 'TRACEABILITY_SOURCE_CATALOG', snippetDigest: sha(firstLine) }],
      authoritySourceRefs: [authoritySourceRef]
    });
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
  const errorRuntimePath = 'packages/schemas/src/error-retry-registry.ts';
  const errorTestPath = 'tests/contract-pack/error-retry.test.ts';
  const errorRuntimeArtifact = traceArtifact(errorRuntimePath);
  const errorTestArtifact = traceArtifact(errorTestPath);
  const errorRuntimeLines = (await readFile(join(root, errorRuntimePath), 'utf8')).split('\n');
  const errorTestLines = (await readFile(join(root, errorTestPath), 'utf8')).split('\n');
  const errorRuntimeMarker = 'export function canonicalErrorView';
  const errorTestMarker = "it('contains only chapter 32 stable errors with total recovery semantics'";
  const errorRuntimeLineIndex = errorRuntimeLines.findIndex((line) => line.includes(errorRuntimeMarker));
  const errorTestLineIndex = errorTestLines.findIndex((line) => line.includes(errorTestMarker));
  if (errorRuntimeLineIndex < 0 || errorTestLineIndex < 0) throw new Error('ERROR_RETRY_EVIDENCE_ANCHOR_MISSING');
  for (const errorRecord of errorRecords) {
    for (const requirementId of errorRecord.requirementIds) {
      const requirement = requirementMap.get(requirementId);
      if (!requirement) throw new Error(`ERROR_RETRY_REQUIREMENT_LOOKUP_FAILED:${errorRecord.code}`);
      requirement.domainModule = 'packages/schemas';
      requirement.errorCodeIds = [...new Set([...requirement.errorCodeIds, errorRecord.errorCodeId])].sort();
      requirement.testCaseIds = [...new Set([...requirement.testCaseIds, `ERROR-${errorRecord.code}`])].sort();
      requirement.acceptanceGateIds = [...new Set([...requirement.acceptanceGateIds, 'GATE-CONTRACT-PACK'])].sort();
      requirement.artifactIds = [...new Set([...requirement.artifactIds, errorRuntimeArtifact.artifactId, errorTestArtifact.artifactId])].sort();
      requirement.status = 'ACTIVE';
      appendTrace(errorRuntimeArtifact, requirementId, `${errorRuntimePath}:${errorRuntimeLineIndex + 1}`, errorRecord.errorCodeId, errorRuntimeLines[errorRuntimeLineIndex]);
      appendTrace(errorTestArtifact, requirementId, `${errorTestPath}:${errorTestLineIndex + 1}`, `ERROR-${errorRecord.code}`, errorTestLines[errorTestLineIndex]);
      errorRuntimeArtifact.registryRecordIds.push(errorRecord.errorCodeId);
      errorTestArtifact.registryRecordIds.push(errorRecord.errorCodeId);
      errorTestArtifact.testIds.push(`ERROR-${errorRecord.code}`);
    }
  }
  const authoritySourceArtifact = traceArtifact(authoritySourcePath);
  const authoritySourceLines = (await readFile(join(root, authoritySourcePath), 'utf8')).split('\n');
  for (const authority of authorities) {
    const sourceLineIndex = authoritySourceLines.findIndex((line) => line.includes(`"authorityObjectKind":"${authority.authorityObjectKind}"`));
    if (sourceLineIndex < 0) throw new Error(`AUTHORITY_SOURCE_TRACE_ANCHOR_MISSING:${authority.authorityObjectKind}`);
    for (const requirementId of authority.requirementIds) appendTrace(authoritySourceArtifact, requirementId, `${authoritySourcePath}:${sourceLineIndex + 1}`, authority.authorityObjectKind, authoritySourceLines[sourceLineIndex]);
    authoritySourceArtifact.registryRecordIds.push(authority.authorityObjectKind);
    authoritySourceArtifact.operationIds.push(...authority.allowedOperationIds);
  }
  const generalAuthorityRequirementIds = authorityRequirementIds(authoritySource.authoritySourceRefs);
  const implementationEvidence = [
    ['scripts/verify-authority-ownership.mjs', 'const requiredKinds = new Set([', 'TD-03-AUTHORITY-VERIFIER'],
    ['scripts/lib/authority-writer-audit.mjs', 'const WRITER_BOUNDARIES = [', 'TD-03-STATIC-WRITER-AUDIT'],
    ['packages/contract-pack/src/index.ts', 'export function validateAuthorityOwnership(', 'TD-03-RUNTIME-REGISTRY-VALIDATOR'],
    ['packages/domain/src/operations.ts', 'validateAuthorityOwnership(catalog.records', 'TD-03-RUNTIME-ADMISSION-CHECK'],
    ['tests/authority-ownership/registry.test.ts', "describe('TD-03 verified authority ownership'", 'TEST-TD-03-AUTHORITY-OWNERSHIP']
  ];
  for (const [repositoryPath, marker, symbol] of implementationEvidence) {
    const artifact = traceArtifact(repositoryPath);
    const lines = (await readFile(join(root, repositoryPath), 'utf8')).split('\n');
    const lineIndex = lines.findIndex((line) => line.includes(marker));
    if (lineIndex < 0) throw new Error(`AUTHORITY_IMPLEMENTATION_TRACE_ANCHOR_MISSING:${repositoryPath}`);
    for (const requirementId of generalAuthorityRequirementIds) appendTrace(artifact, requirementId, `${repositoryPath}:${lineIndex + 1}`, symbol, lines[lineIndex]);
    artifact.registryRecordIds.push(...authorities.map((authority) => authority.authorityObjectKind));
    artifact.testIds.push(...(repositoryPath.startsWith('tests/') ? ['TEST-TD-03-AUTHORITY-OWNERSHIP'] : []));
    if (repositoryPath === 'packages/contract-pack/src/index.ts' || repositoryPath === 'packages/domain/src/operations.ts') artifact.operationIds.push(...operations.map((operation) => operation.operationId));
  }
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
    requirement.artifactIds = [...new Set([...requirement.artifactIds, handlerArtifact.artifactId, testArtifact.artifactId])].sort();
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

  const recoverySourcePath = 'packages/domain/src/recovery-oracle.ts';
  const recoveryTestPath = 'tests/recovery/oracle.test.ts';
  const recoverySourceArtifact = traceArtifact(recoverySourcePath);
  const recoveryTestArtifact = traceArtifact(recoveryTestPath);
  const recoverySourceLines = (await readFile(join(root, recoverySourcePath), 'utf8')).split('\n');
  const recoveryTestLines = (await readFile(join(root, recoveryTestPath), 'utf8')).split('\n');
  const recoverySourceLineIndex = recoverySourceLines.findIndex((line) => line.includes('export function evaluateRecoveryOracle'));
  const recoveryTestLineIndex = recoveryTestLines.findIndex((line) => line.includes("describe('TD-16 operation/state-machine recovery oracle'"));
  if (recoverySourceLineIndex < 0 || recoveryTestLineIndex < 0) throw new Error('RECOVERY_ORACLE_TRACE_ANCHOR_MISSING');
  for (const requirementId of recoveryRequirementIds) {
    const requirement = requirementMap.get(requirementId);
    if (!requirement) throw new Error(`RECOVERY_ORACLE_REQUIREMENT_LOOKUP_FAILED:${requirementId}`);
    appendTrace(recoverySourceArtifact, requirementId, `${recoverySourcePath}:${recoverySourceLineIndex + 1}`, 'evaluateRecoveryOracle', recoverySourceLines[recoverySourceLineIndex]);
    appendTrace(recoveryTestArtifact, requirementId, `${recoveryTestPath}:${recoveryTestLineIndex + 1}`, 'TD-16 operation/state-machine recovery oracle', recoveryTestLines[recoveryTestLineIndex]);
    requirement.domainModule = 'packages/domain';
    requirement.artifactIds = stableSort([...new Set([...requirement.artifactIds, recoverySourceArtifact.artifactId, recoveryTestArtifact.artifactId])]);
    requirement.testCaseIds = stableSort([...new Set([...requirement.testCaseIds, 'TEST-TD16-RECOVERY-ORACLE-TOTALITY', 'TEST-TD16-RECOVERY-ORACLE-MUTATION'])]);
    requirement.runtimeEvidenceKinds = stableSort([...new Set([...requirement.runtimeEvidenceKinds, 'PERSISTED_EVIDENCE_ORACLE', 'CANONICAL_RECOVERY_ACTION', 'ORACLE_MUTATION_TEST'])]);
    requirement.acceptanceGateIds = stableSort([...new Set([...requirement.acceptanceGateIds, 'GATE-CONTRACT-PACK'])]);
  }
  recoverySourceArtifact.operationIds.push(...operations.filter((operation) => operation.sideEffectClass !== 'READ_ONLY').map((operation) => operation.operationId));
  recoverySourceArtifact.stateMachineIds.push(...stateMachines.map((machine) => machine.stateMachineId));
  recoverySourceArtifact.registryRecordIds.push(...recoveryOracles.map((oracle) => oracle.recoveryOracleId));
  recoveryTestArtifact.testIds.push('TEST-TD16-RECOVERY-ORACLE-TOTALITY', 'TEST-TD16-RECOVERY-ORACLE-MUTATION');
  recoveryTestArtifact.operationIds.push(...operations.filter((operation) => operation.sideEffectClass !== 'READ_ONLY').map((operation) => operation.operationId));
  recoveryTestArtifact.stateMachineIds.push(...stateMachines.map((machine) => machine.stateMachineId));
  recoveryTestArtifact.registryRecordIds.push(...recoveryOracles.map((oracle) => oracle.recoveryOracleId));

  const closureSourcePath = 'packages/domain/src/closure-predicates.ts';
  const closureTestPath = 'tests/closure/terminal-closure.test.ts';
  const closureSourceArtifact = traceArtifact(closureSourcePath);
  const closureTestArtifact = traceArtifact(closureTestPath);
  const closureSourceLines = (await readFile(join(root, closureSourcePath), 'utf8')).split('\n');
  const closureTestLines = (await readFile(join(root, closureTestPath), 'utf8')).split('\n');
  const closureSourceLineIndex = closureSourceLines.findIndex((line) => line.includes('export async function evaluateClosure'));
  const closureTestLineIndex = closureTestLines.findIndex((line) => line.includes("describe('TD-06 terminal closure direct-state oracle'"));
  if (closureSourceLineIndex < 0 || closureTestLineIndex < 0) throw new Error('CLOSURE_PREDICATE_EVIDENCE_ANCHOR_MISSING');
  const closureEvidenceRequirementIds = stableSort([...new Set(closure.flatMap((record) => record.requirementIds))]);
  for (const requirementId of closureEvidenceRequirementIds) {
    const requirement = requirementMap.get(requirementId);
    if (!requirement) throw new Error(`CLOSURE_PREDICATE_REQUIREMENT_LOOKUP_FAILED:${requirementId}`);
    appendTrace(closureSourceArtifact, requirementId, `${closureSourcePath}:${closureSourceLineIndex + 1}`, 'evaluateClosure', closureSourceLines[closureSourceLineIndex]);
    appendTrace(closureTestArtifact, requirementId, `${closureTestPath}:${closureTestLineIndex + 1}`, 'TD-06 terminal closure direct-state oracle', closureTestLines[closureTestLineIndex]);
    requirement.domainModule = 'packages/domain';
    requirement.closurePredicateIds = stableSort([...new Set([...requirement.closurePredicateIds, ...closure.map((record) => record.closurePredicateId)])]);
    requirement.testCaseIds = stableSort([...new Set([...requirement.testCaseIds, 'TEST-TD06-TERMINAL-CLOSURE-DIRECT-STATE'])]);
    requirement.runtimeEvidenceKinds = stableSort([...new Set([...requirement.runtimeEvidenceKinds, 'POSTGRES_SERIALIZABLE_READ_ONLY_DEFERRABLE', 'RUNTIME_PROCESS_CGROUP_SOCKET_INVENTORY', 'FILESYSTEM_ARTIFACT_INVENTORY', 'EXTERNAL_READ_BACK'])]);
    requirement.artifactIds = stableSort([...new Set([...requirement.artifactIds, closureSourceArtifact.artifactId, closureTestArtifact.artifactId])]);
    requirement.acceptanceGateIds = stableSort([...new Set([...requirement.acceptanceGateIds, 'ARCH_CLOSURE_PREDICATES_COMPLETE', 'GATE-CONTRACT-PACK'])]);
    requirement.status = 'ACTIVE';
  }
  closureSourceArtifact.registryRecordIds.push(...closure.map((record) => record.closurePredicateId));
  closureTestArtifact.testIds.push('TEST-TD06-TERMINAL-CLOSURE-DIRECT-STATE');

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
    },
    {
      authoritySourceRef: 'ssot://51.2/51-2-datab-zov-role-session-stav-a-transak-n-profily/atom-6',
      sourcePath: 'packages/database/src/index.ts',
      sourceMarkers: ['WORKER_COMMIT: { id:'],
      testPath: 'tests/unit/postgres-contracts.test.ts',
      testMarker: 'declares the exact SSOT 51.2 profile',
      testCaseId: 'TEST-PG-TRANSACTION-PROFILES'
    },
    {
      authoritySourceRef: 'ssot://51.2/51-2-datab-zov-role-session-stav-a-transak-n-profily/atom-2',
      sourcePath: 'packages/database/src/index.ts',
      sourceMarkers: ['ADVISORY_NAMESPACE_IDS'],
      testPath: 'tests/unit/postgres-contracts.test.ts',
      testMarker: 'uses the SSOT namespace ids',
      testCaseId: 'TEST-PG-ADVISORY-NAMESPACE-KEY'
    },
    {
      authoritySourceRef: 'ssot://49.31/49-31-architektonick-closure-pravidlo/atom-5',
      sourcePath: 'packages/database/src/index.ts',
      sourceMarkers: ['export class LockOrderGuard'],
      testPath: 'tests/unit/postgres-contracts.test.ts',
      testMarker: 'rejects a lower lock class',
      testCaseId: 'TEST-PG-LOCK-ORDER-GUARD'
    },
    {
      authoritySourceRef: 'ssot://51.36/51-36-datab-zov-closure-pravidlo/atom-2',
      sourcePath: 'scripts/lib/postgres-operation-contract.mjs',
      sourceMarkers: ['function contractFor(operation)'],
      testPath: 'tests/unit/postgres-contract-matrix.test.ts',
      testMarker: 'covers every catalog operation',
      testCaseId: 'TEST-PG-PER-OPERATION-MATRIX'
    },
    {
      authoritySourceRef: 'ssot://51.36/51-36-datab-zov-closure-pravidlo/atom-6',
      sourcePath: 'database/migrations/20260901000102_postgres_transaction_contracts.sql',
      sourceMarkers: ['KCML_PHASE_PLAN: EXPAND, VALIDATE, ACTIVATE'],
      testPath: 'tests/postgres/contract-matrix.ts',
      testMarker: 'POSTGRES_CONTRACT_MATRIX: PASS',
      testCaseId: 'TEST-PG-TRANSACTION-CONSTRAINT-MIGRATION'
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
    { requirementId: 'KCML-REQ-RUNTIME-444fd05998029935c6d719e0e6dd5a757ee9ca6781ea0db77eed9ede2d7106f1', sourcePath: 'deploy/runtime/kcml-sandbox-launcher.c', sourceMarker: 'CLONE_NEWUSER', testPath: 'tests/runtime-boundary/sandbox-contract.test.ts', testMarker: "it('implements the namespace, pidfd and root linearization" },
    { requirementId: 'KCML-REQ-POSTGRES-3e1e2ca6aeac79dd1abde323ff75757ef93d6e481c6402602085a209c5b81fe5', sourcePath: 'deploy/runtime/kcml-sandbox-launcher.c', sourceMarker: 'open_release_file(release_fd, executable_relative, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)', testPath: 'tests/runtime-boundary/sandbox-contract.test.ts', testMarker: "it('implements the namespace, pidfd and root linearization" },
    { requirementId: 'KCML-REQ-RUNTIME-6298de933c910d5b02240bb21d710869ea548a611d97114438898fe282497fdd', sourcePath: 'deploy/runtime/kcml-sandbox-launcher.c', sourceMarker: 'O_NOFOLLOW', testPath: 'tests/runtime-boundary/sandbox-contract.test.ts', testMarker: "it('implements the namespace, pidfd and root linearization" },
    { requirementId: 'KCML-REQ-RUNTIME-2e05853970fa83ad9006d03338413a61660f196ba1e79dd1a20c6181898d3f90', sourcePath: 'deploy/runtime/kcml-sandbox-launcher.c', sourceMarker: 'static void install_seccomp_allowlist', testPath: 'tests/runtime-boundary/sandbox-contract.test.ts', testMarker: "it('uses a real FD3 inheritance contract and a fail-closed minimal BPF profile" },
    { requirementId: 'KCML-REQ-CORE-4281633d14a90bb6c2a2bace795a3a394fccb462cf2a8319f33924bd8d71b0e2', sourcePath: 'deploy/runtime/kcml-sandbox-launcher.c', sourceMarker: 'SYS_close_range', testPath: 'tests/runtime-boundary/sandbox-contract.test.ts', testMarker: "it('implements the namespace, pidfd and root linearization" },
    { requirementId: 'KCML-REQ-RUNTIME-321b40ee21af05286246bd355e173646751caf68855f0d516cbce8d3258c562d', sourcePath: 'deploy/runtime/kcml-sandbox-launcher.c', sourceMarker: 'setenv("KCML_CONTEXT_FD", "3"', testPath: 'tests/runtime-boundary/sandbox-contract.test.ts', testMarker: "it('bootstraps only Node 24 and imports a verified handler after FD hardening" },
    { requirementId: 'KCML-REQ-CORE-b4212bcad7e9f02d49a5e263b68eac4e7dc21cf1c0826c9b3ba868b88d948979', sourcePath: 'deploy/runtime/kcml-fd-cloexec-addon.c', sourceMarker: 'fcntl(3, F_SETFD, FD_CLOEXEC)', testPath: 'tests/runtime-boundary/sandbox-contract.test.ts', testMarker: "it('bootstraps only Node 24 and imports a verified handler after FD hardening" },
    { requirementId: 'KCML-REQ-RUNTIME-9b9b39e3819dbe737df54e9ee052d0af1ab56d7c3320e03dc0cee777262d7a60', sourcePath: 'deploy/runtime/kcml-node-bootstrap.mjs', sourceMarker: 'async function main()', testPath: 'tests/runtime-boundary/sandbox-contract.test.ts', testMarker: "it('bootstraps only Node 24 and imports a verified handler after FD hardening" },
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

  // The atom trace source is an explicit, versioned input. It is intentionally
  // separate from the artifact-level override catalog: every requirement has
  // one record, every relation names its exact file/line/symbol, and every
  // snippet digest is checked against the bytes in this checkout. No relation
  // is inferred from a domain, filename, operation prefix, or neighboring
  // record.
  const traceRelationKinds = ['SOURCE', 'MIGRATION', 'TEST', 'EVIDENCE'];
  const traceRecordsByRequirement = new Map();
  const traceAnchorKeys = new Map();
  const traceLinesByPath = new Map();
  const traceLinesFor = async (repositoryPath) => {
    if (!traceLinesByPath.has(repositoryPath)) traceLinesByPath.set(repositoryPath, (await readFile(join(root, repositoryPath), 'utf8')).split('\n'));
    return traceLinesByPath.get(repositoryPath);
  };
  const tracePathIsSafe = (repositoryPath) => typeof repositoryPath === 'string' && repositoryPath.length > 0 && !repositoryPath.startsWith('/') && !repositoryPath.includes('..') && !repositoryPath.includes('\\');
  const tracePathMatchesKind = (kind, repositoryPath) => {
    if (kind === 'SOURCE') return repositoryPath === 'SSOT_CURRENT.md';
    if (kind === 'TEST') return /^tests\/requirement-trace\/[^/]+\.test\.ts$/u.test(repositoryPath);
    if (kind === 'EVIDENCE') return /^contracts\/testing\/evidence\/requirement-trace\/[^/]+\.jsonl$/u.test(repositoryPath);
    if (kind === 'MIGRATION') return /^database\/migrations\/[^/]+\.sql$/u.test(repositoryPath);
    return false;
  };
  for (const record of requirementTraceRecords) {
    const requirement = requirementMap.get(record.requirementId);
    if (!requirement) throw new Error(`REQUIREMENT_ATOM_TRACE_UNKNOWN_REQUIREMENT:${record.requirementId}`);
    if (traceRecordsByRequirement.has(record.requirementId)) throw new Error(`REQUIREMENT_ATOM_TRACE_DUPLICATE_REQUIREMENT:${record.requirementId}`);
    traceRecordsByRequirement.set(record.requirementId, record);
    if (record.statementDigest !== sha(requirement.canonicalStatement)) throw new Error(`REQUIREMENT_ATOM_TRACE_STATEMENT_DIGEST_INVALID:${record.requirementId}`);
    if (!requirement.authoritySourceRefs.includes(record.authoritySourceRef)) throw new Error(`REQUIREMENT_ATOM_TRACE_AUTHORITY_REF_INVALID:${record.requirementId}`);
    const requiredKinds = traceRelationKinds.filter((kind) => kind !== 'MIGRATION' || requirement.domain === 'POSTGRES');
    const relationKeys = Object.keys(record.relations).sort();
    if (relationKeys.length !== requiredKinds.length || relationKeys.some((kind, index) => kind !== [...requiredKinds].sort()[index])) throw new Error(`REQUIREMENT_ATOM_TRACE_RELATION_SET_INVALID:${record.requirementId}`);
    for (const kind of requiredKinds) {
      const anchor = record.relations[kind];
      if (!anchor || typeof anchor !== 'object' || !tracePathIsSafe(anchor.repositoryPath) || !tracePathMatchesKind(kind, anchor.repositoryPath) || !Number.isInteger(anchor.line) || anchor.line < 1 || typeof anchor.symbol !== 'string' || anchor.symbol.length === 0 || typeof anchor.snippetDigest !== 'string') {
        throw new Error(`REQUIREMENT_ATOM_TRACE_ANCHOR_SHAPE_INVALID:${record.requirementId}:${kind}`);
      }
      const lines = await traceLinesFor(anchor.repositoryPath);
      const line = lines[anchor.line - 1];
      if (line === undefined || sha(line) !== anchor.snippetDigest) throw new Error(`REQUIREMENT_ATOM_TRACE_ANCHOR_DIGEST_INVALID:${record.requirementId}:${kind}`);
      if (anchor.symbol === 'file-start') throw new Error(`REQUIREMENT_ATOM_TRACE_FILE_START_FORBIDDEN:${record.requirementId}:${kind}`);
      if (kind === 'SOURCE') {
        const expectedLine = requirementSourceLineByRef.get(record.authoritySourceRef) ?? requirementSourceLineById.get(record.requirementId);
        if (expectedLine !== anchor.line || anchor.symbol !== `SSOT_ATOM:${record.authoritySourceRef}`) throw new Error(`REQUIREMENT_ATOM_TRACE_SOURCE_LOCATOR_INVALID:${record.requirementId}`);
      } else if (!line.includes(record.requirementId) || !line.includes(record.statementDigest)) {
        throw new Error(`REQUIREMENT_ATOM_TRACE_LINE_NOT_BOUND:${record.requirementId}:${kind}`);
      }
      const anchorKey = `${kind}:${anchor.repositoryPath}:${anchor.line}`;
      const previousRequirementId = traceAnchorKeys.get(anchorKey);
      if (previousRequirementId && previousRequirementId !== record.requirementId) throw new Error(`REQUIREMENT_ATOM_TRACE_SHARED_ANCHOR:${anchorKey}:${previousRequirementId}:${record.requirementId}`);
      traceAnchorKeys.set(anchorKey, record.requirementId);
      const artifact = traceArtifact(anchor.repositoryPath);
      appendTrace(artifact, requirement.requirementId, `${anchor.repositoryPath}:${anchor.line}`, anchor.symbol, line);
      if (kind === 'TEST') {
        artifact.testIds.push(`TEST-REQUIREMENT-TRACE-${requirement.requirementId}`);
        requirement.testCaseIds = [...new Set([...requirement.testCaseIds, `TEST-REQUIREMENT-TRACE-${requirement.requirementId}`])].sort();
      }
    }
    requirement.runtimeEvidenceKinds = [...new Set([...requirement.runtimeEvidenceKinds, 'EXACT_REQUIREMENT_ATOM_TRACE'])].sort();
    requirement.status = 'ACTIVE';
  }
  if (traceRecordsByRequirement.size !== requirements.length || requirements.some((requirement) => !traceRecordsByRequirement.has(requirement.requirementId))) {
    const missing = requirements.filter((requirement) => !traceRecordsByRequirement.has(requirement.requirementId)).map((requirement) => requirement.requirementId);
    throw new Error(`REQUIREMENT_ATOM_TRACE_COVERAGE_INVALID:${missing.length}:${missing.slice(0, 10).join(',')}`);
  }

  // The generator is part of the repository's traceability toolchain and is
  // therefore itself subject to the same artifact inventory. Seed its
  // concrete implementation anchor before the legacy file-level catalog
  // pass, so the latter cannot silently treat it as an unowned file.
  const traceGeneratorPath = 'scripts/generate-requirement-trace.mjs';
  const traceGeneratorRequirement = requirements.find((candidate) => candidate.authoritySourceRefs.includes('ssot://55.19/55-19-artifact-traceability-a-z-kaz-orphan-implementation/atom-13'));
  if (!traceGeneratorRequirement) throw new Error('REQUIREMENT_ATOM_TRACE_GENERATOR_REQUIREMENT_MISSING');
  const traceGeneratorArtifact = traceArtifact(traceGeneratorPath);
  const traceGeneratorLines = await traceLinesFor(traceGeneratorPath);
  const traceGeneratorLineIndex = traceGeneratorLines.findIndex((line) => line.includes('function parseSsotSourceLines'));
  if (traceGeneratorLineIndex < 0) throw new Error('REQUIREMENT_ATOM_TRACE_GENERATOR_ANCHOR_MISSING');
  appendTrace(traceGeneratorArtifact, traceGeneratorRequirement.requirementId, `${traceGeneratorPath}:${traceGeneratorLineIndex + 1}`, 'parseSsotSourceLines', traceGeneratorLines[traceGeneratorLineIndex]);

  const traceSourcePath = 'contracts/traceability/artifact-trace-source.json';
  const traceSource = JSON.parse(await readFile(join(root, traceSourcePath), 'utf8'));
  const traceSourceOverrides = JSON.parse(await readFile(join(root, 'contracts/traceability/artifact-trace-source-overrides.json'), 'utf8'));
  const traceSourceBrowserOverrides = JSON.parse(await readFile(join(root, 'contracts/traceability/artifact-trace-source-browser-overrides.json'), 'utf8'));
  const traceSourceTestOverrides = JSON.parse(await readFile(join(root, 'contracts/traceability/artifact-trace-source-test-overrides.json'), 'utf8'));
  if (traceSource.schemaVersion !== '1.0' || traceSource.kind !== 'ARTIFACT_TRACE_SOURCE' || !Array.isArray(traceSource.records) || traceSourceOverrides.schemaVersion !== '1.0' || traceSourceOverrides.kind !== 'ARTIFACT_TRACE_SOURCE' || !Array.isArray(traceSourceOverrides.records) || traceSourceBrowserOverrides.schemaVersion !== '1.0' || traceSourceBrowserOverrides.kind !== 'ARTIFACT_TRACE_SOURCE' || !Array.isArray(traceSourceBrowserOverrides.records) || traceSourceTestOverrides.schemaVersion !== '1.0' || traceSourceTestOverrides.kind !== 'ARTIFACT_TRACE_SOURCE' || !Array.isArray(traceSourceTestOverrides.records)) throw new Error('ARTIFACT_TRACE_SOURCE_INVALID');
  const traceSourceByPath = new Map();
  for (const record of traceSource.records) {
    if (typeof record.repositoryPath !== 'string' || traceSourceByPath.has(record.repositoryPath)) throw new Error(`ARTIFACT_TRACE_SOURCE_DUPLICATE:${record.repositoryPath}`);
    traceSourceByPath.set(record.repositoryPath, record);
  }
  for (const record of [...traceSourceOverrides.records, ...traceSourceBrowserOverrides.records, ...traceSourceTestOverrides.records]) {
    if (typeof record.repositoryPath !== 'string') throw new Error('ARTIFACT_TRACE_SOURCE_PATH_INVALID');
    const existing = traceSourceByPath.get(record.repositoryPath);
    if (!existing) traceSourceByPath.set(record.repositoryPath, record);
    else traceSourceByPath.set(record.repositoryPath, {
      ...existing, ...record,
      requirementIds: [...new Set([...(existing.requirementIds ?? []), ...(record.requirementIds ?? [])])],
      operationIds: [...new Set([...(existing.operationIds ?? []), ...(record.operationIds ?? [])])],
      registryRecordIds: [...new Set([...(existing.registryRecordIds ?? []), ...(record.registryRecordIds ?? [])])],
      testIds: [...new Set([...(existing.testIds ?? []), ...(record.testIds ?? [])])],
      traceAnchors: [...(existing.traceAnchors ?? []), ...(record.traceAnchors ?? [])]
    });
  }
  for (const repositoryPath of traceSourceByPath.keys()) {
    if (typeof repositoryPath !== 'string') throw new Error('ARTIFACT_TRACE_SOURCE_PATH_INVALID');
    // Contract schema outputs are added below with compiler lineage and are
    // intentionally not part of the repository-file source catalog.
    if (!artifactByPath.has(repositoryPath) && !repositoryPath.startsWith('contracts/registry-schemas/')) throw new Error(`ARTIFACT_TRACE_SOURCE_STALE:${repositoryPath}`);
  }
  for (const artifact of artifacts) {
    if (artifact.requirementIds.length > 0) continue;
    const source = traceSourceByPath.get(artifact.repositoryPath);
    if (!source) throw new Error(`ARTIFACT_TRACE_SOURCE_MISSING:${artifact.repositoryPath}`);
    if (!Array.isArray(source.requirementIds) || source.requirementIds.length === 0) throw new Error(`ARTIFACT_TRACE_REQUIREMENT_MISSING:${artifact.repositoryPath}`);
    for (const requirementId of source.requirementIds) if (!requirementMap.has(requirementId)) throw new Error(`ARTIFACT_TRACE_REQUIREMENT_UNKNOWN:${artifact.repositoryPath}:${requirementId}`);
    const artifactLines = (await readFile(join(root, artifact.repositoryPath), 'utf8')).split('\n');
    for (const anchor of source.traceAnchors ?? []) {
      const match = typeof anchor.locator === 'string' ? anchor.locator.match(/^(.*):(\d+)$/u) : null;
      if (!match || match[1] !== artifact.repositoryPath) throw new Error(`ARTIFACT_TRACE_ANCHOR_INVALID:${artifact.repositoryPath}`);
      const line = Number(match[2]);
      if (!Number.isInteger(line) || line < 1 || line > artifactLines.length || anchor.snippetDigest !== sha(artifactLines[line - 1])) throw new Error(`ARTIFACT_TRACE_ANCHOR_STALE:${artifact.repositoryPath}:${anchor.locator}`);
      if (!anchor.symbol || !source.requirementIds.includes(anchor.requirementId)) throw new Error(`ARTIFACT_TRACE_ANCHOR_RELATION_INVALID:${artifact.repositoryPath}`);
    }
    artifact.requirementIds.push(...source.requirementIds);
    artifact.operationIds.push(...(source.operationIds ?? []));
    artifact.stateMachineIds.push(...(source.stateMachineIds ?? []));
    artifact.registryRecordIds.push(...(source.registryRecordIds ?? []));
    artifact.testIds.push(...(source.testIds ?? []));
    artifact.traceAnchors.push(...(source.traceAnchors ?? []));
    artifact.generatedFrom = source.generatedFrom ?? artifact.generatedFrom;
    artifact.generationToolDigest = source.generationToolDigest ?? artifact.generationToolDigest;
    touchedTraceArtifacts.add(artifact);
  }
  for (const artifact of touchedTraceArtifacts) {
    artifact.requirementIds = stableSort([...new Set(artifact.requirementIds)]);
    artifact.operationIds = stableSort([...new Set(artifact.operationIds)]);
    artifact.stateMachineIds = stableSort([...new Set(artifact.stateMachineIds)]);
    artifact.registryRecordIds = stableSort([...new Set(artifact.registryRecordIds)]);
    artifact.testIds = stableSort([...new Set(artifact.testIds)]);
    artifact.traceAnchors.sort((left, right) => stableCompare(`${left.requirementId}:${left.locator}`, `${right.requirementId}:${right.locator}`));
  }
  for (const artifact of touchedTraceArtifacts) for (const requirementId of artifact.requirementIds) {
    const requirement = requirementMap.get(requirementId);
    if (!requirement) throw new Error(`ARTIFACT_REQUIREMENT_LOOKUP_FAILED:${artifact.artifactId}:${requirementId}`);
    requirement.artifactIds = stableSort([...new Set([...requirement.artifactIds, artifact.artifactId])]);
  }

  // Some specialized evidence passes intentionally replace a requirement's
  // artifact list while enriching it. Reconcile from the final forward edges
  // once more so every artifact/requirement relation remains bidirectional,
  // including generated atom-trace shards.
  for (const artifact of artifacts) for (const requirementId of artifact.requirementIds) {
    const requirement = requirementMap.get(requirementId);
    if (!requirement) throw new Error(`ARTIFACT_REQUIREMENT_LOOKUP_FAILED:${artifact.artifactId}:${requirementId}`);
    requirement.artifactIds = stableSort([...new Set([...requirement.artifactIds, artifact.artifactId])]);
  }

  // Build an explicit per-requirement evidence ledger from the already
  // validated artifact relations. The ledger deliberately does not infer
  // semantics from names or proximity: a relation only counts when the
  // artifact is already bidirectionally linked and carries a concrete anchor.
  // `file-start` records retained for legacy file-level inventory are not
  // implementation evidence.
  const artifactClass = (repositoryPath) => {
    if (/^tests\//u.test(repositoryPath)) return 'TEST';
    if (/^database\/(?:baseline|migrations)\/.*\.sql$/u.test(repositoryPath)) return 'MIGRATION';
    return 'SOURCE';
  };
  const concreteAnchorsFor = (artifact, requirementId) => (artifact.traceAnchors ?? [])
    .filter((anchor) => anchor.requirementId === requirementId && anchor.symbol !== 'file-start')
    .map((anchor) => ({
      artifactId: artifact.artifactId,
      repositoryPath: artifact.repositoryPath,
      locator: anchor.locator,
      symbol: anchor.symbol,
      snippetDigest: anchor.snippetDigest
    }))
    .sort((left, right) => stableCompare(`${left.repositoryPath}:${left.locator}:${left.symbol}`, `${right.repositoryPath}:${right.locator}:${right.symbol}`));
  const traceabilityFor = (requirement) => {
    const relations = { SOURCE: [], MIGRATION: [], TEST: [], EVIDENCE: [] };
    for (const artifact of artifacts) {
      if (!artifact.requirementIds.includes(requirement.requirementId)) continue;
      const anchors = concreteAnchorsFor(artifact, requirement.requirementId);
      if (anchors.length === 0) continue;
      relations[artifactClass(artifact.repositoryPath)].push(...anchors);
      relations.EVIDENCE.push(...anchors);
    }
    for (const kind of Object.keys(relations)) {
      const unique = new Map(relations[kind].map((anchor) => [`${anchor.artifactId}:${anchor.locator}:${anchor.symbol}`, anchor]));
      relations[kind] = [...unique.values()].sort((left, right) => stableCompare(`${left.repositoryPath}:${left.locator}:${left.symbol}`, `${right.repositoryPath}:${right.locator}:${right.symbol}`));
    }
    const requiredRelationKinds = ['SOURCE', 'TEST', 'EVIDENCE'];
    // A migration relation is applicable to physical PostgreSQL requirements.
    // Domain operations can reference persistence objects without owning the
    // schema migration itself; requiring a migration for every such operation
    // would manufacture cross-layer evidence.
    if (requirement.domain === 'POSTGRES') requiredRelationKinds.push('MIGRATION');
    const missingRelationKinds = requiredRelationKinds.filter((kind) => relations[kind].length === 0);
    return {
      schemaVersion: '1.0',
      status: requirement.status === 'ACTIVE' && missingRelationKinds.length === 0 ? 'COMPLETE' : 'INCOMPLETE',
      requiredRelationKinds,
      relations,
      missingRelationKinds
    };
  };
  for (const requirement of requirements) {
    requirement.extensions = {
      ...requirement.extensions,
      'kcml:traceability': traceabilityFor(requirement)
    };
  }
  const architectureBlockers = [];
  const surfaceSqlForArchitecture = await readFile(join(root, 'database/baseline/00000000000001_ssot_surface.sql'), 'utf8');
  if ((surfaceSqlForArchitecture.match(/document jsonb NOT NULL DEFAULT '\{\}'::jsonb/giu) ?? []).length > 0) architectureBlockers.push({ code: 'GENERIC_ENTITY_SCHEMA', summary: 'Physical entity schemas still contain generic document storage.' });
  if (requirements.some((requirement) => requirement.artifactIds.length === 0)) architectureBlockers.push({ code: 'TRACEABILITY_INCOMPLETE', summary: 'Requirements do not yet have implementation artifact evidence.' });

  const schemaManifest = { schemaVersion: '1.0', schemas: Object.keys(schemas).sort().map((name) => ({ ref: `contracts/registry-schemas/${name}`, digest: sha(canonical(schemas[name])) })) };
  schemaManifest.digest = sha(canonical(schemaManifest));
  for (const [name, schema] of Object.entries(schemas)) addArtifact(`contracts/registry-schemas/${name}`, `${canonical(schema)}\n`, { artifactKind: 'GENERATED_SCHEMA', generatedFrom: ['SSOT_CURRENT.md'], generationToolDigest: compilerDigest, requirementIds: ['KCML-REQ-CORE-31c3864691295a899cc1493719c94d8d49887ced538e31cc9a2083d88ba74fe3'], authoritySourceRefs: ['ssot://55/machine-readable-contract-pack/schema'] });
  addArtifact('contracts/registry-schemas/bundle-manifest.json', `${canonical(schemaManifest)}\n`, { artifactKind: 'GENERATED_SCHEMA_BUNDLE', generatedFrom: ['SSOT_CURRENT.md'], generationToolDigest: compilerDigest, requirementIds: ['KCML-REQ-CORE-339ab6c969bca81f6614e401513efca51a8ac4c7c898cbb5f55a0f7e106a93ec'], authoritySourceRefs: ['ssot://55/machine-readable-contract-pack/schema-bundle'] });

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
    ['authorityOwnershipIds', 'AUTHORITY_OWNERSHIP_REGISTRY'], ['artifactIds', 'ARTIFACT_TRACE_REGISTRY']
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
