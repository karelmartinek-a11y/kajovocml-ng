import { randomUUID } from 'node:crypto';
import type { DatabaseClient, DatabasePool } from '@kcml/database';
import { allocateContiguousSequence, inTransaction } from '@kcml/database';
import { canonicalDigest, type CanonicalJsonValue } from '@kcml/schemas';
import { DomainError } from './errors.js';

function canonicalValue(value:unknown):CanonicalJsonValue{return JSON.parse(JSON.stringify(value,(_key,item)=>typeof item==='bigint'?item.toString():item)) as CanonicalJsonValue;}
function digestBytes(value:unknown):Buffer{return Buffer.from(canonicalDigest(canonicalValue(value)).slice(7),'hex');}
function digestText(value:unknown):string{return canonicalDigest(canonicalValue(value));}
function sameDigest(left:unknown,right:Buffer):boolean{return Buffer.isBuffer(left)&&left.length===right.length&&left.equals(right);}

type JsonObject=Record<string,unknown>;

export interface SystemChatReservationInput{
  conversationId:string;messageId:string;message:string;model:string;context:Record<string,unknown>;accessChannel:'SESSION'|'API_KEY';idempotencyKey:string;correlationId:string;
}
export type SystemChatReservation=
  |{replay:false;recover:boolean;conversationId:string;ownerMessageId:string;modelIntentId:string;requestDigest:string}
  |{replay:true;conversationId:string;ownerMessageId:string;assistantMessageId:string;assistantContent:string;assistantStatus:string;modelCallId:string|null};

export interface SystemChatHistoryItem{
  id:string;sequence:string;role:'OWNER'|'ASSISTANT';content:string;status:string;modelCallId:string|null;usage:unknown;
}

export interface SystemChatActionInput{
  actionId:string;messageId:string;operationKey:string;target:JsonObject;arguments:JsonObject;authorityEvidence:JsonObject;providerCallId:string;parentModelCallId:string;correlationId:string;
}

export class SystemChatService{
  public constructor(private readonly pool:DatabasePool){}

  private requestShape(input:SystemChatReservationInput):JsonObject{
    return {conversationId:input.conversationId,messageId:input.messageId,message:input.message,model:input.model,context:input.context,accessChannel:input.accessChannel,idempotencyKey:input.idempotencyKey};
  }

  private async createModelIntent(client:DatabaseClient,input:SystemChatReservationInput,ownerMessageId:string,heads:any):Promise<string>{
    const id=randomUUID();
    const requestDigest=digestText(this.requestShape(input));
    const argumentsValue={messageId:ownerMessageId,model:input.model,context:input.context,requestDigest};
    const canonical={id,messageId:ownerMessageId,operationKey:'chat.model.respond',target:{conversationId:input.conversationId},arguments:argumentsValue};
    await client.query(`INSERT INTO kcml.system_chat_action(id,message_id,operation_key,target,arguments,arguments_digest,status,started_at,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
      VALUES($1,$2,'chat.model.respond',$3,$4,$5,'RESERVED',clock_timestamp(),$6,$7,$8,$9,$10,$11)`,[
      id,ownerMessageId,{conversationId:input.conversationId},argumentsValue,digestBytes(argumentsValue),digestBytes(canonical),id,input.correlationId,heads.activation_epoch,heads.platform_incarnation_id,heads.current_epoch
    ]);
    return id;
  }

  public async reserve(input:SystemChatReservationInput):Promise<SystemChatReservation>{
    const requestShape=this.requestShape(input);
    const requestDigest=digestBytes(requestShape);
    const requestDigestText=digestText(requestShape);
    return inTransaction(this.pool,'SERIALIZABLE',async client=>{
      const heads=(await client.query(`SELECT p.platform_incarnation_id,d.current_epoch,a.current_epoch AS activation_epoch
        FROM kcml.platform_incarnation p CROSS JOIN kcml.application_deployment_head d CROSS JOIN kcml.activation_head a
        WHERE p.singleton_key=1 AND d.singleton_key=1 AND a.singleton_key=1 FOR SHARE OF p,d,a`)).rows[0];
      let conversation=(await client.query(`SELECT * FROM kcml.system_chat_conversation WHERE id=$1 FOR UPDATE`,[input.conversationId])).rows[0];
      if(!conversation){
        const title=input.message.slice(0,120);const shape={conversationId:input.conversationId,title,ownerActorId:'KRMAR78',accessChannel:input.accessChannel,model:input.model,context:input.context};
        conversation=(await client.query(`INSERT INTO kcml.system_chat_conversation(id,parent_id,stable_key,display_name,title,owner_actor_id,access_channel,status,selected_model,last_activity_at,current_object_context,
          canonical_digest,correlation_id,platform_incarnation_id,application_deployment_epoch,activation_epoch)
          VALUES($1,$1,$2,$3,$3,'KRMAR78',$4,'PROCESSING',$5,clock_timestamp(),$6,$7,$8,$9,$10,$11) RETURNING *`,[
          input.conversationId,`system-chat:${input.conversationId}`,title,input.accessChannel,input.model,input.context,digestBytes(shape),input.correlationId,
          heads.platform_incarnation_id,heads.current_epoch,heads.activation_epoch
        ])).rows[0];
      }else if(conversation.owner_actor_id!=='KRMAR78')throw new DomainError('OPERATION_CONTRACT_INCOMPLETE','Conversation is not owned by the singleton OWNER',403,'DO_NOT_RETRY');
      const stableKey=`system-chat-owner:${input.conversationId}:${input.idempotencyKey}`;
      const prior=(await client.query(`SELECT m.*,a.id AS assistant_message_id,a.content AS assistant_content,a.status AS assistant_status,a.model_call_id AS assistant_model_call_id
        FROM kcml.system_chat_message m LEFT JOIN kcml.system_chat_message a ON a.causation_id=m.id AND a.role='ASSISTANT'
        WHERE m.stable_key=$1 ORDER BY a.sequence DESC NULLS LAST LIMIT 1`,[stableKey])).rows[0];
      if(prior){
        if(!sameDigest(prior.canonical_digest,requestDigest))throw new DomainError('IDEMPOTENCY_CONFLICT','Chat idempotency key was reused with a different message, model, context or access channel',409,'DO_NOT_RETRY',{requestDigest:requestDigestText});
        if(prior.assistant_message_id)return{replay:true,conversationId:input.conversationId,ownerMessageId:String(prior.id),assistantMessageId:String(prior.assistant_message_id),assistantContent:String(prior.assistant_content),assistantStatus:String(prior.assistant_status),modelCallId:prior.assistant_model_call_id?String(prior.assistant_model_call_id):null};
        let modelIntent=(await client.query(`SELECT id FROM kcml.system_chat_action WHERE message_id=$1 AND operation_key='chat.model.respond' ORDER BY started_at ASC LIMIT 1 FOR UPDATE`,[prior.id])).rows[0];
        if(!modelIntent){modelIntent={id:await this.createModelIntent(client,input,String(prior.id),heads)};}
        return{replay:false,recover:true,conversationId:input.conversationId,ownerMessageId:String(prior.id),modelIntentId:String(modelIntent.id),requestDigest:requestDigestText};
      }
      const nextSequence=await allocateContiguousSequence(client,'SYSTEM_CHAT_MESSAGE',input.conversationId,'SEQUENCE');
      await client.query(`INSERT INTO kcml.system_chat_message(id,parent_id,stable_key,display_name,conversation_id,sequence,role,content,status,completed_at,
        correlation_id,canonical_digest,platform_incarnation_id,application_deployment_epoch,activation_epoch)
        VALUES($1,$2,$3,$4,$2,$5,'OWNER',$4,'COMPLETED',clock_timestamp(),$6,$7,$8,$9,$10)`,[
        input.messageId,input.conversationId,stableKey,input.message,nextSequence.toString(),input.correlationId,requestDigest,heads.platform_incarnation_id,heads.current_epoch,heads.activation_epoch
      ]);
      const modelIntentId=await this.createModelIntent(client,input,input.messageId,heads);
      await client.query(`UPDATE kcml.system_chat_conversation SET status='PROCESSING',selected_model=$2,current_object_context=$3,last_activity_at=clock_timestamp(),
        state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`,[input.conversationId,input.model,input.context]);
      return{replay:false,recover:false,conversationId:input.conversationId,ownerMessageId:input.messageId,modelIntentId,requestDigest:requestDigestText};
    });
  }

  public async history(conversationId:string):Promise<SystemChatHistoryItem[]>{
    const rows=(await this.pool.query(`SELECT id,sequence::text AS sequence,role,content,status,model_call_id,usage
      FROM kcml.system_chat_message WHERE conversation_id=$1 AND role IN ('OWNER','ASSISTANT') ORDER BY sequence ASC,id ASC`,[conversationId])).rows;
    return rows.map((row)=>({id:String(row.id),sequence:String(row.sequence),role:String(row.role) as 'OWNER'|'ASSISTANT',content:String(row.content),status:String(row.status),modelCallId:row.model_call_id?String(row.model_call_id):null,usage:row.usage??null}));
  }

  public async markModelIntent(modelIntentId:string,status:'EXECUTING'|'SUCCEEDED'|'FAILED'|'MANUAL_REVIEW',result:unknown=null):Promise<void>{
    const terminal=status==='SUCCEEDED'||status==='FAILED'||status==='MANUAL_REVIEW';
    const changed=await this.pool.query(`UPDATE kcml.system_chat_action SET status=$2,result=$3,result_digest=$4,completed_at=CASE WHEN $5 THEN clock_timestamp() ELSE completed_at END,state_version=state_version+1,updated_at=clock_timestamp()
      WHERE id=$1 AND operation_key='chat.model.respond' AND status IN ('RESERVED','EXECUTING')`,[modelIntentId,status,result,result===null?null:digestBytes(result),terminal]);
    if(changed.rowCount===0){
      const current=(await this.pool.query(`SELECT status FROM kcml.system_chat_action WHERE id=$1 AND operation_key='chat.model.respond'`,[modelIntentId])).rows[0];
      if(!current||String(current.status)!==status)throw new DomainError('STATE_VERSION_CONFLICT','Chat model intent changed while it was being updated',409,'RECONCILE_THEN_RETRY',{modelIntentId,status:current?.status??null});
    }
  }

  public async beginAction(input:SystemChatActionInput):Promise<{actionId:string;replay:boolean;status:string;result:unknown}>{
    return inTransaction(this.pool,'SERIALIZABLE',async client=>{
      const heads=(await client.query(`SELECT p.platform_incarnation_id,d.current_epoch,a.current_epoch AS activation_epoch
        FROM kcml.platform_incarnation p CROSS JOIN kcml.application_deployment_head d CROSS JOIN kcml.activation_head a
        WHERE p.singleton_key=1 AND d.singleton_key=1 AND a.singleton_key=1 FOR SHARE OF p,d,a`)).rows[0];
      const storedArguments={canonicalArguments:input.arguments,authorityEvidence:input.authorityEvidence,providerCallId:input.providerCallId,parentModelCallId:input.parentModelCallId};
      const argumentsDigest=digestBytes(storedArguments);
      const existing=(await client.query(`SELECT * FROM kcml.system_chat_action WHERE id=$1 FOR UPDATE`,[input.actionId])).rows[0];
      if(existing){
        if(String(existing.operation_key)!==input.operationKey||!sameDigest(existing.arguments_digest,argumentsDigest))throw new DomainError('IDEMPOTENCY_CONFLICT','Provider function call identity was reused with a different operation or arguments',409,'DO_NOT_RETRY',{actionId:input.actionId});
        return{actionId:input.actionId,replay:true,status:String(existing.status),result:existing.result??null};
      }
      const canonical={actionId:input.actionId,messageId:input.messageId,operationKey:input.operationKey,target:input.target,storedArguments};
      await client.query(`INSERT INTO kcml.system_chat_action(id,message_id,operation_key,target,arguments,arguments_digest,status,started_at,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
        VALUES($1,$2,$3,$4,$5,$6,'EXECUTING',clock_timestamp(),$7,$8,$9,$10,$11,$12)`,[
        input.actionId,input.messageId,input.operationKey,input.target,storedArguments,argumentsDigest,digestBytes(canonical),input.actionId,input.correlationId,heads.activation_epoch,heads.platform_incarnation_id,heads.current_epoch
      ]);
      return{actionId:input.actionId,replay:false,status:'EXECUTING',result:null};
    });
  }

  public async completeAction(actionId:string,status:'SUCCEEDED'|'FAILED'|'CANCELLED'|'MANUAL_REVIEW',result:unknown):Promise<unknown>{
    return inTransaction(this.pool,'SERIALIZABLE',async client=>{
      const current=(await client.query(`SELECT * FROM kcml.system_chat_action WHERE id=$1 FOR UPDATE`,[actionId])).rows[0];
      if(!current)throw new DomainError('KCIP_TARGET_NOT_FOUND','System chat action does not exist',404,'DO_NOT_RETRY',{actionId});
      if(['SUCCEEDED','FAILED','CANCELLED','MANUAL_REVIEW'].includes(String(current.status)))return current.result??null;
      const updated=(await client.query(`UPDATE kcml.system_chat_action SET status=$2,result=$3,result_digest=$4,completed_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND status IN ('PROPOSED','RESERVED','EXECUTING') RETURNING result`,[actionId,status,result,digestBytes(result)])).rows[0];
      if(!updated)throw new DomainError('STATE_VERSION_CONFLICT','System chat action changed before terminal result persistence',409,'RECONCILE_THEN_RETRY',{actionId});
      return updated.result;
    });
  }

  public async complete(input:{conversationId:string;ownerMessageId:string;content:string;modelCallId:string;usage:unknown;correlationId:string}):Promise<string>{
    return inTransaction(this.pool,'SERIALIZABLE',async client=>{
      const conversation=(await client.query(`SELECT * FROM kcml.system_chat_conversation WHERE id=$1 FOR UPDATE`,[input.conversationId])).rows[0];
      if(!conversation)throw new DomainError('TOOL_ARGUMENT_SCHEMA_INVALID','Conversation disappeared before assistant persistence',409,'MANUAL_REVIEW');
      const ownerMessage=(await client.query(`SELECT id FROM kcml.system_chat_message WHERE id=$1 AND conversation_id=$2 AND role='OWNER'`,[input.ownerMessageId,input.conversationId])).rows[0];
      if(!ownerMessage)throw new DomainError('TOOL_ARGUMENT_SCHEMA_INVALID','OWNER message disappeared before assistant persistence',409,'MANUAL_REVIEW');
      const modelCall=(await client.query(`SELECT id FROM kcml.ai_model_call WHERE id=$1 AND parent_run_id=$2 AND submit_state='COMPLETED'`,[input.modelCallId,input.conversationId])).rows[0];
      if(!modelCall)throw new DomainError('TERMINAL_STATE_IMMUTABLE','Assistant success requires a completed model call owned by the conversation',409,'MANUAL_REVIEW');
      const existing=(await client.query(`SELECT id FROM kcml.system_chat_message WHERE causation_id=$1 AND role='ASSISTANT'`,[input.ownerMessageId])).rows[0];
      if(existing)return String(existing.id);
      const assistantMessageId=randomUUID();const nextSequence=await allocateContiguousSequence(client,'SYSTEM_CHAT_MESSAGE',input.conversationId,'SEQUENCE');
      const shape={conversationId:input.conversationId,assistantMessageId,sequence:nextSequence.toString(),role:'ASSISTANT',content:input.content,modelCallId:input.modelCallId};
      await client.query(`INSERT INTO kcml.system_chat_message(id,parent_id,stable_key,display_name,conversation_id,sequence,role,content,model_call_id,status,usage,completed_at,causation_id,
        correlation_id,canonical_digest,platform_incarnation_id,application_deployment_epoch,activation_epoch)
        VALUES($1,$2,$3,'Assistant response',$2,$4,'ASSISTANT',$5,$6,'COMPLETED',$7,clock_timestamp(),$8,$9,$10,$11,$12,$13)`,[
        assistantMessageId,input.conversationId,`system-chat-assistant:${input.ownerMessageId}`,nextSequence.toString(),input.content,input.modelCallId,input.usage,input.ownerMessageId,input.correlationId,
        digestBytes(shape),conversation.platform_incarnation_id,conversation.application_deployment_epoch,conversation.activation_epoch
      ]);
      await client.query(`UPDATE kcml.system_chat_conversation SET status='OPEN',last_activity_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`,[input.conversationId]);
      return assistantMessageId;
    });
  }

  public async fail(input:{conversationId:string;ownerMessageId:string;message:string;modelCallId?:string|null;correlationId:string}):Promise<string>{
    return inTransaction(this.pool,'SERIALIZABLE',async client=>{
      const conversation=(await client.query(`SELECT * FROM kcml.system_chat_conversation WHERE id=$1 FOR UPDATE`,[input.conversationId])).rows[0];
      if(!conversation)throw new DomainError('TOOL_ARGUMENT_SCHEMA_INVALID','Conversation disappeared before failure persistence',409,'MANUAL_REVIEW');
      const existing=(await client.query(`SELECT id FROM kcml.system_chat_message WHERE causation_id=$1 AND role='ASSISTANT'`,[input.ownerMessageId])).rows[0];
      if(existing)return String(existing.id);
      const assistantMessageId=randomUUID();const nextSequence=await allocateContiguousSequence(client,'SYSTEM_CHAT_MESSAGE',input.conversationId,'SEQUENCE');
      const safeMessage=input.message.slice(0,4000);const shape={conversationId:input.conversationId,assistantMessageId,sequence:nextSequence.toString(),role:'ASSISTANT',status:'FAILED',content:safeMessage,modelCallId:input.modelCallId??null};
      await client.query(`INSERT INTO kcml.system_chat_message(id,parent_id,stable_key,display_name,conversation_id,sequence,role,content,model_call_id,status,completed_at,causation_id,
        correlation_id,canonical_digest,platform_incarnation_id,application_deployment_epoch,activation_epoch)
        VALUES($1,$2,$3,'Assistant failure',$2,$4,'ASSISTANT',$5,$6,'FAILED',clock_timestamp(),$7,$8,$9,$10,$11,$12)`,[
        assistantMessageId,input.conversationId,`system-chat-assistant:${input.ownerMessageId}`,nextSequence.toString(),safeMessage,input.modelCallId??null,input.ownerMessageId,input.correlationId,
        digestBytes(shape),conversation.platform_incarnation_id,conversation.application_deployment_epoch,conversation.activation_epoch
      ]);
      await client.query(`UPDATE kcml.system_chat_conversation SET status='FAILED',last_activity_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`,[input.conversationId]);
      return assistantMessageId;
    });
  }
}
