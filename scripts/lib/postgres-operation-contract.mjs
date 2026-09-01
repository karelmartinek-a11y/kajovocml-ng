const ROOT_TABLES = Object.freeze({
  AGENT_RUN: 'agent_run',
  AUDIT_HEAD: 'audit_head',
  BROWSER_SESSION: 'browser_session',
  COMPONENT: 'component',
  GENERATION_JOB: 'generation_job',
  MCP_CALL_RUN: 'mcp_call_run',
  OPERATIONAL_ALERT: 'operational_alert',
  OWNER_IDENTITY: 'owner_identity',
  RUNTIME_INSTANCE: 'runtime_instance',
  SECRET_RECORD: 'secret_record',
  SELF_TEST_RUN: 'self_test_run',
  SYSTEM_CHAT_CONVERSATION: 'system_chat_conversation'
});

const unique = (items) => [...new Set(items)];

function physicalTables(operation) {
  const root = ROOT_TABLES[operation.aggregateRoot];
  if (!root) throw new Error(`POSTGRES_CONTRACT_ROOT_TABLE_MISSING:${operation.operationName}`);
  const name = operation.operationName;
  const tables = [root];
  if (/\.message\.|\.turn\.|\.phase\.|\.checkpoint\.|\.workspace\.|\.plan\.|\.blocker\.|\.validation\.|\.source\./u.test(name)) tables.push('generation_event');
  if (/\.model\.|\.tool\.|\.delegate\.|\.approval\.|\.memory\.|\.session\.|\.eval\./u.test(name)) tables.push('ai_model_call');
  if (/\.binding\.|\.bind$|\.unbind$/u.test(name)) tables.push('binding_set');
  if (/\.browser\.|^browser\./u.test(name)) tables.push('browser_action_run');
  if (/\.upload\.|\.download\.|artifact/u.test(name)) tables.push('artifact_publication');
  if (/\.alert\./u.test(name)) tables.push('operational_alert');
  return unique(tables);
}

function rowLocks(operation) {
  const root = operation.aggregateRoot;
  const children = {
    COMPONENT: ['COMPONENT_POINTER'], GENERATION_JOB: ['GENERATION_PHASE', 'GENERATION_CHECKPOINT'],
    AGENT_RUN: ['AGENT_ATTEMPT'], BROWSER_SESSION: ['BROWSER_CONTROL', 'BROWSER_ACTION'],
    MCP_CALL_RUN: ['MCP_TASK'], SECRET_RECORD: ['SECRET_VERSION'], OPERATIONAL_ALERT: ['ALERT_DELIVERY'],
    RUNTIME_INSTANCE: ['RUNTIME_PROCESS'], SELF_TEST_RUN: ['SELF_TEST_CASE'],
    SYSTEM_CHAT_CONVERSATION: ['CHAT_TURN'], OWNER_IDENTITY: ['OWNER_SESSION'], AUDIT_HEAD: ['AUDIT_EVENT']
  }[root] ?? [];
  return ['PLATFORM', 'DEPLOYMENT', 'IDEMPOTENCY', 'ACTIVATION_DOMAIN', `AGGREGATE:${root}`, ...children, 'AUDIT'];
}

function contractFor(operation) {
  const name = operation.operationName;
  const readOnly = operation.transactionProfileId === 'CONSISTENT_READ';
  const strategy = operation.extensions?.handlerStrategy ?? operation.handlerStrategy ?? null;
  const external = strategy === 'SIDE_EFFECT_LEDGER' || strategy === 'GUARDED_RECONCILIATION'
    || /\.activation\.(switch|rollback)$|\.runtime\.invoke$|\.tools\.call$|\.action\.(dispatchPhase|reconcile|resolveOutcome|complete|fail)$|\.model\.execute$|\.validation\.run$|\.registeredElement\.run$|\.integration\.step$|\.cleanup(?:\.|$)|\.reconcile$|\.repair$/u.test(name);
  const activation = /activation\.(switch|rollback)$|binding\.(publish|activate)$/u.test(name);
  const profile = readOnly ? 'CONSISTENT_READ' : activation ? 'ACTIVATION_SWITCH' : external ? 'WORKER_COMMIT' : 'ONLINE_MUTATION';
  const create = strategy === 'IDEMPOTENT_CREATE' || /\.create$|\.register$|\.open$|\.start$/u.test(name);
  const append = strategy === 'COMMUTATIVE_EVIDENCE_APPEND' || /\.append$|\.result$|\.heartbeat$|\.report$/u.test(name);
  const segments = readOnly ? ['R'] : external ? ['T1', 'D', 'T2', 'T3'] : ['T1', 'T3'];
  const constraints = unique([
    'STATE_VERSION_NON_NEGATIVE',
    'PLATFORM_DEPLOYMENT_EPOCH',
    create ? 'FIRST_CREATE_UNIQUE_KEY' : 'EXPECTED_STATE_VERSION_CAS',
    append ? 'PARENT_SEQUENCE_UNIQUE' : 'IDEMPOTENCY_SCOPE_KEY',
    ...(external ? ['SIDE_EFFECT_ATTEMPT_UNIQUE', 'DISPATCH_AUTHORITY_UNIQUE'] : []),
    ...(activation ? ['ACTIVATION_EPOCH_MONOTONIC'] : [])
  ]);
  const checks = unique([
    'DIGEST_32_BYTES',
    'STATE_VERSION_INCREASES',
    ...(external ? ['POSSIBLE_EFFECT_REQUIRES_RECONCILIATION'] : []),
    ...(create ? ['ABSENT_ROW_GUARD'] : []),
    ...(activation ? ['POINTER_SNAPSHOT_COMPLETE'] : [])
  ]);
  const outbox = readOnly ? [] : external ? ['DOMAIN_EVENT', 'SIDE_EFFECT_DISPATCH'] : ['DOMAIN_EVENT'];
  const inbox = /\.result$|\.observe$|\.heartbeat$|\.acknowledge$|\.notify$/u.test(name) ? ['DUPLICATE_EVENT_DEDUPE'] : [];
  const successor = /\.start$|\.request$|\.approve$|\.resolve$|\.complete$|\.phase\./u.test(name);
  const tables = physicalTables(operation);
  return {
    postgresContractId: `PG-${operation.operationId}`,
    operationId: operation.operationId,
    transactionProfileId: profile,
    isolationLevel: readOnly ? 'REPEATABLE READ' : 'READ COMMITTED',
    transactionSegments: segments,
    orderedAdvisoryLocks: readOnly ? [] : ['PLATFORM_RECOVERY_BARRIER', ...(create ? ['FIRST_CREATE_NAMESPACE'] : [])],
    orderedRowLocks: readOnly ? [] : rowLocks(operation),
    absentRowGuard: readOnly ? 'NOT_APPLICABLE_READ_PROFILE' : create ? 'PARENT_HEAD_AND_UNIQUE_INDEX' : append ? 'PARENT_ROOT_AND_SEQUENCE_UNIQUE' : 'LOCKED_ROOT_CAS',
    readAfterLockGuards: readOnly ? ['REPEATABLE_READ_SNAPSHOT'] : ['DB_TIME', 'STATE_VERSION', 'RECOVERY_EPOCH', 'ACTIVATION_EPOCH', ...(external ? ['DISPATCH_FENCE'] : [])],
    stateVersionCas: !readOnly,
    fencingPredicate: !readOnly,
    platformIncarnationPredicate: !readOnly,
    applicationDeploymentEpochPredicate: !readOnly,
    bindingActivationPredicate: !readOnly && /binding|browser|runtime|agent|mcp|activation/u.test(name),
    uniqueConstraints: readOnly ? [] : constraints,
    checkConstraints: readOnly ? [] : checks,
    foreignKeys: readOnly ? [] : unique(['PARENT_OWNERSHIP', ...(external ? ['ATTEMPT_OUTBOX_COMPOSITE'] : []), ...(activation ? ['POINTER_PARENT_OWNERSHIP'] : [])]),
    deferredConstraintTriggers: readOnly ? [] : unique(['TERMINAL_CLOSURE', ...(external ? ['SIDE_EFFECT_AUTHORITY_CONSISTENCY'] : [])]),
    idempotencyUniqueness: readOnly ? 'NONE_READ_PROFILE' : create ? 'SCOPE_KEY_AND_REQUEST_DIGEST' : 'SCOPE_KEY',
    sequenceAllocation: readOnly ? 'NONE_READ_PROFILE' : append ? 'LOCKED_PARENT_SEQUENCE' : 'LOCKED_HEAD_INCREMENT',
    outboxWrites: outbox,
    inboxWrites: inbox,
    successorReservation: readOnly ? 'NONE_READ_PROFILE' : successor ? 'UNIQUE_DECLARED_EDGE' : 'NONE',
    successorEnqueue: readOnly ? 'NONE_READ_PROFILE' : successor ? 'SAME_COMMIT' : 'NONE',
    externalEffectSplit: readOnly ? 'READ_ONLY_NO_SIDE_EFFECT' : external ? 'T1_D_E_T2_T3' : 'T1_T3_NO_EXTERNAL_IO',
    sqlstateRetryMap: readOnly ? 'ERR-RETRY-REGISTRY:57014' : 'ERR-RETRY-REGISTRY:40001|40P01|55P03|23505|23503|23514|57014',
    migrationImplications: readOnly ? ['READ_ONLY_NO_SCHEMA_MUTATION', `ANCHORS:${tables.join(',')}`] : ['FORWARD_ONLY_EXPAND_MIGRATE_VALIDATE_ACTIVATE_CONTRACT', `ANCHORS:${tables.join(',')}`],
    rollbackCompatibility: 'PREVIOUS_RELEASE_READS_FORWARD_SCHEMA',
    parallelTestIds: readOnly ? [`PG-READ-${operation.operationId}-SNAPSHOT`] : [`PG-CONCURRENT-${operation.operationId}`, `PG-CONTRACT-${operation.operationId}-LOCK_ORDER`, `PG-CONTRACT-${operation.operationId}-CAS`],
    crashTestIds: readOnly ? [] : [`CRASH-${operation.operationId}-PRE_COMMIT`, `CRASH-${operation.operationId}-POST_COMMIT`],
    physicalSchemaAnchors: tables.map((table) => ({ table, sourcePath: 'database/baseline/00000000000000_greenfield.sql', anchor: `kcml.${table}` })),
    lockPlanEvidence: { sourceRef: 'ssot://51/postgresql-transakcni-soubehovy-a-migracni-kontrakt/lock-order', classes: rowLocks(operation) },
    contractDerivation: { strategy: strategy ?? 'operation-catalog-specific', operationName: name, aggregateRoot: operation.aggregateRoot, readOnly }
  };
}

export { contractFor };
