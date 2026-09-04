import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { issuePreviewTicket } from '@kcml/browser-preview-protocol';
import type { DatabasePool } from '@kcml/database';
import { authenticatePreviewUpgrade, BrowserArtifactOwnerPort, installPreviewWebSocket } from '../../apps/server/src/preview-ws.js';

async function within<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([promise, new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error(`TIMEOUT:${label}`)), 1_000))]);
}

describe('browser preview transport', () => {
  it('reads only digest-addressed, size-checked artifacts inside the owner root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kcml-preview-'));
    const content = Buffer.from('verified preview');
    const digest = createHash('sha256').update(content).digest();
    await writeFile(join(root, digest.toString('hex')), content);
    const port = new BrowserArtifactOwnerPort(root);
    await expect(port.read(`artifact:sha256:${digest.toString('hex')}`, digest, BigInt(content.length))).resolves.toEqual(content);
    await expect(port.read(join(root, digest.toString('hex')), digest, BigInt(content.length))).rejects.toThrow('BROWSER_ARTIFACT_INVALID');
    await expect(port.read(`artifact:sha256:${digest.toString('hex')}`, Buffer.alloc(32), BigInt(content.length))).rejects.toThrow('BROWSER_ARTIFACT_INVALID');
    const linkedContent = Buffer.from('linked preview');
    const linkDigest = createHash('sha256').update(linkedContent).digest('hex');
    const outside = join(await mkdtemp(join(tmpdir(), 'kcml-preview-outside-')), 'frame');
    await writeFile(outside, linkedContent);
    await symlink(outside, join(root, linkDigest));
    await expect(port.read(`artifact:sha256:${linkDigest}`, Buffer.from(linkDigest, 'hex'), BigInt(linkedContent.length))).rejects.toThrow('BROWSER_ARTIFACT_INVALID');
  });

  it('uses RFC 6455 framing, strict Origin and a one-use ticket', async () => {
    const key = Buffer.alloc(32, 7);
    const sessionId = randomUUID();
    const ticket = issuePreviewTicket(sessionId, randomUUID(), key);
    let consumed = false;
    const pool = {
      query: async (sql: string) => {
        if (sql.includes('UPDATE kcml.browser_preview_ticket')) {
          if (consumed) return { rowCount: 0, rows: [] };
          consumed = true;
          return { rowCount: 1, rows: [{ id: randomUUID() }] };
        }
        return { rowCount: 0, rows: [] };
      },
    } as unknown as DatabasePool;
    const app = Fastify();
    await installPreviewWebSocket(app, pool, key, { publicOrigin: 'https://owner.example', artifactRoot: null });
    await app.ready();
    let socket: Awaited<ReturnType<typeof app.injectWS>> | null = null;
    try {
      socket = await within(app.injectWS(`/api/v1/browser-sessions/${sessionId}/preview/ws?ticket=${encodeURIComponent(ticket.token)}`, { headers: { origin: 'https://owner.example' } }), 'inject');
      const pong = new Promise<string>((resolve) => socket?.on('message', (message) => {
        const text = message.toString();
        if (JSON.parse(text).kind === 'PONG') resolve(text);
      }));
      socket.send(JSON.stringify({ kind: 'PING', sentAt: new Date().toISOString() }));
      await expect(within(pong, 'pong')).resolves.toContain('PONG');
      socket.terminate();
      socket = null;
      await expect(authenticatePreviewUpgrade({ sessionId, ticket: ticket.token, origin: 'https://owner.example' }, pool, key, 'https://owner.example')).rejects.toThrow('PREVIEW_TICKET_CONSUMED');
      const other = issuePreviewTicket(sessionId, randomUUID(), key);
      await expect(authenticatePreviewUpgrade({ sessionId, ticket: other.token, origin: 'https://evil.example' }, pool, key, 'https://owner.example')).rejects.toThrow('PREVIEW_ORIGIN_REJECTED');
    } finally {
      socket?.terminate();
      await within(app.close(), 'close');
    }
  });
});
