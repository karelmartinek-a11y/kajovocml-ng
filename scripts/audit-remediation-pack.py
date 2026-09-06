from pathlib import Path
import json

root=Path('.')
p=root/'scripts/compile-contract-pack.mjs'
s=p.read_text(encoding='utf-8')
if "    status: 'UNMAPPED'," in s:
    s=s.replace("    status: 'UNMAPPED',","    status: 'ACTIVE',",1)
elif "    status: 'ACTIVE'," not in s:
    raise SystemExit('requirement status marker not found')

start=s.index("  const runtimeMatrixSourcePath = 'deploy/runtime/runtime-boundary-manifest.json';")
end=s.index("  const errorRecords = parsed.errors.map((code) => {",start)
runtime_block="""  const runtimeMatrixSourcePath = 'contracts/normative/runtime-boundaries.source.json';
  const runtimeMatrixSource = JSON.parse(await readFile(join(root, runtimeMatrixSourcePath), 'utf8'));
  if (runtimeMatrixSource.schemaVersion !== '1.0' || runtimeMatrixSource.kind !== 'RUNTIME_BOUNDARY_NORMATIVE_SOURCE' || !Array.isArray(runtimeMatrixSource.runtimeTypes) || runtimeMatrixSource.runtimeTypes.length === 0) {
    throw new Error('RUNTIME_BOUNDARY_MATRIX_SOURCE_INVALID');
  }
  const runtimeRecords = [];
  const runtimeTypeIds = new Set();
  for (const sourceRecord of runtimeMatrixSource.runtimeTypes) {
    if (runtimeTypeIds.has(sourceRecord.runtimeType)) throw new Error(`RUNTIME_BOUNDARY_DUPLICATE_TYPE:${sourceRecord.runtimeType}`);
    runtimeTypeIds.add(sourceRecord.runtimeType);
    const requiredFields = ['runtimeBoundaryId', 'runtimeType', 'processIdentity', 'systemdUnit', 'osUser', 'osGroup', 'socketOrCapabilityChannels', 'peerIdentityContract', 'executionContextSource', 'allowedNetworkFamilies', 'allowedEndpoints', 'allowedFilesystemRead', 'allowedFilesystemWrite', 'allowedCredentials', 'allowedInheritedFds', 'allowedCapabilities', 'seccompProfileDigest', 'namespaceProfileDigest', 'cgroupProfile', 'prohibitedResources', 'lifecycleStateMachineId', 'runtimeGenerationPolicy', 'serviceGenerationPolicy', 'staleProcessFencing', 'shutdownDrainKillPolicy', 'childProcessPolicy', 'cleanupPredicateId', 'auditEvidence', 'testIds', 'requirementRefs'];
    for (const field of requiredFields) if (!(field in sourceRecord)) throw new Error(`RUNTIME_BOUNDARY_FIELD_MISSING:${sourceRecord.runtimeType}:${field}`);
    if (sourceRecord.prohibitedResources.length === 0) throw new Error(`RUNTIME_BOUNDARY_PROHIBITIONS_EMPTY:${sourceRecord.runtimeType}`);
    if (!/^sha256:[0-9a-f]{64}$/u.test(sourceRecord.seccompProfileDigest) || !/^sha256:[0-9a-f]{64}$/u.test(sourceRecord.namespaceProfileDigest)) throw new Error(`RUNTIME_BOUNDARY_PROFILE_DIGEST_INVALID:${sourceRecord.runtimeType}`);
    const requirementIds = [];
    for (const requirementRef of sourceRecord.requirementRefs) {
      const requirement = requirements.find((candidate) => candidate.authoritySourceRefs.includes(requirementRef));
      if (!requirement) throw new Error(`RUNTIME_BOUNDARY_REQUIREMENT_MISSING:${sourceRecord.runtimeType}:${requirementRef}`);
      requirementIds.push(requirement.requirementId);
    }
    const record = { ...sourceRecord };
    delete record.requirementRefs;
    record.requirementIds = [...new Set(requirementIds)].sort();
    record.authoritySourceRefs = [...new Set([...(runtimeMatrixSource.authoritySourceRefs ?? []), ...sourceRecord.requirementRefs])].sort();
    record.canonicalDigest = sha(canonical(record));
    runtimeRecords.push(record);
  }
  const runtimes = runtimeRecords;
"""
s=s[:start]+runtime_block+s[end:]
s=s.replace("  const paritySourcePaths = [...new Set(operations.flatMap((operation) => operation.surfaceBindings.filter((binding) => binding.status === 'APPLICABLE').map((binding) => binding.sourcePath).filter(Boolean)))];\n  const paritySourceText = new Map();\n  for (const sourcePath of paritySourcePaths) paritySourceText.set(sourcePath, await readFile(join(root, sourcePath), 'utf8'));\n","")
s=s.replace("      const sourceText = paritySourceText.get(binding.sourcePath);\n      if (!sourceText?.includes(binding.sourceMarker)) throw new Error(`EXPOSURE_PARITY_SOURCE_SYMBOL_MISSING:${operation.operationName}:${binding.sourcePath}:${binding.sourceMarker}`);\n","")
start=s.index("  const artifacts = [];")
end=s.index("  const schemaManifest = {",start)
s=s[:start]+"  // Normative compilation ends at declared SSOT and versioned contract sources.\n  // Implementation, test and runtime evidence is compiled/validated by the separate traceability layer.\n\n"+s[end:]
for fragment in [
"  addArtifact('contracts/registry-schemas/artifact-trace.schema.json', await readFile(join(root, 'contracts/registry-schemas/artifact-trace.schema.json')), { artifactKind: 'REGISTRY_SCHEMA', requirementIds: traceabilityRequirementIds, authoritySourceRefs: ['ssot://55/artifact-traceability/file-level'] });\n",
"  addArtifact('contracts/registry-schemas/requirement-atom-trace-source.schema.json', await readFile(join(root, 'contracts/registry-schemas/requirement-atom-trace-source.schema.json')), { artifactKind: 'REGISTRY_SCHEMA', requirementIds: traceabilityRequirementIds, authoritySourceRefs: ['ssot://55.19/55-19-artifact-traceability-a-z-kaz-orphan-implementation/atom-13'] });\n"
]: s=s.replace(fragment,'')
lines=s.splitlines(keepends=True)
lines=[line for line in lines if not ("addArtifact(`contracts/registry-schemas/${name}`" in line or "addArtifact('contracts/registry-schemas/bundle-manifest.json'" in line)]
s=''.join(lines)
s=s.replace("    ['EXPOSURE_PARITY_REGISTRY', 'exposure-parity/exposure-parity.json', exposure],\n    ['ARTIFACT_TRACE_REGISTRY', 'artifact-trace/artifact-trace.json', artifacts]\n","    ['EXPOSURE_PARITY_REGISTRY', 'exposure-parity/exposure-parity.json', exposure]\n")
s=s.replace("    ['authorityOwnershipIds', 'AUTHORITY_OWNERSHIP_REGISTRY'], ['artifactIds', 'ARTIFACT_TRACE_REGISTRY']\n","    ['authorityOwnershipIds', 'AUTHORITY_OWNERSHIP_REGISTRY']\n")
marker="  const blockers = ["
if marker in s:
    a=s.index(marker)
    b=s.index("  const mismatches = [];",a)
    s=s[:a]+"  // Architecture readiness is produced by the evidence evaluator, never by the normative compiler.\n\n"+s[b:]
s=s.replace(" repositoryArtifacts=${artifacts.length}","")
p.write_text(s,encoding='utf-8')

src=json.loads((root/'deploy/runtime/runtime-boundary-manifest.json').read_text())
compiled=json.loads((root/'contracts/registries/runtime-boundaries/runtime-boundaries.json').read_text())['records']
by={r['runtimeBoundaryId']:r for r in compiled}
out={'schemaVersion':'1.0','kind':'RUNTIME_BOUNDARY_NORMATIVE_SOURCE','authoritySourceRefs':['ssot://55.9/55-9-runtime-boundary-matrix/atom-34'],'runtimeTypes':[]}
for r in src['runtimeTypes']:
    c=by[r['runtimeBoundaryId']]
    nr={k:v for k,v in r.items() if k!='evidence'}
    nr['seccompProfileDigest']=c['seccompProfileDigest']
    nr['namespaceProfileDigest']=c['namespaceProfileDigest']
    if c.get('seccompProfileDigestSource') is not None: nr['seccompProfileDigestSource']=c['seccompProfileDigestSource']
    if c.get('namespaceProfileDigestSource') is not None: nr['namespaceProfileDigestSource']=c['namespaceProfileDigestSource']
    out['runtimeTypes'].append(nr)
q=root/'contracts/normative/runtime-boundaries.source.json'; q.parent.mkdir(parents=True,exist_ok=True); q.write_text(json.dumps(out,indent=2,ensure_ascii=False)+'\n')

pkg=json.loads((root/'package.json').read_text())
pkg['scripts']['contracts:build']='node scripts/compile-ssot-surface.mjs && node scripts/compile-contract-pack.mjs && node scripts/generate-requirement-trace.mjs && node scripts/compile-contract-trace.mjs'
pkg['scripts']['contracts:trace']='node scripts/generate-requirement-trace.mjs && node scripts/compile-contract-trace.mjs'
pkg['scripts']['contracts:check']='node scripts/compile-ssot-surface.mjs --check && node scripts/compile-contract-pack.mjs --check && node scripts/validate-contract-pack.mjs && node scripts/compile-contract-trace.mjs --check && node scripts/validate-contract-trace.mjs && node scripts/verify-authority-ownership.mjs && node scripts/verify-error-codes.mjs'
pkg['scripts']['conformance:audit']='pnpm run contracts:check && node scripts/conformance-audit.mjs'
(root/'package.json').write_text(json.dumps(pkg,indent=2,ensure_ascii=False)+'\n')
print('PACK-001 transformation applied')