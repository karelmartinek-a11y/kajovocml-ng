#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
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
  const ignored = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', 'artifacts', 'test-results', 'FORENSIC_AUDIT_CURRENT.md']);
  const output = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (ignored.has(entry.name) || entry.name.startsWith('._')) continue;
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
const traceabilityFor = (record) => record.extensions?.['kcml:traceability'];
const unmappedRequirements = requirements.records.filter((record) => {
  const traceability = traceabilityFor(record);
  return record.status !== 'ACTIVE' || !(record.artifactIds?.length) || traceability?.status !== 'COMPLETE';
});
if (unmappedRequirements.length) {
  const missingByKind = new Map();
  for (const record of unmappedRequirements) for (const kind of traceabilityFor(record)?.missingRelationKinds ?? ['TRACEABILITY_RECORD_MISSING']) missingByKind.set(kind, (missingByKind.get(kind) ?? 0) + 1);
  add('REQUIREMENTS_UNMAPPED', 'BLOCKING', 'Normativní atomy nemají skutečnou obousměrnou vazbu na implementaci, migraci, test a evidence anchors.', [
    `unmapped=${unmappedRequirements.length}`,
    `total=${requirements.records.length}`,
    ...[...missingByKind.entries()].sort((left, right) => left[0].localeCompare(right[0])).map(([kind, count]) => `missing:${kind}=${count}`),
    ...unmappedRequirements.slice(0, 20).map((record) => `${record.requirementId}:${(traceabilityFor(record)?.missingRelationKinds ?? ['TRACEABILITY_RECORD_MISSING']).join(',')}`)
  ]);
}

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
// A high-cardinality artifact relation is only blanket evidence when it is
// asserted without an atom-specific, concrete anchor. A source shard may
// legitimately cover many atoms, but each atom must occupy its own locator;
// a shared line or file-start anchor remains a blocking blanket relation.
const hasOneToOneConcreteAnchors = (record) => {
  const requirementIds = new Set(record.requirementIds ?? []);
  if (requirementIds.size === 0) return false;
  const anchors = (record.traceAnchors ?? []).filter((anchor) => anchor.symbol !== 'file-start');
  const anchoredRequirements = new Set(anchors.map((anchor) => anchor.requirementId));
  if (anchoredRequirements.size !== requirementIds.size || [...requirementIds].some((requirementId) => !anchoredRequirements.has(requirementId))) return false;
  const locatorOwner = new Map();
  for (const anchor of anchors) {
    const locator = anchor.locator;
    const previous = locatorOwner.get(locator);
    if (previous && previous !== anchor.requirementId) return false;
    locatorOwner.set(locator, anchor.requirementId);
  }
  return true;
};
const blanketArtifacts = artifacts.records.filter((record) => (record.requirementIds?.length ?? 0) >= requirements.records.length * 0.9 && !hasOneToOneConcreteAnchors(record));
if (blanketArtifacts.length) add('BLANKET_TRACEABILITY', 'BLOCKING', 'Plošné přiřazení téměř všech požadavků k artefaktu není důkaz traceability.', blanketArtifacts.map((record) => `${record.artifactId}:${record.requirementIds.length}/${requirements.records.length}`));

const operationSource = await read('packages/domain/src/operations.ts');
const specialCommands = [...operationSource.matchAll(/operation\.operationName==='([^']+)'/gu)].map((match) => match[1]);
const exactOperationSources = await Promise.all([
  'packages/domain/src/exact-operation-handlers.ts',
  'packages/domain/src/component-operations.ts',
  'packages/domain/src/runtime-operations.ts',
  'packages/domain/src/secret-operations.ts',
  'packages/domain/src/self-test-operations.ts',
  'packages/domain/src/monitor-operations.ts'
].map((path) => read(path)));
const exactOperationCommands = exactOperationSources.flatMap((source) =>
  [
    ...[...source.matchAll(/export const exact\w+Operations\s*=\s*new Set\(\[([\s\S]*?)\]\);/gu)]
      .flatMap((setMatch) => [...setMatch[1].matchAll(/'([^']+)'/gu)].map((operationMatch) => operationMatch[1])),
    ...[...source.matchAll(/case\s+'([^']+)'\s*:\s*return\s+handle[A-Z][A-Za-z0-9_]*/gu)].map((match) => match[1])
  ]
);
const catalogOperationNames = new Set(operations.records.map((record) => record.operationName));
const specializedCommands = [...new Set([...specialCommands, ...exactOperationCommands].filter((name) => catalogOperationNames.has(name)))].sort();
const surfaceMutationSource=await read('packages/domain/src/ssot-surface.ts');
const genericFallbackEvidence=[];
if (/\bmutateOperationEntity\s*\(/u.test(operationSource)&&specializedCommands.length<operations.records.length)genericFallbackEvidence.push('canonical-worker:mutateOperationEntity');
if (/class SsotSurfaceService/u.test(surfaceMutationSource)&&/private async applyMutation\(/u.test(surfaceMutationSource))genericFallbackEvidence.push('compiled-api:SsotSurfaceService.applyMutation');
if (genericFallbackEvidence.length) {
  add('GENERIC_OPERATION_FALLBACK', 'BLOCKING', 'Kanonické nebo compiled API mutace stále obsahují univerzální CRUD writer místo exaktní sémantiky operace ze SSOT.', [`specialized=${specializedCommands.length}`, `catalog=${operations.records.length}`,...genericFallbackEvidence, ...specializedCommands]);
}
const unimplementedOperations=operations.records.map((record)=>record.operationName).filter((operationName)=>!specializedCommands.includes(operationName));
if(unimplementedOperations.length)add('UNIMPLEMENTED_OPERATION_HANDLERS','BLOCKING','Katalogované operace bez exaktní implementace jsou fail-closed a nelze je považovat za hotové.',[`count=${unimplementedOperations.length}`,...unimplementedOperations]);
const generatedRouteSource=await read('apps/server/src/ssot-surface.generated.ts');const generatedRouteMatch=generatedRouteSource.match(/export const SSOT_ROUTES = (\[[\s\S]*?\]) as const;/u);
const serverSource=await read('apps/server/src/server.ts');const specialRouteBlock=serverSource.match(/const specialRouteKeys = new Set<string>\(\[([\s\S]*?)\]\);/u)?.[1]??'';const specialRouteKeys=new Set([...specialRouteBlock.matchAll(/'([^']+)'/gu)].map((match)=>match[1]));
const generatedRoutes=generatedRouteMatch?JSON.parse(generatedRouteMatch[1]):[];const unboundMutatingRoutes=generatedRoutes.filter((route)=>['POST','PUT','PATCH','DELETE'].includes(route.method)&&!route.operation&&!specialRouteKeys.has(route.routeKey));
if(unboundMutatingRoutes.length)add('UNBOUND_MUTATING_ROUTES','BLOCKING','Compiled mutující API routes jsou fail-closed, protože dosud nemají exact canonical operation binding a handler.',[`count=${unboundMutatingRoutes.length}`,...unboundMutatingRoutes.map((route)=>`${route.routeKey}:${route.entity}`)]);
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
const behavioralEvidence = testText.includes("BEHAVIORAL_OPERATION_EVIDENCE")
  && testText.includes('CanonicalOperationService')
  && testText.includes('IDEMPOTENCY_KEY_REQUIRED')
  && testText.includes('FaultCoverageTracker')
  && testText.includes('LinearizabilityHistory');
const operationCoverageCases = behavioralEvidence
  && testText.includes('OPERATION_COVERAGE_EVIDENCE')
  && testText.includes('it.each(catalog.records');
const effectiveTestCalls = operationCoverageCases ? Math.max(testCalls, operations.records.length) : testCalls;
if (effectiveTestCalls < operations.records.length) add('TEST_EVIDENCE_INSUFFICIENT', 'BLOCKING', 'Počet explicitních testovacích případů nemůže dokazovat všechny operace, failure pointy a closure predicates.', [`testFiles=${testFiles.length}`, `testCases=${effectiveTestCalls}`, `operations=${operations.records.length}`]);
if (!behavioralEvidence) add('BEHAVIORAL_OPERATION_EVIDENCE_MISSING', 'BLOCKING', 'Operation coverage nemá executable canonical admission, stale, idempotency, concurrency, fault a recovery evidence.', ['tests/operations/behavioral-contracts.test.ts']);
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
if (process.argv.includes('--write-current')) {
  const findingRows = unique.length === 0
    ? '| — | Žádné blocking findings. |\n'
    : unique.map((finding) => `| \`${finding.code}\` | ${finding.summary} |`).join('\n') + '\n';
  const evidence = unique.length === 0
    ? 'Nový hluboký audit neidentifikoval žádnou blokující odchylku.'
    : unique.map((finding) => `- \`${finding.code}\`: ${(finding.evidence ?? []).join('; ')}`).join('\n');
  const current = [
    '# Aktuální forenzní audit vůči SSOT',
    '',
    '> Tento dokument je generován pouze z aktuálního výstupu `scripts/deep-forensic-audit.mjs --write-current`; jedinou normativní autoritou zůstává `SSOT_CURRENT.md`.',
    '',
    '## Identita auditu',
    '',
    `- Autorita: \`${report.authority}\``,
    `- SHA-256 SSOT: \`${report.ssotDigest}\``,
    `- Stav: **${report.status}**`,
    `- Requirement atomy: ${report.measured.requirements}`,
    `- Operace: ${report.measured.operations}`,
    `- Auditované repository files: ${report.measured.repositoryFiles}`,
    `- Test files: ${report.measured.testFiles}`,
    '',
    '## Blocking findings',
    '',
    '| Kód | Stav |',
    '| --- | --- |',
    findingRows,
    '## Evidence',
    '',
    evidence,
    ''
  ].join('\n');
  await writeFile(join(root, 'FORENSIC_AUDIT_CURRENT.md'), current, 'utf8');
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (unique.length) process.exitCode = 1;
