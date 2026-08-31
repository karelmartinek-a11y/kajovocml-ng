import type { DatabaseClient } from '@kcml/database';
import { DomainError } from './errors.js';

export interface RecoveryAuthorityHead extends Record<string, unknown> {
  platform_incarnation_id: string;
  current_epoch: string | number | bigint;
  recovery_epoch: string | number | bigint;
}

export async function lockAndVerifyPlatformRecovery(client: DatabaseClient): Promise<RecoveryAuthorityHead> {
  await client.query(`SELECT pg_advisory_xact_lock_shared(hashtextextended('PLATFORM_RECOVERY_BARRIER',0))`);
  const row = (await client.query(`SELECT recovery.database_start_identity,recovery.platform_incarnation_id,
      recovery.application_deployment_epoch,recovery.recovery_epoch,recovery.state,
      platform.platform_incarnation_id AS current_platform_incarnation_id,
      deployment.current_epoch,kcml.current_database_start_identity() AS current_database_start_identity
    FROM kcml.platform_recovery_head recovery
    CROSS JOIN kcml.platform_incarnation platform
    CROSS JOIN kcml.application_deployment_head deployment
    WHERE recovery.singleton_key=1 AND platform.singleton_key=1 AND deployment.singleton_key=1
    FOR SHARE OF recovery,platform,deployment`)).rows[0];
  if (!row) throw new DomainError('PLATFORM_RECOVERY_HEAD_MISSING', 'Platform recovery authority head is missing', 503, 'RETRY_SAME_OPERATION');
  const identityCurrent = Buffer.from(row.database_start_identity).equals(Buffer.from(row.current_database_start_identity));
  const lineageCurrent = String(row.platform_incarnation_id) === String(row.current_platform_incarnation_id)
    && BigInt(row.application_deployment_epoch) === BigInt(row.current_epoch);
  if (row.state !== 'READY' || !identityCurrent || !lineageCurrent) {
    throw new DomainError('PLATFORM_RECOVERY_NOT_READY', 'Authoritative write is fail-closed until current database recovery and inventory reconciliation reach READY', 503, 'RETRY_SAME_OPERATION', {
      state: row.state,
      databaseStartIdentityCurrent: identityCurrent,
      authorityLineageCurrent: lineageCurrent,
      recoveryEpoch: String(row.recovery_epoch)
    });
  }
  return {
    platform_incarnation_id: String(row.platform_incarnation_id),
    current_epoch: row.current_epoch,
    recovery_epoch: row.recovery_epoch
  };
}
