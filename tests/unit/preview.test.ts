import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { consumePreviewTicket, issuePreviewTicket } from '@kcml/browser-preview-protocol';

describe('browser preview ticket', () => {
  it('is single-purpose, signed and short lived', () => {
    const key = Buffer.alloc(32, 3); const sessionId = randomUUID(); const ownerSessionId = randomUUID();
    const ticket = issuePreviewTicket(sessionId, ownerSessionId, key, 30);
    expect(consumePreviewTicket(ticket.token, key)).toMatchObject({ sessionId, ownerSessionId });
    expect(() => consumePreviewTicket(`${ticket.token}x`, key)).toThrow('PREVIEW_TICKET_INVALID');
  });
});
