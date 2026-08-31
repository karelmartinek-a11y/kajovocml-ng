import fc from 'fast-check';
import { canonicalJson } from '@kcml/schemas';
import { SequenceGuard } from '@kcml/kcip';

const seed = Number(process.env.KCML_PROPERTY_SEED ?? 20_260_830);
const parameters = { numRuns: 10_000, seed } as const;

fc.assert(fc.property(fc.dictionary(fc.string(), fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null))), (value) => canonicalJson(value) === canonicalJson(Object.fromEntries(Object.entries(value).reverse()))), parameters);
fc.assert(fc.property(fc.integer({ min: 1, max: 500 }), (length) => { const guard = new SequenceGuard(); for (let value = 1; value <= length; value += 1) if (guard.accept('stream', BigInt(value)) !== 'ACCEPTED') return false; return guard.accept('stream', BigInt(length)) === 'DUPLICATE'; }), parameters);
console.log(`MODEL_FAST_PROPERTY: PASS runs=${parameters.numRuns} seed=${seed}`);
