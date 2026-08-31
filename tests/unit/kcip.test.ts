import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createKcipEnvelope, SequenceGuard, verifyKcipEnvelope } from '@kcml/kcip';

describe('KCIP/1.0', () => {
  it('detects payload alteration and deadline expiry', () => {
    const envelope = createKcipEnvelope({ messageType: 'REQUEST', operation: 'system.health.read', correlationId: randomUUID(), causationId: null, idempotencyKey: 'one', deadlineAt: new Date(Date.now() + 60_000).toISOString(), payloadSchemaDigest: `sha256:${'0'.repeat(64)}`, payload: { ok: true } });
    expect(verifyKcipEnvelope(envelope)).toEqual(envelope);
    expect(() => verifyKcipEnvelope({ ...envelope, payload: { ok: false } })).toThrow('KCIP_PAYLOAD_DIGEST_MISMATCH');
    expect(() => verifyKcipEnvelope({ ...envelope, deadlineAt: new Date(0).toISOString() })).toThrow('KCIP_DEADLINE_EXCEEDED');
  });
  it('fences duplicate and missing stream sequences', () => {
    const guard = new SequenceGuard();
    expect(guard.accept('a', 1n)).toBe('ACCEPTED');
    expect(guard.accept('a', 1n)).toBe('DUPLICATE');
    expect(() => guard.accept('a', 3n)).toThrow('KCIP_SEQUENCE_GAP');
  });
});
