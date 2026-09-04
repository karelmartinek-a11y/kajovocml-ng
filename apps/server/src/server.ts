import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { createDatabasePool, verifyDatabaseContract, type DatabasePool } from '@kcml/database';
import { CanonicalOperationService, canonicalFailure, DomainError, EnvelopeCipher, OperationCatalogService, OwnerAuthenticationService, SecretManager, SsotSurfaceService, SystemChatService, closureReportForRoot, loadClosureRecords, tokenDigest, type SessionPrincipal } from '@kcml/domain';
import { MetricsRegistry, StructuredLogger, correlationId } from '@kcml/observability';
import { DatabaseOpenAISecretProvider, ResponsesRuntime } from '@kcml/openai-runtime';
import { compileAuthorityLineage } from '@kcml/agentic-authority';
import { issuePreviewTicket } from '@kcml/browser-preview-protocol';
import { canonicalDigest, ownerLoginSchema, toCanonicalJsonValue, z, type CanonicalJsonValue } from '@kcml/schemas';
import { SSOT_ENTITY_NAMES, SSOT_ROUTES, SSOT_SURFACE_FINGERPRINT } from './ssot-surface.generated.js';
import { registerCompiledSsotRoutes } from './ssot-router.js';
import { installPreviewWebSocket } from './preview-ws.js';
import { evaluateServiceReadiness, loadExpectedHeartbeatServices, type ServiceHeartbeat } from './readiness.js';

declare module 'fastify' {
  interface FastifyRequest {
    principal?: SessionPrincipal;
    ownerIdentityId?: string;
    authKind?: 'SESSION' | 'API_KEY';
    requestCorrelationId: string;
  }
}

export interface ServerDependencies { pool?: DatabasePool; cipher?: EnvelopeCipher; repositoryRoot?: string; logger?: StructuredLogger; }

type JsonObject = Record<string, unknown>;

async function loadDashboardChatContext(pool: DatabasePool, surface: SsotSurfaceService): Promise<JsonObject> {
  const [workspace, nodePositions, connections, runtimeEvents] = await Promise.all([
    surface.read('dashboard_workspace', null, 10),
    surface.read('dashboard_node_position', null, 500),
    surface.read('dashboard_connection', null, 500),
    surface.read('dashboard_runtime_event', null, 100),
  ]);
  return {
    source: 'KCML_SERVER_DASHBOARD_SNAPSHOT', capturedAt: new Date().toISOString(),
    workspace, nodePositions, connections, runtimeEvents,
    visibleUiObjects: [
      { key: 'metric.active_components', label: 'Aktivní komponenty', meaning: 'Počet aktivních komponent z aktuálního databázového stavu.' },
      { key: 'metric.degraded', label: 'Nezdravé / degradované', meaning: 'Počet komponent ve zhoršeném nebo nezdravém stavu.' },
      { key: 'metric.open_alerts', label: 'Otevřené alarmy', meaning: 'Počet aktuálně otevřených alarmů.' },
      { key: 'metric.running_work', label: 'Běžící joby / runy', meaning: 'Počet právě běžících jobů nebo runů.' },
      { key: 'health-strip', label: 'API, Workers, PostgreSQL, TLS, DNS', meaning: 'Souhrnné stavové indikátory provozních služeb.' },
      { key: 'topology', label: 'Topologie systému', meaning: 'Konfigurační mapa Internet → Nginx + API → Auth, Orchestrator, Outbox → Agents, MCP, Browser, PostgreSQL.' },
      { key: 'audit-timeline', label: 'Poslední KCIP / PULSE události', meaning: 'Časová osa posledních auditních událostí s korelací.' },
      { key: 'service-heartbeats', label: 'Service heartbeats', meaning: 'Poslední heartbeat každé známé služby, release, epochy a stav.' },
    ],
  };
}

const CHAT_TOOLS = [
  { type: 'function', name: 'read_entity', description: 'Read the current authoritative PostgreSQL projection for an SSOT entity. Never use this for secret values.', parameters: { type: 'object', additionalProperties: false, properties: { entity: { type: 'string' }, targetId: { type: ['string', 'null'] }, limit: { type: 'integer', minimum: 1, maximum: 500 }, scope: { type: 'object', additionalProperties: { type: 'string' } } }, required: ['entity'] }, strict: true },
  { type: 'function', name: 'execute_operation', description: 'Execute one catalogued OWNER operation through the canonical command service. Use only when the OWNER explicitly requests an action.', parameters: { type: 'object', additionalProperties: false, properties: { operation: { type: 'string' }, targetId: { type: ['string', 'null'] }, arguments: { type: 'object', additionalProperties: true }, expectedStateVersion: { type: ['string', 'null'] }, expectedActivationEpoch: { type: ['string', 'null'] } }, required: ['operation', 'arguments'] }, strict: true },
];

function functionCalls(output: unknown[]): Array<{ callId: string; name: string; arguments: JsonObject }> {
  return output.flatMap((item) => {
    const value = item && typeof item === 'object' ? item as JsonObject : {};
    if (value.type !== 'function_call' || typeof value.call_id !== 'string' || typeof value.name !== 'string' || typeof value.arguments !== 'string') return [];
    try { const args = JSON.parse(value.arguments) as unknown; return args && typeof args === 'object' && !Array.isArray(args) ? [{ callId: value.call_id, name: value.name, arguments: args as JsonObject }] : []; } catch { return []; }
  });
}

async function executeChatTool(name: string, args: JsonObject, pool: DatabasePool, surface: SsotSurfaceService, operations: CanonicalOperationService, request: FastifyRequest, ownerActorId: string): Promise<unknown> {
  if (name === 'read_entity') {
    const entity = typeof args.entity === 'string' ? args.entity : '';
    const targetId = typeof args.targetId === 'string' ? args.targetId : null;
    const limit = typeof args.limit === 'number' ? args.limit : 200;
    const scope = args.scope && typeof args.scope === 'object' && !Array.isArray(args.scope) ? args.scope as Record<string, string> : {};
    return apiSafe(await surface.read(entity, targetId, limit, scope));
  }
  if (name === 'execute_operation') {
    const operation = typeof args.operation === 'string' ? args.operation : '';
    const result = await operations.execute(operation, {
      targetId: typeof args.targetId === 'string' ? args.targetId : null,
      arguments: args.arguments && typeof args.arguments === 'object' && !Array.isArray(args.arguments) ? args.arguments : {},
      expectedStateVersion: args.expectedStateVersion ?? null,
      expectedActivationEpoch: args.expectedActivationEpoch ?? null,
      deadlineAt: new Date(Date.now() + 120_000).toISOString(),
    }, { callerFingerprint: callerFingerprint(request), actorId: ownerActorId, correlationId: request.requestCorrelationId, idempotencyKey: randomUUID() });
    return apiSafe(result);
  }
  throw new DomainError('KCIP_TARGET_NOT_FOUND', `Unknown chat tool ${name}`, 400, 'DO_NOT_RETRY');
}

function apiSafe(value: unknown): unknown {
  return toCanonicalJsonValue(value);
}

function canonicalValue(value: unknown): CanonicalJsonValue {
  return toCanonicalJsonValue(value);
}

function previewTicketKey(): Buffer | null {
  const explicitPath = process.env.KCML_PREVIEW_TICKET_KEY_FILE;
  const credentialPath = process.env.CREDENTIALS_DIRECTORY ? resolve(process.env.CREDENTIALS_DIRECTORY, 'preview-ticket-key') : null;
  const path = explicitPath ?? credentialPath;
  if (!path || !existsSync(path)) return null;
  const value = readFileSync(path);
  return value.length >= 32 ? value : null;
}

interface OpenAIModelCapability {
  modelId: string;
  observedAt: string;
  expiresAt: string;
  compatibilityProfile: unknown;
  lifecycleCapabilities: unknown;
  structuredOutputProfile: unknown;
  toolCapabilities: unknown;
  modalityLimits: unknown;
  sourceEvidence: unknown;
}

async function currentOpenAIModels(pool: DatabasePool): Promise<{ models: OpenAIModelCapability[]; defaultModel: string | null }> {
  const result = await pool.query(`SELECT model_id,observed_at,expires_at,compatibility_profile,lifecycle_capabilities,
    structured_output_profile,tool_capabilities,modality_limits,source_evidence
    FROM kcml.openai_model_capability_snapshot
    WHERE lifecycle='ACTIVE' AND deleted_at IS NULL AND observed_at<=clock_timestamp() AND expires_at>clock_timestamp()
    ORDER BY observed_at DESC,model_id ASC`);
  const models = result.rows.map((row) => ({
    modelId: String(row.model_id), observedAt: new Date(row.observed_at).toISOString(), expiresAt: new Date(row.expires_at).toISOString(),
    compatibilityProfile: row.compatibility_profile, lifecycleCapabilities: row.lifecycle_capabilities,
    structuredOutputProfile: row.structured_output_profile, toolCapabilities: row.tool_capabilities,
    modalityLimits: row.modality_limits, sourceEvidence: row.source_evidence,
  }));
  const configuredDefault = process.env.KCML_OPENAI_DEFAULT_MODEL;
  const defaultModel = models.some((model) => model.modelId === configuredDefault) ? configuredDefault! : models[0]?.modelId ?? null;
  return { models, defaultModel };
}

function cookieOptions() {
  return { path: '/', httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' as const, maxAge: 12 * 60 * 60 };
}

function idempotencyKey(request: FastifyRequest): string | null {
  return typeof request.headers['idempotency-key'] === 'string' ? request.headers['idempotency-key'] : null;
}

function callerFingerprint(request: FastifyRequest): string {
  return request.authKind === 'API_KEY' ? 'OWNER_API_KEY' : request.principal?.sessionId ?? 'OWNER_SESSION';
}

async function verifySsotStorage(pool: DatabasePool): Promise<{ expected: number; physical: number; missing: string[] }> {
  const result = await pool.query(`SELECT c.relname AS table_name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='kcml' AND c.relkind='r'`);
  const physical = new Set(result.rows.map((row) => String(row.table_name)));
  const missing = SSOT_ENTITY_NAMES.filter((name) => !physical.has(name));
  if (missing.length) throw new Error(`SSOT_STORAGE_MISSING:${missing.join(',')}`);
  return { expected: SSOT_ENTITY_NAMES.length, physical: SSOT_ENTITY_NAMES.length, missing: [] };
}

async function ownerApiKeyMetadata(pool: DatabasePool): Promise<unknown> {
  const result = await pool.query(`SELECT id,stable_name,secret_id,secret_version_id,fingerprint,credential_version,credential_activation_epoch,last_used_at,last_usage_metadata,created_at,rotated_at,updated_at,state_version FROM kcml.owner_api_credential WHERE singleton_key=1`);
  if (!result.rows[0]) throw new DomainError('AGENTIC_OWNER_INTENT_MISSING', 'Singleton OWNER API credential row is missing', 503);
  return apiSafe(result.rows[0]);
}

export async function buildServer(dependencies: ServerDependencies = {}): Promise<FastifyInstance> {
  const logger = dependencies.logger ?? new StructuredLogger(process.env.KCML_SERVICE_NAME ?? 'kcml-web-api');
  const metrics = new MetricsRegistry();
  const pool = dependencies.pool ?? createDatabasePool({ applicationName: 'kcml-web-api' });
  const cipher = dependencies.cipher ?? await EnvelopeCipher.fromEnvironment();
  const repositoryRoot = dependencies.repositoryRoot ?? process.cwd();
  const expectedHeartbeatServices = await loadExpectedHeartbeatServices(repositoryRoot);
  const catalog = await OperationCatalogService.load(repositoryRoot);
  const operations = new CanonicalOperationService(pool, catalog);
  const auth = new OwnerAuthenticationService(pool, cipher);
  const secrets = new SecretManager(pool, cipher);
  const surface = new SsotSurfaceService(pool, new Set(SSOT_ENTITY_NAMES));
  const systemChat = new SystemChatService(pool);
  const previewKey = previewTicketKey();
  const provider = new DatabaseOpenAISecretProvider(async () => {
    const row = await pool.query(`SELECT id FROM kcml.secret_record WHERE stable_name='OPENAI_API_KEY' AND deleted_at IS NULL`);
    const id = row.rows[0]?.id;
    if (!id) throw new DomainError('OPENAI_CONFIGURATION_REQUIRED', 'OpenAI credential is not configured', 409);
    return (await secrets.reveal(id, 'openai-runtime')).value;
  });
  const responses = new ResponsesRuntime(pool, provider);
  const app = Fastify({ logger: false, trustProxy: '127.0.0.1', bodyLimit: 8 * 1024 * 1024, requestTimeout: 130_000, keepAliveTimeout: 72_000, genReqId: () => randomUUID() });

  await installPreviewWebSocket(app, pool, previewKey);

  await app.register(cookie, { hook: 'onRequest' });
  await app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:', 'blob:'], connectSrc: ["'self'", 'wss:'], frameAncestors: ["'none'"] } }, hsts: { maxAge: 63_072_000, includeSubDomains: true, preload: true } });
  await app.register(rateLimit, { max: 240, timeWindow: '1 minute', keyGenerator: (request) => request.ip });
  app.addHook('onRequest', async (request) => { request.requestCorrelationId = correlationId(typeof request.headers['x-correlation-id'] === 'string' ? request.headers['x-correlation-id'] : undefined); });
  app.addHook('onRequest', async (request) => { if (request.url.startsWith('/api/v1/') && ['POST','PUT','PATCH','DELETE'].includes(request.method) && !idempotencyKey(request)) throw new DomainError('TOOL_ARGUMENT_SCHEMA_INVALID', 'Idempotency-Key is mandatory for every mutating API request', 422, 'DO_NOT_RETRY', { key: 'Idempotency-Key' }); });
  app.addHook('onResponse', async (request, reply) => { reply.header('x-correlation-id', request.requestCorrelationId); metrics.increment('kcml_http_requests_total', { method: request.method, status: String(reply.statusCode) }); });
  app.setErrorHandler((error, request, reply) => {
    const domain = error instanceof DomainError ? error : new DomainError('KCIP_INTERNAL_FAILURE', 'Internal service error', 500);
    const failure = canonicalFailure(domain);
    logger.error('request.failed', { correlationId: request.requestCorrelationId, code: failure.code, error: error instanceof Error ? error.message : String(error), errorRecordDigest: failure.recordDigest });
    void reply.status(failure.httpStatus).send({ error: { ...failure, correlationId: request.requestCorrelationId } });
  });

  const authenticate = async (request: FastifyRequest, requireMfa = true): Promise<void> => {
    const authorization = request.headers.authorization;
    const apiValue = typeof authorization === 'string' && authorization.startsWith('Bearer ') ? authorization.slice(7) : typeof request.headers['x-api-key'] === 'string' ? request.headers['x-api-key'] : null;
    if (apiValue) {
      const result = await pool.query(`SELECT c.verifier_hash,o.id AS owner_id FROM kcml.owner_api_credential c CROSS JOIN kcml.owner_identity o WHERE c.singleton_key=1 AND o.singleton_key=1`);
      const expected = result.rows[0]?.verifier_hash as Buffer | undefined;
      const actual = tokenDigest(apiValue);
      if (!expected || expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new DomainError('AGENTIC_OPERATION_CONTEXT_INVALID', 'API key is invalid', 401);
      request.ownerIdentityId = result.rows[0].owner_id;
      request.authKind = 'API_KEY';
      return;
    }
    const token = request.cookies.kcml_session;
    if (!token) throw new DomainError('AGENTIC_OWNER_INTENT_MISSING', 'Authentication is required', 401);
    request.principal = await auth.authenticate(token, requireMfa);
    request.ownerIdentityId = request.principal.ownerId;
    request.authKind = 'SESSION';
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const csrf = request.headers['x-csrf-token'];
      if (typeof csrf !== 'string') throw new DomainError('AGENTIC_OWNER_INTENT_MISSING', 'X-CSRF-Token is required', 403);
      auth.verifyCsrf(request.principal, csrf);
    }
  };
  const ownerId = (request: FastifyRequest) => request.ownerIdentityId!;

  // Host-level probes remain outside the product API contract.
  app.get('/health', async () => ({ status: 'healthy', service: 'kcml-web-api', releaseId: process.env.KCML_RELEASE_ID ?? 'development' }));
  app.get('/ready', async (_request, reply) => {
    try {
      await verifyDatabaseContract(pool);
      await verifySsotStorage(pool);
      const recovery = (await pool.query(`SELECT state,recovery_epoch,database_start_identity,kcml.current_database_start_identity() AS current_database_start_identity,platform_incarnation_id,application_deployment_epoch,ready_evidence_digest FROM kcml.platform_recovery_head WHERE singleton_key=1`)).rows[0];
      if(!recovery||recovery.state!=='READY'||!Buffer.from(recovery.database_start_identity).equals(Buffer.from(recovery.current_database_start_identity))||!recovery.ready_evidence_digest)throw new Error('PLATFORM_RECOVERY_NOT_READY');
      const epoch = await deploymentEpoch(pool);
      const expected = process.env.KCML_DEPLOYMENT_EPOCH;
      if (expected !== undefined && expected !== epoch) throw new Error(`MIXED_DEPLOYMENT_EPOCH:process=${expected}:database=${epoch}`);
      if(BigInt(recovery.application_deployment_epoch)!==BigInt(epoch))throw new Error(`PLATFORM_RECOVERY_DEPLOYMENT_EPOCH_STALE:recovery=${recovery.application_deployment_epoch}:database=${epoch}`);
      const releaseId = process.env.KCML_RELEASE_ID ?? 'development';
      const sourceSha = process.env.KCML_SOURCE_SHA ?? '';
      if (!/^[0-9a-f]{40}$/iu.test(sourceSha)) throw new Error('KCML_SOURCE_SHA_REQUIRED');
      const heartbeatResult = await pool.query<ServiceHeartbeat>(`SELECT DISTINCT ON (service_name)
        service_name,instance_id,release_id,source_sha,deployment_epoch,status,observed_at,expires_at
        FROM kcml.platform_worker_heartbeat ORDER BY service_name,observed_at DESC`);
      const serviceReadiness = evaluateServiceReadiness(heartbeatResult.rows, expectedHeartbeatServices, releaseId, sourceSha, epoch);
      if (!serviceReadiness.ready) throw new Error(`SERVICE_READINESS_BLOCKED:${JSON.stringify(serviceReadiness)}`);
      return { status: 'ready', deploymentEpoch: epoch, recoveryEpoch:String(recovery.recovery_epoch), releaseId, sourceSha: sourceSha.toLowerCase(), services: serviceReadiness, ssotSurfaceFingerprint: SSOT_SURFACE_FINGERPRINT };
    } catch (error) {
      reply.status(503);
      return { status: 'not_ready', reason: error instanceof Error ? error.message : String(error) };
    }
  });
  const specialRouteKeys = new Set<string>([
    'GET /operations/catalog','POST /operations/:operationKey/invoke',
    'POST /auth/login','POST /auth/login/mfa','POST /auth/logout','POST /auth/api-key-session','GET /session','POST /session/reauthenticate',
    'GET /owner/security','POST /owner/mfa/enroll','POST /owner/mfa/verify','POST /owner/recovery-codes/rotate','GET /owner/sessions','DELETE /owner/sessions/:id','POST /owner/sessions/revoke-others','POST /owner/sessions/revoke-all',
    'GET /owner/api-key','GET /owner/api-key/value','POST /owner/api-key/rotate','GET /owner/api-key/usage',
    'GET /system/health','GET /system/readiness','GET /system/version','GET /system/capabilities','GET /system/closure',
    'GET /secrets','POST /secrets','GET /secrets/:id','PATCH /secrets/:id','DELETE /secrets/:id','GET /secrets/:id/value','POST /secrets/:id/versions','GET /secrets/:id/versions','POST /secrets/generate-password','POST /secrets/import','POST /secrets/export',
    'GET /audit/integrity','POST /audit/integrity/verify',
    'POST /chat/ask','POST /browser-sessions/:sessionId/preview-tickets'
  ]);

  app.get('/api/v1/operations/catalog', async (request) => { await authenticate(request); return { operations: catalog.publicView(), count: catalog.operations.length }; });
  app.post('/api/v1/operations/:operationKey/invoke', async (request) => {
    await authenticate(request);
    const operationKey = decodeURIComponent((request.params as { operationKey: string }).operationKey);
    if (catalog.get(operationKey).exposureClass === 'INTERNAL_PROTOCOL') throw new DomainError('EXPOSURE_PARITY_INCOMPLETE', `Internal protocol operation ${operationKey} has no public REST exposure`, 404, 'DO_NOT_RETRY');
    return apiSafe(await operations.execute(operationKey, request.body, { callerFingerprint: callerFingerprint(request), actorId: ownerId(request), correlationId: request.requestCorrelationId, idempotencyKey: idempotencyKey(request) }));
  });

  app.post('/api/v1/auth/login', { config: { rateLimit: { max: 12, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const input = ownerLoginSchema.parse(request.body);
    const result = await auth.login(input.username, input.password, request.ip, request.headers['user-agent'] ?? null, request.requestCorrelationId);
    reply.setCookie('kcml_session', result.sessionToken, cookieOptions());
    reply.header('x-csrf-token', result.csrfToken);
    return { state: result.state, csrfToken: result.csrfToken, expiresAt: result.expiresAt, username: 'KRMAR78' };
  });
  app.post('/api/v1/auth/login/mfa', async (request) => { await authenticate(request, false); const body = z.object({ code: z.string().min(1) }).parse(request.body); await auth.verifyMfa(request.cookies.kcml_session!, body.code); return { state: 'AUTHENTICATED' }; });
  app.post('/api/v1/auth/logout', async (request, reply) => { await authenticate(request, false); if (request.authKind !== 'SESSION' || !request.principal) throw new DomainError('AGENTIC_OWNER_INTENT_MISSING', 'Logout requires an OWNER web session', 400); await auth.logout(request.principal); reply.clearCookie('kcml_session', { path: '/' }); return { status: 'SIGNED_OUT' }; });
  app.post('/api/v1/auth/api-key-session', async (request, reply) => { await authenticate(request); if (request.authKind !== 'API_KEY') throw new DomainError('AGENTIC_OWNER_INTENT_MISSING', 'Bearer KCML_OWNER_API_KEY is required', 401); const result = await auth.createApiKeySession(request.ip, request.headers['user-agent'] ?? null); reply.setCookie('kcml_session', result.sessionToken, cookieOptions()); reply.header('x-csrf-token', result.csrfToken); return { state: 'AUTHENTICATED', csrfToken: result.csrfToken, expiresAt: result.expiresAt, username: 'KRMAR78' }; });
  app.get('/api/v1/session', async (request) => { await authenticate(request, false); return { username: 'KRMAR78', authKind: request.authKind, sessionId: request.principal?.sessionId ?? null, mfaVerified: request.principal?.mfaVerified ?? request.authKind === 'API_KEY', expiresAt: request.principal?.expiresAt.toISOString() ?? null }; });
  app.post('/api/v1/session/reauthenticate', async (request) => { await authenticate(request, false); if (request.authKind !== 'SESSION') throw new DomainError('AGENTIC_OWNER_INTENT_MISSING', 'Reauthentication requires a web session', 400); const body = z.object({ password: z.string().min(1), mfaCode: z.string().optional() }).parse(request.body); await auth.reauthenticate(request.cookies.kcml_session!, body.password, body.mfaCode); return { status: 'REAUTHENTICATED' }; });
  app.get('/api/v1/owner/security', async (request) => { await authenticate(request); const result = await pool.query(`SELECT id,username,password_source,mfa_enabled,deployment_managed,password_changed_at,last_login_at,created_at,updated_at,state_version,application_deployment_epoch FROM kcml.owner_identity WHERE singleton_key=1`); return apiSafe(result.rows[0]); });
  app.post('/api/v1/owner/mfa/enroll', async (request) => { await authenticate(request, false); if (request.authKind !== 'SESSION') throw new DomainError('AGENTIC_OWNER_INTENT_MISSING', 'MFA enrollment requires a web session', 400); return auth.beginMfaEnrollment(request.cookies.kcml_session!); });
  app.post('/api/v1/owner/mfa/verify', async (request) => { await authenticate(request, false); if (request.authKind !== 'SESSION') throw new DomainError('AGENTIC_OWNER_INTENT_MISSING', 'MFA enrollment verification requires a web session', 400); const body = z.object({ code: z.string().min(1) }).parse(request.body); return auth.completeMfa(request.cookies.kcml_session!, body.code); });
  app.post('/api/v1/owner/recovery-codes/rotate', async (request) => { await authenticate(request); if (request.authKind !== 'SESSION') throw new DomainError('AGENTIC_OWNER_INTENT_MISSING', 'Recovery code rotation requires a web session', 400); return auth.rotateRecoveryCodes(request.cookies.kcml_session!); });
  app.get('/api/v1/owner/sessions', async (request) => { await authenticate(request); return auth.listSessions(ownerId(request)); });
  app.delete('/api/v1/owner/sessions/:id', async (request) => { await authenticate(request); await auth.revokeSession(ownerId(request), (request.params as { id: string }).id); return { status: 'REVOKED' }; });
  app.post('/api/v1/owner/sessions/revoke-others', async (request) => { await authenticate(request); if (!request.principal) throw new DomainError('AGENTIC_OWNER_INTENT_MISSING', 'Current session is required', 400); return { revoked: await auth.revokeOtherSessions(ownerId(request), request.principal.sessionId) }; });
  app.post('/api/v1/owner/sessions/revoke-all', async (request, reply) => { await authenticate(request); const revoked = await auth.revokeAllSessions(ownerId(request)); reply.clearCookie('kcml_session', { path: '/' }); return { revoked }; });
  app.get('/api/v1/owner/api-key', async (request) => { await authenticate(request); return ownerApiKeyMetadata(pool); });
  app.get('/api/v1/owner/api-key/value', async (request) => { await authenticate(request); const result = await pool.query(`SELECT secret_id FROM kcml.owner_api_credential WHERE singleton_key=1`); if (!result.rows[0]?.secret_id) throw new DomainError('AGENTIC_OPERATION_CONTEXT_INVALID', 'OWNER API key is not initialized', 409); return secrets.reveal(result.rows[0].secret_id, ownerId(request)); });
  app.post('/api/v1/owner/api-key/rotate', async (request) => { await authenticate(request); const body = z.object({ expectedStateVersion: z.coerce.bigint(), logicalOperationId: z.string().uuid().optional() }).parse(request.body); return secrets.rotateOwnerApiKey(body.expectedStateVersion, ownerId(request), body.logicalOperationId ?? randomUUID(), request.requestCorrelationId); });
  app.get('/api/v1/owner/api-key/usage', async (request) => { await authenticate(request); const [credential, accesses] = await Promise.all([ownerApiKeyMetadata(pool), pool.query(`SELECT id,event_type,actor_id,correlation_id,created_at FROM kcml.audit_event WHERE event_type LIKE 'owner.api_key.%' OR actor_id='OWNER_API_KEY' ORDER BY chain_sequence DESC LIMIT 100`)]); return { credential, events: apiSafe(accesses.rows) }; });

  app.get('/api/v1/system/health', async (request) => { await authenticate(request); return { status: 'healthy', releaseId: process.env.KCML_RELEASE_ID ?? 'development', sourceSha: process.env.KCML_SOURCE_SHA ?? null }; });
  app.get('/api/v1/system/readiness', async (request) => {
    await authenticate(request);
    const [database, storage, heartbeat, openai, epoch, summary, timeline] = await Promise.all([
      verifyDatabaseContract(pool),
      verifySsotStorage(pool),
      pool.query<ServiceHeartbeat>(`SELECT DISTINCT ON (service_name) service_name,instance_id,release_id,source_sha,deployment_epoch,status,observed_at,expires_at FROM kcml.platform_worker_heartbeat ORDER BY service_name,observed_at DESC`),
      pool.query(`SELECT EXISTS(SELECT 1 FROM kcml.secret_record WHERE stable_name='OPENAI_API_KEY' AND active_version_id IS NOT NULL AND deleted_at IS NULL) configured`),
      deploymentEpoch(pool),
      pool.query(`SELECT
        (SELECT count(*)::text FROM kcml.component WHERE lifecycle='ACTIVE' AND deleted_at IS NULL) AS active_components,
        (SELECT count(*)::text FROM kcml.component WHERE deleted_at IS NULL AND (operational_state IN ('DEGRADED','UNHEALTHY') OR monitoring_state IN ('DEGRADED','UNHEALTHY'))) AS degraded,
        (SELECT count(*)::text FROM kcml.operational_alert WHERE status IN ('OPEN','ACKNOWLEDGED','SUPPRESSED')) AS open_alerts,
        ((SELECT count(*) FROM kcml.generation_job WHERE lifecycle IN ('ANALYZING','IMPLEMENTING','INTEGRATING','VALIDATING','CML_CONFORMANCE','ACTIVATING')) +
         (SELECT count(*) FROM kcml.agent_run WHERE status IN ('QUEUED','PREPARING','RUNNING','WAITING_FOR_MODEL','WAITING_FOR_TOOL','WAITING_FOR_MCP_INPUT','WAITING_FOR_MCP_TASK','WAITING_FOR_AGENT','WAITING_FOR_OWNER','CHALLENGE_REQUIRED','PAUSED')))::text AS running_work`),
      pool.query(`SELECT id,event_type,correlation_id,created_at FROM kcml.audit_event ORDER BY chain_sequence DESC LIMIT 20`)
    ]);
    const releaseId = process.env.KCML_RELEASE_ID ?? 'development';
    const sourceSha = process.env.KCML_SOURCE_SHA ?? '';
    const services = /^[0-9a-f]{40}$/iu.test(sourceSha)
      ? evaluateServiceReadiness(heartbeat.rows, expectedHeartbeatServices, releaseId, sourceSha, epoch)
      : { ready: false, expectedServices: expectedHeartbeatServices, missingServices: [], unhealthyServices: [], staleServices: [], mismatchedServices: ['KCML_SOURCE_SHA_REQUIRED'] };
    return {
      ready: services.ready,
      database,
      storage,
      services: heartbeat.rows,
      serviceReadiness: services,
      capabilities: { openai: openai.rows[0].configured ? 'READY' : 'OPENAI_CONFIGURATION_REQUIRED' },
      summary: {
        schemaVersion: 'DashboardSummaryV1', capturedAt: new Date().toISOString(),
        activeComponents: summary.rows[0]?.active_components ?? null,
        degraded: summary.rows[0]?.degraded ?? null,
        openAlerts: summary.rows[0]?.open_alerts ?? null,
        runningWork: summary.rows[0]?.running_work ?? null,
      },
      serviceGroups: [
        { group: 'API', status: 'READY', observedAt: new Date().toISOString(), evidence: { database: true, storage: true } },
        { group: 'WORKERS', status: services.ready ? 'READY' : 'DEGRADED', observedAt: new Date().toISOString(), evidence: services },
        { group: 'POSTGRESQL', status: 'READY', observedAt: new Date().toISOString(), evidence: database },
        { group: 'TLS', status: 'UNKNOWN', observedAt: null, evidence: null },
        { group: 'DNS', status: 'UNKNOWN', observedAt: null, evidence: null },
      ],
      timeline: apiSafe(timeline.rows),
      releaseId,
      sourceSha: sourceSha || null,
      deploymentEpoch: epoch,
      ssotSurfaceFingerprint: SSOT_SURFACE_FINGERPRINT
    };
  });
  app.get('/api/v1/system/version', async (request) => { await authenticate(request); return { product: 'KájovoCML NG', version: '2026.8.30-8', releaseId: process.env.KCML_RELEASE_ID ?? 'development', sourceSha: process.env.KCML_SOURCE_SHA ?? null, deploymentEpoch: await deploymentEpoch(pool), ssotSurfaceFingerprint: SSOT_SURFACE_FINGERPRINT }; });
  app.get('/api/v1/system/capabilities', async (request) => { await authenticate(request); const configured = await pool.query(`SELECT stable_name,kind,active_version_id IS NOT NULL AS configured FROM kcml.secret_record WHERE deleted_at IS NULL ORDER BY stable_name`); return { apiRoutes: SSOT_ROUTES.length, databaseEntities: SSOT_ENTITY_NAMES.length, operationCatalog: catalog.operations.length, credentials: apiSafe(configured.rows) }; });
  app.get('/api/v1/system/closure', async (request) => {
    await authenticate(request);
    const query = z.object({ rootKind: z.string().min(1).optional(), rootId: z.string().uuid().nullable().optional() }).strict().parse(request.query ?? {});
    const records = await loadClosureRecords(repositoryRoot);
    if (!query.rootKind) return { closureVersion: 1, rootKinds: records.filter((record) => record.lifecycle === 'ACTIVE').map((record) => ({ rootKind: record.rootKind, closurePredicateId: record.closurePredicateId, directQueryIds: record.directQueryIds, passExpression: record.passExpression, terminalStates: record.terminalStates })) };
    return apiSafe(await closureReportForRoot(pool, query.rootKind, query.rootId ?? null, repositoryRoot));
  });

  app.get('/api/v1/secrets', async (request) => { await authenticate(request); return secrets.list(); });
  app.post('/api/v1/secrets', async (request) => { await authenticate(request); return secrets.create(request.body, ownerId(request), randomUUID(), request.requestCorrelationId); });
  app.get('/api/v1/secrets/:id', async (request) => { await authenticate(request); return secrets.get((request.params as { id: string }).id); });
  app.patch('/api/v1/secrets/:id', async (request) => { await authenticate(request); const body = z.object({ displayName: z.string().min(1).optional(), metadata: z.record(z.string(), z.unknown()).optional(), expectedStateVersion: z.coerce.bigint() }).parse(request.body); return secrets.update((request.params as { id: string }).id, body, body.expectedStateVersion, ownerId(request), randomUUID(), request.requestCorrelationId); });
  app.delete('/api/v1/secrets/:id', async (request) => { await authenticate(request); const query = z.object({ expectedStateVersion: z.coerce.bigint() }).parse(request.query); return secrets.softDelete((request.params as { id: string }).id, query.expectedStateVersion, ownerId(request), randomUUID(), request.requestCorrelationId); });
  app.get('/api/v1/secrets/:id/value', async (request) => { await authenticate(request); return secrets.reveal((request.params as { id: string }).id, ownerId(request), randomUUID(), request.requestCorrelationId); });
  app.post('/api/v1/secrets/:id/versions', async (request) => { await authenticate(request); const body = z.object({ value: z.string().min(1), expectedStateVersion: z.coerce.bigint(), activate: z.boolean().default(true) }).parse(request.body); return secrets.addVersion((request.params as { id: string }).id, body.value, body.expectedStateVersion, ownerId(request), body.activate, randomUUID(), request.requestCorrelationId); });
  app.get('/api/v1/secrets/:id/versions', async (request) => { await authenticate(request); return secrets.listVersions((request.params as { id: string }).id); });
  app.post('/api/v1/secrets/generate-password', async (request) => { await authenticate(request); const body = z.object({ bytes: z.number().int().min(16).max(256).default(32) }).parse(request.body ?? {}); return { value: randomBytes(body.bytes).toString('base64url'), entropyBits: body.bytes * 8 }; });
  app.post('/api/v1/secrets/import', async (request) => { await authenticate(request); const body = z.object({ records: z.array(z.unknown()).min(1).max(1000) }).parse(request.body); const created = []; for (const record of body.records) created.push(await secrets.create(record, ownerId(request), randomUUID(), request.requestCorrelationId)); return { imported: created.length, records: created }; });
  app.post('/api/v1/secrets/export', async (request) => { await authenticate(request); return { exportedAt: new Date().toISOString(), records: await secrets.exportActive(ownerId(request)) }; });

  app.get('/api/v1/audit/integrity', async (request) => { await authenticate(request); return apiSafe(await operations.execute('audit.integrity.verify', { targetId: null, arguments: {}, expectedStateVersion: null, expectedActivationEpoch: null, deadlineAt: null }, { callerFingerprint: callerFingerprint(request), actorId: ownerId(request), correlationId: request.requestCorrelationId, idempotencyKey: null })); });
  app.post('/api/v1/audit/integrity/verify', async (request) => { await authenticate(request); return apiSafe(await operations.execute('audit.integrity.verify', { targetId: null, arguments: request.body ?? {}, expectedStateVersion: null, expectedActivationEpoch: null, deadlineAt: null }, { callerFingerprint: callerFingerprint(request), actorId: ownerId(request), correlationId: request.requestCorrelationId, idempotencyKey: idempotencyKey(request) })); });

  app.post('/api/v1/chat/ask', async (request) => {
    await authenticate(request);
    const body = z.object({ conversationId: z.string().uuid().optional(), messageId: z.string().uuid().optional(), message: z.string().min(1), model: z.string().optional(), context: z.record(z.string(), z.unknown()).default({}) }).parse(request.body);
    const capabilities = await currentOpenAIModels(pool);
    const selectedModel = body.model ?? capabilities.defaultModel;
    if (!selectedModel || !capabilities.models.some((model) => model.modelId === selectedModel)) {
      throw new DomainError('OPENAI_MODEL_CAPABILITY_UNSUPPORTED', 'Requested model has no fresh verified capability snapshot', 422, 'DO_NOT_RETRY', { requestedModel: body.model ?? null });
    }
    const dashboardContext = await loadDashboardChatContext(pool, surface);
    const modelInput = {
      ownerMessage: body.message,
      clientContext: body.context,
      dashboardSnapshot: dashboardContext,
      availableSsotEntities: SSOT_ENTITY_NAMES,
      availableCanonicalOperations: operations.catalog.publicView(),
      availableChatTools: ['read_entity', 'execute_operation'],
    };
    const conversationId = body.conversationId ?? randomUUID();
    const messageId = body.messageId ?? randomUUID();
    const reservation=await systemChat.reserve({conversationId,messageId,message:body.message,model:selectedModel,context:body.context,accessChannel:request.authKind!,idempotencyKey:idempotencyKey(request)!,correlationId:request.requestCorrelationId});
    if(reservation.replay)return apiSafe({conversationId,messageId:reservation.ownerMessageId,assistantMessageId:reservation.assistantMessageId,assistantStatus:reservation.assistantStatus,modelCallId:reservation.modelCallId,outputText:reservation.assistantContent,idempotencyReplay:true});
    const contextDigest = canonicalDigest(canonicalValue(body.context));
    const lineage = compileAuthorityLineage({ lineageId: randomUUID(), authorityKind: 'OWNER_FULL', sourceOwnerMessageId: messageId, operationContextDigest: contextDigest, targetOperation: 'chat.response.stream', arguments: { message: { value: body.message, origin: 'OWNER_LITERAL', sourceRef: `owner-message:${messageId}` } }, createdAt: new Date().toISOString() });
    try{
      const instructions = 'You are the KájovoCML NG central assistant. You have live server tools over the complete compiled SSOT surface and canonical OWNER operations. Answer questions about the whole program, components, agents, MCP, browser, monitoring, logs, audit, configuration and secrets from live tool results. Use read_entity whenever the supplied snapshot is insufficient; never claim lack of access when a tool can read the data. Use execute_operation only for an explicit OWNER command, and report its exact result and evidence. Model interpretation is only a proposal; never invent an outcome. Secret values are trusted OWNER data under SSOT and may be read only when the OWNER explicitly asks for the value; never fetch or repeat a secret proactively. Explain all lifecycle states in plain Czech when useful. The dashboardSnapshot is server-generated observational context and visibleUiObjects describes the rendered dashboard objects.';
      let result = await responses.create({ parentRunId: conversationId, ownerKind: 'SYSTEM_CHAT', model: selectedModel, instructions, input: modelInput, tools: CHAT_TOOLS as never, authority: lineage });
      for (let turn = 1; turn <= 8; turn += 1) {
        const calls = functionCalls(result.output);
        if (!calls.length) break;
        const outputs = [];
        for (const call of calls) {
          try { outputs.push({ type: 'function_call_output', call_id: call.callId, output: JSON.stringify(await executeChatTool(call.name, call.arguments, pool, surface, operations, request, ownerId(request))) }); }
          catch (error) { outputs.push({ type: 'function_call_output', call_id: call.callId, output: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }); }
        }
        result = await responses.create({ parentRunId: conversationId, ownerKind: 'SYSTEM_CHAT', model: selectedModel, instructions, input: outputs, previousResponseId: result.responseId, tools: CHAT_TOOLS as never, idempotencyKey: `${messageId}:chat-continuation:${turn}`, authority: lineage });
      }
      const assistantMessageId=await systemChat.complete({conversationId,ownerMessageId:messageId,content:result.outputText,modelCallId:result.callId,usage:result.usage,correlationId:request.requestCorrelationId});
      return apiSafe({ conversationId, messageId, assistantMessageId, ...result, requestedModel: body.model ?? null, selectedModel, actualModel: selectedModel, authorityLineage: lineage, idempotencyReplay:false });
    }catch(error){
      const details=error instanceof DomainError&&typeof error.details==='object'&&error.details!==null?error.details as Record<string,unknown>:{};
      try{
        await systemChat.fail({conversationId,ownerMessageId:messageId,message:error instanceof Error?error.message:String(error),modelCallId:typeof details.callId==='string'?details.callId:null,correlationId:request.requestCorrelationId});
      }catch(persistenceError){
        logger.error('chat.failure_persistence_failed',{correlationId:request.requestCorrelationId,code:error instanceof DomainError?error.code:'OPENAI_PROVIDER_TRANSIENT',error:persistenceError instanceof Error?persistenceError.message:String(persistenceError)});
      }
      throw error;
    }
  });

  app.post('/api/v1/browser-sessions/:sessionId/preview-tickets', async (request) => {
    await authenticate(request);
    if (!previewKey) throw new DomainError('RUNTIME_SECRET_BINDING_REJECTED', 'Preview ticket credential is unavailable', 503, 'DO_NOT_RETRY');
    const sessionId = (request.params as { sessionId: string }).sessionId;
    const ownerSessionId = request.principal?.sessionId ?? '00000000-0000-0000-0000-000000000000';
    const issued = issuePreviewTicket(sessionId, ownerSessionId, previewKey);
    const fingerprint = tokenDigest(issued.token);
    const head = (await pool.query(`SELECT p.platform_incarnation_id,d.current_epoch,a.current_epoch AS activation_epoch FROM kcml.platform_incarnation p CROSS JOIN kcml.application_deployment_head d CROSS JOIN kcml.activation_head a WHERE p.singleton_key=1 AND d.singleton_key=1 AND a.singleton_key=1`)).rows[0];
    await pool.query(`INSERT INTO kcml.browser_preview_ticket(parent_id,stable_key,display_name,lifecycle,session_id,owner_session_id,access_channel,audience,capability_set,token_fingerprint,issued_at,expires_at,
      canonical_digest,activation_epoch,platform_incarnation_id,application_deployment_epoch,correlation_id)
      VALUES($1,$2,$3,'ACTIVE',$1,$4,$5,'OWNER_PREVIEW_WS',$6,$7,clock_timestamp(),$8,$7,$9,$10,$11,$12)`,[
      sessionId,fingerprint.toString('hex'),`Preview ticket ${sessionId}`,request.authKind==='SESSION'?ownerSessionId:null,request.authKind,{video:true,observation:true},fingerprint,issued.expiresAt,
      head.activation_epoch,head.platform_incarnation_id,head.current_epoch,request.requestCorrelationId
    ]);
    return issued;
  });

  registerCompiledSsotRoutes({ app, pool, operations, surface, authenticate, ownerId, specialRouteKeys });
  const uiRoot = resolve(process.cwd(), 'apps/owner-ui/dist');
  if (existsSync(uiRoot)) {
    await app.register(fastifyStatic, {
      root: uiRoot,
      prefix: '/',
      wildcard: false,
      // Release artifacts have deterministic timestamps. Files with the same size
      // would therefore receive the same weak ETag across different releases and
      // could leave a browser running an index that references a removed bundle.
      cacheControl: false,
      etag: false,
      lastModified: false,
      setHeaders: (reply, pathName) => {
        if (pathName.endsWith('index.html')) {
          reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
          reply.header('Pragma', 'no-cache');
          reply.header('Expires', '0');
          return;
        }
        if (pathName.includes('/assets/')) reply.header('Cache-Control', 'public, max-age=31536000, immutable');
      }
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) return reply.status(404).send({ error: { code: 'ROUTE_NOT_FOUND', message: 'API route not found', correlationId: request.requestCorrelationId } });
      return reply
        .header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        .header('Pragma', 'no-cache')
        .header('Expires', '0')
        .type('text/html')
        .sendFile('index.html');
    });
  }
  app.addHook('onClose', async () => { if (!dependencies.pool) await pool.end(); });
  return app;
}

async function deploymentEpoch(pool: DatabasePool): Promise<string> {
  const result = await pool.query(`SELECT current_epoch FROM kcml.application_deployment_head WHERE singleton_key=1`);
  return String(result.rows[0].current_epoch);
}
