import { describe, expect, it } from 'vitest';
import {
  closureAstForPredicates,
  evaluateClosureAst,
  evaluateClosureRecord,
  loadClosureRecords,
  parseClosureAst,
  type ClosureDatabaseEvidence,
  type ClosureRegistryRecord
} from '../../packages/domain/src/closure-predicates.js';

const record: ClosureRegistryRecord = {
  recordId: 'CLOSURE-COMPONENT', recordKind: 'CLOSURE_PREDICATE_REGISTRY', schemaVersion: '1.0',
  authoritySourceRefs: ['ssot://55.13/closure'], sourceRelations: [], requirementIds: [], canonicalName: 'component closure',
  canonicalDigest: 'sha256:' + '0'.repeat(64), lifecycle: 'ACTIVE', supersedes: [], supersededBy: [], extensions: {},
  closurePredicateId: 'CLOSURE-COMPONENT', rootKind: 'COMPONENT', terminalStates: ['DEREGISTERED'],
  requiredChildPredicates: ['NO_ACTIVE_CONTRACT_BINDING'], forbiddenPendingChildKinds: ['LEASE'], forbiddenProvisionalKinds: ['RUNTIME'],
  leaseAndFencePredicate: 'lease_and_fence', sideEffectPredicate: 'side_effects_known', pointerAndEpochPredicate: 'pointer_and_epoch',
  runtimeProcessPredicate: 'runtime_process_closed', bindingPredicate: 'bindings_exact', queueOutboxInboxPredicate: 'queue_outbox_inbox_closed',
  artifactFilesystemPredicate: 'artifacts_filesystem_closed', cleanupPredicate: 'cleanup_complete', auditEvidencePredicate: 'audit_evidence_valid',
  manualReviewPredicate: 'manual_review_empty', directQueryIds: ['QUERY-CLOSURE-COMPONENT-DB-V1', 'QUERY-CLOSURE-COMPONENT-RUNTIME-V1', 'QUERY-CLOSURE-COMPONENT-FILESYSTEM-V1', 'QUERY-CLOSURE-COMPONENT-EXTERNAL-V1'],
  passExpression: closureAstForPredicates(), failureCode: 'TERMINAL_CLOSURE_INCOMPLETE'
};

const baseEvidence = (): ClosureDatabaseEvidence => ({
  root: { id: 'component-1', state: 'DEREGISTERED', exists: true, stateVersion: '7' },
  children: { pendingCommands: 0, provisionalChildren: 0, pendingApprovals: 0, pendingTasks: 0 },
  leases: { active: 0, stale: 0, unfenced: 0 }, effects: [],
  pointers: { mixedEpoch: 0, activePointer: 0, pendingSwitches: 0 }, bindings: { active: 0, stale: 0, unresolved: 0 },
  delivery: { pendingQueue: 0, pendingOutbox: 0, inboxGaps: 0 }, runtime: { processes: [], sockets: [], contexts: 0 },
  artifacts: [], cleanup: { incomplete: 0, liveResources: 0 }, audit: { invalidStreams: 0, missingTerminalEvent: 0 }, manualReview: { objects: 0, conflicts: 0 }
});

describe('TD-06 terminal closure direct-state oracle', () => {
  it('loads concrete production closure records with versioned direct queries', async () => {
    const records = await loadClosureRecords(process.cwd());
    // The compiled registry covers every current terminal root kind; this is
    // intentionally exact so an omitted root cannot be hidden by a subset.
    expect(records).toHaveLength(26);
    expect(new Set(records.map((item) => item.closurePredicateId)).size).toBe(26);
    for (const item of records) {
      expect(item.directQueryIds).toEqual([
        `QUERY-CLOSURE-${item.rootKind}-DB-V1`,
        `QUERY-CLOSURE-${item.rootKind}-RUNTIME-V1`,
        `QUERY-CLOSURE-${item.rootKind}-FILESYSTEM-V1`,
        `QUERY-CLOSURE-${item.rootKind}-EXTERNAL-V1`
      ]);
      expect(() => parseClosureAst(item.passExpression)).not.toThrow();
    }
  });

  it('uses a deterministic boolean AST and rejects blanket marker expressions', () => {
    const ast = closureAstForPredicates();
    expect(ast).toBe(closureAstForPredicates());
    expect(parseClosureAst(ast)).toEqual({ op: 'AND', args: expect.any(Array) });
    expect(() => parseClosureAst('AND_ALL_PREDICATES')).toThrow('CLOSURE_PASS_EXPRESSION_INVALID_JSON');
    expect(evaluateClosureAst(parseClosureAst(ast), { terminal_state: true, children_closed: true, lease_and_fence: true, side_effects_known: true, pointer_and_epoch: true, bindings_exact: true, queue_outbox_inbox_closed: true, runtime_process_closed: true, artifacts_filesystem_closed: true, cleanup_complete: true, audit_evidence_valid: true, manual_review_empty: true })).toBe(true);
  });

  it.each([
    ['active lease', (e: ClosureDatabaseEvidence) => { e.leases.active = 1; }],
    ['stale fence', (e: ClosureDatabaseEvidence) => { e.leases.stale = 1; }],
    ['unknown effect', (e: ClosureDatabaseEvidence) => { e.effects = [{ id: 'effect-1', status: 'UNKNOWN', possibleEffect: true, manualReview: true }]; }],
    ['pending outbox', (e: ClosureDatabaseEvidence) => { e.delivery.pendingOutbox = 1; }],
    ['active process', (e: ClosureDatabaseEvidence) => { e.runtime.processes = [{ id: 'process-1', pid: 999999, active: true, cgroupPath: '/kubepods/test' }]; }],
    ['live socket', (e: ClosureDatabaseEvidence) => { e.runtime.sockets = [{ id: 'socket-1', path: '/run/kcml/stale.sock', active: true }]; }],
    ['temporary artifact', (e: ClosureDatabaseEvidence) => { e.artifacts = [{ id: 'artifact-1', state: 'WRITING', tempPath: '/tmp/kcml.partial', finalPath: null, expectedDigest: 'sha256:' + '1'.repeat(64) }]; }],
    ['cleanup resource', (e: ClosureDatabaseEvidence) => { e.cleanup.liveResources = 1; }],
    ['manual review', (e: ClosureDatabaseEvidence) => { e.manualReview.objects = 1; }]
  ])('fails closed for %s', async (_name, mutate) => {
    const evidence = baseEvidence(); mutate(evidence);
    const report = await evaluateClosureRecord(record, evidence, 'component-1', {
      runtimeInventory: async (db) => ({ processes: db.runtime.processes, sockets: db.runtime.sockets, cgroups: db.runtime.processes.map((item) => ({ path: item.cgroupPath, populated: item.active })) }),
      filesystemInventory: async (db) => ({ artifacts: db.artifacts.map((item) => ({ id: item.id, path: item.tempPath, present: item.state === 'WRITING' })) })
    });
    expect(report.passed).toBe(false);
    expect(report.failureCode).toBe('TERMINAL_CLOSURE_INCOMPLETE');
    expect(report.failingPredicates.length).toBeGreaterThan(0);
  });

  it('does not infer external success from a possible-effect row without read-back', async () => {
    const evidence = baseEvidence();
    evidence.effects = [{ id: 'effect-1', status: 'CONFIRMED_APPLIED', possibleEffect: true, manualReview: false }];
    const report = await evaluateClosureRecord(record, evidence, 'component-1');
    expect(report.passed).toBe(false);
    expect(report.failingPredicates).toContain('side_effects_known');
  });
});
