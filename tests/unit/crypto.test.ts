import { describe, expect, it } from 'vitest';
import { EnvelopeCipher, base32Decode, base32Encode, totp, verifyTotp } from '@kcml/domain';

describe('secret cryptography', () => {
  it('round-trips AES-GCM with bound associated data', () => {
    const cipher = new EnvelopeCipher(Buffer.alloc(32, 7), 'test-key');
    const encrypted = cipher.encrypt('sensitive', 'secret:OPENAI_API_KEY');
    expect(cipher.decrypt(encrypted, 'secret:OPENAI_API_KEY')).toBe('sensitive');
    expect(() => cipher.decrypt(encrypted, 'secret:OTHER')).toThrow();
  });
  it('implements Base32 and time-based OTP verification', () => {
    const input = Buffer.from('12345678901234567890');
    const encoded = base32Encode(input);
    expect(base32Decode(encoded)).toEqual(input);
    const code = totp(encoded, 1_700_000_000_000);
    expect(verifyTotp(encoded, code, 1_700_000_000_000)).toBe(true);
  });
});
