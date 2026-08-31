#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(join(root, 'contracts/registries/manifest.json'), 'utf8'));
const failures = [];
const ids = new Set();
const operationNames = new Set();

for (const registry of manifest.registries) {
  const bytes = await readFile(join(root, registry.dataRef));
  const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  if (digest !== registry.digest) failures.push(`${registry.kind}: digest mismatch`);
  const data = JSON.parse(bytes.toString('utf8'));
  if (data.records.length !== registry.recordCount) failures.push(`${registry.kind}: record count mismatch`);
  for (const record of data.records) {
    const id = record.requirementId ?? record.operationId ?? record.stateMachineId ?? record.postgresContractId ?? record.runtimeBoundaryId ?? record.gateId ?? record.closurePredicateId ?? record.artifactId ?? record.errorCodeId ?? record.authorityObjectKind ?? record.bindingId ?? record.faultPointId ?? record.recoveryOracleId;
    if (id) {
      const scoped = `${registry.kind}:${id}`;
      if (ids.has(scoped)) failures.push(`${registry.kind}: duplicate ${id}`);
      ids.add(scoped);
    }
    if (record.operationName) {
      if (operationNames.has(record.operationName)) failures.push(`duplicate operation ${record.operationName}`);
      operationNames.add(record.operationName);
    }
  }
}

const ssot = await readFile(join(root, 'SSOT_CURRENT.md'));
const ssotDigest = `sha256:${createHash('sha256').update(ssot).digest('hex')}`;
if (ssotDigest !== manifest.ssotDigest) failures.push('SSOT digest mismatch');
if (manifest.ssotVersion !== '2026.08.30.8') failures.push('SSOT version mismatch');
if (operationNames.size === 0) failures.push('operation catalog empty');

if (failures.length > 0) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Contract Pack structural validation complete: ${manifest.registries.length} registries, ${operationNames.size} operations, ${manifest.packDigest}. This result is not an architecture or SSOT compliance PASS.\n`);
}
