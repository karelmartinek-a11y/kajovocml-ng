import { randomUUID } from 'node:crypto';
import type { DatabasePool } from '@kcml/database';
import { inTransaction } from '@kcml/database';
import type { CanonicalOperationService } from '@kcml/domain';
import { DomainError } from '@kcml/domain';
import { canonicalDigest, type CanonicalJsonValue, z } from '@kcml/schemas';

export const jsonRpcRequestSchema=z.object({jsonrpc:z.literal('2.0'),id:z.union([z.string(),z.number().safe(),z.null()]),method:z.string().min(1),params:z.record(z.string(),z.unknown()).optional()}).strict();
export const supportedMcpVersions=['2025-11-25','2025-06-18','2025-03-26'] as const;

export interface McpHeaders {protocolVersion:string;method:string;name:string|null;origin:string|null;}
function canonicalValue(value: unknown): CanonicalJsonValue {
  return JSON.parse(JSON.stringify(value)) as CanonicalJsonValue;
}
function digestBytes(value: unknown): Buffer {
  return Buffer.from(canonicalDigest(canonicalValue(value)).slice(7), 'hex');
}
export function validateMcpHeaders(rawHeaders:readonly string[],request:unknown):McpHeaders{
  const body=jsonRpcRequestSchema.parse(request);const groups=new Map<string,string[]>();for(let index=0;index<rawHeaders.length;index+=2){const name=rawHeaders[index]?.toLowerCase();const value=rawHeaders[index+1];if(name&&value)(groups.get(name)??(groups.set(name,[]),groups.get(name)!)).push(value);}
  const singleton=(name:string,required=true):string|null=>{const values=groups.get(name)??[];if(values.length>1||values.some(value=>value.includes(',')))throw new DomainError('MCP_HEADER_MISMATCH',`Duplicate singleton header ${name}`,400);if(required&&values.length!==1)throw new DomainError('MCP_HEADER_MISMATCH',`Missing header ${name}`,400);return values[0]??null;};
  const protocolVersion=singleton('mcp-protocol-version')!;if(!supportedMcpVersions.includes(protocolVersion as typeof supportedMcpVersions[number]))throw new DomainError('MCP_UNSUPPORTED_VERSION','Unsupported MCP protocol version',400);
  const method=singleton('mcp-method')!;if(method!==body.method)throw new DomainError('MCP_HEADER_MISMATCH','Mcp-Method differs from JSON-RPC body',400);
  const bodyName=typeof body.params?.name==='string'?body.params.name:null;const name=singleton('mcp-name',bodyName!==null);if(name!==bodyName)throw new DomainError('MCP_HEADER_MISMATCH','Mcp-Name differs from JSON-RPC params',400);
  return{protocolVersion,method,name,origin:singleton('origin',false)};
}

export class McpRuntime {
  public constructor(private readonly pool:DatabasePool,private readonly operations:CanonicalOperationService){}
  public discover(){return{protocolVersion:supportedMcpVersions[0],supportedVersions:supportedMcpVersions,supportedCapabilities:{tools:{listChanged:true}},serverInfo:{name:'KájovoCML NG',version:'2026.8.30-8'},extensions:{kcip:'KCIP/1.0'},_meta:{cacheTtlSeconds:30,cacheScope:'binding-revision'}};}
  public async dispatch(componentId:string,rawHeaders:readonly string[],payload:unknown,caller:{callerFingerprint:string;actorId:string;correlationId:string;idempotencyKey:string|null}):Promise<unknown>{
    const request=jsonRpcRequestSchema.parse(payload);
    const headers=validateMcpHeaders(rawHeaders,request);
    const requestIdType=request.id===null?null:typeof request.id==='number'?'INTEGER':'STRING';
    const requestIdValue=request.id===null?null:String(request.id);
    const requestDigest=digestBytes(request);
    const headerEvidence={protocolVersion:headers.protocolVersion,method:headers.method,name:headers.name,origin:headers.origin};
    const headerDigest=digestBytes(headerEvidence);
    const inflightSourceScope=canonicalDigest(canonicalValue({componentId,callerFingerprint:caller.callerFingerprint,origin:headers.origin}));
    const reservation=await inTransaction(this.pool,'SERIALIZABLE',async(client)=>{
      const authority=(await client.query(`SELECT c.id,c.active_revision_id,c.current_release_id,c.active_binding_set_revision_id,c.current_activation_epoch,
        r.manifest_digest,p.platform_incarnation_id,d.current_epoch
        FROM kcml.component c JOIN kcml.component_revision r ON r.id=c.active_revision_id
        CROSS JOIN kcml.platform_incarnation p CROSS JOIN kcml.application_deployment_head d
        WHERE c.id=$1 AND c.lifecycle='ACTIVE' AND p.singleton_key=1 AND d.singleton_key=1 FOR SHARE OF c,r`,[componentId])).rows[0];
      if(!authority)throw new DomainError('MCP_COMPONENT_REVISION_NOT_ACTIVE','MCP server has no active exact revision',409,'DO_NOT_RETRY');
      if(requestIdValue!==null){
        const prior=(await client.query(`SELECT e.request_body_digest,c.* FROM kcml.mcp_request_event e
          JOIN kcml.mcp_call_run c ON c.request_event_id=e.id
          WHERE e.inflight_source_scope=$1 AND e.request_id_type=$2 AND e.request_id_value=$3 AND e.completed_at IS NULL
          FOR UPDATE OF e,c`,[inflightSourceScope,requestIdType,requestIdValue])).rows[0];
        if(prior){
          if(!Buffer.from(prior.request_body_digest).equals(requestDigest))throw new DomainError('MCP_DUPLICATE_ID_CONFLICT','Active JSON-RPC ID is reserved for a different request',409,'DO_NOT_RETRY');
          return prior;
        }
      }
      const logicalOperationId=randomUUID();
      const eventShape={componentId,revisionId:authority.active_revision_id,requestIdType,requestIdValue,method:request.method,requestDigest:requestDigest.toString('hex'),callerFingerprint:caller.callerFingerprint};
      const event=(await client.query(`INSERT INTO kcml.mcp_request_event(
        server_component_id,server_revision_id,server_release_id,endpoint,access_context,protocol_era,protocol_version,
        request_id_type,request_id_value,inflight_source_scope,method,method_name,is_notification,auth_decision,binding_decision,
        request_headers,request_body,request_headers_digest,request_body_digest,routing_headers,header_validation_result,http_method,origin,
        request_size_bytes,processing_stage,handler_dispatched,final_response_state,response_delivery_state,logical_operation_id,correlation_id,
        received_at,canonical_digest,platform_incarnation_id,application_deployment_epoch,activation_epoch)
        VALUES($1,$2,$3,'/mcp',$4,'MODERN',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'POST',$20,$21,'VALIDATED',false,'PENDING','PENDING',$22,$23,clock_timestamp(),$24,$25,$26,$27) RETURNING *`,[
        componentId,authority.active_revision_id,authority.current_release_id,{callerFingerprint:caller.callerFingerprint,actorId:caller.actorId},headers.protocolVersion,
        requestIdType,requestIdValue,inflightSourceScope,request.method,headers.name,request.id===null,{authorityKind:'OWNER_FULL',actorId:caller.actorId},
        {bindingSetRevisionId:authority.active_binding_set_revision_id},headerEvidence,request,headerDigest,requestDigest,headerEvidence,{status:'VALID',profile:'EXACT_MCP_HEADERS'},headers.origin,
        Buffer.byteLength(JSON.stringify(request),'utf8'),logicalOperationId,caller.correlationId,digestBytes(eventShape),authority.platform_incarnation_id,authority.current_epoch,authority.current_activation_epoch
      ])).rows[0];
      const argumentsValue=request.params??{};
      const callShape={requestEventId:event.id,logicalOperationId,componentId,revisionId:authority.active_revision_id,method:request.method,arguments:argumentsValue};
      return (await client.query(`INSERT INTO kcml.mcp_call_run(
        request_event_id,logical_operation_id,server_component_id,tool_key,server_revision_id,server_contract_digest,binding_decision,
        canonical_arguments,arguments_digest,side_effect_classification,retry_classification,idempotency_classification,concurrency_classification,
        ordering_classification,idempotency_key,state,platform_incarnation_id,application_deployment_epoch,activation_epoch,effective_deadline_at,
        idle_timeout_ms,correlation_id,canonical_digest)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'CONTRACT_BOUND',$11,'CONTRACT_BOUND','CONTRACT_BOUND',$12,'RECEIVED',$13,$14,$15,$16,15000,$17,$18) RETURNING *`,[
        event.id,logicalOperationId,componentId,headers.name,authority.active_revision_id,authority.manifest_digest,{bindingSetRevisionId:authority.active_binding_set_revision_id},
        argumentsValue,digestBytes(argumentsValue),request.method==='tools/call'?'DECLARED_BY_TOOL_CONTRACT':'READ_ONLY',caller.idempotencyKey?'KEYED':'NONE',caller.idempotencyKey,
        authority.platform_incarnation_id,authority.current_epoch,authority.current_activation_epoch,new Date(Date.now()+30_000),caller.correlationId,digestBytes(callShape)
      ])).rows[0];
    });
    if(['SUCCEEDED','FAILED','CANCELLED'].includes(reservation.state))return reservation.terminal_response;
    const claimed=await inTransaction(this.pool,'READ COMMITTED',async client=>{
      const claim=await client.query(`UPDATE kcml.mcp_call_run SET state='CLAIMED',state_version=state_version+1
        WHERE id=$1 AND state='RECEIVED' RETURNING id`,[reservation.id]);
      if(claim.rowCount!==1)return null;
      return (await client.query(`UPDATE kcml.mcp_call_run SET state='EXECUTING',started_at=clock_timestamp(),state_version=state_version+1
        WHERE id=$1 AND state='CLAIMED' RETURNING *`,[reservation.id])).rows[0]??null;
    });
    if(!claimed)throw new DomainError('MCP_REQUEST_IN_FLIGHT','The same MCP request is already executing',409,'RETRY_SAME_OPERATION');
    try{
      let result:unknown;
      if(request.method==='server/discover')result=this.discover();
      else if(request.method==='tools/list')result={tools:this.operations.catalog.publicView()};
      else if(request.method==='tools/call'){
        const params=z.object({name:z.string(),arguments:z.record(z.string(),z.unknown()).default({})}).parse(request.params);
        result=await this.operations.execute(params.name,{operation:params.name,targetId:typeof params.arguments.targetId==='string'?params.arguments.targetId:null,arguments:params.arguments},caller);
      }else throw new DomainError('MCP_METHOD_NOT_FOUND',`Unknown MCP method ${request.method}`,404);
      const response={jsonrpc:'2.0',id:request.id,result:{resultType:'complete',...((typeof result==='object'&&result!==null)?result:{value:result})}};
      await this.commitTerminal(claimed.id,claimed.request_event_id,'SUCCEEDED',response,digestBytes(response),null);
      return response;
    }catch(error){
      const domain=error instanceof DomainError?error:new DomainError('MCP_TOOL_EXECUTION_FAILED',error instanceof Error?error.message:String(error),500);
      const response={jsonrpc:'2.0',id:request.id,error:{code:domain.code==='MCP_METHOD_NOT_FOUND'?-32601:-32000,message:domain.message,data:{stableCode:domain.code,retryDirective:domain.retryDirective,details:domain.details}}};
      await this.commitTerminal(claimed.id,claimed.request_event_id,'FAILED',response,digestBytes(response),response.error);
      return response;
    }
  }

  private async commitTerminal(callId:string,requestEventId:string,state:'SUCCEEDED'|'FAILED',response:unknown,responseDigest:Buffer,error:unknown):Promise<void>{
    await inTransaction(this.pool,'SERIALIZABLE',async client=>{
      const updated=await client.query(`UPDATE kcml.mcp_call_run SET state=$2,structured_result=CASE WHEN $2='SUCCEEDED' THEN $3::jsonb ELSE NULL END,
        result_digest=$4,jsonrpc_error=$5::jsonb,terminal_response=$3::jsonb,response_delivery_state='MATERIALIZED',completed_at=clock_timestamp(),state_version=state_version+1
        WHERE id=$1 AND state='EXECUTING' RETURNING id`,[callId,state,JSON.stringify(response),responseDigest,error===null?null:JSON.stringify(error)]);
      if(updated.rowCount!==1)throw new DomainError('MCP_TERMINAL_COMMIT_CONFLICT','MCP call state changed before terminal commit',409,'RECONCILE_THEN_RETRY');
      const event=await client.query(`UPDATE kcml.mcp_request_event SET final_response_state=$2,response_delivery_state='MATERIALIZED',handler_dispatched=true,
        response_http_status=200,response_content_type='application/json',completed_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp()
        WHERE id=$1 AND completed_at IS NULL RETURNING id`,[requestEventId,state]);
      if(event.rowCount!==1)throw new DomainError('MCP_REQUEST_EVENT_TERMINAL_CONFLICT','MCP request event state changed before terminal commit',409,'RECONCILE_THEN_RETRY');
    });
  }
}
