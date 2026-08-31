import { digestSchema, uuidSchema, z } from '@kcml/schemas';

export const runtimeBuildManifestSchema = z.object({
  buildId: z.string().min(1),
  playwrightVersion: z.string().min(1),
  chromiumRevision: z.string().min(1),
  firefoxRevision: z.string().min(1),
  webkitRevision: z.string().min(1),
  executableDigests: z.record(z.string(), digestSchema),
  capabilityDigest: digestSchema,
  createdAt: z.string().datetime({ offset: true })
}).strict();
export type RuntimeBuildManifest = z.infer<typeof runtimeBuildManifestSchema>;

export const browserObservationSchema = z.object({
  observationId: uuidSchema,
  sessionId: uuidSchema,
  observationRevision: z.coerce.bigint().positive(),
  contextGeneration: z.coerce.bigint().nonnegative(),
  pageId: uuidSchema,
  pageGeneration: z.coerce.bigint().nonnegative(),
  frameId: uuidSchema,
  documentEpoch: z.coerce.bigint().nonnegative(),
  url: z.string().url(),
  title: z.string(),
  viewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive(), deviceScaleFactor: z.number().positive() }).strict(),
  semanticSnapshot: z.record(z.string(), z.unknown()),
  networkSummary: z.record(z.string(), z.unknown()),
  consoleSummary: z.record(z.string(), z.unknown()),
  screenshotArtifactId: uuidSchema.nullable(),
  digest: digestSchema,
  observedAt: z.string().datetime({ offset: true })
}).strict();
export type BrowserObservation = z.infer<typeof browserObservationSchema>;

export const targetReferenceSchema = z.object({
  targetReferenceId: uuidSchema,
  sessionId: uuidSchema,
  pageId: uuidSchema,
  frameId: uuidSchema,
  documentEpoch: z.coerce.bigint().nonnegative(),
  semanticDescription: z.string().min(1),
  locatorAst: z.record(z.string(), z.unknown()),
  fingerprint: digestSchema,
  createdFromObservationRevision: z.coerce.bigint().positive()
}).strict();
export type TargetReference = z.infer<typeof targetReferenceSchema>;

export const actionOutcomeSchema = z.object({
  actionId: uuidSchema,
  phase: z.enum(['INTENT_RECORDED','TARGET_RESOLVED','PRECONDITION_VERIFIED','DISPATCH_AUTHORIZED','POSSIBLE_EFFECT','OUTCOME_OBSERVED','RECONCILING','CONFIRMED_APPLIED','CONFIRMED_NOT_APPLIED','FAILED_FINAL','UNKNOWN']),
  possibleSideEffect: z.boolean(),
  retryAllowed: z.boolean(),
  observation: browserObservationSchema.nullable(),
  evidence: z.record(z.string(), z.unknown())
}).strict();
export type ActionOutcome = z.infer<typeof actionOutcomeSchema>;

export function assertObservationFence(reference: TargetReference, observation: BrowserObservation): void {
  if (reference.sessionId !== observation.sessionId || reference.pageId !== observation.pageId || reference.frameId !== observation.frameId || reference.documentEpoch !== observation.documentEpoch) {
    throw new Error('BROWSER_TARGET_REFERENCE_STALE');
  }
  if (reference.createdFromObservationRevision > observation.observationRevision) throw new Error('BROWSER_OBSERVATION_REGRESSION');
}
