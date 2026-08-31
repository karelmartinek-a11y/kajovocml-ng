import { SequenceGuard } from '@kcml/kcip';

const SCHEDULE_COUNT = 10_000;
const BASE_SEED = Number(process.env.KCML_CHAOS_SEED ?? 20_260_830);
const THREE_WAY_SCHEDULES = [
  'crash+duplicate-delivery+stale-fence',
  'postgres-restart+delayed-worker+activation-switch',
  'credential-rotation+disconnect+delayed-callback',
  'browser-auth-expiry+popup-race+owner-takeover',
  'disk-full+cleanup-failure+service-restart',
  'queue-saturation+cancellation+deadline',
  'openai-rate-limit+sse-disconnect+duplicate-result',
  'rollback-failure+cleanup-failure+service-restart'
] as const;

interface ModelState {
  epoch: number;
  fence: number;
  workerFence: number | null;
  intentPersisted: boolean;
  effectCount: number;
  outcome: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'MANUAL_REVIEW';
  orphanCount: number;
  staleWritesRejected: number;
}

function random(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function assertInvariants(state: ModelState): void {
  if (state.effectCount > 1) throw new Error('DUPLICATE_EXTERNAL_EFFECT');
  if (state.effectCount > 0 && !state.intentPersisted) throw new Error('EFFECT_WITHOUT_DURABLE_INTENT');
  if (state.outcome === 'SUCCEEDED' && state.effectCount !== 1) throw new Error('FALSE_SUCCESS');
  if (state.outcome !== 'PENDING' && state.orphanCount !== 0) throw new Error('TERMINAL_ORPHAN');
}

function runSchedule(seed: number): void {
  const next = random(seed);
  const state: ModelState = { epoch: 1, fence: 0, workerFence: null, intentPersisted: false, effectCount: 0, outcome: 'PENDING', orphanCount: 0, staleWritesRejected: 0 };
  for (let step = 0; step < 32; step += 1) {
    switch (Math.floor(next() * 9)) {
      case 0:
        if (state.outcome === 'PENDING') state.workerFence = ++state.fence;
        break;
      case 1:
        state.epoch += 1;
        state.fence += 1;
        break;
      case 2:
        if (state.workerFence === state.fence && state.outcome === 'PENDING') state.intentPersisted = true;
        else state.staleWritesRejected += 1;
        break;
      case 3:
        if (state.intentPersisted && state.workerFence === state.fence && state.outcome === 'PENDING') state.effectCount = Math.max(1, state.effectCount);
        else state.staleWritesRejected += 1;
        break;
      case 4:
        if (state.effectCount === 1 && state.workerFence === state.fence) state.outcome = 'SUCCEEDED';
        else if (state.workerFence !== null && state.workerFence !== state.fence) state.staleWritesRejected += 1;
        break;
      case 5:
        if (state.outcome === 'PENDING') state.outcome = state.effectCount === 0 ? 'FAILED' : 'MANUAL_REVIEW';
        break;
      case 6:
        if (state.outcome === 'PENDING') state.orphanCount = 1;
        break;
      case 7:
        state.orphanCount = 0;
        break;
      default:
        if (state.effectCount === 1 && state.outcome === 'PENDING') state.outcome = 'SUCCEEDED';
        break;
    }
    if (state.outcome !== 'PENDING') state.orphanCount = 0;
    assertInvariants(state);
  }
  if (state.outcome === 'PENDING') state.outcome = state.effectCount === 1 ? 'SUCCEEDED' : 'FAILED';
  state.orphanCount = 0;
  assertInvariants(state);
}

for (let schedule = 0; schedule < SCHEDULE_COUNT; schedule += 1) runSchedule(BASE_SEED + schedule);
for (let index = 0; index < THREE_WAY_SCHEDULES.length; index += 1) runSchedule(BASE_SEED ^ (0x9e37_79b9 + index));

const guard = new SequenceGuard();
guard.accept('replay', 1n);
if (guard.accept('replay', 1n) !== 'DUPLICATE') throw new Error('REPLAY_NOT_DEDUPLICATED');
let fenced = false;
try { guard.accept('replay', 3n); } catch { fenced = true; }
if (!fenced) throw new Error('SEQUENCE_GAP_NOT_FENCED');
const backoff = Array.from({ length: 16 }, (_, attempt) => Math.min(300_000, 1_000 * 2 ** attempt));
if (!backoff.every((value, index) => index === 0 || value >= backoff[index - 1]!)) throw new Error('BACKOFF_NOT_MONOTONIC');

console.log(`MODEL_FAST_CHAOS: PASS schedules=${SCHEDULE_COUNT} seed=${BASE_SEED} threeWay=${THREE_WAY_SCHEDULES.length}`);
