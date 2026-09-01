import { describe, expect, it } from 'vitest';
import { loadOperationCatalog } from '../../packages/contract-pack/src/index.js';
import { contractFor } from '../../scripts/lib/postgres-operation-contract.mjs';

const catalog = await loadOperationCatalog();

describe('POSTGRES_CONTRACT_MATRIX per-operation derivation', () => {
  it('covers every catalog operation with a physical root anchor', () => {
    const contracts = catalog.records.map((operation) => contractFor(operation));
    expect(contracts).toHaveLength(catalog.records.length);
    expect(contracts.every((contract) => contract.physicalSchemaAnchors.length > 0)).toBe(true);
    expect(new Set(contracts.map((contract) => contract.contractDerivation.operationName)).size).toBe(catalog.records.length);
  });

  it('uses a read profile without mutation claims for read-only operations', () => {
    const read = contractFor(catalog.records.find((operation) => operation.operationName === 'component.state.query')!);
    expect(read).toMatchObject({
      transactionProfileId: 'CONSISTENT_READ',
      transactionSegments: ['R'],
      orderedAdvisoryLocks: [],
      orderedRowLocks: [],
      stateVersionCas: false,
      externalEffectSplit: 'READ_ONLY_NO_SIDE_EFFECT'
    });
  });

  it('gives external operations a fresh D claim and two outcome segments', () => {
    const external = contractFor(catalog.records.find((operation) => operation.operationName === 'mcp.tools.call')!);
    expect(external).toMatchObject({
      transactionSegments: ['T1', 'D', 'T2', 'T3'],
      externalEffectSplit: 'T1_D_E_T2_T3',
      outboxWrites: ['DOMAIN_EVENT', 'SIDE_EFFECT_DISPATCH'],
      deferredConstraintTriggers: ['TERMINAL_CLOSURE', 'SIDE_EFFECT_AUTHORITY_CONSISTENCY']
    });
  });

  it('does not emit one blanket lock/constraint record for unrelated roots', () => {
    const component = contractFor(catalog.records.find((operation) => operation.operationName === 'component.enable')!);
    const generation = contractFor(catalog.records.find((operation) => operation.operationName === 'generation.job.create')!);
    expect(component.orderedRowLocks).not.toEqual(generation.orderedRowLocks);
    expect(component.physicalSchemaAnchors).not.toEqual(generation.physicalSchemaAnchors);
  });
});
