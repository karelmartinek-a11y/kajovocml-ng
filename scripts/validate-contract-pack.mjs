#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(join(root, 'contracts/registries/manifest.json'), 'utf8'));
const failures = [];
const ids = new Set();
const operationNames = new Set();
const canonical = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
};
const sha = (value) => `sha256:${createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex')}`;
const shaBytes = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const registryRecordId = (record) => record.recordId ?? record.requirementId ?? record.operationId ?? record.stateMachineId ?? record.postgresContractId ?? record.runtimeBoundaryId ?? record.gateId ?? record.closurePredicateId ?? record.artifactId ?? record.errorCodeId ?? record.authorityObjectKind ?? record.bindingId ?? record.faultPointId ?? record.recoveryOracleId;
const registryDataByKind = new Map();
const refSafety = (value) => typeof value === 'string' && value.startsWith('contracts/') && !value.includes('..') && !value.startsWith('/') && !value.includes('\\');

for (const registry of manifest.registries) {
  if (!refSafety(registry.schemaRef) || !refSafety(registry.dataRef)) failures.push(`${registry.kind}: unsafe repository-relative reference`);
  try {
    const schema = JSON.parse(await readFile(join(root, registry.schemaRef), 'utf8'));
    if (!Array.isArray(schema.required) || schema.additionalProperties === false) failures.push(`${registry.kind}: invalid registry-specific schema contract`);
    const data = JSON.parse(await readFile(join(root, registry.dataRef), 'utf8'));
    registryDataByKind.set(registry.kind, data);
    for (const required of schema.required ?? []) for (const record of data.records ?? []) if (!(required in record)) failures.push(`${registry.kind}: ${registryRecordId(record)} missing ${required}`);
    for (const record of data.records ?? []) if (schema.properties?.recordKind?.const && record.recordKind !== schema.properties.recordKind.const) failures.push(`${registry.kind}: ${registryRecordId(record)} wrong recordKind`);
  } catch (error) {
    failures.push(`${registry.kind}: schema/data unreadable (${error.message})`);
  }
  const bytes = await readFile(join(root, registry.dataRef));
  const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  if (digest !== registry.digest) failures.push(`${registry.kind}: digest mismatch`);
  const data = JSON.parse(bytes.toString('utf8'));
  if (data.records.length !== registry.recordCount) failures.push(`${registry.kind}: record count mismatch`);
  for (const record of data.records) {
    const id = registryRecordId(record);
    if (id) {
      const scoped = `${registry.kind}:${id}`;
      if (ids.has(scoped)) failures.push(`${registry.kind}: duplicate ${id}`);
      ids.add(scoped);
    }
    if (record.operationName) {
      if (operationNames.has(record.operationName)) failures.push(`duplicate operation ${record.operationName}`);
      operationNames.add(record.operationName);
    }
    if (record.recordId !== id) failures.push(`${registry.kind}: recordId mismatch for ${id}`);
    if (record.lifecycle === 'ACTIVE') {
      if (!Array.isArray(record.sourceRelations) || record.sourceRelations.length === 0) failures.push(`${registry.kind}: ${id} has no source evidence`);
      for (const relation of record.sourceRelations ?? []) {
        const relationInput = { sourceRef: relation.sourceRef, relationKind: relation.relationKind, canonicalRecordId: relation.canonicalRecordId, canonicalRequirementIds: [...relation.canonicalRequirementIds].sort() };
        if (relation.relationDigest !== sha(relationInput)) failures.push(`${registry.kind}: ${id} source relation digest mismatch`);
        if (relation.relationKind === 'AUTHORITY' && relation.canonicalRecordId !== id) failures.push(`${registry.kind}: ${id} authority relation target mismatch`);
        for (const requirementId of relation.canonicalRequirementIds ?? []) if (!/^[A-Za-z0-9_-]+$/u.test(requirementId)) failures.push(`${registry.kind}: ${id} invalid source requirement ID`);
      }
      const { canonicalDigest, ...identity } = record;
      if (record.canonicalDigest !== sha(identity)) failures.push(`${registry.kind}: ${id} canonical digest mismatch`);
    }
  }
}

const schemaBundle = JSON.parse(await readFile(join(root, manifest.schemaBundleRef), 'utf8'));
const { digest: schemaBundleDigest, ...schemaBundleIdentity } = schemaBundle;
if (!refSafety(manifest.schemaBundleRef) || manifest.schemaBundleDigest !== schemaBundleDigest || schemaBundleDigest !== sha(schemaBundleIdentity)) failures.push('schema bundle digest mismatch');
for (const schema of schemaBundle.schemas ?? []) {
  if (!refSafety(schema.ref)) failures.push(`schema bundle unsafe reference: ${schema.ref}`);
  const actual = await readFile(join(root, schema.ref), 'utf8');
  if (sha(JSON.parse(actual)) !== schema.digest) failures.push(`schema bundle digest mismatch: ${schema.ref}`);
}

const ssot = await readFile(join(root, 'SSOT_CURRENT.md'));
const ssotDigest = `sha256:${createHash('sha256').update(ssot).digest('hex')}`;
if (ssotDigest !== manifest.ssotDigest) failures.push('SSOT digest mismatch');
if (manifest.ssotVersion !== '2026.08.30.8') failures.push('SSOT version mismatch');
if (operationNames.size === 0) failures.push('operation catalog empty');

const requirements = registryDataByKind.get('REQUIREMENT_REGISTRY')?.records ?? [];
const artifacts = registryDataByKind.get('ARTIFACT_TRACE_REGISTRY')?.records ?? [];
const artifactById = new Map(artifacts.map((record) => [record.artifactId, record]));
const requirementById = new Map(requirements.map((record) => [record.requirementId, record]));
const idsByKind = new Map([...registryDataByKind.entries()].map(([kind, data]) => [kind, new Set((data.records ?? []).map(registryRecordId))]));
const allRegistryIds = new Set([...idsByKind.values()].flatMap((ids) => [...ids]));
for (const [registryKind, data] of registryDataByKind) for (const record of data.records ?? []) for (const relation of record.sourceRelations ?? []) {
  if ((relation.relationKind === 'SPECIALIZATION' || relation.relationKind === 'REFERENCE') && !allRegistryIds.has(relation.canonicalRecordId)) failures.push(`${registryKind}: ${registryRecordId(record)} source relation target missing`);
  for (const requirementId of relation.canonicalRequirementIds ?? []) if (!requirementById.has(requirementId)) failures.push(`${registryKind}: ${registryRecordId(record)} source requirement missing ${requirementId}`);
}
const crossReferences = [
  ['OPERATION_CATALOG', 'operationId', 'operationId'], ['OPERATION_CATALOG', 'operationIds', 'operationId'],
  ['STATE_MACHINE_REGISTRY', 'stateMachineId', 'stateMachineId'], ['STATE_MACHINE_REGISTRY', 'stateMachineIds', 'stateMachineId'],
  ['BINDING_REGISTRY', 'bindingIds', 'bindingId'], ['ERROR_RETRY_REGISTRY', 'errorCodeIds', 'errorCodeId'],
  ['ACCEPTANCE_GATE_REGISTRY', 'acceptanceGateIds', 'gateId'], ['CLOSURE_PREDICATE_REGISTRY', 'closurePredicateIds', 'closurePredicateId']
];
const registryIdsByField = new Map(crossReferences.map(([kind, field, idField]) => [field, [kind, idField]]));
for (const [registryKind, data] of registryDataByKind) for (const record of data.records ?? []) for (const [field, value] of Object.entries(record)) {
  const target = registryIdsByField.get(field);
  if (!target) continue;
  for (const id of Array.isArray(value) ? value : [value]) if (id !== null && !idsByKind.get(target[0])?.has(id)) failures.push(`${registryKind}: ${registryRecordId(record)} references missing ${target[0]} ${id}`);
}
for (const requirement of requirements) {
  for (const artifactId of requirement.artifactIds ?? []) {
    const artifact = artifactById.get(artifactId);
    if (!artifact) failures.push(`REQUIREMENT_REGISTRY: ${requirement.requirementId} references missing artifact ${artifactId}`);
    else if (!(artifact.requirementIds ?? []).includes(requirement.requirementId)) failures.push(`TRACEABILITY: ${requirement.requirementId} -> ${artifactId} is not bidirectional`);
  }
}
for (const artifact of artifacts) for (const requirementId of artifact.requirementIds ?? []) {
  const requirement = requirementById.get(requirementId);
  if (!requirement) failures.push(`ARTIFACT_TRACE_REGISTRY: ${artifact.artifactId} references missing requirement ${requirementId}`);
  else if (!(requirement.artifactIds ?? []).includes(artifact.artifactId)) failures.push(`TRACEABILITY: ${artifact.artifactId} -> ${requirementId} is not bidirectional`);
}
for (const artifact of artifacts) {
  const artifactPath = join(root, artifact.repositoryPath);
  let bytes;
  try {
    const info = await stat(artifactPath);
    if (!info.isFile()) failures.push(`ARTIFACT_TRACE_REGISTRY: ${artifact.artifactId} repositoryPath is not a regular file`);
    bytes = await readFile(artifactPath);
  } catch (error) {
    failures.push(`ARTIFACT_TRACE_REGISTRY: ${artifact.artifactId} repositoryPath unreadable (${error.message})`);
    continue;
  }
  const expectedContentDigest = shaBytes(bytes);
  const pathBoundArtifactId = `ART-${sha(`${artifact.repositoryPath}\u0000${artifact.contentDigest}`).slice(7)}`;
  if (artifact.contentDigest !== expectedContentDigest) failures.push(`ARTIFACT_TRACE_REGISTRY: ${artifact.artifactId} content digest mismatch`);
  if (artifact.artifactId !== pathBoundArtifactId) failures.push(`ARTIFACT_TRACE_REGISTRY: ${artifact.artifactId} artifact identity mismatch`);
  if (!Array.isArray(artifact.requirementIds) || artifact.requirementIds.length === 0) failures.push(`ARTIFACT_TRACE_REGISTRY: ${artifact.artifactId} has no requirement relation`);
  for (const anchor of artifact.traceAnchors ?? []) {
    const match = typeof anchor.locator === 'string' ? anchor.locator.match(/^(.*):(\d+)$/u) : null;
    if (!match || match[1] !== artifact.repositoryPath) {
      failures.push(`ARTIFACT_TRACE_REGISTRY: ${artifact.artifactId} invalid trace anchor locator`);
      continue;
    }
    const line = Number(match[2]);
    const lines = bytes.toString('utf8').split('\n');
    if (!Number.isInteger(line) || line < 1 || line > lines.length) failures.push(`ARTIFACT_TRACE_REGISTRY: ${artifact.artifactId} trace anchor line out of range`);
    else if (anchor.snippetDigest !== sha(lines[line - 1])) failures.push(`ARTIFACT_TRACE_REGISTRY: ${artifact.artifactId} trace anchor digest mismatch`);
    if (!anchor.symbol || typeof anchor.symbol !== 'string') failures.push(`ARTIFACT_TRACE_REGISTRY: ${artifact.artifactId} trace anchor symbol missing`);
    if (!artifact.requirementIds.includes(anchor.requirementId)) failures.push(`ARTIFACT_TRACE_REGISTRY: ${artifact.artifactId} trace anchor requirement is not linked`);
  }
  const browserImplementation = /(?:^|\/)browser[^/]*\/src\/|^tests\/browser(?:\/|-)/iu.test(artifact.repositoryPath);
  if (browserImplementation) {
    if (!artifact.operationIds?.length) failures.push(`TRACEABILITY_BROWSER_OPERATION_MISSING:${artifact.repositoryPath}`);
    if (!(artifact.registryRecordIds ?? []).includes('ORACLE-SIDE-EFFECT')) failures.push(`TRACEABILITY_BROWSER_ORACLE_MISSING:${artifact.repositoryPath}`);
  }
}
const manifestForDigest = { ...manifest, packDigest: null };
const expectedPackDigest = sha(canonical(manifestForDigest) + manifest.registries.map((record) => record.digest).join(''));
if (manifest.packDigest !== expectedPackDigest) failures.push('pack digest mismatch');

if (failures.length > 0) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Contract Pack structural validation complete: ${manifest.registries.length} registries, ${operationNames.size} operations, ${manifest.packDigest}. This result is not an architecture or SSOT compliance PASS.\n`);
}
