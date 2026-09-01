import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isSourceEvidence } from '../../packages/contract-pack/src/index.js';

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
};
const digest = (value: unknown): string => `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;

describe('Contract Pack', () => {
  it('is closed and every requirement carries evidence bindings', async () => {
    const manifest = JSON.parse(await readFile('contracts/registries/manifest.json', 'utf8'));
    const requirements = JSON.parse(await readFile('contracts/registries/requirements/requirements.json', 'utf8'));
    const operations = JSON.parse(await readFile('contracts/registries/operations/operations.json', 'utf8'));
    expect(manifest.schemaVersion).toBe('1.0');
    expect(manifest.packDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(requirements.records.length).toBeGreaterThan(10_000);
    expect(operations.records.length).toBeGreaterThan(250);
    for (const item of requirements.records) expect(item).toMatchObject({ requirementId: expect.any(String), authoritySourceRefs: expect.any(Array), artifactIds: expect.any(Array), testCaseIds: expect.any(Array), acceptanceGateIds: expect.any(Array), extensions: { 'kcml:traceability': { schemaVersion: '1.0', status: expect.stringMatching(/^(COMPLETE|INCOMPLETE)$/u), requiredRelationKinds: expect.any(Array), relations: expect.any(Object), missingRelationKinds: expect.any(Array) } } });
  });

  it('uses registry-specific schemas and verifiable source evidence', async () => {
    const manifest = JSON.parse(await readFile('contracts/registries/manifest.json', 'utf8'));
    const artifacts = JSON.parse(await readFile('contracts/registries/artifact-trace/artifact-trace.json', 'utf8'));
    const requirements = JSON.parse(await readFile('contracts/registries/requirements/requirements.json', 'utf8'));
    expect(manifest.registries.every((entry: { schemaRef: string }) => !entry.schemaRef.endsWith('/common-record.schema.json'))).toBe(true);
    const artifactById = new Map(artifacts.records.map((record: { artifactId: string }) => [record.artifactId, record]));
    for (const entry of manifest.registries) {
      const data = JSON.parse(await readFile(entry.dataRef, 'utf8'));
      for (const record of data.records) {
        expect(record.recordId).toEqual(expect.any(String));
        expect(record.recordKind).toBe(data.kind);
        expect(record.sourceRelations.length).toBeGreaterThan(0);
        for (const relation of record.sourceRelations) {
          expect(isSourceEvidence(relation)).toBe(true);
          const { relationDigest: _digest, ...relationIdentity } = relation;
          expect(relation.relationDigest).toBe(digest(relationIdentity));
        }
      }
    }
    for (const requirement of requirements.records) for (const artifactId of requirement.artifactIds) {
      expect(artifactById.get(artifactId)?.requirementIds).toContain(requirement.requirementId);
    }
  });

  it('keeps per-requirement evidence categories explicit and does not turn incomplete atoms into PASS', async () => {
    const requirements = JSON.parse(await readFile('contracts/registries/requirements/requirements.json', 'utf8')) as { records: Array<Record<string, any>> };
    const complete = requirements.records.filter((record) => record.extensions?.['kcml:traceability']?.status === 'COMPLETE');
    expect(complete.length).toBe(requirements.records.length);
    for (const requirement of requirements.records) {
      const traceability = requirement.extensions?.['kcml:traceability'];
      const required = new Set(traceability.requiredRelationKinds);
      const missing = traceability.missingRelationKinds as string[];
      expect(missing.every((kind) => required.has(kind))).toBe(true);
      for (const kind of ['SOURCE', 'MIGRATION', 'TEST', 'EVIDENCE']) {
        expect(Array.isArray(traceability.relations[kind])).toBe(true);
      }
      expect(traceability.status === 'COMPLETE').toBe(missing.length === 0 && requirement.status === 'ACTIVE');
    }
  });
});
