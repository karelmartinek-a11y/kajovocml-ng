import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import websocket from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';
import type { DatabasePool } from '@kcml/database';
import { consumePreviewTicket } from '@kcml/browser-preview-protocol';
import { z } from '@kcml/schemas';

const MAX_PREVIEW_ARTIFACT_BYTES = 8 * 1024 * 1024;
const MAX_BUFFERED_BYTES = 2 * 1024 * 1024;
const previewQuerySchema = z.object({ ticket: z.string().min(1).max(4096) }).strict();
const previewParamsSchema = z.object({ sessionId: z.string().uuid() }).strict();
const kbppClientMessageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ACK'), streamEpoch: z.string().regex(/^\d+$/u), sequence: z.string().regex(/^\d+$/u) }).strict(),
  z.object({ kind: z.literal('PING'), sentAt: z.string().datetime({ offset: true }) }).strict(),
]);

function digest(value: Buffer): Buffer { return createHash('sha256').update(value).digest(); }

export class BrowserArtifactOwnerPort {
  public constructor(private readonly root: string | null) {}
  public async read(locator: string, expectedDigest: Buffer, expectedSize: bigint): Promise<Buffer> {
    if (!this.root) throw new Error('BROWSER_ARTIFACT_ROOT_UNAVAILABLE');
    const match = /^artifact:sha256:([0-9a-f]{64})$/u.exec(locator);
    const digestHex = match?.[1];
    if (!digestHex || !Buffer.from(digestHex, 'hex').equals(expectedDigest)) throw new Error('BROWSER_ARTIFACT_INVALID');
    const root = await realpath(this.root);
    const candidate = join(root, digestHex);
    const candidateStat = await lstat(candidate);
    if (candidateStat.isSymbolicLink()) throw new Error('BROWSER_ARTIFACT_INVALID');
    const resolved = await realpath(candidate);
    const scope = relative(root, resolved);
    if (scope.startsWith('..') || isAbsolute(scope)) throw new Error('BROWSER_ARTIFACT_INVALID');
    if (!candidateStat.isFile() || candidateStat.size > MAX_PREVIEW_ARTIFACT_BYTES || BigInt(candidateStat.size) !== expectedSize) throw new Error('BROWSER_ARTIFACT_INVALID');
    const content = await readFile(resolved);
    if (!digest(content).equals(expectedDigest)) throw new Error('BROWSER_ARTIFACT_INVALID');
    return content;
  }
}

function ticketFingerprint(token: string): Buffer { return createHash('sha256').update(token).digest(); }

export async function authenticatePreviewUpgrade(
  input: { sessionId: string; ticket: string; origin: string | undefined },
  pool: DatabasePool,
  previewKey: Buffer | null,
  publicOrigin: string | null,
): Promise<void> {
  if (!previewKey || !publicOrigin) throw new Error('PREVIEW_UNAVAILABLE');
  if (input.origin !== publicOrigin) throw new Error('PREVIEW_ORIGIN_REJECTED');
  const consumed = consumePreviewTicket(input.ticket, previewKey);
  if (consumed.sessionId !== input.sessionId) throw new Error('PREVIEW_SESSION_REJECTED');
  const consumedRow = await pool.query(`UPDATE kcml.browser_preview_ticket AS t
    SET lifecycle='CLOSED',used_at=clock_timestamp(),state_version=t.state_version+1,updated_at=clock_timestamp()
    WHERE t.token_fingerprint=$1 AND t.lifecycle='ACTIVE' AND t.used_at IS NULL AND t.revoked_at IS NULL AND t.expires_at>clock_timestamp() RETURNING id`, [ticketFingerprint(input.ticket)]);
  if (consumedRow.rowCount !== 1) throw new Error('PREVIEW_TICKET_CONSUMED');
}

export interface PreviewWebSocketOptions { publicOrigin?: string | null; artifactRoot?: string | null }

export async function installPreviewWebSocket(app: FastifyInstance, pool: DatabasePool, previewKey: Buffer | null, options: PreviewWebSocketOptions = {}): Promise<void> {
  const publicOrigin = options.publicOrigin ?? process.env.KCML_PUBLIC_ORIGIN ?? null;
  const artifacts = new BrowserArtifactOwnerPort(options.artifactRoot ?? process.env.KCML_ARTIFACT_ROOT ?? null);
  await app.register(websocket, {
    options: { maxPayload: 16 * 1024, clientTracking: false, perMessageDeflate: false },
    errorHandler: (_error, socket) => socket.close(1011, 'preview protocol error'),
  });
  app.get('/api/v1/browser-sessions/:sessionId/preview/ws', {
    websocket: true,
    preValidation: async (request, reply) => {
      const { sessionId } = previewParamsSchema.parse(request.params);
      const { ticket } = previewQuerySchema.parse(request.query);
      try { await authenticatePreviewUpgrade({ sessionId, ticket, origin: request.headers.origin }, pool, previewKey, publicOrigin); }
      catch (error) {
        const code = error instanceof Error ? error.message : 'PREVIEW_UNAVAILABLE';
        const status = code === 'PREVIEW_UNAVAILABLE' ? 503 : code === 'PREVIEW_TICKET_CONSUMED' ? 409 : 403;
        return reply.code(status).send({ error: code });
      }
    },
  }, (socket, request) => {
    const { sessionId } = previewParamsSchema.parse(request.params);
    const streamEpoch = BigInt(Date.now());
    let sequence = 1n;
    let lastRevision = '';
    let polling = false;
    const send = (value: unknown) => {
      if (socket.readyState !== 1) return;
      if (socket.bufferedAmount > MAX_BUFFERED_BYTES) { socket.close(1013, 'preview backpressure'); return; }
      socket.send(JSON.stringify(value));
    };
    send({ kind: 'HELLO', protocol: 'KCML-PREVIEW/1', streamEpoch: streamEpoch.toString(), sessionId });
    socket.on('message', (raw, binary) => {
      if (binary) { socket.close(1003, 'text messages required'); return; }
      try {
        const message = kbppClientMessageSchema.parse(JSON.parse(raw.toString('utf8')));
        if (message.kind === 'PING') send({ kind: 'PONG', sentAt: message.sentAt, receivedAt: new Date().toISOString() });
      } catch { socket.close(1007, 'invalid KBPP message'); }
    });
    const poll = async () => {
      if (polling || socket.readyState !== 1) return;
      polling = true;
      try {
        const frame = await pool.query(`SELECT f.id,f.frame_revision,f.page_id,f.mime_type,f.size_bytes,a.storage_reference,a.artifact_digest
          FROM kcml.browser_preview_frame f JOIN kcml.browser_automation_artifact a ON a.id=f.image_artifact_id
          WHERE f.session_id=$1 AND f.cleanup_state NOT IN ('REMOVED','FAILED') AND a.cleanup_state NOT IN ('REMOVED','FAILED')
          ORDER BY f.stream_epoch DESC,f.frame_revision DESC LIMIT 1`, [sessionId]);
        const row = frame.rows[0];
        const revision = row ? `${row.id}:${row.frame_revision}` : '';
        if (row && revision !== lastRevision) {
          const image = await artifacts.read(String(row.storage_reference), Buffer.from(row.artifact_digest), BigInt(row.size_bytes));
          lastRevision = revision;
          send({ kind: 'VIDEO', streamEpoch: streamEpoch.toString(), sequence: (sequence++).toString(), pageId: row.page_id, mimeType: row.mime_type, dataBase64: image.toString('base64'), viewportRevision: String(row.frame_revision) });
        } else send({ kind: 'HEARTBEAT', streamEpoch: streamEpoch.toString(), sentAt: new Date().toISOString() });
      } finally { polling = false; }
    };
    const timer = setInterval(() => void poll().catch(() => socket.close(1011, 'artifact read failed')), 1_000);
    socket.once('close', () => clearInterval(timer));
    socket.once('error', () => clearInterval(timer));
  });
}
