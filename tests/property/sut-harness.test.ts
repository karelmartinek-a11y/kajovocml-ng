import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { EVIDENCE_MODES, MODEL_REGISTRY, modelFastEvidence, runPostgresRealTrace } from './sut-harness.js';

describe('TD-13 stateful evidence harness', () => {
  it('keeps MODEL_FAST explicitly non-blocking and separate from SUT evidence', () => {
    const report = modelFastEvidence(42, 3);
    expect(report).toMatchObject({ mode: 'MODEL_FAST', status: 'PASS', blocking: false, executedSteps: 3, comparisonCount: 0 });
    expect(EVIDENCE_MODES).toContain('POSTGRES_REAL');
    expect(MODEL_REGISTRY.aggregates).toHaveLength(1);
    expect(MODEL_REGISTRY.aggregates[0]?.oracle).toContain('execution checkpoint');
  });

  it('classifies missing SUT environment without claiming a model-only PASS', async () => {
    const report = await runPostgresRealTrace(43);
    if (report.status === 'PASS') {
      expect(report).toMatchObject({ mode: 'POSTGRES_REAL', status: 'PASS', blocking: true, executedSteps: 3, comparisonCount: 3 });
    } else {
      expect(report).toMatchObject({ mode: 'POSTGRES_REAL', status: 'NOT_EXECUTED_ENVIRONMENTAL', blocking: true, executedSteps: 0, comparisonCount: 0 });
      expect(report.status).toBe('NOT_EXECUTED_ENVIRONMENTAL');
    }
  });

  it('binds both executable suites to the CanonicalOperationService SUT', async () => {
    const [propertyRunner, chaosRunner] = await Promise.all([
      readFile(new URL('./run.ts', import.meta.url), 'utf8'),
      readFile(new URL('../chaos/run.ts', import.meta.url), 'utf8')
    ]);
    for (const runner of [propertyRunner, chaosRunner]) {
      expect(runner).toContain('CanonicalOperationService');
      expect(runner).toContain('runPostgresRealTrace');
      expect(runner).toContain("import('@kcml/domain')");
      expect(runner).toContain('canonicalOperationServiceLoader');
    }
  });
});
