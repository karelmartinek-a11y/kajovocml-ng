import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ErrorCode } from './error-codes.generated.js';

export const stableRetryDirectives = [
  'DO_NOT_RETRY',
  'RETRY_SAME_OPERATION',
  'REFRESH_AND_RETRY_NEW_COMMAND',
  'RECONCILE_THEN_RETRY',
  'MANUAL_REVIEW'
] as const;
export type StableRetryDirective = (typeof stableRetryDirectives)[number];

export type StableErrorClassification =
  | 'AUTHENTICATION' | 'BINDING' | 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT' | 'RATE_LIMIT'
  | 'CAPACITY' | 'TIMEOUT' | 'DEPENDENCY' | 'PROTOCOL' | 'CANCELLED' | 'MANUAL_REVIEW' | 'INTERNAL';

export type StableErrorSideEffectPoint = 'PRE_ADMISSION' | 'PRE_DISPATCH' | 'POSSIBLE_EFFECT' | 'POST_COMMIT' | 'EVIDENCE_ONLY';

export interface RecoveryDecisionRule {
  ruleId: string;
  predicate: string;
  outcome: string;
  directive: StableRetryDirective;
}

export interface RecoveryDecisionTable {
  tableId: string;
  ordering: string;
  rules: RecoveryDecisionRule[];
  defaultRule: { predicate: string; outcome: string; directive: StableRetryDirective };
  total: true;
  mutuallyExclusive: true;
}

export interface StableErrorRecord {
  [key: string]: unknown;
  recordId: string;
  recordKind: 'ERROR_RETRY_REGISTRY';
  schemaVersion: '1.0';
  authoritySourceRefs: string[];
  sourceRelations: Array<Record<string, unknown>>;
  requirementIds: string[];
  canonicalName: string;
  canonicalDigest: string;
  lifecycle: 'ACTIVE' | 'SUPERSEDED' | 'RETIRED';
  supersedes: string[];
  supersededBy: string[];
  extensions: { recoveryDecisionTable: RecoveryDecisionTable | null } & Record<string, unknown>;
  errorCodeId: string;
  code: string;
  namespace: string;
  classification: StableErrorClassification;
  canonicalMeaning: string;
  sideEffectPoint: StableErrorSideEffectPoint;
  terminalityRule: string;
  recoveryRuleKind: 'FIXED' | 'EVIDENCE_DECISION_TABLE';
  fixedRetryDirective: StableRetryDirective | null;
  recoveryDecisionTableId: string | null;
  sameLogicalOperationRequired: boolean;
  refreshRequired: boolean;
  reconciliationRequired: boolean;
  manualReviewRequired: boolean;
  requiredSnapshotFields: string[];
  affectedObjectKinds: string[];
  httpMappings: number[];
  kcipMappings: Array<string | number>;
  mcpMappings: Array<string | number>;
  uiMessageKey: string;
  canonicalOwnerActions: string[];
  auditEvidenceKinds: string[];
  testCaseIds: string[];
}

export interface CanonicalErrorView {
  code: ErrorCode;
  classification: StableErrorClassification;
  canonicalMeaning: string;
  sideEffectPoint: StableErrorSideEffectPoint;
  retryDirective: StableRetryDirective;
  recoveryRuleKind: StableErrorRecord['recoveryRuleKind'];
  sameLogicalOperationRequired: boolean;
  refreshRequired: boolean;
  reconciliationRequired: boolean;
  manualReviewRequired: boolean;
  recordDigest: string;
  record: StableErrorRecord;
}

export class ErrorRecoveryContractError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ErrorRecoveryContractError';
  }
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

function digestRecord(record: StableErrorRecord): string {
  const { canonicalDigest: _ignored, ...identity } = record;
  return `sha256:${createHash('sha256').update(canonical(identity)).digest('hex')}`;
}

export function validateErrorRetryRegistry(records: readonly StableErrorRecord[]): void {
  const active = new Map<string, StableErrorRecord>();
  for (const record of records) {
    if (record.lifecycle !== 'ACTIVE') continue;
    if (record.retryable !== undefined) throw new ErrorRecoveryContractError(`ERROR_RECOVERY_CONTRACT_INCOMPLETE:non_authoritative_retryable:${record.code}`);
    if (!record.code || active.has(record.code)) throw new ErrorRecoveryContractError(`ERROR_RECOVERY_CONTRACT_INCOMPLETE:duplicate:${record.code}`);
    if (!/^([A-Z][A-Z0-9]*)(_[A-Z0-9]+)+$/u.test(record.code) || record.errorCodeId !== `ERR-${record.code}` || record.authoritySourceRefs.every((ref) => !ref.startsWith('ssot://32.'))) throw new ErrorRecoveryContractError(`ERROR_RECOVERY_CONTRACT_INCOMPLETE:identity:${record.code}`);
    if (record.requirementIds.length === 0 || record.testCaseIds.length === 0 || record.canonicalOwnerActions.length === 0) throw new ErrorRecoveryContractError(`ERROR_RECOVERY_CONTRACT_INCOMPLETE:evidence:${record.code}`);
    if (record.canonicalDigest !== digestRecord(record)) throw new ErrorRecoveryContractError(`ERROR_RECOVERY_CONTRACT_INCOMPLETE:digest:${record.code}`);
    if (record.recoveryRuleKind === 'FIXED') {
      if (!record.fixedRetryDirective || !stableRetryDirectives.includes(record.fixedRetryDirective)) throw new ErrorRecoveryContractError(`ERROR_RECOVERY_CONTRACT_INCOMPLETE:fixed_directive:${record.code}`);
      if (record.recoveryDecisionTableId !== null || record.extensions.recoveryDecisionTable !== null) throw new ErrorRecoveryContractError(`ERROR_RECOVERY_CONTRACT_INCOMPLETE:fixed_table:${record.code}`);
    } else {
      const table = record.extensions.recoveryDecisionTable;
      const predicates = table?.rules.map((rule) => rule.predicate) ?? [];
      const requiredPredicates = ['effectOutcome=CONFIRMED_NOT_APPLIED', 'effectOutcome=CONFIRMED_APPLIED', 'effectOutcome=POSSIBLE_EFFECT', 'effectOutcome=UNKNOWN'];
      if (!record.recoveryDecisionTableId || record.fixedRetryDirective !== null || !table || table.tableId !== record.recoveryDecisionTableId || table.total !== true || table.mutuallyExclusive !== true || table.defaultRule.predicate !== 'otherwise' || table.rules.length !== requiredPredicates.length || new Set(predicates).size !== predicates.length || requiredPredicates.some((predicate) => !predicates.includes(predicate))) throw new ErrorRecoveryContractError(`ERROR_RECOVERY_CONTRACT_INCOMPLETE:decision_table:${record.code}`);
      for (const rule of [...table.rules, table.defaultRule]) if (!stableRetryDirectives.includes(rule.directive)) throw new ErrorRecoveryContractError(`ERROR_RECOVERY_CONTRACT_INCOMPLETE:decision_directive:${record.code}`);
    }
    if (record.code === 'MCP_HEADER_MISMATCH' && JSON.stringify(record.mcpMappings) !== JSON.stringify([-32020])) throw new ErrorRecoveryContractError('ERROR_RECOVERY_CONTRACT_INCOMPLETE:mcp_header_mapping');
    if (record.code === 'MCP_CLIENT_CAPABILITY_MISSING' && JSON.stringify(record.mcpMappings) !== JSON.stringify([-32021])) throw new ErrorRecoveryContractError('ERROR_RECOVERY_CONTRACT_INCOMPLETE:mcp_capability_mapping');
    if (record.code === 'MCP_PROTOCOL_VERSION_UNSUPPORTED' && JSON.stringify(record.mcpMappings) !== JSON.stringify([-32022])) throw new ErrorRecoveryContractError('ERROR_RECOVERY_CONTRACT_INCOMPLETE:mcp_version_mapping');
    active.set(record.code, record);
  }
  if (active.size === 0) throw new ErrorRecoveryContractError('ERROR_RECOVERY_CONTRACT_INCOMPLETE:no_active_records');
}

function loadRegistry(): Map<string, StableErrorRecord> {
  let parsed: unknown;
  try {
    const path = resolve(process.cwd(), 'contracts/registries/errors/errors.json');
    parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error) {
    throw new ErrorRecoveryContractError(`ERROR_RECOVERY_CONTRACT_INCOMPLETE:registry_unreadable:${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== 'object' || (parsed as { kind?: unknown }).kind !== 'ERROR_RETRY_REGISTRY' || !Array.isArray((parsed as { records?: unknown }).records)) {
    throw new ErrorRecoveryContractError('ERROR_RECOVERY_CONTRACT_INCOMPLETE:registry_shape');
  }
  const records = (parsed as { records: unknown[] }).records as StableErrorRecord[];
  validateErrorRetryRegistry(records);
  const active = new Map(records.filter((record) => record.lifecycle === 'ACTIVE').map((record) => [record.code, record]));
  return active;
}

let registry: Map<string, StableErrorRecord> | undefined;

export function getErrorRetryRegistry(): ReadonlyMap<string, StableErrorRecord> {
  registry ??= loadRegistry();
  return registry;
}

export function getStableErrorRecord(code: string): StableErrorRecord {
  const record = getErrorRetryRegistry().get(code);
  if (!record) throw new ErrorRecoveryContractError(`ERROR_RECOVERY_CONTRACT_INCOMPLETE:unknown_code:${code}`);
  return record;
}

export function resolveRetryDirective(record: StableErrorRecord, observedEffect: 'CONFIRMED_NOT_APPLIED' | 'CONFIRMED_APPLIED' | 'POSSIBLE_EFFECT' | 'UNKNOWN' = 'UNKNOWN'): StableRetryDirective {
  if (record.recoveryRuleKind === 'FIXED') return record.fixedRetryDirective!;
  const predicate = `effectOutcome=${observedEffect}`;
  return record.extensions.recoveryDecisionTable?.rules.find((rule) => rule.predicate === predicate)?.directive
    ?? record.extensions.recoveryDecisionTable?.defaultRule.directive
    ?? 'MANUAL_REVIEW';
}

export function canonicalErrorView(code: string, observedEffect: 'CONFIRMED_NOT_APPLIED' | 'CONFIRMED_APPLIED' | 'POSSIBLE_EFFECT' | 'UNKNOWN' = 'UNKNOWN'): CanonicalErrorView {
  const record = getStableErrorRecord(code);
  return {
    code: record.code as ErrorCode,
    classification: record.classification,
    canonicalMeaning: record.canonicalMeaning,
    sideEffectPoint: record.sideEffectPoint,
    retryDirective: resolveRetryDirective(record, observedEffect),
    recoveryRuleKind: record.recoveryRuleKind,
    sameLogicalOperationRequired: record.sameLogicalOperationRequired,
    refreshRequired: record.refreshRequired,
    reconciliationRequired: record.reconciliationRequired,
    manualReviewRequired: record.manualReviewRequired,
    recordDigest: record.canonicalDigest,
    record
  };
}

export function assertCanonicalRetryDirective(code: string, directive: string, observedEffect: 'CONFIRMED_NOT_APPLIED' | 'CONFIRMED_APPLIED' | 'POSSIBLE_EFFECT' | 'UNKNOWN' = 'UNKNOWN'): void {
  const expected = canonicalErrorView(code, observedEffect).retryDirective;
  if (directive !== expected) throw new ErrorRecoveryContractError(`ERROR_RECOVERY_CONTRACT_INCOMPLETE:directive_mismatch:${code}:${directive}:${expected}`);
}
