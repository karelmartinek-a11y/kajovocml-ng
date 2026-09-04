import { canonicalErrorView, type CanonicalErrorView, type ErrorCode, type RetryDirective } from '@kcml/schemas';

export class DomainError extends Error {
  public readonly retryDirective: RetryDirective;
  public readonly httpStatus: number;

  public constructor(
    public readonly code: ErrorCode,
    message: string,
    _legacyHttpStatus: number,
    _legacyRetryDirective: RetryDirective = 'DO_NOT_RETRY',
    public readonly details: unknown = null
  ) {
    super(message);
    this.name = 'DomainError';
    const registered = canonicalErrorView(code);
    this.retryDirective = registered.retryDirective;
    this.httpStatus = registered.record.httpMappings[0] ?? 500;
  }
}

/**
 * Transport adapters must use this projection instead of the directive carried
 * by an adapter/provider exception.  The registry is authoritative for code,
 * classification, side-effect point and recovery; HTTP/SDK metadata is not.
 */
export function canonicalizeDomainError(error: unknown): CanonicalErrorView {
  const postgresCode = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : null;
  const projectedPostgresCode: ErrorCode | null = postgresCode === '23505'
    ? 'IDEMPOTENCY_CONFLICT'
    : postgresCode === '23514'
      ? 'STATE_MACHINE_CONTRACT_INCOMPLETE'
      : postgresCode === '40001'
        ? 'STATE_VERSION_CONFLICT'
        : postgresCode === '40P01'
          ? 'PLATFORM_RECOVERY_IN_PROGRESS'
          : postgresCode === '55000'
            ? 'TERMINAL_STATE_IMMUTABLE'
            : null;
  const code = error instanceof DomainError
    ? error.code
    : projectedPostgresCode ?? 'ERROR_RECOVERY_CONTRACT_INCOMPLETE';
  try {
    return canonicalErrorView(code);
  } catch {
    return canonicalErrorView('ERROR_RECOVERY_CONTRACT_INCOMPLETE');
  }
}

export interface CanonicalFailure {
  readonly code: ErrorCode;
  readonly effectiveCode: ErrorCode;
  readonly message: string;
  readonly classification: CanonicalErrorView['classification'];
  readonly sideEffectPoint: CanonicalErrorView['sideEffectPoint'];
  readonly retryDirective: CanonicalErrorView['retryDirective'];
  readonly recordDigest: string;
  readonly registryVersion: string;
  readonly httpStatus: number;
  readonly details: unknown;
  readonly cause: { readonly kind: string; readonly originalCode: string | null } | null;
}

export function canonicalFailure(error: unknown): CanonicalFailure {
  const view = canonicalizeDomainError(error);
  const originalCode = error instanceof DomainError ? error.code : null;
  return Object.freeze({
    code: view.code,
    effectiveCode: view.code,
    message: view.canonicalMeaning,
    classification: view.classification,
    sideEffectPoint: view.sideEffectPoint,
    retryDirective: view.retryDirective,
    recordDigest: view.recordDigest,
    registryVersion: view.record.schemaVersion,
    httpStatus: view.record.httpMappings[0] ?? 500,
    details: error instanceof DomainError && originalCode === view.code ? error.details : null,
    cause: originalCode && originalCode !== view.code
      ? Object.freeze({ kind: 'UNREGISTERED_DOMAIN_ERROR', originalCode })
      : error instanceof DomainError ? null : Object.freeze({ kind: 'NON_DOMAIN_ERROR', originalCode: null })
  });
}

export function canonicalRetryDirective(error: unknown): RetryDirective {
  return canonicalizeDomainError(error).retryDirective;
}

export function isPostgresConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && ['23505', '40001', '40P01'].includes(String(error.code));
}
