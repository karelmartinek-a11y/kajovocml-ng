import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, mkdir, open, readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createConnection, type Socket } from 'node:net';
import type { DatabaseClient, DatabasePool } from '@kcml/database';
import { inTransactionProfile } from '@kcml/database';
import type { StructuredLogger } from '@kcml/observability';
import { canonicalJson, toCanonicalJsonValue, z } from '@kcml/schemas';
import { consumeRuntimeFrames, encodeRuntimeFrame, RUNTIME_IPC_PROTOCOL, type RuntimeFrame } from '@kcml/runtime-capability-ipc';
import { launchTrustedRuntime, type RuntimeHandle, type RuntimeLaunchSpec } from '@kcml/runtime-boundary';
import { runtimeHostUnit } from './runtime-systemd.js';

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const RELATIVE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\0)[A-Za-z0-9._/@+-]+(?:\/[A-Za-z0-9._/@+-]+)*$/u;
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/u;
const GATEWAY_PATH = '/run/kajovocml-ng/gateway/runtime-gateway.sock';
const RUNTIME_ROOT = '/var/lib/kajovocml-ng/runtime/instances';
const HANDLER_READY_TIMEOUT_MS = 20_000;

const toolSchema = z.object({
  name: z.string().regex(TOOL_NAME),
  inputSchema: z.record(z.string(), z.unknown()),
  outputSchema: z.record(z.string(), z.unknown()),
}).strict();

const generatedRuntimeSchema = z.object({
  kind: z.literal('NODE24_GENERATED_HANDLER'),
  executable: z.string().regex(RELATIVE_PATH),
  executableDigest: z.string().regex(DIGEST),
  nodeBootstrap: z.string().regex(RELATIVE_PATH),
  handlerEntrypoint: z.string().regex(RELATIVE_PATH),
  handlerDigest: z.string().regex(DIGEST),
  stateSchemaRevision: z.string().min(1).max(256),
  cleanupInventoryTemplate: z.record(z.string(), z.unknown()),
}).strict();

const componentManifestSchema = z.object({
  runtime: generatedRuntimeSchema,
  tools: z.array(toolSchema).max(512),
}).passthrough();

type GeneratedRuntimeManifest = z.infer<typeof generatedRuntimeSchema>;
type ToolContract = z.infer<typeof toolSchema>;

export interface RuntimeLaunchManifest {
  readonly schemaVersion: 'KCML-RUNTIME-LAUNCH-MANIFEST/1';
  readonly componentId: string;
  readonly sourceRevisionId: string;
  readonly releaseId: string;
  readonly artifactDigest: string;
  readonly runtimeDigest: string;
  readonly dependencyLockDigest: string;
  readonly bindingSetRevisionId: string;
  readonly activationEpoch: string;
  readonly applicationDeploymentEpoch: string;
  readonly platformIncarnationId: string;
  readonly runtimeInstanceId: string;
  readonly runtimeGeneration: string;
  readonly systemdUnitName: string;
  readonly expectedServiceClass: 'kcml-runtime-host';
  readonly resourceProfileDigest: string;
  readonly namespaceProfileDigest: string;
  readonly seccompProfileDigest: string;
  readonly environmentProfileDigest: string;
  readonly fdProfileDigest: string;
  readonly handlerEntrypoint: string;
  readonly handlerDigest: string;
  readonly executable: string;
  readonly executableDigest: string;
  readonly nodeBootstrap: string;
  readonly exportDigest: string;
  readonly inputSchemaDigest: string;
  readonly outputSchemaDigest: string;
  readonly stateSchemaRevision: string;
  readonly cleanupInventoryTemplate: Readonly<Record<string, unknown>>;
}

interface RuntimeLaunchPlan {
  readonly manifest: RuntimeLaunchManifest;
  readonly manifestDigest: string;
  readonly releaseDirectory: string;
  readonly linuxUid: number;
  readonly linuxGid: number;
  readonly tools: readonly ToolContract[];
}

interface GatewayChannel {
  readonly socket: Socket;
  readonly connectionId: string;
  readonly invocationId: string;
  close(): void;
}

interface HandlerHandshake {
  readonly exportDigest: string;
  readonly inputSchemaDigest: string;
  readonly outputSchemaDigest: string;
}

export interface RuntimeHostHandle {
  readonly runtimeInstanceId: string;
  readonly runtimeGeneration: bigint;
  readonly gateway: GatewayChannel;
  readonly handler: RuntimeHandle;
  close(reason?: string): Promise<void>;
}

function canonicalDigest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(toCanonicalJsonValue(value))).digest('hex')}`;
}

function bytesDigest(value: unknown, label: string): string {
  if (!Buffer.isBuffer(value) || value.length !== 32) throw new Error(`${label}_INVALID`);
  return `sha256:${value.toString('hex')}`;
}

async function fileDigest(path: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolveRead, reject) => {
    const stream = createReadStream(path, { highWaterMark: 256 * 1024 });
    stream.on('data', (chunk) => { hash.update(chunk); });
    stream.once('error', reject);
    stream.once('end', resolveRead);
  });
  return `sha256:${hash.digest('hex')}`;
}

function toolContractDigests(tools: readonly ToolContract[]): { exportDigest: string; inputSchemaDigest: string; outputSchemaDigest: string } {
  const ordered = [...tools].sort((left, right) => left.name.localeCompare(right.name));
  if (new Set(ordered.map((tool) => tool.name)).size !== ordered.length) throw new Error('RUNTIME_HANDLER_TOOL_DUPLICATE');
  return {
    exportDigest: canonicalDigest({ invoke: true, tools: ordered.map((tool) => tool.name) }),
    inputSchemaDigest: canonicalDigest(ordered.map((tool) => ({ name: tool.name, schema: tool.inputSchema }))),
    outputSchemaDigest: canonicalDigest(ordered.map((tool) => ({ name: tool.name, schema: tool.outputSchema }))),
  };
}

function requireCurrentRuntime(row: Record<string, unknown>, runtimeInstanceId: string): void {
  if (String(row.id) !== runtimeInstanceId) throw new Error('RUNTIME_INSTANCE_ID_MISMATCH');
  if (String(row.systemd_unit_name) !== runtimeHostUnit(runtimeInstanceId) || String(row.expected_service_class) !== 'kcml-runtime-host') throw new Error('RUNTIME_SYSTEMD_IDENTITY_MISMATCH');
  if (row.recovery_state !== 'READY' || row.database_identity_current !== true || row.recovery_lineage_current !== true) throw new Error('PLATFORM_RECOVERY_REQUIRED');
  if (row.component_lifecycle !== 'ACTIVE' || row.component_activation_state !== 'ACTIVE' || row.component_enabled !== true || row.revision_validation_state !== 'VALID' || row.revision_verification_state !== 'VERIFIED' || row.release_state !== 'ACTIVE' || row.target_lifecycle !== 'ACTIVE') throw new Error('RUNTIME_CONTEXT_NOT_CURRENT');
  if (String(row.active_revision_id) !== String(row.source_revision_id) || String(row.current_release_id) !== String(row.release_id) || String(row.active_binding_set_revision_id) !== String(row.binding_set_revision_id)) throw new Error('RUNTIME_CONTEXT_NOT_CURRENT');
  if (String(row.component_activation_epoch) !== String(row.activation_epoch) || String(row.current_activation_epoch) !== String(row.activation_epoch) || String(row.current_deployment_epoch) !== String(row.application_deployment_epoch) || String(row.current_platform_incarnation_id) !== String(row.platform_incarnation_id)) throw new Error('RUNTIME_CONTEXT_NOT_CURRENT');
  if (bytesDigest(row.release_artifact_digest, 'RELEASE_ARTIFACT_DIGEST') !== bytesDigest(row.artifact_digest, 'RUNTIME_ARTIFACT_DIGEST') || bytesDigest(row.release_runtime_digest, 'RELEASE_RUNTIME_DIGEST') !== bytesDigest(row.runtime_digest, 'RUNTIME_RUNTIME_DIGEST')) throw new Error('RUNTIME_RELEASE_DIGEST_MISMATCH');
}

export function buildRuntimeLaunchManifest(row: Record<string, unknown>): RuntimeLaunchManifest {
  const parsed = componentManifestSchema.safeParse(row.canonical_manifest);
  if (!parsed.success) throw new Error('RUNTIME_COMPONENT_MANIFEST_INVALID');
  const runtime = parsed.data.runtime;
  const digests = toolContractDigests(parsed.data.tools);
  return {
    schemaVersion: 'KCML-RUNTIME-LAUNCH-MANIFEST/1',
    componentId: String(row.component_id),
    sourceRevisionId: String(row.source_revision_id),
    releaseId: String(row.release_id),
    artifactDigest: bytesDigest(row.artifact_digest, 'RUNTIME_ARTIFACT_DIGEST'),
    runtimeDigest: bytesDigest(row.runtime_digest, 'RUNTIME_RUNTIME_DIGEST'),
    dependencyLockDigest: bytesDigest(row.dependency_lock_digest, 'RUNTIME_DEPENDENCY_LOCK_DIGEST'),
    bindingSetRevisionId: String(row.binding_set_revision_id),
    activationEpoch: String(row.activation_epoch),
    applicationDeploymentEpoch: String(row.application_deployment_epoch),
    platformIncarnationId: String(row.platform_incarnation_id),
    runtimeInstanceId: String(row.id),
    runtimeGeneration: String(row.runtime_generation),
    systemdUnitName: String(row.systemd_unit_name),
    expectedServiceClass: 'kcml-runtime-host',
    resourceProfileDigest: bytesDigest(row.resource_profile_digest, 'RUNTIME_RESOURCE_PROFILE_DIGEST'),
    namespaceProfileDigest: bytesDigest(row.namespace_profile_digest, 'RUNTIME_NAMESPACE_PROFILE_DIGEST'),
    seccompProfileDigest: bytesDigest(row.seccomp_profile_digest, 'RUNTIME_SECCOMP_PROFILE_DIGEST'),
    environmentProfileDigest: bytesDigest(row.environment_profile_digest, 'RUNTIME_ENVIRONMENT_PROFILE_DIGEST'),
    fdProfileDigest: bytesDigest(row.fd_profile_digest, 'RUNTIME_FD_PROFILE_DIGEST'),
    handlerEntrypoint: runtime.handlerEntrypoint,
    handlerDigest: runtime.handlerDigest,
    executable: runtime.executable,
    executableDigest: runtime.executableDigest,
    nodeBootstrap: runtime.nodeBootstrap,
    exportDigest: digests.exportDigest,
    inputSchemaDigest: digests.inputSchemaDigest,
    outputSchemaDigest: digests.outputSchemaDigest,
    stateSchemaRevision: runtime.stateSchemaRevision,
    cleanupInventoryTemplate: runtime.cleanupInventoryTemplate,
  };
}

async function loadRuntimeLaunchPlan(pool: DatabasePool, runtimeInstanceId: string): Promise<RuntimeLaunchPlan> {
  return inTransactionProfile(pool, 'CONSISTENT_READ', async (client) => {
    const row = (await client.query(`SELECT r.*,
      c.lifecycle AS component_lifecycle,c.activation_state AS component_activation_state,c.enabled AS component_enabled,c.active_revision_id,c.current_release_id,c.active_binding_set_revision_id,c.current_activation_epoch AS component_activation_epoch,
      revision.canonical_manifest,revision.manifest_digest,revision.validation_state AS revision_validation_state,revision.verification_state AS revision_verification_state,
      release.release_directory,release.state AS release_state,release.artifact_digest AS release_artifact_digest,release.runtime_digest AS release_runtime_digest,
      target.lifecycle AS target_lifecycle,
      p.platform_incarnation_id AS current_platform_incarnation_id,d.current_epoch AS current_deployment_epoch,a.current_epoch AS current_activation_epoch,
      recovery.state AS recovery_state,recovery.database_identity_current,recovery.recovery_lineage_current
    FROM kcml.runtime_instance r
    JOIN kcml.component c ON c.id=r.component_id
    JOIN kcml.component_revision revision ON revision.id=r.source_revision_id
    JOIN kcml.component_release release ON release.id=r.release_id
    JOIN kcml.component_runtime_target target ON target.id=r.runtime_target_id
    CROSS JOIN kcml.platform_incarnation p CROSS JOIN kcml.application_deployment_head d CROSS JOIN kcml.activation_head a CROSS JOIN kcml.platform_recovery_head recovery
    WHERE r.id=$1 AND p.singleton_key=1 AND d.singleton_key=1 AND a.singleton_key=1 AND recovery.singleton_key=1
    FOR SHARE OF r,c,revision,release,target,p,d,a,recovery`, [runtimeInstanceId])).rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new Error('RUNTIME_INSTANCE_NOT_FOUND');
    requireCurrentRuntime(row, runtimeInstanceId);
    const manifest = buildRuntimeLaunchManifest(row);
    const manifestDigest = canonicalDigest(manifest);
    if (manifestDigest !== bytesDigest(row.launch_manifest_digest, 'RUNTIME_LAUNCH_MANIFEST_DIGEST')) throw new Error('RUNTIME_LAUNCH_MANIFEST_MISMATCH');
    const parsed = componentManifestSchema.parse(row.canonical_manifest);
    const uid = Number(row.linux_uid);
    const gid = Number(row.linux_gid);
    if (!Number.isSafeInteger(uid) || uid <= 0 || !Number.isSafeInteger(gid) || gid <= 0) throw new Error('RUNTIME_OS_IDENTITY_INVALID');
    if (typeof row.release_directory !== 'string' || row.release_directory.length === 0) throw new Error('RUNTIME_RELEASE_DIRECTORY_REQUIRED');
    return { manifest, manifestDigest, releaseDirectory: row.release_directory, linuxUid: uid, linuxGid: gid, tools: parsed.tools };
  });
}

async function materializeLaunchManifest(plan: RuntimeLaunchPlan): Promise<{ instanceRoot: string; workspaceRoot: string; socketDirectory: string }> {
  const generationRoot = resolve(RUNTIME_ROOT, plan.manifest.runtimeInstanceId, plan.manifest.runtimeGeneration);
  const workspaceRoot = resolve(generationRoot, 'work');
  const socketDirectory = resolve(generationRoot, 'run');
  await mkdir(workspaceRoot, { recursive: true, mode: 0o700 });
  await mkdir(socketDirectory, { recursive: true, mode: 0o750 });
  const manifestPath = resolve(generationRoot, 'launch-manifest.json');
  const bytes = Buffer.from(`${canonicalJson(toCanonicalJsonValue(plan.manifest))}\n`);
  try {
    const descriptor = await open(manifestPath, 'wx', 0o400);
    try { await descriptor.writeFile(bytes); await descriptor.sync(); } finally { await descriptor.close(); }
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
    if (code !== 'EEXIST') throw error;
    const current = await readFile(manifestPath);
    if (!current.equals(bytes)) throw new Error('RUNTIME_LAUNCH_MANIFEST_MISMATCH');
  }
  await chmod(manifestPath, 0o400);
  return { instanceRoot: generationRoot, workspaceRoot, socketDirectory };
}

async function verifyLaunchFiles(plan: RuntimeLaunchPlan): Promise<RuntimeLaunchSpec> {
  const releaseRoot = await realpath(plan.releaseDirectory);
  const runtime: GeneratedRuntimeManifest = componentManifestSchema.parse((await inMemoryManifest(plan)).canonicalManifest).runtime;
  const executable = resolve(releaseRoot, runtime.executable);
  const nodeBootstrap = resolve(releaseRoot, runtime.nodeBootstrap);
  const handlerEntrypoint = resolve(releaseRoot, runtime.handlerEntrypoint);
  if (await fileDigest(executable) !== runtime.executableDigest) throw new Error('RUNTIME_EXECUTABLE_DIGEST_MISMATCH');
  if (await fileDigest(handlerEntrypoint) !== runtime.handlerDigest) throw new Error('RUNTIME_HANDLER_DIGEST_MISMATCH');
  const directories = await materializeLaunchManifest(plan);
  const handshake = Buffer.from(canonicalJson(toCanonicalJsonValue({
    protocol: RUNTIME_IPC_PROTOCOL,
    runtimeInstanceId: plan.manifest.runtimeInstanceId,
    runtimeGeneration: plan.manifest.runtimeGeneration,
    runtimeDigest: plan.manifest.runtimeDigest,
    exportDigest: plan.manifest.exportDigest,
    inputSchemaDigest: plan.manifest.inputSchemaDigest,
    outputSchemaDigest: plan.manifest.outputSchemaDigest,
  }))).toString('base64url');
  return {
    executionId: plan.manifest.runtimeInstanceId,
    executable,
    executableDigest: runtime.executableDigest,
    nodeBootstrap,
    handlerEntrypoint,
    args: ['--kcml-handshake', handshake],
    releaseRoot,
    workspaceRoot: directories.workspaceRoot,
    socketDirectory: directories.socketDirectory,
    uid: plan.linuxUid,
    gid: plan.linuxGid,
    environment: {
      LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC', NODE_ENV: 'production', HOME: '/work/home', TMPDIR: '/tmp', PATH: '/runtime/bin', UV_USE_IO_URING: '0'
    },
    timeoutMs: HANDLER_READY_TIMEOUT_MS,
  };
}

async function inMemoryManifest(plan: RuntimeLaunchPlan): Promise<{ canonicalManifest: unknown }> {
  return inTransactionProfile((globalThis as unknown as { __never?: DatabasePool }).__never as never, 'CONSISTENT_READ', async () => ({ canonicalManifest: null }));
}

async function connectGateway(plan: RuntimeLaunchPlan): Promise<GatewayChannel> {
  const socketPath = process.env.KCML_RUNTIME_GATEWAY_SOCKET ?? GATEWAY_PATH;
  const socket = createConnection({ path: socketPath });
  await new Promise<void>((resolveConnect, reject) => {
    const timer = setTimeout(() => reject(new Error('RUNTIME_GATEWAY_CONNECT_TIMEOUT')), 10_000);
    socket.once('connect', () => { clearTimeout(timer); resolveConnect(); });
    socket.once('error', (error) => { clearTimeout(timer); reject(error); });
  });
  socket.write(encodeRuntimeFrame({ frameType: 'HELLO', flags: 0, sequence: 1, payload: {
    protocol: RUNTIME_IPC_PROTOCOL,
    peerKind: 'RUNTIME_HOST',
    serviceClass: 'kcml-runtime-host',
    runtimeInstanceId: plan.manifest.runtimeInstanceId,
    runtimeGeneration: plan.manifest.runtimeGeneration,
    systemdUnit: plan.manifest.systemdUnitName,
    launchManifestDigest: plan.manifestDigest,
  } }));
  const ready = await waitForFrame(socket, (frame) => frame.frameType === 'READY', 10_000);
  const payload = z.object({ protocol: z.literal(RUNTIME_IPC_PROTOCOL), stage: z.literal('HOST_CHANNEL_VALIDATED'), connectionId: z.string().uuid(), runtimeInstanceId: z.string().uuid(), runtimeGeneration: z.string(), systemdInvocationId: z.string().uuid() }).strict().parse(ready.payload);
  if (payload.runtimeInstanceId !== plan.manifest.runtimeInstanceId || payload.runtimeGeneration !== plan.manifest.runtimeGeneration) throw new Error('RUNTIME_GATEWAY_HANDSHAKE_MISMATCH');
  return { socket, connectionId: payload.connectionId, invocationId: payload.systemdInvocationId, close: () => socket.destroy() };
}

function waitForFrame(socket: Socket, predicate: (frame: RuntimeFrame) => boolean, timeoutMs: number): Promise<RuntimeFrame> {
  return new Promise<RuntimeFrame>((resolveFrame, reject) => {
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; socket.destroy(); reject(new Error('RUNTIME_PROTOCOL_TIMEOUT')); } }, timeoutMs);
    const finish = (frame: RuntimeFrame) => {
      if (settled || !predicate(frame)) return;
      settled = true;
      clearTimeout(timer);
      resolveFrame(frame);
    };
    socket.once('error', (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    consumeRuntimeFrames(socket, async (frame) => finish(frame));
  });
}

async function waitForHandlerReady(handle: RuntimeHandle, plan: RuntimeLaunchPlan): Promise<HandlerHandshake> {
  let helloSeen = false;
  return new Promise<HandlerHandshake>((resolveReady, reject) => {
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; void handle.terminate('SIGKILL'); reject(new Error('RUNTIME_HANDLER_READY_TIMEOUT')); } }, HANDLER_READY_TIMEOUT_MS);
    const fail = (error: unknown) => { if (!settled) { settled = true; clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error))); } };
    handle.process.once('exit', (code, signal) => fail(new Error(`RUNTIME_HANDLER_EXITED_BEFORE_READY:${code ?? signal ?? 'unknown'}`)));
    consumeRuntimeFrames(handle.capabilitySocket, async (frame) => {
      const payload = z.object({ protocol: z.literal(RUNTIME_IPC_PROTOCOL), runtimeInstanceId: z.string().uuid(), runtimeGeneration: z.string(), runtimeDigest: z.string().regex(DIGEST), exportDigest: z.string().regex(DIGEST), inputSchemaDigest: z.string().regex(DIGEST), outputSchemaDigest: z.string().regex(DIGEST) }).passthrough().parse(frame.payload);
      if (payload.runtimeInstanceId !== plan.manifest.runtimeInstanceId || payload.runtimeGeneration !== plan.manifest.runtimeGeneration || payload.runtimeDigest !== plan.manifest.runtimeDigest || payload.exportDigest !== plan.manifest.exportDigest || payload.inputSchemaDigest !== plan.manifest.inputSchemaDigest || payload.outputSchemaDigest !== plan.manifest.outputSchemaDigest) throw new Error('RUNTIME_HANDLER_CONFORMANCE_MISMATCH');
      if (frame.frameType === 'HELLO' && frame.sequence === 1) { helloSeen = true; return; }
      if (frame.frameType !== 'READY' || frame.sequence !== 2 || !helloSeen) throw new Error('RUNTIME_HANDLER_HANDSHAKE_INVALID');
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolveReady({ exportDigest: payload.exportDigest, inputSchemaDigest: payload.inputSchemaDigest, outputSchemaDigest: payload.outputSchemaDigest });
      }
    });
    handle.capabilitySocket.once('error', fail);
  });
}

async function persistReady(client: DatabaseClient, plan: RuntimeLaunchPlan, gateway: GatewayChannel, handler: RuntimeHandle, handshake: HandlerHandshake): Promise<void> {
  const runtime = (await client.query(`SELECT r.*,p.platform_incarnation_id AS current_platform_incarnation_id,d.current_epoch AS current_deployment_epoch,a.current_epoch AS current_activation_epoch,recovery.state AS recovery_state,recovery.database_identity_current,recovery.recovery_lineage_current
    FROM kcml.runtime_instance r CROSS JOIN kcml.platform_incarnation p CROSS JOIN kcml.application_deployment_head d CROSS JOIN kcml.activation_head a CROSS JOIN kcml.platform_recovery_head recovery
    WHERE r.id=$1 AND p.singleton_key=1 AND d.singleton_key=1 AND a.singleton_key=1 AND recovery.singleton_key=1 FOR UPDATE OF r`, [plan.manifest.runtimeInstanceId])).rows[0] as Record<string, unknown> | undefined;
  if (!runtime) throw new Error('RUNTIME_INSTANCE_NOT_FOUND');
  if (String(runtime.runtime_generation) !== plan.manifest.runtimeGeneration || bytesDigest(runtime.launch_manifest_digest, 'RUNTIME_LAUNCH_MANIFEST_DIGEST') !== plan.manifestDigest || String(runtime.runtime_gateway_connection_id) !== gateway.connectionId || String(runtime.current_platform_incarnation_id) !== plan.manifest.platformIncarnationId || String(runtime.current_deployment_epoch) !== plan.manifest.applicationDeploymentEpoch || String(runtime.current_activation_epoch) !== plan.manifest.activationEpoch || runtime.recovery_state !== 'READY' || runtime.database_identity_current !== true || runtime.recovery_lineage_current !== true) throw new Error('RUNTIME_CONTEXT_NOT_CURRENT');
  if (handshake.exportDigest !== plan.manifest.exportDigest || handshake.inputSchemaDigest !== plan.manifest.inputSchemaDigest || handshake.outputSchemaDigest !== plan.manifest.outputSchemaDigest) throw new Error('RUNTIME_HANDLER_CONFORMANCE_MISMATCH');
  const connection = (await client.query(`SELECT * FROM kcml.runtime_ipc_connection WHERE id=$1 AND runtime_instance_id=$2 AND runtime_generation=$3 AND state='ACTIVE' FOR SHARE`, [gateway.connectionId, plan.manifest.runtimeInstanceId, plan.manifest.runtimeGeneration])).rows[0];
  if (!connection) throw new Error('RUNTIME_GATEWAY_CONNECTION_REQUIRED');
  const processEvidence = { supervisorPid: handler.pid, runtimeInstanceId: plan.manifest.runtimeInstanceId, runtimeGeneration: plan.manifest.runtimeGeneration, launchManifestDigest: plan.manifestDigest, gatewayConnectionId: gateway.connectionId };
  const readySequence = BigInt(String(runtime.ready_sequence)) + 1n;
  const update = await client.query(`UPDATE kcml.runtime_instance SET desired_state='READY',effective_state='READY',effective_at=clock_timestamp(),ready_sequence=$2,ready_at=coalesce(ready_at,clock_timestamp()),state_version=state_version+1
    WHERE id=$1 AND runtime_generation=$3 AND launch_manifest_digest=$4 AND runtime_gateway_connection_id=$5 AND platform_incarnation_id=$6 AND application_deployment_epoch=$7 AND activation_epoch=$8`, [
    plan.manifest.runtimeInstanceId, readySequence.toString(), plan.manifest.runtimeGeneration, Buffer.from(plan.manifestDigest.slice(7), 'hex'), gateway.connectionId, plan.manifest.platformIncarnationId, plan.manifest.applicationDeploymentEpoch, plan.manifest.activationEpoch
  ]);
  if (update.rowCount !== 1) throw new Error('RUNTIME_CONTEXT_NOT_CURRENT');
  await client.query(`INSERT INTO kcml.runtime_readiness_evidence(runtime_instance_id,runtime_generation,ready_sequence,check_kind,check_result,evidence,evidence_digest,observed_at,activation_epoch,platform_incarnation_id,application_deployment_epoch)
    VALUES($1,$2,$3,'HANDLER_READY','PASS',$4,$5,clock_timestamp(),$6,$7,$8)`, [
    plan.manifest.runtimeInstanceId, plan.manifest.runtimeGeneration, readySequence.toString(), processEvidence, Buffer.from(canonicalDigest(processEvidence).slice(7), 'hex'), plan.manifest.activationEpoch, plan.manifest.platformIncarnationId, plan.manifest.applicationDeploymentEpoch
  ]);
}

export async function startRuntimeHost(pool: DatabasePool, logger: StructuredLogger): Promise<RuntimeHostHandle> {
  const runtimeInstanceId = z.string().uuid().parse(process.env.KCML_RUNTIME_INSTANCE_ID).toLowerCase();
  const plan = await loadRuntimeLaunchPlan(pool, runtimeInstanceId);
  const gateway = await connectGateway(plan);
  let handler: RuntimeHandle | null = null;
  try {
    const spec = await verifyLaunchFiles(plan);
    handler = await launchTrustedRuntime(spec, logger);
    const handshake = await waitForHandlerReady(handler, plan);
    await inTransactionProfile(pool, 'WORKER_COMMIT', (client) => persistReady(client, plan, gateway, handler as RuntimeHandle, handshake));
    let heartbeatSequence = 1n;
    const heartbeat = setInterval(() => {
      if (gateway.socket.destroyed) return;
      heartbeatSequence += 1n;
      gateway.socket.write(encodeRuntimeFrame({ frameType: 'HEARTBEAT', flags: 0, sequence: Number(heartbeatSequence), payload: { runtimeInstanceId, runtimeGeneration: plan.manifest.runtimeGeneration, heartbeatSequence: heartbeatSequence.toString() } }));
    }, 5_000);
    heartbeat.unref();
    const close = async (reason = 'RUNTIME_HOST_SHUTDOWN') => {
      clearInterval(heartbeat);
      await handler?.terminate('SIGTERM');
      gateway.close();
      await pool.query(`UPDATE kcml.runtime_instance SET effective_state=CASE WHEN desired_state IN ('STOPPED','DRAINING') THEN desired_state ELSE 'STOPPED' END,effective_at=clock_timestamp(),stopped_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1 AND runtime_generation=$2`, [runtimeInstanceId, plan.manifest.runtimeGeneration]).catch(() => undefined);
      logger.info('runtime-host.closed', { runtimeInstanceId, runtimeGeneration: plan.manifest.runtimeGeneration, reason });
    };
    handler.process.once('exit', (code, signal) => {
      void pool.query(`UPDATE kcml.runtime_instance SET effective_state=CASE WHEN desired_state='STOPPED' THEN 'STOPPED' ELSE 'FAILED' END,effective_at=clock_timestamp(),state_version=state_version+1 WHERE id=$1 AND runtime_generation=$2`, [runtimeInstanceId, plan.manifest.runtimeGeneration]).catch(() => undefined);
      logger.error('runtime-host.handler-exited', { runtimeInstanceId, runtimeGeneration: plan.manifest.runtimeGeneration, code, signal });
    });
    logger.info('runtime-host.ready', { runtimeInstanceId, runtimeGeneration: plan.manifest.runtimeGeneration, launchManifestDigest: plan.manifestDigest, gatewayConnectionId: gateway.connectionId, handlerSupervisorPid: handler.pid });
    return { runtimeInstanceId, runtimeGeneration: BigInt(plan.manifest.runtimeGeneration), gateway, handler, close };
  } catch (error) {
    await handler?.terminate('SIGKILL').catch(() => undefined);
    gateway.close();
    throw error;
  }
}
