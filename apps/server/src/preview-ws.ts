import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Socket } from 'node:net';
import type { DatabasePool } from '@kcml/database';
import { consumePreviewTicket } from '@kcml/browser-preview-protocol';

function wsFrame(payload: string): Buffer {
  const body = Buffer.from(payload, 'utf8');
  if (body.length < 126) return Buffer.concat([Buffer.from([0x81, body.length]), body]);
  if (body.length <= 0xffff) {
    const header = Buffer.allocUnsafe(4);
    header[0] = 0x81; header[1] = 126; header.writeUInt16BE(body.length, 2);
    return Buffer.concat([header, body]);
  }
  const header = Buffer.allocUnsafe(10);
  header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(body.length), 2);
  return Buffer.concat([header, body]);
}

function ticketFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function installPreviewWebSocket(app: FastifyInstance, pool: DatabasePool, previewKey: Buffer): void {
  app.server.on('upgrade', (request, socket) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const match = /^\/api\/v1\/browser-sessions\/([0-9a-f-]{36})\/preview\/ws$/iu.exec(url.pathname);
      if (!match) return;
      const sessionId = match[1]!;
      const ticket = url.searchParams.get('ticket');
      const websocketKey = request.headers['sec-websocket-key'];
      if (!ticket || typeof websocketKey !== 'string' || request.headers.upgrade?.toLowerCase() !== 'websocket') {
        socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
      }
      let consumed;
      try { consumed = consumePreviewTicket(ticket, previewKey); } catch {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
      }
      if (consumed.sessionId !== sessionId) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
      }
      const fingerprint = ticketFingerprint(ticket);
      const consumedRow = await pool.query(`UPDATE kcml.browser_preview_ticket AS t
        SET lifecycle='CLOSED',document=t.document || jsonb_build_object('usedAt',clock_timestamp()),state_version=t.state_version+1,updated_at=clock_timestamp()
        WHERE t.stable_key=$1 AND t.lifecycle='ACTIVE' AND (t.document->>'expiresAt')::timestamptz>clock_timestamp() RETURNING id`, [fingerprint]);
      if (consumedRow.rowCount !== 1) {
        socket.write('HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
      }
      const accept = createHash('sha1').update(`${websocketKey}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
      const streamEpoch = BigInt(Date.now());
      let sequence = 1n;
      let lastRevision = '';
      const send = (value: unknown) => { if (!socket.destroyed) socket.write(wsFrame(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item))); };
      send({ kind: 'HELLO', protocol: 'KCML-PREVIEW/1', streamEpoch: streamEpoch.toString(), sessionId });
      const poll = async () => {
        const frame = await pool.query(`SELECT id,document,state_version,created_at FROM kcml.browser_preview_frame
          WHERE parent_id=$1 OR document->>'sessionId'=$1 ORDER BY created_at DESC LIMIT 1`, [sessionId]);
        const row = frame.rows[0];
        const revision = row ? `${row.id}:${row.state_version}` : '';
        if (row && revision !== lastRevision) {
          lastRevision = revision;
          send({ kind: 'VIDEO', streamEpoch: streamEpoch.toString(), sequence: (sequence++).toString(), ...(row.document ?? {}), frameId: row.id, createdAt: row.created_at });
        } else {
          send({ kind: 'HEARTBEAT', streamEpoch: streamEpoch.toString(), sentAt: new Date().toISOString() });
        }
      };
      const timer = setInterval(() => void poll().catch(() => { socket.destroy(); }), 1000);
      socket.once('close', () => clearInterval(timer));
      socket.once('error', () => clearInterval(timer));
      socket.on('data', (chunk: Buffer) => {
        if ((chunk[0] ?? 0) === 0x88) { clearInterval(timer); socket.end(); }
      });
    })().catch(() => { if (!(socket as Socket).destroyed) socket.destroy(); });
  });
}
