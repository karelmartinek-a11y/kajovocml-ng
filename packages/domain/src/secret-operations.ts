import type { DatabasePool } from '@kcml/database';
import { canonicalDigest, type CanonicalJsonValue } from '@kcml/schemas';
import { DomainError } from './errors.js';

type JsonObject = Record<string, unknown>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function requiredSecretId(targetId:string|null):string {
  if(!targetId||!UUID_PATTERN.test(targetId))throw new DomainError('SECRET_TARGET_REQUIRED','secret.usage.report requires an exact secret UUID',422,'DO_NOT_RETRY');
  return targetId;
}

function boundedLimit(value:unknown,name:string,defaultValue:number):number {
  if(value===undefined)return defaultValue;
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1||value>500)throw new DomainError('SECRET_USAGE_LIMIT_INVALID',`${name} must be an integer between 1 and 500`,422,'DO_NOT_RETRY');
  return value;
}

function safeJson(value:unknown):CanonicalJsonValue {
  return JSON.parse(JSON.stringify(value,(_key,item)=>typeof item==='bigint'?item.toString():item)) as CanonicalJsonValue;
}

async function reportSecretUsage(pool:DatabasePool,targetId:string|null,args:JsonObject):Promise<unknown> {
  const secretId=requiredSecretId(targetId);
  const accessLimit=boundedLimit(args.accessLimit,'accessLimit',100);
  const resolutionLimit=boundedLimit(args.resolutionLimit,'resolutionLimit',100);
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result=await client.query(`WITH selected AS (
        SELECT record.*,
               platform.platform_incarnation_id AS current_platform_incarnation_id,
               deployment.current_epoch AS current_deployment_epoch,
               activation.current_epoch AS current_activation_epoch,
               recovery.recovery_epoch,recovery.state AS recovery_state,
               recovery.database_start_identity=kcml.current_database_start_identity() AS database_identity_current,
               recovery.platform_incarnation_id=platform.platform_incarnation_id
                 AND recovery.application_deployment_epoch=deployment.current_epoch AS recovery_lineage_current
        FROM kcml.secret_record record
        CROSS JOIN kcml.platform_incarnation platform
        CROSS JOIN kcml.application_deployment_head deployment
        CROSS JOIN kcml.activation_head activation
        CROSS JOIN kcml.platform_recovery_head recovery
        WHERE record.id=$1 AND platform.singleton_key=1 AND deployment.singleton_key=1
          AND activation.singleton_key=1 AND recovery.singleton_key=1
      ), version_inventory AS (
        SELECT count(*)::int AS total_versions,
               count(*) FILTER (WHERE lifecycle='ACTIVE')::int AS active_versions,
               coalesce(max(version_number),0)::bigint AS latest_version_number
        FROM kcml.secret_version WHERE secret_id=$1
      ), binding_inventory AS (
        SELECT count(*)::int AS total_bindings,
               count(*) FILTER (WHERE lifecycle='ACTIVE' AND retired_at IS NULL AND deleted_at IS NULL
                 AND (expires_at IS NULL OR expires_at>transaction_timestamp()))::int AS active_bindings
        FROM kcml.secret_binding WHERE secret_id=$1
      ), resolution_inventory AS (
        SELECT count(*)::int AS total_resolutions,
               count(*) FILTER (WHERE state='RESOLVED')::int AS resolved,
               count(*) FILTER (WHERE state='REJECTED')::int AS rejected,
               count(*) FILTER (WHERE state IN ('RESERVED','RESOLVED') AND consumed_at IS NULL
                 AND expires_at>transaction_timestamp())::int AS outstanding
        FROM kcml.secret_resolution WHERE secret_id=$1
      ), access_inventory AS (
        SELECT count(*)::int AS total_accesses,
               count(*) FILTER (WHERE success)::int AS successful,
               count(*) FILTER (WHERE NOT success)::int AS failed,
               max(occurred_at) AS last_access_at
        FROM kcml.secret_access_event WHERE secret_id=$1
      ), resolutions AS (
        SELECT to_jsonb(resolution) AS row FROM kcml.secret_resolution resolution
        WHERE resolution.secret_id=$1 ORDER BY resolution.created_at DESC,resolution.id LIMIT $2
      ), accesses AS (
        SELECT jsonb_build_object('id',access.id,'secretVersionId',access.secret_version_id,
          'executionContextId',access.execution_context_id,'bindingId',access.binding_id,
          'purpose',access.purpose,'operation',access.operation,'success',access.success,
          'runtimeId',access.runtime_id,'jobId',access.job_id,'runId',access.run_id,
          'logicalOperationId',access.logical_operation_id,'correlationId',access.correlation_id,
          'occurredAt',access.occurred_at,'platformIncarnationId',access.platform_incarnation_id,
          'applicationDeploymentEpoch',access.application_deployment_epoch,'activationEpoch',access.activation_epoch) AS row
        FROM kcml.secret_access_event access WHERE access.secret_id=$1
        ORDER BY access.occurred_at DESC,access.id LIMIT $3
      )
      SELECT jsonb_build_object('id',secret.id,'stableName',secret.stable_name,'displayName',secret.display_name,
               'kind',secret.kind,'lifecycle',secret.lifecycle,'activeVersionId',secret.active_version_id,
               'secretActivationEpoch',secret.secret_activation_epoch,'stateVersion',secret.state_version,
               'metadata',secret.metadata,'createdAt',secret.created_at,'updatedAt',secret.updated_at,'deletedAt',secret.deleted_at,
               'platformIncarnationId',secret.platform_incarnation_id,'applicationDeploymentEpoch',secret.application_deployment_epoch) AS secret,
             CASE WHEN active.id IS NULL THEN NULL ELSE jsonb_build_object('id',active.id,'versionNumber',active.version_number,
               'fingerprint',active.fingerprint,'algorithm',active.algorithm,'keyId',active.key_id,'lifecycle',active.lifecycle,
               'createdAt',active.created_at,'activatedAt',active.activated_at,'retiredAt',active.retired_at,
               'createdBy',active.created_by,'activationLogicalOperationId',active.activation_logical_operation_id) END AS active_version,
             coalesce((SELECT jsonb_agg(jsonb_build_object('id',version.id,'versionNumber',version.version_number,
               'fingerprint',version.fingerprint,'algorithm',version.algorithm,'keyId',version.key_id,'lifecycle',version.lifecycle,
               'createdAt',version.created_at,'activatedAt',version.activated_at,'retiredAt',version.retired_at,
               'createdBy',version.created_by,'activationLogicalOperationId',version.activation_logical_operation_id)
               ORDER BY version.version_number DESC) FROM kcml.secret_version version WHERE version.secret_id=$1),'[]'::jsonb) AS versions,
             coalesce((SELECT jsonb_agg(to_jsonb(binding) ORDER BY binding.binding_revision DESC,binding.id)
               FROM kcml.secret_binding binding WHERE binding.secret_id=$1),'[]'::jsonb) AS bindings,
             coalesce((SELECT jsonb_agg(row) FROM resolutions),'[]'::jsonb) AS resolutions,
             coalesce((SELECT jsonb_agg(row) FROM accesses),'[]'::jsonb) AS accesses,
             jsonb_build_object('totalVersions',versions.total_versions,'activeVersions',versions.active_versions,
               'latestVersionNumber',versions.latest_version_number,'totalBindings',bindings.total_bindings,
               'activeBindings',bindings.active_bindings,'totalResolutions',resolution.total_resolutions,
               'resolved',resolution.resolved,'rejected',resolution.rejected,'outstandingResolutions',resolution.outstanding,
               'totalAccesses',access.total_accesses,'successfulAccesses',access.successful,
               'failedAccesses',access.failed,'lastAccessAt',access.last_access_at) AS inventory,
             jsonb_build_object('recoveryReady',secret.recovery_state='READY' AND secret.database_identity_current AND secret.recovery_lineage_current,
               'recordLineageCurrent',secret.platform_incarnation_id=secret.current_platform_incarnation_id
                 AND secret.application_deployment_epoch=secret.current_deployment_epoch,
               'activePointerConsistent',(secret.active_version_id IS NULL AND versions.active_versions=0)
                 OR (secret.active_version_id=active.id AND active.secret_id=secret.id AND active.lifecycle='ACTIVE' AND versions.active_versions=1),
               'activeLifecycleConsistent',(secret.lifecycle='ACTIVE' AND secret.deleted_at IS NULL)
                 OR (secret.lifecycle='CLOSED' AND secret.deleted_at IS NOT NULL),
               'activationEpochConsistent',(secret.active_version_id IS NULL AND secret.secret_activation_epoch>=0)
                 OR (secret.active_version_id IS NOT NULL AND secret.secret_activation_epoch>0)) AS checks,
             jsonb_build_object('platformIncarnationId',secret.current_platform_incarnation_id,
               'applicationDeploymentEpoch',secret.current_deployment_epoch,'activationEpoch',secret.current_activation_epoch,
               'recoveryEpoch',secret.recovery_epoch,'recoveryState',secret.recovery_state) AS authority_head
      FROM selected secret CROSS JOIN version_inventory versions CROSS JOIN binding_inventory bindings
      CROSS JOIN resolution_inventory resolution CROSS JOIN access_inventory access
      LEFT JOIN kcml.secret_version active ON active.id=secret.active_version_id AND active.secret_id=secret.id`,[secretId,resolutionLimit,accessLimit]);
    const row=result.rows[0];
    if(!row)throw new DomainError('SECRET_NOT_FOUND','Secret does not exist',404,'DO_NOT_RETRY');
    const failedChecks=Object.entries(row.checks as JsonObject).filter(([,passed])=>passed!==true).map(([name])=>`SECRET_USAGE_${name.replace(/([a-z0-9])([A-Z])/gu,'$1_$2').toUpperCase()}`);
    const evidence={secretId,evidenceScope:'SECRET_METADATA_AND_USAGE_EVIDENCE',consistent:failedChecks.length===0,checks:row.checks,issues:failedChecks,authorityHead:row.authority_head,secret:row.secret,activeVersion:row.active_version,versions:row.versions,bindings:row.bindings,resolutions:row.resolutions,accesses:row.accesses,inventory:row.inventory};
    await client.query('COMMIT');
    return {...evidence,evidenceDigest:canonicalDigest(safeJson(evidence))};
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function readOwnerApiKey(pool:DatabasePool,targetId:string|null):Promise<unknown> {
  if(targetId!==null&&!UUID_PATTERN.test(targetId))throw new DomainError('OWNER_API_KEY_TARGET_INVALID','ownerApiKey.read target must be the singleton credential UUID or null',422,'DO_NOT_RETRY');
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const row=(await client.query(`SELECT credential.id,credential.stable_name,credential.secret_id,credential.secret_version_id,
        credential.fingerprint,credential.credential_version,credential.credential_activation_epoch,
        credential.last_used_at,credential.last_usage_metadata,credential.rotated_at,credential.updated_at,credential.state_version,
        record.id AS record_id,record.stable_name AS record_stable_name,record.active_version_id,
        record.secret_activation_epoch,record.lifecycle AS record_lifecycle,record.deleted_at AS record_deleted_at,
        version.id AS version_id,version.secret_id AS version_secret_id,version.version_number,
        version.fingerprint AS version_fingerprint,version.algorithm,version.key_id,version.lifecycle AS version_lifecycle,
        version.created_at AS version_created_at,version.activated_at,version.retired_at,
        platform.platform_incarnation_id,deployment.current_epoch AS application_deployment_epoch,
        recovery.recovery_epoch,recovery.state AS recovery_state,
        recovery.database_start_identity=kcml.current_database_start_identity() AS database_identity_current,
        recovery.platform_incarnation_id=platform.platform_incarnation_id
          AND recovery.application_deployment_epoch=deployment.current_epoch AS recovery_lineage_current
      FROM kcml.owner_api_credential credential
      CROSS JOIN kcml.platform_incarnation platform CROSS JOIN kcml.application_deployment_head deployment
      CROSS JOIN kcml.platform_recovery_head recovery
      LEFT JOIN kcml.secret_record record ON record.id=credential.secret_id
      LEFT JOIN kcml.secret_version version ON version.id=credential.secret_version_id AND version.secret_id=credential.secret_id
      WHERE credential.singleton_key=1 AND ($1::uuid IS NULL OR credential.id=$1)
        AND platform.singleton_key=1 AND deployment.singleton_key=1 AND recovery.singleton_key=1`,[targetId])).rows[0];
    if(!row)throw new DomainError('OWNER_API_KEY_NOT_FOUND','Singleton OWNER API credential does not exist or target does not match',404,'DO_NOT_RETRY');
    const initialized=Boolean(row.secret_id&&row.secret_version_id&&row.fingerprint);
    const checks={
      recoveryReady:row.recovery_state==='READY'&&row.database_identity_current===true&&row.recovery_lineage_current===true,
      singletonStableName:row.stable_name==='KCML_OWNER_API_KEY',
      initializationAtomic:initialized
        ? Boolean(row.record_id&&row.version_id&&row.record_stable_name==='KCML_OWNER_API_KEY'&&row.record_lifecycle==='ACTIVE'&&!row.record_deleted_at)
        : row.secret_id===null&&row.secret_version_id===null&&row.fingerprint===null&&BigInt(row.credential_version)===0n&&BigInt(row.credential_activation_epoch)===0n,
      activePointerConsistent:initialized
        ? String(row.active_version_id)===String(row.secret_version_id)&&String(row.version_secret_id)===String(row.secret_id)&&row.version_lifecycle==='ACTIVE'
        : row.active_version_id===null,
      fingerprintConsistent:initialized?row.fingerprint===row.version_fingerprint:row.version_fingerprint===null,
      epochConsistent:initialized
        ? BigInt(row.credential_version)>0n&&BigInt(row.credential_activation_epoch)>0n&&BigInt(row.secret_activation_epoch)>0n
        : true
    };
    const issues=Object.entries(checks).filter(([,passed])=>!passed).map(([name])=>`OWNER_API_KEY_${name.replace(/([a-z0-9])([A-Z])/gu,'$1_$2').toUpperCase()}`);
    const evidence={initialized,consistent:issues.length===0,checks,issues,authorityHead:{platformIncarnationId:row.platform_incarnation_id,applicationDeploymentEpoch:row.application_deployment_epoch,recoveryEpoch:row.recovery_epoch,recoveryState:row.recovery_state},credential:{id:row.id,stableName:row.stable_name,fingerprint:row.fingerprint,credentialVersion:row.credential_version,credentialActivationEpoch:row.credential_activation_epoch,lastUsedAt:row.last_used_at,lastUsageMetadata:row.last_usage_metadata,rotatedAt:row.rotated_at,updatedAt:row.updated_at,stateVersion:row.state_version},secret:initialized?{id:row.record_id,stableName:row.record_stable_name,activeVersionId:row.active_version_id,secretActivationEpoch:row.secret_activation_epoch,lifecycle:row.record_lifecycle}:null,activeVersion:initialized?{id:row.version_id,versionNumber:row.version_number,fingerprint:row.version_fingerprint,algorithm:row.algorithm,keyId:row.key_id,lifecycle:row.version_lifecycle,createdAt:row.version_created_at,activatedAt:row.activated_at,retiredAt:row.retired_at}:null};
    await client.query('COMMIT');
    return {...evidence,evidenceDigest:canonicalDigest(safeJson(evidence))};
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>undefined);
    throw error;
  } finally {
    client.release();
  }
}

export const exactSecretQueryOperations=new Set(['secret.usage.report','ownerApiKey.read']);

export async function executeExactSecretQuery(pool:DatabasePool,operationName:string,targetId:string|null,args:JsonObject):Promise<unknown> {
  if(operationName==='secret.usage.report')return reportSecretUsage(pool,targetId,args);
  if(operationName==='ownerApiKey.read')return readOwnerApiKey(pool,targetId);
  throw new DomainError('SECRET_OPERATION_NOT_EXACT',`Secret operation ${operationName} has no exact query implementation`,500,'DO_NOT_RETRY');
}
