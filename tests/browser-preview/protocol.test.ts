import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { consumePreviewTicket, issuePreviewTicket } from '@kcml/browser-preview-protocol';
describe('preview protocol',()=>it('binds ticket to session and viewer',()=>{const key=Buffer.alloc(32,8);const session=randomUUID();const viewer=randomUUID();const issued=issuePreviewTicket(session,viewer,key);expect(consumePreviewTicket(issued.token,key)).toMatchObject({sessionId:session,ownerSessionId:viewer});}));
