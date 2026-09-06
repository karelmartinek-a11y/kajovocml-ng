import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const shaBytes = (value: Buffer): string => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const shaText = (value: string): string => `sha256:${createHash('sha256').update(value).digest('hex')}`;

describe('TD-02 file-level artifact traceability', () => {
  it('covers every compiled regular file with exact bytes and a reverse requirement edge', async () => {
    const artifacts = (JSON.parse(await readFile('contracts/traceability/artifact-trace/artifact-trace.json', 'utf8')) as { records: Array<Record<string, any>> }).records;
    const requirements = new Set((JSON.parse(await readFile('contracts/registries/requirements/requirements.json', 'utf8')) as { records: Array<{ requirementId: string }> }).records.map((record) => record.requirementId));
    expect(artifacts.length).toBeGreaterThan(300);
    for (const artifact of artifacts) {
      const bytes = await readFile(artifact.repositoryPath);
      expect((await stat(artifact.repositoryPath)).isFile()).toBe(true);
      expect(artifact.contentDigest).toBe(shaBytes(bytes));
      expect(artifact.artifactId).toBe(`ART-${shaText(`${artifact.repositoryPath}\u0000${artifact.contentDigest}`).slice(7)}`);
      expect(artifact.requirementIds.length).toBeGreaterThan(0);
      for (const requirementId of artifact.requirementIds) expect(requirements.has(requirementId)).toBe(true);
      const lines = bytes.toString('utf8').split('\n');
      for (const anchor of artifact.traceAnchors ?? []) {
        const match = anchor.locator.match(/^(.*):(\d+)$/u);
        expect(match?.[1]).toBe(artifact.repositoryPath);
        const line = Number(match?.[2]);
        expect(line).toBeGreaterThanOrEqual(1);
        expect(anchor.snippetDigest).toBe(shaText(lines[line - 1]));
      }
    }
  });

  it('keeps browser implementation artifacts connected to operations and the recovery oracle', async () => {
    const artifacts = (JSON.parse(await readFile('contracts/registries/artifact-trace/artifact-trace.json', 'utf8')) as { records: Array<Record<string, any>> }).records;
    const browserArtifacts = artifacts.filter((artifact) => /(?:^|\/)browser[^/]*\/src\/|^tests\/browser(?:\/|-)/iu.test(artifact.repositoryPath));
    expect(browserArtifacts.length).toBeGreaterThanOrEqual(10);
    for (const artifact of browserArtifacts) {
      expect(artifact.operationIds.length).toBeGreaterThan(0);
      expect(artifact.registryRecordIds).toContain('ORACLE-SIDE-EFFECT');
    }
  });

  it('pins generated schema artifacts to their compiler lineage', async () => {
    const artifacts = (JSON.parse(await readFile('contracts/registries/artifact-trace/artifact-trace.json', 'utf8')) as { records: Array<Record<string, any>> }).records;
    const generatedSchemas = artifacts.filter((artifact) => artifact.artifactKind === 'GENERATED_SCHEMA' || artifact.artifactKind === 'GENERATED_SCHEMA_BUNDLE');
    expect(generatedSchemas.length).toBeGreaterThan(0);
    for (const artifact of generatedSchemas) {
      expect(artifact.generatedFrom).toContain('SSOT_CURRENT.md');
      expect(artifact.generationToolDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
      expect(artifact.requirementIds.length).toBeGreaterThan(0);
    }
  });
});
