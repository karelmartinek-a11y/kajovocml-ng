import { describe, expect, it } from 'vitest';
import { canonicalDigest, canonicalJson, operationCommandSchema, ownerLoginSchema, toCanonicalJsonValue } from '@kcml/schemas';

describe('canonical contracts', () => {
  it('orders object keys recursively and has a stable digest', () => {
    expect(canonicalJson({ z: 1, a: { y: true, x: null } })).toBe('{"a":{"x":null,"y":true},"z":1}');
    expect(canonicalDigest({ b: 2, a: 1 })).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });
  it('rejects undeclared command fields', () => {
    expect(() => operationCommandSchema.parse({ operation: 'x', surprise: true })).toThrow();
  });
  it('requires both manually entered OWNER login fields', () => {
    expect(() => ownerLoginSchema.parse({ password: 'secret' })).toThrow();
    expect(ownerLoginSchema.parse({ username: 'entered-owner', password: 'secret' })).toEqual({ username: 'entered-owner', password: 'secret' });
  });
  it('materializes one strict JSON-safe representation', () => {
    expect(toCanonicalJsonValue({ when: new Date('2026-09-04T00:00:00Z'), amount: 42n, nested: [null, 'ž'] }))
      .toEqual({ amount: '42', nested: [null, 'ž'], when: '2026-09-04T00:00:00.000Z' });
    expect(toCanonicalJsonValue({ bytes: Buffer.from([1, 2, 3]) })).toEqual({ bytes: 'base64:AQID' });
    expect(() => toCanonicalJsonValue({ value: Number.NaN })).toThrow('non-finite number');
    expect(() => toCanonicalJsonValue({ value: () => true })).toThrow('function');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => toCanonicalJsonValue(cyclic)).toThrow('cycle');
  });
});
