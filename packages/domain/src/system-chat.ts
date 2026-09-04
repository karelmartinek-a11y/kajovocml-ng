import { randomUUID } from 'node:crypto';
import type { DatabasePool } from '@kcml/database';
import { allocateContiguousSequence, inTransaction } from '@kcml/database';
import { canonicalDigest, type CanonicalJsonValue } from '@kcml/schemas';
import { DomainError } from './errors.js';

function canonicalValue(value:unknown):CanonicalJsonValue{return JSON.parse(JSON.stringify(value,(_key,item)=>typeof item==='bigint'?item.toString():item)) as CanonicalJsonValue;}
function digestBytes(value:unknown):Buffer{return Buffer.from(canonicalDigest(canonicalValue(value)).slice(7),'hex');}

export interface SystemChatReservationInput{
  conversationId:string;messageId:string;message:string;model:string;context:Record<string,unknown>;accessChannel:'SESSION'|'API_KEY';idempotencyKey:string;correlationId:string;
}
export type SystemChatReservation=
  |{replay:false;conversationId:string;ownerMessageId:string}
  |{replay:true;conversationId:string;ownerMessageId:string;assistantMessageId:string;assistantContent:string;assistantStatus:string;modelCallId:string|null};

export class SystemChatService{
  public constructor(private readonly pool:DatabasePool){}

  public async reserve(input:SystemChatReservationInput):Promise<SystemChatReservation>{
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
        if(prior.content!==input.message)throw new DomainError('IDEMPOTENCY_CONFLICT','Chat idempotency key was used with a different OWNER message',409,'DO_NOT_RETRY');
        if(prior.assistant_message_id)return{replay:true,conversationId:input.conversationId,ownerMessageId:String(prior.id),assistantMessageId:String(prior.assistant_message_id),assistantContent:String(prior.assistant_content),assistantStatus:String(prior.assistant_status),modelCallId:prior.assistant_model_call_id?String(prior.assistant_model_call_id):null};
        throw new DomainError('PLATFORM_RECOVERY_IN_PROGRESS','The idempotent chat request is still in progress',409,'RETRY_SAME_OPERATION');
      }
      const nextSequence=await allocateContiguousSequence(client,'SYSTEM_CHAT_MESSAGE',input.conversationId,'SEQUENCE');
      const shape={conversationId:input.conversationId,messageId:input.messageId,sequence:nextSequence.toString(),role:'OWNER',content:input.message,context:input.context,idempotencyKey:input.idempotencyKey};
      await client.query(`INSERT INTO kcml.system_chat_message(id,parent_id,stable_key,display_name,conversation_id,sequence,role,content,status,completed_at,
        correlation_id,canonical_digest,platform_incarnation_id,application_deployment_epoch,activation_epoch)
        VALUES($1,$2,$3,$4,$2,$5,'OWNER',$4,'COMPLETED',clock_timestamp(),$6,$7,$8,$9,$10)`,[
        input.messageId,input.conversationId,stableKey,input.message,nextSequence.toString(),input.correlationId,digestBytes(shape),heads.platform_incarnation_id,heads.current_epoch,heads.activation_epoch
      ]);
      await client.query(`UPDATE kcml.system_chat_conversation SET status='PROCESSING',selected_model=$2,current_object_context=$3,last_activity_at=clock_timestamp(),
        state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`,[input.conversationId,input.model,input.context]);
      return{replay:false,conversationId:input.conversationId,ownerMessageId:input.messageId};
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
