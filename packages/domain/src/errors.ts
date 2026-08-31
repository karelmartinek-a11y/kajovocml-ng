import type { RetryDirective } from '@kcml/schemas';

export class DomainError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number,
    public readonly retryDirective: RetryDirective = 'DO_NOT_RETRY',
    public readonly details: unknown = null
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export function isPostgresConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && ['23505', '40001', '40P01'].includes(String(error.code));
}
