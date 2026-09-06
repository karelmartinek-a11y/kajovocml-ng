from pathlib import Path

outbox = r'''import { createHash } from 'node:crypto';
import { canonicalJson, toCanonicalJsonValue } from '@kcml/schemas';
import { inTransactionProfile, type DatabaseClient, type DatabasePool } from '@kcml/database';

interface OutboxRow {
  id: string;
  stream_key: string;
  stream_sequence: string | number | bigint;
  purpose: string;
  event_type: string;
  aggregate_id: string | null;
  payload: unknown;
  payload_digest: Buffer;
  recovery_epoch: string | number | bigint;
  delivery_fencing_token: string | number | bigint;
}

export interface OutboxDeliveryOptions {
  workerId: string;
  leaseSeconds?: number;
}

function digestPayload(value: unknown): Buffer {
  return createHash('sha256').update(canonicalJson(toCanonicalJsonValue(value))).digest();
}

function sameDigest(left: unknown, right: Buffer): boolean {
  return Buffer.isBuffer(left) && left.length === right.length && left.equals(right);
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function appendDeliveryAudit(client: DatabaseClient, row: OutboxRow, consumerId: string, outcome: string): Promise<void> {
  const payload = { outboxId: row.id, streamKey: row.stream_key, streamSequence: String(row.stream_sequence), purpose: row.purpose, eventType: row.event_type, consumerId, outcome };
  const bytes = Buffer.from(canonicalJson(toCanonicalJsonValue(payload)));
  await client.query(`SELECT * FROM kcml.append_audit_event($1,'SYSTEM','kcml-outbox-relay','TRANSACTIONAL_OUTBOX',$2,NULL,NULL,$3,$4)`, [
    'outbox.delivery.completed', row.id, payload, bytes
  ]);
}

async function deliverDomainEvent(client: DatabaseClient, row: OutboxRow): Promise<string> {
  const consumerId = 'kcml-domain-event-ledger';
  await client.query(`INSERT INTO kcml.transactional_inbox(consumer_id,event_id,stream_key,stream_sequence,payload_digest,processed_at)
    VALUES($1,$2,$3,$4,$5,clock_timestamp()) ON CONFLICT (consumer_id,event_id) DO NOTHING`, [consumerId, row.id, row.stream_key, String(row.stream_sequence), row.payload_digest]);
  await appendDeliveryAudit(client, row, consumerId, 'DURABLY_CONSUMED');
  return consumerId;
}

async function deliverGenerationSuccessor(client: DatabaseClient, row: OutboxRow): Promise<string> {
  const consumerId = 'kcml-generation-phase-scheduler';
  const payload = jsonObject(row.payload);
  const phaseRunId = typeof payload.phaseRunId === 'string' ? payload.phaseRunId : null;
  const phase = typeof payload.phase === 'string' ? payload.phase : null;
  if (!phaseRunId || !phase || !row.aggregate_id) throw new Error('OUTBOX_GENERATION_SUCCESSOR_PAYLOAD_INVALID');
  const successor = (await client.query(`SELECT r.id,r.job_id,r.phase,r.state,r.worker_pool,j.active_phase_run_id,j.lifecycle,j.current_phase
    FROM kcml.generation_phase_run r JOIN kcml.generation_job j ON j.id=r.job_id
    WHERE r.id=$1 AND r.job_id=$2 FOR SHARE OF r,j`, [phaseRunId, row.aggregate_id])).rows[0];
  if (!successor) throw new Error('OUTBOX_GENERATION_SUCCESSOR_NOT_FOUND');
  if (String(successor.phase) !== phase || String(successor.state) !== 'QUEUED' || String(successor.active_phase_run_id) !== phaseRunId || String(successor.lifecycle) !== phase || String(successor.current_phase) !== phase) {
    throw new Error('OUTBOX_GENERATION_SUCCESSOR_STATE_MISMATCH');
  }
  await client.query(`INSERT INTO kcml.transactional_inbox(consumer_id,event_id,stream_key,stream_sequence,payload_digest,processed_at)
    VALUES($1,$2,$3,$4,$5,clock_timestamp()) ON CONFLICT (consumer_id,event_id) DO NOTHING`, [consumerId, row.id, row.stream_key, String(row.stream_sequence), row.payload_digest]);
  await appendDeliveryAudit(client, row, consumerId, 'SUCCESSOR_READY');
  return consumerId;
}

export class TransactionalOutboxDeliveryWorker {
  private readonly leaseSeconds: number;
  public constructor(private readonly pool: DatabasePool, private readonly options: OutboxDeliveryOptions) {
    this.leaseSeconds = Math.max(5, Math.min(options.leaseSeconds ?? 30, 300));
  }

  public async runOnce(): Promise<boolean> {
    const claim = await inTransactionProfile(this.pool, 'WORKER_COMMIT', async (client) => {
      const recovery = (await client.query(`SELECT recovery_epoch,state,database_identity_current,recovery_lineage_current FROM kcml.platform_recovery_head WHERE singleton_key=1 FOR SHARE`)).rows[0];
      if (!recovery || recovery.state !== 'READY' || recovery.database_identity_current !== true || recovery.recovery_lineage_current !== true) return null;
      await client.query(`UPDATE kcml.transactional_outbox SET status='PENDING',delivery_owner=NULL,delivery_lease_expires_at=NULL,state_version=state_version+1
        WHERE status='CLAIMED' AND delivery_lease_expires_at IS NOT NULL AND delivery_lease_expires_at<clock_timestamp()`);
      const row = (await client.query(`SELECT o.* FROM kcml.transactional_outbox o
        WHERE o.status='PENDING' AND o.available_at<=clock_timestamp() AND o.recovery_epoch=$1
          AND o.purpose IN ('DOMAIN_EVENT','GENERATION_PHASE_SUCCESSOR')
          AND NOT EXISTS (
            SELECT 1 FROM kcml.transactional_outbox predecessor
            WHERE predecessor.stream_key=o.stream_key AND predecessor.stream_sequence<o.stream_sequence
              AND predecessor.status NOT IN ('DELIVERED','FAILED_FINAL')
          )
        ORDER BY o.available_at,o.stream_key,o.stream_sequence,o.id
        FOR UPDATE OF o SKIP LOCKED LIMIT 1`, [recovery.recovery_epoch])).rows[0] as OutboxRow | undefined;
      if (!row) return null;
      const claimed = (await client.query(`UPDATE kcml.transactional_outbox
        SET status='CLAIMED',delivery_owner=$2,delivery_fencing_token=delivery_fencing_token+1,delivery_lease_expires_at=clock_timestamp()+($3::text||' seconds')::interval,state_version=state_version+1
        WHERE id=$1 AND status='PENDING' RETURNING *`, [row.id, this.options.workerId, String(this.leaseSeconds)])).rows[0] as OutboxRow | undefined;
      return claimed ?? null;
    });
    if (!claim) return false;

    try {
      await inTransactionProfile(this.pool, 'WORKER_COMMIT', async (client) => {
        const row = (await client.query(`SELECT * FROM kcml.transactional_outbox WHERE id=$1 FOR UPDATE`, [claim.id])).rows[0] as OutboxRow | undefined;
        if (!row || String((row as unknown as Record<string, unknown>).status) !== 'CLAIMED') return;
        const record = row as unknown as Record<string, unknown>;
        if (String(record.delivery_owner) !== this.options.workerId || BigInt(String(row.delivery_fencing_token)) !== BigInt(String(claim.delivery_fencing_token))) throw new Error('OUTBOX_DELIVERY_FENCE_STALE');
        const recovery = (await client.query(`SELECT recovery_epoch,state,database_identity_current,recovery_lineage_current FROM kcml.platform_recovery_head WHERE singleton_key=1 FOR SHARE`)).rows[0];
        if (!recovery || recovery.state !== 'READY' || recovery.database_identity_current !== true || recovery.recovery_lineage_current !== true || BigInt(String(recovery.recovery_epoch)) !== BigInt(String(row.recovery_epoch))) throw new Error('OUTBOX_RECOVERY_EPOCH_STALE');
        const recomputed = digestPayload(row.payload);
        if (!sameDigest(row.payload_digest, recomputed)) throw new Error('OUTBOX_PAYLOAD_DIGEST_MISMATCH');
        if (row.purpose === 'DOMAIN_EVENT') await deliverDomainEvent(client, row);
        else if (row.purpose === 'GENERATION_PHASE_SUCCESSOR') await deliverGenerationSuccessor(client, row);
        else throw new Error('OUTBOX_PURPOSE_UNSUPPORTED');
        const delivered = await client.query(`UPDATE kcml.transactional_outbox SET status='DELIVERED',delivered_at=clock_timestamp(),delivery_owner=NULL,delivery_lease_expires_at=NULL,state_version=state_version+1
          WHERE id=$1 AND status='CLAIMED' AND delivery_owner=$2 AND delivery_fencing_token=$3`, [row.id, this.options.workerId, String(row.delivery_fencing_token)]);
        if (delivered.rowCount !== 1) throw new Error('OUTBOX_DELIVERY_FENCE_STALE');
      });
      return true;
    } catch (error) {
      const deterministic = error instanceof Error && ['OUTBOX_GENERATION_SUCCESSOR_PAYLOAD_INVALID','OUTBOX_GENERATION_SUCCESSOR_NOT_FOUND','OUTBOX_GENERATION_SUCCESSOR_STATE_MISMATCH','OUTBOX_PAYLOAD_DIGEST_MISMATCH','OUTBOX_PURPOSE_UNSUPPORTED'].includes(error.message);
      await inTransactionProfile(this.pool, 'WORKER_COMMIT', async (client) => {
        await client.query(`UPDATE kcml.transactional_outbox
          SET status=$4,available_at=CASE WHEN $4='PENDING' THEN clock_timestamp()+interval '5 seconds' ELSE available_at END,delivery_owner=NULL,delivery_lease_expires_at=NULL,state_version=state_version+1
          WHERE id=$1 AND status='CLAIMED' AND delivery_owner=$2 AND delivery_fencing_token=$3`, [claim.id, this.options.workerId, String(claim.delivery_fencing_token), deterministic ? 'FAILED_FINAL' : 'PENDING']);
      });
      if (deterministic) return true;
      throw error;
    }
  }
}
'''
Path('packages/worker-runtime/src/outbox-delivery.ts').write_text(outbox, encoding='utf-8')

p = Path('packages/worker-runtime/src/index.ts')
t = p.read_text(encoding='utf-8')
marker = "import { authorizeEgressUrl, performPinnedRequest, type EgressPolicy } from './egress-policy.js';"
if marker not in t: raise SystemExit('worker-runtime import marker missing')
t = t.replace(marker, marker + "\nimport { TransactionalOutboxDeliveryWorker } from './outbox-delivery.js';", 1)
old = "  retryScheduler?: boolean;\n}"
new = "  retryScheduler?: boolean;\n  outboxDelivery?: boolean;\n}"
if old not in t: raise SystemExit('ServiceOptions marker missing')
t = t.replace(old, new, 1)
old = "  'kcml-retry-scheduler': { retryScheduler: true, runtimeKind: 'COMMAND_COORDINATOR', intervalMs: 250 }"
new = "  'kcml-retry-scheduler': { retryScheduler: true, outboxDelivery: true, runtimeKind: 'COMMAND_COORDINATOR', intervalMs: 250 }"
if old not in t: raise SystemExit('retry scheduler definition marker missing')
t = t.replace(old, new, 1)
old = "    capabilities: 'broker' in service ? [service.broker] : 'retryScheduler' in service ? ['CANONICAL_RETRY_SCHEDULER'] : []"
new = "    capabilities: 'broker' in service ? [service.broker] : 'retryScheduler' in service ? ['CANONICAL_RETRY_SCHEDULER', ...('outboxDelivery' in service && service.outboxDelivery ? ['TRANSACTIONAL_OUTBOX_DELIVERY'] : [])] : []"
if old not in t: raise SystemExit('readiness capabilities marker missing')
t = t.replace(old, new, 1)
old = "  const retryScheduler = options.retryScheduler && catalog ? new CanonicalRetryScheduler(pool, new CanonicalOperationService(pool, catalog), { workerId: instanceId }) : null;"
new = old + "\n  const outboxDelivery = options.outboxDelivery ? new TransactionalOutboxDeliveryWorker(pool, { workerId: instanceId }) : null;"
if old not in t: raise SystemExit('retry scheduler instance marker missing')
t = t.replace(old, new, 1)
old = "    if (!worked && retryScheduler) worked = await retryScheduler.runOnce().catch(async (error) => {\n      logger.error('retry-scheduler.iteration.failed', { error: error instanceof Error ? error.message : String(error) });\n      await heartbeat('FAILED', { error: error instanceof Error ? error.message : String(error) });\n      return false;\n    });"
new = old + "\n    if (!worked && outboxDelivery) worked = await outboxDelivery.runOnce().catch(async (error) => {\n      logger.error('outbox-delivery.iteration.failed', { error: error instanceof Error ? error.message : String(error) });\n      await heartbeat('FAILED', { error: error instanceof Error ? error.message : String(error) });\n      return false;\n    });"
if old not in t: raise SystemExit('run loop marker missing')
t = t.replace(old, new, 1)
p.write_text(t, encoding='utf-8')
print('batch5 ordered outbox delivery remediation applied')
