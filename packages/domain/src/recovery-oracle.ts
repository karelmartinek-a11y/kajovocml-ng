import { canonicalDigest, type CanonicalJsonValue, type OperationResult, type RetryDirective } from '@kcml/schemas';
import { loadRegistry } from '@kcml/contract-pack';
import { DomainError } from './errors.js';

/** The only actions an oracle may authorize.  An evaluator never performs one. */
export const RECOVERY_ACTIONS = [
  'REPLAY_TERMINAL',
  'RESUME_FROM_CHECKPOINT',
  'RETRY_SAME_OPERATION',
  'RECONCILE',
  'CANCEL_BEFORE_DISPATCH',
  'RUN_COMPENSATION',
  'RUN_CLEANUP',
  'MANUAL_REVIEW'
] as const;
export type RecoveryAction = typeof RECOVERY_ACTIONS[number];

export type RecoveryCanonicalOutcome =
  | 'TERMINAL_REPLAY'
  | 'RESUMED'
  | 'CONFIRMED_APPLIED'
  | 'CONFIRMED_NOT_APPLIED'
  | 'CANCELLED_BEFORE_DISPATCH'
  | 'COMPENSATION_REQUIRED'
  | 'CLEANUP_REQUIRED'
  | 'UNKNOWN';

export interface RecoveryRule {
  priority: number;
  ruleId: string;
  /** Stable predicate ID; the implementation below is the executable predicate. */
  predicate: string;
  allowedAction: RecoveryAction;
  canonicalOutcome: RecoveryCanonicalOutcome;
  retryDirective: RetryDirective;
  stateTransitionId: string;
  requiredFencingGuards: string[];
  evidenceToPersist: string[];
  canonicalOperationName?: string;
}

export interface RecoveryOracleRecord {
  recoveryOracleId: string;
  subjectId: string;
  observedAuthoritativeStateSchema: string;
  requiredEvidence: string[];
  forbiddenEvidenceAssumptions: string[];
  rules: RecoveryRule[];
  defaultOutcome: RecoveryCanonicalOutcome | 'MANUAL_REVIEW';
  manualReviewSchemaRef: string;
  conflictingOperationBlockKeys: string[];
  closurePredicateId: string;
  testCaseIds: string[];
  requirementIds: string[];
  authoritySourceRefs: string[];
}

export interface RecoveryEvidence {
  root: {
    state: string;
    version: bigint | number | string;
    terminalOutcome?: RecoveryCanonicalOutcome | null;
  };
  idempotency: {
    keyDigest: string;
    requestDigest: string;
    terminalOutcomeDigest?: string | null;
  };
  lineage: {
    platformIncarnationId: string;
    applicationDeploymentEpoch: bigint | number | string;
    recoveryEpoch: bigint | number | string;
    fencingToken: bigint | number | string;
    fenceCurrent: boolean;
  };
  checkpoint: {
    present: boolean;
    lineageCurrent: boolean;
    state?: string | null;
  };
  dispatch: {
    intentRecorded: boolean;
    outboxCommitted: boolean;
    claimCurrent: boolean;
    sendPhase: 'NOT_STARTED' | 'PREPARED' | 'DNS_RESOLVED' | 'CONNECTED' | 'TLS_ESTABLISHED' | 'REQUEST_HEADERS_STARTED' | 'REQUEST_BODY_STARTED' | 'REQUEST_BODY_COMPLETED' | 'REQUEST_BYTES_SENT' | 'RESPONSE_HEADERS_RECEIVED' | 'RESPONSE_BODY_COMPLETED' | 'RESPONSE_RECEIVED' | 'READBACK_COMPLETED' | null;
    targetIdempotencyKey?: string | null;
  };
  external: {
    readBack: 'APPLIED' | 'NOT_APPLIED' | 'UNKNOWN' | 'NOT_AVAILABLE';
    providerResponseId?: string | null;
    browserPostcondition?: 'APPLIED' | 'NOT_APPLIED' | 'UNKNOWN' | null;
  };
  cleanup: {
    required: boolean;
    complete: boolean;
    inventoryDigest?: string | null;
  };
  pointerRuntime: {
    pointerInventoryDigest: string;
    runtimeInventoryDigest: string;
  };
  /** Explicitly rejected inputs make accidental log/exception decisions testable. */
  untrusted?: {
    processMemory?: unknown;
    missingLog?: unknown;
    timeout?: unknown;
    transportDisconnect?: unknown;
    processDeath?: unknown;
    exceptionText?: unknown;
  };
}

export interface RecoveryDecision {
  recoveryOracleId: string;
  ruleId: string;
  action: RecoveryAction;
  canonicalOutcome: RecoveryCanonicalOutcome;
  retryDirective: RetryDirective;
  stateTransitionId: string;
  evidenceDigest: string;
  evidenceToPersist: string[];
  blockingKeys: string[];
  canonicalOperationName?: string;
}

export class RecoveryOracleRegistry {
  readonly #records: ReadonlyMap<string, RecoveryOracleRecord>;

  public constructor(records: readonly RecoveryOracleRecord[]) {
    for (const record of records) validateRecoveryOracleCoverage(record);
    this.#records = new Map(records.map((record) => [record.recoveryOracleId, record]));
  }

  public get(recoveryOracleId: string): RecoveryOracleRecord {
    const record = this.#records.get(recoveryOracleId);
    if (!record) throw new DomainError('RECOVERY_ORACLE_NOT_FOUND', `Unknown recovery oracle ${recoveryOracleId}`, 404, 'DO_NOT_RETRY');
    return record;
  }

  public records(): readonly RecoveryOracleRecord[] { return [...this.#records.values()]; }

  public evaluate(recoveryOracleId: string, evidence: RecoveryEvidence): RecoveryDecision {
    return evaluateRecoveryOracle(this.get(recoveryOracleId), evidence);
  }

  public static async load(repositoryRoot = process.cwd()): Promise<RecoveryOracleRegistry> {
    const document = await loadRegistry('RECOVERY_ORACLE_REGISTRY', repositoryRoot);
    return new RecoveryOracleRegistry(document.records as unknown as RecoveryOracleRecord[]);
  }
}

const automaticActions = new Set<RecoveryAction>(RECOVERY_ACTIONS.filter((action) => action !== 'MANUAL_REVIEW'));
const terminalOutcomes = new Set<RecoveryCanonicalOutcome>(['TERMINAL_REPLAY', 'CONFIRMED_APPLIED', 'CONFIRMED_NOT_APPLIED', 'CANCELLED_BEFORE_DISPATCH']);
const noEffectSendPhases = new Set<NonNullable<RecoveryEvidence['dispatch']['sendPhase']>>(['NOT_STARTED', 'PREPARED', 'DNS_RESOLVED', 'CONNECTED', 'TLS_ESTABLISHED']);
const possibleEffectSendPhases = new Set<NonNullable<RecoveryEvidence['dispatch']['sendPhase']>>(['REQUEST_HEADERS_STARTED', 'REQUEST_BODY_STARTED', 'REQUEST_BODY_COMPLETED', 'REQUEST_BYTES_SENT', 'RESPONSE_HEADERS_RECEIVED', 'RESPONSE_BODY_COMPLETED', 'RESPONSE_RECEIVED', 'READBACK_COMPLETED']);

function jsonSafe(value: unknown): CanonicalJsonValue {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item)) as CanonicalJsonValue;
}

function ruleMatches(rule: RecoveryRule, evidence: RecoveryEvidence): boolean {
  const noTerminalOutcome = !evidence.root.terminalOutcome;
  switch (rule.predicate) {
    case 'TERMINAL_OUTCOME_KNOWN':
      return Boolean(evidence.root.terminalOutcome && terminalOutcomes.has(evidence.root.terminalOutcome) && evidence.idempotency.terminalOutcomeDigest && evidence.cleanup.complete);
    case 'CHECKPOINT_RESUMABLE_BEFORE_DISPATCH':
      return noTerminalOutcome && evidence.checkpoint.present && evidence.checkpoint.lineageCurrent && evidence.root.state !== 'CANCEL_REQUESTED' && !evidence.dispatch.intentRecorded && evidence.dispatch.sendPhase === 'NOT_STARTED' && evidence.dispatch.claimCurrent && evidence.lineage.fenceCurrent;
    case 'CANCELABLE_BEFORE_DISPATCH':
      return noTerminalOutcome && !evidence.dispatch.intentRecorded && evidence.dispatch.sendPhase === 'NOT_STARTED' && evidence.dispatch.claimCurrent && evidence.root.state === 'CANCEL_REQUESTED';
    case 'CONFIRMED_NOT_APPLIED':
      return noTerminalOutcome && evidence.dispatch.intentRecorded && evidence.dispatch.outboxCommitted && evidence.dispatch.claimCurrent && noEffectSendPhases.has(evidence.dispatch.sendPhase as NonNullable<RecoveryEvidence['dispatch']['sendPhase']>) && evidence.external.readBack === 'NOT_APPLIED' && Boolean(evidence.dispatch.targetIdempotencyKey);
    case 'CONFIRMED_APPLIED':
      return noTerminalOutcome && evidence.dispatch.intentRecorded && evidence.dispatch.outboxCommitted && evidence.dispatch.claimCurrent && evidence.root.state !== 'ROLLING_BACK' && (evidence.external.readBack === 'APPLIED' || evidence.external.browserPostcondition === 'APPLIED');
    case 'CLEANUP_PENDING':
      return noTerminalOutcome && evidence.cleanup.required && !evidence.cleanup.complete && evidence.dispatch.claimCurrent && evidence.external.readBack !== 'UNKNOWN' && !['APPLIED', 'NOT_APPLIED'].includes(evidence.external.readBack);
    case 'COMPENSATION_REQUIRED':
      return noTerminalOutcome && evidence.external.readBack === 'APPLIED' && evidence.dispatch.claimCurrent && evidence.root.state === 'ROLLING_BACK';
    case 'RECONCILIATION_REQUIRED':
      return noTerminalOutcome && evidence.dispatch.intentRecorded && evidence.dispatch.claimCurrent && (!evidence.cleanup.required || evidence.cleanup.complete) && evidence.external.readBack !== 'APPLIED' && evidence.external.readBack !== 'NOT_APPLIED' && (possibleEffectSendPhases.has(evidence.dispatch.sendPhase as NonNullable<RecoveryEvidence['dispatch']['sendPhase']>) || evidence.external.readBack === 'UNKNOWN' || evidence.external.browserPostcondition === 'UNKNOWN');
    default:
      return false;
  }
}

function assertEvidenceShape(evidence: RecoveryEvidence): void {
  if (!evidence.root || evidence.root.version === undefined || !evidence.idempotency || !evidence.lineage || !evidence.dispatch || !evidence.external || !evidence.cleanup || !evidence.pointerRuntime) {
    throw new DomainError('RECOVERY_EVIDENCE_INCOMPLETE', 'Recovery requires the complete persisted evidence contract', 409, 'MANUAL_REVIEW');
  }
  if (evidence.untrusted && Object.values(evidence.untrusted).some((value) => value !== undefined)) {
    throw new DomainError('RECOVERY_UNTRUSTED_EVIDENCE', 'Process memory, logs, transport failures and exception text are not authoritative recovery evidence', 409, 'MANUAL_REVIEW');
  }
  if (!evidence.lineage.fenceCurrent) {
    throw new DomainError('RECOVERY_FENCE_LOST', 'Recovery evidence is stale and cannot authorize a mutation', 409, 'RECONCILE_THEN_RETRY');
  }
}

function validateRules(record: RecoveryOracleRecord): void {
  if (record.defaultOutcome !== 'MANUAL_REVIEW') {
    throw new DomainError('RECOVERY_ORACLE_SCHEMA_INVALID', 'Oracle default must fail closed to MANUAL_REVIEW', 500, 'DO_NOT_RETRY');
  }
  const priorities = new Set<number>();
  for (const rule of record.rules) {
    if (priorities.has(rule.priority)) throw new DomainError('RECOVERY_ORACLE_CONFLICT', `Duplicate oracle priority ${rule.priority}`, 500, 'MANUAL_REVIEW');
    priorities.add(rule.priority);
    if (!RECOVERY_ORACLE_PREDICATES.includes(rule.predicate as typeof RECOVERY_ORACLE_PREDICATES[number])) throw new DomainError('RECOVERY_ORACLE_SCHEMA_INVALID', `Unknown recovery predicate ${rule.predicate}`, 500, 'DO_NOT_RETRY');
    if (!automaticActions.has(rule.allowedAction) && rule.canonicalOutcome !== 'UNKNOWN') throw new DomainError('RECOVERY_ORACLE_SCHEMA_INVALID', 'Manual-review rule must have UNKNOWN outcome', 500, 'DO_NOT_RETRY');
  }
}

export function evaluateRecoveryOracle(record: RecoveryOracleRecord, evidence: RecoveryEvidence): RecoveryDecision {
  validateRules(record);
  assertEvidenceShape(evidence);
  const matches = record.rules.filter((rule) => ruleMatches(rule, evidence)).sort((left, right) => left.priority - right.priority);
  const selected = matches[0];
  if (matches.length > 1) {
    const uniqueDecisions = new Set(matches.map((rule) => `${rule.allowedAction}:${rule.canonicalOutcome}`));
    if (uniqueDecisions.size > 1) throw new DomainError('RECOVERY_ORACLE_CONFLICT', 'More than one automatic recovery action matches the observed state', 409, 'MANUAL_REVIEW', { ruleIds: matches.map((rule) => rule.ruleId) });
  }
  if (!selected) {
    return {
      recoveryOracleId: record.recoveryOracleId,
      ruleId: 'DEFAULT_MANUAL_REVIEW',
      action: 'MANUAL_REVIEW',
      canonicalOutcome: 'UNKNOWN',
      retryDirective: 'MANUAL_REVIEW',
      stateTransitionId: 'TO_MANUAL_REVIEW',
      evidenceDigest: canonicalDigest(jsonSafe(evidence)),
      evidenceToPersist: ['ROOT_SNAPSHOT', 'LINEAGE_SNAPSHOT', 'DISPATCH_SNAPSHOT', 'EXTERNAL_READ_BACK', 'CLEANUP_INVENTORY'],
      blockingKeys: record.conflictingOperationBlockKeys
    };
  }
  return {
    recoveryOracleId: record.recoveryOracleId,
    ruleId: selected.ruleId,
    action: selected.allowedAction,
    canonicalOutcome: selected.canonicalOutcome,
    retryDirective: selected.retryDirective,
    stateTransitionId: selected.stateTransitionId,
    evidenceDigest: canonicalDigest(jsonSafe(evidence)),
      evidenceToPersist: selected.evidenceToPersist,
    blockingKeys: selected.allowedAction === 'MANUAL_REVIEW' ? record.conflictingOperationBlockKeys : [],
    ...(selected.canonicalOperationName ? { canonicalOperationName: selected.canonicalOperationName } : {})
  };
}

/** Validates that the registry is executable and has no uncovered predicate. */
export function validateRecoveryOracleCoverage(record: RecoveryOracleRecord): void {
  validateRules(record);
  const predicates = new Set(record.rules.map((rule) => rule.predicate));
  const missing = RECOVERY_ORACLE_PREDICATES.filter((predicate) => !predicates.has(predicate));
  if (missing.length > 0) throw new DomainError('RECOVERY_ORACLE_COVERAGE_GAP', `Recovery oracle is missing predicates: ${missing.join(',')}`, 500, 'DO_NOT_RETRY', { missing });
  if (record.defaultOutcome !== 'MANUAL_REVIEW') throw new DomainError('RECOVERY_ORACLE_DEFAULT_NOT_FAIL_CLOSED', 'An uncovered observed state must enter UNKNOWN/MANUAL_REVIEW', 500, 'DO_NOT_RETRY');
}

export interface RecoveryFence { recoveryEpoch: bigint; fencingToken: bigint; }
export interface RecoveryActionContext {
  callerFingerprint: string;
  actorId: 'KRMAR78';
  correlationId: string;
  idempotencyKey: string;
}
export interface CanonicalRecoveryOperationService {
  execute(operationName: string, command: unknown, context: RecoveryActionContext & { recoveryFence: RecoveryFence }): Promise<OperationResult>;
}

/** Executes an oracle decision only through CanonicalOperationService. */
export class RecoveryActionExecutor {
  public constructor(
    private readonly operationService: CanonicalRecoveryOperationService,
    private readonly freshFence: () => Promise<RecoveryFence>,
  ) {}

  public async execute(decision: RecoveryDecision, operationName: string, targetId: string | null, arguments_: Record<string, unknown>, context: RecoveryActionContext): Promise<OperationResult | RecoveryDecision> {
    if (decision.action === 'MANUAL_REVIEW') return decision;
    if (decision.canonicalOperationName && operationName !== decision.canonicalOperationName) {
      throw new DomainError('RECOVERY_CANONICAL_OPERATION_MISMATCH', 'Recovery action must execute through the operation named by its oracle rule', 409, 'MANUAL_REVIEW', { expected: decision.canonicalOperationName, received: operationName });
    }
    const fence = await this.freshFence();
    return this.operationService.execute(operationName, {
      targetId,
      arguments: {
        ...arguments_,
        recoveryOracleId: decision.recoveryOracleId,
        recoveryRuleId: decision.ruleId,
        observedEvidenceDigest: decision.evidenceDigest,
        recoveryAction: decision.action,
        freshRecoveryEpoch: fence.recoveryEpoch.toString(),
        freshFencingToken: fence.fencingToken.toString()
      },
      expectedStateVersion: null,
      expectedActivationEpoch: null,
      deadlineAt: null
    }, { ...context, recoveryFence: fence });
  }
}

export const RECOVERY_ORACLE_PREDICATES = [
  'TERMINAL_OUTCOME_KNOWN',
  'CHECKPOINT_RESUMABLE_BEFORE_DISPATCH',
  'CANCELABLE_BEFORE_DISPATCH',
  'CONFIRMED_NOT_APPLIED',
  'CONFIRMED_APPLIED',
  'CLEANUP_PENDING',
  'COMPENSATION_REQUIRED',
  'RECONCILIATION_REQUIRED'
] as const;
