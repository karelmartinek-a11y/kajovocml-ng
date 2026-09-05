import { createHash } from 'node:crypto';
import type { DatabaseClient, DatabasePool } from '@kcml/database';
import { inSerializableReadOnlyDeferrable } from '@kcml/database';
import { DomainError } from './errors.js';

export interface AuditIntegrityResult {
  valid: true;
  eventCount: number;
  lastSequence: string;
  lastHash: string;
}

/**
 * Verify the authoritative audit chain in bounded pages inside one database
 * snapshot. No page is trusted independently: predecessor hash and sequence are
 * carried across page boundaries and the final value is compared with audit_head.
 */
export async function verifyAuditChainClient(client: DatabaseClient, pageSize = 1000): Promise<AuditIntegrityResult> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 10_000) throw new Error('AUDIT_PAGE_SIZE_INVALID');
  const head = (await client.query(`SELECT last_sequence,last_hash FROM kcml.audit_head WHERE singleton_key=1`)).rows[0];
  if (!head) throw new DomainError('CLOSURE_PREDICATE_INCOMPLETE', 'Audit head is missing', 503, 'DO_NOT_RETRY');

  let previous = Buffer.alloc(32);
  let expectedSequence = 1n;
  let eventCount = 0;

  for (;;) {
    const page = await client.query(`SELECT chain_sequence,event_type,payload_canonical_bytes,payload_digest,previous_hash,event_hash
      FROM kcml.audit_event
      WHERE chain_sequence >= $1
      ORDER BY chain_sequence
      LIMIT $2`, [expectedSequence.toString(), pageSize]);
    if (page.rows.length === 0) break;

    for (const event of page.rows) {
      const sequence = BigInt(event.chain_sequence);
      if (sequence !== expectedSequence) throw new DomainError('SEQUENCE_GAP', `Expected audit sequence ${expectedSequence} but found ${sequence}`, 409, 'DO_NOT_RETRY');
      const storedPrevious = Buffer.from(event.previous_hash);
      if (!storedPrevious.equals(previous)) throw new DomainError('CHECKPOINT_DIGEST_INVALID', `Audit chain predecessor mismatch at ${sequence}`, 409, 'DO_NOT_RETRY');

      const payloadDigest = createHash('sha256').update(Buffer.from(event.payload_canonical_bytes)).digest();
      if (!payloadDigest.equals(Buffer.from(event.payload_digest))) throw new DomainError('CHECKPOINT_DIGEST_INVALID', `Audit payload digest mismatch at ${sequence}`, 409, 'DO_NOT_RETRY');

      const sequenceBytes = Buffer.alloc(8);
      sequenceBytes.writeBigInt64BE(sequence);
      const calculated = createHash('sha256').update(Buffer.concat([previous, sequenceBytes, Buffer.from(String(event.event_type), 'utf8'), payloadDigest])).digest();
      if (!calculated.equals(Buffer.from(event.event_hash))) throw new DomainError('CHECKPOINT_DIGEST_INVALID', `Audit event hash mismatch at ${sequence}`, 409, 'DO_NOT_RETRY');

      previous = calculated;
      expectedSequence += 1n;
      eventCount += 1;
    }

    if (page.rows.length < pageSize) break;
  }

  const lastSequence = expectedSequence - 1n;
  if (BigInt(head.last_sequence) !== lastSequence || !Buffer.from(head.last_hash).equals(previous)) {
    throw new DomainError('CLOSURE_PREDICATE_INCOMPLETE', 'Audit head does not match the terminal chain event in the same snapshot', 409, 'DO_NOT_RETRY');
  }
  return { valid: true, eventCount, lastSequence: lastSequence.toString(), lastHash: previous.toString('hex') };
}

export async function verifyAuditChainSnapshot(pool: DatabasePool, pageSize = 1000): Promise<AuditIntegrityResult> {
  return inSerializableReadOnlyDeferrable(pool, (client) => verifyAuditChainClient(client, pageSize));
}
