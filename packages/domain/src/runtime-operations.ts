import type { DatabaseClient, DatabasePool } from '@kcml/database';
import { inTransaction } from '@kcml/database';
import { canonicalDigest, type CanonicalJsonValue } from '@kcml/schemas';
import { DomainError } from './errors.js';

type JsonObject = Record<string, unknown>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function requiredTargetId(targetId: string | null, operationName: string): string {
  if (!targetId || !UUID_PATTERN.test(targetId)) {
    throw new DomainError('RUNTIME_TARGET_REQUIRED', `${operationName} requires an exact UUID target`, 422, 'DO_NOT_RETRY');
  }
  return targetId;
}

function boundedCallLimit(value: unknown): number {
  if (value === undefined) return 100;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 500) {
    throw new DomainError('RUNTIME_INSPECTION_LIMIT_INVALID', 'callLimit must be an integer between 1 and 500', 422, 'DO_NOT_RETRY');
  }
  return value;
}

function safeJson(value: unknown): CanonicalJsonValue {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item)) as CanonicalJsonValue;
}

function failedChecks(checks: JsonObject, prefix: string): string[] {
  return Object.entries(checks)
    .filter(([, passed]) => passed !== true)
    .map(([name]) => `${prefix}_${name.replace(/([a-z0-9])([A-Z])/gu, '$1_$2').toUpperCase()}`);
}

async function beginConsistentRead<T>(pool: DatabasePool, body: (client: DatabaseClient) => Promise<T>): Promise<T> {
  return inTransaction(pool, 'REPEATABLE READ', async (client) => {
    await client.query('SET TRANSACTION READ ONLY');
    return body(client);
  });
}

async function verifyRuntimeBoundary(pool: DatabasePool, targetId: string | null): Promise<unknown> {
  const runtimeInstanceId = requiredTargetId(targetId, 'runtime.boundary.verify');
  return beginConsistentRead(pool, async (client) => {
    const result = await client.query(`WITH current_heads AS (
        SELECT p.platform_incarnation_id AS current_platform_incarnation_id,
               deployment.current_epoch AS current_deployment_epoch,
               activation.current_epoch AS current_activation_epoch,
               recovery.recovery_epoch,
               recovery.state AS recovery_state,
               recovery.database_start_identity=kcml.current_database_start_identity() AS database_identity_current,
               recovery.platform_incarnation_id=p.platform_incarnation_id
                 AND recovery.application_deployment_epoch=deployment.current_epoch AS recovery_lineage_current
        FROM kcml.platform_incarnation p
        CROSS JOIN kcml.application_deployment_head deployment
        CROSS JOIN kcml.activation_head activation
        CROSS JOIN kcml.platform_recovery_head recovery
        WHERE p.singleton_key=1 AND deployment.singleton_key=1 AND activation.singleton_key=1 AND recovery.singleton_key=1
      ), selected AS (
        SELECT r.*, c.lifecycle AS component_lifecycle, c.activation_state AS component_activation_state,
               c.enabled AS component_enabled, c.active_revision_id, c.current_release_id,
               c.active_binding_set_revision_id, c.current_activation_epoch AS component_activation_epoch,
               c.platform_incarnation_id AS component_platform_incarnation_id,
               c.application_deployment_epoch AS component_deployment_epoch,
               revision.validation_state AS revision_validation_state,
               revision.verification_state AS revision_verification_state,
               revision.platform_incarnation_id AS revision_platform_incarnation_id,
               revision.application_deployment_epoch AS revision_deployment_epoch,
               release.state AS release_state, release.artifact_digest AS release_artifact_digest,
               release.runtime_digest AS release_runtime_digest,
               release.platform_incarnation_id AS release_platform_incarnation_id,
               release.application_deployment_epoch AS release_deployment_epoch,
               target.lifecycle AS target_lifecycle, target.transport AS target_transport,
               target.socket_path AS target_socket_path, target.execution_mode AS target_execution_mode,
               target.platform_incarnation_id AS target_platform_incarnation_id,
               target.application_deployment_epoch AS target_deployment_epoch,
               heads.*
        FROM kcml.runtime_instance r
        JOIN kcml.component c ON c.id=r.component_id
        JOIN kcml.component_revision revision ON revision.id=r.source_revision_id
        JOIN kcml.component_release release ON release.id=r.release_id
        JOIN kcml.component_runtime_target target ON target.id=r.runtime_target_id
        CROSS JOIN current_heads heads
        WHERE r.id=$1
      ), process_inventory AS (
        SELECT count(*) FILTER (WHERE exited_at IS NULL)::int AS active_process_count,
               count(*) FILTER (WHERE exited_at IS NULL AND process_role='HOST')::int AS active_host_count
        FROM kcml.runtime_process_identity WHERE runtime_instance_id=$1
      ), host AS (
        SELECT p.* FROM kcml.runtime_process_identity p
        WHERE p.runtime_instance_id=$1 AND p.process_role='HOST' AND p.exited_at IS NULL
        ORDER BY p.runtime_generation DESC,p.started_at DESC,p.id LIMIT 1
      ), connection_inventory AS (
        SELECT count(*) FILTER (WHERE state IN ('OPENING','ACTIVE','DRAINING'))::int AS open_connection_count
        FROM kcml.runtime_ipc_connection WHERE runtime_instance_id=$1
      ), inflight AS (
        SELECT count(*) FILTER (WHERE call.state IN ('RECEIVED','VALIDATED','DISPATCHED','STREAMING','RECONCILING'))::bigint AS call_count
        FROM selected runtime
        LEFT JOIN kcml.runtime_ipc_call call ON call.connection_id=runtime.runtime_gateway_connection_id
      )
      SELECT to_jsonb(runtime) AS runtime_snapshot,
             to_jsonb(host) AS host_process_snapshot,
             to_jsonb(connection) AS connection_snapshot,
             jsonb_build_object(
               'platformIncarnationId',runtime.current_platform_incarnation_id,
               'applicationDeploymentEpoch',runtime.current_deployment_epoch,
               'activationEpoch',runtime.current_activation_epoch,
               'recoveryEpoch',runtime.recovery_epoch,
               'recoveryState',runtime.recovery_state,
               'databaseIdentityCurrent',runtime.database_identity_current,
               'recoveryLineageCurrent',runtime.recovery_lineage_current
             ) AS authority_head,
             jsonb_build_object(
               'recoveryReady',runtime.recovery_state='READY' AND runtime.database_identity_current AND runtime.recovery_lineage_current,
               'runtimeLineageCurrent',runtime.platform_incarnation_id=runtime.current_platform_incarnation_id
                 AND runtime.platform_incarnation_id=runtime.component_platform_incarnation_id
                 AND runtime.platform_incarnation_id=runtime.revision_platform_incarnation_id
                 AND runtime.platform_incarnation_id=runtime.release_platform_incarnation_id
                 AND runtime.platform_incarnation_id=runtime.target_platform_incarnation_id,
               'deploymentEpochCurrent',runtime.application_deployment_epoch=runtime.current_deployment_epoch
                 AND runtime.component_deployment_epoch=runtime.current_deployment_epoch
                 AND runtime.revision_deployment_epoch=runtime.current_deployment_epoch
                 AND runtime.release_deployment_epoch=runtime.current_deployment_epoch
                 AND runtime.target_deployment_epoch=runtime.current_deployment_epoch,
               'activationEpochCurrent',runtime.activation_epoch=runtime.current_activation_epoch
                 AND runtime.component_activation_epoch=runtime.activation_epoch,
               'componentCurrent',runtime.component_lifecycle='ACTIVE' AND runtime.component_activation_state='ACTIVE' AND runtime.component_enabled
                 AND runtime.active_revision_id=runtime.source_revision_id AND runtime.current_release_id=runtime.release_id
                 AND runtime.active_binding_set_revision_id=runtime.binding_set_revision_id,
               'revisionEligible',runtime.revision_validation_state='VALID' AND runtime.revision_verification_state='VERIFIED',
               'releaseCurrent',runtime.release_state='ACTIVE' AND runtime.release_artifact_digest=runtime.artifact_digest
                 AND runtime.release_runtime_digest=runtime.runtime_digest,
               'targetCurrent',runtime.target_lifecycle='ACTIVE' AND runtime.target_transport IS NOT NULL
                 AND runtime.target_execution_mode IS NOT NULL,
               'runtimeReady',runtime.desired_state='READY' AND runtime.effective_state='READY'
                 AND runtime.effective_at IS NOT NULL AND runtime.ready_sequence>0,
               'runtimeProfilesComplete',octet_length(runtime.artifact_digest)=32 AND octet_length(runtime.runtime_digest)=32
                 AND octet_length(runtime.dependency_lock_digest)=32 AND octet_length(runtime.launch_manifest_digest)=32
                 AND octet_length(runtime.resource_profile_digest)=32 AND octet_length(runtime.namespace_profile_digest)=32
                 AND octet_length(runtime.seccomp_profile_digest)=32 AND octet_length(runtime.environment_profile_digest)=32
                 AND octet_length(runtime.fd_profile_digest)=32,
               'singleCurrentHost',inventory.active_host_count=1,
               'hostIdentityCurrent',host.id IS NOT NULL AND host.runtime_generation=runtime.runtime_generation
                 AND host.linux_pid=runtime.main_pid AND host.linux_uid=runtime.linux_uid AND host.linux_gid=runtime.linux_gid
                 AND host.host_boot_id=runtime.host_boot_id AND host.process_start_ticks=runtime.process_start_ticks
                 AND host.systemd_unit=runtime.systemd_unit_name AND host.invocation_id=runtime.systemd_invocation_id
                 AND host.cgroup_path=runtime.cgroup_path AND host.ready_at IS NOT NULL AND host.exited_at IS NULL
                 AND host.namespace_profile_digest=runtime.namespace_profile_digest
                 AND host.release_digest=runtime.artifact_digest AND octet_length(host.identity_digest)=32,
               'gatewayConnectionCurrent',connection.id IS NOT NULL AND connection.id=runtime.runtime_gateway_connection_id
                 AND connection.state='ACTIVE' AND connection.validated_at IS NOT NULL AND connection.closed_at IS NULL
                 AND connection.transport_kind='RUNTIME_GATEWAY_UDS' AND connection.runtime_instance_id=runtime.id
                 AND connection.runtime_generation=runtime.runtime_generation
                 AND connection.service_invocation_id=runtime.systemd_invocation_id
                 AND connection.platform_incarnation_id=runtime.platform_incarnation_id
                 AND connection.application_deployment_epoch=runtime.application_deployment_epoch
                 AND connection.activation_epoch=runtime.activation_epoch,
               'socketEvidenceComplete',connection.id IS NOT NULL AND connection.canonical_path IS NOT NULL
                 AND connection.socket_device IS NOT NULL AND connection.socket_inode IS NOT NULL
                 AND connection.socket_type='SOCK_STREAM' AND connection.socket_owner_uid IS NOT NULL
                 AND connection.socket_group_gid IS NOT NULL AND connection.socket_mode IS NOT NULL
                 AND connection.socket_unit IS NOT NULL AND (runtime.target_socket_path IS NULL OR connection.canonical_path=runtime.target_socket_path),
               'peerIdentityCurrent',connection.id IS NOT NULL AND host.id IS NOT NULL
                 AND connection.peer_uid=host.linux_uid AND connection.peer_gid=host.linux_gid
                 AND connection.peer_pid=host.linux_pid AND connection.peer_boot_id=host.host_boot_id
                 AND connection.peer_start_ticks=host.process_start_ticks
                 AND connection.peer_cgroup_path=host.cgroup_path,
               'protocolAndSequenceCurrent',connection.id IS NOT NULL AND octet_length(connection.protocol_profile_digest)=32
                 AND connection.first_sequence>=0 AND connection.last_sequence>=connection.first_sequence
                 AND connection.inflight_count=inflight.call_count,
               'cleanupNotPending',runtime.terminal_cleanup_state IN ('NOT_STARTED','COMPLETE')
             ) AS checks,
             jsonb_build_object('activeProcesses',inventory.active_process_count,'activeHosts',inventory.active_host_count,
               'openConnections',connections.open_connection_count,'persistedInflightCalls',inflight.call_count) AS inventory
      FROM selected runtime CROSS JOIN process_inventory inventory CROSS JOIN connection_inventory connections CROSS JOIN inflight
      LEFT JOIN host ON true
      LEFT JOIN kcml.runtime_ipc_connection connection ON connection.id=runtime.runtime_gateway_connection_id`, [runtimeInstanceId]);
    const row = result.rows[0];
    if (!row) throw new DomainError('RUNTIME_INSTANCE_NOT_FOUND', 'Runtime instance does not exist', 404, 'DO_NOT_RETRY');
    const checks = row.checks as JsonObject;
    const issues = failedChecks(checks, 'RUNTIME_BOUNDARY');
    const evidence = {
      runtimeInstanceId,
      evidenceScope: 'PERSISTED_AUTHORITY_SNAPSHOT',
      persistedAuthorityValid: issues.length === 0,
      liveKernelRevalidationRequired: true,
      checks,
      issues,
      authorityHead: row.authority_head,
      inventory: row.inventory,
      runtime: row.runtime_snapshot,
      hostProcess: row.host_process_snapshot,
      gatewayConnection: row.connection_snapshot
    };
    return { ...evidence, evidenceDigest: canonicalDigest(safeJson(evidence)) };
  });
}

async function inspectRuntimeConnection(pool: DatabasePool, targetId: string | null, args: JsonObject): Promise<unknown> {
  const connectionId = requiredTargetId(targetId, 'runtime.connection.inspect');
  const callLimit = boundedCallLimit(args.callLimit);
  const includeTerminalCalls = args.includeTerminalCalls === undefined ? true : args.includeTerminalCalls;
  if (typeof includeTerminalCalls !== 'boolean') {
    throw new DomainError('RUNTIME_INSPECTION_FILTER_INVALID', 'includeTerminalCalls must be boolean', 422, 'DO_NOT_RETRY');
  }
  return beginConsistentRead(pool, async (client) => {
    const result = await client.query(`WITH selected AS (
        SELECT connection.*,
               heads.platform_incarnation_id AS current_platform_incarnation_id,
               heads.application_deployment_epoch AS current_deployment_epoch,
               heads.activation_epoch AS current_activation_epoch,
               heads.recovery_state, heads.database_identity_current, heads.recovery_lineage_current
        FROM kcml.runtime_ipc_connection connection
        CROSS JOIN LATERAL (
          SELECT p.platform_incarnation_id,deployment.current_epoch AS application_deployment_epoch,
                 activation.current_epoch AS activation_epoch,recovery.state AS recovery_state,
                 recovery.database_start_identity=kcml.current_database_start_identity() AS database_identity_current,
                 recovery.platform_incarnation_id=p.platform_incarnation_id
                   AND recovery.application_deployment_epoch=deployment.current_epoch AS recovery_lineage_current
          FROM kcml.platform_incarnation p CROSS JOIN kcml.application_deployment_head deployment
          CROSS JOIN kcml.activation_head activation CROSS JOIN kcml.platform_recovery_head recovery
          WHERE p.singleton_key=1 AND deployment.singleton_key=1 AND activation.singleton_key=1 AND recovery.singleton_key=1
        ) heads
        WHERE connection.id=$1
      ), call_inventory AS (
        SELECT count(*)::int AS total_calls,
               count(*) FILTER (WHERE state IN ('RECEIVED','VALIDATED','DISPATCHED','STREAMING','RECONCILING'))::bigint AS inflight_calls,
               coalesce(min(sequence),0)::bigint AS minimum_sequence,
               coalesce(max(sequence),0)::bigint AS maximum_sequence
        FROM kcml.runtime_ipc_call WHERE connection_id=$1
      ), peer AS (
        SELECT process.* FROM selected connection
        JOIN kcml.runtime_process_identity process
          ON process.host_boot_id=connection.peer_boot_id AND process.linux_pid=connection.peer_pid
         AND process.process_start_ticks=connection.peer_start_ticks AND process.exited_at IS NULL
         AND (connection.runtime_instance_id IS NULL OR process.runtime_instance_id=connection.runtime_instance_id)
         AND (connection.runtime_generation IS NULL OR process.runtime_generation=connection.runtime_generation)
        ORDER BY process.started_at DESC,process.id LIMIT 1
      ), call_rows AS (
        SELECT jsonb_build_object('call',to_jsonb(call),'parentContext',to_jsonb(parent_context),
                 'childContext',CASE WHEN child_context.id IS NULL THEN NULL ELSE to_jsonb(child_context) END) AS row
        FROM kcml.runtime_ipc_call call
        JOIN kcml.runtime_execution_context parent_context ON parent_context.id=call.parent_execution_context_id
        LEFT JOIN kcml.runtime_execution_context child_context ON child_context.id=call.child_execution_context_id
        WHERE call.connection_id=$1
          AND ($2::boolean OR call.state NOT IN ('SUCCEEDED','FAILED','CANCELLED'))
        ORDER BY call.sequence DESC,call.id LIMIT $3
      )
      SELECT to_jsonb(connection) AS connection_snapshot,
             CASE WHEN runtime.id IS NULL THEN NULL ELSE to_jsonb(runtime) END AS runtime_snapshot,
             CASE WHEN peer.id IS NULL THEN NULL ELSE to_jsonb(peer) END AS peer_process_snapshot,
             coalesce((SELECT jsonb_agg(row) FROM call_rows),'[]'::jsonb) AS calls,
             jsonb_build_object('totalCalls',inventory.total_calls,'inflightCalls',inventory.inflight_calls,
               'minimumSequence',inventory.minimum_sequence,'maximumSequence',inventory.maximum_sequence,
               'returnedCalls',(SELECT count(*) FROM call_rows)) AS inventory,
             jsonb_build_object(
               'recoveryReady',connection.recovery_state='READY' AND connection.database_identity_current AND connection.recovery_lineage_current,
               'lineageCurrent',connection.platform_incarnation_id=connection.current_platform_incarnation_id
                 AND connection.application_deployment_epoch=connection.current_deployment_epoch
                 AND connection.activation_epoch=connection.current_activation_epoch,
               'transportIdentityComplete',CASE WHEN connection.transport_kind='HANDLER_ANONYMOUS'
                 THEN connection.anonymous_channel_id IS NOT NULL AND connection.canonical_path IS NULL
                 ELSE connection.canonical_path IS NOT NULL AND connection.socket_device IS NOT NULL
                   AND connection.socket_inode IS NOT NULL AND connection.socket_type='SOCK_STREAM'
                   AND connection.socket_owner_uid IS NOT NULL AND connection.socket_group_gid IS NOT NULL
                   AND connection.socket_mode IS NOT NULL AND connection.socket_unit IS NOT NULL END,
               'peerIdentityComplete',peer.id IS NOT NULL AND connection.peer_uid=peer.linux_uid
                 AND connection.peer_gid=peer.linux_gid AND connection.peer_pid=peer.linux_pid
                 AND connection.peer_boot_id=peer.host_boot_id AND connection.peer_start_ticks=peer.process_start_ticks
                 AND connection.peer_cgroup_path=peer.cgroup_path,
               'runtimeBindingCurrent',connection.runtime_instance_id IS NOT NULL AND runtime.id=connection.runtime_instance_id
                 AND connection.runtime_generation=runtime.runtime_generation
                 AND connection.service_invocation_id=runtime.systemd_invocation_id,
               'lifecycleConsistent',(connection.state='ACTIVE' AND connection.validated_at IS NOT NULL AND connection.closed_at IS NULL)
                 OR (connection.state='DRAINING' AND connection.validated_at IS NOT NULL AND connection.draining_at IS NOT NULL AND connection.closed_at IS NULL)
                 OR (connection.state IN ('CLOSED','REJECTED') AND connection.closed_at IS NOT NULL),
               'sequenceConsistent',connection.first_sequence>=0 AND connection.last_sequence>=connection.first_sequence
                 AND (inventory.total_calls=0 OR (inventory.minimum_sequence>=connection.first_sequence AND inventory.maximum_sequence<=connection.last_sequence)),
               'inflightCountConsistent',connection.inflight_count=inventory.inflight_calls,
               'protocolProfileComplete',octet_length(connection.protocol_profile_digest)=32
             ) AS checks
      FROM selected connection CROSS JOIN call_inventory inventory
      LEFT JOIN kcml.runtime_instance runtime ON runtime.id=connection.runtime_instance_id
      LEFT JOIN peer ON true`, [connectionId, includeTerminalCalls, callLimit]);
    const row = result.rows[0];
    if (!row) throw new DomainError('RUNTIME_CONNECTION_NOT_FOUND', 'Runtime IPC connection does not exist', 404, 'DO_NOT_RETRY');
    const checks = row.checks as JsonObject;
    const issues = failedChecks(checks, 'RUNTIME_CONNECTION');
    const evidence = {
      connectionId,
      evidenceScope: 'PERSISTED_CONNECTION_EVIDENCE',
      persistedEvidenceValid: issues.length === 0,
      livePeerRevalidationRequired: row.connection_snapshot?.state === 'ACTIVE' || row.connection_snapshot?.state === 'DRAINING',
      checks,
      issues,
      inventory: row.inventory,
      connection: row.connection_snapshot,
      runtime: row.runtime_snapshot,
      peerProcess: row.peer_process_snapshot,
      calls: row.calls
    };
    return { ...evidence, evidenceDigest: canonicalDigest(safeJson(evidence)) };
  });
}

export const exactRuntimeQueryOperations = new Set([
  'runtime.boundary.verify',
  'runtime.connection.inspect'
]);

export async function executeExactRuntimeQuery(
  pool: DatabasePool,
  operationName: string,
  targetId: string | null,
  args: JsonObject
): Promise<unknown> {
  if (operationName === 'runtime.boundary.verify') return verifyRuntimeBoundary(pool, targetId);
  if (operationName === 'runtime.connection.inspect') return inspectRuntimeConnection(pool, targetId, args);
  throw new DomainError('RUNTIME_OPERATION_NOT_EXACT', `Runtime operation ${operationName} has no exact query implementation`, 500, 'DO_NOT_RETRY');
}
