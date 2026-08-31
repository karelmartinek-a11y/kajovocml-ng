import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { browserObservationSchema } from '@kcml/browser-runtime-contracts';
import { z } from '@kcml/schemas';

export const previewFrameSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('HELLO'), protocol: z.literal('KCML-PREVIEW/1'), streamEpoch: z.coerce.bigint().positive(), sessionId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('OBSERVATION'), streamEpoch: z.coerce.bigint().positive(), sequence: z.coerce.bigint().positive(), observation: browserObservationSchema }).strict(),
  z.object({ kind: z.literal('VIDEO'), streamEpoch: z.coerce.bigint().positive(), sequence: z.coerce.bigint().positive(), pageId: z.string().uuid(), mimeType: z.enum(['image/webp','image/jpeg']), dataBase64: z.string(), viewportRevision: z.coerce.bigint().positive() }).strict(),
  z.object({ kind: z.literal('RESYNC_REQUIRED'), streamEpoch: z.coerce.bigint().positive(), expectedSequence: z.coerce.bigint().positive() }).strict(),
  z.object({ kind: z.literal('HEARTBEAT'), streamEpoch: z.coerce.bigint().positive(), sentAt: z.string().datetime({ offset: true }) }).strict()
]);
export type PreviewFrame = z.infer<typeof previewFrameSchema>;

export interface PreviewTicket { token: string; expiresAt: Date; }

export function issuePreviewTicket(sessionId: string, ownerSessionId: string, key: Buffer, ttlSeconds = 30): PreviewTicket {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const nonce = randomBytes(16).toString('base64url');
  const body = Buffer.from(JSON.stringify({ sessionId, ownerSessionId, expiresAt: expiresAt.toISOString(), nonce })).toString('base64url');
  const signature = createHmac('sha256', key).update(body).digest('base64url');
  return { token: `${body}.${signature}`, expiresAt };
}

export function consumePreviewTicket(token: string, key: Buffer): { sessionId: string; ownerSessionId: string; expiresAt: string; nonce: string } {
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra) throw new Error('PREVIEW_TICKET_INVALID');
  const expected = createHmac('sha256', key).update(body).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('PREVIEW_TICKET_INVALID');
  const value = z.object({ sessionId: z.string().uuid(), ownerSessionId: z.string().uuid(), expiresAt: z.string().datetime({ offset: true }), nonce: z.string() }).strict().parse(JSON.parse(Buffer.from(body, 'base64url').toString('utf8')));
  if (new Date(value.expiresAt) <= new Date()) throw new Error('PREVIEW_TICKET_EXPIRED');
  return value;
}

export class PreviewSequence {
  #expected = 1n;
  public accept(frame: PreviewFrame): void {
    if ('sequence' in frame) {
      if (frame.sequence !== this.#expected) throw new Error('PREVIEW_SEQUENCE_GAP');
      this.#expected += 1n;
    }
  }
}
