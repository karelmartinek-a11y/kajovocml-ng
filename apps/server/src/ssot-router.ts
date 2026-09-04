import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DatabasePool } from '@kcml/database';
import { CanonicalOperationService, DomainError, operationHandlerFor, SsotSurfaceService } from '@kcml/domain';
import { SSOT_ROUTES, type SsotRoute } from './ssot-surface.generated.js';

export type AuthenticateRequest = (request: FastifyRequest, requireMfa?: boolean) => Promise<void>;

export interface CompiledRouteDependencies {
  app: FastifyInstance;
  pool: DatabasePool;
  operations: CanonicalOperationService;
  surface: SsotSurfaceService;
  authenticate: AuthenticateRequest;
  ownerId: (request: FastifyRequest) => string;
  specialRouteKeys: ReadonlySet<string>;
}

type Params = Record<string, string>;
type JsonObject = Record<string, unknown>;

function paramsOf(request: FastifyRequest): Params {
  const raw = (request.params ?? {}) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
}

function bodyOf(request: FastifyRequest): JsonObject {
  return request.body && typeof request.body === 'object' && !Array.isArray(request.body) ? request.body as JsonObject : {};
}

function queryLimit(request: FastifyRequest): number {
  const query = request.query && typeof request.query === 'object' ? request.query as Record<string, unknown> : {};
  const raw = Number(query.limit ?? 200);
  return Number.isFinite(raw) ? Math.max(1, Math.min(500, Math.trunc(raw))) : 200;
}

function lastParam(route: SsotRoute, params: Params): string | null {
  const names = [...route.path.matchAll(/:([A-Za-z][A-Za-z0-9_]*)/g)]
    .map((match) => match[1])
    .filter((name): name is string => name !== undefined);
  for (const name of names.reverse()) if (params[name] !== undefined) return params[name];
  return null;
}

function pathEndsWithParam(route: SsotRoute): boolean {
  return /\/:([A-Za-z][A-Za-z0-9_]*)$/u.test(route.path);
}

const ACTION_TAILS = new Set([
  'activate','approve','cancel','close','compact','connect','deregister','disable','enable','enroll','execute','export','fail','finalize','import','invoke','pause','precheck','preflight','preview','publish','reconcile','recover','refresh','reject','release','repair','reset','resolve','restore','resume','retry','revoke','rollback','rotate','run','save','start','stop','suspend','takeover','test','validate','verify','warmup','ack','return-to-ai','acquire','resolve-outcome','test-resolve'
]);

function directTargetId(route: SsotRoute, params: Params): string | null {
  const candidate = lastParam(route, params);
  if (!candidate) return null;
  if (pathEndsWithParam(route)) return candidate;
  const tail = route.path.split('/').filter(Boolean).at(-1) ?? '';
  return ACTION_TAILS.has(tail) ? candidate : null;
}

function operationTargetId(route: SsotRoute, params: Params): string | null {
  const candidate = lastParam(route, params);
  if (!candidate) return null;
  const tail = route.path.split('/').filter(Boolean).at(-1) ?? '';
  if (pathEndsWithParam(route) || ACTION_TAILS.has(tail)) return candidate;
  return null;
}

function scopeForRoute(route: SsotRoute, params: Params): Record<string, string> {
  const scope: Record<string, string> = { ...params };
  const names = [...route.path.matchAll(/:([A-Za-z][A-Za-z0-9_]*)/g)]
    .map((match) => match[1])
    .filter((name): name is string => name !== undefined);
  if (names.length) scope.parentId = params[names.at(-1)!] ?? '';
  return scope;
}

function enrichedArguments(route: SsotRoute, request: FastifyRequest): JsonObject {
  const params = paramsOf(request);
  const body = bodyOf(request);
  const query = request.query && typeof request.query === 'object' ? request.query as JsonObject : {};
  const parent = lastParam(route, params);
  return { ...query, ...body, ...params, ...(parent ? { parentId: parent } : {}) };
}

function expectedStateVersion(request: FastifyRequest): bigint | null {
  const body = bodyOf(request);
  const value = body.expectedStateVersion ?? request.headers['if-match'];
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).replace(/^W\//u, '').replace(/^"|"$/gu, '');
  try { return BigInt(text); } catch { throw new DomainError('TOOL_ARGUMENT_SCHEMA_INVALID', 'expectedStateVersion/If-Match must be an integer', 400, 'DO_NOT_RETRY'); }
}

function expectedActivationEpoch(request: FastifyRequest): bigint | null {
  const body = bodyOf(request);
  const value = body.expectedActivationEpoch;
  if (value === undefined || value === null || value === '') return null;
  try { return BigInt(String(value)); } catch { throw new DomainError('TOOL_ARGUMENT_SCHEMA_INVALID', 'expectedActivationEpoch must be an integer', 400, 'DO_NOT_RETRY'); }
}

function callerFingerprint(request: FastifyRequest): string {
  return request.authKind === 'API_KEY' ? 'OWNER_API_KEY' : request.principal?.sessionId ?? 'OWNER_SESSION';
}

function commandInput(route: SsotRoute, request: FastifyRequest): JsonObject {
  const body = bodyOf(request);
  if ('arguments' in body || 'targetId' in body || 'expectedStateVersion' in body || 'expectedActivationEpoch' in body || 'deadlineAt' in body) {
    return {
      targetId: body.targetId ?? operationTargetId(route, paramsOf(request)),
      arguments: body.arguments ?? enrichedArguments(route, request),
      expectedStateVersion: body.expectedStateVersion ?? expectedStateVersion(request),
      expectedActivationEpoch: body.expectedActivationEpoch ?? expectedActivationEpoch(request),
      deadlineAt: body.deadlineAt ?? null
    };
  }
  return {
    targetId: operationTargetId(route, paramsOf(request)),
    arguments: enrichedArguments(route, request),
    expectedStateVersion: expectedStateVersion(request),
    expectedActivationEpoch: expectedActivationEpoch(request),
    deadlineAt: null
  };
}

function assertCanonicalRouteHandler(route: SsotRoute, operations: CanonicalOperationService): void {
  if (!route.operation || route.operation === '__DYNAMIC_OPERATION__') return;
  const operation = operations.catalog.get(route.operation);
  const handler = operationHandlerFor(operation.operationName);
  if (handler.operation !== operation.operationName) {
    throw new Error(`COMPILED_ROUTE_HANDLER_OPERATION_MISMATCH:${route.routeKey}:${operation.operationName}`);
  }
}

export function registerCompiledSsotRoutes(dependencies: CompiledRouteDependencies): void {
  const { app, operations, surface, authenticate, ownerId, specialRouteKeys } = dependencies;
  for (const route of SSOT_ROUTES) {
    if (route.method === 'WSS' || specialRouteKeys.has(route.routeKey)) continue;
    assertCanonicalRouteHandler(route, operations);
    if (route.operation && route.operation !== '__DYNAMIC_OPERATION__' && operations.catalog.get(route.operation).exposureClass === 'INTERNAL_PROTOCOL') continue;
    const method = route.method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    app.route({
      method,
      url: `/api/v1${route.path}`,
      handler: async (request) => {
        await authenticate(request);
        if (route.operation) {
          const operationName = route.operation === '__DYNAMIC_OPERATION__'
            ? String((request.params as Record<string, unknown>).operationKey ?? '')
            : route.operation;
          if (!operationName) throw new DomainError('OPERATION_CONTRACT_INCOMPLETE', 'operationKey is required', 400, 'DO_NOT_RETRY');
          return operations.execute(operationName, commandInput(route, request), {
            callerFingerprint: callerFingerprint(request),
            actorId: ownerId(request),
            correlationId: request.requestCorrelationId,
            idempotencyKey: typeof request.headers['idempotency-key'] === 'string' ? request.headers['idempotency-key'] : null
          });
        }
        if (method === 'GET') {
          const params = paramsOf(request);
          return surface.read(route.entity, directTargetId(route, params), queryLimit(request), scopeForRoute(route, params));
        }
        throw new Error(`COMPILED_MUTATING_ROUTE_OPERATION_MISSING:${route.routeKey}`);
      }
    });
  }
}
