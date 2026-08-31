import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { spawn } from 'node:child_process';
import { chmod, unlink } from 'node:fs/promises';
import { z } from '@kcml/schemas';

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
