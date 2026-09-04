import { describe, expect, it } from 'vitest';
import { listSpecializedServiceDescriptors, serviceReadinessDescriptor } from '../../packages/worker-runtime/src/index.js';

describe('specialized service composition roots', () => {
  it('publishes a versioned capability descriptor for every deployed specialist', () => {
    const descriptors = listSpecializedServiceDescriptors();
    expect(descriptors).toHaveLength(25);
    expect(new Set(descriptors.map((descriptor) => descriptor.serviceName)).size).toBe(descriptors.length);
    for (const descriptor of descriptors) {
      expect(descriptor).toMatchObject({ schemaVersion: '1.0' });
      expect(descriptor.runtimeKind).not.toBeUndefined();
      const ownsWork = (descriptor.queues as readonly string[]).length > 0;
      if (ownsWork) {
        expect([
          ...(descriptor.operationPrefixes as readonly string[]),
          ...(descriptor.operations as readonly string[])
        ].length).toBeGreaterThan(0);
      }
    }
  });

  it('assigns retry and reconciliation to a dedicated coordinator', () => {
    const descriptor = serviceReadinessDescriptor('kcml-retry-scheduler');
    expect(descriptor).toMatchObject({ runtimeKind: 'COMMAND_COORDINATOR', capabilities: ['CANONICAL_RETRY_SCHEDULER'] });
    expect(descriptor.queues).toEqual([]);
  });

  it('assigns each generation specialist an exclusive queue', () => {
    const names = [
      'kcml-generation-coordinator', 'kcml-generation-openai-worker',
      'kcml-generation-workspace-worker', 'kcml-generation-integration-worker',
      'kcml-generation-validation-worker', 'kcml-generation-activation-worker'
    ] as const;
    const queues = names.flatMap((name) => serviceReadinessDescriptor(name).queues as readonly string[]);
    expect(queues).toHaveLength(names.length);
    expect(new Set(queues).size).toBe(names.length);
    expect(queues).not.toContain('kcml-generation');
  });
});
