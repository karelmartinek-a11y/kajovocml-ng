import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { spawn } from 'node:child_process';
import { chmod, unlink } from 'node:fs/promises';
import { canonicalJson, toCanonicalJsonValue, type CanonicalJsonValue, z } from '@kcml/schemas';

/** The anonymous handler channel is deliberately separate from the legacy
 * broker UDS API below. It carries no bearer key or server identity envelope;
 * the trusted runtime host supplies that context after validating the child.
 */
export const RUNTIME_IPC_PROTOCOL = 'KCML-RUNTIME-IPC/1' as const;
export const RUNTIME_IPC_MAGIC = Buffer.from('KCR1', 'ascii');
export const RUNTIME_IPC_MAX_PAYLOAD = 1024 * 1024;
export const RUNTIME_IPC_MAX_UNARY = 16 * 1024 * 1024;
export const RUNTIME_IPC_MAX_STREAM_CHUNK = 64 * 1024;
export const RUNTIME_IPC_HEADER_BYTES = 16;
export const RUNTIME_IPC_MAX_PENDING = 32;

export const runtimeFrameType = {
  HELLO: 1, READY: 2, REQUEST: 3, RESPONSE: 4, ERROR: 5, STREAM_OPEN: 6,
  STREAM_CHUNK: 7, STREAM_CREDIT: 8, STREAM_END: 9, CANCEL: 10,
  SHUTDOWN: 11, HEARTBEAT: 12
} as const;
export type RuntimeFrameType = keyof typeof runtimeFrameType;

export interface RuntimeFrame {
  frameType: RuntimeFrameType;
  flags: number;
  sequence: number;
  payload: unknown;
}

export const runtimeCapabilityRequestSchema = z.object({
  requestId: z.string().uuid(),
  operation: z.enum(['secret', 'callComponent', 'callExternal', 'state', 'logger', 'runtime']),
  capabilityAlias: z.string().min(1).max(256).nullable(),
  deadlineAt: z.string().datetime({ offset: true }),
  cancellationVersion: z.number().int().nonnegative(),
  correlationId: z.string().uuid(),
  payload: z.unknown()
}).strict();
export type RuntimeCapabilityRequest = z.infer<typeof runtimeCapabilityRequestSchema>;

function runtimePayloadBytes(frame: RuntimeFrame): Buffer {
  if (frame.frameType === 'STREAM_CHUNK') {
    if (!Buffer.isBuffer(frame.payload)) throw new Error('RUNTIME_PROTOCOL_STREAM_CHUNK_INVALID');
    if (frame.payload.length > RUNTIME_IPC_MAX_STREAM_CHUNK) throw new Error('RUNTIME_PAYLOAD_TOO_LARGE');
    return frame.payload;
  }
  return Buffer.from(canonicalJson(toCanonicalJsonValue(frame.payload)), 'utf8');
}

export function encodeRuntimeFrame(frame: RuntimeFrame): Buffer {
  const frameType = runtimeFrameType[frame.frameType];
  if (!frameType) throw new Error('RUNTIME_PROTOCOL_UNKNOWN_FRAME');
  const payload = runtimePayloadBytes(frame);
  if (payload.length > RUNTIME_IPC_MAX_PAYLOAD) throw new Error('RUNTIME_PAYLOAD_TOO_LARGE');
  if (!Number.isSafeInteger(frame.sequence) || frame.sequence < 1 || frame.sequence > 0xffffffff) throw new Error('RUNTIME_PROTOCOL_SEQUENCE_INVALID');
  const header = Buffer.alloc(RUNTIME_IPC_HEADER_BYTES);
  RUNTIME_IPC_MAGIC.copy(header, 0);
  header.writeUInt8(1, 4);
  header.writeUInt8(frameType, 5);
  header.writeUInt16BE(frame.flags, 6);
  header.writeUInt32BE(payload.length, 8);
  header.writeUInt32BE(frame.sequence, 12);
  return Buffer.concat([header, payload]);
}

export function decodeRuntimeFrameHeader(header: Buffer): { frameType: RuntimeFrameType; flags: number; payloadLength: number; sequence: number } {
  if (header.length !== RUNTIME_IPC_HEADER_BYTES || !header.subarray(0, 4).equals(RUNTIME_IPC_MAGIC) || header.readUInt8(4) !== 1) throw new Error('RUNTIME_PROTOCOL_INVALID_HEADER');
  const frameType = (Object.entries(runtimeFrameType).find(([, value]) => value === header.readUInt8(5))?.[0] ?? null) as RuntimeFrameType | null;
  if (!frameType) throw new Error('RUNTIME_PROTOCOL_UNKNOWN_FRAME');
  const payloadLength = header.readUInt32BE(8);
  if (payloadLength > RUNTIME_IPC_MAX_PAYLOAD) throw new Error('RUNTIME_PAYLOAD_TOO_LARGE');
  const sequence = header.readUInt32BE(12);
  if (sequence < 1) throw new Error('RUNTIME_PROTOCOL_SEQUENCE_INVALID');
  return { frameType, flags: header.readUInt16BE(6), payloadLength, sequence };
}

function consumeRuntimeFrames(socket: Socket, onFrame: (frame: RuntimeFrame) => Promise<void>): void {
  let pending = Buffer.alloc(0);
  let expectedSequence = 1;
  socket.on('data', (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= RUNTIME_IPC_HEADER_BYTES) {
      let header: ReturnType<typeof decodeRuntimeFrameHeader>;
      try {
        header = decodeRuntimeFrameHeader(pending.subarray(0, RUNTIME_IPC_HEADER_BYTES));
      } catch (error: unknown) {
        socket.destroy(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      if (expectedSequence === 0) {
        socket.destroy(new Error('RUNTIME_PROTOCOL_SEQUENCE_WRAP'));
        return;
      }
      if (header.sequence !== expectedSequence) {
        socket.destroy(new Error('RUNTIME_PROTOCOL_SEQUENCE_INVALID'));
        return;
      }
      if (pending.length < RUNTIME_IPC_HEADER_BYTES + header.payloadLength) return;
      const payloadBytes = pending.subarray(RUNTIME_IPC_HEADER_BYTES, RUNTIME_IPC_HEADER_BYTES + header.payloadLength);
      pending = pending.subarray(RUNTIME_IPC_HEADER_BYTES + header.payloadLength);
      expectedSequence = expectedSequence === 0xffffffff ? 0 : expectedSequence + 1;
      let payload: unknown;
      if (header.frameType === 'STREAM_CHUNK') payload = Buffer.from(payloadBytes);
      else { try { payload = JSON.parse(payloadBytes.toString('utf8')); } catch { socket.destroy(new Error('RUNTIME_PROTOCOL_INVALID_JSON')); return; } }
      void onFrame({ frameType: header.frameType, flags: header.flags, sequence: header.sequence, payload }).catch((error: unknown) => socket.destroy(error instanceof Error ? error : new Error(String(error))));
    }
  });
}

export function createCapabilityFdServer(socket: Socket, handler: (request: RuntimeCapabilityRequest) => Promise<unknown>): void {
  let responseSequence = 1;
  const cancelled = new Set<string>();
  consumeRuntimeFrames(socket, async (frame) => {
    if (frame.frameType === 'CANCEL') {
      const requestId = z.object({ requestId: z.string().uuid() }).strict().parse(frame.payload).requestId;
      cancelled.add(requestId);
      return;
    }
    if (frame.frameType !== 'REQUEST') throw new Error('RUNTIME_PROTOCOL_UNEXPECTED_FRAME');
    const request = runtimeCapabilityRequestSchema.parse(frame.payload);
    const payload = await handler(request);
    if (cancelled.delete(request.requestId)) return;
    socket.write(encodeRuntimeFrame({ frameType: 'RESPONSE', flags: 0, sequence: responseSequence++, payload: { requestId: request.requestId, payload } }));
  });
}

type PendingRuntimeCall = { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: NodeJS.Timeout };

export class RuntimeCapabilityClient {
  readonly #pending = new Map<string, PendingRuntimeCall>();
  readonly #cancelled = new Set<string>();
  #sequence = 1;
  #closed = false;

  public constructor(private readonly socket: Socket, private readonly maxPending = RUNTIME_IPC_MAX_PENDING) {
    consumeRuntimeFrames(socket, async (frame) => {
      if (frame.frameType !== 'RESPONSE' && frame.frameType !== 'ERROR') throw new Error('RUNTIME_PROTOCOL_UNEXPECTED_FRAME');
      const response = z.object({ requestId: z.string().uuid(), payload: z.unknown().optional(), error: z.string().optional() }).strict().parse(frame.payload);
      const pending = this.#pending.get(response.requestId);
      if (!pending && this.#cancelled.delete(response.requestId)) return;
      if (!pending) throw new Error('RUNTIME_PROTOCOL_REQUEST_MISMATCH');
      this.#pending.delete(response.requestId);
      clearTimeout(pending.timer);
      if (frame.frameType === 'ERROR') pending.reject(new Error(response.error ?? 'RUNTIME_REMOTE_ERROR'));
      else pending.resolve(response.payload);
    });
    const close = (error?: Error) => this.close(error ?? new Error('RUNTIME_CHANNEL_CLOSED'));
    socket.once('error', close);
    socket.once('close', () => close());
  }

  public async invoke(request: RuntimeCapabilityRequest): Promise<unknown> {
    if (this.#closed) throw new Error('RUNTIME_CHANNEL_CLOSED');
    const validated = runtimeCapabilityRequestSchema.parse(request);
    if (this.#pending.has(validated.requestId)) throw new Error('RUNTIME_DUPLICATE_REQUEST_ID');
    if (this.#pending.size >= this.maxPending) throw new Error('RUNTIME_STREAM_BACKPRESSURE');
    const deadline = new Date(validated.deadlineAt).getTime();
    if (!Number.isFinite(deadline) || deadline <= Date.now()) throw new Error('RUNTIME_DEADLINE_EXCEEDED');
    const response = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(validated.requestId);
        this.#cancelled.add(validated.requestId);
        this.write('CANCEL', { requestId: validated.requestId }).catch(() => undefined);
        reject(new Error('RUNTIME_DEADLINE_EXCEEDED'));
      }, deadline - Date.now());
      this.#pending.set(validated.requestId, { resolve, reject, timer });
    });
    try { await this.write('REQUEST', validated); }
    catch (error) {
      const pending = this.#pending.get(validated.requestId);
      if (pending) { clearTimeout(pending.timer); this.#pending.delete(validated.requestId); pending.reject(error instanceof Error ? error : new Error(String(error))); }
    }
    return response;
  }

  private async write(frameType: 'REQUEST' | 'CANCEL', payload: unknown): Promise<void> {
    if (this.#sequence > 0xffffffff) throw new Error('RUNTIME_PROTOCOL_SEQUENCE_WRAP');
    const sequence = this.#sequence;
    this.#sequence += 1;
    const frame = encodeRuntimeFrame({ frameType, flags: 0, sequence, payload });
    if (this.socket.write(frame)) return;
    await new Promise<void>((resolveDrain, reject) => {
      const onError = (error: Error) => { this.socket.off('drain', onDrain); reject(error); };
      const onDrain = () => { this.socket.off('error', onError); resolveDrain(); };
      this.socket.once('error', onError); this.socket.once('drain', onDrain);
    });
  }

  public close(error = new Error('RUNTIME_CHANNEL_CLOSED')): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const pending of this.#pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.#pending.clear();
    this.#cancelled.clear();
  }
}

const runtimeClients = new WeakMap<Socket, RuntimeCapabilityClient>();
export function invokeCapabilityOnFd(socket: Socket, request: RuntimeCapabilityRequest): Promise<unknown> {
  let client = runtimeClients.get(socket);
  if (!client) { client = new RuntimeCapabilityClient(socket); runtimeClients.set(socket, client); }
  return client.invoke(request);
}

export const capabilityRequestSchema = z.object({
  protocol: z.literal('KCML-CAPABILITY-IPC/1'),
  requestId: z.string().uuid(),
  executionId: z.string().uuid(),
  capability: z.enum(['STATE_READ','STATE_WRITE','SECRET_USE','EGRESS_REQUEST','ARTIFACT_READ','ARTIFACT_WRITE','CHILD_EXEC']),
  operation: z.string().min(1),
  channelGeneration: z.string().uuid(),
  capabilityBinding: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  issuedAt: z.string().datetime({ offset: true }),
  payload: z.unknown(),
  deadlineAt: z.string().datetime({ offset: true }),
  nonce: z.string().regex(/^[0-9a-f]{32}$/u),
  mac: z.string().regex(/^[0-9a-f]{64}$/u)
}).strict();
export type CapabilityRequest = z.infer<typeof capabilityRequestSchema>;

export const capabilityResponseSchema = z.object({
  protocol: z.literal('KCML-CAPABILITY-IPC/1'),
  requestId: z.string().uuid(),
  ok: z.boolean(),
  payload: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string() }).strict().optional()
}).strict();
export type CapabilityResponse = z.infer<typeof capabilityResponseSchema>;

const MAX_FRAME = 8 * 1024 * 1024;

function authenticatedBytes(value: Omit<CapabilityRequest, 'mac'>): Buffer {
  return Buffer.from(canonicalJson(JSON.parse(JSON.stringify(value)) as CanonicalJsonValue), 'utf8');
}

function capabilityBinding(value: Pick<CapabilityRequest, 'executionId' | 'capability' | 'operation' | 'channelGeneration'>): string {
  const digest = createHmac('sha256', Buffer.from('KCML-CAPABILITY-BINDING/1')).update(`${value.executionId}\0${value.capability}\0${value.operation}\0${value.channelGeneration}`).digest('hex');
  return `sha256:${digest}`;
}

export class CapabilityReplayLedger {
  readonly #entries = new Map<string, number>();
  public constructor(private readonly capacity = 10_000) {}
  public consume(request: CapabilityRequest, expiresAt: number, now = Date.now()): void {
    for (const [key, expiry] of this.#entries) if (expiry <= now) this.#entries.delete(key);
    const key = `${request.executionId}:${request.channelGeneration}:${request.nonce}`;
    if (this.#entries.has(key)) throw new Error('IPC_REPLAY_REJECTED');
    if (this.#entries.size >= this.capacity) throw new Error('IPC_REPLAY_LEDGER_CAPACITY');
    this.#entries.set(key, expiresAt);
  }
}

export function signRequest(
  value: Omit<CapabilityRequest, 'mac' | 'nonce' | 'issuedAt' | 'capabilityBinding' | 'channelGeneration'>,
  channelKey: Buffer,
  channelGeneration = value.executionId,
  now = new Date()
): CapabilityRequest {
  const bindingInput = { ...value, channelGeneration };
  const unsigned = { ...bindingInput, issuedAt: now.toISOString(), capabilityBinding: capabilityBinding(bindingInput), nonce: randomBytes(16).toString('hex') };
  return capabilityRequestSchema.parse({ ...unsigned, mac: createHmac('sha256', channelKey).update(authenticatedBytes(unsigned)).digest('hex') });
}

export function verifyRequest(value: unknown, channelKey: Buffer, now = new Date(), replayLedger?: CapabilityReplayLedger, expectedGeneration?: string): CapabilityRequest {
  const request = capabilityRequestSchema.parse(value);
  const { mac, ...unsigned } = request;
  const expected = createHmac('sha256', channelKey).update(authenticatedBytes(unsigned)).digest();
  const actual = Buffer.from(mac, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('IPC_AUTHENTICATION_FAILED');
  if (expectedGeneration && request.channelGeneration !== expectedGeneration) throw new Error('IPC_CHANNEL_GENERATION_STALE');
  if (request.capabilityBinding !== capabilityBinding(request)) throw new Error('IPC_CAPABILITY_BINDING_INVALID');
  const issuedAt = new Date(request.issuedAt).getTime();
  if (!Number.isFinite(issuedAt) || issuedAt > now.getTime() + 5_000 || issuedAt < now.getTime() - 120_000) throw new Error('IPC_REQUEST_STALE');
  if (new Date(request.deadlineAt) <= now) throw new Error('IPC_DEADLINE_EXCEEDED');
  replayLedger?.consume(request, new Date(request.deadlineAt).getTime(), now.getTime());
  return request;
}

function encodeFrame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  if (body.length > MAX_FRAME) throw new Error('IPC_FRAME_TOO_LARGE');
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(body.length);
  return Buffer.concat([prefix, body]);
}

function consumeFrames(socket: Socket, onFrame: (value: unknown) => Promise<void>): void {
  let pending = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 4) {
      const length = pending.readUInt32BE(0);
      if (length > MAX_FRAME) { socket.destroy(new Error('IPC_FRAME_TOO_LARGE')); return; }
      if (pending.length < length + 4) return;
      const body = pending.subarray(4, length + 4);
      pending = pending.subarray(length + 4);
      void onFrame(JSON.parse(body.toString('utf8'))).catch((error: unknown) => socket.destroy(error instanceof Error ? error : new Error(String(error))));
    }
  });
}

async function verifyPeer(socket:Socket):Promise<void>{
  const helper=process.env.KCML_PEERCRED_HELPER??'/usr/libexec/kajovocml-ng/kcml-peercred';
  const socketFd=(socket as Socket&{_handle?:{fd?:number}})._handle?.fd;
  if(!Number.isInteger(socketFd)||Number(socketFd)<0)throw new Error('IPC_PEER_SOCKET_FD_UNAVAILABLE');
  const output=await new Promise<string>((resolve,reject)=>{const child=spawn(helper,['3'],{stdio:['ignore','pipe','pipe',Number(socketFd)]});let stdout='';let stderr='';child.stdout?.on('data',(value:Buffer)=>stdout+=value.toString('utf8'));child.stderr?.on('data',(value:Buffer)=>stderr+=value.toString('utf8'));child.once('error',reject);child.once('exit',code=>code===0?resolve(stdout):reject(new Error(`PEERCRED_HELPER_FAILED:${code}:${stderr.trim()}`)));});
  const identity=z.object({pid:z.number().int().positive(),uid:z.number().int().nonnegative(),gid:z.number().int().nonnegative()}).parse(JSON.parse(output));
  const configured=(process.env.KCML_ALLOWED_PEER_UIDS??'').split(',').filter(Boolean).map(Number);
  if(process.env.NODE_ENV==='production'&&configured.length===0)throw new Error('IPC_PEER_ALLOWLIST_REQUIRED');
  if(configured.length>0&&!configured.includes(identity.uid))throw new Error('IPC_PEER_IDENTITY_DENIED');
}

export async function createCapabilityServer(
  socketPath: string,
  channelKeyForExecution: (executionId: string) => Promise<Buffer>,
  handler: (request: CapabilityRequest) => Promise<CapabilityResponse>
): Promise<Server> {
  const replayLedger = new CapabilityReplayLedger();
  const inherited=Number(process.env.LISTEN_FDS??0)>0&&Number(process.env.LISTEN_PID??0)===process.pid;
  if(!inherited)await unlink(socketPath).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
  const server = createServer((socket) => {
    void verifyPeer(socket).then(()=>consumeFrames(socket, async (value) => {
      const shape = z.object({ executionId: z.string().uuid() }).passthrough().parse(value);
      const request = verifyRequest(value, await channelKeyForExecution(shape.executionId), new Date(), replayLedger, shape.executionId);
      const response = await handler(request);
      socket.write(encodeFrame(capabilityResponseSchema.parse(response)));
    })).catch((error:unknown)=>socket.destroy(error instanceof Error?error:new Error(String(error))));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(inherited?{fd:3}:{path:socketPath}, () => { server.off('error', reject); resolve(); });
  });
  if(!inherited)await chmod(socketPath, 0o660);
  return server;
}

export async function invokeCapability(socketPath: string, request: CapabilityRequest): Promise<CapabilityResponse> {
  const socket = createConnection(socketPath);
  return new Promise<CapabilityResponse>((resolve, reject) => {
    socket.once('error', reject);
    consumeFrames(socket, async (value) => { resolve(capabilityResponseSchema.parse(value)); socket.end(); });
    socket.once('connect', () => socket.write(encodeFrame(request)));
  });
}
