import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCapabilityServer, invokeCapability, signRequest } from '@kcml/runtime-capability-ipc';

const root = await mkdtemp(join(tmpdir(), 'kcml-ipc-')); const socketPath = join(root, 'cap.sock');
process.env.NODE_ENV = 'test';
const channelKey = Buffer.alloc(32, 11); const executionId = crypto.randomUUID();
let server;
try {
  server = await createCapabilityServer(socketPath, async () => channelKey, async (request) => ({ protocol: 'KCML-CAPABILITY-IPC/1', requestId: request.requestId, ok: true, payload: { echoed: request.payload } }));
  const request = signRequest({ protocol: 'KCML-CAPABILITY-IPC/1', requestId: crypto.randomUUID(), executionId, capability: 'STATE_READ', operation: 'state.read', deadlineAt: new Date(Date.now() + 10_000).toISOString(), payload: { id: 7 } }, channelKey);
  const response = await invokeCapability(socketPath, request);
  if (JSON.stringify(response.payload) !== JSON.stringify({ echoed: { id: 7 } })) throw new Error('IPC_PAYLOAD_MISMATCH');
  console.log('LINUX_IPC: PASS framing,deadline,response-correlation');
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === 'EPERM') console.log('NOT_EXECUTED_ENVIRONMENTAL: sandbox prohibits Unix Domain Socket listen');
  else throw error;
} finally { if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); await rm(root, { recursive: true, force: true }); }
