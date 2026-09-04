import { createHash, randomUUID } from 'node:crypto';
import { chmod, link, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { dirname, join } from 'node:path';
import { z } from '@kcml/schemas';

const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
const MAX_FRAME_BYTES = Math.ceil(MAX_ARTIFACT_BYTES * 4 / 3) + 16 * 1024;
const requestSchema = z.object({
  protocol: z.literal('KCML-BROWSER-ARTIFACT/1'),
  requestId: z.string().uuid(),
  deadlineAt: z.string().datetime({ offset: true }),
  kind: z.literal('PUT'),
  sessionId: z.string().uuid(),
  actionId: z.string().uuid(),
  actionFence: z.coerce.bigint().positive(),
  contentDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  sizeBytes: z.number().int().nonnegative().max(MAX_ARTIFACT_BYTES),
  mimeType: z.enum(['image/jpeg', 'image/png']),
  contentBase64: z.string().min(1)
}).strict();
export type BrowserArtifactPutRequest = z.infer<typeof requestSchema>;
const responseSchema = z.object({
  protocol: z.literal('KCML-BROWSER-ARTIFACT/1'), requestId: z.string().uuid(), ok: z.boolean(),
  artifact: z.object({ storageReference: z.string().regex(/^artifact:sha256:[a-f0-9]{64}$/u), contentDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u), sizeBytes: z.number().int().nonnegative(), mimeType: z.string() }).strict().optional(),
  error: z.object({ code: z.string(), message: z.string() }).strict().optional()
}).strict();
export type BrowserArtifactPutResponse = z.infer<typeof responseSchema>;

/** The only process allowed to turn browser-produced bytes into durable artifacts. */
export class BrowserArtifactOwnerServer {
  #server: Server | null = null;
  public constructor(private readonly socketPath: string, private readonly artifactRoot: string) {}
  public async start(): Promise<void> {
    await mkdir(this.artifactRoot, { recursive: true, mode: 0o700 });
    await mkdir(dirname(this.socketPath), { recursive: true, mode: 0o750 });
    await unlink(this.socketPath).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
    this.#server = createServer(socket => this.accept(socket));
    await new Promise<void>((resolve, reject) => { this.#server!.once('error', reject); this.#server!.listen(this.socketPath, () => { this.#server!.off('error', reject); resolve(); }); });
    await chmod(this.socketPath, 0o660);
  }
  public async stop(): Promise<void> {
    await new Promise<void>(resolve => this.#server?.close(() => resolve()) ?? resolve());
    this.#server = null;
    await unlink(this.socketPath).catch(() => undefined);
  }
  private accept(socket: Socket): void {
    let pending = '';
    socket.setTimeout(35_000, () => socket.destroy(new Error('BROWSER_ARTIFACT_IDLE_TIMEOUT')));
    socket.on('data', (chunk: Buffer) => {
      pending += chunk.toString('utf8');
      if (Buffer.byteLength(pending) > MAX_FRAME_BYTES) { socket.destroy(new Error('BROWSER_ARTIFACT_FRAME_TOO_LARGE')); return; }
      const newline = pending.indexOf('\n');
      if (newline >= 0) void this.respond(socket, pending.slice(0, newline));
    });
  }
  private async respond(socket: Socket, frame: string): Promise<void> {
    let requestId: string = randomUUID();
    try {
      const raw = JSON.parse(frame) as { requestId?: unknown };
      if (typeof raw.requestId === 'string') requestId = raw.requestId;
      const request = requestSchema.parse(raw);
      if (new Date(request.deadlineAt).getTime() <= Date.now()) throw new Error('BROWSER_ARTIFACT_DEADLINE_EXCEEDED');
      const content = Buffer.from(request.contentBase64, 'base64');
      if (content.toString('base64') !== request.contentBase64) throw new Error('BROWSER_ARTIFACT_ENCODING_INVALID');
      if (content.length !== request.sizeBytes) throw new Error('BROWSER_ARTIFACT_SIZE_MISMATCH');
      const digest = createHash('sha256').update(content).digest('hex');
      if (`sha256:${digest}` !== request.contentDigest) throw new Error('BROWSER_ARTIFACT_DIGEST_MISMATCH');
      const path = join(this.artifactRoot, digest);
      const temporaryPath = join(this.artifactRoot, `.pending-${request.requestId}`);
      const handle = await open(temporaryPath, 'wx', 0o600);
      try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
      try { await link(temporaryPath, path); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const existing = await readFile(path);
        if (existing.length !== content.length || !createHash('sha256').update(existing).digest().equals(Buffer.from(digest, 'hex'))) throw new Error('BROWSER_ARTIFACT_EXISTING_CONTENT_INVALID');
      } finally { await unlink(temporaryPath).catch(() => undefined); }
      const directory = await open(this.artifactRoot, 'r'); try { await directory.sync(); } finally { await directory.close(); }
      this.write(socket, { protocol: 'KCML-BROWSER-ARTIFACT/1', requestId, ok: true, artifact: { storageReference: `artifact:sha256:${digest}`, contentDigest: `sha256:${digest}`, sizeBytes: content.length, mimeType: request.mimeType } });
    } catch (error) {
      this.write(socket, { protocol: 'KCML-BROWSER-ARTIFACT/1', requestId, ok: false, error: { code: error instanceof Error ? error.message.split(':')[0]! : 'BROWSER_ARTIFACT_FAILURE', message: error instanceof Error ? error.message : String(error) } });
    }
  }
  private write(socket: Socket, response: BrowserArtifactPutResponse): void { socket.end(`${JSON.stringify(response)}\n`); }
}

export class BrowserArtifactOwnerClient {
  public constructor(private readonly socketPath: string) {}
  public put(input: Omit<BrowserArtifactPutRequest, 'protocol' | 'requestId' | 'deadlineAt' | 'kind'>): Promise<BrowserArtifactPutResponse> {
    const request = requestSchema.parse({ protocol: 'KCML-BROWSER-ARTIFACT/1', requestId: randomUUID(), deadlineAt: new Date(Date.now() + 30_000).toISOString(), kind: 'PUT', ...input });
    return new Promise((resolve, reject) => {
      const socket = createConnection(this.socketPath); let pending = '';
      socket.setTimeout(30_000, () => socket.destroy(new Error('BROWSER_ARTIFACT_DEADLINE_EXCEEDED')));
      socket.once('error', reject);
      socket.on('data', (chunk: Buffer) => { pending += chunk.toString('utf8'); if (Buffer.byteLength(pending) > 64 * 1024) { socket.destroy(new Error('BROWSER_ARTIFACT_RESPONSE_TOO_LARGE')); return; } const newline = pending.indexOf('\n'); if (newline < 0) return; try { const response = responseSchema.parse(JSON.parse(pending.slice(0, newline))); if (response.requestId !== request.requestId) throw new Error('BROWSER_ARTIFACT_REQUEST_MISMATCH'); socket.end(); resolve(response); } catch (error) { socket.destroy(); reject(error); } });
      socket.once('connect', () => socket.write(`${JSON.stringify(request, (_, value) => typeof value === 'bigint' ? value.toString() : value)}\n`));
    });
  }
}
