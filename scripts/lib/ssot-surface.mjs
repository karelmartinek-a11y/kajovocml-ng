import { createHash } from 'node:crypto';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function boundedSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) throw new Error(`SSOT_SECTION_NOT_FOUND:${startMarker}:${endMarker}`);
  return source.slice(start, end);
}

export function parseSsotEntities(ssot) {
  const section = boundedSection(ssot, '### 25.3 Fixed OWNER authentication entities', '## 26. API kontrakt');
  const matches = [...section.matchAll(/^#### `([^`]+)`\s*$/gm)];
  // These rows carry an in-place lifecycle before terminalization. Their
  // contracts may mention immutable terminal states or contain suffixes such
  // as _event/_snapshot/_attempt, which must not be mistaken for whole-row
  // immutability.
  const lifecycleRows = new Set([
    'mcp_discovery_snapshot','mcp_request_event','mcp_call_run','mcp_input_exchange','mcp_input_request_item',
    'mcp_subscription','mcp_state_handle','mcp_task','mcp_task_input_request','mcp_idempotency_record',
    'runtime_process_identity','runtime_ipc_connection','runtime_ipc_call','runtime_cleanup_operation',
    'browser_action_attempt','browser_automation_run_step','generation_phase_run','generation_contract_candidate',
    'generation_validation_run','generation_blocker','ai_tool_dispatch','agent_message','agent_tool_call','agent_handoff_run',
    'agent_approval_request','agent_memory_item','agent_trigger','agent_eval_run','system_chat_message','system_chat_action',
    'deployment_step','production_acceptance_run','domain_command_activation_domain','activation_domain_barrier','configuration_apply_run','operation_context'
    ,'browser_session_binding','browser_host_slot','browser_context_instance','browser_page','browser_frame','browser_document','browser_navigation',
    'browser_preview_ticket','browser_control_lease','browser_control_transfer','browser_irreversible_confirmation','browser_auth_attempt',
    'browser_bridge_connection','browser_bridge_assignment','browser_profile_lease','browser_dialog','browser_permission_request','browser_teaching_run',
    'browser_teaching_step','browser_automation_definition','browser_automation_run','browser_challenge'
  ]);
  const immutableRows = new Set([
    'agent_session_compaction','agent_revision','agent_tool_binding','agent_handoff_binding','agent_guardrail',
    'agent_session_item','agent_run_checkpoint','agent_eval_suite','agent_eval_case','agent_eval_case_result',
    'self_test_catalog_entry','operational_setting_applied','authority_lineage','operation_intent','content_provenance',
    'instruction_segment','semantic_action_plan','value_derivation','secret_use_context','agentic_security_event'
    ,'browser_runtime_build_manifest','browser_preview_frame','browser_preview_event','browser_input_event','browser_action_dispatch_event',
    'browser_operation_scope','browser_state_bundle_member','browser_automation_revision','browser_automation_artifact','browser_auth_binding'
  ]);
  return matches.map((match, index) => {
    const name = match[1];
    const start = match.index;
    const end = index + 1 < matches.length ? matches[index + 1].index : section.length;
    const contract = section.slice(start, end).trim();
    const explicitlyImmutable = /\bimmutable\b|append-only|neměnn|po commitu je immutable/iu.test(contract);
    const structurallyImmutable = /(?:_revision|_snapshot|_event|_evidence|_checkpoint|_attempt|_result|_artifact|_fact|_decision|_message|_turn|_content_part|_dispatch|_continuation|_history|_notification|_item|_member|_derivation)$/u.test(name);
    return { name, ordinal: index + 1, contractDigest: sha256(contract), immutable: immutableRows.has(name) || (!lifecycleRows.has(name) && (explicitlyImmutable || structurallyImmutable)), contract };
  });
}

export function parseSsotRoutes(ssot) {
  const section = boundedSection(ssot, '## 26. API kontrakt', '## 27. Procesy, workery, fronty a leases');
  return [...section.matchAll(/^\s*(GET|POST|PUT|PATCH|DELETE|WSS)\s+(\/[^\s`]+)\s*$/gm)].map((match, index) => ({
    method: match[1],
    path: match[2],
    ordinal: index + 1,
    routeKey: `${match[1]} ${match[2]}`,
    contractDigest: sha256(`${match[1]} ${match[2]}`)
  }));
}

function has(path, fragment) { return path.includes(fragment); }
function starts(path, prefix) { return path === prefix || path.startsWith(`${prefix}/`); }

export function entityForRoute(path) {
  if (starts(path, '/operations')) return 'operation_context';
  if (path === '/auth/login' || path === '/auth/login/mfa') return 'owner_login_throttle';
  if (path === '/auth/logout' || path === '/auth/api-key-session' || starts(path, '/session')) return 'owner_session';
  if (path === '/owner/security') return 'owner_identity';
  if (starts(path, '/owner/mfa')) return 'owner_mfa_enrollment';
  if (starts(path, '/owner/recovery-codes')) return 'owner_recovery_code';
  if (starts(path, '/owner/sessions')) return 'owner_session';
  if (starts(path, '/owner/api-key')) return 'owner_api_credential';

  if (starts(path, '/dashboard/connections')) return 'dashboard_connection';
  if (starts(path, '/dashboard/nodes')) return 'component';
  if (starts(path, '/dashboard/secrets')) return 'secret_binding';
  if (path === '/dashboard/events') return 'dashboard_runtime_event';
  if (path === '/dashboard/layout') return 'dashboard_node_position';
  if (path === '/dashboard/topology' || path === '/dashboard/identity-cards') return 'dashboard_workspace';

  if (starts(path, '/components')) {
    if (has(path, '/revisions')) return 'component_revision';
    if (has(path, '/releases')) return 'component_release';
    if (has(path, '/e2e-runs')) return 'component_e2e_run';
    if (has(path, '/state-queries')) return 'component_state_history';
    if (has(path, '/heartbeat-challenges')) return 'component_pulse_contract';
    if (has(path, '/logs')) return 'debug_log_event';
    if (has(path, '/audit')) return 'component_audit_event';
    if (has(path, '/bindings')) return 'component_contract_binding';
    if (has(path, '/secrets')) return 'secret_binding';
    return 'component';
  }

  if (starts(path, '/mcp-servers')) {
    if (has(path, '/revisions')) return 'mcp_server_revision_profile';
    if (has(path, '/discovery-snapshots')) return 'mcp_discovery_snapshot';
    if (has(path, '/registration-probes')) return 'mcp_registration_probe';
    return 'mcp_server_revision_profile';
  }
  if (starts(path, '/mcp-request-events')) return 'mcp_request_event';
  if (starts(path, '/mcp-call-runs')) return has(path, '/input-exchanges') ? 'mcp_input_exchange' : 'mcp_call_run';
  if (starts(path, '/mcp-input-exchanges')) return 'mcp_input_exchange';
  if (starts(path, '/mcp-subscriptions')) return has(path, '/notifications') ? 'mcp_subscription_notification' : 'mcp_subscription';
  if (starts(path, '/mcp-state-handles')) return 'mcp_state_handle';
  if (starts(path, '/mcp-tasks')) return has(path, '/events') ? 'mcp_task_event' : 'mcp_task';
  if (starts(path, '/mcp-tools')) return 'component_tool_contract';
  if (starts(path, '/mcp-resources') || starts(path, '/mcp-resource-templates')) return 'component_resource_contract';
  if (starts(path, '/mcp-prompts')) return 'component_prompt_contract';
  if (starts(path, '/mcp-aliases')) return 'mcp_tool_alias';

  if (starts(path, '/agents')) {
    if (has(path, '/revisions')) {
      if (has(path, '/tool-bindings')) return 'agent_tool_binding';
      if (has(path, '/handoffs')) return 'agent_handoff_binding';
      if (has(path, '/guardrails')) return 'agent_guardrail';
      return 'agent_revision';
    }
    if (has(path, '/sessions')) return 'agent_session';
    if (has(path, '/memory')) return has(path, '/items') ? 'agent_memory_item' : 'agent_memory_namespace';
    if (has(path, '/eval-suites')) return 'agent_eval_suite';
    if (has(path, '/triggers')) return 'agent_trigger';
    if (has(path, '/runs')) return 'agent_run';
    return 'agent_definition';
  }
  if (starts(path, '/agent-runs')) {
    if (has(path, '/events') || has(path, '/messages')) return 'agent_message';
    if (has(path, '/checkpoints')) return 'agent_run_checkpoint';
    if (has(path, '/tool-calls')) return 'agent_tool_call';
    if (has(path, '/handoffs')) return 'agent_handoff_run';
    if (has(path, '/approvals')) return 'agent_approval_request';
    return 'agent_run';
  }
  if (starts(path, '/agent-sessions')) return has(path, '/items') ? 'agent_session_item' : 'agent_session';
  if (starts(path, '/agent-eval-suites')) return 'agent_eval_suite';
  if (starts(path, '/agent-eval-runs')) return has(path, '/cases') ? 'agent_eval_case_result' : 'agent_eval_run';

  if (starts(path, '/chat/conversations')) {
    if (has(path, '/messages')) return 'system_chat_message';
    if (has(path, '/browser-sessions')) return 'browser_session_binding';
    return 'system_chat_conversation';
  }
  if (path === '/chat/ask') return 'system_chat_action';

  if (starts(path, '/ai/model-calls')) {
    if (has(path, '/request-descriptor')) return 'openai_request_descriptor';
    if (has(path, '/events')) return 'ai_model_event';
    if (has(path, '/output-items')) return 'ai_model_output_item';
    if (has(path, '/tool-dispatches')) return 'ai_tool_dispatch';
    if (has(path, '/continuations')) return 'ai_model_continuation';
    if (has(path, '/checkpoints')) return 'ai_run_state_checkpoint';
    return 'ai_model_call';
  }
  if (starts(path, '/ai/model-capabilities')) return 'openai_model_capability_snapshot';

  if (starts(path, '/generation/jobs')) {
    if (has(path, '/messages')) return 'generation_message';
    if (has(path, '/turns')) return 'generation_turn';
    if (has(path, '/events')) return 'generation_event';
    if (has(path, '/sources')) return 'generation_source';
    if (has(path, '/facts')) return 'generation_fact';
    if (has(path, '/owner-decisions')) return 'generation_owner_decision';
    if (has(path, '/capability-snapshots')) return 'generation_capability_snapshot';
    if (has(path, '/spec/revisions') || has(path, '/spec')) return 'generation_spec_revision';
    if (has(path, '/authority')) return 'generation_execution_authority';
    if (has(path, '/plans')) return 'generation_plan';
    if (has(path, '/phases')) return 'generation_phase_run';
    if (has(path, '/checkpoints')) return 'generation_checkpoint';
    if (has(path, '/model-calls')) return 'ai_model_call';
    if (has(path, '/tool-events')) return 'generation_tool_event';
    if (has(path, '/workspace/revisions')) return has(path, '/files') ? 'generation_workspace_file' : 'generation_workspace_revision';
    if (has(path, '/workspace/patches')) return 'generation_workspace_patch';
    if (has(path, '/contract-candidates')) return 'generation_contract_candidate';
    if (has(path, '/artifact-manifests')) return 'generation_artifact_manifest';
    if (has(path, '/artifacts')) return 'generation_artifact';
    if (has(path, '/validation-runs')) return 'generation_validation_run';
    if (has(path, '/blockers')) return 'generation_blocker';
    if (has(path, '/activation-set')) return 'generation_activation_set';
    if (has(path, '/releases')) return 'component_release';
    if (has(path, '/logs')) return 'debug_log_event';
    if (has(path, '/audit')) return 'audit_event';
    if (has(path, '/browser/teaching')) return 'browser_teaching_run';
    if (has(path, '/browser/confirmations')) return 'browser_irreversible_confirmation';
    if (has(path, '/browser/operation-scope')) return 'browser_operation_scope';
    if (has(path, '/browser/account')) return 'browser_account_binding';
    if (has(path, '/browser')) return 'browser_session';
    return 'generation_job';
  }

  if (starts(path, '/browser-sessions')) {
    if (has(path, '/pages')) return 'browser_page';
    if (has(path, '/frames')) return 'browser_frame';
    if (has(path, '/documents')) return 'browser_document';
    if (has(path, '/navigations')) return 'browser_navigation';
    if (has(path, '/observe')) return 'browser_observation';
    if (has(path, '/actions')) return has(path, '/attempts') ? 'browser_action_attempt' : 'browser_action_run';
    if (has(path, '/control-transfers')) return 'browser_control_transfer';
    if (has(path, '/control')) return 'browser_control_lease';
    if (has(path, '/operation-scopes')) return 'browser_operation_scope';
    if (has(path, '/targets')) return 'browser_target_reference';
    if (has(path, '/credentials') || has(path, '/auth')) return 'browser_auth_attempt';
    if (has(path, '/accounts')) return 'browser_account_binding';
    if (has(path, '/state-bundles')) return 'browser_state_bundle';
    if (has(path, '/dialogs')) return 'browser_dialog';
    if (has(path, '/permissions')) return 'browser_permission_request';
    if (has(path, '/challenges')) return 'browser_challenge';
    if (has(path, '/uploads')) return 'browser_upload_handle';
    if (has(path, '/downloads')) return 'browser_download';
    if (has(path, '/preview')) return path.endsWith('/preview-tickets') ? 'browser_preview_ticket' : 'browser_preview_frame';
    if (has(path, '/artifacts')) return 'browser_automation_artifact';
    return 'browser_session';
  }
  if (starts(path, '/browser-accounts')) return has(path, '/state-bundles') ? 'browser_state_bundle' : 'browser_account_binding';
  if (starts(path, '/browser-bridges')) {
    if (has(path, '/connections')) return 'browser_bridge_connection';
    if (has(path, '/profiles')) return 'browser_profile_lease';
    return 'browser_local_bridge';
  }
  if (starts(path, '/browser-automations')) {
    if (has(path, '/revisions')) return 'browser_automation_revision';
    if (has(path, '/auth-bindings')) return 'browser_auth_binding';
    if (has(path, '/teaching-runs')) return 'browser_teaching_run';
    if (has(path, '/runs')) return 'browser_automation_run';
    return 'browser_automation_definition';
  }
  if (starts(path, '/browser-teaching-runs')) return 'browser_teaching_run';
  if (starts(path, '/browser-runs')) {
    if (has(path, '/steps')) return 'browser_automation_run_step';
    if (has(path, '/artifacts')) return 'browser_automation_artifact';
    if (has(path, '/challenges')) return 'browser_challenge';
    if (has(path, '/session')) return 'browser_session';
    return 'browser_automation_run';
  }

  if (starts(path, '/secrets')) {
    if (has(path, '/versions')) return 'secret_version';
    if (has(path, '/bindings')) return 'secret_binding';
    if (has(path, '/usage') || has(path, '/test-resolve')) return 'secret_access_event';
    return 'secret_record';
  }

  if (starts(path, '/runtime/executions')) return 'runtime_execution_context';
  if (starts(path, '/runtime/instances')) {
    if (has(path, '/processes')) return 'runtime_process_identity';
    if (has(path, '/connections')) return 'runtime_ipc_connection';
    if (has(path, '/calls')) return 'runtime_ipc_call';
    if (has(path, '/cleanup')) return 'runtime_cleanup_operation';
    return 'runtime_instance';
  }
  if (starts(path, '/runtime/boundary')) return 'runtime_process_identity';

  if (starts(path, '/bindings')) return 'binding_set';
  if (starts(path, '/external/targets')) return 'external_target';
  if (starts(path, '/external/auth-bindings')) return 'external_auth_binding';
  if (starts(path, '/external/target-bindings')) return 'external_target_binding';
  if (starts(path, '/external/requests')) return 'external_request_event';
  if (starts(path, '/webhooks')) return 'webhook_endpoint';

  if (path === '/monitoring/overview') return 'monitoring_profile';
  if (starts(path, '/monitoring/probes') || starts(path, '/monitoring/probe')) return 'monitoring_probe';
  if (starts(path, '/monitoring/state-history')) return 'component_state_history';
  if (starts(path, '/monitoring/profiles')) return 'monitoring_profile';
  if (starts(path, '/alerts')) return has(path, '/deliveries') ? 'alert_delivery' : 'operational_alert';
  if (starts(path, '/workers/heartbeats')) return 'platform_worker_heartbeat';

  if (starts(path, '/audit')) return path === '/audit/archive' ? 'audit_archive_outbox' : 'audit_event';
  if (starts(path, '/logs')) return 'debug_log_event';
  if (starts(path, '/config')) return has(path, '/apply') ? 'configuration_apply_run' : 'operational_setting';
  if (starts(path, '/releases')) return 'application_release';
  if (starts(path, '/deployments')) return 'deployment_run';
  if (starts(path, '/backups')) return 'backup_record';
  if (starts(path, '/acceptance-runs')) return 'production_acceptance_run';
  if (starts(path, '/maintenance')) return 'runtime_instance';
  if (starts(path, '/self-tests')) return has(path, '/catalog') ? 'self_test_catalog_entry' : 'self_test_run';

  if (path === '/system/health' || path === '/system/readiness' || path === '/system/version' || path === '/system/capabilities') return 'application_deployment_head';
  if (path === '/system/recovery') return 'platform_incarnation';
  if (path === '/system/closure') return 'activation_head';
  if (starts(path, '/authority/lineages')) return 'authority_lineage';
  if (starts(path, '/operation-intents')) return 'operation_intent';
  if (starts(path, '/operation-contexts')) {
    if (has(path, '/action-plans')) return 'semantic_action_plan';
    if (has(path, '/value-derivations')) return 'value_derivation';
    if (has(path, '/secret-uses')) return 'secret_use_context';
    return 'operation_context';
  }
  if (starts(path, '/provenance/content')) return 'content_provenance';
  if (starts(path, '/agentic-security')) return 'agentic_security_event';
  throw new Error(`NO_ENTITY_BINDING_FOR_ROUTE:${path}`);
}

function normalizeToken(value) {
  return value.replace(/([a-z])([A-Z])/g, '$1-$2').replace(/[^a-z0-9]+/gi, '-').toLowerCase().split('-').filter(Boolean);
}

function familyForPath(path) {
  if (starts(path, '/components')) return 'component';
  if (path.startsWith('/runtime/')) return 'runtime';
  if (path.startsWith('/mcp-')) return 'mcp';
  if (path.startsWith('/agents') || path.startsWith('/agent-')) return 'agent';
  if (path.startsWith('/secrets')) return 'secret';
  if (path.startsWith('/monitoring') || path.startsWith('/alerts') || path.startsWith('/workers')) return 'monitor';
  if (path.startsWith('/browser-') || has(path, '/browser/')) return 'browser';
  if (path.startsWith('/audit')) return 'audit';
  if (path.startsWith('/chat')) return 'chat';
  if (path.startsWith('/owner/api-key')) return 'ownerApiKey';
  if (path.startsWith('/self-tests')) return 'selfTest';
  if (path.startsWith('/generation')) return 'generation';
  if (path.startsWith('/authority') || path.startsWith('/operation-intents') || path.startsWith('/operation-contexts')) return 'authority';
  if (path.startsWith('/provenance')) return 'provenance';
  if (path.startsWith('/agentic-security')) return 'agentic';
  return null;
}

const CREATE_DEFAULT = new Map([
  ['component', 'component.register'], ['generation', 'generation.job.create'], ['browser', 'browser.session.create'],
  ['chat', 'chat.conversation.create'], ['selfTest', 'selfTest.run.start']
]);

export function operationForRoute(route, operationNames) {
  const { method, path } = route;
  if (path === '/operations/:operationKey/invoke') return '__DYNAMIC_OPERATION__';
  if (path === '/owner/api-key') return method === 'GET' ? 'ownerApiKey.read' : null;
  if (path === '/owner/api-key/value') return 'ownerApiKey.reveal';
  if (path === '/owner/api-key/rotate') return 'ownerApiKey.rotate';
  if (path === '/auth/api-key-session') return 'ownerApiKey.session.exchange';
  if (path === '/self-tests/catalog') return 'selfTest.catalog.list';
  if (path === '/audit/integrity/verify') return 'audit.integrity.verify';
  if (path === '/agentic-security/evidence/export') return 'agentic.security.evidence.export';
  if (path === '/alerts/:id/acknowledge' || path === '/alerts/:id/suppress') return 'monitor.alert.update';
  if (path === '/alerts/:id/close') return 'monitor.alert.close';
  if (path === '/workers/heartbeats') return 'monitor.heartbeat.observe';

  const family = familyForPath(path);
  if (!family) return null;
  const candidates = operationNames.filter((name) => name.split('.')[0] === family);
  if (!candidates.length) return null;

  if (method === 'GET') {
    const preferred = candidates.filter((name) => /(?:\.list|\.get|\.read|\.status|\.query|\.inspect|\.observe|\.catalog|\.evidence|\.report)$/.test(name));
    if (!preferred.length) return null;
    const routeTokens = normalizeToken(path).filter((token) => !token.startsWith('id') && !['api','v1'].includes(token));
    let best = null; let bestScore = 0;
    for (const name of preferred) {
      const opTokens = normalizeToken(name);
      const score = opTokens.filter((token) => routeTokens.includes(token)).length;
      if (score > bestScore) { best = name; bestScore = score; }
    }
    return bestScore >= 2 ? best : null;
  }

  const staticSegments = path.split('/').filter((segment) => segment && !segment.startsWith(':'));
  const tail = staticSegments.at(-1) ?? '';
  const routeTokens = normalizeToken(staticSegments.slice(-4).join('-'));
  let best = null; let bestScore = 0;
  for (const name of candidates) {
    const opTokens = normalizeToken(name);
    let score = opTokens.filter((token) => routeTokens.includes(token)).length;
    const opTail = normalizeToken(name.split('.').at(-1) ?? '');
    const tailTokens = normalizeToken(tail);
    if (opTail.join('') === tailTokens.join('') && tailTokens.length) score += 5;
    if (score > bestScore) { best = name; bestScore = score; }
  }
  if (bestScore >= 3) return best;
  if (method === 'POST' && staticSegments.length <= 2) return CREATE_DEFAULT.get(family) ?? null;
  return null;
}

export function surfaceFingerprint(entities, routes) {
  return sha256(JSON.stringify({ entities: entities.map(({ name, contractDigest }) => ({ name, contractDigest })), routes: routes.map(({ method, path }) => ({ method, path })) }));
}
