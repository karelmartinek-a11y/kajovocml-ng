import { describe, expect, it } from 'vitest';
import { loadOperationCatalog } from '../../packages/contract-pack/src/index.js';
import { DomainError } from '../../packages/domain/src/errors.js';
import { mutationHandlerFor, queryHandlerFor, validateCanonicalOperationCommand } from '../../packages/domain/src/canonical-operation-handlers.js';

const catalog = await loadOperationCatalog();
const byName = new Map(catalog.records.map((operation) => [operation.operationName, operation]));

function operation(name: string) {
  const result = byName.get(name);
  if (!result) throw new Error(`missing test operation ${name}`);
  return result;
}

const context = {
  logicalOperationId: '00000000-0000-4000-8000-000000000001',
  correlationId: '00000000-0000-4000-8000-000000000002',
  activationEpoch: 4n,
  platformIncarnationId: '00000000-0000-4000-8000-000000000003',
  applicationDeploymentEpoch: 8n,
  recoveryEpoch: 2n
};

describe('TD-12 exact operation behavior contracts', () => {
  it('has an executable family handler for every mutating catalog record', () => {
    const mutating = catalog.records.filter((record) => record.sideEffectClass !== 'READ_ONLY' && record.exposureClass !== 'OWNER_QUERY');
    expect(mutating).toHaveLength(220);
    for (const record of mutating) expect(() => mutationHandlerFor(record)).not.toThrow();
  });

  it('has a consistent-read handler for every non-mutating catalog record', () => {
    const readable = catalog.records.filter((record) => record.sideEffectClass === 'READ_ONLY' || record.exposureClass === 'OWNER_QUERY');
    expect(readable).toHaveLength(42);
    for (const record of readable) expect(() => queryHandlerFor(record)).not.toThrow();
  });

  it('rejects caller-owned authority fields before admission', () => {
    expect(() => validateCanonicalOperationCommand(operation('runtime.prepare'), '00000000-0000-4000-8000-000000000010', { platformIncarnationId: context.platformIncarnationId })).toThrowError(
      expect.objectContaining({ code: 'OPERATION_AUTHORITY_OVERRIDE_FORBIDDEN' })
    );
  });

  it('keeps operation-specific target and argument validation fail-closed', () => {
    expect(() => validateCanonicalOperationCommand(operation('runtime.prepare'), null, {})).toThrowError(expect.objectContaining({ code: 'OPERATION_TARGET_REQUIRED' }));
    expect(() => validateCanonicalOperationCommand(operation('browser.action.start'), '00000000-0000-4000-8000-000000000011', {})).toThrowError(expect.objectContaining({ code: 'OPERATION_ARGUMENT_REQUIRED' }));
    expect(() => validateCanonicalOperationCommand(operation('runtime.invoke'), '00000000-0000-4000-8000-000000000012', {})).toThrowError(expect.objectContaining({ code: 'OPERATION_ARGUMENT_REQUIRED' }));
  });

  it('performs a runtime transition with CAS and rejects stale recovery state', async () => {
    const runtime = {
      id: '00000000-0000-4000-8000-000000000013',
      state_version: 3n,
      effective_state: 'STOPPED',
      desired_state: 'STOPPED',
      heartbeat_sequence: 0n
    };
    const queries: string[] = [];
    const client = {
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.startsWith('SELECT')) return { rows: [runtime] };
        return { rows: [{ ...runtime, desired_state: 'STARTING', effective_state: 'STARTING', state_version: 4n }] };
      }
    } as never;
    const result = await mutationHandlerFor(operation('runtime.prepare'))(client, {
      operation: operation('runtime.prepare'),
      targetId: runtime.id,
      arguments: {},
      expectedStateVersion: 3n,
      ...context
    });
    expect(result).toMatchObject({ transition: { from: 'STOPPED', to: 'STARTING' }, state_version: 4n });
    expect(queries).toHaveLength(2);

    await expect(mutationHandlerFor(operation('runtime.prepare'))(client, {
      operation: operation('runtime.prepare'),
      targetId: runtime.id,
      arguments: {},
      expectedStateVersion: 2n,
      ...context
    })).rejects.toMatchObject({ code: 'STATE_VERSION_CONFLICT', retryDirective: 'REFRESH_AND_RETRY_NEW_COMMAND' });
  });

  it('does not turn a terminal runtime stop into a second external effect', async () => {
    const runtime = { id: '00000000-0000-4000-8000-000000000014', state_version: 5n, effective_state: 'STOPPED', desired_state: 'STOPPED', heartbeat_sequence: 1n };
    const client = { query: async (sql: string) => sql.startsWith('SELECT') ? { rows: [runtime] } : { rows: [] } } as never;
    const result = await mutationHandlerFor(operation('runtime.stop'))(client, {
      operation: operation('runtime.stop'),
      targetId: runtime.id,
      arguments: {},
      expectedStateVersion: 5n,
      ...context
    });
    expect(result).toMatchObject({ duplicate: true, state_version: 5n });
  });

  it('uses stable DomainError contracts rather than generic success for an invalid transition', async () => {
    const runtime = { id: '00000000-0000-4000-8000-000000000015', state_version: 1n, effective_state: 'READY', desired_state: 'READY', heartbeat_sequence: 1n };
    const client = { query: async (sql: string) => sql.startsWith('SELECT') ? { rows: [runtime] } : { rows: [] } } as never;
    await expect(mutationHandlerFor(operation('runtime.prepare'))(client, {
      operation: operation('runtime.prepare'),
      targetId: runtime.id,
      arguments: {},
      expectedStateVersion: 1n,
      ...context
    })).rejects.toBeInstanceOf(DomainError);
    await expect(mutationHandlerFor(operation('runtime.prepare'))(client, {
      operation: operation('runtime.prepare'),
      targetId: runtime.id,
      arguments: {},
      expectedStateVersion: 1n,
      ...context
    })).rejects.toMatchObject({ code: 'RUNTIME_STATE_INVALID', retryDirective: 'RECONCILE_THEN_RETRY' });
  });
});
