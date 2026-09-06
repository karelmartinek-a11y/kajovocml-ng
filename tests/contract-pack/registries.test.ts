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

const loadRequirementTrace = async (): Promise<Map<string, Record<string, any>>> => {
  const manifest = JSON.parse(await readFile('contracts/traceability/requirement-atom-trace/manifest.json', 'utf8')) as { shards: Array<{ repositoryPath: string }> };
  const records = (await Promise.all(manifest.shards.map(async ({ repositoryPath }) => (await readFile(repositoryPath, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line))))).flat();
  return new Map(records.map((record) => [record.requirementId, record]));
};

describe('Contract Pack', () => {
  it('is closed and every requirement carries evidence bindings', async () => {
    const manifest = JSON.parse(await readFile('contracts/registries/manifest.json', 'utf8'));
    const requirements = JSON.parse(await readFile('contracts/registries/requirements/requirements.json', 'utf8'));
    const operations = JSON.parse(await readFile('contracts/registries/operations/operations.json', 'utf8'));
    const traceByRequirement = await loadRequirementTrace();
    const artifacts = JSON.parse(await readFile('contracts/traceability/artifact-trace/artifact-trace.json', 'utf8')) as { records: Array<{ artifactId: string; requirementIds: string[] }> };
    const artifactIdsByRequirement = new Map<string, string[]>();
    for (const artifact of artifacts.records) for (const requirementId of artifact.requirementIds) artifactIdsByRequirement.set(requirementId, [...(artifactIdsByRequirement.get(requirementId) ?? []), artifact.artifactId]);
    expect(manifest.schemaVersion).toBe('1.0');
    expect(manifest.packDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(requirements.records.length).toBeGreaterThan(10_000);
    expect(operations.records.length).toBeGreaterThan(250);
    for (const item of requirements.records) {
      expect(item).toMatchObject({ requirementId: expect.any(String), authoritySourceRefs: expect.any(Array), artifactIds: expect.any(Array), testCaseIds: expect.any(Array), acceptanceGateIds: expect.any(Array) });
      const trace = traceByRequirement.get(item.requirementId);
      expect(trace?.relations).toMatchObject({ SOURCE: expect.any(Object), TEST: expect.any(Object), EVIDENCE: expect.any(Object) });
      if (item.domain === 'POSTGRES') expect(trace?.relations).toHaveProperty('MIGRATION');
      expect(artifactIdsByRequirement.get(item.requirementId)?.length).toBeGreaterThan(0);
    }
  });

  it('uses registry-specific schemas and verifiable source evidence', async () => {
    const manifest = JSON.parse(await readFile('contracts/registries/manifest.json', 'utf8'));
    const artifacts = JSON.parse(await readFile('contracts/traceability/artifact-trace/artifact-trace.json', 'utf8'));
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
    for (const artifact of artifacts.records) for (const requirementId of artifact.requirementIds) expect(requirements.records.some((requirement: { requirementId: string }) => requirement.requirementId === requirementId)).toBe(true);
  });

  it('keeps per-requirement evidence categories explicit and does not turn incomplete atoms into PASS', async () => {
    const requirements = JSON.parse(await readFile('contracts/registries/requirements/requirements.json', 'utf8')) as { records: Array<Record<string, any>> };
    const traceByRequirement = await loadRequirementTrace();
    const complete = requirements.records.filter((record) => {
      const required = record.domain === 'POSTGRES' ? ['SOURCE', 'MIGRATION', 'TEST', 'EVIDENCE'] : ['SOURCE', 'TEST', 'EVIDENCE'];
      const trace = traceByRequirement.get(record.requirementId);
      return trace && required.every((kind) => trace.relations?.[kind]);
    });
    expect(complete.length).toBe(requirements.records.length);
    for (const requirement of requirements.records) {
      const trace = traceByRequirement.get(requirement.requirementId);
      const required = requirement.domain === 'POSTGRES' ? ['SOURCE', 'MIGRATION', 'TEST', 'EVIDENCE'] : ['SOURCE', 'TEST', 'EVIDENCE'];
      expect(required.every((kind) => trace?.relations?.[kind])).toBe(requirement.status === 'ACTIVE');
    }
  });
});
