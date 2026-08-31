#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseSsotEntities, parseSsotRoutes, entityForRoute, operationForRoute, surfaceFingerprint } from './lib/ssot-surface.mjs';
import { compilePostgresSchemaContracts } from './lib/postgres-schema-contract.mjs';

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
const exactColumns = new Map([
  ['component', [
    ['kcml_number', 'text NOT NULL'], ['code', 'text NOT NULL'], ['hostname', 'text'], ['description', 'text'], ['category', 'text NOT NULL'], ['role', 'text NOT NULL'],
    ['contacts', 'jsonb NOT NULL DEFAULT \'[]\'::jsonb'], ['criticality', 'text NOT NULL'], ['runtime_identity_kind', 'text NOT NULL'],
    ['active_revision_id', 'uuid'], ['current_release_id', 'uuid'], ['activation_state', 'text NOT NULL'], ['operational_state', 'text NOT NULL'], ['monitoring_state', 'text NOT NULL'], ['recertification_state', 'text NOT NULL'],
    ['enabled', 'boolean NOT NULL DEFAULT false'], ['ingress_enabled', 'boolean NOT NULL DEFAULT false'], ['pulse_enabled', 'boolean NOT NULL DEFAULT false'], ['egress_enabled', 'boolean NOT NULL DEFAULT false'],
    ['active_binding_set_revision_id', 'uuid'], ['current_activation_epoch', 'bigint NOT NULL DEFAULT 0 CHECK (current_activation_epoch >= 0)'], ['aggregate_event_sequence', 'bigint NOT NULL DEFAULT 0 CHECK (aggregate_event_sequence >= 0)'], ['pointer_snapshot_digest', 'bytea'], ['latest_transition_operation_id', 'uuid'],
    ['activated_at', 'timestamptz'], ['retired_at', 'timestamptz'], ['deregistered_at', 'timestamptz']
  ]],
  ['component_revision', [
    ['component_id', 'uuid NOT NULL REFERENCES kcml.component(id)'], ['semantic_version', 'text NOT NULL'], ['canonical_manifest', 'jsonb NOT NULL'],
    ['manifest_digest', 'bytea NOT NULL'], ['source_provenance', 'jsonb NOT NULL'], ['validation_state', 'text NOT NULL'], ['validation_evidence', 'jsonb NOT NULL'],
    ['verification_state', 'text NOT NULL'], ['verification_evidence', 'jsonb NOT NULL']
  ]],
  ['component_runtime_target', [
    ['transport', 'text NOT NULL'], ['socket_path', 'text'], ['upstream', 'text'],
    ['service_instance', 'text'], ['execution_mode', 'text NOT NULL'],
    ['resource_limits', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'],
    ['readiness_mode', 'text NOT NULL'], ['persistent_state', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb']
  ]],
  ['component_contract_binding', [
    ['source_component_id', 'uuid NOT NULL'], ['source_revision_id', 'uuid NOT NULL'],
    ['target_component_id', 'uuid NOT NULL'], ['target_revision_id', 'uuid NOT NULL'],
    ['contract_key', 'text NOT NULL'], ['source_contract_digest', 'bytea NOT NULL'],
    ['target_contract_digest', 'bytea NOT NULL'], ['operation_scope', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'],
    ['binding_revision', 'bigint NOT NULL DEFAULT 1 CHECK (binding_revision > 0)'],
    ['activation_set_id', 'uuid'], ['retired_at', 'timestamptz'], ['audit_metadata', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb']
  ]],
  ['external_target', [
    ['target_key', 'text NOT NULL'], ['base_url', 'text NOT NULL'],
    ['allowed_paths', 'jsonb NOT NULL DEFAULT \'[]\'::jsonb'], ['allowed_methods', 'text[] NOT NULL DEFAULT \'{}\''],
    ['timeout_ms', 'integer NOT NULL CHECK (timeout_ms > 0)'], ['retry_policy', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'],
    ['rate_limit', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'], ['circuit_state', 'text NOT NULL'],
    ['auth_binding_id', 'uuid'], ['monitoring', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb']
  ]],
  ['browser_upload_handle', [
    ['session_id', 'uuid NOT NULL'], ['run_id', 'uuid'], ['step_id', 'uuid'], ['artifact_id', 'uuid'],
    ['safe_name', 'text NOT NULL'], ['mime_type', 'text'], ['extension', 'text'], ['size_bytes', 'bigint NOT NULL CHECK (size_bytes >= 0)'],
    ['content_digest', 'bytea NOT NULL'], ['sensitivity', 'text NOT NULL'], ['target_policy', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'],
    ['file_count_policy', 'integer NOT NULL DEFAULT 1 CHECK (file_count_policy > 0)'], ['directory_policy', 'text NOT NULL'],
    ['expires_at', 'timestamptz NOT NULL'], ['consumed_at', 'timestamptz'], ['cleanup_at', 'timestamptz']
  ]],
  ['browser_download', [
    ['session_id', 'uuid NOT NULL'], ['run_id', 'uuid'], ['step_id', 'uuid'], ['action_id', 'uuid'],
    ['source_origin', 'text'], ['source_url', 'text'], ['url_kind', 'text'], ['event_sequence', 'bigint NOT NULL DEFAULT 0'],
    ['suggested_name', 'text'], ['safe_name', 'text'], ['mime_type', 'text'], ['expected_size_bytes', 'bigint'],
    ['state', 'text NOT NULL CHECK (state IN (\'STARTED\',\'STREAMING\',\'COMPLETED\',\'FAILED\',\'CANCELLED\'))'],
    ['artifact_id', 'uuid'], ['size_bytes', 'bigint'], ['content_digest', 'bytea'], ['content_verification', 'jsonb'],
    ['temp_path_handle', 'text'], ['cleanup_state', 'text']
  ]],
  ['component_release', [
    ['component_id', 'uuid NOT NULL'], ['revision_id', 'uuid NOT NULL'], ['source_job_id', 'uuid'],
    ['source_commit', 'text'], ['build_digest', 'bytea'], ['artifact_digest', 'bytea'], ['runtime_digest', 'bytea'],
    ['release_directory', 'text'], ['release_reference', 'text'], ['previous_release_id', 'uuid'],
    ['state', 'text NOT NULL'], ['validated_at', 'timestamptz'], ['activated_at', 'timestamptz'], ['rolled_back_at', 'timestamptz'],
    ['evidence', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb']
  ]],
  ['component_readiness_gate', [
    ['component_id', 'uuid NOT NULL'], ['release_id', 'uuid NOT NULL'], ['gate_key', 'text NOT NULL'],
    ['status', 'text NOT NULL'], ['reason_code', 'text'], ['evaluator_version', 'text NOT NULL'],
    ['evidence', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'], ['evidence_digest', 'bytea NOT NULL'],
    ['executed_at', 'timestamptz NOT NULL'], ['expires_at', 'timestamptz']
  ]],
  ['component_e2e_run', [
    ['scenario', 'text NOT NULL'], ['variant', 'text'], ['revision_id', 'uuid'], ['release_id', 'uuid'],
    ['invocation', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'], ['input', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'],
    ['expected', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'], ['actual', 'jsonb'], ['status', 'text NOT NULL'],
    ['duration_ms', 'bigint'], ['evidence', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'], ['cleanup', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb']
  ]],
  ['component_tool_contract', [
    ['component_id', 'uuid NOT NULL'], ['revision_id', 'uuid NOT NULL'], ['tool_name', 'text NOT NULL'], ['title', 'text'], ['description', 'text'],
    ['input_schema', 'jsonb NOT NULL'], ['output_schema', 'jsonb NOT NULL'], ['scope', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'], ['timeout_ms', 'integer'], ['limits', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'],
    ['side_effect_policy', 'text NOT NULL'], ['retry_policy', 'text NOT NULL'], ['idempotency_policy', 'text NOT NULL'], ['concurrency_policy', 'text NOT NULL'], ['contract_digest', 'bytea NOT NULL']
  ]],
  ['component_resource_contract', [
    ['uri_template', 'text NOT NULL'], ['mime_type', 'text'], ['schema', 'jsonb'], ['subscription_policy', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'], ['limits', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'], ['contract_digest', 'bytea NOT NULL']
  ]],
  ['component_prompt_contract', [
    ['prompt_name', 'text NOT NULL'], ['arguments', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'], ['content_schema', 'jsonb NOT NULL'], ['hints', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'], ['contract_digest', 'bytea NOT NULL']
  ]],
  ['component_endpoint_contract', [
    ['endpoint_key', 'text NOT NULL'], ['method', 'text NOT NULL'], ['path', 'text NOT NULL'], ['scope', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'], ['request_schema', 'jsonb NOT NULL'], ['response_schema', 'jsonb NOT NULL'], ['auth_verification', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'], ['webhook_verification', 'jsonb'], ['contract_digest', 'bytea NOT NULL']
  ]],
  ['component_pulse_contract', [
    ['direction', 'text NOT NULL'], ['pulse_type', 'text NOT NULL'], ['schema', 'jsonb NOT NULL'], ['scope', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'], ['delivery', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'], ['contract_digest', 'bytea NOT NULL']
  ]],
  ['component_state_contract', [
    ['component_id', 'uuid NOT NULL REFERENCES kcml.component(id)'], ['revision_id', 'uuid NOT NULL REFERENCES kcml.component_revision(id)'], ['state_key', 'text NOT NULL'], ['category', 'text NOT NULL'], ['schema', 'jsonb NOT NULL'], ['terminal', 'boolean NOT NULL DEFAULT false'], ['contract_digest', 'bytea NOT NULL']
  ]],
  ['component_state_transition', [
    ['from_state', 'text NOT NULL'], ['to_state', 'text NOT NULL'], ['trigger', 'text NOT NULL'], ['guard', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'], ['side_effect', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'], ['contract_digest', 'bytea NOT NULL']
  ]],
  ['mcp_tool_alias', [
    ['agent_scope', 'jsonb'], ['exposure_scope', 'jsonb'], ['source_server_id', 'uuid NOT NULL'], ['source_tool_id', 'uuid NOT NULL'], ['source_revision_id', 'uuid NOT NULL'], ['source_digest', 'bytea NOT NULL'], ['model_alias', 'text NOT NULL'], ['collision_strategy', 'text NOT NULL'], ['openai_projection_id', 'uuid'], ['compatibility_state', 'text NOT NULL'], ['retired_at', 'timestamptz']
  ]],
  ['mcp_server_revision_profile', [
    ['component_id', 'uuid NOT NULL REFERENCES kcml.component(id)'], ['revision_id', 'uuid NOT NULL REFERENCES kcml.component_revision(id)'],
    ['protocol_era', "text NOT NULL CHECK (protocol_era IN ('MODERN','LEGACY','DUAL_ERA_ADAPTER'))"],
    ['supported_protocol_versions', "text[] NOT NULL CHECK (cardinality(supported_protocol_versions) > 0)"], ['selected_protocol_version', 'text NOT NULL'],
    ['canonical_transport', 'text NOT NULL'], ['canonical_endpoint', 'text NOT NULL'], ['canonical_origin', 'text'], ['http_method_profile', 'jsonb NOT NULL'],
    ['required_meta_profile', 'jsonb NOT NULL'], ['standard_header_profile', 'jsonb NOT NULL'], ['method_name_header_profile', 'jsonb NOT NULL'],
    ['server_capabilities', 'jsonb NOT NULL'], ['extension_capabilities', 'jsonb NOT NULL'], ['supported_result_types', "text[] NOT NULL DEFAULT '{}'"],
    ['http_jsonrpc_error_map', 'jsonb NOT NULL'], ['stable_error_profile', 'jsonb NOT NULL'], ['discovery_policy', 'jsonb NOT NULL'], ['cache_policy', 'jsonb NOT NULL'],
    ['pagination_policy', 'jsonb NOT NULL'], ['subscription_policy', 'jsonb NOT NULL'], ['mrtr_policy', 'jsonb NOT NULL'], ['state_handle_policy', 'jsonb NOT NULL'], ['task_policy', 'jsonb NOT NULL'],
    ['json_schema_dialects', "text[] NOT NULL DEFAULT '{}'"], ['reference_policy', 'jsonb NOT NULL'], ['schema_resource_budgets', 'jsonb NOT NULL'],
    ['public_access_profile', 'jsonb'], ['internal_binding_profile', 'jsonb NOT NULL'], ['legacy_compatibility_profile', 'jsonb'], ['era_probe_profile', 'jsonb NOT NULL'],
    ['canonical_profile', 'jsonb NOT NULL'], ['profile_digest', 'bytea NOT NULL']
  ]],
  ['mcp_registration_probe', [
    ['external_server_id', 'uuid NOT NULL'], ['external_server_revision_id', 'uuid NOT NULL'], ['transport_kind', 'text NOT NULL'],
    ['origin', 'text NOT NULL'], ['endpoint', 'text NOT NULL'], ['auth_binding_id', 'uuid'], ['tls_fingerprint', 'bytea'],
    ['attempted_era', "text NOT NULL CHECK (attempted_era IN ('MODERN','LEGACY'))"], ['request_version', 'text'], ['request_method', 'text NOT NULL'],
    ['request_header_digest', 'bytea NOT NULL'], ['request_body_digest', 'bytea NOT NULL'], ['http_status', 'integer'], ['response_content_type', 'text'],
    ['jsonrpc_id_evidence', 'jsonb'], ['jsonrpc_result_evidence', 'jsonb'], ['jsonrpc_error_evidence', 'jsonb'],
    ['classification', "text NOT NULL CHECK (classification IN ('MODERN','LEGACY_CANDIDATE','LEGACY','ERA_INDETERMINATE','PROTOCOL_INVALID') AND (classification <> 'LEGACY' OR (attempted_era = 'LEGACY' AND (http_status IS NULL OR (http_status NOT IN (401,403,407,429) AND http_status < 500)))))"],
    ['recognized_modern_error', 'boolean NOT NULL DEFAULT false'], ['advertised_versions', "text[] NOT NULL DEFAULT '{}'"],
    ['fallback_decision', 'text'], ['fallback_reason', 'text'], ['observed_at', 'timestamptz NOT NULL'], ['expires_at', 'timestamptz NOT NULL'],
    ['process_fingerprint', 'bytea'], ['release_fingerprint', 'bytea'], ['evidence_digest', 'bytea NOT NULL'],
    ['transport_failure_kind', "text CHECK (transport_failure_kind IS NULL OR classification = 'ERA_INDETERMINATE')"]
  ]],
  ['mcp_discovery_snapshot', [
    ['server_component_id', 'uuid NOT NULL REFERENCES kcml.component(id)'], ['server_revision_id', 'uuid NOT NULL REFERENCES kcml.component_revision(id)'], ['server_release_id', 'uuid'],
    ['endpoint', 'text NOT NULL'], ['method', 'text NOT NULL'], ['protocol_version', 'text NOT NULL'], ['client_capability_digest', 'bytea NOT NULL'], ['extension_digest', 'bytea NOT NULL'],
    ['source_execution_context_id', 'uuid'], ['access_channel', 'text NOT NULL'], ['auth_binding_id', 'uuid'], ['binding_revision', 'bigint'], ['exposure_fingerprint', 'bytea NOT NULL'],
    ['request_params', 'jsonb NOT NULL'], ['page_cursor', 'text'], ['cache_key_digest', 'bytea NOT NULL'], ['request_body_digest', 'bytea NOT NULL'], ['request_header_digest', 'bytea NOT NULL'],
    ['result_payload', 'jsonb NOT NULL'], ['result_digest', 'bytea NOT NULL'], ['element_contract_digests', "bytea[] NOT NULL DEFAULT '{}'"],
    ['ttl_ms', 'bigint NOT NULL CHECK (ttl_ms >= 0)'], ['cache_scope', 'text NOT NULL'], ['received_at', 'timestamptz NOT NULL'], ['expires_at', 'timestamptz NOT NULL'],
    ['previous_page_snapshot_id', 'uuid REFERENCES kcml.mcp_discovery_snapshot(id)'], ['page_index', 'integer NOT NULL DEFAULT 0 CHECK (page_index >= 0)'],
    ['page_lineage_evidence', 'jsonb NOT NULL'], ['aggregate_traversal_digest', 'bytea'],
    ['state', "text NOT NULL CHECK (state IN ('FRESH','STALE','INVALID','DIAGNOSTIC_ONLY'))"], ['invalidation_reason', 'text'], ['invalidation_relation', 'jsonb'],
    ['latency_ms', 'bigint NOT NULL CHECK (latency_ms >= 0)'], ['verification_state', 'text NOT NULL'],
    ['contains_input_responses', 'boolean NOT NULL DEFAULT false'], ['contains_request_state', 'boolean NOT NULL DEFAULT false']
  ]],
  ['mcp_discovery_item', [
    ['snapshot_id', 'uuid NOT NULL REFERENCES kcml.mcp_discovery_snapshot(id)'], ['kind', "text NOT NULL CHECK (kind IN ('TOOL','RESOURCE','RESOURCE_TEMPLATE','PROMPT'))"],
    ['element_id', 'text NOT NULL'], ['visible_name', 'text'], ['visible_uri', 'text'], ['source_revision_id', 'uuid NOT NULL'], ['contract_digest', 'bytea NOT NULL'],
    ['native_schema_bundle', 'jsonb NOT NULL'], ['native_schema_digest', 'bytea NOT NULL'], ['openai_projection_digest', 'bytea'], ['mcp_header_map_digest', 'bytea'],
    ['sort_key', 'text NOT NULL'], ['verification_state', 'text NOT NULL'], ['error', 'jsonb']
  ]],
  ['mcp_request_event', [
    ['server_component_id', 'uuid NOT NULL REFERENCES kcml.component(id)'], ['server_revision_id', 'uuid NOT NULL REFERENCES kcml.component_revision(id)'], ['server_release_id', 'uuid'],
    ['endpoint', 'text NOT NULL'], ['access_context', 'jsonb NOT NULL'], ['protocol_era', "text NOT NULL CHECK (protocol_era IN ('MODERN','LEGACY','DUAL_ERA_ADAPTER'))"], ['protocol_version', 'text NOT NULL'],
    ['request_id_type', "text CHECK (request_id_type IN ('STRING','INTEGER'))"], ['request_id_value', 'text'], ['inflight_source_scope', 'text NOT NULL'], ['method', 'text NOT NULL'],
    ['method_name', 'text'], ['resource_uri', 'text'], ['task_id', 'text'], ['is_notification', 'boolean NOT NULL DEFAULT false'],
    ['source_execution_context_id', 'uuid'], ['auth_decision', 'jsonb NOT NULL'], ['binding_decision', 'jsonb NOT NULL'], ['client_info', 'jsonb'],
    ['client_capability_digest', 'bytea'], ['extension_digest', 'bytea'], ['request_headers', 'jsonb'], ['request_body', 'jsonb'], ['request_headers_digest', 'bytea NOT NULL'], ['request_body_digest', 'bytea NOT NULL'],
    ['routing_headers', 'jsonb NOT NULL'], ['header_validation_result', 'jsonb NOT NULL'], ['http_method', 'text NOT NULL'], ['origin', 'text'], ['accept_type', 'text'], ['content_type', 'text'],
    ['request_size_bytes', 'bigint NOT NULL CHECK (request_size_bytes >= 0)'], ['processing_stage', 'text NOT NULL'], ['handler_dispatched', 'boolean NOT NULL DEFAULT false'],
    ['response_http_status', 'integer'], ['response_content_type', 'text'], ['result_type', 'text'], ['jsonrpc_error_code', 'integer'], ['stable_error_code', 'text'],
    ['sse_stream_id', 'text'], ['stream_message_sequence', 'bigint'], ['final_response_state', 'text NOT NULL'], ['disconnect_cancel_point', 'text'], ['response_delivery_state', 'text NOT NULL'],
    ['causation_id', 'uuid'], ['trace_id', 'text'], ['received_at', 'timestamptz NOT NULL'], ['completed_at', 'timestamptz']
  ]],
  ['mcp_call_progress', [
    ['call_run_id', 'uuid NOT NULL REFERENCES kcml.mcp_call_run(id)'], ['sequence', 'bigint NOT NULL CHECK (sequence > 0)'], ['progress_token', 'text NOT NULL'],
    ['completed_units', 'numeric'], ['total_units', 'numeric'], ['message', 'text'], ['checkpoint_id', 'uuid'], ['emitted_at', 'timestamptz NOT NULL'],
    ['payload_digest', 'bytea NOT NULL'], ['response_stream_id', 'text NOT NULL'], ['delivery_state', 'text NOT NULL']
  ]],
  ['mcp_input_request_item', [
    ['input_exchange_id', 'uuid NOT NULL REFERENCES kcml.mcp_input_exchange(id)'], ['request_key', 'text NOT NULL'],
    ['request_method', "text NOT NULL CHECK (request_method IN ('elicitation/create','sampling/createMessage','roots/list'))"], ['params', 'jsonb NOT NULL'], ['params_digest', 'bytea NOT NULL'],
    ['required_client_capability_digest', 'bytea NOT NULL'], ['state', "text NOT NULL CHECK (state IN ('OUTSTANDING','SATISFIED','SUPERSEDED','EXPIRED'))"],
    ['satisfied_at', 'timestamptz']
  ]],
  ['mcp_input_response_item', [
    ['input_exchange_id', 'uuid NOT NULL REFERENCES kcml.mcp_input_exchange(id)'], ['retry_request_event_id', 'uuid NOT NULL REFERENCES kcml.mcp_request_event(id)'], ['supplied_key', 'text NOT NULL'],
    ['raw_response', 'jsonb NOT NULL'], ['normalized_response', 'jsonb'], ['response_digest', 'bytea NOT NULL'],
    ['disposition', "text NOT NULL CHECK (disposition IN ('ACCEPTED','DUPLICATE_REPLAY','IGNORED_UNKNOWN','IGNORED_ALREADY_SATISFIED','REJECTED_INVALID'))"],
    ['input_request_item_id', 'uuid REFERENCES kcml.mcp_input_request_item(id)'], ['audit_event_id', 'uuid']
  ]],
  ['mcp_subscription', [
    ['server_component_id', 'uuid NOT NULL REFERENCES kcml.component(id)'], ['server_revision_id', 'uuid NOT NULL REFERENCES kcml.component_revision(id)'], ['server_release_id', 'uuid'],
    ['request_id_type', "text NOT NULL CHECK (request_id_type IN ('STRING','INTEGER'))"], ['request_id_value', 'text NOT NULL'], ['source_execution_context_id', 'uuid'],
    ['access_context', 'jsonb NOT NULL'], ['binding_revision', 'bigint NOT NULL'], ['protocol_version', 'text NOT NULL'], ['capability_digest', 'bytea NOT NULL'], ['extension_digest', 'bytea NOT NULL'],
    ['requested_filter', 'jsonb NOT NULL'], ['acknowledged_filter', 'jsonb'], ['state', "text NOT NULL CHECK (state IN ('OPENING','ACTIVE','CANCEL_REQUESTED','GRACEFUL_CLOSING','CLOSED','FAILED'))"],
    ['ack_persisted_sequence', 'bigint'], ['ack_emitted_sequence', 'bigint'], ['first_message_proof', 'jsonb'], ['stream_opened_at', 'timestamptz'], ['last_keepalive_at', 'timestamptz'], ['closed_at', 'timestamptz'],
    ['final_response_state', 'text'], ['close_reason', 'text'], ['notification_count', 'bigint NOT NULL DEFAULT 0 CHECK (notification_count >= 0)'], ['last_error', 'jsonb'], ['trace_id', 'text']
  ]],
  ['mcp_subscription_notification', [
    ['subscription_id', 'uuid NOT NULL REFERENCES kcml.mcp_subscription(id)'], ['sequence', 'bigint NOT NULL CHECK (sequence > 0)'], ['method', 'text NOT NULL'],
    ['source_object_id', 'uuid'], ['source_uri', 'text'], ['source_task_id', 'text'], ['payload', 'jsonb NOT NULL'], ['payload_digest', 'bytea NOT NULL'],
    ['meta_subscription_id', 'text NOT NULL'], ['emitted_at', 'timestamptz NOT NULL'], ['delivered_at', 'timestamptz'], ['delivery_result', 'jsonb']
  ]],
  ['mcp_state_handle', [
    ['owner_component_id', 'uuid NOT NULL REFERENCES kcml.component(id)'], ['owner_tool_key', 'text NOT NULL'], ['owner_revision_id', 'uuid NOT NULL REFERENCES kcml.component_revision(id)'], ['contract_digest', 'bytea NOT NULL'],
    ['public_opaque_id', 'text NOT NULL'], ['lookup_digest', 'bytea NOT NULL'], ['generation_nonce', 'uuid NOT NULL'], ['source_execution_context_id', 'uuid'], ['access_context', 'jsonb NOT NULL'],
    ['binding_revision', 'bigint NOT NULL'], ['state_namespace', 'text NOT NULL'], ['state_reference', 'text NOT NULL'], ['status', "text NOT NULL CHECK (status IN ('OPEN','CLOSED','EXPIRED'))"],
    ['last_used_at', 'timestamptz'], ['expires_at', 'timestamptz NOT NULL'], ['closed_at', 'timestamptz'], ['close_logical_operation_id', 'uuid'], ['audit_event_id', 'uuid']
  ]],
  ['mcp_task_input_request', [
    ['task_id', 'uuid NOT NULL REFERENCES kcml.mcp_task(id)'], ['request_key', 'text NOT NULL'], ['request_method', 'text NOT NULL'], ['params', 'jsonb NOT NULL'],
    ['params_digest', 'bytea NOT NULL'], ['required_capability_digest', 'bytea NOT NULL'], ['state', "text NOT NULL CHECK (state IN ('OUTSTANDING','SATISFIED','SUPERSEDED','EXPIRED'))"], ['satisfied_at', 'timestamptz']
  ]],
  ['mcp_task_input_response', [
    ['task_id', 'uuid NOT NULL REFERENCES kcml.mcp_task(id)'], ['update_request_event_id', 'uuid NOT NULL REFERENCES kcml.mcp_request_event(id)'], ['supplied_key', 'text NOT NULL'],
    ['normalized_response', 'jsonb NOT NULL'], ['response_digest', 'bytea NOT NULL'], ['disposition', "text NOT NULL CHECK (disposition IN ('ACCEPTED','DUPLICATE','IGNORED_UNKNOWN','IGNORED_ALREADY_SATISFIED','REJECTED_INVALID'))"],
    ['accepted_at', 'timestamptz'], ['audit_event_id', 'uuid']
  ]],
  ['mcp_task_event', [
    ['task_id', 'uuid NOT NULL REFERENCES kcml.mcp_task(id)'], ['sequence', 'bigint NOT NULL CHECK (sequence > 0)'], ['status_projection', 'jsonb NOT NULL'], ['status_message', 'text'],
    ['input_request_id', 'uuid'], ['final_result_reference', 'jsonb'], ['error_reference', 'jsonb'], ['payload_digest', 'bytea NOT NULL'], ['occurred_at', 'timestamptz NOT NULL'],
    ['subscription_notification_id', 'uuid REFERENCES kcml.mcp_subscription_notification(id)']
  ]],
  ['mcp_idempotency_record', [
    ['server_component_id', 'uuid NOT NULL REFERENCES kcml.component(id)'], ['tool_key', 'text NOT NULL'], ['operation_contract_revision_id', 'uuid NOT NULL'], ['operation_contract_digest', 'bytea NOT NULL'],
    ['caller_authority_kind', 'text NOT NULL'], ['source_object_id', 'uuid NOT NULL'], ['source_revision_id', 'uuid NOT NULL'], ['access_fingerprint', 'bytea NOT NULL'],
    ['business_target', 'jsonb NOT NULL'], ['concurrency_resource', 'jsonb'], ['idempotency_key', 'text NOT NULL'], ['request_digest', 'bytea NOT NULL'],
    ['original_call_attempt_id', 'uuid'], ['current_call_attempt_id', 'uuid'],
    ['state', "text NOT NULL CHECK (state IN ('RESERVED','EXECUTING','WAITING_FOR_INPUT','WAITING_FOR_RECONCILIATION','SUCCEEDED','FAILED_FINAL','CANCELLED_FINAL','MANUAL_REVIEW'))"],
    ['current_result', 'jsonb'], ['terminal_result', 'jsonb'], ['terminal_error', 'jsonb'], ['terminal_event_digest', 'bytea'], ['retry_directive', 'text'], ['expires_at', 'timestamptz NOT NULL']
  ]],
  ['runtime_execution_context', [
    ['execution_kind', "text NOT NULL CHECK (execution_kind IN ('COMPONENT','AGENT','PLATFORM','OWNER_API','EXTERNAL_BINDING'))"], ['source_object_kind', 'text NOT NULL'], ['source_object_id', 'uuid NOT NULL'],
    ['source_revision_id', 'uuid NOT NULL'], ['run_id', 'uuid'], ['job_id', 'uuid'], ['worker_id', 'uuid'], ['execution_attempt_id', 'uuid NOT NULL'], ['binding_set_revision_id', 'uuid'],
    ['execution_snapshot_digest', 'bytea NOT NULL'], ['trusted_dispatcher', 'text NOT NULL'], ['service_identity', 'text NOT NULL'], ['systemd_identity', 'jsonb'], ['uds_path', 'text'], ['peer_credential_evidence', 'jsonb'],
    ['started_at', 'timestamptz'], ['completed_at', 'timestamptz'], ['state', 'text NOT NULL'], ['context_digest', 'bytea NOT NULL']
  ]],
  ['runtime_process_identity', [
    ['runtime_instance_id', 'uuid NOT NULL REFERENCES kcml.runtime_instance(id)'], ['runtime_generation', 'bigint NOT NULL CHECK (runtime_generation > 0)'],
    ['process_role', "text NOT NULL CHECK (process_role IN ('HOST','SANDBOX_INIT','HANDLER','CHILD'))"], ['linux_pid', 'integer NOT NULL CHECK (linux_pid > 0)'], ['linux_uid', 'integer NOT NULL CHECK (linux_uid >= 0)'], ['linux_gid', 'integer NOT NULL CHECK (linux_gid >= 0)'],
    ['supplementary_groups', "integer[] NOT NULL DEFAULT '{}'"], ['host_boot_id', 'uuid NOT NULL'], ['process_start_ticks', 'bigint NOT NULL CHECK (process_start_ticks >= 0)'],
    ['systemd_unit', 'text NOT NULL'], ['invocation_id', 'uuid NOT NULL'], ['main_pid_relation', 'jsonb NOT NULL'], ['cgroup_path', 'text NOT NULL'], ['pidfd_evidence', 'jsonb'],
    ['parent_process_identity_id', 'uuid REFERENCES kcml.runtime_process_identity(id)'], ['namespace_profile_digest', 'bytea NOT NULL'], ['executable_digest', 'bytea NOT NULL'], ['release_digest', 'bytea NOT NULL'],
    ['started_at', 'timestamptz NOT NULL'], ['ready_at', 'timestamptz'], ['exited_at', 'timestamptz'], ['exit_code', 'integer'], ['exit_signal', 'integer'], ['oom_reason', 'text'], ['seccomp_reason', 'text'], ['identity_digest', 'bytea NOT NULL']
  ]],
  ['runtime_ipc_connection', [
    ['transport_kind', "text NOT NULL CHECK (transport_kind IN ('RUNTIME_GATEWAY_UDS','HANDLER_ANONYMOUS','BROKER_UDS','BROWSER_HOST_UDS'))"], ['canonical_path', 'text'], ['anonymous_channel_id', 'uuid'],
    ['socket_device', 'bigint'], ['socket_inode', 'bigint'], ['socket_type', 'text NOT NULL'], ['socket_owner_uid', 'integer'], ['socket_group_gid', 'integer'], ['socket_mode', 'integer'], ['socket_unit', 'text'],
    ['peer_uid', 'integer NOT NULL'], ['peer_gid', 'integer NOT NULL'], ['peer_pid', 'integer NOT NULL'], ['peer_boot_id', 'uuid NOT NULL'], ['peer_start_ticks', 'bigint NOT NULL'], ['peer_systemd_identity', 'jsonb NOT NULL'], ['peer_cgroup_path', 'text NOT NULL'],
    ['runtime_instance_id', 'uuid REFERENCES kcml.runtime_instance(id)'], ['runtime_generation', 'bigint'], ['service_invocation_id', 'uuid'], ['protocol_profile_digest', 'bytea NOT NULL'],
    ['first_sequence', 'bigint NOT NULL DEFAULT 0'], ['last_sequence', 'bigint NOT NULL DEFAULT 0'], ['inflight_count', 'bigint NOT NULL DEFAULT 0 CHECK (inflight_count >= 0)'],
    ['state', "text NOT NULL CHECK (state IN ('OPENING','ACTIVE','DRAINING','CLOSED','REJECTED'))"], ['opened_at', 'timestamptz NOT NULL'], ['validated_at', 'timestamptz'], ['draining_at', 'timestamptz'], ['closed_at', 'timestamptz'], ['close_reason', 'text']
  ]],
  ['runtime_ipc_call', [
    ['connection_id', 'uuid NOT NULL REFERENCES kcml.runtime_ipc_connection(id)'], ['parent_execution_context_id', 'uuid NOT NULL REFERENCES kcml.runtime_execution_context(id)'], ['child_execution_context_id', 'uuid REFERENCES kcml.runtime_execution_context(id)'],
    ['request_id', 'text NOT NULL'], ['sequence', 'bigint NOT NULL CHECK (sequence > 0)'], ['operation', 'text NOT NULL'], ['capability_alias', 'text NOT NULL'],
    ['resolved_target', 'jsonb NOT NULL'], ['resolved_binding_id', 'uuid'], ['resolved_secret_id', 'uuid'], ['resolved_external_target_id', 'uuid'], ['resolved_state_reference', 'jsonb'],
    ['revision_id', 'uuid NOT NULL'], ['release_id', 'uuid NOT NULL'], ['runtime_generation', 'bigint NOT NULL'], ['binding_revision', 'bigint NOT NULL'],
    ['input_digest', 'bytea NOT NULL'], ['output_digest', 'bytea'], ['error_digest', 'bytea'], ['input_bytes', 'bigint NOT NULL CHECK (input_bytes >= 0)'], ['output_bytes', 'bigint CHECK (output_bytes >= 0)'],
    ['deadline_at', 'timestamptz NOT NULL'], ['cancellation_version', 'bigint NOT NULL DEFAULT 0'], ['stream_state', 'jsonb'], ['window_state', 'jsonb'],
    ['state', "text NOT NULL CHECK (state IN ('RECEIVED','VALIDATED','DISPATCHED','STREAMING','RECONCILING','SUCCEEDED','FAILED','CANCELLED','MANUAL_REVIEW'))"],
    ['result', 'jsonb'], ['error', 'jsonb'], ['cleanup_state', 'text NOT NULL'], ['started_at', 'timestamptz'], ['completed_at', 'timestamptz']
  ]],
  ['runtime_credential_generation', [
    ['service_id', 'uuid NOT NULL'], ['credential_stable_id', 'uuid NOT NULL'], ['credential_kind', 'text NOT NULL'], ['desired_generation', 'bigint NOT NULL'], ['effective_generation', 'bigint'], ['fingerprint', 'bytea'], ['source_version', 'bigint'], ['systemd_unit', 'text'], ['invocation_id', 'uuid'], ['rotation_operation_id', 'uuid'], ['restart_relation', 'jsonb'], ['verification_evidence', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'], ['activated_at', 'timestamptz'], ['retired_at', 'timestamptz']
  ]],
  ['runtime_cleanup_operation', [
    ['runtime_instance_id', 'uuid NOT NULL'], ['runtime_generation', 'bigint NOT NULL'], ['cleanup_reason', 'text NOT NULL'], ['checkpoint', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'], ['fencing_token', 'bigint'], ['resource_inventory', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'], ['pending_side_effects', 'jsonb NOT NULL DEFAULT \'[]\'::jsonb'], ['leases', 'jsonb NOT NULL DEFAULT \'[]\'::jsonb'], ['capacity_claims', 'jsonb NOT NULL DEFAULT \'[]\'::jsonb'], ['ordered_steps', 'jsonb NOT NULL DEFAULT \'[]\'::jsonb'], ['attempts', 'jsonb NOT NULL DEFAULT \'[]\'::jsonb'], ['outcomes', 'jsonb NOT NULL DEFAULT \'[]\'::jsonb'], ['evidence_digests', 'jsonb NOT NULL DEFAULT \'[]\'::jsonb'], ['completed_at', 'timestamptz']
  ]],
  ['webhook_endpoint', [
    ['component_id', 'uuid NOT NULL'], ['revision_id', 'uuid NOT NULL'], ['path', 'text NOT NULL'], ['verification_mode', 'text NOT NULL'], ['secret_refs', 'jsonb NOT NULL DEFAULT \'[]\'::jsonb'], ['schema', 'jsonb NOT NULL'], ['processing_contract', 'jsonb NOT NULL']
  ]],
  ['external_auth_binding', [
    ['binding_key', 'text NOT NULL'], ['component_id', 'uuid'], ['revision_id', 'uuid'], ['endpoint_id', 'uuid'], ['external_target_id', 'uuid'],
    ['auth_mode', 'text NOT NULL'], ['secret_id', 'uuid'], ['certificate_id', 'uuid'], ['method', 'text'], ['path', 'text'], ['tool_key', 'text'],
    ['rate_policy', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'], ['circuit_policy', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'], ['verifier_policy', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'], ['retired_at', 'timestamptz'], ['audit_metadata', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb']
  ]],
  ['secret_binding', [
    ['secret_id', 'uuid NOT NULL'], ['source_object_kind', 'text NOT NULL'], ['source_object_id', 'uuid NOT NULL'], ['source_revision_id', 'uuid NOT NULL'],
    ['usage_purpose', 'text NOT NULL'], ['target_id', 'uuid'], ['account_id', 'uuid'], ['version_selector', 'jsonb NOT NULL'], ['resolved_version_policy', 'text NOT NULL'],
    ['binding_revision', 'bigint NOT NULL CHECK (binding_revision > 0)'], ['binding_digest', 'bytea NOT NULL'], ['activation_set_id', 'uuid'], ['expires_at', 'timestamptz'], ['invalidation_policy', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'], ['retired_at', 'timestamptz'], ['audit_metadata', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb']
  ]],
  ['secret_resolution', [
    ['execution_context_id', 'uuid NOT NULL'], ['secret_id', 'uuid NOT NULL'], ['binding_id', 'uuid NOT NULL'], ['binding_revision', 'bigint NOT NULL'], ['binding_digest', 'bytea NOT NULL'],
    ['requested_stable_name', 'text NOT NULL'], ['requested_purpose', 'text NOT NULL'], ['requested_target', 'jsonb'], ['resolved_secret_version_id', 'uuid'], ['secret_activation_epoch', 'bigint'],
    ['source_revision_id', 'uuid'], ['target_revision_id', 'uuid'], ['source_activation_epoch', 'bigint'], ['target_activation_epoch', 'bigint'], ['state', 'text NOT NULL CHECK (state IN (\'RESERVED\',\'RESOLVED\',\'REJECTED\',\'EXPIRED\'))'],
    ['result_fingerprint', 'bytea'], ['expires_at', 'timestamptz NOT NULL'], ['consumed_at', 'timestamptz'], ['audit_event_id', 'uuid']
  ]],
  ['secret_access_event', [
    ['secret_id', 'uuid NOT NULL'], ['secret_version_id', 'uuid NOT NULL'], ['execution_context_id', 'uuid NOT NULL'], ['binding_id', 'uuid'], ['purpose', 'text NOT NULL'], ['operation', 'text NOT NULL'], ['success', 'boolean NOT NULL'], ['occurred_at', 'timestamptz NOT NULL'], ['runtime_id', 'uuid'], ['job_id', 'uuid'], ['run_id', 'uuid']
  ]],
  ['external_target_binding', [
    ['source_component_id', 'uuid NOT NULL'], ['source_revision_id', 'uuid NOT NULL'], ['target_id', 'uuid NOT NULL'], ['route', 'text NOT NULL'], ['method', 'text NOT NULL'], ['request_contract_digest', 'bytea NOT NULL'], ['response_contract_digest', 'bytea NOT NULL'], ['binding_revision', 'bigint NOT NULL CHECK (binding_revision > 0)'], ['activation_set_id', 'uuid']
  ]],
  ['external_request_event', [
    ['external_target_id', 'uuid NOT NULL'], ['binding_id', 'uuid NOT NULL'], ['binding_revision', 'bigint NOT NULL'], ['route', 'text NOT NULL'], ['method', 'text NOT NULL'],
    ['side_effect_operation_id', 'uuid'], ['attempt', 'bigint NOT NULL'], ['target_idempotency_key', 'text'], ['request_metadata', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'], ['request_payload_digest', 'bytea NOT NULL'],
    ['dispatch_state', 'text NOT NULL'], ['sent_at', 'timestamptz'], ['transport_evidence', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'], ['response_metadata', 'jsonb'], ['response_payload_digest', 'bytea'], ['provider_request_id', 'text'], ['provider_event_id', 'text'],
    ['outcome', 'text NOT NULL CHECK (outcome IN (\'CONFIRMED_APPLIED\',\'CONFIRMED_NOT_APPLIED\',\'UNKNOWN\',\'READ_ONLY_RESULT\'))'], ['reconciliation_state', 'text'], ['reconciliation_evidence', 'jsonb'], ['next_action', 'text'],
    ['latency_ms', 'bigint'], ['http_status', 'integer'], ['provider_status', 'text'], ['retry_classification', 'text'], ['circuit_decision', 'text'], ['worker_fence', 'bigint'], ['causation_id', 'uuid'], ['trace_id', 'text']
  ]],
  ['dashboard_workspace', [
    ['owner_identity_id', 'uuid NOT NULL'], ['viewport_x', 'double precision NOT NULL DEFAULT 0'], ['viewport_y', 'double precision NOT NULL DEFAULT 0'], ['viewport_zoom', 'double precision NOT NULL DEFAULT 1 CHECK (viewport_zoom > 0)'], ['filters', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'], ['groups', 'jsonb NOT NULL DEFAULT \'[]\'::jsonb'], ['lock_version', 'bigint NOT NULL DEFAULT 1 CHECK (lock_version > 0)']
  ]],
  ['dashboard_node_position', [
    ['workspace_id', 'uuid NOT NULL'], ['node_id', 'uuid NOT NULL'], ['position_x', 'double precision NOT NULL'], ['position_y', 'double precision NOT NULL'], ['position_z', 'integer NOT NULL DEFAULT 0'], ['group_id', 'uuid'], ['collapsed', 'boolean NOT NULL DEFAULT false']
  ]],
  ['dashboard_connection', [
    ['source_component_id', 'uuid NOT NULL'], ['source_port', 'text NOT NULL'], ['target_component_id', 'uuid NOT NULL'], ['target_port', 'text NOT NULL'], ['route', 'text'], ['operation_scope', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'], ['source_contract_digest', 'bytea NOT NULL'], ['target_contract_digest', 'bytea NOT NULL'], ['compatibility_state', 'text NOT NULL'], ['compatibility_evidence', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'], ['desired_binding_id', 'uuid'], ['effective_binding_id', 'uuid']
  ]],
  ['dashboard_runtime_event', [
    ['component_id', 'uuid NOT NULL'], ['event_kind', 'text NOT NULL'], ['operation_name', 'text'], ['direction', 'text NOT NULL'], ['success', 'boolean NOT NULL'], ['trace_id', 'text'], ['occurred_at', 'timestamptz NOT NULL'], ['received_at', 'timestamptz NOT NULL']
  ]],
  ['component_state_history', [
    ['component_id', 'uuid NOT NULL'], ['lifecycle_state', 'text NOT NULL'], ['operational_state', 'text NOT NULL'], ['recertification_state', 'text NOT NULL'], ['reason', 'text'], ['recorded_at', 'timestamptz NOT NULL']
  ]],
  ['alert_delivery', [
    ['alert_id', 'uuid NOT NULL'], ['channel', 'text NOT NULL'], ['idempotency_key', 'text NOT NULL'], ['attempts', 'integer NOT NULL DEFAULT 0 CHECK (attempts >= 0)'], ['state', 'text NOT NULL'], ['status_code', 'text'], ['error', 'jsonb'], ['next_attempt_at', 'timestamptz'], ['delivered_at', 'timestamptz']
  ]],
  ['monitoring_scheduler_heartbeat', [
    ['worker_id', 'uuid NOT NULL'], ['started_at', 'timestamptz NOT NULL'], ['completed_at', 'timestamptz'], ['lease_owner', 'uuid'], ['lease_fencing_token', 'bigint'], ['lease_expires_at', 'timestamptz'], ['error', 'jsonb'], ['next_run_at', 'timestamptz']
  ]],
  ['audit_archive_outbox', [
    ['event_id', 'uuid NOT NULL'], ['payload', 'jsonb NOT NULL'], ['state', 'text NOT NULL'], ['attempts', 'integer NOT NULL DEFAULT 0 CHECK (attempts >= 0)'], ['lease_owner', 'uuid'], ['lease_fencing_token', 'bigint'], ['lease_expires_at', 'timestamptz'], ['error', 'jsonb'], ['archived_at', 'timestamptz']
  ]],
  ['component_audit_stream', [
    ['component_id', 'uuid NOT NULL'], ['first_sequence', 'bigint NOT NULL DEFAULT 0'], ['last_sequence', 'bigint NOT NULL DEFAULT 0'], ['gap_state', 'text NOT NULL'], ['replay_state', 'text NOT NULL'], ['current_hash', 'bytea NOT NULL'], ['integrity_state', 'text NOT NULL']
  ]],
  ['component_audit_event', [
    ['stream_id', 'uuid NOT NULL'], ['sequence', 'bigint NOT NULL'], ['workflow', 'text'], ['step', 'text'], ['actor', 'jsonb'], ['model', 'text'], ['tool', 'text'], ['service', 'text'], ['classifications', 'jsonb NOT NULL DEFAULT \'[]\'::jsonb'], ['payload', 'jsonb NOT NULL'], ['access_channel', 'text'], ['binding_id', 'uuid'], ['protocol', 'text'], ['http_status', 'integer'], ['retry_classification', 'text'], ['causation_id', 'uuid'], ['trace_id', 'text'], ['span_id', 'text'], ['state_change', 'jsonb'], ['payload_digest', 'bytea NOT NULL'], ['previous_hash', 'bytea'], ['event_hash', 'bytea NOT NULL']
  ]],
  ['debug_log_event', [
    ['process_id', 'text'], ['service', 'text NOT NULL'], ['level', 'text NOT NULL'], ['message', 'text NOT NULL'], ['object_references', 'jsonb NOT NULL DEFAULT \'[]\'::jsonb'], ['trace_id', 'text'], ['span_id', 'text'], ['structured_fields', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'], ['full_payload', 'jsonb'], ['exception', 'text'], ['stack', 'text'], ['occurred_at', 'timestamptz NOT NULL'], ['retention_partition', 'text NOT NULL']
  ]],
  ['generation_source', [
    ['job_id', 'uuid NOT NULL'], ['source_kind', 'text NOT NULL CHECK (source_kind IN (\'TEXT\',\'FILE\',\'IMAGE\',\'URL\',\'API_DOC\',\'CREDENTIAL_REF\',\'OBJECT_REF\'))'], ['original_name', 'text'], ['locator', 'text'], ['mime_type', 'text'], ['content_reference', 'text'], ['storage_reference', 'text'], ['content_digest', 'bytea NOT NULL'], ['status', 'text NOT NULL'], ['parser_version', 'text'], ['normalized_text_reference', 'text'], ['sensitivity', 'text NOT NULL'], ['retention_policy', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'], ['parsed_at', 'timestamptz'], ['verified_at', 'timestamptz'], ['superseded_at', 'timestamptz']
  ]],
  ['generation_fact', [
    ['job_id', 'uuid NOT NULL'], ['source_id', 'uuid NOT NULL'], ['fact_key', 'text NOT NULL'], ['classification', 'text NOT NULL'], ['statement', 'text NOT NULL'], ['canonical_value', 'jsonb NOT NULL'], ['source_locator', 'text'], ['verification_method', 'text NOT NULL'], ['confidence_classification', 'text NOT NULL'], ['observed_at', 'timestamptz NOT NULL'], ['superseded_at', 'timestamptz'], ['fact_digest', 'bytea NOT NULL']
  ]],
  ['generation_owner_decision', [
    ['job_id', 'uuid NOT NULL'], ['owner_message_id', 'uuid NOT NULL'], ['decision_key', 'text NOT NULL'], ['specification_paths', 'text[] NOT NULL DEFAULT \'{}\''], ['exact_text', 'text NOT NULL'], ['structured_value', 'jsonb'], ['decision_digest', 'bytea NOT NULL'], ['superseded_by_id', 'uuid']
  ]],
  ['generation_message', [
    ['job_id', 'uuid NOT NULL'], ['sequence', 'bigint NOT NULL'], ['role', 'text NOT NULL'], ['content', 'jsonb NOT NULL'], ['attachments', 'jsonb NOT NULL DEFAULT \'[]\'::jsonb'], ['status', 'text NOT NULL'], ['client_message_id', 'text'], ['turn_id', 'uuid'], ['completed_at', 'timestamptz'], ['interrupted_at', 'timestamptz'], ['content_digest', 'bytea NOT NULL']
  ]],
  ['generation_turn', [
    ['job_id', 'uuid NOT NULL'], ['input_message_id', 'uuid NOT NULL'], ['turn_sequence', 'bigint NOT NULL'], ['status', 'text NOT NULL'], ['worker_lease_owner', 'uuid'], ['worker_fencing_token', 'bigint'], ['worker_lease_expires_at', 'timestamptz'], ['worker_heartbeat_at', 'timestamptz'], ['active_model_call_id', 'uuid'], ['provider_response_id', 'text'], ['successor_turn_id', 'uuid'], ['successor_slot', 'text'], ['interruption_version', 'bigint NOT NULL DEFAULT 0'], ['cancellation_version', 'bigint NOT NULL DEFAULT 0'], ['interruption_intent', 'text'], ['interruption_reason', 'text'], ['latest_checkpoint_id', 'uuid'], ['pending_side_effects', 'jsonb NOT NULL DEFAULT \'[]\'::jsonb'], ['error', 'jsonb'], ['terminal_outcome_digest', 'bytea'], ['started_at', 'timestamptz'], ['completed_at', 'timestamptz']
  ]],
  ['generation_spec_revision', [
    ['job_id', 'uuid NOT NULL'], ['revision_number', 'bigint NOT NULL'], ['schema_version', 'text NOT NULL'], ['canonical_json', 'jsonb NOT NULL'], ['rendered_markdown', 'text NOT NULL'], ['spec_digest', 'bytea NOT NULL'], ['parent_revision_id', 'uuid'], ['capability_snapshot_id', 'uuid'], ['capability_digest', 'bytea'], ['conformance_precheck_state', 'text NOT NULL'], ['conformance_report', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb']
  ]],
  ['generation_execution_authority', [
    ['job_id', 'uuid NOT NULL'], ['authority_kind', 'text NOT NULL CHECK (authority_kind IN (\'OWNER_APPROVED\',\'INHERITED_TECHNICAL\'))'], ['source_job_id', 'uuid'], ['source_spec_id', 'uuid'], ['source_revision_id', 'uuid'], ['source_digest', 'bytea NOT NULL'], ['owner_approval_event_id', 'uuid'], ['target_identities_snapshot', 'jsonb NOT NULL'], ['lineage_digest', 'bytea NOT NULL'], ['frozen_at', 'timestamptz NOT NULL']
  ]],
  ['generation_capability_snapshot', [
    ['job_id', 'uuid NOT NULL'], ['specification_revision_id', 'uuid NOT NULL'], ['requirement_digest', 'bytea NOT NULL'], ['catalog_epoch', 'bigint NOT NULL'], ['snapshot_payload', 'jsonb NOT NULL'], ['snapshot_digest', 'bytea NOT NULL'], ['stale_at', 'timestamptz']
  ]],
  ['generation_capability_match', [
    ['snapshot_id', 'uuid NOT NULL'], ['requirement_id', 'text NOT NULL'], ['matched_object_kind', 'text'], ['matched_object_id', 'uuid'], ['component_id', 'uuid'], ['revision_id', 'uuid'], ['contract_digest', 'bytea'], ['behavior_coverage', 'jsonb NOT NULL'], ['schema_compatibility', 'jsonb NOT NULL'], ['runtime_eligibility', 'boolean NOT NULL'], ['binding_eligibility', 'boolean NOT NULL'], ['decision', 'text NOT NULL CHECK (decision IN (\'FULL_REUSE\',\'PARTIAL_REUSE\',\'NEW_CAPABILITY_REQUIRED\'))'], ['evidence', 'jsonb NOT NULL'], ['score', 'double precision NOT NULL']
  ]],
  ['generation_plan', [
    ['job_id', 'uuid NOT NULL'], ['authority_id', 'uuid NOT NULL'], ['specification_id', 'uuid NOT NULL'], ['schema_version', 'text NOT NULL'], ['canonical_dag', 'jsonb NOT NULL'], ['plan_digest', 'bytea NOT NULL'], ['validation_state', 'text NOT NULL'], ['validation_report', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb']
  ]],
  ['generation_plan_node', [
    ['plan_id', 'uuid NOT NULL'], ['node_key', 'text NOT NULL'], ['node_kind', 'text NOT NULL'], ['purpose', 'text NOT NULL'], ['requirement_ids', 'text[] NOT NULL DEFAULT \'{}\''], ['input_artifacts', 'jsonb NOT NULL DEFAULT \'[]\'::jsonb'], ['output_schema', 'jsonb NOT NULL'], ['output_digest', 'bytea'], ['execution_role', 'text NOT NULL'], ['side_effect_policy', 'text NOT NULL'], ['retry_policy', 'text NOT NULL'], ['idempotency_policy', 'text NOT NULL'], ['timeout_ms', 'integer NOT NULL'], ['budget', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'], ['checkpoint_policy', 'jsonb NOT NULL'], ['compensation_policy', 'jsonb NOT NULL'], ['state', 'text NOT NULL'], ['result_artifact_id', 'uuid']
  ]],
  ['generation_plan_edge', [
    ['plan_id', 'uuid NOT NULL'], ['source_node_id', 'uuid NOT NULL'], ['target_node_id', 'uuid NOT NULL'], ['edge_kind', 'text NOT NULL CHECK (edge_kind IN (\'DATA\',\'CONTROL\',\'ACTIVATION\',\'COMPENSATION\'))'], ['required_artifact', 'jsonb'], ['required_schema', 'jsonb'], ['edge_digest', 'bytea NOT NULL']
  ]],
  ['generation_phase_run', [
    ['job_id', 'uuid NOT NULL'], ['phase', 'text NOT NULL'], ['attempt', 'bigint NOT NULL'], ['state', 'text NOT NULL'], ['worker_pool', 'text NOT NULL'], ['lease_owner', 'uuid'], ['lease_fencing_token', 'bigint'], ['lease_expires_at', 'timestamptz'], ['heartbeat_at', 'timestamptz'], ['plan_node_range', 'jsonb NOT NULL'], ['input_checkpoint_id', 'uuid'], ['output_checkpoint_id', 'uuid'], ['cancellation_version', 'bigint NOT NULL DEFAULT 0'], ['pending_side_effects', 'jsonb NOT NULL DEFAULT \'[]\'::jsonb'], ['started_at', 'timestamptz'], ['completed_at', 'timestamptz'], ['result_summary', 'jsonb'], ['result_digest', 'bytea'], ['blocker_id', 'uuid'], ['error', 'jsonb'], ['manual_review_id', 'uuid']
  ]],
  ['generation_tool_event', [
    ['job_id', 'uuid NOT NULL'], ['turn_id', 'uuid'], ['phase_run_id', 'uuid'], ['model_call_id', 'uuid'], ['tool_key', 'text NOT NULL'], ['provider_call_id', 'text'], ['state', 'text NOT NULL CHECK (state IN (\'STARTED\',\'PROGRESS\',\'COMPLETED\',\'FAILED\',\'CANCELLED\'))'], ['canonical_arguments', 'jsonb NOT NULL'], ['arguments_digest', 'bytea NOT NULL'], ['canonical_result', 'jsonb'], ['result_digest', 'bytea'], ['domain_operation', 'text'], ['side_effect_classification', 'text NOT NULL'], ['audit_event_id', 'uuid'], ['started_at', 'timestamptz NOT NULL'], ['completed_at', 'timestamptz']
  ]],
  ['generation_workspace_revision', [
    ['job_id', 'uuid NOT NULL'], ['revision_number', 'bigint NOT NULL'], ['parent_revision_id', 'uuid'], ['source_tree_digest', 'bytea NOT NULL'], ['artifact_manifest_draft_digest', 'bytea'], ['created_by_model_call_id', 'uuid'], ['created_by_worker_id', 'uuid']
  ]],
  ['generation_workspace_file', [
    ['workspace_revision_id', 'uuid NOT NULL'], ['relative_path', 'text NOT NULL'], ['mime_type', 'text'], ['file_type', 'text NOT NULL'], ['executable', 'boolean NOT NULL DEFAULT false'], ['content_storage', 'text NOT NULL'], ['content_reference', 'text NOT NULL'], ['size_bytes', 'bigint NOT NULL CHECK (size_bytes >= 0)'], ['content_digest', 'bytea NOT NULL'], ['source_classification', 'text NOT NULL']
  ]],
  ['generation_workspace_patch', [
    ['job_id', 'uuid NOT NULL'], ['phase_run_id', 'uuid NOT NULL'], ['model_call_id', 'uuid'], ['base_workspace_revision_id', 'uuid NOT NULL'], ['base_digest', 'bytea NOT NULL'], ['operations', 'jsonb NOT NULL'], ['operations_digest', 'bytea NOT NULL'], ['apply_state', 'text NOT NULL'], ['conflict', 'jsonb'], ['error', 'jsonb'], ['result_workspace_revision_id', 'uuid'], ['applied_at', 'timestamptz']
  ]],
  ['generation_artifact_manifest', [
    ['job_id', 'uuid NOT NULL'], ['workspace_revision_id', 'uuid NOT NULL'], ['candidate_release_id', 'uuid'], ['specification_digest', 'bytea NOT NULL'], ['authority_digest', 'bytea NOT NULL'], ['plan_digest', 'bytea NOT NULL'], ['manifest', 'jsonb NOT NULL'], ['manifest_digest', 'bytea NOT NULL'], ['completeness_state', 'text NOT NULL']
  ]],
  ['generation_contract_candidate', [
    ['job_id', 'uuid NOT NULL'], ['target_graph_node_id', 'uuid'], ['candidate_kind', 'text NOT NULL CHECK (candidate_kind IN (\'COMPONENT\',\'MCP_SERVER\',\'MCP_TOOL\',\'MCP_RESOURCE\',\'MCP_PROMPT\',\'AI_AGENT\',\'AUTOMATION\'))'], ['proposed_identity', 'jsonb NOT NULL'], ['revision_payload', 'jsonb NOT NULL'], ['revision_digest', 'bytea NOT NULL'], ['specification_paths', 'text[] NOT NULL DEFAULT \'{}\''], ['validation_state', 'text NOT NULL'], ['verification_state', 'text NOT NULL'], ['integration_state', 'text NOT NULL DEFAULT \'PENDING\''], ['integration_evidence', 'jsonb'], ['published_object_id', 'uuid'], ['published_revision_id', 'uuid']
  ]],
  ['generation_validation_run', [
    ['job_id', 'uuid NOT NULL'], ['phase_run_id', 'uuid'], ['workspace_revision_id', 'uuid'], ['candidate_id', 'uuid'], ['activation_set_id', 'uuid'], ['gate_catalog_version', 'text NOT NULL'], ['state', 'text NOT NULL'], ['started_at', 'timestamptz NOT NULL'], ['completed_at', 'timestamptz'], ['blocking_summary', 'jsonb'], ['evidence_digest', 'bytea']
  ]],
  ['generation_validation_result', [
    ['validation_run_id', 'uuid NOT NULL'], ['gate_key', 'text NOT NULL'], ['evaluator_version', 'text NOT NULL'], ['status', 'text NOT NULL CHECK (status IN (\'PASS\',\'FAIL\',\'NOT_APPLICABLE\'))'], ['inputs', 'jsonb NOT NULL'], ['expected', 'jsonb NOT NULL'], ['actual', 'jsonb'], ['diagnostics', 'jsonb NOT NULL DEFAULT \'[]\'::jsonb'], ['artifacts', 'jsonb NOT NULL DEFAULT \'[]\'::jsonb'], ['logs', 'jsonb NOT NULL DEFAULT \'[]\'::jsonb'], ['duration_ms', 'bigint NOT NULL'], ['result_digest', 'bytea NOT NULL']
  ]],
  ['generation_repair_iteration', [
    ['job_id', 'uuid NOT NULL'], ['phase', 'text NOT NULL'], ['iteration_number', 'bigint NOT NULL'], ['diagnostics_cluster', 'jsonb NOT NULL'], ['diagnostics_digest', 'bytea NOT NULL'], ['input_workspace_revision_id', 'uuid NOT NULL'], ['model_call_id', 'uuid'], ['patch_id', 'uuid'], ['output_workspace_revision_id', 'uuid'], ['progress_signature', 'bytea NOT NULL'], ['result', 'jsonb NOT NULL'], ['duration_ms', 'bigint NOT NULL']
  ]],
  ['generation_blocker', [
    ['job_id', 'uuid NOT NULL'], ['phase', 'text NOT NULL'], ['plan_node_id', 'uuid'], ['blocker_code', 'text NOT NULL'], ['classification', 'text NOT NULL'], ['title', 'text NOT NULL'], ['detail', 'text NOT NULL'], ['requirement_ids', 'text[] NOT NULL DEFAULT \'{}\''], ['evidence', 'jsonb NOT NULL'], ['required_resolution', 'text NOT NULL'], ['input_schema', 'jsonb'], ['resume_phase', 'text'], ['resume_checkpoint_id', 'uuid'], ['state', 'text NOT NULL'], ['resolved_at', 'timestamptz'], ['resolver', 'text']
  ]],
  ['generation_activation_member', [
    ['activation_set_id', 'uuid NOT NULL'], ['object_kind', 'text NOT NULL'], ['object_id', 'uuid NOT NULL'], ['previous_revision_id', 'uuid'], ['previous_release_id', 'uuid'], ['previous_binding_set_revision_id', 'uuid'], ['candidate_revision_id', 'uuid'], ['candidate_release_id', 'uuid'], ['candidate_binding_set_revision_id', 'uuid'], ['activation_order_key', 'text NOT NULL'], ['state', 'text NOT NULL'], ['evidence', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb']
  ]],
  ['generation_event', [
    ['job_id', 'uuid NOT NULL'], ['sequence', 'bigint NOT NULL'], ['event_type', 'text NOT NULL'], ['emitted_at', 'timestamptz NOT NULL'], ['persisted_at', 'timestamptz NOT NULL'], ['payload', 'jsonb NOT NULL'], ['payload_digest', 'bytea NOT NULL'], ['message_id', 'uuid'], ['turn_id', 'uuid'], ['phase_run_id', 'uuid'], ['model_call_id', 'uuid'], ['specification_id', 'uuid'], ['plan_id', 'uuid'], ['workspace_revision_id', 'uuid'], ['candidate_id', 'uuid'], ['activation_set_id', 'uuid'], ['causation_id', 'uuid'], ['trace_id', 'text']
  ]],
  ['agent_session_compaction', [
    ['session_id', 'uuid NOT NULL'], ['source_session_version', 'bigint NOT NULL CHECK (source_session_version > 0)'], ['source_first_item_sequence', 'bigint NOT NULL CHECK (source_first_item_sequence > 0)'], ['source_last_item_sequence', 'bigint NOT NULL'],
    ['source_aggregate_digest', 'bytea NOT NULL'], ['mode', "text NOT NULL CHECK (mode IN ('INPUT','PREVIOUS_RESPONSE_ID'))"], ['model_id', 'text NOT NULL'],
    ['capability_snapshot_id', 'uuid'], ['sdk_version', 'text NOT NULL'], ['adapter_version', 'text NOT NULL'], ['request_descriptor_id', 'uuid'], ['provider_handle', 'jsonb'],
    ['compacted_items', 'jsonb NOT NULL'], ['compacted_items_digest', 'bytea NOT NULL'], ['validation_evidence', 'jsonb NOT NULL'], ['equivalence_evidence', 'jsonb NOT NULL'],
    ['state', "text NOT NULL CHECK (state IN ('CANDIDATE','VALIDATED','ACTIVE','REJECTED','SUPERSEDED'))"], ['active_pointer_relation', 'jsonb'], ['activated_at', 'timestamptz'], ['completed_at', 'timestamptz']
  ]],
  ['agent_definition', [
    ['component_id', 'uuid'], ['runtime_identity_kind', 'text NOT NULL'], ['purpose', 'text NOT NULL'], ['status', "text NOT NULL CHECK (status IN ('DRAFT','ACTIVE','SUSPENDED','RETIRED'))"],
    ['mode', "text NOT NULL CHECK (mode IN ('INTERACTIVE','TRIGGERED','EVALUATION','REPAIR'))"], ['active_revision_id', 'uuid'], ['enabled', 'boolean NOT NULL DEFAULT false'], ['retired_at', 'timestamptz']
  ]],
  ['agent_revision', [
    ['agent_definition_id', 'uuid NOT NULL REFERENCES kcml.agent_definition(id)'], ['revision_number', 'bigint NOT NULL CHECK (revision_number > 0)'], ['schema_version', 'text NOT NULL'],
    ['purpose', 'text NOT NULL'], ['success_definition', 'jsonb NOT NULL'], ['canonical_instructions', 'text NOT NULL'], ['variable_schema', 'jsonb NOT NULL'],
    ['openai_model', 'text NOT NULL'], ['model_settings', 'jsonb NOT NULL'], ['input_schema', 'jsonb NOT NULL'], ['output_schema', 'jsonb NOT NULL'],
    ['run_policy', 'jsonb NOT NULL'], ['trigger_policy', 'jsonb NOT NULL'], ['session_policy', 'jsonb NOT NULL'], ['memory_policy', 'jsonb NOT NULL'], ['budget_policy', 'jsonb NOT NULL'], ['concurrency_policy', 'jsonb NOT NULL'],
    ['monitoring_profile', 'jsonb NOT NULL'], ['evaluation_profile', 'jsonb NOT NULL'], ['secret_references', "jsonb NOT NULL DEFAULT '[]'::jsonb"], ['specification_lineage', 'jsonb NOT NULL'],
    ['canonical_payload', 'jsonb NOT NULL'], ['payload_digest', 'bytea NOT NULL'], ['validation_state', 'text NOT NULL'], ['validation_evidence', 'jsonb NOT NULL'], ['verification_state', 'text NOT NULL'], ['verification_evidence', 'jsonb NOT NULL']
  ]],
  ['agent_tool_binding', [
    ['agent_revision_id', 'uuid NOT NULL REFERENCES kcml.agent_revision(id)'], ['source_kind', 'text NOT NULL'], ['source_object_id', 'uuid NOT NULL'], ['source_revision_id', 'uuid NOT NULL'],
    ['source_contract_digest', 'bytea NOT NULL'], ['model_alias', 'text NOT NULL'], ['exposure_filter', 'jsonb NOT NULL'], ['operation_scope', 'jsonb NOT NULL'], ['contract_binding_id', 'uuid'],
    ['input_schema_digest', 'bytea NOT NULL'], ['output_schema_digest', 'bytea NOT NULL'], ['side_effect_policy', 'text NOT NULL'], ['retry_policy', 'text NOT NULL'], ['timeout_ms', 'bigint NOT NULL CHECK (timeout_ms > 0)'],
    ['approval_policy', 'jsonb NOT NULL'], ['result_policy', 'jsonb NOT NULL'], ['compatibility_state', 'text NOT NULL'], ['binding_digest', 'bytea NOT NULL']
  ]],
  ['agent_handoff_binding', [
    ['source_agent_revision_id', 'uuid NOT NULL REFERENCES kcml.agent_revision(id)'], ['target_agent_revision_id', 'uuid NOT NULL REFERENCES kcml.agent_revision(id)'],
    ['orchestration_pattern', "text NOT NULL CHECK (orchestration_pattern IN ('HANDOFF','AGENT_AS_TOOL'))"], ['purpose', 'text NOT NULL'], ['input_schema', 'jsonb NOT NULL'], ['output_schema', 'jsonb NOT NULL'],
    ['context_projection', 'jsonb NOT NULL'], ['allowed_tools', "text[] NOT NULL DEFAULT '{}'"], ['budget', 'jsonb NOT NULL'], ['max_depth', 'integer NOT NULL CHECK (max_depth > 0)'],
    ['cancellation_policy', 'jsonb NOT NULL'], ['approval_policy', 'jsonb NOT NULL'], ['binding_digest', 'bytea NOT NULL']
  ]],
  ['agent_guardrail', [
    ['agent_revision_id', 'uuid NOT NULL REFERENCES kcml.agent_revision(id)'], ['kind', "text NOT NULL CHECK (kind IN ('INPUT','OUTPUT','TOOL_INPUT','TOOL_OUTPUT','KCIP_PRE','KCIP_POST'))"],
    ['guardrail_key', 'text NOT NULL'], ['rule_schema', 'jsonb'], ['rule', 'jsonb'], ['evaluator_reference', 'jsonb'], ['failure_action', 'text NOT NULL'], ['priority', 'integer NOT NULL'], ['guardrail_digest', 'bytea NOT NULL']
  ]],
  ['agent_session', [
    ['agent_definition_id', 'uuid NOT NULL REFERENCES kcml.agent_definition(id)'], ['agent_revision_id', 'uuid NOT NULL REFERENCES kcml.agent_revision(id)'], ['session_key', 'text NOT NULL'],
    ['caller_scope', 'jsonb NOT NULL'], ['strategy', 'text NOT NULL'], ['provider_conversation_id', 'text'], ['previous_response_id', 'text'], ['current_item_sequence', 'bigint NOT NULL DEFAULT 0 CHECK (current_item_sequence >= 0)'],
    ['state', "text NOT NULL CHECK (state IN ('OPEN','COMPACTING','CLOSING','CLOSED','EXPIRED'))"], ['lock_version', 'bigint NOT NULL DEFAULT 1 CHECK (lock_version > 0)'],
    ['last_activity_at', 'timestamptz NOT NULL'], ['expires_at', 'timestamptz'], ['closed_at', 'timestamptz'], ['active_compaction_id', 'uuid']
  ]],
  ['agent_session_item', [
    ['session_id', 'uuid NOT NULL REFERENCES kcml.agent_session(id)'], ['sequence', 'bigint NOT NULL CHECK (sequence > 0)'], ['item_kind', 'text NOT NULL'], ['role', 'text'],
    ['payload', 'jsonb NOT NULL'], ['payload_digest', 'bytea NOT NULL'], ['source_run_id', 'uuid'], ['source_model_call_id', 'uuid'], ['source_tool_call_id', 'uuid'], ['source_handoff_run_id', 'uuid']
  ]],
  ['agent_run_checkpoint', [
    ['agent_run_id', 'uuid NOT NULL REFERENCES kcml.agent_run(id)'], ['sequence', 'bigint NOT NULL CHECK (sequence > 0)'], ['run_state', 'text NOT NULL'], ['completed_item_sequence', 'bigint NOT NULL CHECK (completed_item_sequence >= 0)'],
    ['session_cursor', 'text'], ['pending_model_calls', "jsonb NOT NULL DEFAULT '[]'::jsonb"], ['pending_tool_calls', "jsonb NOT NULL DEFAULT '[]'::jsonb"], ['pending_handoffs', "jsonb NOT NULL DEFAULT '[]'::jsonb"], ['pending_approvals', "jsonb NOT NULL DEFAULT '[]'::jsonb"],
    ['budget_snapshot', 'jsonb NOT NULL'], ['usage_snapshot', 'jsonb NOT NULL'], ['sdk_run_state_checkpoint_id', 'uuid'], ['lease_fencing_token', 'bigint NOT NULL'], ['payload_digest', 'bytea NOT NULL']
  ]],
  ['agent_message', [
    ['agent_run_id', 'uuid NOT NULL REFERENCES kcml.agent_run(id)'], ['sequence', 'bigint NOT NULL CHECK (sequence > 0)'], ['role', 'text NOT NULL'], ['item_type', 'text NOT NULL'],
    ['content', 'text'], ['payload', 'jsonb NOT NULL'], ['payload_digest', 'bytea NOT NULL'], ['model_call_id', 'uuid'], ['tool_call_id', 'uuid'], ['handoff_run_id', 'uuid'],
    ['status', "text NOT NULL CHECK (status IN ('PENDING','COMPLETED','FAILED','CANCELLED'))"], ['completed_at', 'timestamptz']
  ]],
  ['agent_tool_call', [
    ['agent_run_id', 'uuid NOT NULL REFERENCES kcml.agent_run(id)'], ['model_call_id', 'uuid NOT NULL'], ['tool_binding_id', 'uuid NOT NULL REFERENCES kcml.agent_tool_binding(id)'], ['target', 'jsonb NOT NULL'],
    ['provider_call_id', 'text NOT NULL'], ['canonical_arguments', 'jsonb NOT NULL'], ['arguments_digest', 'bytea NOT NULL'], ['canonical_result', 'jsonb'], ['result_digest', 'bytea'],
    ['status', "text NOT NULL CHECK (status IN ('RESERVED','WAITING_FOR_APPROVAL','EXECUTING','RECONCILING','SUCCEEDED','FAILED','CANCELLED','MANUAL_REVIEW'))"],
    ['approval_request_id', 'uuid'], ['idempotency_relation', 'jsonb'], ['trace_id', 'text'], ['started_at', 'timestamptz'], ['completed_at', 'timestamptz'], ['error', 'jsonb']
  ]],
  ['agent_handoff_run', [
    ['root_agent_run_id', 'uuid NOT NULL REFERENCES kcml.agent_run(id)'], ['source_agent_revision_id', 'uuid NOT NULL REFERENCES kcml.agent_revision(id)'], ['target_agent_revision_id', 'uuid NOT NULL REFERENCES kcml.agent_revision(id)'],
    ['handoff_binding_id', 'uuid NOT NULL REFERENCES kcml.agent_handoff_binding(id)'], ['depth', 'integer NOT NULL CHECK (depth > 0)'], ['parent_handoff_run_id', 'uuid REFERENCES kcml.agent_handoff_run(id)'],
    ['input', 'jsonb NOT NULL'], ['input_digest', 'bytea NOT NULL'], ['output', 'jsonb'], ['output_digest', 'bytea'], ['status', "text NOT NULL CHECK (status IN ('RESERVED','RUNNING','WAITING_FOR_APPROVAL','SUCCEEDED','FAILED','CANCELLED','MANUAL_REVIEW'))"],
    ['budget', 'jsonb NOT NULL'], ['started_at', 'timestamptz'], ['completed_at', 'timestamptz'], ['error', 'jsonb']
  ]],
  ['agent_approval_request', [
    ['root_agent_run_id', 'uuid NOT NULL REFERENCES kcml.agent_run(id)'], ['tool_call_id', 'uuid REFERENCES kcml.agent_tool_call(id)'], ['handoff_run_id', 'uuid REFERENCES kcml.agent_handoff_run(id)'],
    ['target', 'jsonb NOT NULL'], ['arguments', 'jsonb NOT NULL'], ['arguments_digest', 'bytea NOT NULL'], ['consequence_summary', 'text NOT NULL'], ['policy_source', 'jsonb NOT NULL'],
    ['status', "text NOT NULL CHECK (status IN ('PENDING','APPROVED','REJECTED','EXPIRED','CANCELLED'))"], ['expires_at', 'timestamptz NOT NULL'], ['owner_decision', 'jsonb'], ['owner_message_id', 'uuid'],
    ['audit_event_id', 'uuid'], ['checkpoint_id', 'uuid'], ['decided_at', 'timestamptz']
  ]],
  ['agent_memory_namespace', [
    ['agent_definition_id', 'uuid NOT NULL REFERENCES kcml.agent_definition(id)'], ['memory_type', 'text NOT NULL'], ['content_schema', 'jsonb NOT NULL'], ['retention_policy', 'jsonb NOT NULL'],
    ['indexing_policy', 'jsonb NOT NULL'], ['access_policy', 'jsonb NOT NULL'], ['quota', 'jsonb NOT NULL'], ['namespace_digest', 'bytea NOT NULL']
  ]],
  ['agent_memory_item', [
    ['namespace_id', 'uuid NOT NULL REFERENCES kcml.agent_memory_namespace(id)'], ['memory_key', 'text NOT NULL'], ['content', 'jsonb NOT NULL'], ['vector_reference', 'jsonb'], ['metadata', 'jsonb NOT NULL'],
    ['source_agent_run_id', 'uuid REFERENCES kcml.agent_run(id)'], ['content_digest', 'bytea NOT NULL'], ['superseded_by_id', 'uuid REFERENCES kcml.agent_memory_item(id)'], ['superseded_at', 'timestamptz']
  ]],
  ['agent_trigger', [
    ['agent_revision_id', 'uuid NOT NULL REFERENCES kcml.agent_revision(id)'], ['trigger_kind', "text NOT NULL CHECK (trigger_kind IN ('EVENT','SCHEDULE','API','MANUAL'))"], ['configuration', 'jsonb NOT NULL'],
    ['input_mapping', 'jsonb NOT NULL'], ['idempotency_policy', 'jsonb NOT NULL'], ['concurrency_policy', 'jsonb NOT NULL'], ['enabled', 'boolean NOT NULL DEFAULT false'], ['trigger_digest', 'bytea NOT NULL']
  ]],
  ['agent_eval_suite', [
    ['agent_revision_id', 'uuid NOT NULL REFERENCES kcml.agent_revision(id)'], ['suite_version', 'text NOT NULL'], ['promotion_policy', 'jsonb NOT NULL'], ['blocking_thresholds', 'jsonb NOT NULL'],
    ['aggregate_thresholds', 'jsonb NOT NULL'], ['canonical_payload', 'jsonb NOT NULL'], ['suite_digest', 'bytea NOT NULL']
  ]],
  ['agent_eval_case', [
    ['eval_suite_id', 'uuid NOT NULL REFERENCES kcml.agent_eval_suite(id)'], ['case_key', 'text NOT NULL'], ['input', 'jsonb NOT NULL'], ['fixtures', 'jsonb NOT NULL'], ['expected_schemas', 'jsonb NOT NULL'],
    ['expected_invariants', 'jsonb NOT NULL'], ['grader', 'jsonb NOT NULL'], ['threshold', 'numeric NOT NULL'], ['side_effect_contract', 'jsonb NOT NULL'], ['cleanup_contract', 'jsonb NOT NULL'], ['blocking', 'boolean NOT NULL'], ['case_digest', 'bytea NOT NULL']
  ]],
  ['agent_eval_run', [
    ['eval_suite_id', 'uuid NOT NULL REFERENCES kcml.agent_eval_suite(id)'], ['agent_revision_id', 'uuid NOT NULL REFERENCES kcml.agent_revision(id)'], ['model_snapshot', 'jsonb NOT NULL'], ['tool_snapshot', 'jsonb NOT NULL'],
    ['state', "text NOT NULL CHECK (state IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED','MANUAL_REVIEW'))"], ['environment', 'jsonb NOT NULL'], ['seed', 'bigint NOT NULL'], ['fixture_namespace', 'text NOT NULL'],
    ['summary_metrics', 'jsonb'], ['started_at', 'timestamptz'], ['completed_at', 'timestamptz'], ['evidence_digest', 'bytea']
  ]],
  ['agent_eval_case_result', [
    ['eval_run_id', 'uuid NOT NULL REFERENCES kcml.agent_eval_run(id)'], ['eval_case_id', 'uuid NOT NULL REFERENCES kcml.agent_eval_case(id)'], ['agent_run_id', 'uuid REFERENCES kcml.agent_run(id)'],
    ['status', "text NOT NULL CHECK (status IN ('PASS','FAIL','NOT_EXECUTED_ENVIRONMENTAL','ERROR'))"], ['expected', 'jsonb NOT NULL'], ['actual', 'jsonb'], ['grader_outputs', 'jsonb NOT NULL'],
    ['usage', 'jsonb'], ['latency_ms', 'bigint'], ['cost_microunits', 'bigint'], ['evidence', 'jsonb NOT NULL'], ['cleanup_result', 'jsonb NOT NULL']
  ]],
  ['system_chat_conversation', [
    ['title', 'text NOT NULL'], ['owner_actor_id', 'text NOT NULL DEFAULT \'KRMAR78\' CHECK (owner_actor_id = \'KRMAR78\')'], ['access_channel', "text NOT NULL CHECK (access_channel IN ('SESSION','API_KEY'))"],
    ['status', "text NOT NULL CHECK (status IN ('OPEN','PROCESSING','WAITING_FOR_OWNER','CLOSED','FAILED'))"], ['selected_model', 'text NOT NULL'], ['agent_definition_id', 'uuid'], ['agent_session_id', 'uuid'],
    ['last_activity_at', 'timestamptz NOT NULL'], ['current_object_context', 'jsonb NOT NULL'], ['generation_job_id', 'uuid'], ['active_browser_session_id', 'uuid']
  ]],
  ['system_chat_message', [
    ['conversation_id', 'uuid NOT NULL REFERENCES kcml.system_chat_conversation(id)'], ['sequence', 'bigint NOT NULL CHECK (sequence > 0)'], ['role', "text NOT NULL CHECK (role IN ('OWNER','ASSISTANT','SYSTEM','TOOL'))"],
    ['content', 'text NOT NULL'], ['attachments', "jsonb NOT NULL DEFAULT '[]'::jsonb"], ['model_call_id', 'uuid'], ['status', "text NOT NULL CHECK (status IN ('PENDING','STREAMING','COMPLETED','FAILED','CANCELLED'))"],
    ['usage', 'jsonb'], ['completed_at', 'timestamptz'], ['causation_id', 'uuid'], ['related_object_ids', "uuid[] NOT NULL DEFAULT '{}'"], ['browser_target_reference_ids', "uuid[] NOT NULL DEFAULT '{}'" ]
  ]],
  ['system_chat_action', [
    ['message_id', 'uuid NOT NULL REFERENCES kcml.system_chat_message(id)'], ['operation_key', 'text NOT NULL'], ['target', 'jsonb NOT NULL'], ['arguments', 'jsonb NOT NULL'], ['arguments_digest', 'bytea NOT NULL'],
    ['result', 'jsonb'], ['result_digest', 'bytea'], ['status', "text NOT NULL CHECK (status IN ('PROPOSED','RESERVED','EXECUTING','SUCCEEDED','FAILED','CANCELLED','MANUAL_REVIEW'))"],
    ['idempotency_relation', 'jsonb'], ['audit_event_id', 'uuid'], ['started_at', 'timestamptz'], ['completed_at', 'timestamptz']
  ]],
  ['browser_runtime_build_manifest', [
    ['application_release_id', 'text NOT NULL'], ['source_commit', "text NOT NULL CHECK (source_commit ~ '^[0-9a-f]{40}$')"], ['node_version', 'text NOT NULL'], ['playwright_version', 'text NOT NULL'],
    ['locator_compiler_version', 'text NOT NULL'], ['preview_adapter_version', 'text NOT NULL'], ['automation_interpreter_version', 'text NOT NULL'], ['state_serializer_version', 'text NOT NULL'],
    ['browser_engine', 'text NOT NULL'], ['browser_channel', 'text NOT NULL'], ['browser_revision', 'text NOT NULL'], ['executable_digest', 'bytea NOT NULL'], ['dependency_digest', 'bytea NOT NULL'],
    ['os_image', 'text NOT NULL'], ['os_release', 'text NOT NULL'], ['architecture', 'text NOT NULL'], ['runtime_libraries_digest', 'bytea NOT NULL'], ['fonts_digest', 'bytea NOT NULL'],
    ['locale_timezone_digest', 'bytea NOT NULL'], ['sandbox_profile_digest', 'bytea NOT NULL'], ['launch_mode', "text NOT NULL CHECK (launch_mode IN ('HEADLESS','HEADED'))"], ['launch_arguments', 'jsonb NOT NULL'], ['environment_allowlist_digest', 'bytea NOT NULL'],
    ['capability_map', 'jsonb NOT NULL'], ['state_bundle_compatibility', 'jsonb NOT NULL'], ['automation_compatibility', 'jsonb NOT NULL'], ['host_generation_compatibility', 'jsonb NOT NULL'],
    ['manifest_payload', 'jsonb NOT NULL'], ['manifest_digest', 'bytea NOT NULL'], ['validation_state', 'text NOT NULL'], ['verification_state', 'text NOT NULL'], ['evidence', 'jsonb NOT NULL']
  ]],
  ['browser_session_binding', [
    ['session_id', 'uuid NOT NULL REFERENCES kcml.browser_session(id)'], ['related_object_kind', 'text NOT NULL'], ['related_object_id', 'uuid NOT NULL'],
    ['relation', "text NOT NULL CHECK (relation IN ('OWNER','VIEWER','SOURCE','RESULT','AUDIT'))"], ['revoked_at', 'timestamptz']
  ]],
  ['browser_host_slot', [
    ['host_id', 'uuid NOT NULL'], ['slot_key', 'text NOT NULL'], ['runtime_build_manifest_id', 'uuid NOT NULL REFERENCES kcml.browser_runtime_build_manifest(id)'], ['process_identity_id', 'uuid'],
    ['host_generation', 'bigint NOT NULL CHECK (host_generation > 0)'], ['systemd_unit', 'text NOT NULL'], ['invocation_id', 'uuid NOT NULL'], ['boot_id', 'uuid NOT NULL'], ['pid', 'integer NOT NULL CHECK (pid > 0)'], ['process_start_ticks', 'bigint NOT NULL'], ['cgroup_path', 'text NOT NULL'],
    ['capacity', 'integer NOT NULL CHECK (capacity > 0)'], ['current_contexts', 'integer NOT NULL DEFAULT 0 CHECK (current_contexts >= 0)'], ['drain_state', 'text NOT NULL'], ['admission_state', 'text NOT NULL'],
    ['uds_endpoint', 'text NOT NULL'], ['uds_inode', 'bigint NOT NULL'], ['uds_fingerprint', 'bytea NOT NULL'], ['lease_owner', 'uuid'], ['lease_fencing_token', 'bigint'], ['lease_expires_at', 'timestamptz'], ['heartbeat_at', 'timestamptz'],
    ['previous_deployment_epoch', 'bigint'], ['last_crash_at', 'timestamptz'], ['last_restart_at', 'timestamptz'], ['last_error', 'jsonb'], ['cleanup_evidence', 'jsonb']
  ]],
  ['browser_context_instance', [
    ['session_id', 'uuid NOT NULL REFERENCES kcml.browser_session(id)'], ['context_key', 'text NOT NULL'], ['context_generation', 'bigint NOT NULL CHECK (context_generation > 0)'],
    ['host_slot_id', 'uuid REFERENCES kcml.browser_host_slot(id)'], ['bridge_id', 'uuid'], ['profile_id', 'text'], ['runtime_build_manifest_id', 'uuid NOT NULL REFERENCES kcml.browser_runtime_build_manifest(id)'],
    ['creation_mode', "text NOT NULL CHECK (creation_mode IN ('NON_PERSISTENT','BRIDGE_PROFILE','CDP_COMPATIBILITY'))"], ['locale_digest', 'bytea NOT NULL'], ['timezone_digest', 'bytea NOT NULL'], ['device_digest', 'bytea NOT NULL'], ['viewport_digest', 'bytea NOT NULL'],
    ['permission_profile_digest', 'bytea NOT NULL'], ['client_certificate_profile_digest', 'bytea'], ['account_binding_id', 'uuid'], ['account_auth_epoch', 'bigint'], ['restored_bundle_version_id', 'uuid'],
    ['attached_at', 'timestamptz'], ['detached_at', 'timestamptz'], ['closed_at', 'timestamptz'], ['context_lifecycle', 'text NOT NULL'], ['browser_process_identity', 'jsonb NOT NULL'], ['cleanup_state', 'text NOT NULL']
  ]],
  ['browser_page', [
    ['session_id', 'uuid NOT NULL REFERENCES kcml.browser_session(id)'], ['context_instance_id', 'uuid NOT NULL REFERENCES kcml.browser_context_instance(id)'], ['page_key', 'text NOT NULL'], ['page_generation', 'bigint NOT NULL CHECK (page_generation > 0)'],
    ['runtime_handle_fingerprint', 'bytea NOT NULL'], ['opener_page_id', 'uuid REFERENCES kcml.browser_page(id)'], ['opener_page_generation', 'bigint'], ['creation_action_id', 'uuid'], ['active_preview', 'boolean NOT NULL DEFAULT false'], ['closed', 'boolean NOT NULL DEFAULT false'],
    ['url', 'text NOT NULL'], ['origin', 'text'], ['title', 'text'], ['page_lifecycle', 'text NOT NULL'], ['current_document_id', 'uuid'], ['current_document_epoch', 'bigint NOT NULL DEFAULT 0'], ['top_frame_id', 'uuid'], ['navigation_sequence', 'bigint NOT NULL DEFAULT 0'],
    ['last_navigation_digest', 'bytea'], ['last_result_digest', 'bytea'], ['closed_at', 'timestamptz'], ['close_reason', 'text']
  ]],
  ['browser_frame', [
    ['page_id', 'uuid NOT NULL REFERENCES kcml.browser_page(id)'], ['page_generation', 'bigint NOT NULL'], ['frame_key', 'text NOT NULL'], ['attachment_epoch', 'bigint NOT NULL CHECK (attachment_epoch > 0)'], ['runtime_handle_fingerprint', 'bytea NOT NULL'],
    ['parent_frame_id', 'uuid REFERENCES kcml.browser_frame(id)'], ['parent_attachment_epoch', 'bigint'], ['origin', 'text'], ['url', 'text NOT NULL'], ['frame_name', 'text'], ['sandbox_attributes', 'jsonb NOT NULL'], ['permission_attributes', 'jsonb NOT NULL'],
    ['attached', 'boolean NOT NULL DEFAULT true'], ['oopif_route', 'jsonb'], ['process_route', 'jsonb'], ['current_document_id', 'uuid'], ['current_document_epoch', 'bigint NOT NULL DEFAULT 0'], ['latest_semantic_digest', 'bytea'], ['latest_visual_digest', 'bytea'],
    ['attached_at', 'timestamptz NOT NULL'], ['detached_at', 'timestamptz'], ['detach_reason', 'text']
  ]],
  ['browser_document', [
    ['page_id', 'uuid NOT NULL REFERENCES kcml.browser_page(id)'], ['frame_id', 'uuid NOT NULL REFERENCES kcml.browser_frame(id)'], ['document_key', 'text NOT NULL'], ['document_epoch', 'bigint NOT NULL CHECK (document_epoch > 0)'],
    ['creation_reason', "text NOT NULL CHECK (creation_reason IN ('NAVIGATION','BF_CACHE_RESTORE','PRERENDER_ACTIVATION','RECOVERY','OOPIF_REPLACEMENT'))"], ['url', 'text NOT NULL'], ['origin', 'text'], ['navigation_id', 'uuid'], ['navigation_sequence', 'bigint NOT NULL'],
    ['document_lifecycle', 'text NOT NULL'], ['initial_observation_id', 'uuid'], ['last_observation_id', 'uuid'], ['dom_digest', 'bytea'], ['semantic_digest', 'bytea'], ['retired_at', 'timestamptz']
  ]],
  ['browser_navigation', [
    ['session_id', 'uuid NOT NULL REFERENCES kcml.browser_session(id)'], ['page_id', 'uuid NOT NULL REFERENCES kcml.browser_page(id)'], ['frame_id', 'uuid REFERENCES kcml.browser_frame(id)'], ['document_id', 'uuid'],
    ['navigation_key', 'uuid NOT NULL'], ['navigation_sequence', 'bigint NOT NULL CHECK (navigation_sequence > 0)'], ['causation_action_id', 'uuid'], ['causation_input_event_id', 'uuid'], ['requested_url', 'text NOT NULL'], ['requested_origin', 'text'], ['http_method', 'text NOT NULL'], ['redirect_chain_artifact_id', 'uuid'],
    ['navigation_type', "text NOT NULL CHECK (navigation_type IN ('FULL','SAME_DOCUMENT','BF_CACHE_RESTORE','PRERENDER_ACTIVATION','POPUP_INITIAL','FRAME'))"], ['state', "text NOT NULL CHECK (state IN ('REQUESTED','STARTED','COMMITTED','DOM_CONTENT_LOADED','LOAD_FIRED','ABORTED','FAILED'))"],
    ['previous_document_epoch', 'bigint'], ['new_document_epoch', 'bigint'], ['origin_policy_outcome', 'jsonb NOT NULL'], ['timings', 'jsonb NOT NULL'], ['error', 'jsonb'], ['evidence_digests', "bytea[] NOT NULL DEFAULT '{}'" ]
  ]],
  ['browser_preview_frame', [
    ['session_id', 'uuid NOT NULL REFERENCES kcml.browser_session(id)'], ['stream_epoch', 'bigint NOT NULL CHECK (stream_epoch > 0)'], ['frame_revision', 'bigint NOT NULL CHECK (frame_revision > 0)'], ['base_frame_id', 'uuid'], ['key_frame', 'boolean NOT NULL'],
    ['page_id', 'uuid NOT NULL'], ['page_generation', 'bigint NOT NULL'], ['frame_id', 'uuid NOT NULL'], ['document_id', 'uuid'], ['document_epoch', 'bigint NOT NULL'], ['observation_id', 'uuid'], ['observation_revision', 'bigint NOT NULL'],
    ['viewport_transform', 'jsonb NOT NULL'], ['viewport_transform_digest', 'bytea NOT NULL'], ['image_artifact_id', 'uuid'], ['patch_artifact_id', 'uuid'], ['mime_type', 'text NOT NULL'], ['width', 'integer NOT NULL CHECK (width > 0)'], ['height', 'integer NOT NULL CHECK (height > 0)'], ['size_bytes', 'bigint NOT NULL CHECK (size_bytes >= 0)'],
    ['retention_state', 'text NOT NULL'], ['cleanup_state', 'text NOT NULL']
  ]],
  ['browser_preview_ticket', [
    ['session_id', 'uuid NOT NULL REFERENCES kcml.browser_session(id)'], ['owner_session_id', 'uuid'], ['access_channel', "text NOT NULL CHECK (access_channel IN ('SESSION','API_KEY'))"], ['audience', 'text NOT NULL'], ['capability_set', 'jsonb NOT NULL'],
    ['token_fingerprint', 'bytea NOT NULL'], ['issued_at', 'timestamptz NOT NULL'], ['expires_at', 'timestamptz NOT NULL'], ['used_at', 'timestamptz'], ['revoked_at', 'timestamptz'], ['stream_epoch', 'bigint'], ['stream_binding', 'jsonb']
  ]],
  ['browser_preview_event', [
    ['session_id', 'uuid NOT NULL REFERENCES kcml.browser_session(id)'], ['stream_epoch', 'bigint NOT NULL'], ['sequence', 'bigint NOT NULL CHECK (sequence > 0)'], ['event_type', 'text NOT NULL'], ['control_epoch', 'bigint'],
    ['page_id', 'uuid'], ['frame_id', 'uuid'], ['document_id', 'uuid'], ['document_epoch', 'bigint'], ['observation_revision', 'bigint'], ['frame_revision', 'bigint'], ['payload', 'jsonb NOT NULL'], ['artifact_references', "uuid[] NOT NULL DEFAULT '{}'" ]
  ]],
  ['browser_control_lease', [
    ['session_id', 'uuid NOT NULL REFERENCES kcml.browser_session(id)'], ['holder_kind', "text NOT NULL CHECK (holder_kind IN ('AI','OWNER','AUTOMATION'))"], ['holder_id', 'uuid'], ['context_generation', 'bigint NOT NULL'], ['control_epoch', 'bigint NOT NULL'], ['fencing_token', 'bigint NOT NULL CHECK (fencing_token > 0)'],
    ['state', "text NOT NULL CHECK (state IN ('ACTIVE','RELEASED','EXPIRED','REVOKED'))"], ['issued_at', 'timestamptz NOT NULL'], ['heartbeat_at', 'timestamptz'], ['expires_at', 'timestamptz NOT NULL'], ['released_at', 'timestamptz'], ['takeover_source', 'jsonb'], ['control_transfer_id', 'uuid'], ['checkpoint_id', 'uuid']
  ]],
  ['browser_control_transfer', [
    ['session_id', 'uuid NOT NULL REFERENCES kcml.browser_session(id)'], ['requested_holder_kind', 'text NOT NULL'], ['requested_holder_id', 'uuid'], ['current_holder_kind', 'text'], ['current_holder_id', 'uuid'],
    ['expected_session_state_version', 'bigint NOT NULL'], ['expected_control_epoch', 'bigint NOT NULL'], ['current_action_id', 'uuid'], ['state', "text NOT NULL CHECK (state IN ('REQUESTED','DRAINING','GRANTED','REJECTED','CANCELLED','MANUAL_REVIEW'))"],
    ['input_reset_evidence', 'jsonb'], ['safe_checkpoint_id', 'uuid'], ['previous_control_epoch', 'bigint'], ['previous_fencing_token', 'bigint'], ['new_control_epoch', 'bigint'], ['new_fencing_token', 'bigint'], ['result', 'jsonb'], ['error', 'jsonb'], ['terminal_at', 'timestamptz']
  ]],
  ['browser_input_event', [
    ['session_id', 'uuid NOT NULL REFERENCES kcml.browser_session(id)'], ['control_lease_id', 'uuid NOT NULL REFERENCES kcml.browser_control_lease(id)'], ['control_epoch', 'bigint NOT NULL'], ['fencing_token', 'bigint NOT NULL'], ['client_sequence', 'bigint NOT NULL'], ['stream_sequence', 'bigint'],
    ['context_generation', 'bigint NOT NULL'], ['page_generation', 'bigint NOT NULL'], ['frame_attachment_epoch', 'bigint'], ['document_epoch', 'bigint NOT NULL'], ['observation_revision', 'bigint NOT NULL'], ['frame_revision', 'bigint'], ['viewport_transform_digest', 'bytea NOT NULL'],
    ['input_type', 'text NOT NULL'], ['input_state_sequence', 'bigint NOT NULL'], ['payload', 'jsonb NOT NULL'], ['mutation_trigger_classification', 'text NOT NULL'], ['state', "text NOT NULL CHECK (state IN ('ACCEPTED','REJECTED'))"], ['reason', 'text'], ['resulting_action_id', 'uuid'], ['occurred_at', 'timestamptz NOT NULL']
  ]],
  ['browser_action_attempt', [
    ['action_run_id', 'uuid NOT NULL REFERENCES kcml.browser_action_run(id)'], ['attempt', 'bigint NOT NULL CHECK (attempt > 0)'], ['command_id', 'uuid NOT NULL'], ['action_fence', 'bigint NOT NULL'], ['browser_identity_snapshot', 'jsonb NOT NULL'],
    ['resolved_target_candidates', 'jsonb NOT NULL'], ['chosen_target_digest', 'bytea'], ['actionability_evidence', 'jsonb NOT NULL'], ['trial_evidence', 'jsonb'], ['force_evidence', 'jsonb'], ['input_strategy', 'text NOT NULL'], ['prearmed_waiters', 'jsonb NOT NULL'],
    ['method_outcome', 'jsonb'], ['navigation_outcome', 'jsonb'], ['popup_outcome', 'jsonb'], ['dialog_outcome', 'jsonb'], ['permission_outcome', 'jsonb'], ['filechooser_outcome', 'jsonb'], ['download_outcome', 'jsonb'],
    ['postcondition', 'jsonb'], ['readback', 'jsonb'], ['evidence', 'jsonb NOT NULL'], ['started_at', 'timestamptz NOT NULL'], ['ended_at', 'timestamptz'], ['error', 'jsonb']
  ]],
  ['browser_action_dispatch_event', [
    ['action_attempt_id', 'uuid NOT NULL REFERENCES kcml.browser_action_attempt(id)'], ['phase_sequence', 'bigint NOT NULL CHECK (phase_sequence > 0)'], ['phase', 'text NOT NULL'], ['identity_snapshot', 'jsonb NOT NULL'],
    ['occurred_at', 'timestamptz NOT NULL'], ['adapter_evidence_digest', 'bytea NOT NULL'], ['event_digest', 'bytea NOT NULL']
  ]],
  ['browser_operation_scope', [
    ['parent_kind', 'text NOT NULL'], ['parent_object_id', 'uuid NOT NULL'], ['owner_message_id', 'uuid'], ['revision_id', 'uuid'], ['target_origins', "text[] NOT NULL DEFAULT '{}'"], ['redirect_origins', "text[] NOT NULL DEFAULT '{}'"],
    ['external_protocol_policy', 'jsonb NOT NULL'], ['local_target_policy', 'jsonb NOT NULL'], ['allowed_operation_classes', "text[] NOT NULL DEFAULT '{}'"], ['side_effect_ceiling', 'text NOT NULL'], ['account_constraints', 'jsonb NOT NULL'], ['tenant_constraints', 'jsonb NOT NULL'],
    ['resource_constraints', 'jsonb NOT NULL'], ['data_constraints', 'jsonb NOT NULL'], ['clipboard_constraints', 'jsonb NOT NULL'], ['upload_constraints', 'jsonb NOT NULL'], ['download_constraints', 'jsonb NOT NULL'], ['confirmation_policy', 'jsonb NOT NULL'], ['challenge_policy', 'jsonb NOT NULL'], ['scope_digest', 'bytea NOT NULL'], ['expires_at', 'timestamptz']
  ]],
  ['browser_irreversible_confirmation', [
    ['session_id', 'uuid NOT NULL REFERENCES kcml.browser_session(id)'], ['action_run_id', 'uuid'], ['automation_run_id', 'uuid'], ['step_id', 'uuid'], ['page_id', 'uuid NOT NULL'], ['frame_id', 'uuid'], ['document_id', 'uuid'],
    ['target', 'jsonb NOT NULL'], ['arguments', 'jsonb NOT NULL'], ['consequence', 'text NOT NULL'], ['account_identity', 'jsonb'], ['operation_scope_id', 'uuid NOT NULL REFERENCES kcml.browser_operation_scope(id)'], ['control_epoch', 'bigint NOT NULL'], ['observation_digest', 'bytea NOT NULL'],
    ['owner_confirmation', 'jsonb NOT NULL'], ['expires_at', 'timestamptz NOT NULL'], ['consumed_at', 'timestamptz'], ['confirmation_digest', 'bytea NOT NULL']
  ]],
  ['browser_auth_attempt', [
    ['session_id', 'uuid NOT NULL REFERENCES kcml.browser_session(id)'], ['automation_run_id', 'uuid'], ['step_id', 'uuid'], ['account_binding_id', 'uuid NOT NULL'], ['account_auth_epoch', 'bigint NOT NULL'], ['auth_mode', 'text NOT NULL'], ['login_flow_kind', 'text NOT NULL'], ['credential_versions', 'jsonb NOT NULL'],
    ['page_id', 'uuid'], ['frame_id', 'uuid'], ['document_id', 'uuid'], ['origin', 'text'], ['relying_party', 'text'], ['state', 'text NOT NULL'], ['challenge_id', 'uuid'], ['side_effect_operation_id', 'uuid'], ['account_evidence', 'jsonb'], ['tenant_evidence', 'jsonb'], ['result', 'jsonb'], ['error', 'jsonb'], ['started_at', 'timestamptz NOT NULL'], ['completed_at', 'timestamptz']
  ]],
  ['browser_state_bundle_member', [
    ['state_bundle_id', 'uuid NOT NULL REFERENCES kcml.browser_state_bundle(id)'], ['member_kind', "text NOT NULL CHECK (member_kind IN ('COOKIE','LOCAL_STORAGE','INDEXED_DB','SESSION_STORAGE','PERMISSION','CLIENT_CERTIFICATE_METADATA','VIRTUAL_WEBAUTHN'))"], ['member_key', 'text NOT NULL'], ['origin_scope', 'text'], ['partition_scope', 'jsonb'],
    ['encrypted_content', 'bytea'], ['artifact_reference', 'jsonb'], ['serializer_version', 'text NOT NULL'], ['member_digest', 'bytea NOT NULL'], ['size_bytes', 'bigint NOT NULL CHECK (size_bytes >= 0)'], ['compatibility_metadata', 'jsonb NOT NULL']
  ]],
  ['browser_bridge_connection', [
    ['bridge_id', 'uuid NOT NULL REFERENCES kcml.browser_local_bridge(id)'], ['certificate_generation', 'bigint NOT NULL'], ['connection_epoch', 'bigint NOT NULL CHECK (connection_epoch > 0)'], ['peer_certificate_fingerprint', 'bytea NOT NULL'], ['protocol_digest', 'bytea NOT NULL'], ['capability_digest', 'bytea NOT NULL'],
    ['capability_snapshot', 'jsonb NOT NULL'], ['connected_at', 'timestamptz NOT NULL'], ['heartbeat_at', 'timestamptz'], ['disconnected_at', 'timestamptz'], ['disconnect_reason', 'text'], ['revoke_reason', 'text'], ['state', "text NOT NULL CHECK (state IN ('CONNECTED','DRAINING','DISCONNECTED','REVOKED','FAILED'))"]
  ]],
  ['browser_bridge_assignment', [
    ['bridge_connection_id', 'uuid NOT NULL REFERENCES kcml.browser_bridge_connection(id)'], ['session_id', 'uuid NOT NULL REFERENCES kcml.browser_session(id)'], ['context_generation', 'bigint NOT NULL'], ['operation_scope_id', 'uuid NOT NULL'], ['local_target', 'jsonb'], ['account_binding_id', 'uuid'], ['profile_id', 'text'], ['control_epoch', 'bigint NOT NULL'], ['action_fence', 'bigint NOT NULL'],
    ['lease_owner', 'uuid'], ['lease_fencing_token', 'bigint NOT NULL'], ['lease_expires_at', 'timestamptz NOT NULL'], ['state', "text NOT NULL CHECK (state IN ('ASSIGNED','ACTIVE','RELEASING','RELEASED','FAILED'))"], ['assigned_at', 'timestamptz NOT NULL'], ['released_at', 'timestamptz'], ['cleanup_evidence', 'jsonb']
  ]],
  ['browser_profile_lease', [
    ['bridge_id', 'uuid NOT NULL'], ['profile_key', 'text NOT NULL'], ['browser_build_id', 'text NOT NULL'], ['owner_session_id', 'uuid NOT NULL REFERENCES kcml.browser_session(id)'], ['account_binding_id', 'uuid'], ['fencing_token', 'bigint NOT NULL'], ['connection_epoch', 'bigint NOT NULL'],
    ['mode', "text NOT NULL CHECK (mode IN ('READ_ONLY','SERIALIZED_MUTATION','EXCLUSIVE'))"], ['state', "text NOT NULL CHECK (state IN ('ACTIVE','RELEASING','RELEASED','EXPIRED','FAILED'))"], ['issued_at', 'timestamptz NOT NULL'], ['expires_at', 'timestamptz NOT NULL'], ['released_at', 'timestamptz'], ['process_evidence', 'jsonb'], ['profile_lock_evidence', 'jsonb']
  ]],
  ['browser_dialog', [
    ['session_id', 'uuid NOT NULL REFERENCES kcml.browser_session(id)'], ['page_id', 'uuid NOT NULL'], ['frame_id', 'uuid'], ['document_id', 'uuid'], ['dialog_sequence', 'bigint NOT NULL'], ['dialog_type', "text NOT NULL CHECK (dialog_type IN ('ALERT','CONFIRM','PROMPT','BEFOREUNLOAD','NATIVE'))"], ['causation_action_id', 'uuid'],
    ['safe_message_digest', 'bytea NOT NULL'], ['default_value_metadata', 'jsonb'], ['policy', 'jsonb NOT NULL'], ['challenge_id', 'uuid'], ['state', 'text NOT NULL'], ['response_digest', 'bytea'], ['opened_at', 'timestamptz NOT NULL'], ['resolved_at', 'timestamptz'], ['expired_at', 'timestamptz']
  ]],
  ['browser_permission_request', [
    ['session_id', 'uuid NOT NULL REFERENCES kcml.browser_session(id)'], ['context_instance_id', 'uuid NOT NULL'], ['page_id', 'uuid'], ['frame_id', 'uuid'], ['document_id', 'uuid'], ['origin', 'text NOT NULL'], ['permission_kind', 'text NOT NULL'], ['causation_action_id', 'uuid'], ['requested_scope', 'jsonb NOT NULL'],
    ['policy', 'jsonb NOT NULL'], ['challenge_id', 'uuid'], ['response', 'jsonb'], ['effective_permission_state', 'text'], ['resolved_at', 'timestamptz'], ['revoked_at', 'timestamptz']
  ]],
  ['browser_teaching_run', [
    ['parent_kind', 'text NOT NULL'], ['parent_object_id', 'uuid NOT NULL'], ['session_id', 'uuid NOT NULL REFERENCES kcml.browser_session(id)'], ['status', 'text NOT NULL'], ['control_participants', 'jsonb NOT NULL'], ['operation_scope_id', 'uuid NOT NULL'], ['first_event_sequence', 'bigint NOT NULL'], ['last_event_sequence', 'bigint'],
    ['compiler_version', 'text NOT NULL'], ['runtime_version', 'text NOT NULL'], ['candidate_automation_revision_id', 'uuid'], ['coverage_report', 'jsonb'], ['ambiguity_report', 'jsonb'], ['mutation_semantics_report', 'jsonb']
  ]],
  ['browser_teaching_step', [
    ['teaching_run_id', 'uuid NOT NULL REFERENCES kcml.browser_teaching_run(id)'], ['step_order', 'integer NOT NULL CHECK (step_order > 0)'], ['first_input_event_sequence', 'bigint NOT NULL'], ['last_action_event_sequence', 'bigint NOT NULL'], ['semantic_action', 'text NOT NULL'], ['route_snapshot', 'jsonb NOT NULL'], ['locator_candidates', 'jsonb NOT NULL'],
    ['input_binding', 'jsonb NOT NULL'], ['input_strategy', 'text NOT NULL'], ['mutation_trigger', 'text NOT NULL'], ['prearmed_waiter_contract', 'jsonb NOT NULL'], ['preconditions', 'jsonb NOT NULL'], ['postconditions', 'jsonb NOT NULL'], ['readback_contract', 'jsonb NOT NULL'],
    ['side_effect_class', 'text NOT NULL'], ['retry_class', 'text NOT NULL'], ['reconciliation_contract', 'jsonb NOT NULL'], ['concurrency_contract', 'jsonb NOT NULL'], ['evidence', 'jsonb NOT NULL'], ['owner_resolution', 'jsonb']
  ]],
  ['browser_automation_definition', [
    ['owner_component_id', 'uuid'], ['automation_name', 'text NOT NULL'], ['enabled', 'boolean NOT NULL DEFAULT false'], ['active_revision_id', 'uuid'], ['retired_at', 'timestamptz']
  ]],
  ['browser_automation_revision', [
    ['automation_definition_id', 'uuid NOT NULL REFERENCES kcml.browser_automation_definition(id)'], ['revision_number', 'bigint NOT NULL CHECK (revision_number > 0)'], ['manifest', 'jsonb NOT NULL'], ['manifest_digest', 'bytea NOT NULL'], ['interaction_plane_version', 'text NOT NULL'], ['interpreter_version', 'text NOT NULL'],
    ['runtime_requirements', 'jsonb NOT NULL'], ['engine_requirements', 'jsonb NOT NULL'], ['bridge_requirements', 'jsonb NOT NULL'], ['origin_policy', 'jsonb NOT NULL'], ['redirect_policy', 'jsonb NOT NULL'], ['local_target_policy', 'jsonb NOT NULL'], ['account_policy', 'jsonb NOT NULL'], ['tenant_policy', 'jsonb NOT NULL'],
    ['auth_bindings', 'jsonb NOT NULL'], ['input_schema', 'jsonb NOT NULL'], ['output_schema', 'jsonb NOT NULL'], ['steps', 'jsonb NOT NULL'], ['steps_digest', 'bytea NOT NULL'], ['locator_digest', 'bytea NOT NULL'], ['target_digest', 'bytea NOT NULL'], ['mutation_trigger_digest', 'bytea NOT NULL'], ['postcondition_digest', 'bytea NOT NULL'],
    ['schedule_policy', 'jsonb'], ['verification_status', 'text NOT NULL'], ['verification_evidence', 'jsonb NOT NULL'], ['compatibility_relations', 'jsonb NOT NULL']
  ]],
  ['browser_automation_run', [
    ['automation_definition_id', 'uuid NOT NULL REFERENCES kcml.browser_automation_definition(id)'], ['automation_revision_id', 'uuid NOT NULL REFERENCES kcml.browser_automation_revision(id)'], ['caller_snapshot', 'jsonb NOT NULL'], ['revision_digest', 'bytea NOT NULL'], ['client_run_id', 'text NOT NULL'], ['schedule_fire_id', 'text'], ['idempotency_scope', 'text NOT NULL'],
    ['operation_scope_id', 'uuid NOT NULL'], ['browser_session_id', 'uuid NOT NULL REFERENCES kcml.browser_session(id)'], ['account_binding_id', 'uuid'], ['account_auth_epoch', 'bigint'], ['status', 'text NOT NULL'], ['current_step', 'integer NOT NULL DEFAULT 0'], ['current_attempt', 'bigint NOT NULL DEFAULT 0'], ['input', 'jsonb NOT NULL'], ['input_digest', 'bytea NOT NULL'], ['output', 'jsonb'], ['output_digest', 'bytea'],
    ['lease_owner', 'uuid'], ['lease_fencing_token', 'bigint'], ['lease_expires_at', 'timestamptz'], ['heartbeat_at', 'timestamptz'], ['concurrency_claims', 'jsonb NOT NULL'], ['latest_checkpoint_id', 'uuid'], ['control_epoch', 'bigint'], ['cancellation_version', 'bigint NOT NULL DEFAULT 0'], ['pending_state', 'jsonb NOT NULL'], ['manual_review', 'jsonb'], ['error', 'jsonb'], ['started_at', 'timestamptz'], ['completed_at', 'timestamptz']
  ]],
  ['browser_automation_run_step', [
    ['automation_run_id', 'uuid NOT NULL REFERENCES kcml.browser_automation_run(id)'], ['step_order', 'integer NOT NULL'], ['attempt', 'bigint NOT NULL'], ['browser_action_run_id', 'uuid REFERENCES kcml.browser_action_run(id)'], ['status', 'text NOT NULL'], ['observed_browser_state', 'jsonb NOT NULL'], ['observed_account_state', 'jsonb'], ['mutation_trigger', 'text NOT NULL'], ['side_effect_state', 'jsonb'], ['reconciliation_state', 'jsonb'], ['started_at', 'timestamptz'], ['completed_at', 'timestamptz'], ['error', 'jsonb'], ['evidence', 'jsonb NOT NULL']
  ]],
  ['browser_automation_artifact', [
    ['session_id', 'uuid NOT NULL REFERENCES kcml.browser_session(id)'], ['automation_run_id', 'uuid'], ['step_id', 'uuid'], ['action_run_id', 'uuid'], ['artifact_type', 'text NOT NULL'], ['storage_reference', 'text NOT NULL'], ['page_id', 'uuid'], ['frame_id', 'uuid'], ['document_id', 'uuid'], ['mime_type', 'text'], ['size_bytes', 'bigint NOT NULL'], ['artifact_digest', 'bytea NOT NULL'], ['safe_name', 'text NOT NULL'], ['source_origin', 'text'], ['sensitivity', 'text NOT NULL'], ['retention_state', 'text NOT NULL'], ['scan_state', 'text NOT NULL'], ['cleanup_state', 'text NOT NULL']
  ]],
  ['browser_auth_binding', [
    ['automation_definition_id', 'uuid NOT NULL REFERENCES kcml.browser_automation_definition(id)'], ['automation_revision_id', 'uuid NOT NULL REFERENCES kcml.browser_automation_revision(id)'], ['account_key', 'text NOT NULL'], ['account_binding_id', 'uuid NOT NULL'], ['auth_mode', 'text NOT NULL'], ['secret_references', "uuid[] NOT NULL DEFAULT '{}'"], ['certificate_references', "uuid[] NOT NULL DEFAULT '{}'"], ['virtual_authenticator_references', "uuid[] NOT NULL DEFAULT '{}'"], ['state_bundle_compatibility', 'jsonb NOT NULL'], ['expected_account_condition', 'jsonb NOT NULL'], ['expected_tenant_condition', 'jsonb NOT NULL'], ['expires_at', 'timestamptz'], ['invalidation_policy', 'jsonb NOT NULL']
  ]],
  ['browser_challenge', [
    ['session_id', 'uuid NOT NULL REFERENCES kcml.browser_session(id)'], ['automation_run_id', 'uuid'], ['step_id', 'uuid'], ['challenge_type', 'text NOT NULL'], ['status', "text NOT NULL CHECK (status IN ('PENDING','RESOLVED','EXPIRED','CANCELLED','FAILED'))"], ['page_id', 'uuid'], ['frame_id', 'uuid'], ['document_id', 'uuid'], ['origin', 'text'], ['relying_party', 'text'], ['account_binding_id', 'uuid'], ['pending_action_digest', 'bytea NOT NULL'], ['auth_epoch', 'bigint'], ['control_epoch', 'bigint NOT NULL'], ['deadline_at', 'timestamptz NOT NULL'], ['safe_prompt', 'text NOT NULL'], ['allowed_resolution_methods', "text[] NOT NULL DEFAULT '{}'"], ['expires_at', 'timestamptz NOT NULL'], ['resolved_at', 'timestamptz'], ['owner_response_id', 'uuid'], ['bridge_response_id', 'uuid'], ['consume_digest', 'bytea']
  ]],
  ['self_test_catalog_entry', [
    ['case_key', 'text NOT NULL'], ['suite', 'text NOT NULL'], ['capability', 'text NOT NULL'], ['required_environment', 'jsonb NOT NULL'], ['target_operation', 'text NOT NULL'],
    ['setup_contract', 'jsonb NOT NULL'], ['execution_contract', 'jsonb NOT NULL'], ['assertion_contract', 'jsonb NOT NULL'], ['cleanup_contract', 'jsonb NOT NULL'], ['evidence_contract', 'jsonb NOT NULL']
  ]],
  ['deployment_step', [
    ['deployment_run_id', 'uuid NOT NULL'], ['step_key', 'text NOT NULL'], ['step_order', 'integer NOT NULL CHECK (step_order > 0)'], ['attempt', 'bigint NOT NULL CHECK (attempt > 0)'],
    ['state', "text NOT NULL CHECK (state IN ('PENDING','RUNNING','RECONCILING','SUCCEEDED','FAILED','MANUAL_REVIEW'))"], ['intent', 'jsonb NOT NULL'], ['expected_before_digest', 'bytea NOT NULL'], ['expected_after_digest', 'bytea NOT NULL'],
    ['side_effect_operation_id', 'uuid'], ['outcome', 'jsonb'], ['reconciliation', 'jsonb'], ['started_at', 'timestamptz'], ['completed_at', 'timestamptz'], ['duration_ms', 'bigint'], ['result', 'jsonb'], ['evidence', 'jsonb NOT NULL']
  ]],
  ['production_acceptance_run', [
    ['expected_source_sha', "text NOT NULL CHECK (expected_source_sha ~ '^[0-9a-f]{40}$')"], ['expected_release_id', 'text NOT NULL'], ['checks', 'jsonb NOT NULL'], ['results', 'jsonb'],
    ['state', "text NOT NULL CHECK (state IN ('PENDING','RUNNING','PASS','FAIL','NOT_EXECUTED_ENVIRONMENTAL'))"], ['started_at', 'timestamptz'], ['completed_at', 'timestamptz'], ['evidence_digest', 'bytea']
  ]],
  ['operational_setting_applied', [
    ['operational_setting_id', 'uuid NOT NULL'], ['desired_version', 'bigint NOT NULL CHECK (desired_version > 0)'], ['target_service', 'text NOT NULL'], ['target_build_id', 'text NOT NULL'],
    ['effective_version', 'bigint NOT NULL CHECK (effective_version > 0)'], ['effective_digest', 'bytea NOT NULL'], ['configuration_apply_run_id', 'uuid'], ['applied_at', 'timestamptz NOT NULL'],
    ['verification', 'jsonb NOT NULL'], ['result', "text NOT NULL CHECK (result IN ('APPLIED','VERIFIED','MISMATCH','FAILED','ROLLED_BACK'))"], ['error', 'jsonb']
  ]],
  ['domain_command_activation_domain', [
    ['domain_command_id', 'uuid NOT NULL REFERENCES kcml.domain_command(id)'], ['activation_domain_id', 'uuid NOT NULL REFERENCES kcml.activation_domain_head(id)'], ['pinned_activation_epoch', 'bigint NOT NULL CHECK (pinned_activation_epoch >= 0)'],
    ['operation_class', "text NOT NULL CHECK (operation_class IN ('READ_ONLY','MUTATING'))"], ['state', "text NOT NULL CHECK (state IN ('ADMITTED','CHECKPOINTED','RECONCILING','TERMINAL'))"],
    ['admitted_at', 'timestamptz NOT NULL'], ['terminal_at', 'timestamptz'], ['evidence_digest', 'bytea NOT NULL']
  ]],
  ['activation_domain_barrier', [
    ['activation_set_id', 'uuid NOT NULL'], ['activation_domain_id', 'uuid NOT NULL REFERENCES kcml.activation_domain_head(id)'], ['state', "text NOT NULL CHECK (state IN ('REQUESTED','DRAINING','CLOSED','RELEASED','FAILED'))"],
    ['admission_epoch', 'bigint NOT NULL CHECK (admission_epoch >= 0)'], ['pending_mutating_operation_count', 'bigint NOT NULL CHECK (pending_mutating_operation_count >= 0)'],
    ['lease_owner', 'uuid'], ['lease_fencing_token', 'bigint'], ['lease_expires_at', 'timestamptz'], ['requested_at', 'timestamptz NOT NULL'], ['closed_at', 'timestamptz'], ['released_at', 'timestamptz'], ['evidence', 'jsonb NOT NULL']
  ]],
  ['configuration_apply_run', [
    ['configuration_group', 'text NOT NULL'], ['desired_snapshot_digest', 'bytea NOT NULL'], ['previous_snapshot_digest', 'bytea NOT NULL'],
    ['state', "text NOT NULL CHECK (state IN ('PLANNED','APPLYING','RESTARTING','VERIFYING','ACTIVE','ROLLING_BACK','ROLLED_BACK','FAILED','MANUAL_REVIEW'))"],
    ['target_services', "text[] NOT NULL DEFAULT '{}'"], ['effective_versions', 'jsonb NOT NULL'], ['lease_owner', 'uuid'], ['lease_fencing_token', 'bigint'], ['lease_expires_at', 'timestamptz'],
    ['step_outcomes', 'jsonb NOT NULL'], ['rollback_evidence', 'jsonb'], ['evidence', 'jsonb NOT NULL'], ['started_at', 'timestamptz'], ['completed_at', 'timestamptz']
  ]],
  ['authority_lineage', [
    ['parent_lineage_id', 'uuid REFERENCES kcml.authority_lineage(id)'], ['root_kind', "text NOT NULL CHECK (root_kind IN ('OWNER_MESSAGE','OWNER_APPROVED_SPECIFICATION','OWNER_DELEGATED_SOURCE','ACTIVE_AGENT_REVISION','ACTIVE_AUTOMATION_REVISION','ACTIVE_COMPONENT_REVISION','EXTERNAL_ENDPOINT_CONTRACT','PLATFORM_RUNTIME_POLICY'))"],
    ['root_object_kind', 'text NOT NULL'], ['root_object_id', 'uuid NOT NULL'], ['root_object_digest', 'bytea NOT NULL'], ['target_ceiling', 'jsonb NOT NULL'], ['operation_ceiling', 'jsonb NOT NULL'],
    ['side_effect_ceiling', 'text NOT NULL'], ['secret_use_ceiling', 'jsonb NOT NULL'], ['lineage_payload', 'jsonb NOT NULL'], ['lineage_digest', 'bytea NOT NULL'], ['creator_execution_context_id', 'uuid']
  ]],
  ['operation_intent', [
    ['intent_id', 'uuid NOT NULL'], ['intent_revision', 'bigint NOT NULL CHECK (intent_revision > 0)'], ['authority_lineage_id', 'uuid NOT NULL REFERENCES kcml.authority_lineage(id)'], ['source_owner_message_id', 'uuid'],
    ['source_specification_id', 'uuid'], ['source_revision_id', 'uuid'], ['objective', 'text NOT NULL'], ['requirement_ids', "text[] NOT NULL DEFAULT '{}'"], ['target_selectors', 'jsonb NOT NULL'],
    ['operation_classes', "text[] NOT NULL DEFAULT '{}'"], ['side_effect_ceiling', 'text NOT NULL'], ['argument_slots', 'jsonb NOT NULL'], ['dynamic_target_slots', 'jsonb NOT NULL'],
    ['delegated_source_references', 'jsonb NOT NULL'], ['value_derivation_contracts', 'jsonb NOT NULL'], ['secret_use_purposes', 'jsonb NOT NULL'], ['target_constraints', 'jsonb NOT NULL'],
    ['placement_templates', 'jsonb NOT NULL'], ['delegation_graph_ceiling', 'jsonb NOT NULL'], ['success_postcondition', 'jsonb NOT NULL'], ['stop_conditions', 'jsonb NOT NULL'], ['cancel_conditions', 'jsonb NOT NULL'],
    ['expires_at', 'timestamptz'], ['intent_digest', 'bytea NOT NULL']
  ]],
  ['content_provenance', [
    ['parent_content_id', 'uuid REFERENCES kcml.content_provenance(id)'], ['transformation_id', 'uuid'], ['source_kind', 'text NOT NULL'], ['source_object_id', 'uuid'], ['source_revision_id', 'uuid'],
    ['source_locator', 'jsonb NOT NULL'], ['observed_at', 'timestamptz NOT NULL'], ['raw_bytes', 'bytea'], ['artifact_reference', 'jsonb'], ['raw_digest', 'bytea NOT NULL'], ['content_digest', 'bytea NOT NULL'],
    ['mime_type', 'text'], ['schema_id', 'text'], ['content_role', "text NOT NULL CHECK (content_role IN ('INSTRUCTION','DATA','EVIDENCE','PROPOSAL','RESULT','CODE','METADATA'))"],
    ['instruction_authority', "text NOT NULL CHECK (instruction_authority IN ('OWNER_DIRECT','OWNER_APPROVED_SPECIFICATION','OWNER_DELEGATED_SOURCE','ACTIVE_REVISION','PLATFORM_RUNTIME','NONE'))"],
    ['taint_flags', "text[] NOT NULL DEFAULT '{}'"], ['provenance_flags', "text[] NOT NULL DEFAULT '{}'"], ['extraction_method', 'text NOT NULL'], ['normalization_method', 'text NOT NULL'], ['transform_chain', 'jsonb NOT NULL']
  ]],
  ['instruction_segment', [
    ['model_call_id', 'uuid'], ['request_descriptor_id', 'uuid NOT NULL REFERENCES kcml.openai_request_descriptor(id)'], ['segment_sequence', 'bigint NOT NULL CHECK (segment_sequence > 0)'],
    ['source_provenance_id', 'uuid NOT NULL REFERENCES kcml.content_provenance(id)'], ['role', 'text NOT NULL'], ['instruction_authority', 'text NOT NULL'],
    ['destination', "text NOT NULL CHECK (destination IN ('INSTRUCTIONS','INPUT','TOOL_DEFINITION','OUTPUT_SCHEMA'))"], ['rendered_bytes', 'bytea NOT NULL'], ['rendered_digest', 'bytea NOT NULL'], ['compiler_version', 'text NOT NULL'], ['segment_digest', 'bytea NOT NULL']
  ]],
  ['operation_context', [
    ['parent_kind', 'text NOT NULL'], ['parent_object_id', 'uuid NOT NULL'], ['authority_lineage_id', 'uuid NOT NULL REFERENCES kcml.authority_lineage(id)'], ['authority_lineage_digest', 'bytea NOT NULL'],
    ['operation_intent_id', 'uuid NOT NULL'], ['operation_intent_digest', 'bytea NOT NULL'], ['actor_snapshot', 'jsonb NOT NULL'], ['execution_snapshot', 'jsonb NOT NULL'], ['revision_snapshot', 'jsonb NOT NULL'],
    ['tool_action_snapshot', 'jsonb NOT NULL'], ['target_snapshot', 'jsonb NOT NULL'], ['binding_snapshot', 'jsonb NOT NULL'], ['activation_snapshot', 'jsonb NOT NULL'], ['target_constraints', 'jsonb NOT NULL'],
    ['argument_schema', 'jsonb NOT NULL'], ['argument_origin_map', 'jsonb NOT NULL'], ['side_effect_contract', 'jsonb NOT NULL'], ['retry_contract', 'jsonb NOT NULL'], ['idempotency_contract', 'jsonb NOT NULL'], ['concurrency_contract', 'jsonb NOT NULL'],
    ['secret_use_plan', 'jsonb NOT NULL'], ['delegation_projection', 'jsonb NOT NULL'], ['deadline_at', 'timestamptz'], ['precondition', 'jsonb NOT NULL'], ['postcondition', 'jsonb NOT NULL'],
    ['provenance_manifest_digest', 'bytea NOT NULL'], ['state', "text NOT NULL CHECK (state IN ('COMPILED','VALIDATED','DISPATCH_RESERVED','DISPATCHED','TERMINAL','MANUAL_REVIEW','INVALIDATED'))"],
    ['canonical_payload', 'jsonb NOT NULL'], ['context_digest', 'bytea NOT NULL']
  ]],
  ['semantic_action_plan', [
    ['operation_context_id', 'uuid NOT NULL REFERENCES kcml.operation_context(id)'], ['producing_model_call_id', 'uuid'], ['producing_output_item_id', 'uuid'], ['producing_tool_call_id', 'uuid'], ['producing_handoff_id', 'uuid'],
    ['proposed_alias', 'text'], ['proposed_text', 'text'], ['resolved_operation', 'text NOT NULL'], ['resolved_tool_key', 'text'], ['resolved_revision_id', 'uuid'], ['resolved_binding_id', 'uuid'],
    ['target', 'jsonb NOT NULL'], ['canonical_arguments', 'jsonb NOT NULL'], ['argument_origin_map', 'jsonb NOT NULL'], ['value_derivation_ids', "uuid[] NOT NULL DEFAULT '{}'"], ['side_effect_class', 'text NOT NULL'],
    ['secret_use_context_ids', "uuid[] NOT NULL DEFAULT '{}'"], ['postcondition', 'jsonb NOT NULL'], ['reconciliation', 'jsonb NOT NULL'], ['validation_result', 'jsonb NOT NULL'], ['stable_error', 'jsonb'], ['validator_version', 'text NOT NULL'], ['plan_digest', 'bytea NOT NULL']
  ]],
  ['value_derivation', [
    ['operation_context_id', 'uuid NOT NULL REFERENCES kcml.operation_context(id)'], ['semantic_action_plan_id', 'uuid'], ['destination_path', 'text NOT NULL'], ['source_content_provenance_id', 'uuid NOT NULL REFERENCES kcml.content_provenance(id)'],
    ['source_locator', 'jsonb NOT NULL'], ['source_digest', 'bytea NOT NULL'], ['transform', 'text NOT NULL'], ['normalizer', 'text NOT NULL'], ['value_schema', 'jsonb NOT NULL'], ['constraints', 'jsonb NOT NULL'], ['transform_version', 'text NOT NULL'],
    ['canonical_value', 'jsonb NOT NULL'], ['value_digest', 'bytea NOT NULL'], ['validation_evidence', 'jsonb NOT NULL'], ['requirement_id', 'text NOT NULL']
  ]],
  ['secret_use_context', [
    ['operation_context_id', 'uuid NOT NULL REFERENCES kcml.operation_context(id)'], ['semantic_action_plan_id', 'uuid'], ['secret_binding_alias', 'text NOT NULL'], ['secret_binding_revision', 'bigint NOT NULL'],
    ['declared_purpose', 'text NOT NULL'], ['consumer', 'jsonb NOT NULL'], ['target_component_id', 'uuid'], ['external_target_id', 'uuid'], ['target_origin', 'text'], ['account_id', 'uuid'], ['tenant_id', 'text'],
    ['allowed_placement', "text NOT NULL CHECK (allowed_placement IN ('HEADER','QUERY','BODY','BROWSER_FIELD','SDK_CONFIG','RUNTIME_VALUE','CODE_ARTIFACT'))"], ['argument_path', 'text NOT NULL'], ['lifetime', 'text NOT NULL'], ['attempt', 'bigint NOT NULL'],
    ['expected_recipient_contract', 'jsonb NOT NULL'], ['use_digest', 'bytea NOT NULL'], ['resolution_evidence', 'jsonb'], ['result_evidence', 'jsonb']
  ]],
  ['agentic_security_event', [
    ['security_code', 'text NOT NULL'], ['classification', 'text NOT NULL'], ['severity', 'text NOT NULL'], ['operation_context_id', 'uuid'], ['authority_lineage_id', 'uuid'], ['content_provenance_id', 'uuid'], ['semantic_action_plan_id', 'uuid'],
    ['attempted_tool', 'jsonb'], ['attempted_target', 'jsonb'], ['attempted_argument_change', 'jsonb'], ['attempted_delegation_change', 'jsonb'], ['attempted_secret_use_change', 'jsonb'],
    ['validation_decision', 'text NOT NULL'], ['no_side_effect_evidence', 'jsonb NOT NULL'], ['recovery_directive', 'text NOT NULL'], ['occurred_at', 'timestamptz NOT NULL']
  ]],
  ['openai_model_capability_snapshot', [
    ['model_id', 'text NOT NULL'], ['compatibility_profile', 'jsonb NOT NULL'], ['lifecycle_capabilities', 'jsonb NOT NULL'], ['structured_output_profile', 'jsonb NOT NULL'], ['tool_capabilities', 'jsonb NOT NULL'], ['modality_limits', 'jsonb NOT NULL'], ['source_evidence', 'jsonb NOT NULL'], ['verification_run_id', 'uuid'], ['observed_at', 'timestamptz NOT NULL'], ['expires_at', 'timestamptz NOT NULL'], ['canonical_payload', 'jsonb NOT NULL'], ['payload_digest', 'bytea NOT NULL']
  ]],
  ['openai_request_descriptor', [
    ['model_logical_operation_id', 'uuid NOT NULL'], ['attempt', 'bigint NOT NULL'], ['owner_kind', 'text NOT NULL'], ['owner_object_id', 'uuid NOT NULL'], ['parent_checkpoint_id', 'uuid'], ['model_id', 'text NOT NULL'], ['api_kind', 'text NOT NULL'], ['execution_mode', 'text NOT NULL'], ['transport', 'text NOT NULL'], ['background_policy', 'text NOT NULL'], ['store_policy', 'text NOT NULL'], ['instructions_payload', 'text NOT NULL'], ['input_payload', 'jsonb NOT NULL'], ['tools_payload', 'jsonb NOT NULL DEFAULT \'[]\'::jsonb'], ['output_schema_payload', 'jsonb'], ['instructions_digest', 'bytea NOT NULL'], ['input_digest', 'bytea NOT NULL'], ['tools_digest', 'bytea NOT NULL'], ['output_schema_digest', 'bytea'], ['model_settings', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'], ['history_strategy', 'text NOT NULL'], ['provider_continuation_handles', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'], ['capability_snapshot_id', 'uuid'], ['sdk_version', 'text NOT NULL'], ['adapter_version', 'text NOT NULL'], ['serializer_version', 'text NOT NULL'], ['budgets', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'], ['timeout_ms', 'integer NOT NULL'], ['deadline_at', 'timestamptz'], ['causation_id', 'uuid'], ['trace_id', 'text'], ['group_id', 'text'], ['idempotency_scope', 'text NOT NULL'], ['idempotency_key', 'text NOT NULL'], ['request_digest', 'bytea NOT NULL']
  ]],
  ['ai_model_event', [
    ['model_call_id', 'uuid NOT NULL'], ['sequence', 'bigint NOT NULL'], ['provider_response_id', 'text'], ['provider_sequence', 'bigint'], ['event_type', 'text NOT NULL'], ['raw_payload', 'jsonb NOT NULL'], ['payload_digest', 'bytea NOT NULL'], ['persisted_at', 'timestamptz NOT NULL'], ['published_at', 'timestamptz']
  ]],
  ['ai_model_output_item', [
    ['model_call_id', 'uuid NOT NULL'], ['provider_response_id', 'text NOT NULL'], ['output_index', 'integer NOT NULL CHECK (output_index >= 0)'], ['provider_item_id', 'text'], ['item_type', 'text NOT NULL'], ['status', 'text'], ['provider_call_id', 'text'], ['raw_payload', 'jsonb NOT NULL'], ['payload_digest', 'bytea NOT NULL'], ['first_provider_sequence', 'bigint'], ['last_provider_sequence', 'bigint'], ['interpretation_state', 'text NOT NULL'], ['compatibility_profile', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb']
  ]],
  ['ai_model_output_content_part', [
    ['output_item_id', 'uuid NOT NULL'], ['content_index', 'integer NOT NULL CHECK (content_index >= 0)'], ['content_type', 'text NOT NULL'], ['payload', 'jsonb NOT NULL'], ['payload_digest', 'bytea NOT NULL'], ['annotations', 'jsonb NOT NULL DEFAULT \'[]\'::jsonb'], ['artifact_references', 'jsonb NOT NULL DEFAULT \'[]\'::jsonb']
  ]],
  ['ai_tool_dispatch', [
    ['model_call_id', 'uuid NOT NULL'], ['provider_output_ordinal', 'integer NOT NULL'], ['provider_call_id', 'text NOT NULL'], ['provider_item_id', 'text'], ['tool_key', 'text NOT NULL'], ['binding_key', 'text NOT NULL'], ['binding_revision', 'bigint NOT NULL'], ['tool_digest', 'bytea NOT NULL'], ['binding_digest', 'bytea NOT NULL'], ['raw_arguments', 'text NOT NULL'], ['canonical_arguments', 'jsonb NOT NULL'], ['arguments_digest', 'bytea NOT NULL'], ['call_ordinal', 'bigint NOT NULL'], ['execution_group', 'text'], ['state', 'text NOT NULL'], ['approval_request_id', 'uuid'], ['domain_operation_id', 'uuid'], ['side_effect_operation_id', 'uuid'], ['idempotency_relation', 'jsonb'], ['result_payload', 'jsonb'], ['error_payload', 'jsonb'], ['result_digest', 'bytea'], ['function_output_payload', 'jsonb'], ['function_output_digest', 'bytea'], ['started_at', 'timestamptz'], ['completed_at', 'timestamptz']
  ]],
  ['ai_model_continuation', [
    ['parent_run_id', 'uuid NOT NULL'], ['parent_turn_id', 'uuid'], ['producing_model_call_id', 'uuid NOT NULL'], ['provider_response_id', 'text NOT NULL'], ['continuation_generation', 'bigint NOT NULL'], ['history_strategy', 'text NOT NULL'], ['resolved_tool_calls', 'jsonb NOT NULL'], ['aggregate_digest', 'bytea NOT NULL'], ['previous_response_id', 'text'], ['conversation_id', 'text'], ['history_cursor', 'text'], ['successor_request_descriptor_id', 'uuid'], ['successor_model_call_id', 'uuid'], ['state', 'text NOT NULL'], ['checkpoint_id', 'uuid'], ['queue_item_id', 'uuid'], ['outbox_event_id', 'uuid']
  ]],
  ['ai_run_state_checkpoint', [
    ['owner_kind', 'text NOT NULL'], ['owner_id', 'uuid NOT NULL'], ['run_state_payload', 'jsonb NOT NULL'], ['serializer_version', 'text NOT NULL'], ['openai_version', 'text NOT NULL'], ['agents_sdk_version', 'text NOT NULL'], ['adapter_version', 'text NOT NULL'], ['code_runtime_version', 'text NOT NULL'], ['agent_graph_identity_map', 'jsonb NOT NULL'], ['agent_graph_digest', 'bytea NOT NULL'], ['instruction_digest', 'bytea NOT NULL'], ['tools_digest', 'bytea NOT NULL'], ['session_digest', 'bytea'], ['guardrail_digest', 'bytea'], ['output_digest', 'bytea'], ['tool_use_behavior', 'text'], ['reasoning_item_id', 'text'], ['tool_execution_policies', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'], ['pending_interruptions', 'jsonb NOT NULL DEFAULT \'[]\'::jsonb'], ['nested_resumptions', 'jsonb NOT NULL DEFAULT \'[]\'::jsonb'], ['pending_calls', 'jsonb NOT NULL DEFAULT \'[]\'::jsonb'], ['pending_output_ownership', 'jsonb'], ['budget_snapshot', 'jsonb NOT NULL'], ['usage_snapshot', 'jsonb NOT NULL'], ['turn_snapshot', 'jsonb NOT NULL'], ['provider_handles', 'jsonb NOT NULL DEFAULT \'{}\'::jsonb'], ['session_strategy', 'text NOT NULL'], ['session_version', 'bigint'], ['session_cursor', 'text'], ['checkpoint_sequence', 'bigint NOT NULL'], ['previous_checkpoint_id', 'uuid'], ['checkpoint_digest', 'bytea NOT NULL']
  ]]
]);
const exactIndexes = new Map([
  ['component', [
    'CREATE UNIQUE INDEX IF NOT EXISTS component_kcml_number_uq ON kcml.component(kcml_number)',
    'CREATE UNIQUE INDEX IF NOT EXISTS component_code_uq ON kcml.component(code)',
    'CREATE UNIQUE INDEX IF NOT EXISTS component_hostname_uq ON kcml.component(hostname) WHERE hostname IS NOT NULL'
  ]],
  ['component_audit_stream', [
    'CREATE UNIQUE INDEX IF NOT EXISTS component_audit_stream_component_uq ON kcml.component_audit_stream(component_id)'
  ]],
  ['component_audit_event', [
    'CREATE UNIQUE INDEX IF NOT EXISTS component_audit_event_sequence_uq ON kcml.component_audit_event(stream_id,sequence)'
  ]],
  ['component_state_contract', [
    'CREATE UNIQUE INDEX IF NOT EXISTS component_state_contract_key_uq ON kcml.component_state_contract(component_id,revision_id,state_key) WHERE deleted_at IS NULL'
  ]],
  ['browser_runtime_build_manifest', [
    'CREATE UNIQUE INDEX IF NOT EXISTS browser_runtime_build_manifest_digest_uq ON kcml.browser_runtime_build_manifest(manifest_digest)'
  ]],
  ['browser_session_binding', [
    'CREATE UNIQUE INDEX IF NOT EXISTS browser_session_binding_relation_uq ON kcml.browser_session_binding(session_id,related_object_kind,related_object_id,relation) WHERE revoked_at IS NULL'
  ]],
  ['browser_host_slot', [
    'CREATE UNIQUE INDEX IF NOT EXISTS browser_host_slot_generation_uq ON kcml.browser_host_slot(host_id,slot_key,host_generation)',
    "CREATE UNIQUE INDEX IF NOT EXISTS browser_host_slot_uds_active_uq ON kcml.browser_host_slot(uds_inode,uds_fingerprint) WHERE admission_state <> 'CLOSED'"
  ]],
  ['browser_context_instance', [
    'CREATE UNIQUE INDEX IF NOT EXISTS browser_context_generation_uq ON kcml.browser_context_instance(session_id,context_key,context_generation)'
  ]],
  ['browser_page', [
    'CREATE UNIQUE INDEX IF NOT EXISTS browser_page_generation_uq ON kcml.browser_page(session_id,page_key,page_generation)'
  ]],
  ['browser_frame', [
    'CREATE UNIQUE INDEX IF NOT EXISTS browser_frame_attachment_uq ON kcml.browser_frame(page_id,frame_key,attachment_epoch)'
  ]],
  ['browser_document', [
    'CREATE UNIQUE INDEX IF NOT EXISTS browser_document_epoch_uq ON kcml.browser_document(frame_id,document_epoch)'
  ]],
  ['browser_navigation', [
    'CREATE UNIQUE INDEX IF NOT EXISTS browser_navigation_id_uq ON kcml.browser_navigation(navigation_key)',
    'CREATE UNIQUE INDEX IF NOT EXISTS browser_navigation_sequence_uq ON kcml.browser_navigation(page_id,navigation_sequence)'
  ]],
  ['browser_preview_frame', [
    'CREATE UNIQUE INDEX IF NOT EXISTS browser_preview_frame_revision_uq ON kcml.browser_preview_frame(session_id,stream_epoch,frame_revision)'
  ]],
  ['browser_preview_ticket', [
    'CREATE UNIQUE INDEX IF NOT EXISTS browser_preview_ticket_fingerprint_uq ON kcml.browser_preview_ticket(token_fingerprint)'
  ]],
  ['browser_preview_event', [
    'CREATE UNIQUE INDEX IF NOT EXISTS browser_preview_event_sequence_uq ON kcml.browser_preview_event(session_id,stream_epoch,sequence)'
  ]],
  ['browser_control_lease', [
    "CREATE UNIQUE INDEX IF NOT EXISTS browser_control_lease_active_uq ON kcml.browser_control_lease(session_id) WHERE state = 'ACTIVE'",
    'CREATE UNIQUE INDEX IF NOT EXISTS browser_control_lease_fence_uq ON kcml.browser_control_lease(session_id,fencing_token)'
  ]],
  ['browser_control_transfer', [
    "CREATE UNIQUE INDEX IF NOT EXISTS browser_control_transfer_active_uq ON kcml.browser_control_transfer(session_id) WHERE state IN ('REQUESTED','DRAINING')"
  ]],
  ['browser_input_event', [
    'CREATE UNIQUE INDEX IF NOT EXISTS browser_input_event_client_sequence_uq ON kcml.browser_input_event(control_lease_id,client_sequence)',
    'CREATE UNIQUE INDEX IF NOT EXISTS browser_input_event_state_sequence_uq ON kcml.browser_input_event(session_id,control_epoch,input_state_sequence)'
  ]],
  ['browser_action_attempt', [
    'CREATE UNIQUE INDEX IF NOT EXISTS browser_action_attempt_number_uq ON kcml.browser_action_attempt(action_run_id,attempt)',
    'CREATE UNIQUE INDEX IF NOT EXISTS browser_action_attempt_command_uq ON kcml.browser_action_attempt(command_id)'
  ]],
  ['browser_action_dispatch_event', [
    'CREATE UNIQUE INDEX IF NOT EXISTS browser_action_dispatch_sequence_uq ON kcml.browser_action_dispatch_event(action_attempt_id,phase_sequence)'
  ]],
  ['browser_operation_scope', [
    'CREATE UNIQUE INDEX IF NOT EXISTS browser_operation_scope_digest_uq ON kcml.browser_operation_scope(scope_digest)'
  ]],
  ['browser_irreversible_confirmation', [
    'CREATE UNIQUE INDEX IF NOT EXISTS browser_irreversible_confirmation_digest_uq ON kcml.browser_irreversible_confirmation(confirmation_digest)'
  ]],
  ['browser_state_bundle_member', [
    'CREATE UNIQUE INDEX IF NOT EXISTS browser_state_bundle_member_key_uq ON kcml.browser_state_bundle_member(state_bundle_id,member_kind,member_key)'
  ]],
  ['browser_bridge_connection', [
    'CREATE UNIQUE INDEX IF NOT EXISTS browser_bridge_connection_epoch_uq ON kcml.browser_bridge_connection(bridge_id,connection_epoch)'
  ]],
  ['browser_bridge_assignment', [
    "CREATE UNIQUE INDEX IF NOT EXISTS browser_bridge_assignment_active_uq ON kcml.browser_bridge_assignment(session_id,context_generation) WHERE state IN ('ASSIGNED','ACTIVE','RELEASING')"
  ]],
  ['browser_profile_lease', [
    "CREATE UNIQUE INDEX IF NOT EXISTS browser_profile_lease_writer_uq ON kcml.browser_profile_lease(bridge_id,profile_key) WHERE state = 'ACTIVE' AND mode IN ('SERIALIZED_MUTATION','EXCLUSIVE')"
  ]],
  ['browser_dialog', [
    'CREATE UNIQUE INDEX IF NOT EXISTS browser_dialog_sequence_uq ON kcml.browser_dialog(session_id,dialog_sequence)'
  ]],
  ['browser_permission_request', [
    "CREATE UNIQUE INDEX IF NOT EXISTS browser_permission_request_active_uq ON kcml.browser_permission_request(session_id,origin,permission_kind) WHERE resolved_at IS NULL AND revoked_at IS NULL"
  ]],
  ['browser_teaching_run', [
    "CREATE UNIQUE INDEX IF NOT EXISTS browser_teaching_run_active_uq ON kcml.browser_teaching_run(session_id) WHERE status IN ('RECORDING','COMPILING','WAITING_FOR_OWNER')"
  ]],
  ['browser_teaching_step', [
    'CREATE UNIQUE INDEX IF NOT EXISTS browser_teaching_step_order_uq ON kcml.browser_teaching_step(teaching_run_id,step_order)'
  ]],
  ['browser_automation_definition', [
    'CREATE UNIQUE INDEX IF NOT EXISTS browser_automation_definition_name_uq ON kcml.browser_automation_definition(owner_component_id,automation_name)'
  ]],
  ['browser_automation_revision', [
    'CREATE UNIQUE INDEX IF NOT EXISTS browser_automation_revision_number_uq ON kcml.browser_automation_revision(automation_definition_id,revision_number)',
    'CREATE UNIQUE INDEX IF NOT EXISTS browser_automation_revision_digest_uq ON kcml.browser_automation_revision(automation_definition_id,manifest_digest)'
  ]],
  ['browser_automation_run', [
    'CREATE UNIQUE INDEX IF NOT EXISTS browser_automation_run_client_uq ON kcml.browser_automation_run(automation_definition_id,client_run_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS browser_automation_run_schedule_uq ON kcml.browser_automation_run(automation_definition_id,schedule_fire_id) WHERE schedule_fire_id IS NOT NULL'
  ]],
  ['browser_automation_run_step', [
    'CREATE UNIQUE INDEX IF NOT EXISTS browser_automation_run_step_uq ON kcml.browser_automation_run_step(automation_run_id,step_order,attempt)'
  ]],
  ['browser_automation_artifact', [
    'CREATE UNIQUE INDEX IF NOT EXISTS browser_automation_artifact_digest_uq ON kcml.browser_automation_artifact(automation_run_id,artifact_digest,artifact_type)'
  ]],
  ['browser_auth_binding', [
    'CREATE UNIQUE INDEX IF NOT EXISTS browser_auth_binding_account_uq ON kcml.browser_auth_binding(automation_revision_id,account_key)'
  ]],
  ['browser_challenge', [
    "CREATE UNIQUE INDEX IF NOT EXISTS browser_challenge_pending_uq ON kcml.browser_challenge(session_id,pending_action_digest) WHERE status = 'PENDING'"
  ]],
  ['self_test_catalog_entry', [
    'CREATE UNIQUE INDEX IF NOT EXISTS self_test_catalog_entry_case_uq ON kcml.self_test_catalog_entry(case_key)'
  ]],
  ['deployment_step', [
    'CREATE UNIQUE INDEX IF NOT EXISTS deployment_step_attempt_uq ON kcml.deployment_step(deployment_run_id,step_key,attempt)',
    'CREATE UNIQUE INDEX IF NOT EXISTS deployment_step_order_attempt_uq ON kcml.deployment_step(deployment_run_id,step_order,attempt)'
  ]],
  ['production_acceptance_run', [
    'CREATE INDEX IF NOT EXISTS production_acceptance_expected_idx ON kcml.production_acceptance_run(expected_source_sha,expected_release_id,created_at DESC)'
  ]],
  ['operational_setting_applied', [
    'CREATE UNIQUE INDEX IF NOT EXISTS operational_setting_applied_target_uq ON kcml.operational_setting_applied(operational_setting_id,desired_version,target_service,target_build_id)'
  ]],
  ['domain_command_activation_domain', [
    'CREATE UNIQUE INDEX IF NOT EXISTS domain_command_activation_domain_uq ON kcml.domain_command_activation_domain(domain_command_id,activation_domain_id)'
  ]],
  ['activation_domain_barrier', [
    "CREATE UNIQUE INDEX IF NOT EXISTS activation_domain_barrier_active_uq ON kcml.activation_domain_barrier(activation_domain_id) WHERE state IN ('REQUESTED','DRAINING','CLOSED')"
  ]],
  ['configuration_apply_run', [
    'CREATE UNIQUE INDEX IF NOT EXISTS configuration_apply_run_snapshot_uq ON kcml.configuration_apply_run(configuration_group,desired_snapshot_digest)'
  ]],
  ['authority_lineage', [
    'CREATE UNIQUE INDEX IF NOT EXISTS authority_lineage_digest_uq ON kcml.authority_lineage(lineage_digest)'
  ]],
  ['operation_intent', [
    'CREATE UNIQUE INDEX IF NOT EXISTS operation_intent_revision_uq ON kcml.operation_intent(intent_id,intent_revision)',
    'CREATE UNIQUE INDEX IF NOT EXISTS operation_intent_digest_uq ON kcml.operation_intent(intent_digest)'
  ]],
  ['content_provenance', [
    'CREATE UNIQUE INDEX IF NOT EXISTS content_provenance_source_digest_uq ON kcml.content_provenance(source_kind,content_digest,raw_digest)'
  ]],
  ['instruction_segment', [
    'CREATE UNIQUE INDEX IF NOT EXISTS instruction_segment_sequence_uq ON kcml.instruction_segment(request_descriptor_id,segment_sequence)',
    'CREATE UNIQUE INDEX IF NOT EXISTS instruction_segment_digest_uq ON kcml.instruction_segment(request_descriptor_id,segment_digest)'
  ]],
  ['operation_context', [
    'CREATE UNIQUE INDEX IF NOT EXISTS operation_context_digest_uq ON kcml.operation_context(context_digest)',
    "CREATE UNIQUE INDEX IF NOT EXISTS operation_context_dispatch_current_uq ON kcml.operation_context(parent_kind,parent_object_id) WHERE state IN ('DISPATCH_RESERVED','DISPATCHED')"
  ]],
  ['semantic_action_plan', [
    'CREATE UNIQUE INDEX IF NOT EXISTS semantic_action_plan_digest_uq ON kcml.semantic_action_plan(operation_context_id,plan_digest)'
  ]],
  ['value_derivation', [
    'CREATE UNIQUE INDEX IF NOT EXISTS value_derivation_destination_uq ON kcml.value_derivation(operation_context_id,semantic_action_plan_id,destination_path)'
  ]],
  ['secret_use_context', [
    'CREATE UNIQUE INDEX IF NOT EXISTS secret_use_context_attempt_uq ON kcml.secret_use_context(operation_context_id,semantic_action_plan_id,secret_binding_alias,argument_path,attempt)'
  ]],
  ['agentic_security_event', [
    'CREATE INDEX IF NOT EXISTS agentic_security_event_context_idx ON kcml.agentic_security_event(operation_context_id,created_at)'
  ]],
  ['agent_session_compaction', [
    'CREATE UNIQUE INDEX IF NOT EXISTS agent_session_compaction_source_uq ON kcml.agent_session_compaction(session_id,source_session_version,source_first_item_sequence,source_last_item_sequence)',
    "CREATE UNIQUE INDEX IF NOT EXISTS agent_session_compaction_active_uq ON kcml.agent_session_compaction(session_id) WHERE state = 'ACTIVE'"
  ]],
  ['agent_definition', [
    'CREATE UNIQUE INDEX IF NOT EXISTS agent_definition_component_uq ON kcml.agent_definition(component_id) WHERE component_id IS NOT NULL'
  ]],
  ['agent_revision', [
    'CREATE UNIQUE INDEX IF NOT EXISTS agent_revision_number_uq ON kcml.agent_revision(agent_definition_id,revision_number)',
    'CREATE UNIQUE INDEX IF NOT EXISTS agent_revision_payload_uq ON kcml.agent_revision(agent_definition_id,payload_digest)'
  ]],
  ['agent_tool_binding', [
    'CREATE UNIQUE INDEX IF NOT EXISTS agent_tool_binding_alias_uq ON kcml.agent_tool_binding(agent_revision_id,model_alias)',
    'CREATE UNIQUE INDEX IF NOT EXISTS agent_tool_binding_digest_uq ON kcml.agent_tool_binding(agent_revision_id,binding_digest)'
  ]],
  ['agent_handoff_binding', [
    'CREATE UNIQUE INDEX IF NOT EXISTS agent_handoff_binding_pair_uq ON kcml.agent_handoff_binding(source_agent_revision_id,target_agent_revision_id,orchestration_pattern,binding_digest)'
  ]],
  ['agent_guardrail', [
    'CREATE UNIQUE INDEX IF NOT EXISTS agent_guardrail_key_uq ON kcml.agent_guardrail(agent_revision_id,kind,guardrail_key)'
  ]],
  ['agent_session', [
    'CREATE UNIQUE INDEX IF NOT EXISTS agent_session_key_uq ON kcml.agent_session(agent_definition_id,session_key)'
  ]],
  ['agent_session_item', [
    'CREATE UNIQUE INDEX IF NOT EXISTS agent_session_item_sequence_uq ON kcml.agent_session_item(session_id,sequence)'
  ]],
  ['agent_run_checkpoint', [
    'CREATE UNIQUE INDEX IF NOT EXISTS agent_run_checkpoint_sequence_uq ON kcml.agent_run_checkpoint(agent_run_id,sequence)'
  ]],
  ['agent_message', [
    'CREATE UNIQUE INDEX IF NOT EXISTS agent_message_sequence_uq ON kcml.agent_message(agent_run_id,sequence)'
  ]],
  ['agent_tool_call', [
    'CREATE UNIQUE INDEX IF NOT EXISTS agent_tool_call_provider_uq ON kcml.agent_tool_call(model_call_id,provider_call_id)'
  ]],
  ['agent_approval_request', [
    "CREATE UNIQUE INDEX IF NOT EXISTS agent_approval_tool_pending_uq ON kcml.agent_approval_request(tool_call_id) WHERE tool_call_id IS NOT NULL AND status = 'PENDING'",
    "CREATE UNIQUE INDEX IF NOT EXISTS agent_approval_handoff_pending_uq ON kcml.agent_approval_request(handoff_run_id) WHERE handoff_run_id IS NOT NULL AND status = 'PENDING'"
  ]],
  ['agent_memory_namespace', [
    'CREATE UNIQUE INDEX IF NOT EXISTS agent_memory_namespace_type_uq ON kcml.agent_memory_namespace(agent_definition_id,memory_type)'
  ]],
  ['agent_memory_item', [
    'CREATE UNIQUE INDEX IF NOT EXISTS agent_memory_item_current_key_uq ON kcml.agent_memory_item(namespace_id,memory_key) WHERE superseded_at IS NULL AND deleted_at IS NULL'
  ]],
  ['agent_trigger', [
    'CREATE UNIQUE INDEX IF NOT EXISTS agent_trigger_digest_uq ON kcml.agent_trigger(agent_revision_id,trigger_kind,trigger_digest)'
  ]],
  ['agent_eval_suite', [
    'CREATE UNIQUE INDEX IF NOT EXISTS agent_eval_suite_version_uq ON kcml.agent_eval_suite(agent_revision_id,suite_version)'
  ]],
  ['agent_eval_case', [
    'CREATE UNIQUE INDEX IF NOT EXISTS agent_eval_case_key_uq ON kcml.agent_eval_case(eval_suite_id,case_key)'
  ]],
  ['agent_eval_case_result', [
    'CREATE UNIQUE INDEX IF NOT EXISTS agent_eval_case_result_uq ON kcml.agent_eval_case_result(eval_run_id,eval_case_id)'
  ]],
  ['system_chat_message', [
    'CREATE UNIQUE INDEX IF NOT EXISTS system_chat_message_sequence_uq ON kcml.system_chat_message(conversation_id,sequence)',
    "CREATE UNIQUE INDEX IF NOT EXISTS system_chat_assistant_causation_uq ON kcml.system_chat_message(causation_id) WHERE role = 'ASSISTANT' AND causation_id IS NOT NULL"
  ]],
  ['system_chat_action', [
    'CREATE UNIQUE INDEX IF NOT EXISTS system_chat_action_operation_uq ON kcml.system_chat_action(message_id,operation_key,arguments_digest)'
  ]],
  ['component_revision', [
    'CREATE UNIQUE INDEX IF NOT EXISTS component_revision_semver_uq ON kcml.component_revision(component_id,semantic_version)',
    'CREATE UNIQUE INDEX IF NOT EXISTS component_revision_manifest_uq ON kcml.component_revision(component_id,manifest_digest)'
  ]],
  ['mcp_server_revision_profile', [
    'CREATE UNIQUE INDEX IF NOT EXISTS mcp_server_revision_profile_revision_uq ON kcml.mcp_server_revision_profile(component_id,revision_id)'
  ]],
  ['mcp_registration_probe', [
    'CREATE UNIQUE INDEX IF NOT EXISTS mcp_registration_probe_evidence_uq ON kcml.mcp_registration_probe(external_server_id,external_server_revision_id,attempted_era,evidence_digest)'
  ]],
  ['mcp_discovery_snapshot', [
    "CREATE UNIQUE INDEX IF NOT EXISTS mcp_discovery_snapshot_cache_context_uq ON kcml.mcp_discovery_snapshot(cache_key_digest,exposure_fingerprint,COALESCE(binding_revision,-1),COALESCE(page_cursor,'')) WHERE state = 'FRESH'"
  ]],
  ['mcp_discovery_item', [
    'CREATE UNIQUE INDEX IF NOT EXISTS mcp_discovery_item_element_uq ON kcml.mcp_discovery_item(snapshot_id,kind,element_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS mcp_discovery_item_sort_uq ON kcml.mcp_discovery_item(snapshot_id,sort_key)'
  ]],
  ['mcp_request_event', [
    'CREATE UNIQUE INDEX IF NOT EXISTS mcp_request_event_active_transport_id_uq ON kcml.mcp_request_event(inflight_source_scope,request_id_type,request_id_value) WHERE request_id_value IS NOT NULL AND completed_at IS NULL'
  ]],
  ['mcp_call_progress', [
    'CREATE UNIQUE INDEX IF NOT EXISTS mcp_call_progress_sequence_uq ON kcml.mcp_call_progress(call_run_id,sequence)',
    'CREATE UNIQUE INDEX IF NOT EXISTS mcp_call_progress_stream_sequence_uq ON kcml.mcp_call_progress(response_stream_id,sequence)'
  ]],
  ['mcp_input_request_item', [
    'CREATE UNIQUE INDEX IF NOT EXISTS mcp_input_request_item_key_uq ON kcml.mcp_input_request_item(input_exchange_id,request_key)'
  ]],
  ['mcp_input_response_item', [
    'CREATE UNIQUE INDEX IF NOT EXISTS mcp_input_response_item_retry_key_uq ON kcml.mcp_input_response_item(input_exchange_id,retry_request_event_id,supplied_key)'
  ]],
  ['mcp_subscription', [
    'CREATE UNIQUE INDEX IF NOT EXISTS mcp_subscription_request_uq ON kcml.mcp_subscription(server_component_id,source_execution_context_id,request_id_type,request_id_value)'
  ]],
  ['mcp_subscription_notification', [
    'CREATE UNIQUE INDEX IF NOT EXISTS mcp_subscription_notification_sequence_uq ON kcml.mcp_subscription_notification(subscription_id,sequence)'
  ]],
  ['mcp_state_handle', [
    'CREATE UNIQUE INDEX IF NOT EXISTS mcp_state_handle_public_id_uq ON kcml.mcp_state_handle(public_opaque_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS mcp_state_handle_lookup_uq ON kcml.mcp_state_handle(lookup_digest)',
    'CREATE UNIQUE INDEX IF NOT EXISTS mcp_state_handle_generation_uq ON kcml.mcp_state_handle(generation_nonce)'
  ]],
  ['mcp_task_input_request', [
    'CREATE UNIQUE INDEX IF NOT EXISTS mcp_task_input_request_key_uq ON kcml.mcp_task_input_request(task_id,request_key)'
  ]],
  ['mcp_task_input_response', [
    'CREATE UNIQUE INDEX IF NOT EXISTS mcp_task_input_response_key_uq ON kcml.mcp_task_input_response(task_id,update_request_event_id,supplied_key)'
  ]],
  ['mcp_task_event', [
    'CREATE UNIQUE INDEX IF NOT EXISTS mcp_task_event_sequence_uq ON kcml.mcp_task_event(task_id,sequence)'
  ]],
  ['mcp_idempotency_record', [
    'CREATE UNIQUE INDEX IF NOT EXISTS mcp_idempotency_business_scope_uq ON kcml.mcp_idempotency_record(server_component_id,tool_key,operation_contract_revision_id,caller_authority_kind,source_object_id,source_revision_id,access_fingerprint,idempotency_key)'
  ]],
  ['runtime_execution_context', [
    'CREATE UNIQUE INDEX IF NOT EXISTS runtime_execution_context_attempt_uq ON kcml.runtime_execution_context(execution_attempt_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS runtime_execution_context_digest_uq ON kcml.runtime_execution_context(context_digest)'
  ]],
  ['runtime_process_identity', [
    'CREATE UNIQUE INDEX IF NOT EXISTS runtime_process_identity_kernel_uq ON kcml.runtime_process_identity(host_boot_id,linux_pid,process_start_ticks)',
    'CREATE UNIQUE INDEX IF NOT EXISTS runtime_process_identity_generation_role_uq ON kcml.runtime_process_identity(runtime_instance_id,runtime_generation,process_role,linux_pid)'
  ]],
  ['runtime_ipc_connection', [
    'CREATE UNIQUE INDEX IF NOT EXISTS runtime_ipc_connection_socket_peer_uq ON kcml.runtime_ipc_connection(socket_device,socket_inode,peer_boot_id,peer_pid,peer_start_ticks) WHERE socket_inode IS NOT NULL'
  ]],
  ['runtime_ipc_call', [
    'CREATE UNIQUE INDEX IF NOT EXISTS runtime_ipc_call_sequence_uq ON kcml.runtime_ipc_call(connection_id,sequence)',
    'CREATE UNIQUE INDEX IF NOT EXISTS runtime_ipc_call_request_uq ON kcml.runtime_ipc_call(connection_id,request_id)'
  ]]
]);
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
baseline.push('BEGIN;', '', '-- AUTO-GENERATED exact Chapter-25 physical schema projection.', '-- Column, index, constraint and lifecycle evidence is emitted into postgres-schema-contracts.json and verified against PostgreSQL.', `-- SSOT surface fingerprint: ${fingerprint}`, '');
for (const entity of missing) {
  const table = q(entity.name);
  baseline.push(`CREATE TABLE IF NOT EXISTS kcml.${table} (`);
  baseline.push('  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),');
  baseline.push('  parent_id uuid,');
  baseline.push('  stable_key text,');
  baseline.push('  display_name text,');
  baseline.push("  lifecycle text NOT NULL DEFAULT 'ACTIVE',");
  const columns = exactColumns.get(entity.name);
  if (columns) for (const [name, definition] of columns) baseline.push(`  ${q(name)} ${definition},`);
  else baseline.push("  document jsonb NOT NULL DEFAULT '{}'::jsonb,");
  // PostgreSQL generated columns require immutable expressions. The digest is
  // written by the canonical command transaction after validating the entity
  // contract, so it is an ordinary persisted value rather than a JSONB shortcut.
  baseline.push('  canonical_digest bytea NOT NULL,');
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
  if (entity.immutable) {
    baseline.push(`DROP TRIGGER IF EXISTS immutable_row ON kcml.${table};`);
    baseline.push(`CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml.${table} FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();`);
  } else {
    baseline.push(`DROP TRIGGER IF EXISTS touch_mutable_row ON kcml.${table};`);
    baseline.push(`CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml.${table} FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();`);
  }
  baseline.push('');
  for (const index of exactIndexes.get(entity.name) ?? []) baseline.push(`${index};`);
  if ((exactIndexes.get(entity.name) ?? []).length > 0) baseline.push('');
}
for (const entity of entities) {
  baseline.push(`COMMENT ON TABLE kcml.${q(entity.name)} IS ${sqlLiteral(`SSOT_CURRENT.md chapter 25 entity ${entity.name}; contract sha256 ${entity.contractDigest}`)};`);
}
baseline.push('');
baseline.push('ALTER TABLE kcml.ai_model_call DROP CONSTRAINT IF EXISTS ai_model_call_request_descriptor_fk;');
baseline.push('ALTER TABLE kcml.ai_model_call ADD CONSTRAINT ai_model_call_request_descriptor_fk FOREIGN KEY (request_descriptor_id) REFERENCES kcml.openai_request_descriptor(id);');
baseline.push('');
for (const [table, name, columns, target] of [
  ['component','component_active_revision_fk','active_revision_id','component_revision(id)'],
  ['component','component_current_release_fk','current_release_id','component_release(id)'],
  ['component','component_binding_set_revision_fk','active_binding_set_revision_id','binding_set_revision(id)'],
  ['component_audit_stream','component_audit_stream_component_fk','component_id','component(id)'],
  ['component_audit_event','component_audit_event_stream_fk','stream_id','component_audit_stream(id)'],
  ['runtime_instance','runtime_instance_component_fk','component_id','component(id)'],
  ['runtime_instance','runtime_instance_target_fk','runtime_target_id','component_runtime_target(id)'],
  ['runtime_instance','runtime_instance_revision_fk','source_revision_id','component_revision(id)'],
  ['runtime_instance','runtime_instance_release_fk','release_id','component_release(id)'],
  ['mcp_call_run','mcp_call_run_request_event_fk','request_event_id','mcp_request_event(id)'],
  ['mcp_call_run','mcp_call_run_idempotency_fk','idempotency_record_id','mcp_idempotency_record(id)'],
  ['mcp_call_run','mcp_call_run_component_fk','server_component_id','component(id)'],
  ['mcp_call_run','mcp_call_run_revision_fk','server_revision_id','component_revision(id)'],
  ['mcp_call_run','mcp_call_run_execution_context_fk','source_execution_context_id','runtime_execution_context(id)'],
  ['mcp_input_exchange','mcp_input_exchange_retry_event_fk','retry_request_event_id','mcp_request_event(id)'],
  ['mcp_task','mcp_task_component_fk','server_component_id','component(id)'],
  ['mcp_task','mcp_task_revision_fk','server_revision_id','component_revision(id)'],
  ['mcp_task','mcp_task_execution_context_fk','source_execution_context_id','runtime_execution_context(id)'],
  ['agent_session_compaction','agent_session_compaction_session_fk','session_id','agent_session(id)'],
  ['agent_definition','agent_definition_active_revision_fk','active_revision_id','agent_revision(id)'],
  ['agent_session','agent_session_active_compaction_fk','active_compaction_id','agent_session_compaction(id)'],
  ['agent_run','agent_run_definition_fk','agent_definition_id','agent_definition(id)'],
  ['agent_run','agent_run_revision_fk','agent_revision_id','agent_revision(id)'],
  ['agent_run','agent_run_execution_context_fk','source_execution_context_id','runtime_execution_context(id)'],
  ['agent_run','agent_run_trigger_fk','trigger_id','agent_trigger(id)'],
  ['agent_run','agent_run_session_fk','session_id','agent_session(id)'],
  ['agent_run','agent_run_checkpoint_fk','latest_checkpoint_id','agent_run_checkpoint(id)'],
  ['system_chat_conversation','system_chat_conversation_agent_fk','agent_definition_id','agent_definition(id)'],
  ['system_chat_conversation','system_chat_conversation_session_fk','agent_session_id','agent_session(id)'],
  ['system_chat_message','system_chat_message_model_call_fk','model_call_id','ai_model_call(id)'],
  ['deployment_step','deployment_step_run_fk','deployment_run_id','deployment_run(id)'],
  ['deployment_step','deployment_step_side_effect_fk','side_effect_operation_id','side_effect_operation(id)'],
  ['operational_setting_applied','operational_setting_applied_setting_fk','operational_setting_id','operational_setting(id)'],
  ['operational_setting_applied','operational_setting_applied_run_fk','configuration_apply_run_id','configuration_apply_run(id)'],
  ['activation_domain_barrier','activation_domain_barrier_set_fk','activation_set_id','generation_activation_set(id)'],
  ['authority_lineage','authority_lineage_creator_context_fk','creator_execution_context_id','runtime_execution_context(id)'],
  ['operation_context','operation_context_intent_fk','operation_intent_id','operation_intent(id)'],
  ['semantic_action_plan','semantic_action_plan_model_call_fk','producing_model_call_id','ai_model_call(id)'],
  ['semantic_action_plan','semantic_action_plan_output_item_fk','producing_output_item_id','ai_model_output_item(id)'],
  ['value_derivation','value_derivation_plan_fk','semantic_action_plan_id','semantic_action_plan(id)'],
  ['secret_use_context','secret_use_context_plan_fk','semantic_action_plan_id','semantic_action_plan(id)'],
  ['agentic_security_event','agentic_security_event_context_fk','operation_context_id','operation_context(id)'],
  ['agentic_security_event','agentic_security_event_lineage_fk','authority_lineage_id','authority_lineage(id)'],
  ['agentic_security_event','agentic_security_event_provenance_fk','content_provenance_id','content_provenance(id)'],
  ['agentic_security_event','agentic_security_event_plan_fk','semantic_action_plan_id','semantic_action_plan(id)'],
  ['browser_host_slot','browser_host_slot_process_identity_fk','process_identity_id','runtime_process_identity(id)'],
  ['browser_context_instance','browser_context_bridge_fk','bridge_id','browser_local_bridge(id)'],
  ['browser_context_instance','browser_context_account_fk','account_binding_id','browser_account_binding(id)'],
  ['browser_context_instance','browser_context_bundle_fk','restored_bundle_version_id','browser_state_bundle(id)'],
  ['browser_page','browser_page_current_document_fk','current_document_id','browser_document(id)'],
  ['browser_page','browser_page_top_frame_fk','top_frame_id','browser_frame(id)'],
  ['browser_page','browser_page_creation_action_fk','creation_action_id','browser_action_run(id)'],
  ['browser_frame','browser_frame_current_document_fk','current_document_id','browser_document(id)'],
  ['browser_document','browser_document_initial_observation_fk','initial_observation_id','browser_observation(id)'],
  ['browser_document','browser_document_last_observation_fk','last_observation_id','browser_observation(id)'],
  ['browser_navigation','browser_navigation_document_fk','document_id','browser_document(id)'],
  ['browser_navigation','browser_navigation_action_fk','causation_action_id','browser_action_run(id)'],
  ['browser_navigation','browser_navigation_input_event_fk','causation_input_event_id','browser_input_event(id)'],
  ['browser_control_transfer','browser_control_transfer_action_fk','current_action_id','browser_action_run(id)'],
  ['browser_input_event','browser_input_event_action_fk','resulting_action_id','browser_action_run(id)'],
  ['browser_irreversible_confirmation','browser_confirmation_action_fk','action_run_id','browser_action_run(id)'],
  ['browser_irreversible_confirmation','browser_confirmation_automation_run_fk','automation_run_id','browser_automation_run(id)'],
  ['browser_auth_attempt','browser_auth_attempt_account_fk','account_binding_id','browser_account_binding(id)'],
  ['browser_auth_attempt','browser_auth_attempt_challenge_fk','challenge_id','browser_challenge(id)'],
  ['browser_auth_attempt','browser_auth_attempt_side_effect_fk','side_effect_operation_id','side_effect_operation(id)'],
  ['browser_bridge_assignment','browser_bridge_assignment_scope_fk','operation_scope_id','browser_operation_scope(id)'],
  ['browser_bridge_assignment','browser_bridge_assignment_account_fk','account_binding_id','browser_account_binding(id)'],
  ['browser_profile_lease','browser_profile_lease_bridge_fk','bridge_id','browser_local_bridge(id)'],
  ['browser_profile_lease','browser_profile_lease_account_fk','account_binding_id','browser_account_binding(id)'],
  ['browser_dialog','browser_dialog_challenge_fk','challenge_id','browser_challenge(id)'],
  ['browser_permission_request','browser_permission_context_fk','context_instance_id','browser_context_instance(id)'],
  ['browser_permission_request','browser_permission_challenge_fk','challenge_id','browser_challenge(id)'],
  ['browser_teaching_run','browser_teaching_scope_fk','operation_scope_id','browser_operation_scope(id)'],
  ['browser_teaching_run','browser_teaching_candidate_revision_fk','candidate_automation_revision_id','browser_automation_revision(id)'],
  ['browser_automation_definition','browser_automation_owner_component_fk','owner_component_id','component(id)'],
  ['browser_automation_definition','browser_automation_active_revision_fk','active_revision_id','browser_automation_revision(id)'],
  ['browser_automation_run','browser_automation_run_scope_fk','operation_scope_id','browser_operation_scope(id)'],
  ['browser_automation_run','browser_automation_run_account_fk','account_binding_id','browser_account_binding(id)'],
  ['browser_automation_artifact','browser_automation_artifact_run_fk','automation_run_id','browser_automation_run(id)'],
  ['browser_automation_artifact','browser_automation_artifact_action_fk','action_run_id','browser_action_run(id)'],
  ['browser_auth_binding','browser_auth_binding_account_fk','account_binding_id','browser_account_binding(id)'],
  ['browser_challenge','browser_challenge_run_fk','automation_run_id','browser_automation_run(id)'],
  ['browser_challenge','browser_challenge_account_fk','account_binding_id','browser_account_binding(id)']
]) {
  baseline.push(`ALTER TABLE kcml.${table} DROP CONSTRAINT IF EXISTS ${name};`);
  baseline.push(`ALTER TABLE kcml.${table} ADD CONSTRAINT ${name} FOREIGN KEY (${columns}) REFERENCES kcml.${target};`);
}
baseline.push('');
baseline.push(`CREATE OR REPLACE FUNCTION kcml.current_database_start_identity() RETURNS bytea LANGUAGE sql STABLE STRICT AS $$
  SELECT digest(control.system_identifier::text || ':' || pg_postmaster_start_time()::text, 'sha256')
  FROM pg_control_system() AS control
$$;`);
baseline.push(`CREATE TABLE IF NOT EXISTS kcml.platform_recovery_head (
  singleton_key smallint PRIMARY KEY DEFAULT 1 CHECK (singleton_key = 1),
  database_start_identity bytea NOT NULL CHECK (octet_length(database_start_identity) = 32),
  platform_incarnation_id uuid NOT NULL,
  application_deployment_epoch bigint NOT NULL CHECK (application_deployment_epoch >= 0),
  recovery_epoch bigint NOT NULL UNIQUE CHECK (recovery_epoch > 0),
  state text NOT NULL CHECK (state IN ('STARTING','RECONCILING','READY','BLOCKED','MANUAL_REVIEW')),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  current_attempt_id uuid,
  current_fencing_token bigint NOT NULL DEFAULT 0 CHECK (current_fencing_token >= 0),
  ready_evidence_digest bytea,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (state <> 'READY' OR (ready_evidence_digest IS NOT NULL AND octet_length(ready_evidence_digest) = 32))
);`);
baseline.push(`INSERT INTO kcml.platform_recovery_head(singleton_key,database_start_identity,platform_incarnation_id,application_deployment_epoch,recovery_epoch,state,ready_evidence_digest)
  SELECT 1,kcml.current_database_start_identity(),p.platform_incarnation_id,d.current_epoch,1,'READY',
    digest('GREENFIELD_EMPTY_INVENTORY' || encode(kcml.current_database_start_identity(),'hex') || p.platform_incarnation_id::text || d.current_epoch::text,'sha256')
  FROM kcml.platform_incarnation p CROSS JOIN kcml.application_deployment_head d
  WHERE p.singleton_key=1 AND d.singleton_key=1
  ON CONFLICT(singleton_key) DO NOTHING;`);
baseline.push('DROP TRIGGER IF EXISTS protect_singleton ON kcml.platform_recovery_head;');
baseline.push('CREATE TRIGGER protect_singleton BEFORE UPDATE OR DELETE ON kcml.platform_recovery_head FOR EACH ROW EXECUTE FUNCTION kcml.protect_singleton();');
baseline.push('ALTER TABLE kcml.domain_command ADD COLUMN IF NOT EXISTS recovery_epoch bigint NOT NULL DEFAULT 1 CHECK (recovery_epoch > 0);');
baseline.push('ALTER TABLE kcml.queue_item ADD COLUMN IF NOT EXISTS recovery_epoch bigint NOT NULL DEFAULT 1 CHECK (recovery_epoch > 0);');
baseline.push('ALTER TABLE kcml.side_effect_operation ADD COLUMN IF NOT EXISTS recovery_epoch bigint NOT NULL DEFAULT 1 CHECK (recovery_epoch > 0);');
baseline.push('ALTER TABLE kcml.concurrency_claim ADD COLUMN IF NOT EXISTS recovery_epoch bigint NOT NULL DEFAULT 1 CHECK (recovery_epoch > 0);');
baseline.push('ALTER TABLE kcml.transactional_outbox ADD COLUMN IF NOT EXISTS recovery_epoch bigint NOT NULL DEFAULT 1 CHECK (recovery_epoch > 0);');
baseline.push('ALTER TABLE kcml.domain_command DROP CONSTRAINT IF EXISTS domain_command_concurrency_claim_fk;');
baseline.push('ALTER TABLE kcml.domain_command ADD CONSTRAINT domain_command_concurrency_claim_fk FOREIGN KEY (concurrency_claim_id) REFERENCES kcml.concurrency_claim(id);');
baseline.push('ALTER TABLE kcml.queue_item DROP CONSTRAINT IF EXISTS queue_item_concurrency_claim_fk;');
baseline.push('ALTER TABLE kcml.queue_item ADD CONSTRAINT queue_item_concurrency_claim_fk FOREIGN KEY (concurrency_claim_id) REFERENCES kcml.concurrency_claim(id);');
baseline.push('');
baseline.push(`CREATE TABLE IF NOT EXISTS kcml.domain_command_execution_checkpoint (
  command_id uuid PRIMARY KEY REFERENCES kcml.domain_command(id),
  logical_operation_id uuid NOT NULL UNIQUE,
  checkpoint_revision bigint NOT NULL DEFAULT 1 CHECK (checkpoint_revision > 0),
  checkpoint_state text NOT NULL CHECK (checkpoint_state = 'APPLIED'),
  output jsonb NOT NULL,
  output_digest bytea NOT NULL CHECK (octet_length(output_digest) = 32),
  concurrency_claim_id uuid NOT NULL REFERENCES kcml.concurrency_claim(id),
  concurrency_fencing_token bigint NOT NULL CHECK (concurrency_fencing_token > 0),
  recovery_epoch bigint NOT NULL CHECK (recovery_epoch > 0),
  platform_incarnation_id uuid NOT NULL,
  application_deployment_epoch bigint NOT NULL CHECK (application_deployment_epoch >= 0),
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (output_digest = digest(convert_to(output::text,'UTF8'),'sha256'))
);`);
baseline.push('DROP TRIGGER IF EXISTS immutable_row ON kcml.domain_command_execution_checkpoint;');
baseline.push('CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml.domain_command_execution_checkpoint FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();');
baseline.push('');
baseline.push(`CREATE TABLE IF NOT EXISTS kcml.platform_recovery_attempt (
  id uuid PRIMARY KEY,
  database_start_identity bytea NOT NULL CHECK (octet_length(database_start_identity) = 32),
  platform_incarnation_id uuid NOT NULL,
  application_deployment_epoch bigint NOT NULL CHECK (application_deployment_epoch >= 0),
  recovery_epoch bigint NOT NULL UNIQUE CHECK (recovery_epoch > 0),
  state text NOT NULL CHECK (state IN ('STARTING','RECONCILING','READY','BLOCKED','MANUAL_REVIEW')),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  lease_owner uuid NOT NULL,
  lease_fencing_token bigint NOT NULL CHECK (lease_fencing_token > 0),
  lease_expires_at timestamptz NOT NULL,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  inventory_watermark jsonb,
  first_inventory_digest bytea,
  stable_inventory_digest bytea,
  schema_constraint_digest bytea NOT NULL CHECK (octet_length(schema_constraint_digest) = 32),
  classification_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  unresolved_object_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_digest bytea,
  CHECK ((state IN ('READY','BLOCKED','MANUAL_REVIEW')) = (finished_at IS NOT NULL)),
  CHECK (evidence_digest IS NULL OR octet_length(evidence_digest) = 32),
  CHECK (first_inventory_digest IS NULL OR octet_length(first_inventory_digest) = 32),
  CHECK (stable_inventory_digest IS NULL OR octet_length(stable_inventory_digest) = 32)
);`);
baseline.push(`CREATE TABLE IF NOT EXISTS kcml.platform_recovery_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recovery_attempt_id uuid NOT NULL REFERENCES kcml.platform_recovery_attempt(id),
  owner_kind text NOT NULL,
  owner_id text NOT NULL,
  classification_revision bigint NOT NULL DEFAULT 1 CHECK (classification_revision > 0),
  classification text NOT NULL CHECK (classification IN ('TERMINAL_REPLAY','RESUME','RECONCILE','CANCEL','CLEANUP','MANUAL_REVIEW')),
  inventory_digest bytea NOT NULL CHECK (octet_length(inventory_digest) = 32),
  successor_kind text,
  successor_id text,
  blocking boolean NOT NULL,
  evidence jsonb NOT NULL,
  recovery_epoch bigint NOT NULL CHECK (recovery_epoch > 0),
  recovery_fencing_token bigint NOT NULL CHECK (recovery_fencing_token > 0),
  classified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (recovery_attempt_id, owner_kind, owner_id, classification_revision),
  CHECK ((classification = 'MANUAL_REVIEW') = blocking),
  CHECK ((classification IN ('RESUME','RECONCILE','CANCEL','CLEANUP','TERMINAL_REPLAY') AND successor_kind IS NOT NULL AND successor_id IS NOT NULL) OR classification = 'MANUAL_REVIEW')
);`);
baseline.push('DROP TRIGGER IF EXISTS immutable_row ON kcml.platform_recovery_item;');
baseline.push('CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml.platform_recovery_item FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();');
baseline.push('ALTER TABLE kcml.platform_recovery_head DROP CONSTRAINT IF EXISTS platform_recovery_head_attempt_fk;');
baseline.push('ALTER TABLE kcml.platform_recovery_head ADD CONSTRAINT platform_recovery_head_attempt_fk FOREIGN KEY (current_attempt_id) REFERENCES kcml.platform_recovery_attempt(id);');
baseline.push(`CREATE OR REPLACE FUNCTION kcml.guard_platform_recovery_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'platform recovery attempt deletion is forbidden' USING ERRCODE='55000'; END IF;
  IF OLD.finished_at IS NOT NULL THEN RAISE EXCEPTION 'finished platform recovery attempt is immutable' USING ERRCODE='55000'; END IF;
  IF NEW.state_version<=OLD.state_version OR NEW.lease_fencing_token<OLD.lease_fencing_token OR NEW.recovery_epoch<>OLD.recovery_epoch THEN RAISE EXCEPTION 'platform recovery attempt version or fence is stale' USING ERRCODE='40001'; END IF;
  IF NOT (NEW.state=OLD.state OR (OLD.state='STARTING' AND NEW.state='RECONCILING') OR (OLD.state='RECONCILING' AND NEW.state IN ('READY','BLOCKED','MANUAL_REVIEW'))) THEN RAISE EXCEPTION 'invalid platform recovery attempt transition % -> %',OLD.state,NEW.state USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;`);
baseline.push('DROP TRIGGER IF EXISTS guard_lifecycle ON kcml.platform_recovery_attempt;');
baseline.push('CREATE TRIGGER guard_lifecycle BEFORE UPDATE OR DELETE ON kcml.platform_recovery_attempt FOR EACH ROW EXECUTE FUNCTION kcml.guard_platform_recovery_attempt();');
baseline.push(`CREATE OR REPLACE FUNCTION kcml.guard_platform_recovery_head() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'platform recovery head deletion is forbidden' USING ERRCODE='55000'; END IF;
  IF NEW.state_version<=OLD.state_version OR NEW.recovery_epoch<OLD.recovery_epoch OR NEW.current_fencing_token<OLD.current_fencing_token THEN RAISE EXCEPTION 'platform recovery head version, epoch or fence is stale' USING ERRCODE='40001'; END IF;
  IF NEW.recovery_epoch>OLD.recovery_epoch THEN
    IF NEW.recovery_epoch<>OLD.recovery_epoch+1 OR NEW.state<>'STARTING' OR NEW.current_attempt_id IS NULL THEN RAISE EXCEPTION 'new recovery epoch must begin at STARTING with exact successor epoch and attempt' USING ERRCODE='23514'; END IF;
  ELSIF NOT (NEW.state=OLD.state OR (OLD.state='STARTING' AND NEW.state='RECONCILING') OR (OLD.state='RECONCILING' AND NEW.state IN ('READY','BLOCKED','MANUAL_REVIEW')) OR (OLD.state IN ('BLOCKED','MANUAL_REVIEW') AND NEW.state='RECONCILING') OR (OLD.state='READY' AND NEW.state='STARTING')) THEN
    RAISE EXCEPTION 'invalid platform recovery head transition % -> %',OLD.state,NEW.state USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;`);
baseline.push('DROP TRIGGER IF EXISTS guard_lifecycle ON kcml.platform_recovery_head;');
baseline.push('CREATE TRIGGER guard_lifecycle BEFORE UPDATE OR DELETE ON kcml.platform_recovery_head FOR EACH ROW EXECUTE FUNCTION kcml.guard_platform_recovery_head();');
baseline.push('');
baseline.push(`CREATE TABLE IF NOT EXISTS kcml.capacity_reservation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capacity_kind text NOT NULL,
  reservation_key text NOT NULL,
  reservation_class text NOT NULL CHECK (reservation_class IN ('REGULAR','RECOVERY','CLEANUP')),
  owner_kind text NOT NULL,
  owner_id text NOT NULL,
  reserved_units bigint NOT NULL CHECK (reserved_units > 0),
  fencing_token bigint NOT NULL CHECK (fencing_token > 0),
  recovery_epoch bigint NOT NULL CHECK (recovery_epoch > 0),
  acquired_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  released_at timestamptz,
  release_evidence_digest bytea,
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  platform_incarnation_id uuid NOT NULL,
  application_deployment_epoch bigint NOT NULL CHECK (application_deployment_epoch >= 0),
  CHECK (expires_at > acquired_at),
  CHECK ((released_at IS NULL) = (release_evidence_digest IS NULL)),
  CHECK (release_evidence_digest IS NULL OR octet_length(release_evidence_digest) = 32)
);`);
baseline.push(`CREATE UNIQUE INDEX IF NOT EXISTS capacity_reservation_active_uq ON kcml.capacity_reservation(capacity_kind,reservation_key) WHERE released_at IS NULL;`);
baseline.push(`CREATE OR REPLACE FUNCTION kcml.guard_capacity_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'capacity reservation deletion is forbidden' USING ERRCODE='55000'; END IF;
  IF NEW.state_version<=OLD.state_version OR NEW.fencing_token<>OLD.fencing_token OR NEW.recovery_epoch<>OLD.recovery_epoch OR NEW.reserved_units<>OLD.reserved_units THEN RAISE EXCEPTION 'capacity reservation authority is immutable or stale' USING ERRCODE='40001'; END IF;
  IF OLD.released_at IS NOT NULL THEN RAISE EXCEPTION 'released capacity reservation is immutable' USING ERRCODE='55000'; END IF;
  IF NEW.released_at IS NULL OR NEW.release_evidence_digest IS NULL THEN RAISE EXCEPTION 'capacity release requires timestamp and evidence digest' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;`);
baseline.push('DROP TRIGGER IF EXISTS guard_lifecycle ON kcml.capacity_reservation;');
baseline.push('CREATE TRIGGER guard_lifecycle BEFORE UPDATE OR DELETE ON kcml.capacity_reservation FOR EACH ROW EXECUTE FUNCTION kcml.guard_capacity_reservation();');
baseline.push(`CREATE TABLE IF NOT EXISTS kcml.artifact_publication (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_owner_kind text NOT NULL,
  artifact_owner_id text NOT NULL,
  logical_name text NOT NULL,
  publication_revision bigint NOT NULL CHECK (publication_revision > 0),
  artifact_state text NOT NULL CHECK (artifact_state IN ('INTENT_RECORDED','WRITING','FILE_FSYNCED','VALIDATED','PARENT_FSYNCED','RENAMED','PUBLISHED','CLEANUP_PENDING','CLEANED','FAILED','MANUAL_REVIEW')),
  temp_path_identity text NOT NULL,
  expected_size bigint NOT NULL CHECK (expected_size >= 0),
  expected_digest bytea NOT NULL CHECK (octet_length(expected_digest) = 32),
  final_content_address text,
  final_size bigint,
  final_digest bytea,
  mime_type text NOT NULL,
  validation_evidence jsonb,
  file_fsynced_at timestamptz,
  parent_directory_fsynced_at timestamptz,
  renamed_at timestamptz,
  pointer_committed_at timestamptz,
  temp_cleanup_at timestamptz,
  failure jsonb,
  recovery_epoch bigint NOT NULL CHECK (recovery_epoch > 0),
  fencing_token bigint NOT NULL CHECK (fencing_token > 0),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  platform_incarnation_id uuid NOT NULL,
  application_deployment_epoch bigint NOT NULL CHECK (application_deployment_epoch >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (artifact_owner_kind,artifact_owner_id,logical_name,publication_revision),
  UNIQUE (id,artifact_state,final_digest),
  CHECK (final_size IS NULL OR final_size >= 0),
  CHECK (final_digest IS NULL OR octet_length(final_digest) = 32),
  CHECK (artifact_state <> 'PUBLISHED' OR (final_digest IS NOT NULL AND final_size=expected_size AND final_digest=expected_digest AND final_content_address IS NOT NULL AND validation_evidence IS NOT NULL AND file_fsynced_at IS NOT NULL AND parent_directory_fsynced_at IS NOT NULL AND renamed_at IS NOT NULL AND pointer_committed_at IS NOT NULL))
);`);
baseline.push(`CREATE TABLE IF NOT EXISTS kcml.artifact_current_pointer (
  artifact_owner_kind text NOT NULL,
  artifact_owner_id text NOT NULL,
  logical_name text NOT NULL,
  publication_id uuid NOT NULL,
  publication_state text NOT NULL DEFAULT 'PUBLISHED' CHECK (publication_state='PUBLISHED'),
  final_digest bytea NOT NULL CHECK (octet_length(final_digest)=32),
  pointer_revision bigint NOT NULL CHECK (pointer_revision>0),
  committed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (artifact_owner_kind,artifact_owner_id,logical_name),
  FOREIGN KEY (publication_id,publication_state,final_digest) REFERENCES kcml.artifact_publication(id,artifact_state,final_digest)
);`);
baseline.push(`CREATE OR REPLACE FUNCTION kcml.guard_artifact_publication() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed boolean := false;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.artifact_state<>'INTENT_RECORDED' THEN RAISE EXCEPTION 'artifact publication must begin at INTENT_RECORDED' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'artifact publication deletion is forbidden' USING ERRCODE='55000'; END IF;
  IF NEW.state_version<=OLD.state_version OR NEW.fencing_token<>OLD.fencing_token OR NEW.recovery_epoch<>OLD.recovery_epoch THEN RAISE EXCEPTION 'artifact publication version or authority is stale' USING ERRCODE='40001'; END IF;
  IF OLD.artifact_state IN ('CLEANED','FAILED') THEN RAISE EXCEPTION 'terminal artifact publication is immutable' USING ERRCODE='55000'; END IF;
  allowed := NEW.artifact_state=OLD.artifact_state OR
    (OLD.artifact_state='INTENT_RECORDED' AND NEW.artifact_state IN ('WRITING','FAILED','MANUAL_REVIEW')) OR
    (OLD.artifact_state='WRITING' AND NEW.artifact_state IN ('FILE_FSYNCED','FAILED','MANUAL_REVIEW')) OR
    (OLD.artifact_state='FILE_FSYNCED' AND NEW.artifact_state IN ('VALIDATED','FAILED','MANUAL_REVIEW')) OR
    (OLD.artifact_state='VALIDATED' AND NEW.artifact_state IN ('PARENT_FSYNCED','FAILED','MANUAL_REVIEW')) OR
    (OLD.artifact_state='PARENT_FSYNCED' AND NEW.artifact_state IN ('RENAMED','FAILED','MANUAL_REVIEW')) OR
    (OLD.artifact_state='RENAMED' AND NEW.artifact_state IN ('PUBLISHED','CLEANUP_PENDING','FAILED','MANUAL_REVIEW')) OR
    (OLD.artifact_state='PUBLISHED' AND NEW.artifact_state='CLEANUP_PENDING') OR
    (OLD.artifact_state='CLEANUP_PENDING' AND NEW.artifact_state IN ('CLEANED','MANUAL_REVIEW')) OR
    (OLD.artifact_state='MANUAL_REVIEW' AND NEW.artifact_state IN ('WRITING','CLEANUP_PENDING','FAILED'));
  IF NOT allowed THEN RAISE EXCEPTION 'invalid artifact publication transition % -> %',OLD.artifact_state,NEW.artifact_state USING ERRCODE='23514'; END IF;
  IF NEW.artifact_state='CLEANED' AND EXISTS(SELECT 1 FROM kcml.artifact_current_pointer pointer WHERE pointer.publication_id=OLD.id) THEN RAISE EXCEPTION 'current artifact pointer prevents cleanup' USING ERRCODE='23514'; END IF;
  NEW.updated_at:=clock_timestamp();RETURN NEW;
END $$;`);
baseline.push('DROP TRIGGER IF EXISTS guard_lifecycle ON kcml.artifact_publication;');
baseline.push('CREATE TRIGGER guard_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON kcml.artifact_publication FOR EACH ROW EXECUTE FUNCTION kcml.guard_artifact_publication();');
baseline.push('');
baseline.push(`CREATE TABLE IF NOT EXISTS kcml.terminal_closure_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  terminal_root_kind text NOT NULL,
  terminal_root_id uuid NOT NULL,
  terminal_state_version bigint NOT NULL CHECK (terminal_state_version > 0),
  closure_version bigint NOT NULL CHECK (closure_version > 0),
  blocking_query_catalog_digest bytea NOT NULL CHECK (octet_length(blocking_query_catalog_digest) = 32),
  inventory_watermarks jsonb NOT NULL,
  predicate_results jsonb NOT NULL,
  result_digest bytea NOT NULL CHECK (octet_length(result_digest) = 32),
  logical_operation_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  platform_incarnation_id uuid NOT NULL,
  application_deployment_epoch bigint NOT NULL CHECK (application_deployment_epoch >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (terminal_root_kind, terminal_root_id, terminal_state_version)
);`);
baseline.push('DROP TRIGGER IF EXISTS immutable_row ON kcml.terminal_closure_evidence;');
baseline.push('CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml.terminal_closure_evidence FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();');
baseline.push('CREATE INDEX IF NOT EXISTS terminal_closure_evidence_root_idx ON kcml.terminal_closure_evidence(terminal_root_kind,terminal_root_id,terminal_state_version DESC);');
baseline.push(`CREATE OR REPLACE FUNCTION kcml.guard_component_terminal_closure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lifecycle = 'DEREGISTERED' AND NOT EXISTS (
    SELECT 1 FROM kcml.terminal_closure_evidence e
    WHERE e.terminal_root_kind = 'COMPONENT'
      AND e.terminal_root_id = NEW.id
      AND e.terminal_state_version = NEW.state_version
      AND (e.predicate_results->>'passed')::boolean IS TRUE
  ) THEN
    RAISE EXCEPTION 'COMPONENT_TERMINAL_CLOSURE_EVIDENCE_MISSING' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;`);
baseline.push('DROP TRIGGER IF EXISTS guard_component_terminal_closure ON kcml.component;');
baseline.push('CREATE CONSTRAINT TRIGGER guard_component_terminal_closure AFTER INSERT OR UPDATE ON kcml.component DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION kcml.guard_component_terminal_closure();');
baseline.push(`CREATE OR REPLACE FUNCTION kcml.guard_component_terminal_child() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_component_id uuid; v_other_component_id uuid; v_is_authority_bearing boolean := true;
BEGIN
  IF TG_TABLE_NAME = 'runtime_instance' THEN
    v_component_id := NEW.component_id;
    v_is_authority_bearing := NEW.effective_state NOT IN ('STOPPED','FAILED');
  ELSIF TG_TABLE_NAME = 'component_contract_binding' THEN
    v_component_id := NEW.source_component_id;
    v_other_component_id := NEW.target_component_id;
    v_is_authority_bearing := NEW.lifecycle = 'ACTIVE' AND NEW.retired_at IS NULL AND NEW.deleted_at IS NULL;
  ELSIF TG_TABLE_NAME = 'domain_command' THEN
    v_component_id := NEW.target_id;
    IF TG_OP = 'INSERT' THEN
      v_is_authority_bearing := NEW.target_id IS NOT NULL;
    ELSE
      v_is_authority_bearing := OLD.status IN ('SUCCEEDED','FAILED_FINAL','CANCELLED_FINAL') AND NEW.status NOT IN ('SUCCEEDED','FAILED_FINAL','CANCELLED_FINAL');
    END IF;
  END IF;
  IF v_is_authority_bearing AND (
    EXISTS (SELECT 1 FROM kcml.component c WHERE c.id=v_component_id AND c.lifecycle='DEREGISTERED') OR
    (v_other_component_id IS NOT NULL AND EXISTS (SELECT 1 FROM kcml.component c WHERE c.id=v_other_component_id AND c.lifecycle='DEREGISTERED'))
  ) THEN
    RAISE EXCEPTION 'COMPONENT_TERMINAL_CHILD_FORBIDDEN' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;`);
for (const table of ['runtime_instance','component_contract_binding','domain_command']) {
  baseline.push(`DROP TRIGGER IF EXISTS guard_component_terminal_child ON kcml.${table};`);
  baseline.push(`CREATE TRIGGER guard_component_terminal_child BEFORE INSERT OR UPDATE ON kcml.${table} FOR EACH ROW EXECUTE FUNCTION kcml.guard_component_terminal_child();`);
}
baseline.push('');
baseline.push('ALTER TABLE kcml.component ALTER COLUMN lifecycle SET DEFAULT \'DRAFT\';');
for (const [name, expression] of [
  ['component_lifecycle_domain_ck', "lifecycle IN ('DRAFT','REVIEW','APPROVED','ACTIVE','SUSPENDED','QUARANTINED','RETIRED','DEREGISTERED')"],
  ['component_activation_domain_ck', "activation_state IN ('INACTIVE','READY','READY_FOR_ACTIVATION','ACTIVE','BLOCKED','ENABLE_REQUESTED','DISABLE_REQUESTED','DISABLE_UNCONFIRMED')"],
  ['component_operational_domain_ck', "operational_state IN ('UNKNOWN','DISABLED','HEALTHY','DEGRADED','UNHEALTHY','MAINTENANCE','QUARANTINED','RETIRED')"],
  ['component_monitoring_domain_ck', "monitoring_state IN ('NOT_CONFIGURED','PENDING','HEALTHY','DEGRADED','FAILED')"],
  ['component_recertification_domain_ck', "recertification_state IN ('NOT_DUE','DUE','OVERDUE','IN_REVIEW','PASSED','FAILED')"],
  ['component_active_authority_ck', "lifecycle <> 'ACTIVE' OR (activation_state = 'ACTIVE' AND active_revision_id IS NOT NULL AND current_release_id IS NOT NULL AND active_binding_set_revision_id IS NOT NULL AND current_activation_epoch > 0 AND enabled)"],
  ['component_retired_authority_ck', "lifecycle NOT IN ('RETIRED','DEREGISTERED') OR (activation_state <> 'ACTIVE' AND NOT enabled)"],
  ['component_enabled_projection_ck', "NOT enabled OR activation_state = 'ACTIVE'"]
]) {
  baseline.push(`ALTER TABLE kcml.component DROP CONSTRAINT IF EXISTS ${name};`);
  baseline.push(`ALTER TABLE kcml.component ADD CONSTRAINT ${name} CHECK (${expression});`);
}
baseline.push(`CREATE OR REPLACE FUNCTION kcml.guard_component_state_machine() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.lifecycle = 'DEREGISTERED' THEN RAISE EXCEPTION 'COMPONENT_TERMINAL_IMMUTABLE' USING ERRCODE='55000'; END IF;
  IF NEW.state_version <> OLD.state_version + 1 OR NEW.aggregate_event_sequence <> OLD.aggregate_event_sequence + 1 THEN
    RAISE EXCEPTION 'COMPONENT_VERSION_SEQUENCE_INVALID' USING ERRCODE='40001';
  END IF;
  IF NEW.lifecycle <> OLD.lifecycle AND NOT ((OLD.lifecycle,NEW.lifecycle) IN (
    ('DRAFT','REVIEW'),('DRAFT','RETIRED'),('REVIEW','DRAFT'),('REVIEW','APPROVED'),('REVIEW','RETIRED'),
    ('APPROVED','ACTIVE'),('APPROVED','RETIRED'),('ACTIVE','SUSPENDED'),('ACTIVE','QUARANTINED'),('ACTIVE','RETIRED'),
    ('SUSPENDED','ACTIVE'),('SUSPENDED','QUARANTINED'),('SUSPENDED','RETIRED'),('QUARANTINED','SUSPENDED'),
    ('QUARANTINED','ACTIVE'),('QUARANTINED','RETIRED'),('RETIRED','DEREGISTERED')
  )) THEN RAISE EXCEPTION 'COMPONENT_LIFECYCLE_TRANSITION_FORBIDDEN: % -> %',OLD.lifecycle,NEW.lifecycle USING ERRCODE='23514'; END IF;
  IF NEW.activation_state <> OLD.activation_state AND NOT (
    (OLD.activation_state,NEW.activation_state) IN (('INACTIVE','READY'),('READY','READY_FOR_ACTIVATION'),('READY_FOR_ACTIVATION','ENABLE_REQUESTED'),('ENABLE_REQUESTED','ACTIVE'),('ENABLE_REQUESTED','BLOCKED'),('ACTIVE','DISABLE_REQUESTED'),('DISABLE_REQUESTED','INACTIVE'),('DISABLE_REQUESTED','DISABLE_UNCONFIRMED'),('DISABLE_UNCONFIRMED','INACTIVE'),('DISABLE_UNCONFIRMED','ACTIVE'),('DISABLE_UNCONFIRMED','BLOCKED'),('READY','BLOCKED'),('READY_FOR_ACTIVATION','BLOCKED'))
    OR (OLD.activation_state='BLOCKED' AND NEW.activation_state IN ('INACTIVE','READY','READY_FOR_ACTIVATION'))
  ) THEN RAISE EXCEPTION 'COMPONENT_ACTIVATION_TRANSITION_FORBIDDEN: % -> %',OLD.activation_state,NEW.activation_state USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;`);
baseline.push('DROP TRIGGER IF EXISTS guard_component_state_machine ON kcml.component;');
baseline.push('CREATE TRIGGER guard_component_state_machine BEFORE UPDATE ON kcml.component FOR EACH ROW EXECUTE FUNCTION kcml.guard_component_state_machine();');
baseline.push('');
baseline.push('DROP TRIGGER IF EXISTS touch_mutable_row ON kcml.mcp_request_event;');
baseline.push('DROP TRIGGER IF EXISTS guard_mcp_request_event_lifecycle ON kcml.mcp_request_event;');
baseline.push("CREATE TRIGGER guard_mcp_request_event_lifecycle BEFORE UPDATE OR DELETE ON kcml.mcp_request_event FOR EACH ROW EXECUTE FUNCTION kcml.guard_mcp_lifecycle('final_response_state');");
baseline.push('');
baseline.push('DROP TRIGGER IF EXISTS touch_mutable_row ON kcml.operation_context;');
baseline.push('DROP TRIGGER IF EXISTS guard_operation_context_lifecycle ON kcml.operation_context;');
baseline.push('CREATE TRIGGER guard_operation_context_lifecycle BEFORE UPDATE OR DELETE ON kcml.operation_context FOR EACH ROW EXECUTE FUNCTION kcml.guard_operation_context_lifecycle();');
baseline.push('');
baseline.push('ALTER TABLE kcml.secret_use_context ALTER COLUMN logical_operation_id SET NOT NULL;');
baseline.push('ALTER TABLE kcml.browser_state_bundle_member DROP CONSTRAINT IF EXISTS browser_state_bundle_member_content_guard;');
baseline.push("ALTER TABLE kcml.browser_state_bundle_member ADD CONSTRAINT browser_state_bundle_member_content_guard CHECK ((encrypted_content IS NOT NULL) <> (artifact_reference IS NOT NULL));");
baseline.push('');
baseline.push(`CREATE OR REPLACE FUNCTION kcml.guard_operational_alert_state_machine() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'OPERATIONAL_ALERT_DELETE_FORBIDDEN' USING ERRCODE='55000'; END IF;
  IF OLD.status='CLOSED' THEN RAISE EXCEPTION 'OPERATIONAL_ALERT_TERMINAL_IMMUTABLE' USING ERRCODE='55000'; END IF;
  IF NEW.state_version<>OLD.state_version+1 THEN RAISE EXCEPTION 'OPERATIONAL_ALERT_STATE_VERSION_INVALID' USING ERRCODE='40001'; END IF;
  IF NEW.status<>OLD.status AND NOT ((OLD.status,NEW.status) IN (
    ('OPEN','ACKNOWLEDGED'),('OPEN','SUPPRESSED'),('OPEN','CLOSED'),
    ('ACKNOWLEDGED','SUPPRESSED'),('ACKNOWLEDGED','CLOSED'),
    ('SUPPRESSED','OPEN'),('SUPPRESSED','ACKNOWLEDGED'),('SUPPRESSED','CLOSED')
  )) THEN RAISE EXCEPTION 'OPERATIONAL_ALERT_TRANSITION_FORBIDDEN: % -> %',OLD.status,NEW.status USING ERRCODE='23514'; END IF;
  IF NEW.status=OLD.status AND NEW.latest_source_sequence<=OLD.latest_source_sequence THEN
    RAISE EXCEPTION 'OPERATIONAL_ALERT_OBSERVATION_SEQUENCE_NOT_ADVANCED' USING ERRCODE='40001';
  END IF;
  IF NEW.status='ACKNOWLEDGED' AND OLD.status<>NEW.status AND NEW.acknowledged_at IS NULL THEN
    RAISE EXCEPTION 'OPERATIONAL_ALERT_ACK_TIMESTAMP_MISSING' USING ERRCODE='23514';
  END IF;
  NEW.updated_at:=clock_timestamp();
  RETURN NEW;
END $$;`);
baseline.push('DROP TRIGGER IF EXISTS touch_mutable_row ON kcml.operational_alert;');
baseline.push('DROP TRIGGER IF EXISTS guard_operational_alert_state_machine ON kcml.operational_alert;');
baseline.push('CREATE TRIGGER guard_operational_alert_state_machine BEFORE UPDATE OR DELETE ON kcml.operational_alert FOR EACH ROW EXECUTE FUNCTION kcml.guard_operational_alert_state_machine();');
baseline.push('');
baseline.push('COMMIT;', '');
const generatedBaselineSql = baseline.join('\n');
const postgresSchemaContracts = compilePostgresSchemaContracts(`${primaryBaseline}\n${generatedBaselineSql}`, entities);
const postgresSchemaContractJson = `${JSON.stringify({ schemaVersion: '1.0', authority: 'SSOT_CURRENT.md chapter 25', fingerprint, records: postgresSchemaContracts }, null, 2)}\n`;

const outputs = [
  [join(root, 'contracts/ssot-surface/entities.json'), entityJson],
  [join(root, 'contracts/ssot-surface/routes.json'), routeJson],
  [join(root, 'contracts/ssot-surface/postgres-schema-contracts.json'), postgresSchemaContractJson],
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
