import { randomUUID } from 'node:crypto';
import type { DatabasePool } from '@kcml/database';
import { inTransaction } from '@kcml/database';
import type { CanonicalOperationService } from '@kcml/domain';
import { DomainError } from '@kcml/domain';
import { canonicalDigest, type CanonicalJsonValue, z } from '@kcml/schemas';

export const jsonRpcRequestSchema=z.object({jsonrpc:z.literal('2.0'),id:z.union([z.string(),z.number().safe(),z.null()]),method:z.string().min(1),params:z.record(z.string(),z.unknown()).optional()}).strict();
export const supportedMcpVersions=['2025-11-25','2025-06-18','2025-03-26'] as const;

export interface McpHeaders {protocolVersion:string;method:string;name:string|null;origin:string|null;}
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
    const request=jsonRpcRequestSchema.parse(payload);const headers=validateMcpHeaders(rawHeaders,request);const idType=request.id===null?'NULL':typeof request.id==='number'?'NUMBER':'STRING';const idCanonical=request.id===null?'null':String(request.id);const digest=canonicalDigest(JSON.parse(JSON.stringify(request)) as CanonicalJsonValue);
    const reservation=await inTransaction(this.pool,'SERIALIZABLE',async(client)=>{const prior=await client.query(`SELECT * FROM kcml.mcp_call_run WHERE component_id=$1 AND request_id_type=$2 AND request_id_canonical=$3 FOR UPDATE`,[componentId,idType,idCanonical]);if(prior.rows[0]){if(!Buffer.from(prior.rows[0].request_digest).equals(Buffer.from(digest.slice(7),'hex')))throw new DomainError('MCP_DUPLICATE_ID_CONFLICT','JSON-RPC ID already reserved for different request',409);return prior.rows[0];}
      const logicalOperationId=randomUUID();const created=await client.query(`INSERT INTO kcml.mcp_call_run(component_id,logical_operation_id,request_id_type,request_id_canonical,protocol_version,method,name,request_metadata,request_payload,request_digest)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)RETURNING *`,[componentId,logicalOperationId,idType,idCanonical,headers.protocolVersion,request.method,headers.name,headers,request,Buffer.from(digest.slice(7),'hex')]);return created.rows[0];});
    if(reservation.status==='COMPLETED')return reservation.response_payload;
    try{let result:unknown;if(request.method==='server/discover')result=this.discover();else if(request.method==='tools/list')result={tools:this.operations.catalog.publicView()};else if(request.method==='tools/call'){const params=z.object({name:z.string(),arguments:z.record(z.string(),z.unknown()).default({})}).parse(request.params);result=await this.operations.execute(params.name,{operation:params.name,targetId:typeof params.arguments.targetId==='string'?params.arguments.targetId:null,arguments:params.arguments},caller);}else throw new DomainError('MCP_METHOD_NOT_FOUND',`Unknown MCP method ${request.method}`,404);
      const response={jsonrpc:'2.0',id:request.id,result:{resultType:'complete',...((typeof result==='object'&&result!==null)?result:{value:result})}};await this.pool.query(`UPDATE kcml.mcp_call_run SET status='COMPLETED',result_type='complete',response_payload=$2,response_digest=$3,completed_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1`,[reservation.id,response,Buffer.from(canonicalDigest(JSON.parse(JSON.stringify(response)) as CanonicalJsonValue).slice(7),'hex')]);return response;
    }catch(error){const domain=error instanceof DomainError?error:new DomainError('MCP_TOOL_EXECUTION_FAILED',error instanceof Error?error.message:String(error),500);const response={jsonrpc:'2.0',id:request.id,error:{code:domain.code==='MCP_METHOD_NOT_FOUND'?-32601:-32000,message:domain.message,data:{stableCode:domain.code,retryDirective:domain.retryDirective,details:domain.details}}};await this.pool.query(`UPDATE kcml.mcp_call_run SET status='FAILED_FINAL',response_payload=$2,response_digest=$3,completed_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1`,[reservation.id,response,Buffer.from(canonicalDigest(JSON.parse(JSON.stringify(response)) as CanonicalJsonValue).slice(7),'hex')]);return response;}
  }
}
