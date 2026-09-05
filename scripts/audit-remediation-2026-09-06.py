#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one occurrence, found {count}: {old[:160]!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


def insert_after(path: str, marker: str, addition: str) -> None:
    replace_once(path, marker, marker + addition)


def replace_between(path: str, start: str, end: str, replacement: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    start_index = text.find(start)
    if start_index < 0:
        raise SystemExit(f"{path}: start marker not found: {start[:160]!r}")
    end_index = text.find(end, start_index)
    if end_index < 0:
        raise SystemExit(f"{path}: end marker not found: {end[:160]!r}")
    target.write_text(text[:start_index] + replacement + text[end_index:], encoding="utf-8")


# DB-001: physical system_chat_conversation uses status and has no CANCELLED state.
replace_once(
    "packages/domain/src/closure-predicates.ts",
    "SYSTEM_CHAT_CONVERSATION: { table: 'system_chat_conversation', column: 'state', terminal: ['CANCELLED', 'CLOSED', 'FAILED'] }",
    "SYSTEM_CHAT_CONVERSATION: { table: 'system_chat_conversation', column: 'status', terminal: ['CLOSED', 'FAILED'] }",
)

# CLOSURE-005: an optimistic expected activation epoch is not itself a provisional
# child. Only nonterminal commands can contribute to the pending child count.
replace_once(
    "packages/domain/src/closure-predicates.ts",
    "count(*) FILTER (WHERE c.target_id=$1 AND (c.expected_activation_epoch IS NOT NULL))::int AS provisional_children",
    "count(*) FILTER (WHERE c.target_id=$1 AND c.expected_activation_epoch IS NOT NULL AND c.status NOT IN ('SUCCEEDED','FAILED_FINAL','CANCELLED_FINAL'))::int AS provisional_children",
)

# AUDIT-001/AUDIT-002: route the public integrity query through the shared,
# paginated, same-snapshot verifier instead of materializing all audit rows and
# reading audit_head in a second snapshot.
insert_after(
    "packages/domain/src/operations.ts",
    "import { planCanonicalRetry } from './retry-planner.js';\n",
    "import { verifyAuditChainSnapshot } from './audit-integrity.js';\n",
)
replace_once(
    "packages/domain/src/operations.ts",
    "else if(operation.operationName==='audit.integrity.verify')result=await verifyAuditChain(this.pool);",
    "else if(operation.operationName==='audit.integrity.verify')result=await verifyAuditChainSnapshot(this.pool);",
)
replace_between(
    "packages/domain/src/operations.ts",
    "async function verifyAuditChain(pool:DatabasePool)",
    "async function currentActivationEpoch(pool:DatabasePool)",
    "",
)

# CLOSURE-002/CLOSURE-001: closure uses the same cryptographic verifier and
# requires a terminal audit event tied to the terminal root, instead of checking
# only digest lengths and hard-coding missing_terminal_event to zero.
insert_after(
    "packages/domain/src/closure-predicates.ts",
    "import { canonicalDigest, type CanonicalJsonValue } from '@kcml/schemas';\n",
    "import { verifyAuditChainClient } from './audit-integrity.js';\n",
)
replace_between(
    "packages/domain/src/closure-predicates.ts",
    "  const audit = await queryOne(client, `SELECT\n",
    "  const manual = await queryOne(client, `SELECT\n",
    "  let invalidAuditStreams = 0;\n"
    "  try { await verifyAuditChainClient(client); } catch { invalidAuditStreams += 1; }\n"
    "  const componentAudit = await queryOne(client, `SELECT count(*)::int AS count FROM kcml.component_audit_stream WHERE component_id=$1 AND integrity_state<>'VALID'`, [rootId]);\n"
    "  invalidAuditStreams += numberValue(componentAudit?.count);\n"
    "  let missingTerminalEvent = 0;\n"
    "  if (rootId && evidence.root.exists && config.terminal.includes(String(evidence.root.state))) {\n"
    "    const terminalAudit = await queryOne(client, `SELECT count(*)::int AS count FROM kcml.audit_event WHERE aggregate_id=$1 AND (\n"
    "      payload->>'state'=ANY($2::text[]) OR payload->>'status'=ANY($2::text[]) OR payload->>'lifecycle'=ANY($2::text[]) OR payload->>'dispatchPhase'=ANY($2::text[]) OR payload->>'effectiveState'=ANY($2::text[]) OR\n"
    "      event_type ~* '(succeeded|completed|closed|cancelled|failed|activated|rolled.?back|deregistered|stopped|pass)'\n"
    "    )`, [rootId, config.terminal]);\n"
    "    missingTerminalEvent = numberValue(terminalAudit?.count) > 0 ? 0 : 1;\n"
    "  }\n"
    "  evidence.audit = { invalidStreams: invalidAuditStreams, missingTerminalEvent };\n",
)

# CLOSURE-003/CLOSURE-004: direct-state closure evidence must come from the
# kernel/filesystem, not DB flags. Unknown kernel access is conservative (live),
# published artifacts must exist and match their expected content digest.
replace_once(
    "packages/domain/src/closure-predicates.ts",
    "import { lstat } from 'node:fs/promises';\nimport { kill } from 'node:process';",
    "import { createReadStream } from 'node:fs';\nimport { createHash } from 'node:crypto';\nimport { lstat, readFile } from 'node:fs/promises';\nimport { kill } from 'node:process';",
)
replace_between(
    "packages/domain/src/closure-predicates.ts",
    "async function defaultRuntimeInventory(evidence: ClosureDatabaseEvidence): Promise<RuntimeInventory> {",
    "async function defaultFilesystemInventory(evidence: ClosureDatabaseEvidence): Promise<FilesystemInventory> {",
    "function processIsAlive(pid: number): boolean {\n"
    "  if (!Number.isSafeInteger(pid) || pid <= 0) return true;\n"
    "  try { kill(pid, 0); return true; }\n"
    "  catch (error) {\n"
    "    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : '';\n"
    "    if (code === 'ESRCH') return false;\n"
    "    return true;\n"
    "  }\n"
    "}\n\n"
    "async function cgroupPopulated(cgroupPath: string): Promise<boolean> {\n"
    "  if (!cgroupPath) return true;\n"
    "  const path = cgroupPath.startsWith('/sys/fs/cgroup/') ? cgroupPath : `/sys/fs/cgroup${cgroupPath.startsWith('/') ? '' : '/'}${cgroupPath}`;\n"
    "  try {\n"
    "    const events = await readFile(`${path}/cgroup.events`, 'utf8');\n"
    "    const populated = /^populated\\s+1$/mu.test(events);\n"
    "    const procs = await readFile(`${path}/cgroup.procs`, 'utf8');\n"
    "    return populated || procs.trim().length > 0;\n"
    "  } catch {\n"
    "    return true;\n"
    "  }\n"
    "}\n\n"
    "async function defaultRuntimeInventory(evidence: ClosureDatabaseEvidence): Promise<RuntimeInventory> {\n"
    "  const processes = evidence.runtime.processes.map((item) => ({ ...item, active: item.active ? processIsAlive(item.pid) : false }));\n"
    "  const sockets = await Promise.all(evidence.runtime.sockets.map(async (item) => {\n"
    "    if (!item.path) return item;\n"
    "    try { await lstat(item.path); return { ...item, active: true }; } catch { return { ...item, active: false }; }\n"
    "  }));\n"
    "  const cgroupPaths = [...new Set(evidence.runtime.processes.map((item) => item.cgroupPath).filter(Boolean))];\n"
    "  const cgroups = await Promise.all(cgroupPaths.map(async (path) => ({ path, populated: await cgroupPopulated(path) })));\n"
    "  return { processes, sockets, cgroups };\n"
    "}\n\n",
)
replace_between(
    "packages/domain/src/closure-predicates.ts",
    "async function defaultFilesystemInventory(evidence: ClosureDatabaseEvidence): Promise<FilesystemInventory> {",
    "export async function evaluateClosureRecord(record: ClosureRegistryRecord",
    "async function fileDigest(path: string): Promise<string> {\n"
    "  const hash = createHash('sha256');\n"
    "  await new Promise<void>((resolve, reject) => {\n"
    "    const stream = createReadStream(path);\n"
    "    stream.on('data', (chunk) => hash.update(chunk));\n"
    "    stream.on('error', reject);\n"
    "    stream.on('end', resolve);\n"
    "  });\n"
    "  return `sha256:${hash.digest('hex')}`;\n"
    "}\n\n"
    "async function defaultFilesystemInventory(evidence: ClosureDatabaseEvidence): Promise<FilesystemInventory> {\n"
    "  const artifacts: FilesystemInventory['artifacts'] = [];\n"
    "  for (const item of evidence.artifacts) {\n"
    "    const paths = item.state === 'PUBLISHED' ? [item.finalPath].filter((value): value is string => Boolean(value)) : [item.tempPath];\n"
    "    for (const path of paths) {\n"
    "      try {\n"
    "        const stat = await lstat(path);\n"
    "        artifacts.push({ id: item.id, path, present: true, size: stat.size, digest: item.state === 'PUBLISHED' ? await fileDigest(path) : undefined });\n"
    "      } catch { artifacts.push({ id: item.id, path, present: false }); }\n"
    "    }\n"
    "  }\n"
    "  return { artifacts };\n"
    "}\n\n",
)
replace_once(
    "packages/domain/src/closure-predicates.ts",
    "  const artifactClosed = database.artifacts.every((item) => ['PUBLISHED', 'CLEANED', 'FAILED'].includes(item.state)) && filesystem.artifacts.every((item) => !item.present || database.artifacts.find((artifact) => artifact.id === item.id)?.state === 'PUBLISHED');",
    "  const artifactClosed = database.artifacts.every((item) => { const observed=filesystem.artifacts.find((artifact)=>artifact.id===item.id); if(item.state==='PUBLISHED')return Boolean(observed?.present)&&Boolean(item.expectedDigest)&&observed?.digest===item.expectedDigest; if(item.state==='CLEANED'||item.state==='FAILED')return !observed?.present; return false; });",
)

# ARCH-002/Q: every source-level command queue gets a deployed consumer. Extend
# existing authority owners instead of inventing competing writers. OWNER API key
# commands are consumed by the Secret Broker because that process owns the master
# key and secret material; MCP gets its own protocol worker service.
replace_once(
    "packages/worker-runtime/src/index.ts",
    "'kcml-component-control-worker': { queueNames: ['kcml-component'], allowedOperations: ['component.control.enable', 'component.control.disable', 'component.control.ack', 'component.heartbeat', 'component.state.report'], runtimeKind: 'SPECIALIST_HANDLER' },",
    "'kcml-component-control-worker': { queueNames: ['kcml-component'], allowedOperationPrefixes: ['component.'], runtimeKind: 'SPECIALIST_HANDLER' },",
)
replace_once(
    "packages/worker-runtime/src/index.ts",
    "'kcml-secret-broker': { broker: 'secret', socketPath: '/run/kajovocml-ng/brokers/secret-broker.sock', runtimeKind: 'CAPABILITY_BROKER' },",
    "'kcml-secret-broker': { queueNames: ['kcml-secret', 'kcml-ownerapikey'], allowedOperationPrefixes: ['secret.', 'ownerApiKey.'], broker: 'secret', socketPath: '/run/kajovocml-ng/brokers/secret-broker.sock', runtimeKind: 'CAPABILITY_BROKER' },",
)
replace_once(
    "packages/worker-runtime/src/index.ts",
    "'kcml-state-broker': { broker: 'state', socketPath: '/run/kajovocml-ng/brokers/state-broker.sock', runtimeKind: 'CAPABILITY_BROKER' },",
    "'kcml-mcp-worker': { queueNames: ['kcml-mcp'], allowedOperationPrefixes: ['mcp.'], runtimeKind: 'PROTOCOL_GATEWAY' },\n  'kcml-state-broker': { broker: 'state', socketPath: '/run/kajovocml-ng/brokers/state-broker.sock', runtimeKind: 'CAPABILITY_BROKER' },",
)
insert_after(
    "deploy/systemd/services.tsv",
    "kcml-browser-bridge-gateway|browser-bridge-gateway|kcml-browser-bridge|AF_UNIX AF_INET AF_INET6|/var/lib/kajovocml-ng/browser| |yes\n",
    "kcml-mcp-worker|mcp-worker|kcml-mcp|AF_UNIX AF_INET AF_INET6|/var/lib/kajovocml-ng/data| |yes\n",
)
insert_after(
    "deploy/security/service-capabilities.tsv",
    "kcml-browser-bridge-gateway|kcml-browser-bridge|kcml-release-readers|kcml_browser_bridge_gateway|database-url|/opt/kajovocml-ng/current /etc/kajovocml-ng/runtime.env\n",
    "kcml-mcp-worker|kcml-mcp|kcml-release-readers|kcml_mcp_worker|database-url|/opt/kajovocml-ng/current /etc/kajovocml-ng/runtime.env\n",
)

print("audit remediation transformations applied")
