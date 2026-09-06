import { createHash, randomUUID } from 'node:crypto';
import { closeSync } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createServer, type Server, type Socket } from 'node:net';
import { spawn } from 'node:child_process';
import type { DatabaseClient, DatabasePool } from '@kcml/database';
import { inTransactionProfile } from '@kcml/database';
import { canonicalJson, toCanonicalJsonValue, z } from '@kcml/schemas';
import {
  RUNTIME_IPC_HEADER_BYTES,
  RUNTIME_IPC_MAGIC,
  RUNTIME_IPC_MAX_PAYLOAD,
  RUNTIME_IPC_MAX_PENDING,
  RUNTIME_IPC_MAX_STREAM_CHUNK,
  RUNTIME_IPC_MAX_UNARY,
  RUNTIME_IPC_PROTOCOL,
  consumeRuntimeFrames,
  encodeRuntimeFrame,
  openPinnedPidfd,
  sealAndInspectSocketFd,
} from '@kcml/runtime-capability-ipc';
import { RuntimeSystemdController, runtimeHostUnit } from './runtime-systemd.js';

const RUNTIME_GATEWAY_PATH = '/run/kajovocml-ng/gateway/runtime-gateway.sock';
const RUNTIME_GATEWAY_FD_NAME = 'runtime-gateway';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;

const runtimeHostHelloSchema = z.object({
  protocol: z.literal(RUNTIME_IPC_PROTOCOL),
  peerKind: z.literal('RUNTIME_HOST'),
  serviceClass: z.literal('kcml-runtime-host'),
  runtimeInstanceId: z.string().uuid(),
  runtimeGeneration: z.string().regex(/^[1-9][0-9]*$/u),
  systemdUnit: z.string().min(1).max(512),
  launchManifestDigest: z.string().regex(SHA256_PATTERN),
}).strict();

type RuntimeHostHello = z.infer<typeof runtimeHostHelloSchema>;

type GatewayLogger = Pick<Console, 'info' | 'error'> & {
  info(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
};

interface PeerCredentials { pid: number; uid: number; gid: number }
interface PeerKernelIdentity extends PeerCredentials {
  bootId: string;
  startTicks: bigint;
  cgroupPath: string;
  unit: string;
  invocationId: string;
  pidfd: number;
}
interface ListenerEvidence {
  path: string;
  device: bigint;
  inode: bigint;
  uid: bigint;
  gid: bigint;
  mode: number;
}
interface AcceptedConnection {
  connectionId: string;
  runtimeInstanceId: string;
  runtimeGeneration: bigint;
  pidfd: number;
}

function digest(value: unknown): Buffer {
  return createHash('sha256').update(canonicalJson(toCanonicalJsonValue(value))).digest();
}

function asDigest(value: unknown, label: string): Buffer {
  if (!Buffer.isBuffer(value) || value.length !== 32) throw new Error(`${label}_INVALID`);
  return value;
}

function sha256Label(value: unknown, label: string): string {
  return `sha256:${asDigest(value, label).toString('hex')}`;
}

function requireUuid(value: unknown, label: string): string {
  const text = typeof value === 'string' ? value.toLowerCase() : '';
  if (!UUID_PATTERN.test(text)) throw new Error(`${label}_INVALID`);
  return text;
}

export function assertRuntimeGatewayActivationEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  pid = process.pid,
): void {
  if (environment.LISTEN_PID !== String(pid)) throw new Error('RUNTIME_SOCKET_ACTIVATION_PID_MISMATCH');
  if (environment.LISTEN_FDS !== '1') throw new Error('RUNTIME_SOCKET_ACTIVATION_FD_COUNT_INVALID');
  if (environment.LISTEN_FDNAMES !== RUNTIME_GATEWAY_FD_NAME) throw new Error('RUNTIME_SOCKET_ACTIVATION_FD_NAME_INVALID');
}

export function parseProcStartTicks(stat: string): bigint {
  const close = stat.lastIndexOf(')');
  if (close < 0) throw new Error('RUNTIME_PROCESS_STAT_INVALID');
  const fields = stat.slice(close + 2).trim().split(/\s+/u);
  const value = fields[19];
  if (!value || !/^\d+$/u.test(value)) throw new Error('RUNTIME_PROCESS_START_TICKS_INVALID');
  return BigInt(value);
}

export function runtimeUnitFromCgroup(cgroup: string): string {
  const candidates = cgroup.split('\n').filter(Boolean).map((line) => line.slice(line.lastIndexOf(':') + 1));
  for (const path of candidates) {
    const leaf = path.split('/').filter(Boolean).at(-1)?.replace(/\\x2d/gu, '-') ?? '';
    if (/^kcml-runtime-host@[0-9a-f-]{36}\.service$/u.test(leaf)) return leaf;
  }
  throw new Error('RUNTIME_CGROUP_UNIT_NOT_FOUND');
}

function peerSocketFd(socket: Socket): number {
  const fd = (socket as unknown as { _handle?: { fd?: number } })._handle?.fd;
  if (!Number.isInteger(fd) || Number(fd) < 0) throw new Error('RUNTIME_PEER_SOCKET_FD_UNAVAILABLE');
  return Number(fd);
}

async function peerCredentials(socket: Socket): Promise<PeerCredentials> {
  const fd = peerSocketFd(socket);
  const helper = process.env.KCML_PEERCRED_HELPER ?? '/usr/libexec/kajovocml-ng/kcml-peercred';
  return new Promise<PeerCredentials>((resolve, reject) => {
    const child = spawn(helper, ['3'], { stdio: ['ignore', 'pipe', 'pipe', fd], env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' } });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('RUNTIME_PEERCRED_TIMEOUT')); }, 5_000);
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); if (stdout.length > 4096) child.kill('SIGKILL'); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); if (stderr.length > 4096) child.kill('SIGKILL'); });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) { reject(new Error(`RUNTIME_PEERCRED_FAILED:${stderr.trim().slice(0, 512)}`)); return; }
      try {
        const parsed = JSON.parse(stdout) as PeerCredentials;
        if (!Number.isInteger(parsed.pid) || parsed.pid <= 0 || !Number.isInteger(parsed.uid) || parsed.uid < 0 || !Number.isInteger(parsed.gid) || parsed.gid < 0) throw new Error('invalid');
        resolve(parsed);
      } catch { reject(new Error('RUNTIME_PEERCRED_INVALID')); }
    });
  });
}

async function readPeerKernelIdentity(socket: Socket, hello: RuntimeHostHello, systemd: RuntimeSystemdController): Promise<PeerKernelIdentity> {
  const credentials = await peerCredentials(socket);
  const pidfd = openPinnedPidfd(credentials.pid);
  try {
    const before = parseProcStartTicks(await readFile(`/proc/${credentials.pid}/stat`, 'utf8'));
    const status = await readFile(`/proc/${credentials.pid}/status`, 'utf8');
    const cgroup = await readFile(`/proc/${credentials.pid}/cgroup`, 'utf8');
    const bootId = requireUuid((await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim(), 'HOST_BOOT_ID');
    const uid = Number(/^Uid:\s+(\d+)/mu.exec(status)?.[1] ?? '-1');
    const gid = Number(/^Gid:\s+(\d+)/mu.exec(status)?.[1] ?? '-1');
    if (uid !== credentials.uid || gid !== credentials.gid) throw new Error('RUNTIME_PEER_PROC_CREDENTIAL_MISMATCH');
    const unit = runtimeUnitFromCgroup(cgroup);
    if (unit !== hello.systemdUnit || unit !== runtimeHostUnit(hello.runtimeInstanceId)) throw new Error('RUNTIME_PEER_SYSTEMD_UNIT_MISMATCH');
    const systemdState = await systemd.show(hello.runtimeInstanceId);
    const after = parseProcStartTicks(await readFile(`/proc/${credentials.pid}/stat`, 'utf8'));
    if (before !== after) throw new Error('RUNTIME_PID_REUSE_DETECTED');
    const cgroupPath = cgroup.split('\n').filter(Boolean).map((line) => line.slice(line.lastIndexOf(':') + 1)).find((value) => value.endsWith(`/${unit}`) || value === `/${unit}`) ?? '';
    if (systemdState.activeState !== 'active' || systemdState.mainPid !== credentials.pid || systemdState.controlGroup !== cgroupPath || !systemdState.invocationId) {
      throw new Error('RUNTIME_PEER_SYSTEMD_IDENTITY_MISMATCH');
    }
    return { ...credentials, bootId, startTicks: before, cgroupPath, unit, invocationId: systemdState.invocationId, pidfd };
  } catch (error) {
    closeSync(pidfd);
    throw error;
  }
}

async function listenerEvidence(path: string, fd = 3): Promise<ListenerEvidence> {
  assertRuntimeGatewayActivationEnvironment();
  const native = sealAndInspectSocketFd(fd);
  if (native.family !== 'AF_UNIX' || native.socketType !== 'SOCK_STREAM' || !native.accepting || !native.nonBlocking || !native.closeOnExec) {
    throw new Error('RUNTIME_SOCKET_ACTIVATION_FD_INVALID');
  }
  if (native.localPath !== path) throw new Error('RUNTIME_SOCKET_ACTIVATION_PATH_MISMATCH');
  const socket = await lstat(path, { bigint: true });
  const parent = await lstat(dirname(path), { bigint: true });
  if (!socket.isSocket() || socket.isSymbolicLink()) throw new Error('RUNTIME_SOCKET_PATH_TYPE_INVALID');
  if (socket.dev !== native.device || socket.ino !== native.inode) throw new Error('RUNTIME_SOCKET_SUBSTITUTION_DETECTED');
  if ((socket.mode & 0o777n) !== 0o660n) throw new Error('RUNTIME_SOCKET_MODE_INVALID');
  if (typeof process.getuid === 'function' && socket.uid !== BigInt(process.getuid())) throw new Error('RUNTIME_SOCKET_OWNER_INVALID');
  if (typeof process.getgroups === 'function' && !process.getgroups().includes(Number(socket.gid))) throw new Error('RUNTIME_SOCKET_GROUP_INVALID');
  if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== 0n || (parent.mode & 0o777n) !== 0o750n || parent.gid !== socket.gid) {
    throw new Error('RUNTIME_SOCKET_PARENT_INVALID');
  }
  return { path, device: socket.dev, inode: socket.ino, uid: socket.uid, gid: socket.gid, mode: Number(socket.mode & 0o777n) };
}

function protocolDigest(): Buffer {
  return digest({
    protocol: RUNTIME_IPC_PROTOCOL,
    magic: RUNTIME_IPC_MAGIC.toString('ascii'),
    headerBytes: RUNTIME_IPC_HEADER_BYTES,
    maxPayload: RUNTIME_IPC_MAX_PAYLOAD,
    maxUnary: RUNTIME_IPC_MAX_UNARY,
    maxStreamChunk: RUNTIME_IPC_MAX_STREAM_CHUNK,
    maxPending: RUNTIME_IPC_MAX_PENDING,
  });
}

async function validateRuntimeSnapshot(client: DatabaseClient, hello: RuntimeHostHello, peer: PeerKernelIdentity): Promise<Record<string, unknown>> {
  const runtime = (await client.query(`SELECT r.*,
      c.lifecycle AS component_lifecycle,c.activation_state AS component_activation_state,c.enabled AS component_enabled,
      c.active_revision_id,c.current_release_id,c.active_binding_set_revision_id,c.current_activation_epoch AS component_activation_epoch,
      revision.validation_state AS revision_validation_state,revision.verification_state AS revision_verification_state,
      release.state AS release_state,release.artifact_digest AS release_artifact_digest,release.runtime_digest AS release_runtime_digest,
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
    FOR SHARE OF r,c,revision,release,target,p,d,a,recovery`, [hello.runtimeInstanceId])).rows[0] as Record<string, unknown> | undefined;
  if (!runtime) throw new Error('RUNTIME_CONTEXT_NOT_CURRENT');
  if (BigInt(String(runtime.runtime_generation)) !== BigInt(hello.runtimeGeneration)) throw new Error('RUNTIME_GENERATION_STALE');
  if (String(runtime.systemd_unit_name) !== hello.systemdUnit || String(runtime.expected_service_class) !== hello.serviceClass) throw new Error('RUNTIME_PEER_SYSTEMD_IDENTITY_MISMATCH');
  if (sha256Label(runtime.launch_manifest_digest, 'RUNTIME_LAUNCH_MANIFEST_DIGEST') !== hello.launchManifestDigest) throw new Error('RUNTIME_LAUNCH_MANIFEST_MISMATCH');
  if (Number(runtime.linux_uid) !== peer.uid || Number(runtime.linux_gid) !== peer.gid) throw new Error('RUNTIME_PEER_CREDENTIAL_MISMATCH');
  if (String(runtime.platform_incarnation_id) !== String(runtime.current_platform_incarnation_id) || String(runtime.application_deployment_epoch) !== String(runtime.current_deployment_epoch) || String(runtime.activation_epoch) !== String(runtime.current_activation_epoch)) throw new Error('RUNTIME_CONTEXT_NOT_CURRENT');
  if (runtime.recovery_state !== 'READY' || runtime.database_identity_current !== true || runtime.recovery_lineage_current !== true) throw new Error('PLATFORM_RECOVERY_REQUIRED');
  if (runtime.component_lifecycle !== 'ACTIVE' || runtime.component_activation_state !== 'ACTIVE' || runtime.component_enabled !== true || String(runtime.active_revision_id) !== String(runtime.source_revision_id) || String(runtime.current_release_id) !== String(runtime.release_id) || String(runtime.active_binding_set_revision_id) !== String(runtime.binding_set_revision_id) || String(runtime.component_activation_epoch) !== String(runtime.activation_epoch)) throw new Error('RUNTIME_CONTEXT_NOT_CURRENT');
  if (runtime.revision_validation_state !== 'VALID' || runtime.revision_verification_state !== 'VERIFIED' || runtime.release_state !== 'ACTIVE' || runtime.target_lifecycle !== 'ACTIVE') throw new Error('RUNTIME_CONTEXT_NOT_CURRENT');
  if (!asDigest(runtime.release_artifact_digest, 'RELEASE_ARTIFACT_DIGEST').equals(asDigest(runtime.artifact_digest, 'RUNTIME_ARTIFACT_DIGEST')) || !asDigest(runtime.release_runtime_digest, 'RELEASE_RUNTIME_DIGEST').equals(asDigest(runtime.runtime_digest, 'RUNTIME_RUNTIME_DIGEST'))) throw new Error('RUNTIME_RELEASE_DIGEST_MISMATCH');
  return runtime;
}

async function persistAcceptedConnection(
  pool: DatabasePool,
  socket: Socket,
  listener: ListenerEvidence,
  hello: RuntimeHostHello,
  peer: PeerKernelIdentity,
): Promise<AcceptedConnection> {
  const accepted = sealAndInspectSocketFd(peerSocketFd(socket));
  if (accepted.family !== 'AF_UNIX' || accepted.socketType !== 'SOCK_STREAM' || accepted.accepting) throw new Error('RUNTIME_PEER_SOCKET_INVALID');
  const connectionId = randomUUID();
  const protocolProfileDigest = protocolDigest();
  return inTransactionProfile(pool, 'WORKER_COMMIT', async (client) => {
    const runtime = await validateRuntimeSnapshot(client, hello, peer);
    const identityEvidence = {
      runtimeInstanceId: hello.runtimeInstanceId,
      runtimeGeneration: hello.runtimeGeneration,
      pid: peer.pid,
      uid: peer.uid,
      gid: peer.gid,
      bootId: peer.bootId,
      startTicks: peer.startTicks.toString(),
      unit: peer.unit,
      invocationId: peer.invocationId,
      cgroupPath: peer.cgroupPath,
    };
    const identityDigest = digest(identityEvidence);
    await client.query(`INSERT INTO kcml.runtime_process_identity(runtime_instance_id,runtime_generation,process_role,linux_pid,linux_uid,linux_gid,supplementary_groups,host_boot_id,process_start_ticks,systemd_unit,invocation_id,main_pid_relation,cgroup_path,pidfd_evidence,namespace_profile_digest,executable_digest,release_digest,started_at,identity_digest,canonical_digest,logical_operation_id,correlation_id,activation_epoch,platform_incarnation_id,application_deployment_epoch)
      VALUES($1,$2,'HOST',$3,$4,$5,'{}',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,clock_timestamp(),$16,$16,NULL,NULL,$17,$18,$19)
      ON CONFLICT (host_boot_id,linux_pid,process_start_ticks) DO NOTHING`, [
      hello.runtimeInstanceId, hello.runtimeGeneration, peer.pid, peer.uid, peer.gid, peer.bootId, peer.startTicks.toString(), peer.unit, peer.invocationId,
      { mainPid: peer.pid, verified: true }, peer.cgroupPath, { pidfdTracked: true, pidReuseChecked: true },
      asDigest(runtime.namespace_profile_digest, 'RUNTIME_NAMESPACE_PROFILE_DIGEST'), asDigest(runtime.runtime_digest, 'RUNTIME_EXECUTABLE_DIGEST'), asDigest(runtime.artifact_digest, 'RUNTIME_RELEASE_DIGEST'),
      identityDigest, String(runtime.activation_epoch), String(runtime.platform_incarnation_id), String(runtime.application_deployment_epoch),
    ]);
    const identity = (await client.query(`SELECT * FROM kcml.runtime_process_identity WHERE host_boot_id=$1 AND linux_pid=$2 AND process_start_ticks=$3 AND exited_at IS NULL FOR SHARE`, [peer.bootId, peer.pid, peer.startTicks.toString()])).rows[0];
    if (!identity || String(identity.runtime_instance_id) !== hello.runtimeInstanceId || BigInt(String(identity.runtime_generation)) !== BigInt(hello.runtimeGeneration) || String(identity.systemd_unit) !== peer.unit || String(identity.invocation_id) !== peer.invocationId) throw new Error('RUNTIME_PROCESS_IDENTITY_MISMATCH');

    const connectionEvidence = {
      connectionId,
      listener: { path: listener.path, device: listener.device.toString(), inode: listener.inode.toString(), mode: listener.mode },
      peer: identityEvidence,
      protocol: RUNTIME_IPC_PROTOCOL,
    };
    const connectionDigest = digest(connectionEvidence);
    await client.query(`INSERT INTO kcml.runtime_ipc_connection(id,transport_kind,canonical_path,socket_device,socket_inode,socket_type,socket_owner_uid,socket_group_gid,socket_mode,socket_unit,peer_uid,peer_gid,peer_pid,peer_boot_id,peer_start_ticks,peer_systemd_identity,peer_cgroup_path,runtime_instance_id,runtime_generation,service_invocation_id,protocol_profile_digest,first_sequence,last_sequence,inflight_count,state,opened_at,validated_at,canonical_digest,activation_epoch,platform_incarnation_id,application_deployment_epoch)
      VALUES($1,'RUNTIME_GATEWAY_UDS',$2,$3,$4,'SOCK_STREAM',$5,$6,$7,'kcml-runtime-gateway.socket',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,1,1,0,'ACTIVE',clock_timestamp(),clock_timestamp(),$19,$20,$21,$22)`, [
      connectionId, listener.path, accepted.device.toString(), accepted.inode.toString(), Number(listener.uid), Number(listener.gid), listener.mode,
      peer.uid, peer.gid, peer.pid, peer.bootId, peer.startTicks.toString(), { unit: peer.unit, invocationId: peer.invocationId, mainPid: peer.pid, active: true }, peer.cgroupPath,
      hello.runtimeInstanceId, hello.runtimeGeneration, peer.invocationId, protocolProfileDigest, connectionDigest,
      String(runtime.activation_epoch), String(runtime.platform_incarnation_id), String(runtime.application_deployment_epoch),
    ]);
    const update = await client.query(`UPDATE kcml.runtime_instance SET runtime_gateway_connection_id=$2,systemd_invocation_id=$3,host_boot_id=$4,main_pid=$5,process_start_ticks=$6,cgroup_path=$7,
      effective_state=CASE WHEN effective_state IN ('ABSENT','STOPPED','FAILED','UNKNOWN') THEN 'STARTING' ELSE effective_state END,effective_at=clock_timestamp(),state_version=state_version+1
      WHERE id=$1 AND runtime_generation=$8 AND launch_manifest_digest=$9 AND platform_incarnation_id=$10 AND application_deployment_epoch=$11 AND activation_epoch=$12`, [
      hello.runtimeInstanceId, connectionId, peer.invocationId, peer.bootId, peer.pid, peer.startTicks.toString(), peer.cgroupPath, hello.runtimeGeneration,
      asDigest(runtime.launch_manifest_digest, 'RUNTIME_LAUNCH_MANIFEST_DIGEST'), String(runtime.platform_incarnation_id), String(runtime.application_deployment_epoch), String(runtime.activation_epoch),
    ]);
    if (update.rowCount !== 1) throw new Error('RUNTIME_CONTEXT_NOT_CURRENT');
    return { connectionId, runtimeInstanceId: hello.runtimeInstanceId, runtimeGeneration: BigInt(hello.runtimeGeneration), pidfd: peer.pidfd };
  });
}

async function closeConnectionEvidence(pool: DatabasePool, accepted: AcceptedConnection, reason: string): Promise<void> {
  await inTransactionProfile(pool, 'WORKER_COMMIT', async (client) => {
    await client.query(`UPDATE kcml.runtime_ipc_connection SET state='CLOSED',closed_at=coalesce(closed_at,clock_timestamp()),close_reason=coalesce(close_reason,$2),state_version=state_version+1
      WHERE id=$1 AND state<>'CLOSED'`, [accepted.connectionId, reason.slice(0, 1000)]);
    await client.query(`UPDATE kcml.runtime_instance SET runtime_gateway_connection_id=NULL,effective_state=CASE WHEN effective_state='READY' THEN 'UNKNOWN' ELSE effective_state END,effective_at=clock_timestamp(),state_version=state_version+1
      WHERE id=$1 AND runtime_generation=$2 AND runtime_gateway_connection_id=$3`, [accepted.runtimeInstanceId, accepted.runtimeGeneration.toString(), accepted.connectionId]);
  });
}

export async function startRuntimeGatewayServer(pool: DatabasePool, logger: GatewayLogger): Promise<Server> {
  const socketPath = process.env.KCML_RUNTIME_GATEWAY_SOCKET ?? RUNTIME_GATEWAY_PATH;
  const listener = await listenerEvidence(socketPath, 3);
  const systemd = new RuntimeSystemdController();
  const server = createServer((socket) => {
    let accepted: AcceptedConnection | null = null;
    let outboundSequence = 1;
    let closed = false;
    const terminate = (reason: string) => {
      if (closed) return;
      closed = true;
      socket.destroy();
      if (accepted) {
        const current = accepted;
        closeSync(current.pidfd);
        void closeConnectionEvidence(pool, current, reason).catch((error) => logger.error('runtime-gateway.connection-close-evidence.failed', { connectionId: current.connectionId, error: String(error) }));
      }
    };
    socket.once('error', (error) => terminate(error.message));
    socket.once('close', () => terminate('PEER_CLOSED'));
    consumeRuntimeFrames(socket, async (frame) => {
      if (!accepted) {
        if (frame.frameType !== 'HELLO' || frame.sequence !== 1) throw new Error('RUNTIME_PROTOCOL_HELLO_REQUIRED');
        const hello = runtimeHostHelloSchema.parse(frame.payload);
        const peer = await readPeerKernelIdentity(socket, hello, systemd);
        accepted = await persistAcceptedConnection(pool, socket, listener, hello, peer);
        socket.write(encodeRuntimeFrame({ frameType: 'READY', flags: 0, sequence: outboundSequence++, payload: {
          protocol: RUNTIME_IPC_PROTOCOL,
          stage: 'HOST_CHANNEL_VALIDATED',
          connectionId: accepted.connectionId,
          runtimeInstanceId: accepted.runtimeInstanceId,
          runtimeGeneration: accepted.runtimeGeneration.toString(),
          systemdInvocationId: peer.invocationId,
        } }));
        logger.info('runtime-gateway.peer-accepted', { connectionId: accepted.connectionId, runtimeInstanceId: accepted.runtimeInstanceId, runtimeGeneration: accepted.runtimeGeneration.toString() });
        return;
      }
      if (frame.frameType !== 'HEARTBEAT') throw new Error('RUNTIME_PROTOCOL_UNEXPECTED_FRAME');
      const heartbeat = z.object({ runtimeInstanceId: z.string().uuid(), runtimeGeneration: z.string().regex(/^[1-9][0-9]*$/u), heartbeatSequence: z.string().regex(/^[1-9][0-9]*$/u) }).strict().parse(frame.payload);
      if (heartbeat.runtimeInstanceId !== accepted.runtimeInstanceId || BigInt(heartbeat.runtimeGeneration) !== accepted.runtimeGeneration) throw new Error('RUNTIME_GENERATION_STALE');
      const changed = await pool.query(`UPDATE kcml.runtime_ipc_connection SET last_sequence=$2,state_version=state_version+1,updated_at=clock_timestamp()
        WHERE id=$1 AND state='ACTIVE' AND last_sequence<$2`, [accepted.connectionId, frame.sequence]);
      if (changed.rowCount !== 1) throw new Error('RUNTIME_PROTOCOL_SEQUENCE_INVALID');
      await pool.query(`UPDATE kcml.runtime_instance SET heartbeat_sequence=$2,heartbeat_at=clock_timestamp(),state_version=state_version+1
        WHERE id=$1 AND runtime_generation=$3 AND runtime_gateway_connection_id=$4 AND heartbeat_sequence<$2`, [accepted.runtimeInstanceId, heartbeat.heartbeatSequence, accepted.runtimeGeneration.toString(), accepted.connectionId]);
    });
  });
  server.on('error', (error) => logger.error('runtime-gateway.server.failed', { error: error.message }));
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => { server.off('listening', onListening); reject(error); };
    const onListening = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen({ fd: 3, exclusive: false });
  });
  logger.info('runtime-gateway.socket-activated', { socketPath: listener.path, device: listener.device.toString(), inode: listener.inode.toString(), protocol: RUNTIME_IPC_PROTOCOL });
  return server;
}
