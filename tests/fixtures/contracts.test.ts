import { describe, expect, it } from 'vitest';
import { canonicalDigest, canonicalJson } from '@kcml/schemas';

describe('canonical fixture contract', () => {
  it('keeps request evidence invariant under object insertion order', () => {
    const first = { operation: 'component.state.query', arguments: { limit: 10, includeHistory: true } };
    const second = { arguments: { includeHistory: true, limit: 10 }, operation: 'component.state.query' };
    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(canonicalDigest(first)).toBe(canonicalDigest(second));
  });
});
