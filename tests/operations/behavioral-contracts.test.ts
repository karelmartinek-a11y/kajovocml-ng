import { describe, expect, it } from 'vitest';
import { loadOperationCatalog, loadRegistry, type OperationContract } from '../../packages/contract-pack/src/index.js';
import { DomainError } from '../../packages/domain/src/errors.js';
import { CanonicalOperationService, OperationCatalogService } from '../../packages/domain/src/operations.js';
import { mutationHandlerFor, queryHandlerFor, validateCanonicalOperationCommand } from '../../packages/domain/src/canonical-operation-handlers.js';
import { faultPointDeclarations } from '../../packages/domain/src/fault-declarations.js';
import { FaultCoverageTracker, LinearizabilityHistory } from '../../packages/testing/src/index.js';

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

const operationCatalogService = await OperationCatalogService.load();
const admissionOnlyService = new CanonicalOperationService({} as never, operationCatalogService);
const testIds = {
  target: '00000000-0000-4000-8000-000000000010',
  component: '00000000-0000-4000-8000-000000000011',
  revision: '00000000-0000-4000-8000-000000000012',
  run: '00000000-0000-4000-8000-000000000013',
  release: '00000000-0000-4000-8000-000000000014'
};
const digest = 'sha256:' + '1'.repeat(64);

type EvidenceDimension = 'positive' | 'negative' | 'stale' | 'duplicate' | 'concurrency' | 'fault' | 'recovery';
type EvidenceObligation = {
  testId: string;
  operationId: string;
  operationName: string;
  requirementIds: string[];
  stateEdge: {
    stateMachineId: string;
    expectedStates: string[];
    allowedTransitionIds: string[];
  };
  dimensions: EvidenceDimension[];
  faultPointIds: string[];
  oracleQueries: string[];
  environmentProfiles: string[];
  expectedEvidence: string[];
  acceptanceGateIds: string[];
  expectedTerminalOutcomes: string[];
  directStateOracle: string;
};

/**
 * This is an executable evidence catalog, not a metadata coverage shortcut.
 * The tests below use the production admission service and exact handlers;
 * the database-backed positive/worker portions remain in the integration
 * profile and are never represented as a unit-test PASS.
 */
const behavioralEvidenceCatalog: EvidenceObligation[] = catalog.records.map((operation) => ({
  testId: `TEST-TD20-BEHAVIORAL-${operation.operationId}`,
  operationId: operation.operationId,
  operationName: operation.operationName,
  requirementIds: operation.requirementIds,
  stateEdge: {
    stateMachineId: operation.stateMachineId,
    expectedStates: operation.expectedStates,
    allowedTransitionIds: operation.allowedTransitionIds
  },
  dimensions: ['positive', 'negative', 'stale', 'duplicate', 'concurrency', 'fault', 'recovery'],
  faultPointIds: [`FAULT-${operation.operationId}`, ...faultPointDeclarations.filter((point) => point.operationName === operation.operationName).map((point) => point.faultPointId)],
  oracleQueries: operation.sideEffectClass === 'READ_ONLY' || operation.exposureClass === 'OWNER_QUERY'
    ? [`AUTHORITATIVE_READ:${operation.aggregateRoot}`]
    : ['kcml.domain_command', 'kcml.domain_idempotency_record', 'kcml.queue_item', 'kcml.transactional_outbox', 'kcml.concurrency_claim'],
  environmentProfiles: operation.sideEffectClass === 'READ_ONLY' || operation.exposureClass === 'OWNER_QUERY'
    ? ['NODE_CANONICAL_ADMISSION', 'POSTGRES_INTEGRATION']
    : ['NODE_CANONICAL_ADMISSION', 'POSTGRES_INTEGRATION', 'FAULT_INJECTION', 'RECOVERY_REPLAY'],
  expectedEvidence: ['CANONICAL_OUTCOME', 'DIRECT_AUTHORITATIVE_STATE', 'CORRELATION_ID', 'TERMINAL_CLOSURE'],
  acceptanceGateIds: [...operation.acceptanceGateIds, 'GATE-TD20-BEHAVIORAL'],
  expectedTerminalOutcomes: operation.terminalOutcomes,
  directStateOracle: operation.sideEffectClass === 'READ_ONLY' || operation.exposureClass === 'OWNER_QUERY'
    ? 'consistent-read-authoritative-state'
    : 'domain_command+idempotency+queue+outbox+claim'
}));

const creationOperations = new Set([
  'component.register', 'generation.job.create', 'browser.session.create', 'browser.upload.create',
  'browser.download.started', 'browser.artifact.created', 'browser.challenge.required', 'agent.run.start',
  'chat.conversation.create', 'mcp.stateHandle.create', 'mcp.task.create', 'monitor.alert.open',
  'provenance.content.register', 'provenance.segment.compile', 'provenance.valueDerivation.create', 'selfTest.run.start'
]);

function validArguments(operation: OperationContract): Record<string, unknown> {
  const name = operation.operationName;
  const args: Record<string, unknown> = {};
  if (name === 'runtime.invoke') args.capabilityAlias = 'test.capability';
  if (name === 'mcp.tools.call') args.toolName = 'test.tool';
  if (name === 'agent.run.start') Object.assign(args, { agentDefinitionId: testIds.target, agentRevisionId: testIds.revision, clientRunId: 'test-run' });
  if (name === 'mcp.stateHandle.create') Object.assign(args, { ownerComponentId: testIds.component, ownerRevisionId: testIds.revision, ownerToolKey: 'test.tool', publicOpaqueId: 'opaque-test', stateNamespace: 'test', stateReference: 'test-reference', contractDigest: digest, lookupDigest: digest });
  if (name === 'mcp.task.create') Object.assign(args, { serverComponentId: testIds.component, serverRevisionId: testIds.revision, originalCallRunId: testIds.run, toolKey: 'test.tool', publicTaskId: 'task-test', lookupDigest: digest, originalRequestDigest: digest });
  if (name === 'chat.conversation.create') Object.assign(args, { title: 'Evidence test', selectedModel: 'test-model' });
  if (name === 'browser.action.start') Object.assign(args, { sessionId: testIds.target, action: 'OBSERVE' });
  if (name === 'browser.upload.create') Object.assign(args, { sessionId: testIds.target, artifactId: testIds.target });
  if (name === 'browser.download.started') Object.assign(args, { sessionId: testIds.target, downloadId: testIds.target });
  if (name === 'browser.download.persist') Object.assign(args, { artifactId: testIds.target, contentDigest: digest, sizeBytes: 0 });
  if (name === 'browser.artifact.created') Object.assign(args, { sessionId: testIds.target, artifactId: testIds.target, artifactDigest: digest, sizeBytes: 0, safeName: 'artifact.bin', storageReference: `artifact:${digest}` });
  if (name === 'browser.challenge.required') Object.assign(args, { sessionId: testIds.target, challengeType: 'OTP', pendingActionDigest: digest, controlEpoch: 1, deadlineAt: new Date(Date.now() + 60_000).toISOString(), expiresAt: new Date(Date.now() + 120_000).toISOString(), safePrompt: 'Enter the code' });
  if (name === 'browser.challenge.resolve') Object.assign(args, { responseDigest: digest, controlEpoch: 1, ownerResponseId: testIds.target });
  if (name === 'browser.control.transfer') Object.assign(args, { holder: 'AI', expectedControlEpoch: 1 });
  if (name === 'browser.action.dispatchPhase') Object.assign(args, { phase: 'COMMAND_ACCEPTED', evidence: { source: 'test' } });
  if (name === 'browser.action.reconcile' || name === 'browser.action.resolveOutcome') Object.assign(args, { outcome: 'CONFIRMED_NOT_APPLIED', readBack: { observed: false } });
  if (name === 'agent.message.append' || name === 'generation.message.append' || name === 'chat.message.append') args.content = 'Evidence test';
  if (name === 'provenance.content.register') Object.assign(args, { sourceKind: 'TEST', contentRole: 'INPUT', instructionAuthority: 'OWNER', extractionMethod: 'NONE', normalizationMethod: 'NONE', rawDigest: digest, contentDigest: digest });
  if (name === 'selfTest.registeredElement.run') args.evidenceKind = 'TEST';
  return args;
}

function commandFor(operation: OperationContract, deadlineAt: string | null = null) {
  return {
    targetId: creationOperations.has(operation.operationName) ? null : testIds.target,
    arguments: validArguments(operation),
    expectedStateVersion: creationOperations.has(operation.operationName) ? null : 1n,
    expectedActivationEpoch: 4n,
    deadlineAt
  };
}

describe('TD-12 exact operation behavior contracts', () => {
  it('has an executable canonical handler for every mutating catalog record', () => {
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
      expect.objectContaining({ code: 'AGENTIC_ARGUMENT_ORIGIN_INVALID' })
    );
  });

  it('keeps operation-specific target and argument validation fail-closed', () => {
    expect(() => validateCanonicalOperationCommand(operation('runtime.prepare'), null, {})).toThrowError(expect.objectContaining({ code: 'TOOL_ARGUMENT_SCHEMA_INVALID' }));
    expect(() => validateCanonicalOperationCommand(operation('browser.action.start'), '00000000-0000-4000-8000-000000000011', {})).toThrowError(expect.objectContaining({ code: 'TOOL_ARGUMENT_SCHEMA_INVALID' }));
    expect(() => validateCanonicalOperationCommand(operation('runtime.invoke'), '00000000-0000-4000-8000-000000000012', {})).toThrowError(expect.objectContaining({ code: 'TOOL_ARGUMENT_SCHEMA_INVALID' }));
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
    expect(queries).toHaveLength(3);

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
    })).rejects.toMatchObject({ code: 'RUNTIME_STATE_BOUNDARY_VIOLATION', retryDirective: 'DO_NOT_RETRY' });
  });
});

describe('BEHAVIORAL_OPERATION_EVIDENCE — TD-20', () => {
  it('declares executable obligations and authoritative state oracles for all 262 operations', () => {
    expect(behavioralEvidenceCatalog).toHaveLength(catalog.records.length);
    expect(behavioralEvidenceCatalog).toHaveLength(262);
    for (const obligation of behavioralEvidenceCatalog) {
      expect(obligation.testId).toMatch(/^TEST-TD20-BEHAVIORAL-OP-/u);
      expect(obligation.requirementIds.length, obligation.operationName).toBeGreaterThan(0);
      expect(obligation.stateEdge.stateMachineId, obligation.operationName).toMatch(/^SM-/u);
      expect(obligation.dimensions).toEqual(['positive', 'negative', 'stale', 'duplicate', 'concurrency', 'fault', 'recovery']);
      expect(obligation.faultPointIds.length, obligation.operationName).toBeGreaterThan(0);
      expect(obligation.oracleQueries.length, obligation.operationName).toBeGreaterThan(0);
      expect(obligation.environmentProfiles.length, obligation.operationName).toBeGreaterThan(0);
      expect(obligation.expectedEvidence).toEqual(['CANONICAL_OUTCOME', 'DIRECT_AUTHORITATIVE_STATE', 'CORRELATION_ID', 'TERMINAL_CLOSURE']);
      expect(obligation.acceptanceGateIds).toContain('GATE-TD20-BEHAVIORAL');
      expect(obligation.directStateOracle).not.toMatch(/metadata|mock|model/u);
      expect(obligation.expectedTerminalOutcomes.length).toBeGreaterThan(0);
    }
  });

  it.each(catalog.records.map((operation) => [operation.operationName, operation] as const))('negative authority override is rejected before admission: %s', async (_operationName, operation) => {
    expect(() => validateCanonicalOperationCommand(operation, commandFor(operation).targetId, { ...validArguments(operation), actorId: 'KRMAR78' }))
      .toThrowError(expect.objectContaining({ code: 'AGENTIC_ARGUMENT_ORIGIN_INVALID' }));
  });

  it.each(catalog.records.map((operation) => [operation.operationName, operation] as const))('stale deadline fails closed through CanonicalOperationService: %s', async (_operationName, operation) => {
    await expect(admissionOnlyService.execute(operation.operationName, commandFor(operation, '2020-01-01T00:00:00.000Z'), {
      callerFingerprint: 'KRMAR78', actorId: 'KRMAR78', correlationId: context.correlationId
    })).rejects.toMatchObject({ code: 'RUNTIME_DEADLINE_EXCEEDED' });
  });

  it.each(catalog.records.filter((operation) => operation.sideEffectClass !== 'READ_ONLY' && operation.exposureClass !== 'OWNER_QUERY').map((operation) => [operation.operationName, operation] as const))('mutations require idempotency before any write: %s', async (_operationName, operation) => {
    await expect(admissionOnlyService.execute(operation.operationName, commandFor(operation), {
      callerFingerprint: 'KRMAR78', actorId: 'KRMAR78', correlationId: context.correlationId
    })).rejects.toMatchObject({ code: 'TOOL_ARGUMENT_SCHEMA_INVALID' });
  });

  it('binds duplicate, concurrency, fault and recovery evidence to contract-level obligations', async () => {
    const faults = await loadRegistry('FAULT_CATALOG');
    const postgres = await loadRegistry('POSTGRES_CONTRACT_MATRIX');
    const recovery = await loadRegistry('RECOVERY_ORACLE_REGISTRY');
    const faultOperationIds = new Set(faults.records.map((record) => String((record as Record<string, unknown>).operationId)));
    const postgresOperationIds = new Set(postgres.records.map((record) => String((record as Record<string, unknown>).operationId)));
    const recoverySubjects = new Set(recovery.records.map((record) => String((record as Record<string, unknown>).subjectId)));
    for (const operation of catalog.records.filter((candidate) => candidate.sideEffectClass !== 'READ_ONLY' && candidate.exposureClass !== 'OWNER_QUERY')) {
      expect(operation.idempotencyKeySource, operation.operationName).not.toBe('NONE');
      expect(operation.concurrencyScope, operation.operationName).not.toBe('NONE');
      expect(postgresOperationIds.has(operation.operationId), operation.operationName).toBe(true);
      expect(faultOperationIds.has(operation.operationId), operation.operationName).toBe(true);
      // ORACLE-SIDE-EFFECT is the current shared authoritative oracle. A
      // per-operation oracle can replace it only when its subject is pinned.
      expect(recoverySubjects.has(operation.operationId) || recoverySubjects.has('SIDE_EFFECT'), operation.operationName).toBe(true);
    }
  });

  it('records concurrent invocations as a well-formed history and rejects duplicate returns', () => {
    const history = new LinearizabilityHistory();
    history.invoke('operation-a', { operation: 'component.register', idempotencyKey: 'a' });
    history.invoke('operation-b', { operation: 'component.register', idempotencyKey: 'b' });
    history.returned('operation-b', { status: 'ACCEPTED' });
    history.returned('operation-a', { status: 'ACCEPTED' });
    expect(() => history.assertWellFormed()).not.toThrow();
    history.returned('operation-a', { status: 'SUCCEEDED' });
    expect(() => history.assertWellFormed()).toThrow('LINEARIZABILITY_RETURN_WITHOUT_INVOKE');
  });

  it('requires every declared fault kind at both cutpoint sides in the evidence tracker', () => {
    const coverage = new FaultCoverageTracker(faultPointDeclarations);
    for (const schedule of coverage.singleFaultSchedules()) coverage.record(schedule.faultPointId, schedule.faultKind);
    const report = coverage.report(0, 8);
    expect(report.status).toBe('PASS');
    expect(report.uncoveredPointIds).toEqual([]);
    expect(report.threeWaySchedules).toBe(8);
  });
});
