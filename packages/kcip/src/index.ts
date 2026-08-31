import { randomUUID } from 'node:crypto';
import { canonicalDigest, kcipEnvelopeSchema, type CanonicalJsonValue, type KcipEnvelope } from '@kcml/schemas';

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
  if (canonicalDigest(envelope.payload as CanonicalJsonValue) !== envelope.payloadDigest) throw new Error('KCIP_PAYLOAD_DIGEST_MISMATCH');
  if (envelope.deadlineAt && new Date(envelope.deadlineAt) <= now) throw new Error('KCIP_DEADLINE_EXCEEDED');
  return envelope;
}

export class SequenceGuard {
  readonly #next = new Map<string, bigint>();

  public accept(stream: string, sequence: bigint): 'ACCEPTED' | 'DUPLICATE' {
    const expected = this.#next.get(stream) ?? 1n;
    if (sequence < expected) return 'DUPLICATE';
    if (sequence > expected) throw new Error('KCIP_SEQUENCE_GAP');
    this.#next.set(stream, expected + 1n);
    return 'ACCEPTED';
  }
}
