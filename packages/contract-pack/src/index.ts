import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export type RegistryKind =
  | 'REQUIREMENT_REGISTRY'
  | 'OPERATION_CATALOG'
  | 'STATE_MACHINE_REGISTRY'
  | 'POSTGRES_CONTRACT_MATRIX'
  | 'RUNTIME_BOUNDARY_MATRIX'
  | 'BINDING_REGISTRY'
  | 'AUTHORITY_OWNERSHIP_REGISTRY'
  | 'ERROR_RETRY_REGISTRY'
  | 'FAULT_CATALOG'
  | 'RECOVERY_ORACLE_REGISTRY'
  | 'CLOSURE_PREDICATE_REGISTRY'
  | 'ACCEPTANCE_GATE_REGISTRY'
  | 'EXPOSURE_PARITY_REGISTRY'
  | 'ARTIFACT_TRACE_REGISTRY';

export type SourceRelationKind = 'AUTHORITY' | 'SPECIALIZATION' | 'REFERENCE';

/**
 * Typed evidence of where a registry record gets its meaning.
 *
 * `sourceRef` is a stable SSOT URI, never a line-number-only locator.  The
 * relation digest is over the relation without `relationDigest`, using the
 * KCML canonical JSON representation.
 */
export interface SourceEvidence {
  sourceRef: string;
  relationKind: SourceRelationKind;
  canonicalRecordId: string;
  canonicalRequirementIds: string[];
  relationDigest: string;
}

/** @deprecated Use SourceEvidence; retained as a semantic alias for callers. */
export type SourceRelation = SourceEvidence;

export interface TraceAnchor {
  requirementId: string;
  locator: string;
  symbol: string;
  snippetDigest: string;
}

export interface RegistryRecord {
  recordId: string;
  recordKind: RegistryKind;
  schemaVersion: '1.0';
  authoritySourceRefs: string[];
  sourceRelations: SourceEvidence[];
  requirementIds: string[];
  canonicalName: string;
  canonicalDigest: string;
  lifecycle: 'ACTIVE' | 'SUPERSEDED' | 'RETIRED';
  supersedes: string[];
  supersededBy: string[];
  extensions: Record<string, unknown>;
}

export interface RegistryDocument<T extends RegistryRecord = RegistryRecord> {
  schemaVersion: '1.0';
  kind: RegistryKind;
  records: T[];
}

export interface OperationContract extends RegistryRecord {
  operationId: string;
  operationName: string;
  operationRevision: number;
  operationFamily: string;
  aggregateRoot: string;
  exposureClass: string;
  sideEffectClass: string;
  retryClass: string;
  expectedStateVersionPolicy: string;
  idempotencyKeySource: string;
  canonicalDigest: string;
  [key: string]: unknown;
}

export interface OperationCatalog extends RegistryDocument<OperationContract> { kind: 'OPERATION_CATALOG'; }

export function registryRecordId(record: Partial<RegistryRecord>): string | undefined {
  return record.recordId;
}

export function isSourceEvidence(value: unknown): value is SourceEvidence {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.sourceRef === 'string'
    && (candidate.relationKind === 'AUTHORITY' || candidate.relationKind === 'SPECIALIZATION' || candidate.relationKind === 'REFERENCE')
    && typeof candidate.canonicalRecordId === 'string'
    && Array.isArray(candidate.canonicalRequirementIds)
    && candidate.canonicalRequirementIds.every((id) => typeof id === 'string')
    && typeof candidate.relationDigest === 'string';
}

export async function loadRegistry<T extends RegistryRecord>(
  kind: RegistryKind,
  repositoryRoot = process.cwd(),
): Promise<RegistryDocument<T>> {
  const paths: Record<RegistryKind, string> = {
    REQUIREMENT_REGISTRY: 'contracts/registries/requirements/requirements.json',
    OPERATION_CATALOG: 'contracts/registries/operations/operations.json',
    STATE_MACHINE_REGISTRY: 'contracts/registries/state-machines/state-machines.json',
    POSTGRES_CONTRACT_MATRIX: 'contracts/registries/postgres/postgres-contracts.json',
    RUNTIME_BOUNDARY_MATRIX: 'contracts/registries/runtime-boundaries/runtime-boundaries.json',
    BINDING_REGISTRY: 'contracts/registries/bindings/bindings.json',
    AUTHORITY_OWNERSHIP_REGISTRY: 'contracts/registries/authority/authority-ownership.json',
    ERROR_RETRY_REGISTRY: 'contracts/registries/errors/errors.json',
    FAULT_CATALOG: 'contracts/registries/faults/faults.json',
    RECOVERY_ORACLE_REGISTRY: 'contracts/registries/recovery-oracles/recovery-oracles.json',
    CLOSURE_PREDICATE_REGISTRY: 'contracts/registries/closure-predicates/closure-predicates.json',
    ACCEPTANCE_GATE_REGISTRY: 'contracts/registries/acceptance-gates/acceptance-gates.json',
    EXPOSURE_PARITY_REGISTRY: 'contracts/registries/exposure-parity/exposure-parity.json',
    ARTIFACT_TRACE_REGISTRY: 'contracts/registries/artifact-trace/artifact-trace.json',
  };
  const parsed = JSON.parse(await readFile(resolve(repositoryRoot, paths[kind]), 'utf8')) as RegistryDocument<T>;
  if (parsed.kind !== kind || !Array.isArray(parsed.records)) throw new Error(`Invalid ${kind}`);
  return parsed;
}

export async function loadOperationCatalog(repositoryRoot = process.cwd()): Promise<OperationCatalog> {
  return loadRegistry<OperationContract>('OPERATION_CATALOG', repositoryRoot) as Promise<OperationCatalog>;
}

export async function operationByName(name: string, repositoryRoot = process.cwd()): Promise<OperationContract> {
  const catalog = await loadOperationCatalog(repositoryRoot);
  const operation = catalog.records.find((candidate) => candidate.operationName === name);
  if (!operation) throw new Error(`Unknown operation: ${name}`);
  return operation;
}
