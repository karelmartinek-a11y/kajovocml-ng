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

export const SERVER_HANDLED_ROUTE_KEYS = new Set([
  "GET /operations/catalog",
  "POST /operations/:operationKey/invoke",
  "POST /auth/login",
  "POST /auth/login/mfa",
  "POST /auth/logout",
  "POST /auth/api-key-session",
  "GET /session",
  "POST /session/reauthenticate",
  "GET /owner/security",
  "POST /owner/mfa/enroll",
  "POST /owner/mfa/verify",
  "POST /owner/recovery-codes/rotate",
  "GET /owner/sessions",
  "DELETE /owner/sessions/:id",
  "POST /owner/sessions/revoke-others",
  "POST /owner/sessions/revoke-all",
  "GET /owner/api-key",
  "GET /owner/api-key/value",
  "POST /owner/api-key/rotate",
  "GET /owner/api-key/usage",
  "GET /system/health",
  "GET /system/readiness",
  "GET /system/version",
  "GET /system/capabilities",
  "GET /system/closure",
  "GET /secrets",
  "POST /secrets",
  "GET /secrets/:id",
  "PATCH /secrets/:id",
  "DELETE /secrets/:id",
  "GET /secrets/:id/value",
  "POST /secrets/:id/versions",
  "GET /secrets/:id/versions",
  "POST /secrets/generate-password",
  "POST /secrets/import",
  "POST /secrets/export",
  "GET /audit/integrity",
  "POST /audit/integrity/verify",
  "POST /chat/ask",
  "POST /browser-sessions/:sessionId/preview-tickets"
]);

/**
 * Literal route-to-operation bindings. Every entry is audited by route key:
 * aliases are explicit transport bindings, never inferred from path families,
 * HTTP verbs, or create defaults. Routes without a catalog operation are
 * handled only by the explicitly enumerated server-owned routes above.
 */
export const ROUTE_OPERATION_BINDINGS = new Map([
  ["PUT /dashboard/layout", "component.revision.publish"],
  ["POST /dashboard/connections/preview", "component.revision.publish"],
  ["POST /dashboard/connections", "component.register"],
  ["PUT /dashboard/connections/:id/binding", "component.revision.publish"],
  ["DELETE /dashboard/connections/:id", "component.deregister"],
  ["PATCH /components/:id", "component.revision.publish"],
  ["POST /components/:id/repair", "component.restore"],
  ["POST /components/:id/e2e-runs", "component.verify"],
  ["POST /components/:id/state-queries", "component.verify"],
  ["POST /components/:id/heartbeat-challenges", "component.verify"],
  ["POST /mcp-servers", "mcp.contract.compatibility"],
  ["PATCH /mcp-servers/:id", "mcp.contract.compatibility"],
  ["POST /mcp-servers/:id/revisions", "mcp.contract.compatibility"],
  ["POST /mcp-servers/:id/revisions/:revisionId/activate", "mcp.contract.compatibility"],
  ["POST /mcp-servers/:id/cache-pagination-test", "mcp.cache.invalidate"],
  ["POST /mcp-servers/:id/tasks-test", "mcp.task.update"],
  ["POST /mcp-tools", "mcp.contract.compatibility"],
  ["POST /mcp-aliases/preview", "mcp.contract.compatibility"],
  ["POST /mcp-aliases", "mcp.contract.compatibility"],
  ["DELETE /mcp-aliases/:id", "mcp.discovery.invalidate"],
  ["POST /agents", "agent.eval.start"],
  ["PATCH /agents/:id", "agent.eval.result"],
  ["POST /agents/:id/revisions", "agent.eval.start"],
  ["POST /agents/:id/revisions/:revisionId/validate", "agent.eval.result"],
  ["POST /agents/:id/revisions/:revisionId/verify", "agent.eval.result"],
  ["POST /agents/:id/revisions/:revisionId/activate", "agent.eval.result"],
  ["POST /agents/:id/revisions/:revisionId/compatibility", "agent.eval.result"],
  ["POST /agents/:id/enable", "agent.run.start"],
  ["POST /agents/:id/disable", "agent.run.cancel"],
  ["POST /agents/:id/repair", "agent.run.manualReview"],
  ["POST /agent-sessions/:sessionId/close", "agent.session.compact"],
  ["POST /agents/:id/eval-suites", "agent.eval.start"],
  ["POST /agents/:id/triggers", "agent.delegate.request"],
  ["PATCH /agents/:id/triggers/:triggerId", "agent.delegate.request"],
  ["DELETE /agents/:id/triggers/:triggerId", "agent.delegate.request"],
  ["POST /ai/model-calls/:id/retrieve", "agent.model.completed"],
  ["POST /ai/model-calls/:id/resume-stream", "agent.model.completed"],
  ["POST /ai/model-calls/:id/request-cancel", "agent.model.started"],
  ["POST /ai/model-calls/:id/reconcile", "agent.model.completed"],
  ["POST /ai/model-capabilities/refresh", "agent.model.started"],
  ["POST /generation/jobs/:id/browser/credentials", "browser.auth.verify"],
  ["POST /browser-sessions/:sessionId/credentials", "browser.auth.verify"],
  ["POST /browser-accounts/:accountId/reauthenticate", "browser.automation.reauthenticate"],
  ["POST /browser-automations", "browser.automation.run"],
  ["PATCH /browser-automations/:id", "browser.automation.repair"],
  ["POST /browser-automations/:id/revisions", "browser.teaching.compile"],
  ["POST /browser-automations/:id/revisions/:revisionId/activate", "browser.automation.run"],
  ["POST /browser-automations/:id/revisions/:revisionId/rollback", "browser.automation.repair"],
  ["POST /browser-automations/:id/auth-bindings", "browser.account.save"],
  ["POST /browser-automations/:id/schedules", "browser.schedule.evaluate"],
  ["PATCH /browser-automations/:id/schedules/:scheduleId", "browser.schedule.evaluate"],
  ["POST /browser-teaching-runs/:teachingRunId/stop", "browser.teaching.start"],
  ["POST /browser-automations/:id/enable", "browser.automation.run"],
  ["POST /browser-automations/:id/disable", "browser.automation.cancel"],
  ["POST /bindings/preview", "component.revision.publish"],
  ["POST /bindings/test", "component.revision.publish"],
  ["POST /external/targets", "component.revision.publish"],
  ["PATCH /external/targets/:id", "component.revision.publish"],
  ["POST /external/targets/:id/test", "mcp.tools.call"],
  ["POST /external/targets/:id/circuit/open", "monitor.state.transition"],
  ["POST /external/targets/:id/circuit/close", "monitor.state.transition"],
  ["POST /external/auth-bindings", "secret.bind"],
  ["PATCH /external/auth-bindings/:id", "secret.bind"],
  ["POST /external/target-bindings", "component.revision.publish"],
  ["DELETE /external/target-bindings/:id", "component.deregister"],
  ["POST /webhooks/test", "mcp.tools.call"],
  ["PUT /monitoring/profiles/:componentId", "monitor.state.transition"],
  ["POST /logs/export", "audit.archive.enqueue"],
  ["PUT /config/settings/:key", "component.revision.publish"],
  ["POST /config/settings/:key/reset", "component.revision.publish"],
  ["POST /config/validate", "component.validate"],
  ["POST /config/apply", "generation.activation.switch"],
  ["POST /config/export", "audit.archive.enqueue"],
  ["POST /config/import", "component.revision.publish"],
  ["POST /releases/:id/rollback", "component.rollback"],
  ["POST /backups", "audit.archive.enqueue"],
  ["POST /backups/:id/verify", "audit.integrity.verify"],
  ["POST /maintenance/restart-service", "runtime.instance.restart"],
  ["PUT /dashboard/nodes/:id/suspension", "component.suspend"],
  ["POST /dashboard/nodes/:id/deregister", "component.deregister"],
  ["POST /dashboard/secrets/:secretId/bindings", "secret.bind"],
  ["DELETE /dashboard/secrets/:secretId/bindings/:nodeId", "secret.unbind"],
  ["POST /dashboard/secrets/:secretId/bindings/bulk", "secret.bind"],
  ["POST /components", "component.register"],
  ["POST /components/:id/revisions", "component.revision.publish"],
  ["POST /components/:id/validate", "component.validate"],
  ["POST /components/:id/verify", "component.verify"],
  ["POST /components/:id/activate", "component.activate"],
  ["POST /components/:id/enable", "component.enable"],
  ["POST /components/:id/disable", "component.disable"],
  ["POST /components/:id/suspend", "component.suspend"],
  ["POST /components/:id/quarantine", "component.quarantine"],
  ["POST /components/:id/restore", "component.restore"],
  ["POST /components/:id/rollback", "component.rollback"],
  ["POST /components/:id/recertify", "component.recertify"],
  ["POST /mcp-servers/:id/revisions/:revisionId/validate", "mcp.contract.validate"],
  ["POST /mcp-servers/:id/revisions/:revisionId/verify", "mcp.wire.verify"],
  ["POST /mcp-servers/:id/revisions/:revisionId/compatibility", "mcp.contract.compatibility"],
  ["POST /mcp-servers/:id/discovery-snapshots", "mcp.discovery.snapshot"],
  ["POST /mcp-servers/:id/era-probe", "mcp.era.probe"],
  ["POST /mcp-servers/:id/server-discover-test", "mcp.server.discover"],
  ["POST /mcp-servers/:id/request-metadata-test", "mcp.contract.validate"],
  ["POST /mcp-servers/:id/streamable-http-test", "mcp.contract.validate"],
  ["POST /mcp-servers/:id/mrtr-test", "mcp.tools.reconcile"],
  ["POST /mcp-servers/:id/wire-edge-matrix", "mcp.wire.verify"],
  ["POST /mcp-servers/:id/tools/list-test", "mcp.tools.list"],
  ["POST /mcp-servers/:id/resources/list-test", "mcp.resources.list"],
  ["POST /mcp-servers/:id/resources/templates/list-test", "mcp.resources.templates.list"],
  ["POST /mcp-servers/:id/prompts/list-test", "mcp.prompts.list"],
  ["POST /mcp-servers/:id/tools/:toolName/call-test", "mcp.tools.call"],
  ["POST /mcp-servers/:id/subscriptions/list-test", "mcp.subscription.listen"],
  ["POST /mcp-call-runs/:callId/cancel", "mcp.tools.cancel"],
  ["POST /mcp-call-runs/:callId/reconcile", "mcp.tools.reconcile"],
  ["POST /mcp-input-exchanges/:exchangeId/respond", "mcp.input.respond"],
  ["POST /mcp-subscriptions/:subscriptionId/cancel", "mcp.subscription.cancel"],
  ["POST /mcp-state-handles/:handleId/close", "mcp.stateHandle.close"],
  ["POST /mcp-tasks/:taskId/update", "mcp.task.update"],
  ["POST /mcp-tasks/:taskId/cancel", "mcp.task.cancel"],
  ["POST /agents/:id/revisions/:revisionId/tool-bindings/preview", "agent.tool.request"],
  ["POST /agents/:id/runs", "agent.run.start"],
  ["POST /agent-runs/:runId/messages", "agent.message.append"],
  ["POST /agent-runs/:runId/pause", "agent.run.pause"],
  ["POST /agent-runs/:runId/resume", "agent.run.resume"],
  ["POST /agent-runs/:runId/cancel", "agent.run.cancel"],
  ["POST /agent-runs/:runId/approvals/:approvalId/approve", "agent.approval.approve"],
  ["POST /agent-runs/:runId/approvals/:approvalId/reject", "agent.approval.reject"],
  ["POST /agent-sessions/:sessionId/compact", "agent.session.compact"],
  ["POST /agents/:id/memory/search", "agent.memory.read"],
  ["POST /agents/:id/memory/items", "agent.memory.write"],
  ["DELETE /agents/:id/memory/items/:itemId", "agent.memory.write"],
  ["POST /agent-eval-suites/:suiteId/runs", "agent.eval.start"],
  ["POST /chat/conversations", "chat.conversation.create"],
  ["POST /chat/conversations/:id/messages", "chat.message.append"],
  ["POST /chat/conversations/:id/cancel", "chat.command.execute"],
  ["POST /chat/conversations/:id/browser-sessions", "chat.browser.session.create"],
  ["POST /chat/conversations/:id/browser-sessions/:sessionId/attach", "chat.browser.session.attach"],
  ["POST /generation/jobs", "generation.job.create"],
  ["POST /generation/jobs/:id/messages", "generation.message.append"],
  ["POST /generation/jobs/:id/sources", "generation.source.add"],
  ["POST /generation/jobs/:id/capability-snapshots/refresh", "generation.capability.resolve"],
  ["POST /generation/jobs/:id/spec/revisions/:revisionId/precheck", "generation.spec.precheck"],
  ["POST /generation/jobs/:id/approve-spec", "generation.spec.approve"],
  ["POST /generation/jobs/:id/plans/:planId/validate", "generation.plan.validate"],
  ["POST /generation/jobs/:id/validation-runs", "generation.validation.run"],
  ["POST /generation/jobs/:id/blockers/:blockerId/resolve", "generation.blocker.resolve"],
  ["POST /generation/jobs/:id/cancel", "generation.job.cancel"],
  ["POST /generation/jobs/:id/retry", "generation.job.retry"],
  ["POST /generation/jobs/:id/follow-up", "generation.message.append"],
  ["POST /generation/jobs/:id/resume", "generation.job.resume"],
  ["POST /generation/jobs/:id/browser/session", "browser.session.create"],
  ["POST /generation/jobs/:id/browser/attach", "browser.session.attach"],
  ["POST /generation/jobs/:id/browser/account/save", "browser.account.save"],
  ["POST /generation/jobs/:id/browser/operation-scope", "browser.session.state"],
  ["POST /generation/jobs/:id/browser/confirmations", "browser.challenge.resolve"],
  ["POST /generation/jobs/:id/browser/teaching", "browser.teaching.start"],
  ["POST /generation/jobs/:id/browser/teaching/preflight", "browser.automation.preflight"],
  ["POST /generation/jobs/:id/browser/teaching/replay", "browser.automation.run"],
  ["POST /generation/jobs/:id/browser/takeover", "browser.control.transfer"],
  ["POST /generation/jobs/:id/browser/return-to-ai", "browser.control.release"],
  ["POST /browser-sessions", "browser.session.create"],
  ["POST /browser-sessions/:sessionId/pages", "browser.page.open"],
  ["POST /browser-sessions/:sessionId/pages/:pageId/activate", "browser.page.activate"],
  ["POST /browser-sessions/:sessionId/pages/:pageId/close", "browser.page.close"],
  ["POST /browser-sessions/:sessionId/observe", "browser.session.observe"],
  ["POST /browser-sessions/:sessionId/actions", "browser.action.start"],
  ["POST /browser-sessions/:sessionId/actions/:actionId/cancel", "browser.action.cancel"],
  ["POST /browser-sessions/:sessionId/actions/:actionId/reconcile", "browser.action.reconcile"],
  ["POST /browser-sessions/:sessionId/actions/:actionId/resolve-outcome", "browser.action.resolveOutcome"],
  ["POST /browser-sessions/:sessionId/control/acquire", "browser.control.acquire"],
  ["POST /browser-sessions/:sessionId/control/release", "browser.control.release"],
  ["POST /browser-sessions/:sessionId/control/return-to-ai", "browser.control.release"],
  ["POST /browser-sessions/:sessionId/operation-scopes", "browser.session.state"],
  ["POST /browser-sessions/:sessionId/targets/pick", "browser.target.pick"],
  ["POST /browser-sessions/:sessionId/targets/:targetId/revalidate", "browser.target.revalidate"],
  ["POST /browser-sessions/:sessionId/auth/verify", "browser.auth.verify"],
  ["POST /browser-sessions/:sessionId/accounts/save", "browser.account.save"],
  ["POST /browser-sessions/:sessionId/state-bundles/capture", "browser.state.capture"],
  ["POST /browser-sessions/:sessionId/dialogs/:dialogId/respond", "browser.dialog.respond"],
  ["POST /browser-sessions/:sessionId/permissions/:requestId/respond", "browser.dialog.respond"],
  ["POST /browser-sessions/:sessionId/challenges/:challengeId/resolve", "browser.challenge.resolve"],
  ["POST /browser-sessions/:sessionId/pause", "browser.session.pause"],
  ["POST /browser-sessions/:sessionId/resume", "browser.session.resume"],
  ["POST /browser-sessions/:sessionId/recover", "browser.session.recover"],
  ["POST /browser-sessions/:sessionId/close", "browser.session.close"],
  ["POST /browser-sessions/:sessionId/uploads", "browser.upload.create"],
  ["POST /browser-accounts", "browser.account.save"],
  ["PATCH /browser-accounts/:accountId", "browser.account.save"],
  ["POST /browser-accounts/:accountId/verify", "browser.account.verify"],
  ["POST /browser-accounts/:accountId/logout", "browser.account.logout"],
  ["POST /browser-accounts/:accountId/invalidate-state", "browser.state.invalidate"],
  ["POST /browser-accounts/:accountId/state-bundles/:bundleId/verify", "browser.state.verify"],
  ["POST /browser-accounts/:accountId/state-bundles/:bundleId/activate", "browser.state.activate"],
  ["POST /browser-accounts/:accountId/state-bundles/:bundleId/invalidate", "browser.state.invalidate"],
  ["POST /browser-bridges/enrollments", "browser.bridge.enroll"],
  ["POST /browser-bridges/enrollments/:enrollmentId/complete", "browser.bridge.connect"],
  ["POST /browser-bridges/:bridgeId/test", "browser.bridge.test"],
  ["POST /browser-bridges/:bridgeId/rotate-certificate", "browser.bridge.rotateCertificate"],
  ["POST /browser-bridges/:bridgeId/revoke", "browser.bridge.revoke"],
  ["POST /browser-automations/:id/revisions/:revisionId/preflight", "browser.automation.preflight"],
  ["POST /browser-automations/:id/revisions/:revisionId/verify", "browser.automation.verify"],
  ["POST /browser-automations/:id/teaching-runs", "browser.teaching.start"],
  ["POST /browser-teaching-runs/:teachingRunId/compile", "browser.teaching.compile"],
  ["POST /browser-automations/:id/runs", "browser.automation.run"],
  ["POST /browser-runs/:runId/control/acquire", "browser.control.acquire"],
  ["POST /browser-runs/:runId/control/release", "browser.control.release"],
  ["POST /browser-runs/:runId/control/return-to-runtime", "browser.control.release"],
  ["POST /browser-runs/:runId/cancel", "browser.automation.cancel"],
  ["POST /browser-runs/:runId/reauthenticate", "browser.automation.reauthenticate"],
  ["POST /browser-runs/:runId/reconcile", "browser.automation.reconcile"],
  ["POST /browser-runs/:runId/resolve-outcome", "browser.run.manualReview"],
  ["POST /browser-runs/:runId/challenges/:challengeId/resolve", "browser.challenge.resolve"],
  ["POST /browser-automations/:id/repair", "browser.automation.repair"],
  ["POST /secrets/:id/versions/:versionId/activate", "secret.version.activate"],
  ["POST /secrets/:id/rotate", "secret.rotate"],
  ["POST /secrets/:id/bindings", "secret.bind"],
  ["DELETE /secrets/:id/bindings/:bindingId", "secret.unbind"],
  ["POST /secrets/:id/test-resolve", "secret.resolve"],
  ["POST /runtime/instances/:id/drain", "runtime.drain"],
  ["POST /runtime/instances/:id/restart", "runtime.instance.restart"],
  ["POST /runtime/instances/:id/reconcile", "runtime.instance.reconcile"],
  ["POST /runtime/instances/:id/verify-boundary", "runtime.boundary.verify"],
  ["POST /monitoring/probe/run", "monitor.probe.request"],
  ["POST /alerts/:id/acknowledge", "monitor.alert.update"],
  ["POST /alerts/:id/suppress", "monitor.alert.update"],
  ["POST /alerts/:id/close", "monitor.alert.close"],
  ["POST /alerts/channels/test", "monitor.probe.request"],
  ["POST /self-tests/runs", "selfTest.run.start"],
  ["POST /self-tests/runs/:id/replay", "selfTest.registeredElement.run"],
  ["POST /self-tests/runs/:id/shrink", "selfTest.registeredElement.run"],
  ["POST /self-tests/runs/:id/cancel", "selfTest.run.cancel"],
  ["POST /self-tests/runs/:id/cleanup", "selfTest.run.cleanup"],
  ["POST /agentic-security/self-tests", "agentic.security.event.record"],
  ["POST /agentic-security/evidence/export", "agentic.security.evidence.export"],
  ["GET /mcp-tasks/:taskId", "mcp.task.get"],
  ["GET /mcp-tasks/:taskId/events", "mcp.task.get"],
  ["GET /mcp-tools", "mcp.tools.list"],
  ["GET /mcp-tools/:id", "mcp.tools.list"],
  ["GET /mcp-tools/:id/revisions", "mcp.tools.list"],
  ["GET /mcp-tools/:id/callers", "mcp.tools.list"],
  ["GET /mcp-tools/:id/usage", "mcp.tools.list"],
  ["GET /mcp-resources", "mcp.resources.list"],
  ["GET /mcp-resources/:id", "mcp.resources.read"],
  ["GET /mcp-resource-templates", "mcp.resources.templates.list"],
  ["GET /mcp-resource-templates/:id", "mcp.resources.templates.list"],
  ["GET /mcp-prompts", "mcp.prompts.list"],
  ["GET /mcp-prompts/:id", "mcp.prompts.get"],
  ["GET /agent-runs/:runId", "agent.run.status"],
  ["GET /agent-runs/:runId/events", "agent.run.status"],
  ["GET /agent-runs/:runId/checkpoints", "agent.run.status"],
  ["GET /agent-runs/:runId/tool-calls", "agent.run.status"],
  ["GET /agent-runs/:runId/handoffs", "agent.run.status"],
  ["GET /agent-runs/:runId/approvals", "agent.run.status"],
  ["GET /agent-eval-runs/:runId", "agent.run.status"],
  ["GET /agent-eval-runs/:runId/cases", "agent.run.status"],
  ["GET /generation/jobs/:id/browser/session", "browser.session.observe"],
  ["GET /browser-sessions/:sessionId", "browser.session.observe"],
  ["GET /browser-sessions/:sessionId/snapshot", "browser.session.observe"],
  ["GET /browser-sessions/:sessionId/events", "browser.session.observe"],
  ["GET /browser-sessions/:sessionId/pages", "browser.session.observe"],
  ["GET /browser-sessions/:sessionId/pages/:pageId", "browser.session.observe"],
  ["GET /browser-sessions/:sessionId/frames", "browser.session.observe"],
  ["GET /browser-sessions/:sessionId/documents", "browser.session.observe"],
  ["GET /browser-sessions/:sessionId/navigations", "browser.session.observe"],
  ["GET /browser-sessions/:sessionId/actions/:actionId", "browser.action.status"],
  ["GET /browser-sessions/:sessionId/actions/:actionId/attempts", "browser.action.status"],
  ["GET /browser-sessions/:sessionId/control", "browser.session.observe"],
  ["GET /browser-sessions/:sessionId/control-transfers", "browser.session.observe"],
  ["GET /browser-sessions/:sessionId/targets", "browser.session.observe"],
  ["GET /browser-sessions/:sessionId/auth-attempts", "browser.session.observe"],
  ["GET /browser-sessions/:sessionId/artifacts", "browser.session.observe"],
  ["GET /browser-sessions/:sessionId/downloads", "browser.session.observe"],
  ["GET /browser-sessions/:sessionId/preview/latest", "browser.session.observe"],
  ["GET /browser-runs/:runId/session", "browser.session.observe"],
  ["GET /workers/heartbeats", "monitor.heartbeat.observe"],
  ["GET /self-tests/catalog", "selfTest.catalog.list"],
  ["GET /self-tests/fault-catalog", "selfTest.catalog.list"],
  ["GET /self-tests/runs/:id/evidence", "selfTest.evidence.read"],
]);

export function operationForRoute(route, operationNames) {
  const { method, routeKey } = route;
  if (routeKey === 'POST /operations/:operationKey/invoke') return '__DYNAMIC_OPERATION__';
  if (SERVER_HANDLED_ROUTE_KEYS.has(routeKey)) return null;
  const operation = ROUTE_OPERATION_BINDINGS.get(routeKey) ?? null;
  if (operation && !operationNames.includes(operation)) {
    throw new Error('ROUTE_OPERATION_NOT_IN_CANONICAL_CATALOG:' + routeKey + ':' + operation);
  }
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !operation) {
    throw new Error('MUTATING_ROUTE_OPERATION_BINDING_MISSING:' + routeKey);
  }
  return operation;
}

export function surfaceFingerprint(entities, routes) {
  return sha256(JSON.stringify({ entities: entities.map(({ name, contractDigest }) => ({ name, contractDigest })), routes: routes.map(({ method, path }) => ({ method, path })) }));
}
