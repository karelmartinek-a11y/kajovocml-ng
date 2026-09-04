import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { canonicalJson, toCanonicalJsonValue, type CanonicalJsonValue } from '@kcml/schemas';
import { createDatabasePool, inTransaction, type DatabaseClient } from '@kcml/database';
import { CanonicalCommandWorker, CanonicalOperationService, CanonicalRetryScheduler, EnvelopeCipher, OperationCatalogService, SecretManager } from '@kcml/domain';
import { StructuredLogger } from '@kcml/observability';
import { createCapabilityServer, type CapabilityRequest, type CapabilityResponse } from '@kcml/runtime-capability-ipc';

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
  'kcml-component-control-worker': { queueNames: ['kcml-component'], allowedOperations: ['component.control.enable', 'component.control.disable', 'component.control.ack', 'component.heartbeat', 'component.state.report'], runtimeKind: 'SPECIALIST_HANDLER' },
  'kcml-component-e2e-worker': { queueNames: ['kcml-selftest'], allowedOperations: ['selfTest.registeredElement.run'], runtimeKind: 'EVIDENCE_WORKER' },
  'kcml-monitor-worker': { queueNames: ['kcml-monitor'], allowedOperationPrefixes: ['monitor.'], runtimeKind: 'EVIDENCE_WORKER', intervalMs: 1000 },
  'kcml-alert-primary-worker': { queueNames: ['kcml-monitor'], allowedOperationPrefixes: ['monitor.alert.'], runtimeKind: 'SPECIALIST_HANDLER' },
  'kcml-alert-backup-worker': { queueNames: ['kcml-monitor'], allowedOperationPrefixes: ['monitor.alert.'], runtimeKind: 'SPECIALIST_HANDLER' },
  'kcml-secret-broker': { broker: 'secret', socketPath: '/run/kajovocml-ng/brokers/secret-broker.sock', runtimeKind: 'CAPABILITY_BROKER' },
  'kcml-state-broker': { broker: 'state', socketPath: '/run/kajovocml-ng/brokers/state-broker.sock', runtimeKind: 'CAPABILITY_BROKER' },
  'kcml-egress-gateway': { broker: 'egress', socketPath: '/run/kajovocml-ng/brokers/egress-gateway.sock', runtimeKind: 'CAPABILITY_BROKER' },
  'kcml-audit-archiver': { queueNames: ['kcml-audit'], allowedOperationPrefixes: ['audit.'], runtimeKind: 'EVIDENCE_WORKER' },
  'kcml-self-test-worker': { queueNames: ['kcml-selftest'], allowedOperationPrefixes: ['selfTest.'], runtimeKind: 'EVIDENCE_WORKER' },
  'kcml-acceptance-runner': { queueNames: ['kcml-selftest'], allowedOperationPrefixes: ['selfTest.'], runtimeKind: 'EVIDENCE_WORKER', intervalMs: 250 },
  'kcml-runtime-host': { queueNames: ['kcml-runtime'], allowedOperationPrefixes: ['runtime.'], runtimeKind: 'SPECIALIST_HANDLER' },
  'kcml-owner-device-bridge': { runtimeKind: 'PROTOCOL_GATEWAY' },
  'kcml-retry-scheduler': { retryScheduler: true, runtimeKind: 'COMMAND_COORDINATOR', intervalMs: 250 }
} as const satisfies Record<string, Omit<ServiceOptions, 'serviceName'>>;

export type SpecializedServiceName = keyof typeof specializedServices;

export function serviceReadinessDescriptor(serviceName: SpecializedServiceName): Readonly<Record<string, unknown>> {
  const service = specializedServices[serviceName];
  return Object.freeze({
    schemaVersion: '1.0', serviceName, runtimeKind: service.runtimeKind,
    queues: 'queueNames' in service ? service.queueNames : [],
    operationPrefixes: 'allowedOperationPrefixes' in service ? service.allowedOperationPrefixes : [],
    operations: 'allowedOperations' in service ? service.allowedOperations : [],
    capabilities: 'broker' in service ? [service.broker] : 'retryScheduler' in service ? ['CANONICAL_RETRY_SCHEDULER'] : []
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

function runtimeStateKey(executionId: string): string {
  return `runtime-state:${executionId}`;
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

async function stateRead(pool: ReturnType<typeof createDatabasePool>, executionId: string, payload: JsonObject): Promise<unknown> {
  const key = String(payload.key ?? '');
  if (!key || key.length > 512) throw new Error('RUNTIME_STATE_KEY_INVALID');
  const result = await pool.query(`SELECT id,persistent_state,state_version,activation_epoch,application_deployment_epoch
    FROM kcml.component_runtime_target
    WHERE stable_key=$1 AND lifecycle='ACTIVE' AND deleted_at IS NULL`, [runtimeStateKey(executionId)]);
  const row = result.rows[0];
  if (!row) return null;
  const document = (row.persistent_state ?? {}) as JsonObject;
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

async function stateWrite(pool: ReturnType<typeof createDatabasePool>, executionId: string, payload: JsonObject): Promise<unknown> {
  const operation = String(payload.operation ?? 'put').toLowerCase();
  if (!['put', 'create', 'delete'].includes(operation)) throw new Error('RUNTIME_STATE_OPERATION_UNSUPPORTED');
  const key = String(payload.key ?? '');
  if (!key || key.length > 512) throw new Error('RUNTIME_STATE_KEY_INVALID');
  const expected = payload.expectedStateVersion === undefined || payload.expectedStateVersion === null ? null : BigInt(String(payload.expectedStateVersion));

  return inTransaction(pool, 'SERIALIZABLE', async (client) => {
    const heads = (await client.query(`SELECT p.platform_incarnation_id,d.current_epoch,a.current_epoch AS activation_epoch
      FROM kcml.platform_incarnation p CROSS JOIN kcml.application_deployment_head d CROSS JOIN kcml.activation_head a
      WHERE p.singleton_key=1 AND d.singleton_key=1 AND a.singleton_key=1 FOR SHARE OF p,d,a`)).rows[0];
    const stableKey = runtimeStateKey(executionId);
    let row = (await client.query(`SELECT * FROM kcml.component_runtime_target WHERE stable_key=$1 FOR UPDATE`, [stableKey])).rows[0];
    if (!row) {
      if (operation !== 'create' && operation !== 'put') throw new Error('RUNTIME_STATE_NOT_FOUND');
      row = (await client.query(`INSERT INTO kcml.component_runtime_target(stable_key,display_name,lifecycle,transport,execution_mode,readiness_mode,persistent_state,activation_epoch,platform_incarnation_id,application_deployment_epoch)
        VALUES($1,$2,'ACTIVE','RUNTIME_GATEWAY_UDS','PERSISTENT_STATE','HEALTHCHECK',$3,$4,$5,$6) RETURNING *`, [
        stableKey,
        `Persistent state ${executionId}`,
        { executionId, persistentState: true, namespaceVersion: 1, values: {} },
        heads.activation_epoch,
        heads.platform_incarnation_id,
        heads.current_epoch
      ])).rows[0];
    }

    const document = { ...((row.persistent_state ?? {}) as JsonObject) };
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
      schemaVersion: Number(payload.schemaVersion ?? current?.schemaVersion ?? 1),
      stateVersion: nextVersion.toString(),
      deleted: operation === 'delete',
      updatedAt: new Date().toISOString(),
      executionId
    };
    document.values = values;
    document.namespaceVersion = (BigInt(row.state_version) + 1n).toString();
    document.lastCorrelationId = typeof payload.correlationId === 'string' ? payload.correlationId : null;
    const updated = (await client.query(`UPDATE kcml.component_runtime_target AS t
      SET persistent_state=$2,state_version=t.state_version+1,activation_epoch=$3,application_deployment_epoch=$4,updated_at=clock_timestamp()
      WHERE t.id=$1 RETURNING *`, [row.id, document, heads.activation_epoch, heads.current_epoch])).rows[0];
    await appendBrokerAudit(client, `runtime.state.${operation}`, executionId, 'COMPONENT_RUNTIME_TARGET', row.id, { key, stateVersion: nextVersion.toString(), valueDigest: sha256(value), correlationId: payload.correlationId ?? null });
    return {
      id: row.id,
      key,
      value,
      valueDigest: sha256(value),
      schemaVersion: Number(payload.schemaVersion ?? current?.schemaVersion ?? 1),
      stateVersion: nextVersion.toString(),
      namespaceVersion: updated.state_version,
      deleted: operation === 'delete'
    };
  });
}

async function egressRequest(pool: ReturnType<typeof createDatabasePool>, executionId: string, payload: JsonObject): Promise<unknown> {
  const bindingId = String(payload.bindingId ?? '');
  if (!bindingId) throw new Error('EXTERNAL_BINDING_REQUIRED');
  const binding = await pool.query(`SELECT id,target_key,base_url,allowed_paths,allowed_methods,timeout_ms,retry_policy,rate_limit,circuit_state,auth_binding_id,monitoring,lifecycle,state_version FROM kcml.external_target WHERE id::text=$1 OR stable_key=$1 OR target_key=$1 LIMIT 1`, [bindingId]);
  const row = binding.rows[0];
  if (!row || row.lifecycle !== 'ACTIVE') throw new Error('EXTERNAL_BINDING_NOT_READY');
  const definition = row as JsonObject;
  const outgoing = (payload.request ?? {}) as JsonObject;
  const baseUrl = definition.baseUrl ?? definition.base_url;
  if (typeof baseUrl !== 'string') throw new Error('EXTERNAL_TARGET_BASE_URL_MISSING');
  const base = new URL(baseUrl);
  const relativePath = String(outgoing.path ?? '/');
  if (/^[a-z][a-z0-9+.-]*:/iu.test(relativePath) || relativePath.startsWith('//')) throw new Error('EGRESS_ABSOLUTE_URL_DENIED');
  const url = new URL(relativePath, base);
  if (url.origin !== base.origin) throw new Error('EGRESS_ORIGIN_MISMATCH');
  const allowedPaths = Array.isArray(definition.allowedPaths) ? definition.allowedPaths.map(String) : Array.isArray(definition.allowed_paths) ? definition.allowed_paths.map(String) : ['/'];
  if (!allowedPaths.some((prefix) => url.pathname.startsWith(prefix))) throw new Error('EGRESS_PATH_DENIED');
  const allowed = Array.isArray(definition.methods) ? definition.methods.map((value) => String(value).toUpperCase()) : Array.isArray(definition.allowedMethods) ? definition.allowedMethods.map((value) => String(value).toUpperCase()) : ['GET'];
  const method = String(outgoing.method ?? 'GET').toUpperCase();
  if (!allowed.includes(method)) throw new Error('EGRESS_METHOD_DENIED');
  const timeoutMs = Math.max(100, Math.min(Number(definition.timeoutMs ?? definition.timeout_ms ?? 30_000), 120_000));
  const response = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', 'user-agent': 'KájovoCML-NG/2026.8.30-8' },
    signal: AbortSignal.timeout(timeoutMs),
    ...(['GET', 'HEAD'].includes(method) ? {} : { body: JSON.stringify(outgoing.body ?? null) })
  });
  const body = await response.text();
  return { status: response.status, headers: Object.fromEntries(response.headers), body: body.slice(0, 2_000_000), targetId: row.id, targetStateVersion: row.state_version, executionId };
}

async function handleBrokerRequest(pool: ReturnType<typeof createDatabasePool>, secrets: SecretManager, broker: NonNullable<ServiceOptions['broker']>, request: CapabilityRequest): Promise<CapabilityResponse> {
  try {
    const payload = request.payload as JsonObject;
    let responsePayload: unknown;
    if (broker === 'secret') {
      if (request.capability !== 'SECRET_USE') throw new Error('CAPABILITY_MISMATCH');
      const revealed = await secrets.reveal(String(payload.secretId), `runtime:${request.executionId}`);
      responsePayload = { value: revealed.value, fingerprint: revealed.fingerprint };
    } else if (broker === 'state') {
      if (!['STATE_READ', 'STATE_WRITE'].includes(request.capability)) throw new Error('CAPABILITY_MISMATCH');
      responsePayload = request.capability === 'STATE_READ' ? await stateRead(pool, request.executionId, payload) : await stateWrite(pool, request.executionId, payload);
    } else {
      if (request.capability !== 'EGRESS_REQUEST') throw new Error('CAPABILITY_MISMATCH');
      responsePayload = await egressRequest(pool, request.executionId, payload);
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
  if (options.broker) {
    const broker = options.broker;
    const socketPath = options.socketPath ?? `/run/kajovocml-ng/${broker}-broker.sock`;
    const cipher = await EnvelopeCipher.fromEnvironment();
    const secrets = new SecretManager(pool, cipher);
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
  const worker = options.queueNames && catalog ? new CanonicalCommandWorker(pool, catalog, { queueNames: options.queueNames, allowedOperations, workerId: instanceId }) : null;
  const retryScheduler = options.retryScheduler && catalog ? new CanonicalRetryScheduler(pool, new CanonicalOperationService(pool, catalog), { workerId: instanceId }) : null;
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
    if (!worked) await new Promise((resolveDelay) => setTimeout(resolveDelay, options.intervalMs ?? 750));
  }
  clearInterval(heartbeatTimer);
  await heartbeat('DRAINING');
  await closeBroker?.();
  await pool.end();
}
