import { canonicalErrorView, type CanonicalErrorView, type RetryDirective } from '@kcml/schemas';

export class DomainError extends Error {
  public readonly retryDirective: RetryDirective;

  public constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number,
    retryDirective: RetryDirective = 'DO_NOT_RETRY',
    public readonly details: unknown = null
  ) {
    super(message);
    this.name = 'DomainError';
    try {
      this.retryDirective = canonicalErrorView(code).retryDirective;
    } catch {
      // Legacy/internal callers can still construct an error, but transport
      // adapters will fail closed to ERROR_RECOVERY_CONTRACT_INCOMPLETE.
      this.retryDirective = retryDirective;
    }
  }
}

/**
 * Transport adapters must use this projection instead of the directive carried
 * by an adapter/provider exception.  The registry is authoritative for code,
 * classification, side-effect point and recovery; HTTP/SDK metadata is not.
 */
export function canonicalizeDomainError(error: unknown): CanonicalErrorView {
  const code = error instanceof DomainError ? error.code : 'ERROR_RECOVERY_CONTRACT_INCOMPLETE';
  try {
    return canonicalErrorView(code);
  } catch {
    return canonicalErrorView('ERROR_RECOVERY_CONTRACT_INCOMPLETE');
  }
}

export function canonicalRetryDirective(error: unknown): RetryDirective {
  return canonicalizeDomainError(error).retryDirective;
}

export function isPostgresConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && ['23505', '40001', '40P01'].includes(String(error.code));
}
