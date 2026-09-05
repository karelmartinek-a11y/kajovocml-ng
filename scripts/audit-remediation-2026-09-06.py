#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one occurrence, found {count}: {old[:120]!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


def replace_all(path: str, old: str, new: str, expected: int) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{path}: expected {expected} occurrences, found {count}: {old[:120]!r}")
    target.write_text(text.replace(old, new), encoding="utf-8")


# DB-001: closure must use the physical, normative status column and only states
# admitted by the system_chat_conversation schema.
replace_once(
    "packages/domain/src/closure-predicates.ts",
    "SYSTEM_CHAT_CONVERSATION: { table: 'system_chat_conversation', column: 'state', terminal: ['CANCELLED', 'CLOSED', 'FAILED'] }",
    "SYSTEM_CHAT_CONVERSATION: { table: 'system_chat_conversation', column: 'status', terminal: ['CLOSED', 'FAILED'] }",
)

# ARCH-002/Q: every canonical command queue needs an actual consumer. Existing
# component and broker services are the authority owners, so extend those exact
# owners instead of creating competing writers.
replace_once(
    "packages/worker-runtime/src/index.ts",
    "'kcml-component-control-worker': { queueNames: ['kcml-component'], allowedOperations: ['component.control.enable', 'component.control.disable', 'component.control.ack', 'component.heartbeat', 'component.state.report'], runtimeKind: 'SPECIALIST_HANDLER' },",
    "'kcml-component-control-worker': { queueNames: ['kcml-component'], allowedOperationPrefixes: ['component.'], runtimeKind: 'SPECIALIST_HANDLER' },",
)
replace_once(
    "packages/worker-runtime/src/index.ts",
    "'kcml-secret-broker': { broker: 'secret', socketPath: '/run/kajovocml-ng/brokers/secret-broker.sock', runtimeKind: 'CAPABILITY_BROKER' },",
    "'kcml-secret-broker': { queueNames: ['kcml-secret'], allowedOperationPrefixes: ['secret.'], broker: 'secret', socketPath: '/run/kajovocml-ng/brokers/secret-broker.sock', runtimeKind: 'CAPABILITY_BROKER' },",
)
replace_once(
    "packages/worker-runtime/src/index.ts",
    "'kcml-state-broker': { broker: 'state', socketPath: '/run/kajovocml-ng/brokers/state-broker.sock', runtimeKind: 'CAPABILITY_BROKER' },",
    "'kcml-mcp-worker': { queueNames: ['kcml-mcp'], allowedOperationPrefixes: ['mcp.'], runtimeKind: 'PROTOCOL_GATEWAY' },\n  'kcml-owner-api-key-worker': { queueNames: ['kcml-ownerapikey'], allowedOperationPrefixes: ['ownerApiKey.'], runtimeKind: 'SPECIALIST_HANDLER' },\n  'kcml-state-broker': { broker: 'state', socketPath: '/run/kajovocml-ng/brokers/state-broker.sock', runtimeKind: 'CAPABILITY_BROKER' },",
)

print("audit remediation transformations applied")
