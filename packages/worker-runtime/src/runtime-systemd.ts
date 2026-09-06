import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import type { DatabaseClient } from '@kcml/database';
import { recordSideEffectIntent, recordSideEffectReadbackEvidence, type SpecialistCommandExecutor, type SpecialistExecutionContext, type SpecialistExecutionResult, type SpecialistReconcileResult } from '@kcml/domain';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RUNTIME_MUTATIONS = new Set([
  'runtime.prepare', 'runtime.instance.start', 'runtime.instance.restart', 'runtime.drain',
  'runtime.stop', 'runtime.cancel', 'runtime.instance.reconcile', 'runtime.cleanup.resume', 'runtime.invoke'
]);

type RuntimeAction = 'START' | 'RESTART' | 'DRAIN' | 'STOP' | 'RECONCILE' | 'CLEANUP' | 'INVOKE';

export interface SystemdUnitState {
  readonly unit: string;
  readonly loadState: string;
  readonly activeState: string;
  readonly subState: string;
  readonly mainPid: number;
  readonly invocationId: string | null;
  readonly controlGroup: string;
  readonly result: string;
}

export interface ProcessReadback {
  readonly pid: number;
  readonly bootId: string;
  readonly startTicks: bigint;
  readonly cgroupPath: string;
}

interface PreparedRuntimeAction {
  readonly operationName: string;
  readonly action: RuntimeAction;
  readonly runtimeInstanceId: string;
  readonly runtimeGeneration: bigint;
  readonly systemdUnitName: string;
  readonly sideEffectOperationId: string;
  readonly beforeEffectiveState: string;
  readonly desiredState: string;
  readonly cleanupOperationId: string | null;
}

interface RuntimeExecutionReadback {
  readonly action: RuntimeAction;
  readonly before: SystemdUnitState;
  readonly after: SystemdUnitState;
  readonly process: ProcessReadback | null;
}

function requireUuid(value: unknown, label: string): string {
  const text = typeof value === 'string' ? value.toLowerCase() : '';
  if (!UUID.test(text)) throw new Error(`${label}_INVALID`);
  return text;
}

export function runtimeHostUnit(runtimeInstanceId: string): string {
  return `kcml-runtime-host@${requireUuid(runtimeInstanceId, 'RUNTIME_INSTANCE_ID')}.service`;
}

export function parseSystemdShow(unit: string, stdout: string): SystemdUnitState {
  const values = new Map<string, string>();
  for (const line of stdout.split('\n')) {
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    values.set(line.slice(0, separator), line.slice(separator + 1));
  }
  const mainPid = Number(values.get('MainPID') ?? '0');
  if (!Number.isInteger(mainPid) || mainPid < 0) throw new Error('SYSTEMD_MAIN_PID_INVALID');
  const invocation = values.get('InvocationID') ?? '';
  if (invocation !== '' && !/^[0-9a-f]{32}$/u.test(invocation)) throw new Error('SYSTEMD_INVOCATION_ID_INVALID');
  return {
    unit,
    loadState: values.get('LoadState') ?? 'not-found',
    activeState: values.get('ActiveState') ?? 'unknown',
    subState: values.get('SubState') ?? 'unknown',
    mainPid,
    invocationId: invocation === '' ? null : `${invocation.slice(0, 8)}-${invocation.slice(8, 12)}-${invocation.slice(12, 16)}-${invocation.slice(16, 20)}-${invocation.slice(20)}`,
    controlGroup: values.get('ControlGroup') ?? '',
    result: values.get('Result') ?? 'unknown'
  };
}

async function command(executable: string, args: readonly string[], timeoutMs = 20_000): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(executable, [...args], { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' } });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`SYSTEMD_COMMAND_TIMEOUT:${args[0] ?? ''}`)); }, timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); if (stdout.length > 256 * 1024) child.kill('SIGKILL'); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); if (stderr.length > 64 * 1024) child.kill('SIGKILL'); });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`SYSTEMD_COMMAND_FAILED:${args[0] ?? ''}:${code ?? signal ?? 'unknown'}:${stderr.trim().slice(0, 1024)}`));
    });
  });
}

export class RuntimeSystemdController {
  public constructor(private readonly systemctl = process.env.KCML_SYSTEMCTL ?? '/usr/bin/systemctl') {}

  public async show(runtimeInstanceId: string): Promise<SystemdUnitState> {
    const unit = runtimeHostUnit(runtimeInstanceId);
    const stdout = await command(this.systemctl, ['show', '--no-pager', '--property=LoadState,ActiveState,SubState,MainPID,InvocationID,ControlGroup,Result', unit]);
    return parseSystemdShow(unit, stdout);
  }

  public async start(runtimeInstanceId: string): Promise<void> {
    await command(this.systemctl, ['start', '--no-ask-password', runtimeHostUnit(runtimeInstanceId)], 60_000);
  }

  public async restart(runtimeInstanceId: string): Promise<void> {
    await command(this.systemctl, ['restart', '--no-ask-password', runtimeHostUnit(runtimeInstanceId)], 60_000);
  }

  public async drain(runtimeInstanceId: string): Promise<void> {
    await command(this.systemctl, ['kill', '--no-ask-password', '--kill-whom=main', '--signal=SIGUSR1', runtimeHostUnit(runtimeInstanceId)]);
  }

  public async stop(runtimeInstanceId: string): Promise<void> {
    await command(this.systemctl, ['stop', '--no-ask-password', runtimeHostUnit(runtimeInstanceId)], 60_000);
  }
}

async function processReadback(state: SystemdUnitState): Promise<ProcessReadback | null> {
  if (state.mainPid <= 0) return null;
  const pid = state.mainPid;
  const bootIdRaw = await readFile('/proc/sys/kernel/random/boot_id', 'utf8');
  const statBefore = await readFile(`/proc/${pid}/stat`, 'utf8');
  const cgroup = await readFile(`/proc/${pid}/cgroup`, 'utf8');
  const statAfter = await readFile(`/proc/${pid}/stat`, 'utf8');
  const startTicks = (value: string): bigint => {
    const close = value.lastIndexOf(')');
    if (close < 0) throw new Error('RUNTIME_PROCESS_STAT_INVALID');
    const fields = value.slice(close + 2).trim().split(/\s+/u);
    const raw = fields[19];
    if (!raw || !/^\d+$/u.test(raw)) throw new Error('RUNTIME_PROCESS_START_TICKS_INVALID');
    return BigInt(raw);
  };
  const beforeTicks = startTicks(statBefore);
  const afterTicks = startTicks(statAfter);
  if (beforeTicks !== afterTicks) throw new Error('RUNTIME_PROCESS_IDENTITY_CHANGED');
  const cgroupPath = cgroup.split('\n').filter(Boolean).map((line) => line.slice(line.lastIndexOf(':') + 1)).find((value) => value.length > 0) ?? '';
  if (!cgroupPath || (state.controlGroup && cgroupPath !== state.controlGroup)) throw new Error('RUNTIME_CGROUP_MISMATCH');
  const bootId = bootIdRaw.trim().toLowerCase();
  requireUuid(bootId, 'HOST_BOOT_ID');
  return { pid, bootId, startTicks: beforeTicks, cgroupPath };
}

function actionFor(operationName: string): RuntimeAction {
  switch (operationName) {
    case 'runtime.prepare':
    case 'runtime.instance.start': return 'START';
    case 'runtime.instance.restart': return 'RESTART';
    case 'runtime.drain': return 'DRAIN';
    case 'runtime.stop':
    case 'runtime.cancel': return 'STOP';
    case 'runtime.instance.reconcile': return 'RECONCILE';
    case 'runtime.cleanup.resume': return 'CLEANUP';
    case 'runtime.invoke': return 'INVOKE';
    default: throw new Error('RUNTIME_SPECIALIST_OPERATION_UNSUPPORTED');
  }
}

function desiredStateFor(action: RuntimeAction): string {
  switch (action) {
    case 'START': return 'STARTING';
    case 'RESTART': return 'RESTARTING';
    case 'DRAIN': return 'DRAINING';
    case 'STOP':
    case 'CLEANUP': return 'STOPPED';
    case 'RECONCILE':
    case 'INVOKE': return 'UNCHANGED';
  }
}

async function runtimeForContext(client: DatabaseClient, context: SpecialistExecutionContext): Promise<{ runtime: Record<string, unknown>; cleanupOperationId: string | null }> {
  if (context.operation.operationName === 'runtime.cleanup.resume') {
    const cleanupId = requireUuid(context.targetId, 'RUNTIME_CLEANUP_ID');
    const cleanup = (await client.query(`SELECT * FROM kcml.runtime_cleanup_operation WHERE id=$1 FOR UPDATE`, [cleanupId])).rows[0] as Record<string, unknown> | undefined;
    if (!cleanup) throw new Error('RUNTIME_CLEANUP_NOT_FOUND');
    if (context.expectedStateVersion !== null && BigInt(String(cleanup.state_version)) !== context.expectedStateVersion) throw new Error('STATE_VERSION_CONFLICT');
    const runtime = (await client.query(`SELECT * FROM kcml.runtime_instance WHERE id=$1 FOR UPDATE`, [cleanup.runtime_instance_id])).rows[0] as Record<string, unknown> | undefined;
    if (!runtime) throw new Error('RUNTIME_INSTANCE_NOT_FOUND');
    return { runtime, cleanupOperationId: cleanupId };
  }
  const runtimeId = requireUuid(context.targetId, 'RUNTIME_INSTANCE_ID');
  const runtime = (await client.query(`SELECT * FROM kcml.runtime_instance WHERE id=$1 FOR UPDATE`, [runtimeId])).rows[0] as Record<string, unknown> | undefined;
  if (!runtime) throw new Error('RUNTIME_INSTANCE_NOT_FOUND');
  if (context.expectedStateVersion !== null && BigInt(String(runtime.state_version)) !== context.expectedStateVersion) throw new Error('STATE_VERSION_CONFLICT');
  return { runtime, cleanupOperationId: null };
}

function assertRuntimeAuthority(runtime: Record<string, unknown>, context: SpecialistExecutionContext): void {
  if (String(runtime.platform_incarnation_id) !== context.platformIncarnationId) throw new Error('PLATFORM_INCARNATION_STALE');
  if (BigInt(String(runtime.application_deployment_epoch)) !== context.applicationDeploymentEpoch) throw new Error('APPLICATION_DEPLOYMENT_EPOCH_STALE');
  if (BigInt(String(runtime.activation_epoch)) !== context.activationEpoch) throw new Error('ACTIVATION_EPOCH_STALE');
  const runtimeId = requireUuid(runtime.id, 'RUNTIME_INSTANCE_ID');
  if (String(runtime.systemd_unit_name) !== runtimeHostUnit(runtimeId)) throw new Error('RUNTIME_SYSTEMD_UNIT_MISMATCH');
  if (String(runtime.expected_service_class) !== 'kcml-runtime-host') throw new Error('RUNTIME_SERVICE_CLASS_MISMATCH');
}

function effectiveStateFromReadback(action: RuntimeAction, state: SystemdUnitState): string {
  if (state.activeState === 'failed') return 'FAILED';
  if (state.activeState === 'inactive' && state.mainPid === 0) return 'STOPPED';
  if (action === 'DRAIN' && state.activeState === 'active') return 'DRAINING';
  if (state.activeState === 'active') return 'STARTING';
  return 'UNKNOWN';
}

export class RuntimeLifecycleExecutor implements SpecialistCommandExecutor {
  public constructor(private readonly systemd = new RuntimeSystemdController()) {}

  public canHandle(operationName: string): boolean { return RUNTIME_MUTATIONS.has(operationName); }

  public async prepare(client: DatabaseClient, context: SpecialistExecutionContext): Promise<PreparedRuntimeAction> {
    const { runtime, cleanupOperationId } = await runtimeForContext(client, context);
    assertRuntimeAuthority(runtime, context);
    const runtimeInstanceId = requireUuid(runtime.id, 'RUNTIME_INSTANCE_ID');
    const action = actionFor(context.operation.operationName);
    const desiredState = desiredStateFor(action);
    const sideEffectOperationId = (await recordSideEffectIntent(client, { commandId: context.commandId, logicalOperationId: context.logicalOperationId, operationName: context.operation.operationName, sideEffectClass: context.operation.sideEffectClass, retryClass: context.operation.retryClass, platformIncarnationId: context.platformIncarnationId, applicationDeploymentEpoch: context.applicationDeploymentEpoch, recoveryEpoch: context.recoveryEpoch }, `runtime-systemd:${context.operation.operationName}`, `systemd:${runtimeHostUnit(runtimeInstanceId)}`, { operationName: context.operation.operationName, runtimeInstanceId, logicalOperationId: context.logicalOperationId }, { oracle: 'SYSTEMD_KERNEL_READBACK', runtimeInstanceId, unit: runtimeHostUnit(runtimeInstanceId) })).id;
    if (desiredState !== 'UNCHANGED') {
      await client.query(`UPDATE kcml.runtime_instance SET desired_state=$2,correlation_id=$3,
        drain_logical_operation_id=CASE WHEN $2='DRAINING' THEN $4 ELSE drain_logical_operation_id END,
        stop_logical_operation_id=CASE WHEN $2='STOPPED' THEN $4 ELSE stop_logical_operation_id END,
        restart_logical_operation_id=CASE WHEN $2='RESTARTING' THEN $4 ELSE restart_logical_operation_id END,
        state_version=state_version+1 WHERE id=$1`, [runtimeInstanceId, desiredState, context.correlationId, context.logicalOperationId]);
    }
    return {
      operationName: context.operation.operationName, action, runtimeInstanceId,
      runtimeGeneration: BigInt(String(runtime.runtime_generation)), systemdUnitName: String(runtime.systemd_unit_name),
      sideEffectOperationId, beforeEffectiveState: String(runtime.effective_state), desiredState, cleanupOperationId
    };
  }

  public async execute(preparedValue: unknown): Promise<RuntimeExecutionReadback> {
    const prepared = preparedValue as PreparedRuntimeAction;
    const before = await this.systemd.show(prepared.runtimeInstanceId).catch(() => ({
      unit: prepared.systemdUnitName, loadState: 'not-found', activeState: 'inactive', subState: 'dead', mainPid: 0,
      invocationId: null, controlGroup: '', result: 'unknown'
    } satisfies SystemdUnitState));
    switch (prepared.action) {
      case 'START': await this.systemd.start(prepared.runtimeInstanceId); break;
      case 'RESTART': await this.systemd.restart(prepared.runtimeInstanceId); break;
      case 'DRAIN': await this.systemd.drain(prepared.runtimeInstanceId); break;
      case 'STOP':
      case 'CLEANUP': await this.systemd.stop(prepared.runtimeInstanceId); break;
      case 'RECONCILE': break;
      case 'INVOKE': throw new Error('RUNTIME_GATEWAY_CONNECTION_REQUIRED');
    }
    const after = await this.systemd.show(prepared.runtimeInstanceId);
    const process = after.mainPid > 0 ? await processReadback(after) : null;
    return { action: prepared.action, before, after, process };
  }

  public async reconcile(client: DatabaseClient, preparedValue: unknown, execution: SpecialistExecutionResult, context: SpecialistExecutionContext): Promise<SpecialistReconcileResult> {
    const prepared = preparedValue as PreparedRuntimeAction;
    if (!execution.ok) {
      await recordSideEffectReadbackEvidence(client, prepared.sideEffectOperationId, {
        operationName: prepared.operationName,
        runtimeInstanceId: prepared.runtimeInstanceId,
        outcome: 'UNKNOWN',
        errorCode: execution.error instanceof Error ? execution.error.message : 'RUNTIME_EFFECT_UNKNOWN'
      }, 'UNKNOWN');
      return { disposition: 'FAILED', error: execution.error };
    }
    const readback = execution.value as RuntimeExecutionReadback;
    const effectiveState = effectiveStateFromReadback(prepared.action, readback.after);
    const stopApplied = ['STOP', 'CLEANUP'].includes(prepared.action) ? effectiveState === 'STOPPED' : true;
    const activeApplied = ['START', 'RESTART', 'DRAIN'].includes(prepared.action) ? readback.after.activeState === 'active' : true;
    const applied = stopApplied && activeApplied;
    await recordSideEffectReadbackEvidence(client, prepared.sideEffectOperationId, {
      unit: readback.after, process: readback.process ? { ...readback.process, startTicks: readback.process.startTicks.toString() } : null,
      operationName: prepared.operationName, runtimeInstanceId: prepared.runtimeInstanceId
    }, applied ? 'CONFIRMED_APPLIED' : 'CONFIRMED_NOT_APPLIED');
    if (!applied) return { disposition: 'FAILED', error: new Error('RUNTIME_SYSTEMD_READBACK_NOT_APPLIED') };

    await client.query(`UPDATE kcml.runtime_instance SET effective_state=$2,effective_at=clock_timestamp(),
      systemd_invocation_id=$3,host_boot_id=$4,main_pid=$5,process_start_ticks=$6,cgroup_path=CASE WHEN $7<>'' THEN $7 ELSE cgroup_path END,
      stopped_at=CASE WHEN $2='STOPPED' THEN clock_timestamp() ELSE stopped_at END,
      correlation_id=$8,state_version=state_version+1 WHERE id=$1`, [
      prepared.runtimeInstanceId, effectiveState, readback.after.invocationId, readback.process?.bootId ?? null,
      readback.process?.pid ?? null, readback.process?.startTicks.toString() ?? null, readback.process?.cgroupPath ?? '', context.correlationId
    ]);
    if (prepared.cleanupOperationId && effectiveState === 'STOPPED') {
      await client.query(`UPDATE kcml.runtime_cleanup_operation SET checkpoint=jsonb_set(checkpoint,'{systemdStopped}','true'::jsonb,true),
        outcomes=outcomes || jsonb_build_object('systemdStop','CONFIRMED'),state_version=state_version+1,updated_at=clock_timestamp()
        WHERE id=$1 AND completed_at IS NULL`, [prepared.cleanupOperationId]);
    }
    return { disposition: 'APPLIED', output: {
      runtimeInstanceId: prepared.runtimeInstanceId,
      runtimeGeneration: prepared.runtimeGeneration.toString(),
      desiredState: prepared.desiredState,
      effectiveState,
      systemdUnitName: readback.after.unit,
      systemdInvocationId: readback.after.invocationId,
      mainPid: readback.after.mainPid,
      processStartTicks: readback.process?.startTicks.toString() ?? null,
      hostBootId: readback.process?.bootId ?? null,
      cgroupPath: readback.process?.cgroupPath ?? null,
      sideEffectOperationId: prepared.sideEffectOperationId
    } };
  }
}
