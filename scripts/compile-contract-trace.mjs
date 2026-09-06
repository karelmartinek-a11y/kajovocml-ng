#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const canonical = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
};
const shaBytes = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const sha = (value) => shaBytes(Buffer.from(typeof value === 'string' ? value : canonical(value), 'utf8'));
const stable = (values) => [...new Set(values ?? [])].sort();
const sourceFiles = [
  'contracts/traceability/artifact-trace-source.json',
  'contracts/traceability/artifact-trace-source-overrides.json',
  'contracts/traceability/artifact-trace-source-browser-overrides.json',
  'contracts/traceability/artifact-trace-source-test-overrides.json',
  'contracts/traceability/artifact-trace-source-remediation.json'
];
const operationalControlPlanePaths = new Set([
  '.github/workflows/audit-remediation.yml'
]);

const merged = new Map();
for (const sourcePath of sourceFiles) {
  const source = JSON.parse(await readFile(join(root, sourcePath), 'utf8'));
  if (source.schemaVersion !== '1.0' || source.kind !== 'ARTIFACT_TRACE_SOURCE' || !Array.isArray(source.records)) throw new Error(`TRACE_SOURCE_INVALID:${sourcePath}`);
  for (const record of source.records) {
    if (operationalControlPlanePaths.has(record.repositoryPath)) continue;
    const current = merged.get(record.repositoryPath) ?? { repositoryPath: record.repositoryPath, requirementIds: [], operationIds: [], stateMachineIds: [], registryRecordIds: [], testIds: [], releaseIds: [], traceAnchors: [] };
    for (const field of ['requirementIds','operationIds','stateMachineIds','registryRecordIds','testIds','releaseIds']) current[field] = stable([...(current[field] ?? []), ...(record[field] ?? [])]);
    const anchors = [...(current.traceAnchors ?? []), ...(record.traceAnchors ?? [])];
    current.traceAnchors = [...new Map(anchors.map((anchor) => [`${anchor.requirementId}:${anchor.symbol}`, anchor])).values()];
    merged.set(record.repositoryPath, current);
  }
}

// Historical compiled trace is evidence-only seed data. It is deliberately
// outside the normative manifest and may only contribute path-to-requirement
// mappings; all content digests and anchors are recomputed from current files.
try {
  const legacy = JSON.parse(await readFile(join(root, 'contracts/registries/artifact-trace/artifact-trace.json'), 'utf8'));
  for (const record of legacy.records ?? []) {
    if (operationalControlPlanePaths.has(record.repositoryPath)) continue;
    const current = merged.get(record.repositoryPath) ?? { repositoryPath: record.repositoryPath, requirementIds: [], operationIds: [], stateMachineIds: [], registryRecordIds: [], testIds: [], releaseIds: [], traceAnchors: [] };
    for (const field of ['requirementIds','operationIds','stateMachineIds','registryRecordIds','testIds','releaseIds']) current[field] = stable([...(current[field] ?? []), ...(record[field] ?? [])]);
    const anchors = [...(current.traceAnchors ?? []), ...(record.traceAnchors ?? [])];
    current.traceAnchors = [...new Map(anchors.map((anchor) => [`${anchor.requirementId}:${anchor.symbol}`, anchor])).values()];
    merged.set(record.repositoryPath, current);
  }
} catch { /* evidence seed may be absent in a clean checkout */ }

async function collect(directory = root) {
  const ignored = new Set(['node_modules','dist','.git','artifacts','test-results','FORENSIC_AUDIT_CURRENT.md']);
  const output = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
    if (ignored.has(entry.name) || entry.name.startsWith('._')) continue;
    const absolute = join(directory, entry.name);
    const repositoryPath = relative(root, absolute).replaceAll('\\','/');
    if (entry.isDirectory()) output.push(...await collect(absolute));
    else if (entry.isFile() && !operationalControlPlanePaths.has(repositoryPath) && !repositoryPath.startsWith('contracts/registries/') && !repositoryPath.startsWith('contracts/registry-schemas/') && !repositoryPath.startsWith('contracts/traceability/artifact-trace/')) output.push(repositoryPath);
  }
  return output;
}

const records = [];
for (const repositoryPath of await collect()) {
  const bytes = await readFile(join(root, repositoryPath));
  const lines = bytes.toString('utf8').split('\n');
  const mapped = merged.get(repositoryPath);
  const contentDigest = shaBytes(bytes);
  const artifactId = `ART-${sha(`${repositoryPath}\u0000${contentDigest}`).slice(7)}`;
  const anchors = [];
  for (const sourceAnchor of mapped?.traceAnchors ?? []) {
    let line = 1;
    if (sourceAnchor.symbol !== 'file-start') {
      const declared = /:(\d+)$/u.exec(sourceAnchor.locator ?? '')?.[1];
      const declaredIndex = declared ? Number(declared) - 1 : -1;
      if (declaredIndex >= 0 && declaredIndex < lines.length && lines[declaredIndex]?.includes(sourceAnchor.symbol)) line = declaredIndex + 1;
      else {
        const found = lines.findIndex((candidate) => candidate.includes(sourceAnchor.symbol));
        if (found >= 0) line = found + 1;
        else if (declaredIndex >= 0 && declaredIndex < lines.length) line = declaredIndex + 1;
        else throw new Error(`TRACE_ANCHOR_UNRESOLVED:${repositoryPath}:${sourceAnchor.symbol}`);
      }
    }
    anchors.push({ requirementId: sourceAnchor.requirementId, locator: `${repositoryPath}:${line}`, symbol: sourceAnchor.symbol, snippetDigest: sha(lines[line - 1] ?? '') });
  }
  records.push({
    artifactId, artifactKind: 'REPOSITORY_FILE', repositoryPath, contentDigest,
    ownerModule: repositoryPath.startsWith('packages/') ? repositoryPath.split('/').slice(0,2).join('/') : repositoryPath.split('/')[0],
    requirementIds: stable(mapped?.requirementIds), operationIds: stable(mapped?.operationIds), stateMachineIds: stable(mapped?.stateMachineIds), registryRecordIds: stable(mapped?.registryRecordIds), testIds: stable(mapped?.testIds), releaseIds: stable(mapped?.releaseIds),
    traceAnchors: anchors, coverageStatus: mapped && (mapped.requirementIds?.length ?? 0) > 0 ? 'MAPPED' : 'UNMAPPED'
  });
}
records.sort((a,b) => a.repositoryPath.localeCompare(b.repositoryPath));
const data = { schemaVersion: '1.0', kind: 'ARTIFACT_TRACE_EVIDENCE', records };
const dataBytes = `${canonical(data)}\n`;
const normativeManifest = JSON.parse(await readFile(join(root, 'contracts/registries/manifest.json'), 'utf8'));
const sourceDigests = Object.fromEntries(await Promise.all(sourceFiles.map(async (sourcePath) => [sourcePath, shaBytes(await readFile(join(root, sourcePath)))])));
const manifest = {
  schemaVersion: '1.0', kind: 'ARTIFACT_TRACE_EVIDENCE_MANIFEST', ssotDigest: normativeManifest.ssotDigest, normativePackDigest: normativeManifest.packDigest,
  recordCount: records.length, mappedCount: records.filter((record) => record.coverageStatus === 'MAPPED').length,
  unmappedPaths: records.filter((record) => record.coverageStatus === 'UNMAPPED').map((record) => record.repositoryPath),
  dataRef: 'contracts/traceability/artifact-trace/artifact-trace.json', dataDigest: sha(dataBytes), sourceDigests, traceDigest: null
};
manifest.traceDigest = sha({ ...manifest, traceDigest: null });
const outputs = new Map([
  ['contracts/traceability/artifact-trace/artifact-trace.json', dataBytes],
  ['contracts/traceability/artifact-trace/manifest.json', `${canonical(manifest)}\n`]
]);
const mismatches = [];
for (const [repositoryPath, contents] of outputs) {
  const absolute = join(root, repositoryPath);
  if (checkOnly) {
    let existing = null;
    try { existing = await readFile(absolute, 'utf8'); } catch { /* missing */ }
    if (existing !== contents) mismatches.push(`${repositoryPath}: drift`);
  } else {
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, contents, 'utf8');
  }
}
if (mismatches.length) throw new Error(`CONTRACT_TRACE_DRIFT\n${mismatches.join('\n')}`);
process.stdout.write(`${checkOnly ? 'verified' : 'generated'} artifact evidence=${records.length} mapped=${manifest.mappedCount} unmapped=${manifest.unmappedPaths.length} trace=${manifest.traceDigest}\n`);
