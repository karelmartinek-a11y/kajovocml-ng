import { describe, expect, it } from 'vitest';
import { canonicalDigest, canonicalJson, operationCommandSchema } from '@kcml/schemas';

describe('canonical contracts', () => {
  it('orders object keys recursively and has a stable digest', () => {
    expect(canonicalJson({ z: 1, a: { y: true, x: null } })).toBe('{"a":{"x":null,"y":true},"z":1}');
    expect(canonicalDigest({ b: 2, a: 1 })).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });
  it('rejects undeclared command fields', () => {
    expect(() => operationCommandSchema.parse({ operation: 'x', surprise: true })).toThrow();
  });
});
