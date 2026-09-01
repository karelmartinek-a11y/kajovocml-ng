import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadOperationCatalog } from '../../packages/contract-pack/src/index.js';
import { operationHandlerFor } from '../../packages/domain/src/operation-handler-catalog.js';
import {
  ROUTE_OPERATION_BINDINGS,
  operationForRoute,
  parseSsotRoutes,
  SERVER_HANDLED_ROUTE_KEYS
} from '../../scripts/lib/ssot-surface.mjs';

const ssot = await readFile(new URL('../../SSOT_CURRENT.md', import.meta.url), 'utf8');
const routes = parseSsotRoutes(ssot);
const catalog = await loadOperationCatalog();
const operationNames = catalog.records.map((record) => record.operationName);
const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

describe('SSOT route operation bindings', () => {
  it('resolves every route explicitly without family or create-default inference', async () => {
    const source = await readFile(new URL('../../scripts/lib/ssot-surface.mjs', import.meta.url), 'utf8');
    expect(source).toContain('ROUTE_OPERATION_BINDINGS');
    expect(source).not.toMatch(/familyForPath|CREATE_DEFAULT|normalizeToken/u);

    expect(routes).toHaveLength(503);
    expect(routes.filter((route) => mutatingMethods.has(route.method))).toHaveLength(256);
    expect(routes.filter((route) => SERVER_HANDLED_ROUTE_KEYS.has(route.routeKey))).toHaveLength(40);
    expect(ROUTE_OPERATION_BINDINGS.size).toBe(277);
    expect([...ROUTE_OPERATION_BINDINGS.keys()].every((routeKey) => routes.some((route) => route.routeKey === routeKey))).toBe(true);

    for (const route of routes) {
      const operation = operationForRoute(route, operationNames);
      if (route.routeKey === 'POST /operations/:operationKey/invoke') {
        expect(operation).toBe('__DYNAMIC_OPERATION__');
      } else if (SERVER_HANDLED_ROUTE_KEYS.has(route.routeKey)) {
        expect(operation).toBeNull();
      } else if (mutatingMethods.has(route.method)) {
        expect(operation).toEqual(expect.any(String));
        expect(operationNames).toContain(operation);
        expect(ROUTE_OPERATION_BINDINGS.get(route.routeKey)).toBe(operation);
        expect(operationHandlerFor(operation! as string).operation).toBe(operation);
      } else if (operation !== null) {
        expect(operationNames).toContain(operation);
        expect(ROUTE_OPERATION_BINDINGS.get(route.routeKey)).toBe(operation);
        expect(operationHandlerFor(operation).operation).toBe(operation);
      }
    }
  });

  it('keeps route behavior tied to the exact canonical operation', () => {
    const expected = new Map([
      ['POST /components', 'component.register'],
      ['POST /components/:id/revisions', 'component.revision.publish'],
      ['POST /agents/:id/memory/search', 'agent.memory.read'],
      ['GET /mcp-prompts', 'mcp.prompts.list'],
      ['GET /mcp-prompts/:id', 'mcp.prompts.get'],
      ['GET /mcp-resources/:id', 'mcp.resources.read'],
      ['POST /browser-sessions/:sessionId/resume', 'browser.session.resume'],
      ['POST /browser-sessions/:sessionId/recover', 'browser.session.recover'],
      ['PUT /dashboard/layout', 'component.revision.publish'],
      ['POST /agents', 'agent.eval.start'],
      ['POST /browser-automations', 'browser.automation.run'],
      ['POST /external/targets', 'component.revision.publish'],
      ['POST /maintenance/restart-service', 'runtime.instance.restart']
    ]);

    for (const [routeKey, operationName] of expected) {
      const route = routes.find((candidate) => candidate.routeKey === routeKey);
      expect(route).toBeDefined();
      expect(operationForRoute(route!, operationNames)).toBe(operationName);
    }

    expect(operationForRoute(routes.find((route) => route.routeKey === 'POST /chat/ask')!, operationNames)).toBeNull();
    expect(operationForRoute(routes.find((route) => route.routeKey === 'POST /browser-sessions/:sessionId/preview-tickets')!, operationNames)).toBeNull();
  });

  it('keeps compiled mutations on the canonical service boundary', async () => {
    const routerSource = await readFile(new URL('../../apps/server/src/ssot-router.ts', import.meta.url), 'utf8');
    const surfaceSource = await readFile(new URL('../../packages/domain/src/ssot-surface.ts', import.meta.url), 'utf8');
    expect(routerSource).toContain('assertCanonicalRouteHandler');
    expect(routerSource).toContain('operationHandlerFor');
    expect(routerSource).not.toContain('surface.mutate(');
    expect(surfaceSource).toContain("SSOT_OPERATION_BINDING_REQUIRED");
    expect(surfaceSource).toContain('Promise<never>');
  });
});
