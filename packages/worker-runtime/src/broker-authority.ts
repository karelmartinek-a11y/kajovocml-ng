import { createHash } from 'node:crypto';
import type { DatabaseClient, DatabasePool } from '@kcml/database';
import { canonicalJson, toCanonicalJsonValue } from '@kcml/schemas';

export interface RuntimeExecutionLineage {
  executionId: string;
  executionKind: string;
  sourceObjectKind: string;
  sourceObjectId: string;
  sourceRevisionId: string;
  bindingSetRevisionId: string;
  bindingSetRevisionNumber: string;
  activationEpoch: string;
  activationSetId: string | null;
  runtimeInstanceId: string | null;
  runtimeGeneration: string;
  platformIncarnationId: string;
  applicationDeploymentEpoch: string;
  lineageDigest: string;
}

type Queryable = Pick<DatabasePool, 'query'> | Pick<DatabaseClient, 'query'>;

export function runtimeLineageDigest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(toCanonicalJsonValue(value))).digest('hex')}`;
}

export function runtimeStateNamespace(lineage: RuntimeExecutionLineage): string {
  return `runtime-state:${lineage.lineageDigest.slice('sha256:'.length)}`;
}

export function assertRuntimeLocalStateKey(value: unknown): string {
  const key = String(value ?? '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u.test(key)) throw new Error('RUNTIME_STATE_KEY_INVALID');
  return key;
}

/** Resolve authority exclusively from immutable server-side execution and activation records. */
export async function loadRuntimeExecutionLineage(db: Queryable, executionId: string, lock = false): Promise<RuntimeExecutionLineage> {
  const result = await db.query(`SELECT
      e.id,e.execution_kind,e.source_object_kind,e.source_object_id,e.source_revision_id,
      e.binding_set_revision_id,b.revision_number,e.activation_epoch,e.platform_incarnation_id,
      e.application_deployment_epoch,
      r.id AS runtime_instance_id,r.runtime_generation,
      NULLIF(e.systemd_identity->>'runtimeGeneration','') AS declared_runtime_generation,
      a.current_activation_set_id AS activation_set_id
    FROM kcml.runtime_execution_context e
    JOIN kcml.binding_set_revision b ON b.id=e.binding_set_revision_id
    JOIN kcml.binding_set sb ON sb.id=b.binding_set_id AND sb.current_revision_id=b.id
    JOIN kcml.platform_incarnation p ON p.singleton_key=1 AND p.platform_incarnation_id=e.platform_incarnation_id
    JOIN kcml.application_deployment_head d ON d.singleton_key=1 AND d.current_epoch=e.application_deployment_epoch
    JOIN kcml.activation_head a ON a.singleton_key=1 AND a.current_epoch=e.activation_epoch
    LEFT JOIN kcml.runtime_instance r ON e.execution_kind='COMPONENT'
      AND r.component_id=e.source_object_id AND r.source_revision_id=e.source_revision_id
      AND r.binding_set_revision_id=e.binding_set_revision_id AND r.activation_epoch=e.activation_epoch
      AND r.platform_incarnation_id=e.platform_incarnation_id
      AND r.application_deployment_epoch=e.application_deployment_epoch
      AND r.desired_state='READY' AND r.effective_state='READY'
    LEFT JOIN kcml.component c ON e.execution_kind='COMPONENT' AND c.id=e.source_object_id
    WHERE e.id=$1 AND e.lifecycle='ACTIVE' AND e.state='ACTIVE'
      AND e.completed_at IS NULL AND e.deleted_at IS NULL
      AND (e.execution_kind<>'COMPONENT' OR (
        c.lifecycle='ACTIVE' AND c.activation_state='ACTIVE' AND c.enabled
        AND c.active_revision_id=e.source_revision_id
        AND c.active_binding_set_revision_id=e.binding_set_revision_id
        AND c.current_activation_epoch=e.activation_epoch
      ))
    ${lock ? 'FOR SHARE OF e,b,sb,p,d,a' : ''}`, [executionId]);
  if (result.rowCount !== 1) throw new Error('RUNTIME_EXECUTION_AUTHORITY_STALE');
  const row = result.rows[0];
  const runtimeGeneration = row.runtime_generation ?? row.declared_runtime_generation;
  if (runtimeGeneration === null || BigInt(runtimeGeneration) < 1n) throw new Error('RUNTIME_GENERATION_AUTHORITY_MISSING');
  const raw = {
    executionId: String(row.id), executionKind: String(row.execution_kind), sourceObjectKind: String(row.source_object_kind),
    sourceObjectId: String(row.source_object_id), sourceRevisionId: String(row.source_revision_id),
    bindingSetRevisionId: String(row.binding_set_revision_id), bindingSetRevisionNumber: String(row.revision_number),
    activationEpoch: String(row.activation_epoch), activationSetId: row.activation_set_id ? String(row.activation_set_id) : null,
    runtimeInstanceId: row.runtime_instance_id ? String(row.runtime_instance_id) : null,
    runtimeGeneration: String(runtimeGeneration), platformIncarnationId: String(row.platform_incarnation_id),
    applicationDeploymentEpoch: String(row.application_deployment_epoch)
  };
  return { ...raw, lineageDigest: runtimeLineageDigest(raw) };
}

export function assertStateDocumentWithinLimits(values: Record<string, unknown>): void {
  const entries = Object.keys(values);
  if (entries.length > 256) throw new Error('RUNTIME_STATE_NAMESPACE_QUOTA_EXCEEDED');
  const bytes = Buffer.byteLength(canonicalJson(toCanonicalJsonValue(values)));
  if (bytes > 1024 * 1024) throw new Error('RUNTIME_STATE_NAMESPACE_QUOTA_EXCEEDED');
}

export function assertStateValueWithinLimits(value: unknown): void {
  const bytes = Buffer.byteLength(canonicalJson(toCanonicalJsonValue(value)));
  if (bytes > 64 * 1024) throw new Error('RUNTIME_STATE_VALUE_TOO_LARGE');
}
