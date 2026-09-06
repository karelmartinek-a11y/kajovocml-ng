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

import base64
validator=base64.b64decode('IyEvdXNyL2Jpbi9lbnYgbm9kZQppbXBvcnQgeyBjcmVhdGVIYXNoIH0gZnJvbSAnbm9kZTpjerlwdG8nOwppbXBvcnQgeyByZWFkRmlsZSB9IGZyb20gJ25vZGU6ZnMvcHJvbWlzZXMnOwppbXBvcnQgeyBkaXJuYW1lLCBqb2luIH0gZnJvbSAnbm9kZTpwYXRoJzsKaW1wb3J0IHsgZmlsZVVSTFRvUGF0aCB9IGZyb20gJ25vZGU6dXJsJzsKCmNvbnN0IHJvb3QgPSBqb2luKGRpcm5hbWUoZmlsZVVSTFRvUGF0aChpbXBvcnQubWV0YS51cmwpKSwgJy4uJyk7CmNvbnN0IGNhbm9uaWNhbCA9ICh2YWx1ZSkgPT4gewogIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB0eXBlb2YgdmFsdWUgIT09ICdvYmplY3QnKSByZXR1cm4gSlNPTi5zdHJpbmdpZnkodmFsdWUpOwogIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkgcmV0dXJuIGBbJHt2YWx1ZS5tYXAoY2Fub25pY2FsKS5qb2luKCcsJyl9XWA7CiAgcmV0dXJuIGB7JHtPYmplY3Qua2V5cyh2YWx1ZSkuc29ydCgpLm1hcCgoa2V5KSA9PiBgJHtKU09OLnN0cmluZ2lmeShrZXkpfToke2Nhbm9uaWNhbCh2YWx1ZVtrZXldKX1gKS5qb2luKCcsJyl9fWA7Cn07CmNvbnN0IHNoYSA9ICh2YWx1ZSkgPT4gYHNoYTI1Njoke2NyZWF0ZUhhc2goJ3NoYTI1NicpLnVwZGF0ZSh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnID8gdmFsdWUgOiBjYW5vbmljYWwodmFsdWUpKS5kaWdlc3QoJ2hleCcpfWA7CmNvbnN0IHNoYUJ5dGVzID0gKHZhbHVlKSA9PiBgc2hhMjU2OiR7Y3JlYXRlSGFzaCgnc2hhMjU2JykudXBkYXRlKHZhbHVlKS5kaWdlc3QoJ2hleCcpfWA7CmNvbnN0IGlkRm9yID0gKHJlY29yZCkgPT4gcmVjb3JkLnJlY29yZElkID8/IHJlY29yZC5yZXF1aXJlbWVudElkID8/IHJlY29yZC5vcGVyYXRpb25JZCA/PyByZWNvcmQuc3RhdGVNYWNoaW5lSWQgPz8gcmVjb3JkLnBvc3RncmVzQ29udHJhY3RJZCA/PyByZWNvcmQucnVudGltZUJvdW5kYXJ5SWQgPz8gcmVjb3JkLmdhdGVJZCA/PyByZWNvcmQuY2xvc3VyZVByZWRpY2F0ZUlkID8/IHJlY29yZC5lcnJvckNvZGVJZCA/PyByZWNvcmQuYXV0aG9yaXR5T2JqZWN0S2luZCA/PyByZWNvcmQuYmluZGluZ0lkID8/IHJlY29yZC5mYXVsdFBvaW50SWQgPz8gcmVjb3JkLnJlY292ZXJ5T3JhY2xlSWQ7CmNvbnN0IHNhZmVSZWYgPSAodmFsdWUpID0+IHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycgJiYgdmFsdWUuc3RhcnRzV2l0aCgnY29udHJhY3RzLycpICYmICF2YWx1ZS5pbmNsdWRlcygnLi4nKSAmJiAhdmFsdWUuaW5jbHVkZXMoJ1xcJyk7CmNvbnN0IGZhaWx1cmVzID0gW107Cgpjb25zdCBtYW5pZmVzdEJ5dGVzID0gYXdhaXQgcmVhZEZpbGUoam9pbihyb290LCAnY29udHJhY3RzL3JlZ2lzdHJpZXMvbWFuaWZlc3QuanNvbicpKTsKY29uc3QgbWFuaWZlc3QgPSBKU09OLnBhcnNlKG1hbmlmZXN0Qnl0ZXMudG9TdHJpbmcoJ3V0ZjgnKSk7CmlmIChtYW5pZmVzdC5yZWdpc3RyaWVzLnNvbWUoKHJlY29yZCkgPT4gcmVjb3JkLmtpbmQgPT09ICdBUlRJRkFDVF9UUkFDRV9SRUdJU1RSWScpKSBmYWlsdXJlcy5wdXNoKCdQQUNLX0FVVEhPUklUWV9CT1VOREFSWTogaW1wbGVtZW50YXRpb24gYXJ0aWZhY3QgdHJhY2UgbXVzdCBub3QgYmUgYSBub3JtYXRpdmUgQ29udHJhY3QgUGFjayByZWdpc3RyeScpOwoKY29uc3Qgc2NoZW1hQnVuZGxlQnl0ZXMgPSBhd2FpdCByZWFkRmlsZShqb2luKHJvb3QsIG1hbmlmZXN0LnNjaGVtYUJ1bmRsZVJlZikpOwpjb25zdCBzY2hlbWFCdW5kbGUgPSBKU09OLnBhcnNlKHNjaGVtYUJ1bmRsZUJ5dGVzLnRvU3RyaW5nKCd1dGY4JykpOwpjb25zdCB7IGRpZ2VzdDogYnVuZGxlRGlnZXN0LCAuLi5idW5kbGVJZGVudGl0eSB9ID0gc2NoZW1hQnVuZGxlOwppZiAoIXNhZmVSZWYobWFuaWZlc3Quc2NoZW1hQnVuZGxlUmVmKSB8fCBtYW5pZmVzdC5zY2hlbWFCdW5kbGVEaWdlc3QgIT09IGJ1bmRsZURpZ2VzdCB8fCBidW5kbGVEaWdlc3QgIT09IHNoYShidW5kbGVJZGVudGl0eSkpIGZhaWx1cmVzLnB1c2goJ3NjaGVtYSBidW5kbGUgZGlnZXN0IG1pc21hdGNoJyk7CmZvciAoY29uc3Qgc2NoZW1hIG9mIHNjaGVtYUJ1bmRsZS5zY2hlbWFzID8/IFtdKSB7CiAgaWYgKCFzYWZlUmVmKHNjaGVtYS5yZWYpKSB7IGZhaWx1cmVzLnB1c2goYHVuc2FmZSBzY2hlbWEgcmVmICR7c2NoZW1hLnJlZn1gKTsgY29udGludWU7IH0KICBjb25zdCBieXRlcyA9IGF3YWl0IHJlYWRGaWxlKGpvaW4ocm9vdCwgc2NoZW1hLnJlZikpOwogIGlmIChzaGEoSlNPTi5wYXJzZShieXRlcy50b1N0cmluZygndXRmOCcpKSkgIT09IHNjaGVtYS5kaWdlc3QpIGZhaWx1cmVzLnB1c2goYHNjaGVtYSBidW5kbGUgZGlnZXN0IG1pc21hdGNoOiAke3NjaGVtYS5yZWZ9YCk7Cn0KCmNvbnN0IHJlZ2lzdHJ5RGF0YUJ5S2luZCA9IG5ldyBNYXAoKTsKY29uc3QgaWRzQnlLaW5kID0gbmV3IE1hcCgpOwpmb3IgKGNvbnN0IHJlZ2lzdHJ5IG9mIG1hbmlmZXN0LnJlZ2lzdHJpZXMgPz8gW10pIHsKICBpZiAoIXNhZmVSZWYocmVnaXN0cnkuc2NoZW1hUmVmKSB8fCAhc2FmZVJlZihyZWdpc3RyeS5kYXRhUmVmKSkgeyBmYWlsdXJlcy5wdXNoKGAke3JlZ2lzdHJ5LmtpbmR9OiB1bnNhZmUgcmVwb3NpdG9yeS1yZWxhdGl2ZSByZWZlcmVuY2VgKTsgY29udGludWU7IH0KICBjb25zdCBbc2NoZW1hQnl0ZXMsIGRhdGFCeXRlc10gPSBhd2FpdCBQcm9taXNlLmFsbChbcmVhZEZpbGUoam9pbihyb290LCByZWdpc3RyeS5zY2hlbWFSZWYpKSwgcmVhZEZpbGUoam9pbihyb290LCByZWdpc3RyeS5kYXRhUmVmKSldKTsKICBpZiAoc2hhQnl0ZXMoZGF0YUJ5dGVzKSAhPT0gcmVnaXN0cnkuZGlnZXN0KSBmYWlsdXJlcy5wdXNoKGAke3JlZ2lzdHJ5LmtpbmR9OiBkaWdlc3QgbWlzbWF0Y2hgKTsKICBjb25zdCBzY2hlbWEgPSBKU09OLnBhcnNlKHNjaGVtYUJ5dGVzLnRvU3RyaW5nKCd1dGY4JykpOwogIGNvbnN0IGRhdGEgPSBKU09OLnBhcnNlKGRhdGFCeXRlcy50b1N0cmluZygndXRmOCcpKTsKICByZWdpc3RyeURhdGFCeUtpbmQuc2V0KHJlZ2lzdHJ5LmtpbmQsIGRhdGEpOwogIGNvbnN0IHNjb3BlZElkcyA9IG5ldyBTZXQoKTsKICBmb3IgKGNvbnN0IHJlY29yZCBvZiBkYXRhLnJlY29yZHMgPz8gW10pIHsKICAgIGNvbnN0IGlkID0gaWRGb3IocmVjb3JkKTsKICAgIGlmICghaWQpIHsgZmFpbHVyZXMucHVzaChgJHtyZWdpc3RyeS5raW5kfTogcmVjb3JkIGlkZW50aXR5IG1pc3NpbmdgKTsgY29udGludWU7IH0KICAgIGlmIChzY29wZWRJZHMuaGFzKGlkKSkgZmFpbHVyZXMucHVzaChgJHtyZWdpc3RyeS5raW5kfTogZHVwbGljYXRlICR7aWR9YCk7CiAgICBzY29wZWRJZHMuYWRkKGlkKTsKICAgIGlmIChyZWNvcmQucmVjb3JkSWQgIT09IGlkKSBmYWlsdXJlcy5wdXNoKGAke3JlZ2lzdHJ5LmtpbmR9OiByZWNvcmRJZCBtaXNtYXRjaCBmb3IgJHtpZH1gKTsKICAgIGZvciAoY29uc3QgcmVxdWlyZWQgb2Ygc2NoZW1hLnJlcXVpcmVkID8/IFtdKSBpZiAoIShyZXF1aXJlZCBpbiByZWNvcmQpKSBmYWlsdXJlcy5wdXNoKGAke3JlZ2lzdHJ5LmtpbmR9OiAke2lkfSBtaXNzaW5nICR7cmVxdWlyZWR9YCk7CiAgICBpZiAocmVjb3JkLmxpZmVjeWNsZSA9PT0gJ0FDVElWRScpIHsKICAgICAgaWYgKCFBcnJheS5pc0FycmF5KHJlY29yZC5zb3VyY2VSZWxhdGlvbnMpIHx8IHJlY29yZC5zb3VyY2VSZWxhdGlvbnMubGVuZ3RoID09PSAwKSBmYWlsdXJlcy5wdXNoKGAke3JlZ2lzdHJ5LmtpbmR9OiAke2lkfSBoYXMgbm8gbm9ybWF0aXZlIHNvdXJjZSByZWxhdGlvbmApOwogICAgICBmb3IgKGNvbnN0IHJlbGF0aW9uIG9mIHJlY29yZC5zb3VyY2VSZWxhdGlvbnMgPz8gW10pIHsKICAgICAgICBjb25zdCBpZGVudGl0eSA9IHsgc291cmNlUmVmOiByZWxhdGlvbi5zb3VyY2VSZWYsIHJlbGF0aW9uS2luZDogcmVsYXRpb24ucmVsYXRpb25LaW5kLCBjYW5vbmljYWxSZWNvcmRJZDogcmVsYXRpb24uY2Fub25pY2FsUmVjb3JkSWQsIGNhbm9uaWNhbFJlcXVpcmVtZW50SWRzOiBbLi4uKHJlbGF0aW9uLmNhbm9uaWNhbFJlcXVpcmVtZW50SWRzID8/IFtdKV0uc29ydCgpIH07CiAgICAgICAgaWYgKHJlbGF0aW9uLnJlbGF0aW9uRGlnZXN0ICE9PSBzaGEoaWRlbnRpdHkpKSBmYWlsdXJlcy5wdXNoKGAke3JlZ2lzdHJ5LmtpbmR9OiAke2lkfSBzb3VyY2UgcmVsYXRpb24gZGlnZXN0IG1pc21hdGNoYCk7CiAgICAgIH0KICAgICAgY29uc3QgeyBjYW5vbmljYWxEaWdlc3QsIC4uLmlkZW50aXR5IH0gPSByZWNvcmQ7CiAgICAgIGlmIChjYW5vbmljYWxEaWdlc3QgIT09IHNoYShpZGVudGl0eSkpIGZhaWx1cmVzLnB1c2goYCR7cmVnaXN0cnkua2luZH06ICR7aWR9IGNhbm9uaWNhbCBkaWdlc3QgbWlzbWF0Y2hgKTsKICAgIH0KICB9CiAgaWRzQnlLaW5kLnNldChyZWdpc3RyeS5raW5kLCBzY29wZWRJZHMpOwogIGlmICgoZGF0YS5yZWNvcmRzID8/IFtdKS5sZW5ndGggIT09IHJlZ2lzdHJ5LnJlY29yZENvdW50KSBmYWlsdXJlcy5wdXNoKGAke3JlZ2lzdHJ5LmtpbmR9OiByZWNvcmQgY291bnQgbWlzbWF0Y2hgKTsKfQoKY29uc3Qgc3NvdEJ5dGVzID0gYXdhaXQgcmVhZEZpbGUoam9pbihyb290LCAnU1NPVF9DVVJSRU5ULm1kJykpOwppZiAoc2hhQnl0ZXMoc3NvdEJ5dGVzKSAhPT0gbWFuaWZlc3Quc3NvdERpZ2VzdCkgZmFpbHVyZXMucHVzaCgnU1NPVCBkaWdlc3QgbWlzbWF0Y2gnKTsKaWYgKG1hbmlmZXN0LnNzb3RWZXJzaW9uICE9PSAnMjAyNi4wOC4zMC44JykgZmFpbHVyZXMucHVzaCgnU1NPVCB2ZXJzaW9uIG1pc21hdGNoJyk7CmNvbnN0IHJlcXVpcmVtZW50cyA9IHJlZ2lzdHJ5RGF0YUJ5S2luZC5nZXQoJ1JFUVVJUkVNRU5UX1JFR0lTVFJZJyk/LnJlY29yZHMgPz8gW107CmNvbnN0IHJlcXVpcmVtZW50SWRzID0gbmV3IFNldChyZXF1aXJlbWVudHMubWFwKChyZWNvcmQpID0+IHJlY29yZC5yZXF1aXJlbWVudElkKSk7CmlmIChyZXF1aXJlbWVudHMubGVuZ3RoID09PSAwKSBmYWlsdXJlcy5wdXNoKCdyZXF1aXJlbWVudCByZWdpc3RyeSBlbXB0eScpOwppZiAoKHJlZ2lzdHJ5RGF0YUJ5S2luZC5nZXQoJ09QRVJBVElPTl9DQVRBTE9HJyk/LnJlY29yZHMgPz8gW10pLmxlbmd0aCA9PT0gMCkgZmFpbHVyZXMucHVzaCgnb3BlcmF0aW9uIGNhdGFsb2cgZW1wdHknKTsKCmNvbnN0IHJlZmVyZW5jZUZpZWxkcyA9IG5ldyBNYXAoWwogIFsnb3BlcmF0aW9uSWQnLCAnT1BFUkFUSU9OX0NBVEFMT0cnXSwgWydvcGVyYXRpb25JZHMnLCAnT1BFUkFUSU9OX0NBVEFMT0cnXSwKICBbJ3N0YXRlTWFjaGluZUlkJywgJ1NUQVRFX01BQ0hJTkVfUkVHSVNUUlknXSwgWydzdGF0ZU1hY2hpbmVJZHMnLCAnU1RBVEVfTUFDSElORV9SRUdJU1RSWSddLAogIFsnYmluZGluZ0lkcycsICdCSU5ESU5HX1JFR0lTVFJZJ10sIFsnZXJyb3JDb2RlSWRzJywgJ0VSUk9SX1JFVFJZX1JFR0lTVFJZJ10sCiAgWydhY2NlcHRhbmNlR2F0ZUlkcycsICdBQ0NFUFRBTkNFX0dBVEVfUkVHSVNUUlknXSwgWydjbG9zdXJlUHJlZGljYXRlSWRzJywgJ0NMT1NVUkVfUFJFRElDQVRFX1JFR0lTVFJZJ10sCiAgWydhdXRob3JpdHlPd25lcnNoaXBJZHMnLCAnQVVUSE9SSVRZX09XTkVSU0hJUF9SRUdJU1RSWSddCl0pOwpmb3IgKGNvbnN0IFtraW5kLCBkYXRhXSBvZiByZWdpc3RyeURhdGFCeUtpbmQpIGZvciAoY29uc3QgcmVjb3JkIG9mIGRhdGEucmVjb3JkcyA/PyBbXSkgewogIGZvciAoY29uc3QgcmVsYXRpb24gb2YgcmVjb3JkLnNvdXJjZVJlbGF0aW9ucyA/PyBbXSkgZm9yIChjb25zdCByZXF1aXJlbWVudElkIG9mIHJlbGF0aW9uLmNhbm9uaWNhbFJlcXVpcmVtZW50SWRzID8/IFtdKSBpZiAoIXJlcXVpcmVtZW50SWRzLmhhcyhyZXF1aXJlbWVudElkKSkgZmFpbHVyZXMucHVzaChgJHtraW5kfTogJHtpZEZvcihyZWNvcmQpfSBzb3VyY2UgcmVsYXRpb24gcmVmZXJlbmNlcyB1bmtub3duIHJlcXVpcmVtZW50ICR7cmVxdWlyZW1lbnRJZH1gKTsKICBmb3IgKGNvbnN0IFtmaWVsZCwgdGFyZ2V0S2luZF0gb2YgcmVmZXJlbmNlRmllbGRzKSB7CiAgICBjb25zdCB2YWx1ZSA9IHJlY29yZFtmaWVsZF07CiAgICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCB8fCB2YWx1ZSA9PT0gbnVsbCkgY29udGludWU7CiAgICBmb3IgKGNvbnN0IGlkIG9mIEFycmF5LmlzQXJyYXkodmFsdWUpID8gdmFsdWUgOiBbdmFsdWVdKSBpZiAodHlwZW9mIGlkID09PSAnc3RyaW5nJyAmJiAhaWRzQnlLaW5kLmdldCh0YXJnZXRLaW5kKT8uaGFzKGlkKSkgZmFpbHVyZXMucHVzaChgJHtraW5kfTogJHtpZEZvcihyZWNvcmQpfSByZWZlcmVuY2VzIG1pc3NpbmcgJHt0YXJnZXRLaW5kfSAke2lkfWApOwogIH0KfQoKY29uc3QgZXhwZWN0ZWRQYWNrRGlnZXN0ID0gc2hhKGNhbm9uaWNhbCh7IC4uLm1hbmlmZXN0LCBwYWNrRGlnZXN0OiBudWxsIH0pICsgbWFuaWZlc3QucmVnaXN0cmllcy5tYXAoKHJlY29yZCkgPT4gcmVjb3JkLmRpZ2VzdCkuam9pbignJykpOwppZiAobWFuaWZlc3QucGFja0RpZ2VzdCAhPT0gZXhwZWN0ZWRQYWNrRGlnZXN0KSBmYWlsdXJlcy5wdXNoKCdwYWNrIGRpZ2VzdCBtaXNtYXRjaCcpOwoKaWYgKGZhaWx1cmVzLmxlbmd0aCkgewogIHByb2Nlc3Muc3RkZXJyLndyaXRlKGAke2ZhaWx1cmVzLmpvaW4oJ1xuJyl9XG5gKTsKICBwcm9jZXNzLmV4aXRDb2RlID0gMTsKfSBlbHNlIHsKICBwcm9jZXNzLnN0ZG91dC53cml0ZShgTm9ybWF0aXZlIENvbnRyYWN0IFBhY2sgdmFsaWRhdGlvbiBjb21wbGV0ZTogJHttYW5pZmVzdC5yZWdpc3RyaWVzLmxlbmd0aH0gcmVnaXN0cmllcywgJHtyZXF1aXJlbWVudHMubGVuZ3RofSBTU09UIHJlcXVpcmVtZW50cywgJHttYW5pZmVzdC5wYWNrRGlnZXN0fS4gSW1wbGVtZW50YXRpb24gZXZpZGVuY2UgaXMgdmFsaWRhdGVkIHNlcGFyYXRlbHkuXG5gKTsKfQo=').decode('utf-8')
(root/'scripts/validate-contract-pack.mjs').write_text(validator,encoding='utf-8')

pkg=json.loads((root/'package.json').read_text())
pkg['scripts']['contracts:build']='node scripts/compile-ssot-surface.mjs && node scripts/compile-contract-pack.mjs && node scripts/generate-requirement-trace.mjs && node scripts/compile-contract-trace.mjs'
pkg['scripts']['contracts:trace']='node scripts/generate-requirement-trace.mjs && node scripts/compile-contract-trace.mjs'
pkg['scripts']['contracts:check']='node scripts/compile-ssot-surface.mjs --check && node scripts/compile-contract-pack.mjs --check && node scripts/validate-contract-pack.mjs && node scripts/compile-contract-trace.mjs --check && node scripts/validate-contract-trace.mjs && node scripts/verify-authority-ownership.mjs && node scripts/verify-error-codes.mjs'
pkg['scripts']['conformance:audit']='pnpm run contracts:check && node scripts/conformance-audit.mjs'
(root/'package.json').write_text(json.dumps(pkg,indent=2,ensure_ascii=False)+'\n')
print('PACK-001 transformation applied')