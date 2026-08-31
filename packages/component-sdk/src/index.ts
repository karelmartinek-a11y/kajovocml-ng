import { randomUUID } from 'node:crypto';
import { invokeCapability, signRequest, type CapabilityResponse } from '@kcml/runtime-capability-ipc';

export interface ComponentContextOptions {
  executionId: string;
  socketPath: string;
  channelKey: Buffer;
  deadlineAt: Date;
}

export class ComponentContext {
  public constructor(private readonly options: ComponentContextOptions) {}

  public async invoke(capability: 'STATE_READ' | 'STATE_WRITE' | 'SECRET_USE' | 'EGRESS_REQUEST' | 'ARTIFACT_READ' | 'ARTIFACT_WRITE' | 'CHILD_EXEC', operation: string, payload: unknown): Promise<CapabilityResponse> {
    if (this.options.deadlineAt <= new Date()) throw new Error('EXECUTION_DEADLINE_EXCEEDED');
    const request = signRequest({
      protocol: 'KCML-CAPABILITY-IPC/1', requestId: randomUUID(), executionId: this.options.executionId,
      capability, operation, payload, deadlineAt: this.options.deadlineAt.toISOString()
    }, this.options.channelKey);
    return invokeCapability(this.options.socketPath, request);
  }

  public state = {
    read: (key: string) => this.invoke('STATE_READ', 'state.read', { key }),
    write: (key: string, value: unknown, expectedStateVersion: bigint) => this.invoke('STATE_WRITE', 'state.write', { key, value, expectedStateVersion: expectedStateVersion.toString() })
  };

  public secret = {
    use: (secretId: string, targetIdentity: string, purpose: string) => this.invoke('SECRET_USE', 'secret.use', { secretId, targetIdentity, purpose })
  };

  public egress = {
    request: (bindingId: string, request: unknown) => this.invoke('EGRESS_REQUEST', 'egress.request', { bindingId, request })
  };
}
