import { randomUUID } from 'node:crypto';
import type { DatabasePool } from '@kcml/database';
import type { CanonicalOperationService, OperationCatalogService } from '@kcml/domain';

export const EVIDENCE_MODES = [
  'MODEL_FAST',
  'POSTGRES_REAL',
  'SYSTEMD_RUNTIME',
  'OPENAI_FAKE_TRANSPORT',
  'BROWSER_FIXTURE',
  'CROSS_SUBSYSTEM',
  'PRODUCTION_SHAPED',
  'DISASTER_RESTORE'
] as const;

export type EvidenceMode = (typeof EVIDENCE_MODES)[number];
export type EvidenceStatus = 'PASS' | 'FAIL' | 'NOT_EXECUTED_ENVIRONMENTAL';

export interface EvidenceReport {
  mode: EvidenceMode;
  status: EvidenceStatus;
  blocking: boolean;
  executedSteps: number;
  comparisonCount: number;
  seed: number;
  reason?: string;
}

/**
 * The blocking trace accepts the production service constructor from its
 * runner. This keeps the runner's SUT binding explicit while retaining the
 * lazy import needed to classify an unavailable environment correctly.
 */
export type CanonicalOperationServiceConstructor = new (
  pool: DatabasePool,
  catalog: OperationCatalogService
) => CanonicalOperationService;

export type CanonicalOperationServiceLoader = () => Promise<CanonicalOperationServiceConstructor>;

/** MODEL_FAST is deliberately non-blocking: it is a reference-model oracle,
 * never evidence that the production implementation executed. */
export function modelFastEvidence(seed: number, executedSteps: number): EvidenceReport {
  return { mode: 'MODEL_FAST', status: 'PASS', blocking: false, executedSteps, comparisonCount: 0, seed };
}

export function environmentalEvidence(mode: EvidenceMode, seed: number, reason: string): EvidenceReport {
  return { mode, status: 'NOT_EXECUTED_ENVIRONMENTAL', blocking: true, executedSteps: 0, comparisonCount: 0, seed, reason };
}

interface RegisterArguments {
  stableKey: string;
  kcmlNumber: string;
  code: string;
  displayName: string;
  category: string;
  role: string;
  contacts: Array<Record<string, unknown>>;
  criticality: string;
  runtimeIdentityKind: string;
}

export interface ModelCommand {
  label: 'VALID' | 'DUPLICATE' | 'CONFLICT';
  arguments: RegisterArguments;
  idempotencyKey: string;
}

interface ReferenceState {
  registered: boolean;
  lifecycle: 'ABSENT' | 'DRAFT';
  stateVersion: number;
  aggregateEventSequence: number;
  terminalOutcome: 'NONE' | 'SUCCEEDED' | 'CONFLICT';
}

interface SutSnapshot {
  componentCount: number;
  lifecycle: string | null;
  stateVersion: number | null;
  aggregateEventSequence: number | null;
  commandStatus: string | null;
  queueStatus: string | null;
  checkpointCount: number;
  outboxCount: number;
  auditCount: number;
}

export const MODEL_REGISTRY = Object.freeze({
  version: 1,
  aggregates: [{
    aggregateKind: 'COMPONENT',
    mutableFields: ['lifecycle', 'activation_state', 'operational_state', 'monitoring_state', 'recertification_state', 'state_version', 'aggregate_event_sequence'],
    commandOperations: ['component.register'],
    oracle: 'component row + domain command + queue item + execution checkpoint + outbox + audit event',
    sourceRequirementRefs: ['ssot://49.29', 'ssot://49.30', 'ssot://54.2', 'ssot://54.3', 'ssot://54.4', 'ssot://54.5']
  }]
});

function componentArguments(suffix: string, displayName = 'TD-13 model component'): RegisterArguments {
  return {
    stableKey: `td13-${suffix}`,
    kcmlNumber: `K-CML-TD13-${suffix}`,
    code: `td13-${suffix}`,
    displayName,
    category: 'PLATFORM',
    role: 'MODEL_SUT_PROBE',
    contacts: [{ kind: 'OWNER', value: 'KRMAR78' }],
    criticality: 'LOW',
    runtimeIdentityKind: 'SERVICE'
  };
}

export function generatedComponentTrace(seed: number): ModelCommand[] {
  const suffix = `${seed}-${randomUUID().slice(0, 8)}`;
  const first = componentArguments(suffix);
  return [
    { label: 'VALID', arguments: first, idempotencyKey: `td13-register-${suffix}` },
    { label: 'DUPLICATE', arguments: first, idempotencyKey: `td13-register-${suffix}` },
    { label: 'CONFLICT', arguments: { ...first, displayName: 'TD-13 conflicting request' }, idempotencyKey: `td13-register-${suffix}` }
  ];
}

function applyReference(state: ReferenceState, command: ModelCommand): void {
  if (command.label === 'VALID') {
    if (state.registered) throw new Error('REFERENCE_MODEL_GENERATOR_PRECONDITION_INVALID');
    state.registered = true;
    state.lifecycle = 'DRAFT';
    state.stateVersion = 1;
    state.aggregateEventSequence = 0;
    state.terminalOutcome = 'SUCCEEDED';
    return;
  }
  if (command.label === 'DUPLICATE') {
    if (!state.registered) throw new Error('REFERENCE_MODEL_DUPLICATE_BEFORE_CREATE');
    state.terminalOutcome = 'SUCCEEDED';
    return;
  }
  if (!state.registered) throw new Error('REFERENCE_MODEL_CONFLICT_BEFORE_CREATE');
  state.terminalOutcome = 'CONFLICT';
}

function assertSnapshot(state: ReferenceState, snapshot: SutSnapshot, command: ModelCommand): void {
  if (snapshot.componentCount !== (state.registered ? 1 : 0)) throw new Error('MODEL_SUT_COMPONENT_CARDINALITY_MISMATCH');
  if (snapshot.lifecycle !== (state.registered ? state.lifecycle : null)) throw new Error('MODEL_SUT_COMPONENT_LIFECYCLE_MISMATCH');
  if (snapshot.stateVersion !== (state.registered ? state.stateVersion : null)) throw new Error('MODEL_SUT_COMPONENT_STATE_VERSION_MISMATCH');
  if (snapshot.aggregateEventSequence !== (state.registered ? state.aggregateEventSequence : null)) throw new Error('MODEL_SUT_COMPONENT_EVENT_SEQUENCE_MISMATCH');
  if (snapshot.checkpointCount !== 1 || snapshot.queueStatus !== 'SUCCEEDED' || snapshot.outboxCount < 1 || snapshot.auditCount < 1) throw new Error('MODEL_SUT_DURABLE_EVIDENCE_INCOMPLETE');
  if (command.label === 'CONFLICT') {
    if (snapshot.commandStatus !== 'SUCCEEDED') throw new Error('MODEL_SUT_CONFLICT_CHANGED_CANONICAL_COMMAND');
    return;
  }
  if (snapshot.commandStatus !== 'SUCCEEDED') throw new Error('MODEL_SUT_COMMAND_NOT_TERMINAL');
}

async function snapshot(pool: DatabasePool, commandId: string, stableKey: string): Promise<SutSnapshot> {
  const result = await pool.query<{
    component_count: string;
    lifecycle: string | null;
    state_version: string | null;
    aggregate_event_sequence: string | null;
    command_status: string | null;
    queue_status: string | null;
    checkpoint_count: string;
    outbox_count: string;
    audit_count: string;
  }>(`
    SELECT
      (SELECT count(*)::int FROM kcml.component WHERE stable_key=$2) AS component_count,
      (SELECT lifecycle FROM kcml.component WHERE stable_key=$2) AS lifecycle,
      (SELECT state_version::text FROM kcml.component WHERE stable_key=$2) AS state_version,
      (SELECT aggregate_event_sequence::text FROM kcml.component WHERE stable_key=$2) AS aggregate_event_sequence,
      command.status AS command_status,
      queue.status AS queue_status,
      (SELECT count(*)::int FROM kcml.domain_command_execution_checkpoint WHERE command_id=command.id) AS checkpoint_count,
      (SELECT count(*)::int FROM kcml.transactional_outbox WHERE stream_key=('command:'||command.id::text)) AS outbox_count,
      (SELECT count(*)::int FROM kcml.audit_event WHERE aggregate_type='DOMAIN_COMMAND' AND aggregate_id=command.id) AS audit_count
    FROM kcml.domain_command command
    LEFT JOIN kcml.queue_item queue ON queue.command_id=command.id
    WHERE command.id=$1`, [commandId, stableKey]);
  const row = result.rows[0];
  if (!row) throw new Error('MODEL_SUT_COMMAND_EVIDENCE_MISSING');
  return {
    componentCount: Number(row.component_count),
    lifecycle: row.lifecycle,
    stateVersion: row.state_version === null ? null : Number(row.state_version),
    aggregateEventSequence: row.aggregate_event_sequence === null ? null : Number(row.aggregate_event_sequence),
    commandStatus: row.command_status,
    queueStatus: row.queue_status,
    checkpointCount: Number(row.checkpoint_count),
    outboxCount: Number(row.outbox_count),
    auditCount: Number(row.audit_count)
  };
}

export async function prepareProductionDatabase(pool: DatabasePool): Promise<void> {
  const { loadBaseline, loadForwardMigrations } = await import('@kcml/database');
  await pool.query(await loadBaseline());
  for (const migration of await loadForwardMigrations()) await pool.query(migration.sql);
}

export async function runPostgresRealTrace(seed: number, migrate = true, serviceLoader?: CanonicalOperationServiceLoader): Promise<EvidenceReport> {
  if (!process.env.DATABASE_URL) return environmentalEvidence('POSTGRES_REAL', seed, 'DATABASE_URL is unavailable');
  let pool: DatabasePool | undefined;
  try {
    const [{ createDatabasePool }, { CanonicalCommandWorker, CanonicalOperationService, OperationCatalogService }] = await Promise.all([
      import('@kcml/database'),
      import('@kcml/domain')
    ]);
    pool = createDatabasePool({ applicationName: 'kcml-property-sut', max: 2 });
    if (migrate) await prepareProductionDatabase(pool);
    const catalog = await OperationCatalogService.load();
    const serviceClass = serviceLoader ? await serviceLoader() : CanonicalOperationService;
    const service = new serviceClass(pool, catalog);
    const worker = new CanonicalCommandWorker(pool, catalog, { queueNames: ['kcml-component'], workerId: randomUUID() });
    const commands = generatedComponentTrace(seed);
    const state: ReferenceState = { registered: false, lifecycle: 'ABSENT', stateVersion: 0, aggregateEventSequence: 0, terminalOutcome: 'NONE' };
    let commandId = '';
    for (const command of commands) {
      let response;
      try {
        response = await service.execute('component.register', { targetId: null, arguments: command.arguments, expectedStateVersion: null, expectedActivationEpoch: null, deadlineAt: null }, {
          callerFingerprint: 'td13-property', actorId: 'KRMAR78', correlationId: randomUUID(), idempotencyKey: command.idempotencyKey
        });
        commandId = String(response.metadata.commandId);
        if (command.label === 'VALID' && response.status !== 'ACCEPTED') throw new Error('MODEL_SUT_ADMISSION_OUTCOME_INVALID');
        if (command.label === 'DUPLICATE' && (!response.metadata.idempotencyReplay || response.status !== 'SUCCEEDED')) throw new Error('MODEL_SUT_DUPLICATE_OUTCOME_INVALID');
        if (command.label === 'CONFLICT') throw new Error('MODEL_SUT_CONFLICT_ACCEPTED');
      } catch (error) {
        const errorCode = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
        if (command.label !== 'CONFLICT' || errorCode !== 'IDEMPOTENCY_CONFLICT') throw error;
      }
      if (command.label === 'VALID') {
        if (!await worker.runOnce()) throw new Error('MODEL_SUT_WORKER_DID_NOT_EXECUTE');
        const terminal = await service.execute('component.register', { targetId: null, arguments: command.arguments, expectedStateVersion: null, expectedActivationEpoch: null, deadlineAt: null }, {
          callerFingerprint: 'td13-property', actorId: 'KRMAR78', correlationId: randomUUID(), idempotencyKey: command.idempotencyKey
        });
        if (terminal.status !== 'SUCCEEDED' || !terminal.metadata.idempotencyReplay) throw new Error('MODEL_SUT_TERMINAL_OUTCOME_INVALID');
      }
      applyReference(state, command);
      assertSnapshot(state, await snapshot(pool, commandId, command.arguments.stableKey), command);
    }
    return { mode: 'POSTGRES_REAL', status: 'PASS', blocking: true, executedSteps: commands.length, comparisonCount: commands.length, seed };
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ERR_DLOPEN_FAILED') {
      return environmentalEvidence('POSTGRES_REAL', seed, `SUT runtime dependency unavailable: ${error.message}`);
    }
    return { mode: 'POSTGRES_REAL', status: 'FAIL', blocking: true, executedSteps: 0, comparisonCount: 0, seed, reason: error instanceof Error ? error.message : String(error) };
  } finally {
    await pool?.end();
  }
}
