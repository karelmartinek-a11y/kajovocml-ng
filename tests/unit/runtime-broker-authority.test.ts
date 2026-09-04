import { describe, expect, it } from 'vitest';
import { assertRuntimeLocalStateKey, assertStateDocumentWithinLimits, assertStateValueWithinLimits, runtimeLineageDigest, runtimeStateNamespace, type RuntimeExecutionLineage } from '../../packages/worker-runtime/src/index.js';

function lineage(overrides: Partial<RuntimeExecutionLineage> = {}): RuntimeExecutionLineage {
  const value = {
    executionId: '00000000-0000-4000-8000-000000000001', executionKind: 'COMPONENT', sourceObjectKind: 'COMPONENT',
    sourceObjectId: '00000000-0000-4000-8000-000000000002', sourceRevisionId: '00000000-0000-4000-8000-000000000003',
    bindingSetRevisionId: '00000000-0000-4000-8000-000000000004', bindingSetRevisionNumber: '1', activationEpoch: '8',
    activationSetId: '00000000-0000-4000-8000-000000000005', runtimeInstanceId: '00000000-0000-4000-8000-000000000006',
    runtimeGeneration: '3', platformIncarnationId: '00000000-0000-4000-8000-000000000007', applicationDeploymentEpoch: '12',
    ...overrides
  };
  return { ...value, lineageDigest: runtimeLineageDigest(value) } as RuntimeExecutionLineage;
}

describe('runtime broker authority', () => {
  it('isolates namespaces across every server-derived lineage dimension', () => {
    const base = lineage();
    const dimensions: Array<keyof RuntimeExecutionLineage> = ['sourceObjectId','sourceRevisionId','bindingSetRevisionId','activationEpoch','activationSetId','runtimeGeneration','executionId','platformIncarnationId','applicationDeploymentEpoch'];
    for (const [index, dimension] of dimensions.entries()) {
      const changed = lineage({ [dimension]: `changed-${index}` });
      expect(runtimeStateNamespace(changed)).not.toBe(runtimeStateNamespace(base));
    }
  });

  it('accepts only bounded typed local keys and values', () => {
    expect(assertRuntimeLocalStateKey('checkpoint/v1:last-good')).toBe('checkpoint/v1:last-good');
    expect(() => assertRuntimeLocalStateKey('../escape')).toThrow('RUNTIME_STATE_KEY_INVALID');
    expect(() => assertRuntimeLocalStateKey('x'.repeat(129))).toThrow('RUNTIME_STATE_KEY_INVALID');
    expect(() => assertStateValueWithinLimits('x'.repeat(70_000))).toThrow('RUNTIME_STATE_VALUE_TOO_LARGE');
    expect(() => assertStateDocumentWithinLimits(Object.fromEntries(Array.from({ length: 257 }, (_, index) => [`k${index}`, index])))).toThrow('RUNTIME_STATE_NAMESPACE_QUOTA_EXCEEDED');
  });
});
