import { randomUUID } from 'node:crypto';
import { canonicalDigest, canonicalErrorView, kcipEnvelopeSchema, type CanonicalJsonValue, type KcipEnvelope } from '@kcml/schemas';

export class KcipError extends Error {
  public readonly canonical: ReturnType<typeof canonicalErrorView>;

  public constructor(public readonly code: string, message: string, public readonly details: unknown = null) {
    super(message);
    this.name = 'KcipError';
    this.canonical = canonicalErrorView(code);
  }
}

export function toKcipError(error: unknown): KcipError {
  if (error instanceof KcipError) return error;
  const code = error instanceof Error && error.message.startsWith('KCIP_') ? error.message.split(':', 1)[0]! : 'KCIP_INTERNAL_FAILURE';
  try {
    canonicalErrorView(code);
    return new KcipError(code, error instanceof Error ? error.message : String(error));
  } catch {
    return new KcipError('KCIP_INTERNAL_FAILURE', error instanceof Error ? error.message : String(error));
  }
}

export function kcipErrorPayload(error: unknown): { code: string; classification: string; retryDirective: string; recordDigest: string; details: unknown } {
  const value = toKcipError(error);
  return { code: value.canonical.code, classification: value.canonical.classification, retryDirective: value.canonical.retryDirective, recordDigest: value.canonical.recordDigest, details: value.details };
}

export function createKcipEnvelope(input: Omit<KcipEnvelope, 'kcip' | 'messageId' | 'sentAt' | 'payloadDigest'>): KcipEnvelope {
  return kcipEnvelopeSchema.parse({
    ...input,
    kcip: 'KCIP/1.0',
    messageId: randomUUID(),
    sentAt: new Date().toISOString(),
    payloadDigest: canonicalDigest(input.payload as CanonicalJsonValue)
  });
}

export function verifyKcipEnvelope(value: unknown, now = new Date()): KcipEnvelope {
  const envelope = kcipEnvelopeSchema.parse(value);
  if (canonicalDigest(envelope.payload as CanonicalJsonValue) !== envelope.payloadDigest) throw new KcipError('KCIP_MALFORMED_ENVELOPE', 'KCIP_PAYLOAD_DIGEST_MISMATCH: payload digest does not match the envelope');
  if (envelope.deadlineAt && new Date(envelope.deadlineAt) <= now) throw new KcipError('KCIP_DEADLINE_EXCEEDED', 'KCIP_DEADLINE_EXCEEDED: envelope deadline has elapsed');
  return envelope;
}

export class SequenceGuard {
  readonly #next = new Map<string, bigint>();

  public accept(stream: string, sequence: bigint): 'ACCEPTED' | 'DUPLICATE' {
    const expected = this.#next.get(stream) ?? 1n;
    if (sequence < expected) return 'DUPLICATE';
    if (sequence > expected) throw new KcipError('KCIP_SEQUENCE_GAP', 'KCIP_SEQUENCE_GAP: sequence skipped an expected value');
    this.#next.set(stream, expected + 1n);
    return 'ACCEPTED';
  }
}
