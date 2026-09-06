#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const canonical = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
};
const sha = (value) => `sha256:${createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex')}`;
const shaBytes = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const idFor = (record) => record.recordId ?? record.requirementId ?? record.operationId ?? record.stateMachineId ?? record.postgresContractId ?? record.runtimeBoundaryId ?? record.gateId ?? record.closurePredicateId ?? record.errorCodeId ?? record.authorityObjectKind ?? record.bindingId ?? record.faultPointId ?? record.recoveryOracleId;
const safeRef = (value) => typeof value === 'string' && value.startsWith('contracts/') && !value.includes('..') && !value.includes('\\');
const failures = [];

const manifestBytes = await readFile(join(root, 'contracts/registries/manifest.json'));
const manifest = JSON.parse(manifestBytes.toString('utf8'));
if (manifest.registries.some((record) => record.kind === 'ARTIFACT_TRACE_REGISTRY')) failures.push('PACK_AUTHORITY_BOUNDARY: implementation artifact trace must not be a normative Contract Pack registry');

const schemaBundleBytes = await readFile(join(root, manifest.schemaBundleRef));
const schemaBundle = JSON.parse(schemaBundleBytes.toString('utf8'));
const { digest: bundleDigest, ...bundleIdentity } = schemaBundle;
if (!safeRef(manifest.schemaBundleRef) || manifest.schemaBundleDigest !== bundleDigest || bundleDigest !== sha(bundleIdentity)) failures.push('schema bundle digest mismatch');
for (const schema of schemaBundle.schemas ?? []) {
  if (!safeRef(schema.ref)) { failures.push(`unsafe schema ref ${schema.ref}`); continue; }
  const bytes = await readFile(join(root, schema.ref));
  if (sha(JSON.parse(bytes.toString('utf8'))) !== schema.digest) failures.push(`schema bundle digest mismatch: ${schema.ref}`);
}

const registryDataByKind = new Map();
const idsByKind = new Map();
for (const registry of manifest.registries ?? []) {
  if (!safeRef(registry.schemaRef) || !safeRef(registry.dataRef)) { failures.push(`${registry.kind}: unsafe repository-relative reference`); continue; }
  const [schemaBytes, dataBytes] = await Promise.all([readFile(join(root, registry.schemaRef)), readFile(join(root, registry.dataRef))]);
  if (shaBytes(dataBytes) !== registry.digest) failures.push(`${registry.kind}: digest mismatch`);
  const schema = JSON.parse(schemaBytes.toString('utf8'));
  const data = JSON.parse(dataBytes.toString('utf8'));
  registryDataByKind.set(registry.kind, data);
  const scopedIds = new Set();
  for (const record of data.records ?? []) {
    const id = idFor(record);
    if (!id) { failures.push(`${registry.kind}: record identity missing`); continue; }
    if (scopedIds.has(id)) failures.push(`${registry.kind}: duplicate ${id}`);
    scopedIds.add(id);
    if (record.recordId !== id) failures.push(`${registry.kind}: recordId mismatch for ${id}`);
    for (const required of schema.required ?? []) if (!(required in record)) failures.push(`${registry.kind}: ${id} missing ${required}`);
    if (record.lifecycle === 'ACTIVE') {
      if (!Array.isArray(record.sourceRelations) || record.sourceRelations.length === 0) failures.push(`${registry.kind}: ${id} has no normative source relation`);
      for (const relation of record.sourceRelations ?? []) {
        const identity = { sourceRef: relation.sourceRef, relationKind: relation.relationKind, canonicalRecordId: relation.canonicalRecordId, canonicalRequirementIds: [...(relation.canonicalRequirementIds ?? [])].sort() };
        if (relation.relationDigest !== sha(identity)) failures.push(`${registry.kind}: ${id} source relation digest mismatch`);
      }
      const { canonicalDigest, ...identity } = record;
      if (canonicalDigest !== sha(identity)) failures.push(`${registry.kind}: ${id} canonical digest mismatch`);
    }
  }
  idsByKind.set(registry.kind, scopedIds);
  if ((data.records ?? []).length !== registry.recordCount) failures.push(`${registry.kind}: record count mismatch`);
}

const ssotBytes = await readFile(join(root, 'SSOT_CURRENT.md'));
if (shaBytes(ssotBytes) !== manifest.ssotDigest) failures.push('SSOT digest mismatch');
if (manifest.ssotVersion !== '2026.08.30.8') failures.push('SSOT version mismatch');
const requirements = registryDataByKind.get('REQUIREMENT_REGISTRY')?.records ?? [];
const requirementIds = new Set(requirements.map((record) => record.requirementId));
if (requirements.length === 0) failures.push('requirement registry empty');
if ((registryDataByKind.get('OPERATION_CATALOG')?.records ?? []).length === 0) failures.push('operation catalog empty');

const referenceFields = new Map([
  ['operationId', 'OPERATION_CATALOG'], ['operationIds', 'OPERATION_CATALOG'],
  ['stateMachineId', 'STATE_MACHINE_REGISTRY'], ['stateMachineIds', 'STATE_MACHINE_REGISTRY'],
  ['bindingIds', 'BINDING_REGISTRY'], ['errorCodeIds', 'ERROR_RETRY_REGISTRY'],
  ['acceptanceGateIds', 'ACCEPTANCE_GATE_REGISTRY'], ['closurePredicateIds', 'CLOSURE_PREDICATE_REGISTRY'],
  ['authorityOwnershipIds', 'AUTHORITY_OWNERSHIP_REGISTRY']
]);
for (const [kind, data] of registryDataByKind) for (const record of data.records ?? []) {
  for (const relation of record.sourceRelations ?? []) for (const requirementId of relation.canonicalRequirementIds ?? []) if (!requirementIds.has(requirementId)) failures.push(`${kind}: ${idFor(record)} source relation references unknown requirement ${requirementId}`);
  for (const [field, targetKind] of referenceFields) {
    const value = record[field];
    if (value === undefined || value === null) continue;
    for (const id of Array.isArray(value) ? value : [value]) if (typeof id === 'string' && !idsByKind.get(targetKind)?.has(id)) failures.push(`${kind}: ${idFor(record)} references missing ${targetKind} ${id}`);
  }
}

const expectedPackDigest = sha(canonical({ ...manifest, packDigest: null }) + manifest.registries.map((record) => record.digest).join(''));
if (manifest.packDigest !== expectedPackDigest) failures.push('pack digest mismatch');

if (failures.length) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Normative Contract Pack validation complete: ${manifest.registries.length} registries, ${requirements.length} SSOT requirements, ${manifest.packDigest}. Implementation evidence is validated separately.\n`);
}
