import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  canonicalErrorView,
  getErrorRetryRegistry,
  resolveRetryDirective,
  validateErrorRetryRegistry,
  type StableErrorRecord
} from '@kcml/schemas';
import { canonicalizeDomainError, DomainError } from '../../packages/domain/src/errors.js';

describe('Error and Retry Registry', () => {
  it('contains only chapter 32 stable errors with total recovery semantics', async () => {
    const document = JSON.parse(await readFile('contracts/registries/errors/errors.json', 'utf8')) as { records: StableErrorRecord[] };
    const records = document.records.filter((record) => record.lifecycle === 'ACTIVE');
    expect(records.length).toBeGreaterThan(200);
    expect(records.some((record) => record.code === 'ACTIONABILITY_PASSED')).toBe(false);
    expect(new Set(records.map((record) => record.code)).size).toBe(records.length);
    validateErrorRetryRegistry(records);
    for (const record of records) {
      expect(record.requirementIds.length).toBeGreaterThan(0);
      expect(record.authoritySourceRefs.some((ref) => ref.startsWith('ssot://32.'))).toBe(true);
      expect(record.testCaseIds).toContain(`ERROR-${record.code}`);
      if (record.recoveryRuleKind === 'FIXED') expect(record.fixedRetryDirective).toBeTruthy();
      else expect(record.extensions.recoveryDecisionTable).toMatchObject({ total: true, mutuallyExclusive: true });
    }
  });

  it('uses one canonical meaning across DomainError, HTTP metadata, KCIP and MCP', () => {
    const known = canonicalErrorView('MCP_HEADER_MISMATCH');
    const domain = canonicalizeDomainError(new DomainError('MCP_HEADER_MISMATCH', 'localized message', 418, 'MANUAL_REVIEW'));
    expect(domain.code).toBe(known.code);
    expect(domain.classification).toBe(known.classification);
    expect(domain.retryDirective).toBe(known.retryDirective);
    expect(domain.recordDigest).toBe(known.recordDigest);
    expect(known.record.httpMappings).toEqual([400]);
    expect(known.record.kcipMappings).toEqual(['ERROR']);
    expect(known.record.mcpMappings).toEqual([-32020]);
  });

  it('rejects duplicate meanings and retry booleans in mutation tests', () => {
    const records = [...getErrorRetryRegistry().values()];
    expect(() => validateErrorRetryRegistry([...records, records[0]!])).toThrow('duplicate');
    const mutated = records.map((record) => record.code === 'OPENAI_PROVIDER_TRANSIENT' ? { ...record, retryable: false } : record);
    expect(() => validateErrorRetryRegistry(mutated)).toThrow('non_authoritative_retryable');
    const fixed = records.find((record) => record.recoveryRuleKind === 'FIXED')!;
    expect(() => validateErrorRetryRegistry(records.map((record) => record === fixed ? { ...record, fixedRetryDirective: null } : record))).toThrow();
    const table = records.find((record) => record.recoveryRuleKind === 'EVIDENCE_DECISION_TABLE')!;
    expect(() => validateErrorRetryRegistry(records.map((record) => record === table ? { ...record, extensions: { ...record.extensions, recoveryDecisionTable: { ...record.extensions.recoveryDecisionTable, total: false } } } : record))).toThrow();
  });

  it('does not allow an unknown runtime code to acquire recovery meaning', () => {
    expect(() => canonicalErrorView('RUNTIME_CODE_ADDED_WITHOUT_REGISTRY')).toThrow('unknown_code');
  });

  it('evaluates every evidence outcome through the canonical decision table', () => {
    const record = getErrorRetryRegistry().get('KCIP_OUTCOME_UNKNOWN')!;
    expect(record.recoveryRuleKind).toBe('EVIDENCE_DECISION_TABLE');
    expect(resolveRetryDirective(record, 'CONFIRMED_NOT_APPLIED')).toBe('RETRY_SAME_OPERATION');
    expect(resolveRetryDirective(record, 'CONFIRMED_APPLIED')).toBe('DO_NOT_RETRY');
    expect(resolveRetryDirective(record, 'POSSIBLE_EFFECT')).toBe('RECONCILE_THEN_RETRY');
    expect(resolveRetryDirective(record, 'UNKNOWN')).toBe('MANUAL_REVIEW');
    expect(canonicalErrorView('OPENAI_PROVIDER_TRANSIENT').retryDirective).toBe('RETRY_SAME_OPERATION');
    expect(canonicalErrorView('MCP_DEADLINE_EXCEEDED').retryDirective).toBe('RECONCILE_THEN_RETRY');
  });
});
