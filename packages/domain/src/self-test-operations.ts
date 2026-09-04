import type { DatabaseClient, DatabasePool } from '@kcml/database';
import { inTransaction } from '@kcml/database';
import { canonicalDigest, type CanonicalJsonValue } from '@kcml/schemas';
import { DomainError } from './errors.js';

type JsonObject=Record<string,unknown>;
const UUID_PATTERN=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function safeJson(value:unknown):CanonicalJsonValue{return JSON.parse(JSON.stringify(value,(_key,item)=>typeof item==='bigint'?item.toString():item)) as CanonicalJsonValue;}
function boundedLimit(value:unknown,defaultValue:number):number{if(value===undefined)return defaultValue;if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1||value>500)throw new DomainError('TOOL_ARGUMENT_SCHEMA_INVALID','limit must be an integer between 1 and 500',422,'DO_NOT_RETRY');return value;}
function exactRunId(targetId:string|null,operationName:string):string{if(!targetId||!UUID_PATTERN.test(targetId))throw new DomainError('AGENTIC_DYNAMIC_TARGET_UNBOUND',`${operationName} requires an exact self-test run UUID`,422,'DO_NOT_RETRY');return targetId;}
async function consistentRead<T>(pool:DatabasePool,body:(client:DatabaseClient)=>Promise<T>):Promise<T>{return inTransaction(pool,'REPEATABLE READ',async client=>{await client.query('SET TRANSACTION READ ONLY');return body(client);});}

async function listCatalog(pool:DatabasePool,targetId:string|null,args:JsonObject):Promise<unknown>{
  if(targetId!==null)throw new DomainError('AGENTIC_DYNAMIC_TARGET_UNBOUND','selfTest.catalog.list does not accept a target ID',422,'DO_NOT_RETRY');
  const limit=boundedLimit(args.limit,200);for(const key of ['suite','capability','targetOperation'])if(args[key]!==undefined&&(typeof args[key]!=='string'||String(args[key]).length===0))throw new DomainError('TOOL_ARGUMENT_SCHEMA_INVALID',`${key} must be a non-empty string`,422,'DO_NOT_RETRY');
  return consistentRead(pool,async client=>{
    const rows=(await client.query(`SELECT jsonb_build_object('id',entry.id,'caseKey',entry.case_key,'stableKey',entry.stable_key,
        'displayName',entry.display_name,'suite',entry.suite,'capability',entry.capability,
        'requiredEnvironment',entry.required_environment,'targetOperation',entry.target_operation,
        'setupContract',entry.setup_contract,'executionContract',entry.execution_contract,
        'assertionContract',entry.assertion_contract,'cleanupContract',entry.cleanup_contract,
        'evidenceContract',entry.evidence_contract,'lifecycle',entry.lifecycle,
        'activationEpoch',entry.activation_epoch,'platformIncarnationId',entry.platform_incarnation_id,
        'applicationDeploymentEpoch',entry.application_deployment_epoch,
        'canonicalDigest','sha256:'||encode(entry.canonical_digest,'hex')) AS entry
      FROM kcml.self_test_catalog_entry entry
      WHERE entry.deleted_at IS NULL AND entry.lifecycle='ACTIVE'
        AND ($1::text IS NULL OR entry.suite=$1) AND ($2::text IS NULL OR entry.capability=$2)
        AND ($3::text IS NULL OR entry.target_operation=$3)
      ORDER BY entry.suite,entry.case_key,entry.id LIMIT $4`,[args.suite??null,args.capability??null,args.targetOperation??null,limit])).rows.map(row=>row.entry);
    const evidence={filters:{suite:args.suite??null,capability:args.capability??null,targetOperation:args.targetOperation??null},count:rows.length,entries:rows};return {...evidence,evidenceDigest:canonicalDigest(safeJson(evidence))};
  });
}

async function runStatus(pool:DatabasePool,targetId:string|null):Promise<unknown>{
  const runId=exactRunId(targetId,'selfTest.run.status');
  return consistentRead(pool,async client=>{
    const row=(await client.query(`SELECT to_jsonb(run) AS run,
        jsonb_build_object('evidenceCount',count(result.id),'firstSequence',coalesce(min(result.sequence),0),
          'lastSequence',coalesce(max(result.sequence),0),'artifactReferenceCount',count(result.artifact_path) FILTER (WHERE result.artifact_path IS NOT NULL),
          'invalidDigestCount',count(result.id) FILTER (WHERE octet_length(result.canonical_digest)<>32)) AS inventory,
        platform.platform_incarnation_id AS current_platform_incarnation_id,
        deployment.current_epoch AS current_deployment_epoch,recovery.recovery_epoch,recovery.state AS recovery_state,
        recovery.database_start_identity=kcml.current_database_start_identity() AS database_identity_current,
        recovery.platform_incarnation_id=platform.platform_incarnation_id
          AND recovery.application_deployment_epoch=deployment.current_epoch AS recovery_lineage_current
      FROM kcml.self_test_run run
      CROSS JOIN kcml.platform_incarnation platform CROSS JOIN kcml.application_deployment_head deployment
      CROSS JOIN kcml.platform_recovery_head recovery
      LEFT JOIN kcml.self_test_case_result result ON result.test_run_id=run.id
      WHERE run.id=$1 AND platform.singleton_key=1 AND deployment.singleton_key=1 AND recovery.singleton_key=1
    GROUP BY run.id,platform.platform_incarnation_id,deployment.current_epoch,recovery.recovery_epoch,recovery.state,
        recovery.database_start_identity,recovery.platform_incarnation_id,recovery.application_deployment_epoch`,[runId])).rows[0];
    if(!row)throw new DomainError('KCIP_TARGET_NOT_FOUND','Self-test run does not exist',404,'DO_NOT_RETRY');
    const closureEvidence=(await client.query(`SELECT terminal_root_kind,terminal_root_id,terminal_state_version,closure_version,
        inventory_watermarks,predicate_results,'sha256:'||encode(result_digest,'hex') AS result_digest,created_at
      FROM kcml.terminal_closure_evidence ORDER BY created_at DESC,terminal_root_kind,terminal_root_id LIMIT 100`)).rows;
    const status=String(row.run.status);const terminal=['PASS','FAIL','CANCELLED','NOT_EXECUTED_ENVIRONMENTAL'].includes(status);const executed=status!=='NOT_EXECUTED_ENVIRONMENTAL';const passed=status==='PASS';
    const checks={recoveryReady:row.recovery_state==='READY'&&row.database_identity_current===true&&row.recovery_lineage_current===true,runLineageCurrent:String(row.run.platform_incarnation_id)===String(row.current_platform_incarnation_id)&&BigInt(row.run.application_deployment_epoch)===BigInt(row.current_deployment_epoch),terminalTimestampsConsistent:terminal?row.run.completed_at!==null:row.run.completed_at===null,evidenceDigestShapesValid:Number(row.inventory.invalidDigestCount)===0,environmentalNotReportedAsPass:status!=='NOT_EXECUTED_ENVIRONMENTAL'||(executed===false&&!passed)};
    const issues=Object.entries(checks).filter(([,checkPassed])=>!checkPassed).map(([name])=>`SELF_TEST_STATUS_${name.replace(/([a-z0-9])([A-Z])/gu,'$1_$2').toUpperCase()}`);const evidence={runId,status,terminal,executed,passed,consistent:issues.length===0,checks,issues,run:row.run,inventory:row.inventory,closureEvidence,authorityHead:{platformIncarnationId:row.current_platform_incarnation_id,applicationDeploymentEpoch:row.current_deployment_epoch,recoveryEpoch:row.recovery_epoch,recoveryState:row.recovery_state}};return {...evidence,evidenceDigest:canonicalDigest(safeJson(evidence))};
  });
}

async function readEvidence(pool:DatabasePool,targetId:string|null,args:JsonObject):Promise<unknown>{
  const runId=exactRunId(targetId,'selfTest.evidence.read');const limit=boundedLimit(args.limit,200);const evidenceId=args.evidenceId;const sequence=args.sequence;
  if(evidenceId!==undefined&&(typeof evidenceId!=='string'||!UUID_PATTERN.test(evidenceId)))throw new DomainError('OPERATION_CONTRACT_INCOMPLETE','evidenceId must be a UUID',422,'DO_NOT_RETRY');
  if(sequence!==undefined&&(typeof sequence!=='number'||!Number.isSafeInteger(sequence)||sequence<1))throw new DomainError('OPERATION_CONTRACT_INCOMPLETE','sequence must be a positive safe integer',422,'DO_NOT_RETRY');
  if(evidenceId!==undefined&&sequence!==undefined)throw new DomainError('OPERATION_CONTRACT_INCOMPLETE','Use either evidenceId or sequence, not both',422,'DO_NOT_RETRY');
  return consistentRead(pool,async client=>{
    const run=(await client.query(`SELECT id,status,source_sha,release_id,environment_digest,platform_incarnation_id,application_deployment_epoch FROM kcml.self_test_run WHERE id=$1`,[runId])).rows[0];if(!run)throw new DomainError('KCIP_TARGET_NOT_FOUND','Self-test run does not exist',404,'DO_NOT_RETRY');
    const rows=(await client.query(`SELECT id,test_run_id,sequence,evidence_kind,artifact_path,payload,
        'sha256:'||encode(canonical_digest,'hex') AS canonical_digest,octet_length(canonical_digest)=32 AS digest_shape_valid,created_at
      FROM kcml.self_test_case_result WHERE test_run_id=$1 AND ($2::uuid IS NULL OR id=$2)
        AND ($3::bigint IS NULL OR sequence=$3) ORDER BY sequence,id LIMIT $4`,[runId,evidenceId??null,sequence??null,limit])).rows;
    const closureEvidence=(await client.query(`SELECT terminal_root_kind,terminal_root_id,terminal_state_version,closure_version,
        inventory_watermarks,predicate_results,'sha256:'||encode(result_digest,'hex') AS result_digest,created_at
      FROM kcml.terminal_closure_evidence ORDER BY created_at DESC,terminal_root_kind,terminal_root_id LIMIT 100`)).rows;
    if((evidenceId!==undefined||sequence!==undefined)&&rows.length!==1)throw new DomainError('KCIP_TARGET_NOT_FOUND','Selected self-test evidence does not exist in the target run',404,'DO_NOT_RETRY');
    const issues=rows.filter(row=>!row.digest_shape_valid).map(row=>`SELF_TEST_EVIDENCE_DIGEST_INVALID:${String(row.id)}`);const evidence={runId,runStatus:run.status,sourceSha:run.source_sha,releaseId:run.release_id,environmentDigest:`sha256:${Buffer.from(run.environment_digest).toString('hex')}`,platformIncarnationId:run.platform_incarnation_id,applicationDeploymentEpoch:String(run.application_deployment_epoch),consistent:issues.length===0,issues,count:rows.length,evidence:rows,closureEvidence};return {...evidence,evidenceDigest:canonicalDigest(safeJson(evidence))};
  });
}

export const exactSelfTestQueryOperations=new Set(['selfTest.catalog.list','selfTest.run.status','selfTest.evidence.read']);
export async function executeExactSelfTestQuery(pool:DatabasePool,operationName:string,targetId:string|null,args:JsonObject):Promise<unknown>{if(operationName==='selfTest.catalog.list')return listCatalog(pool,targetId,args);if(operationName==='selfTest.run.status')return runStatus(pool,targetId);if(operationName==='selfTest.evidence.read')return readEvidence(pool,targetId,args);throw new DomainError('OPERATION_CONTRACT_INCOMPLETE',`Self-test operation ${operationName} has no exact query implementation`,500,'DO_NOT_RETRY');}
