import { describe, expect, it } from 'vitest';
import {
  RECOVERY_ORACLE_PREDICATES,
  RecoveryActionExecutor,
  RecoveryOracleRegistry,
  evaluateRecoveryOracle,
  validateRecoveryOracleCoverage,
  type RecoveryEvidence,
  type RecoveryOracleRecord
} from '../../packages/domain/src/recovery-oracle.js';
import { loadOperationCatalog } from '../../packages/contract-pack/src/index.js';

const baseEvidence = (): RecoveryEvidence => ({
  root: { state: 'RUNNING', version: 4n, terminalOutcome: null },
  idempotency: { keyDigest: 'sha256:key', requestDigest: 'sha256:req', terminalOutcomeDigest: null },
  lineage: { platformIncarnationId: 'platform-1', applicationDeploymentEpoch: 8n, recoveryEpoch: 2n, fencingToken: 9n, fenceCurrent: true },
  checkpoint: { present: false, lineageCurrent: false, state: null },
  dispatch: { intentRecorded: false, outboxCommitted: false, claimCurrent: true, sendPhase: 'NOT_STARTED', targetIdempotencyKey: null },
  external: { readBack: 'NOT_AVAILABLE', providerResponseId: null, browserPostcondition: null },
  cleanup: { required: false, complete: true, inventoryDigest: null },
  pointerRuntime: { pointerInventoryDigest: 'sha256:pointer', runtimeInventoryDigest: 'sha256:runtime' }
});

const record = (): RecoveryOracleRecord => ({
  recoveryOracleId: 'ORACLE-TEST', subjectId: 'OP-TEST', observedAuthoritativeStateSchema: 'RECOVERY_EVIDENCE_V1',
  requiredEvidence: ['root state/version', 'idempotency record', 'lease/fence/incarnation/deployment/recovery epoch', 'checkpoint lineage', 'dispatch intent/outbox/claim', 'adapter send phase', 'target idempotency handle', 'external read-back', 'provider response/task ID', 'browser mutation phase/postcondition', 'pointer/runtime effective inventory', 'cleanup inventory'],
  forbiddenEvidenceAssumptions: ['PROCESS_MEMORY', 'MISSING_LOG', 'TIMEOUT_TEXT', 'HTTP_STATUS', 'TRANSPORT_DISCONNECT', 'PROCESS_DEATH', 'EXCEPTION_TEXT'],
  rules: RECOVERY_ORACLE_PREDICATES.map((predicate, index) => ({
    priority: (index + 1) * 10, ruleId: `TEST:${predicate}`, predicate,
    allowedAction: predicate === 'TERMINAL_OUTCOME_KNOWN' ? 'REPLAY_TERMINAL' : predicate === 'CHECKPOINT_RESUMABLE_BEFORE_DISPATCH' ? 'RESUME_FROM_CHECKPOINT' : predicate === 'CANCELABLE_BEFORE_DISPATCH' ? 'CANCEL_BEFORE_DISPATCH' : predicate === 'CONFIRMED_NOT_APPLIED' ? 'RETRY_SAME_OPERATION' : predicate === 'CONFIRMED_APPLIED' ? 'RECONCILE' : predicate === 'CLEANUP_PENDING' ? 'RUN_CLEANUP' : predicate === 'COMPENSATION_REQUIRED' ? 'RUN_COMPENSATION' : 'RECONCILE',
    canonicalOutcome: predicate === 'TERMINAL_OUTCOME_KNOWN' ? 'TERMINAL_REPLAY' : predicate === 'CHECKPOINT_RESUMABLE_BEFORE_DISPATCH' ? 'RESUMED' : predicate === 'CANCELABLE_BEFORE_DISPATCH' ? 'CANCELLED_BEFORE_DISPATCH' : predicate === 'CONFIRMED_NOT_APPLIED' ? 'CONFIRMED_NOT_APPLIED' : predicate === 'CONFIRMED_APPLIED' ? 'CONFIRMED_APPLIED' : predicate === 'CLEANUP_PENDING' ? 'CLEANUP_REQUIRED' : predicate === 'COMPENSATION_REQUIRED' ? 'COMPENSATION_REQUIRED' : 'UNKNOWN',
    retryDirective: predicate === 'CANCELABLE_BEFORE_DISPATCH' || predicate === 'COMPENSATION_REQUIRED' || predicate === 'RECONCILIATION_REQUIRED' ? 'MANUAL_REVIEW' : predicate === 'CONFIRMED_APPLIED' ? 'RECONCILE_THEN_RETRY' : predicate === 'TERMINAL_OUTCOME_KNOWN' || predicate === 'CHECKPOINT_RESUMABLE_BEFORE_DISPATCH' || predicate === 'CONFIRMED_NOT_APPLIED' ? 'RETRY_SAME_OPERATION' : 'RETRY_SAME_OPERATION',
    stateTransitionId: `TEST:${predicate}`, requiredFencingGuards: ['CURRENT_RECOVERY_EPOCH', 'CURRENT_FENCE'], evidenceToPersist: ['ROOT_SNAPSHOT', 'DISPATCH_SNAPSHOT'], canonicalOperationName: 'component.register'
  })),
  defaultOutcome: 'MANUAL_REVIEW', manualReviewSchemaRef: 'contracts/registry-schemas/operation-command.schema.json',
  conflictingOperationBlockKeys: ['ACCOUNT', 'RESOURCE'], closurePredicateId: 'CLOSURE-TEST', testCaseIds: ['TEST-TD16-RECOVERY-ORACLE-TOTALITY', 'TEST-TD16-RECOVERY-ORACLE-MUTATION'], requirementIds: [], authoritySourceRefs: ['ssot://54.12/54-12-recovery-oracle/atom-1']
});

describe('TD-16 operation/state-machine recovery oracle', () => {
  it('loads operation/state-machine records from the generated Contract Pack', async () => {
    const registry = await RecoveryOracleRegistry.load();
    const catalog = await loadOperationCatalog();
    expect(registry.records().length).toBeGreaterThanOrEqual(282);
    expect(registry.get('ORACLE-OP-AGENT-RUN-CANCEL').rules).toHaveLength(8);
    expect(registry.get('ORACLE-SM-SIDE_EFFECT').closurePredicateId).toBe('CLOSURE-SIDE_EFFECT');
    for (const operation of catalog.records) expect(registry.get(operation.reconciliationOracleId as string).subjectId).toBe(operation.operationId);
  });

  it('TEST-TD16-RECOVERY-ORACLE-TOTALITY covers every predicate and fails closed', () => {
    const oracle = record();
    expect(() => validateRecoveryOracleCoverage(oracle)).not.toThrow();
    const unknown = evaluateRecoveryOracle(oracle, baseEvidence());
    expect(unknown).toMatchObject({ action: 'MANUAL_REVIEW', canonicalOutcome: 'UNKNOWN', retryDirective: 'MANUAL_REVIEW' });

    const terminal = baseEvidence(); terminal.root = { state: 'COMPLETED', version: 5n, terminalOutcome: 'CONFIRMED_APPLIED' }; terminal.idempotency.terminalOutcomeDigest = 'sha256:terminal';
    expect(evaluateRecoveryOracle(oracle, terminal).action).toBe('REPLAY_TERMINAL');
    terminal.dispatch = { intentRecorded: true, outboxCommitted: true, claimCurrent: true, sendPhase: 'REQUEST_BYTES_SENT', targetIdempotencyKey: null }; terminal.external.readBack = 'APPLIED';
    expect(evaluateRecoveryOracle(oracle, terminal).action).toBe('REPLAY_TERMINAL');
    const checkpoint = baseEvidence(); checkpoint.checkpoint = { present: true, lineageCurrent: true, state: 'APPLIED' };
    expect(evaluateRecoveryOracle(oracle, checkpoint).action).toBe('RESUME_FROM_CHECKPOINT');
    const cancel = baseEvidence(); cancel.root.state = 'CANCEL_REQUESTED';
    expect(evaluateRecoveryOracle(oracle, cancel).action).toBe('CANCEL_BEFORE_DISPATCH');
    const notApplied = baseEvidence(); notApplied.dispatch = { intentRecorded: true, outboxCommitted: true, claimCurrent: true, sendPhase: 'PREPARED', targetIdempotencyKey: 'target-1' }; notApplied.external.readBack = 'NOT_APPLIED';
    expect(evaluateRecoveryOracle(oracle, notApplied).action).toBe('RETRY_SAME_OPERATION');
    const applied = baseEvidence(); applied.dispatch = { intentRecorded: true, outboxCommitted: true, claimCurrent: true, sendPhase: 'REQUEST_BYTES_SENT', targetIdempotencyKey: null }; applied.external.readBack = 'APPLIED';
    expect(evaluateRecoveryOracle(oracle, applied).canonicalOutcome).toBe('CONFIRMED_APPLIED');
    const compensation = baseEvidence(); compensation.root.state = 'ROLLING_BACK'; compensation.external.readBack = 'APPLIED';
    expect(evaluateRecoveryOracle(oracle, compensation).action).toBe('RUN_COMPENSATION');
    const cleanup = baseEvidence(); cleanup.cleanup = { required: true, complete: false, inventoryDigest: 'sha256:cleanup' };
    expect(evaluateRecoveryOracle(oracle, cleanup).action).toBe('RUN_CLEANUP');
    cleanup.dispatch = { intentRecorded: true, outboxCommitted: true, claimCurrent: true, sendPhase: 'REQUEST_BYTES_SENT', targetIdempotencyKey: null };
    expect(evaluateRecoveryOracle(oracle, cleanup).action).toBe('RUN_CLEANUP');
    const reconcile = baseEvidence(); reconcile.dispatch = { intentRecorded: true, outboxCommitted: true, claimCurrent: true, sendPhase: 'REQUEST_BYTES_SENT', targetIdempotencyKey: null }; reconcile.external.readBack = 'UNKNOWN';
    expect(evaluateRecoveryOracle(oracle, reconcile).action).toBe('RECONCILE');
  });

  it('TEST-TD16-RECOVERY-ORACLE-MUTATION catches conflicting rules and forbidden evidence', () => {
    const oracle = record();
    oracle.rules = [
      { ...oracle.rules[4]!, priority: 40, allowedAction: 'RECONCILE' },
      { ...oracle.rules[4]!, priority: 50, allowedAction: 'RETRY_SAME_OPERATION' },
      ...oracle.rules.filter((_rule, index) => index !== 4)
    ];
    const applied = baseEvidence(); applied.dispatch = { intentRecorded: true, outboxCommitted: true, claimCurrent: true, sendPhase: 'REQUEST_BYTES_SENT', targetIdempotencyKey: null }; applied.external.readBack = 'APPLIED';
    expect(() => evaluateRecoveryOracle(oracle, applied)).toThrowError(expect.objectContaining({ code: 'RECOVERY_ORACLE_CONFLICT' }));
    const mutated = baseEvidence(); mutated.untrusted = { missingLog: 'no log' };
    expect(() => evaluateRecoveryOracle(record(), mutated)).toThrowError(expect.objectContaining({ code: 'RECOVERY_ORACLE_CONFLICT' }));
    const stale = baseEvidence(); stale.lineage.fenceCurrent = false;
    expect(() => evaluateRecoveryOracle(record(), stale)).toThrowError(expect.objectContaining({ code: 'FENCING_TOKEN_STALE' }));
  });

  it('executes an automatic decision through canonical operation with a fresh fence', async () => {
    const calls: unknown[] = [];
    const service = { execute: async (...args: unknown[]) => { calls.push(args); return {} as never; } };
    const executor = new RecoveryActionExecutor(service, async () => ({ recoveryEpoch: 3n, fencingToken: 11n }));
    const evidence = baseEvidence(); evidence.dispatch = { intentRecorded: true, outboxCommitted: true, claimCurrent: true, sendPhase: 'PREPARED', targetIdempotencyKey: 'target-1' }; evidence.external.readBack = 'NOT_APPLIED';
    const decision = evaluateRecoveryOracle(record(), evidence);
    await executor.execute(decision, 'component.register', null, { stableKey: 'recovery' }, { callerFingerprint: 'recovery-worker', actorId: 'KRMAR78', correlationId: '00000000-0000-4000-8000-000000000001', idempotencyKey: 'recovery-1' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(expect.arrayContaining(['component.register', expect.objectContaining({ arguments: expect.objectContaining({ recoveryAction: 'RETRY_SAME_OPERATION', freshRecoveryEpoch: '3', freshFencingToken: '11' }) })]));
    expect(calls[0]).toEqual(expect.arrayContaining([expect.anything(), expect.anything(), expect.objectContaining({ recoveryFence: { recoveryEpoch: 3n, fencingToken: 11n } })]));
  });
});
