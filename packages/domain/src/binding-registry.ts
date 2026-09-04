import { canonicalJson, digestSchema, z, type CanonicalJsonValue } from '@kcml/schemas';
import { DomainError } from './errors.js';

export const bindingKinds = [
  'CONTRACT_BINDING',
  'SECRET_BINDING',
  'EXTERNAL_TARGET_BINDING',
  'EXTERNAL_AUTH_BINDING',
  'AGENT_TOOL_BINDING',
  'BROWSER_ACCOUNT_BINDING',
  'BROWSER_PROFILE_ASSIGNMENT',
  'ACTIVATION_SET_MEMBERSHIP',
  'ROUTE_BINDING'
] as const;

export type BindingKind = typeof bindingKinds[number];

const bindingKindSchema = z.enum(bindingKinds);
const nullableString = z.string().min(1).nullable();
const nullableJsonObject = z.record(z.string(), z.unknown()).nullable();

/** The immutable, server-authored shape used by runtime admission. */
export const exactBindingRecordSchema = z.object({
  recordId: z.string().min(1),
  recordKind: z.literal('BINDING_REGISTRY'),
  schemaVersion: z.literal('1.0'),
  sourceRelations: z.array(z.unknown()).min(1),
  canonicalName: z.string().min(1),
  supersedes: z.array(z.string()),
  supersededBy: z.array(z.string()),
  extensions: z.record(z.string(), z.unknown()),
  bindingId: z.string().min(1),
  bindingKind: bindingKindSchema,
  bindingRevision: z.coerce.bigint().positive(),
  bindingDigest: digestSchema,
  sourceObjectId: z.string().min(1),
  sourceRevisionId: z.string().min(1),
  targetObjectId: z.string().min(1),
  targetRevisionId: nullableString,
  targetOperationOrRoute: z.string().min(1),
  contractSchemaDigest: digestSchema,
  secretVersionSelector: nullableJsonObject,
  externalTargetOrOrigin: nullableString,
  accountOrTenantConstraint: nullableJsonObject,
  purpose: z.string().min(1),
  lifecycle: z.enum(['ACTIVE', 'SUPERSEDED', 'RETIRED']),
  bindingSetRevision: z.string().min(1),
  activationSetId: z.string().min(1),
  activationEpoch: z.coerce.bigint().nonnegative(),
  validFrom: z.string().datetime({ offset: true }).nullable(),
  validUntil: z.string().datetime({ offset: true }).nullable(),
  canonicalWriterId: z.string().min(1),
  targetOperationId: nullableString,
  routeOperationId: nullableString,
  contractDigest: digestSchema,
  exact: z.literal(true),
  requirementIds: z.array(z.string().min(1)).min(1),
  authoritySourceRefs: z.array(z.string().min(1)).min(1),
  canonicalDigest: digestSchema
}).strict();

export type ExactBindingRecord = z.infer<typeof exactBindingRecordSchema>;

export interface RuntimeBindingRequest {
  bindingId: string;
  bindingRevision: bigint | number | string;
  bindingDigest: string;
  sourceObjectId: string;
  sourceRevisionId: string;
  targetObjectId: string;
  targetRevisionId: string | null;
  targetOperationOrRoute: string;
  contractSchemaDigest: string;
  secretVersionSelector?: Record<string, unknown> | null;
  externalTargetOrOrigin?: string | null;
  accountOrTenantConstraint?: Record<string, unknown> | null;
  purpose: string;
  bindingSetRevision: string;
  activationSetId: string;
  activationEpoch: bigint | number | string;
  now?: Date;
}

export interface RuntimeBindingPin {
  bindingId: string;
  bindingKind: BindingKind;
  bindingRevision: bigint;
  bindingDigest: string;
  sourceObjectId: string;
  sourceRevisionId: string;
  targetObjectId: string;
  targetRevisionId: string | null;
  targetOperationOrRoute: string;
  contractSchemaDigest: string;
  secretVersionSelector: Record<string, unknown> | null;
  externalTargetOrOrigin: string | null;
  accountOrTenantConstraint: Record<string, unknown> | null;
  purpose: string;
  bindingSetRevision: string;
  activationSetId: string;
  activationEpoch: bigint;
}

const jsonValue = (value: unknown): CanonicalJsonValue => JSON.parse(JSON.stringify(value ?? null)) as CanonicalJsonValue;
const sameJson = (left: unknown, right: unknown): boolean => canonicalJson(jsonValue(left)) === canonicalJson(jsonValue(right));

function reject(code: string, message: string, details: Record<string, unknown>): never {
  throw new DomainError('BINDING_REVISION_STALE', `${code}: ${message}`, 409, 'REFRESH_AND_RETRY_NEW_COMMAND', { ...details, bindingReason: code });
}

function requireEqual(field: string, actual: unknown, expected: unknown): void {
  if (String(actual) !== String(expected)) reject(`BINDING_${field.toUpperCase()}_MISMATCH`, `Exact binding ${field} does not match the server snapshot`, { field, expected, actual });
}

function requireJsonEqual(field: string, actual: unknown, expected: unknown): void {
  if (!sameJson(actual, expected)) reject(`BINDING_${field.toUpperCase()}_MISMATCH`, `Exact binding ${field} does not match the server snapshot`, { field });
}

/** Validate registry invariants before a record can be used for dispatch. */
export function validateExactBindingRecord(value: unknown): ExactBindingRecord {
  const record = exactBindingRecordSchema.parse(value);
  if (record.bindingId.includes('*') || record.sourceObjectId.includes('*') || record.targetObjectId.includes('*')) reject('BINDING_WILDCARD_FORBIDDEN', 'Wildcard source or target is not representable as an exact binding', { bindingId: record.bindingId });
  if (record.targetOperationOrRoute.includes('*')) reject('BINDING_TARGET_WILDCARD_FORBIDDEN', 'Wildcard operation or route is not an exact binding', { bindingId: record.bindingId });
  if (record.bindingKind === 'SECRET_BINDING' && record.secretVersionSelector === null) reject('BINDING_SECRET_VERSION_REQUIRED', 'A secret binding must pin a version selector', { bindingId: record.bindingId });
  if (record.bindingKind === 'BROWSER_ACCOUNT_BINDING' && record.accountOrTenantConstraint === null) reject('BINDING_ACCOUNT_CONSTRAINT_REQUIRED', 'A browser account binding must pin account or tenant identity', { bindingId: record.bindingId });
  if (record.activationSetId.length === 0 || record.bindingSetRevision.length === 0) reject('BINDING_ACTIVATION_RELATION_REQUIRED', 'Every binding must be related to an activation set and binding-set revision', { bindingId: record.bindingId });
  return record;
}

/**
 * Pin one immutable active record to one runtime dispatch. Every salient
 * identity is compared before a handler, broker, browser, route or external
 * side effect can be reached.
 */
export function pinRuntimeBinding(recordValue: unknown, request: RuntimeBindingRequest, now = request.now ?? new Date()): RuntimeBindingPin {
  const record = validateExactBindingRecord(recordValue);
  if (record.lifecycle !== 'ACTIVE') reject('BINDING_NOT_ACTIVE', 'Only an active exact binding may be dispatched', { bindingId: record.bindingId, lifecycle: record.lifecycle });
  requireEqual('id', record.bindingId, request.bindingId);
  requireEqual('revision', record.bindingRevision, request.bindingRevision);
  requireEqual('digest', record.bindingDigest, request.bindingDigest);
  requireEqual('source_object_id', record.sourceObjectId, request.sourceObjectId);
  requireEqual('source_revision', record.sourceRevisionId, request.sourceRevisionId);
  requireEqual('target_object_id', record.targetObjectId, request.targetObjectId);
  requireEqual('target_revision', record.targetRevisionId, request.targetRevisionId);
  requireEqual('operation_or_route', record.targetOperationOrRoute, request.targetOperationOrRoute);
  requireEqual('contract_schema_digest', record.contractSchemaDigest, request.contractSchemaDigest);
  requireEqual('purpose', record.purpose, request.purpose);
  requireEqual('binding_set_revision', record.bindingSetRevision, request.bindingSetRevision);
  requireEqual('activation_set_id', record.activationSetId, request.activationSetId);
  requireEqual('activation_epoch', record.activationEpoch, request.activationEpoch);
  requireJsonEqual('secret_version', record.secretVersionSelector, request.secretVersionSelector ?? null);
  requireEqual('external_target', record.externalTargetOrOrigin, request.externalTargetOrOrigin ?? null);
  requireJsonEqual('account_constraint', record.accountOrTenantConstraint, request.accountOrTenantConstraint ?? null);
  if (record.validFrom && now < new Date(record.validFrom)) reject('BINDING_NOT_YET_VALID', 'Binding validity has not started', { bindingId: record.bindingId });
  if (record.validUntil && now >= new Date(record.validUntil)) reject('BINDING_EXPIRED', 'Binding validity has expired', { bindingId: record.bindingId });
  return {
    bindingId: record.bindingId,
    bindingKind: record.bindingKind,
    bindingRevision: record.bindingRevision,
    bindingDigest: record.bindingDigest,
    sourceObjectId: record.sourceObjectId,
    sourceRevisionId: record.sourceRevisionId,
    targetObjectId: record.targetObjectId,
    targetRevisionId: record.targetRevisionId,
    targetOperationOrRoute: record.targetOperationOrRoute,
    contractSchemaDigest: record.contractSchemaDigest,
    secretVersionSelector: record.secretVersionSelector,
    externalTargetOrOrigin: record.externalTargetOrOrigin,
    accountOrTenantConstraint: record.accountOrTenantConstraint,
    purpose: record.purpose,
    bindingSetRevision: record.bindingSetRevision,
    activationSetId: record.activationSetId,
    activationEpoch: record.activationEpoch
  };
}

export const validateRuntimeBinding = pinRuntimeBinding;

export class BindingRegistry {
  readonly #records: ReadonlyMap<string, ExactBindingRecord>;

  public constructor(records: readonly unknown[]) {
    const parsed = records.map(validateExactBindingRecord);
    const byId = new Map<string, ExactBindingRecord>();
    for (const record of parsed) {
      if (byId.has(record.bindingId)) throw new Error(`BINDING_ID_DUPLICATE:${record.bindingId}`);
      byId.set(record.bindingId, record);
    }
    const presentKinds = new Set(parsed.map((record) => record.bindingKind));
    for (const kind of bindingKinds) if (!presentKinds.has(kind)) throw new Error(`BINDING_KIND_MISSING:${kind}`);
    this.#records = byId;
  }

  public get(bindingId: string): ExactBindingRecord {
    const record = this.#records.get(bindingId);
    if (!record) throw new DomainError('KCIP_BINDING_NOT_ACTIVE', 'Exact binding is not present in the active registry', 404, 'DO_NOT_RETRY', { bindingId });
    return record;
  }

  public pin(request: RuntimeBindingRequest): RuntimeBindingPin {
    return pinRuntimeBinding(this.get(request.bindingId), request);
  }

  public records(): readonly ExactBindingRecord[] {
    return [...this.#records.values()];
  }
}
