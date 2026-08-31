import { canonicalDigest, digestSchema, z, type CanonicalJsonValue } from '@kcml/schemas';

export const provenanceSourceSchema = z.object({
  sourceRef: z.string().min(1),
  sourceKind: z.enum(['OWNER_MESSAGE','OWNER_DOCUMENT','SSOT','TOOL_RESULT','BROWSER_OBSERVATION','SYSTEM_STATE']),
  trustClass: z.enum(['OWNER_AUTHORITY','TRUSTED_PLATFORM','UNTRUSTED_CONTENT']),
  contentDigest: digestSchema,
  observedAt: z.string().datetime({ offset: true })
}).strict();

export const valueDerivationSchema = z.object({
  fieldPath: z.string().min(1),
  valueDigest: digestSchema,
  derivationKind: z.enum(['COPIED','NORMALIZED','CALCULATED','MODEL_PROPOSED','OWNER_CONFIRMED']),
  sourceRefs: z.array(z.string().min(1)).min(1),
  expression: z.string().nullable()
}).strict();

export const provenanceEnvelopeSchema = z.object({
  sources: z.array(provenanceSourceSchema),
  derivations: z.array(valueDerivationSchema),
  untrustedInstructionsIgnored: z.array(z.string()),
  digest: digestSchema
}).strict();
export type ProvenanceEnvelope = z.infer<typeof provenanceEnvelopeSchema>;

export function compileProvenance(input: Omit<ProvenanceEnvelope, 'digest'>): ProvenanceEnvelope {
  return provenanceEnvelopeSchema.parse({ ...input, digest: canonicalDigest(input as unknown as CanonicalJsonValue) });
}

export function assertNoUntrustedAuthority(envelope: ProvenanceEnvelope, authoritySourceRefs: readonly string[]): void {
  const untrusted = new Set(envelope.sources.filter((source) => source.trustClass === 'UNTRUSTED_CONTENT').map((source) => source.sourceRef));
  const violation = authoritySourceRefs.find((reference) => untrusted.has(reference));
  if (violation) throw new Error(`UNTRUSTED_CONTENT_CANNOT_GRANT_AUTHORITY:${violation}`);
}
