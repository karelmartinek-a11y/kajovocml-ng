BEGIN;

-- AUTO-GENERATED provisional Chapter-25 name surface.
-- These generic tables are incomplete until each entity has its exact SSOT schema and verified invariants.
-- SSOT surface fingerprint: d1e1020ff347a9aea8bcf21f4443759b2ae165757b7a53112a2d9f6e0c9c4eb7

CREATE TABLE IF NOT EXISTS kcml."component" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."component" IS 'SSOT_CURRENT.md chapter 25 entity component; contract sha256 384f38971ccbda3155fff0dc9b3eedea0ab0474092944a23858074b39ae2dec7';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."component";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."component" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."component_revision" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."component_revision" IS 'SSOT_CURRENT.md chapter 25 entity component_revision; contract sha256 d9cd12ffbb61af96b00aa6b76c257f88ca5dde1b56ce96180b16bd2eda05d661';
DROP TRIGGER IF EXISTS immutable_row ON kcml."component_revision";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."component_revision" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."component_tool_contract" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."component_tool_contract" IS 'SSOT_CURRENT.md chapter 25 entity component_tool_contract; contract sha256 4b8ef4561ccb88f6eaa9bcd3b701f4a74ad9deac7331ae948c618ea9b01b6bd8';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."component_tool_contract";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."component_tool_contract" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."component_resource_contract" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."component_resource_contract" IS 'SSOT_CURRENT.md chapter 25 entity component_resource_contract; contract sha256 a4f6769f249d7a9670cfbfa035ea18c40f3e3c7b5dad44549257eacce64a4467';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."component_resource_contract";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."component_resource_contract" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."component_prompt_contract" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."component_prompt_contract" IS 'SSOT_CURRENT.md chapter 25 entity component_prompt_contract; contract sha256 a533854a025952e3381016de98835981f16a10d27edcd127dd2b6b2282a8866f';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."component_prompt_contract";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."component_prompt_contract" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."component_endpoint_contract" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."component_endpoint_contract" IS 'SSOT_CURRENT.md chapter 25 entity component_endpoint_contract; contract sha256 d82ef64a692d386a1d8be5095dd75d1467fdac604268971af66a7a6789791482';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."component_endpoint_contract";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."component_endpoint_contract" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."component_pulse_contract" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."component_pulse_contract" IS 'SSOT_CURRENT.md chapter 25 entity component_pulse_contract; contract sha256 e8ad3aa8670870d69f16faeb2291cc9f5d76803417c2a8c7168d9508906c04dc';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."component_pulse_contract";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."component_pulse_contract" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."component_state_contract" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."component_state_contract" IS 'SSOT_CURRENT.md chapter 25 entity component_state_contract; contract sha256 e64f6b144b05d8e4d5afac8b6f6450c1a6d15f12ad629de8e5fa1efe30b2c255';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."component_state_contract";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."component_state_contract" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."component_state_transition" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."component_state_transition" IS 'SSOT_CURRENT.md chapter 25 entity component_state_transition; contract sha256 71893302b34b5487d2903936cda1afc0501b80d6795a5bedf4ff5349231d99b1';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."component_state_transition";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."component_state_transition" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."component_runtime_target" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."component_runtime_target" IS 'SSOT_CURRENT.md chapter 25 entity component_runtime_target; contract sha256 6105997913a989391316d141ce9ca341c312b3f933939297c71e8682f1956581';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."component_runtime_target";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."component_runtime_target" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."component_contract_binding" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."component_contract_binding" IS 'SSOT_CURRENT.md chapter 25 entity component_contract_binding; contract sha256 192ecef3b97652d5724a583c84dfb60a94b321cfbe16bb3944cb683bcef5faa3';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."component_contract_binding";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."component_contract_binding" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."component_release" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."component_release" IS 'SSOT_CURRENT.md chapter 25 entity component_release; contract sha256 9c89428a76d6169596ed5a9799591bb2a2aeff0f99c7a5c0d5bae7c45bdc8981';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."component_release";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."component_release" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."component_readiness_gate" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."component_readiness_gate" IS 'SSOT_CURRENT.md chapter 25 entity component_readiness_gate; contract sha256 9f206372c2a20d7342fdd96eb7d087b39fdd45081959efece9ae63d9c1d05867';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."component_readiness_gate";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."component_readiness_gate" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."component_e2e_run" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."component_e2e_run" IS 'SSOT_CURRENT.md chapter 25 entity component_e2e_run; contract sha256 33d71c863387acc99b87d77447eec4fc1a615e9f425a821168daa9afd1c425bf';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."component_e2e_run";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."component_e2e_run" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."mcp_server_revision_profile" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."mcp_server_revision_profile" IS 'SSOT_CURRENT.md chapter 25 entity mcp_server_revision_profile; contract sha256 83da6b86fce011752e3e6c8a541c41588befafbe81655aaa230ed7c99a1ffb72';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."mcp_server_revision_profile";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."mcp_server_revision_profile" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."mcp_registration_probe" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."mcp_registration_probe" IS 'SSOT_CURRENT.md chapter 25 entity mcp_registration_probe; contract sha256 e468d094f6ac95e997588bfb5c3e127d59d52b2597fd939bda2070a6a49fe678';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."mcp_registration_probe";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."mcp_registration_probe" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."mcp_discovery_snapshot" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."mcp_discovery_snapshot" IS 'SSOT_CURRENT.md chapter 25 entity mcp_discovery_snapshot; contract sha256 c5ed4fd4b299ac1fa5f76604628fa1e2166bc97bc3d31ed61cede8b06bbf6ac9';
DROP TRIGGER IF EXISTS immutable_row ON kcml."mcp_discovery_snapshot";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."mcp_discovery_snapshot" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."mcp_discovery_item" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."mcp_discovery_item" IS 'SSOT_CURRENT.md chapter 25 entity mcp_discovery_item; contract sha256 baaa5a8daaad8061cef6b1dba53d08a68157acf0d368d6edbc606dce14a3d6ec';
DROP TRIGGER IF EXISTS immutable_row ON kcml."mcp_discovery_item";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."mcp_discovery_item" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."mcp_tool_alias" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."mcp_tool_alias" IS 'SSOT_CURRENT.md chapter 25 entity mcp_tool_alias; contract sha256 394235517224957b3c82b85f859ec881fbd44baac6268ef942a8290aeb25d9d7';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."mcp_tool_alias";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."mcp_tool_alias" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."mcp_request_event" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."mcp_request_event" IS 'SSOT_CURRENT.md chapter 25 entity mcp_request_event; contract sha256 707da407858420e716f570ce6c241c1047d1d35029416245bc02749d32684624';
DROP TRIGGER IF EXISTS immutable_row ON kcml."mcp_request_event";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."mcp_request_event" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."mcp_call_progress" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."mcp_call_progress" IS 'SSOT_CURRENT.md chapter 25 entity mcp_call_progress; contract sha256 239de41d0451ac62e44e6ac6d0a8d65e8ca8209bc83200b3629a351f755e2a76';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."mcp_call_progress";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."mcp_call_progress" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."mcp_input_request_item" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."mcp_input_request_item" IS 'SSOT_CURRENT.md chapter 25 entity mcp_input_request_item; contract sha256 2c467be26f73c761ce9573fc89be6d18acff9e60b4e431b769cf71d849378fb4';
DROP TRIGGER IF EXISTS immutable_row ON kcml."mcp_input_request_item";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."mcp_input_request_item" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."mcp_input_response_item" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."mcp_input_response_item" IS 'SSOT_CURRENT.md chapter 25 entity mcp_input_response_item; contract sha256 ee080670b8fc3637fe9fcb07cef4495beb6d8ac00f03d2ce842361af9e486b05';
DROP TRIGGER IF EXISTS immutable_row ON kcml."mcp_input_response_item";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."mcp_input_response_item" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."mcp_subscription" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."mcp_subscription" IS 'SSOT_CURRENT.md chapter 25 entity mcp_subscription; contract sha256 abc369393b7f3c909c153e5b54b2be1609927ccf7c89ea0acf72caba10630537';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."mcp_subscription";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."mcp_subscription" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."mcp_subscription_notification" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."mcp_subscription_notification" IS 'SSOT_CURRENT.md chapter 25 entity mcp_subscription_notification; contract sha256 30c85f0dfcd970145329a84fd5d94040f784dde2591c09853a730f8680dd7b7a';
DROP TRIGGER IF EXISTS immutable_row ON kcml."mcp_subscription_notification";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."mcp_subscription_notification" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."mcp_state_handle" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."mcp_state_handle" IS 'SSOT_CURRENT.md chapter 25 entity mcp_state_handle; contract sha256 b283296d265635bacdb183c8b2ffb2853ce470eaff367e1de3aa2e12f91eaa91';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."mcp_state_handle";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."mcp_state_handle" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."mcp_task_input_request" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."mcp_task_input_request" IS 'SSOT_CURRENT.md chapter 25 entity mcp_task_input_request; contract sha256 cee47e54a6a6e45b343712a3d4d173be4cfc2186d3fd4fc826a8788427c912c9';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."mcp_task_input_request";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."mcp_task_input_request" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."mcp_task_input_response" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."mcp_task_input_response" IS 'SSOT_CURRENT.md chapter 25 entity mcp_task_input_response; contract sha256 2ae5c09e3d62802a41728417d0cf021734584ab96acffed840d788a6bb4dc420';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."mcp_task_input_response";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."mcp_task_input_response" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."mcp_task_event" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."mcp_task_event" IS 'SSOT_CURRENT.md chapter 25 entity mcp_task_event; contract sha256 0d63c0b87e8afb8c1b3c7290e4acebb37893b7b760bae7502215ccfd585a2312';
DROP TRIGGER IF EXISTS immutable_row ON kcml."mcp_task_event";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."mcp_task_event" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."mcp_idempotency_record" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."mcp_idempotency_record" IS 'SSOT_CURRENT.md chapter 25 entity mcp_idempotency_record; contract sha256 245fc8327b4b013bb51787b28d1cb1d1affd1cdb700667bca2332b23d83808b9';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."mcp_idempotency_record";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."mcp_idempotency_record" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."runtime_execution_context" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."runtime_execution_context" IS 'SSOT_CURRENT.md chapter 25 entity runtime_execution_context; contract sha256 c0a19c31011d12795b5030d0c71c4e1c441e205ac8446d0e07961b9662f56e1c';
DROP TRIGGER IF EXISTS immutable_row ON kcml."runtime_execution_context";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."runtime_execution_context" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."runtime_process_identity" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."runtime_process_identity" IS 'SSOT_CURRENT.md chapter 25 entity runtime_process_identity; contract sha256 6795ff111d219d90787f3081bddbf10d44011a2141faceaba9b36d19fb83b0bb';
DROP TRIGGER IF EXISTS immutable_row ON kcml."runtime_process_identity";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."runtime_process_identity" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."runtime_ipc_connection" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."runtime_ipc_connection" IS 'SSOT_CURRENT.md chapter 25 entity runtime_ipc_connection; contract sha256 665817a8f896bf729784807c7b3d4de81fac0e3598fed278291ae8e15dd88cd3';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."runtime_ipc_connection";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."runtime_ipc_connection" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."runtime_ipc_call" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."runtime_ipc_call" IS 'SSOT_CURRENT.md chapter 25 entity runtime_ipc_call; contract sha256 d1959ac652f7b17e747f4a8104592a0b844fef753e6fbba1daa3efc4b42f5804';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."runtime_ipc_call";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."runtime_ipc_call" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."runtime_credential_generation" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."runtime_credential_generation" IS 'SSOT_CURRENT.md chapter 25 entity runtime_credential_generation; contract sha256 6fc9e8753e0998af07c24f17d1cddf957ba0616ac080d35dadabb5976ccfa2eb';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."runtime_credential_generation";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."runtime_credential_generation" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."runtime_cleanup_operation" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."runtime_cleanup_operation" IS 'SSOT_CURRENT.md chapter 25 entity runtime_cleanup_operation; contract sha256 4d7f47d281b0a906a3962976750bebbc10f2aa1f7fa03ebc10e44e2e9e738f83';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."runtime_cleanup_operation";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."runtime_cleanup_operation" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."external_auth_binding" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."external_auth_binding" IS 'SSOT_CURRENT.md chapter 25 entity external_auth_binding; contract sha256 ee5a20e69c3f234a8561de45bd0d89b40f3b414a1c02725f0ccfff8d7577e755';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."external_auth_binding";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."external_auth_binding" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."secret_binding" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."secret_binding" IS 'SSOT_CURRENT.md chapter 25 entity secret_binding; contract sha256 0e48e2f299a2ef3bdc532a3803c972d8e5670a7ab74894326b86450a4aad0786';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."secret_binding";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."secret_binding" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."secret_resolution" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."secret_resolution" IS 'SSOT_CURRENT.md chapter 25 entity secret_resolution; contract sha256 a74f1ed839c706326a3ba14b2bcd9927fcb97c56add8cfad245330e17eff1f06';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."secret_resolution";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."secret_resolution" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."secret_access_event" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."secret_access_event" IS 'SSOT_CURRENT.md chapter 25 entity secret_access_event; contract sha256 74567accad4aaaa5f503ee19c3a327532f1c9b9e832db969a5529c4829eb9619';
DROP TRIGGER IF EXISTS immutable_row ON kcml."secret_access_event";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."secret_access_event" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."external_target" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."external_target" IS 'SSOT_CURRENT.md chapter 25 entity external_target; contract sha256 920fc071f3ff232cef12bd2ba89765e2386fe259f2670ac32210338b20906c62';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."external_target";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."external_target" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."external_target_binding" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."external_target_binding" IS 'SSOT_CURRENT.md chapter 25 entity external_target_binding; contract sha256 96e11636803ab2981900aafc4c1a56801eb45a0328d9de2d9090eaf565251abe';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."external_target_binding";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."external_target_binding" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."external_request_event" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."external_request_event" IS 'SSOT_CURRENT.md chapter 25 entity external_request_event; contract sha256 9f2ab4c49c8084702b1aedf468f493f00622fc9be7d960c675123fc7d0048de7';
DROP TRIGGER IF EXISTS immutable_row ON kcml."external_request_event";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."external_request_event" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."webhook_endpoint" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."webhook_endpoint" IS 'SSOT_CURRENT.md chapter 25 entity webhook_endpoint; contract sha256 733413d7e3e904a8cbb4fdeb10c7fbbb55b210a8c0252f6b57722ddf063d5d55';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."webhook_endpoint";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."webhook_endpoint" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."dashboard_workspace" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."dashboard_workspace" IS 'SSOT_CURRENT.md chapter 25 entity dashboard_workspace; contract sha256 abfc206b277d763a108869ecd60160c2845e6f44dcf95bb081d7f17d7870ead5';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."dashboard_workspace";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."dashboard_workspace" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."dashboard_node_position" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."dashboard_node_position" IS 'SSOT_CURRENT.md chapter 25 entity dashboard_node_position; contract sha256 b350ca6c2a92dab5d2ee9fb98243f4fb51a55069a118665e7c08e9abaff32830';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."dashboard_node_position";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."dashboard_node_position" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."dashboard_connection" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."dashboard_connection" IS 'SSOT_CURRENT.md chapter 25 entity dashboard_connection; contract sha256 b81e6bb4f3aa0e941d2e0694792298b584a8a08c52bb192d2f1a7b213a161f1c';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."dashboard_connection";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."dashboard_connection" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."dashboard_runtime_event" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."dashboard_runtime_event" IS 'SSOT_CURRENT.md chapter 25 entity dashboard_runtime_event; contract sha256 0115591f784cdf2bfbb3aeaeb5a39118bb76830c0692871c12a71b3c09085a92';
DROP TRIGGER IF EXISTS immutable_row ON kcml."dashboard_runtime_event";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."dashboard_runtime_event" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."component_state_history" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."component_state_history" IS 'SSOT_CURRENT.md chapter 25 entity component_state_history; contract sha256 81a9c066766115bfdcdcd12ba494bef2518f303d4152372946c5945db41ceacb';
DROP TRIGGER IF EXISTS immutable_row ON kcml."component_state_history";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."component_state_history" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."alert_delivery" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."alert_delivery" IS 'SSOT_CURRENT.md chapter 25 entity alert_delivery; contract sha256 443375f741163c5bf58d997cf18f853094dbcd27c3ad64233bfaadf06601bf7f';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."alert_delivery";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."alert_delivery" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."monitoring_scheduler_heartbeat" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."monitoring_scheduler_heartbeat" IS 'SSOT_CURRENT.md chapter 25 entity monitoring_scheduler_heartbeat; contract sha256 7ed4504b9e9aa0a9b67f5318db46c60e9f60a2efebead3bc4a634f88d845ed14';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."monitoring_scheduler_heartbeat";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."monitoring_scheduler_heartbeat" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."audit_archive_outbox" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."audit_archive_outbox" IS 'SSOT_CURRENT.md chapter 25 entity audit_archive_outbox; contract sha256 82d1b1729c99fcb33f7ddc7b0c470c3f8bd9d9ab3ed3b0d15c6f343caeb32e79';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."audit_archive_outbox";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."audit_archive_outbox" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."component_audit_stream" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."component_audit_stream" IS 'SSOT_CURRENT.md chapter 25 entity component_audit_stream; contract sha256 25e2b8b088ca8711b483677eff21f7a0875521d5981283874c94546d95296bbf';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."component_audit_stream";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."component_audit_stream" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."component_audit_event" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."component_audit_event" IS 'SSOT_CURRENT.md chapter 25 entity component_audit_event; contract sha256 3f9343f3b2711ab19cea9071007f959a9ba484695f0fdb1dc46ca5f6917bd610';
DROP TRIGGER IF EXISTS immutable_row ON kcml."component_audit_event";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."component_audit_event" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."debug_log_event" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."debug_log_event" IS 'SSOT_CURRENT.md chapter 25 entity debug_log_event; contract sha256 484cb2a251702276ca326db3c79838cc1930df192f3f40bfbd0bc9a0ef6374c5';
DROP TRIGGER IF EXISTS immutable_row ON kcml."debug_log_event";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."debug_log_event" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."generation_source" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."generation_source" IS 'SSOT_CURRENT.md chapter 25 entity generation_source; contract sha256 17e8bec823b186bcc979a4725319f7d8f2cf75c33de85337361ebe2f12b4df12';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."generation_source";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."generation_source" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."generation_fact" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."generation_fact" IS 'SSOT_CURRENT.md chapter 25 entity generation_fact; contract sha256 3e820d05a588257f79b52dac354482f3f831ba46fbe6c7e581b615303b5355f2';
DROP TRIGGER IF EXISTS immutable_row ON kcml."generation_fact";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."generation_fact" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."generation_owner_decision" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."generation_owner_decision" IS 'SSOT_CURRENT.md chapter 25 entity generation_owner_decision; contract sha256 9ade52f97b34411d6ca54a1e321f8ef129706e3ec439f75f25330e485f71f96d';
DROP TRIGGER IF EXISTS immutable_row ON kcml."generation_owner_decision";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."generation_owner_decision" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."generation_message" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."generation_message" IS 'SSOT_CURRENT.md chapter 25 entity generation_message; contract sha256 48d5cb4bd0e7f7492ee78d0a2973ce9f95df76a3daa70a4251e2fbad7b599c12';
DROP TRIGGER IF EXISTS immutable_row ON kcml."generation_message";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."generation_message" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."generation_turn" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."generation_turn" IS 'SSOT_CURRENT.md chapter 25 entity generation_turn; contract sha256 ef4bc462bb46ff1bc3d591c92f296a8b0fa98b46f268006f9f6c0dc3ef6783c2';
DROP TRIGGER IF EXISTS immutable_row ON kcml."generation_turn";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."generation_turn" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."generation_spec_revision" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."generation_spec_revision" IS 'SSOT_CURRENT.md chapter 25 entity generation_spec_revision; contract sha256 09a5437b2f00fb5e124ccff112333f26307bdd9b62684c48052d9bc1143cafb4';
DROP TRIGGER IF EXISTS immutable_row ON kcml."generation_spec_revision";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."generation_spec_revision" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."generation_execution_authority" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."generation_execution_authority" IS 'SSOT_CURRENT.md chapter 25 entity generation_execution_authority; contract sha256 d9c3a6f94461d14af5521246d6098388b44a9e0936c2956df15d3e1123534b14';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."generation_execution_authority";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."generation_execution_authority" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."generation_capability_snapshot" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."generation_capability_snapshot" IS 'SSOT_CURRENT.md chapter 25 entity generation_capability_snapshot; contract sha256 6b8e32474462ab0177b9171278b9131f6afe3714066235ac7b8fe4414cf62d5e';
DROP TRIGGER IF EXISTS immutable_row ON kcml."generation_capability_snapshot";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."generation_capability_snapshot" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."generation_capability_match" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."generation_capability_match" IS 'SSOT_CURRENT.md chapter 25 entity generation_capability_match; contract sha256 5c632cef35fbe94bf1a2223aefef2ccc566384334a99e1d83900a5aa968b5267';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."generation_capability_match";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."generation_capability_match" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."generation_plan" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."generation_plan" IS 'SSOT_CURRENT.md chapter 25 entity generation_plan; contract sha256 c690c63f06ce24bc612ffb0d08257b5653856356786ad8457ea44f9edf28cbde';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."generation_plan";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."generation_plan" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."generation_plan_node" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."generation_plan_node" IS 'SSOT_CURRENT.md chapter 25 entity generation_plan_node; contract sha256 d7d72d44211d0db10ed8fcf385b660e3f5f720176685d43b4f8e6c8e1bee7a2e';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."generation_plan_node";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."generation_plan_node" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."generation_plan_edge" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."generation_plan_edge" IS 'SSOT_CURRENT.md chapter 25 entity generation_plan_edge; contract sha256 c1db14c613b4f0babcea7eba774868769398118e2f3c56a67a094f9a7d03dcb9';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."generation_plan_edge";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."generation_plan_edge" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."generation_phase_run" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."generation_phase_run" IS 'SSOT_CURRENT.md chapter 25 entity generation_phase_run; contract sha256 d4eb317d01e0c41666ac8f98452977eb8505016f3445ac7ca78aa98eceea2454';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."generation_phase_run";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."generation_phase_run" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."generation_tool_event" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."generation_tool_event" IS 'SSOT_CURRENT.md chapter 25 entity generation_tool_event; contract sha256 efc24ac170776e7697722398fdb30b7fc9c8a15a3458d4c1a1e4ba63ab9417bf';
DROP TRIGGER IF EXISTS immutable_row ON kcml."generation_tool_event";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."generation_tool_event" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."generation_workspace_revision" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."generation_workspace_revision" IS 'SSOT_CURRENT.md chapter 25 entity generation_workspace_revision; contract sha256 0fd83fdc63f79eebba63295dd63890bdbf562641a21bf0c1dcac94b298b78373';
DROP TRIGGER IF EXISTS immutable_row ON kcml."generation_workspace_revision";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."generation_workspace_revision" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."generation_workspace_file" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."generation_workspace_file" IS 'SSOT_CURRENT.md chapter 25 entity generation_workspace_file; contract sha256 a8f5dcd3d62d0dbce1623b654465b0d8f7782947d7d0895512f7a501fe4fd603';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."generation_workspace_file";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."generation_workspace_file" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."generation_workspace_patch" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."generation_workspace_patch" IS 'SSOT_CURRENT.md chapter 25 entity generation_workspace_patch; contract sha256 a4c69361b3e2d6bb25a3732a42a04c73c914c6c851b6bfb3b6ca4e42363a6d20';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."generation_workspace_patch";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."generation_workspace_patch" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."generation_artifact_manifest" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."generation_artifact_manifest" IS 'SSOT_CURRENT.md chapter 25 entity generation_artifact_manifest; contract sha256 e0b61eac76b0e1945c40611dfb0bc400b7dedd6189dd046c03dbd6ec5030bfaa';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."generation_artifact_manifest";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."generation_artifact_manifest" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."generation_contract_candidate" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."generation_contract_candidate" IS 'SSOT_CURRENT.md chapter 25 entity generation_contract_candidate; contract sha256 bf34f162ea749f152130c7d9e425270ef1feec4c94821752f82113e207ab3585';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."generation_contract_candidate";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."generation_contract_candidate" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."generation_validation_run" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."generation_validation_run" IS 'SSOT_CURRENT.md chapter 25 entity generation_validation_run; contract sha256 c27b4009039b5df43026f8ffe831fde603d800175bb471f1861c35ed639440a7';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."generation_validation_run";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."generation_validation_run" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."generation_validation_result" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."generation_validation_result" IS 'SSOT_CURRENT.md chapter 25 entity generation_validation_result; contract sha256 0d4819ff105b2412e3ca1f0f41914ee24e77c1bd953ba78fe2f58025d6774513';
DROP TRIGGER IF EXISTS immutable_row ON kcml."generation_validation_result";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."generation_validation_result" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."generation_repair_iteration" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."generation_repair_iteration" IS 'SSOT_CURRENT.md chapter 25 entity generation_repair_iteration; contract sha256 e52a087bbf3379882dcba9124cb4eea613d468e9ec0fdcbe64ab4f1836609b72';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."generation_repair_iteration";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."generation_repair_iteration" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."generation_blocker" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."generation_blocker" IS 'SSOT_CURRENT.md chapter 25 entity generation_blocker; contract sha256 71b7ba69920be43367f8bd5f8c95e2b517204e4c174150ededf962b1eb6b9fd7';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."generation_blocker";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."generation_blocker" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."generation_activation_member" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."generation_activation_member" IS 'SSOT_CURRENT.md chapter 25 entity generation_activation_member; contract sha256 18210f30137a2d7da1332d71ce8c0b5f6b06361ee38a74c1a93f4a7df019f456';
DROP TRIGGER IF EXISTS immutable_row ON kcml."generation_activation_member";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."generation_activation_member" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."generation_event" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."generation_event" IS 'SSOT_CURRENT.md chapter 25 entity generation_event; contract sha256 709b244cff790629e7964e625fc2e74854641be1cc8dda704ba2ec3ad8296141';
DROP TRIGGER IF EXISTS immutable_row ON kcml."generation_event";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."generation_event" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."openai_model_capability_snapshot" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."openai_model_capability_snapshot" IS 'SSOT_CURRENT.md chapter 25 entity openai_model_capability_snapshot; contract sha256 9381d5e270096a3b63be2995f5612e8ee30c4dd4ad947d4082113d5f9a63167a';
DROP TRIGGER IF EXISTS immutable_row ON kcml."openai_model_capability_snapshot";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."openai_model_capability_snapshot" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."openai_request_descriptor" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."openai_request_descriptor" IS 'SSOT_CURRENT.md chapter 25 entity openai_request_descriptor; contract sha256 3509574e873fe06a3da3c7a0dd8cf32a92ee33a6ca269039ec21ded11df0a792';
DROP TRIGGER IF EXISTS immutable_row ON kcml."openai_request_descriptor";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."openai_request_descriptor" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."ai_model_event" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."ai_model_event" IS 'SSOT_CURRENT.md chapter 25 entity ai_model_event; contract sha256 7c470c5ba69ba5cf1ddb12b33e4545254c10d23ebe625ba9f7901b29bc634bd2';
DROP TRIGGER IF EXISTS immutable_row ON kcml."ai_model_event";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."ai_model_event" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."ai_model_output_item" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."ai_model_output_item" IS 'SSOT_CURRENT.md chapter 25 entity ai_model_output_item; contract sha256 cdb438b936d95900f518d698cf2a644a0a31214c98d1f85cac09939e9885ef07';
DROP TRIGGER IF EXISTS immutable_row ON kcml."ai_model_output_item";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."ai_model_output_item" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."ai_model_output_content_part" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."ai_model_output_content_part" IS 'SSOT_CURRENT.md chapter 25 entity ai_model_output_content_part; contract sha256 7431b11ba459ca3730ff5d30f90882ec88715cc225a378c6fa624bb2d8d7d5c0';
DROP TRIGGER IF EXISTS immutable_row ON kcml."ai_model_output_content_part";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."ai_model_output_content_part" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."ai_tool_dispatch" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."ai_tool_dispatch" IS 'SSOT_CURRENT.md chapter 25 entity ai_tool_dispatch; contract sha256 96179860ebe44499aeed0a82f660c668bcc9760229ba6cba262dc8e30b5958fb';
DROP TRIGGER IF EXISTS immutable_row ON kcml."ai_tool_dispatch";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."ai_tool_dispatch" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."ai_model_continuation" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."ai_model_continuation" IS 'SSOT_CURRENT.md chapter 25 entity ai_model_continuation; contract sha256 39b6065a94cad409cef5f618cb0226796e01c515108c36a7e1a59eaf38e7740b';
DROP TRIGGER IF EXISTS immutable_row ON kcml."ai_model_continuation";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."ai_model_continuation" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."ai_run_state_checkpoint" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."ai_run_state_checkpoint" IS 'SSOT_CURRENT.md chapter 25 entity ai_run_state_checkpoint; contract sha256 b8d7dd9fd3e687689a94f936a0f1c519bbcd9234572b884c06bd25a42e5112c7';
DROP TRIGGER IF EXISTS immutable_row ON kcml."ai_run_state_checkpoint";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."ai_run_state_checkpoint" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."agent_session_compaction" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."agent_session_compaction" IS 'SSOT_CURRENT.md chapter 25 entity agent_session_compaction; contract sha256 678e11743137d72ce56b15a283dfba8ffdd1732a0df53f31012a6af5485dee81';
DROP TRIGGER IF EXISTS immutable_row ON kcml."agent_session_compaction";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."agent_session_compaction" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."agent_definition" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."agent_definition" IS 'SSOT_CURRENT.md chapter 25 entity agent_definition; contract sha256 6e4bd6d6a12d4cfad2b9597def7b9facb4ec8de9b6eb15a86f8adde9af50c317';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."agent_definition";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."agent_definition" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."agent_revision" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."agent_revision" IS 'SSOT_CURRENT.md chapter 25 entity agent_revision; contract sha256 62214f9a953c907b1aac5cfda24ea736322ea82914454a7ffe3fc01505daca8d';
DROP TRIGGER IF EXISTS immutable_row ON kcml."agent_revision";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."agent_revision" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."agent_tool_binding" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."agent_tool_binding" IS 'SSOT_CURRENT.md chapter 25 entity agent_tool_binding; contract sha256 ee383f6be6fd94e747265b1c0d5e6ea4e7071caff64ba442ef2ce57bdf1417a7';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."agent_tool_binding";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."agent_tool_binding" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."agent_handoff_binding" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."agent_handoff_binding" IS 'SSOT_CURRENT.md chapter 25 entity agent_handoff_binding; contract sha256 d7d6cb217bda7ccc0fb55a015eff14355aea506c64335b3be6638c500a3c4918';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."agent_handoff_binding";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."agent_handoff_binding" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."agent_guardrail" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."agent_guardrail" IS 'SSOT_CURRENT.md chapter 25 entity agent_guardrail; contract sha256 7994ecd21afec62e3423503184d8bc972a80ed0cdb17f48a2374c75cbc052536';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."agent_guardrail";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."agent_guardrail" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."agent_session" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."agent_session" IS 'SSOT_CURRENT.md chapter 25 entity agent_session; contract sha256 282531b1163eb07453e581796d3b03a30fc70b6f84116d83f063d1f6158b3014';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."agent_session";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."agent_session" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."agent_session_item" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."agent_session_item" IS 'SSOT_CURRENT.md chapter 25 entity agent_session_item; contract sha256 10a1f4deff9cdce2da560ec839e0fe939f035e202c0a6b7c69946af02c5286ba';
DROP TRIGGER IF EXISTS immutable_row ON kcml."agent_session_item";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."agent_session_item" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."agent_run_checkpoint" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."agent_run_checkpoint" IS 'SSOT_CURRENT.md chapter 25 entity agent_run_checkpoint; contract sha256 a0163bbc6cf806d1a662c3ed20490de7f1393de899e1ed6e01f8b34323e9b51a';
DROP TRIGGER IF EXISTS immutable_row ON kcml."agent_run_checkpoint";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."agent_run_checkpoint" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."agent_message" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."agent_message" IS 'SSOT_CURRENT.md chapter 25 entity agent_message; contract sha256 9a1c8d45241bce7b273d68ae06c42ceeba37d67461d5f57516ad6fd14246f078';
DROP TRIGGER IF EXISTS immutable_row ON kcml."agent_message";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."agent_message" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."agent_tool_call" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."agent_tool_call" IS 'SSOT_CURRENT.md chapter 25 entity agent_tool_call; contract sha256 275ff1824e8d5bf0338fc06dcbf944e9fe84e28797399fc7de209f1149e51434';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."agent_tool_call";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."agent_tool_call" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."agent_handoff_run" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."agent_handoff_run" IS 'SSOT_CURRENT.md chapter 25 entity agent_handoff_run; contract sha256 6e25ef87f5877c2d4db729e32ab4b4ac85dd34d6cee6a2b546dcfee06d96f480';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."agent_handoff_run";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."agent_handoff_run" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."agent_approval_request" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."agent_approval_request" IS 'SSOT_CURRENT.md chapter 25 entity agent_approval_request; contract sha256 fa805e1f33208e83e7dda4c8165782af18ee765e47a7805100153c37fcab353c';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."agent_approval_request";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."agent_approval_request" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."agent_memory_namespace" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."agent_memory_namespace" IS 'SSOT_CURRENT.md chapter 25 entity agent_memory_namespace; contract sha256 f44431c2f49f7c3b53e2ae448a1231a36fa69426e2fb431ecda04ebf3138242e';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."agent_memory_namespace";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."agent_memory_namespace" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."agent_memory_item" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."agent_memory_item" IS 'SSOT_CURRENT.md chapter 25 entity agent_memory_item; contract sha256 9f401879424e20b004ba9a19eda4d641586d230955bf092454bb825d711271be';
DROP TRIGGER IF EXISTS immutable_row ON kcml."agent_memory_item";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."agent_memory_item" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."agent_trigger" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."agent_trigger" IS 'SSOT_CURRENT.md chapter 25 entity agent_trigger; contract sha256 73cd99dc7bdc4d03d3b06e4d9e07bc80c1f1b9ecda1a4f0d5f9dc5639ed45a56';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."agent_trigger";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."agent_trigger" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."agent_eval_suite" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."agent_eval_suite" IS 'SSOT_CURRENT.md chapter 25 entity agent_eval_suite; contract sha256 e96e0323e3ea24af1b4ab8def3c2ce432a48e9672a38a432090ba469d4772aad';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."agent_eval_suite";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."agent_eval_suite" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."agent_eval_case" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."agent_eval_case" IS 'SSOT_CURRENT.md chapter 25 entity agent_eval_case; contract sha256 c6fbfe857eb855595e34f5b4e4f27185fda87b102fe0e8c2aa99cc325efec4bd';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."agent_eval_case";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."agent_eval_case" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."agent_eval_run" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."agent_eval_run" IS 'SSOT_CURRENT.md chapter 25 entity agent_eval_run; contract sha256 60082c6a18ccd829498638072a61e4806a62eaaffc03ae6dbda9b072bf8677f7';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."agent_eval_run";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."agent_eval_run" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."agent_eval_case_result" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."agent_eval_case_result" IS 'SSOT_CURRENT.md chapter 25 entity agent_eval_case_result; contract sha256 b3017aba6da9774a51b688e48de102f0aa7fdb68dc1ef9d5a22ed9587236ea77';
DROP TRIGGER IF EXISTS immutable_row ON kcml."agent_eval_case_result";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."agent_eval_case_result" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."system_chat_conversation" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."system_chat_conversation" IS 'SSOT_CURRENT.md chapter 25 entity system_chat_conversation; contract sha256 9822ca4ebc1e5f6cbefff4cf541c3b606172ca65e91633338e6319abc4893744';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."system_chat_conversation";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."system_chat_conversation" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."system_chat_message" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."system_chat_message" IS 'SSOT_CURRENT.md chapter 25 entity system_chat_message; contract sha256 0acb85bc091e968776885604cc5c2f58ee76d20782459b5ad8f5a7d2abbac6c0';
DROP TRIGGER IF EXISTS immutable_row ON kcml."system_chat_message";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."system_chat_message" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."system_chat_action" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."system_chat_action" IS 'SSOT_CURRENT.md chapter 25 entity system_chat_action; contract sha256 bf0aa03487a2698a8a2a8ff3799e70afd67eaf38270d8e2a618f76c89cf735d3';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."system_chat_action";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."system_chat_action" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."browser_runtime_build_manifest" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."browser_runtime_build_manifest" IS 'SSOT_CURRENT.md chapter 25 entity browser_runtime_build_manifest; contract sha256 0f54d76a64a550846b173897a8cf63d24a96e8a4b7e5c90ea248e21d4a976864';
DROP TRIGGER IF EXISTS immutable_row ON kcml."browser_runtime_build_manifest";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."browser_runtime_build_manifest" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."browser_session_binding" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."browser_session_binding" IS 'SSOT_CURRENT.md chapter 25 entity browser_session_binding; contract sha256 b600c45d72391f933a18fa1cda3dbe7c56beefee0703aa80c7c58023f9b9aab9';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_session_binding";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_session_binding" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."browser_host_slot" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."browser_host_slot" IS 'SSOT_CURRENT.md chapter 25 entity browser_host_slot; contract sha256 03f76107d623e84943ebd45038051b7304a051a3c4b97abdd7303716f0919287';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_host_slot";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_host_slot" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."browser_context_instance" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."browser_context_instance" IS 'SSOT_CURRENT.md chapter 25 entity browser_context_instance; contract sha256 17e21be04a8045f4787290f17c5ae17999ec464a8f87b214fb7803d0d112ba4b';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_context_instance";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_context_instance" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."browser_page" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."browser_page" IS 'SSOT_CURRENT.md chapter 25 entity browser_page; contract sha256 60fafa41219f47d1a8370b53c5f8b7300e5a7ccc1400ae2c6edadab4f5ca06ff';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_page";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_page" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."browser_frame" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."browser_frame" IS 'SSOT_CURRENT.md chapter 25 entity browser_frame; contract sha256 8562f6250fb7aaa6fe1deb65c51d9c5eec52aadc83cafb68763bc1e21dddf3cc';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_frame";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_frame" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."browser_document" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."browser_document" IS 'SSOT_CURRENT.md chapter 25 entity browser_document; contract sha256 d73b7b15afc7c0016dbe481c072ade0c542f92c249531414674b95d182c95ea3';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_document";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_document" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."browser_navigation" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."browser_navigation" IS 'SSOT_CURRENT.md chapter 25 entity browser_navigation; contract sha256 fe05af2cda7861d7bf4e7702665c0ecf3a1a3f5cfe42679f933aa6ea7f489271';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_navigation";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_navigation" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."browser_preview_frame" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."browser_preview_frame" IS 'SSOT_CURRENT.md chapter 25 entity browser_preview_frame; contract sha256 2c524fdd35d76e21a8664ddda2a6a84cfc6b42bf710ff7111688525d8881123b';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_preview_frame";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_preview_frame" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."browser_preview_ticket" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."browser_preview_ticket" IS 'SSOT_CURRENT.md chapter 25 entity browser_preview_ticket; contract sha256 a25f8771acd8bf47c577a748879e44d004820ee69c557c6e6e851c06a1feacfe';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_preview_ticket";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_preview_ticket" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."browser_preview_event" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."browser_preview_event" IS 'SSOT_CURRENT.md chapter 25 entity browser_preview_event; contract sha256 28b1d10fefaaaca6c6961da9965a03163da91540d49a945cf9fb16bb0cc81f14';
DROP TRIGGER IF EXISTS immutable_row ON kcml."browser_preview_event";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."browser_preview_event" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."browser_control_lease" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."browser_control_lease" IS 'SSOT_CURRENT.md chapter 25 entity browser_control_lease; contract sha256 11777922fb20a2be1a8ff0120a05c776c004b4a83bc6436193b1e8ff439f1384';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_control_lease";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_control_lease" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."browser_control_transfer" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."browser_control_transfer" IS 'SSOT_CURRENT.md chapter 25 entity browser_control_transfer; contract sha256 163fb268295d1a19f8911e1abfb6d04c295c8c2d4dd732b0a6e139f19eb32db2';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_control_transfer";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_control_transfer" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."browser_input_event" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."browser_input_event" IS 'SSOT_CURRENT.md chapter 25 entity browser_input_event; contract sha256 e9e81bcebe9c3aa9aa3e5c502f48a8a1ec94fa06536b8777843584938e9d8e73';
DROP TRIGGER IF EXISTS immutable_row ON kcml."browser_input_event";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."browser_input_event" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."browser_action_attempt" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."browser_action_attempt" IS 'SSOT_CURRENT.md chapter 25 entity browser_action_attempt; contract sha256 deae1488f8312c57100c3b3305380ce3d004ca6731c95e6223232235187008e1';
DROP TRIGGER IF EXISTS immutable_row ON kcml."browser_action_attempt";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."browser_action_attempt" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."browser_action_dispatch_event" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."browser_action_dispatch_event" IS 'SSOT_CURRENT.md chapter 25 entity browser_action_dispatch_event; contract sha256 68a1fcdfa0375f5e2515e65816df81b465ae5221dd97ce4d767f256727ba0c5c';
DROP TRIGGER IF EXISTS immutable_row ON kcml."browser_action_dispatch_event";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."browser_action_dispatch_event" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."browser_operation_scope" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."browser_operation_scope" IS 'SSOT_CURRENT.md chapter 25 entity browser_operation_scope; contract sha256 a52213bd68835ebd7168dc5fea3f9342d9f612c9a9d6cc2649ccf6816a8c8384';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_operation_scope";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_operation_scope" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."browser_irreversible_confirmation" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."browser_irreversible_confirmation" IS 'SSOT_CURRENT.md chapter 25 entity browser_irreversible_confirmation; contract sha256 f26f5fb04557f24f00ea4d96c45d0f0b2ad7ed1acd66ad38d3bde8be900c847f';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_irreversible_confirmation";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_irreversible_confirmation" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."browser_auth_attempt" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."browser_auth_attempt" IS 'SSOT_CURRENT.md chapter 25 entity browser_auth_attempt; contract sha256 c45c106ac7b336edcec80c57996c547d22d1be376eb9c63c999e2d6aca1614b8';
DROP TRIGGER IF EXISTS immutable_row ON kcml."browser_auth_attempt";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."browser_auth_attempt" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."browser_state_bundle_member" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."browser_state_bundle_member" IS 'SSOT_CURRENT.md chapter 25 entity browser_state_bundle_member; contract sha256 d1cfd1efa3339be3ac23607fa9266065cb3882eb04930b4707d67c7268845728';
DROP TRIGGER IF EXISTS immutable_row ON kcml."browser_state_bundle_member";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."browser_state_bundle_member" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."browser_bridge_connection" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."browser_bridge_connection" IS 'SSOT_CURRENT.md chapter 25 entity browser_bridge_connection; contract sha256 9011b9cd24d2563dd275d05a3b4a35c3cf489d3f54be02e59687f0591d4929f8';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_bridge_connection";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_bridge_connection" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."browser_bridge_assignment" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."browser_bridge_assignment" IS 'SSOT_CURRENT.md chapter 25 entity browser_bridge_assignment; contract sha256 924a092864218f14f87792d1d2d96c9eb56a1fd1c2827a99e2adb7bcf6fd35be';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_bridge_assignment";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_bridge_assignment" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."browser_profile_lease" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."browser_profile_lease" IS 'SSOT_CURRENT.md chapter 25 entity browser_profile_lease; contract sha256 d813cf29424bce63dcd797dbb88313298c03058c332daa7434f6e2b25dfa6130';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_profile_lease";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_profile_lease" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."browser_dialog" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."browser_dialog" IS 'SSOT_CURRENT.md chapter 25 entity browser_dialog; contract sha256 11cd64e8b0aa67ff6053fd436879091dac4517ca16b5a98e36067fd1daa8d9f1';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_dialog";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_dialog" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."browser_permission_request" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."browser_permission_request" IS 'SSOT_CURRENT.md chapter 25 entity browser_permission_request; contract sha256 2467931e8ee27e8e6c206a4fc149dd7552d0e3d423888e66401028b6848bf6a4';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_permission_request";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_permission_request" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."browser_upload_handle" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."browser_upload_handle" IS 'SSOT_CURRENT.md chapter 25 entity browser_upload_handle; contract sha256 0e0c8dcc2d8b878c304a2b2fa71f0f8641cc65df48a858c75363834767d8159e';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_upload_handle";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_upload_handle" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."browser_download" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."browser_download" IS 'SSOT_CURRENT.md chapter 25 entity browser_download; contract sha256 728ebdb29befd619ac8b113cabf182a7dc5f4104f3d9b04856cc874ee7302045';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_download";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_download" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."browser_teaching_run" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."browser_teaching_run" IS 'SSOT_CURRENT.md chapter 25 entity browser_teaching_run; contract sha256 3dce69c80a191fda83a89edd466591aa5d5152ace4b4833fcaa6992a5dbbda6b';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_teaching_run";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_teaching_run" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."browser_teaching_step" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."browser_teaching_step" IS 'SSOT_CURRENT.md chapter 25 entity browser_teaching_step; contract sha256 4e10efb019d1fdfdfdfcf307222f637bb0913cea8844bb6fdf8936a946657883';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_teaching_step";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_teaching_step" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."browser_automation_definition" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."browser_automation_definition" IS 'SSOT_CURRENT.md chapter 25 entity browser_automation_definition; contract sha256 28e33b260ffe2751a453c910eeb32ffdfec89ce5c1dda66bbc63cfc95c0bf776';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_automation_definition";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_automation_definition" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."browser_automation_revision" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."browser_automation_revision" IS 'SSOT_CURRENT.md chapter 25 entity browser_automation_revision; contract sha256 76a3a8c03ab1997eefaeec7ef23f5438e80ada9f8335c7e0981c728568545b2e';
DROP TRIGGER IF EXISTS immutable_row ON kcml."browser_automation_revision";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."browser_automation_revision" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."browser_automation_run" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."browser_automation_run" IS 'SSOT_CURRENT.md chapter 25 entity browser_automation_run; contract sha256 eda12b2e12fff951c28bd0fb39503ecb92da8525eae5906088bb5042be9836b7';
DROP TRIGGER IF EXISTS immutable_row ON kcml."browser_automation_run";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."browser_automation_run" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."browser_automation_run_step" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."browser_automation_run_step" IS 'SSOT_CURRENT.md chapter 25 entity browser_automation_run_step; contract sha256 b858df59cd96a1b01d22f859e98defc0eac7dce2a47a1e8436b21558990b96cf';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_automation_run_step";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_automation_run_step" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."browser_automation_artifact" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."browser_automation_artifact" IS 'SSOT_CURRENT.md chapter 25 entity browser_automation_artifact; contract sha256 4df2fd57f7b79201c513cfe48b817c2a6d44c9b7f9f72bb1e80ccba561c65bc1';
DROP TRIGGER IF EXISTS immutable_row ON kcml."browser_automation_artifact";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."browser_automation_artifact" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."browser_auth_binding" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."browser_auth_binding" IS 'SSOT_CURRENT.md chapter 25 entity browser_auth_binding; contract sha256 80272d715501f887078fc17038672580bbd942b5c093ca47064bd4d9a4eea215';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_auth_binding";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_auth_binding" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."browser_challenge" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."browser_challenge" IS 'SSOT_CURRENT.md chapter 25 entity browser_challenge; contract sha256 870cd8fc26d49235192bfe6dc362930448f70d68c4f61a139bf4fc634e873bea';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."browser_challenge";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."browser_challenge" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."self_test_catalog_entry" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."self_test_catalog_entry" IS 'SSOT_CURRENT.md chapter 25 entity self_test_catalog_entry; contract sha256 124b2576f054c198be7230faac0e60bb4268547eebe3b0037407c0cc42a7edf8';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."self_test_catalog_entry";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."self_test_catalog_entry" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."deployment_step" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."deployment_step" IS 'SSOT_CURRENT.md chapter 25 entity deployment_step; contract sha256 45d3486c55065e0c6863f3cfafad8035cdd136936d7b26e13aa4b233310d9528';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."deployment_step";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."deployment_step" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."production_acceptance_run" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."production_acceptance_run" IS 'SSOT_CURRENT.md chapter 25 entity production_acceptance_run; contract sha256 0f7cf2ca8971f3ee7d45f791b6dcbdc8bb8ba4af1703897857969fa8415dbdcd';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."production_acceptance_run";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."production_acceptance_run" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."operational_setting_applied" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."operational_setting_applied" IS 'SSOT_CURRENT.md chapter 25 entity operational_setting_applied; contract sha256 79cce5f19b5745d994681c0bc01d32a8cbb938c7b966f39e7944bff251834f7e';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."operational_setting_applied";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."operational_setting_applied" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."domain_command_activation_domain" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."domain_command_activation_domain" IS 'SSOT_CURRENT.md chapter 25 entity domain_command_activation_domain; contract sha256 4095d4e65738384a041b12788d0dd5ba45d7b94c5ea1a9a67dfad7439e276090';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."domain_command_activation_domain";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."domain_command_activation_domain" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."activation_domain_barrier" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."activation_domain_barrier" IS 'SSOT_CURRENT.md chapter 25 entity activation_domain_barrier; contract sha256 0d233d2472cc607bda897c5fea0f2adebf08842dc8c519db8bc1382492a68677';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."activation_domain_barrier";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."activation_domain_barrier" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."configuration_apply_run" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."configuration_apply_run" IS 'SSOT_CURRENT.md chapter 25 entity configuration_apply_run; contract sha256 d28208a42a2007ff9a93b2727d6281497675a58436e3c778b2ce63a0855cc57e';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."configuration_apply_run";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."configuration_apply_run" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."authority_lineage" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."authority_lineage" IS 'SSOT_CURRENT.md chapter 25 entity authority_lineage; contract sha256 5e883b29817188cebae5fc8b7af78e5ec616a83420f0db96621fe822f9fec611';
DROP TRIGGER IF EXISTS immutable_row ON kcml."authority_lineage";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."authority_lineage" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."operation_intent" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."operation_intent" IS 'SSOT_CURRENT.md chapter 25 entity operation_intent; contract sha256 47745df438e63f306b426675e406f6bd0b51b428bde0610726b1e34e0f365086';
DROP TRIGGER IF EXISTS immutable_row ON kcml."operation_intent";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."operation_intent" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."content_provenance" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."content_provenance" IS 'SSOT_CURRENT.md chapter 25 entity content_provenance; contract sha256 bc24e8c5b1662178905bf21a976c6f6699b5ec29c9b6a3d617357b74f8635beb';
DROP TRIGGER IF EXISTS immutable_row ON kcml."content_provenance";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."content_provenance" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."instruction_segment" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."instruction_segment" IS 'SSOT_CURRENT.md chapter 25 entity instruction_segment; contract sha256 52d0afcba0e640501234f99d826f32d8a5613f3ae60cc7e97f02c35ba95a49da';
DROP TRIGGER IF EXISTS immutable_row ON kcml."instruction_segment";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."instruction_segment" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."operation_context" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."operation_context" IS 'SSOT_CURRENT.md chapter 25 entity operation_context; contract sha256 4877838d1639089b567492c110af0bbde1461cb4f0209af977471578aa9b8333';
DROP TRIGGER IF EXISTS immutable_row ON kcml."operation_context";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."operation_context" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."semantic_action_plan" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."semantic_action_plan" IS 'SSOT_CURRENT.md chapter 25 entity semantic_action_plan; contract sha256 3a054b5fc3abd8088b943d7c791ed33f72ac89adeac1754b2d08623dfa865c57';
DROP TRIGGER IF EXISTS immutable_row ON kcml."semantic_action_plan";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."semantic_action_plan" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."value_derivation" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."value_derivation" IS 'SSOT_CURRENT.md chapter 25 entity value_derivation; contract sha256 bc794cc8d42b3bc45be4a05c4beb380daa9223ffd09e543e6779cdd3d904a493';
DROP TRIGGER IF EXISTS immutable_row ON kcml."value_derivation";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."value_derivation" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml."secret_use_context" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."secret_use_context" IS 'SSOT_CURRENT.md chapter 25 entity secret_use_context; contract sha256 9ac19d4a13feb0f1d4b8ad719363733ef536fa1e270b2d605d34c550a62b53ab';
DROP TRIGGER IF EXISTS touch_mutable_row ON kcml."secret_use_context";
CREATE TRIGGER touch_mutable_row BEFORE UPDATE ON kcml."secret_use_context" FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml."agentic_security_event" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  stable_key text,
  display_name text,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_digest bytea GENERATED ALWAYS AS (digest(convert_to(document::text, 'UTF8'), 'sha256')) STORED,
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
COMMENT ON TABLE kcml."agentic_security_event" IS 'SSOT_CURRENT.md chapter 25 entity agentic_security_event; contract sha256 f980c06761bf38664bd1a0d2402d1e1525ef9290fcdf8fa0a80eef54bdcdef03';
DROP TRIGGER IF EXISTS immutable_row ON kcml."agentic_security_event";
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml."agentic_security_event" FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

COMMIT;
