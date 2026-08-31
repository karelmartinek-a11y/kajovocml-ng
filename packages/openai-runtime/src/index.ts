import { randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import { Agent, run, setDefaultOpenAIKey } from '@openai/agents';
import type { DatabaseClient, DatabasePool } from '@kcml/database';
import { allocateContiguousSequence, inTransaction } from '@kcml/database';
import { canonicalDigest, type CanonicalJsonValue } from '@kcml/schemas';
import type { AuthorityLineage } from '@kcml/agentic-authority';
import { verifyAuthorityLineage } from '@kcml/agentic-authority';
import { DomainError } from '@kcml/domain';

export interface OpenAISecretProvider { getOpenAIKey(): Promise<string>; }
export interface ModelCallRequest {
  parentRunId:string;ownerKind:'GENERATION_TURN'|'GENERATION_PHASE'|'AGENT_RUN'|'SYSTEM_CHAT';model:string;instructions:string;input:unknown;previousResponseId?:string;tools?:OpenAI.Responses.Tool[];
  textFormat?:Record<string,unknown>;settings?:{temperature?:number;maxOutputTokens?:number};authority:AuthorityLineage;
}
export interface StreamEvent {type:string;payload:unknown;sequence:number;}
export interface ModelCallResult {callId:string;responseId:string;outputText:string;output:unknown[];usage:unknown;events:StreamEvent[];}
export interface BackgroundModelCallResult {callId:string;responseId:string|null;status:string;}

function jsonValue(value:unknown):CanonicalJsonValue{return JSON.parse(JSON.stringify(value)) as CanonicalJsonValue;}
function bytes(digest:string):Buffer{return Buffer.from(digest.replace('sha256:',''),'hex');}

async function persistModelCallIntent(client:DatabaseClient,callId:string,request:ModelCallRequest,descriptor:Record<string,unknown>,executionMode:'FOREGROUND'|'BACKGROUND'):Promise<void>{
  const attempt=await allocateContiguousSequence(client,'AI_MODEL_CALL',request.parentRunId,'ATTEMPT_SEQUENCE');
  const descriptorId=randomUUID();const requestDigest=canonicalDigest(jsonValue(descriptor));const inputDigest=canonicalDigest(jsonValue(request.input));const instructionsDigest=canonicalDigest(request.instructions);const toolsDigest=canonicalDigest(jsonValue(request.tools??[]));const schemaDigest=request.textFormat?canonicalDigest(jsonValue(request.textFormat)):null;
  await client.query(`INSERT INTO kcml.openai_request_descriptor(id,parent_id,stable_key,display_name,model_logical_operation_id,attempt,owner_kind,owner_object_id,model_id,api_kind,execution_mode,transport,background_policy,store_policy,instructions_payload,input_payload,tools_payload,output_schema_payload,instructions_digest,input_digest,tools_digest,output_schema_digest,model_settings,history_strategy,provider_continuation_handles,sdk_version,adapter_version,serializer_version,budgets,timeout_ms,idempotency_scope,idempotency_key,request_digest,canonical_digest)
    VALUES($1,$2,$3,$4,$5,$6,$7,$2,$8,'RESPONSES_API',$9,'HTTPS',$10,'PROVIDER',$11,$12::jsonb,$13::jsonb,$14::jsonb,$15,$16,$17,$18,$19,$20,$21,'openai-js','kcml-openai-runtime/1','KCML-CANONICAL-JSON/1',$22,120000,'MODEL_CALL_ATTEMPT',$23,$24,$24)`,[descriptorId,request.parentRunId,`openai-request:${callId}`,`${request.model}:${attempt}`,callId,attempt.toString(),request.ownerKind,request.model,executionMode,executionMode==='BACKGROUND'?'BACKGROUND':'FOREGROUND',request.instructions,JSON.stringify(jsonValue(request.input)),JSON.stringify(jsonValue(request.tools??[])),request.textFormat?JSON.stringify(jsonValue(request.textFormat)):null,bytes(instructionsDigest),bytes(inputDigest),bytes(toolsDigest),schemaDigest?bytes(schemaDigest):null,request.settings??{},request.previousResponseId?'PREVIOUS_RESPONSE_ID':'LOCAL_ORDERED_INPUT',request.previousResponseId?{previousResponseId:request.previousResponseId}:{},request.settings??{},requestDigest,bytes(requestDigest)]);
  await client.query(`INSERT INTO kcml.ai_model_call(id,parent_run_id,attempt_sequence,model,request_descriptor_id,request_descriptor,request_digest,input_digest,instructions_digest,tools_digest,schema_digest,settings_snapshot,submit_state)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'INTENT_RECORDED')`,[callId,request.parentRunId,attempt.toString(),request.model,descriptorId,descriptor,bytes(requestDigest),bytes(inputDigest),bytes(instructionsDigest),bytes(toolsDigest),schemaDigest?bytes(schemaDigest):null,request.settings??{}]);
}

async function persistModelEvent(pool:DatabasePool,callId:string,sequence:number,responseId:string|null,event:Record<string,unknown>):Promise<void>{const payload=jsonValue(event);const payloadDigest=bytes(canonicalDigest(payload));await pool.query(`INSERT INTO kcml.ai_model_event(id,parent_id,stable_key,model_call_id,sequence,provider_response_id,provider_sequence,event_type,raw_payload,payload_digest,persisted_at,canonical_digest) VALUES($1,$2,$3,$2,$4,$5,$6,$7,$8,$9,clock_timestamp(),$9)`,[randomUUID(),callId,`model-event:${callId}:${sequence}`,sequence,responseId,typeof event.sequence==='number'?event.sequence:null,String(event.type??'unknown'),payload,payloadDigest]);}

async function persistOutputItems(client:DatabaseClient,callId:string,responseId:string,output:unknown[]):Promise<void>{for(let index=0;index<output.length;index+=1){const raw=jsonValue(output[index]);const item=typeof output[index]==='object'&&output[index]!==null?output[index] as Record<string,unknown>:{};const itemId=randomUUID();const payloadDigest=bytes(canonicalDigest(raw));await client.query(`INSERT INTO kcml.ai_model_output_item(id,parent_id,stable_key,model_call_id,provider_response_id,output_index,provider_item_id,item_type,status,provider_call_id,raw_payload,payload_digest,interpretation_state,canonical_digest) VALUES($1,$2,$3,$2,$4,$5,$6,$7,$8,$9,$10,$11,'PERSISTED',$11)`,[itemId,callId,`model-output:${callId}:${index}`,responseId,index,typeof item.id==='string'?item.id:null,String(item.type??'unknown'),typeof item.status==='string'?item.status:null,typeof item.call_id==='string'?item.call_id:null,raw,payloadDigest]);const content=Array.isArray(item.content)?item.content:[];for(let contentIndex=0;contentIndex<content.length;contentIndex+=1){const part=jsonValue(content[contentIndex]);const partRecord=typeof content[contentIndex]==='object'&&content[contentIndex]!==null?content[contentIndex] as Record<string,unknown>:{};const partDigest=bytes(canonicalDigest(part));await client.query(`INSERT INTO kcml.ai_model_output_content_part(id,parent_id,stable_key,output_item_id,content_index,content_type,payload,payload_digest,annotations,artifact_references,canonical_digest) VALUES($1,$2,$3,$2,$4,$5,$6,$7,$8,$9,$7)`,[randomUUID(),itemId,`model-output-content:${itemId}:${contentIndex}`,contentIndex,String(partRecord.type??'unknown'),part,partDigest,Array.isArray(partRecord.annotations)?partRecord.annotations:[],[]]);}}}

export class ResponsesRuntime {
  public constructor(private readonly pool:DatabasePool,private readonly secrets:OpenAISecretProvider){}

  public async create(request:ModelCallRequest,onEvent?:(event:StreamEvent)=>Promise<void>|void):Promise<ModelCallResult>{
    if(!verifyAuthorityLineage(request.authority))throw new DomainError('AUTHORITY_LINEAGE_INVALID','Model call authority lineage is invalid',403);
    const callId=randomUUID();const descriptor={model:request.model,instructions:request.instructions,input:request.input,previous_response_id:request.previousResponseId??null,tools:request.tools??[],textFormat:request.textFormat??null,settings:request.settings??{}};
    await inTransaction(this.pool,'SERIALIZABLE',async(client)=>persistModelCallIntent(client,callId,request,descriptor,'FOREGROUND'));
    const apiKey=await this.secrets.getOpenAIKey().catch(async()=>{await this.pool.query(`UPDATE kcml.ai_model_call SET submit_state='FAILED_FINAL',output_items=$2::jsonb,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND submit_state='INTENT_RECORDED'`,[callId,JSON.stringify([{type:'credential_error',code:'OPENAI_API_KEY_MISSING'}])]);throw new DomainError('OPENAI_API_KEY_MISSING','OpenAI credential is not configured; add OPENAI_API_KEY in Password Manager',409,'DO_NOT_RETRY',{callId});});
    const client=new OpenAI({apiKey,maxRetries:0,timeout:120_000});const events:StreamEvent[]=[];const started=Date.now();
    await this.pool.query(`UPDATE kcml.ai_model_call SET submit_state='DISPATCH_STARTED',state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND submit_state='INTENT_RECORDED'`,[callId]);
    try{
      const stream=await client.responses.create({model:request.model,instructions:request.instructions,input:request.input as OpenAI.Responses.ResponseInput,stream:true,
        ...(request.previousResponseId?{previous_response_id:request.previousResponseId}:{}),
        ...(request.tools?{tools:request.tools}:{}),
        ...(request.settings?.maxOutputTokens!==undefined?{max_output_tokens:request.settings.maxOutputTokens}:{}),
        ...(request.settings?.temperature!==undefined?{temperature:request.settings.temperature}:{})});
      let responseId='';let outputText='';let completed:unknown=null;let sequence=0;
      for await(const rawEvent of stream){const event=rawEvent as unknown as Record<string,unknown>;sequence+=1;
        if(typeof event.response==='object'&&event.response!==null&&'id'in event.response)responseId=String((event.response as Record<string,unknown>).id);
        await persistModelEvent(this.pool,callId,sequence,responseId||null,event);const item={type:String(event.type??'unknown'),payload:event,sequence};events.push(item);await onEvent?.(item);
        if(event.type==='response.output_text.delta'&&typeof event.delta==='string')outputText+=event.delta;
        if(event.type==='response.completed')completed=event.response;}
      if(!responseId)throw new DomainError('MODEL_RESPONSE_ID_MISSING','Provider stream ended without a response identity',502,'MANUAL_REVIEW');
      const response=completed as Record<string,unknown>|null;const output=Array.isArray(response?.output)?response.output:[];const usage=response?.usage??null;
      await inTransaction(this.pool,'SERIALIZABLE',async client=>{await persistOutputItems(client,callId,responseId,output);await client.query(`UPDATE kcml.ai_model_call SET submit_state='COMPLETED',provider_response_id=$2,output_items=$3::jsonb,usage=$4::jsonb,latency_ms=$5,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`,[callId,responseId,JSON.stringify(output),JSON.stringify(usage),Date.now()-started]);});
      return{callId,responseId,outputText,output,usage,events};
    }catch(error){
      const responseId=typeof error==='object'&&error!==null&&'response_id'in error?String((error as Record<string,unknown>).response_id):null;
      const state=responseId?'FAILED_FINAL':'MODEL_SUBMIT_OUTCOME_UNKNOWN';
      await this.pool.query(`UPDATE kcml.ai_model_call SET submit_state=$2,provider_response_id=$3,output_items=$4::jsonb,latency_ms=$5,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`,[callId,state,responseId,JSON.stringify([{type:'runtime_error',message:error instanceof Error?error.message:String(error)}]),Date.now()-started]);
      if(state==='MODEL_SUBMIT_OUTCOME_UNKNOWN')throw new DomainError('MODEL_SUBMIT_OUTCOME_UNKNOWN','Provider submission outcome is unknown; automatic create retry is prohibited',502,'MANUAL_REVIEW',{callId});
      throw error;
    }
  }

  public async createBackground(request:ModelCallRequest):Promise<BackgroundModelCallResult>{
    if(!verifyAuthorityLineage(request.authority))throw new DomainError('AUTHORITY_LINEAGE_INVALID','Model call authority lineage is invalid',403);
    const callId=randomUUID();const descriptor={model:request.model,instructions:request.instructions,input:request.input,previous_response_id:request.previousResponseId??null,tools:request.tools??[],textFormat:request.textFormat??null,settings:request.settings??{},background:true};
    await inTransaction(this.pool,'SERIALIZABLE',async(client)=>persistModelCallIntent(client,callId,request,descriptor,'BACKGROUND'));
    const key=await this.secrets.getOpenAIKey().catch(async()=>{await this.pool.query(`UPDATE kcml.ai_model_call SET submit_state='FAILED_FINAL',output_items=$2::jsonb,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND submit_state='INTENT_RECORDED'`,[callId,JSON.stringify([{type:'credential_error',code:'OPENAI_API_KEY_MISSING'}])]);throw new DomainError('OPENAI_API_KEY_MISSING','OpenAI credential is not configured; add OPENAI_API_KEY in Password Manager',409,'DO_NOT_RETRY',{callId});});
    const client=new OpenAI({apiKey:key,maxRetries:0,timeout:120_000});
    await this.pool.query(`UPDATE kcml.ai_model_call SET submit_state='DISPATCH_STARTED',state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND submit_state='INTENT_RECORDED'`,[callId]);
    try { const response=await client.responses.create({model:request.model,instructions:request.instructions,input:request.input as OpenAI.Responses.ResponseInput,background:true as never, ...(request.previousResponseId?{previous_response_id:request.previousResponseId}:{}), ...(request.tools?{tools:request.tools}:{}), ...(request.settings?.maxOutputTokens!==undefined?{max_output_tokens:request.settings.maxOutputTokens}:{}), ...(request.settings?.temperature!==undefined?{temperature:request.settings.temperature}:{})} as never) as unknown as Record<string,unknown>; const responseId=typeof response.id==='string'?response.id:null; if(!responseId)throw new DomainError('MODEL_RESPONSE_ID_MISSING','Background response ended without a response identity',502,'MANUAL_REVIEW'); await this.pool.query(`UPDATE kcml.ai_model_call SET submit_state='RESPONSE_IDENTIFIED',provider_response_id=$2,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`,[callId,responseId]); return {callId,responseId,status:String(response.status??'queued')}; }
    catch(error){await this.pool.query(`UPDATE kcml.ai_model_call SET submit_state='MODEL_SUBMIT_OUTCOME_UNKNOWN',output_items=$2::jsonb,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`,[callId,JSON.stringify([{type:'runtime_error',message:error instanceof Error?error.message:String(error)}])]);throw error;}
  }

  public async retrieve(callId:string,authority:AuthorityLineage):Promise<Record<string,unknown>>{
    if(!verifyAuthorityLineage(authority))throw new DomainError('AUTHORITY_LINEAGE_INVALID','Model call authority lineage is invalid',403);
    const row=(await this.pool.query(`SELECT provider_response_id FROM kcml.ai_model_call WHERE id=$1`,[callId])).rows[0];if(!row?.provider_response_id)throw new DomainError('MODEL_RESPONSE_ID_MISSING','No provider response is persisted for this call',409,'MANUAL_REVIEW');
    const key=await this.secrets.getOpenAIKey();const client=new OpenAI({apiKey:key,maxRetries:0,timeout:120_000});const response=await client.responses.retrieve(String(row.provider_response_id));const value=response as unknown as Record<string,unknown>;const providerStatus=String(value.status??'unknown');const submitState=providerStatus==='completed'?'COMPLETED':providerStatus==='failed'?'FAILED_FINAL':providerStatus==='cancelled'?'CANCELLED':'RESPONSE_IDENTIFIED';const output=Array.isArray(value.output)?value.output:[];await inTransaction(this.pool,'SERIALIZABLE',async transaction=>{const existing=Number((await transaction.query(`SELECT count(*)::int AS count FROM kcml.ai_model_output_item WHERE model_call_id=$1`,[callId])).rows[0]?.count??0);if(existing===0&&output.length)await persistOutputItems(transaction,callId,String(row.provider_response_id),output);else if(existing!==0&&existing!==output.length)throw new DomainError('MODEL_OUTPUT_REPLAY_CONFLICT','Retrieved output cardinality conflicts with persisted provider evidence',409,'MANUAL_REVIEW');await transaction.query(`UPDATE kcml.ai_model_call SET output_items=$2::jsonb,usage=$3::jsonb,submit_state=$4,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`,[callId,JSON.stringify(output),JSON.stringify(value.usage??null),submitState]);});return value;
  }

  public async resume(callId:string,authority:AuthorityLineage):Promise<Record<string,unknown>>{return this.retrieve(callId,authority);}

  public async submitToolOutput(callId:string,toolCallId:string,output:unknown,authority:AuthorityLineage):Promise<ModelCallResult>{
    if(!verifyAuthorityLineage(authority))throw new DomainError('AUTHORITY_LINEAGE_INVALID','Model call authority lineage is invalid',403);
    const row=(await this.pool.query(`SELECT c.parent_run_id,c.model,c.provider_response_id,c.request_descriptor,d.owner_kind FROM kcml.ai_model_call c JOIN kcml.openai_request_descriptor d ON d.id=c.request_descriptor_id WHERE c.id=$1`,[callId])).rows[0];if(!row)throw new DomainError('MODEL_CALL_NOT_FOUND','Model call does not exist',404);if(!row.provider_response_id)throw new DomainError('MODEL_RESPONSE_ID_MISSING','Tool output continuation requires the persisted provider response identity',409,'MANUAL_REVIEW');if(!toolCallId)throw new DomainError('MODEL_TOOL_CALL_ID_REQUIRED','Tool call ID is required',422);
    await this.pool.query(`UPDATE kcml.ai_model_call SET output_items=coalesce(output_items,'[]'::jsonb)||$2::jsonb,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`,[callId,JSON.stringify([{type:'function_call_output',callId:toolCallId,output:jsonValue(output)}])]);
    const descriptor=(row.request_descriptor??{}) as Record<string,unknown>;return this.create({parentRunId:String(row.parent_run_id),ownerKind:String(row.owner_kind) as ModelCallRequest['ownerKind'],model:String(row.model),instructions:String(descriptor.instructions??''),input:[{type:'function_call_output',call_id:toolCallId,output:JSON.stringify(jsonValue(output))}] as unknown as string,previousResponseId:String(row.provider_response_id),authority});
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
