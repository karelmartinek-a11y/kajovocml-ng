import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export interface CipherEnvelope { ciphertext: Buffer; nonce: Buffer; authTag: Buffer; keyId: string; fingerprint: string; valueDigest: Buffer; }

export class EnvelopeCipher {
  public constructor(private readonly key: Buffer, public readonly keyId: string) {
    if (key.length !== 32) throw new Error('Master key must be exactly 32 bytes');
  }

  public static async fromEnvironment(): Promise<EnvelopeCipher> {
    const encoded = process.env.KCML_MASTER_KEY;
    const key = encoded ? Buffer.from(encoded, 'base64') : await readFile(process.env.KCML_MASTER_KEY_FILE ?? '/etc/kajovocml-ng/master.key').then((value) => Buffer.from(value.toString('utf8').trim(), 'base64'));
    return new EnvelopeCipher(key, process.env.KCML_MASTER_KEY_ID ?? 'host-master-v1');
  }

  public encrypt(value: string, associatedData: string): CipherEnvelope {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(Buffer.from(associatedData, 'utf8'));
    const plaintext = Buffer.from(value, 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const valueDigest = createHash('sha256').update(plaintext).digest();
    return { ciphertext, nonce, authTag: cipher.getAuthTag(), keyId: this.keyId, fingerprint: valueDigest.toString('hex').slice(0, 16), valueDigest };
  }

  public decrypt(envelope: Pick<CipherEnvelope, 'ciphertext' | 'nonce' | 'authTag'>, associatedData: string): string {
    const decipher = createDecipheriv('aes-256-gcm', this.key, envelope.nonce);
    decipher.setAAD(Buffer.from(associatedData, 'utf8'));
    decipher.setAuthTag(envelope.authTag);
    return Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]).toString('utf8');
  }
}

export function tokenDigest(token: string): Buffer { return createHash('sha256').update(token, 'utf8').digest(); }
export function fingerprint(token: string): string { return tokenDigest(token).toString('hex').slice(0, 16); }
export function randomToken(bytes = 32): string { return randomBytes(bytes).toString('base64url'); }

const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(value: Buffer): string {
  let bits = 0; let acc = 0; let output = '';
  for (const byte of value) {
    acc = (acc << 8) | byte; bits += 8;
    while (bits >= 5) { output += base32Alphabet[(acc >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) output += base32Alphabet[(acc << (5 - bits)) & 31];
  return output;
}

export function base32Decode(value: string): Buffer {
  let bits = 0; let acc = 0; const output: number[] = [];
  for (const character of value.toUpperCase().replace(/=+$/u, '')) {
    const index = base32Alphabet.indexOf(character);
    if (index < 0) throw new Error('Invalid Base32');
    acc = (acc << 5) | index; bits += 5;
    if (bits >= 8) { output.push((acc >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(output);
}

export function totp(secretBase32: string, timestamp = Date.now(), stepSeconds = 30): string {
  const counter = Math.floor(timestamp / 1000 / stepSeconds);
  const message = Buffer.alloc(8); message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Decode(secretBase32)).update(message).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 15;
  const binary = ((digest[offset] ?? 0) & 127) << 24 | (digest[offset + 1] ?? 0) << 16 | (digest[offset + 2] ?? 0) << 8 | (digest[offset + 3] ?? 0);
  return String(binary % 1_000_000).padStart(6, '0');
}

export function verifyTotp(secretBase32: string, code: string, timestamp = Date.now()): boolean {
  for (const offset of [-30_000, 0, 30_000]) {
    const expected = Buffer.from(totp(secretBase32, timestamp + offset));
    const actual = Buffer.from(code);
    if (actual.length === expected.length && timingSafeEqual(actual, expected)) return true;
  }
  return false;
}
