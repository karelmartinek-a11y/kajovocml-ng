import { canonicalDigest, canonicalJson, digestSchema, uuidSchema, z, type CanonicalJsonValue } from '@kcml/schemas';

export const authorityKindSchema = z.enum(['OWNER_FULL', 'DELEGATED_OPERATION', 'SYSTEM_RECONCILIATION']);
export const argumentOriginSchema = z.enum(['OWNER_LITERAL', 'OWNER_DOCUMENT', 'TRUSTED_STATE', 'TOOL_RESULT', 'MODEL_DERIVED']);

export const authorityLineageSchema = z.object({
  lineageId: uuidSchema,
  authorityKind: authorityKindSchema,
  sourceOwnerMessageId: uuidSchema.nullable(),
  sourceSpecificationRevisionId: uuidSchema.nullable(),
  operationContextDigest: digestSchema,
  exactBindingDigest: digestSchema.nullable(),
  targetOperation: z.string().min(1),
  targetId: uuidSchema.nullable(),
  argumentOrigins: z.record(z.string(), z.object({ origin: argumentOriginSchema, sourceRef: z.string().min(1), valueDigest: digestSchema }).strict()),
  secretUseContexts: z.array(z.object({ secretId: uuidSchema, targetIdentity: z.string(), operation: z.string(), purpose: z.string(), expiresAt: z.string().datetime({ offset: true }) }).strict()),
  createdAt: z.string().datetime({ offset: true }),
  digest: digestSchema
}).strict();
export type AuthorityLineage = z.infer<typeof authorityLineageSchema>;

export interface CompileAuthorityInput {
  lineageId: string;
  authorityKind: z.infer<typeof authorityKindSchema>;
  sourceOwnerMessageId?: string | null;
  sourceSpecificationRevisionId?: string | null;
  operationContextDigest: string;
  exactBindingDigest?: string | null;
  targetOperation: string;
  targetId?: string | null;
  arguments: Record<string, { value: CanonicalJsonValue; origin: z.infer<typeof argumentOriginSchema>; sourceRef: string }>;
  secretUseContexts?: Array<{ secretId: string; targetIdentity: string; operation: string; purpose: string; expiresAt: string }>;
  createdAt: string;
}

export function compileAuthorityLineage(input: CompileAuthorityInput): AuthorityLineage {
  const unsigned = {
    lineageId: input.lineageId,
    authorityKind: input.authorityKind,
    sourceOwnerMessageId: input.sourceOwnerMessageId ?? null,
    sourceSpecificationRevisionId: input.sourceSpecificationRevisionId ?? null,
    operationContextDigest: input.operationContextDigest,
    exactBindingDigest: input.exactBindingDigest ?? null,
    targetOperation: input.targetOperation,
    targetId: input.targetId ?? null,
    argumentOrigins: Object.fromEntries(Object.entries(input.arguments).map(([name, value]) => [name, {
      origin: value.origin, sourceRef: value.sourceRef, valueDigest: canonicalDigest(value.value)
    }])),
    secretUseContexts: input.secretUseContexts ?? [],
    createdAt: input.createdAt
  };
  return authorityLineageSchema.parse({ ...unsigned, digest: canonicalDigest(unsigned as unknown as CanonicalJsonValue) });
}

export function verifyAuthorityLineage(lineage: AuthorityLineage): boolean {
  const parsed = authorityLineageSchema.parse(lineage);
  const { digest, ...unsigned } = parsed;
  return digest === canonicalDigest(JSON.parse(canonicalJson(unsigned as unknown as CanonicalJsonValue)) as CanonicalJsonValue);
}

export function assertSecretUse(lineage: AuthorityLineage, secretId: string, targetIdentity: string, operation: string, now = new Date()): void {
  const context = lineage.secretUseContexts.find((item) => item.secretId === secretId && item.targetIdentity === targetIdentity && item.operation === operation);
  if (!context || new Date(context.expiresAt) <= now) throw new Error('SECRET_USE_CONTEXT_REQUIRED');
}
