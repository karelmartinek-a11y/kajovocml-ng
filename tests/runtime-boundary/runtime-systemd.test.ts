import { describe, expect, it } from 'vitest';
import { parseSystemdShow, runtimeHostUnit } from '../../packages/worker-runtime/src/index.js';

describe('runtime systemd lifecycle authority', () => {
  it('accepts only canonical UUID runtime-host unit identities', () => {
    expect(runtimeHostUnit('123e4567-e89b-42d3-a456-426614174000')).toBe('kcml-runtime-host@123e4567-e89b-42d3-a456-426614174000.service');
    expect(() => runtimeHostUnit('../../ssh')).toThrow('RUNTIME_INSTANCE_ID_INVALID');
  });

  it('derives process authority only from systemd readback fields', () => {
    const state = parseSystemdShow('kcml-runtime-host@123e4567-e89b-42d3-a456-426614174000.service', [
      'LoadState=loaded', 'ActiveState=active', 'SubState=running', 'MainPID=321',
      'InvocationID=0123456789abcdef0123456789abcdef',
      'ControlGroup=/system.slice/kcml-runtime-host@123e4567-e89b-42d3-a456-426614174000.service', 'Result=success'
    ].join('\n'));
    expect(state).toMatchObject({ activeState: 'active', subState: 'running', mainPid: 321, invocationId: '01234567-89ab-cdef-0123-456789abcdef' });
  });
});
