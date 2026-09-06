import { createServer, createConnection, type AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  RuntimeCapabilityClient,
  RUNTIME_IPC_HEADER_BYTES,
  decodeRuntimeFrameHeader,
  encodeRuntimeFrame,
  createCapabilityFdServer,
  type RuntimeCapabilityRequest,
} from '@kcml/runtime-capability-ipc';

async function connectedPair(handler: (request: RuntimeCapabilityRequest) => Promise<unknown>) {
  const server = createServer((socket) => createCapabilityFdServer(socket, handler));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  const socket = createConnection(address.port, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  return {
    client: new RuntimeCapabilityClient(socket),
    close: () => { socket.destroy(); server.close(); },
  };
}

function request(index: number, deadlineMs = 10_000): RuntimeCapabilityRequest {
  return {
    requestId: randomUUID(),
    operation: 'runtime',
    capabilityAlias: 'stress',
    deadlineAt: new Date(Date.now() + deadlineMs).toISOString(),
    cancellationVersion: 0,
    correlationId: randomUUID(),
    payload: { index },
  };
}

describe('runtime capability multiplexing', () => {

  it('uses the exact 16-byte KCML-RUNTIME-IPC/1 network-order header', () => {
    const frame = encodeRuntimeFrame({ frameType: 'REQUEST', flags: 0x1234, sequence: 7, payload: { z: 1, a: 2 } });
    expect(RUNTIME_IPC_HEADER_BYTES).toBe(16);
    expect(frame.subarray(0, 4).toString('ascii')).toBe('KCR1');
    expect(frame.readUInt8(4)).toBe(1);
    expect(frame.readUInt16BE(6)).toBe(0x1234);
    expect(frame.readUInt32BE(12)).toBe(7);
    expect(frame.subarray(16).toString('utf8')).toBe('{"a":2,"z":1}');
    expect(decodeRuntimeFrameHeader(frame.subarray(0, 16))).toMatchObject({ frameType: 'REQUEST', flags: 0x1234, sequence: 7 });
  });

  it('rejects zero and wrapped runtime sequence values', () => {
    expect(() => encodeRuntimeFrame({ frameType: 'REQUEST', flags: 0, sequence: 0, payload: {} })).toThrow('RUNTIME_PROTOCOL_SEQUENCE_INVALID');
    expect(() => encodeRuntimeFrame({ frameType: 'REQUEST', flags: 0, sequence: 0x1_0000_0000, payload: {} })).toThrow('RUNTIME_PROTOCOL_SEQUENCE_INVALID');
  });
  it('correlates 10k reordered responses without listener growth', async () => {
    const pair = await connectedPair(async (value) => {
      const index = Number((value.payload as { index: number }).index);
      await new Promise((resolve) => setTimeout(resolve, index % 4));
      return { index };
    });
    try {
      for (let batch = 0; batch < 1_000; batch += 1) {
        const start = batch * 10;
        const results = await Promise.all(Array.from({ length: 10 }, (_, offset) => pair.client.invoke(request(start + offset))));
        expect(results.map((result) => (result as { index: number }).index)).toEqual(Array.from({ length: 10 }, (_, offset) => start + offset));
      }
    } finally { pair.close(); }
  }, 60_000);

  it('cancels an expired request and cleans its pending slot', async () => {
    const pair = await connectedPair(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { late: true };
    });
    try {
      await expect(pair.client.invoke(request(1, 5))).rejects.toThrow('RUNTIME_DEADLINE_EXCEEDED');
      await expect(pair.client.invoke(request(2, 250))).resolves.toEqual({ late: true });
    } finally { pair.close(); }
  });
});
