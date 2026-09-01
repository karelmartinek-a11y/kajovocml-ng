import fc from 'fast-check';
import { canonicalJson } from '@kcml/schemas';
import { SequenceGuard } from '@kcml/kcip';
import { modelFastEvidence, runPostgresRealTrace } from './sut-harness.js';

const seed = Number(process.env.KCML_PROPERTY_SEED ?? 20_260_830);
const parameters = { numRuns: 10_000, seed } as const;

fc.assert(fc.property(fc.dictionary(fc.string(), fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null))), (value) => canonicalJson(value) === canonicalJson(Object.fromEntries(Object.entries(value).reverse()))), parameters);
fc.assert(fc.property(fc.integer({ min: 1, max: 500 }), (length) => { const guard = new SequenceGuard(); for (let value = 1; value <= length; value += 1) if (guard.accept('stream', BigInt(value)) !== 'ACCEPTED') return false; return guard.accept('stream', BigInt(length)) === 'DUPLICATE'; }), parameters);
const modelEvidence = modelFastEvidence(seed, parameters.numRuns);
const canonicalOperationServiceLoader = async () => (await import('@kcml/domain')).CanonicalOperationService;
const sutEvidence = await runPostgresRealTrace(seed, true, canonicalOperationServiceLoader);
console.log(JSON.stringify({ suite: 'property', status: sutEvidence.status, blocking: sutEvidence.blocking, model: modelEvidence, sut: sutEvidence }));
if (sutEvidence.status === 'FAIL') process.exitCode = 1;
