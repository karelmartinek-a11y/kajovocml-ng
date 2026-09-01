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

export interface ExposureParityContract extends RegistryRecord {
  operationId: string;
  exposureClass: 'OWNER_COMMAND' | 'OWNER_QUERY' | 'PUBLIC_PROTOCOL' | 'INTERNAL_PROTOCOL' | 'AUTOMATED_MAINTENANCE' | 'EVIDENCE_ONLY';
  apiOperationIds: string[];
  uiSurfaceIds: string[];
  uiActionIds: string[];
  chatCapabilityIds: string[];
  auditEventTypes: string[];
  selfTestCaseIds: string[];
  acceptanceGateIds: string[];
  parentOperationId: string | null;
  notApplicableReasons: Array<{ surface: string; reasonCode: string; supportingRequirementSourceRef: string }>;
  surfaceBindings: Array<{ bindingId: string; status: 'APPLICABLE' | 'NOT_APPLICABLE'; sourcePath: string | null; sourceSymbol: string | null; sourceMarker: string | null; target: string | null; reasonCode?: string; supportingRequirementSourceRef?: string }>;
}

const exposureClasses = new Set<ExposureParityContract['exposureClass']>(['OWNER_COMMAND', 'OWNER_QUERY', 'PUBLIC_PROTOCOL', 'INTERNAL_PROTOCOL', 'AUTOMATED_MAINTENANCE', 'EVIDENCE_ONLY']);
const syntheticExposureIds = /^(?:API|UI-ACTION|CHAT|SELFTEST)-/u;

/**
 * Validates the cross-surface contract without resolving source files. The
 * compiler performs the filesystem and route-symbol resolution; this runtime
 * check keeps a tampered generated registry fail-closed at admission too.
 */
export function validateExposureParity(
  operations: readonly Pick<OperationContract, 'operationId' | 'operationName' | 'exposureClass'>[],
  parity: readonly ExposureParityContract[],
): void {
  const operationIds = new Set(operations.map((operation) => operation.operationId));
  const operationById = new Map(operations.map((operation) => [operation.operationId, operation]));
  const parityByOperation = new Map<string, ExposureParityContract>();
  for (const record of parity) {
    if (!exposureClasses.has(record.exposureClass)) throw new Error(`EXPOSURE_PARITY_CLASS_INVALID:${record.operationId}`);
    if (!operationIds.has(record.operationId) || parityByOperation.has(record.operationId)) throw new Error(`EXPOSURE_PARITY_OPERATION_CARDINALITY:${record.operationId}`);
    if (operationById.get(record.operationId)?.exposureClass !== record.exposureClass) throw new Error(`EXPOSURE_PARITY_CLASS_MISMATCH:${record.operationId}`);
    parityByOperation.set(record.operationId, record);
    const bindings = record.surfaceBindings ?? [];
    if (!bindings.length) throw new Error(`EXPOSURE_PARITY_INCOMPLETE:${record.operationId}:surfaceBindings`);
    const bindingIds = new Set<string>();
    for (const binding of bindings) {
      if (!binding.bindingId || bindingIds.has(binding.bindingId)) throw new Error(`EXPOSURE_PARITY_BINDING_CARDINALITY:${record.operationId}`);
      bindingIds.add(binding.bindingId);
      if (syntheticExposureIds.test(binding.bindingId)) throw new Error(`EXPOSURE_PARITY_SYNTHETIC_BINDING:${record.operationId}:${binding.bindingId}`);
      if (binding.status === 'APPLICABLE' && (!binding.sourcePath || !binding.sourceSymbol || !binding.sourceMarker || !binding.target)) throw new Error(`EXPOSURE_PARITY_BINDING_UNRESOLVED:${record.operationId}:${binding.bindingId}`);
      if (binding.status === 'NOT_APPLICABLE' && (!binding.reasonCode || binding.supportingRequirementSourceRef !== 'ssot://55.18/55-18-ui-api-chat-audit-a-self-test-parity/atom-1')) throw new Error(`EXPOSURE_PARITY_NOT_APPLICABLE_UNSUPPORTED:${record.operationId}:${binding.bindingId}`);
    }
    const applicableIds = (prefix: string) => [...bindingIds].filter((bindingId) => bindingId.startsWith(`${prefix}:`));
    const exactIds = (declared: readonly string[], prefix: string) => {
      const expected = applicableIds(prefix);
      return declared.length === expected.length && declared.every((bindingId) => expected.includes(bindingId));
    };
    if (!exactIds(record.apiOperationIds, 'REST_ROUTE') || !exactIds(record.uiSurfaceIds, 'UI_VIEW') || !exactIds(record.uiActionIds, 'UI_ACTION') || !exactIds(record.chatCapabilityIds, 'CHAT_CAPABILITY') || !exactIds(record.selfTestCaseIds, 'TEST_CASE')) throw new Error(`EXPOSURE_PARITY_ID_BINDING_MISMATCH:${record.operationId}`);
    if (!record.uiSurfaceIds.length || !record.chatCapabilityIds.length || !record.auditEventTypes.length || !record.selfTestCaseIds.length || !record.acceptanceGateIds.length) throw new Error(`EXPOSURE_PARITY_INCOMPLETE:${record.operationId}:required-common-surface`);
    if (record.exposureClass === 'OWNER_COMMAND' && (!record.apiOperationIds.length || !record.uiActionIds.length)) throw new Error(`EXPOSURE_PARITY_INCOMPLETE:${record.operationId}:owner-command`);
    if (record.exposureClass !== 'OWNER_COMMAND' && record.uiActionIds.length) throw new Error(`EXPOSURE_PARITY_UNAUTHORIZED_UI_ACTION:${record.operationId}`);
    if (record.exposureClass === 'INTERNAL_PROTOCOL' && (record.apiOperationIds.length || !record.parentOperationId)) throw new Error(`EXPOSURE_PARITY_INCOMPLETE:${record.operationId}:internal-protocol`);
  }
  for (const operation of operations) if (!parityByOperation.has(operation.operationId)) throw new Error(`EXPOSURE_PARITY_INCOMPLETE:${operation.operationName}:record`);
  for (const record of parity) if (record.parentOperationId && !operationIds.has(record.parentOperationId)) throw new Error(`EXPOSURE_PARITY_PARENT_MISSING:${record.operationId}:${record.parentOperationId}`);
}

export interface AuthorityOwnershipRecord extends RegistryRecord {
  authorityObjectKind: string;
  canonicalWriterId: string;
  ownerModule: string;
  ownerServiceOrWorker: string;
  stateMachineId: string;
  allowedOperationIds: string[];
  authoritativePersistence: string[];
  acceptedEvidenceProducers: string[];
  prohibitedDirectWriters: string[];
  projectionConsumers: string[];
  closurePredicateId: string;
}

export interface AuthorityOwnershipRegistry extends RegistryDocument<AuthorityOwnershipRecord> {
  kind: 'AUTHORITY_OWNERSHIP_REGISTRY';
}

export interface StateMachineContract extends RegistryRecord {
  stateMachineId: string;
  states: string[];
  terminalStates: string[];
  transitions: Array<{ transitionId: string; fromState: string; toState: string; operationIds: string[] }>;
}

export function validateAuthorityOwnership(
  operations: readonly OperationContract[],
  authorities: readonly AuthorityOwnershipRecord[],
  stateMachines: readonly StateMachineContract[] = [],
): void {
  const byOperation = new Map<string, AuthorityOwnershipRecord[]>();
  const kinds = new Set<string>();
  for (const authority of authorities) {
    if (authority.lifecycle !== 'ACTIVE') continue;
    if (kinds.has(authority.authorityObjectKind)) throw new Error(`AUTHORITY_OBJECT_KIND_DUPLICATE:${authority.authorityObjectKind}`);
    kinds.add(authority.authorityObjectKind);
    if (!authority.requirementIds.length) throw new Error(`AUTHORITY_REQUIREMENTS_EMPTY:${authority.authorityObjectKind}`);
    if (!authority.allowedOperationIds.every((id) => typeof id === 'string' && id.length > 0)) throw new Error(`AUTHORITY_OPERATION_ID_INVALID:${authority.authorityObjectKind}`);
    if (!authority.acceptedEvidenceProducers.length || !authority.prohibitedDirectWriters.length) throw new Error(`AUTHORITY_EVIDENCE_OR_DENYLIST_EMPTY:${authority.authorityObjectKind}`);
    if (!authority.closurePredicateId || !authority.stateMachineId) throw new Error(`AUTHORITY_STATE_CONTRACT_INCOMPLETE:${authority.authorityObjectKind}`);
    for (const operationId of authority.allowedOperationIds) {
      const owners = byOperation.get(operationId) ?? [];
      owners.push(authority);
      byOperation.set(operationId, owners);
    }
    if (stateMachines.length && !stateMachines.some((machine) => machine.stateMachineId === authority.stateMachineId)) throw new Error(`AUTHORITY_STATE_MACHINE_MISSING:${authority.authorityObjectKind}:${authority.stateMachineId}`);
  }
  for (const operation of operations) {
    const owners = byOperation.get(operation.operationId) ?? [];
    if (owners.length !== 1) throw new Error(`AUTHORITY_OPERATION_CARDINALITY:${operation.operationName}:${owners.length}`);
    const [owner] = owners;
    if (!owner) throw new Error(`AUTHORITY_OPERATION_CARDINALITY:${operation.operationName}:0`);
    if (owner.canonicalWriterId !== operation.canonicalWriterId || owner.stateMachineId !== operation.stateMachineId) throw new Error(`AUTHORITY_OPERATION_CONTRACT_MISMATCH:${operation.operationName}`);
  }
}

export function authorityForOperation(operationId: string, authorities: readonly AuthorityOwnershipRecord[]): AuthorityOwnershipRecord {
  const owners = authorities.filter((authority) => authority.lifecycle === 'ACTIVE' && authority.allowedOperationIds.includes(operationId));
  if (owners.length !== 1) throw new Error(`AUTHORITY_OPERATION_CARDINALITY:${operationId}:${owners.length}`);
  const owner = owners[0];
  if (!owner) throw new Error(`AUTHORITY_OPERATION_CARDINALITY:${operationId}:0`);
  return owner;
}

export function assertStateTransition(
  machine: Pick<StateMachineContract, 'stateMachineId' | 'states' | 'terminalStates' | 'transitions'>,
  currentState: string,
  nextState: string,
  operationId: string,
): void {
  if (!machine.states.includes(currentState) || !machine.states.includes(nextState)) throw new Error(`STATE_NOT_DECLARED:${machine.stateMachineId}`);
  if (machine.terminalStates.includes(currentState)) throw new Error(`TERMINAL_STATE_IMMUTABLE:${machine.stateMachineId}:${currentState}`);
  const transition = machine.transitions.find((candidate) => candidate.fromState === currentState && candidate.toState === nextState);
  if (!transition || !transition.operationIds.includes(operationId)) throw new Error(`STATE_TRANSITION_FORBIDDEN:${machine.stateMachineId}:${currentState}->${nextState}:${operationId}`);
}

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

export async function loadAuthorityOwnershipRegistry(repositoryRoot = process.cwd()): Promise<AuthorityOwnershipRegistry> {
  return loadRegistry<AuthorityOwnershipRecord>('AUTHORITY_OWNERSHIP_REGISTRY', repositoryRoot) as Promise<AuthorityOwnershipRegistry>;
}

export async function operationByName(name: string, repositoryRoot = process.cwd()): Promise<OperationContract> {
  const catalog = await loadOperationCatalog(repositoryRoot);
  const operation = catalog.records.find((candidate) => candidate.operationName === name);
  if (!operation) throw new Error(`Unknown operation: ${name}`);
  return operation;
}
