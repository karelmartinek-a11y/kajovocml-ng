import { describe, expect, it } from 'vitest';
import { canonicalFailure, DomainError } from '../../packages/domain/src/errors.js';
import { planCanonicalRetry } from '../../packages/domain/src/retry-planner.js';

const cases = [
  ['MCP_HEADER_MISMATCH', 'CLOSE_FAILED_COMMAND'],
  ['OPENAI_PROVIDER_TRANSIENT', 'RETRY_SAME_COMMAND'],
  ['STATE_VERSION_CONFLICT', 'REFRESH_AND_CREATE_SUCCESSOR'],
  ['MCP_DEADLINE_EXCEEDED', 'ENQUEUE_RECONCILIATION'],
  ['MODEL_SUBMIT_OUTCOME_UNKNOWN', 'CREATE_MANUAL_REVIEW']
] as const;

describe('canonical retry planner', () => {
  it.each(cases)('implements the registry directive for %s without degrading it to blind retry', (code, action) => {
    const failure = canonicalFailure(new DomainError(code, 'adapter detail', 599, 'RETRY_SAME_OPERATION'));
    const decision = planCanonicalRetry(failure, 1, 8);
    expect(decision.action).toBe(action);
    expect(decision.directive).toBe(failure.retryDirective);
    expect(decision.policy).toMatchObject({
      directiveSourceRegistryVersion: failure.registryVersion,
      errorRecordDigest: failure.recordDigest,
      attempt: 1,
      maximumAttempts: 8
    });
    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(decision.policy)).toBe(true);
  });

  it('bounds same-operation retry and never converts another directive because of attempt count', () => {
    const retryable = canonicalFailure(new DomainError('OPENAI_PROVIDER_TRANSIENT', 'transient', 503));
    expect(planCanonicalRetry(retryable, 7, 8)).toMatchObject({ action: 'RETRY_SAME_COMMAND', automaticDispatchAllowed: true });
    expect(planCanonicalRetry(retryable, 8, 8)).toMatchObject({ action: 'CLOSE_FAILED_COMMAND', automaticDispatchAllowed: false });

    const reconcile = canonicalFailure(new DomainError('MCP_DEADLINE_EXCEEDED', 'unknown outcome', 504));
    expect(planCanonicalRetry(reconcile, 8, 8)).toMatchObject({ action: 'ENQUEUE_RECONCILIATION', automaticDispatchAllowed: false });
  });
});
