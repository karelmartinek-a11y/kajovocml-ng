import { describe, expect, it } from 'vitest';
import { loadOperationCatalog, loadRegistry, validateExposureParity, type ExposureParityContract } from '../../packages/contract-pack/src/index.js';
import { operationHandlerCatalog } from '../../packages/domain/src/operation-handler-catalog.js';

const catalog = await loadOperationCatalog();
const exposureParity = await loadRegistry<ExposureParityContract>('EXPOSURE_PARITY_REGISTRY');
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

describe('TD-08 exact exposure parity', () => {
  it('resolves every catalog operation to explicit surface evidence', () => {
    expect(exposureParity.records).toHaveLength(catalog.records.length);
    expect(() => validateExposureParity(catalog.records, exposureParity.records)).not.toThrow();

    for (const record of exposureParity.records) {
      expect(record.surfaceBindings.length).toBeGreaterThan(0);
      expect(record.surfaceBindings.every((binding) => !/^(?:API|UI-ACTION|CHAT|SELFTEST)-/u.test(binding.bindingId))).toBe(true);
      expect(record.surfaceBindings.filter((binding) => binding.status === 'APPLICABLE').every((binding) =>
        Boolean(binding.sourcePath && binding.sourceSymbol && binding.sourceMarker && binding.target))).toBe(true);
      expect(record.surfaceBindings.filter((binding) => binding.status === 'NOT_APPLICABLE').every((binding) =>
        Boolean(binding.reasonCode && binding.supportingRequirementSourceRef === 'ssot://55.18/55-18-ui-api-chat-audit-a-self-test-parity/atom-1'))).toBe(true);
    }
  });

  it('fails closed when an owner command loses its UI action binding', () => {
    const records = structuredClone(exposureParity.records);
    const command = records.find((record) => record.exposureClass === 'OWNER_COMMAND');
    expect(command).toBeDefined();
    command!.uiActionIds = [];
    command!.surfaceBindings = command!.surfaceBindings.filter((binding) => !binding.bindingId.startsWith('UI_ACTION:'));

    expect(() => validateExposureParity(catalog.records, records)).toThrow(/EXPOSURE_PARITY_INCOMPLETE/u);
  });

  it('keeps internal protocols off public REST and tied to a business parent', () => {
    const internal = exposureParity.records.find((record) => record.exposureClass === 'INTERNAL_PROTOCOL');
    expect(internal).toBeDefined();
    expect(internal!.apiOperationIds).toEqual([]);
    expect(internal!.parentOperationId).toMatch(/^OP-/u);
    expect(internal!.surfaceBindings).toContainEqual(expect.objectContaining({
      bindingId: 'REST:NOT_APPLICABLE',
      status: 'NOT_APPLICABLE',
      reasonCode: 'INTERNAL_PROTOCOL_NO_PUBLIC_ROUTE'
    }));
  });
});
