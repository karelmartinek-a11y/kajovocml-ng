BEGIN;

-- AUTO-GENERATED exact Chapter-25 physical schema projection.
-- Column, index, constraint and lifecycle evidence is emitted into postgres-schema-contracts.json and verified against PostgreSQL.
-- SSOT surface fingerprint: d1e1020ff347a9aea8bcf21f4443759b2ae165757b7a53112a2d9f6e0c9c4eb7

CREATE TABLE IF NOT EXISTS kcml."component" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "kcml_number" text NOT NULL,
  "code" text NOT NULL,
  "hostname" text,
  "description" text,
  "category" text NOT NULL,
  "role" text NOT NULL,
  "contacts" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "criticality" text NOT NULL,
  "runtime_identity_kind" text NOT NULL,
  "active_revision_id" uuid,
  "current_release_id" uuid,
  "activation_state" text NOT NULL,
  "operational_state" text NOT NULL,
  "monitoring_state" text NOT NULL,
  "recertification_state" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT false,
  "ingress_enabled" boolean NOT NULL DEFAULT false,
  "pulse_enabled" boolean NOT NULL DEFAULT false,
  "egress_enabled" boolean NOT NULL DEFAULT false,
  "active_binding_set_revision_id" uuid,
  "current_activation_epoch" bigint NOT NULL DEFAULT 0 CHECK (current_activation_epoch >= 0),
  "aggregate_event_sequence" bigint NOT NULL DEFAULT 0 CHECK (aggregate_event_sequence >= 0),
  "pointer_snapshot_digest" bytea,
  "latest_transition_operation_id" uuid,
  "activated_at" timestamptz,
  "retired_at" timestamptz,
  "deregistered_at" timestamptz,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "component_stable_key_uq" ON kcml."component"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."component";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."component" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS component_kcml_number_uq ON kcml.component(kcml_number);
CREATE UNIQUE INDEX IF NOT EXISTS component_code_uq ON kcml.component(code);
CREATE UNIQUE INDEX IF NOT EXISTS component_hostname_uq ON kcml.component(hostname) WHERE hostname IS NOT NULL;

CREATE TABLE IF NOT EXISTS kcml."component_revision" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "component_id" uuid NOT NULL REFERENCES kcml.component(id),
  "semantic_version" text NOT NULL,
  "canonical_manifest" jsonb NOT NULL,
  "manifest_digest" bytea NOT NULL,
  "source_provenance" jsonb NOT NULL,
  "validation_state" text NOT NULL,
  "validation_evidence" jsonb NOT NULL,
  "verification_state" text NOT NULL,
  "verification_evidence" jsonb NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "component_revision_stable_key_uq" ON kcml."component_revision"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."component_revision";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."component_revision" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE UNIQUE INDEX IF NOT EXISTS component_revision_semver_uq ON kcml.component_revision(component_id,semantic_version);
CREATE UNIQUE INDEX IF NOT EXISTS component_revision_manifest_uq ON kcml.component_revision(component_id,manifest_digest);

CREATE TABLE IF NOT EXISTS kcml."component_tool_contract" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "component_id" uuid NOT NULL,
  "revision_id" uuid NOT NULL,
  "tool_name" text NOT NULL,
  "title" text,
  "description" text,
  "input_schema" jsonb NOT NULL,
  "output_schema" jsonb NOT NULL,
  "scope" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "timeout_ms" integer,
  "limits" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "side_effect_policy" text NOT NULL,
  "retry_policy" text NOT NULL,
  "idempotency_policy" text NOT NULL,
  "concurrency_policy" text NOT NULL,
  "contract_digest" bytea NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "component_tool_contract_stable_key_uq" ON kcml."component_tool_contract"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."component_tool_contract";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."component_tool_contract" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."component_resource_contract" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "uri_template" text NOT NULL,
  "mime_type" text,
  "schema" jsonb,
  "subscription_policy" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "limits" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "contract_digest" bytea NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "component_resource_contract_stable_key_uq" ON kcml."component_resource_contract"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."component_resource_contract";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."component_resource_contract" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."component_prompt_contract" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "prompt_name" text NOT NULL,
  "arguments" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "content_schema" jsonb NOT NULL,
  "hints" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "contract_digest" bytea NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "component_prompt_contract_stable_key_uq" ON kcml."component_prompt_contract"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."component_prompt_contract";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."component_prompt_contract" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."component_endpoint_contract" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "endpoint_key" text NOT NULL,
  "method" text NOT NULL,
  "path" text NOT NULL,
  "scope" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "request_schema" jsonb NOT NULL,
  "response_schema" jsonb NOT NULL,
  "auth_verification" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "webhook_verification" jsonb,
  "contract_digest" bytea NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "component_endpoint_contract_stable_key_uq" ON kcml."component_endpoint_contract"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."component_endpoint_contract";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."component_endpoint_contract" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."component_pulse_contract" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "direction" text NOT NULL,
  "pulse_type" text NOT NULL,
  "schema" jsonb NOT NULL,
  "scope" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "delivery" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "contract_digest" bytea NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "component_pulse_contract_stable_key_uq" ON kcml."component_pulse_contract"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."component_pulse_contract";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."component_pulse_contract" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."component_state_contract" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "component_id" uuid NOT NULL REFERENCES kcml.component(id),
  "revision_id" uuid NOT NULL REFERENCES kcml.component_revision(id),
  "state_key" text NOT NULL,
  "category" text NOT NULL,
  "schema" jsonb NOT NULL,
  "terminal" boolean NOT NULL DEFAULT false,
  "contract_digest" bytea NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "component_state_contract_stable_key_uq" ON kcml."component_state_contract"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."component_state_contract";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."component_state_contract" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS component_state_contract_key_uq ON kcml.component_state_contract(component_id,revision_id,state_key) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS kcml."component_state_transition" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "from_state" text NOT NULL,
  "to_state" text NOT NULL,
  "trigger" text NOT NULL,
  "guard" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "side_effect" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "contract_digest" bytea NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "component_state_transition_stable_key_uq" ON kcml."component_state_transition"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."component_state_transition";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."component_state_transition" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."component_runtime_target" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "transport" text NOT NULL,
  "socket_path" text,
  "upstream" text,
  "service_instance" text,
  "execution_mode" text NOT NULL,
  "resource_limits" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "readiness_mode" text NOT NULL,
  "persistent_state" jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "component_runtime_target_stable_key_uq" ON kcml."component_runtime_target"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."component_runtime_target";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."component_runtime_target" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."component_contract_binding" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "source_component_id" uuid NOT NULL,
  "source_revision_id" uuid NOT NULL,
  "target_component_id" uuid NOT NULL,
  "target_revision_id" uuid NOT NULL,
  "contract_key" text NOT NULL,
  "source_contract_digest" bytea NOT NULL,
  "target_contract_digest" bytea NOT NULL,
  "operation_scope" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "binding_revision" bigint NOT NULL DEFAULT 1 CHECK (binding_revision > 0),
  "activation_set_id" uuid,
  "retired_at" timestamptz,
  "audit_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "component_contract_binding_stable_key_uq" ON kcml."component_contract_binding"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."component_contract_binding";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."component_contract_binding" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."component_release" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "component_id" uuid NOT NULL,
  "revision_id" uuid NOT NULL,
  "source_job_id" uuid,
  "source_commit" text,
  "build_digest" bytea,
  "artifact_digest" bytea,
  "runtime_digest" bytea,
  "release_directory" text,
  "release_reference" text,
  "previous_release_id" uuid,
  "state" text NOT NULL,
  "validated_at" timestamptz,
  "activated_at" timestamptz,
  "rolled_back_at" timestamptz,
  "evidence" jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "component_release_stable_key_uq" ON kcml."component_release"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."component_release";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."component_release" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."component_readiness_gate" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "component_id" uuid NOT NULL,
  "release_id" uuid NOT NULL,
  "gate_key" text NOT NULL,
  "status" text NOT NULL,
  "reason_code" text,
  "evaluator_version" text NOT NULL,
  "evidence" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "evidence_digest" bytea NOT NULL,
  "executed_at" timestamptz NOT NULL,
  "expires_at" timestamptz,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "component_readiness_gate_stable_key_uq" ON kcml."component_readiness_gate"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."component_readiness_gate";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."component_readiness_gate" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."component_e2e_run" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "scenario" text NOT NULL,
  "variant" text,
  "revision_id" uuid,
  "release_id" uuid,
  "invocation" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "input" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "expected" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "actual" jsonb,
  "status" text NOT NULL,
  "duration_ms" bigint,
  "evidence" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "cleanup" jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "component_e2e_run_stable_key_uq" ON kcml."component_e2e_run"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."component_e2e_run";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."component_e2e_run" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."mcp_server_revision_profile" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "component_id" uuid NOT NULL REFERENCES kcml.component(id),
  "revision_id" uuid NOT NULL REFERENCES kcml.component_revision(id),
  "protocol_era" text NOT NULL CHECK (protocol_era IN ('MODERN','LEGACY','DUAL_ERA_ADAPTER')),
  "supported_protocol_versions" text[] NOT NULL CHECK (cardinality(supported_protocol_versions) > 0),
  "selected_protocol_version" text NOT NULL,
  "canonical_transport" text NOT NULL,
  "canonical_endpoint" text NOT NULL,
  "canonical_origin" text,
  "http_method_profile" jsonb NOT NULL,
  "required_meta_profile" jsonb NOT NULL,
  "standard_header_profile" jsonb NOT NULL,
  "method_name_header_profile" jsonb NOT NULL,
  "server_capabilities" jsonb NOT NULL,
  "extension_capabilities" jsonb NOT NULL,
  "supported_result_types" text[] NOT NULL DEFAULT '{}',
  "http_jsonrpc_error_map" jsonb NOT NULL,
  "stable_error_profile" jsonb NOT NULL,
  "discovery_policy" jsonb NOT NULL,
  "cache_policy" jsonb NOT NULL,
  "pagination_policy" jsonb NOT NULL,
  "subscription_policy" jsonb NOT NULL,
  "mrtr_policy" jsonb NOT NULL,
  "state_handle_policy" jsonb NOT NULL,
  "task_policy" jsonb NOT NULL,
  "json_schema_dialects" text[] NOT NULL DEFAULT '{}',
  "reference_policy" jsonb NOT NULL,
  "schema_resource_budgets" jsonb NOT NULL,
  "public_access_profile" jsonb,
  "internal_binding_profile" jsonb NOT NULL,
  "legacy_compatibility_profile" jsonb,
  "era_probe_profile" jsonb NOT NULL,
  "canonical_profile" jsonb NOT NULL,
  "profile_digest" bytea NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_server_revision_profile_stable_key_uq" ON kcml."mcp_server_revision_profile"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."mcp_server_revision_profile";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."mcp_server_revision_profile" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS mcp_server_revision_profile_revision_uq ON kcml.mcp_server_revision_profile(component_id,revision_id);

CREATE TABLE IF NOT EXISTS kcml."mcp_registration_probe" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "external_server_id" uuid NOT NULL,
  "external_server_revision_id" uuid NOT NULL,
  "transport_kind" text NOT NULL,
  "origin" text NOT NULL,
  "endpoint" text NOT NULL,
  "auth_binding_id" uuid,
  "tls_fingerprint" bytea,
  "attempted_era" text NOT NULL CHECK (attempted_era IN ('MODERN','LEGACY')),
  "request_version" text,
  "request_method" text NOT NULL,
  "request_header_digest" bytea NOT NULL,
  "request_body_digest" bytea NOT NULL,
  "http_status" integer,
  "response_content_type" text,
  "jsonrpc_id_evidence" jsonb,
  "jsonrpc_result_evidence" jsonb,
  "jsonrpc_error_evidence" jsonb,
  "classification" text NOT NULL CHECK (classification IN ('MODERN','LEGACY_CANDIDATE','LEGACY','ERA_INDETERMINATE','PROTOCOL_INVALID') AND (classification <> 'LEGACY' OR (attempted_era = 'LEGACY' AND (http_status IS NULL OR (http_status NOT IN (401,403,407,429) AND http_status < 500))))),
  "recognized_modern_error" boolean NOT NULL DEFAULT false,
  "advertised_versions" text[] NOT NULL DEFAULT '{}',
  "fallback_decision" text,
  "fallback_reason" text,
  "observed_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "process_fingerprint" bytea,
  "release_fingerprint" bytea,
  "evidence_digest" bytea NOT NULL,
  "transport_failure_kind" text CHECK (transport_failure_kind IS NULL OR classification = 'ERA_INDETERMINATE'),
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_registration_probe_stable_key_uq" ON kcml."mcp_registration_probe"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."mcp_registration_probe";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."mcp_registration_probe" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS mcp_registration_probe_evidence_uq ON kcml.mcp_registration_probe(external_server_id,external_server_revision_id,attempted_era,evidence_digest);

CREATE TABLE IF NOT EXISTS kcml."mcp_discovery_snapshot" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "server_component_id" uuid NOT NULL REFERENCES kcml.component(id),
  "server_revision_id" uuid NOT NULL REFERENCES kcml.component_revision(id),
  "server_release_id" uuid,
  "endpoint" text NOT NULL,
  "method" text NOT NULL,
  "protocol_version" text NOT NULL,
  "client_capability_digest" bytea NOT NULL,
  "extension_digest" bytea NOT NULL,
  "source_execution_context_id" uuid,
  "access_channel" text NOT NULL,
  "auth_binding_id" uuid,
  "binding_revision" bigint,
  "exposure_fingerprint" bytea NOT NULL,
  "request_params" jsonb NOT NULL,
  "page_cursor" text,
  "cache_key_digest" bytea NOT NULL,
  "request_body_digest" bytea NOT NULL,
  "request_header_digest" bytea NOT NULL,
  "result_payload" jsonb NOT NULL,
  "result_digest" bytea NOT NULL,
  "element_contract_digests" bytea[] NOT NULL DEFAULT '{}',
  "ttl_ms" bigint NOT NULL CHECK (ttl_ms >= 0),
  "cache_scope" text NOT NULL,
  "received_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "previous_page_snapshot_id" uuid REFERENCES kcml.mcp_discovery_snapshot(id),
  "page_index" integer NOT NULL DEFAULT 0 CHECK (page_index >= 0),
  "page_lineage_evidence" jsonb NOT NULL,
  "aggregate_traversal_digest" bytea,
  "state" text NOT NULL CHECK (state IN ('FRESH','STALE','INVALID','DIAGNOSTIC_ONLY')),
  "invalidation_reason" text,
  "invalidation_relation" jsonb,
  "latency_ms" bigint NOT NULL CHECK (latency_ms >= 0),
  "verification_state" text NOT NULL,
  "contains_input_responses" boolean NOT NULL DEFAULT false,
  "contains_request_state" boolean NOT NULL DEFAULT false,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_discovery_snapshot_stable_key_uq" ON kcml."mcp_discovery_snapshot"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."mcp_discovery_snapshot";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."mcp_discovery_snapshot" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS mcp_discovery_snapshot_cache_context_uq ON kcml.mcp_discovery_snapshot(cache_key_digest,exposure_fingerprint,COALESCE(binding_revision,-1),COALESCE(page_cursor,'')) WHERE state = 'FRESH';

CREATE TABLE IF NOT EXISTS kcml."mcp_discovery_item" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "snapshot_id" uuid NOT NULL REFERENCES kcml.mcp_discovery_snapshot(id),
  "kind" text NOT NULL CHECK (kind IN ('TOOL','RESOURCE','RESOURCE_TEMPLATE','PROMPT')),
  "element_id" text NOT NULL,
  "visible_name" text,
  "visible_uri" text,
  "source_revision_id" uuid NOT NULL,
  "contract_digest" bytea NOT NULL,
  "native_schema_bundle" jsonb NOT NULL,
  "native_schema_digest" bytea NOT NULL,
  "openai_projection_digest" bytea,
  "mcp_header_map_digest" bytea,
  "sort_key" text NOT NULL,
  "verification_state" text NOT NULL,
  "error" jsonb,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_discovery_item_stable_key_uq" ON kcml."mcp_discovery_item"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."mcp_discovery_item";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."mcp_discovery_item" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE UNIQUE INDEX IF NOT EXISTS mcp_discovery_item_element_uq ON kcml.mcp_discovery_item(snapshot_id,kind,element_id);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_discovery_item_sort_uq ON kcml.mcp_discovery_item(snapshot_id,sort_key);

CREATE TABLE IF NOT EXISTS kcml."mcp_tool_alias" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "agent_scope" jsonb,
  "exposure_scope" jsonb,
  "source_server_id" uuid NOT NULL,
  "source_tool_id" uuid NOT NULL,
  "source_revision_id" uuid NOT NULL,
  "source_digest" bytea NOT NULL,
  "model_alias" text NOT NULL,
  "collision_strategy" text NOT NULL,
  "openai_projection_id" uuid,
  "compatibility_state" text NOT NULL,
  "retired_at" timestamptz,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_tool_alias_stable_key_uq" ON kcml."mcp_tool_alias"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."mcp_tool_alias";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."mcp_tool_alias" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."mcp_request_event" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "server_component_id" uuid NOT NULL REFERENCES kcml.component(id),
  "server_revision_id" uuid NOT NULL REFERENCES kcml.component_revision(id),
  "server_release_id" uuid,
  "endpoint" text NOT NULL,
  "access_context" jsonb NOT NULL,
  "protocol_era" text NOT NULL CHECK (protocol_era IN ('MODERN','LEGACY','DUAL_ERA_ADAPTER')),
  "protocol_version" text NOT NULL,
  "request_id_type" text CHECK (request_id_type IN ('STRING','INTEGER')),
  "request_id_value" text,
  "inflight_source_scope" text NOT NULL,
  "method" text NOT NULL,
  "method_name" text,
  "resource_uri" text,
  "task_id" text,
  "is_notification" boolean NOT NULL DEFAULT false,
  "source_execution_context_id" uuid,
  "auth_decision" jsonb NOT NULL,
  "binding_decision" jsonb NOT NULL,
  "client_info" jsonb,
  "client_capability_digest" bytea,
  "extension_digest" bytea,
  "request_headers" jsonb,
  "request_body" jsonb,
  "request_headers_digest" bytea NOT NULL,
  "request_body_digest" bytea NOT NULL,
  "routing_headers" jsonb NOT NULL,
  "header_validation_result" jsonb NOT NULL,
  "http_method" text NOT NULL,
  "origin" text,
  "accept_type" text,
  "content_type" text,
  "request_size_bytes" bigint NOT NULL CHECK (request_size_bytes >= 0),
  "processing_stage" text NOT NULL,
  "handler_dispatched" boolean NOT NULL DEFAULT false,
  "response_http_status" integer,
  "response_content_type" text,
  "result_type" text,
  "jsonrpc_error_code" integer,
  "stable_error_code" text,
  "sse_stream_id" text,
  "stream_message_sequence" bigint,
  "final_response_state" text NOT NULL,
  "disconnect_cancel_point" text,
  "response_delivery_state" text NOT NULL,
  "causation_id" uuid,
  "trace_id" text,
  "received_at" timestamptz NOT NULL,
  "completed_at" timestamptz,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_request_event_stable_key_uq" ON kcml."mcp_request_event"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."mcp_request_event";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."mcp_request_event" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS mcp_request_event_active_transport_id_uq ON kcml.mcp_request_event(inflight_source_scope,request_id_type,request_id_value) WHERE request_id_value IS NOT NULL AND completed_at IS NULL;

CREATE TABLE IF NOT EXISTS kcml."mcp_call_progress" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "call_run_id" uuid NOT NULL REFERENCES kcml.mcp_call_run(id),
  "sequence" bigint NOT NULL CHECK (sequence > 0),
  "progress_token" text NOT NULL,
  "completed_units" numeric,
  "total_units" numeric,
  "message" text,
  "checkpoint_id" uuid,
  "emitted_at" timestamptz NOT NULL,
  "payload_digest" bytea NOT NULL,
  "response_stream_id" text NOT NULL,
  "delivery_state" text NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_call_progress_stable_key_uq" ON kcml."mcp_call_progress"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."mcp_call_progress";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."mcp_call_progress" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS mcp_call_progress_sequence_uq ON kcml.mcp_call_progress(call_run_id,sequence);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_call_progress_stream_sequence_uq ON kcml.mcp_call_progress(response_stream_id,sequence);

CREATE TABLE IF NOT EXISTS kcml."mcp_input_request_item" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "input_exchange_id" uuid NOT NULL REFERENCES kcml.mcp_input_exchange(id),
  "request_key" text NOT NULL,
  "request_method" text NOT NULL CHECK (request_method IN ('elicitation/create','sampling/createMessage','roots/list')),
  "params" jsonb NOT NULL,
  "params_digest" bytea NOT NULL,
  "required_client_capability_digest" bytea NOT NULL,
  "state" text NOT NULL CHECK (state IN ('OUTSTANDING','SATISFIED','SUPERSEDED','EXPIRED')),
  "satisfied_at" timestamptz,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_input_request_item_stable_key_uq" ON kcml."mcp_input_request_item"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."mcp_input_request_item";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."mcp_input_request_item" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS mcp_input_request_item_key_uq ON kcml.mcp_input_request_item(input_exchange_id,request_key);

CREATE TABLE IF NOT EXISTS kcml."mcp_input_response_item" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "input_exchange_id" uuid NOT NULL REFERENCES kcml.mcp_input_exchange(id),
  "retry_request_event_id" uuid NOT NULL REFERENCES kcml.mcp_request_event(id),
  "supplied_key" text NOT NULL,
  "raw_response" jsonb NOT NULL,
  "normalized_response" jsonb,
  "response_digest" bytea NOT NULL,
  "disposition" text NOT NULL CHECK (disposition IN ('ACCEPTED','DUPLICATE_REPLAY','IGNORED_UNKNOWN','IGNORED_ALREADY_SATISFIED','REJECTED_INVALID')),
  "input_request_item_id" uuid REFERENCES kcml.mcp_input_request_item(id),
  "audit_event_id" uuid,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_input_response_item_stable_key_uq" ON kcml."mcp_input_response_item"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."mcp_input_response_item";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."mcp_input_response_item" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE UNIQUE INDEX IF NOT EXISTS mcp_input_response_item_retry_key_uq ON kcml.mcp_input_response_item(input_exchange_id,retry_request_event_id,supplied_key);

CREATE TABLE IF NOT EXISTS kcml."mcp_subscription" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "server_component_id" uuid NOT NULL REFERENCES kcml.component(id),
  "server_revision_id" uuid NOT NULL REFERENCES kcml.component_revision(id),
  "server_release_id" uuid,
  "request_id_type" text NOT NULL CHECK (request_id_type IN ('STRING','INTEGER')),
  "request_id_value" text NOT NULL,
  "source_execution_context_id" uuid,
  "access_context" jsonb NOT NULL,
  "binding_revision" bigint NOT NULL,
  "protocol_version" text NOT NULL,
  "capability_digest" bytea NOT NULL,
  "extension_digest" bytea NOT NULL,
  "requested_filter" jsonb NOT NULL,
  "acknowledged_filter" jsonb,
  "state" text NOT NULL CHECK (state IN ('OPENING','ACTIVE','CANCEL_REQUESTED','GRACEFUL_CLOSING','CLOSED','FAILED')),
  "ack_persisted_sequence" bigint,
  "ack_emitted_sequence" bigint,
  "first_message_proof" jsonb,
  "stream_opened_at" timestamptz,
  "last_keepalive_at" timestamptz,
  "closed_at" timestamptz,
  "final_response_state" text,
  "close_reason" text,
  "notification_count" bigint NOT NULL DEFAULT 0 CHECK (notification_count >= 0),
  "last_error" jsonb,
  "trace_id" text,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_subscription_stable_key_uq" ON kcml."mcp_subscription"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."mcp_subscription";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."mcp_subscription" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS mcp_subscription_request_uq ON kcml.mcp_subscription(server_component_id,source_execution_context_id,request_id_type,request_id_value);

CREATE TABLE IF NOT EXISTS kcml."mcp_subscription_notification" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "subscription_id" uuid NOT NULL REFERENCES kcml.mcp_subscription(id),
  "sequence" bigint NOT NULL CHECK (sequence > 0),
  "method" text NOT NULL,
  "source_object_id" uuid,
  "source_uri" text,
  "source_task_id" text,
  "payload" jsonb NOT NULL,
  "payload_digest" bytea NOT NULL,
  "meta_subscription_id" text NOT NULL,
  "emitted_at" timestamptz NOT NULL,
  "delivered_at" timestamptz,
  "delivery_result" jsonb,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_subscription_notification_stable_key_uq" ON kcml."mcp_subscription_notification"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."mcp_subscription_notification";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."mcp_subscription_notification" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE UNIQUE INDEX IF NOT EXISTS mcp_subscription_notification_sequence_uq ON kcml.mcp_subscription_notification(subscription_id,sequence);

CREATE TABLE IF NOT EXISTS kcml."mcp_state_handle" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "owner_component_id" uuid NOT NULL REFERENCES kcml.component(id),
  "owner_tool_key" text NOT NULL,
  "owner_revision_id" uuid NOT NULL REFERENCES kcml.component_revision(id),
  "contract_digest" bytea NOT NULL,
  "public_opaque_id" text NOT NULL,
  "lookup_digest" bytea NOT NULL,
  "generation_nonce" uuid NOT NULL,
  "source_execution_context_id" uuid,
  "access_context" jsonb NOT NULL,
  "binding_revision" bigint NOT NULL,
  "state_namespace" text NOT NULL,
  "state_reference" text NOT NULL,
  "status" text NOT NULL CHECK (status IN ('OPEN','CLOSED','EXPIRED')),
  "last_used_at" timestamptz,
  "expires_at" timestamptz NOT NULL,
  "closed_at" timestamptz,
  "close_logical_operation_id" uuid,
  "audit_event_id" uuid,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_state_handle_stable_key_uq" ON kcml."mcp_state_handle"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."mcp_state_handle";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."mcp_state_handle" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS mcp_state_handle_public_id_uq ON kcml.mcp_state_handle(public_opaque_id);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_state_handle_lookup_uq ON kcml.mcp_state_handle(lookup_digest);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_state_handle_generation_uq ON kcml.mcp_state_handle(generation_nonce);

CREATE TABLE IF NOT EXISTS kcml."mcp_task_input_request" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "task_id" uuid NOT NULL REFERENCES kcml.mcp_task(id),
  "request_key" text NOT NULL,
  "request_method" text NOT NULL,
  "params" jsonb NOT NULL,
  "params_digest" bytea NOT NULL,
  "required_capability_digest" bytea NOT NULL,
  "state" text NOT NULL CHECK (state IN ('OUTSTANDING','SATISFIED','SUPERSEDED','EXPIRED')),
  "satisfied_at" timestamptz,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_task_input_request_stable_key_uq" ON kcml."mcp_task_input_request"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."mcp_task_input_request";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."mcp_task_input_request" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS mcp_task_input_request_key_uq ON kcml.mcp_task_input_request(task_id,request_key);

CREATE TABLE IF NOT EXISTS kcml."mcp_task_input_response" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "task_id" uuid NOT NULL REFERENCES kcml.mcp_task(id),
  "update_request_event_id" uuid NOT NULL REFERENCES kcml.mcp_request_event(id),
  "supplied_key" text NOT NULL,
  "normalized_response" jsonb NOT NULL,
  "response_digest" bytea NOT NULL,
  "disposition" text NOT NULL CHECK (disposition IN ('ACCEPTED','DUPLICATE','IGNORED_UNKNOWN','IGNORED_ALREADY_SATISFIED','REJECTED_INVALID')),
  "accepted_at" timestamptz,
  "audit_event_id" uuid,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_task_input_response_stable_key_uq" ON kcml."mcp_task_input_response"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."mcp_task_input_response";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."mcp_task_input_response" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS mcp_task_input_response_key_uq ON kcml.mcp_task_input_response(task_id,update_request_event_id,supplied_key);

CREATE TABLE IF NOT EXISTS kcml."mcp_task_event" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "task_id" uuid NOT NULL REFERENCES kcml.mcp_task(id),
  "sequence" bigint NOT NULL CHECK (sequence > 0),
  "status_projection" jsonb NOT NULL,
  "status_message" text,
  "input_request_id" uuid,
  "final_result_reference" jsonb,
  "error_reference" jsonb,
  "payload_digest" bytea NOT NULL,
  "occurred_at" timestamptz NOT NULL,
  "subscription_notification_id" uuid REFERENCES kcml.mcp_subscription_notification(id),
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_task_event_stable_key_uq" ON kcml."mcp_task_event"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."mcp_task_event";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."mcp_task_event" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE UNIQUE INDEX IF NOT EXISTS mcp_task_event_sequence_uq ON kcml.mcp_task_event(task_id,sequence);

CREATE TABLE IF NOT EXISTS kcml."mcp_idempotency_record" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "server_component_id" uuid NOT NULL REFERENCES kcml.component(id),
  "tool_key" text NOT NULL,
  "operation_contract_revision_id" uuid NOT NULL,
  "operation_contract_digest" bytea NOT NULL,
  "caller_authority_kind" text NOT NULL,
  "source_object_id" uuid NOT NULL,
  "source_revision_id" uuid NOT NULL,
  "access_fingerprint" bytea NOT NULL,
  "business_target" jsonb NOT NULL,
  "concurrency_resource" jsonb,
  "idempotency_key" text NOT NULL,
  "request_digest" bytea NOT NULL,
  "original_call_attempt_id" uuid,
  "current_call_attempt_id" uuid,
  "state" text NOT NULL CHECK (state IN ('RESERVED','EXECUTING','WAITING_FOR_INPUT','WAITING_FOR_RECONCILIATION','SUCCEEDED','FAILED_FINAL','CANCELLED_FINAL','MANUAL_REVIEW')),
  "current_result" jsonb,
  "terminal_result" jsonb,
  "terminal_error" jsonb,
  "terminal_event_digest" bytea,
  "retry_directive" text,
  "expires_at" timestamptz NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_idempotency_record_stable_key_uq" ON kcml."mcp_idempotency_record"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."mcp_idempotency_record";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."mcp_idempotency_record" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS mcp_idempotency_business_scope_uq ON kcml.mcp_idempotency_record(server_component_id,tool_key,operation_contract_revision_id,caller_authority_kind,source_object_id,source_revision_id,access_fingerprint,idempotency_key);

CREATE TABLE IF NOT EXISTS kcml."runtime_execution_context" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "execution_kind" text NOT NULL CHECK (execution_kind IN ('COMPONENT','AGENT','PLATFORM','OWNER_API','EXTERNAL_BINDING')),
  "source_object_kind" text NOT NULL,
  "source_object_id" uuid NOT NULL,
  "source_revision_id" uuid NOT NULL,
  "run_id" uuid,
  "job_id" uuid,
  "worker_id" uuid,
  "execution_attempt_id" uuid NOT NULL,
  "binding_set_revision_id" uuid,
  "execution_snapshot_digest" bytea NOT NULL,
  "trusted_dispatcher" text NOT NULL,
  "service_identity" text NOT NULL,
  "systemd_identity" jsonb,
  "uds_path" text,
  "peer_credential_evidence" jsonb,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "state" text NOT NULL,
  "context_digest" bytea NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "runtime_execution_context_stable_key_uq" ON kcml."runtime_execution_context"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."runtime_execution_context";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."runtime_execution_context" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE UNIQUE INDEX IF NOT EXISTS runtime_execution_context_attempt_uq ON kcml.runtime_execution_context(execution_attempt_id);
CREATE UNIQUE INDEX IF NOT EXISTS runtime_execution_context_digest_uq ON kcml.runtime_execution_context(context_digest);

CREATE TABLE IF NOT EXISTS kcml."runtime_process_identity" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "runtime_instance_id" uuid NOT NULL REFERENCES kcml.runtime_instance(id),
  "runtime_generation" bigint NOT NULL CHECK (runtime_generation > 0),
  "process_role" text NOT NULL CHECK (process_role IN ('HOST','SANDBOX_INIT','HANDLER','CHILD')),
  "linux_pid" integer NOT NULL CHECK (linux_pid > 0),
  "linux_uid" integer NOT NULL CHECK (linux_uid >= 0),
  "linux_gid" integer NOT NULL CHECK (linux_gid >= 0),
  "supplementary_groups" integer[] NOT NULL DEFAULT '{}',
  "host_boot_id" uuid NOT NULL,
  "process_start_ticks" bigint NOT NULL CHECK (process_start_ticks >= 0),
  "systemd_unit" text NOT NULL,
  "invocation_id" uuid NOT NULL,
  "main_pid_relation" jsonb NOT NULL,
  "cgroup_path" text NOT NULL,
  "pidfd_evidence" jsonb,
  "parent_process_identity_id" uuid REFERENCES kcml.runtime_process_identity(id),
  "namespace_profile_digest" bytea NOT NULL,
  "executable_digest" bytea NOT NULL,
  "release_digest" bytea NOT NULL,
  "started_at" timestamptz NOT NULL,
  "ready_at" timestamptz,
  "exited_at" timestamptz,
  "exit_code" integer,
  "exit_signal" integer,
  "oom_reason" text,
  "seccomp_reason" text,
  "identity_digest" bytea NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "runtime_process_identity_stable_key_uq" ON kcml."runtime_process_identity"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."runtime_process_identity";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."runtime_process_identity" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS runtime_process_identity_kernel_uq ON kcml.runtime_process_identity(host_boot_id,linux_pid,process_start_ticks);
CREATE UNIQUE INDEX IF NOT EXISTS runtime_process_identity_generation_role_uq ON kcml.runtime_process_identity(runtime_instance_id,runtime_generation,process_role,linux_pid);

CREATE TABLE IF NOT EXISTS kcml."runtime_ipc_connection" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "transport_kind" text NOT NULL CHECK (transport_kind IN ('RUNTIME_GATEWAY_UDS','HANDLER_ANONYMOUS','BROKER_UDS','BROWSER_HOST_UDS')),
  "canonical_path" text,
  "anonymous_channel_id" uuid,
  "socket_device" bigint,
  "socket_inode" bigint,
  "socket_type" text NOT NULL,
  "socket_owner_uid" integer,
  "socket_group_gid" integer,
  "socket_mode" integer,
  "socket_unit" text,
  "peer_uid" integer NOT NULL,
  "peer_gid" integer NOT NULL,
  "peer_pid" integer NOT NULL,
  "peer_boot_id" uuid NOT NULL,
  "peer_start_ticks" bigint NOT NULL,
  "peer_systemd_identity" jsonb NOT NULL,
  "peer_cgroup_path" text NOT NULL,
  "runtime_instance_id" uuid REFERENCES kcml.runtime_instance(id),
  "runtime_generation" bigint,
  "service_invocation_id" uuid,
  "protocol_profile_digest" bytea NOT NULL,
  "first_sequence" bigint NOT NULL DEFAULT 0,
  "last_sequence" bigint NOT NULL DEFAULT 0,
  "inflight_count" bigint NOT NULL DEFAULT 0 CHECK (inflight_count >= 0),
  "state" text NOT NULL CHECK (state IN ('OPENING','ACTIVE','DRAINING','CLOSED','REJECTED')),
  "opened_at" timestamptz NOT NULL,
  "validated_at" timestamptz,
  "draining_at" timestamptz,
  "closed_at" timestamptz,
  "close_reason" text,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "runtime_ipc_connection_stable_key_uq" ON kcml."runtime_ipc_connection"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."runtime_ipc_connection";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."runtime_ipc_connection" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS runtime_ipc_connection_socket_peer_uq ON kcml.runtime_ipc_connection(socket_device,socket_inode,peer_boot_id,peer_pid,peer_start_ticks) WHERE socket_inode IS NOT NULL;

CREATE TABLE IF NOT EXISTS kcml."runtime_ipc_call" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "connection_id" uuid NOT NULL REFERENCES kcml.runtime_ipc_connection(id),
  "parent_execution_context_id" uuid NOT NULL REFERENCES kcml.runtime_execution_context(id),
  "child_execution_context_id" uuid REFERENCES kcml.runtime_execution_context(id),
  "request_id" text NOT NULL,
  "sequence" bigint NOT NULL CHECK (sequence > 0),
  "operation" text NOT NULL,
  "capability_alias" text NOT NULL,
  "resolved_target" jsonb NOT NULL,
  "resolved_binding_id" uuid,
  "resolved_secret_id" uuid,
  "resolved_external_target_id" uuid,
  "resolved_state_reference" jsonb,
  "revision_id" uuid NOT NULL,
  "release_id" uuid NOT NULL,
  "runtime_generation" bigint NOT NULL,
  "binding_revision" bigint NOT NULL,
  "input_digest" bytea NOT NULL,
  "output_digest" bytea,
  "error_digest" bytea,
  "input_bytes" bigint NOT NULL CHECK (input_bytes >= 0),
  "output_bytes" bigint CHECK (output_bytes >= 0),
  "deadline_at" timestamptz NOT NULL,
  "cancellation_version" bigint NOT NULL DEFAULT 0,
  "stream_state" jsonb,
  "window_state" jsonb,
  "state" text NOT NULL CHECK (state IN ('RECEIVED','VALIDATED','DISPATCHED','STREAMING','RECONCILING','SUCCEEDED','FAILED','CANCELLED','MANUAL_REVIEW')),
  "result" jsonb,
  "error" jsonb,
  "cleanup_state" text NOT NULL,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "runtime_ipc_call_stable_key_uq" ON kcml."runtime_ipc_call"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."runtime_ipc_call";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."runtime_ipc_call" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS runtime_ipc_call_sequence_uq ON kcml.runtime_ipc_call(connection_id,sequence);
CREATE UNIQUE INDEX IF NOT EXISTS runtime_ipc_call_request_uq ON kcml.runtime_ipc_call(connection_id,request_id);

CREATE TABLE IF NOT EXISTS kcml."runtime_credential_generation" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "service_id" uuid NOT NULL,
  "credential_stable_id" uuid NOT NULL,
  "credential_kind" text NOT NULL,
  "desired_generation" bigint NOT NULL,
  "effective_generation" bigint,
  "fingerprint" bytea,
  "source_version" bigint,
  "systemd_unit" text,
  "invocation_id" uuid,
  "rotation_operation_id" uuid,
  "restart_relation" jsonb,
  "verification_evidence" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "activated_at" timestamptz,
  "retired_at" timestamptz,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "runtime_credential_generation_stable_key_uq" ON kcml."runtime_credential_generation"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."runtime_credential_generation";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."runtime_credential_generation" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."runtime_cleanup_operation" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "runtime_instance_id" uuid NOT NULL,
  "runtime_generation" bigint NOT NULL,
  "cleanup_reason" text NOT NULL,
  "checkpoint" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "fencing_token" bigint,
  "resource_inventory" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "pending_side_effects" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "leases" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "capacity_claims" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "ordered_steps" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "attempts" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "outcomes" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "evidence_digests" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "completed_at" timestamptz,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "runtime_cleanup_operation_stable_key_uq" ON kcml."runtime_cleanup_operation"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."runtime_cleanup_operation";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."runtime_cleanup_operation" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."external_auth_binding" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "binding_key" text NOT NULL,
  "component_id" uuid,
  "revision_id" uuid,
  "endpoint_id" uuid,
  "external_target_id" uuid,
  "auth_mode" text NOT NULL,
  "secret_id" uuid,
  "certificate_id" uuid,
  "method" text,
  "path" text,
  "tool_key" text,
  "rate_policy" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "circuit_policy" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "verifier_policy" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "retired_at" timestamptz,
  "audit_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "external_auth_binding_stable_key_uq" ON kcml."external_auth_binding"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."external_auth_binding";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."external_auth_binding" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."secret_binding" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "secret_id" uuid NOT NULL,
  "source_object_kind" text NOT NULL,
  "source_object_id" uuid NOT NULL,
  "source_revision_id" uuid NOT NULL,
  "usage_purpose" text NOT NULL,
  "target_id" uuid,
  "account_id" uuid,
  "version_selector" jsonb NOT NULL,
  "resolved_version_policy" text NOT NULL,
  "binding_revision" bigint NOT NULL CHECK (binding_revision > 0),
  "binding_digest" bytea NOT NULL,
  "activation_set_id" uuid,
  "expires_at" timestamptz,
  "invalidation_policy" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "retired_at" timestamptz,
  "audit_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "secret_binding_stable_key_uq" ON kcml."secret_binding"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."secret_binding";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."secret_binding" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."secret_resolution" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "execution_context_id" uuid NOT NULL,
  "secret_id" uuid NOT NULL,
  "binding_id" uuid NOT NULL,
  "binding_revision" bigint NOT NULL,
  "binding_digest" bytea NOT NULL,
  "requested_stable_name" text NOT NULL,
  "requested_purpose" text NOT NULL,
  "requested_target" jsonb,
  "resolved_secret_version_id" uuid,
  "secret_activation_epoch" bigint,
  "source_revision_id" uuid,
  "target_revision_id" uuid,
  "source_activation_epoch" bigint,
  "target_activation_epoch" bigint,
  "state" text NOT NULL CHECK (state IN ('RESERVED','RESOLVED','REJECTED','EXPIRED')),
  "result_fingerprint" bytea,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "audit_event_id" uuid,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "secret_resolution_stable_key_uq" ON kcml."secret_resolution"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."secret_resolution";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."secret_resolution" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."secret_access_event" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "secret_id" uuid NOT NULL,
  "secret_version_id" uuid NOT NULL,
  "execution_context_id" uuid NOT NULL,
  "binding_id" uuid,
  "purpose" text NOT NULL,
  "operation" text NOT NULL,
  "success" boolean NOT NULL,
  "occurred_at" timestamptz NOT NULL,
  "runtime_id" uuid,
  "job_id" uuid,
  "run_id" uuid,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "secret_access_event_stable_key_uq" ON kcml."secret_access_event"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."secret_access_event";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."secret_access_event" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."external_target" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "target_key" text NOT NULL,
  "base_url" text NOT NULL,
  "allowed_paths" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "allowed_methods" text[] NOT NULL DEFAULT '{}',
  "timeout_ms" integer NOT NULL CHECK (timeout_ms > 0),
  "retry_policy" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "rate_limit" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "circuit_state" text NOT NULL,
  "auth_binding_id" uuid,
  "monitoring" jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "external_target_stable_key_uq" ON kcml."external_target"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."external_target";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."external_target" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."external_target_binding" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "source_component_id" uuid NOT NULL,
  "source_revision_id" uuid NOT NULL,
  "target_id" uuid NOT NULL,
  "route" text NOT NULL,
  "method" text NOT NULL,
  "request_contract_digest" bytea NOT NULL,
  "response_contract_digest" bytea NOT NULL,
  "binding_revision" bigint NOT NULL CHECK (binding_revision > 0),
  "activation_set_id" uuid,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "external_target_binding_stable_key_uq" ON kcml."external_target_binding"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."external_target_binding";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."external_target_binding" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."external_request_event" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "external_target_id" uuid NOT NULL,
  "binding_id" uuid NOT NULL,
  "binding_revision" bigint NOT NULL,
  "route" text NOT NULL,
  "method" text NOT NULL,
  "side_effect_operation_id" uuid,
  "attempt" bigint NOT NULL,
  "target_idempotency_key" text,
  "request_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "request_payload_digest" bytea NOT NULL,
  "dispatch_state" text NOT NULL,
  "sent_at" timestamptz,
  "transport_evidence" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "response_metadata" jsonb,
  "response_payload_digest" bytea,
  "provider_request_id" text,
  "provider_event_id" text,
  "outcome" text NOT NULL CHECK (outcome IN ('CONFIRMED_APPLIED','CONFIRMED_NOT_APPLIED','UNKNOWN','READ_ONLY_RESULT')),
  "reconciliation_state" text,
  "reconciliation_evidence" jsonb,
  "next_action" text,
  "latency_ms" bigint,
  "http_status" integer,
  "provider_status" text,
  "retry_classification" text,
  "circuit_decision" text,
  "worker_fence" bigint,
  "causation_id" uuid,
  "trace_id" text,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "external_request_event_stable_key_uq" ON kcml."external_request_event"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."external_request_event";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."external_request_event" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."webhook_endpoint" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "component_id" uuid NOT NULL,
  "revision_id" uuid NOT NULL,
  "path" text NOT NULL,
  "verification_mode" text NOT NULL,
  "secret_refs" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "schema" jsonb NOT NULL,
  "processing_contract" jsonb NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_endpoint_stable_key_uq" ON kcml."webhook_endpoint"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."webhook_endpoint";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."webhook_endpoint" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."dashboard_workspace" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "owner_identity_id" uuid NOT NULL,
  "viewport_x" double precision NOT NULL DEFAULT 0,
  "viewport_y" double precision NOT NULL DEFAULT 0,
  "viewport_zoom" double precision NOT NULL DEFAULT 1 CHECK (viewport_zoom > 0),
  "filters" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "groups" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "lock_version" bigint NOT NULL DEFAULT 1 CHECK (lock_version > 0),
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "dashboard_workspace_stable_key_uq" ON kcml."dashboard_workspace"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."dashboard_workspace";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."dashboard_workspace" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."dashboard_node_position" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "workspace_id" uuid NOT NULL,
  "node_id" uuid NOT NULL,
  "position_x" double precision NOT NULL,
  "position_y" double precision NOT NULL,
  "position_z" integer NOT NULL DEFAULT 0,
  "group_id" uuid,
  "collapsed" boolean NOT NULL DEFAULT false,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "dashboard_node_position_stable_key_uq" ON kcml."dashboard_node_position"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."dashboard_node_position";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."dashboard_node_position" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."dashboard_connection" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "source_component_id" uuid NOT NULL,
  "source_port" text NOT NULL,
  "target_component_id" uuid NOT NULL,
  "target_port" text NOT NULL,
  "route" text,
  "operation_scope" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "source_contract_digest" bytea NOT NULL,
  "target_contract_digest" bytea NOT NULL,
  "compatibility_state" text NOT NULL,
  "compatibility_evidence" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "desired_binding_id" uuid,
  "effective_binding_id" uuid,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "dashboard_connection_stable_key_uq" ON kcml."dashboard_connection"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."dashboard_connection";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."dashboard_connection" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."dashboard_runtime_event" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "component_id" uuid NOT NULL,
  "event_kind" text NOT NULL,
  "operation_name" text,
  "direction" text NOT NULL,
  "success" boolean NOT NULL,
  "trace_id" text,
  "occurred_at" timestamptz NOT NULL,
  "received_at" timestamptz NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "dashboard_runtime_event_stable_key_uq" ON kcml."dashboard_runtime_event"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."dashboard_runtime_event";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."dashboard_runtime_event" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."component_state_history" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "component_id" uuid NOT NULL,
  "lifecycle_state" text NOT NULL,
  "operational_state" text NOT NULL,
  "recertification_state" text NOT NULL,
  "reason" text,
  "recorded_at" timestamptz NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "component_state_history_stable_key_uq" ON kcml."component_state_history"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."component_state_history";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."component_state_history" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."alert_delivery" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "alert_id" uuid NOT NULL,
  "channel" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "attempts" integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  "state" text NOT NULL,
  "status_code" text,
  "error" jsonb,
  "next_attempt_at" timestamptz,
  "delivered_at" timestamptz,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "alert_delivery_stable_key_uq" ON kcml."alert_delivery"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."alert_delivery";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."alert_delivery" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."monitoring_scheduler_heartbeat" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "worker_id" uuid NOT NULL,
  "started_at" timestamptz NOT NULL,
  "completed_at" timestamptz,
  "lease_owner" uuid,
  "lease_fencing_token" bigint,
  "lease_expires_at" timestamptz,
  "error" jsonb,
  "next_run_at" timestamptz,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "monitoring_scheduler_heartbeat_stable_key_uq" ON kcml."monitoring_scheduler_heartbeat"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."monitoring_scheduler_heartbeat";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."monitoring_scheduler_heartbeat" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."audit_archive_outbox" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "event_id" uuid NOT NULL,
  "payload" jsonb NOT NULL,
  "state" text NOT NULL,
  "attempts" integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  "lease_owner" uuid,
  "lease_fencing_token" bigint,
  "lease_expires_at" timestamptz,
  "error" jsonb,
  "archived_at" timestamptz,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "audit_archive_outbox_stable_key_uq" ON kcml."audit_archive_outbox"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."audit_archive_outbox";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."audit_archive_outbox" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."component_audit_stream" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "component_id" uuid NOT NULL,
  "first_sequence" bigint NOT NULL DEFAULT 0,
  "last_sequence" bigint NOT NULL DEFAULT 0,
  "gap_state" text NOT NULL,
  "replay_state" text NOT NULL,
  "current_hash" bytea NOT NULL,
  "integrity_state" text NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "component_audit_stream_stable_key_uq" ON kcml."component_audit_stream"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."component_audit_stream";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."component_audit_stream" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS component_audit_stream_component_uq ON kcml.component_audit_stream(component_id);

CREATE TABLE IF NOT EXISTS kcml."component_audit_event" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "stream_id" uuid NOT NULL,
  "sequence" bigint NOT NULL,
  "workflow" text,
  "step" text,
  "actor" jsonb,
  "model" text,
  "tool" text,
  "service" text,
  "classifications" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "payload" jsonb NOT NULL,
  "access_channel" text,
  "binding_id" uuid,
  "protocol" text,
  "http_status" integer,
  "retry_classification" text,
  "causation_id" uuid,
  "trace_id" text,
  "span_id" text,
  "state_change" jsonb,
  "payload_digest" bytea NOT NULL,
  "previous_hash" bytea,
  "event_hash" bytea NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "component_audit_event_stable_key_uq" ON kcml."component_audit_event"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."component_audit_event";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."component_audit_event" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE UNIQUE INDEX IF NOT EXISTS component_audit_event_sequence_uq ON kcml.component_audit_event(stream_id,sequence);

CREATE TABLE IF NOT EXISTS kcml."debug_log_event" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "process_id" text,
  "service" text NOT NULL,
  "level" text NOT NULL,
  "message" text NOT NULL,
  "object_references" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "trace_id" text,
  "span_id" text,
  "structured_fields" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "full_payload" jsonb,
  "exception" text,
  "stack" text,
  "occurred_at" timestamptz NOT NULL,
  "retention_partition" text NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "debug_log_event_stable_key_uq" ON kcml."debug_log_event"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."debug_log_event";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."debug_log_event" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."generation_source" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "job_id" uuid NOT NULL,
  "source_kind" text NOT NULL CHECK (source_kind IN ('TEXT','FILE','IMAGE','URL','API_DOC','CREDENTIAL_REF','OBJECT_REF')),
  "original_name" text,
  "locator" text,
  "mime_type" text,
  "content_reference" text,
  "storage_reference" text,
  "content_digest" bytea NOT NULL,
  "status" text NOT NULL,
  "parser_version" text,
  "normalized_text_reference" text,
  "sensitivity" text NOT NULL,
  "retention_policy" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "parsed_at" timestamptz,
  "verified_at" timestamptz,
  "superseded_at" timestamptz,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "generation_source_stable_key_uq" ON kcml."generation_source"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."generation_source";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."generation_source" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."generation_fact" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "job_id" uuid NOT NULL,
  "source_id" uuid NOT NULL,
  "fact_key" text NOT NULL,
  "classification" text NOT NULL,
  "statement" text NOT NULL,
  "canonical_value" jsonb NOT NULL,
  "source_locator" text,
  "verification_method" text NOT NULL,
  "confidence_classification" text NOT NULL,
  "observed_at" timestamptz NOT NULL,
  "superseded_at" timestamptz,
  "fact_digest" bytea NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "generation_fact_stable_key_uq" ON kcml."generation_fact"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."generation_fact";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."generation_fact" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."generation_owner_decision" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "job_id" uuid NOT NULL,
  "owner_message_id" uuid NOT NULL,
  "decision_key" text NOT NULL,
  "specification_paths" text[] NOT NULL DEFAULT '{}',
  "exact_text" text NOT NULL,
  "structured_value" jsonb,
  "decision_digest" bytea NOT NULL,
  "superseded_by_id" uuid,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "generation_owner_decision_stable_key_uq" ON kcml."generation_owner_decision"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."generation_owner_decision";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."generation_owner_decision" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."generation_message" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "job_id" uuid NOT NULL,
  "sequence" bigint NOT NULL,
  "role" text NOT NULL,
  "content" jsonb NOT NULL,
  "attachments" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "status" text NOT NULL,
  "client_message_id" text,
  "turn_id" uuid,
  "completed_at" timestamptz,
  "interrupted_at" timestamptz,
  "content_digest" bytea NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "generation_message_stable_key_uq" ON kcml."generation_message"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."generation_message";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."generation_message" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."generation_turn" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "job_id" uuid NOT NULL,
  "input_message_id" uuid NOT NULL,
  "turn_sequence" bigint NOT NULL,
  "status" text NOT NULL,
  "worker_lease_owner" uuid,
  "worker_fencing_token" bigint,
  "worker_lease_expires_at" timestamptz,
  "worker_heartbeat_at" timestamptz,
  "active_model_call_id" uuid,
  "provider_response_id" text,
  "successor_turn_id" uuid,
  "successor_slot" text,
  "interruption_version" bigint NOT NULL DEFAULT 0,
  "cancellation_version" bigint NOT NULL DEFAULT 0,
  "interruption_intent" text,
  "interruption_reason" text,
  "latest_checkpoint_id" uuid,
  "pending_side_effects" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "error" jsonb,
  "terminal_outcome_digest" bytea,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "generation_turn_stable_key_uq" ON kcml."generation_turn"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."generation_turn";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."generation_turn" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."generation_spec_revision" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "job_id" uuid NOT NULL,
  "revision_number" bigint NOT NULL,
  "schema_version" text NOT NULL,
  "canonical_json" jsonb NOT NULL,
  "rendered_markdown" text NOT NULL,
  "spec_digest" bytea NOT NULL,
  "parent_revision_id" uuid,
  "capability_snapshot_id" uuid,
  "capability_digest" bytea,
  "conformance_precheck_state" text NOT NULL,
  "conformance_report" jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "generation_spec_revision_stable_key_uq" ON kcml."generation_spec_revision"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."generation_spec_revision";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."generation_spec_revision" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."generation_execution_authority" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "job_id" uuid NOT NULL,
  "authority_kind" text NOT NULL CHECK (authority_kind IN ('OWNER_APPROVED','INHERITED_TECHNICAL')),
  "source_job_id" uuid,
  "source_spec_id" uuid,
  "source_revision_id" uuid,
  "source_digest" bytea NOT NULL,
  "owner_approval_event_id" uuid,
  "target_identities_snapshot" jsonb NOT NULL,
  "lineage_digest" bytea NOT NULL,
  "frozen_at" timestamptz NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "generation_execution_authority_stable_key_uq" ON kcml."generation_execution_authority"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."generation_execution_authority";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."generation_execution_authority" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."generation_capability_snapshot" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "job_id" uuid NOT NULL,
  "specification_revision_id" uuid NOT NULL,
  "requirement_digest" bytea NOT NULL,
  "catalog_epoch" bigint NOT NULL,
  "snapshot_payload" jsonb NOT NULL,
  "snapshot_digest" bytea NOT NULL,
  "stale_at" timestamptz,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "generation_capability_snapshot_stable_key_uq" ON kcml."generation_capability_snapshot"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."generation_capability_snapshot";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."generation_capability_snapshot" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."generation_capability_match" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "snapshot_id" uuid NOT NULL,
  "requirement_id" text NOT NULL,
  "matched_object_kind" text,
  "matched_object_id" uuid,
  "component_id" uuid,
  "revision_id" uuid,
  "contract_digest" bytea,
  "behavior_coverage" jsonb NOT NULL,
  "schema_compatibility" jsonb NOT NULL,
  "runtime_eligibility" boolean NOT NULL,
  "binding_eligibility" boolean NOT NULL,
  "decision" text NOT NULL CHECK (decision IN ('FULL_REUSE','PARTIAL_REUSE','NEW_CAPABILITY_REQUIRED')),
  "evidence" jsonb NOT NULL,
  "score" double precision NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "generation_capability_match_stable_key_uq" ON kcml."generation_capability_match"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."generation_capability_match";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."generation_capability_match" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."generation_plan" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "job_id" uuid NOT NULL,
  "authority_id" uuid NOT NULL,
  "specification_id" uuid NOT NULL,
  "schema_version" text NOT NULL,
  "canonical_dag" jsonb NOT NULL,
  "plan_digest" bytea NOT NULL,
  "validation_state" text NOT NULL,
  "validation_report" jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "generation_plan_stable_key_uq" ON kcml."generation_plan"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."generation_plan";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."generation_plan" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."generation_plan_node" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "plan_id" uuid NOT NULL,
  "node_key" text NOT NULL,
  "node_kind" text NOT NULL,
  "purpose" text NOT NULL,
  "requirement_ids" text[] NOT NULL DEFAULT '{}',
  "input_artifacts" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "output_schema" jsonb NOT NULL,
  "output_digest" bytea,
  "execution_role" text NOT NULL,
  "side_effect_policy" text NOT NULL,
  "retry_policy" text NOT NULL,
  "idempotency_policy" text NOT NULL,
  "timeout_ms" integer NOT NULL,
  "budget" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "checkpoint_policy" jsonb NOT NULL,
  "compensation_policy" jsonb NOT NULL,
  "state" text NOT NULL,
  "result_artifact_id" uuid,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "generation_plan_node_stable_key_uq" ON kcml."generation_plan_node"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."generation_plan_node";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."generation_plan_node" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."generation_plan_edge" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "plan_id" uuid NOT NULL,
  "source_node_id" uuid NOT NULL,
  "target_node_id" uuid NOT NULL,
  "edge_kind" text NOT NULL CHECK (edge_kind IN ('DATA','CONTROL','ACTIVATION','COMPENSATION')),
  "required_artifact" jsonb,
  "required_schema" jsonb,
  "edge_digest" bytea NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "generation_plan_edge_stable_key_uq" ON kcml."generation_plan_edge"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."generation_plan_edge";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."generation_plan_edge" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."generation_phase_run" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "job_id" uuid NOT NULL,
  "phase" text NOT NULL,
  "attempt" bigint NOT NULL,
  "state" text NOT NULL,
  "worker_pool" text NOT NULL,
  "lease_owner" uuid,
  "lease_fencing_token" bigint,
  "lease_expires_at" timestamptz,
  "heartbeat_at" timestamptz,
  "plan_node_range" jsonb NOT NULL,
  "input_checkpoint_id" uuid,
  "output_checkpoint_id" uuid,
  "cancellation_version" bigint NOT NULL DEFAULT 0,
  "pending_side_effects" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "result_summary" jsonb,
  "result_digest" bytea,
  "blocker_id" uuid,
  "error" jsonb,
  "manual_review_id" uuid,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "generation_phase_run_stable_key_uq" ON kcml."generation_phase_run"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."generation_phase_run";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."generation_phase_run" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."generation_tool_event" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "job_id" uuid NOT NULL,
  "turn_id" uuid,
  "phase_run_id" uuid,
  "model_call_id" uuid,
  "tool_key" text NOT NULL,
  "provider_call_id" text,
  "state" text NOT NULL CHECK (state IN ('STARTED','PROGRESS','COMPLETED','FAILED','CANCELLED')),
  "canonical_arguments" jsonb NOT NULL,
  "arguments_digest" bytea NOT NULL,
  "canonical_result" jsonb,
  "result_digest" bytea,
  "domain_operation" text,
  "side_effect_classification" text NOT NULL,
  "audit_event_id" uuid,
  "started_at" timestamptz NOT NULL,
  "completed_at" timestamptz,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "generation_tool_event_stable_key_uq" ON kcml."generation_tool_event"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."generation_tool_event";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."generation_tool_event" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."generation_workspace_revision" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "job_id" uuid NOT NULL,
  "revision_number" bigint NOT NULL,
  "parent_revision_id" uuid,
  "source_tree_digest" bytea NOT NULL,
  "artifact_manifest_draft_digest" bytea,
  "created_by_model_call_id" uuid,
  "created_by_worker_id" uuid,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "generation_workspace_revision_stable_key_uq" ON kcml."generation_workspace_revision"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."generation_workspace_revision";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."generation_workspace_revision" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."generation_workspace_file" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "workspace_revision_id" uuid NOT NULL,
  "relative_path" text NOT NULL,
  "mime_type" text,
  "file_type" text NOT NULL,
  "executable" boolean NOT NULL DEFAULT false,
  "content_storage" text NOT NULL,
  "content_reference" text NOT NULL,
  "size_bytes" bigint NOT NULL CHECK (size_bytes >= 0),
  "content_digest" bytea NOT NULL,
  "source_classification" text NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "generation_workspace_file_stable_key_uq" ON kcml."generation_workspace_file"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."generation_workspace_file";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."generation_workspace_file" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."generation_workspace_patch" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "job_id" uuid NOT NULL,
  "phase_run_id" uuid NOT NULL,
  "model_call_id" uuid,
  "base_workspace_revision_id" uuid NOT NULL,
  "base_digest" bytea NOT NULL,
  "operations" jsonb NOT NULL,
  "operations_digest" bytea NOT NULL,
  "apply_state" text NOT NULL,
  "conflict" jsonb,
  "error" jsonb,
  "result_workspace_revision_id" uuid,
  "applied_at" timestamptz,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "generation_workspace_patch_stable_key_uq" ON kcml."generation_workspace_patch"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."generation_workspace_patch";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."generation_workspace_patch" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."generation_artifact_manifest" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "job_id" uuid NOT NULL,
  "workspace_revision_id" uuid NOT NULL,
  "candidate_release_id" uuid,
  "specification_digest" bytea NOT NULL,
  "authority_digest" bytea NOT NULL,
  "plan_digest" bytea NOT NULL,
  "manifest" jsonb NOT NULL,
  "manifest_digest" bytea NOT NULL,
  "completeness_state" text NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "generation_artifact_manifest_stable_key_uq" ON kcml."generation_artifact_manifest"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."generation_artifact_manifest";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."generation_artifact_manifest" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."generation_contract_candidate" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "job_id" uuid NOT NULL,
  "target_graph_node_id" uuid,
  "candidate_kind" text NOT NULL CHECK (candidate_kind IN ('COMPONENT','MCP_SERVER','MCP_TOOL','MCP_RESOURCE','MCP_PROMPT','AI_AGENT','AUTOMATION')),
  "proposed_identity" jsonb NOT NULL,
  "revision_payload" jsonb NOT NULL,
  "revision_digest" bytea NOT NULL,
  "specification_paths" text[] NOT NULL DEFAULT '{}',
  "validation_state" text NOT NULL,
  "verification_state" text NOT NULL,
  "integration_state" text NOT NULL DEFAULT 'PENDING',
  "integration_evidence" jsonb,
  "published_object_id" uuid,
  "published_revision_id" uuid,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "generation_contract_candidate_stable_key_uq" ON kcml."generation_contract_candidate"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."generation_contract_candidate";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."generation_contract_candidate" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."generation_validation_run" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "job_id" uuid NOT NULL,
  "phase_run_id" uuid,
  "workspace_revision_id" uuid,
  "candidate_id" uuid,
  "activation_set_id" uuid,
  "gate_catalog_version" text NOT NULL,
  "state" text NOT NULL,
  "started_at" timestamptz NOT NULL,
  "completed_at" timestamptz,
  "blocking_summary" jsonb,
  "evidence_digest" bytea,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "generation_validation_run_stable_key_uq" ON kcml."generation_validation_run"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."generation_validation_run";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."generation_validation_run" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."generation_validation_result" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "validation_run_id" uuid NOT NULL,
  "gate_key" text NOT NULL,
  "evaluator_version" text NOT NULL,
  "status" text NOT NULL CHECK (status IN ('PASS','FAIL','NOT_APPLICABLE')),
  "inputs" jsonb NOT NULL,
  "expected" jsonb NOT NULL,
  "actual" jsonb,
  "diagnostics" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "artifacts" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "logs" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "duration_ms" bigint NOT NULL,
  "result_digest" bytea NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "generation_validation_result_stable_key_uq" ON kcml."generation_validation_result"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."generation_validation_result";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."generation_validation_result" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."generation_repair_iteration" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "job_id" uuid NOT NULL,
  "phase" text NOT NULL,
  "iteration_number" bigint NOT NULL,
  "diagnostics_cluster" jsonb NOT NULL,
  "diagnostics_digest" bytea NOT NULL,
  "input_workspace_revision_id" uuid NOT NULL,
  "model_call_id" uuid,
  "patch_id" uuid,
  "output_workspace_revision_id" uuid,
  "progress_signature" bytea NOT NULL,
  "result" jsonb NOT NULL,
  "duration_ms" bigint NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "generation_repair_iteration_stable_key_uq" ON kcml."generation_repair_iteration"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."generation_repair_iteration";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."generation_repair_iteration" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."generation_blocker" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "job_id" uuid NOT NULL,
  "phase" text NOT NULL,
  "plan_node_id" uuid,
  "blocker_code" text NOT NULL,
  "classification" text NOT NULL,
  "title" text NOT NULL,
  "detail" text NOT NULL,
  "requirement_ids" text[] NOT NULL DEFAULT '{}',
  "evidence" jsonb NOT NULL,
  "required_resolution" text NOT NULL,
  "input_schema" jsonb,
  "resume_phase" text,
  "resume_checkpoint_id" uuid,
  "state" text NOT NULL,
  "resolved_at" timestamptz,
  "resolver" text,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "generation_blocker_stable_key_uq" ON kcml."generation_blocker"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."generation_blocker";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."generation_blocker" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."generation_activation_member" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "activation_set_id" uuid NOT NULL,
  "object_kind" text NOT NULL,
  "object_id" uuid NOT NULL,
  "previous_revision_id" uuid,
  "previous_release_id" uuid,
  "previous_binding_set_revision_id" uuid,
  "candidate_revision_id" uuid,
  "candidate_release_id" uuid,
  "candidate_binding_set_revision_id" uuid,
  "activation_order_key" text NOT NULL,
  "state" text NOT NULL,
  "evidence" jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "generation_activation_member_stable_key_uq" ON kcml."generation_activation_member"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."generation_activation_member";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."generation_activation_member" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."generation_event" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "job_id" uuid NOT NULL,
  "sequence" bigint NOT NULL,
  "event_type" text NOT NULL,
  "emitted_at" timestamptz NOT NULL,
  "persisted_at" timestamptz NOT NULL,
  "payload" jsonb NOT NULL,
  "payload_digest" bytea NOT NULL,
  "message_id" uuid,
  "turn_id" uuid,
  "phase_run_id" uuid,
  "model_call_id" uuid,
  "specification_id" uuid,
  "plan_id" uuid,
  "workspace_revision_id" uuid,
  "candidate_id" uuid,
  "activation_set_id" uuid,
  "causation_id" uuid,
  "trace_id" text,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "generation_event_stable_key_uq" ON kcml."generation_event"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."generation_event";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."generation_event" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."openai_model_capability_snapshot" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "model_id" text NOT NULL,
  "compatibility_profile" jsonb NOT NULL,
  "lifecycle_capabilities" jsonb NOT NULL,
  "structured_output_profile" jsonb NOT NULL,
  "tool_capabilities" jsonb NOT NULL,
  "modality_limits" jsonb NOT NULL,
  "source_evidence" jsonb NOT NULL,
  "verification_run_id" uuid,
  "observed_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "canonical_payload" jsonb NOT NULL,
  "payload_digest" bytea NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "openai_model_capability_snapshot_stable_key_uq" ON kcml."openai_model_capability_snapshot"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."openai_model_capability_snapshot";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."openai_model_capability_snapshot" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."openai_request_descriptor" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "model_logical_operation_id" uuid NOT NULL,
  "attempt" bigint NOT NULL,
  "owner_kind" text NOT NULL,
  "owner_object_id" uuid NOT NULL,
  "parent_checkpoint_id" uuid,
  "model_id" text NOT NULL,
  "api_kind" text NOT NULL,
  "execution_mode" text NOT NULL,
  "transport" text NOT NULL,
  "background_policy" text NOT NULL,
  "store_policy" text NOT NULL,
  "instructions_payload" text NOT NULL,
  "input_payload" jsonb NOT NULL,
  "tools_payload" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "output_schema_payload" jsonb,
  "instructions_digest" bytea NOT NULL,
  "input_digest" bytea NOT NULL,
  "tools_digest" bytea NOT NULL,
  "output_schema_digest" bytea,
  "model_settings" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "history_strategy" text NOT NULL,
  "provider_continuation_handles" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "capability_snapshot_id" uuid,
  "sdk_version" text NOT NULL,
  "adapter_version" text NOT NULL,
  "serializer_version" text NOT NULL,
  "budgets" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "timeout_ms" integer NOT NULL,
  "deadline_at" timestamptz,
  "causation_id" uuid,
  "trace_id" text,
  "group_id" text,
  "idempotency_scope" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_digest" bytea NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "openai_request_descriptor_stable_key_uq" ON kcml."openai_request_descriptor"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."openai_request_descriptor";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."openai_request_descriptor" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."ai_model_event" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "model_call_id" uuid NOT NULL,
  "sequence" bigint NOT NULL,
  "provider_response_id" text,
  "provider_sequence" bigint,
  "event_type" text NOT NULL,
  "raw_payload" jsonb NOT NULL,
  "payload_digest" bytea NOT NULL,
  "persisted_at" timestamptz NOT NULL,
  "published_at" timestamptz,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "ai_model_event_stable_key_uq" ON kcml."ai_model_event"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."ai_model_event";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."ai_model_event" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."ai_model_output_item" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "model_call_id" uuid NOT NULL,
  "provider_response_id" text NOT NULL,
  "output_index" integer NOT NULL CHECK (output_index >= 0),
  "provider_item_id" text,
  "item_type" text NOT NULL,
  "status" text,
  "provider_call_id" text,
  "raw_payload" jsonb NOT NULL,
  "payload_digest" bytea NOT NULL,
  "first_provider_sequence" bigint,
  "last_provider_sequence" bigint,
  "interpretation_state" text NOT NULL,
  "compatibility_profile" jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "ai_model_output_item_stable_key_uq" ON kcml."ai_model_output_item"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."ai_model_output_item";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."ai_model_output_item" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."ai_model_output_content_part" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "output_item_id" uuid NOT NULL,
  "content_index" integer NOT NULL CHECK (content_index >= 0),
  "content_type" text NOT NULL,
  "payload" jsonb NOT NULL,
  "payload_digest" bytea NOT NULL,
  "annotations" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "artifact_references" jsonb NOT NULL DEFAULT '[]'::jsonb,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "ai_model_output_content_part_stable_key_uq" ON kcml."ai_model_output_content_part"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."ai_model_output_content_part";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."ai_model_output_content_part" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."ai_tool_dispatch" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "model_call_id" uuid NOT NULL,
  "provider_output_ordinal" integer NOT NULL,
  "provider_call_id" text NOT NULL,
  "provider_item_id" text,
  "tool_key" text NOT NULL,
  "binding_key" text NOT NULL,
  "binding_revision" bigint NOT NULL,
  "tool_digest" bytea NOT NULL,
  "binding_digest" bytea NOT NULL,
  "raw_arguments" text NOT NULL,
  "canonical_arguments" jsonb NOT NULL,
  "arguments_digest" bytea NOT NULL,
  "call_ordinal" bigint NOT NULL,
  "execution_group" text,
  "state" text NOT NULL,
  "approval_request_id" uuid,
  "domain_operation_id" uuid,
  "side_effect_operation_id" uuid,
  "idempotency_relation" jsonb,
  "result_payload" jsonb,
  "error_payload" jsonb,
  "result_digest" bytea,
  "function_output_payload" jsonb,
  "function_output_digest" bytea,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "ai_tool_dispatch_stable_key_uq" ON kcml."ai_tool_dispatch"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."ai_tool_dispatch";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."ai_tool_dispatch" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."ai_model_continuation" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "parent_run_id" uuid NOT NULL,
  "parent_turn_id" uuid,
  "producing_model_call_id" uuid NOT NULL,
  "provider_response_id" text NOT NULL,
  "continuation_generation" bigint NOT NULL,
  "history_strategy" text NOT NULL,
  "resolved_tool_calls" jsonb NOT NULL,
  "aggregate_digest" bytea NOT NULL,
  "previous_response_id" text,
  "conversation_id" text,
  "history_cursor" text,
  "successor_request_descriptor_id" uuid,
  "successor_model_call_id" uuid,
  "state" text NOT NULL,
  "checkpoint_id" uuid,
  "queue_item_id" uuid,
  "outbox_event_id" uuid,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "ai_model_continuation_stable_key_uq" ON kcml."ai_model_continuation"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."ai_model_continuation";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."ai_model_continuation" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."ai_run_state_checkpoint" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "owner_kind" text NOT NULL,
  "owner_id" uuid NOT NULL,
  "run_state_payload" jsonb NOT NULL,
  "serializer_version" text NOT NULL,
  "openai_version" text NOT NULL,
  "agents_sdk_version" text NOT NULL,
  "adapter_version" text NOT NULL,
  "code_runtime_version" text NOT NULL,
  "agent_graph_identity_map" jsonb NOT NULL,
  "agent_graph_digest" bytea NOT NULL,
  "instruction_digest" bytea NOT NULL,
  "tools_digest" bytea NOT NULL,
  "session_digest" bytea,
  "guardrail_digest" bytea,
  "output_digest" bytea,
  "tool_use_behavior" text,
  "reasoning_item_id" text,
  "tool_execution_policies" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "pending_interruptions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "nested_resumptions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "pending_calls" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "pending_output_ownership" jsonb,
  "budget_snapshot" jsonb NOT NULL,
  "usage_snapshot" jsonb NOT NULL,
  "turn_snapshot" jsonb NOT NULL,
  "provider_handles" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "session_strategy" text NOT NULL,
  "session_version" bigint,
  "session_cursor" text,
  "checkpoint_sequence" bigint NOT NULL,
  "previous_checkpoint_id" uuid,
  "checkpoint_digest" bytea NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "ai_run_state_checkpoint_stable_key_uq" ON kcml."ai_run_state_checkpoint"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."ai_run_state_checkpoint";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."ai_run_state_checkpoint" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."agent_session_compaction" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "session_id" uuid NOT NULL,
  "source_session_version" bigint NOT NULL CHECK (source_session_version > 0),
  "source_first_item_sequence" bigint NOT NULL CHECK (source_first_item_sequence > 0),
  "source_last_item_sequence" bigint NOT NULL,
  "source_aggregate_digest" bytea NOT NULL,
  "mode" text NOT NULL CHECK (mode IN ('INPUT','PREVIOUS_RESPONSE_ID')),
  "model_id" text NOT NULL,
  "capability_snapshot_id" uuid,
  "sdk_version" text NOT NULL,
  "adapter_version" text NOT NULL,
  "request_descriptor_id" uuid,
  "provider_handle" jsonb,
  "compacted_items" jsonb NOT NULL,
  "compacted_items_digest" bytea NOT NULL,
  "validation_evidence" jsonb NOT NULL,
  "equivalence_evidence" jsonb NOT NULL,
  "state" text NOT NULL CHECK (state IN ('CANDIDATE','VALIDATED','ACTIVE','REJECTED','SUPERSEDED')),
  "active_pointer_relation" jsonb,
  "activated_at" timestamptz,
  "completed_at" timestamptz,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "agent_session_compaction_stable_key_uq" ON kcml."agent_session_compaction"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."agent_session_compaction";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."agent_session_compaction" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE UNIQUE INDEX IF NOT EXISTS agent_session_compaction_source_uq ON kcml.agent_session_compaction(session_id,source_session_version,source_first_item_sequence,source_last_item_sequence);
CREATE UNIQUE INDEX IF NOT EXISTS agent_session_compaction_active_uq ON kcml.agent_session_compaction(session_id) WHERE state = 'ACTIVE';

CREATE TABLE IF NOT EXISTS kcml."agent_definition" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "component_id" uuid,
  "runtime_identity_kind" text NOT NULL,
  "purpose" text NOT NULL,
  "status" text NOT NULL CHECK (status IN ('DRAFT','ACTIVE','SUSPENDED','RETIRED')),
  "mode" text NOT NULL CHECK (mode IN ('INTERACTIVE','TRIGGERED','EVALUATION','REPAIR')),
  "active_revision_id" uuid,
  "enabled" boolean NOT NULL DEFAULT false,
  "retired_at" timestamptz,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "agent_definition_stable_key_uq" ON kcml."agent_definition"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."agent_definition";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."agent_definition" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS agent_definition_component_uq ON kcml.agent_definition(component_id) WHERE component_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS kcml."agent_revision" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "agent_definition_id" uuid NOT NULL REFERENCES kcml.agent_definition(id),
  "revision_number" bigint NOT NULL CHECK (revision_number > 0),
  "schema_version" text NOT NULL,
  "purpose" text NOT NULL,
  "success_definition" jsonb NOT NULL,
  "canonical_instructions" text NOT NULL,
  "variable_schema" jsonb NOT NULL,
  "openai_model" text NOT NULL,
  "model_settings" jsonb NOT NULL,
  "input_schema" jsonb NOT NULL,
  "output_schema" jsonb NOT NULL,
  "run_policy" jsonb NOT NULL,
  "trigger_policy" jsonb NOT NULL,
  "session_policy" jsonb NOT NULL,
  "memory_policy" jsonb NOT NULL,
  "budget_policy" jsonb NOT NULL,
  "concurrency_policy" jsonb NOT NULL,
  "monitoring_profile" jsonb NOT NULL,
  "evaluation_profile" jsonb NOT NULL,
  "secret_references" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "specification_lineage" jsonb NOT NULL,
  "canonical_payload" jsonb NOT NULL,
  "payload_digest" bytea NOT NULL,
  "validation_state" text NOT NULL,
  "validation_evidence" jsonb NOT NULL,
  "verification_state" text NOT NULL,
  "verification_evidence" jsonb NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "agent_revision_stable_key_uq" ON kcml."agent_revision"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."agent_revision";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."agent_revision" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE UNIQUE INDEX IF NOT EXISTS agent_revision_number_uq ON kcml.agent_revision(agent_definition_id,revision_number);
CREATE UNIQUE INDEX IF NOT EXISTS agent_revision_payload_uq ON kcml.agent_revision(agent_definition_id,payload_digest);

CREATE TABLE IF NOT EXISTS kcml."agent_tool_binding" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "agent_revision_id" uuid NOT NULL REFERENCES kcml.agent_revision(id),
  "source_kind" text NOT NULL,
  "source_object_id" uuid NOT NULL,
  "source_revision_id" uuid NOT NULL,
  "source_contract_digest" bytea NOT NULL,
  "model_alias" text NOT NULL,
  "exposure_filter" jsonb NOT NULL,
  "operation_scope" jsonb NOT NULL,
  "contract_binding_id" uuid,
  "input_schema_digest" bytea NOT NULL,
  "output_schema_digest" bytea NOT NULL,
  "side_effect_policy" text NOT NULL,
  "retry_policy" text NOT NULL,
  "timeout_ms" bigint NOT NULL CHECK (timeout_ms > 0),
  "approval_policy" jsonb NOT NULL,
  "result_policy" jsonb NOT NULL,
  "compatibility_state" text NOT NULL,
  "binding_digest" bytea NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "agent_tool_binding_stable_key_uq" ON kcml."agent_tool_binding"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."agent_tool_binding";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."agent_tool_binding" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE UNIQUE INDEX IF NOT EXISTS agent_tool_binding_alias_uq ON kcml.agent_tool_binding(agent_revision_id,model_alias);
CREATE UNIQUE INDEX IF NOT EXISTS agent_tool_binding_digest_uq ON kcml.agent_tool_binding(agent_revision_id,binding_digest);

CREATE TABLE IF NOT EXISTS kcml."agent_handoff_binding" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "source_agent_revision_id" uuid NOT NULL REFERENCES kcml.agent_revision(id),
  "target_agent_revision_id" uuid NOT NULL REFERENCES kcml.agent_revision(id),
  "orchestration_pattern" text NOT NULL CHECK (orchestration_pattern IN ('HANDOFF','AGENT_AS_TOOL')),
  "purpose" text NOT NULL,
  "input_schema" jsonb NOT NULL,
  "output_schema" jsonb NOT NULL,
  "context_projection" jsonb NOT NULL,
  "allowed_tools" text[] NOT NULL DEFAULT '{}',
  "budget" jsonb NOT NULL,
  "max_depth" integer NOT NULL CHECK (max_depth > 0),
  "cancellation_policy" jsonb NOT NULL,
  "approval_policy" jsonb NOT NULL,
  "binding_digest" bytea NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "agent_handoff_binding_stable_key_uq" ON kcml."agent_handoff_binding"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."agent_handoff_binding";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."agent_handoff_binding" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE UNIQUE INDEX IF NOT EXISTS agent_handoff_binding_pair_uq ON kcml.agent_handoff_binding(source_agent_revision_id,target_agent_revision_id,orchestration_pattern,binding_digest);

CREATE TABLE IF NOT EXISTS kcml."agent_guardrail" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "agent_revision_id" uuid NOT NULL REFERENCES kcml.agent_revision(id),
  "kind" text NOT NULL CHECK (kind IN ('INPUT','OUTPUT','TOOL_INPUT','TOOL_OUTPUT','KCIP_PRE','KCIP_POST')),
  "guardrail_key" text NOT NULL,
  "rule_schema" jsonb,
  "rule" jsonb,
  "evaluator_reference" jsonb,
  "failure_action" text NOT NULL,
  "priority" integer NOT NULL,
  "guardrail_digest" bytea NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "agent_guardrail_stable_key_uq" ON kcml."agent_guardrail"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."agent_guardrail";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."agent_guardrail" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE UNIQUE INDEX IF NOT EXISTS agent_guardrail_key_uq ON kcml.agent_guardrail(agent_revision_id,kind,guardrail_key);

CREATE TABLE IF NOT EXISTS kcml."agent_session" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "agent_definition_id" uuid NOT NULL REFERENCES kcml.agent_definition(id),
  "agent_revision_id" uuid NOT NULL REFERENCES kcml.agent_revision(id),
  "session_key" text NOT NULL,
  "caller_scope" jsonb NOT NULL,
  "strategy" text NOT NULL,
  "provider_conversation_id" text,
  "previous_response_id" text,
  "current_item_sequence" bigint NOT NULL DEFAULT 0 CHECK (current_item_sequence >= 0),
  "state" text NOT NULL CHECK (state IN ('OPEN','COMPACTING','CLOSING','CLOSED','EXPIRED')),
  "lock_version" bigint NOT NULL DEFAULT 1 CHECK (lock_version > 0),
  "last_activity_at" timestamptz NOT NULL,
  "expires_at" timestamptz,
  "closed_at" timestamptz,
  "active_compaction_id" uuid,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "agent_session_stable_key_uq" ON kcml."agent_session"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."agent_session";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."agent_session" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS agent_session_key_uq ON kcml.agent_session(agent_definition_id,session_key);

CREATE TABLE IF NOT EXISTS kcml."agent_session_item" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "session_id" uuid NOT NULL REFERENCES kcml.agent_session(id),
  "sequence" bigint NOT NULL CHECK (sequence > 0),
  "item_kind" text NOT NULL,
  "role" text,
  "payload" jsonb NOT NULL,
  "payload_digest" bytea NOT NULL,
  "source_run_id" uuid,
  "source_model_call_id" uuid,
  "source_tool_call_id" uuid,
  "source_handoff_run_id" uuid,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "agent_session_item_stable_key_uq" ON kcml."agent_session_item"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."agent_session_item";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."agent_session_item" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE UNIQUE INDEX IF NOT EXISTS agent_session_item_sequence_uq ON kcml.agent_session_item(session_id,sequence);

CREATE TABLE IF NOT EXISTS kcml."agent_run_checkpoint" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "agent_run_id" uuid NOT NULL REFERENCES kcml.agent_run(id),
  "sequence" bigint NOT NULL CHECK (sequence > 0),
  "run_state" text NOT NULL,
  "completed_item_sequence" bigint NOT NULL CHECK (completed_item_sequence >= 0),
  "session_cursor" text,
  "pending_model_calls" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "pending_tool_calls" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "pending_handoffs" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "pending_approvals" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "budget_snapshot" jsonb NOT NULL,
  "usage_snapshot" jsonb NOT NULL,
  "sdk_run_state_checkpoint_id" uuid,
  "lease_fencing_token" bigint NOT NULL,
  "payload_digest" bytea NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "agent_run_checkpoint_stable_key_uq" ON kcml."agent_run_checkpoint"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."agent_run_checkpoint";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."agent_run_checkpoint" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE UNIQUE INDEX IF NOT EXISTS agent_run_checkpoint_sequence_uq ON kcml.agent_run_checkpoint(agent_run_id,sequence);

CREATE TABLE IF NOT EXISTS kcml."agent_message" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "agent_run_id" uuid NOT NULL REFERENCES kcml.agent_run(id),
  "sequence" bigint NOT NULL CHECK (sequence > 0),
  "role" text NOT NULL,
  "item_type" text NOT NULL,
  "content" text,
  "payload" jsonb NOT NULL,
  "payload_digest" bytea NOT NULL,
  "model_call_id" uuid,
  "tool_call_id" uuid,
  "handoff_run_id" uuid,
  "status" text NOT NULL CHECK (status IN ('PENDING','COMPLETED','FAILED','CANCELLED')),
  "completed_at" timestamptz,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "agent_message_stable_key_uq" ON kcml."agent_message"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."agent_message";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."agent_message" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS agent_message_sequence_uq ON kcml.agent_message(agent_run_id,sequence);

CREATE TABLE IF NOT EXISTS kcml."agent_tool_call" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "agent_run_id" uuid NOT NULL REFERENCES kcml.agent_run(id),
  "model_call_id" uuid NOT NULL,
  "tool_binding_id" uuid NOT NULL REFERENCES kcml.agent_tool_binding(id),
  "target" jsonb NOT NULL,
  "provider_call_id" text NOT NULL,
  "canonical_arguments" jsonb NOT NULL,
  "arguments_digest" bytea NOT NULL,
  "canonical_result" jsonb,
  "result_digest" bytea,
  "status" text NOT NULL CHECK (status IN ('RESERVED','WAITING_FOR_APPROVAL','EXECUTING','RECONCILING','SUCCEEDED','FAILED','CANCELLED','MANUAL_REVIEW')),
  "approval_request_id" uuid,
  "idempotency_relation" jsonb,
  "trace_id" text,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "error" jsonb,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "agent_tool_call_stable_key_uq" ON kcml."agent_tool_call"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."agent_tool_call";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."agent_tool_call" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS agent_tool_call_provider_uq ON kcml.agent_tool_call(model_call_id,provider_call_id);

CREATE TABLE IF NOT EXISTS kcml."agent_handoff_run" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "root_agent_run_id" uuid NOT NULL REFERENCES kcml.agent_run(id),
  "source_agent_revision_id" uuid NOT NULL REFERENCES kcml.agent_revision(id),
  "target_agent_revision_id" uuid NOT NULL REFERENCES kcml.agent_revision(id),
  "handoff_binding_id" uuid NOT NULL REFERENCES kcml.agent_handoff_binding(id),
  "depth" integer NOT NULL CHECK (depth > 0),
  "parent_handoff_run_id" uuid REFERENCES kcml.agent_handoff_run(id),
  "input" jsonb NOT NULL,
  "input_digest" bytea NOT NULL,
  "output" jsonb,
  "output_digest" bytea,
  "status" text NOT NULL CHECK (status IN ('RESERVED','RUNNING','WAITING_FOR_APPROVAL','SUCCEEDED','FAILED','CANCELLED','MANUAL_REVIEW')),
  "budget" jsonb NOT NULL,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "error" jsonb,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "agent_handoff_run_stable_key_uq" ON kcml."agent_handoff_run"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."agent_handoff_run";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."agent_handoff_run" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."agent_approval_request" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "root_agent_run_id" uuid NOT NULL REFERENCES kcml.agent_run(id),
  "tool_call_id" uuid REFERENCES kcml.agent_tool_call(id),
  "handoff_run_id" uuid REFERENCES kcml.agent_handoff_run(id),
  "target" jsonb NOT NULL,
  "arguments" jsonb NOT NULL,
  "arguments_digest" bytea NOT NULL,
  "consequence_summary" text NOT NULL,
  "policy_source" jsonb NOT NULL,
  "status" text NOT NULL CHECK (status IN ('PENDING','APPROVED','REJECTED','EXPIRED','CANCELLED')),
  "expires_at" timestamptz NOT NULL,
  "owner_decision" jsonb,
  "owner_message_id" uuid,
  "audit_event_id" uuid,
  "checkpoint_id" uuid,
  "decided_at" timestamptz,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "agent_approval_request_stable_key_uq" ON kcml."agent_approval_request"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."agent_approval_request";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."agent_approval_request" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS agent_approval_tool_pending_uq ON kcml.agent_approval_request(tool_call_id) WHERE tool_call_id IS NOT NULL AND status = 'PENDING';
CREATE UNIQUE INDEX IF NOT EXISTS agent_approval_handoff_pending_uq ON kcml.agent_approval_request(handoff_run_id) WHERE handoff_run_id IS NOT NULL AND status = 'PENDING';

CREATE TABLE IF NOT EXISTS kcml."agent_memory_namespace" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "agent_definition_id" uuid NOT NULL REFERENCES kcml.agent_definition(id),
  "memory_type" text NOT NULL,
  "content_schema" jsonb NOT NULL,
  "retention_policy" jsonb NOT NULL,
  "indexing_policy" jsonb NOT NULL,
  "access_policy" jsonb NOT NULL,
  "quota" jsonb NOT NULL,
  "namespace_digest" bytea NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "agent_memory_namespace_stable_key_uq" ON kcml."agent_memory_namespace"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."agent_memory_namespace";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."agent_memory_namespace" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS agent_memory_namespace_type_uq ON kcml.agent_memory_namespace(agent_definition_id,memory_type);

CREATE TABLE IF NOT EXISTS kcml."agent_memory_item" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "namespace_id" uuid NOT NULL REFERENCES kcml.agent_memory_namespace(id),
  "memory_key" text NOT NULL,
  "content" jsonb NOT NULL,
  "vector_reference" jsonb,
  "metadata" jsonb NOT NULL,
  "source_agent_run_id" uuid REFERENCES kcml.agent_run(id),
  "content_digest" bytea NOT NULL,
  "superseded_by_id" uuid REFERENCES kcml.agent_memory_item(id),
  "superseded_at" timestamptz,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "agent_memory_item_stable_key_uq" ON kcml."agent_memory_item"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."agent_memory_item";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."agent_memory_item" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS agent_memory_item_current_key_uq ON kcml.agent_memory_item(namespace_id,memory_key) WHERE superseded_at IS NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS kcml."agent_trigger" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "agent_revision_id" uuid NOT NULL REFERENCES kcml.agent_revision(id),
  "trigger_kind" text NOT NULL CHECK (trigger_kind IN ('EVENT','SCHEDULE','API','MANUAL')),
  "configuration" jsonb NOT NULL,
  "input_mapping" jsonb NOT NULL,
  "idempotency_policy" jsonb NOT NULL,
  "concurrency_policy" jsonb NOT NULL,
  "enabled" boolean NOT NULL DEFAULT false,
  "trigger_digest" bytea NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "agent_trigger_stable_key_uq" ON kcml."agent_trigger"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."agent_trigger";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."agent_trigger" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS agent_trigger_digest_uq ON kcml.agent_trigger(agent_revision_id,trigger_kind,trigger_digest);

CREATE TABLE IF NOT EXISTS kcml."agent_eval_suite" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "agent_revision_id" uuid NOT NULL REFERENCES kcml.agent_revision(id),
  "suite_version" text NOT NULL,
  "promotion_policy" jsonb NOT NULL,
  "blocking_thresholds" jsonb NOT NULL,
  "aggregate_thresholds" jsonb NOT NULL,
  "canonical_payload" jsonb NOT NULL,
  "suite_digest" bytea NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "agent_eval_suite_stable_key_uq" ON kcml."agent_eval_suite"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."agent_eval_suite";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."agent_eval_suite" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE UNIQUE INDEX IF NOT EXISTS agent_eval_suite_version_uq ON kcml.agent_eval_suite(agent_revision_id,suite_version);

CREATE TABLE IF NOT EXISTS kcml."agent_eval_case" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "eval_suite_id" uuid NOT NULL REFERENCES kcml.agent_eval_suite(id),
  "case_key" text NOT NULL,
  "input" jsonb NOT NULL,
  "fixtures" jsonb NOT NULL,
  "expected_schemas" jsonb NOT NULL,
  "expected_invariants" jsonb NOT NULL,
  "grader" jsonb NOT NULL,
  "threshold" numeric NOT NULL,
  "side_effect_contract" jsonb NOT NULL,
  "cleanup_contract" jsonb NOT NULL,
  "blocking" boolean NOT NULL,
  "case_digest" bytea NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "agent_eval_case_stable_key_uq" ON kcml."agent_eval_case"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."agent_eval_case";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."agent_eval_case" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE UNIQUE INDEX IF NOT EXISTS agent_eval_case_key_uq ON kcml.agent_eval_case(eval_suite_id,case_key);

CREATE TABLE IF NOT EXISTS kcml."agent_eval_run" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "eval_suite_id" uuid NOT NULL REFERENCES kcml.agent_eval_suite(id),
  "agent_revision_id" uuid NOT NULL REFERENCES kcml.agent_revision(id),
  "model_snapshot" jsonb NOT NULL,
  "tool_snapshot" jsonb NOT NULL,
  "state" text NOT NULL CHECK (state IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED','MANUAL_REVIEW')),
  "environment" jsonb NOT NULL,
  "seed" bigint NOT NULL,
  "fixture_namespace" text NOT NULL,
  "summary_metrics" jsonb,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "evidence_digest" bytea,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "agent_eval_run_stable_key_uq" ON kcml."agent_eval_run"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."agent_eval_run";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."agent_eval_run" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."agent_eval_case_result" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "eval_run_id" uuid NOT NULL REFERENCES kcml.agent_eval_run(id),
  "eval_case_id" uuid NOT NULL REFERENCES kcml.agent_eval_case(id),
  "agent_run_id" uuid REFERENCES kcml.agent_run(id),
  "status" text NOT NULL CHECK (status IN ('PASS','FAIL','NOT_EXECUTED_ENVIRONMENTAL','ERROR')),
  "expected" jsonb NOT NULL,
  "actual" jsonb,
  "grader_outputs" jsonb NOT NULL,
  "usage" jsonb,
  "latency_ms" bigint,
  "cost_microunits" bigint,
  "evidence" jsonb NOT NULL,
  "cleanup_result" jsonb NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "agent_eval_case_result_stable_key_uq" ON kcml."agent_eval_case_result"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."agent_eval_case_result";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."agent_eval_case_result" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE UNIQUE INDEX IF NOT EXISTS agent_eval_case_result_uq ON kcml.agent_eval_case_result(eval_run_id,eval_case_id);

CREATE TABLE IF NOT EXISTS kcml."system_chat_conversation" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "title" text NOT NULL,
  "owner_actor_id" text NOT NULL DEFAULT 'KRMAR78' CHECK (owner_actor_id = 'KRMAR78'),
  "access_channel" text NOT NULL CHECK (access_channel IN ('SESSION','API_KEY')),
  "status" text NOT NULL CHECK (status IN ('OPEN','PROCESSING','WAITING_FOR_OWNER','CLOSED','FAILED')),
  "selected_model" text NOT NULL,
  "agent_definition_id" uuid,
  "agent_session_id" uuid,
  "last_activity_at" timestamptz NOT NULL,
  "current_object_context" jsonb NOT NULL,
  "generation_job_id" uuid,
  "active_browser_session_id" uuid,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "system_chat_conversation_stable_key_uq" ON kcml."system_chat_conversation"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."system_chat_conversation";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."system_chat_conversation" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."system_chat_message" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "conversation_id" uuid NOT NULL REFERENCES kcml.system_chat_conversation(id),
  "sequence" bigint NOT NULL CHECK (sequence > 0),
  "role" text NOT NULL CHECK (role IN ('OWNER','ASSISTANT','SYSTEM','TOOL')),
  "content" text NOT NULL,
  "attachments" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "model_call_id" uuid,
  "status" text NOT NULL CHECK (status IN ('PENDING','STREAMING','COMPLETED','FAILED','CANCELLED')),
  "usage" jsonb,
  "completed_at" timestamptz,
  "causation_id" uuid,
  "related_object_ids" uuid[] NOT NULL DEFAULT '{}',
  "browser_target_reference_ids" uuid[] NOT NULL DEFAULT '{}',
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "system_chat_message_stable_key_uq" ON kcml."system_chat_message"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."system_chat_message";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."system_chat_message" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS system_chat_message_sequence_uq ON kcml.system_chat_message(conversation_id,sequence);
CREATE UNIQUE INDEX IF NOT EXISTS system_chat_assistant_causation_uq ON kcml.system_chat_message(causation_id) WHERE role = 'ASSISTANT' AND causation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS kcml."system_chat_action" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "message_id" uuid NOT NULL REFERENCES kcml.system_chat_message(id),
  "operation_key" text NOT NULL,
  "target" jsonb NOT NULL,
  "arguments" jsonb NOT NULL,
  "arguments_digest" bytea NOT NULL,
  "result" jsonb,
  "result_digest" bytea,
  "status" text NOT NULL CHECK (status IN ('PROPOSED','RESERVED','EXECUTING','SUCCEEDED','FAILED','CANCELLED','MANUAL_REVIEW')),
  "idempotency_relation" jsonb,
  "audit_event_id" uuid,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "system_chat_action_stable_key_uq" ON kcml."system_chat_action"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."system_chat_action";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."system_chat_action" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS system_chat_action_operation_uq ON kcml.system_chat_action(message_id,operation_key,arguments_digest);

CREATE TABLE IF NOT EXISTS kcml."browser_runtime_build_manifest" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "application_release_id" text NOT NULL,
  "source_commit" text NOT NULL CHECK (source_commit ~ '^[0-9a-f]{40}$'),
  "node_version" text NOT NULL,
  "playwright_version" text NOT NULL,
  "locator_compiler_version" text NOT NULL,
  "preview_adapter_version" text NOT NULL,
  "automation_interpreter_version" text NOT NULL,
  "state_serializer_version" text NOT NULL,
  "browser_engine" text NOT NULL,
  "browser_channel" text NOT NULL,
  "browser_revision" text NOT NULL,
  "executable_digest" bytea NOT NULL,
  "dependency_digest" bytea NOT NULL,
  "os_image" text NOT NULL,
  "os_release" text NOT NULL,
  "architecture" text NOT NULL,
  "runtime_libraries_digest" bytea NOT NULL,
  "fonts_digest" bytea NOT NULL,
  "locale_timezone_digest" bytea NOT NULL,
  "sandbox_profile_digest" bytea NOT NULL,
  "launch_mode" text NOT NULL CHECK (launch_mode IN ('HEADLESS','HEADED')),
  "launch_arguments" jsonb NOT NULL,
  "environment_allowlist_digest" bytea NOT NULL,
  "capability_map" jsonb NOT NULL,
  "state_bundle_compatibility" jsonb NOT NULL,
  "automation_compatibility" jsonb NOT NULL,
  "host_generation_compatibility" jsonb NOT NULL,
  "manifest_payload" jsonb NOT NULL,
  "manifest_digest" bytea NOT NULL,
  "validation_state" text NOT NULL,
  "verification_state" text NOT NULL,
  "evidence" jsonb NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "browser_runtime_build_manifest_stable_key_uq" ON kcml."browser_runtime_build_manifest"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."browser_runtime_build_manifest";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."browser_runtime_build_manifest" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE UNIQUE INDEX IF NOT EXISTS browser_runtime_build_manifest_digest_uq ON kcml.browser_runtime_build_manifest(manifest_digest);

CREATE TABLE IF NOT EXISTS kcml."browser_session_binding" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "session_id" uuid NOT NULL REFERENCES kcml.browser_session(id),
  "related_object_kind" text NOT NULL,
  "related_object_id" uuid NOT NULL,
  "relation" text NOT NULL CHECK (relation IN ('OWNER','VIEWER','SOURCE','RESULT','AUDIT')),
  "revoked_at" timestamptz,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "browser_session_binding_stable_key_uq" ON kcml."browser_session_binding"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_session_binding";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_session_binding" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS browser_session_binding_relation_uq ON kcml.browser_session_binding(session_id,related_object_kind,related_object_id,relation) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS kcml."browser_host_slot" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "host_id" uuid NOT NULL,
  "slot_key" text NOT NULL,
  "runtime_build_manifest_id" uuid NOT NULL REFERENCES kcml.browser_runtime_build_manifest(id),
  "process_identity_id" uuid,
  "host_generation" bigint NOT NULL CHECK (host_generation > 0),
  "systemd_unit" text NOT NULL,
  "invocation_id" uuid NOT NULL,
  "boot_id" uuid NOT NULL,
  "pid" integer NOT NULL CHECK (pid > 0),
  "process_start_ticks" bigint NOT NULL,
  "cgroup_path" text NOT NULL,
  "capacity" integer NOT NULL CHECK (capacity > 0),
  "current_contexts" integer NOT NULL DEFAULT 0 CHECK (current_contexts >= 0),
  "drain_state" text NOT NULL,
  "admission_state" text NOT NULL,
  "uds_endpoint" text NOT NULL,
  "uds_inode" bigint NOT NULL,
  "uds_fingerprint" bytea NOT NULL,
  "lease_owner" uuid,
  "lease_fencing_token" bigint,
  "lease_expires_at" timestamptz,
  "heartbeat_at" timestamptz,
  "previous_deployment_epoch" bigint,
  "last_crash_at" timestamptz,
  "last_restart_at" timestamptz,
  "last_error" jsonb,
  "cleanup_evidence" jsonb,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "browser_host_slot_stable_key_uq" ON kcml."browser_host_slot"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_host_slot";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_host_slot" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS browser_host_slot_generation_uq ON kcml.browser_host_slot(host_id,slot_key,host_generation);
CREATE UNIQUE INDEX IF NOT EXISTS browser_host_slot_uds_active_uq ON kcml.browser_host_slot(uds_inode,uds_fingerprint) WHERE admission_state <> 'CLOSED';

CREATE TABLE IF NOT EXISTS kcml."browser_context_instance" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "session_id" uuid NOT NULL REFERENCES kcml.browser_session(id),
  "context_key" text NOT NULL,
  "context_generation" bigint NOT NULL CHECK (context_generation > 0),
  "host_slot_id" uuid REFERENCES kcml.browser_host_slot(id),
  "bridge_id" uuid,
  "profile_id" text,
  "runtime_build_manifest_id" uuid NOT NULL REFERENCES kcml.browser_runtime_build_manifest(id),
  "creation_mode" text NOT NULL CHECK (creation_mode IN ('NON_PERSISTENT','BRIDGE_PROFILE','CDP_COMPATIBILITY')),
  "locale_digest" bytea NOT NULL,
  "timezone_digest" bytea NOT NULL,
  "device_digest" bytea NOT NULL,
  "viewport_digest" bytea NOT NULL,
  "permission_profile_digest" bytea NOT NULL,
  "client_certificate_profile_digest" bytea,
  "account_binding_id" uuid,
  "account_auth_epoch" bigint,
  "restored_bundle_version_id" uuid,
  "attached_at" timestamptz,
  "detached_at" timestamptz,
  "closed_at" timestamptz,
  "context_lifecycle" text NOT NULL,
  "browser_process_identity" jsonb NOT NULL,
  "cleanup_state" text NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "browser_context_instance_stable_key_uq" ON kcml."browser_context_instance"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_context_instance";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_context_instance" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS browser_context_generation_uq ON kcml.browser_context_instance(session_id,context_key,context_generation);

CREATE TABLE IF NOT EXISTS kcml."browser_page" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "session_id" uuid NOT NULL REFERENCES kcml.browser_session(id),
  "context_instance_id" uuid NOT NULL REFERENCES kcml.browser_context_instance(id),
  "page_key" text NOT NULL,
  "page_generation" bigint NOT NULL CHECK (page_generation > 0),
  "runtime_handle_fingerprint" bytea NOT NULL,
  "opener_page_id" uuid REFERENCES kcml.browser_page(id),
  "opener_page_generation" bigint,
  "creation_action_id" uuid,
  "active_preview" boolean NOT NULL DEFAULT false,
  "closed" boolean NOT NULL DEFAULT false,
  "url" text NOT NULL,
  "origin" text,
  "title" text,
  "page_lifecycle" text NOT NULL,
  "current_document_id" uuid,
  "current_document_epoch" bigint NOT NULL DEFAULT 0,
  "top_frame_id" uuid,
  "navigation_sequence" bigint NOT NULL DEFAULT 0,
  "last_navigation_digest" bytea,
  "last_result_digest" bytea,
  "closed_at" timestamptz,
  "close_reason" text,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "browser_page_stable_key_uq" ON kcml."browser_page"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_page";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_page" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS browser_page_generation_uq ON kcml.browser_page(session_id,page_key,page_generation);

CREATE TABLE IF NOT EXISTS kcml."browser_frame" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "page_id" uuid NOT NULL REFERENCES kcml.browser_page(id),
  "page_generation" bigint NOT NULL,
  "frame_key" text NOT NULL,
  "attachment_epoch" bigint NOT NULL CHECK (attachment_epoch > 0),
  "runtime_handle_fingerprint" bytea NOT NULL,
  "parent_frame_id" uuid REFERENCES kcml.browser_frame(id),
  "parent_attachment_epoch" bigint,
  "origin" text,
  "url" text NOT NULL,
  "frame_name" text,
  "sandbox_attributes" jsonb NOT NULL,
  "permission_attributes" jsonb NOT NULL,
  "attached" boolean NOT NULL DEFAULT true,
  "oopif_route" jsonb,
  "process_route" jsonb,
  "current_document_id" uuid,
  "current_document_epoch" bigint NOT NULL DEFAULT 0,
  "latest_semantic_digest" bytea,
  "latest_visual_digest" bytea,
  "attached_at" timestamptz NOT NULL,
  "detached_at" timestamptz,
  "detach_reason" text,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "browser_frame_stable_key_uq" ON kcml."browser_frame"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_frame";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_frame" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS browser_frame_attachment_uq ON kcml.browser_frame(page_id,frame_key,attachment_epoch);

CREATE TABLE IF NOT EXISTS kcml."browser_document" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "page_id" uuid NOT NULL REFERENCES kcml.browser_page(id),
  "frame_id" uuid NOT NULL REFERENCES kcml.browser_frame(id),
  "document_key" text NOT NULL,
  "document_epoch" bigint NOT NULL CHECK (document_epoch > 0),
  "creation_reason" text NOT NULL CHECK (creation_reason IN ('NAVIGATION','BF_CACHE_RESTORE','PRERENDER_ACTIVATION','RECOVERY','OOPIF_REPLACEMENT')),
  "url" text NOT NULL,
  "origin" text,
  "navigation_id" uuid,
  "navigation_sequence" bigint NOT NULL,
  "document_lifecycle" text NOT NULL,
  "initial_observation_id" uuid,
  "last_observation_id" uuid,
  "dom_digest" bytea,
  "semantic_digest" bytea,
  "retired_at" timestamptz,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "browser_document_stable_key_uq" ON kcml."browser_document"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_document";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_document" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS browser_document_epoch_uq ON kcml.browser_document(frame_id,document_epoch);

CREATE TABLE IF NOT EXISTS kcml."browser_navigation" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "session_id" uuid NOT NULL REFERENCES kcml.browser_session(id),
  "page_id" uuid NOT NULL REFERENCES kcml.browser_page(id),
  "frame_id" uuid REFERENCES kcml.browser_frame(id),
  "document_id" uuid,
  "navigation_key" uuid NOT NULL,
  "navigation_sequence" bigint NOT NULL CHECK (navigation_sequence > 0),
  "causation_action_id" uuid,
  "causation_input_event_id" uuid,
  "requested_url" text NOT NULL,
  "requested_origin" text,
  "http_method" text NOT NULL,
  "redirect_chain_artifact_id" uuid,
  "navigation_type" text NOT NULL CHECK (navigation_type IN ('FULL','SAME_DOCUMENT','BF_CACHE_RESTORE','PRERENDER_ACTIVATION','POPUP_INITIAL','FRAME')),
  "state" text NOT NULL CHECK (state IN ('REQUESTED','STARTED','COMMITTED','DOM_CONTENT_LOADED','LOAD_FIRED','ABORTED','FAILED')),
  "previous_document_epoch" bigint,
  "new_document_epoch" bigint,
  "origin_policy_outcome" jsonb NOT NULL,
  "timings" jsonb NOT NULL,
  "error" jsonb,
  "evidence_digests" bytea[] NOT NULL DEFAULT '{}',
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "browser_navigation_stable_key_uq" ON kcml."browser_navigation"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_navigation";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_navigation" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS browser_navigation_id_uq ON kcml.browser_navigation(navigation_key);
CREATE UNIQUE INDEX IF NOT EXISTS browser_navigation_sequence_uq ON kcml.browser_navigation(page_id,navigation_sequence);

CREATE TABLE IF NOT EXISTS kcml."browser_preview_frame" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "session_id" uuid NOT NULL REFERENCES kcml.browser_session(id),
  "stream_epoch" bigint NOT NULL CHECK (stream_epoch > 0),
  "frame_revision" bigint NOT NULL CHECK (frame_revision > 0),
  "base_frame_id" uuid,
  "key_frame" boolean NOT NULL,
  "page_id" uuid NOT NULL,
  "page_generation" bigint NOT NULL,
  "frame_id" uuid NOT NULL,
  "document_id" uuid,
  "document_epoch" bigint NOT NULL,
  "observation_id" uuid,
  "observation_revision" bigint NOT NULL,
  "viewport_transform" jsonb NOT NULL,
  "viewport_transform_digest" bytea NOT NULL,
  "image_artifact_id" uuid,
  "patch_artifact_id" uuid,
  "mime_type" text NOT NULL,
  "width" integer NOT NULL CHECK (width > 0),
  "height" integer NOT NULL CHECK (height > 0),
  "size_bytes" bigint NOT NULL CHECK (size_bytes >= 0),
  "retention_state" text NOT NULL,
  "cleanup_state" text NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "browser_preview_frame_stable_key_uq" ON kcml."browser_preview_frame"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."browser_preview_frame";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."browser_preview_frame" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE UNIQUE INDEX IF NOT EXISTS browser_preview_frame_revision_uq ON kcml.browser_preview_frame(session_id,stream_epoch,frame_revision);

CREATE TABLE IF NOT EXISTS kcml."browser_preview_ticket" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "session_id" uuid NOT NULL REFERENCES kcml.browser_session(id),
  "owner_session_id" uuid,
  "access_channel" text NOT NULL CHECK (access_channel IN ('SESSION','API_KEY')),
  "audience" text NOT NULL,
  "capability_set" jsonb NOT NULL,
  "token_fingerprint" bytea NOT NULL,
  "issued_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "used_at" timestamptz,
  "revoked_at" timestamptz,
  "stream_epoch" bigint,
  "stream_binding" jsonb,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "browser_preview_ticket_stable_key_uq" ON kcml."browser_preview_ticket"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_preview_ticket";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_preview_ticket" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS browser_preview_ticket_fingerprint_uq ON kcml.browser_preview_ticket(token_fingerprint);

CREATE TABLE IF NOT EXISTS kcml."browser_preview_event" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "session_id" uuid NOT NULL REFERENCES kcml.browser_session(id),
  "stream_epoch" bigint NOT NULL,
  "sequence" bigint NOT NULL CHECK (sequence > 0),
  "event_type" text NOT NULL,
  "control_epoch" bigint,
  "page_id" uuid,
  "frame_id" uuid,
  "document_id" uuid,
  "document_epoch" bigint,
  "observation_revision" bigint,
  "frame_revision" bigint,
  "payload" jsonb NOT NULL,
  "artifact_references" uuid[] NOT NULL DEFAULT '{}',
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "browser_preview_event_stable_key_uq" ON kcml."browser_preview_event"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."browser_preview_event";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."browser_preview_event" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE UNIQUE INDEX IF NOT EXISTS browser_preview_event_sequence_uq ON kcml.browser_preview_event(session_id,stream_epoch,sequence);

CREATE TABLE IF NOT EXISTS kcml."browser_control_lease" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "session_id" uuid NOT NULL REFERENCES kcml.browser_session(id),
  "holder_kind" text NOT NULL CHECK (holder_kind IN ('AI','OWNER','AUTOMATION')),
  "holder_id" uuid,
  "context_generation" bigint NOT NULL,
  "control_epoch" bigint NOT NULL,
  "fencing_token" bigint NOT NULL CHECK (fencing_token > 0),
  "state" text NOT NULL CHECK (state IN ('ACTIVE','RELEASED','EXPIRED','REVOKED')),
  "issued_at" timestamptz NOT NULL,
  "heartbeat_at" timestamptz,
  "expires_at" timestamptz NOT NULL,
  "released_at" timestamptz,
  "takeover_source" jsonb,
  "control_transfer_id" uuid,
  "checkpoint_id" uuid,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "browser_control_lease_stable_key_uq" ON kcml."browser_control_lease"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_control_lease";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_control_lease" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS browser_control_lease_active_uq ON kcml.browser_control_lease(session_id) WHERE state = 'ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS browser_control_lease_fence_uq ON kcml.browser_control_lease(session_id,fencing_token);

CREATE TABLE IF NOT EXISTS kcml."browser_control_transfer" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "session_id" uuid NOT NULL REFERENCES kcml.browser_session(id),
  "requested_holder_kind" text NOT NULL,
  "requested_holder_id" uuid,
  "current_holder_kind" text,
  "current_holder_id" uuid,
  "expected_session_state_version" bigint NOT NULL,
  "expected_control_epoch" bigint NOT NULL,
  "current_action_id" uuid,
  "state" text NOT NULL CHECK (state IN ('REQUESTED','DRAINING','GRANTED','REJECTED','CANCELLED','MANUAL_REVIEW')),
  "input_reset_evidence" jsonb,
  "safe_checkpoint_id" uuid,
  "previous_control_epoch" bigint,
  "previous_fencing_token" bigint,
  "new_control_epoch" bigint,
  "new_fencing_token" bigint,
  "result" jsonb,
  "error" jsonb,
  "terminal_at" timestamptz,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "browser_control_transfer_stable_key_uq" ON kcml."browser_control_transfer"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_control_transfer";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_control_transfer" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS browser_control_transfer_active_uq ON kcml.browser_control_transfer(session_id) WHERE state IN ('REQUESTED','DRAINING');

CREATE TABLE IF NOT EXISTS kcml."browser_input_event" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "session_id" uuid NOT NULL REFERENCES kcml.browser_session(id),
  "control_lease_id" uuid NOT NULL REFERENCES kcml.browser_control_lease(id),
  "control_epoch" bigint NOT NULL,
  "fencing_token" bigint NOT NULL,
  "client_sequence" bigint NOT NULL,
  "stream_sequence" bigint,
  "context_generation" bigint NOT NULL,
  "page_generation" bigint NOT NULL,
  "frame_attachment_epoch" bigint,
  "document_epoch" bigint NOT NULL,
  "observation_revision" bigint NOT NULL,
  "frame_revision" bigint,
  "viewport_transform_digest" bytea NOT NULL,
  "input_type" text NOT NULL,
  "input_state_sequence" bigint NOT NULL,
  "payload" jsonb NOT NULL,
  "mutation_trigger_classification" text NOT NULL,
  "state" text NOT NULL CHECK (state IN ('ACCEPTED','REJECTED')),
  "reason" text,
  "resulting_action_id" uuid,
  "occurred_at" timestamptz NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "browser_input_event_stable_key_uq" ON kcml."browser_input_event"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."browser_input_event";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."browser_input_event" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE UNIQUE INDEX IF NOT EXISTS browser_input_event_client_sequence_uq ON kcml.browser_input_event(control_lease_id,client_sequence);
CREATE UNIQUE INDEX IF NOT EXISTS browser_input_event_state_sequence_uq ON kcml.browser_input_event(session_id,control_epoch,input_state_sequence);

CREATE TABLE IF NOT EXISTS kcml."browser_action_attempt" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "action_run_id" uuid NOT NULL REFERENCES kcml.browser_action_run(id),
  "attempt" bigint NOT NULL CHECK (attempt > 0),
  "command_id" uuid NOT NULL,
  "action_fence" bigint NOT NULL,
  "browser_identity_snapshot" jsonb NOT NULL,
  "resolved_target_candidates" jsonb NOT NULL,
  "chosen_target_digest" bytea,
  "actionability_evidence" jsonb NOT NULL,
  "trial_evidence" jsonb,
  "force_evidence" jsonb,
  "input_strategy" text NOT NULL,
  "prearmed_waiters" jsonb NOT NULL,
  "method_outcome" jsonb,
  "navigation_outcome" jsonb,
  "popup_outcome" jsonb,
  "dialog_outcome" jsonb,
  "permission_outcome" jsonb,
  "filechooser_outcome" jsonb,
  "download_outcome" jsonb,
  "postcondition" jsonb,
  "readback" jsonb,
  "evidence" jsonb NOT NULL,
  "started_at" timestamptz NOT NULL,
  "ended_at" timestamptz,
  "error" jsonb,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "browser_action_attempt_stable_key_uq" ON kcml."browser_action_attempt"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_action_attempt";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_action_attempt" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS browser_action_attempt_number_uq ON kcml.browser_action_attempt(action_run_id,attempt);
CREATE UNIQUE INDEX IF NOT EXISTS browser_action_attempt_command_uq ON kcml.browser_action_attempt(command_id);

CREATE TABLE IF NOT EXISTS kcml."browser_action_dispatch_event" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "action_attempt_id" uuid NOT NULL REFERENCES kcml.browser_action_attempt(id),
  "phase_sequence" bigint NOT NULL CHECK (phase_sequence > 0),
  "phase" text NOT NULL,
  "identity_snapshot" jsonb NOT NULL,
  "occurred_at" timestamptz NOT NULL,
  "adapter_evidence_digest" bytea NOT NULL,
  "event_digest" bytea NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "browser_action_dispatch_event_stable_key_uq" ON kcml."browser_action_dispatch_event"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."browser_action_dispatch_event";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."browser_action_dispatch_event" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE UNIQUE INDEX IF NOT EXISTS browser_action_dispatch_sequence_uq ON kcml.browser_action_dispatch_event(action_attempt_id,phase_sequence);

CREATE TABLE IF NOT EXISTS kcml."browser_operation_scope" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "parent_kind" text NOT NULL,
  "parent_object_id" uuid NOT NULL,
  "owner_message_id" uuid,
  "revision_id" uuid,
  "target_origins" text[] NOT NULL DEFAULT '{}',
  "redirect_origins" text[] NOT NULL DEFAULT '{}',
  "external_protocol_policy" jsonb NOT NULL,
  "local_target_policy" jsonb NOT NULL,
  "allowed_operation_classes" text[] NOT NULL DEFAULT '{}',
  "side_effect_ceiling" text NOT NULL,
  "account_constraints" jsonb NOT NULL,
  "tenant_constraints" jsonb NOT NULL,
  "resource_constraints" jsonb NOT NULL,
  "data_constraints" jsonb NOT NULL,
  "clipboard_constraints" jsonb NOT NULL,
  "upload_constraints" jsonb NOT NULL,
  "download_constraints" jsonb NOT NULL,
  "confirmation_policy" jsonb NOT NULL,
  "challenge_policy" jsonb NOT NULL,
  "scope_digest" bytea NOT NULL,
  "expires_at" timestamptz,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "browser_operation_scope_stable_key_uq" ON kcml."browser_operation_scope"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."browser_operation_scope";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."browser_operation_scope" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE UNIQUE INDEX IF NOT EXISTS browser_operation_scope_digest_uq ON kcml.browser_operation_scope(scope_digest);

CREATE TABLE IF NOT EXISTS kcml."browser_irreversible_confirmation" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "session_id" uuid NOT NULL REFERENCES kcml.browser_session(id),
  "action_run_id" uuid,
  "automation_run_id" uuid,
  "step_id" uuid,
  "page_id" uuid NOT NULL,
  "frame_id" uuid,
  "document_id" uuid,
  "target" jsonb NOT NULL,
  "arguments" jsonb NOT NULL,
  "consequence" text NOT NULL,
  "account_identity" jsonb,
  "operation_scope_id" uuid NOT NULL REFERENCES kcml.browser_operation_scope(id),
  "control_epoch" bigint NOT NULL,
  "observation_digest" bytea NOT NULL,
  "owner_confirmation" jsonb NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "confirmation_digest" bytea NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "browser_irreversible_confirmation_stable_key_uq" ON kcml."browser_irreversible_confirmation"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_irreversible_confirmation";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_irreversible_confirmation" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS browser_irreversible_confirmation_digest_uq ON kcml.browser_irreversible_confirmation(confirmation_digest);

CREATE TABLE IF NOT EXISTS kcml."browser_auth_attempt" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "session_id" uuid NOT NULL REFERENCES kcml.browser_session(id),
  "automation_run_id" uuid,
  "step_id" uuid,
  "account_binding_id" uuid NOT NULL,
  "account_auth_epoch" bigint NOT NULL,
  "auth_mode" text NOT NULL,
  "login_flow_kind" text NOT NULL,
  "credential_versions" jsonb NOT NULL,
  "page_id" uuid,
  "frame_id" uuid,
  "document_id" uuid,
  "origin" text,
  "relying_party" text,
  "state" text NOT NULL,
  "challenge_id" uuid,
  "side_effect_operation_id" uuid,
  "account_evidence" jsonb,
  "tenant_evidence" jsonb,
  "result" jsonb,
  "error" jsonb,
  "started_at" timestamptz NOT NULL,
  "completed_at" timestamptz,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "browser_auth_attempt_stable_key_uq" ON kcml."browser_auth_attempt"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_auth_attempt";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_auth_attempt" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."browser_state_bundle_member" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "state_bundle_id" uuid NOT NULL REFERENCES kcml.browser_state_bundle(id),
  "member_kind" text NOT NULL CHECK (member_kind IN ('COOKIE','LOCAL_STORAGE','INDEXED_DB','SESSION_STORAGE','PERMISSION','CLIENT_CERTIFICATE_METADATA','VIRTUAL_WEBAUTHN')),
  "member_key" text NOT NULL,
  "origin_scope" text,
  "partition_scope" jsonb,
  "encrypted_content" bytea,
  "artifact_reference" jsonb,
  "serializer_version" text NOT NULL,
  "member_digest" bytea NOT NULL,
  "size_bytes" bigint NOT NULL CHECK (size_bytes >= 0),
  "compatibility_metadata" jsonb NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "browser_state_bundle_member_stable_key_uq" ON kcml."browser_state_bundle_member"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."browser_state_bundle_member";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."browser_state_bundle_member" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE UNIQUE INDEX IF NOT EXISTS browser_state_bundle_member_key_uq ON kcml.browser_state_bundle_member(state_bundle_id,member_kind,member_key);

CREATE TABLE IF NOT EXISTS kcml."browser_bridge_connection" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "bridge_id" uuid NOT NULL REFERENCES kcml.browser_local_bridge(id),
  "certificate_generation" bigint NOT NULL,
  "connection_epoch" bigint NOT NULL CHECK (connection_epoch > 0),
  "peer_certificate_fingerprint" bytea NOT NULL,
  "protocol_digest" bytea NOT NULL,
  "capability_digest" bytea NOT NULL,
  "capability_snapshot" jsonb NOT NULL,
  "connected_at" timestamptz NOT NULL,
  "heartbeat_at" timestamptz,
  "disconnected_at" timestamptz,
  "disconnect_reason" text,
  "revoke_reason" text,
  "state" text NOT NULL CHECK (state IN ('CONNECTED','DRAINING','DISCONNECTED','REVOKED','FAILED')),
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "browser_bridge_connection_stable_key_uq" ON kcml."browser_bridge_connection"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_bridge_connection";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_bridge_connection" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS browser_bridge_connection_epoch_uq ON kcml.browser_bridge_connection(bridge_id,connection_epoch);

CREATE TABLE IF NOT EXISTS kcml."browser_bridge_assignment" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "bridge_connection_id" uuid NOT NULL REFERENCES kcml.browser_bridge_connection(id),
  "session_id" uuid NOT NULL REFERENCES kcml.browser_session(id),
  "context_generation" bigint NOT NULL,
  "operation_scope_id" uuid NOT NULL,
  "local_target" jsonb,
  "account_binding_id" uuid,
  "profile_id" text,
  "control_epoch" bigint NOT NULL,
  "action_fence" bigint NOT NULL,
  "lease_owner" uuid,
  "lease_fencing_token" bigint NOT NULL,
  "lease_expires_at" timestamptz NOT NULL,
  "state" text NOT NULL CHECK (state IN ('ASSIGNED','ACTIVE','RELEASING','RELEASED','FAILED')),
  "assigned_at" timestamptz NOT NULL,
  "released_at" timestamptz,
  "cleanup_evidence" jsonb,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "browser_bridge_assignment_stable_key_uq" ON kcml."browser_bridge_assignment"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_bridge_assignment";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_bridge_assignment" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS browser_bridge_assignment_active_uq ON kcml.browser_bridge_assignment(session_id,context_generation) WHERE state IN ('ASSIGNED','ACTIVE','RELEASING');

CREATE TABLE IF NOT EXISTS kcml."browser_profile_lease" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "bridge_id" uuid NOT NULL,
  "profile_key" text NOT NULL,
  "browser_build_id" text NOT NULL,
  "owner_session_id" uuid NOT NULL REFERENCES kcml.browser_session(id),
  "account_binding_id" uuid,
  "fencing_token" bigint NOT NULL,
  "connection_epoch" bigint NOT NULL,
  "mode" text NOT NULL CHECK (mode IN ('READ_ONLY','SERIALIZED_MUTATION','EXCLUSIVE')),
  "state" text NOT NULL CHECK (state IN ('ACTIVE','RELEASING','RELEASED','EXPIRED','FAILED')),
  "issued_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "released_at" timestamptz,
  "process_evidence" jsonb,
  "profile_lock_evidence" jsonb,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "browser_profile_lease_stable_key_uq" ON kcml."browser_profile_lease"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_profile_lease";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_profile_lease" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS browser_profile_lease_writer_uq ON kcml.browser_profile_lease(bridge_id,profile_key) WHERE state = 'ACTIVE' AND mode IN ('SERIALIZED_MUTATION','EXCLUSIVE');

CREATE TABLE IF NOT EXISTS kcml."browser_dialog" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "session_id" uuid NOT NULL REFERENCES kcml.browser_session(id),
  "page_id" uuid NOT NULL,
  "frame_id" uuid,
  "document_id" uuid,
  "dialog_sequence" bigint NOT NULL,
  "dialog_type" text NOT NULL CHECK (dialog_type IN ('ALERT','CONFIRM','PROMPT','BEFOREUNLOAD','NATIVE')),
  "causation_action_id" uuid,
  "safe_message_digest" bytea NOT NULL,
  "default_value_metadata" jsonb,
  "policy" jsonb NOT NULL,
  "challenge_id" uuid,
  "state" text NOT NULL,
  "response_digest" bytea,
  "opened_at" timestamptz NOT NULL,
  "resolved_at" timestamptz,
  "expired_at" timestamptz,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "browser_dialog_stable_key_uq" ON kcml."browser_dialog"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_dialog";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_dialog" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS browser_dialog_sequence_uq ON kcml.browser_dialog(session_id,dialog_sequence);

CREATE TABLE IF NOT EXISTS kcml."browser_permission_request" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "session_id" uuid NOT NULL REFERENCES kcml.browser_session(id),
  "context_instance_id" uuid NOT NULL,
  "page_id" uuid,
  "frame_id" uuid,
  "document_id" uuid,
  "origin" text NOT NULL,
  "permission_kind" text NOT NULL,
  "causation_action_id" uuid,
  "requested_scope" jsonb NOT NULL,
  "policy" jsonb NOT NULL,
  "challenge_id" uuid,
  "response" jsonb,
  "effective_permission_state" text,
  "resolved_at" timestamptz,
  "revoked_at" timestamptz,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "browser_permission_request_stable_key_uq" ON kcml."browser_permission_request"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_permission_request";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_permission_request" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS browser_permission_request_active_uq ON kcml.browser_permission_request(session_id,origin,permission_kind) WHERE resolved_at IS NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS kcml."browser_upload_handle" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "session_id" uuid NOT NULL,
  "run_id" uuid,
  "step_id" uuid,
  "artifact_id" uuid,
  "safe_name" text NOT NULL,
  "mime_type" text,
  "extension" text,
  "size_bytes" bigint NOT NULL CHECK (size_bytes >= 0),
  "content_digest" bytea NOT NULL,
  "sensitivity" text NOT NULL,
  "target_policy" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "file_count_policy" integer NOT NULL DEFAULT 1 CHECK (file_count_policy > 0),
  "directory_policy" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "cleanup_at" timestamptz,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "browser_upload_handle_stable_key_uq" ON kcml."browser_upload_handle"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_upload_handle";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_upload_handle" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."browser_download" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "session_id" uuid NOT NULL,
  "run_id" uuid,
  "step_id" uuid,
  "action_id" uuid,
  "source_origin" text,
  "source_url" text,
  "url_kind" text,
  "event_sequence" bigint NOT NULL DEFAULT 0,
  "suggested_name" text,
  "safe_name" text,
  "mime_type" text,
  "expected_size_bytes" bigint,
  "state" text NOT NULL CHECK (state IN ('STARTED','STREAMING','COMPLETED','FAILED','CANCELLED')),
  "artifact_id" uuid,
  "size_bytes" bigint,
  "content_digest" bytea,
  "content_verification" jsonb,
  "temp_path_handle" text,
  "cleanup_state" text,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "browser_download_stable_key_uq" ON kcml."browser_download"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_download";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_download" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."browser_teaching_run" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "parent_kind" text NOT NULL,
  "parent_object_id" uuid NOT NULL,
  "session_id" uuid NOT NULL REFERENCES kcml.browser_session(id),
  "status" text NOT NULL,
  "control_participants" jsonb NOT NULL,
  "operation_scope_id" uuid NOT NULL,
  "first_event_sequence" bigint NOT NULL,
  "last_event_sequence" bigint,
  "compiler_version" text NOT NULL,
  "runtime_version" text NOT NULL,
  "candidate_automation_revision_id" uuid,
  "coverage_report" jsonb,
  "ambiguity_report" jsonb,
  "mutation_semantics_report" jsonb,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "browser_teaching_run_stable_key_uq" ON kcml."browser_teaching_run"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_teaching_run";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_teaching_run" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS browser_teaching_run_active_uq ON kcml.browser_teaching_run(session_id) WHERE status IN ('RECORDING','COMPILING','WAITING_FOR_OWNER');

CREATE TABLE IF NOT EXISTS kcml."browser_teaching_step" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "teaching_run_id" uuid NOT NULL REFERENCES kcml.browser_teaching_run(id),
  "step_order" integer NOT NULL CHECK (step_order > 0),
  "first_input_event_sequence" bigint NOT NULL,
  "last_action_event_sequence" bigint NOT NULL,
  "semantic_action" text NOT NULL,
  "route_snapshot" jsonb NOT NULL,
  "locator_candidates" jsonb NOT NULL,
  "input_binding" jsonb NOT NULL,
  "input_strategy" text NOT NULL,
  "mutation_trigger" text NOT NULL,
  "prearmed_waiter_contract" jsonb NOT NULL,
  "preconditions" jsonb NOT NULL,
  "postconditions" jsonb NOT NULL,
  "readback_contract" jsonb NOT NULL,
  "side_effect_class" text NOT NULL,
  "retry_class" text NOT NULL,
  "reconciliation_contract" jsonb NOT NULL,
  "concurrency_contract" jsonb NOT NULL,
  "evidence" jsonb NOT NULL,
  "owner_resolution" jsonb,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "browser_teaching_step_stable_key_uq" ON kcml."browser_teaching_step"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_teaching_step";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_teaching_step" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS browser_teaching_step_order_uq ON kcml.browser_teaching_step(teaching_run_id,step_order);

CREATE TABLE IF NOT EXISTS kcml."browser_automation_definition" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "owner_component_id" uuid,
  "automation_name" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT false,
  "active_revision_id" uuid,
  "retired_at" timestamptz,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "browser_automation_definition_stable_key_uq" ON kcml."browser_automation_definition"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_automation_definition";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_automation_definition" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS browser_automation_definition_name_uq ON kcml.browser_automation_definition(owner_component_id,automation_name);

CREATE TABLE IF NOT EXISTS kcml."browser_automation_revision" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "automation_definition_id" uuid NOT NULL REFERENCES kcml.browser_automation_definition(id),
  "revision_number" bigint NOT NULL CHECK (revision_number > 0),
  "manifest" jsonb NOT NULL,
  "manifest_digest" bytea NOT NULL,
  "interaction_plane_version" text NOT NULL,
  "interpreter_version" text NOT NULL,
  "runtime_requirements" jsonb NOT NULL,
  "engine_requirements" jsonb NOT NULL,
  "bridge_requirements" jsonb NOT NULL,
  "origin_policy" jsonb NOT NULL,
  "redirect_policy" jsonb NOT NULL,
  "local_target_policy" jsonb NOT NULL,
  "account_policy" jsonb NOT NULL,
  "tenant_policy" jsonb NOT NULL,
  "auth_bindings" jsonb NOT NULL,
  "input_schema" jsonb NOT NULL,
  "output_schema" jsonb NOT NULL,
  "steps" jsonb NOT NULL,
  "steps_digest" bytea NOT NULL,
  "locator_digest" bytea NOT NULL,
  "target_digest" bytea NOT NULL,
  "mutation_trigger_digest" bytea NOT NULL,
  "postcondition_digest" bytea NOT NULL,
  "schedule_policy" jsonb,
  "verification_status" text NOT NULL,
  "verification_evidence" jsonb NOT NULL,
  "compatibility_relations" jsonb NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "browser_automation_revision_stable_key_uq" ON kcml."browser_automation_revision"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."browser_automation_revision";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."browser_automation_revision" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE UNIQUE INDEX IF NOT EXISTS browser_automation_revision_number_uq ON kcml.browser_automation_revision(automation_definition_id,revision_number);
CREATE UNIQUE INDEX IF NOT EXISTS browser_automation_revision_digest_uq ON kcml.browser_automation_revision(automation_definition_id,manifest_digest);

CREATE TABLE IF NOT EXISTS kcml."browser_automation_run" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "automation_definition_id" uuid NOT NULL REFERENCES kcml.browser_automation_definition(id),
  "automation_revision_id" uuid NOT NULL REFERENCES kcml.browser_automation_revision(id),
  "caller_snapshot" jsonb NOT NULL,
  "revision_digest" bytea NOT NULL,
  "client_run_id" text NOT NULL,
  "schedule_fire_id" text,
  "idempotency_scope" text NOT NULL,
  "operation_scope_id" uuid NOT NULL,
  "browser_session_id" uuid NOT NULL REFERENCES kcml.browser_session(id),
  "account_binding_id" uuid,
  "account_auth_epoch" bigint,
  "status" text NOT NULL,
  "current_step" integer NOT NULL DEFAULT 0,
  "current_attempt" bigint NOT NULL DEFAULT 0,
  "input" jsonb NOT NULL,
  "input_digest" bytea NOT NULL,
  "output" jsonb,
  "output_digest" bytea,
  "lease_owner" uuid,
  "lease_fencing_token" bigint,
  "lease_expires_at" timestamptz,
  "heartbeat_at" timestamptz,
  "concurrency_claims" jsonb NOT NULL,
  "latest_checkpoint_id" uuid,
  "control_epoch" bigint,
  "cancellation_version" bigint NOT NULL DEFAULT 0,
  "pending_state" jsonb NOT NULL,
  "manual_review" jsonb,
  "error" jsonb,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "browser_automation_run_stable_key_uq" ON kcml."browser_automation_run"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_automation_run";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_automation_run" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS browser_automation_run_client_uq ON kcml.browser_automation_run(automation_definition_id,client_run_id);
CREATE UNIQUE INDEX IF NOT EXISTS browser_automation_run_schedule_uq ON kcml.browser_automation_run(automation_definition_id,schedule_fire_id) WHERE schedule_fire_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS kcml."browser_automation_run_step" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "automation_run_id" uuid NOT NULL REFERENCES kcml.browser_automation_run(id),
  "step_order" integer NOT NULL,
  "attempt" bigint NOT NULL,
  "browser_action_run_id" uuid REFERENCES kcml.browser_action_run(id),
  "status" text NOT NULL,
  "observed_browser_state" jsonb NOT NULL,
  "observed_account_state" jsonb,
  "mutation_trigger" text NOT NULL,
  "side_effect_state" jsonb,
  "reconciliation_state" jsonb,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "error" jsonb,
  "evidence" jsonb NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "browser_automation_run_step_stable_key_uq" ON kcml."browser_automation_run_step"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_automation_run_step";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_automation_run_step" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS browser_automation_run_step_uq ON kcml.browser_automation_run_step(automation_run_id,step_order,attempt);

CREATE TABLE IF NOT EXISTS kcml."browser_automation_artifact" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "session_id" uuid NOT NULL REFERENCES kcml.browser_session(id),
  "automation_run_id" uuid,
  "step_id" uuid,
  "action_run_id" uuid,
  "artifact_type" text NOT NULL,
  "storage_reference" text NOT NULL,
  "page_id" uuid,
  "frame_id" uuid,
  "document_id" uuid,
  "mime_type" text,
  "size_bytes" bigint NOT NULL,
  "artifact_digest" bytea NOT NULL,
  "safe_name" text NOT NULL,
  "source_origin" text,
  "sensitivity" text NOT NULL,
  "retention_state" text NOT NULL,
  "scan_state" text NOT NULL,
  "cleanup_state" text NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "browser_automation_artifact_stable_key_uq" ON kcml."browser_automation_artifact"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."browser_automation_artifact";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."browser_automation_artifact" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE UNIQUE INDEX IF NOT EXISTS browser_automation_artifact_digest_uq ON kcml.browser_automation_artifact(automation_run_id,artifact_digest,artifact_type);

CREATE TABLE IF NOT EXISTS kcml."browser_auth_binding" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "automation_definition_id" uuid NOT NULL REFERENCES kcml.browser_automation_definition(id),
  "automation_revision_id" uuid NOT NULL REFERENCES kcml.browser_automation_revision(id),
  "account_key" text NOT NULL,
  "account_binding_id" uuid NOT NULL,
  "auth_mode" text NOT NULL,
  "secret_references" uuid[] NOT NULL DEFAULT '{}',
  "certificate_references" uuid[] NOT NULL DEFAULT '{}',
  "virtual_authenticator_references" uuid[] NOT NULL DEFAULT '{}',
  "state_bundle_compatibility" jsonb NOT NULL,
  "expected_account_condition" jsonb NOT NULL,
  "expected_tenant_condition" jsonb NOT NULL,
  "expires_at" timestamptz,
  "invalidation_policy" jsonb NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "browser_auth_binding_stable_key_uq" ON kcml."browser_auth_binding"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."browser_auth_binding";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."browser_auth_binding" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE UNIQUE INDEX IF NOT EXISTS browser_auth_binding_account_uq ON kcml.browser_auth_binding(automation_revision_id,account_key);

CREATE TABLE IF NOT EXISTS kcml."browser_challenge" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "session_id" uuid NOT NULL REFERENCES kcml.browser_session(id),
  "automation_run_id" uuid,
  "step_id" uuid,
  "challenge_type" text NOT NULL,
  "status" text NOT NULL CHECK (status IN ('PENDING','RESOLVED','EXPIRED','CANCELLED','FAILED')),
  "page_id" uuid,
  "frame_id" uuid,
  "document_id" uuid,
  "origin" text,
  "relying_party" text,
  "account_binding_id" uuid,
  "pending_action_digest" bytea NOT NULL,
  "auth_epoch" bigint,
  "control_epoch" bigint NOT NULL,
  "deadline_at" timestamptz NOT NULL,
  "safe_prompt" text NOT NULL,
  "allowed_resolution_methods" text[] NOT NULL DEFAULT '{}',
  "expires_at" timestamptz NOT NULL,
  "resolved_at" timestamptz,
  "owner_response_id" uuid,
  "bridge_response_id" uuid,
  "consume_digest" bytea,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "browser_challenge_stable_key_uq" ON kcml."browser_challenge"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_challenge";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_challenge" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS browser_challenge_pending_uq ON kcml.browser_challenge(session_id,pending_action_digest) WHERE status = 'PENDING';

CREATE TABLE IF NOT EXISTS kcml."self_test_catalog_entry" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "case_key" text NOT NULL,
  "suite" text NOT NULL,
  "capability" text NOT NULL,
  "required_environment" jsonb NOT NULL,
  "target_operation" text NOT NULL,
  "setup_contract" jsonb NOT NULL,
  "execution_contract" jsonb NOT NULL,
  "assertion_contract" jsonb NOT NULL,
  "cleanup_contract" jsonb NOT NULL,
  "evidence_contract" jsonb NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "self_test_catalog_entry_stable_key_uq" ON kcml."self_test_catalog_entry"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."self_test_catalog_entry";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."self_test_catalog_entry" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE UNIQUE INDEX IF NOT EXISTS self_test_catalog_entry_case_uq ON kcml.self_test_catalog_entry(case_key);

CREATE TABLE IF NOT EXISTS kcml."deployment_step" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "deployment_run_id" uuid NOT NULL,
  "step_key" text NOT NULL,
  "step_order" integer NOT NULL CHECK (step_order > 0),
  "attempt" bigint NOT NULL CHECK (attempt > 0),
  "state" text NOT NULL CHECK (state IN ('PENDING','RUNNING','RECONCILING','SUCCEEDED','FAILED','MANUAL_REVIEW')),
  "intent" jsonb NOT NULL,
  "expected_before_digest" bytea NOT NULL,
  "expected_after_digest" bytea NOT NULL,
  "side_effect_operation_id" uuid,
  "outcome" jsonb,
  "reconciliation" jsonb,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "duration_ms" bigint,
  "result" jsonb,
  "evidence" jsonb NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "deployment_step_stable_key_uq" ON kcml."deployment_step"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."deployment_step";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."deployment_step" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS deployment_step_attempt_uq ON kcml.deployment_step(deployment_run_id,step_key,attempt);
CREATE UNIQUE INDEX IF NOT EXISTS deployment_step_order_attempt_uq ON kcml.deployment_step(deployment_run_id,step_order,attempt);

CREATE TABLE IF NOT EXISTS kcml."production_acceptance_run" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "expected_source_sha" text NOT NULL CHECK (expected_source_sha ~ '^[0-9a-f]{40}$'),
  "expected_release_id" text NOT NULL,
  "checks" jsonb NOT NULL,
  "results" jsonb,
  "state" text NOT NULL CHECK (state IN ('PENDING','RUNNING','PASS','FAIL','NOT_EXECUTED_ENVIRONMENTAL')),
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "evidence_digest" bytea,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "production_acceptance_run_stable_key_uq" ON kcml."production_acceptance_run"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."production_acceptance_run";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."production_acceptance_run" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE INDEX IF NOT EXISTS production_acceptance_expected_idx ON kcml.production_acceptance_run(expected_source_sha,expected_release_id,created_at DESC);

CREATE TABLE IF NOT EXISTS kcml."operational_setting_applied" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "operational_setting_id" uuid NOT NULL,
  "desired_version" bigint NOT NULL CHECK (desired_version > 0),
  "target_service" text NOT NULL,
  "target_build_id" text NOT NULL,
  "effective_version" bigint NOT NULL CHECK (effective_version > 0),
  "effective_digest" bytea NOT NULL,
  "configuration_apply_run_id" uuid,
  "applied_at" timestamptz NOT NULL,
  "verification" jsonb NOT NULL,
  "result" text NOT NULL CHECK (result IN ('APPLIED','VERIFIED','MISMATCH','FAILED','ROLLED_BACK')),
  "error" jsonb,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "operational_setting_applied_stable_key_uq" ON kcml."operational_setting_applied"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."operational_setting_applied";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."operational_setting_applied" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE UNIQUE INDEX IF NOT EXISTS operational_setting_applied_target_uq ON kcml.operational_setting_applied(operational_setting_id,desired_version,target_service,target_build_id);

CREATE TABLE IF NOT EXISTS kcml."domain_command_activation_domain" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "domain_command_id" uuid NOT NULL REFERENCES kcml.domain_command(id),
  "activation_domain_id" uuid NOT NULL REFERENCES kcml.activation_domain_head(id),
  "pinned_activation_epoch" bigint NOT NULL CHECK (pinned_activation_epoch >= 0),
  "operation_class" text NOT NULL CHECK (operation_class IN ('READ_ONLY','MUTATING')),
  "state" text NOT NULL CHECK (state IN ('ADMITTED','CHECKPOINTED','RECONCILING','TERMINAL')),
  "admitted_at" timestamptz NOT NULL,
  "terminal_at" timestamptz,
  "evidence_digest" bytea NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "domain_command_activation_domain_stable_key_uq" ON kcml."domain_command_activation_domain"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."domain_command_activation_domain";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."domain_command_activation_domain" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS domain_command_activation_domain_uq ON kcml.domain_command_activation_domain(domain_command_id,activation_domain_id);

CREATE TABLE IF NOT EXISTS kcml."activation_domain_barrier" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "activation_set_id" uuid NOT NULL,
  "activation_domain_id" uuid NOT NULL REFERENCES kcml.activation_domain_head(id),
  "state" text NOT NULL CHECK (state IN ('REQUESTED','DRAINING','CLOSED','RELEASED','FAILED')),
  "admission_epoch" bigint NOT NULL CHECK (admission_epoch >= 0),
  "pending_mutating_operation_count" bigint NOT NULL CHECK (pending_mutating_operation_count >= 0),
  "lease_owner" uuid,
  "lease_fencing_token" bigint,
  "lease_expires_at" timestamptz,
  "requested_at" timestamptz NOT NULL,
  "closed_at" timestamptz,
  "released_at" timestamptz,
  "evidence" jsonb NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "activation_domain_barrier_stable_key_uq" ON kcml."activation_domain_barrier"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."activation_domain_barrier";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."activation_domain_barrier" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS activation_domain_barrier_active_uq ON kcml.activation_domain_barrier(activation_domain_id) WHERE state IN ('REQUESTED','DRAINING','CLOSED');

CREATE TABLE IF NOT EXISTS kcml."configuration_apply_run" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "configuration_group" text NOT NULL,
  "desired_snapshot_digest" bytea NOT NULL,
  "previous_snapshot_digest" bytea NOT NULL,
  "state" text NOT NULL CHECK (state IN ('PLANNED','APPLYING','RESTARTING','VERIFYING','ACTIVE','ROLLING_BACK','ROLLED_BACK','FAILED','MANUAL_REVIEW')),
  "target_services" text[] NOT NULL DEFAULT '{}',
  "effective_versions" jsonb NOT NULL,
  "lease_owner" uuid,
  "lease_fencing_token" bigint,
  "lease_expires_at" timestamptz,
  "step_outcomes" jsonb NOT NULL,
  "rollback_evidence" jsonb,
  "evidence" jsonb NOT NULL,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "configuration_apply_run_stable_key_uq" ON kcml."configuration_apply_run"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."configuration_apply_run";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."configuration_apply_run" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS configuration_apply_run_snapshot_uq ON kcml.configuration_apply_run(configuration_group,desired_snapshot_digest);

CREATE TABLE IF NOT EXISTS kcml."authority_lineage" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "parent_lineage_id" uuid REFERENCES kcml.authority_lineage(id),
  "root_kind" text NOT NULL CHECK (root_kind IN ('OWNER_MESSAGE','OWNER_APPROVED_SPECIFICATION','OWNER_DELEGATED_SOURCE','ACTIVE_AGENT_REVISION','ACTIVE_AUTOMATION_REVISION','ACTIVE_COMPONENT_REVISION','EXTERNAL_ENDPOINT_CONTRACT','PLATFORM_RUNTIME_POLICY')),
  "root_object_kind" text NOT NULL,
  "root_object_id" uuid NOT NULL,
  "root_object_digest" bytea NOT NULL,
  "target_ceiling" jsonb NOT NULL,
  "operation_ceiling" jsonb NOT NULL,
  "side_effect_ceiling" text NOT NULL,
  "secret_use_ceiling" jsonb NOT NULL,
  "lineage_payload" jsonb NOT NULL,
  "lineage_digest" bytea NOT NULL,
  "creator_execution_context_id" uuid,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "authority_lineage_stable_key_uq" ON kcml."authority_lineage"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."authority_lineage";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."authority_lineage" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE UNIQUE INDEX IF NOT EXISTS authority_lineage_digest_uq ON kcml.authority_lineage(lineage_digest);

CREATE TABLE IF NOT EXISTS kcml."operation_intent" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "intent_id" uuid NOT NULL,
  "intent_revision" bigint NOT NULL CHECK (intent_revision > 0),
  "authority_lineage_id" uuid NOT NULL REFERENCES kcml.authority_lineage(id),
  "source_owner_message_id" uuid,
  "source_specification_id" uuid,
  "source_revision_id" uuid,
  "objective" text NOT NULL,
  "requirement_ids" text[] NOT NULL DEFAULT '{}',
  "target_selectors" jsonb NOT NULL,
  "operation_classes" text[] NOT NULL DEFAULT '{}',
  "side_effect_ceiling" text NOT NULL,
  "argument_slots" jsonb NOT NULL,
  "dynamic_target_slots" jsonb NOT NULL,
  "delegated_source_references" jsonb NOT NULL,
  "value_derivation_contracts" jsonb NOT NULL,
  "secret_use_purposes" jsonb NOT NULL,
  "target_constraints" jsonb NOT NULL,
  "placement_templates" jsonb NOT NULL,
  "delegation_graph_ceiling" jsonb NOT NULL,
  "success_postcondition" jsonb NOT NULL,
  "stop_conditions" jsonb NOT NULL,
  "cancel_conditions" jsonb NOT NULL,
  "expires_at" timestamptz,
  "intent_digest" bytea NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "operation_intent_stable_key_uq" ON kcml."operation_intent"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."operation_intent";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."operation_intent" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE UNIQUE INDEX IF NOT EXISTS operation_intent_revision_uq ON kcml.operation_intent(intent_id,intent_revision);
CREATE UNIQUE INDEX IF NOT EXISTS operation_intent_digest_uq ON kcml.operation_intent(intent_digest);

CREATE TABLE IF NOT EXISTS kcml."content_provenance" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "parent_content_id" uuid REFERENCES kcml.content_provenance(id),
  "transformation_id" uuid,
  "source_kind" text NOT NULL,
  "source_object_id" uuid,
  "source_revision_id" uuid,
  "source_locator" jsonb NOT NULL,
  "observed_at" timestamptz NOT NULL,
  "raw_bytes" bytea,
  "artifact_reference" jsonb,
  "raw_digest" bytea NOT NULL,
  "content_digest" bytea NOT NULL,
  "mime_type" text,
  "schema_id" text,
  "content_role" text NOT NULL CHECK (content_role IN ('INSTRUCTION','DATA','EVIDENCE','PROPOSAL','RESULT','CODE','METADATA')),
  "instruction_authority" text NOT NULL CHECK (instruction_authority IN ('OWNER_DIRECT','OWNER_APPROVED_SPECIFICATION','OWNER_DELEGATED_SOURCE','ACTIVE_REVISION','PLATFORM_RUNTIME','NONE')),
  "taint_flags" text[] NOT NULL DEFAULT '{}',
  "provenance_flags" text[] NOT NULL DEFAULT '{}',
  "extraction_method" text NOT NULL,
  "normalization_method" text NOT NULL,
  "transform_chain" jsonb NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "content_provenance_stable_key_uq" ON kcml."content_provenance"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."content_provenance";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."content_provenance" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE UNIQUE INDEX IF NOT EXISTS content_provenance_source_digest_uq ON kcml.content_provenance(source_kind,content_digest,raw_digest);

CREATE TABLE IF NOT EXISTS kcml."instruction_segment" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "model_call_id" uuid,
  "request_descriptor_id" uuid NOT NULL REFERENCES kcml.openai_request_descriptor(id),
  "segment_sequence" bigint NOT NULL CHECK (segment_sequence > 0),
  "source_provenance_id" uuid NOT NULL REFERENCES kcml.content_provenance(id),
  "role" text NOT NULL,
  "instruction_authority" text NOT NULL,
  "destination" text NOT NULL CHECK (destination IN ('INSTRUCTIONS','INPUT','TOOL_DEFINITION','OUTPUT_SCHEMA')),
  "rendered_bytes" bytea NOT NULL,
  "rendered_digest" bytea NOT NULL,
  "compiler_version" text NOT NULL,
  "segment_digest" bytea NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "instruction_segment_stable_key_uq" ON kcml."instruction_segment"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."instruction_segment";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."instruction_segment" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE UNIQUE INDEX IF NOT EXISTS instruction_segment_sequence_uq ON kcml.instruction_segment(request_descriptor_id,segment_sequence);
CREATE UNIQUE INDEX IF NOT EXISTS instruction_segment_digest_uq ON kcml.instruction_segment(request_descriptor_id,segment_digest);

CREATE TABLE IF NOT EXISTS kcml."operation_context" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "parent_kind" text NOT NULL,
  "parent_object_id" uuid NOT NULL,
  "authority_lineage_id" uuid NOT NULL REFERENCES kcml.authority_lineage(id),
  "authority_lineage_digest" bytea NOT NULL,
  "operation_intent_id" uuid NOT NULL,
  "operation_intent_digest" bytea NOT NULL,
  "actor_snapshot" jsonb NOT NULL,
  "execution_snapshot" jsonb NOT NULL,
  "revision_snapshot" jsonb NOT NULL,
  "tool_action_snapshot" jsonb NOT NULL,
  "target_snapshot" jsonb NOT NULL,
  "binding_snapshot" jsonb NOT NULL,
  "activation_snapshot" jsonb NOT NULL,
  "target_constraints" jsonb NOT NULL,
  "argument_schema" jsonb NOT NULL,
  "argument_origin_map" jsonb NOT NULL,
  "side_effect_contract" jsonb NOT NULL,
  "retry_contract" jsonb NOT NULL,
  "idempotency_contract" jsonb NOT NULL,
  "concurrency_contract" jsonb NOT NULL,
  "secret_use_plan" jsonb NOT NULL,
  "delegation_projection" jsonb NOT NULL,
  "deadline_at" timestamptz,
  "precondition" jsonb NOT NULL,
  "postcondition" jsonb NOT NULL,
  "provenance_manifest_digest" bytea NOT NULL,
  "state" text NOT NULL CHECK (state IN ('COMPILED','VALIDATED','DISPATCH_RESERVED','DISPATCHED','TERMINAL','MANUAL_REVIEW','INVALIDATED')),
  "canonical_payload" jsonb NOT NULL,
  "context_digest" bytea NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "operation_context_stable_key_uq" ON kcml."operation_context"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."operation_context";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."operation_context" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE UNIQUE INDEX IF NOT EXISTS operation_context_digest_uq ON kcml.operation_context(context_digest);
CREATE UNIQUE INDEX IF NOT EXISTS operation_context_dispatch_current_uq ON kcml.operation_context(parent_kind,parent_object_id) WHERE state IN ('DISPATCH_RESERVED','DISPATCHED');

CREATE TABLE IF NOT EXISTS kcml."semantic_action_plan" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "operation_context_id" uuid NOT NULL REFERENCES kcml.operation_context(id),
  "producing_model_call_id" uuid,
  "producing_output_item_id" uuid,
  "producing_tool_call_id" uuid,
  "producing_handoff_id" uuid,
  "proposed_alias" text,
  "proposed_text" text,
  "resolved_operation" text NOT NULL,
  "resolved_tool_key" text,
  "resolved_revision_id" uuid,
  "resolved_binding_id" uuid,
  "target" jsonb NOT NULL,
  "canonical_arguments" jsonb NOT NULL,
  "argument_origin_map" jsonb NOT NULL,
  "value_derivation_ids" uuid[] NOT NULL DEFAULT '{}',
  "side_effect_class" text NOT NULL,
  "secret_use_context_ids" uuid[] NOT NULL DEFAULT '{}',
  "postcondition" jsonb NOT NULL,
  "reconciliation" jsonb NOT NULL,
  "validation_result" jsonb NOT NULL,
  "stable_error" jsonb,
  "validator_version" text NOT NULL,
  "plan_digest" bytea NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "semantic_action_plan_stable_key_uq" ON kcml."semantic_action_plan"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."semantic_action_plan";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."semantic_action_plan" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE UNIQUE INDEX IF NOT EXISTS semantic_action_plan_digest_uq ON kcml.semantic_action_plan(operation_context_id,plan_digest);

CREATE TABLE IF NOT EXISTS kcml."value_derivation" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "operation_context_id" uuid NOT NULL REFERENCES kcml.operation_context(id),
  "semantic_action_plan_id" uuid,
  "destination_path" text NOT NULL,
  "source_content_provenance_id" uuid NOT NULL REFERENCES kcml.content_provenance(id),
  "source_locator" jsonb NOT NULL,
  "source_digest" bytea NOT NULL,
  "transform" text NOT NULL,
  "normalizer" text NOT NULL,
  "value_schema" jsonb NOT NULL,
  "constraints" jsonb NOT NULL,
  "transform_version" text NOT NULL,
  "canonical_value" jsonb NOT NULL,
  "value_digest" bytea NOT NULL,
  "validation_evidence" jsonb NOT NULL,
  "requirement_id" text NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "value_derivation_stable_key_uq" ON kcml."value_derivation"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."value_derivation";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."value_derivation" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE UNIQUE INDEX IF NOT EXISTS value_derivation_destination_uq ON kcml.value_derivation(operation_context_id,semantic_action_plan_id,destination_path);

CREATE TABLE IF NOT EXISTS kcml."secret_use_context" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "operation_context_id" uuid NOT NULL REFERENCES kcml.operation_context(id),
  "semantic_action_plan_id" uuid,
  "secret_binding_alias" text NOT NULL,
  "secret_binding_revision" bigint NOT NULL,
  "declared_purpose" text NOT NULL,
  "consumer" jsonb NOT NULL,
  "target_component_id" uuid,
  "external_target_id" uuid,
  "target_origin" text,
  "account_id" uuid,
  "tenant_id" text,
  "allowed_placement" text NOT NULL CHECK (allowed_placement IN ('HEADER','QUERY','BODY','BROWSER_FIELD','SDK_CONFIG','RUNTIME_VALUE','CODE_ARTIFACT')),
  "argument_path" text NOT NULL,
  "lifetime" text NOT NULL,
  "attempt" bigint NOT NULL,
  "expected_recipient_contract" jsonb NOT NULL,
  "use_digest" bytea NOT NULL,
  "resolution_evidence" jsonb,
  "result_evidence" jsonb,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "secret_use_context_stable_key_uq" ON kcml."secret_use_context"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."secret_use_context";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."secret_use_context" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE UNIQUE INDEX IF NOT EXISTS secret_use_context_attempt_uq ON kcml.secret_use_context(operation_context_id,semantic_action_plan_id,secret_binding_alias,argument_path,attempt);

CREATE TABLE IF NOT EXISTS kcml."agentic_security_event" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  "security_code" text NOT NULL,
  "classification" text NOT NULL,
  "severity" text NOT NULL,
  "operation_context_id" uuid,
  "authority_lineage_id" uuid,
  "content_provenance_id" uuid,
  "semantic_action_plan_id" uuid,
  "attempted_tool" jsonb,
  "attempted_target" jsonb,
  "attempted_argument_change" jsonb,
  "attempted_delegation_change" jsonb,
  "attempted_secret_use_change" jsonb,
  "validation_decision" text NOT NULL,
  "no_side_effect_evidence" jsonb NOT NULL,
  "recovery_directive" text NOT NULL,
  "occurred_at" timestamptz NOT NULL,
  canonical_digest bytea NOT NULL,
  logical_operation_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL DEFAULT 0 CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid,
  application_deployment_epoch bigint NOT NULL DEFAULT 0 CHECK (application_deployment_epoch >= 0),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "agentic_security_event_stable_key_uq" ON kcml."agentic_security_event"(stable_key) WHERE stable_key IS NOT NULL AND deleted_at IS NULL;
DROP TRIGGER IF EXISTS immutable_row ON kcml."agentic_security_event";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."agentic_security_event" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE INDEX IF NOT EXISTS agentic_security_event_context_idx ON kcml.agentic_security_event(operation_context_id,created_at);

COMMENT ON TABLE kcml."owner_identity" IS 'SSOT_CURRENT.md chapter 25 entity owner_identity; contract sha256 5202b65805b025284e4b1232c1871032ca5680aa8d63e07936221e436efb4102';
COMMENT ON TABLE kcml."owner_session" IS 'SSOT_CURRENT.md chapter 25 entity owner_session; contract sha256 2e00afc47eb9c9ac1c1440193cec671dc36013b0a41ade64d48955c1ea331001';
COMMENT ON TABLE kcml."owner_login_throttle" IS 'SSOT_CURRENT.md chapter 25 entity owner_login_throttle; contract sha256 837a190e5e933072bfc2a21b75ca724ab83b708ec4220aefd7b11cfa04fb41df';
COMMENT ON TABLE kcml."owner_recovery_code" IS 'SSOT_CURRENT.md chapter 25 entity owner_recovery_code; contract sha256 1aba1f84117b2678c660adab9fab8a427efe1cfd7b21c0773a5f0c43bb68c159';
COMMENT ON TABLE kcml."owner_mfa_enrollment" IS 'SSOT_CURRENT.md chapter 25 entity owner_mfa_enrollment; contract sha256 0b4b2d1ded79f44f98e69ea4745f4f903885ae0d059f75da8a4f534bc1e1ed34';
COMMENT ON TABLE kcml."owner_api_credential" IS 'SSOT_CURRENT.md chapter 25 entity owner_api_credential; contract sha256 fa75399249a9e52da54974468e1b81843a0b70798ae6394e5dc23a3d68f0358e';
COMMENT ON TABLE kcml."component" IS 'SSOT_CURRENT.md chapter 25 entity component; contract sha256 384f38971ccbda3155fff0dc9b3eedea0ab0474092944a23858074b39ae2dec7';
COMMENT ON TABLE kcml."component_revision" IS 'SSOT_CURRENT.md chapter 25 entity component_revision; contract sha256 d9cd12ffbb61af96b00aa6b76c257f88ca5dde1b56ce96180b16bd2eda05d661';
COMMENT ON TABLE kcml."component_tool_contract" IS 'SSOT_CURRENT.md chapter 25 entity component_tool_contract; contract sha256 4b8ef4561ccb88f6eaa9bcd3b701f4a74ad9deac7331ae948c618ea9b01b6bd8';
COMMENT ON TABLE kcml."component_resource_contract" IS 'SSOT_CURRENT.md chapter 25 entity component_resource_contract; contract sha256 a4f6769f249d7a9670cfbfa035ea18c40f3e3c7b5dad44549257eacce64a4467';
COMMENT ON TABLE kcml."component_prompt_contract" IS 'SSOT_CURRENT.md chapter 25 entity component_prompt_contract; contract sha256 a533854a025952e3381016de98835981f16a10d27edcd127dd2b6b2282a8866f';
COMMENT ON TABLE kcml."component_endpoint_contract" IS 'SSOT_CURRENT.md chapter 25 entity component_endpoint_contract; contract sha256 d82ef64a692d386a1d8be5095dd75d1467fdac604268971af66a7a6789791482';
COMMENT ON TABLE kcml."component_pulse_contract" IS 'SSOT_CURRENT.md chapter 25 entity component_pulse_contract; contract sha256 e8ad3aa8670870d69f16faeb2291cc9f5d76803417c2a8c7168d9508906c04dc';
COMMENT ON TABLE kcml."component_state_contract" IS 'SSOT_CURRENT.md chapter 25 entity component_state_contract; contract sha256 e64f6b144b05d8e4d5afac8b6f6450c1a6d15f12ad629de8e5fa1efe30b2c255';
COMMENT ON TABLE kcml."component_state_transition" IS 'SSOT_CURRENT.md chapter 25 entity component_state_transition; contract sha256 71893302b34b5487d2903936cda1afc0501b80d6795a5bedf4ff5349231d99b1';
COMMENT ON TABLE kcml."component_runtime_target" IS 'SSOT_CURRENT.md chapter 25 entity component_runtime_target; contract sha256 6105997913a989391316d141ce9ca341c312b3f933939297c71e8682f1956581';
COMMENT ON TABLE kcml."component_contract_binding" IS 'SSOT_CURRENT.md chapter 25 entity component_contract_binding; contract sha256 192ecef3b97652d5724a583c84dfb60a94b321cfbe16bb3944cb683bcef5faa3';
COMMENT ON TABLE kcml."component_release" IS 'SSOT_CURRENT.md chapter 25 entity component_release; contract sha256 9c89428a76d6169596ed5a9799591bb2a2aeff0f99c7a5c0d5bae7c45bdc8981';
COMMENT ON TABLE kcml."component_readiness_gate" IS 'SSOT_CURRENT.md chapter 25 entity component_readiness_gate; contract sha256 9f206372c2a20d7342fdd96eb7d087b39fdd45081959efece9ae63d9c1d05867';
COMMENT ON TABLE kcml."component_e2e_run" IS 'SSOT_CURRENT.md chapter 25 entity component_e2e_run; contract sha256 33d71c863387acc99b87d77447eec4fc1a615e9f425a821168daa9afd1c425bf';
COMMENT ON TABLE kcml."mcp_server_revision_profile" IS 'SSOT_CURRENT.md chapter 25 entity mcp_server_revision_profile; contract sha256 83da6b86fce011752e3e6c8a541c41588befafbe81655aaa230ed7c99a1ffb72';
COMMENT ON TABLE kcml."mcp_registration_probe" IS 'SSOT_CURRENT.md chapter 25 entity mcp_registration_probe; contract sha256 e468d094f6ac95e997588bfb5c3e127d59d52b2597fd939bda2070a6a49fe678';
COMMENT ON TABLE kcml."mcp_discovery_snapshot" IS 'SSOT_CURRENT.md chapter 25 entity mcp_discovery_snapshot; contract sha256 c5ed4fd4b299ac1fa5f76604628fa1e2166bc97bc3d31ed61cede8b06bbf6ac9';
COMMENT ON TABLE kcml."mcp_discovery_item" IS 'SSOT_CURRENT.md chapter 25 entity mcp_discovery_item; contract sha256 baaa5a8daaad8061cef6b1dba53d08a68157acf0d368d6edbc606dce14a3d6ec';
COMMENT ON TABLE kcml."mcp_tool_alias" IS 'SSOT_CURRENT.md chapter 25 entity mcp_tool_alias; contract sha256 394235517224957b3c82b85f859ec881fbd44baac6268ef942a8290aeb25d9d7';
COMMENT ON TABLE kcml."mcp_request_event" IS 'SSOT_CURRENT.md chapter 25 entity mcp_request_event; contract sha256 707da407858420e716f570ce6c241c1047d1d35029416245bc02749d32684624';
COMMENT ON TABLE kcml."mcp_call_run" IS 'SSOT_CURRENT.md chapter 25 entity mcp_call_run; contract sha256 6cb12d1ed3c03f5abd9a957e8b21fee9a416541e07f874bb8cfe0fa96293babb';
COMMENT ON TABLE kcml."mcp_call_progress" IS 'SSOT_CURRENT.md chapter 25 entity mcp_call_progress; contract sha256 239de41d0451ac62e44e6ac6d0a8d65e8ca8209bc83200b3629a351f755e2a76';
COMMENT ON TABLE kcml."mcp_input_exchange" IS 'SSOT_CURRENT.md chapter 25 entity mcp_input_exchange; contract sha256 99df47f873f575e5cc672a46e1ff7a41e73bf6893d108d25c39d984cbb8a824a';
COMMENT ON TABLE kcml."mcp_input_request_item" IS 'SSOT_CURRENT.md chapter 25 entity mcp_input_request_item; contract sha256 2c467be26f73c761ce9573fc89be6d18acff9e60b4e431b769cf71d849378fb4';
COMMENT ON TABLE kcml."mcp_input_response_item" IS 'SSOT_CURRENT.md chapter 25 entity mcp_input_response_item; contract sha256 ee080670b8fc3637fe9fcb07cef4495beb6d8ac00f03d2ce842361af9e486b05';
COMMENT ON TABLE kcml."mcp_subscription" IS 'SSOT_CURRENT.md chapter 25 entity mcp_subscription; contract sha256 abc369393b7f3c909c153e5b54b2be1609927ccf7c89ea0acf72caba10630537';
COMMENT ON TABLE kcml."mcp_subscription_notification" IS 'SSOT_CURRENT.md chapter 25 entity mcp_subscription_notification; contract sha256 30c85f0dfcd970145329a84fd5d94040f784dde2591c09853a730f8680dd7b7a';
COMMENT ON TABLE kcml."mcp_state_handle" IS 'SSOT_CURRENT.md chapter 25 entity mcp_state_handle; contract sha256 b283296d265635bacdb183c8b2ffb2853ce470eaff367e1de3aa2e12f91eaa91';
COMMENT ON TABLE kcml."mcp_task" IS 'SSOT_CURRENT.md chapter 25 entity mcp_task; contract sha256 f7491655f131f4f6391230d000696076a4270ff3b5d0c09fd475cc0d333e55ff';
COMMENT ON TABLE kcml."mcp_task_input_request" IS 'SSOT_CURRENT.md chapter 25 entity mcp_task_input_request; contract sha256 cee47e54a6a6e45b343712a3d4d173be4cfc2186d3fd4fc826a8788427c912c9';
COMMENT ON TABLE kcml."mcp_task_input_response" IS 'SSOT_CURRENT.md chapter 25 entity mcp_task_input_response; contract sha256 2ae5c09e3d62802a41728417d0cf021734584ab96acffed840d788a6bb4dc420';
COMMENT ON TABLE kcml."mcp_task_event" IS 'SSOT_CURRENT.md chapter 25 entity mcp_task_event; contract sha256 0d63c0b87e8afb8c1b3c7290e4acebb37893b7b760bae7502215ccfd585a2312';
COMMENT ON TABLE kcml."mcp_idempotency_record" IS 'SSOT_CURRENT.md chapter 25 entity mcp_idempotency_record; contract sha256 245fc8327b4b013bb51787b28d1cb1d1affd1cdb700667bca2332b23d83808b9';
COMMENT ON TABLE kcml."runtime_execution_context" IS 'SSOT_CURRENT.md chapter 25 entity runtime_execution_context; contract sha256 c0a19c31011d12795b5030d0c71c4e1c441e205ac8446d0e07961b9662f56e1c';
COMMENT ON TABLE kcml."runtime_instance" IS 'SSOT_CURRENT.md chapter 25 entity runtime_instance; contract sha256 24e8b589e594804bd70a168418110937013a5b382e6f5e67b36fc20fbc6d728c';
COMMENT ON TABLE kcml."runtime_process_identity" IS 'SSOT_CURRENT.md chapter 25 entity runtime_process_identity; contract sha256 6795ff111d219d90787f3081bddbf10d44011a2141faceaba9b36d19fb83b0bb';
COMMENT ON TABLE kcml."runtime_ipc_connection" IS 'SSOT_CURRENT.md chapter 25 entity runtime_ipc_connection; contract sha256 665817a8f896bf729784807c7b3d4de81fac0e3598fed278291ae8e15dd88cd3';
COMMENT ON TABLE kcml."runtime_ipc_call" IS 'SSOT_CURRENT.md chapter 25 entity runtime_ipc_call; contract sha256 d1959ac652f7b17e747f4a8104592a0b844fef753e6fbba1daa3efc4b42f5804';
COMMENT ON TABLE kcml."runtime_credential_generation" IS 'SSOT_CURRENT.md chapter 25 entity runtime_credential_generation; contract sha256 6fc9e8753e0998af07c24f17d1cddf957ba0616ac080d35dadabb5976ccfa2eb';
COMMENT ON TABLE kcml."runtime_cleanup_operation" IS 'SSOT_CURRENT.md chapter 25 entity runtime_cleanup_operation; contract sha256 4d7f47d281b0a906a3962976750bebbc10f2aa1f7fa03ebc10e44e2e9e738f83';
COMMENT ON TABLE kcml."external_auth_binding" IS 'SSOT_CURRENT.md chapter 25 entity external_auth_binding; contract sha256 ee5a20e69c3f234a8561de45bd0d89b40f3b414a1c02725f0ccfff8d7577e755';
COMMENT ON TABLE kcml."secret_record" IS 'SSOT_CURRENT.md chapter 25 entity secret_record; contract sha256 6809b7e9e627599b71f1bfdf2ad184137595b855178dad9a052b106561d550fb';
COMMENT ON TABLE kcml."secret_version" IS 'SSOT_CURRENT.md chapter 25 entity secret_version; contract sha256 f57592de545ca70dfd4b3f4b8567ca64eb3cca4c5d17551a7e7deb18a55b634a';
COMMENT ON TABLE kcml."secret_binding" IS 'SSOT_CURRENT.md chapter 25 entity secret_binding; contract sha256 0e48e2f299a2ef3bdc532a3803c972d8e5670a7ab74894326b86450a4aad0786';
COMMENT ON TABLE kcml."secret_resolution" IS 'SSOT_CURRENT.md chapter 25 entity secret_resolution; contract sha256 a74f1ed839c706326a3ba14b2bcd9927fcb97c56add8cfad245330e17eff1f06';
COMMENT ON TABLE kcml."secret_access_event" IS 'SSOT_CURRENT.md chapter 25 entity secret_access_event; contract sha256 74567accad4aaaa5f503ee19c3a327532f1c9b9e832db969a5529c4829eb9619';
COMMENT ON TABLE kcml."external_target" IS 'SSOT_CURRENT.md chapter 25 entity external_target; contract sha256 920fc071f3ff232cef12bd2ba89765e2386fe259f2670ac32210338b20906c62';
COMMENT ON TABLE kcml."external_target_binding" IS 'SSOT_CURRENT.md chapter 25 entity external_target_binding; contract sha256 96e11636803ab2981900aafc4c1a56801eb45a0328d9de2d9090eaf565251abe';
COMMENT ON TABLE kcml."external_request_event" IS 'SSOT_CURRENT.md chapter 25 entity external_request_event; contract sha256 9f2ab4c49c8084702b1aedf468f493f00622fc9be7d960c675123fc7d0048de7';
COMMENT ON TABLE kcml."webhook_endpoint" IS 'SSOT_CURRENT.md chapter 25 entity webhook_endpoint; contract sha256 733413d7e3e904a8cbb4fdeb10c7fbbb55b210a8c0252f6b57722ddf063d5d55';
COMMENT ON TABLE kcml."dashboard_workspace" IS 'SSOT_CURRENT.md chapter 25 entity dashboard_workspace; contract sha256 abfc206b277d763a108869ecd60160c2845e6f44dcf95bb081d7f17d7870ead5';
COMMENT ON TABLE kcml."dashboard_node_position" IS 'SSOT_CURRENT.md chapter 25 entity dashboard_node_position; contract sha256 b350ca6c2a92dab5d2ee9fb98243f4fb51a55069a118665e7c08e9abaff32830';
COMMENT ON TABLE kcml."dashboard_connection" IS 'SSOT_CURRENT.md chapter 25 entity dashboard_connection; contract sha256 b81e6bb4f3aa0e941d2e0694792298b584a8a08c52bb192d2f1a7b213a161f1c';
COMMENT ON TABLE kcml."dashboard_runtime_event" IS 'SSOT_CURRENT.md chapter 25 entity dashboard_runtime_event; contract sha256 0115591f784cdf2bfbb3aeaeb5a39118bb76830c0692871c12a71b3c09085a92';
COMMENT ON TABLE kcml."monitoring_profile" IS 'SSOT_CURRENT.md chapter 25 entity monitoring_profile; contract sha256 f777ad5320596f849a852c1d4d05260c80b15c2fbaa8def63b5d71cdc7757133';
COMMENT ON TABLE kcml."monitoring_probe" IS 'SSOT_CURRENT.md chapter 25 entity monitoring_probe; contract sha256 a27d7412d473a13b019a07163567bf0baf485fd93fb8f24c2964f5136e7d8c16';
COMMENT ON TABLE kcml."component_state_history" IS 'SSOT_CURRENT.md chapter 25 entity component_state_history; contract sha256 81a9c066766115bfdcdcd12ba494bef2518f303d4152372946c5945db41ceacb';
COMMENT ON TABLE kcml."operational_alert" IS 'SSOT_CURRENT.md chapter 25 entity operational_alert; contract sha256 caa4ceca8ccac15fd6c6ca9d3965a61b8253fa3daa5f238357d7d486876b4504';
COMMENT ON TABLE kcml."alert_delivery" IS 'SSOT_CURRENT.md chapter 25 entity alert_delivery; contract sha256 443375f741163c5bf58d997cf18f853094dbcd27c3ad64233bfaadf06601bf7f';
COMMENT ON TABLE kcml."monitoring_scheduler_heartbeat" IS 'SSOT_CURRENT.md chapter 25 entity monitoring_scheduler_heartbeat; contract sha256 7ed4504b9e9aa0a9b67f5318db46c60e9f60a2efebead3bc4a634f88d845ed14';
COMMENT ON TABLE kcml."platform_worker_heartbeat" IS 'SSOT_CURRENT.md chapter 25 entity platform_worker_heartbeat; contract sha256 7bf0d94676ef2803ed6d763491725f7ec98bcdf7c3646e993e2678ac7ebd435f';
COMMENT ON TABLE kcml."audit_event" IS 'SSOT_CURRENT.md chapter 25 entity audit_event; contract sha256 960fdf4a2e6b087766298b4bf6756cd769bb5c5efdc2062069e78c669c423c9b';
COMMENT ON TABLE kcml."audit_head" IS 'SSOT_CURRENT.md chapter 25 entity audit_head; contract sha256 e48128802aae7326f79c04d0b546ba320813c172c9f55ca9b458d5e78d0ebb32';
COMMENT ON TABLE kcml."audit_archive_outbox" IS 'SSOT_CURRENT.md chapter 25 entity audit_archive_outbox; contract sha256 82d1b1729c99fcb33f7ddc7b0c470c3f8bd9d9ab3ed3b0d15c6f343caeb32e79';
COMMENT ON TABLE kcml."component_audit_stream" IS 'SSOT_CURRENT.md chapter 25 entity component_audit_stream; contract sha256 25e2b8b088ca8711b483677eff21f7a0875521d5981283874c94546d95296bbf';
COMMENT ON TABLE kcml."component_audit_event" IS 'SSOT_CURRENT.md chapter 25 entity component_audit_event; contract sha256 3f9343f3b2711ab19cea9071007f959a9ba484695f0fdb1dc46ca5f6917bd610';
COMMENT ON TABLE kcml."debug_log_event" IS 'SSOT_CURRENT.md chapter 25 entity debug_log_event; contract sha256 484cb2a251702276ca326db3c79838cc1930df192f3f40bfbd0bc9a0ef6374c5';
COMMENT ON TABLE kcml."generation_job" IS 'SSOT_CURRENT.md chapter 25 entity generation_job; contract sha256 c80f35874cba13e216c55bfd09c52c70dde7afdd13bf60e67516ca33ae0494c9';
COMMENT ON TABLE kcml."generation_source" IS 'SSOT_CURRENT.md chapter 25 entity generation_source; contract sha256 17e8bec823b186bcc979a4725319f7d8f2cf75c33de85337361ebe2f12b4df12';
COMMENT ON TABLE kcml."generation_fact" IS 'SSOT_CURRENT.md chapter 25 entity generation_fact; contract sha256 3e820d05a588257f79b52dac354482f3f831ba46fbe6c7e581b615303b5355f2';
COMMENT ON TABLE kcml."generation_owner_decision" IS 'SSOT_CURRENT.md chapter 25 entity generation_owner_decision; contract sha256 9ade52f97b34411d6ca54a1e321f8ef129706e3ec439f75f25330e485f71f96d';
COMMENT ON TABLE kcml."generation_message" IS 'SSOT_CURRENT.md chapter 25 entity generation_message; contract sha256 48d5cb4bd0e7f7492ee78d0a2973ce9f95df76a3daa70a4251e2fbad7b599c12';
COMMENT ON TABLE kcml."generation_turn" IS 'SSOT_CURRENT.md chapter 25 entity generation_turn; contract sha256 ef4bc462bb46ff1bc3d591c92f296a8b0fa98b46f268006f9f6c0dc3ef6783c2';
COMMENT ON TABLE kcml."generation_spec_revision" IS 'SSOT_CURRENT.md chapter 25 entity generation_spec_revision; contract sha256 09a5437b2f00fb5e124ccff112333f26307bdd9b62684c48052d9bc1143cafb4';
COMMENT ON TABLE kcml."generation_execution_authority" IS 'SSOT_CURRENT.md chapter 25 entity generation_execution_authority; contract sha256 d9c3a6f94461d14af5521246d6098388b44a9e0936c2956df15d3e1123534b14';
COMMENT ON TABLE kcml."generation_capability_snapshot" IS 'SSOT_CURRENT.md chapter 25 entity generation_capability_snapshot; contract sha256 6b8e32474462ab0177b9171278b9131f6afe3714066235ac7b8fe4414cf62d5e';
COMMENT ON TABLE kcml."generation_capability_match" IS 'SSOT_CURRENT.md chapter 25 entity generation_capability_match; contract sha256 5c632cef35fbe94bf1a2223aefef2ccc566384334a99e1d83900a5aa968b5267';
COMMENT ON TABLE kcml."generation_plan" IS 'SSOT_CURRENT.md chapter 25 entity generation_plan; contract sha256 c690c63f06ce24bc612ffb0d08257b5653856356786ad8457ea44f9edf28cbde';
COMMENT ON TABLE kcml."generation_plan_node" IS 'SSOT_CURRENT.md chapter 25 entity generation_plan_node; contract sha256 d7d72d44211d0db10ed8fcf385b660e3f5f720176685d43b4f8e6c8e1bee7a2e';
COMMENT ON TABLE kcml."generation_plan_edge" IS 'SSOT_CURRENT.md chapter 25 entity generation_plan_edge; contract sha256 c1db14c613b4f0babcea7eba774868769398118e2f3c56a67a094f9a7d03dcb9';
COMMENT ON TABLE kcml."generation_phase_run" IS 'SSOT_CURRENT.md chapter 25 entity generation_phase_run; contract sha256 d4eb317d01e0c41666ac8f98452977eb8505016f3445ac7ca78aa98eceea2454';
COMMENT ON TABLE kcml."generation_checkpoint" IS 'SSOT_CURRENT.md chapter 25 entity generation_checkpoint; contract sha256 b366d5e068ae1499ed5a2712c460f08f5797ad02c39ec674006831dedd4c8f71';
COMMENT ON TABLE kcml."generation_tool_event" IS 'SSOT_CURRENT.md chapter 25 entity generation_tool_event; contract sha256 efc24ac170776e7697722398fdb30b7fc9c8a15a3458d4c1a1e4ba63ab9417bf';
COMMENT ON TABLE kcml."generation_workspace_revision" IS 'SSOT_CURRENT.md chapter 25 entity generation_workspace_revision; contract sha256 0fd83fdc63f79eebba63295dd63890bdbf562641a21bf0c1dcac94b298b78373';
COMMENT ON TABLE kcml."generation_workspace_file" IS 'SSOT_CURRENT.md chapter 25 entity generation_workspace_file; contract sha256 a8f5dcd3d62d0dbce1623b654465b0d8f7782947d7d0895512f7a501fe4fd603';
COMMENT ON TABLE kcml."generation_workspace_patch" IS 'SSOT_CURRENT.md chapter 25 entity generation_workspace_patch; contract sha256 a4c69361b3e2d6bb25a3732a42a04c73c914c6c851b6bfb3b6ca4e42363a6d20';
COMMENT ON TABLE kcml."generation_artifact_manifest" IS 'SSOT_CURRENT.md chapter 25 entity generation_artifact_manifest; contract sha256 e0b61eac76b0e1945c40611dfb0bc400b7dedd6189dd046c03dbd6ec5030bfaa';
COMMENT ON TABLE kcml."generation_artifact" IS 'SSOT_CURRENT.md chapter 25 entity generation_artifact; contract sha256 a549c1996712afd7277aa8d5ed05f694945f372060f87c62e8b7543f8a41e3ff';
COMMENT ON TABLE kcml."generation_contract_candidate" IS 'SSOT_CURRENT.md chapter 25 entity generation_contract_candidate; contract sha256 bf34f162ea749f152130c7d9e425270ef1feec4c94821752f82113e207ab3585';
COMMENT ON TABLE kcml."generation_validation_run" IS 'SSOT_CURRENT.md chapter 25 entity generation_validation_run; contract sha256 c27b4009039b5df43026f8ffe831fde603d800175bb471f1861c35ed639440a7';
COMMENT ON TABLE kcml."generation_validation_result" IS 'SSOT_CURRENT.md chapter 25 entity generation_validation_result; contract sha256 0d4819ff105b2412e3ca1f0f41914ee24e77c1bd953ba78fe2f58025d6774513';
COMMENT ON TABLE kcml."generation_repair_iteration" IS 'SSOT_CURRENT.md chapter 25 entity generation_repair_iteration; contract sha256 e52a087bbf3379882dcba9124cb4eea613d468e9ec0fdcbe64ab4f1836609b72';
COMMENT ON TABLE kcml."generation_blocker" IS 'SSOT_CURRENT.md chapter 25 entity generation_blocker; contract sha256 71b7ba69920be43367f8bd5f8c95e2b517204e4c174150ededf962b1eb6b9fd7';
COMMENT ON TABLE kcml."generation_activation_set" IS 'SSOT_CURRENT.md chapter 25 entity generation_activation_set; contract sha256 1aa2f841e089f97e4aa560dbbea5c91340ee0964f4aa7a23f1e5752c8ae092c1';
COMMENT ON TABLE kcml."generation_activation_member" IS 'SSOT_CURRENT.md chapter 25 entity generation_activation_member; contract sha256 18210f30137a2d7da1332d71ce8c0b5f6b06361ee38a74c1a93f4a7df019f456';
COMMENT ON TABLE kcml."generation_event" IS 'SSOT_CURRENT.md chapter 25 entity generation_event; contract sha256 709b244cff790629e7964e625fc2e74854641be1cc8dda704ba2ec3ad8296141';
COMMENT ON TABLE kcml."openai_model_capability_snapshot" IS 'SSOT_CURRENT.md chapter 25 entity openai_model_capability_snapshot; contract sha256 9381d5e270096a3b63be2995f5612e8ee30c4dd4ad947d4082113d5f9a63167a';
COMMENT ON TABLE kcml."openai_request_descriptor" IS 'SSOT_CURRENT.md chapter 25 entity openai_request_descriptor; contract sha256 3509574e873fe06a3da3c7a0dd8cf32a92ee33a6ca269039ec21ded11df0a792';
COMMENT ON TABLE kcml."ai_model_call" IS 'SSOT_CURRENT.md chapter 25 entity ai_model_call; contract sha256 d4f06f7f2bc44908c7efa7a9ce07dcff75f79878ff1cd7669efdbac6f775e884';
COMMENT ON TABLE kcml."ai_model_event" IS 'SSOT_CURRENT.md chapter 25 entity ai_model_event; contract sha256 7c470c5ba69ba5cf1ddb12b33e4545254c10d23ebe625ba9f7901b29bc634bd2';
COMMENT ON TABLE kcml."ai_model_output_item" IS 'SSOT_CURRENT.md chapter 25 entity ai_model_output_item; contract sha256 cdb438b936d95900f518d698cf2a644a0a31214c98d1f85cac09939e9885ef07';
COMMENT ON TABLE kcml."ai_model_output_content_part" IS 'SSOT_CURRENT.md chapter 25 entity ai_model_output_content_part; contract sha256 7431b11ba459ca3730ff5d30f90882ec88715cc225a378c6fa624bb2d8d7d5c0';
COMMENT ON TABLE kcml."ai_tool_dispatch" IS 'SSOT_CURRENT.md chapter 25 entity ai_tool_dispatch; contract sha256 96179860ebe44499aeed0a82f660c668bcc9760229ba6cba262dc8e30b5958fb';
COMMENT ON TABLE kcml."ai_model_continuation" IS 'SSOT_CURRENT.md chapter 25 entity ai_model_continuation; contract sha256 39b6065a94cad409cef5f618cb0226796e01c515108c36a7e1a59eaf38e7740b';
COMMENT ON TABLE kcml."ai_run_state_checkpoint" IS 'SSOT_CURRENT.md chapter 25 entity ai_run_state_checkpoint; contract sha256 b8d7dd9fd3e687689a94f936a0f1c519bbcd9234572b884c06bd25a42e5112c7';
COMMENT ON TABLE kcml."agent_session_compaction" IS 'SSOT_CURRENT.md chapter 25 entity agent_session_compaction; contract sha256 678e11743137d72ce56b15a283dfba8ffdd1732a0df53f31012a6af5485dee81';
COMMENT ON TABLE kcml."agent_definition" IS 'SSOT_CURRENT.md chapter 25 entity agent_definition; contract sha256 6e4bd6d6a12d4cfad2b9597def7b9facb4ec8de9b6eb15a86f8adde9af50c317';
COMMENT ON TABLE kcml."agent_revision" IS 'SSOT_CURRENT.md chapter 25 entity agent_revision; contract sha256 62214f9a953c907b1aac5cfda24ea736322ea82914454a7ffe3fc01505daca8d';
COMMENT ON TABLE kcml."agent_tool_binding" IS 'SSOT_CURRENT.md chapter 25 entity agent_tool_binding; contract sha256 ee383f6be6fd94e747265b1c0d5e6ea4e7071caff64ba442ef2ce57bdf1417a7';
COMMENT ON TABLE kcml."agent_handoff_binding" IS 'SSOT_CURRENT.md chapter 25 entity agent_handoff_binding; contract sha256 d7d6cb217bda7ccc0fb55a015eff14355aea506c64335b3be6638c500a3c4918';
COMMENT ON TABLE kcml."agent_guardrail" IS 'SSOT_CURRENT.md chapter 25 entity agent_guardrail; contract sha256 7994ecd21afec62e3423503184d8bc972a80ed0cdb17f48a2374c75cbc052536';
COMMENT ON TABLE kcml."agent_session" IS 'SSOT_CURRENT.md chapter 25 entity agent_session; contract sha256 282531b1163eb07453e581796d3b03a30fc70b6f84116d83f063d1f6158b3014';
COMMENT ON TABLE kcml."agent_session_item" IS 'SSOT_CURRENT.md chapter 25 entity agent_session_item; contract sha256 10a1f4deff9cdce2da560ec839e0fe939f035e202c0a6b7c69946af02c5286ba';
COMMENT ON TABLE kcml."agent_run" IS 'SSOT_CURRENT.md chapter 25 entity agent_run; contract sha256 7b331d24edb9f021bdf727176e8f589753764096baa3ace1ff5aa46d83205b06';
COMMENT ON TABLE kcml."agent_run_checkpoint" IS 'SSOT_CURRENT.md chapter 25 entity agent_run_checkpoint; contract sha256 a0163bbc6cf806d1a662c3ed20490de7f1393de899e1ed6e01f8b34323e9b51a';
COMMENT ON TABLE kcml."agent_message" IS 'SSOT_CURRENT.md chapter 25 entity agent_message; contract sha256 9a1c8d45241bce7b273d68ae06c42ceeba37d67461d5f57516ad6fd14246f078';
COMMENT ON TABLE kcml."agent_tool_call" IS 'SSOT_CURRENT.md chapter 25 entity agent_tool_call; contract sha256 275ff1824e8d5bf0338fc06dcbf944e9fe84e28797399fc7de209f1149e51434';
COMMENT ON TABLE kcml."agent_handoff_run" IS 'SSOT_CURRENT.md chapter 25 entity agent_handoff_run; contract sha256 6e25ef87f5877c2d4db729e32ab4b4ac85dd34d6cee6a2b546dcfee06d96f480';
COMMENT ON TABLE kcml."agent_approval_request" IS 'SSOT_CURRENT.md chapter 25 entity agent_approval_request; contract sha256 fa805e1f33208e83e7dda4c8165782af18ee765e47a7805100153c37fcab353c';
COMMENT ON TABLE kcml."agent_memory_namespace" IS 'SSOT_CURRENT.md chapter 25 entity agent_memory_namespace; contract sha256 f44431c2f49f7c3b53e2ae448a1231a36fa69426e2fb431ecda04ebf3138242e';
COMMENT ON TABLE kcml."agent_memory_item" IS 'SSOT_CURRENT.md chapter 25 entity agent_memory_item; contract sha256 9f401879424e20b004ba9a19eda4d641586d230955bf092454bb825d711271be';
COMMENT ON TABLE kcml."agent_trigger" IS 'SSOT_CURRENT.md chapter 25 entity agent_trigger; contract sha256 73cd99dc7bdc4d03d3b06e4d9e07bc80c1f1b9ecda1a4f0d5f9dc5639ed45a56';
COMMENT ON TABLE kcml."agent_eval_suite" IS 'SSOT_CURRENT.md chapter 25 entity agent_eval_suite; contract sha256 e96e0323e3ea24af1b4ab8def3c2ce432a48e9672a38a432090ba469d4772aad';
COMMENT ON TABLE kcml."agent_eval_case" IS 'SSOT_CURRENT.md chapter 25 entity agent_eval_case; contract sha256 c6fbfe857eb855595e34f5b4e4f27185fda87b102fe0e8c2aa99cc325efec4bd';
COMMENT ON TABLE kcml."agent_eval_run" IS 'SSOT_CURRENT.md chapter 25 entity agent_eval_run; contract sha256 60082c6a18ccd829498638072a61e4806a62eaaffc03ae6dbda9b072bf8677f7';
COMMENT ON TABLE kcml."agent_eval_case_result" IS 'SSOT_CURRENT.md chapter 25 entity agent_eval_case_result; contract sha256 b3017aba6da9774a51b688e48de102f0aa7fdb68dc1ef9d5a22ed9587236ea77';
COMMENT ON TABLE kcml."system_chat_conversation" IS 'SSOT_CURRENT.md chapter 25 entity system_chat_conversation; contract sha256 9822ca4ebc1e5f6cbefff4cf541c3b606172ca65e91633338e6319abc4893744';
COMMENT ON TABLE kcml."system_chat_message" IS 'SSOT_CURRENT.md chapter 25 entity system_chat_message; contract sha256 0acb85bc091e968776885604cc5c2f58ee76d20782459b5ad8f5a7d2abbac6c0';
COMMENT ON TABLE kcml."system_chat_action" IS 'SSOT_CURRENT.md chapter 25 entity system_chat_action; contract sha256 bf0aa03487a2698a8a2a8ff3799e70afd67eaf38270d8e2a618f76c89cf735d3';
COMMENT ON TABLE kcml."browser_runtime_build_manifest" IS 'SSOT_CURRENT.md chapter 25 entity browser_runtime_build_manifest; contract sha256 0f54d76a64a550846b173897a8cf63d24a96e8a4b7e5c90ea248e21d4a976864';
COMMENT ON TABLE kcml."browser_session" IS 'SSOT_CURRENT.md chapter 25 entity browser_session; contract sha256 f028bb414b843be5dac4ad263dd61934073b3027ed25f824fe3cead7fe166d9c';
COMMENT ON TABLE kcml."browser_session_binding" IS 'SSOT_CURRENT.md chapter 25 entity browser_session_binding; contract sha256 b600c45d72391f933a18fa1cda3dbe7c56beefee0703aa80c7c58023f9b9aab9';
COMMENT ON TABLE kcml."browser_host_slot" IS 'SSOT_CURRENT.md chapter 25 entity browser_host_slot; contract sha256 03f76107d623e84943ebd45038051b7304a051a3c4b97abdd7303716f0919287';
COMMENT ON TABLE kcml."browser_context_instance" IS 'SSOT_CURRENT.md chapter 25 entity browser_context_instance; contract sha256 17e21be04a8045f4787290f17c5ae17999ec464a8f87b214fb7803d0d112ba4b';
COMMENT ON TABLE kcml."browser_page" IS 'SSOT_CURRENT.md chapter 25 entity browser_page; contract sha256 60fafa41219f47d1a8370b53c5f8b7300e5a7ccc1400ae2c6edadab4f5ca06ff';
COMMENT ON TABLE kcml."browser_frame" IS 'SSOT_CURRENT.md chapter 25 entity browser_frame; contract sha256 8562f6250fb7aaa6fe1deb65c51d9c5eec52aadc83cafb68763bc1e21dddf3cc';
COMMENT ON TABLE kcml."browser_document" IS 'SSOT_CURRENT.md chapter 25 entity browser_document; contract sha256 d73b7b15afc7c0016dbe481c072ade0c542f92c249531414674b95d182c95ea3';
COMMENT ON TABLE kcml."browser_navigation" IS 'SSOT_CURRENT.md chapter 25 entity browser_navigation; contract sha256 fe05af2cda7861d7bf4e7702665c0ecf3a1a3f5cfe42679f933aa6ea7f489271';
COMMENT ON TABLE kcml."browser_observation" IS 'SSOT_CURRENT.md chapter 25 entity browser_observation; contract sha256 efe443a3958b570308f472853eb75a67427505320949d62e95373ccb2d917af3';
COMMENT ON TABLE kcml."browser_preview_frame" IS 'SSOT_CURRENT.md chapter 25 entity browser_preview_frame; contract sha256 2c524fdd35d76e21a8664ddda2a6a84cfc6b42bf710ff7111688525d8881123b';
COMMENT ON TABLE kcml."browser_preview_ticket" IS 'SSOT_CURRENT.md chapter 25 entity browser_preview_ticket; contract sha256 a25f8771acd8bf47c577a748879e44d004820ee69c557c6e6e851c06a1feacfe';
COMMENT ON TABLE kcml."browser_preview_event" IS 'SSOT_CURRENT.md chapter 25 entity browser_preview_event; contract sha256 28b1d10fefaaaca6c6961da9965a03163da91540d49a945cf9fb16bb0cc81f14';
COMMENT ON TABLE kcml."browser_control_lease" IS 'SSOT_CURRENT.md chapter 25 entity browser_control_lease; contract sha256 11777922fb20a2be1a8ff0120a05c776c004b4a83bc6436193b1e8ff439f1384';
COMMENT ON TABLE kcml."browser_control_transfer" IS 'SSOT_CURRENT.md chapter 25 entity browser_control_transfer; contract sha256 163fb268295d1a19f8911e1abfb6d04c295c8c2d4dd732b0a6e139f19eb32db2';
COMMENT ON TABLE kcml."browser_input_event" IS 'SSOT_CURRENT.md chapter 25 entity browser_input_event; contract sha256 e9e81bcebe9c3aa9aa3e5c502f48a8a1ec94fa06536b8777843584938e9d8e73';
COMMENT ON TABLE kcml."browser_target_reference" IS 'SSOT_CURRENT.md chapter 25 entity browser_target_reference; contract sha256 da87ee3e2a7760e4bb7925679f4c049fe9822912ac7fcaf18422ca563a6070cb';
COMMENT ON TABLE kcml."browser_action_run" IS 'SSOT_CURRENT.md chapter 25 entity browser_action_run; contract sha256 ac70c339f38599132977a8d624d12f0841d1f0e0c103a890a69040a14abafd88';
COMMENT ON TABLE kcml."browser_action_attempt" IS 'SSOT_CURRENT.md chapter 25 entity browser_action_attempt; contract sha256 deae1488f8312c57100c3b3305380ce3d004ca6731c95e6223232235187008e1';
COMMENT ON TABLE kcml."browser_action_dispatch_event" IS 'SSOT_CURRENT.md chapter 25 entity browser_action_dispatch_event; contract sha256 68a1fcdfa0375f5e2515e65816df81b465ae5221dd97ce4d767f256727ba0c5c';
COMMENT ON TABLE kcml."browser_operation_scope" IS 'SSOT_CURRENT.md chapter 25 entity browser_operation_scope; contract sha256 a52213bd68835ebd7168dc5fea3f9342d9f612c9a9d6cc2649ccf6816a8c8384';
COMMENT ON TABLE kcml."browser_irreversible_confirmation" IS 'SSOT_CURRENT.md chapter 25 entity browser_irreversible_confirmation; contract sha256 f26f5fb04557f24f00ea4d96c45d0f0b2ad7ed1acd66ad38d3bde8be900c847f';
COMMENT ON TABLE kcml."browser_account_binding" IS 'SSOT_CURRENT.md chapter 25 entity browser_account_binding; contract sha256 f9875ca55d13b3ccdaeb5c65ee2a50812a024b8967a48950c40a6a157edc706a';
COMMENT ON TABLE kcml."browser_auth_attempt" IS 'SSOT_CURRENT.md chapter 25 entity browser_auth_attempt; contract sha256 c45c106ac7b336edcec80c57996c547d22d1be376eb9c63c999e2d6aca1614b8';
COMMENT ON TABLE kcml."browser_state_bundle" IS 'SSOT_CURRENT.md chapter 25 entity browser_state_bundle; contract sha256 1d4d28d8a62edaee6aeb05c9bea99bc482a5c692ee8814bee54221e5066fb04d';
COMMENT ON TABLE kcml."browser_state_bundle_member" IS 'SSOT_CURRENT.md chapter 25 entity browser_state_bundle_member; contract sha256 d1cfd1efa3339be3ac23607fa9266065cb3882eb04930b4707d67c7268845728';
COMMENT ON TABLE kcml."browser_local_bridge" IS 'SSOT_CURRENT.md chapter 25 entity browser_local_bridge; contract sha256 f4280d70634831c7d4a5715dfbfe78dbaabe07cdf83ff71aeed72bf84163b16a';
COMMENT ON TABLE kcml."browser_bridge_connection" IS 'SSOT_CURRENT.md chapter 25 entity browser_bridge_connection; contract sha256 9011b9cd24d2563dd275d05a3b4a35c3cf489d3f54be02e59687f0591d4929f8';
COMMENT ON TABLE kcml."browser_bridge_assignment" IS 'SSOT_CURRENT.md chapter 25 entity browser_bridge_assignment; contract sha256 924a092864218f14f87792d1d2d96c9eb56a1fd1c2827a99e2adb7bcf6fd35be';
COMMENT ON TABLE kcml."browser_profile_lease" IS 'SSOT_CURRENT.md chapter 25 entity browser_profile_lease; contract sha256 d813cf29424bce63dcd797dbb88313298c03058c332daa7434f6e2b25dfa6130';
COMMENT ON TABLE kcml."browser_dialog" IS 'SSOT_CURRENT.md chapter 25 entity browser_dialog; contract sha256 11cd64e8b0aa67ff6053fd436879091dac4517ca16b5a98e36067fd1daa8d9f1';
COMMENT ON TABLE kcml."browser_permission_request" IS 'SSOT_CURRENT.md chapter 25 entity browser_permission_request; contract sha256 2467931e8ee27e8e6c206a4fc149dd7552d0e3d423888e66401028b6848bf6a4';
COMMENT ON TABLE kcml."browser_upload_handle" IS 'SSOT_CURRENT.md chapter 25 entity browser_upload_handle; contract sha256 0e0c8dcc2d8b878c304a2b2fa71f0f8641cc65df48a858c75363834767d8159e';
COMMENT ON TABLE kcml."browser_download" IS 'SSOT_CURRENT.md chapter 25 entity browser_download; contract sha256 728ebdb29befd619ac8b113cabf182a7dc5f4104f3d9b04856cc874ee7302045';
COMMENT ON TABLE kcml."browser_teaching_run" IS 'SSOT_CURRENT.md chapter 25 entity browser_teaching_run; contract sha256 3dce69c80a191fda83a89edd466591aa5d5152ace4b4833fcaa6992a5dbbda6b';
COMMENT ON TABLE kcml."browser_teaching_step" IS 'SSOT_CURRENT.md chapter 25 entity browser_teaching_step; contract sha256 4e10efb019d1fdfdfdfcf307222f637bb0913cea8844bb6fdf8936a946657883';
COMMENT ON TABLE kcml."browser_automation_definition" IS 'SSOT_CURRENT.md chapter 25 entity browser_automation_definition; contract sha256 28e33b260ffe2751a453c910eeb32ffdfec89ce5c1dda66bbc63cfc95c0bf776';
COMMENT ON TABLE kcml."browser_automation_revision" IS 'SSOT_CURRENT.md chapter 25 entity browser_automation_revision; contract sha256 76a3a8c03ab1997eefaeec7ef23f5438e80ada9f8335c7e0981c728568545b2e';
COMMENT ON TABLE kcml."browser_automation_run" IS 'SSOT_CURRENT.md chapter 25 entity browser_automation_run; contract sha256 eda12b2e12fff951c28bd0fb39503ecb92da8525eae5906088bb5042be9836b7';
COMMENT ON TABLE kcml."browser_automation_run_step" IS 'SSOT_CURRENT.md chapter 25 entity browser_automation_run_step; contract sha256 b858df59cd96a1b01d22f859e98defc0eac7dce2a47a1e8436b21558990b96cf';
COMMENT ON TABLE kcml."browser_automation_artifact" IS 'SSOT_CURRENT.md chapter 25 entity browser_automation_artifact; contract sha256 4df2fd57f7b79201c513cfe48b817c2a6d44c9b7f9f72bb1e80ccba561c65bc1';
COMMENT ON TABLE kcml."browser_auth_binding" IS 'SSOT_CURRENT.md chapter 25 entity browser_auth_binding; contract sha256 80272d715501f887078fc17038672580bbd942b5c093ca47064bd4d9a4eea215';
COMMENT ON TABLE kcml."browser_challenge" IS 'SSOT_CURRENT.md chapter 25 entity browser_challenge; contract sha256 870cd8fc26d49235192bfe6dc362930448f70d68c4f61a139bf4fc634e873bea';
COMMENT ON TABLE kcml."self_test_run" IS 'SSOT_CURRENT.md chapter 25 entity self_test_run; contract sha256 88438342bb0fb73cece5f6eb92667d1763a8e073ff281712a882fb33e1cbe0f1';
COMMENT ON TABLE kcml."self_test_case_result" IS 'SSOT_CURRENT.md chapter 25 entity self_test_case_result; contract sha256 a2d323f303bd6a1646c17c5fb59628ad5f946c9a9bd75bdc34e6585b882ecf9d';
COMMENT ON TABLE kcml."self_test_catalog_entry" IS 'SSOT_CURRENT.md chapter 25 entity self_test_catalog_entry; contract sha256 124b2576f054c198be7230faac0e60bb4268547eebe3b0037407c0cc42a7edf8';
COMMENT ON TABLE kcml."application_release" IS 'SSOT_CURRENT.md chapter 25 entity application_release; contract sha256 de22195b8824a29d77a35acd044ed21c7b56df32a0b2ed34a912396c72bc2fd1';
COMMENT ON TABLE kcml."deployment_run" IS 'SSOT_CURRENT.md chapter 25 entity deployment_run; contract sha256 2bb3f6a80b70a9adcb7ac0a7729920cbbf825544ab682beaf2ed5a5a7198e2ea';
COMMENT ON TABLE kcml."deployment_step" IS 'SSOT_CURRENT.md chapter 25 entity deployment_step; contract sha256 45d3486c55065e0c6863f3cfafad8035cdd136936d7b26e13aa4b233310d9528';
COMMENT ON TABLE kcml."backup_record" IS 'SSOT_CURRENT.md chapter 25 entity backup_record; contract sha256 a92095ee87e2e71e84fc39d8ac019129b1b884b5bc66858c3ff2eaa98c2e7d61';
COMMENT ON TABLE kcml."production_acceptance_run" IS 'SSOT_CURRENT.md chapter 25 entity production_acceptance_run; contract sha256 0f7cf2ca8971f3ee7d45f791b6dcbdc8bb8ba4af1703897857969fa8415dbdcd';
COMMENT ON TABLE kcml."operational_setting" IS 'SSOT_CURRENT.md chapter 25 entity operational_setting; contract sha256 eeb39fe1fbbf784fc5dfb15c258eb5ac9828cfa57455a80b564bae80189fb5c0';
COMMENT ON TABLE kcml."operational_setting_applied" IS 'SSOT_CURRENT.md chapter 25 entity operational_setting_applied; contract sha256 79cce5f19b5745d994681c0bc01d32a8cbb938c7b966f39e7944bff251834f7e';
COMMENT ON TABLE kcml."platform_incarnation" IS 'SSOT_CURRENT.md chapter 25 entity platform_incarnation; contract sha256 08fec80f6eb0e3a2498958f41e8639cf5fc7592e2b88b4a98872fe0a614ba771';
COMMENT ON TABLE kcml."domain_command" IS 'SSOT_CURRENT.md chapter 25 entity domain_command; contract sha256 609c4a0fc16095f48fcbf36c0e598f9bdf4ee56d0ab23e1558eed0d2177cd406';
COMMENT ON TABLE kcml."domain_idempotency_record" IS 'SSOT_CURRENT.md chapter 25 entity domain_idempotency_record; contract sha256 a5c5278b625cfde630f3a5bd8b336ba023d2ef0c2935774c2e5367d9fac9de24';
COMMENT ON TABLE kcml."side_effect_operation" IS 'SSOT_CURRENT.md chapter 25 entity side_effect_operation; contract sha256 0770f6d05b7aaaa0324019f30cdcab6d64c8061127b1dd2429f36b8cffcc674e';
COMMENT ON TABLE kcml."side_effect_attempt" IS 'SSOT_CURRENT.md chapter 25 entity side_effect_attempt; contract sha256 49fa54da416b3ea4182ce14cc66c0e7b1e231564b15336aef197a0820efc5514';
COMMENT ON TABLE kcml."side_effect_attempt_state" IS 'SSOT_CURRENT.md chapter 25 entity side_effect_attempt_state; contract sha256 b7c68b424b30fa11d69476c5a20bf9e723364b42e1fbe82720e236b07bff7601';
COMMENT ON TABLE kcml."side_effect_attempt_evidence" IS 'SSOT_CURRENT.md chapter 25 entity side_effect_attempt_evidence; contract sha256 c89af772d7c28c23d1c10f447fa98f2dd4b9b23d01248b8254f08c655aefb2c1';
COMMENT ON TABLE kcml."transactional_outbox" IS 'SSOT_CURRENT.md chapter 25 entity transactional_outbox; contract sha256 13f85ab106a6ba5a4e5ef71fd94c7baf48e70f122b4fe83f0c7837613a97d785';
COMMENT ON TABLE kcml."transactional_inbox" IS 'SSOT_CURRENT.md chapter 25 entity transactional_inbox; contract sha256 b9e588d887f82ae8d4945e9c66451e68900db163e94ac71dc2bd05fc309ce8d1';
COMMENT ON TABLE kcml."queue_item" IS 'SSOT_CURRENT.md chapter 25 entity queue_item; contract sha256 469c87ab4175a759315fcd971985ffc7c3022ded5bfd524291bfed35d3d2ff8c';
COMMENT ON TABLE kcml."concurrency_claim" IS 'SSOT_CURRENT.md chapter 25 entity concurrency_claim; contract sha256 13644a06f6e2391eeb27d034ef85ddc51767660fe95019d0b0fd0cc984a17761';
COMMENT ON TABLE kcml."binding_set" IS 'SSOT_CURRENT.md chapter 25 entity binding_set; contract sha256 ec1d2d1d0a9049c3f26816997da5c36d46634983386a2498a3da24a9cce4f98b';
COMMENT ON TABLE kcml."binding_set_revision" IS 'SSOT_CURRENT.md chapter 25 entity binding_set_revision; contract sha256 0e44e024b8e4953916b8826bbd88cbc4786e17cb63b96415eb418ce5f19d9e1b';
COMMENT ON TABLE kcml."binding_set_member" IS 'SSOT_CURRENT.md chapter 25 entity binding_set_member; contract sha256 8d7b2acae2505766f3074466ba06cde09daf6e21db9933fdf31e16bd78120c3b';
COMMENT ON TABLE kcml."activation_domain_head" IS 'SSOT_CURRENT.md chapter 25 entity activation_domain_head; contract sha256 0cfc77642a0075039e0238180cf485c8be87fb31442921caa4fea2362a7a3df2';
COMMENT ON TABLE kcml."domain_command_activation_domain" IS 'SSOT_CURRENT.md chapter 25 entity domain_command_activation_domain; contract sha256 4095d4e65738384a041b12788d0dd5ba45d7b94c5ea1a9a67dfad7439e276090';
COMMENT ON TABLE kcml."activation_head" IS 'SSOT_CURRENT.md chapter 25 entity activation_head; contract sha256 e49671422cc4a80fc0ad406b57a37e48f49347f700580fe90a7776f2922be36b';
COMMENT ON TABLE kcml."application_deployment_head" IS 'SSOT_CURRENT.md chapter 25 entity application_deployment_head; contract sha256 5d7ea0297f5d2753937c141c1e828627183a7583bd2b1096738d25da48afdbfe';
COMMENT ON TABLE kcml."activation_domain_barrier" IS 'SSOT_CURRENT.md chapter 25 entity activation_domain_barrier; contract sha256 0d233d2472cc607bda897c5fea0f2adebf08842dc8c519db8bc1382492a68677';
COMMENT ON TABLE kcml."cleanup_operation" IS 'SSOT_CURRENT.md chapter 25 entity cleanup_operation; contract sha256 645439536b35c103b9cfbded1c9f3377fe119ca0b1328846a939730a22b78140';
COMMENT ON TABLE kcml."cleanup_resource" IS 'SSOT_CURRENT.md chapter 25 entity cleanup_resource; contract sha256 6ec94385f12957894ccda9deb6aee7a0c5e6b586323af028725722c96a217902';
COMMENT ON TABLE kcml."configuration_apply_run" IS 'SSOT_CURRENT.md chapter 25 entity configuration_apply_run; contract sha256 d28208a42a2007ff9a93b2727d6281497675a58436e3c778b2ce63a0855cc57e';
COMMENT ON TABLE kcml."schema_migration" IS 'SSOT_CURRENT.md chapter 25 entity schema_migration; contract sha256 46490de006bf231b5020a43266031a191c511d765ee408ac2e4f781f7c3814cf';
COMMENT ON TABLE kcml."authority_lineage" IS 'SSOT_CURRENT.md chapter 25 entity authority_lineage; contract sha256 5e883b29817188cebae5fc8b7af78e5ec616a83420f0db96621fe822f9fec611';
COMMENT ON TABLE kcml."operation_intent" IS 'SSOT_CURRENT.md chapter 25 entity operation_intent; contract sha256 47745df438e63f306b426675e406f6bd0b51b428bde0610726b1e34e0f365086';
COMMENT ON TABLE kcml."content_provenance" IS 'SSOT_CURRENT.md chapter 25 entity content_provenance; contract sha256 bc24e8c5b1662178905bf21a976c6f6699b5ec29c9b6a3d617357b74f8635beb';
COMMENT ON TABLE kcml."instruction_segment" IS 'SSOT_CURRENT.md chapter 25 entity instruction_segment; contract sha256 52d0afcba0e640501234f99d826f32d8a5613f3ae60cc7e97f02c35ba95a49da';
COMMENT ON TABLE kcml."operation_context" IS 'SSOT_CURRENT.md chapter 25 entity operation_context; contract sha256 4877838d1639089b567492c110af0bbde1461cb4f0209af977471578aa9b8333';
COMMENT ON TABLE kcml."semantic_action_plan" IS 'SSOT_CURRENT.md chapter 25 entity semantic_action_plan; contract sha256 3a054b5fc3abd8088b943d7c791ed33f72ac89adeac1754b2d08623dfa865c57';
COMMENT ON TABLE kcml."value_derivation" IS 'SSOT_CURRENT.md chapter 25 entity value_derivation; contract sha256 bc794cc8d42b3bc45be4a05c4beb380daa9223ffd09e543e6779cdd3d904a493';
COMMENT ON TABLE kcml."secret_use_context" IS 'SSOT_CURRENT.md chapter 25 entity secret_use_context; contract sha256 9ac19d4a13feb0f1d4b8ad719363733ef536fa1e270b2d605d34c550a62b53ab';
COMMENT ON TABLE kcml."agentic_security_event" IS 'SSOT_CURRENT.md chapter 25 entity agentic_security_event; contract sha256 f980c06761bf38664bd1a0d2402d1e1525ef9290fcdf8fa0a80eef54bdcdef03';
CREATE OR REPLACE FUNCTION kcml.guard_generation_phase_run() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed boolean := false;
BEGIN
  IF NEW.state_version <= OLD.state_version THEN RAISE EXCEPTION 'generation_phase_run state_version must increase' USING ERRCODE='40001'; END IF;
  IF OLD.state IN ('SUCCEEDED','FAILED','CANCELLED') THEN RAISE EXCEPTION 'generation_phase_run terminal row is immutable' USING ERRCODE='55000'; END IF;
  allowed := OLD.state = NEW.state OR
    (OLD.state = 'QUEUED' AND NEW.state IN ('RUNNING','CANCEL_REQUESTED','CANCELLED')) OR
    (OLD.state = 'RUNNING' AND NEW.state IN ('WAITING_FOR_DEPENDENCY','WAITING_FOR_OWNER','REPAIRING','SUCCEEDED','FAILED','CANCEL_REQUESTED','CANCELLED')) OR
    (OLD.state IN ('WAITING_FOR_DEPENDENCY','WAITING_FOR_OWNER') AND NEW.state IN ('RUNNING','REPAIRING','FAILED','CANCEL_REQUESTED','CANCELLED')) OR
    (OLD.state = 'REPAIRING' AND NEW.state IN ('RUNNING','SUCCEEDED','FAILED','CANCEL_REQUESTED','CANCELLED')) OR
    (OLD.state = 'CANCEL_REQUESTED' AND NEW.state IN ('FAILED','CANCELLED'));
  IF NOT allowed THEN RAISE EXCEPTION 'invalid generation_phase_run state transition % -> %', OLD.state, NEW.state USING ERRCODE='23514'; END IF;
  NEW.updated_at := clock_timestamp(); RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_generation_phase_run ON kcml.generation_phase_run;
CREATE TRIGGER guard_generation_phase_run BEFORE UPDATE ON kcml.generation_phase_run FOR EACH ROW EXECUTE FUNCTION kcml.guard_generation_phase_run();


ALTER TABLE kcml.ai_model_call DROP CONSTRAINT IF EXISTS ai_model_call_request_descriptor_fk;
ALTER TABLE kcml.ai_model_call ADD CONSTRAINT ai_model_call_request_descriptor_fk FOREIGN KEY (request_descriptor_id) REFERENCES kcml.openai_request_descriptor(id);

ALTER TABLE kcml.component DROP CONSTRAINT IF EXISTS component_active_revision_fk;
ALTER TABLE kcml.component ADD CONSTRAINT component_active_revision_fk FOREIGN KEY (active_revision_id) REFERENCES kcml.component_revision(id);
ALTER TABLE kcml.component DROP CONSTRAINT IF EXISTS component_current_release_fk;
ALTER TABLE kcml.component ADD CONSTRAINT component_current_release_fk FOREIGN KEY (current_release_id) REFERENCES kcml.component_release(id);
ALTER TABLE kcml.component DROP CONSTRAINT IF EXISTS component_binding_set_revision_fk;
ALTER TABLE kcml.component ADD CONSTRAINT component_binding_set_revision_fk FOREIGN KEY (active_binding_set_revision_id) REFERENCES kcml.binding_set_revision(id);
ALTER TABLE kcml.component_audit_stream DROP CONSTRAINT IF EXISTS component_audit_stream_component_fk;
ALTER TABLE kcml.component_audit_stream ADD CONSTRAINT component_audit_stream_component_fk FOREIGN KEY (component_id) REFERENCES kcml.component(id);
ALTER TABLE kcml.component_audit_event DROP CONSTRAINT IF EXISTS component_audit_event_stream_fk;
ALTER TABLE kcml.component_audit_event ADD CONSTRAINT component_audit_event_stream_fk FOREIGN KEY (stream_id) REFERENCES kcml.component_audit_stream(id);
ALTER TABLE kcml.runtime_instance DROP CONSTRAINT IF EXISTS runtime_instance_component_fk;
ALTER TABLE kcml.runtime_instance ADD CONSTRAINT runtime_instance_component_fk FOREIGN KEY (component_id) REFERENCES kcml.component(id);
ALTER TABLE kcml.runtime_instance DROP CONSTRAINT IF EXISTS runtime_instance_target_fk;
ALTER TABLE kcml.runtime_instance ADD CONSTRAINT runtime_instance_target_fk FOREIGN KEY (runtime_target_id) REFERENCES kcml.component_runtime_target(id);
ALTER TABLE kcml.runtime_instance DROP CONSTRAINT IF EXISTS runtime_instance_revision_fk;
ALTER TABLE kcml.runtime_instance ADD CONSTRAINT runtime_instance_revision_fk FOREIGN KEY (source_revision_id) REFERENCES kcml.component_revision(id);
ALTER TABLE kcml.runtime_instance DROP CONSTRAINT IF EXISTS runtime_instance_release_fk;
ALTER TABLE kcml.runtime_instance ADD CONSTRAINT runtime_instance_release_fk FOREIGN KEY (release_id) REFERENCES kcml.component_release(id);
ALTER TABLE kcml.mcp_call_run DROP CONSTRAINT IF EXISTS mcp_call_run_request_event_fk;
ALTER TABLE kcml.mcp_call_run ADD CONSTRAINT mcp_call_run_request_event_fk FOREIGN KEY (request_event_id) REFERENCES kcml.mcp_request_event(id);
ALTER TABLE kcml.mcp_call_run DROP CONSTRAINT IF EXISTS mcp_call_run_idempotency_fk;
ALTER TABLE kcml.mcp_call_run ADD CONSTRAINT mcp_call_run_idempotency_fk FOREIGN KEY (idempotency_record_id) REFERENCES kcml.mcp_idempotency_record(id);
ALTER TABLE kcml.mcp_call_run DROP CONSTRAINT IF EXISTS mcp_call_run_component_fk;
ALTER TABLE kcml.mcp_call_run ADD CONSTRAINT mcp_call_run_component_fk FOREIGN KEY (server_component_id) REFERENCES kcml.component(id);
ALTER TABLE kcml.mcp_call_run DROP CONSTRAINT IF EXISTS mcp_call_run_revision_fk;
ALTER TABLE kcml.mcp_call_run ADD CONSTRAINT mcp_call_run_revision_fk FOREIGN KEY (server_revision_id) REFERENCES kcml.component_revision(id);
ALTER TABLE kcml.mcp_call_run DROP CONSTRAINT IF EXISTS mcp_call_run_execution_context_fk;
ALTER TABLE kcml.mcp_call_run ADD CONSTRAINT mcp_call_run_execution_context_fk FOREIGN KEY (source_execution_context_id) REFERENCES kcml.runtime_execution_context(id);
ALTER TABLE kcml.mcp_input_exchange DROP CONSTRAINT IF EXISTS mcp_input_exchange_retry_event_fk;
ALTER TABLE kcml.mcp_input_exchange ADD CONSTRAINT mcp_input_exchange_retry_event_fk FOREIGN KEY (retry_request_event_id) REFERENCES kcml.mcp_request_event(id);
ALTER TABLE kcml.mcp_task DROP CONSTRAINT IF EXISTS mcp_task_component_fk;
ALTER TABLE kcml.mcp_task ADD CONSTRAINT mcp_task_component_fk FOREIGN KEY (server_component_id) REFERENCES kcml.component(id);
ALTER TABLE kcml.mcp_task DROP CONSTRAINT IF EXISTS mcp_task_revision_fk;
ALTER TABLE kcml.mcp_task ADD CONSTRAINT mcp_task_revision_fk FOREIGN KEY (server_revision_id) REFERENCES kcml.component_revision(id);
ALTER TABLE kcml.mcp_task DROP CONSTRAINT IF EXISTS mcp_task_execution_context_fk;
ALTER TABLE kcml.mcp_task ADD CONSTRAINT mcp_task_execution_context_fk FOREIGN KEY (source_execution_context_id) REFERENCES kcml.runtime_execution_context(id);
ALTER TABLE kcml.agent_session_compaction DROP CONSTRAINT IF EXISTS agent_session_compaction_session_fk;
ALTER TABLE kcml.agent_session_compaction ADD CONSTRAINT agent_session_compaction_session_fk FOREIGN KEY (session_id) REFERENCES kcml.agent_session(id);
ALTER TABLE kcml.agent_definition DROP CONSTRAINT IF EXISTS agent_definition_active_revision_fk;
ALTER TABLE kcml.agent_definition ADD CONSTRAINT agent_definition_active_revision_fk FOREIGN KEY (active_revision_id) REFERENCES kcml.agent_revision(id);
ALTER TABLE kcml.agent_session DROP CONSTRAINT IF EXISTS agent_session_active_compaction_fk;
ALTER TABLE kcml.agent_session ADD CONSTRAINT agent_session_active_compaction_fk FOREIGN KEY (active_compaction_id) REFERENCES kcml.agent_session_compaction(id);
ALTER TABLE kcml.agent_run DROP CONSTRAINT IF EXISTS agent_run_definition_fk;
ALTER TABLE kcml.agent_run ADD CONSTRAINT agent_run_definition_fk FOREIGN KEY (agent_definition_id) REFERENCES kcml.agent_definition(id);
ALTER TABLE kcml.agent_run DROP CONSTRAINT IF EXISTS agent_run_revision_fk;
ALTER TABLE kcml.agent_run ADD CONSTRAINT agent_run_revision_fk FOREIGN KEY (agent_revision_id) REFERENCES kcml.agent_revision(id);
ALTER TABLE kcml.agent_run DROP CONSTRAINT IF EXISTS agent_run_execution_context_fk;
ALTER TABLE kcml.agent_run ADD CONSTRAINT agent_run_execution_context_fk FOREIGN KEY (source_execution_context_id) REFERENCES kcml.runtime_execution_context(id);
ALTER TABLE kcml.agent_run DROP CONSTRAINT IF EXISTS agent_run_trigger_fk;
ALTER TABLE kcml.agent_run ADD CONSTRAINT agent_run_trigger_fk FOREIGN KEY (trigger_id) REFERENCES kcml.agent_trigger(id);
ALTER TABLE kcml.agent_run DROP CONSTRAINT IF EXISTS agent_run_session_fk;
ALTER TABLE kcml.agent_run ADD CONSTRAINT agent_run_session_fk FOREIGN KEY (session_id) REFERENCES kcml.agent_session(id);
ALTER TABLE kcml.agent_run DROP CONSTRAINT IF EXISTS agent_run_checkpoint_fk;
ALTER TABLE kcml.agent_run ADD CONSTRAINT agent_run_checkpoint_fk FOREIGN KEY (latest_checkpoint_id) REFERENCES kcml.agent_run_checkpoint(id);
ALTER TABLE kcml.system_chat_conversation DROP CONSTRAINT IF EXISTS system_chat_conversation_agent_fk;
ALTER TABLE kcml.system_chat_conversation ADD CONSTRAINT system_chat_conversation_agent_fk FOREIGN KEY (agent_definition_id) REFERENCES kcml.agent_definition(id);
ALTER TABLE kcml.system_chat_conversation DROP CONSTRAINT IF EXISTS system_chat_conversation_session_fk;
ALTER TABLE kcml.system_chat_conversation ADD CONSTRAINT system_chat_conversation_session_fk FOREIGN KEY (agent_session_id) REFERENCES kcml.agent_session(id);
ALTER TABLE kcml.system_chat_message DROP CONSTRAINT IF EXISTS system_chat_message_model_call_fk;
ALTER TABLE kcml.system_chat_message ADD CONSTRAINT system_chat_message_model_call_fk FOREIGN KEY (model_call_id) REFERENCES kcml.ai_model_call(id);
ALTER TABLE kcml.deployment_step DROP CONSTRAINT IF EXISTS deployment_step_run_fk;
ALTER TABLE kcml.deployment_step ADD CONSTRAINT deployment_step_run_fk FOREIGN KEY (deployment_run_id) REFERENCES kcml.deployment_run(id);
ALTER TABLE kcml.deployment_step DROP CONSTRAINT IF EXISTS deployment_step_side_effect_fk;
ALTER TABLE kcml.deployment_step ADD CONSTRAINT deployment_step_side_effect_fk FOREIGN KEY (side_effect_operation_id) REFERENCES kcml.side_effect_operation(id);
ALTER TABLE kcml.operational_setting_applied DROP CONSTRAINT IF EXISTS operational_setting_applied_setting_fk;
ALTER TABLE kcml.operational_setting_applied ADD CONSTRAINT operational_setting_applied_setting_fk FOREIGN KEY (operational_setting_id) REFERENCES kcml.operational_setting(id);
ALTER TABLE kcml.operational_setting_applied DROP CONSTRAINT IF EXISTS operational_setting_applied_run_fk;
ALTER TABLE kcml.operational_setting_applied ADD CONSTRAINT operational_setting_applied_run_fk FOREIGN KEY (configuration_apply_run_id) REFERENCES kcml.configuration_apply_run(id);
ALTER TABLE kcml.activation_domain_barrier DROP CONSTRAINT IF EXISTS activation_domain_barrier_set_fk;
ALTER TABLE kcml.activation_domain_barrier ADD CONSTRAINT activation_domain_barrier_set_fk FOREIGN KEY (activation_set_id) REFERENCES kcml.generation_activation_set(id);
ALTER TABLE kcml.authority_lineage DROP CONSTRAINT IF EXISTS authority_lineage_creator_context_fk;
ALTER TABLE kcml.authority_lineage ADD CONSTRAINT authority_lineage_creator_context_fk FOREIGN KEY (creator_execution_context_id) REFERENCES kcml.runtime_execution_context(id);
ALTER TABLE kcml.operation_context DROP CONSTRAINT IF EXISTS operation_context_intent_fk;
ALTER TABLE kcml.operation_context ADD CONSTRAINT operation_context_intent_fk FOREIGN KEY (operation_intent_id) REFERENCES kcml.operation_intent(id);
ALTER TABLE kcml.semantic_action_plan DROP CONSTRAINT IF EXISTS semantic_action_plan_model_call_fk;
ALTER TABLE kcml.semantic_action_plan ADD CONSTRAINT semantic_action_plan_model_call_fk FOREIGN KEY (producing_model_call_id) REFERENCES kcml.ai_model_call(id);
ALTER TABLE kcml.semantic_action_plan DROP CONSTRAINT IF EXISTS semantic_action_plan_output_item_fk;
ALTER TABLE kcml.semantic_action_plan ADD CONSTRAINT semantic_action_plan_output_item_fk FOREIGN KEY (producing_output_item_id) REFERENCES kcml.ai_model_output_item(id);
ALTER TABLE kcml.value_derivation DROP CONSTRAINT IF EXISTS value_derivation_plan_fk;
ALTER TABLE kcml.value_derivation ADD CONSTRAINT value_derivation_plan_fk FOREIGN KEY (semantic_action_plan_id) REFERENCES kcml.semantic_action_plan(id);
ALTER TABLE kcml.secret_use_context DROP CONSTRAINT IF EXISTS secret_use_context_plan_fk;
ALTER TABLE kcml.secret_use_context ADD CONSTRAINT secret_use_context_plan_fk FOREIGN KEY (semantic_action_plan_id) REFERENCES kcml.semantic_action_plan(id);
ALTER TABLE kcml.agentic_security_event DROP CONSTRAINT IF EXISTS agentic_security_event_context_fk;
ALTER TABLE kcml.agentic_security_event ADD CONSTRAINT agentic_security_event_context_fk FOREIGN KEY (operation_context_id) REFERENCES kcml.operation_context(id);
ALTER TABLE kcml.agentic_security_event DROP CONSTRAINT IF EXISTS agentic_security_event_lineage_fk;
ALTER TABLE kcml.agentic_security_event ADD CONSTRAINT agentic_security_event_lineage_fk FOREIGN KEY (authority_lineage_id) REFERENCES kcml.authority_lineage(id);
ALTER TABLE kcml.agentic_security_event DROP CONSTRAINT IF EXISTS agentic_security_event_provenance_fk;
ALTER TABLE kcml.agentic_security_event ADD CONSTRAINT agentic_security_event_provenance_fk FOREIGN KEY (content_provenance_id) REFERENCES kcml.content_provenance(id);
ALTER TABLE kcml.agentic_security_event DROP CONSTRAINT IF EXISTS agentic_security_event_plan_fk;
ALTER TABLE kcml.agentic_security_event ADD CONSTRAINT agentic_security_event_plan_fk FOREIGN KEY (semantic_action_plan_id) REFERENCES kcml.semantic_action_plan(id);
ALTER TABLE kcml.browser_host_slot DROP CONSTRAINT IF EXISTS browser_host_slot_process_identity_fk;
ALTER TABLE kcml.browser_host_slot ADD CONSTRAINT browser_host_slot_process_identity_fk FOREIGN KEY (process_identity_id) REFERENCES kcml.runtime_process_identity(id);
ALTER TABLE kcml.browser_context_instance DROP CONSTRAINT IF EXISTS browser_context_bridge_fk;
ALTER TABLE kcml.browser_context_instance ADD CONSTRAINT browser_context_bridge_fk FOREIGN KEY (bridge_id) REFERENCES kcml.browser_local_bridge(id);
ALTER TABLE kcml.browser_context_instance DROP CONSTRAINT IF EXISTS browser_context_account_fk;
ALTER TABLE kcml.browser_context_instance ADD CONSTRAINT browser_context_account_fk FOREIGN KEY (account_binding_id) REFERENCES kcml.browser_account_binding(id);
ALTER TABLE kcml.browser_context_instance DROP CONSTRAINT IF EXISTS browser_context_bundle_fk;
ALTER TABLE kcml.browser_context_instance ADD CONSTRAINT browser_context_bundle_fk FOREIGN KEY (restored_bundle_version_id) REFERENCES kcml.browser_state_bundle(id);
ALTER TABLE kcml.browser_page DROP CONSTRAINT IF EXISTS browser_page_current_document_fk;
ALTER TABLE kcml.browser_page ADD CONSTRAINT browser_page_current_document_fk FOREIGN KEY (current_document_id) REFERENCES kcml.browser_document(id);
ALTER TABLE kcml.browser_page DROP CONSTRAINT IF EXISTS browser_page_top_frame_fk;
ALTER TABLE kcml.browser_page ADD CONSTRAINT browser_page_top_frame_fk FOREIGN KEY (top_frame_id) REFERENCES kcml.browser_frame(id);
ALTER TABLE kcml.browser_page DROP CONSTRAINT IF EXISTS browser_page_creation_action_fk;
ALTER TABLE kcml.browser_page ADD CONSTRAINT browser_page_creation_action_fk FOREIGN KEY (creation_action_id) REFERENCES kcml.browser_action_run(id);
ALTER TABLE kcml.browser_frame DROP CONSTRAINT IF EXISTS browser_frame_current_document_fk;
ALTER TABLE kcml.browser_frame ADD CONSTRAINT browser_frame_current_document_fk FOREIGN KEY (current_document_id) REFERENCES kcml.browser_document(id);
ALTER TABLE kcml.browser_document DROP CONSTRAINT IF EXISTS browser_document_initial_observation_fk;
ALTER TABLE kcml.browser_document ADD CONSTRAINT browser_document_initial_observation_fk FOREIGN KEY (initial_observation_id) REFERENCES kcml.browser_observation(id);
ALTER TABLE kcml.browser_document DROP CONSTRAINT IF EXISTS browser_document_last_observation_fk;
ALTER TABLE kcml.browser_document ADD CONSTRAINT browser_document_last_observation_fk FOREIGN KEY (last_observation_id) REFERENCES kcml.browser_observation(id);
ALTER TABLE kcml.browser_navigation DROP CONSTRAINT IF EXISTS browser_navigation_document_fk;
ALTER TABLE kcml.browser_navigation ADD CONSTRAINT browser_navigation_document_fk FOREIGN KEY (document_id) REFERENCES kcml.browser_document(id);
ALTER TABLE kcml.browser_navigation DROP CONSTRAINT IF EXISTS browser_navigation_action_fk;
ALTER TABLE kcml.browser_navigation ADD CONSTRAINT browser_navigation_action_fk FOREIGN KEY (causation_action_id) REFERENCES kcml.browser_action_run(id);
ALTER TABLE kcml.browser_navigation DROP CONSTRAINT IF EXISTS browser_navigation_input_event_fk;
ALTER TABLE kcml.browser_navigation ADD CONSTRAINT browser_navigation_input_event_fk FOREIGN KEY (causation_input_event_id) REFERENCES kcml.browser_input_event(id);
ALTER TABLE kcml.browser_control_transfer DROP CONSTRAINT IF EXISTS browser_control_transfer_action_fk;
ALTER TABLE kcml.browser_control_transfer ADD CONSTRAINT browser_control_transfer_action_fk FOREIGN KEY (current_action_id) REFERENCES kcml.browser_action_run(id);
ALTER TABLE kcml.browser_input_event DROP CONSTRAINT IF EXISTS browser_input_event_action_fk;
ALTER TABLE kcml.browser_input_event ADD CONSTRAINT browser_input_event_action_fk FOREIGN KEY (resulting_action_id) REFERENCES kcml.browser_action_run(id);
ALTER TABLE kcml.browser_irreversible_confirmation DROP CONSTRAINT IF EXISTS browser_confirmation_action_fk;
ALTER TABLE kcml.browser_irreversible_confirmation ADD CONSTRAINT browser_confirmation_action_fk FOREIGN KEY (action_run_id) REFERENCES kcml.browser_action_run(id);
ALTER TABLE kcml.browser_irreversible_confirmation DROP CONSTRAINT IF EXISTS browser_confirmation_automation_run_fk;
ALTER TABLE kcml.browser_irreversible_confirmation ADD CONSTRAINT browser_confirmation_automation_run_fk FOREIGN KEY (automation_run_id) REFERENCES kcml.browser_automation_run(id);
ALTER TABLE kcml.browser_auth_attempt DROP CONSTRAINT IF EXISTS browser_auth_attempt_account_fk;
ALTER TABLE kcml.browser_auth_attempt ADD CONSTRAINT browser_auth_attempt_account_fk FOREIGN KEY (account_binding_id) REFERENCES kcml.browser_account_binding(id);
ALTER TABLE kcml.browser_auth_attempt DROP CONSTRAINT IF EXISTS browser_auth_attempt_challenge_fk;
ALTER TABLE kcml.browser_auth_attempt ADD CONSTRAINT browser_auth_attempt_challenge_fk FOREIGN KEY (challenge_id) REFERENCES kcml.browser_challenge(id);
ALTER TABLE kcml.browser_auth_attempt DROP CONSTRAINT IF EXISTS browser_auth_attempt_side_effect_fk;
ALTER TABLE kcml.browser_auth_attempt ADD CONSTRAINT browser_auth_attempt_side_effect_fk FOREIGN KEY (side_effect_operation_id) REFERENCES kcml.side_effect_operation(id);
ALTER TABLE kcml.browser_bridge_assignment DROP CONSTRAINT IF EXISTS browser_bridge_assignment_scope_fk;
ALTER TABLE kcml.browser_bridge_assignment ADD CONSTRAINT browser_bridge_assignment_scope_fk FOREIGN KEY (operation_scope_id) REFERENCES kcml.browser_operation_scope(id);
ALTER TABLE kcml.browser_bridge_assignment DROP CONSTRAINT IF EXISTS browser_bridge_assignment_account_fk;
ALTER TABLE kcml.browser_bridge_assignment ADD CONSTRAINT browser_bridge_assignment_account_fk FOREIGN KEY (account_binding_id) REFERENCES kcml.browser_account_binding(id);
ALTER TABLE kcml.browser_profile_lease DROP CONSTRAINT IF EXISTS browser_profile_lease_bridge_fk;
ALTER TABLE kcml.browser_profile_lease ADD CONSTRAINT browser_profile_lease_bridge_fk FOREIGN KEY (bridge_id) REFERENCES kcml.browser_local_bridge(id);
ALTER TABLE kcml.browser_profile_lease DROP CONSTRAINT IF EXISTS browser_profile_lease_account_fk;
ALTER TABLE kcml.browser_profile_lease ADD CONSTRAINT browser_profile_lease_account_fk FOREIGN KEY (account_binding_id) REFERENCES kcml.browser_account_binding(id);
ALTER TABLE kcml.browser_dialog DROP CONSTRAINT IF EXISTS browser_dialog_challenge_fk;
ALTER TABLE kcml.browser_dialog ADD CONSTRAINT browser_dialog_challenge_fk FOREIGN KEY (challenge_id) REFERENCES kcml.browser_challenge(id);
ALTER TABLE kcml.browser_permission_request DROP CONSTRAINT IF EXISTS browser_permission_context_fk;
ALTER TABLE kcml.browser_permission_request ADD CONSTRAINT browser_permission_context_fk FOREIGN KEY (context_instance_id) REFERENCES kcml.browser_context_instance(id);
ALTER TABLE kcml.browser_permission_request DROP CONSTRAINT IF EXISTS browser_permission_challenge_fk;
ALTER TABLE kcml.browser_permission_request ADD CONSTRAINT browser_permission_challenge_fk FOREIGN KEY (challenge_id) REFERENCES kcml.browser_challenge(id);
ALTER TABLE kcml.browser_teaching_run DROP CONSTRAINT IF EXISTS browser_teaching_scope_fk;
ALTER TABLE kcml.browser_teaching_run ADD CONSTRAINT browser_teaching_scope_fk FOREIGN KEY (operation_scope_id) REFERENCES kcml.browser_operation_scope(id);
ALTER TABLE kcml.browser_teaching_run DROP CONSTRAINT IF EXISTS browser_teaching_candidate_revision_fk;
ALTER TABLE kcml.browser_teaching_run ADD CONSTRAINT browser_teaching_candidate_revision_fk FOREIGN KEY (candidate_automation_revision_id) REFERENCES kcml.browser_automation_revision(id);
ALTER TABLE kcml.browser_automation_definition DROP CONSTRAINT IF EXISTS browser_automation_owner_component_fk;
ALTER TABLE kcml.browser_automation_definition ADD CONSTRAINT browser_automation_owner_component_fk FOREIGN KEY (owner_component_id) REFERENCES kcml.component(id);
ALTER TABLE kcml.browser_automation_definition DROP CONSTRAINT IF EXISTS browser_automation_active_revision_fk;
ALTER TABLE kcml.browser_automation_definition ADD CONSTRAINT browser_automation_active_revision_fk FOREIGN KEY (active_revision_id) REFERENCES kcml.browser_automation_revision(id);
ALTER TABLE kcml.browser_automation_run DROP CONSTRAINT IF EXISTS browser_automation_run_scope_fk;
ALTER TABLE kcml.browser_automation_run ADD CONSTRAINT browser_automation_run_scope_fk FOREIGN KEY (operation_scope_id) REFERENCES kcml.browser_operation_scope(id);
ALTER TABLE kcml.browser_automation_run DROP CONSTRAINT IF EXISTS browser_automation_run_account_fk;
ALTER TABLE kcml.browser_automation_run ADD CONSTRAINT browser_automation_run_account_fk FOREIGN KEY (account_binding_id) REFERENCES kcml.browser_account_binding(id);
ALTER TABLE kcml.browser_automation_artifact DROP CONSTRAINT IF EXISTS browser_automation_artifact_run_fk;
ALTER TABLE kcml.browser_automation_artifact ADD CONSTRAINT browser_automation_artifact_run_fk FOREIGN KEY (automation_run_id) REFERENCES kcml.browser_automation_run(id);
ALTER TABLE kcml.browser_automation_artifact DROP CONSTRAINT IF EXISTS browser_automation_artifact_action_fk;
ALTER TABLE kcml.browser_automation_artifact ADD CONSTRAINT browser_automation_artifact_action_fk FOREIGN KEY (action_run_id) REFERENCES kcml.browser_action_run(id);
ALTER TABLE kcml.browser_auth_binding DROP CONSTRAINT IF EXISTS browser_auth_binding_account_fk;
ALTER TABLE kcml.browser_auth_binding ADD CONSTRAINT browser_auth_binding_account_fk FOREIGN KEY (account_binding_id) REFERENCES kcml.browser_account_binding(id);
ALTER TABLE kcml.browser_challenge DROP CONSTRAINT IF EXISTS browser_challenge_run_fk;
ALTER TABLE kcml.browser_challenge ADD CONSTRAINT browser_challenge_run_fk FOREIGN KEY (automation_run_id) REFERENCES kcml.browser_automation_run(id);
ALTER TABLE kcml.browser_challenge DROP CONSTRAINT IF EXISTS browser_challenge_account_fk;
ALTER TABLE kcml.browser_challenge ADD CONSTRAINT browser_challenge_account_fk FOREIGN KEY (account_binding_id) REFERENCES kcml.browser_account_binding(id);

CREATE OR REPLACE FUNCTION kcml.current_database_start_identity() RETURNS bytea LANGUAGE sql STABLE STRICT AS $$
  SELECT digest(control.system_identifier::text || ':' || pg_postmaster_start_time()::text, 'sha256')
  FROM pg_control_system() AS control
$$;
CREATE TABLE IF NOT EXISTS kcml.platform_recovery_head (
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
);
INSERT INTO kcml.platform_recovery_head(singleton_key,database_start_identity,platform_incarnation_id,application_deployment_epoch,recovery_epoch,state,ready_evidence_digest)
  SELECT 1,kcml.current_database_start_identity(),p.platform_incarnation_id,d.current_epoch,1,'READY',
    digest('GREENFIELD_EMPTY_INVENTORY' || encode(kcml.current_database_start_identity(),'hex') || p.platform_incarnation_id::text || d.current_epoch::text,'sha256')
  FROM kcml.platform_incarnation p CROSS JOIN kcml.application_deployment_head d
  WHERE p.singleton_key=1 AND d.singleton_key=1
  ON CONFLICT(singleton_key) DO NOTHING;
DROP TRIGGER IF EXISTS protect_singleton ON kcml.platform_recovery_head;
CREATE TRIGGER protect_singleton BEFORE UPDATE OR DELETE ON kcml.platform_recovery_head FOR EACH ROW EXECUTE FUNCTION kcml.protect_singleton();
ALTER TABLE kcml.domain_command ADD COLUMN IF NOT EXISTS recovery_epoch bigint NOT NULL DEFAULT 1 CHECK (recovery_epoch > 0);
ALTER TABLE kcml.queue_item ADD COLUMN IF NOT EXISTS recovery_epoch bigint NOT NULL DEFAULT 1 CHECK (recovery_epoch > 0);
ALTER TABLE kcml.side_effect_operation ADD COLUMN IF NOT EXISTS recovery_epoch bigint NOT NULL DEFAULT 1 CHECK (recovery_epoch > 0);
ALTER TABLE kcml.concurrency_claim ADD COLUMN IF NOT EXISTS recovery_epoch bigint NOT NULL DEFAULT 1 CHECK (recovery_epoch > 0);
ALTER TABLE kcml.transactional_outbox ADD COLUMN IF NOT EXISTS recovery_epoch bigint NOT NULL DEFAULT 1 CHECK (recovery_epoch > 0);
ALTER TABLE kcml.domain_command DROP CONSTRAINT IF EXISTS domain_command_concurrency_claim_fk;
ALTER TABLE kcml.domain_command ADD CONSTRAINT domain_command_concurrency_claim_fk FOREIGN KEY (concurrency_claim_id) REFERENCES kcml.concurrency_claim(id);
ALTER TABLE kcml.queue_item DROP CONSTRAINT IF EXISTS queue_item_concurrency_claim_fk;
ALTER TABLE kcml.queue_item ADD CONSTRAINT queue_item_concurrency_claim_fk FOREIGN KEY (concurrency_claim_id) REFERENCES kcml.concurrency_claim(id);

CREATE TABLE IF NOT EXISTS kcml.domain_command_execution_checkpoint (
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
);
DROP TRIGGER IF EXISTS immutable_row ON kcml.domain_command_execution_checkpoint;
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml.domain_command_execution_checkpoint FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml.platform_recovery_attempt (
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
);
CREATE TABLE IF NOT EXISTS kcml.platform_recovery_item (
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
);
DROP TRIGGER IF EXISTS immutable_row ON kcml.platform_recovery_item;
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml.platform_recovery_item FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();
ALTER TABLE kcml.platform_recovery_head DROP CONSTRAINT IF EXISTS platform_recovery_head_attempt_fk;
ALTER TABLE kcml.platform_recovery_head ADD CONSTRAINT platform_recovery_head_attempt_fk FOREIGN KEY (current_attempt_id) REFERENCES kcml.platform_recovery_attempt(id);
CREATE OR REPLACE FUNCTION kcml.guard_platform_recovery_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'platform recovery attempt deletion is forbidden' USING ERRCODE='55000'; END IF;
  IF OLD.finished_at IS NOT NULL THEN RAISE EXCEPTION 'finished platform recovery attempt is immutable' USING ERRCODE='55000'; END IF;
  IF NEW.state_version<=OLD.state_version OR NEW.lease_fencing_token<OLD.lease_fencing_token OR NEW.recovery_epoch<>OLD.recovery_epoch THEN RAISE EXCEPTION 'platform recovery attempt version or fence is stale' USING ERRCODE='40001'; END IF;
  IF NOT (NEW.state=OLD.state OR (OLD.state='STARTING' AND NEW.state='RECONCILING') OR (OLD.state='RECONCILING' AND NEW.state IN ('READY','BLOCKED','MANUAL_REVIEW'))) THEN RAISE EXCEPTION 'invalid platform recovery attempt transition % -> %',OLD.state,NEW.state USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_lifecycle ON kcml.platform_recovery_attempt;
CREATE TRIGGER guard_lifecycle BEFORE UPDATE OR DELETE ON kcml.platform_recovery_attempt FOR EACH ROW EXECUTE FUNCTION kcml.guard_platform_recovery_attempt();
CREATE OR REPLACE FUNCTION kcml.guard_platform_recovery_head() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'platform recovery head deletion is forbidden' USING ERRCODE='55000'; END IF;
  IF NEW.state_version<=OLD.state_version OR NEW.recovery_epoch<OLD.recovery_epoch OR NEW.current_fencing_token<OLD.current_fencing_token THEN RAISE EXCEPTION 'platform recovery head version, epoch or fence is stale' USING ERRCODE='40001'; END IF;
  IF NEW.recovery_epoch>OLD.recovery_epoch THEN
    IF NEW.recovery_epoch<>OLD.recovery_epoch+1 OR NEW.state<>'STARTING' OR NEW.current_attempt_id IS NULL THEN RAISE EXCEPTION 'new recovery epoch must begin at STARTING with exact successor epoch and attempt' USING ERRCODE='23514'; END IF;
  ELSIF NOT (NEW.state=OLD.state OR (OLD.state='STARTING' AND NEW.state='RECONCILING') OR (OLD.state='RECONCILING' AND NEW.state IN ('READY','BLOCKED','MANUAL_REVIEW')) OR (OLD.state IN ('BLOCKED','MANUAL_REVIEW') AND NEW.state='RECONCILING') OR (OLD.state='READY' AND NEW.state='STARTING')) THEN
    RAISE EXCEPTION 'invalid platform recovery head transition % -> %',OLD.state,NEW.state USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_lifecycle ON kcml.platform_recovery_head;
CREATE TRIGGER guard_lifecycle BEFORE UPDATE OR DELETE ON kcml.platform_recovery_head FOR EACH ROW EXECUTE FUNCTION kcml.guard_platform_recovery_head();

CREATE TABLE IF NOT EXISTS kcml.capacity_reservation (
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
);
CREATE UNIQUE INDEX IF NOT EXISTS capacity_reservation_active_uq ON kcml.capacity_reservation(capacity_kind,reservation_key) WHERE released_at IS NULL;
CREATE OR REPLACE FUNCTION kcml.guard_capacity_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'capacity reservation deletion is forbidden' USING ERRCODE='55000'; END IF;
  IF NEW.state_version<=OLD.state_version OR NEW.fencing_token<>OLD.fencing_token OR NEW.recovery_epoch<>OLD.recovery_epoch OR NEW.reserved_units<>OLD.reserved_units THEN RAISE EXCEPTION 'capacity reservation authority is immutable or stale' USING ERRCODE='40001'; END IF;
  IF OLD.released_at IS NOT NULL THEN RAISE EXCEPTION 'released capacity reservation is immutable' USING ERRCODE='55000'; END IF;
  IF NEW.released_at IS NULL OR NEW.release_evidence_digest IS NULL THEN RAISE EXCEPTION 'capacity release requires timestamp and evidence digest' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_lifecycle ON kcml.capacity_reservation;
CREATE TRIGGER guard_lifecycle BEFORE UPDATE OR DELETE ON kcml.capacity_reservation FOR EACH ROW EXECUTE FUNCTION kcml.guard_capacity_reservation();
CREATE TABLE IF NOT EXISTS kcml.artifact_publication (
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
);
CREATE TABLE IF NOT EXISTS kcml.artifact_current_pointer (
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
);
CREATE OR REPLACE FUNCTION kcml.guard_artifact_publication() RETURNS trigger LANGUAGE plpgsql AS $$
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
END $$;
DROP TRIGGER IF EXISTS guard_lifecycle ON kcml.artifact_publication;
CREATE TRIGGER guard_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON kcml.artifact_publication FOR EACH ROW EXECUTE FUNCTION kcml.guard_artifact_publication();

CREATE TABLE IF NOT EXISTS kcml.terminal_closure_evidence (
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
);
DROP TRIGGER IF EXISTS immutable_row ON kcml.terminal_closure_evidence;
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml.terminal_closure_evidence FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();
CREATE INDEX IF NOT EXISTS terminal_closure_evidence_root_idx ON kcml.terminal_closure_evidence(terminal_root_kind,terminal_root_id,terminal_state_version DESC);
CREATE OR REPLACE FUNCTION kcml.guard_component_terminal_closure() RETURNS trigger LANGUAGE plpgsql AS $$
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
END $$;
DROP TRIGGER IF EXISTS guard_component_terminal_closure ON kcml.component;
CREATE CONSTRAINT TRIGGER guard_component_terminal_closure AFTER INSERT OR UPDATE ON kcml.component DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION kcml.guard_component_terminal_closure();
CREATE OR REPLACE FUNCTION kcml.guard_component_terminal_child() RETURNS trigger LANGUAGE plpgsql AS $$
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
END $$;
DROP TRIGGER IF EXISTS guard_component_terminal_child ON kcml.runtime_instance;
CREATE TRIGGER guard_component_terminal_child BEFORE INSERT OR UPDATE ON kcml.runtime_instance FOR EACH ROW EXECUTE FUNCTION kcml.guard_component_terminal_child();
DROP TRIGGER IF EXISTS guard_component_terminal_child ON kcml.component_contract_binding;
CREATE TRIGGER guard_component_terminal_child BEFORE INSERT OR UPDATE ON kcml.component_contract_binding FOR EACH ROW EXECUTE FUNCTION kcml.guard_component_terminal_child();
DROP TRIGGER IF EXISTS guard_component_terminal_child ON kcml.domain_command;
CREATE TRIGGER guard_component_terminal_child BEFORE INSERT OR UPDATE ON kcml.domain_command FOR EACH ROW EXECUTE FUNCTION kcml.guard_component_terminal_child();

ALTER TABLE kcml.component ALTER COLUMN lifecycle SET DEFAULT 'DRAFT';
ALTER TABLE kcml.component DROP CONSTRAINT IF EXISTS component_lifecycle_domain_ck;
ALTER TABLE kcml.component ADD CONSTRAINT component_lifecycle_domain_ck CHECK (lifecycle IN ('DRAFT','REVIEW','APPROVED','ACTIVE','SUSPENDED','QUARANTINED','RETIRED','DEREGISTERED'));
ALTER TABLE kcml.component DROP CONSTRAINT IF EXISTS component_activation_domain_ck;
ALTER TABLE kcml.component ADD CONSTRAINT component_activation_domain_ck CHECK (activation_state IN ('INACTIVE','READY','READY_FOR_ACTIVATION','ACTIVE','BLOCKED','ENABLE_REQUESTED','DISABLE_REQUESTED','DISABLE_UNCONFIRMED'));
ALTER TABLE kcml.component DROP CONSTRAINT IF EXISTS component_operational_domain_ck;
ALTER TABLE kcml.component ADD CONSTRAINT component_operational_domain_ck CHECK (operational_state IN ('UNKNOWN','DISABLED','HEALTHY','DEGRADED','UNHEALTHY','MAINTENANCE','QUARANTINED','RETIRED'));
ALTER TABLE kcml.component DROP CONSTRAINT IF EXISTS component_monitoring_domain_ck;
ALTER TABLE kcml.component ADD CONSTRAINT component_monitoring_domain_ck CHECK (monitoring_state IN ('NOT_CONFIGURED','PENDING','HEALTHY','DEGRADED','FAILED'));
ALTER TABLE kcml.component DROP CONSTRAINT IF EXISTS component_recertification_domain_ck;
ALTER TABLE kcml.component ADD CONSTRAINT component_recertification_domain_ck CHECK (recertification_state IN ('NOT_DUE','DUE','OVERDUE','IN_REVIEW','PASSED','FAILED'));
ALTER TABLE kcml.component DROP CONSTRAINT IF EXISTS component_active_authority_ck;
ALTER TABLE kcml.component ADD CONSTRAINT component_active_authority_ck CHECK (lifecycle <> 'ACTIVE' OR (activation_state = 'ACTIVE' AND active_revision_id IS NOT NULL AND current_release_id IS NOT NULL AND active_binding_set_revision_id IS NOT NULL AND current_activation_epoch > 0 AND enabled));
ALTER TABLE kcml.component DROP CONSTRAINT IF EXISTS component_retired_authority_ck;
ALTER TABLE kcml.component ADD CONSTRAINT component_retired_authority_ck CHECK (lifecycle NOT IN ('RETIRED','DEREGISTERED') OR (activation_state <> 'ACTIVE' AND NOT enabled));
ALTER TABLE kcml.component DROP CONSTRAINT IF EXISTS component_enabled_projection_ck;
ALTER TABLE kcml.component ADD CONSTRAINT component_enabled_projection_ck CHECK (NOT enabled OR activation_state = 'ACTIVE');
CREATE OR REPLACE FUNCTION kcml.guard_component_state_machine() RETURNS trigger LANGUAGE plpgsql AS $$
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
END $$;
DROP TRIGGER IF EXISTS guard_component_state_machine ON kcml.component;
CREATE TRIGGER guard_component_state_machine BEFORE UPDATE ON kcml.component FOR EACH ROW EXECUTE FUNCTION kcml.guard_component_state_machine();

DROP TRIGGER IF EXISTS touch_mutable_row ON kcml.mcp_request_event;
DROP TRIGGER IF EXISTS guard_mcp_request_event_lifecycle ON kcml.mcp_request_event;
CREATE TRIGGER guard_mcp_request_event_lifecycle BEFORE UPDATE OR DELETE ON kcml.mcp_request_event FOR EACH ROW EXECUTE FUNCTION kcml.guard_mcp_lifecycle('final_response_state');

DROP TRIGGER IF EXISTS touch_mutable_row ON kcml.operation_context;
DROP TRIGGER IF EXISTS guard_operation_context_lifecycle ON kcml.operation_context;
CREATE TRIGGER guard_operation_context_lifecycle BEFORE UPDATE OR DELETE ON kcml.operation_context FOR EACH ROW EXECUTE FUNCTION kcml.guard_operation_context_lifecycle();

ALTER TABLE kcml.secret_use_context ALTER COLUMN logical_operation_id SET NOT NULL;
ALTER TABLE kcml.browser_state_bundle_member DROP CONSTRAINT IF EXISTS browser_state_bundle_member_content_guard;
ALTER TABLE kcml.browser_state_bundle_member ADD CONSTRAINT browser_state_bundle_member_content_guard CHECK ((encrypted_content IS NOT NULL) <> (artifact_reference IS NOT NULL));

CREATE OR REPLACE FUNCTION kcml.guard_operational_alert_state_machine() RETURNS trigger LANGUAGE plpgsql AS $$
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
END $$;
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml.operational_alert;
DROP TRIGGER IF EXISTS guard_operational_alert_state_machine ON kcml.operational_alert;
CREATE TRIGGER guard_operational_alert_state_machine BEFORE UPDATE OR DELETE ON kcml.operational_alert FOR EACH ROW EXECUTE FUNCTION kcml.guard_operational_alert_state_machine();

COMMIT;
