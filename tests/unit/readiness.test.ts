import { describe, expect, it } from 'vitest';
import { evaluateServiceReadiness, loadExpectedHeartbeatServices, type ServiceHeartbeat } from '../../apps/server/src/readiness.js';

const sourceSha = 'a'.repeat(40);
const now = new Date('2026-08-31T12:00:00.000Z');

function heartbeat(serviceName: string, overrides: Partial<ServiceHeartbeat> = {}): ServiceHeartbeat {
  return {
    service_name: serviceName,
    instance_id: `${serviceName}-instance`,
    release_id: 'release-1',
    source_sha: sourceSha,
    deployment_epoch: '7',
    status: 'READY',
    observed_at: '2026-08-31T11:59:55.000Z',
    expires_at: '2026-08-31T12:00:25.000Z',
    ...overrides
  };
}

describe('service readiness', () => {
  it('requires every enabled persistent service and the managed browser host', async () => {
    const expected = await loadExpectedHeartbeatServices(process.cwd());
    expect(expected).toContain('kcml-central-chat-worker');
    expect(expected).toContain('kcml-runtime-gateway');
    expect(expected).toContain('kcml-browser-host');
    expect(expected).not.toContain('kcml-web-api');
    expect(expected).not.toContain('kcml-acceptance-runner');
  });

  it('accepts only fresh READY evidence from the exact release, source SHA and epoch', () => {
    const expected = ['a', 'b'];
    expect(evaluateServiceReadiness(expected.map((name) => heartbeat(name)), expected, 'release-1', sourceSha, 7n, now)).toMatchObject({
      ready: true,
      missingServices: [],
      unhealthyServices: [],
      staleServices: [],
      mismatchedServices: []
    });
  });

  it('fails closed for missing, unhealthy, expired and mixed-release evidence', () => {
    const result = evaluateServiceReadiness([
      heartbeat('unhealthy', { status: 'DEGRADED' }),
      heartbeat('stale', { expires_at: '2026-08-31T11:59:59.000Z' }),
      heartbeat('mixed', { release_id: 'old-release', deployment_epoch: '6' })
    ], ['missing', 'unhealthy', 'stale', 'mixed'], 'release-1', sourceSha, 7n, now);
    expect(result).toEqual({
      ready: false,
      expectedServices: ['missing', 'mixed', 'stale', 'unhealthy'],
      missingServices: ['missing'],
      unhealthyServices: ['unhealthy'],
      staleServices: ['stale'],
      mismatchedServices: ['mixed']
    });
  });

  it('uses only the newest heartbeat for each service', () => {
    const result = evaluateServiceReadiness([
      heartbeat('worker', { observed_at: '2026-08-31T11:59:00.000Z', status: 'FAILED' }),
      heartbeat('worker', { observed_at: '2026-08-31T11:59:59.000Z' })
    ], ['worker'], 'release-1', sourceSha, 7n, now);
    expect(result.ready).toBe(true);
  });
});
