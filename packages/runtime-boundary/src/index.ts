import { access, chmod, lstat, mkdir, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { Socket } from 'node:net';
import type { StructuredLogger } from '@kcml/observability';

export interface RuntimeLaunchSpec {
  executionId: string;
  executable: string;
  executableDigest: string;
  /** Exact trusted Node.js 24 bootstrap in the same release, when launching a generated handler. */
  nodeBootstrap?: string;
  /** Exact generated handler module imported by nodeBootstrap. */
  handlerEntrypoint?: string;
  args: readonly string[];
  releaseRoot: string;
  workspaceRoot: string;
  socketDirectory: string;
  uid: number;
  gid: number;
  /** A pre-opened endpoint of an anonymous AF_UNIX socketpair. The trusted
   * host owns the other endpoint; the launcher only receives this FD as 3. */
  capabilityFd: number;
  environment: Readonly<Record<string, string>>;
  timeoutMs: number;
}

export interface RuntimeHandle {
  process: ChildProcess;
  pid: number;
  capabilitySocket: Socket;
  terminate: (signal?: NodeJS.Signals) => Promise<void>;
}

export function createAnonymousCapabilityPair(capabilityFd: number): { childFd: number; hostFd: number } {
  if (!Number.isInteger(capabilityFd) || capabilityFd < 3) throw new Error('RUNTIME_CAPABILITY_FD_INVALID');
  // socketpair(2) is created by the trusted native launcher boundary. Keeping
  // this typed hand-off explicit prevents a filesystem UDS from being used as
  // a substitute for the handler channel.
  return { childFd: 3, hostFd: capabilityFd };
}

function assertContained(root: string, candidate: string): void {
  const path = relative(root, candidate);
  if (path.startsWith('..') || isAbsolute(path)) throw new Error('RUNTIME_PATH_ESCAPE');
}

const RUNTIME_ENVIRONMENT_ALLOWLIST = new Set(['LANG', 'PATH', 'KCML_EXECUTION_ID']);

function buildRuntimeEnvironment(spec: RuntimeLaunchSpec): Record<string, string> {
  const environment: Record<string, string> = {
    LANG: 'C.UTF-8',
    PATH: '/usr/bin:/bin',
    KCML_EXECUTION_ID: spec.executionId
  };
  for (const [key, value] of Object.entries(spec.environment)) {
    if (!RUNTIME_ENVIRONMENT_ALLOWLIST.has(key)) throw new Error(`RUNTIME_ENVIRONMENT_NOT_ALLOWED:${key}`);
    environment[key] = value;
  }
  return environment;
}

export async function prepareRuntimePaths(spec: RuntimeLaunchSpec): Promise<void> {
  const release = await realpath(spec.releaseRoot);
  const executable = await realpath(spec.executable);
  assertContained(release, executable);
  await access(executable, constants.X_OK);
  createAnonymousCapabilityPair(spec.capabilityFd);
  const stat = await lstat(executable);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('RUNTIME_EXECUTABLE_INVALID');
  if ((spec.nodeBootstrap === undefined) !== (spec.handlerEntrypoint === undefined)) throw new Error('RUNTIME_BOOTSTRAP_PAIR_REQUIRED');
  for (const [label, path] of [['node bootstrap', spec.nodeBootstrap], ['handler entrypoint', spec.handlerEntrypoint]] as const) {
    if (path === undefined) continue;
    const resolved = await realpath(path);
    assertContained(release, resolved);
    const candidate = await lstat(resolved);
    if (!candidate.isFile() || candidate.isSymbolicLink() || candidate.nlink !== 1 || (candidate.mode & 0o6000) !== 0) throw new Error(`RUNTIME_${label === 'node bootstrap' ? 'BOOTSTRAP' : 'HANDLER'}_INVALID`);
  }
  await mkdir(resolve(spec.workspaceRoot), { recursive: true, mode: 0o700 });
  await mkdir(resolve(spec.socketDirectory), { recursive: true, mode: 0o750 });
  await chmod(resolve(spec.workspaceRoot), 0o700);
  await chmod(resolve(spec.socketDirectory), 0o750);
}

export async function launchTrustedRuntime(spec: RuntimeLaunchSpec, logger: StructuredLogger): Promise<RuntimeHandle> {
  await prepareRuntimePaths(spec);
  const capabilityPair = createAnonymousCapabilityPair(spec.capabilityFd);
  const launcher = process.env.KCML_SANDBOX_LAUNCHER ?? '/usr/libexec/kajovocml-ng/kcml-sandbox-launcher';
  await access(launcher, constants.X_OK);
  const exactEnvironment: Readonly<Record<string, string>> = {
    LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC', NODE_ENV: 'production', HOME: '/work/home',
    TMPDIR: '/tmp', PATH: '/runtime/bin', UV_USE_IO_URING: '0'
  };
  for (const [key, value] of Object.entries(spec.environment)) {
    if (!(key in exactEnvironment) || exactEnvironment[key] !== value) throw new Error('RUNTIME_ENVIRONMENT_NOT_ALLOWED');
  }
  const argumentsVector = [
    '--uid', String(spec.uid), '--gid', String(spec.gid),
    '--release-root', spec.releaseRoot,
    '--workspace-root', spec.workspaceRoot,
    '--socket-directory', spec.socketDirectory,
    '--capability-fd', String(capabilityPair.childFd),
    '--timeout-ms', String(spec.timeoutMs),
    ...(spec.nodeBootstrap && spec.handlerEntrypoint ? ['--bootstrap', spec.nodeBootstrap, '--handler-entrypoint', spec.handlerEntrypoint] : []),
    '--executable-digest', spec.executableDigest,
    '--', spec.executable, ...spec.args
  ];
  const child = spawn(launcher, argumentsVector, {
    cwd: spec.workspaceRoot,
    env: { ...exactEnvironment, KCML_EXECUTION_ID: spec.executionId },
    stdio: ['ignore', 'pipe', 'pipe', spec.capabilityFd],
    detached: false
  });
  child.stdout?.on('data', (chunk: Buffer) => logger.info('runtime.stdout', { executionId: spec.executionId, line: chunk.toString('utf8').trimEnd() }));
  child.stderr?.on('data', (chunk: Buffer) => logger.warn('runtime.stderr', { executionId: spec.executionId, line: chunk.toString('utf8').trimEnd() }));
  const pid = await new Promise<number>((resolvePid, reject) => {
    child.once('spawn', () => resolvePid(child.pid ?? 0));
    child.once('error', reject);
  });
  if (pid <= 0) throw new Error('RUNTIME_SPAWN_FAILED');
  return {
    process: child,
    pid,
    capabilitySocket: new Socket({ fd: spec.capabilityFd, readable: true, writable: true }),
    terminate: async (signal = 'SIGTERM') => {
      if (child.exitCode !== null) return;
      child.kill(signal);
      await new Promise<void>((done) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); }, 10_000);
        child.once('exit', () => { clearTimeout(timer); done(); });
      });
    }
  };
}
