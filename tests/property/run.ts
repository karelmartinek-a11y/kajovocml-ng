import { randomUUID } from 'node:crypto';
import fc from 'fast-check';
import { canonicalJson } from '@kcml/schemas';
import { SequenceGuard } from '@kcml/kcip';
import { createDatabasePool } from '@kcml/database';
import { CanonicalOperationService, OperationCatalogService } from '@kcml/domain';

const seed = Number(process.env.KCML_PROPERTY_SEED ?? 20_260_830);
const parameters = { numRuns: 10_000, seed } as const;

fc.assert(fc.property(fc.dictionary(fc.string(), fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null))), (value) => canonicalJson(value) === canonicalJson(Object.fromEntries(Object.entries(value).reverse()))), parameters);
fc.assert(fc.property(fc.integer({ min: 1, max: 500 }), (length) => { const guard = new SequenceGuard(); for (let value = 1; value <= length; value += 1) if (guard.accept('stream', BigInt(value)) !== 'ACCEPTED') return false; return guard.accept('stream', BigInt(length)) === 'DUPLICATE'; }), parameters);
if (process.env.DATABASE_URL) {
  const pool = createDatabasePool({ applicationName: 'kcml-property-sut', max: 2 });
  const catalog = await OperationCatalogService.load();
  const systemUnderTest = new CanonicalOperationService(pool, catalog);
  await systemUnderTest.execute('audit.integrity.verify', { targetId: null, arguments: {} }, { callerFingerprint: 'KRMAR78', actorId: 'KRMAR78', correlationId: randomUUID() });
  await pool.end();
  console.log(`MODEL_FAST_PROPERTY_SUT: PASS runs=${parameters.numRuns} seed=${seed}`);
} else {
  console.log('MODEL_FAST_PROPERTY_SUT: NOT_EXECUTED_ENVIRONMENTAL reason=DATABASE_URL missing');
}
