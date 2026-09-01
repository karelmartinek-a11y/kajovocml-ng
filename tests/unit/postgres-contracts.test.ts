import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ADVISORY_NAMESPACE_IDS, LockOrderGuard, TRANSACTION_PROFILES, advisoryKey } from '../../packages/database/src/index.js';

describe('POSTGRES_CONTRACT_MATRIX physical transaction primitives', () => {
  it('uses the SSOT namespace ids and SHA-256 big-endian signed key', () => {
    const identity = 'contract-test-identity';
    const digest = createHash('sha256').update(`IDEMPOTENCY_SCOPE\u0000${identity}`, 'utf8').digest();
    expect(advisoryKey('IDEMPOTENCY_SCOPE', identity)).toEqual([
      ADVISORY_NAMESPACE_IDS.IDEMPOTENCY_SCOPE,
      digest.readInt32BE(0)
    ]);
    expect(advisoryKey('IDEMPOTENCY_SCOPE', identity)).not.toEqual([0, 0]);
  });

  it('rejects unknown advisory namespaces instead of silently hashing them', () => {
    expect(() => advisoryKey('UNDECLARED_NAMESPACE', 'x')).toThrow('ADVISORY_NAMESPACE_INVALID');
  });

  it('declares the exact SSOT 51.2 profile timeouts and read-only modes', () => {
    expect(TRANSACTION_PROFILES).toMatchObject({
      ONLINE_MUTATION: { isolation: 'READ COMMITTED', readOnly: false, lockTimeout: '1500ms', statementTimeout: '10s', idleInTransactionSessionTimeout: '10s' },
      WORKER_COMMIT: { isolation: 'READ COMMITTED', readOnly: false, lockTimeout: '3000ms', statementTimeout: '15s', idleInTransactionSessionTimeout: '15s' },
      ACTIVATION_SWITCH: { isolation: 'READ COMMITTED', readOnly: false, lockTimeout: '5000ms', statementTimeout: '30s', idleInTransactionSessionTimeout: '30s' },
      CONSISTENT_READ: { isolation: 'REPEATABLE READ', readOnly: true, deferrable: false },
      CLOSURE_SNAPSHOT: { isolation: 'SERIALIZABLE', readOnly: true, deferrable: true },
      SERIALIZABLE_PREDICATE: { isolation: 'SERIALIZABLE', readOnly: false }
    });
  });

  it('rejects a lower lock class after a higher class and preserves same-class key order', () => {
    const guard = new LockOrderGuard();
    guard.acquire('PLATFORM', 'singleton');
    guard.acquire('AGGREGATE', 'component:00000000-0000-0000-0000-000000000001');
    expect(() => guard.acquire('IDEMPOTENCY', 'scope')).toThrow('LOCK_ORDER_VIOLATION');

    const ordered = new LockOrderGuard();
    ordered.acquire('AGGREGATE', 'a');
    expect(() => ordered.acquire('AGGREGATE', '0')).toThrow('LOCK_ORDER_VIOLATION');
  });
});
