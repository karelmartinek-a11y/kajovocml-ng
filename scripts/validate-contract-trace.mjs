#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const canonical = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
};
const shaBytes = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const sha = (value) => shaBytes(Buffer.from(typeof value === 'string' ? value : canonical(value), 'utf8'));
const failures = [];
const normativeManifest = JSON.parse(await readFile(join(root, 'contracts/registries/manifest.json'), 'utf8'));
const requirements = JSON.parse(await readFile(join(root, 'contracts/registries/requirements/requirements.json'), 'utf8')).records ?? [];
const requirementIds = new Set(requirements.map((record) => record.requirementId));
const traceManifestBytes = await readFile(join(root, 'contracts/traceability/artifact-trace/manifest.json'));
const traceManifest = JSON.parse(traceManifestBytes.toString('utf8'));
const traceDataBytes = await readFile(join(root, traceManifest.dataRef));
const traceData = JSON.parse(traceDataBytes.toString('utf8'));
if (traceManifest.kind !== 'ARTIFACT_TRACE_EVIDENCE_MANIFEST' || traceData.kind !== 'ARTIFACT_TRACE_EVIDENCE') failures.push('TRACE_LAYER_KIND_INVALID');
if (traceManifest.ssotDigest !== normativeManifest.ssotDigest || traceManifest.normativePackDigest !== normativeManifest.packDigest) failures.push('TRACE_LAYER_NORMATIVE_BINDING_STALE');
if (traceManifest.dataDigest !== sha(traceDataBytes.toString('utf8'))) failures.push('TRACE_LAYER_DATA_DIGEST_MISMATCH');
if (traceManifest.traceDigest !== sha({ ...traceManifest, traceDigest: null })) failures.push('TRACE_LAYER_MANIFEST_DIGEST_MISMATCH');
if (traceManifest.recordCount !== (traceData.records ?? []).length) failures.push('TRACE_LAYER_RECORD_COUNT_MISMATCH');
if ((traceManifest.unmappedPaths ?? []).length > 0) failures.push(`TRACE_LAYER_UNMAPPED_ARTIFACTS:${traceManifest.unmappedPaths.join(',')}`);
const paths = new Set();
for (const artifact of traceData.records ?? []) {
  if (paths.has(artifact.repositoryPath)) failures.push(`TRACE_LAYER_DUPLICATE_PATH:${artifact.repositoryPath}`);
  paths.add(artifact.repositoryPath);
  let bytes;
  try {
    const info = await stat(join(root, artifact.repositoryPath));
    if (!info.isFile()) { failures.push(`TRACE_LAYER_NOT_FILE:${artifact.repositoryPath}`); continue; }
    bytes = await readFile(join(root, artifact.repositoryPath));
  } catch (error) { failures.push(`TRACE_LAYER_MISSING:${artifact.repositoryPath}:${error.message}`); continue; }
  const contentDigest = shaBytes(bytes);
  const expectedId = `ART-${sha(`${artifact.repositoryPath}\u0000${contentDigest}`).slice(7)}`;
  if (artifact.contentDigest !== contentDigest) failures.push(`TRACE_LAYER_CONTENT_DRIFT:${artifact.repositoryPath}`);
  if (artifact.artifactId !== expectedId) failures.push(`TRACE_LAYER_IDENTITY_DRIFT:${artifact.repositoryPath}`);
  if (artifact.coverageStatus !== 'MAPPED' || !Array.isArray(artifact.requirementIds) || artifact.requirementIds.length === 0) failures.push(`TRACE_LAYER_UNMAPPED:${artifact.repositoryPath}`);
  for (const requirementId of artifact.requirementIds ?? []) if (!requirementIds.has(requirementId)) failures.push(`TRACE_LAYER_UNKNOWN_REQUIREMENT:${artifact.repositoryPath}:${requirementId}`);
  const lines = bytes.toString('utf8').split('\n');
  for (const anchor of artifact.traceAnchors ?? []) {
    const prefix = `${artifact.repositoryPath}:`;
    const line = anchor.locator?.startsWith(prefix) ? Number(anchor.locator.slice(prefix.length)) : 0;
    if (!Number.isInteger(line) || line < 1 || line > lines.length) failures.push(`TRACE_LAYER_ANCHOR_RANGE:${artifact.repositoryPath}:${anchor.symbol}`);
    else if (anchor.snippetDigest !== sha(lines[line - 1])) failures.push(`TRACE_LAYER_ANCHOR_DRIFT:${artifact.repositoryPath}:${anchor.symbol}`);
    if (!(artifact.requirementIds ?? []).includes(anchor.requirementId)) failures.push(`TRACE_LAYER_ANCHOR_REQUIREMENT:${artifact.repositoryPath}:${anchor.requirementId}`);
  }
}

// Requirement-atom trace is evidence too. Validate its source binding without
// feeding implementation state back into the normative Contract Pack.
const atomManifest = JSON.parse(await readFile(join(root, 'contracts/traceability/requirement-atom-trace/manifest.json'), 'utf8'));
if (atomManifest.ssotDigest !== normativeManifest.ssotDigest || atomManifest.records !== requirements.length) failures.push('REQUIREMENT_ATOM_TRACE_BINDING_STALE');
let atomCount = 0;
const atomIds = new Set();
for (const shard of atomManifest.shards ?? []) {
  const bytes = await readFile(join(root, shard.repositoryPath));
  if (shaBytes(bytes) !== shard.contentDigest) failures.push(`REQUIREMENT_ATOM_TRACE_SHARD_DRIFT:${shard.repositoryPath}`);
  for (const line of bytes.toString('utf8').split('\n').filter(Boolean)) {
    const record = JSON.parse(line); atomCount += 1; atomIds.add(record.requirementId);
    if (!requirementIds.has(record.requirementId)) failures.push(`REQUIREMENT_ATOM_TRACE_UNKNOWN:${record.requirementId}`);
  }
}
if (atomCount !== requirements.length || atomIds.size !== requirements.length) failures.push('REQUIREMENT_ATOM_TRACE_COVERAGE_INCOMPLETE');

if (failures.length) { process.stderr.write(`${failures.join('\n')}\n`); process.exitCode = 1; }
else process.stdout.write(`Contract trace/evidence validation complete: ${traceData.records.length} repository artifacts and ${atomCount} requirement atoms bound to normative pack ${normativeManifest.packDigest}.\n`);
