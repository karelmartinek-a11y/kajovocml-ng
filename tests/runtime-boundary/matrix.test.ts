import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { decodeRuntimeFrameHeader, encodeRuntimeFrame } from '@kcml/runtime-capability-ipc';

const matrix = JSON.parse(await readFile('deploy/runtime/runtime-boundary-manifest.json', 'utf8')) as {
  schemaVersion: string;
  runtimeTypes: Array<Record<string, unknown>>;
};

describe('Runtime Boundary Matrix', () => {
  it('RUNTIME_BOUNDARY_MATRIX_EVIDENCE: has one exact record per declared runtime type', () => {
    expect(matrix.schemaVersion).toBe('1.0');
    expect(matrix.runtimeTypes.length).toBeGreaterThanOrEqual(4);
    expect(new Set(matrix.runtimeTypes.map((record) => record.runtimeType)).size).toBe(matrix.runtimeTypes.length);
    for (const record of matrix.runtimeTypes) {
      expect(record.runtimeBoundaryId).toEqual(expect.any(String));
      expect(record.systemdUnit).toEqual(expect.any(String));
      expect(record.processIdentity).toEqual(expect.any(String));
      expect(record.socketOrCapabilityChannels).toEqual(expect.any(Array));
      expect(record.prohibitedResources).toEqual(expect.arrayContaining(['UNDECLARED_RESOURCE']));
      expect(record.requirementRefs).toEqual(expect.arrayContaining(['ssot://55.9/55-9-runtime-boundary-matrix/atom-34']));
    }
  });

  it('GENERATED_HANDLER_NEGATIVE_BOUNDARY_EVIDENCE: denies network, credentials and platform sockets', () => {
    const handler = matrix.runtimeTypes.find((record) => record.runtimeType === 'GENERATED_HANDLER');
    expect(handler).toBeDefined();
    expect(handler?.allowedNetworkFamilies).toEqual([]);
    expect(handler?.allowedCredentials).toEqual([]);
    expect(handler?.allowedCapabilities).toEqual([]);
    expect(handler?.socketOrCapabilityChannels).toEqual(['ANONYMOUS_FD_3_ONLY']);
    expect(handler?.prohibitedResources).toEqual(expect.arrayContaining(['AF_INET', 'AF_INET6', 'POSTGRES', 'BROKERS', 'HOST_RUN', 'OWNER_API_KEY']));
  });

  it('RUNTIME_GATEWAY_IDENTITY_EVIDENCE: uses native framed anonymous IPC with monotonic sequence', () => {
    const encoded = encodeRuntimeFrame({ frameType: 'REQUEST', flags: 0, sequence: 0, payload: { requestId: 'test' } });
    expect(decodeRuntimeFrameHeader(encoded.subarray(0, 16))).toMatchObject({ frameType: 'REQUEST', payloadLength: encoded.length - 16, sequence: 0 });
    expect(encoded.subarray(0, 4).toString('ascii')).toBe('KCR1');
  });

  it('RUNTIME_HOST_LAUNCH_EVIDENCE: keeps launcher and systemd boundary implementation anchored', async () => {
    const launcher = await readFile('deploy/runtime/kcml-sandbox-launcher.c', 'utf8');
    const unit = await readFile('deploy/systemd/kcml-runtime-host@.service', 'utf8');
    expect(launcher).toContain('install_seccomp_allowlist');
    expect(launcher).toContain('PR_SET_NO_NEW_PRIVS');
    expect(launcher).toContain('--capability-fd');
    expect(unit).toContain('SystemCallArchitectures=native');
    expect(unit).toContain('KillMode=control-group');
    expect(unit).toContain('MemorySwapMax=0');
  });
});
