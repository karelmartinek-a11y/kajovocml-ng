import { describe, expect, it } from 'vitest';
import {
  FaultCoverageTracker,
  installFaultHarnessCapability,
  invokeFaultHook,
  mandatoryThreeWayScheduleIds,
} from '@kcml/testing';
import { faultPointById, faultPointDeclarations } from '../../packages/domain/src/fault-declarations.js';
import type { FaultPointDeclaration } from '@kcml/schemas';

describe('TD-09 explicit fault catalog and deny-by-default hooks', () => {
  it('declares paired before/after cutpoints with unique canonical names', () => {
    expect(faultPointDeclarations.length).toBeGreaterThanOrEqual(12);
    expect(new Set(faultPointDeclarations.map((point) => point.faultPointId)).size).toBe(faultPointDeclarations.length);
    expect(new Set(faultPointDeclarations.map((point) => point.faultPointName)).size).toBe(faultPointDeclarations.length);
    const phases = new Map(faultPointDeclarations.map((point) => [`${point.operationName}:${point.phase}`, new Set<string>()]));
    for (const point of faultPointDeclarations) phases.get(`${point.operationName}:${point.phase}`)!.add(point.side);
    for (const sides of phases.values()) expect([...sides].sort()).toEqual(['after', 'before']);
    for (const point of faultPointDeclarations) expect(point.sourceLocation.repositoryPath).toMatch(/\.ts$/u);
  });

  it('keeps production hooks inert and rejects fabricated declaration objects', async () => {
    const point = faultPointDeclarations[0]!;
    let injected = 0;
    await invokeFaultHook(point);
    expect(injected).toBe(0);
    const dispose = installFaultHarnessCapability({
      capabilityId: 'KCML_DISPOSABLE_FAULT_HARNESS_V1', namespace: 'TEST', catalogDigest: 'sha256:test',
      allowedFaultPointIds: [point.faultPointId], inject: async () => { injected += 1; },
    }, faultPointDeclarations);
    await invokeFaultHook(point);
    await invokeFaultHook({ ...point } as FaultPointDeclaration);
    expect(injected).toBe(1);
    dispose();
  });

  it('builds an exact single-fault coverage matrix instead of counting files', () => {
    const coverage = new FaultCoverageTracker(faultPointDeclarations);
    const obligations = coverage.singleFaultSchedules();
    expect(obligations.length).toBeGreaterThan(faultPointDeclarations.length);
    expect(coverage.report().status).toBe('FAIL');
    for (const schedule of obligations) coverage.record(schedule.faultPointId, schedule.faultKind);
    const report = coverage.report(3, 8);
    expect(report.singleFaultCovered).toBe(report.singleFaultObligations);
    expect(report.uncoveredPointIds).toEqual([]);
    expect(report.status).toBe('PASS');
    expect(faultPointById(obligations[0]!.faultPointId)).toBe(faultPointDeclarations.find((point) => point.faultPointId === obligations[0]!.faultPointId));
    expect(mandatoryThreeWayScheduleIds).toHaveLength(8);
  });
});
