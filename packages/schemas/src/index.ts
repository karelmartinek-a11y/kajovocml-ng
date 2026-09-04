import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
export * from './faults.js';

export const uuidSchema = z.string().uuid();
export const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
export const nonNegativeBigIntSchema = z.coerce.bigint().nonnegative();

export const canonicalJsonValueSchema: z.ZodType<CanonicalJsonValue> = z.lazy(() => z.union([
  z.null(), z.boolean(), z.number().finite(), z.string(), z.array(canonicalJsonValueSchema), z.record(z.string(), canonicalJsonValueSchema)
]));

export type CanonicalJsonValue = null | boolean | number | string | CanonicalJsonValue[] | { [key: string]: CanonicalJsonValue };

export class CanonicalJsonConversionError extends TypeError {
  public constructor(
    public readonly path: string,
    public readonly valueKind: string
  ) {
    super(`Value at ${path} is not representable as canonical JSON (${valueKind})`);
    this.name = 'CanonicalJsonConversionError';
  }
}

/**
 * Materialize the one JSON representation used by persistence, digests,
 * idempotency replay and transports.  The conversion is intentionally strict:
 * silently dropping a function/symbol or accepting a class instance would make
 * the persisted outcome differ from the response digest.
 */
export function toCanonicalJsonValue(value: unknown): CanonicalJsonValue {
  const ancestors = new Set<object>();
  const visit = (input: unknown, path: string): CanonicalJsonValue => {
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'bigint') return input.toString(10);
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) throw new CanonicalJsonConversionError(path, 'non-finite number');
      return Object.is(input, -0) ? 0 : input;
    }
    if (typeof input === 'undefined' || typeof input === 'function' || typeof input === 'symbol') {
      throw new CanonicalJsonConversionError(path, typeof input);
    }
    if (input instanceof Date) {
      if (Number.isNaN(input.getTime())) throw new CanonicalJsonConversionError(path, 'invalid Date');
      return input.toISOString();
    }
    if (typeof input !== 'object') throw new CanonicalJsonConversionError(path, typeof input);
    if (ancestors.has(input)) throw new CanonicalJsonConversionError(path, 'cycle');
    const prototype = Object.getPrototypeOf(input);
    if (!Array.isArray(input) && prototype !== Object.prototype && prototype !== null) {
      throw new CanonicalJsonConversionError(path, prototype?.constructor?.name ?? 'unknown prototype');
    }
    ancestors.add(input);
    try {
      if (Array.isArray(input)) return input.map((item, index) => visit(item, `${path}[${index}]`));
      const output: Record<string, CanonicalJsonValue> = {};
      for (const key of Object.keys(input).sort((left, right) => left.localeCompare(right))) {
        output[key] = visit((input as Record<string, unknown>)[key], `${path}.${key}`);
      }
      return output;
    } finally {
      ancestors.delete(input);
    }
  };
  return visit(value, '$');
}

export function canonicalJson(value: CanonicalJsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
}

export function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function canonicalDigest(value: CanonicalJsonValue): string {
  return sha256(canonicalJson(value));
}

export const retryDirectiveSchema = z.enum([
  'DO_NOT_RETRY', 'RETRY_SAME_OPERATION', 'REFRESH_AND_RETRY_NEW_COMMAND', 'RECONCILE_THEN_RETRY', 'MANUAL_REVIEW'
]);
export type RetryDirective = z.infer<typeof retryDirectiveSchema>;

export const accessBindingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('OWNER_FULL') }).strict(),
  z.object({ kind: z.literal('CONTRACT'), bindingId: uuidSchema, bindingRevision: z.number().int().positive(), bindingDigest: digestSchema }).strict(),
  z.object({ kind: z.literal('EXTERNAL'), bindingId: uuidSchema, bindingRevision: z.number().int().positive(), bindingDigest: digestSchema }).strict()
]);

export const executionContextSchema = z.object({
  executionId: uuidSchema,
  logicalOperationId: uuidSchema,
  source: z.object({ componentId: uuidSchema.nullable(), revisionId: uuidSchema.nullable(), releaseId: z.string().min(1) }).strict(),
  target: z.object({ componentId: uuidSchema, revisionId: uuidSchema, operation: z.string().min(1) }).strict(),
  binding: accessBindingSchema,
  platformIncarnationId: uuidSchema,
  applicationDeploymentEpoch: nonNegativeBigIntSchema,
  activationEpoch: nonNegativeBigIntSchema,
  bindingSetRevision: nonNegativeBigIntSchema,
  runtimeGeneration: nonNegativeBigIntSchema,
  recoveryEpoch: nonNegativeBigIntSchema,
  deadlineAt: z.string().datetime({ offset: true }),
  cancellationVersion: nonNegativeBigIntSchema,
  correlationId: uuidSchema,
  causationId: uuidSchema.nullable(),
  digest: digestSchema
}).strict();
export type ExecutionContext = z.infer<typeof executionContextSchema>;

export const operationCommandSchema = z.object({
  operation: z.string().min(1),
  targetId: uuidSchema.nullable().default(null),
  arguments: z.record(z.string(), z.unknown()).default({}),
  expectedStateVersion: nonNegativeBigIntSchema.nullable().default(null),
  expectedActivationEpoch: nonNegativeBigIntSchema.nullable().default(null),
  deadlineAt: z.string().datetime({ offset: true }).nullable().default(null)
}).strict();
export type OperationCommand = z.infer<typeof operationCommandSchema>;

export const operationMetadataSchema = z.object({
  correlationId: uuidSchema,
  logicalOperationId: uuidSchema,
  commandId: uuidSchema,
  stateVersion: nonNegativeBigIntSchema,
  eventSequence: nonNegativeBigIntSchema,
  activationEpoch: nonNegativeBigIntSchema,
  resultDigest: digestSchema,
  idempotencyReplay: z.boolean(),
  serverTime: z.string().datetime({ offset: true })
}).strict();
export type OperationMetadata = z.infer<typeof operationMetadataSchema>;

export const operationResultSchema = z.object({
  status: z.enum(['ACCEPTED', 'SUCCEEDED', 'FAILED_FINAL', 'CANCELLED_FINAL', 'MANUAL_REVIEW']),
  metadata: operationMetadataSchema,
  result: z.unknown().nullable(),
  error: z.object({ code: z.string(), message: z.string(), classification: z.string(), sideEffectPoint: z.string(), retryDirective: retryDirectiveSchema, recordDigest: digestSchema, details: z.unknown().nullable() }).strict().nullable()
}).strict();
export type OperationResult = z.infer<typeof operationResultSchema>;

export const kcipEnvelopeSchema = z.object({
  kcip: z.literal('KCIP/1.0'),
  messageId: uuidSchema,
  messageType: z.enum(['REQUEST', 'RESPONSE', 'EVENT', 'ACK', 'ERROR', 'CANCEL']),
  operation: z.string().min(1),
  correlationId: uuidSchema,
  causationId: uuidSchema.nullable(),
  idempotencyKey: z.string().min(1).max(256).nullable(),
  sentAt: z.string().datetime({ offset: true }),
  deadlineAt: z.string().datetime({ offset: true }).nullable(),
  payloadSchemaDigest: digestSchema,
  payloadDigest: digestSchema,
  payload: z.unknown()
}).strict();
export type KcipEnvelope = z.infer<typeof kcipEnvelopeSchema>;

export const ownerLoginSchema = z.object({ username: z.string().min(1).max(128), password: z.string().min(1).max(4096), mfaContinuation: z.string().min(1).max(4096).optional() }).strict();
export const mfaChallengeSchema = z.object({ challengeId: uuidSchema, code: z.string().regex(/^\d{6}$|^[A-Z0-9-]{8,64}$/u), trustDevice: z.boolean().default(false) }).strict();

export const secretInputSchema = z.object({
  stableName: z.string().regex(/^[A-Z][A-Z0-9_]{1,127}$/u),
  displayName: z.string().min(1).max(200),
  kind: z.enum(['PASSWORD', 'API_KEY', 'TOKEN', 'TOTP', 'CERTIFICATE', 'PRIVATE_KEY', 'OPAQUE']),
  value: z.string().min(1).max(1_048_576),
  metadata: z.record(z.string(), z.unknown()).default({})
}).strict();

export const generationJobInputSchema = z.object({
  mode: z.enum(['CREATE', 'UPDATE', 'FOLLOW_UP', 'RETRY', 'REPAIR']),
  objective: z.string().min(1).max(200_000),
  targetObjectIds: z.array(uuidSchema).max(256).default([]),
  sourceArtifactIds: z.array(uuidSchema).max(256).default([]),
  model: z.string().min(1).max(128).nullable().default(null)
}).strict();

export const browserSessionInputSchema = z.object({
  purpose: z.string().min(1).max(500),
  targetUrl: z.string().url(),
  executionTarget: z.enum(['SERVER_MANAGED', 'OWNER_DEVICE_BRIDGE']),
  accountBindingId: uuidSchema.nullable().default(null),
  operationScope: z.record(z.string(), z.unknown()).default({})
}).strict();

export const browserActionInputSchema = z.object({
  sessionId: uuidSchema,
  action: z.enum(['NAVIGATE', 'CLICK', 'FILL', 'TYPE', 'KEYBOARD', 'POINTER', 'TOUCH', 'UPLOAD', 'DOWNLOAD', 'DIALOG', 'PERMISSION', 'CHALLENGE', 'OBSERVE']),
  targetReferenceId: uuidSchema.nullable().default(null),
  payload: z.record(z.string(), z.unknown()).default({}),
  expectedControlEpoch: nonNegativeBigIntSchema,
  expectedDocumentEpoch: nonNegativeBigIntSchema,
  expectedObservationRevision: nonNegativeBigIntSchema
}).strict();

export const paginationSchema = z.object({ cursor: z.string().max(2048).nullable().default(null), limit: z.coerce.number().int().min(1).max(200).default(50) }).strict();

export function newCorrelationId(): string {
  return randomUUID();
}

export * from './error-retry-registry.js';
export * from './error-codes.generated.js';
export { z };
