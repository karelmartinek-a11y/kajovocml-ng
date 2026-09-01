#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { auditWriterSources } from './lib/authority-writer-audit.mjs';

const root = join(new URL('.', import.meta.url).pathname, '..');
const sha = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const readJson = async (path) => JSON.parse(await readFile(join(root, path), 'utf8'));

const requiredKinds = new Set([
  'OWNER_IDENTITY', 'OWNER_API_CREDENTIAL', 'SYSTEM_CHAT_CONVERSATION', 'COMPONENT_MONITORING_PROJECTION', 'IMMUTABLE_REGISTRY_REVISION', 'APPLICATION_RELEASE', 'GENERATION_ACTIVATION_SET', 'ACTIVATION_POINTER', 'BINDING_SET', 'SECRET_RECORD',
  'SECRET_RESOLUTION_EVIDENCE', 'EXTERNAL_TARGET', 'GENERATION_JOB', 'GENERATION_WORKSPACE', 'GENERATION_INTEGRATION', 'VALIDATION_GATE',
  'OPENAI_MODEL_CALL', 'AGENT_RUN', 'MCP_RUNTIME', 'BROWSER_RUNTIME_BUILD', 'BROWSER_SESSION', 'BROWSER_CONTROL', 'BROWSER_ACTION',
  'BROWSER_ACCOUNT_STATE', 'BROWSER_AUTOMATION', 'SIDE_EFFECT_LEDGER', 'QUEUE_WORK', 'AUDIT_HEAD', 'ALERT_EPISODE', 'REPAIR_JOB',
  'RUNTIME_INSTANCE', 'DEPLOYMENT_RUN', 'PLATFORM_RECOVERY', 'CLEANUP_OPERATION', 'CONFIGURATION', 'CONTRACT_REGISTRY'
]);

const authority = await readJson('contracts/registries/authority/authority-ownership.json');
const operations = await readJson('contracts/registries/operations/operations.json');
const stateMachines = await readJson('contracts/registries/state-machines/state-machines.json');
const failures = [];
const active = authority.records.filter((record) => record.lifecycle === 'ACTIVE');
const byKind = new Map();
for (const record of active) {
  if (byKind.has(record.authorityObjectKind)) failures.push(`AUTHORITY_OBJECT_KIND_DUPLICATE:${record.authorityObjectKind}`);
  byKind.set(record.authorityObjectKind, record);
  for (const field of ['requirementIds', 'allowedOperationIds', 'authoritativePersistence', 'acceptedEvidenceProducers', 'prohibitedDirectWriters', 'projectionConsumers']) {
    if (!Array.isArray(record[field])) failures.push(`AUTHORITY_FIELD_NOT_ARRAY:${record.authorityObjectKind}:${field}`);
  }
  if (!record.requirementIds?.length) failures.push(`AUTHORITY_REQUIREMENTS_EMPTY:${record.authorityObjectKind}`);
  if (!record.authoritySourceRefs?.length || !record.sourceRelations?.length) failures.push(`AUTHORITY_SOURCE_EVIDENCE_EMPTY:${record.authorityObjectKind}`);
  if (!stateMachines.records.some((machine) => machine.stateMachineId === record.stateMachineId)) failures.push(`AUTHORITY_STATE_MACHINE_MISSING:${record.authorityObjectKind}`);
  if (!record.closurePredicateId) failures.push(`AUTHORITY_CLOSURE_MISSING:${record.authorityObjectKind}`);
}
for (const kind of requiredKinds) if (!byKind.has(kind)) failures.push(`AUTHORITY_REQUIRED_KIND_MISSING:${kind}`);
const ownersByOperation = new Map();
for (const record of active) for (const operationId of record.allowedOperationIds) ownersByOperation.set(operationId, [...(ownersByOperation.get(operationId) ?? []), record]);
for (const operation of operations.records) {
  const owners = ownersByOperation.get(operation.operationId) ?? [];
  if (owners.length !== 1) failures.push(`AUTHORITY_OPERATION_CARDINALITY:${operation.operationName}:${owners.length}`);
  else if (owners[0].canonicalWriterId !== operation.canonicalWriterId || owners[0].stateMachineId !== operation.stateMachineId) failures.push(`AUTHORITY_OPERATION_CONTRACT_MISMATCH:${operation.operationName}`);
}
const staticEvidence = await auditWriterSources(root);
failures.push(...staticEvidence.violations.map((violation) => `${violation.code}:${violation.repositoryPath}:${violation.line}`));
const registeredWriterIds = new Set(active.map((record) => record.canonicalWriterId));
for (const write of staticEvidence.writes) if (write.writerBoundary !== 'CANONICAL_OPERATION_SERVICE' && !registeredWriterIds.has(write.writerBoundary)) failures.push(`STATIC_WRITER_OWNER_UNREGISTERED:${write.repositoryPath}:${write.line}:${write.writerBoundary}`);
const result = { status: failures.length ? 'FAIL' : 'PASS', authorityRecordCount: active.length, requiredKindCount: requiredKinds.size, operationCount: operations.records.length, staticWriterCount: staticEvidence.writes.length, staticEvidenceDigest: staticEvidence.evidenceDigest, failures, evidenceDigest: sha(JSON.stringify({ failures, staticEvidenceDigest: staticEvidence.evidenceDigest })) };
process.stdout.write(`${JSON.stringify(result)}\n`);
if (failures.length) process.exitCode = 1;
