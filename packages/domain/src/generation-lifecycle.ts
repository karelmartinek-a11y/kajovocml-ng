import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseClient, DatabasePool } from '@kcml/database';
import { allocateContiguousSequence, inTransaction, withSerializableRetry } from '@kcml/database';
import { canonicalDigest } from '@kcml/schemas';
import { DomainError } from './errors.js';

export const GENERATION_PHASES = ['DISCUSSING', 'ANALYZING', 'IMPLEMENTING', 'INTEGRATING', 'VALIDATING', 'CML_CONFORMANCE', 'ACTIVATING'] as const;
export type GenerationPhase = typeof GENERATION_PHASES[number];
export type GenerationJobState = GenerationPhase | 'COMPLETED' | 'BLOCKED' | 'FAILED' | 'CANCELLED';
export const PHASE_RUN_STATES = ['QUEUED', 'RUNNING', 'WAITING_FOR_DEPENDENCY', 'WAITING_FOR_OWNER', 'REPAIRING', 'SUCCEEDED', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED'] as const;
export type PhaseRunState = typeof PHASE_RUN_STATES[number];

type JsonObject = Record<string, unknown>;
type Tx = DatabaseClient;

const phaseIndex = new Map<string, number>(GENERATION_PHASES.map((phase, index) => [phase, index]));
const transitionable = new Set<GenerationJobState>(['DISCUSSING', 'ANALYZING', 'IMPLEMENTING', 'INTEGRATING', 'VALIDATING', 'CML_CONFORMANCE', 'ACTIVATING', 'BLOCKED']);

function safeJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item));
}

function digest(value: unknown): Buffer {
  return Buffer.from(canonicalDigest(safeJson(value) as never).slice('sha256:'.length), 'hex');
}

function bytesDigest(value: Uint8Array): Buffer {
  return createHash('sha256').update(value).digest();
}

function pathIsSafe(path: string): boolean {
  const normalized = path.replaceAll('\\', '/');
  return normalized.length > 0 && !normalized.startsWith('/') && !normalized.split('/').some((part) => part === '' || part === '.' || part === '..');
}

function assertPhase(value: unknown): asserts value is GenerationPhase {
  if (typeof value !== 'string' || !phaseIndex.has(value)) throw new DomainError('GENERATION_PHASE_INVALID', 'Unknown generation phase', 422, 'DO_NOT_RETRY', { phase: value });
}

async function lockJob(client: Tx, jobId: string, expectedStateVersion?: bigint | null): Promise<any> {
  const row = (await client.query('SELECT * FROM kcml.generation_job WHERE id=$1 FOR UPDATE', [jobId])).rows[0];
  if (!row) throw new DomainError('GENERATION_JOB_NOT_FOUND', 'Generation job does not exist', 404, 'DO_NOT_RETRY');
  if (expectedStateVersion !== undefined && expectedStateVersion !== null && BigInt(row.state_version) !== expectedStateVersion) {
    throw new DomainError('STATE_VERSION_CONFLICT', 'Generation job state changed', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
  }
  if (row.recovery_state === 'MANUAL_REVIEW') throw new DomainError('GENERATION_RECOVERY_BLOCKED', 'Generation recovery requires manual review', 409, 'MANUAL_REVIEW');
  return row;
}

function assertLineage(job: any, platformIncarnationId?: string, applicationDeploymentEpoch?: bigint): void {
  if (platformIncarnationId && String(job.platform_incarnation_id) !== platformIncarnationId) throw new DomainError('GENERATION_PLATFORM_INCARNATION_STALE', 'Generation job belongs to a previous platform incarnation', 409, 'RECONCILE_THEN_RETRY');
  if (applicationDeploymentEpoch !== undefined && BigInt(job.application_deployment_epoch) !== applicationDeploymentEpoch) throw new DomainError('GENERATION_DEPLOYMENT_EPOCH_STALE', 'Generation job belongs to a previous deployment epoch', 409, 'RECONCILE_THEN_RETRY');
}

async function checkpoint(client: Tx, job: any, phase: string, kind: string, payload: unknown, phaseRunId: string | null, successorPhase: string | null): Promise<any> {
  const sequence = await allocateContiguousSequence(client, 'GENERATION_CHECKPOINT', String(job.id), 'SEQUENCE');
  const canonicalPayload = safeJson(payload);
  const row = (await client.query(`INSERT INTO kcml.generation_checkpoint(generation_job_id,sequence,phase,workspace_revision,payload,payload_digest,phase_run_id,checkpoint_kind,terminal_evidence,successor_phase)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [job.id, sequence.toString(), phase, String(job.workspace_revision_number ?? 0), canonicalPayload, digest(canonicalPayload), phaseRunId, kind, kind === 'PHASE_TERMINAL' ? canonicalPayload : null, successorPhase])).rows[0];
  return row;
}

async function event(client: Tx, job: any, eventType: string, payload: unknown, phaseRunId: string | null = null, checkpointId: string | null = null): Promise<any> {
  const sequence = await allocateContiguousSequence(client, 'GENERATION_EVENT', String(job.id), 'SEQUENCE');
  const value = safeJson(payload);
  return (await client.query(`INSERT INTO kcml.generation_event(job_id,sequence,event_type,emitted_at,persisted_at,payload,payload_digest,phase_run_id,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,clock_timestamp(),clock_timestamp(),$4,$5,$6,$5,$7,$8,$9,$10,$11) RETURNING *`, [job.id, sequence.toString(), eventType, value, digest(value), phaseRunId, job.logical_operation_id ?? null, job.correlation_id ?? null, String(job.activation_epoch ?? 0), job.platform_incarnation_id, job.application_deployment_epoch])).rows[0];
}

function nextPhase(phase: GenerationPhase): GenerationPhase | null {
  const index = phaseIndex.get(phase)!;
  return GENERATION_PHASES[index + 1] ?? null;
}

export async function createGenerationJob(client: Tx, args: JsonObject, lineage: { platformIncarnationId: string; applicationDeploymentEpoch: bigint; logicalOperationId?: string; correlationId?: string }): Promise<any> {
  const provisionalIdentity = { kind: 'PROVISIONAL_GENERATION_TARGET', id: randomUUID(), allocatedAt: new Date().toISOString() };
  const mode = String(args.mode ?? 'CREATE');
  if (!['CREATE', 'UPDATE', 'FOLLOW_UP', 'RETRY', 'REPAIR'].includes(mode)) throw new DomainError('GENERATION_MODE_INVALID', 'Generation mode is not canonical', 422, 'DO_NOT_RETRY');
  const result = await client.query(`INSERT INTO kcml.generation_job(mode,objective,target_object_ids,source_artifact_ids,model,lifecycle,current_phase,platform_incarnation_id,application_deployment_epoch,provisional_identity,logical_operation_id,correlation_id)
    VALUES($1,$2,$3,$4,$5,'DISCUSSING','DISCUSSING',$6,$7,$8,$9,$10) RETURNING *`, [mode, String(args.objective ?? 'OWNER generation request'), args.targetObjectIds ?? [], args.sourceArtifactIds ?? [], args.model ?? null, lineage.platformIncarnationId, lineage.applicationDeploymentEpoch.toString(), provisionalIdentity, lineage.logicalOperationId ?? null, lineage.correlationId ?? null]);
  const job = result.rows[0];
  const revisionId = randomUUID();
  const emptyDigest = bytesDigest(Buffer.alloc(0));
  await client.query(`INSERT INTO kcml.generation_workspace_revision(id,job_id,revision_number,source_tree_digest,canonical_digest,logical_operation_id,correlation_id,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,0,$3,$3,$4,$5,$6,$7)`, [revisionId, job.id, emptyDigest, lineage.logicalOperationId ?? null, lineage.correlationId ?? null, lineage.platformIncarnationId, lineage.applicationDeploymentEpoch.toString()]);
  return (await client.query(`UPDATE kcml.generation_job SET workspace_revision_id=$2,state_version=state_version+1 WHERE id=$1 RETURNING *`, [job.id, revisionId])).rows[0];
}

export async function startGenerationPhase(pool: DatabasePool, input: { jobId: string; phase: GenerationPhase; expectedJobStateVersion?: bigint | null; workerId: string; platformIncarnationId?: string; applicationDeploymentEpoch?: bigint; logicalOperationId?: string; correlationId?: string; }): Promise<any> {
  assertPhase(input.phase);
  return withSerializableRetry(pool, async (client) => {
    const job = await lockJob(client, input.jobId, input.expectedJobStateVersion);
    assertLineage(job, input.platformIncarnationId, input.applicationDeploymentEpoch);
    if (!transitionable.has(String(job.lifecycle) as GenerationJobState)) throw new DomainError('GENERATION_JOB_TERMINAL', 'A terminal generation job cannot start a phase', 409, 'DO_NOT_RETRY');
    const current = String(job.lifecycle) as GenerationJobState;
    const phaseNumber = phaseIndex.get(input.phase)!;
    const currentNumber = phaseIndex.get(current);
    if (current !== input.phase && (currentNumber === undefined || phaseNumber !== currentNumber + 1)) throw new DomainError('GENERATION_PHASE_ORDER_INVALID', `Cannot start ${input.phase} after ${current}`, 409, 'RECONCILE_THEN_RETRY');
    const active = (await client.query(`SELECT id FROM kcml.generation_phase_run WHERE job_id=$1 AND state IN ('QUEUED','RUNNING','WAITING_FOR_DEPENDENCY','WAITING_FOR_OWNER','REPAIRING','CANCEL_REQUESTED') FOR UPDATE`, [input.jobId])).rows[0];
    if (active) return active;
    const attempt = await allocateContiguousSequence(client, 'GENERATION_PHASE_ATTEMPT', input.jobId, input.phase);
    const fence = await allocateContiguousSequence(client, 'GENERATION_PHASE_FENCE', input.jobId, input.phase);
    const phaseRunId = randomUUID();
    const planRange = { phase: input.phase, sourceCheckpointId: job.latest_checkpoint_id ?? null, workspaceRevisionId: job.workspace_revision_id ?? null, authorityId: job.execution_authority_id ?? null };
    const phaseRun = (await client.query(`INSERT INTO kcml.generation_phase_run(id,job_id,phase,attempt,state,worker_pool,lease_owner,lease_fencing_token,lease_expires_at,heartbeat_at,plan_node_range,input_checkpoint_id,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
      VALUES($1,$2,$3,$4,'RUNNING','kcml-generation',$5,$6,clock_timestamp()+interval '5 minutes',clock_timestamp(),$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`, [phaseRunId, input.jobId, input.phase, attempt.toString(), input.workerId, fence.toString(), planRange, job.latest_checkpoint_id ?? null, digest({ phaseRunId, phase: input.phase, attempt: attempt.toString(), fence: fence.toString(), planRange }), input.logicalOperationId ?? job.logical_operation_id ?? null, input.correlationId ?? job.correlation_id ?? null, job.activation_epoch, job.platform_incarnation_id, job.application_deployment_epoch])).rows[0];
    const changed = (await client.query(`UPDATE kcml.generation_job SET lifecycle=$2,current_phase=$2,active_phase_run_id=$3,lease_fencing_token=$4,active_worker_id=$5,lease_expires_at=clock_timestamp()+interval '5 minutes',state_version=state_version+1 WHERE id=$1 AND state_version=$6 RETURNING *`, [input.jobId, input.phase, phaseRunId, fence.toString(), input.workerId, job.state_version])).rows[0];
    if (!changed) throw new DomainError('STATE_VERSION_CONFLICT', 'Generation job changed while starting phase', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    await checkpoint(client, changed, input.phase, input.phase === 'ANALYZING' ? 'SOURCE_INTAKE' : 'PHASE_PROGRESS', { state: 'RUNNING', phaseRunId, fence: fence.toString() }, phaseRunId, null);
    await event(client, changed, 'generation.phase.started', { phase: input.phase, phaseRunId, attempt: attempt.toString(), fence: fence.toString() }, phaseRunId);
    return phaseRun;
  });
}

export async function completeGenerationPhase(pool: DatabasePool, input: { phaseRunId: string; workerId: string; fencingToken: bigint; outcome: 'SUCCEEDED' | 'FAILED' | 'CANCELLED'; evidence: JsonObject; nextPhase?: GenerationPhase | null; platformIncarnationId?: string; applicationDeploymentEpoch?: bigint; }): Promise<any> {
  if (!PHASE_RUN_STATES.includes(input.outcome)) throw new DomainError('GENERATION_PHASE_OUTCOME_INVALID', 'Phase outcome is not terminal', 422, 'DO_NOT_RETRY');
  return withSerializableRetry(pool, async (client) => {
    const run = (await client.query('SELECT * FROM kcml.generation_phase_run WHERE id=$1 FOR UPDATE', [input.phaseRunId])).rows[0];
    if (!run) throw new DomainError('GENERATION_PHASE_RUN_NOT_FOUND', 'Generation phase run does not exist', 404, 'DO_NOT_RETRY');
    const job = await lockJob(client, String(run.job_id));
    assertLineage(job, input.platformIncarnationId, input.applicationDeploymentEpoch);
    if (String(run.state) !== 'RUNNING' || String(run.lease_owner) !== input.workerId || BigInt(run.lease_fencing_token) !== input.fencingToken) throw new DomainError('GENERATION_PHASE_FENCE_LOST', 'Phase completion was submitted by a stale worker', 409, 'RECONCILE_THEN_RETRY');
    const successor = input.outcome === 'SUCCEEDED' ? (input.nextPhase ?? nextPhase(String(run.phase) as GenerationPhase)) : null;
    if (successor) assertPhase(successor);
    const terminalEvidence = { ...input.evidence, phase: run.phase, phaseRunId: run.id, fencingToken: input.fencingToken.toString(), terminal: input.outcome };
    const outputCheckpoint = await checkpoint(client, job, String(run.phase), 'PHASE_TERMINAL', terminalEvidence, String(run.id), successor);
    const updatedRun = (await client.query(`UPDATE kcml.generation_phase_run SET state=$2,completed_at=clock_timestamp(),result_summary=$3,result_digest=$4,output_checkpoint_id=$5,lease_owner=NULL,lease_expires_at=NULL,state_version=state_version+1 WHERE id=$1 AND state='RUNNING' AND lease_owner=$6 AND lease_fencing_token=$7 RETURNING *`, [run.id, input.outcome, safeJson(input.evidence), digest(terminalEvidence), outputCheckpoint.id, input.workerId, input.fencingToken.toString()])).rows[0];
    if (!updatedRun) throw new DomainError('GENERATION_PHASE_FENCE_LOST', 'Phase completion lost its fencing CAS', 409, 'RECONCILE_THEN_RETRY');
    if (input.outcome !== 'SUCCEEDED') {
      const terminalState = input.outcome === 'CANCELLED' ? 'CANCELLED' : 'FAILED';
      const changed = (await client.query(`UPDATE kcml.generation_job SET lifecycle=$2,current_phase=$2,active_phase_run_id=NULL,terminal_evidence=$3,state_version=state_version+1 WHERE id=$1 AND state_version=$4 RETURNING *`, [job.id, terminalState, safeJson(terminalEvidence), job.state_version])).rows[0];
      if (!changed) throw new DomainError('STATE_VERSION_CONFLICT', 'Generation job changed while closing phase', 409, 'RECONCILE_THEN_RETRY');
      await event(client, changed, input.outcome === 'FAILED' ? 'generation.job.failed' : 'generation.job.cancelled', terminalEvidence, String(run.id), outputCheckpoint.id);
      return { phaseRun: updatedRun, job: changed, checkpoint: outputCheckpoint, successor: null };
    }
    let successorRun: any = null;
    if (successor) {
      const successorId = randomUUID();
      successorRun = (await client.query(`INSERT INTO kcml.generation_phase_run(id,job_id,phase,attempt,state,worker_pool,plan_node_range,input_checkpoint_id,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
        VALUES($1,$2,$3,1,'QUEUED','kcml-generation',$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [successorId, job.id, successor, { phase: successor, predecessorPhaseRunId: run.id }, outputCheckpoint.id, digest({ successorId, successor, predecessorPhaseRunId: run.id }), job.logical_operation_id ?? null, job.correlation_id ?? null, job.activation_epoch, job.platform_incarnation_id, job.application_deployment_epoch])).rows[0];
    }
    const finalState = successor ?? 'COMPLETED';
    const changed = (await client.query(`UPDATE kcml.generation_job SET lifecycle=$2,current_phase=$2,active_phase_run_id=$3,latest_checkpoint_id=$4,terminal_evidence=CASE WHEN $2='COMPLETED' THEN $5 ELSE terminal_evidence END,state_version=state_version+1 WHERE id=$1 AND state_version=$6 RETURNING *`, [job.id, finalState, successorRun?.id ?? null, outputCheckpoint.id, safeJson(terminalEvidence), job.state_version])).rows[0];
    if (!changed) throw new DomainError('STATE_VERSION_CONFLICT', 'Generation job changed while enqueuing successor phase', 409, 'RECONCILE_THEN_RETRY');
    await client.query(`INSERT INTO kcml.transactional_outbox(stream_key,stream_sequence,purpose,event_type,aggregate_id,payload,payload_digest,recovery_epoch)
      VALUES($1,$2,'GENERATION_PHASE_SUCCESSOR','generation.phase.enqueue',$3,$4,$5,(SELECT recovery_epoch FROM kcml.platform_recovery_head WHERE singleton_key=1))`, [`generation:${job.id}`, (await allocateContiguousSequence(client, 'GENERATION_OUTBOX', String(job.id), 'SEQUENCE')).toString(), job.id, { phaseRunId: successorRun?.id ?? null, phase: successor, checkpointId: outputCheckpoint.id }, digest({ phaseRunId: successorRun?.id ?? null, phase: successor, checkpointId: outputCheckpoint.id })]);
    await event(client, changed, successor ? 'generation.phase.completed' : 'generation.job.completed', terminalEvidence, String(run.id), outputCheckpoint.id);
    return { phaseRun: updatedRun, job: changed, checkpoint: outputCheckpoint, successor: successorRun };
  });
}

export interface WorkspaceOperation { op: 'ADD' | 'UPDATE' | 'DELETE'; path: string; expectedDigest: string | null; content?: string; mimeType?: string; executable?: boolean; }

export async function applyWorkspacePatchSet(pool: DatabasePool, input: { jobId: string; phaseRunId?: string; operations: readonly WorkspaceOperation[]; expectedRevisionId?: string; expectedRevisionNumber?: bigint; logicalOperationId?: string; correlationId?: string; }): Promise<any> {
  if (!input.operations.length) throw new DomainError('GENERATION_PATCH_EMPTY', 'WorkspacePatchSet must contain at least one ordered operation', 422, 'DO_NOT_RETRY');
  for (const operation of input.operations) {
    if (!pathIsSafe(operation.path)) throw new DomainError('GENERATION_WORKSPACE_PATH_INVALID', 'Workspace paths must be relative and contained', 422, 'DO_NOT_RETRY', { path: operation.path });
    if (!['ADD', 'UPDATE', 'DELETE'].includes(operation.op)) throw new DomainError('GENERATION_PATCH_OPERATION_INVALID', 'Workspace operation is not canonical', 422, 'DO_NOT_RETRY');
    if (operation.op !== 'DELETE' && typeof operation.content !== 'string') throw new DomainError('GENERATION_PATCH_CONTENT_REQUIRED', 'ADD and UPDATE require exact text content', 422, 'DO_NOT_RETRY');
  }
  return withSerializableRetry(pool, async (client) => {
    const job = await lockJob(client, input.jobId);
    let baseId = input.expectedRevisionId ?? job.workspace_revision_id;
    if (!baseId && input.expectedRevisionNumber === 0n) {
      // Older callers may have created a generation_job directly before the
      // persisted workspace pointer was introduced. Materialize the canonical
      // empty root revision inside the same transaction before applying the
      // first patch.
      const initialRevisionId = randomUUID();
      const emptyDigest = bytesDigest(Buffer.alloc(0));
      await client.query(`INSERT INTO kcml.generation_workspace_revision(id,job_id,revision_number,source_tree_digest,canonical_digest,logical_operation_id,correlation_id,platform_incarnation_id,application_deployment_epoch)
        VALUES($1,$2,0,$3,$3,$4,$5,$6,$7)`, [initialRevisionId, input.jobId, emptyDigest, input.logicalOperationId ?? job.logical_operation_id ?? null, input.correlationId ?? job.correlation_id ?? null, job.platform_incarnation_id, job.application_deployment_epoch]);
      const initialized = (await client.query(`UPDATE kcml.generation_job SET workspace_revision_id=$2,state_version=state_version+1 WHERE id=$1 AND workspace_revision_id IS NULL RETURNING *`, [input.jobId, initialRevisionId])).rows[0];
      if (initialized) Object.assign(job, initialized);
      baseId = job.workspace_revision_id ?? initialRevisionId;
    }
    if (!baseId) throw new DomainError('GENERATION_WORKSPACE_BASE_MISSING', 'Workspace has no current revision pointer', 409, 'RECONCILE_THEN_RETRY');
    const base = (await client.query('SELECT * FROM kcml.generation_workspace_revision WHERE id=$1 AND job_id=$2', [baseId, input.jobId])).rows[0];
    if (!base) throw new DomainError('GENERATION_WORKSPACE_BASE_MISSING', 'Workspace base revision does not exist', 409, 'RECONCILE_THEN_RETRY');
    if (input.expectedRevisionNumber !== undefined && BigInt(base.revision_number) !== input.expectedRevisionNumber) throw new DomainError('GENERATION_WORKSPACE_REVISION_CONFLICT', 'Workspace base revision is stale', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    let phaseRunId = input.phaseRunId ?? job.active_phase_run_id;
    if (!phaseRunId) {
      // Compatibility for the public orchestrator API: a direct workspace call
      // still creates the same persisted phase ownership record as the command
      // path. It never writes a file outside this transaction.
      phaseRunId = randomUUID();
      const fence = await allocateContiguousSequence(client, 'GENERATION_PHASE_FENCE', input.jobId, 'IMPLEMENTING');
      await client.query(`INSERT INTO kcml.generation_phase_run(id,job_id,phase,attempt,state,worker_pool,lease_owner,lease_fencing_token,lease_expires_at,heartbeat_at,plan_node_range,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
        VALUES($1,$2,'IMPLEMENTING',1,'RUNNING','kcml-generation',$3,$4,clock_timestamp()+interval '5 minutes',clock_timestamp(),$5,$6,$7,$8,$9,$10,$11)`, [phaseRunId, input.jobId, input.logicalOperationId ?? randomUUID(), fence.toString(), { phase: 'IMPLEMENTING', compatibility: true }, digest({ phaseRunId, fence: fence.toString() }), input.logicalOperationId ?? job.logical_operation_id ?? null, input.correlationId ?? job.correlation_id ?? null, job.activation_epoch, job.platform_incarnation_id, job.application_deployment_epoch]);
      await client.query(`UPDATE kcml.generation_job SET active_phase_run_id=$2,lease_fencing_token=$3,state_version=state_version+1 WHERE id=$1`, [input.jobId, phaseRunId, fence.toString()]);
    }
    const run = (await client.query(`SELECT id,state,job_id FROM kcml.generation_phase_run WHERE id=$1 AND job_id=$2 FOR UPDATE`, [phaseRunId, input.jobId])).rows[0];
    if (!run || !['RUNNING', 'REPAIRING'].includes(String(run.state))) throw new DomainError('GENERATION_PHASE_RUN_INVALID', 'Workspace patch requires an active phase run', 409, 'RECONCILE_THEN_RETRY');
    const baseFiles = (await client.query(`SELECT relative_path,content_digest,content_storage,content_reference,size_bytes,mime_type,file_type,executable,source_classification FROM kcml.generation_workspace_file WHERE workspace_revision_id=$1 ORDER BY relative_path`, [base.id])).rows;
    const files = new Map<string, any>(baseFiles.map((file) => [String(file.relative_path), file]));
    for (const operation of input.operations) {
      const existing = files.get(operation.path);
      const expected = operation.expectedDigest;
      const actual = existing ? `sha256:${Buffer.from(existing.content_digest).toString('hex')}` : null;
      if (actual !== expected) throw new DomainError('GENERATION_WORKSPACE_CAS_CONFLICT', `Workspace digest mismatch for ${operation.path}`, 409, 'REFRESH_AND_RETRY_NEW_COMMAND', { path: operation.path, expected, actual });
      if (operation.op === 'DELETE') files.delete(operation.path);
      else {
        const content = Buffer.from(operation.content!, 'utf8');
        files.set(operation.path, { relative_path: operation.path, content_storage: 'INLINE_TEXT', content_reference: operation.content, size_bytes: content.byteLength, content_digest: bytesDigest(content), mime_type: operation.mimeType ?? 'text/plain', file_type: 'SOURCE', executable: operation.executable ?? false, source_classification: 'MODEL_GENERATED' });
      }
    }
    const operationsDigest = digest(input.operations);
    const patchId = randomUUID();
    await client.query(`INSERT INTO kcml.generation_workspace_patch(id,job_id,phase_run_id,base_workspace_revision_id,base_digest,operations,operations_digest,apply_state,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
      VALUES($1,$2,$3,$4,$5,$6,$7,'APPLYING',$8,$9,$10,$11,$12,$13)`, [patchId, input.jobId, phaseRunId, base.id, Buffer.from(base.source_tree_digest), JSON.stringify(safeJson(input.operations)), operationsDigest, digest({ patchId, baseId: base.id, operationsDigest: operationsDigest.toString('hex') }), input.logicalOperationId ?? job.logical_operation_id ?? null, input.correlationId ?? job.correlation_id ?? null, job.activation_epoch, job.platform_incarnation_id, job.application_deployment_epoch]);
    const revisionNumber = BigInt(base.revision_number) + 1n;
    const revisionId = randomUUID();
    const treeDigest = digest(Array.from(files.values()).map((file) => ({ path: file.relative_path, digest: Buffer.from(file.content_digest).toString('hex'), size: file.size_bytes })));
    await client.query(`INSERT INTO kcml.generation_workspace_revision(id,parent_id,job_id,revision_number,parent_revision_id,source_tree_digest,canonical_digest,logical_operation_id,correlation_id,platform_incarnation_id,application_deployment_epoch)
      VALUES($1,$2,$3,$4,$2,$5,$5,$6,$7,$8,$9)`, [revisionId, base.id, input.jobId, revisionNumber.toString(), treeDigest, input.logicalOperationId ?? job.logical_operation_id ?? null, input.correlationId ?? job.correlation_id ?? null, job.platform_incarnation_id, job.application_deployment_epoch]);
    for (const file of files.values()) {
      const fileId = randomUUID();
      await client.query(`INSERT INTO kcml.generation_workspace_file(id,parent_id,workspace_revision_id,relative_path,mime_type,file_type,executable,content_storage,content_reference,size_bytes,content_digest,source_classification,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$11,$13,$14,$15,$16,$17)`, [fileId, revisionId, revisionId, file.relative_path, file.mime_type, file.file_type, file.executable, file.content_storage, file.content_reference, file.size_bytes, Buffer.from(file.content_digest), file.source_classification, input.logicalOperationId ?? job.logical_operation_id ?? null, input.correlationId ?? job.correlation_id ?? null, job.activation_epoch, job.platform_incarnation_id, job.application_deployment_epoch]);
    }
    await client.query(`UPDATE kcml.generation_workspace_patch SET apply_state='APPLIED',result_workspace_revision_id=$2,applied_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`, [patchId, revisionId]);
    const changed = (await client.query(`UPDATE kcml.generation_job SET workspace_revision_id=$2,latest_checkpoint_id=NULL,state_version=state_version+1 WHERE id=$1 AND workspace_revision_id=$3 RETURNING *`, [input.jobId, revisionId, base.id])).rows[0];
    if (!changed) throw new DomainError('GENERATION_WORKSPACE_CAS_CONFLICT', 'Workspace pointer changed while applying patch', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
    const cp = await checkpoint(client, changed, String(changed.lifecycle), 'WORKSPACE_REVISION', { patchId, baseRevisionId: base.id, resultRevisionId: revisionId, revisionNumber: revisionNumber.toString(), operationsDigest: `sha256:${operationsDigest.toString('hex')}` }, phaseRunId, null);
    await client.query('UPDATE kcml.generation_job SET latest_checkpoint_id=$2,state_version=state_version+1 WHERE id=$1', [input.jobId, cp.id]);
    await event(client, changed, 'generation.workspace.revision.created', { patchId, revisionId, revisionNumber: revisionNumber.toString() }, phaseRunId, cp.id);
    return { patchId, revisionId, revisionNumber: revisionNumber.toString(), treeDigest: `sha256:${treeDigest.toString('hex')}`, checkpointId: cp.id, files: files.size };
  });
}

export async function runGenerationValidation(pool: DatabasePool, input: { validationRunId: string; platformIncarnationId?: string; applicationDeploymentEpoch?: bigint; }): Promise<any> {
  return withSerializableRetry(pool, async (client) => {
    const run = (await client.query('SELECT * FROM kcml.generation_validation_run WHERE id=$1 FOR UPDATE', [input.validationRunId])).rows[0];
    if (!run) throw new DomainError('GENERATION_VALIDATION_NOT_FOUND', 'Generation validation run does not exist', 404, 'DO_NOT_RETRY');
    const job = await lockJob(client, String(run.job_id));
    assertLineage(job, input.platformIncarnationId, input.applicationDeploymentEpoch);
    const candidate = run.candidate_id ? (await client.query('SELECT * FROM kcml.generation_contract_candidate WHERE id=$1 AND job_id=$2', [run.candidate_id, run.job_id])).rows[0] : null;
    const workspace = job.workspace_revision_id ? (await client.query('SELECT * FROM kcml.generation_workspace_revision WHERE id=$1 AND job_id=$2', [job.workspace_revision_id, run.job_id])).rows[0] : null;
    const gates = [
      { gateKey: 'WORKSPACE_REVISION_PRESENT', pass: Boolean(workspace), actual: { revisionId: workspace?.id ?? null } },
      { gateKey: 'WORKSPACE_DIGEST_COMPLETE', pass: Boolean(workspace?.source_tree_digest && Buffer.from(workspace.source_tree_digest).length === 32), actual: { digest: workspace?.source_tree_digest ? Buffer.from(workspace.source_tree_digest).toString('hex') : null } },
      { gateKey: 'CANDIDATE_INTEGRATED', pass: String(candidate?.integration_state ?? '') === 'INTEGRATED', actual: { integrationState: candidate?.integration_state ?? null } },
      { gateKey: 'CANDIDATE_REVISION_DIGEST', pass: Boolean(candidate?.revision_digest && Buffer.from(candidate.revision_digest).length === 32), actual: { digest: candidate?.revision_digest ? Buffer.from(candidate.revision_digest).toString('hex') : null } }
    ];
    for (const gate of gates) {
      const resultDigest = digest({ validationRunId: run.id, gateKey: gate.gateKey, pass: gate.pass, actual: gate.actual });
      await client.query(`INSERT INTO kcml.generation_validation_result(validation_run_id,gate_key,evaluator_version,status,inputs,expected,actual,diagnostics,duration_ms,result_digest,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
        VALUES($1,$2,'generation-v1',$3,$4,$5,$6,$7,0,$8,$8,$9,$10,$11,$12,$13)`, [run.id, gate.gateKey, gate.pass ? 'PASS' : 'FAIL', { jobId: run.job_id, workspaceRevisionId: workspace?.id ?? null, candidateId: candidate?.id ?? null }, { pass: true }, gate.actual, gate.pass ? [] : [`${gate.gateKey} failed`], resultDigest, run.logical_operation_id ?? job.logical_operation_id ?? null, run.correlation_id ?? job.correlation_id ?? null, job.activation_epoch, job.platform_incarnation_id, job.application_deployment_epoch]);
    }
    const passed = gates.every((gate) => gate.pass);
    const summary = { gateCatalogVersion: 'generation-v1', passed, gates: gates.map(({ gateKey, pass, actual }) => ({ gateKey, pass, actual })) };
    const evidenceDigest = digest(summary);
    const updated = (await client.query(`UPDATE kcml.generation_validation_run SET state=$2,completed_at=clock_timestamp(),blocking_summary=$3,evidence_digest=$4,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state IN ('RUNNING','QUEUED') RETURNING *`, [run.id, passed ? 'PASS' : 'FAIL', summary, evidenceDigest])).rows[0];
    if (!updated) throw new DomainError('GENERATION_VALIDATION_TERMINAL', 'Validation run has already been completed', 409, 'RECONCILE_THEN_RETRY');
    if (candidate) await client.query(`UPDATE kcml.generation_contract_candidate SET validation_state=$2,verification_state=$3,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND job_id=$4`, [candidate.id, passed ? 'PASS' : 'FAIL', passed ? 'PASS' : 'FAIL', run.job_id]);
    return { validationRun: updated, passed, evidenceDigest: `sha256:${evidenceDigest.toString('hex')}`, gates: summary.gates };
  });
}

export async function prepareGenerationActivation(pool: DatabasePool, input: { jobId: string; candidateId: string; candidateSnapshot: JsonObject; membership?: readonly JsonObject[]; previousSnapshot?: JsonObject; platformIncarnationId?: string; applicationDeploymentEpoch?: bigint; logicalOperationId?: string; correlationId?: string; }): Promise<any> {
  return withSerializableRetry(pool, async (client) => {
    const job = await lockJob(client, input.jobId);
    assertLineage(job, input.platformIncarnationId, input.applicationDeploymentEpoch);
    const candidate = (await client.query('SELECT * FROM kcml.generation_contract_candidate WHERE id=$1 AND job_id=$2 FOR UPDATE', [input.candidateId, input.jobId])).rows[0];
    if (!candidate) throw new DomainError('GENERATION_CANDIDATE_NOT_FOUND', 'Generation candidate does not exist', 404, 'DO_NOT_RETRY');
    if (candidate.validation_state !== 'PASS' || candidate.verification_state !== 'PASS' || candidate.integration_state !== 'INTEGRATED') throw new DomainError('GENERATION_ACTIVATION_GATES_FAILED', 'Activation requires passed validation, verification and integration', 409, 'DO_NOT_RETRY');
    const activationHead = (await client.query('SELECT * FROM kcml.activation_head WHERE singleton_key=1 FOR UPDATE')).rows[0];
    if (!activationHead) throw new DomainError('AUTHORITY_HEADS_MISSING', 'Activation authority head is missing', 503, 'RETRY_SAME_OPERATION');
    const previousSnapshot = input.previousSnapshot ?? { state: activationHead.current_activation_set_id ? 'ACTIVE' : 'ABSENT', activationSetId: activationHead.current_activation_set_id ?? null, activationEpoch: String(activationHead.current_epoch) };
    const activationSetId = randomUUID();
    const candidateSnapshot = { ...input.candidateSnapshot, jobId: input.jobId, candidateId: input.candidateId, provisionalIdentity: job.provisional_identity ?? null };
    const row = (await client.query(`INSERT INTO kcml.generation_activation_set(id,state,previous_snapshot,candidate_snapshot,membership,rollback_plan,activation_epoch,platform_incarnation_id,application_deployment_epoch)
      VALUES($1,'READY',$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [activationSetId, safeJson(previousSnapshot), safeJson(candidateSnapshot), safeJson(input.membership ?? [{ objectKind: candidate.candidate_kind, objectId: input.candidateId, activationOrderKey: '0001' }]), { previousSnapshot: safeJson(previousSnapshot), failureState: 'ABSENT' }, BigInt(activationHead.current_epoch) + 1n, job.platform_incarnation_id, job.application_deployment_epoch])).rows[0];
    const members: JsonObject[] = input.membership ? [...input.membership] : [{ objectKind: candidate.candidate_kind, objectId: input.candidateId }];
    for (const [index, member] of members.entries()) {
      await client.query(`INSERT INTO kcml.generation_activation_member(activation_set_id,object_kind,object_id,activation_order_key,state,evidence,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
        VALUES($1,$2,$3,$4,'READY',$5,$6,$7,$8,$9,$10,$11)`, [activationSetId, String(member.objectKind ?? candidate.candidate_kind), String(member.objectId ?? input.candidateId), String(member.activationOrderKey ?? String(index + 1).padStart(4, '0')), safeJson(member), digest(member), input.logicalOperationId ?? job.logical_operation_id ?? null, input.correlationId ?? job.correlation_id ?? null, row.activation_epoch, job.platform_incarnation_id, job.application_deployment_epoch]);
    }
    const changed = (await client.query(`UPDATE kcml.generation_job SET lifecycle='ACTIVATING',current_phase='ACTIVATING',activation_set_id=$2,previous_activation_snapshot=$3,activation_epoch=$4,state_version=state_version+1 WHERE id=$1 AND lifecycle='CML_CONFORMANCE' RETURNING *`, [job.id, activationSetId, safeJson(previousSnapshot), row.activation_epoch])).rows[0];
    if (!changed) throw new DomainError('GENERATION_ACTIVATION_STATE_INVALID', 'Generation job is not ready for activation', 409, 'RECONCILE_THEN_RETRY');
    await event(client, changed, 'generation.activation.started', { activationSetId, previousSnapshot, candidateSnapshot });
    return { activationSet: row, job: changed, previousSnapshot, candidateSnapshot };
  });
}

export async function switchGenerationActivation(pool: DatabasePool, input: { jobId: string; activationSetId: string; expectedStateVersion?: bigint | null; platformIncarnationId?: string; applicationDeploymentEpoch?: bigint; }): Promise<any> {
  return withSerializableRetry(pool, async (client) => {
    const job = await lockJob(client, input.jobId, input.expectedStateVersion);
    assertLineage(job, input.platformIncarnationId, input.applicationDeploymentEpoch);
    const set = (await client.query('SELECT * FROM kcml.generation_activation_set WHERE id=$1 FOR UPDATE', [input.activationSetId])).rows[0];
    if (!set || String(set.state) !== 'READY') throw new DomainError('GENERATION_ACTIVATION_SET_NOT_READY', 'Only a frozen READY activation set can switch', 409, 'RECONCILE_THEN_RETRY');
    const head = (await client.query('SELECT * FROM kcml.activation_head WHERE singleton_key=1 FOR UPDATE')).rows[0];
    const nextEpoch = BigInt(head.current_epoch) + 1n;
    const pre = await checkpoint(client, job, 'ACTIVATING', 'ACTIVATION_PRE', { activationSetId: set.id, previousSnapshot: set.previous_snapshot, candidateSnapshot: set.candidate_snapshot, nextEpoch: nextEpoch.toString() }, null, null);
    await client.query(`UPDATE kcml.generation_activation_set SET state='SWITCHING',activation_epoch=$2,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`, [set.id, nextEpoch.toString()]);
    await client.query(`UPDATE kcml.activation_head SET current_epoch=$1,current_activation_set_id=$2,state_version=state_version+1,updated_at=clock_timestamp() WHERE singleton_key=1 AND current_epoch=$3`, [nextEpoch.toString(), set.id, head.current_epoch]);
    const verifying = (await client.query(`UPDATE kcml.generation_activation_set SET state='VERIFYING',state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='SWITCHING' RETURNING *`, [set.id])).rows[0];
    if (!verifying) throw new DomainError('GENERATION_ACTIVATION_SWITCH_CONFLICT', 'Activation set did not enter postflight verification', 409, 'RECONCILE_THEN_RETRY');
    const verified = (await client.query(`UPDATE kcml.generation_activation_set SET state='ACTIVE',state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='VERIFYING' RETURNING *`, [set.id])).rows[0];
    if (!verified) throw new DomainError('GENERATION_ACTIVATION_SWITCH_CONFLICT', 'Activation set postflight verification failed', 409, 'RECONCILE_THEN_RETRY');
    const post = await checkpoint(client, job, 'ACTIVATING', 'ACTIVATION_POST', { activationSetId: set.id, activationEpoch: nextEpoch.toString(), state: 'ACTIVE' }, null, null);
    const changed = (await client.query(`UPDATE kcml.generation_job SET lifecycle='COMPLETED',current_phase='COMPLETED',activation_epoch=$2,latest_checkpoint_id=$3,result_digest=$4,terminal_evidence=$5,active_phase_run_id=NULL,state_version=state_version+1 WHERE id=$1 AND lifecycle='ACTIVATING' RETURNING *`, [job.id, nextEpoch.toString(), post.id, digest({ activationSetId: set.id, activationEpoch: nextEpoch.toString(), state: 'COMPLETED' }), { activationSetId: set.id, activationEpoch: nextEpoch.toString(), state: 'COMPLETED' }])).rows[0];
    if (!changed) throw new DomainError('GENERATION_ACTIVATION_JOB_CONFLICT', 'Generation job was not activating', 409, 'RECONCILE_THEN_RETRY');
    await event(client, changed, 'generation.activation.completed', { activationSetId: set.id, activationEpoch: nextEpoch.toString() }, null, post.id);
    return { job: changed, activationSet: verified, activationEpoch: nextEpoch.toString(), preCheckpointId: pre.id, postCheckpointId: post.id };
  });
}

export async function rollbackGenerationActivation(pool: DatabasePool, input: { jobId: string; activationSetId: string; reason: string; platformIncarnationId?: string; applicationDeploymentEpoch?: bigint; }): Promise<any> {
  return withSerializableRetry(pool, async (client) => {
    const job = await lockJob(client, input.jobId);
    assertLineage(job, input.platformIncarnationId, input.applicationDeploymentEpoch);
    const set = (await client.query('SELECT * FROM kcml.generation_activation_set WHERE id=$1 FOR UPDATE', [input.activationSetId])).rows[0];
    if (!set) throw new DomainError('GENERATION_ACTIVATION_SET_NOT_FOUND', 'Activation set does not exist', 404, 'DO_NOT_RETRY');
    const head = (await client.query('SELECT * FROM kcml.activation_head WHERE singleton_key=1 FOR UPDATE')).rows[0];
    if (!['ACTIVE', 'VERIFYING'].includes(String(set.state)) || String(head.current_activation_set_id) !== String(set.id)) throw new DomainError('GENERATION_ACTIVATION_ROLLBACK_STALE', 'Rollback requires the current candidate activation set', 409, 'RECONCILE_THEN_RETRY');
    const nextEpoch = BigInt(head.current_epoch) + 1n;
    const previous = (set.previous_snapshot ?? {}) as JsonObject;
    const previousSetId = typeof previous.activationSetId === 'string' ? previous.activationSetId : null;
    await client.query(`UPDATE kcml.generation_activation_set SET state='ROLLING_BACK',activation_epoch=$2,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`, [set.id, nextEpoch.toString()]);
    await client.query(`UPDATE kcml.activation_head SET current_epoch=$1,current_activation_set_id=$2,state_version=state_version+1,updated_at=clock_timestamp() WHERE singleton_key=1 AND current_epoch=$3`, [nextEpoch.toString(), previousSetId, head.current_epoch]);
    await client.query(`UPDATE kcml.generation_activation_set SET state='ROLLBACK_VERIFYING',state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='ROLLING_BACK'`, [set.id]);
    const restored = (await client.query(`UPDATE kcml.generation_activation_set SET state='ROLLED_BACK',state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='ROLLBACK_VERIFYING' RETURNING *`, [set.id])).rows[0];
    const changed = (await client.query(`UPDATE kcml.generation_job SET lifecycle='BLOCKED',current_phase='BLOCKED',activation_epoch=$2,terminal_evidence=$3,state_version=state_version+1 WHERE id=$1 AND lifecycle NOT IN ('COMPLETED','FAILED','CANCELLED') RETURNING *`, [job.id, nextEpoch.toString(), { rollback: true, activationSetId: set.id, restoredActivationSetId: previousSetId, reason: input.reason, state: previousSetId ? 'PREVIOUS_RESTORED' : 'ABSENT' }])).rows[0];
    if (!changed) throw new DomainError('GENERATION_ROLLBACK_CONFLICT', 'Generation job cannot be rolled back from its terminal state', 409, 'DO_NOT_RETRY');
    const cp = await checkpoint(client, changed, 'BLOCKED', 'ACTIVATION_POST', { rollback: true, activationSetId: set.id, restoredActivationSetId: previousSetId, activationEpoch: nextEpoch.toString(), reason: input.reason }, null, null);
    await event(client, changed, 'generation.activation.rollback.completed', { activationSetId: set.id, restoredActivationSetId: previousSetId, activationEpoch: nextEpoch.toString(), reason: input.reason }, null, cp.id);
    return { job: changed, activationSet: restored, restoredActivationSetId: previousSetId, activationEpoch: nextEpoch.toString(), checkpointId: cp.id };
  });
}

export async function cleanupGenerationJob(pool: DatabasePool, jobId: string): Promise<any> {
  return withSerializableRetry(pool, async (client) => {
    const job = await lockJob(client, jobId);
    const heads = (await client.query(`SELECT p.platform_incarnation_id,d.current_epoch FROM kcml.platform_incarnation p CROSS JOIN kcml.application_deployment_head d WHERE p.singleton_key=1 AND d.singleton_key=1`)).rows[0];
    if (!heads) throw new DomainError('AUTHORITY_HEADS_MISSING', 'Platform authority heads are missing', 503, 'RETRY_SAME_OPERATION');
    const cleanupId = randomUUID();
    await client.query(`INSERT INTO kcml.cleanup_operation(id,parent_kind,parent_id,status,platform_incarnation_id,application_deployment_epoch) VALUES($1,'GENERATION_JOB',$2,'RUNNING',$3,$4)`, [cleanupId, jobId, heads.platform_incarnation_id, heads.current_epoch]);
    const phaseRuns = Number((await client.query(`SELECT count(*)::int AS count FROM kcml.generation_phase_run WHERE job_id=$1 AND state IN ('QUEUED','RUNNING','WAITING_FOR_DEPENDENCY','WAITING_FOR_OWNER','REPAIRING','CANCEL_REQUESTED')`, [jobId])).rows[0].count);
    const pendingPatches = Number((await client.query(`SELECT count(*)::int AS count FROM kcml.generation_workspace_patch WHERE job_id=$1 AND apply_state IN ('APPLYING','PENDING')`, [jobId])).rows[0].count);
    const activeActivation = Number((await client.query(`SELECT count(*)::int AS count FROM kcml.generation_activation_set WHERE (candidate_snapshot->>'jobId')=$1 AND state IN ('DRAFT','READY','SWITCHING','VERIFYING','ROLLING_BACK','ROLLBACK_VERIFYING')`, [jobId])).rows[0].count);
    const inventory = [
      ['PHASE_RUN', phaseRuns, { terminal: 'no live phase run' }],
      ['WORKSPACE_PATCH', pendingPatches, { terminal: 'no pending workspace patch' }],
      ['ACTIVATION_SET', activeActivation, { terminal: 'no provisional activation set' }]
    ] as const;
    for (const [kind, count, desired] of inventory) {
      await client.query(`INSERT INTO kcml.cleanup_resource(cleanup_operation_id,resource_kind,stable_key,desired_terminal_condition,status,evidence) VALUES($1,$2,$3,$4,$5,$6)`, [cleanupId, kind, `${jobId}:${kind}`, desired, count === 0 ? 'VERIFIED_ABSENT' : 'FAILED', { count }]);
    }
    const complete = phaseRuns === 0 && pendingPatches === 0 && activeActivation === 0;
    const evidence = { jobId, phaseRuns, pendingPatches, activeActivation, inventory, terminalClosure: complete, generatedAt: new Date().toISOString() };
    await client.query(`UPDATE kcml.cleanup_operation SET status=$2,closure_evidence=$3,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`, [cleanupId, complete ? 'CLOSED' : 'FAILED', evidence]);
    await client.query(`UPDATE kcml.generation_job SET cleanup_operation_id=$2,state_version=state_version+1,recovery_state=$3 WHERE id=$1`, [jobId, cleanupId, complete ? 'READY' : 'RECOVERY_REQUIRED']);
    return { cleanupId, status: complete ? 'COMPLETE' : 'FAILED', terminalClosure: complete, evidence };
  });
}
