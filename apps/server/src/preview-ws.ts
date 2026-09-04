import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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

function ticketFingerprint(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

export function installPreviewWebSocket(app: FastifyInstance, pool: DatabasePool, previewKey: Buffer | null): void {
  app.server.on('upgrade', (request, socket) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const match = /^\/api\/v1\/browser-sessions\/([0-9a-f-]{36})\/preview\/ws$/iu.exec(url.pathname);
      if (!match) return;
      if (!previewKey) {
        socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
      }
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
        SET lifecycle='CLOSED',used_at=clock_timestamp(),state_version=t.state_version+1,updated_at=clock_timestamp()
        WHERE t.token_fingerprint=$1 AND t.lifecycle='ACTIVE' AND t.used_at IS NULL AND t.revoked_at IS NULL AND t.expires_at>clock_timestamp() RETURNING id`, [fingerprint]);
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
        const frame = await pool.query(`SELECT f.id,f.frame_revision,f.page_id,f.mime_type,f.created_at,a.storage_reference
          FROM kcml.browser_preview_frame f LEFT JOIN kcml.browser_automation_artifact a ON a.id=f.image_artifact_id
          WHERE f.session_id=$1 AND f.cleanup_state NOT IN ('REMOVED','FAILED') ORDER BY f.stream_epoch DESC,f.frame_revision DESC LIMIT 1`, [sessionId]);
        const row = frame.rows[0];
        const revision = row ? `${row.id}:${row.frame_revision}` : '';
        if (row?.storage_reference && revision !== lastRevision) {
          lastRevision = revision;
          const image=await readFile(String(row.storage_reference));
          send({ kind: 'VIDEO', streamEpoch: streamEpoch.toString(), sequence: (sequence++).toString(), pageId:row.page_id,mimeType:row.mime_type,dataBase64:image.toString('base64'),viewportRevision:String(row.frame_revision) });
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
