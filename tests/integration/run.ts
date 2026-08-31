import { createDatabasePool, loadBaseline } from '@kcml/database';
import { EnvelopeCipher, OwnerAuthenticationService, SecretManager } from '@kcml/domain';

if (!process.env.DATABASE_URL) {
  console.log('NOT_EXECUTED_ENVIRONMENTAL: domain integration requires DATABASE_URL');
  process.exit(0);
}

const pool = createDatabasePool({ applicationName: 'domain-integration' });
try {
  await pool.query(await loadBaseline());
  const cipher = new EnvelopeCipher(Buffer.alloc(32, 9), 'integration');
  const auth = new OwnerAuthenticationService(pool, cipher);
  const password = `integration-${Date.now()}-secure`;
  await auth.synchronizeDeploymentPassword(password);
  const login = await auth.login('KRMAR78', password, '127.0.0.1', 'integration', crypto.randomUUID());
  if (!login.sessionToken || login.state === 'AUTHENTICATED') throw new Error('OWNER_MFA_ENROLLMENT_NOT_ENFORCED');
  const secrets = new SecretManager(pool, cipher);
  const owner = await pool.query(`SELECT id FROM kcml.owner_identity WHERE singleton_key=1`);
  const created = await secrets.create({ stableName: `INTEGRATION_SECRET_${Date.now()}`, displayName: 'Integration secret', kind: 'API_KEY', value: 'integration-secret', metadata: {} }, owner.rows[0].id);
  const value = await secrets.reveal(created.id, owner.rows[0].id);
  if (value.value !== 'integration-secret') throw new Error('SECRET_ROUNDTRIP_FAILED');
  console.log('DOMAIN_INTEGRATION: PASS');
} finally { await pool.end(); }
