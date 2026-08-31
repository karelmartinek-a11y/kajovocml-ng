#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runForensicAudit } from './lib/forensic-audit.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const findings = [];
const add = (code, severity, summary, evidence) => findings.push({ code, severity, summary, evidence });
const read = (path) => readFile(join(root, path), 'utf8');
const json = async (path) => JSON.parse(await read(path));
const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

async function walk(directory = root) {
  const ignored = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', 'artifacts']);
  const output = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(path));
    else if (entry.isFile()) output.push(path);
  }
  return output;
}

const staticAudit = await runForensicAudit(root);
for (const finding of staticAudit.findings) {
  add(finding.code, 'BLOCKING', finding.message, finding.evidence ?? []);
}

const manifest = await json('contracts/registries/manifest.json');
const registryByKind = new Map(manifest.registries.map((record) => [record.kind, record]));
const registry = async (kind) => json(registryByKind.get(kind).dataRef);
const requirements = await registry('REQUIREMENT_REGISTRY');
const operations = await registry('OPERATION_CATALOG');
const bindings = await registry('BINDING_REGISTRY');
const faults = await registry('FAULT_CATALOG');
const recovery = await registry('RECOVERY_ORACLE_REGISTRY');
const artifacts = await registry('ARTIFACT_TRACE_REGISTRY');
const architecture = await json('contracts/registries/architecture-readiness.json');

for (const [kind, code, summary] of [
  ['POSTGRES_CONTRACT_MATRIX', 'POSTGRES_CONTRACT_MATRIX_EMPTY', 'Chybí ověřené PostgreSQL kontrakty jednotlivých operací.'],
  ['RUNTIME_BOUNDARY_MATRIX', 'RUNTIME_BOUNDARY_MATRIX_EMPTY', 'Chybí ověřené záznamy runtime boundary.'],
  ['AUTHORITY_OWNERSHIP_REGISTRY', 'AUTHORITY_OWNERSHIP_REGISTRY_EMPTY', 'Chybí ověřená single-writer ownership evidence.'],
  ['ERROR_RETRY_REGISTRY', 'ERROR_RETRY_REGISTRY_EMPTY', 'Chybí exaktní error/retry registry.'],
  ['CLOSURE_PREDICATE_REGISTRY', 'CLOSURE_PREDICATE_REGISTRY_EMPTY', 'Chybí spustitelné closure predicates.'],
  ['EXPOSURE_PARITY_REGISTRY', 'EXPOSURE_PARITY_REGISTRY_EMPTY', 'Chybí ověřená exposure parity evidence.']
]) {
  const data = await registry(kind);
  if (data.records.length === 0) add(code, 'BLOCKING', summary, [registryByKind.get(kind).dataRef]);
}
const unmappedRequirements = requirements.records.filter((record) => record.status !== 'ACTIVE' || !(record.artifactIds?.length));
if (unmappedRequirements.length) add('REQUIREMENTS_UNMAPPED', 'BLOCKING', 'Normativní atomy nemají skutečnou obousměrnou vazbu na implementaci a testy.', [`unmapped=${unmappedRequirements.length}`, `total=${requirements.records.length}`]);

if (architecture.status !== 'PASS' || architecture.gates.some((gate) => gate.status !== 'PASS')) {
  add('ARCHITECTURE_READINESS_NOT_PASS', 'BLOCKING', 'Nejméně jedna povinná architektonická brána nemá prokazatelný PASS.', [
    `overall=${architecture.status}`,
    ...architecture.gates.filter((gate) => gate.status !== 'PASS').map((gate) => `${gate.gateId}=${gate.status}`),
    ...(architecture.blockers ?? []).map((blocker) => `${blocker.code}: ${blocker.summary}`)
  ]);
}
if (bindings.records.length === 0) add('BINDING_REGISTRY_EMPTY', 'BLOCKING', 'SSOT vyžaduje exaktní registr vazeb, ale registr je prázdný.', ['contracts/registries/bindings/bindings.json']);
if (faults.records.length === 0) add('FAULT_CATALOG_EMPTY', 'BLOCKING', 'Povinný katalog fault pointů je prázdný.', ['contracts/registries/faults/faults.json']);
const emptyOracles = recovery.records.filter((record) => !Array.isArray(record.rules) || record.rules.length === 0);
if (emptyOracles.length) add('RECOVERY_ORACLE_RULES_EMPTY', 'BLOCKING', 'Recovery oracle nemá rozhodovací pravidla a nemůže dokazovat known outcome.', emptyOracles.map((record) => record.recoveryOracleId));

const repositoryFiles = (await walk()).filter((path) => !path.includes('/contracts/registries/'));
if (artifacts.records.length < repositoryFiles.length) {
  add('ARTIFACT_TRACE_NOT_FILE_LEVEL', 'BLOCKING', 'Artifact trace není úplná obousměrná evidence po jednotlivých souborech.', [`registryRecords=${artifacts.records.length}`, `repositoryFiles=${repositoryFiles.length}`]);
}
const badArtifactDigests = [];
for (const record of artifacts.records) {
  const path = join(root, record.repositoryPath);
  let actual;
  try { actual = digest(await readFile(path)); } catch { actual = 'UNREADABLE_OR_DIRECTORY'; }
  if (record.contentDigest !== actual) badArtifactDigests.push(`${record.artifactId}:${record.repositoryPath}`);
}
if (badArtifactDigests.length) add('ARTIFACT_CONTENT_DIGEST_INVALID', 'BLOCKING', 'Artifact registry obsahuje digest cesty nebo adresáře místo digestu skutečného souboru.', badArtifactDigests);
const blanketArtifacts = artifacts.records.filter((record) => (record.requirementIds?.length ?? 0) >= requirements.records.length * 0.9);
if (blanketArtifacts.length) add('BLANKET_TRACEABILITY', 'BLOCKING', 'Plošné přiřazení téměř všech požadavků k artefaktu není důkaz traceability.', blanketArtifacts.map((record) => `${record.artifactId}:${record.requirementIds.length}/${requirements.records.length}`));

const operationSource = await read('packages/domain/src/operations.ts');
const specialCommands = [...operationSource.matchAll(/operation\.operationName==='([^']+)'/gu)].map((match) => match[1]);
if (operationSource.includes('mutateOperationEntity(client,handler.entity') && specialCommands.length < operations.records.length) {
  add('GENERIC_OPERATION_FALLBACK', 'BLOCKING', 'Většina kanonických operací je obsloužena univerzální CRUD mutací, nikoli exaktní sémantikou operace ze SSOT.', [`specialized=${specialCommands.length}`, `catalog=${operations.records.length}`, ...specialCommands]);
}
const surfaceSql = await read('database/baseline/00000000000001_ssot_surface.sql');
const genericDocumentTables = (surfaceSql.match(/document jsonb NOT NULL DEFAULT '\{\}'::jsonb/giu) ?? []).length;
if (genericDocumentTables > 0) add('GENERIC_ENTITY_SCHEMA', 'BLOCKING', 'Fyzické entity jsou zčásti generovány jednotnou document JSONB šablonou místo exaktních schémat kapitoly 25.', [`genericTables=${genericDocumentTables}`]);

const mcpSource = await read('packages/mcp-runtime/src/index.ts');
const advertisedMcp = ['resources', 'prompts', 'tasks', 'elicitation'].filter((capability) => mcpSource.includes(`${capability}:{`));
const implementedMcp = [...mcpSource.matchAll(/request\.method==='([^']+)'/gu)].map((match) => match[1]);
if (advertisedMcp.length && !implementedMcp.some((method) => /^(resources|prompts|tasks|elicitation)\//u.test(method))) {
  add('MCP_CAPABILITY_OVERCLAIM', 'BLOCKING', 'MCP discovery inzeruje schopnosti, pro které dispatch nemá implementované metody.', [`advertised=${advertisedMcp.join(',')}`, `implemented=${implementedMcp.join(',')}`]);
}

const openaiSource = await read('packages/openai-runtime/src/index.ts');
const missingOpenAi = ['background', 'responses.retrieve', 'previous_response_id', 'function_call_output'].filter((marker) => !openaiSource.includes(marker));
if (missingOpenAi.length) add('OPENAI_LIFECYCLE_INCOMPLETE', 'BLOCKING', 'OpenAI runtime nepokrývá povinný persisted background/retrieve/resume/tool-output lifecycle.', missingOpenAi.map((marker) => `missing:${marker}`));

const generationSource = await read('packages/generation-orchestrator/src/index.ts');
const missingGeneration = ['orphan', 'workspace', 'candidate', 'integration', 'validation', 'activation'].filter((marker) => !generationSource.toLowerCase().includes(marker));
if (missingGeneration.length) add('GENERATION_PIPELINE_INCOMPLETE', 'BLOCKING', 'Generation orchestrator je pouze přechod stavů a jeden model call; povinné fáze a cleanup nejsou implementované.', missingGeneration.map((marker) => `missing:${marker}`));

const browserSource = await read('packages/browser-automation-runtime/src/index.ts');
const missingBrowser = ['setInputFiles', "waitForEvent('download'", 'passkey', 'challenge'].filter((marker) => !browserSource.includes(marker));
if (browserSource.includes('acceptDownloads:false') || missingBrowser.length) add('BROWSER_LIFECYCLE_INCOMPLETE', 'BLOCKING', 'Browser runtime nepokrývá povinný download/upload/challenge/passkey lifecycle.', ['acceptDownloads=false', ...missingBrowser.map((marker) => `missing:${marker}`)]);

const sandboxSource = await read('deploy/runtime/kcml-sandbox-launcher.c');
if (!/seccomp/iu.test(sandboxSource)) add('RUNTIME_SECCOMP_MISSING', 'BLOCKING', 'Sandbox launcher nenastavuje SSOT požadovaný seccomp allowlist.', ['deploy/runtime/kcml-sandbox-launcher.c']);

const testFiles = repositoryFiles.filter((path) => relative(root, path).startsWith('tests/') && /\.(?:ts|tsx|sh)$/u.test(path));
const testText = (await Promise.all(testFiles.map((path) => readFile(path, 'utf8')))).join('\n');
const testCalls = (testText.match(/\b(?:it|test)\s*\(/gu) ?? []).length;
if (testCalls < operations.records.length) add('TEST_EVIDENCE_INSUFFICIENT', 'BLOCKING', 'Počet explicitních testovacích případů nemůže dokazovat všechny operace, failure pointy a closure predicates.', [`testFiles=${testFiles.length}`, `testCases=${testCalls}`, `operations=${operations.records.length}`]);
const propertySource = await read('tests/property/run.ts');
const chaosSource = await read('tests/chaos/run.ts');
if (!propertySource.includes('CanonicalOperationService') || !chaosSource.includes('CanonicalOperationService')) add('MODEL_FAST_NOT_SUT', 'BLOCKING', 'MODEL_FAST testy ověřují pomocný model, ne skutečnou kanonickou operation service.', ['tests/property/run.ts', 'tests/chaos/run.ts']);

const unique = [...new Map(findings.map((finding) => [finding.code, finding])).values()].sort((a, b) => a.code.localeCompare(b.code));
const report = {
  schemaVersion: '1.0',
  authority: 'SSOT_CURRENT.md',
  ssotDigest: digest(await readFile(join(root, 'SSOT_CURRENT.md'))),
  status: unique.length === 0 ? 'PASS' : 'FAIL',
  measured: { requirements: requirements.records.length, operations: operations.records.length, repositoryFiles: repositoryFiles.length, testFiles: testFiles.length },
  findings: unique
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (unique.length) process.exitCode = 1;
