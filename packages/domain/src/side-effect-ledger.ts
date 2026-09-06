import { createHash } from 'node:crypto';
import type { DatabaseClient } from '@kcml/database';
import { canonicalJson, toCanonicalJsonValue } from '@kcml/schemas';

export interface SideEffectAuthorityContext {
  commandId: string;
  logicalOperationId: string;
  operationName: string;
  sideEffectClass: string;
  retryClass: string;
  platformIncarnationId: string;
  applicationDeploymentEpoch: bigint;
  recoveryEpoch: bigint;
}

export interface SideEffectIntentRecord {
  id: string;
  currentAttemptSequence: bigint;
  status: string;
}

function digest(value: unknown): Buffer {
  return createHash('sha256').update(canonicalJson(toCanonicalJsonValue(value))).digest();
}

export async function recordSideEffectIntent(
  client: DatabaseClient,
  context: SideEffectAuthorityContext,
  stepKey: string,
  targetBinding: string,
  request: Readonly<Record<string, unknown>>,
  reconciliationContract: Readonly<Record<string, unknown>>
): Promise<SideEffectIntentRecord> {
  const requestDigest = digest(request);
  await client.query(`INSERT INTO kcml.side_effect_operation(command_id,step_key,target_binding,request,request_digest,idempotency_key,side_effect_class,retry_class,reconciliation_contract,platform_incarnation_id,application_deployment_epoch,recovery_epoch)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT(command_id,step_key) DO NOTHING`, [
    context.commandId, stepKey, targetBinding, request, requestDigest,
    `${context.logicalOperationId}:${stepKey}`, context.sideEffectClass, context.retryClass,
    reconciliationContract, context.platformIncarnationId, context.applicationDeploymentEpoch.toString(), context.recoveryEpoch.toString()
  ]);
  const row = (await client.query(`SELECT id,current_attempt_sequence,status,request_digest FROM kcml.side_effect_operation WHERE command_id=$1 AND step_key=$2 FOR UPDATE`, [context.commandId, stepKey])).rows[0];
  if (!row) throw new Error('SIDE_EFFECT_INTENT_MISSING');
  if (!Buffer.isBuffer(row.request_digest) || !row.request_digest.equals(requestDigest)) throw new Error('SIDE_EFFECT_INTENT_DIGEST_MISMATCH');
  const attemptSequence = BigInt(String(row.current_attempt_sequence));
  await client.query(`INSERT INTO kcml.side_effect_attempt(operation_id,attempt_sequence,request_evidence,request_digest)
    VALUES($1,$2,$3,$4) ON CONFLICT(operation_id,attempt_sequence) DO NOTHING`, [row.id, attemptSequence.toString(), request, requestDigest]);
  await client.query(`INSERT INTO kcml.side_effect_attempt_state(operation_id,attempt_sequence,status)
    VALUES($1,$2,'INTENT_RECORDED') ON CONFLICT(operation_id,attempt_sequence) DO NOTHING`, [row.id, attemptSequence.toString()]);
  return { id: String(row.id), currentAttemptSequence: attemptSequence, status: String(row.status) };
}

export async function recordSideEffectReadbackEvidence(
  client: DatabaseClient,
  operationId: string,
  payload: unknown,
  disposition: 'CONFIRMED_APPLIED' | 'CONFIRMED_NOT_APPLIED' | 'UNKNOWN' | 'FAILED_FINAL'
): Promise<void> {
  const operation = (await client.query(`SELECT current_attempt_sequence FROM kcml.side_effect_operation WHERE id=$1 FOR UPDATE`, [operationId])).rows[0];
  if (!operation) throw new Error('SIDE_EFFECT_OPERATION_NOT_FOUND');
  const attemptSequence = BigInt(String(operation.current_attempt_sequence));
  const next = (await client.query(`SELECT coalesce(max(evidence_sequence),0)+1 AS next FROM kcml.side_effect_attempt_evidence WHERE operation_id=$1 AND attempt_sequence=$2`, [operationId, attemptSequence.toString()])).rows[0]?.next;
  const evidenceSequence = BigInt(String(next ?? 1));
  const safePayload = toCanonicalJsonValue(payload);
  const payloadDigest = digest(safePayload);
  await client.query(`INSERT INTO kcml.side_effect_attempt_evidence(operation_id,attempt_sequence,evidence_sequence,evidence_type,payload,payload_digest)
    VALUES($1,$2,$3,'INDEPENDENT_READBACK',$4,$5)`, [operationId, attemptSequence.toString(), evidenceSequence.toString(), safePayload, payloadDigest]);
  await client.query(`UPDATE kcml.side_effect_attempt_state SET status=$3,last_evidence_sequence=$4,state_version=state_version+1,updated_at=clock_timestamp()
    WHERE operation_id=$1 AND attempt_sequence=$2`, [operationId, attemptSequence.toString(), disposition, evidenceSequence.toString()]);
  await client.query(`UPDATE kcml.side_effect_operation SET status=$2,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`, [operationId, disposition]);
}
