import { z } from 'zod';

export const faultKindSchema = z.enum([
  'PROCESS_KILL', 'SIGTERM', 'PROCESS_EXIT', 'PROCESS_FREEZE', 'EVENT_LOOP_STALL',
  'SERVICE_RESTART', 'HOST_RESTART', 'RUNTIME_HOST_RESTART', 'BROWSER_HOST_RESTART', 'APPLICATION_SERVICE_RESTART', 'STALE_PROCESS',
  'DATABASE_RESTART', 'DATABASE_CONNECTION_LOSS', 'SERIALIZATION_FAILURE', 'DEADLOCK', 'LOCK_TIMEOUT', 'STATEMENT_TIMEOUT', 'TRANSACTION_ROLLBACK', 'CONSTRAINT_VIOLATION', 'SKIP_LOCKED_CONTENTION',
  'TRANSPORT_DISCONNECT', 'TIMEOUT', 'DNS_FAILURE', 'DNS_DELAY', 'TCP_FAILURE', 'TLS_FAILURE', 'HTTP_TIMEOUT', 'HTTP_DISCONNECT', 'SSE_DISCONNECT', 'UDS_DISCONNECT', 'PARTIAL_FRAME', 'DUPLICATE', 'REORDER', 'DELAYED_DELIVERY',
  'STALE_LEASE', 'STALE_FENCE', 'STALE_STATE_VERSION', 'STALE_REVISION', 'STALE_BINDING', 'STALE_ACTIVATION_EPOCH', 'STALE_DEPLOYMENT_EPOCH', 'STALE_PLATFORM_INCARNATION', 'STALE_RECOVERY_EPOCH', 'STALE_BROWSER_IDENTITY', 'STALE_CONTROL_EPOCH', 'STALE_AUTH_EPOCH', 'STALE_IDENTITY', 'DUPLICATE_COMMAND', 'DUPLICATE_WEBHOOK', 'DUPLICATE_MODEL_RESULT', 'LATE_WORKER_WRITE',
  'CAPACITY_EXHAUSTION', 'QUEUE_SATURATION', 'BROKER_SATURATION', 'FD_EXHAUSTION', 'PID_EXHAUSTION', 'TMPFS_EXHAUSTION', 'STORAGE_EXHAUSTION', 'OOM', 'DISK_FAILURE', 'FILESYSTEM_PERMISSION_FAILURE', 'READ_ONLY_PATH', 'RENAME_FAILURE', 'FSYNC_FAILURE',
  'CREDENTIAL_EXPIRY', 'CREDENTIAL_ROTATION', 'CERTIFICATE_REVOKED', 'RATE_LIMIT', 'PROVIDER_TIMEOUT', 'PROVIDER_FAILURE', 'BROWSER_AUTH_EXPIRY', 'CLEANUP_CAPACITY_EXHAUSTION',
  'BROWSER_LIFECYCLE_RACE', 'PARTIAL_UPLOAD', 'PARTIAL_DOWNLOAD', 'POPUP_RACE', 'DIALOG_RACE', 'CHALLENGE_RACE', 'RENDERER_CRASH', 'BEFORE_AFTER_SIDE_EFFECT', 'POINTER_SWITCH_CRASH', 'CREATE_FAILURE', 'UPDATE_FAILURE', 'REPAIR_FAILURE', 'ROLLBACK_FAILURE', 'CLEANUP_FAILURE',
  'MIGRATION_FAILURE', 'INVALID_INDEX',
]);
export type FaultKind = z.infer<typeof faultKindSchema>;

export const faultPointNameSchema = z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9.-]*\.(before|after)$/u);

export interface FaultPointDeclaration {
  readonly faultPointId: string;
  readonly faultPointName: string;
  readonly operationName: string;
  readonly stateMachineId: string;
  readonly phase: string;
  readonly side: 'before' | 'after';
  readonly sourceLocation: { readonly repositoryPath: string; readonly symbol: string; readonly marker: string };
  readonly possibleEffectClass: string;
  readonly applicableFaultKinds: readonly FaultKind[];
  readonly expectedRecoveryOracleId: string;
  readonly expectedCanonicalOutcomeClasses: readonly string[];
  readonly requiredDirectStateQueries: readonly string[];
  readonly requiredCleanupChecks: readonly string[];
  readonly testCaseIds: readonly string[];
  readonly coverageStatus: 'DECLARED' | 'COVERED' | 'UNCOVERED';
  readonly requirementIds: readonly string[];
  readonly authoritySourceRefs: readonly string[];
}

export interface FaultHookContext {
  readonly logicalOperationId?: string;
  readonly operationId?: string;
  readonly correlationId?: string;
  readonly commandId?: string;
  readonly targetId?: string | null;
  readonly stateVersion?: bigint | string | number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface FaultHarnessCapability {
  readonly capabilityId: 'KCML_DISPOSABLE_FAULT_HARNESS_V1';
  readonly namespace: 'TEST' | 'DISPOSABLE';
  readonly catalogDigest: string;
  readonly allowedFaultPointIds: readonly string[];
  readonly inject: (point: FaultPointDeclaration, context: FaultHookContext) => void | Promise<void>;
  readonly onDenied?: (reason: string, pointId: string) => void | Promise<void>;
}

const installedCapabilities = new Set<FaultHarnessCapability>();
let activeCapability: FaultHarnessCapability | null = null;
let activeCatalog = new Map<string, FaultPointDeclaration>();

/** Inert in production; only an explicitly supplied disposable capability can activate it. */
export function installFaultHarnessCapability(capability: FaultHarnessCapability, catalog: readonly FaultPointDeclaration[]): () => void {
  if (capability.capabilityId !== 'KCML_DISPOSABLE_FAULT_HARNESS_V1') throw new Error('FAULT_HARNESS_CAPABILITY_INVALID');
  if (capability.namespace !== 'TEST' && capability.namespace !== 'DISPOSABLE') throw new Error('FAULT_HARNESS_NAMESPACE_INVALID');
  const known = new Set(catalog.map((point) => point.faultPointId));
  if (capability.allowedFaultPointIds.some((pointId) => !known.has(pointId))) throw new Error('FAULT_HARNESS_POINT_NOT_ALLOWLISTED');
  if (installedCapabilities.has(capability)) throw new Error('FAULT_HARNESS_ALREADY_INSTALLED');
  installedCapabilities.add(capability);
  activeCapability = capability;
  activeCatalog = new Map(catalog.map((point) => [point.faultPointId, point]));
  return () => {
    if (activeCapability === capability) { activeCapability = null; activeCatalog = new Map(); }
    installedCapabilities.delete(capability);
  };
}

export async function invokeFaultHook(point: FaultPointDeclaration, context: FaultHookContext = {}): Promise<void> {
  const capability = activeCapability;
  if (!capability || activeCatalog.get(point.faultPointId) !== point || !capability.allowedFaultPointIds.includes(point.faultPointId)) {
    await capability?.onDenied?.('FAULT_ACTIVATION_DENIED', point.faultPointId);
    return;
  }
  await capability.inject(point, context);
}

export function faultHarnessActive(): boolean { return activeCapability !== null; }
