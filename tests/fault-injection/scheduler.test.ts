import { describe, expect, it } from 'vitest';
import { DeterministicScheduler, FaultRegistry } from '@kcml/testing';

describe('deterministic fault injection', () => {
  it('orders equal-time crash and recovery events by reservation order', async () => {
    const scheduler = new DeterministicScheduler();
    const evidence:string[] = [];
    scheduler.schedule(10, async () => { evidence.push('lease-expired'); });
    scheduler.schedule(10, async () => { evidence.push('takeover'); });
    scheduler.schedule(11, async () => { evidence.push('old-worker-fenced'); });
    await scheduler.drain();
    expect(evidence).toEqual(['lease-expired', 'takeover', 'old-worker-fenced']);
  });

  it('does not allow duplicate fault identities', () => {
    const faults = new FaultRegistry();
    const point = { id: 'queue.after-claim', subsystem: 'queue', effect: 'kill-worker', recoveryOracle: 'one-current-fence' };
    faults.register(point);
    expect(() => faults.register(point)).toThrow('FAULT_POINT_DUPLICATE');
  });
});
