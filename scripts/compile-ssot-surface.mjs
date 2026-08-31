#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseSsotEntities, parseSsotRoutes, entityForRoute, operationForRoute, surfaceFingerprint } from './lib/ssot-surface.mjs';

const root = process.cwd();
const checkOnly = process.argv.includes('--check');
const ssot = await readFile(join(root, 'SSOT_CURRENT.md'), 'utf8');
const entities = parseSsotEntities(ssot);
const routes = parseSsotRoutes(ssot);
if (entities.length !== 220) throw new Error(`SSOT_ENTITY_CARDINALITY_DRIFT:${entities.length}`);
if (routes.length !== 503) throw new Error(`SSOT_ROUTE_CARDINALITY_DRIFT:${routes.length}`);
const entityNames = new Set(entities.map((entity) => entity.name));
const operationsDoc = JSON.parse(await readFile(join(root, 'contracts/registries/operations/operations.json'), 'utf8'));
const operationNames = operationsDoc.records.map((record) => record.operationName);
const boundRoutes = routes.map((route) => {
  const entity = entityForRoute(route.path);
  if (!entityNames.has(entity)) throw new Error(`ROUTE_BOUND_TO_NON_SSOT_ENTITY:${route.routeKey}:${entity}`);
  return { ...route, entity, operation: operationForRoute(route, operationNames), mutating: ['POST','PUT','PATCH','DELETE'].includes(route.method) };
});
const routeKeys = new Set();
for (const route of boundRoutes) {
  if (routeKeys.has(route.routeKey)) throw new Error(`DUPLICATE_SSOT_ROUTE:${route.routeKey}`);
  routeKeys.add(route.routeKey);
}
const fingerprint = surfaceFingerprint(entities, boundRoutes);

const q = (name) => `"${name.replaceAll('"', '""')}"`;
const sqlLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;
const entityJson = `${JSON.stringify({ schemaVersion: '1.0', authority: 'SSOT_CURRENT.md', fingerprint, records: entities.map(({ contract, ...entity }) => entity) }, null, 2)}\n`;
const routeJson = `${JSON.stringify({ schemaVersion: '1.0', authority: 'SSOT_CURRENT.md', fingerprint, records: boundRoutes }, null, 2)}\n`;
const generatedTs = `/* AUTO-GENERATED mechanical SSOT surface. It is not implementation or conformance evidence. DO NOT EDIT. */\n` +
  `export const SSOT_SURFACE_FINGERPRINT = ${JSON.stringify(fingerprint)} as const;\n` +
  `export const SSOT_ENTITY_NAMES = ${JSON.stringify(entities.map((entity) => entity.name), null, 2)} as const;\n` +
  `export const SSOT_ROUTES = ${JSON.stringify(boundRoutes.map(({ ordinal, contractDigest, ...route }) => route), null, 2)} as const;\n` +
  `export type SsotEntityName = typeof SSOT_ENTITY_NAMES[number];\n` +
  `export type SsotRoute = typeof SSOT_ROUTES[number];\n`;

const primaryBaselinePath = join(root, 'database/baseline/00000000000000_greenfield.sql');
const primaryBaseline = await readFile(primaryBaselinePath, 'utf8');
const existing = new Set([...primaryBaseline.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+(?:kcml\.)?([a-z][a-z0-9_]*)/giu)].map((match) => match[1]));
const missing = entities.filter((entity) => !existing.has(entity.name));
const baseline = [];
baseline.push('BEGIN;', '', '-- AUTO-GENERATED provisional Chapter-25 name surface.', '-- These generic tables are incomplete until each entity has its exact SSOT schema and verified invariants.', `-- SSOT surface fingerprint: ${fingerprint}`, '');
for (const entity of missing) {
  const table = q(entity.name);
  baseline.push(`CREATE TABLE IF NOT EXISTS kcml.${table} (`);
  baseline.push('  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),');
  baseline.push('  parent_id uuid,');
  baseline.push('  stable_key text,');
  baseline.push('  display_name text,');
  baseline.push("  lifecycle text NOT NULL DEFAULT 'ACTIVE',");
  baseline.push("  document jsonb NOT NULL DEFAULT '{}'::jsonb,");
  baseline.push("  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,");
  baseline.push('  logical_operation_id uuid,');
  baseline.push('  correlation_id uuid,');
  baseline.push('  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),');
  baseline.push('  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),');
  baseline.push('  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),');
  baseline.push('  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),');
  baseline.push('  platform_incarnation_id uuid,');
  baseline.push('  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),');
  baseline.push('  deleted_at timestamptz');
  baseline.push(');');
  baseline.push(`CREATE UNIQUE INDEX IF NOT EXISTS ${q(`${entity.name}_stable_key_uq`)} ON kcml.${table}(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;`);
  baseline.push(`COMMENT ON TABLE kcml.${table} IS ${sqlLiteral(`SSOT_CURRENT.md chapter 25 entity ${entity.name}; contract sha256 ${entity.contractDigest}`)};`);
  if (entity.immutable) {
    baseline.push(`DROP TRIGGER IF EXISTS immutable_row ON kcml.${table};`);
    baseline.push(`CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml.${table} FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();`);
  } else {
    baseline.push(`DROP TRIGGER IF EXISTS touch_mutable_row ON kcml.${table};`);
    baseline.push(`CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml.${table} FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();`);
  }
  baseline.push('');
}
baseline.push('COMMIT;', '');
const generatedBaselineSql = baseline.join('\n');

const outputs = [
  [join(root, 'contracts/ssot-surface/entities.json'), entityJson],
  [join(root, 'contracts/ssot-surface/routes.json'), routeJson],
  [join(root, 'apps/server/src/ssot-surface.generated.ts'), generatedTs],
  [join(root, 'database/baseline/00000000000001_ssot_surface.sql'), generatedBaselineSql]
];

async function emit(path, content) {
  if (checkOnly) {
    let current = null;
    try { current = await readFile(path, 'utf8'); } catch { /* handled below */ }
    if (current !== content) throw new Error(`GENERATED_SSOT_SURFACE_DRIFT:${path.slice(root.length + 1)}`);
    return;
  }
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content);
}
for (const [path, content] of outputs) await emit(path, content);

console.log(JSON.stringify({ mode: checkOnly ? 'CHECK' : 'WRITE', fingerprint, entities: entities.length, routes: routes.length, generatedTables: missing.length, operationBoundRoutes: boundRoutes.filter((route) => route.operation).length, directSurfaceRoutes: boundRoutes.filter((route) => !route.operation).length }, null, 2));
