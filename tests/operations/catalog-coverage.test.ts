import { describe, expect, it } from 'vitest';
import { loadOperationCatalog } from '../../packages/contract-pack/src/index.js';
import { operationHandlerCatalog } from '../../packages/domain/src/operation-handler-catalog.js';

const catalog = await loadOperationCatalog();
const handlers = new Map(operationHandlerCatalog.map((handler) => [handler.operation, handler]));

describe('OPERATION_COVERAGE_EVIDENCE', () => {
  it.each(catalog.records.map((operation) => [operation.operationName, operation] as const))('%s has declared binding metadata', (operationName, operation) => {
    const handler = handlers.get(operationName);
    expect(handler).toBeDefined();
    expect(handler?.family).toBe(operation.operationFamily);
    expect(handler?.contractDigest).toBe(operation.canonicalDigest);
    expect(handler?.entity).toMatch(/^[a-z][a-z0-9_]*$/u);
    expect(handler?.queue).toMatch(/^kcml-[a-z-]+$/u);
    expect(['CONSISTENT_QUERY', 'IDEMPOTENT_CREATE', 'CAS_STATE_TRANSITION', 'COMMUTATIVE_EVIDENCE_APPEND', 'SIDE_EFFECT_LEDGER', 'GUARDED_RECONCILIATION']).toContain(handler?.strategy);
  });

  it('has one-to-one operation and handler coverage', () => {
    expect(catalog.records).toHaveLength(262);
    expect(operationHandlerCatalog).toHaveLength(catalog.records.length);
    expect(new Set(operationHandlerCatalog.map((handler) => handler.operation)).size).toBe(catalog.records.length);
  });
});
