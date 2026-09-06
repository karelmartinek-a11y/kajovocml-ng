import { describe, expect, it } from 'vitest';
import { assertRuntimeGatewayActivationEnvironment, parseProcStartTicks, runtimeUnitFromCgroup } from '../../packages/worker-runtime/src/index.js';

describe('runtime gateway identity primitives', () => {
  it('requires exactly the named systemd socket activation descriptor', () => {
    expect(() => assertRuntimeGatewayActivationEnvironment({ LISTEN_PID: '42', LISTEN_FDS: '1', LISTEN_FDNAMES: 'runtime-gateway' }, 42)).not.toThrow();
    expect(() => assertRuntimeGatewayActivationEnvironment({ LISTEN_PID: '42', LISTEN_FDS: '2', LISTEN_FDNAMES: 'runtime-gateway' }, 42)).toThrow('RUNTIME_SOCKET_ACTIVATION_FD_COUNT_INVALID');
    expect(() => assertRuntimeGatewayActivationEnvironment({ LISTEN_PID: '42', LISTEN_FDS: '1', LISTEN_FDNAMES: 'wrong' }, 42)).toThrow('RUNTIME_SOCKET_ACTIVATION_FD_NAME_INVALID');
  });

  it('reads Linux start ticks without trusting the comm field', () => {
    const prefix = '123 (a process name with spaces) S';
    const fields = Array.from({ length: 19 }, (_, index) => String(index + 1));
    fields[18] = '987654';
    const stat = `${prefix} ${fields.join(' ')}`;
    expect(parseProcStartTicks(stat)).toBe(987654n);
  });

  it('derives only the canonical runtime-host systemd unit from cgroup evidence', () => {
    const runtimeId = '11111111-1111-4111-8111-111111111111';
    expect(runtimeUnitFromCgroup(`0::/system.slice/kcml-runtime-host@${runtimeId}.service\n`)).toBe(`kcml-runtime-host@${runtimeId}.service`);
    expect(() => runtimeUnitFromCgroup('0::/system.slice/ssh.service\n')).toThrow('RUNTIME_CGROUP_UNIT_NOT_FOUND');
  });
});