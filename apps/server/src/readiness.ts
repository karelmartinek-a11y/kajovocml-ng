import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface ServiceHeartbeat {
  service_name: string;
  instance_id?: string;
  release_id: string;
  source_sha: string;
  deployment_epoch: string | number | bigint;
  status: string;
  observed_at: string | Date;
  expires_at: string | Date;
}

export interface ServiceReadinessResult {
  ready: boolean;
  expectedServices: string[];
  missingServices: string[];
  unhealthyServices: string[];
  staleServices: string[];
  mismatchedServices: string[];
}

const NON_HEARTBEATING_UNITS = new Set(['kcml-web-api']);
const ALWAYS_REQUIRED_HEARTBEATS = ['kcml-browser-host'];

export async function loadExpectedHeartbeatServices(repositoryRoot: string): Promise<string[]> {
  const manifest = await readFile(resolve(repositoryRoot, 'deploy/systemd/services.tsv'), 'utf8');
  const services = new Set<string>(ALWAYS_REQUIRED_HEARTBEATS);
  for (const rawLine of manifest.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const columns = line.split('|');
    if (columns.length !== 7) throw new Error(`SERVICE_MANIFEST_ROW_INVALID:${line}`);
    const serviceName = columns[0]?.trim();
    const enabled = columns[6]?.trim();
    if (!serviceName) throw new Error('SERVICE_MANIFEST_NAME_MISSING');
    if (!['yes', 'no'].includes(enabled ?? '')) throw new Error(`SERVICE_MANIFEST_ENABLED_INVALID:${serviceName}`);
    if (enabled === 'yes' && !NON_HEARTBEATING_UNITS.has(serviceName)) services.add(serviceName);
  }
  return [...services].sort();
}

export function evaluateServiceReadiness(
  heartbeats: readonly ServiceHeartbeat[],
  expectedServices: readonly string[],
  expectedReleaseId: string,
  expectedSourceSha: string,
  expectedDeploymentEpoch: string | number | bigint,
  now = new Date()
): ServiceReadinessResult {
  const latest = new Map<string, ServiceHeartbeat>();
  for (const heartbeat of heartbeats) {
    const current = latest.get(heartbeat.service_name);
    if (!current || new Date(heartbeat.observed_at).getTime() > new Date(current.observed_at).getTime()) latest.set(heartbeat.service_name, heartbeat);
  }

  const missingServices: string[] = [];
  const unhealthyServices: string[] = [];
  const staleServices: string[] = [];
  const mismatchedServices: string[] = [];
  const expectedEpoch = String(expectedDeploymentEpoch);
  const normalizedSourceSha = expectedSourceSha.toLowerCase();

  for (const serviceName of [...new Set(expectedServices)].sort()) {
    const heartbeat = latest.get(serviceName);
    if (!heartbeat) {
      missingServices.push(serviceName);
      continue;
    }
    if (heartbeat.status !== 'READY') unhealthyServices.push(serviceName);
    if (!Number.isFinite(new Date(heartbeat.expires_at).getTime()) || new Date(heartbeat.expires_at).getTime() <= now.getTime()) staleServices.push(serviceName);
    if (
      heartbeat.release_id !== expectedReleaseId ||
      heartbeat.source_sha.toLowerCase() !== normalizedSourceSha ||
      String(heartbeat.deployment_epoch) !== expectedEpoch
    ) mismatchedServices.push(serviceName);
  }

  return {
    ready: missingServices.length === 0 && unhealthyServices.length === 0 && staleServices.length === 0 && mismatchedServices.length === 0,
    expectedServices: [...new Set(expectedServices)].sort(),
    missingServices,
    unhealthyServices,
    staleServices,
    mismatchedServices
  };
}
