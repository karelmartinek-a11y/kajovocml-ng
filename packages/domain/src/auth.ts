import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';
import type { DatabasePool } from '@kcml/database';
import { inTransaction } from '@kcml/database';
import { canonicalJson, type CanonicalJsonValue } from '@kcml/schemas';
import { DomainError } from './errors.js';
import { base32Encode, EnvelopeCipher, randomToken, tokenDigest, verifyTotp } from './crypto.js';

export interface SessionPrincipal {
  ownerId: string;
  username: 'KRMAR78';
  sessionId: string;
  csrfTokenDigest: Buffer;
  mfaVerified: boolean;
  sessionEpoch: bigint;
  expiresAt: Date;
}

export interface LoginResult {
  state: 'AUTHENTICATED' | 'MFA_REQUIRED' | 'MFA_ENROLLMENT_REQUIRED';
  sessionToken: string;
  csrfToken: string;
  sessionId: string;
  expiresAt: string;
}

function sessionHash(token: string): Buffer {
  return tokenDigest(`KCML-OWNER-SESSION/1\u0000${token}`);
}

function equalDigest(left: Buffer | undefined, right: Buffer): boolean {
  return left !== undefined && left.length === right.length && timingSafeEqual(left, right);
}

export class OwnerAuthenticationService {
  public constructor(private readonly pool: DatabasePool, private readonly cipher: EnvelopeCipher) {}

  public async synchronizeDeploymentPassword(password: string): Promise<void> {
    if (Buffer.byteLength(password, 'utf8') === 0) throw new DomainError('AGENTIC_OPERATION_CONTEXT_INVALID', 'PASS must not be empty', 422);
    const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 65_536, timeCost: 3, parallelism: 1, hashLength: 32 });
    await inTransaction(this.pool, 'SERIALIZABLE', async (client) => {
      const headResult = await client.query(`SELECT * FROM kcml.owner_identity WHERE singleton_key=1 FOR UPDATE`);
      const owner = headResult.rows[0];
      const deployment = await client.query(`SELECT current_epoch FROM kcml.application_deployment_head WHERE singleton_key=1 FOR SHARE`);
      await client.query(`UPDATE kcml.owner_identity SET password_hash=$1,password_changed_at=clock_timestamp(),session_epoch=session_epoch+1,
        application_deployment_epoch=$2,state_version=state_version+1,updated_at=clock_timestamp() WHERE singleton_key=1`, [hash, deployment.rows[0].current_epoch]);
      await client.query(`UPDATE kcml.owner_session SET revoked_at=coalesce(revoked_at,clock_timestamp()),state_version=state_version+1 WHERE owner_identity_id=$1 AND revoked_at IS NULL`, [owner.id]);
      const payload = { username: 'KRMAR78', source: 'GITHUB_ACTIONS_PASS', deploymentEpoch: String(deployment.rows[0].current_epoch) };
      await client.query(`SELECT * FROM kcml.append_audit_event('owner.password.synchronized','DEPLOYMENT','github-actions','OWNER',$1,gen_random_uuid(),NULL,$2,$3)`, [owner.id, payload, Buffer.from(canonicalJson(payload as CanonicalJsonValue))]);
    });
    const verified = await this.pool.query(`SELECT password_hash FROM kcml.owner_identity WHERE singleton_key=1`);
    if (!verified.rows[0]?.password_hash || !(await argon2.verify(verified.rows[0].password_hash, password))) throw new Error('Deployment password verification failed');
  }

  public async login(username: string, password: string, remoteAddress: string | null, userAgent: string | null, correlationId: string): Promise<LoginResult> {
    const throttleKey = tokenDigest(`OWNER_LOGIN/1\u0000${remoteAddress ?? 'unknown'}`);
    const throttle = await this.pool.query(`SELECT failure_count,locked_until FROM kcml.owner_login_throttle WHERE attempt_key_digest=$1`, [throttleKey]);
    const lockedUntil = throttle.rows[0]?.locked_until ? new Date(throttle.rows[0].locked_until) : null;
    if (lockedUntil && lockedUntil.getTime() > Date.now()) throw new DomainError('PROVIDER_RATE_LIMITED', 'Too many authentication attempts', 429, 'RETRY_SAME_OPERATION');

    const result = await this.pool.query(`SELECT * FROM kcml.owner_identity WHERE singleton_key=1`);
    const owner = result.rows[0];
    const suppliedUsernameDigest = tokenDigest(`OWNER_USERNAME/1\u0000${username}`);
    const persistedUsernameDigest = tokenDigest(`OWNER_USERNAME/1\u0000${typeof owner?.username === 'string' ? owner.username : ''}`);
    const validUsername = timingSafeEqual(suppliedUsernameDigest, persistedUsernameDigest);
    const validPassword = typeof owner?.password_hash === 'string' && await argon2.verify(owner.password_hash, password).catch(() => false);
    if (!validUsername || !validPassword) {
      await this.recordLoginFailure(throttleKey);
      const payload = { accepted: false, remoteAddress, reasonCode: 'INVALID_CREDENTIALS' };
      if (owner?.id) await this.pool.query(`SELECT * FROM kcml.append_audit_event('owner.login.rejected','OWNER_LOGIN','anonymous','OWNER',$1,$2,NULL,$3,$4)`, [owner.id, correlationId, payload, Buffer.from(canonicalJson(payload as CanonicalJsonValue))]);
      throw new DomainError('AGENTIC_OPERATION_CONTEXT_INVALID', 'Invalid credentials', 401);
    }
    await this.pool.query(`DELETE FROM kcml.owner_login_throttle WHERE attempt_key_digest=$1`, [throttleKey]);
    // Interactive password login never satisfies MFA. A fresh installation must
    // complete enrollment, and an enrolled installation must verify a TOTP or
    // recovery code before any MFA-protected endpoint is accessible.
    return this.createSession(owner, remoteAddress, userAgent, false);
  }

  private async recordLoginFailure(attemptKeyDigest: Buffer): Promise<void> {
    await this.pool.query(`INSERT INTO kcml.owner_login_throttle(attempt_key_digest,failure_count,first_failure_at,last_failure_at,locked_until)
      VALUES($1,1,clock_timestamp(),clock_timestamp(),NULL)
      ON CONFLICT(attempt_key_digest) DO UPDATE SET
        failure_count=CASE WHEN kcml.owner_login_throttle.first_failure_at < clock_timestamp()-interval '15 minutes' THEN 1 ELSE kcml.owner_login_throttle.failure_count+1 END,
        first_failure_at=CASE WHEN kcml.owner_login_throttle.first_failure_at < clock_timestamp()-interval '15 minutes' THEN clock_timestamp() ELSE kcml.owner_login_throttle.first_failure_at END,
        last_failure_at=clock_timestamp(),
        locked_until=CASE WHEN (CASE WHEN kcml.owner_login_throttle.first_failure_at < clock_timestamp()-interval '15 minutes' THEN 1 ELSE kcml.owner_login_throttle.failure_count+1 END)>=12 THEN clock_timestamp()+interval '15 minutes' ELSE NULL END,
        state_version=kcml.owner_login_throttle.state_version+1`, [attemptKeyDigest]);
  }

  private async createSession(owner: Record<string, unknown>, remoteAddress: string | null, userAgent: string | null, mfaVerified: boolean): Promise<LoginResult> {
    const sessionToken = randomToken(48);
    const csrfToken = randomToken(32);
    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
    await this.pool.query(`INSERT INTO kcml.owner_session(id,owner_identity_id,lookup_digest,session_hash,csrf_digest,session_epoch,mfa_verified,ip_address,user_agent,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [sessionId, owner.id, tokenDigest(sessionToken), sessionHash(sessionToken), tokenDigest(csrfToken), owner.session_epoch, mfaVerified, remoteAddress, userAgent, expiresAt]);
    return { state: owner.mfa_enabled ? 'MFA_REQUIRED' : 'MFA_ENROLLMENT_REQUIRED', sessionToken, csrfToken, sessionId, expiresAt: expiresAt.toISOString() };
  }

  public async createApiKeySession(remoteAddress: string | null, userAgent: string | null): Promise<LoginResult> {
    const result = await this.pool.query(`SELECT * FROM kcml.owner_identity WHERE singleton_key=1`);
    const owner = result.rows[0];
    if (!owner) throw new DomainError('AGENTIC_OWNER_INTENT_MISSING', 'OWNER identity is not initialized', 503);
    return this.createSession(owner, remoteAddress, userAgent, true);
  }

  public async authenticate(sessionToken: string, requireMfa = true): Promise<SessionPrincipal> {
    const lookupDigest = tokenDigest(sessionToken);
    const result = await this.pool.query(`SELECT s.*,o.username,o.session_epoch AS current_session_epoch FROM kcml.owner_session s JOIN kcml.owner_identity o ON o.id=s.owner_identity_id
      WHERE s.lookup_digest=$1 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()`, [lookupDigest]);
    const row = result.rows[0];
    if (!row || !equalDigest(row.session_hash as Buffer | undefined, sessionHash(sessionToken)) || BigInt(row.session_epoch) !== BigInt(row.current_session_epoch)) throw new DomainError('AGENTIC_OPERATION_CONTEXT_INVALID', 'Session is invalid or expired', 401);
    if (requireMfa && !row.mfa_verified) throw new DomainError('AGENTIC_OWNER_INTENT_MISSING', 'MFA verification is required', 401);
    return { ownerId: row.owner_identity_id, username: 'KRMAR78', sessionId: row.id, csrfTokenDigest: row.csrf_digest, mfaVerified: row.mfa_verified, sessionEpoch: BigInt(row.session_epoch), expiresAt: new Date(row.expires_at) };
  }

  public verifyCsrf(principal: SessionPrincipal, token: string): void {
    const actual = tokenDigest(token);
    if (!equalDigest(principal.csrfTokenDigest, actual)) throw new DomainError('AGENTIC_OPERATION_CONTEXT_INVALID', 'CSRF token is invalid', 403);
  }

  public async beginMfaEnrollment(sessionToken: string): Promise<{ secret: string; otpauthUri: string; expiresAt: string }> {
    const principal = await this.authenticate(sessionToken, false);
    const secret = base32Encode(randomBytes(20));
    const enrollmentToken = randomToken(32);
    const envelope = this.cipher.encrypt(secret, `owner-mfa-enrollment:${principal.ownerId}`);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await inTransaction(this.pool, 'SERIALIZABLE', async (client) => {
      await client.query(`DELETE FROM kcml.owner_mfa_enrollment WHERE owner_identity_id=$1 AND verified_at IS NULL`, [principal.ownerId]);
      await client.query(`INSERT INTO kcml.owner_mfa_enrollment(owner_identity_id,enrollment_token_digest,seed_ciphertext,seed_nonce,seed_auth_tag,expires_at)
        VALUES($1,$2,$3,$4,$5,$6)`, [principal.ownerId, tokenDigest(enrollmentToken), envelope.ciphertext, envelope.nonce, envelope.authTag, expiresAt]);
    });
    return { secret, otpauthUri: `otpauth://totp/KajovoCML%20NG:KRMAR78?secret=${secret}&issuer=KajovoCML%20NG&algorithm=SHA1&digits=6&period=30`, expiresAt: expiresAt.toISOString() };
  }

  public async completeMfa(sessionToken: string, code: string): Promise<{ recoveryCodes: string[] }> {
    const principal = await this.authenticate(sessionToken, false);
    return inTransaction(this.pool, 'SERIALIZABLE', async (client) => {
      const enrollmentResult = await client.query(`SELECT * FROM kcml.owner_mfa_enrollment WHERE owner_identity_id=$1 AND verified_at IS NULL AND expires_at>clock_timestamp() ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [principal.ownerId]);
      const enrollment = enrollmentResult.rows[0];
      if (!enrollment) throw new DomainError('AGENTIC_OPERATION_CONTEXT_INVALID', 'Start MFA enrollment first', 409);
      const secret = this.cipher.decrypt({ authTag: enrollment.seed_auth_tag, ciphertext: enrollment.seed_ciphertext, nonce: enrollment.seed_nonce }, `owner-mfa-enrollment:${principal.ownerId}`);
      if (!verifyTotp(secret, code)) throw new DomainError('AGENTIC_OPERATION_CONTEXT_INVALID', 'Verification code is invalid', 422);
      const activeEnvelope = this.cipher.encrypt(secret, `owner-mfa:${principal.ownerId}`);
      const recoveryCodes = Array.from({ length: 10 }, () => `${randomToken(6).toUpperCase()}-${randomToken(6).toUpperCase()}`);
      await client.query(`DELETE FROM kcml.owner_recovery_code WHERE owner_identity_id=$1`, [principal.ownerId]);
      for (const recovery of recoveryCodes) await client.query(`INSERT INTO kcml.owner_recovery_code(owner_identity_id,code_hash)VALUES($1,$2)`, [principal.ownerId, tokenDigest(recovery)]);
      await client.query(`UPDATE kcml.owner_mfa_enrollment SET verified_at=clock_timestamp() WHERE id=$1`, [enrollment.id]);
      await client.query(`UPDATE kcml.owner_identity SET mfa_enabled=true,mfa_secret_ciphertext=$1,mfa_secret_nonce=$2,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$3`, [Buffer.concat([activeEnvelope.authTag, activeEnvelope.ciphertext]), activeEnvelope.nonce, principal.ownerId]);
      await client.query(`UPDATE kcml.owner_session SET mfa_verified=true,reauthenticated_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1`, [principal.sessionId]);
      return { recoveryCodes };
    });
  }

  public async verifyMfa(sessionToken: string, code: string): Promise<void> {
    const principal = await this.authenticate(sessionToken, false);
    await inTransaction(this.pool, 'SERIALIZABLE', async (client) => {
      const result = await client.query(`SELECT * FROM kcml.owner_identity WHERE id=$1 FOR SHARE`, [principal.ownerId]);
      const owner = result.rows[0];
      let accepted = false;
      if (/^\d{6}$/u.test(code) && owner.mfa_enabled && owner.mfa_secret_ciphertext && owner.mfa_secret_nonce) {
        const stored = Buffer.from(owner.mfa_secret_ciphertext);
        const secret = this.cipher.decrypt({ authTag: stored.subarray(0, 16), ciphertext: stored.subarray(16), nonce: owner.mfa_secret_nonce }, `owner-mfa:${principal.ownerId}`);
        accepted = verifyTotp(secret, code);
      }
      if (!accepted) {
        const recovery = await client.query(`UPDATE kcml.owner_recovery_code SET consumed_at=clock_timestamp() WHERE owner_identity_id=$1 AND code_hash=$2 AND consumed_at IS NULL RETURNING id`, [principal.ownerId, tokenDigest(code)]);
        accepted = recovery.rowCount === 1;
      }
      if (!accepted) throw new DomainError('AGENTIC_OPERATION_CONTEXT_INVALID', 'Verification code is invalid', 422);
      await client.query(`UPDATE kcml.owner_session SET mfa_verified=true,reauthenticated_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1`, [principal.sessionId]);
      await client.query(`UPDATE kcml.owner_identity SET last_login_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`, [principal.ownerId]);
    });
  }

  public async reauthenticate(sessionToken: string, password: string, mfaCode?: string): Promise<void> {
    const principal = await this.authenticate(sessionToken, false);
    const ownerResult = await this.pool.query(`SELECT * FROM kcml.owner_identity WHERE id=$1`, [principal.ownerId]);
    const owner = ownerResult.rows[0];
    if (!owner?.password_hash || !(await argon2.verify(owner.password_hash, password).catch(() => false))) throw new DomainError('AGENTIC_OPERATION_CONTEXT_INVALID', 'Invalid credentials', 401);
    if (owner.mfa_enabled) {
      if (!mfaCode) throw new DomainError('AGENTIC_OWNER_INTENT_MISSING', 'MFA verification is required', 401);
      await this.verifyMfa(sessionToken, mfaCode);
    }
    await this.pool.query(`UPDATE kcml.owner_session SET reauthenticated_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1`, [principal.sessionId]);
  }

  public async logout(principal: SessionPrincipal): Promise<void> {
    await this.pool.query(`UPDATE kcml.owner_session SET revoked_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1 AND revoked_at IS NULL`, [principal.sessionId]);
  }

  public async listSessions(ownerId: string): Promise<unknown[]> {
    const result = await this.pool.query(`SELECT id,ip_address,user_agent,created_at,last_seen_at,reauthenticated_at,expires_at,mfa_verified,trusted_device_id FROM kcml.owner_session WHERE owner_identity_id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp() ORDER BY last_seen_at DESC`, [ownerId]);
    return result.rows;
  }

  public async revokeSession(ownerId: string, sessionId: string): Promise<void> {
    const result = await this.pool.query(`UPDATE kcml.owner_session SET revoked_at=clock_timestamp(),state_version=state_version+1 WHERE owner_identity_id=$1 AND id=$2 AND revoked_at IS NULL`, [ownerId, sessionId]);
    if (result.rowCount !== 1) throw new DomainError('AGENTIC_OWNER_INTENT_MISSING', 'Session does not exist', 404);
  }

  public async revokeOtherSessions(ownerId: string, currentSessionId: string): Promise<number> {
    const result = await this.pool.query(`UPDATE kcml.owner_session SET revoked_at=clock_timestamp(),state_version=state_version+1 WHERE owner_identity_id=$1 AND id<>$2 AND revoked_at IS NULL`, [ownerId, currentSessionId]);
    return result.rowCount ?? 0;
  }

  public async revokeAllSessions(ownerId: string): Promise<number> {
    const result = await this.pool.query(`UPDATE kcml.owner_session SET revoked_at=clock_timestamp(),state_version=state_version+1 WHERE owner_identity_id=$1 AND revoked_at IS NULL`, [ownerId]);
    return result.rowCount ?? 0;
  }


  public async rotateRecoveryCodes(sessionToken: string): Promise<{ recoveryCodes: string[] }> {
    const principal = await this.authenticate(sessionToken, true);
    const recoveryCodes = Array.from({ length: 10 }, () => `${randomToken(6).toUpperCase()}-${randomToken(6).toUpperCase()}`);
    await inTransaction(this.pool, 'SERIALIZABLE', async (client) => {
      await client.query(`DELETE FROM kcml.owner_recovery_code WHERE owner_identity_id=$1`, [principal.ownerId]);
      for (const recovery of recoveryCodes) await client.query(`INSERT INTO kcml.owner_recovery_code(owner_identity_id,code_hash) VALUES($1,$2)`, [principal.ownerId, tokenDigest(recovery)]);
      const correlationId = randomUUID();
      const payload = { rotated: recoveryCodes.length, ownerId: principal.ownerId };
      await client.query(`SELECT * FROM kcml.append_audit_event('owner.recovery_codes.rotated','OWNER',$1,'OWNER',$2,$3,NULL,$4,$5)`, [principal.ownerId, principal.ownerId, correlationId, payload, Buffer.from(canonicalJson(payload as CanonicalJsonValue))]);
    });
    return { recoveryCodes };
  }
}
