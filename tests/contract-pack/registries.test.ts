import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Contract Pack', () => {
  it('is closed and every requirement carries evidence bindings', async () => {
    const manifest = JSON.parse(await readFile('contracts/registries/manifest.json', 'utf8'));
    const requirements = JSON.parse(await readFile('contracts/registries/requirements/requirements.json', 'utf8'));
    const operations = JSON.parse(await readFile('contracts/registries/operations/operations.json', 'utf8'));
    expect(manifest.schemaVersion).toBe('1.0');
    expect(manifest.packDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(requirements.records.length).toBeGreaterThan(10_000);
    expect(operations.records.length).toBeGreaterThan(250);
    for (const item of requirements.records) expect(item).toMatchObject({ requirementId: expect.any(String), authoritySourceRefs: expect.any(Array), artifactIds: expect.any(Array), testCaseIds: expect.any(Array), acceptanceGateIds: expect.any(Array) });
  });
});
