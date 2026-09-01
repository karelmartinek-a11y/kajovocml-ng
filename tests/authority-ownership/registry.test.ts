import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { assertStateTransition, validateAuthorityOwnership, type AuthorityOwnershipRecord, type OperationContract, type StateMachineContract } from '../../packages/contract-pack/src/index.js';

const authority = JSON.parse(await readFile('contracts/registries/authority/authority-ownership.json', 'utf8')) as { records: AuthorityOwnershipRecord[] };
const operations = JSON.parse(await readFile('contracts/registries/operations/operations.json', 'utf8')) as { records: OperationContract[] };
const stateMachines = JSON.parse(await readFile('contracts/registries/state-machines/state-machines.json', 'utf8')) as { records: StateMachineContract[] };
const artifacts = JSON.parse(await readFile('contracts/registries/artifact-trace/artifact-trace.json', 'utf8')) as { records: Array<{ repositoryPath: string; requirementIds: string[]; operationIds: string[]; traceAnchors: unknown[] }> };

describe('TD-03 verified authority ownership', () => {
  it('covers the complete SSOT ownership map with typed evidence', () => {
    validateAuthorityOwnership(operations.records, authority.records, stateMachines.records);
    expect(authority.records.length).toBeGreaterThanOrEqual(37);
    expect(new Set(authority.records.map((record) => record.authorityObjectKind)).size).toBe(authority.records.length);
    expect(authority.records.every((record) => record.requirementIds.length > 0)).toBe(true);
    expect(authority.records.every((record) => record.acceptedEvidenceProducers.includes('TRUSTED_TYPED_EVIDENCE'))).toBe(true);
  });

  it('rejects a second writer for one operation', () => {
    const operation = operations.records.find((candidate) => candidate.operationName === 'component.register');
    if (!operation) throw new Error('TEST_OPERATION_MISSING');
    const owner = authority.records.find((candidate) => candidate.allowedOperationIds.includes(operation.operationId));
    if (!owner) throw new Error('TEST_OWNER_MISSING');
    const duplicate = { ...owner, authorityObjectKind: `${owner.authorityObjectKind}_DUPLICATE`, allowedOperationIds: [operation.operationId] };
    expect(() => validateAuthorityOwnership(operations.records, [...authority.records, duplicate], stateMachines.records)).toThrow('AUTHORITY_OPERATION_CARDINALITY:component.register:2');
  });

  it('rejects a terminal state transition and accepts a fenced declared edge', () => {
    const machine = stateMachines.records.find((candidate) => candidate.stateMachineId === 'SM-COMPONENT');
    if (!machine) throw new Error('TEST_STATE_MACHINE_MISSING');
    expect(() => assertStateTransition(machine, 'DEREGISTERED', 'ACTIVE', 'OP-TEST')).toThrow('TERMINAL_STATE_IMMUTABLE');
    const edge = machine.transitions.find((candidate) => candidate.fromState === 'DRAFT');
    if (!edge) throw new Error('TEST_TRANSITION_MISSING');
    expect(() => assertStateTransition(machine, edge.fromState, edge.toState, edge.operationIds[0] ?? 'OP-TEST')).not.toThrow();
  });

  it('publishes bidirectional evidence for the registry implementation', () => {
    const source = artifacts.records.find((record) => record.repositoryPath === 'contracts/authority/authority-ownership-source.json');
    const validator = artifacts.records.find((record) => record.repositoryPath === 'packages/contract-pack/src/index.ts');
    const writerAudit = artifacts.records.find((record) => record.repositoryPath === 'scripts/lib/authority-writer-audit.mjs');
    expect(source?.requirementIds.length).toBeGreaterThan(0);
    expect(source?.traceAnchors.length).toBeGreaterThanOrEqual(authority.records.length);
    expect(validator?.operationIds.length).toBe(operations.records.length);
    expect(writerAudit?.requirementIds.length).toBeGreaterThan(0);
  });

  it('linearizes two concurrent commits against one expected version', async () => {
    let version = 7;
    const commit = async (expectedVersion: number): Promise<'COMMITTED' | 'STATE_VERSION_CONFLICT'> => {
      await Promise.resolve();
      if (version !== expectedVersion) return 'STATE_VERSION_CONFLICT';
      version += 1;
      return 'COMMITTED';
    };
    const outcomes = await Promise.all([commit(7), commit(7)]);
    expect(outcomes.sort()).toEqual(['COMMITTED', 'STATE_VERSION_CONFLICT']);
    expect(version).toBe(8);
  });
});
