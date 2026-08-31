import { randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import { Agent, run, setDefaultOpenAIKey } from '@openai/agents';
import type { DatabasePool } from '@kcml/database';
import { allocateContiguousSequence, inTransaction } from '@kcml/database';
import { canonicalDigest, type CanonicalJsonValue } from '@kcml/schemas';
import type { AuthorityLineage } from '@kcml/agentic-authority';
import { verifyAuthorityLineage } from '@kcml/agentic-authority';
import { DomainError } from '@kcml/domain';

export interface OpenAISecretProvider { getOpenAIKey(): Promise<string>; }
export interface ModelCallRequest {
  parentRunId:string;model:string;instructions:string;input:unknown;tools?:OpenAI.Responses.Tool[];
  textFormat?:Record<string,unknown>;settings?:{temperature?:number;maxOutputTokens?:number};authority:AuthorityLineage;
}
export interface StreamEvent {type:string;payload:unknown;sequence:number;}
export interface ModelCallResult {callId:string;responseId:string;outputText:string;output:unknown[];usage:unknown;events:StreamEvent[];}

function jsonValue(value:unknown):CanonicalJsonValue{return JSON.parse(JSON.stringify(value)) as CanonicalJsonValue;}
function bytes(digest:string):Buffer{return Buffer.from(digest.replace('sha256:',''),'hex');}

export class ResponsesRuntime {
  public constructor(private readonly pool:DatabasePool,private readonly secrets:OpenAISecretProvider){}

  public async create(request:ModelCallRequest,onEvent?:(event:StreamEvent)=>Promise<void>|void):Promise<ModelCallResult>{
    if(!verifyAuthorityLineage(request.authority))throw new DomainError('AUTHORITY_LINEAGE_INVALID','Model call authority lineage is invalid',403);
    const callId=randomUUID();const descriptor={model:request.model,instructions:request.instructions,input:request.input,tools:request.tools??[],textFormat:request.textFormat??null,settings:request.settings??{}};
    const requestDigest=canonicalDigest(jsonValue(descriptor));const inputDigest=canonicalDigest(jsonValue(request.input));const instructionsDigest=canonicalDigest(request.instructions);const toolsDigest=canonicalDigest(jsonValue(request.tools??[]));
    await inTransaction(this.pool,'SERIALIZABLE',async(client)=>{const attempt=await allocateContiguousSequence(client,'AI_MODEL_CALL',request.parentRunId,'ATTEMPT_SEQUENCE');await client.query(`INSERT INTO kcml.ai_model_call(id,parent_run_id,attempt_sequence,model,request_descriptor,request_digest,input_digest,instructions_digest,tools_digest,schema_digest,settings_snapshot)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[callId,request.parentRunId,attempt.toString(),request.model,descriptor,bytes(requestDigest),bytes(inputDigest),bytes(instructionsDigest),bytes(toolsDigest),request.textFormat?bytes(canonicalDigest(jsonValue(request.textFormat))):null,request.settings??{}]);});
    const apiKey=await this.secrets.getOpenAIKey().catch(()=>{throw new DomainError('OPENAI_API_KEY_MISSING','OpenAI credential is not configured; add OPENAI_API_KEY in Password Manager',409);});
    const client=new OpenAI({apiKey,maxRetries:0,timeout:120_000});const events:StreamEvent[]=[];const started=Date.now();
    await this.pool.query(`UPDATE kcml.ai_model_call SET submit_state='DISPATCH_STARTED',state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND submit_state='INTENT_RECORDED'`,[callId]);
    try{
      const stream=await client.responses.create({model:request.model,instructions:request.instructions,input:request.input as OpenAI.Responses.ResponseInput,stream:true,
        ...(request.tools?{tools:request.tools}:{}),
        ...(request.settings?.maxOutputTokens!==undefined?{max_output_tokens:request.settings.maxOutputTokens}:{}),
        ...(request.settings?.temperature!==undefined?{temperature:request.settings.temperature}:{})});
      let responseId='';let outputText='';let completed:unknown=null;let sequence=0;
      for await(const rawEvent of stream){const event=rawEvent as unknown as Record<string,unknown>;sequence+=1;const item={type:String(event.type??'unknown'),payload:event,sequence};events.push(item);await onEvent?.(item);
        if(typeof event.response==='object'&&event.response!==null&&'id'in event.response)responseId=String((event.response as Record<string,unknown>).id);
        if(event.type==='response.output_text.delta'&&typeof event.delta==='string')outputText+=event.delta;
        if(event.type==='response.completed')completed=event.response;}
      if(!responseId)throw new DomainError('MODEL_RESPONSE_ID_MISSING','Provider stream ended without a response identity',502,'MANUAL_REVIEW');
      const response=completed as Record<string,unknown>|null;const output=Array.isArray(response?.output)?response.output:[];const usage=response?.usage??null;
      await this.pool.query(`UPDATE kcml.ai_model_call SET submit_state='COMPLETED',provider_response_id=$2,output_items=$3,usage=$4,latency_ms=$5,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`,[callId,responseId,output,usage,Date.now()-started]);
      return{callId,responseId,outputText,output,usage,events};
    }catch(error){
      const responseId=typeof error==='object'&&error!==null&&'response_id'in error?String((error as Record<string,unknown>).response_id):null;
      const state=responseId?'FAILED_FINAL':'MODEL_SUBMIT_OUTCOME_UNKNOWN';
      await this.pool.query(`UPDATE kcml.ai_model_call SET submit_state=$2,provider_response_id=$3,output_items=$4,latency_ms=$5,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`,[callId,state,responseId,[{type:'runtime_error',message:error instanceof Error?error.message:String(error)}],Date.now()-started]);
      if(state==='MODEL_SUBMIT_OUTCOME_UNKNOWN')throw new DomainError('MODEL_SUBMIT_OUTCOME_UNKNOWN','Provider submission outcome is unknown; automatic create retry is prohibited',502,'MANUAL_REVIEW',{callId});
      throw error;
    }
  }
}

export interface AgentRuntimeRequest {name:string;instructions:string;input:string;model:string;authority:AuthorityLineage;}
export class AgentsSdkRuntime {
  public constructor(private readonly secrets:OpenAISecretProvider){}
  public async execute(request:AgentRuntimeRequest):Promise<{finalOutput:unknown;history:unknown}>{
    if(!verifyAuthorityLineage(request.authority))throw new DomainError('AUTHORITY_LINEAGE_INVALID','Agent authority lineage is invalid',403);
    const key=await this.secrets.getOpenAIKey().catch(()=>{throw new DomainError('OPENAI_API_KEY_MISSING','OpenAI credential is not configured; add OPENAI_API_KEY in Password Manager',409);});
    setDefaultOpenAIKey(key);
    const agent=new Agent({name:request.name,instructions:request.instructions,model:request.model});
    const result=await run(agent,request.input,{maxTurns:32});
    return{finalOutput:result.finalOutput,history:result.history};
  }
}

export class DatabaseOpenAISecretProvider implements OpenAISecretProvider{
  public constructor(private readonly reveal:()=>Promise<string>){}
  public getOpenAIKey():Promise<string>{return this.reveal();}
}
