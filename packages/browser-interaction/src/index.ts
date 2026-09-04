import { randomUUID } from 'node:crypto';
import type { DatabasePool } from '@kcml/database';
import { browserActionInputSchema } from '@kcml/schemas';
import { browserObservationSchema, type ActionOutcome, type BrowserObservation } from '@kcml/browser-runtime-contracts';
import type { CanonicalOperationService } from '@kcml/domain';
import { DomainError } from '@kcml/domain';

export interface BrowserAdapter {
  observe(sessionId: string): Promise<BrowserObservation>;
  dispatch(sessionId: string, action: string, target: unknown, payload: Record<string, unknown>): Promise<{ possibleSideEffect: boolean; evidence: Record<string, unknown> }>;
}

export interface BrowserInteractionContext {
  callerFingerprint: string;
  actorId: string;
}

/** Typed Browser Interaction Plane facade; CanonicalOperationService owns all persistence. */
export class BrowserInteractionService {
  public constructor(
    private readonly _pool: DatabasePool,
    private readonly _adapter: BrowserAdapter,
    private readonly operations?: CanonicalOperationService,
    private readonly context: BrowserInteractionContext = { callerFingerprint: 'BROWSER_INTERACTION', actorId: 'KRMAR78' }
  ) {}

  public async observe(sessionId: string): Promise<BrowserObservation> {
    const observation = browserObservationSchema.parse(await this._adapter.observe(sessionId));
    if (!this.operations) throw new DomainError('BROWSER_CHALLENGE_REQUIRED', 'Browser observations require CanonicalOperationService persistence', 503, 'DO_NOT_RETRY');
    await this.operations.execute('browser.page.observed', {
      targetId: sessionId,
      arguments: observation,
      expectedStateVersion: null,
      expectedActivationEpoch: null,
      deadlineAt: null
    }, {
      callerFingerprint: this.context.callerFingerprint,
      actorId: this.context.actorId,
      correlationId: randomUUID(),
      idempotencyKey: `browser-observation:${observation.observationId}`
    });
    return observation;
  }

  public async action(inputValue: unknown, logicalOperationId = randomUUID()): Promise<ActionOutcome> {
    const input = browserActionInputSchema.parse(inputValue);
    if (!this.operations) throw new DomainError('BROWSER_CHALLENGE_REQUIRED', 'Browser actions require CanonicalOperationService persistence', 503, 'DO_NOT_RETRY');
    const accepted = await this.operations.execute('browser.action.start', {
      targetId: input.sessionId,
      arguments: {
        sessionId: input.sessionId,
        action: input.action,
        targetReferenceId: input.targetReferenceId,
        payload: input.payload,
        expectedControlEpoch: input.expectedControlEpoch.toString(),
        expectedDocumentEpoch: input.expectedDocumentEpoch.toString(),
        expectedObservationRevision: input.expectedObservationRevision.toString()
      },
      expectedStateVersion: null,
      expectedActivationEpoch: null,
      deadlineAt: null
    }, {
      callerFingerprint: this.context.callerFingerprint,
      actorId: this.context.actorId,
      correlationId: randomUUID(),
      idempotencyKey: `browser-action:${logicalOperationId}`
    });
    return {
      actionId: accepted.metadata.commandId,
      phase: 'INTENT_RECORDED',
      possibleSideEffect: false,
      retryAllowed: false,
      observation: null,
      evidence: { accepted: true, commandId: accepted.metadata.commandId, logicalOperationId }
    };
  }

  public async transferControl(sessionId: string, expectedControlEpoch: bigint, holder: 'AI' | 'OWNER' | 'AUTOMATION', ttlSeconds = 300): Promise<unknown> {
    if (!this.operations) throw new DomainError('BROWSER_CHALLENGE_REQUIRED', 'Control changes require CanonicalOperationService persistence', 503, 'DO_NOT_RETRY');
    return this.operations.execute('browser.control.transfer', {
      targetId: sessionId,
      arguments: { holder, expectedControlEpoch: expectedControlEpoch.toString(), ttlSeconds },
      expectedStateVersion: null,
      expectedActivationEpoch: null,
      deadlineAt: null
    }, {
      callerFingerprint: this.context.callerFingerprint,
      actorId: this.context.actorId,
      correlationId: randomUUID(),
      idempotencyKey: `browser-control:${sessionId}:${expectedControlEpoch.toString()}:${holder}`
    });
  }
}
