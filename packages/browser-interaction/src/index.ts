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

type Row = Record<string, unknown>;
const TERMINAL_ACTION_PHASES = new Set(['CONFIRMED_APPLIED', 'CONFIRMED_NOT_APPLIED', 'FAILED_FINAL', 'UNKNOWN']);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Typed Browser Interaction Plane facade; CanonicalOperationService owns all persistence. */
export class BrowserInteractionService {
  public constructor(
    private readonly pool: DatabasePool,
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

  /**
   * A browser action is a create operation. The canonical command therefore has
   * a null target and carries the session identity in arguments. The method does
   * not confuse command acceptance with browser execution: it resolves the
   * immutable command checkpoint to the real browser_action_run id and then
   * waits for the trusted BrowserSessionService/host path to produce a terminal
   * action classification.
   */
  public async action(inputValue: unknown, logicalOperationId = randomUUID()): Promise<ActionOutcome> {
    const input = browserActionInputSchema.parse(inputValue);
    if (!this.operations) throw new DomainError('BROWSER_CHALLENGE_REQUIRED', 'Browser actions require CanonicalOperationService persistence', 503, 'DO_NOT_RETRY');
    const accepted = await this.operations.execute('browser.action.start', {
      targetId: null,
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
      deadlineAt: new Date(Date.now() + 45_000).toISOString()
    }, {
      callerFingerprint: this.context.callerFingerprint,
      actorId: this.context.actorId,
      correlationId: randomUUID(),
      idempotencyKey: `browser-action:${logicalOperationId}`
    });

    const actionId = await this.waitForActionId(String(accepted.metadata.commandId), 45_000);
    return this.waitForActionOutcome(actionId, 45_000);
  }

  private async waitForActionId(commandId: string, timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await this.pool.query(`SELECT c.status,c.error,checkpoint.output
        FROM kcml.domain_command c
        LEFT JOIN kcml.domain_command_execution_checkpoint checkpoint ON checkpoint.command_id=c.id
        WHERE c.id=$1`, [commandId]);
      const command = result.rows[0] as Row | undefined;
      if (!command) throw new DomainError('KCIP_TARGET_NOT_FOUND', 'Browser action command disappeared before execution', 409, 'DO_NOT_RETRY');
      if (command.status === 'FAILED' || command.status === 'CANCELLED') {
        throw new DomainError('BROWSER_ACTIONABILITY_FAILED', 'Browser action command failed before the action aggregate was created', 409, 'RECONCILE_THEN_RETRY', { commandId, failure: command.error ?? null });
      }
      const output = command.output && typeof command.output === 'object' ? command.output as Row : null;
      const value = output?.value && typeof output.value === 'object' ? output.value as Row : null;
      if (typeof value?.id === 'string') return value.id;
      await sleep(50);
    }
    throw new DomainError('RUNTIME_DEADLINE_EXCEEDED', 'Browser action command did not materialize before its deadline', 408, 'RECONCILE_THEN_RETRY', { commandId });
  }

  private async waitForActionOutcome(actionId: string, timeoutMs: number): Promise<ActionOutcome> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await this.pool.query(`SELECT a.dispatch_phase,a.outcome,a.earliest_mutation_trigger,a.updated_at,
          (SELECT jsonb_build_object('id',t.id,'attempt',t.attempt,'dispatchPhase',t.dispatch_phase,'t1CommittedAt',t.t1_committed_at,'t2CommittedAt',t.t2_committed_at,'readBack',t.readback,'postcondition',t.postcondition)
             FROM kcml.browser_action_attempt t WHERE t.action_run_id=a.id ORDER BY t.attempt DESC LIMIT 1) AS latest_attempt
        FROM kcml.browser_action_run a WHERE a.id=$1`, [actionId]);
      const action = result.rows[0] as Row | undefined;
      if (!action) throw new DomainError('KCIP_TARGET_NOT_FOUND', 'Browser action aggregate disappeared', 409, 'DO_NOT_RETRY', { actionId });
      const phase = String(action.dispatch_phase) as ActionOutcome['phase'];
      if (TERMINAL_ACTION_PHASES.has(phase)) {
        return {
          actionId,
          phase,
          possibleSideEffect: phase === 'CONFIRMED_APPLIED' || phase === 'UNKNOWN' || action.earliest_mutation_trigger !== null,
          retryAllowed: phase === 'CONFIRMED_NOT_APPLIED',
          observation: null,
          evidence: {
            outcome: action.outcome ?? null,
            latestAttempt: action.latest_attempt ?? null,
            updatedAt: action.updated_at ?? null,
            derivedFromAuthoritativeActionRun: true
          }
        };
      }
      await sleep(50);
    }
    return {
      actionId,
      phase: 'UNKNOWN',
      possibleSideEffect: true,
      retryAllowed: false,
      observation: null,
      evidence: { deadlineExceeded: true, reconciliationRequired: true }
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
