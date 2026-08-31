import { describe, expect, it } from 'vitest';
import { LinearizabilityHistory } from '@kcml/testing';

describe('recovery admission history', () => {
  it('accepts one invoke/return pair per logical operation', () => {
    const history = new LinearizabilityHistory();
    history.invoke('rotate-1', { expectedStateVersion: 3 });
    history.returned('rotate-1', { stateVersion: 4 });
    expect(() => history.assertWellFormed()).not.toThrow();
  });

  it('rejects late completion without a current invocation', () => {
    const history = new LinearizabilityHistory();
    history.returned('stale-worker', { fence: 2 });
    expect(() => history.assertWellFormed()).toThrow('LINEARIZABILITY_RETURN_WITHOUT_INVOKE');
  });
});
