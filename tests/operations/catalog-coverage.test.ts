import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadOperationCatalog, loadRegistry, validateExposureParity, type ExposureParityContract } from '../../packages/contract-pack/src/index.js';
import { operationHandlerCatalog } from '../../packages/domain/src/operation-handler-catalog.js';
import { exactMutationHandlerFor, exactQueryHandlerFor, mutationHandlerFor, queryHandlerFor } from '../../packages/domain/src/canonical-operation-handlers.js';

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

  it('binds every TD-12 operation to a named persistence handler', () => {
    const mutating = catalog.records.filter((operation) => operation.sideEffectClass !== 'READ_ONLY' && operation.exposureClass !== 'OWNER_QUERY');
    const readable = catalog.records.filter((operation) => operation.sideEffectClass === 'READ_ONLY' || operation.exposureClass === 'OWNER_QUERY');
    const exactMutations = mutating.filter((operation) => exactMutationHandlerFor(operation.operationName));
    const exactReads = readable.filter((operation) => exactQueryHandlerFor(operation.operationName));

    expect(exactMutations.length).toBeGreaterThan(150);
    expect(exactReads.length).toBeGreaterThan(25);
    for (const operation of exactMutations) {
      expect(mutationHandlerFor(operation)).toBe(exactMutationHandlerFor(operation.operationName));
    }
    for (const operation of exactReads) {
      expect(queryHandlerFor(operation)).toBe(exactQueryHandlerFor(operation.operationName));
    }
    for (const operation of mutating) {
      const exact = exactMutationHandlerFor(operation.operationName);
      const handler = mutationHandlerFor(operation);
      expect(Boolean(exact) || handler.name.length > 0).toBe(true);
    }
    for (const operation of readable) {
      const exact = exactQueryHandlerFor(operation.operationName);
      const handler = queryHandlerFor(operation);
      expect(Boolean(exact) || handler.name.length > 0).toBe(true);
    }
  });

  it('keeps TD-12 handlers concrete and free of the retired generic evidence writer', async () => {
    const source = await readFile('packages/domain/src/exact-operation-handlers.ts', 'utf8');
    expect(source).not.toMatch(/appendOperationEvidence|mutateOperationEntity|family(?:\/|_| )fallback/iu);
    expect(source.match(/async function handle[A-Z][A-Za-z0-9_]*/gu)?.length).toBeGreaterThanOrEqual(235);
    expect(source).toContain('INSERT INTO kcml.side_effect_operation');
    expect(source).toContain('SELECT * FROM kcml.append_audit_event');
  });

  it('persists an exact CAS transition and immutable audit evidence for agent.run.pause', async () => {
    const operation = catalog.records.find((candidate) => candidate.operationName === 'agent.run.pause');
    if (!operation) throw new Error('TEST_OPERATION_MISSING:agent.run.pause');
    const run = {
      id: '00000000-0000-4000-8000-000000000010',
      status: 'RUNNING',
      state_version: 7n
    };
    const updated = { ...run, status: 'PAUSED', state_version: 8n };
    const calls: string[] = [];
    const client = {
      query: async (sql: string) => {
        calls.push(sql);
        if (sql.startsWith('SELECT * FROM kcml.agent_run')) return { rows: [run] };
        if (sql.startsWith('UPDATE kcml.agent_run')) return { rows: [updated] };
        if (sql.startsWith('SELECT * FROM kcml.append_audit_event')) return { rows: [{ chain_sequence: 12n }] };
        throw new Error(`UNEXPECTED_SQL:${sql}`);
      }
    } as never;
    const handler = exactMutationHandlerFor(operation.operationName);
    if (!handler) throw new Error('EXACT_HANDLER_MISSING:agent.run.pause');
    const result = await handler(client, {
      operation,
      commandId: '00000000-0000-4000-8000-000000000011',
      targetId: run.id,
      arguments: {},
      logicalOperationId: '00000000-0000-4000-8000-000000000012',
      correlationId: '00000000-0000-4000-8000-000000000013',
      expectedStateVersion: 7n,
      activationEpoch: 4n,
      platformIncarnationId: '00000000-0000-4000-8000-000000000014',
      applicationDeploymentEpoch: 8n,
      recoveryEpoch: 2n
    });

    expect(result).toMatchObject({
      operation: 'agent.run.pause',
      aggregate: 'agent_run',
      state_version: 8n,
      evidence: { persisted: true, transition: 'RUNNING->PAUSED' }
    });
    expect(calls[1]).toMatch(/UPDATE kcml\.agent_run[\s\S]*WHERE id=\$1[\s\S]*state_version=\$3/u);
    expect(calls.at(-1)).toMatch(/^SELECT \* FROM kcml\.append_audit_event/u);
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
