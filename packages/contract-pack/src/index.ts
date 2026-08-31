import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface OperationContract {
  operationId: string;
  operationName: string;
  operationRevision: number;
  operationFamily: string;
  aggregateRoot: string;
  exposureClass: string;
  sideEffectClass: string;
  retryClass: string;
  expectedStateVersionPolicy: string;
  idempotencyKeySource: string;
  canonicalDigest: string;
  [key: string]: unknown;
}

export interface OperationCatalog { kind: 'OPERATION_CATALOG'; records: OperationContract[]; }

export async function loadOperationCatalog(repositoryRoot = process.cwd()): Promise<OperationCatalog> {
  const raw = await readFile(resolve(repositoryRoot, 'contracts/registries/operations/operations.json'), 'utf8');
  const parsed = JSON.parse(raw) as OperationCatalog;
  if (parsed.kind !== 'OPERATION_CATALOG' || !Array.isArray(parsed.records)) throw new Error('Invalid operation catalog');
  return parsed;
}

export async function operationByName(name: string, repositoryRoot = process.cwd()): Promise<OperationContract> {
  const catalog = await loadOperationCatalog(repositoryRoot);
  const operation = catalog.records.find((candidate) => candidate.operationName === name);
  if (!operation) throw new Error(`Unknown operation: ${name}`);
  return operation;
}
