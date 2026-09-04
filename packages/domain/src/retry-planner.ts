import type { RetryDirective } from '@kcml/schemas';
import type { CanonicalFailure } from './errors.js';

export const retryPlanActions = [
  'CLOSE_FAILED_COMMAND',
  'RETRY_SAME_COMMAND',
  'REFRESH_AND_CREATE_SUCCESSOR',
  'ENQUEUE_RECONCILIATION',
  'CREATE_MANUAL_REVIEW'
] as const;
export type RetryPlanAction = (typeof retryPlanActions)[number];

export interface RetryPolicySnapshot {
  readonly directiveSourceRegistryVersion: string;
  readonly errorRecordDigest: string;
  readonly attempt: number;
  readonly maximumAttempts: number;
  readonly backoffSeconds: number | null;
}

export interface RetryPlanDecision {
  readonly directive: RetryDirective;
  readonly action: RetryPlanAction;
  readonly automaticDispatchAllowed: boolean;
  readonly preservesLogicalOperation: boolean;
  readonly requiresAuthoritativeRefresh: boolean;
  readonly requiresCompletedReconciliation: boolean;
  readonly requiresOwnerDecision: boolean;
  readonly policy: RetryPolicySnapshot;
}

function boundedBackoffSeconds(attempt: number): number {
  return Math.min(300, 2 ** Math.min(30, Math.max(0, attempt)));
}

export function planCanonicalRetry(
  failure: CanonicalFailure,
  attempt: number,
  maximumAttempts: number
): Readonly<RetryPlanDecision> {
  if (!Number.isInteger(attempt) || attempt < 1) throw new RangeError('attempt must be a positive integer');
  if (!Number.isInteger(maximumAttempts) || maximumAttempts < 1) throw new RangeError('maximumAttempts must be a positive integer');

  const exhausted = attempt >= maximumAttempts;
  const directive = failure.retryDirective;
  const action: RetryPlanAction = directive === 'RETRY_SAME_OPERATION'
    ? exhausted ? 'CLOSE_FAILED_COMMAND' : 'RETRY_SAME_COMMAND'
    : directive === 'REFRESH_AND_RETRY_NEW_COMMAND'
      ? 'REFRESH_AND_CREATE_SUCCESSOR'
      : directive === 'RECONCILE_THEN_RETRY'
        ? 'ENQUEUE_RECONCILIATION'
        : directive === 'MANUAL_REVIEW'
          ? 'CREATE_MANUAL_REVIEW'
          : 'CLOSE_FAILED_COMMAND';

  return Object.freeze({
    directive,
    action,
    automaticDispatchAllowed: action === 'RETRY_SAME_COMMAND',
    preservesLogicalOperation: action === 'RETRY_SAME_COMMAND',
    requiresAuthoritativeRefresh: action === 'REFRESH_AND_CREATE_SUCCESSOR',
    requiresCompletedReconciliation: action === 'ENQUEUE_RECONCILIATION',
    requiresOwnerDecision: action === 'CREATE_MANUAL_REVIEW',
    policy: Object.freeze({
      directiveSourceRegistryVersion: failure.registryVersion,
      errorRecordDigest: failure.recordDigest,
      attempt,
      maximumAttempts,
      backoffSeconds: action === 'RETRY_SAME_COMMAND' ? boundedBackoffSeconds(attempt) : null
    })
  });
}
