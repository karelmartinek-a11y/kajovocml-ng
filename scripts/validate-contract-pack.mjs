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
const artifactByPath = new Map(artifacts.map((record) => [record.repositoryPath, record]));
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
const traceabilityKinds = ['SOURCE', 'MIGRATION', 'TEST', 'EVIDENCE'];
const artifactLinesByPath = new Map();
const requirementTraceManifestPath = 'contracts/traceability/requirement-atom-trace/manifest.json';
const requirementTraceRecords = [];
const requirementTraceRecordIds = new Set();
const requirementTraceAnchorOwners = new Map();
const requirementTracePathIsSafe = (value) => typeof value === 'string' && value.length > 0 && !value.startsWith('/') && !value.includes('..') && !value.includes('\\');
const requirementTracePathMatchesKind = (kind, value) => {
  if (kind === 'SOURCE') return value === 'SSOT_CURRENT.md';
  if (kind === 'TEST') return /^tests\/requirement-trace\/[^/]+\.test\.ts$/u.test(value);
  if (kind === 'EVIDENCE') return /^contracts\/testing\/evidence\/requirement-trace\/[^/]+\.jsonl$/u.test(value);
  if (kind === 'MIGRATION') return /^database\/migrations\/[^/]+\.sql$/u.test(value);
  return false;
};
const requirementTraceLines = new Map();
const readRequirementTraceLines = async (repositoryPath) => {
  if (!requirementTraceLines.has(repositoryPath)) {
    try { requirementTraceLines.set(repositoryPath, (await readFile(join(root, repositoryPath), 'utf8')).split('\n')); }
    catch (error) { failures.push(`REQUIREMENT_ATOM_TRACE: ${repositoryPath} unreadable (${error.message})`); return []; }
  }
  return requirementTraceLines.get(repositoryPath);
};
try {
  const traceManifest = JSON.parse(await readFile(join(root, requirementTraceManifestPath), 'utf8'));
  const expectedTraceRelationKinds = ['SOURCE', 'MIGRATION', 'TEST', 'EVIDENCE'];
  if (traceManifest.schemaVersion !== '1.0' || traceManifest.kind !== 'REQUIREMENT_ATOM_TRACE_SOURCE' || traceManifest.ssotDigest !== ssotDigest || canonical(traceManifest.relationKinds) !== canonical(expectedTraceRelationKinds) || !Array.isArray(traceManifest.shards) || !Number.isInteger(traceManifest.records) || traceManifest.records !== requirements.length) failures.push('REQUIREMENT_ATOM_TRACE: manifest identity/count invalid');
  const traceShardPaths = new Set();
  const traceShardDomains = new Set();
  for (const shard of traceManifest.shards ?? []) {
    if (typeof shard.domain !== 'string' || shard.domain.length === 0 || traceShardDomains.has(shard.domain) || typeof shard.repositoryPath !== 'string' || traceShardPaths.has(shard.repositoryPath) || !requirementTracePathIsSafe(shard.repositoryPath) || !/^contracts\/traceability\/requirement-atom-trace\/[^/]+\.jsonl$/u.test(shard.repositoryPath) || !Number.isInteger(shard.recordCount) || shard.recordCount < 1 || typeof shard.contentDigest !== 'string') {
      failures.push(`REQUIREMENT_ATOM_TRACE: invalid shard ${shard.repositoryPath}`);
      continue;
    }
    traceShardDomains.add(shard.domain);
    traceShardPaths.add(shard.repositoryPath);
    const bytes = await readFile(join(root, shard.repositoryPath));
    if (shaBytes(bytes) !== shard.contentDigest) failures.push(`REQUIREMENT_ATOM_TRACE: shard digest mismatch ${shard.repositoryPath}`);
    const lines = bytes.toString('utf8').split('\n');
    const recordLines = [];
    for (const [lineIndex, line] of lines.entries()) {
      if (line.length === 0 && lineIndex === lines.length - 1) continue;
      if (line.length === 0) {
        failures.push(`REQUIREMENT_ATOM_TRACE: blank line ${shard.repositoryPath}:${lineIndex + 1}`);
        continue;
      }
      recordLines.push({ line, lineIndex });
    }
    if (recordLines.length !== shard.recordCount) failures.push(`REQUIREMENT_ATOM_TRACE: shard count mismatch ${shard.repositoryPath}`);
    for (const { line, lineIndex } of recordLines) {
      let record;
      try { record = JSON.parse(line); } catch (error) { failures.push(`REQUIREMENT_ATOM_TRACE: invalid JSON ${shard.repositoryPath}:${lineIndex + 1} (${error.message})`); continue; }
      if (!record || typeof record !== 'object' || typeof record.requirementId !== 'string' || typeof record.statementDigest !== 'string' || typeof record.authoritySourceRef !== 'string' || !record.relations || typeof record.relations !== 'object' || Array.isArray(record.relations)) {
        failures.push(`REQUIREMENT_ATOM_TRACE: invalid record shape ${shard.repositoryPath}:${lineIndex + 1}`);
        continue;
      }
      if (requirementTraceRecordIds.has(record.requirementId)) failures.push(`REQUIREMENT_ATOM_TRACE: duplicate ${record.requirementId}`);
      requirementTraceRecordIds.add(record.requirementId);
      requirementTraceRecords.push(record);
      const requirement = requirementById.get(record.requirementId);
      if (!requirement) {
        failures.push(`REQUIREMENT_ATOM_TRACE: unknown requirement ${record.requirementId}`);
        continue;
      }
      if (record.statementDigest !== sha(requirement.canonicalStatement)) failures.push(`REQUIREMENT_ATOM_TRACE: statement digest mismatch ${record.requirementId}`);
      if (!(requirement.authoritySourceRefs ?? []).includes(record.authoritySourceRef)) failures.push(`REQUIREMENT_ATOM_TRACE: authority source mismatch ${record.requirementId}`);
      const requiredKinds = ['SOURCE', 'TEST', 'EVIDENCE', ...(requirement.domain === 'POSTGRES' ? ['MIGRATION'] : [])];
      const relationKeys = Object.keys(record.relations).sort();
      if (canonical(relationKeys) !== canonical([...requiredKinds].sort())) failures.push(`REQUIREMENT_ATOM_TRACE: relation set mismatch ${record.requirementId}`);
      for (const kind of requiredKinds) {
        const anchor = record.relations[kind];
        if (!anchor || !requirementTracePathIsSafe(anchor.repositoryPath) || !requirementTracePathMatchesKind(kind, anchor.repositoryPath) || !Number.isInteger(anchor.line) || anchor.line < 1 || typeof anchor.symbol !== 'string' || anchor.symbol.length === 0 || typeof anchor.snippetDigest !== 'string') {
          failures.push(`REQUIREMENT_ATOM_TRACE: invalid ${kind} anchor ${record.requirementId}`);
          continue;
        }
        const linesForAnchor = await readRequirementTraceLines(anchor.repositoryPath);
        const lineText = linesForAnchor[anchor.line - 1];
        if (lineText === undefined || sha(lineText) !== anchor.snippetDigest) failures.push(`REQUIREMENT_ATOM_TRACE: stale ${kind} anchor ${record.requirementId}`);
        if (anchor.symbol === 'file-start') failures.push(`REQUIREMENT_ATOM_TRACE: file-start ${kind} anchor ${record.requirementId}`);
        if (kind === 'SOURCE') {
          if (anchor.symbol !== `SSOT_ATOM:${record.authoritySourceRef}`) failures.push(`REQUIREMENT_ATOM_TRACE: source symbol mismatch ${record.requirementId}`);
        } else if (!lineText?.includes(record.requirementId) || !lineText.includes(record.statementDigest)) {
          failures.push(`REQUIREMENT_ATOM_TRACE: ${kind} line is not atom-bound ${record.requirementId}`);
        }
        const anchorKey = `${kind}:${anchor.repositoryPath}:${anchor.line}`;
        const previousOwner = requirementTraceAnchorOwners.get(anchorKey);
        if (previousOwner && previousOwner !== record.requirementId) failures.push(`REQUIREMENT_ATOM_TRACE: shared anchor ${anchorKey}`);
        requirementTraceAnchorOwners.set(anchorKey, record.requirementId);
        const artifact = artifactByPath.get(anchor.repositoryPath);
        if (!artifact) {
          failures.push(`REQUIREMENT_ATOM_TRACE: artifact missing ${record.requirementId} ${anchor.repositoryPath}`);
          continue;
        }
        if (!(requirement.artifactIds ?? []).includes(artifact.artifactId) || !(artifact.requirementIds ?? []).includes(record.requirementId)) failures.push(`REQUIREMENT_ATOM_TRACE: non-bidirectional ${record.requirementId} ${kind}`);
        const compiledAnchor = requirement.extensions?.['kcml:traceability']?.relations?.[kind]?.find((candidate) => candidate.artifactId === artifact.artifactId && candidate.repositoryPath === anchor.repositoryPath && candidate.locator === `${anchor.repositoryPath}:${anchor.line}` && candidate.symbol === anchor.symbol && candidate.snippetDigest === anchor.snippetDigest);
        if (!compiledAnchor) failures.push(`REQUIREMENT_ATOM_TRACE: compiled relation missing ${record.requirementId} ${kind}`);
      }
    }
  }
  if (requirementTraceRecordIds.size !== requirements.length || requirements.some((requirement) => !requirementTraceRecordIds.has(requirement.requirementId))) failures.push('REQUIREMENT_ATOM_TRACE: not every requirement has an explicit source record');
} catch (error) {
  failures.push(`REQUIREMENT_ATOM_TRACE: manifest unreadable (${error.message})`);
}
for (const requirement of requirements) {
  const traceability = requirement.extensions?.['kcml:traceability'];
  if (!traceability || traceability.schemaVersion !== '1.0') {
    failures.push(`TRACEABILITY: ${requirement.requirementId} missing kcml:traceability extension`);
    continue;
  }
  if (!['COMPLETE', 'INCOMPLETE'].includes(traceability.status)) failures.push(`TRACEABILITY: ${requirement.requirementId} invalid coverage status`);
  const requiredKinds = [...new Set(traceability.requiredRelationKinds ?? [])].sort();
  const missingKinds = [...new Set(traceability.missingRelationKinds ?? [])].sort();
  if (requiredKinds.some((kind) => !traceabilityKinds.includes(kind))) failures.push(`TRACEABILITY: ${requirement.requirementId} has unknown required relation kind`);
  if (missingKinds.some((kind) => !requiredKinds.includes(kind))) failures.push(`TRACEABILITY: ${requirement.requirementId} marks a non-required relation kind missing`);
  if (!traceability.relations || typeof traceability.relations !== 'object' || Array.isArray(traceability.relations)) failures.push(`TRACEABILITY: ${requirement.requirementId} relations object missing`);
  for (const kind of traceabilityKinds) if (!Array.isArray(traceability.relations?.[kind])) failures.push(`TRACEABILITY: ${requirement.requirementId} ${kind} relation list missing`);
  const actualMissingKinds = requiredKinds.filter((kind) => !(traceability.relations?.[kind]?.length));
  if (canonical(actualMissingKinds) !== canonical(missingKinds)) failures.push(`TRACEABILITY: ${requirement.requirementId} missing relation set is inconsistent`);
  if (traceability.status === 'COMPLETE' && missingKinds.length > 0) failures.push(`TRACEABILITY: ${requirement.requirementId} is COMPLETE with missing relation evidence`);
  if (traceability.status === 'COMPLETE' && requirement.status !== 'ACTIVE') failures.push(`TRACEABILITY: ${requirement.requirementId} is COMPLETE but the requirement is not ACTIVE`);
  for (const kind of traceabilityKinds) {
    for (const anchor of traceability.relations?.[kind] ?? []) {
      const artifact = artifactById.get(anchor.artifactId);
      if (!artifact) {
        failures.push(`TRACEABILITY: ${requirement.requirementId} ${kind} references missing artifact ${anchor.artifactId}`);
        continue;
      }
      if (artifact.repositoryPath !== anchor.repositoryPath) failures.push(`TRACEABILITY: ${requirement.requirementId} ${kind} artifact path mismatch`);
      if (anchor.symbol === 'file-start') failures.push(`TRACEABILITY: ${requirement.requirementId} ${kind} uses a non-concrete file-start anchor`);
      if (!(requirement.artifactIds ?? []).includes(anchor.artifactId)) failures.push(`TRACEABILITY: ${requirement.requirementId} ${kind} anchor is not in requirement artifactIds`);
      if (!(artifact.requirementIds ?? []).includes(requirement.requirementId)) failures.push(`TRACEABILITY: ${requirement.requirementId} ${kind} anchor is not reverse-linked by artifact`);
      const matchingAnchor = (artifact.traceAnchors ?? []).find((candidate) => candidate.requirementId === requirement.requirementId && candidate.locator === anchor.locator && candidate.symbol === anchor.symbol && candidate.snippetDigest === anchor.snippetDigest);
      if (!matchingAnchor) failures.push(`TRACEABILITY: ${requirement.requirementId} ${kind} anchor digest or locator is not present on artifact`);
    }
  }
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
  artifactLinesByPath.set(artifact.repositoryPath, bytes.toString('utf8').split('\n'));
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
    const lines = artifactLinesByPath.get(artifact.repositoryPath);
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
