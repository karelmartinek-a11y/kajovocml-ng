import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('PostgreSQL physical schema projection', () => {
  it('has an explicit schema for every compiled SSOT entity', async () => {
    const entities = JSON.parse(await readFile('contracts/ssot-surface/entities.json', 'utf8')) as { records: Array<{ name: string }> };
    const contracts = JSON.parse(await readFile('contracts/ssot-surface/postgres-schema-contracts.json', 'utf8')) as {
      records: Array<{ tableName: string; columns: Array<{ name: string }>; canonicalDigest: string }>;
    };
    expect(contracts.records).toHaveLength(entities.records.length);
    expect(new Set(contracts.records.map((record) => record.tableName)).size).toBe(entities.records.length);
    expect(contracts.records.every((record) => record.columns.length > 0)).toBe(true);
    expect(contracts.records.every((record) => /^sha256:[0-9a-f]{64}$/u.test(record.canonicalDigest))).toBe(true);
  });

  it('does not emit the universal document storage fallback', async () => {
    const baseline = await readFile('database/baseline/00000000000001_ssot_surface.sql', 'utf8');
    expect(baseline).not.toMatch(/\bdocument\s+jsonb\s+NOT\s+NULL\s+DEFAULT\s+'\{\}'::jsonb/iu);
  });
});
