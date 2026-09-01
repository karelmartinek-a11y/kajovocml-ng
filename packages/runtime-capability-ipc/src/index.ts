import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { spawn } from 'node:child_process';
import { chmod, unlink } from 'node:fs/promises';
import { z } from '@kcml/schemas';

/** The anonymous handler channel is deliberately separate from the legacy
 * broker UDS API below. It carries no bearer key or server identity envelope;
 * the trusted runtime host supplies that context after validating the child.
 */
export const RUNTIME_IPC_PROTOCOL = 'KCML-RUNTIME-IPC/1' as const;
export const RUNTIME_IPC_MAGIC = Buffer.from('KCR1', 'ascii');
export const RUNTIME_IPC_MAX_PAYLOAD = 1024 * 1024;
export const RUNTIME_IPC_HEADER_BYTES = 16;

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

export function encodeRuntimeFrame(frame: RuntimeFrame): Buffer {
  const frameType = runtimeFrameType[frame.frameType];
  if (!frameType) throw new Error('RUNTIME_PROTOCOL_UNKNOWN_FRAME');
  const payload = Buffer.from(JSON.stringify(frame.payload), 'utf8');
  if (payload.length > RUNTIME_IPC_MAX_PAYLOAD) throw new Error('RUNTIME_PAYLOAD_TOO_LARGE');
  if (!Number.isSafeInteger(frame.sequence) || frame.sequence < 0 || frame.sequence > 0xffffffff) throw new Error('RUNTIME_PROTOCOL_SEQUENCE_INVALID');
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
  return { frameType, flags: header.readUInt16BE(6), payloadLength, sequence: header.readUInt32BE(12) };
}

function consumeRuntimeFrames(socket: Socket, onFrame: (frame: RuntimeFrame) => Promise<void>): void {
  let pending = Buffer.alloc(0);
  let expectedSequence = 0;
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
      if (header.sequence !== expectedSequence) {
        socket.destroy(new Error('RUNTIME_PROTOCOL_SEQUENCE_INVALID'));
        return;
      }
      if (pending.length < RUNTIME_IPC_HEADER_BYTES + header.payloadLength) return;
      const payloadBytes = pending.subarray(RUNTIME_IPC_HEADER_BYTES, RUNTIME_IPC_HEADER_BYTES + header.payloadLength);
      pending = pending.subarray(RUNTIME_IPC_HEADER_BYTES + header.payloadLength);
      expectedSequence += 1;
      let payload: unknown;
      try { payload = JSON.parse(payloadBytes.toString('utf8')); } catch { socket.destroy(new Error('RUNTIME_PROTOCOL_INVALID_JSON')); return; }
      void onFrame({ frameType: header.frameType, flags: header.flags, sequence: header.sequence, payload }).catch((error: unknown) => socket.destroy(error instanceof Error ? error : new Error(String(error))));
    }
  });
}

export function createCapabilityFdServer(socket: Socket, handler: (request: RuntimeCapabilityRequest) => Promise<unknown>): void {
  let responseSequence = 0;
  consumeRuntimeFrames(socket, async (frame) => {
    if (frame.frameType !== 'REQUEST') throw new Error('RUNTIME_PROTOCOL_UNEXPECTED_FRAME');
    const request = runtimeCapabilityRequestSchema.parse(frame.payload);
    const payload = await handler(request);
    socket.write(encodeRuntimeFrame({ frameType: 'RESPONSE', flags: 0, sequence: responseSequence++, payload: { requestId: request.requestId, payload } }));
  });
}

export function invokeCapabilityOnFd(socket: Socket, request: RuntimeCapabilityRequest): Promise<unknown> {
  const validated = runtimeCapabilityRequestSchema.parse(request);
  socket.write(encodeRuntimeFrame({ frameType: 'REQUEST', flags: 0, sequence: 0, payload: validated }));
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    socket.once('error', onError);
    consumeRuntimeFrames(socket, async (frame) => {
      if (frame.frameType !== 'RESPONSE') throw new Error('RUNTIME_PROTOCOL_UNEXPECTED_FRAME');
      const response = z.object({ requestId: z.string().uuid(), payload: z.unknown() }).strict().parse(frame.payload);
      if (response.requestId !== validated.requestId) throw new Error('RUNTIME_PROTOCOL_REQUEST_MISMATCH');
      socket.off('error', onError);
      resolve(response.payload);
    });
  });
}

export const capabilityRequestSchema = z.object({
  protocol: z.literal('KCML-CAPABILITY-IPC/1'),
  requestId: z.string().uuid(),
  executionId: z.string().uuid(),
  capability: z.enum(['STATE_READ','STATE_WRITE','SECRET_USE','EGRESS_REQUEST','ARTIFACT_READ','ARTIFACT_WRITE','CHILD_EXEC']),
  operation: z.string().min(1),
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
  return Buffer.from(JSON.stringify(value), 'utf8');
}

export function signRequest(value: Omit<CapabilityRequest, 'mac' | 'nonce'>, channelKey: Buffer): CapabilityRequest {
  const unsigned = { ...value, nonce: randomBytes(16).toString('hex') };
  return capabilityRequestSchema.parse({ ...unsigned, mac: createHmac('sha256', channelKey).update(authenticatedBytes(unsigned)).digest('hex') });
}

export function verifyRequest(value: unknown, channelKey: Buffer, now = new Date()): CapabilityRequest {
  const request = capabilityRequestSchema.parse(value);
  const { mac, ...unsigned } = request;
  const expected = createHmac('sha256', channelKey).update(authenticatedBytes(unsigned)).digest();
  const actual = Buffer.from(mac, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('IPC_AUTHENTICATION_FAILED');
  if (new Date(request.deadlineAt) <= now) throw new Error('IPC_DEADLINE_EXCEEDED');
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
  const output=await new Promise<string>((resolve,reject)=>{const child=spawn(helper,['3'],{stdio:['ignore','pipe','pipe',socket]});let stdout='';let stderr='';child.stdout?.on('data',(value:Buffer)=>stdout+=value.toString('utf8'));child.stderr?.on('data',(value:Buffer)=>stderr+=value.toString('utf8'));child.once('error',reject);child.once('exit',code=>code===0?resolve(stdout):reject(new Error(`PEERCRED_HELPER_FAILED:${code}:${stderr.trim()}`)));});
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
  const inherited=Number(process.env.LISTEN_FDS??0)>0&&Number(process.env.LISTEN_PID??0)===process.pid;
  if(!inherited)await unlink(socketPath).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
  const server = createServer((socket) => {
    void verifyPeer(socket).then(()=>consumeFrames(socket, async (value) => {
      const shape = z.object({ executionId: z.string().uuid() }).passthrough().parse(value);
      const request = verifyRequest(value, await channelKeyForExecution(shape.executionId));
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
