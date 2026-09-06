import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { canonicalJson, toCanonicalJsonValue, type CanonicalJsonValue } from '@kcml/schemas';
import { createDatabasePool, inTransaction, inTransactionProfile, type DatabaseClient, type DatabasePool } from '@kcml/database';
import { CanonicalCommandWorker, CanonicalOperationService, CanonicalRetryScheduler, EnvelopeCipher, OperationCatalogService, SecretManager } from '@kcml/domain';
import { StructuredLogger } from '@kcml/observability';
import { createCapabilityServer, type CapabilityRequest, type CapabilityResponse } from '@kcml/runtime-capability-ipc';
import { assertRuntimeLocalStateKey, assertStateDocumentWithinLimits, assertStateValueWithinLimits, loadRuntimeExecutionLineage, runtimeStateNamespace, type RuntimeExecutionLineage } from './broker-authority.js';
import { authorizeEgressUrl, performPinnedRequest, type EgressPolicy } from './egress-policy.js';
import { RuntimeLifecycleExecutor } from './runtime-systemd.js';
import { startRuntimeGatewayServer } from './runtime-gateway.js';

export { assertRuntimeLocalStateKey, assertStateDocumentWithinLimits, assertStateValueWithinLimits, loadRuntimeExecutionLineage, runtimeLineageDigest, runtimeStateNamespace } from './broker-authority.js';
export type { RuntimeExecutionLineage } from './broker-authority.js';
export { assertPublicDnsAnswers, authorizeEgressUrl, isForbiddenEgressAddress, performPinnedRequest, resolvePublicAddresses } from './egress-policy.js';
export type { EgressPolicy, PinnedRequestOptions } from './egress-policy.js';
export { RuntimeLifecycleExecutor, RuntimeSystemdController, parseSystemdShow, runtimeHostUnit } from './runtime-systemd.js';
export { assertRuntimeGatewayActivationEnvironment, parseProcStartTicks, runtimeUnitFromCgroup, startRuntimeGatewayServer } from './runtime-gateway.js';

function requiredSourceSha(): string {
  const value = process.env.KCML_SOURCE_SHA;
  if (!value || !/^[0-9a-f]{40}$/iu.test(value)) throw new Error('KCML_SOURCE_SHA_REQUIRED');
  return value.toLowerCase();
}

export interface ServiceOptions {
  serviceName: string;
  queueNames?: readonly string[];
  allowedOperationPrefixes?: readonly string[];
  allowedOperations?: readonly string[];
  runtimeKind?: 'COMMAND_COORDINATOR' | 'SPECIALIST_HANDLER' | 'CAPABILITY_BROKER' | 'PROTOCOL_GATEWAY' | 'EVIDENCE_WORKER';
  broker?: 'secret' | 'state' | 'egress';
  socketPath?: string;
  intervalMs?: number;
  retryScheduler?: boolean;
  outboxDelivery?: boolean;
}

type JsonObject = Record<string, unknown>;

function jsonSafe(value: unknown): CanonicalJsonValue {
  return toCanonicalJsonValue(value);
}

const specializedServices = {
  'kcml-runtime-gateway': { queueNames: ['kcml-runtime'], allowedOperationPrefixes: ['runtime.'], runtimeKind: 'PROTOCOL_GATEWAY' },
  'kcml-central-chat-worker': { queueNames: ['kcml-chat'], allowedOperationPrefixes: ['chat.'], runtimeKind: 'SPECIALIST_HANDLER' },
  'kcml-generation-coordinator': { queueNames: ['kcml-generation-coordinator'], allowedOperationPrefixes: ['generation.'], runtimeKind: 'COMMAND_COORDINATOR' },
  'kcml-generation-openai-worker': { queueNames: ['kcml-generation-openai'], allowedOperations: ['generation.model.execute'], runtimeKind: 'SPECIALIST_HANDLER' },
  'kcml-generation-workspace-worker': { queueNames: ['kcml-generation-workspace'], allowedOperationPrefixes: ['generation.workspace.'], runtimeKind: 'SPECIALIST_HANDLER' },
  'kcml-generation-integration-worker': { queueNames: ['kcml-generation-integration'], allowedOperations: ['generation.candidate.publish', 'generation.integration.step'], runtimeKind: 'SPECIALIST_HANDLER' },
  'kcml-generation-validation-worker': { queueNames: ['kcml-generation-validation'], allowedOperations: ['generation.validation.run'], runtimeKind: 'EVIDENCE_WORKER' },
  'kcml-generation-activation-worker': { queueNames: ['kcml-generation-activation'], allowedOperationPrefixes: ['generation.activation.'], runtimeKind: 'SPECIALIST_HANDLER' },
  'kcml-agent-worker': { queueNames: ['kcml-agent', 'kcml-authority', 'kcml-agentic', 'kcml-provenance'], allowedOperationPrefixes: ['agent.', 'authority.', 'agentic.', 'provenance.'], runtimeKind: 'SPECIALIST_HANDLER' },
  'kcml-browser-worker': { queueNames: ['kcml-browser'], allowedOperationPrefixes: ['browser.'], runtimeKind: 'SPECIALIST_HANDLER' },
  'kcml-browser-bridge-gateway': { queueNames: ['kcml-browser'], allowedOperationPrefixes: ['browser.bridge.'], runtimeKind: 'PROTOCOL_GATEWAY' },
  'kcml-component-control-worker': { queueNames: ['kcml-component'], allowedOperationPrefixes: ['component.'], runtimeKind: 'SPECIALIST_HANDLER' },
  'kcml-component-e2e-worker': { queueNames: ['kcml-selftest'], allowedOperations: ['selfTest.registeredElement.run'], runtimeKind: 'EVIDENCE_WORKER' },
  'kcml-monitor-worker': { queueNames: ['kcml-monitor'], allowedOperationPrefixes: ['monitor.'], runtimeKind: 'EVIDENCE_WORKER', intervalMs: 1000 },
  'kcml-alert-primary-worker': { queueNames: ['kcml-monitor'], allowedOperationPrefixes: ['monitor.alert.'], runtimeKind: 'SPECIALIST_HANDLER' },
  'kcml-alert-backup-worker': { queueNames: ['kcml-monitor'], allowedOperationPrefixes: ['monitor.alert.'], runtimeKind: 'SPECIALIST_HANDLER' },
  'kcml-secret-broker': { queueNames: ['kcml-secret', 'kcml-ownerapikey'], allowedOperationPrefixes: ['secret.', 'ownerApiKey.'], broker: 'secret', socketPath: '/run/kajovocml-ng/brokers/secret-broker.sock', runtimeKind: 'CAPABILITY_BROKER' },
  'kcml-mcp-worker': { queueNames: ['kcml-mcp'], allowedOperationPrefixes: ['mcp.'], runtimeKind: 'PROTOCOL_GATEWAY' },
  'kcml-state-broker': { broker: 'state', socketPath: '/run/kajovocml-ng/brokers/state-broker.sock', runtimeKind: 'CAPABILITY_BROKER' },
  'kcml-egress-gateway': { broker: 'egress', socketPath: '/run/kajovocml-ng/brokers/egress-gateway.sock', runtimeKind: 'CAPABILITY_BROKER' },
  'kcml-audit-archiver': { queueNames: ['kcml-audit'], allowedOperationPrefixes: ['audit.'], runtimeKind: 'EVIDENCE_WORKER' },
  'kcml-self-test-worker': { queueNames: ['kcml-selftest'], allowedOperationPrefixes: ['selfTest.'], runtimeKind: 'EVIDENCE_WORKER' },
  'kcml-acceptance-runner': { queueNames: ['kcml-selftest'], allowedOperationPrefixes: ['selfTest.'], runtimeKind: 'EVIDENCE_WORKER', intervalMs: 250 },
  'kcml-runtime-host': { runtimeKind: 'SPECIALIST_HANDLER' },
  'kcml-owner-device-bridge': { runtimeKind: 'PROTOCOL_GATEWAY' },
  'kcml-retry-scheduler': { retryScheduler: true, outboxDelivery: true, runtimeKind: 'COMMAND_COORDINATOR', intervalMs: 250 }
} as const satisfies Record<string, Omit<ServiceOptions, 'serviceName'>>;

export type SpecializedServiceName = keyof typeof specializedServices;

export function serviceReadinessDescriptor(serviceName: SpecializedServiceName): Readonly<Record<string, unknown>> {
  const service = specializedServices[serviceName];
  return Object.freeze({
    schemaVersion: '1.0', serviceName, runtimeKind: service.runtimeKind,
    queues: 'queueNames' in service ? service.queueNames : [],
    operationPrefixes: 'allowedOperationPrefixes' in service ? service.allowedOperationPrefixes : [],
    operations: 'allowedOperations' in service ? service.allowedOperations : [],
    capabilities: 'broker' in service ? [service.broker] : 'retryScheduler' in service ? ['CANONICAL_RETRY_SCHEDULER', ...('outboxDelivery' in service && service.outboxDelivery ? ['TRANSACTIONAL_OUTBOX_DELIVERY'] : [])] : []
  });
}

export function listSpecializedServiceDescriptors(): readonly Readonly<Record<string, unknown>>[] {
  return Object.keys(specializedServices).sort().map((name) => serviceReadinessDescriptor(name as SpecializedServiceName));
}

export async function startSpecializedService(serviceName: SpecializedServiceName): Promise<void> {
  const definition = specializedServices[serviceName];
  await runService({ serviceName, ...definition });
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(jsonSafe(value))).digest('hex');
}

async function appendBrokerAudit(client: DatabaseClient, eventType: string, executionId: string, aggregateType: string, aggregateId: string | null, payload: JsonObject): Promise<void> {
  const correlationId = typeof payload.correlationId === 'string' && /^[0-9a-f-]{36}$/iu.test(payload.correlationId) ? payload.correlationId : randomUUID();
  const bytes = Buffer.from(canonicalJson(jsonSafe(payload)));
  await client.query(`SELECT * FROM kcml.append_audit_event($1,'SYSTEM',$2,$3,$4,$5,NULL,$6,$7)`, [
    eventType,
    `runtime:${executionId}`,
    aggregateType,
    aggregateId && /^[0-9a-f-]{36}$/iu.test(aggregateId) ? aggregateId : null,
    correlationId,
    jsonSafe(payload),
    bytes
  ]);
}

async function stateRead(pool: ReturnType<typeof createDatabasePool>, lineage: RuntimeExecutionLineage, payload: JsonObject): Promise<unknown> {
  const key = assertRuntimeLocalStateKey(payload.key);
  const result = await pool.query(`SELECT id,persistent_state,state_version,activation_epoch,application_deployment_epoch
    FROM kcml.component_runtime_target
    WHERE stable_key=$1 AND lifecycle='ACTIVE' AND deleted_at IS NULL`, [runtimeStateNamespace(lineage)]);
  const row = result.rows[0];
  if (!row) return null;
  const document = (row.persistent_state ?? {}) as JsonObject;
  if (document.lineageDigest !== lineage.lineageDigest) throw new Error('RUNTIME_STATE_LINEAGE_MISMATCH');
  const values = (document.values ?? {}) as JsonObject;
  const record = values[key] as JsonObject | undefined;
  if (!record || record.deleted === true) return null;
  return {
    value: record.value ?? null,
    valueDigest: record.valueDigest ?? null,
    schemaVersion: record.schemaVersion ?? 1,
    stateVersion: record.stateVersion ?? null,
    namespaceVersion: row.state_version,
    activationEpoch: row.activation_epoch,
    deploymentEpoch: row.application_deployment_epoch
  };
}

async function stateWrite(pool: ReturnType<typeof createDatabasePool>, lineage: RuntimeExecutionLineage, payload: JsonObject): Promise<unknown> {
  const operation = String(payload.operation ?? 'put').toLowerCase();
  if (!['put', 'create', 'delete'].includes(operation)) throw new Error('RUNTIME_STATE_OPERATION_UNSUPPORTED');
  const key = assertRuntimeLocalStateKey(payload.key);
  const schemaVersion = Number(payload.schemaVersion ?? 1);
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) throw new Error('RUNTIME_STATE_SCHEMA_VERSION_INVALID');
  if (operation !== 'delete') assertStateValueWithinLimits(payload.value);
  const expected = payload.expectedStateVersion === undefined || payload.expectedStateVersion === null ? null : BigInt(String(payload.expectedStateVersion));

  return inTransaction(pool, 'SERIALIZABLE', async (client) => {
    const currentLineage = await loadRuntimeExecutionLineage(client, lineage.executionId, true);
    if (currentLineage.lineageDigest !== lineage.lineageDigest) throw new Error('RUNTIME_STATE_FENCING_TOKEN_STALE');
    const heads = (await client.query(`SELECT p.platform_incarnation_id,d.current_epoch,a.current_epoch AS activation_epoch
      FROM kcml.platform_incarnation p CROSS JOIN kcml.application_deployment_head d CROSS JOIN kcml.activation_head a
      WHERE p.singleton_key=1 AND d.singleton_key=1 AND a.singleton_key=1 FOR SHARE OF p,d,a`)).rows[0];
    const stableKey = runtimeStateNamespace(currentLineage);
    let row = (await client.query(`SELECT * FROM kcml.component_runtime_target WHERE stable_key=$1 FOR UPDATE`, [stableKey])).rows[0];
    if (!row) {
      if (operation !== 'create' && operation !== 'put') throw new Error('RUNTIME_STATE_NOT_FOUND');
      const initialDocument = { lineage: currentLineage, lineageDigest: currentLineage.lineageDigest, persistentState: true, namespaceVersion: 1, values: {} };
      const initialBytes = Buffer.from(canonicalJson(jsonSafe(initialDocument)));
      row = (await client.query(`INSERT INTO kcml.component_runtime_target(stable_key,display_name,lifecycle,transport,execution_mode,readiness_mode,persistent_state,canonical_digest,activation_epoch,platform_incarnation_id,application_deployment_epoch)
        VALUES($1,$2,'ACTIVE','RUNTIME_GATEWAY_UDS','PERSISTENT_STATE','HEALTHCHECK',$3,kcml.canonical_digest($4),$5,$6,$7) RETURNING *`, [
        stableKey,
        `Persistent state ${currentLineage.lineageDigest.slice(0, 23)}`,
        initialDocument,
        initialBytes,
        heads.activation_epoch,
        heads.platform_incarnation_id,
        heads.current_epoch
      ])).rows[0];
    }

    const document = { ...((row.persistent_state ?? {}) as JsonObject) };
    if (document.lineageDigest !== currentLineage.lineageDigest) throw new Error('RUNTIME_STATE_LINEAGE_MISMATCH');
    const values = { ...((document.values ?? {}) as JsonObject) };
    const current = values[key] as JsonObject | undefined;
    const currentVersion = current ? BigInt(String(current.stateVersion ?? 0)) : 0n;
    if (operation === 'create' && current && current.deleted !== true) throw new Error('RUNTIME_STATE_ALREADY_EXISTS');
    if (operation !== 'create' && expected === null) throw new Error('STATE_VERSION_REQUIRED');
    if (expected !== null && currentVersion !== expected) throw new Error('STATE_VERSION_CONFLICT');
    const nextVersion = currentVersion + 1n;
    const value = operation === 'delete' ? null : payload.value;
    values[key] = {
      value,
      valueDigest: sha256(value),
      schemaVersion,
      stateVersion: nextVersion.toString(),
      deleted: operation === 'delete',
      updatedAt: new Date().toISOString(),
      lineageDigest: currentLineage.lineageDigest
    };
    assertStateDocumentWithinLimits(values);
    document.values = values;
    document.namespaceVersion = (BigInt(row.state_version) + 1n).toString();
    document.lastCorrelationId = typeof payload.correlationId === 'string' ? payload.correlationId : null;
    const documentBytes = Buffer.from(canonicalJson(jsonSafe(document)));
    const updated = (await client.query(`UPDATE kcml.component_runtime_target AS t
      SET persistent_state=$2,canonical_digest=kcml.canonical_digest($3),state_version=t.state_version+1,activation_epoch=$4,application_deployment_epoch=$5,updated_at=clock_timestamp()
      WHERE t.id=$1 RETURNING *`, [row.id, document, documentBytes, heads.activation_epoch, heads.current_epoch])).rows[0];
    await appendBrokerAudit(client, `runtime.state.${operation}`, currentLineage.executionId, 'COMPONENT_RUNTIME_TARGET', row.id, { key, stateVersion: nextVersion.toString(), valueDigest: sha256(value), lineageDigest: currentLineage.lineageDigest, correlationId: payload.correlationId ?? null });
    return {
      id: row.id,
      key,
      value,
      valueDigest: sha256(value),
      schemaVersion,
      stateVersion: nextVersion.toString(),
      namespaceVersion: updated.state_version,
      deleted: operation === 'delete'
    };
  });
}

const egressInflight = new Map<string, number>();
const egressRateWindows = new Map<string, number[]>();

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.max(minimum, Math.min(parsed, maximum)) : fallback;
}

async function egressRequest(pool: ReturnType<typeof createDatabasePool>, secrets: SecretManager, lineage: RuntimeExecutionLineage, requestOperation: string, payload: JsonObject): Promise<unknown> {
  const bindingAlias = String(payload.bindingAlias ?? '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u.test(bindingAlias)) throw new Error('EXTERNAL_BINDING_ALIAS_INVALID');
  const binding = await pool.query(`SELECT b.id AS binding_id,b.binding_revision,b.route,b.method AS binding_method,b.activation_set_id,
      t.id AS target_id,t.target_key,t.base_url,t.allowed_paths,t.allowed_methods,t.timeout_ms,t.retry_policy,t.rate_limit,t.circuit_state,t.auth_binding_id,t.monitoring,t.lifecycle,t.state_version,
      sb.stable_key AS auth_binding_alias,sb.usage_purpose AS auth_purpose
    FROM kcml.external_target_binding b
    JOIN kcml.external_target t ON t.id=b.target_id
    JOIN kcml.binding_set_member m ON m.revision_id=$1 AND m.member_kind='EXTERNAL_TARGET'
      AND m.operation_name=$2 AND m.source_identity->>'objectId'=$3::text AND m.source_identity->>'revisionId'=$4::text
      AND (m.target_identity->>'bindingId'=b.id::text OR m.target_identity->>'targetId'=t.id::text)
    LEFT JOIN kcml.secret_binding sb ON sb.id=t.auth_binding_id
    WHERE b.stable_key=$5 AND b.lifecycle='ACTIVE' AND b.deleted_at IS NULL
      AND b.source_component_id=$3::uuid AND b.source_revision_id=$4::uuid
      AND b.activation_epoch=$6 AND b.platform_incarnation_id=$7 AND b.application_deployment_epoch=$8
      AND b.activation_set_id IS NOT DISTINCT FROM $9
      AND t.lifecycle='ACTIVE' AND t.deleted_at IS NULL
      AND t.activation_epoch=$6 AND t.platform_incarnation_id=$7 AND t.application_deployment_epoch=$8
    LIMIT 2`, [lineage.bindingSetRevisionId,requestOperation,lineage.sourceObjectId,lineage.sourceRevisionId,bindingAlias,lineage.activationEpoch,lineage.platformIncarnationId,lineage.applicationDeploymentEpoch,lineage.activationSetId]);
  if (binding.rowCount !== 1) throw new Error('EXTERNAL_BINDING_NOT_AUTHORIZED');
  const row = binding.rows[0] as JsonObject;
  if (!['CLOSED','HEALTHY'].includes(String(row.circuit_state))) throw new Error('EGRESS_CIRCUIT_OPEN');
  const outgoing = (payload.request ?? {}) as JsonObject;
  const method = String(outgoing.method ?? 'GET').toUpperCase();
  if (method !== String(row.binding_method).toUpperCase()) throw new Error('EGRESS_BINDING_METHOD_MISMATCH');
  const monitoring = (row.monitoring ?? {}) as JsonObject;
  const policy: EgressPolicy = {
    baseUrl: String(row.base_url),
    allowedPaths: Array.isArray(row.allowed_paths) ? row.allowed_paths.map(String) : ['/'],
    allowedMethods: Array.isArray(row.allowed_methods) ? row.allowed_methods.map(String) : ['GET'],
    timeoutMs: boundedInteger(row.timeout_ms, 30_000, 100, 120_000),
    maxRequestBytes: boundedInteger(monitoring.maxRequestBytes, 256 * 1024, 0, 1024 * 1024),
    maxResponseBytes: boundedInteger(monitoring.maxResponseBytes, 2 * 1024 * 1024, 1, 8 * 1024 * 1024),
    allowPlainHttp: monitoring.allowPlainHttp === true && process.env.NODE_ENV === 'test'
  };
  const relativePath = String(outgoing.path ?? '/');
  let url = authorizeEgressUrl(policy, relativePath, method);
  const bindingRoute = String(row.route ?? '/');
  if (!(url.pathname === bindingRoute || url.pathname.startsWith(bindingRoute.endsWith('/') ? bindingRoute : `${bindingRoute}/`))) throw new Error('EGRESS_BINDING_ROUTE_MISMATCH');
  const requestHeaders = outgoing.headers && typeof outgoing.headers === 'object' && !Array.isArray(outgoing.headers) ? outgoing.headers as JsonObject : {};
  const forbiddenCallerHeaders = new Set(['authorization','proxy-authorization','cookie','set-cookie','x-api-key']);
  for (const name of Object.keys(requestHeaders)) if (forbiddenCallerHeaders.has(name.toLowerCase())) throw new Error('EGRESS_CALLER_CREDENTIAL_DENIED');
  const headers: Record<string, string> = { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'KájovoCML-NG/2026.8.30-8' };
  for (const [name, value] of Object.entries(requestHeaders)) {
    const normalized = name.toLowerCase();
    if (!['accept','content-type','idempotency-key','x-request-id'].includes(normalized) || typeof value !== 'string' || /[\r\n]/u.test(value)) throw new Error('EGRESS_HEADER_DENIED');
    headers[normalized] = value;
  }
  const body = ['GET','HEAD'].includes(method) ? undefined : Buffer.from(canonicalJson(jsonSafe(outgoing.body ?? null)));
  if (body && body.length > policy.maxRequestBytes) throw new Error('EGRESS_REQUEST_TOO_LARGE');
  if (row.auth_binding_id) {
    if (!row.auth_binding_alias || !row.auth_purpose) throw new Error('EGRESS_AUTH_BINDING_INVALID');
    const injection = (monitoring.authInjection ?? {}) as JsonObject;
    const headerName = String(injection.headerName ?? '').toLowerCase();
    if (!['authorization','x-api-key'].includes(headerName)) throw new Error('EGRESS_AUTH_INJECTION_POLICY_INVALID');
    const secret = await secrets.revealForRuntimeBinding(lineage, String(row.auth_binding_alias), String(row.auth_purpose), requestOperation);
    const scheme = typeof injection.scheme === 'string' ? `${injection.scheme} ` : '';
    headers[headerName] = `${scheme}${secret.value}`;
  }
  const rate = (row.rate_limit ?? {}) as JsonObject;
  const now = Date.now();
  const windowMs = boundedInteger(rate.windowMs, 60_000, 1_000, 3_600_000);
  const requestLimit = boundedInteger(rate.requests, 60, 1, 10_000);
  const recent = (egressRateWindows.get(String(row.target_id)) ?? []).filter((timestamp) => timestamp > now - windowMs);
  if (recent.length >= requestLimit) throw new Error('EGRESS_RATE_LIMITED');
  recent.push(now); egressRateWindows.set(String(row.target_id), recent);
  const maxConcurrency = boundedInteger(rate.maxConcurrency, 4, 1, 64);
  const currentInflight = egressInflight.get(String(row.target_id)) ?? 0;
  if (currentInflight >= maxConcurrency) throw new Error('EGRESS_CONCURRENCY_LIMITED');
  egressInflight.set(String(row.target_id), currentInflight + 1);
  const started = Date.now();
  let response: Awaited<ReturnType<typeof performPinnedRequest>>;
  let redirectCount = 0;
  try {
    while (true) {
      response = await performPinnedRequest(url, { method, headers, timeoutMs: policy.timeoutMs, maxResponseBytes: policy.maxResponseBytes, ...(body ? { body } : {}) });
      if (![301,302,303,307,308].includes(response.status)) break;
      if (![307,308].includes(response.status) && !['GET','HEAD'].includes(method)) throw new Error('EGRESS_REDIRECT_METHOD_CHANGE_DENIED');
      if (++redirectCount > 3) throw new Error('EGRESS_REDIRECT_LIMIT_EXCEEDED');
      const location = response.headers.location;
      if (typeof location !== 'string') throw new Error('EGRESS_REDIRECT_LOCATION_INVALID');
      const redirected = new URL(location, url);
      if (redirected.origin !== new URL(policy.baseUrl).origin) throw new Error('EGRESS_REDIRECT_TARGET_DENIED');
      url = authorizeEgressUrl(policy, `${redirected.pathname}${redirected.search}`, method);
      if (!(url.pathname === bindingRoute || url.pathname.startsWith(bindingRoute.endsWith('/') ? bindingRoute : `${bindingRoute}/`))) throw new Error('EGRESS_BINDING_ROUTE_MISMATCH');
    }
  } finally {
    const remaining = (egressInflight.get(String(row.target_id)) ?? 1) - 1;
    if (remaining > 0) egressInflight.set(String(row.target_id), remaining); else egressInflight.delete(String(row.target_id));
  }
  const responseHeaders: Record<string, string | string[]> = {};
  for (const name of ['content-type','content-length','etag','x-request-id']) if (response.headers[name] !== undefined) responseHeaders[name] = response.headers[name];
  const requestEvidence = { executionId: lineage.executionId, lineageDigest: lineage.lineageDigest, bindingId: row.binding_id, bindingRevision: String(row.binding_revision), targetId: row.target_id, method, origin: url.origin, path: url.pathname, requestBytes: body?.length ?? 0, redirects: redirectCount };
  const responseEvidence = { status: response.status, responseBytes: response.body.length, remoteAddressDigest: sha256(response.remoteAddress), headers: responseHeaders };
  const evidenceBytes = Buffer.from(canonicalJson(jsonSafe({ requestEvidence, responseEvidence })));
  const requestDigest = createHash('sha256').update(body ?? Buffer.alloc(0)).digest();
  const responseDigest = createHash('sha256').update(response.body).digest();
  const readOnly = ['GET','HEAD'].includes(method);
  const event = await pool.query(`INSERT INTO kcml.external_request_event(external_target_id,binding_id,binding_revision,route,method,attempt,target_idempotency_key,request_metadata,request_payload_digest,dispatch_state,sent_at,transport_evidence,response_metadata,response_payload_digest,outcome,reconciliation_state,reconciliation_evidence,next_action,latency_ms,http_status,retry_classification,circuit_decision,trace_id,canonical_digest,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,'COMPLETED',clock_timestamp(),$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'ALLOWED',$19,kcml.canonical_digest($20),$21,$22,$23) RETURNING id`, [row.target_id,row.binding_id,row.binding_revision,url.pathname,method,headers['idempotency-key']??null,requestEvidence,requestDigest,{tls:url.protocol==='https:',pinnedAddressDigest:sha256(response.remoteAddress),redirects:redirectCount},responseEvidence,responseDigest,readOnly?'READ_ONLY_RESULT':'UNKNOWN',readOnly?'NOT_REQUIRED':'PENDING',readOnly?{reason:'READ_ONLY'}:{reason:'HTTP_RESPONSE_IS_NOT_SIDE_EFFECT_ORACLE'},readOnly?'NONE':'RECONCILE',Date.now()-started,response.status,readOnly?'NOT_RETRYABLE':'RECONCILE_REQUIRED',payload.traceId??null,evidenceBytes,lineage.activationEpoch,lineage.platformIncarnationId,lineage.applicationDeploymentEpoch]);
  return { status: response.status, headers: responseHeaders, body: response.body.toString('utf8'), targetId: row.target_id, bindingId: row.binding_id, targetStateVersion: row.state_version, executionId: lineage.executionId, evidenceId: event.rows[0].id, outcome: readOnly ? 'READ_ONLY_RESULT' : 'UNKNOWN' };
}

async function handleBrokerRequest(pool: ReturnType<typeof createDatabasePool>, secrets: SecretManager | null, broker: NonNullable<ServiceOptions['broker']>, request: CapabilityRequest): Promise<CapabilityResponse> {
  try {
    const payload = request.payload as JsonObject;
    const lineage = await loadRuntimeExecutionLineage(pool, request.executionId);
    let responsePayload: unknown;
    if (broker === 'secret') {
      if (request.capability !== 'SECRET_USE') throw new Error('CAPABILITY_MISMATCH');
      if (!secrets) throw new Error('SECRET_BROKER_CREDENTIAL_MISSING');
      const revealed = await secrets.revealForRuntimeBinding(lineage, String(payload.bindingAlias ?? ''), String(payload.purpose ?? ''), request.operation);
      responsePayload = { value: revealed.value, fingerprint: revealed.fingerprint, versionId: revealed.versionId };
    } else if (broker === 'state') {
      if (!['STATE_READ', 'STATE_WRITE'].includes(request.capability)) throw new Error('CAPABILITY_MISMATCH');
      responsePayload = request.capability === 'STATE_READ' ? await stateRead(pool, lineage, payload) : await stateWrite(pool, lineage, payload);
    } else {
      if (request.capability !== 'EGRESS_REQUEST') throw new Error('CAPABILITY_MISMATCH');
      if (!secrets) throw new Error('EGRESS_BROKER_CREDENTIAL_MISSING');
      responsePayload = await egressRequest(pool, secrets, lineage, request.operation, payload);
    }
    return { protocol: 'KCML-CAPABILITY-IPC/1', requestId: request.requestId, ok: true, payload: responsePayload };
  } catch (error) {
    return { protocol: 'KCML-CAPABILITY-IPC/1', requestId: request.requestId, ok: false, error: { code: error instanceof Error ? error.message : 'BROKER_ERROR', message: error instanceof Error ? error.message : String(error) } };
  }
}

export async function runService(options: ServiceOptions): Promise<void> {
  if (!options.runtimeKind) throw new Error('SERVICE_RUNTIME_KIND_REQUIRED');
  if (options.queueNames?.length && !options.allowedOperations?.length && !options.allowedOperationPrefixes?.length) throw new Error('SERVICE_OPERATION_ALLOWLIST_REQUIRED');
  const logger = new StructuredLogger(options.serviceName);
  const pool = createDatabasePool({ applicationName: options.serviceName });
  const instanceId = randomUUID();
  const processAuthority = (await pool.query(`SELECT p.platform_incarnation_id,d.current_epoch AS application_deployment_epoch
    FROM kcml.platform_incarnation p CROSS JOIN kcml.application_deployment_head d
    WHERE p.singleton_key=1 AND d.singleton_key=1`)).rows[0];
  if (!processAuthority) throw new Error('PLATFORM_WORKER_AUTHORITY_MISSING');
  let stopping = false;

  const heartbeat = async (status: 'STARTING' | 'READY' | 'DRAINING' | 'FAILED', details: Record<string, unknown> = {}) => {
    const written = await pool.query(`INSERT INTO kcml.platform_worker_heartbeat(service_name,instance_id,release_id,source_sha,deployment_epoch,platform_incarnation_id,heartbeat_sequence,nonce,status,details,expires_at)
      SELECT $1,$2,$3,$4,$5,$6,1,$7,$8,$9,clock_timestamp()+interval '30 seconds'
      WHERE EXISTS (SELECT 1 FROM kcml.platform_incarnation p CROSS JOIN kcml.application_deployment_head d WHERE p.singleton_key=1 AND d.singleton_key=1 AND p.platform_incarnation_id=$6 AND d.current_epoch=$5)
      ON CONFLICT(service_name,instance_id) DO UPDATE SET
        status=EXCLUDED.status,details=EXCLUDED.details,observed_at=clock_timestamp(),expires_at=EXCLUDED.expires_at,
        heartbeat_sequence=kcml.platform_worker_heartbeat.heartbeat_sequence+1,nonce=EXCLUDED.nonce
      WHERE kcml.platform_worker_heartbeat.platform_incarnation_id=EXCLUDED.platform_incarnation_id
        AND kcml.platform_worker_heartbeat.deployment_epoch=EXCLUDED.deployment_epoch
      RETURNING heartbeat_sequence`, [
      options.serviceName,
      instanceId,
      process.env.KCML_RELEASE_ID ?? 'development',
      requiredSourceSha(),
      processAuthority.application_deployment_epoch,
      processAuthority.platform_incarnation_id,
      randomUUID(),
      status,
      details
    ]);
    if (written.rowCount !== 1) throw new Error('PLATFORM_WORKER_HEARTBEAT_AUTHORITY_STALE');
  };

  await heartbeat('STARTING');
  let closeBroker: (() => Promise<void>) | null = null;
  let closeRuntimeGateway: (() => Promise<void>) | null = null;
  if (options.serviceName === 'kcml-runtime-gateway') {
    const runtimeGateway = await startRuntimeGatewayServer(pool, logger);
    closeRuntimeGateway = () => new Promise<void>((resolveClose, reject) => runtimeGateway.close((error) => error ? reject(error) : resolveClose()));
  }
  if (options.broker) {
    const broker = options.broker;
    const socketPath = options.socketPath ?? `/run/kajovocml-ng/${broker}-broker.sock`;
    const secrets = options.broker === 'secret' || options.broker === 'egress' ? new SecretManager(pool, await EnvelopeCipher.fromEnvironment()) : null;
    const server = await createCapabilityServer(
      socketPath,
      async (executionId) => readFile(`/run/kajovocml-ng/capability-keys/${executionId}.key`),
      async (request) => handleBrokerRequest(pool, secrets, broker, request)
    );
    closeBroker = () => new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  }

  const catalog = options.queueNames || options.retryScheduler ? await OperationCatalogService.load() : null;
  const allowedOperations = catalog ? catalog.operations.filter((operation) =>
    options.allowedOperations?.includes(operation.operationName)
    || options.allowedOperationPrefixes?.some((prefix) => operation.operationName.startsWith(prefix))
  ).map((operation) => operation.operationName) : [];
  if (options.queueNames && allowedOperations.length === 0) throw new Error('SERVICE_OPERATION_ALLOWLIST_EMPTY');
  const specialistExecutor = options.serviceName === 'kcml-runtime-gateway' ? new RuntimeLifecycleExecutor() : undefined;
  const worker = options.queueNames && catalog ? new CanonicalCommandWorker(pool, catalog, { queueNames: options.queueNames, allowedOperations, workerId: instanceId, ...(specialistExecutor ? { specialistExecutor } : {}) }) : null;
  const retryScheduler = options.retryScheduler && catalog ? new CanonicalRetryScheduler(pool, new CanonicalOperationService(pool, catalog), { workerId: instanceId }) : null;
  const outboxDelivery = options.outboxDelivery ? new TransactionalOutboxDeliveryWorker(pool, { workerId: instanceId }) : null;
  const stop = () => { stopping = true; };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  const readiness = { schemaVersion: '1.0', runtimeKind: options.runtimeKind, queues: options.queueNames ?? [], allowedOperations, broker: options.broker ?? null };
  await heartbeat('READY', readiness);
  const heartbeatTimer = setInterval(() => void heartbeat('READY', readiness).catch((error) => logger.error('heartbeat.failed', { error: String(error) })), 10_000);
  while (!stopping) {
    let worked = false;
    if (worker) worked = await worker.runOnce().catch(async (error) => {
      logger.error('worker.iteration.failed', { error: error instanceof Error ? error.message : String(error) });
      await heartbeat('FAILED', { error: error instanceof Error ? error.message : String(error) });
      return false;
    });
    if (!worked && retryScheduler) worked = await retryScheduler.runOnce().catch(async (error) => {
      logger.error('retry-scheduler.iteration.failed', { error: error instanceof Error ? error.message : String(error) });
      await heartbeat('FAILED', { error: error instanceof Error ? error.message : String(error) });
      return false;
    });
    if (!worked && outboxDelivery) worked = await outboxDelivery.runOnce().catch(async (error) => {
      logger.error('outbox-delivery.iteration.failed', { error: error instanceof Error ? error.message : String(error) });
      await heartbeat('FAILED', { error: error instanceof Error ? error.message : String(error) });
      return false;
    });
    if (!worked) await new Promise((resolveDelay) => setTimeout(resolveDelay, options.intervalMs ?? 750));
  }
  clearInterval(heartbeatTimer);
  await heartbeat('DRAINING');
  await closeRuntimeGateway?.();
  await closeBroker?.();
  await pool.end();
}

interface OutboxRow {
  id: string;
  stream_key: string;
  stream_sequence: string | number | bigint;
  purpose: string;
  event_type: string;
  aggregate_id: string | null;
  payload: unknown;
  payload_digest: Buffer;
  recovery_epoch: string | number | bigint;
  delivery_fencing_token: string | number | bigint;
}

export interface OutboxDeliveryOptions {
  workerId: string;
  leaseSeconds?: number;
}

function digestPayload(value: unknown): Buffer {
  return createHash('sha256').update(canonicalJson(toCanonicalJsonValue(value))).digest();
}

function sameDigest(left: unknown, right: Buffer): boolean {
  return Buffer.isBuffer(left) && left.length === right.length && left.equals(right);
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function appendDeliveryAudit(client: DatabaseClient, row: OutboxRow, consumerId: string, outcome: string): Promise<void> {
  const payload = { outboxId: row.id, streamKey: row.stream_key, streamSequence: String(row.stream_sequence), purpose: row.purpose, eventType: row.event_type, consumerId, outcome };
  const bytes = Buffer.from(canonicalJson(toCanonicalJsonValue(payload)));
  await client.query(`SELECT * FROM kcml.append_audit_event($1,'SYSTEM','kcml-outbox-relay','TRANSACTIONAL_OUTBOX',$2,NULL,NULL,$3,$4)`, [
    'outbox.delivery.completed', row.id, payload, bytes
  ]);
}

async function deliverDomainEvent(client: DatabaseClient, row: OutboxRow): Promise<string> {
  const consumerId = 'kcml-domain-event-ledger';
  await client.query(`INSERT INTO kcml.transactional_inbox(consumer_id,event_id,stream_key,stream_sequence,payload_digest,processed_at)
    VALUES($1,$2,$3,$4,$5,clock_timestamp()) ON CONFLICT (consumer_id,event_id) DO NOTHING`, [consumerId, row.id, row.stream_key, String(row.stream_sequence), row.payload_digest]);
  await appendDeliveryAudit(client, row, consumerId, 'DURABLY_CONSUMED');
  return consumerId;
}

async function deliverGenerationSuccessor(client: DatabaseClient, row: OutboxRow): Promise<string> {
  const consumerId = 'kcml-generation-phase-scheduler';
  const payload = jsonObject(row.payload);
  const phaseRunId = typeof payload.phaseRunId === 'string' ? payload.phaseRunId : null;
  const phase = typeof payload.phase === 'string' ? payload.phase : null;
  if (!phaseRunId || !phase || !row.aggregate_id) throw new Error('OUTBOX_GENERATION_SUCCESSOR_PAYLOAD_INVALID');
  const successor = (await client.query(`SELECT r.id,r.job_id,r.phase,r.state,r.worker_pool,j.active_phase_run_id,j.lifecycle,j.current_phase
    FROM kcml.generation_phase_run r JOIN kcml.generation_job j ON j.id=r.job_id
    WHERE r.id=$1 AND r.job_id=$2 FOR SHARE OF r,j`, [phaseRunId, row.aggregate_id])).rows[0];
  if (!successor) throw new Error('OUTBOX_GENERATION_SUCCESSOR_NOT_FOUND');
  if (String(successor.phase) !== phase || String(successor.state) !== 'QUEUED' || String(successor.active_phase_run_id) !== phaseRunId || String(successor.lifecycle) !== phase || String(successor.current_phase) !== phase) {
    throw new Error('OUTBOX_GENERATION_SUCCESSOR_STATE_MISMATCH');
  }
  await client.query(`INSERT INTO kcml.transactional_inbox(consumer_id,event_id,stream_key,stream_sequence,payload_digest,processed_at)
    VALUES($1,$2,$3,$4,$5,clock_timestamp()) ON CONFLICT (consumer_id,event_id) DO NOTHING`, [consumerId, row.id, row.stream_key, String(row.stream_sequence), row.payload_digest]);
  await appendDeliveryAudit(client, row, consumerId, 'SUCCESSOR_READY');
  return consumerId;
}

export class TransactionalOutboxDeliveryWorker {
  private readonly leaseSeconds: number;
  public constructor(private readonly pool: DatabasePool, private readonly options: OutboxDeliveryOptions) {
    this.leaseSeconds = Math.max(5, Math.min(options.leaseSeconds ?? 30, 300));
  }

  public async runOnce(): Promise<boolean> {
    const claim = await inTransactionProfile(this.pool, 'WORKER_COMMIT', async (client) => {
      const recovery = (await client.query(`SELECT recovery_epoch,state,database_identity_current,recovery_lineage_current FROM kcml.platform_recovery_head WHERE singleton_key=1 FOR SHARE`)).rows[0];
      if (!recovery || recovery.state !== 'READY' || recovery.database_identity_current !== true || recovery.recovery_lineage_current !== true) return null;
      await client.query(`UPDATE kcml.transactional_outbox SET status='PENDING',delivery_owner=NULL,delivery_lease_expires_at=NULL,state_version=state_version+1
        WHERE status='CLAIMED' AND delivery_lease_expires_at IS NOT NULL AND delivery_lease_expires_at<clock_timestamp()`);
      const row = (await client.query(`SELECT o.* FROM kcml.transactional_outbox o
        WHERE o.status='PENDING' AND o.available_at<=clock_timestamp() AND o.recovery_epoch=$1
          AND o.purpose IN ('DOMAIN_EVENT','GENERATION_PHASE_SUCCESSOR')
          AND NOT EXISTS (
            SELECT 1 FROM kcml.transactional_outbox predecessor
            WHERE predecessor.stream_key=o.stream_key AND predecessor.stream_sequence<o.stream_sequence
              AND predecessor.status NOT IN ('DELIVERED','FAILED_FINAL')
          )
        ORDER BY o.available_at,o.stream_key,o.stream_sequence,o.id
        FOR UPDATE OF o SKIP LOCKED LIMIT 1`, [recovery.recovery_epoch])).rows[0] as OutboxRow | undefined;
      if (!row) return null;
      const claimed = (await client.query(`UPDATE kcml.transactional_outbox
        SET status='CLAIMED',delivery_owner=$2,delivery_fencing_token=delivery_fencing_token+1,delivery_lease_expires_at=clock_timestamp()+($3::text||' seconds')::interval,state_version=state_version+1
        WHERE id=$1 AND status='PENDING' RETURNING *`, [row.id, this.options.workerId, String(this.leaseSeconds)])).rows[0] as OutboxRow | undefined;
      return claimed ?? null;
    });
    if (!claim) return false;

    try {
      await inTransactionProfile(this.pool, 'WORKER_COMMIT', async (client) => {
        const row = (await client.query(`SELECT * FROM kcml.transactional_outbox WHERE id=$1 FOR UPDATE`, [claim.id])).rows[0] as OutboxRow | undefined;
        if (!row || String((row as unknown as Record<string, unknown>).status) !== 'CLAIMED') return;
        const record = row as unknown as Record<string, unknown>;
        if (String(record.delivery_owner) !== this.options.workerId || BigInt(String(row.delivery_fencing_token)) !== BigInt(String(claim.delivery_fencing_token))) throw new Error('OUTBOX_DELIVERY_FENCE_STALE');
        const recovery = (await client.query(`SELECT recovery_epoch,state,database_identity_current,recovery_lineage_current FROM kcml.platform_recovery_head WHERE singleton_key=1 FOR SHARE`)).rows[0];
        if (!recovery || recovery.state !== 'READY' || recovery.database_identity_current !== true || recovery.recovery_lineage_current !== true || BigInt(String(recovery.recovery_epoch)) !== BigInt(String(row.recovery_epoch))) throw new Error('OUTBOX_RECOVERY_EPOCH_STALE');
        const recomputed = digestPayload(row.payload);
        if (!sameDigest(row.payload_digest, recomputed)) throw new Error('OUTBOX_PAYLOAD_DIGEST_MISMATCH');
        if (row.purpose === 'DOMAIN_EVENT') await deliverDomainEvent(client, row);
        else if (row.purpose === 'GENERATION_PHASE_SUCCESSOR') await deliverGenerationSuccessor(client, row);
        else throw new Error('OUTBOX_PURPOSE_UNSUPPORTED');
        const delivered = await client.query(`UPDATE kcml.transactional_outbox SET status='DELIVERED',delivered_at=clock_timestamp(),delivery_owner=NULL,delivery_lease_expires_at=NULL,state_version=state_version+1
          WHERE id=$1 AND status='CLAIMED' AND delivery_owner=$2 AND delivery_fencing_token=$3`, [row.id, this.options.workerId, String(row.delivery_fencing_token)]);
        if (delivered.rowCount !== 1) throw new Error('OUTBOX_DELIVERY_FENCE_STALE');
      });
      return true;
    } catch (error) {
      const deterministic = error instanceof Error && ['OUTBOX_GENERATION_SUCCESSOR_PAYLOAD_INVALID','OUTBOX_GENERATION_SUCCESSOR_NOT_FOUND','OUTBOX_GENERATION_SUCCESSOR_STATE_MISMATCH','OUTBOX_PAYLOAD_DIGEST_MISMATCH','OUTBOX_PURPOSE_UNSUPPORTED'].includes(error.message);
      await inTransactionProfile(this.pool, 'WORKER_COMMIT', async (client) => {
        await client.query(`UPDATE kcml.transactional_outbox
          SET status=$4,available_at=CASE WHEN $4='PENDING' THEN clock_timestamp()+interval '5 seconds' ELSE available_at END,delivery_owner=NULL,delivery_lease_expires_at=NULL,state_version=state_version+1
          WHERE id=$1 AND status='CLAIMED' AND delivery_owner=$2 AND delivery_fencing_token=$3`, [claim.id, this.options.workerId, String(claim.delivery_fencing_token), deterministic ? 'FAILED_FINAL' : 'PENDING']);
      });
      if (deterministic) return true;
      throw error;
    }
  }
}
