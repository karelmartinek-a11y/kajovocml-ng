import { randomUUID } from 'node:crypto';
import type { DatabaseClient, DatabasePool } from '@kcml/database';
import { allocateContiguousSequence, inTransaction } from '@kcml/database';
import { canonicalJson, secretInputSchema, type CanonicalJsonValue } from '@kcml/schemas';
import { DomainError } from './errors.js';
import { EnvelopeCipher, fingerprint, randomToken, tokenDigest } from './crypto.js';
import { lockAndVerifyPlatformRecovery, type RecoveryAuthorityHead } from './recovery-authority.js';

export interface SecretSummary {
  id: string; stableName: string; displayName: string; kind: string; activeVersionId: string | null;
  secretActivationEpoch: string; fingerprint: string | null; stateVersion: string; updatedAt: string;
}

export interface RuntimeSecretAuthority {
  executionId: string;
  sourceObjectKind: string;
  sourceObjectId: string;
  sourceRevisionId: string;
  bindingSetRevisionId: string;
  activationSetId: string | null;
  activationEpoch: string;
  platformIncarnationId: string;
  applicationDeploymentEpoch: string;
}

async function appendSecretOutbox(client: DatabaseClient, recovery: RecoveryAuthorityHead, secretId: string, eventType: string, payload: Record<string, unknown>): Promise<bigint> {
  const streamSequence = await allocateContiguousSequence(client, 'TRANSACTIONAL_OUTBOX', secretId, 'SECRET_EVENT');
  const digest = tokenDigest(canonicalJson(payload as unknown as CanonicalJsonValue));
  await client.query(`INSERT INTO kcml.transactional_outbox(stream_key,stream_sequence,purpose,event_type,aggregate_id,payload,payload_digest,recovery_epoch)
    VALUES($1,$2,'DOMAIN_EVENT',$3,$4,$5,$6,$7)`, [`secret:${secretId}`, streamSequence.toString(), eventType, secretId, payload, digest, recovery.recovery_epoch]);
  return streamSequence;
}

export class SecretManager {
  public constructor(private readonly pool: DatabasePool, private readonly cipher: EnvelopeCipher) {}

  public async list(): Promise<SecretSummary[]> {
    const result = await this.pool.query(`SELECT r.id, r.stable_name, r.display_name, r.kind, r.active_version_id,
      r.secret_activation_epoch, v.fingerprint, r.state_version, r.updated_at
      FROM kcml.secret_record r LEFT JOIN kcml.secret_version v ON v.id = r.active_version_id WHERE r.deleted_at IS NULL ORDER BY r.stable_name`);
    return result.rows.map((row) => ({ id: row.id, stableName: row.stable_name, displayName: row.display_name, kind: row.kind,
      activeVersionId: row.active_version_id, secretActivationEpoch: String(row.secret_activation_epoch), fingerprint: row.fingerprint,
      stateVersion: String(row.state_version), updatedAt: new Date(row.updated_at).toISOString() }));
  }

  public async create(inputValue: unknown, actorId: string, logicalOperationId: string = randomUUID(), correlationId: string = randomUUID()): Promise<SecretSummary> {
    const input = secretInputSchema.parse(inputValue);
    const id = randomUUID(); const versionId = randomUUID();
    const envelope = this.cipher.encrypt(input.value, `${id}:${versionId}:${input.stableName}`);
    await inTransaction(this.pool, 'SERIALIZABLE', async (client) => {
      const recovery = await lockAndVerifyPlatformRecovery(client);
      await client.query(`INSERT INTO kcml.secret_record(id,stable_name,display_name,kind,metadata,platform_incarnation_id,application_deployment_epoch)
        VALUES($1,$2,$3,$4,$5,$6,$7)`, [id, input.stableName, input.displayName, input.kind, input.metadata, recovery.platform_incarnation_id, recovery.current_epoch]);
      const versionNumber = await allocateContiguousSequence(client, 'SECRET_VERSION', id, 'VERSION_NUMBER');
      await client.query(`INSERT INTO kcml.secret_version(id,secret_id,version_number,ciphertext,nonce,auth_tag,key_id,fingerprint,value_digest,lifecycle,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'CREATED',$10)`, [versionId,id,versionNumber.toString(),envelope.ciphertext,envelope.nonce,envelope.authTag,envelope.keyId,envelope.fingerprint,envelope.valueDigest,actorId]);
      await client.query(`UPDATE kcml.secret_version SET lifecycle='ACTIVE',activated_at=clock_timestamp(),activation_logical_operation_id=$2 WHERE id=$1 AND lifecycle='CREATED'`, [versionId, logicalOperationId]);
      await client.query(`UPDATE kcml.secret_record SET active_version_id=$2,secret_activation_epoch=1,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`, [id,versionId]);
      const payload = { stableName: input.stableName, versionId, versionNumber: versionNumber.toString(), fingerprint: envelope.fingerprint, logicalOperationId };
      await appendSecretOutbox(client, recovery, id, 'secret.created', payload);
      const canonical = Buffer.from(canonicalJson(payload as unknown as CanonicalJsonValue));
      await client.query(`SELECT * FROM kcml.append_audit_event($1,'OWNER',$2,'SECRET',$3,$4,NULL,$5,$6)`, ['secret.created',actorId,id,correlationId,payload,canonical]);
    });
    return this.get(id);
  }

  public async addVersion(secretId: string, value: string, expectedStateVersion: bigint, actorId: string, activate = true, logicalOperationId: string = randomUUID(), correlationId: string = randomUUID()): Promise<SecretSummary> {
    return inTransaction(this.pool, 'SERIALIZABLE', async (client) => {
      const recovery = await lockAndVerifyPlatformRecovery(client);
      const rowResult = await client.query(`SELECT * FROM kcml.secret_record WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [secretId]);
      const row = rowResult.rows[0];
      if (!row) throw new DomainError('KCIP_TARGET_NOT_FOUND','Secret does not exist',404);
      if (BigInt(row.state_version) !== expectedStateVersion) throw new DomainError('STATE_VERSION_CONFLICT','Secret changed',409,'REFRESH_AND_RETRY_NEW_COMMAND');
      const versionNumber = await allocateContiguousSequence(client, 'SECRET_VERSION', secretId, 'VERSION_NUMBER'); const versionId=randomUUID();
      const envelope=this.cipher.encrypt(value,`${secretId}:${versionId}:${row.stable_name}`);
      await client.query(`INSERT INTO kcml.secret_version(id,secret_id,version_number,ciphertext,nonce,auth_tag,key_id,fingerprint,value_digest,lifecycle,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'CREATED',$10)`,[versionId,secretId,versionNumber.toString(),envelope.ciphertext,envelope.nonce,envelope.authTag,envelope.keyId,envelope.fingerprint,envelope.valueDigest,actorId]);
      let nextStateVersion = BigInt(row.state_version);
      if (activate) {
        if (row.active_version_id) await client.query(`UPDATE kcml.secret_version SET lifecycle='RETIRED',retired_at=clock_timestamp() WHERE id=$1 AND lifecycle='ACTIVE'`,[row.active_version_id]);
        await client.query(`UPDATE kcml.secret_version SET lifecycle='ACTIVE',activated_at=clock_timestamp(),activation_logical_operation_id=$2 WHERE id=$1 AND lifecycle='CREATED'`,[versionId,logicalOperationId]);
        const updated=await client.query(`UPDATE kcml.secret_record SET active_version_id=$2,secret_activation_epoch=secret_activation_epoch+1,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND state_version=$3 RETURNING state_version`,[secretId,versionId,expectedStateVersion.toString()]);
        if (updated.rowCount !== 1) throw new DomainError('STATE_VERSION_CONFLICT','Secret changed',409,'REFRESH_AND_RETRY_NEW_COMMAND');
        nextStateVersion = BigInt(updated.rows[0].state_version);
      }
      const payload={ secretId, versionId, versionNumber:versionNumber.toString(), activate, fingerprint:envelope.fingerprint, logicalOperationId };
      await client.query(`UPDATE kcml.secret_record SET platform_incarnation_id=$2,application_deployment_epoch=$3 WHERE id=$1`, [secretId,recovery.platform_incarnation_id,recovery.current_epoch]);
      await appendSecretOutbox(client, recovery, secretId, activate ? 'secret.version.activated' : 'secret.version.created', payload);
      await client.query(`SELECT * FROM kcml.append_audit_event($1,'OWNER',$2,'SECRET',$3,$4,NULL,$5,$6)`,[activate?'secret.version.activated':'secret.version.created',actorId,secretId,correlationId,payload,Buffer.from(canonicalJson(payload as unknown as CanonicalJsonValue))]);
      return { id:secretId,stableName:row.stable_name,displayName:row.display_name,kind:row.kind,activeVersionId:activate?versionId:row.active_version_id,
        secretActivationEpoch:String(BigInt(row.secret_activation_epoch)+(activate?1n:0n)),fingerprint:activate?envelope.fingerprint:null,stateVersion:String(nextStateVersion),updatedAt:new Date().toISOString() };
    });
  }

  public async reveal(secretId: string, actorId: string, logicalOperationId: string = randomUUID(), correlationId: string = randomUUID()): Promise<{ value: string; fingerprint: string; versionId: string }> {
    return inTransaction(this.pool,'READ COMMITTED',async(client)=>{
      const recovery = await lockAndVerifyPlatformRecovery(client);
      const result=await client.query(`SELECT r.stable_name,v.* FROM kcml.secret_record r JOIN kcml.secret_version v ON v.id=r.active_version_id WHERE r.id=$1 AND r.deleted_at IS NULL AND v.lifecycle='ACTIVE'`,[secretId]);
      const row=result.rows[0]; if(!row) throw new DomainError('KCIP_TARGET_NOT_FOUND','Active secret does not exist',404);
      const payload={secretId,versionId:row.id,fingerprint:row.fingerprint,actorId,logicalOperationId};
      await client.query(`INSERT INTO kcml.secret_access_event(parent_id,stable_key,secret_id,secret_version_id,execution_context_id,purpose,operation,success,occurred_at,logical_operation_id,correlation_id,platform_incarnation_id,application_deployment_epoch,canonical_digest)
        VALUES($1,$2,$1,$3,$4,'OWNER_REVEAL','secret.reveal',true,clock_timestamp(),$4,$5,$6,$7,kcml.canonical_digest($8))`,[secretId,`${secretId}:${row.id}:${correlationId}`,row.id,logicalOperationId,correlationId,recovery.platform_incarnation_id,recovery.current_epoch,Buffer.from(canonicalJson(payload as unknown as CanonicalJsonValue))]);
      await client.query(`SELECT * FROM kcml.append_audit_event('secret.revealed','OWNER',$1,'SECRET',$2,$3,NULL,$4,$5)`,[actorId,secretId,correlationId,payload,Buffer.from(canonicalJson(payload as unknown as CanonicalJsonValue))]);
      return {value:this.cipher.decrypt({ciphertext:row.ciphertext,nonce:row.nonce,authTag:row.auth_tag},`${secretId}:${row.id}:${row.stable_name}`),fingerprint:row.fingerprint,versionId:row.id};
    });
  }

  public async revealForRuntimeBinding(authority: RuntimeSecretAuthority, bindingAlias: string, purpose: string, operation: string, correlationId = randomUUID()): Promise<{ value: string; fingerprint: string; versionId: string; bindingId: string }> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u.test(bindingAlias)) throw new Error('SECRET_BINDING_ALIAS_INVALID');
    if (!purpose || purpose.length > 256) throw new Error('SECRET_PURPOSE_INVALID');
    return inTransaction(this.pool, 'SERIALIZABLE', async (client) => {
      const recovery = await lockAndVerifyPlatformRecovery(client);
      if (recovery.platform_incarnation_id !== authority.platformIncarnationId || String(recovery.current_epoch) !== authority.applicationDeploymentEpoch) throw new Error('RUNTIME_EXECUTION_AUTHORITY_STALE');
      const result = await client.query(`SELECT b.*,r.stable_name,r.secret_activation_epoch,r.active_version_id,
          v.id AS version_id,v.ciphertext,v.nonce,v.auth_tag,v.fingerprint,v.lifecycle AS version_lifecycle
        FROM kcml.secret_binding b
        JOIN kcml.secret_record r ON r.id=b.secret_id AND r.deleted_at IS NULL
        JOIN kcml.secret_version v ON v.id=r.active_version_id AND v.lifecycle='ACTIVE'
        JOIN kcml.binding_set_member m ON m.revision_id=$1 AND m.member_kind='SECRET'
          AND m.operation_name=$2 AND m.purpose=$3
          AND m.source_identity->>'objectId'=$4::text AND m.source_identity->>'revisionId'=$5::text
          AND (m.target_identity->>'bindingId'=b.id::text OR m.target_identity->>'secretId'=b.secret_id::text)
        WHERE b.stable_key=$6 AND b.lifecycle='ACTIVE' AND b.deleted_at IS NULL AND b.retired_at IS NULL
          AND b.source_object_kind=$7 AND b.source_object_id=$4::uuid AND b.source_revision_id=$5::uuid
          AND b.usage_purpose=$3 AND (b.expires_at IS NULL OR b.expires_at>clock_timestamp())
          AND b.activation_epoch=$8 AND b.platform_incarnation_id=$9 AND b.application_deployment_epoch=$10
          AND b.activation_set_id IS NOT DISTINCT FROM $11
        LIMIT 2 FOR SHARE OF b,r,v,m`, [authority.bindingSetRevisionId,operation,purpose,authority.sourceObjectId,authority.sourceRevisionId,bindingAlias,authority.sourceObjectKind,authority.activationEpoch,authority.platformIncarnationId,authority.applicationDeploymentEpoch,authority.activationSetId]);
      if (result.rowCount !== 1) throw new Error('SECRET_BINDING_NOT_AUTHORIZED');
      const row = result.rows[0];
      const pinnedVersion = row.version_selector?.versionId ?? row.version_selector?.version_id;
      if (!['PINNED_VERSION','CURRENT_ACTIVE'].includes(String(row.resolved_version_policy))) throw new Error('SECRET_BINDING_VERSION_POLICY_INVALID');
      if (row.resolved_version_policy === 'PINNED_VERSION' && !pinnedVersion) throw new Error('SECRET_BINDING_VERSION_POLICY_INVALID');
      if (pinnedVersion && String(pinnedVersion) !== String(row.version_id)) throw new Error('SECRET_BINDING_VERSION_STALE');
      const logicalOperationId = randomUUID();
      const resolutionId = randomUUID();
      const evidence = { executionId: authority.executionId, bindingId: row.id, bindingRevision: String(row.binding_revision), bindingSetRevisionId: authority.bindingSetRevisionId, purpose, operation, secretId: row.secret_id, versionId: row.version_id, fingerprint: row.fingerprint, activationEpoch: authority.activationEpoch };
      const evidenceBytes = Buffer.from(canonicalJson(evidence as unknown as CanonicalJsonValue));
      await client.query(`INSERT INTO kcml.secret_resolution(id,stable_key,execution_context_id,secret_id,binding_id,binding_revision,binding_digest,requested_stable_name,requested_purpose,requested_target,resolved_secret_version_id,secret_activation_epoch,source_revision_id,source_activation_epoch,state,result_fingerprint,expires_at,consumed_at,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'RESOLVED',$15,LEAST(COALESCE($16,clock_timestamp()+interval '5 minutes'),clock_timestamp()+interval '5 minutes'),clock_timestamp(),kcml.canonical_digest($17),$18,$19,$14,$20,$21)`, [resolutionId,`${authority.executionId}:${bindingAlias}:${correlationId}`,authority.executionId,row.secret_id,row.id,row.binding_revision,row.binding_digest,bindingAlias,purpose,row.target_id?{targetId:row.target_id}:null,row.version_id,row.secret_activation_epoch,authority.sourceRevisionId,authority.activationEpoch,row.fingerprint,row.expires_at,evidenceBytes,logicalOperationId,correlationId,authority.platformIncarnationId,authority.applicationDeploymentEpoch]);
      await client.query(`INSERT INTO kcml.secret_access_event(parent_id,stable_key,secret_id,secret_version_id,execution_context_id,binding_id,purpose,operation,success,occurred_at,runtime_id,job_id,run_id,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
        VALUES($1,$2,$1,$3,$4,$5,$6,$7,true,clock_timestamp(),NULL,NULL,NULL,kcml.canonical_digest($8),$9,$10,$11,$12,$13)`, [row.secret_id,`${resolutionId}:access`,row.version_id,authority.executionId,row.id,purpose,operation,evidenceBytes,logicalOperationId,correlationId,authority.activationEpoch,authority.platformIncarnationId,authority.applicationDeploymentEpoch]);
      await client.query(`SELECT * FROM kcml.append_audit_event('secret.used','SYSTEM',$1,'SECRET_RESOLUTION',$2,$3,NULL,$4,$5)`, [`runtime:${authority.executionId}`,resolutionId,correlationId,evidence,evidenceBytes]);
      return { value: this.cipher.decrypt({ ciphertext: row.ciphertext, nonce: row.nonce, authTag: row.auth_tag }, `${row.secret_id}:${row.version_id}:${row.stable_name}`), fingerprint: row.fingerprint, versionId: row.version_id, bindingId: row.id };
    });
  }

  public async get(id: string): Promise<SecretSummary> {
    const result=await this.pool.query(`SELECT r.id,r.stable_name,r.display_name,r.kind,r.active_version_id,r.secret_activation_epoch,v.fingerprint,r.state_version,r.updated_at FROM kcml.secret_record r LEFT JOIN kcml.secret_version v ON v.id=r.active_version_id WHERE r.id=$1 AND r.deleted_at IS NULL`,[id]);
    const row=result.rows[0]; if(!row) throw new DomainError('KCIP_TARGET_NOT_FOUND','Secret does not exist',404);
    return {id:row.id,stableName:row.stable_name,displayName:row.display_name,kind:row.kind,activeVersionId:row.active_version_id,secretActivationEpoch:String(row.secret_activation_epoch),fingerprint:row.fingerprint,stateVersion:String(row.state_version),updatedAt:new Date(row.updated_at).toISOString()};
  }


  public async update(id: string, input: unknown, expectedStateVersion: bigint, actorId: string, logicalOperationId: string = randomUUID(), correlationId: string = randomUUID()): Promise<SecretSummary> {
    const body = (input ?? {}) as Record<string, unknown>;
    return inTransaction(this.pool, 'SERIALIZABLE', async (client) => {
      const recovery = await lockAndVerifyPlatformRecovery(client);
      const current = (await client.query(`SELECT * FROM kcml.secret_record WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [id])).rows[0];
      if (!current) throw new DomainError('KCIP_TARGET_NOT_FOUND', 'Secret does not exist', 404);
      if (BigInt(current.state_version) !== expectedStateVersion) throw new DomainError('STATE_VERSION_CONFLICT', 'Secret changed', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
      const displayName = typeof body.displayName === 'string' ? body.displayName : current.display_name;
      const metadata = body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? body.metadata : current.metadata;
      await client.query(`UPDATE kcml.secret_record SET display_name=$2,metadata=$3,platform_incarnation_id=$4,application_deployment_epoch=$5,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`, [id, displayName, metadata,recovery.platform_incarnation_id,recovery.current_epoch]);
      const payload = { id, displayName, logicalOperationId };
      await appendSecretOutbox(client, recovery, id, 'secret.updated', payload);
      await client.query(`SELECT * FROM kcml.append_audit_event('secret.updated','OWNER',$1,'SECRET',$2,$3,NULL,$4,$5)`, [actorId, id, correlationId, payload, Buffer.from(canonicalJson(payload as unknown as CanonicalJsonValue))]);
      return { id, stableName: current.stable_name, displayName, kind: current.kind, activeVersionId: current.active_version_id, secretActivationEpoch: String(current.secret_activation_epoch), fingerprint: null, stateVersion: String(expectedStateVersion + 1n), updatedAt: new Date().toISOString() };
    });
  }

  public async softDelete(id: string, expectedStateVersion: bigint, actorId: string, logicalOperationId: string = randomUUID(), correlationId: string = randomUUID()): Promise<{ id: string; deleted: true; stateVersion: string }> {
    return inTransaction(this.pool, 'SERIALIZABLE', async (client) => {
      const recovery = await lockAndVerifyPlatformRecovery(client);
      const result = await client.query(`UPDATE kcml.secret_record SET lifecycle='CLOSED',deleted_at=clock_timestamp(),platform_incarnation_id=$3,application_deployment_epoch=$4,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND deleted_at IS NULL AND state_version=$2 RETURNING state_version`, [id, expectedStateVersion.toString(),recovery.platform_incarnation_id,recovery.current_epoch]);
      if (result.rowCount !== 1) throw new DomainError('STATE_VERSION_CONFLICT', 'Secret is missing or stale', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
      const payload = { id, deleted: true, logicalOperationId };
      await appendSecretOutbox(client, recovery, id, 'secret.deleted', payload);
      await client.query(`SELECT * FROM kcml.append_audit_event('secret.deleted','OWNER',$1,'SECRET',$2,$3,NULL,$4,$5)`, [actorId, id, correlationId, payload, Buffer.from(canonicalJson(payload as unknown as CanonicalJsonValue))]);
      return { id, deleted: true, stateVersion: String(result.rows[0].state_version) };
    });
  }

  public async listVersions(secretId: string): Promise<unknown[]> {
    const result = await this.pool.query(`SELECT id,secret_id,version_number,fingerprint,lifecycle,key_id,algorithm,created_at,created_by FROM kcml.secret_version WHERE secret_id=$1 ORDER BY version_number DESC`, [secretId]);
    return result.rows;
  }

  public async exportActive(actorId: string): Promise<unknown[]> {
    const records = await this.pool.query(`SELECT id,stable_name,display_name,kind,metadata FROM kcml.secret_record WHERE deleted_at IS NULL ORDER BY stable_name`);
    const output: unknown[] = [];
    for (const record of records.rows) {
      const revealed = await this.reveal(record.id, actorId);
      output.push({ stableName: record.stable_name, displayName: record.display_name, kind: record.kind, metadata: record.metadata, value: revealed.value, fingerprint: revealed.fingerprint });
    }
    return output;
  }

  public async ensureOwnerApiKey(actorId: string, logicalOperationId = randomUUID(), correlationId = randomUUID()): Promise<{ created: boolean; value?: string; fingerprint: string }> {
    return inTransaction(this.pool,'SERIALIZABLE',async(client)=>{
      const recovery=await lockAndVerifyPlatformRecovery(client);
      const credentialResult=await client.query(`SELECT * FROM kcml.owner_api_credential WHERE singleton_key=1 FOR UPDATE`); const credential=credentialResult.rows[0];
      if(credential.secret_id && credential.secret_version_id && credential.fingerprint) return {created:false,fingerprint:credential.fingerprint};
      const secretId=randomUUID(); const versionId=randomUUID(); const value=`kcml_live_${randomToken(32)}`; const envelope=this.cipher.encrypt(value,`${secretId}:${versionId}:KCML_OWNER_API_KEY`);
      await client.query(`INSERT INTO kcml.secret_record(id,stable_name,display_name,kind,active_version_id,secret_activation_epoch,platform_incarnation_id,application_deployment_epoch,state_version) VALUES($1,'KCML_OWNER_API_KEY','OWNER API key','API_KEY',NULL,0,$2,$3,1)`,[secretId,recovery.platform_incarnation_id,recovery.current_epoch]);
      const versionNumber = await allocateContiguousSequence(client, 'SECRET_VERSION', secretId, 'VERSION_NUMBER');
      await client.query(`INSERT INTO kcml.secret_version(id,secret_id,version_number,ciphertext,nonce,auth_tag,key_id,fingerprint,value_digest,lifecycle,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'CREATED',$10)`,[versionId,secretId,versionNumber.toString(),envelope.ciphertext,envelope.nonce,envelope.authTag,envelope.keyId,envelope.fingerprint,envelope.valueDigest,actorId]);
      await client.query(`UPDATE kcml.secret_version SET lifecycle='ACTIVE',activated_at=clock_timestamp(),activation_logical_operation_id=$2 WHERE id=$1 AND lifecycle='CREATED'`,[versionId,logicalOperationId]);
      await client.query(`UPDATE kcml.secret_record SET active_version_id=$2,secret_activation_epoch=1,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`,[secretId,versionId]);
      await client.query(`UPDATE kcml.owner_api_credential SET secret_id=$1,secret_version_id=$2,verifier_hash=$3,fingerprint=$4,credential_version=1,credential_activation_epoch=1,last_rotate_logical_operation=$5,state_version=state_version+1,rotated_at=clock_timestamp(),updated_at=clock_timestamp() WHERE singleton_key=1`,[secretId,versionId,tokenDigest(value),fingerprint(value),logicalOperationId]);
      const payload={secretId,versionId,fingerprint:fingerprint(value),logicalOperationId};
      await appendSecretOutbox(client,recovery,secretId,'owner.api_key.initialized',payload);
      await client.query(`SELECT * FROM kcml.append_audit_event('owner.api_key.initialized','OWNER',$1,'OWNER_API_CREDENTIAL',$2,$3,NULL,$4,$5)`,[actorId,credential.id,correlationId,payload,Buffer.from(canonicalJson(payload as unknown as CanonicalJsonValue))]);
      return {created:true,value,fingerprint:fingerprint(value)};
    });
  }

  public async rotateOwnerApiKey(expectedStateVersion: bigint, actorId: string, logicalOperationId: string = randomUUID(), correlationId: string = randomUUID()): Promise<{ fingerprint: string; credentialVersion: string; stateVersion: string }> {
    const value = `kcml_live_${randomToken(32)}`;
    return inTransaction(this.pool, 'SERIALIZABLE', async (client) => {
      const recovery = await lockAndVerifyPlatformRecovery(client);
      const credentialResult = await client.query(`SELECT * FROM kcml.owner_api_credential WHERE singleton_key=1 FOR UPDATE`);
      const credential = credentialResult.rows[0];
      if (!credential?.secret_id) throw new DomainError('AGENTIC_OPERATION_CONTEXT_INVALID', 'Initialize the singleton credential first', 409);
      if (BigInt(credential.state_version) !== expectedStateVersion) throw new DomainError('STATE_VERSION_CONFLICT', 'OWNER API key changed', 409, 'REFRESH_AND_RETRY_NEW_COMMAND');
      if (credential.last_rotate_logical_operation === logicalOperationId && credential.last_rotate_outcome_digest) {
        return { fingerprint: credential.fingerprint, credentialVersion: String(credential.credential_version), stateVersion: String(credential.state_version) };
      }
      const secretResult = await client.query(`SELECT * FROM kcml.secret_record WHERE id=$1 FOR UPDATE`, [credential.secret_id]);
      const secret = secretResult.rows[0];
      if (!secret) throw new DomainError('AGENTIC_OWNER_INTENT_MISSING', 'Singleton OWNER API secret is missing', 500);
      const versionNumber = await allocateContiguousSequence(client, 'SECRET_VERSION', secret.id, 'VERSION_NUMBER');
      const versionId = randomUUID();
      const envelope = this.cipher.encrypt(value, `${secret.id}:${versionId}:KCML_OWNER_API_KEY`);
      await client.query(`INSERT INTO kcml.secret_version(id,secret_id,version_number,ciphertext,nonce,auth_tag,key_id,fingerprint,value_digest,lifecycle,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'CREATED',$10)`, [versionId, secret.id, versionNumber.toString(), envelope.ciphertext, envelope.nonce, envelope.authTag, envelope.keyId, envelope.fingerprint, envelope.valueDigest, actorId]);
      if (secret.active_version_id) await client.query(`UPDATE kcml.secret_version SET lifecycle='RETIRED',retired_at=clock_timestamp() WHERE id=$1 AND lifecycle='ACTIVE'`, [secret.active_version_id]);
      await client.query(`UPDATE kcml.secret_version SET lifecycle='ACTIVE',activated_at=clock_timestamp(),activation_logical_operation_id=$2 WHERE id=$1 AND lifecycle='CREATED'`, [versionId, logicalOperationId]);
      await client.query(`UPDATE kcml.secret_record SET active_version_id=$2,secret_activation_epoch=secret_activation_epoch+1,platform_incarnation_id=$3,application_deployment_epoch=$4,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`, [secret.id, versionId,recovery.platform_incarnation_id,recovery.current_epoch]);
      const nextCredentialVersion = BigInt(credential.credential_version) + 1n;
      const nextStateVersion = BigInt(credential.state_version) + 1n;
      const outcome = { fingerprint: fingerprint(value), credentialVersion: nextCredentialVersion.toString(), stateVersion: nextStateVersion.toString() };
      const outcomeDigest = tokenDigest(canonicalJson(outcome as unknown as CanonicalJsonValue));
      await client.query(`UPDATE kcml.owner_api_credential SET secret_version_id=$1,verifier_hash=$2,fingerprint=$3,credential_version=$4,credential_activation_epoch=credential_activation_epoch+1,
        last_rotate_logical_operation=$5,last_rotate_outcome_digest=$6,audit_correlation_id=$7,rotated_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp()
        WHERE singleton_key=1 AND state_version=$8`, [versionId, tokenDigest(value), outcome.fingerprint, nextCredentialVersion.toString(), logicalOperationId, outcomeDigest, correlationId, expectedStateVersion.toString()]);
      const auditPayload = { logicalOperationId, fingerprint: outcome.fingerprint, credentialVersion: outcome.credentialVersion, secretVersionId: versionId };
      await appendSecretOutbox(client, recovery, secret.id, 'owner.api_key.rotated', auditPayload);
      await client.query(`SELECT * FROM kcml.append_audit_event('owner.api_key.rotated','OWNER',$1,'OWNER_API_CREDENTIAL',$2,$3,NULL,$4,$5)`, [actorId, credential.id, correlationId, auditPayload, Buffer.from(canonicalJson(auditPayload as CanonicalJsonValue))]);
      return outcome;
    });
  }
}
