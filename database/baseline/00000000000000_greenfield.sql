BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE SCHEMA IF NOT EXISTS kcml;
REVOKE ALL ON SCHEMA kcml FROM PUBLIC;

CREATE OR REPLACE FUNCTION kcml.touch_mutable_row() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  IF NEW.state_version <= OLD.state_version THEN
    RAISE EXCEPTION 'state_version must increase' USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION kcml.reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is immutable', TG_TABLE_NAME USING ERRCODE = '55000';
END $$;

CREATE OR REPLACE FUNCTION kcml.guard_mcp_lifecycle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_old text := to_jsonb(OLD)->>TG_ARGV[0];
  v_new text := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(NEW)->>TG_ARGV[0] ELSE NULL END;
  v_allowed boolean := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% hard delete is forbidden', TG_TABLE_NAME USING ERRCODE = '55000';
  END IF;
  IF NEW.state_version <= OLD.state_version THEN
    RAISE EXCEPTION 'state_version must increase' USING ERRCODE = '40001';
  END IF;
  IF (TG_TABLE_NAME = 'mcp_call_run' AND v_old IN ('SUCCEEDED','FAILED','CANCELLED')) OR
     (TG_TABLE_NAME = 'mcp_input_exchange' AND v_old IN ('CONSUMED','EXPIRED','INVALIDATED')) OR
     (TG_TABLE_NAME = 'mcp_task' AND v_old IN ('COMPLETED','FAILED','CANCELLED')) OR
     (TG_TABLE_NAME = 'mcp_request_event' AND (to_jsonb(OLD)->>'completed_at') IS NOT NULL) THEN
    RAISE EXCEPTION '% terminal row is immutable', TG_TABLE_NAME USING ERRCODE = '55000';
  END IF;
  IF TG_TABLE_NAME = 'mcp_request_event' THEN
    v_allowed := v_old = v_new OR (v_old = 'PENDING' AND v_new IN ('SUCCEEDED','FAILED','CANCELLED','MANUAL_REVIEW'));
  ELSIF TG_TABLE_NAME = 'mcp_call_run' THEN
    v_allowed := v_old = v_new OR
      (v_old = 'RECEIVED' AND v_new IN ('CLAIMED','CANCELLED','FAILED')) OR
      (v_old = 'CLAIMED' AND v_new IN ('EXECUTING','CANCEL_REQUESTED','CANCELLED','FAILED')) OR
      (v_old = 'EXECUTING' AND v_new IN ('WAITING_FOR_INPUT','WAITING_FOR_TASK','RECONCILING','CANCEL_REQUESTED','SUCCEEDED','FAILED','CANCELLED','MANUAL_REVIEW')) OR
      (v_old IN ('WAITING_FOR_INPUT','WAITING_FOR_TASK') AND v_new IN ('CLAIMED','RECONCILING','CANCEL_REQUESTED','FAILED','CANCELLED','MANUAL_REVIEW')) OR
      (v_old = 'RECONCILING' AND v_new IN ('CLAIMED','SUCCEEDED','FAILED','CANCELLED','MANUAL_REVIEW')) OR
      (v_old = 'CANCEL_REQUESTED' AND v_new IN ('RECONCILING','SUCCEEDED','FAILED','CANCELLED','MANUAL_REVIEW')) OR
      (v_old = 'MANUAL_REVIEW' AND v_new IN ('RECONCILING','FAILED','CANCELLED'));
  ELSIF TG_TABLE_NAME = 'mcp_input_exchange' THEN
    v_allowed := v_old = v_new OR
      (v_old = 'PENDING' AND v_new IN ('PARTIALLY_FULFILLED','FULFILLED','EXPIRED','INVALIDATED')) OR
      (v_old = 'PARTIALLY_FULFILLED' AND v_new IN ('FULFILLED','EXPIRED','INVALIDATED')) OR
      (v_old = 'FULFILLED' AND v_new IN ('CONSUMED','INVALIDATED'));
  ELSIF TG_TABLE_NAME = 'mcp_task' THEN
    v_allowed := v_old = v_new OR
      (v_old = 'WORKING' AND v_new IN ('INPUT_REQUIRED','COMPLETED','FAILED','CANCELLED')) OR
      (v_old = 'INPUT_REQUIRED' AND v_new IN ('WORKING','COMPLETED','FAILED','CANCELLED'));
  END IF;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'invalid % lifecycle transition % -> %', TG_TABLE_NAME, v_old, v_new USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'mcp_task' THEN NEW.updated_at := clock_timestamp(); END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION kcml.guard_agent_run_lifecycle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_allowed boolean := false;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'agent_run hard delete is forbidden' USING ERRCODE = '55000'; END IF;
  IF NEW.state_version <= OLD.state_version THEN RAISE EXCEPTION 'state_version must increase' USING ERRCODE = '40001'; END IF;
  IF OLD.status IN ('SUCCEEDED','FAILED','CANCELLED') THEN RAISE EXCEPTION 'agent_run terminal row is immutable' USING ERRCODE = '55000'; END IF;
  v_allowed := OLD.status = NEW.status OR
    (OLD.status = 'QUEUED' AND NEW.status IN ('PREPARING','CANCEL_REQUESTED')) OR
    (OLD.status = 'PREPARING' AND NEW.status IN ('RUNNING','WAITING_FOR_OWNER','FAILED','CANCEL_REQUESTED')) OR
    (OLD.status = 'RUNNING' AND NEW.status IN ('WAITING_FOR_MODEL','WAITING_FOR_TOOL','WAITING_FOR_MCP_INPUT','WAITING_FOR_MCP_TASK','WAITING_FOR_AGENT','WAITING_FOR_OWNER','CHALLENGE_REQUIRED','PAUSED','SUCCEEDED','FAILED','CANCEL_REQUESTED','MANUAL_REVIEW')) OR
    (OLD.status = 'WAITING_FOR_MODEL' AND NEW.status IN ('RUNNING','FAILED','CANCEL_REQUESTED','MANUAL_REVIEW')) OR
    (OLD.status = 'WAITING_FOR_TOOL' AND NEW.status IN ('RUNNING','WAITING_FOR_MCP_INPUT','WAITING_FOR_MCP_TASK','FAILED','CANCEL_REQUESTED','MANUAL_REVIEW')) OR
    (OLD.status = 'WAITING_FOR_MCP_INPUT' AND NEW.status IN ('RUNNING','FAILED','CANCEL_REQUESTED')) OR
    (OLD.status IN ('WAITING_FOR_MCP_TASK','WAITING_FOR_AGENT') AND NEW.status IN ('RUNNING','FAILED','CANCEL_REQUESTED','MANUAL_REVIEW')) OR
    (OLD.status IN ('WAITING_FOR_OWNER','CHALLENGE_REQUIRED') AND NEW.status IN ('RUNNING','FAILED','CANCEL_REQUESTED')) OR
    (OLD.status = 'PAUSED' AND NEW.status IN ('RUNNING','CANCEL_REQUESTED','FAILED')) OR
    (OLD.status = 'CANCEL_REQUESTED' AND NEW.status IN ('CANCELLED','MANUAL_REVIEW')) OR
    (OLD.status = 'MANUAL_REVIEW' AND NEW.status IN ('RUNNING','FAILED','CANCELLED'));
  IF NOT v_allowed THEN RAISE EXCEPTION 'invalid agent_run lifecycle transition % -> %', OLD.status, NEW.status USING ERRCODE = '23514'; END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION kcml.guard_operation_context_lifecycle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_allowed boolean := false;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'operation_context hard delete is forbidden' USING ERRCODE = '55000'; END IF;
  IF NEW.state_version <= OLD.state_version THEN RAISE EXCEPTION 'state_version must increase' USING ERRCODE = '40001'; END IF;
  IF OLD.state IN ('TERMINAL','INVALIDATED') THEN RAISE EXCEPTION 'operation_context terminal row is immutable' USING ERRCODE = '55000'; END IF;
  IF ROW(NEW.authority_lineage_id,NEW.authority_lineage_digest,NEW.operation_intent_id,NEW.operation_intent_digest,NEW.canonical_payload,NEW.context_digest,NEW.provenance_manifest_digest)
     IS DISTINCT FROM ROW(OLD.authority_lineage_id,OLD.authority_lineage_digest,OLD.operation_intent_id,OLD.operation_intent_digest,OLD.canonical_payload,OLD.context_digest,OLD.provenance_manifest_digest) THEN
    RAISE EXCEPTION 'operation_context canonical meaning is immutable' USING ERRCODE = '55000';
  END IF;
  v_allowed := OLD.state = NEW.state OR
    (OLD.state = 'COMPILED' AND NEW.state IN ('VALIDATED','INVALIDATED')) OR
    (OLD.state = 'VALIDATED' AND NEW.state IN ('DISPATCH_RESERVED','INVALIDATED')) OR
    (OLD.state = 'DISPATCH_RESERVED' AND NEW.state IN ('DISPATCHED','MANUAL_REVIEW','INVALIDATED')) OR
    (OLD.state = 'DISPATCHED' AND NEW.state IN ('TERMINAL','MANUAL_REVIEW')) OR
    (OLD.state = 'MANUAL_REVIEW' AND NEW.state IN ('DISPATCH_RESERVED','TERMINAL','INVALIDATED'));
  IF NOT v_allowed THEN RAISE EXCEPTION 'invalid operation_context lifecycle transition % -> %', OLD.state, NEW.state USING ERRCODE = '23514'; END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;


CREATE OR REPLACE FUNCTION kcml.protect_secret_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'secret_version is immutable' USING ERRCODE = '55000';
  END IF;
  IF ROW(NEW.id,NEW.secret_id,NEW.version_number,NEW.ciphertext,NEW.nonce,NEW.auth_tag,NEW.algorithm,NEW.key_id,NEW.fingerprint,NEW.value_digest,NEW.created_at,NEW.created_by)
     IS DISTINCT FROM
     ROW(OLD.id,OLD.secret_id,OLD.version_number,OLD.ciphertext,OLD.nonce,OLD.auth_tag,OLD.algorithm,OLD.key_id,OLD.fingerprint,OLD.value_digest,OLD.created_at,OLD.created_by) THEN
    RAISE EXCEPTION 'secret_version cryptographic material is immutable' USING ERRCODE = '55000';
  END IF;
  IF NOT ((OLD.lifecycle = 'CREATED' AND NEW.lifecycle IN ('CREATED','ACTIVE','RETIRED')) OR
          (OLD.lifecycle = 'ACTIVE' AND NEW.lifecycle IN ('ACTIVE','RETIRED')) OR
          (OLD.lifecycle = 'RETIRED' AND NEW.lifecycle = 'RETIRED')) THEN
    RAISE EXCEPTION 'invalid secret_version lifecycle transition % -> %', OLD.lifecycle, NEW.lifecycle USING ERRCODE = '23514';
  END IF;
  IF NEW.lifecycle = 'ACTIVE' AND NEW.activated_at IS NULL THEN NEW.activated_at := clock_timestamp(); END IF;
  IF NEW.lifecycle = 'RETIRED' AND NEW.retired_at IS NULL THEN NEW.retired_at := clock_timestamp(); END IF;
  IF OLD.lifecycle = 'RETIRED' AND NEW.retired_at IS DISTINCT FROM OLD.retired_at THEN
    RAISE EXCEPTION 'retired secret_version timestamp is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION kcml.protect_singleton() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW.singleton_key <> 1 OR OLD.singleton_key <> NEW.singleton_key THEN
    RAISE EXCEPTION '% singleton identity is immutable', TG_TABLE_NAME USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION kcml.canonical_digest(value bytea) RETURNS bytea
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$ SELECT public.digest(value, 'sha256') $$;

CREATE TABLE IF NOT EXISTS kcml.platform_incarnation (
  singleton_key smallint PRIMARY KEY DEFAULT 1 CHECK (singleton_key = 1),
  platform_incarnation_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  incarnation_sequence bigint NOT NULL DEFAULT 1 CHECK (incarnation_sequence > 0),
  reason text NOT NULL DEFAULT 'GREENFIELD_BOOTSTRAP',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0)
);

CREATE TABLE IF NOT EXISTS kcml.application_deployment_head (
  singleton_key smallint PRIMARY KEY DEFAULT 1 CHECK (singleton_key = 1),
  current_epoch bigint NOT NULL DEFAULT 0 CHECK (current_epoch >= 0),
  current_release_id text,
  source_sha text CHECK (source_sha IS NULL OR source_sha ~ '^[0-9a-f]{40}$'),
  deployment_id uuid,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0)
);

CREATE TABLE IF NOT EXISTS kcml.activation_head (
  singleton_key smallint PRIMARY KEY DEFAULT 1 CHECK (singleton_key = 1),
  current_epoch bigint NOT NULL DEFAULT 0 CHECK (current_epoch >= 0),
  current_activation_set_id uuid,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0)
);

CREATE TABLE IF NOT EXISTS kcml.audit_head (
  singleton_key smallint PRIMARY KEY DEFAULT 1 CHECK (singleton_key = 1),
  last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  last_hash bytea NOT NULL DEFAULT decode(repeat('00', 32), 'hex') CHECK (octet_length(last_hash) = 32),
  chain_format_version integer NOT NULL DEFAULT 1 CHECK (chain_format_version = 1),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0)
);

CREATE TABLE IF NOT EXISTS kcml.owner_identity (
  singleton_key smallint PRIMARY KEY DEFAULT 1 CHECK (singleton_key = 1),
  id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  username citext NOT NULL UNIQUE DEFAULT 'KRMAR78' CHECK (username::text = 'KRMAR78'),
  password_hash text,
  password_source text NOT NULL DEFAULT 'GITHUB_ACTIONS_PASS' CHECK (password_source = 'GITHUB_ACTIONS_PASS'),
  mfa_enabled boolean NOT NULL DEFAULT false,
  mfa_secret_ciphertext bytea,
  mfa_secret_nonce bytea,
  session_epoch bigint NOT NULL DEFAULT 1 CHECK (session_epoch > 0),
  deployment_managed boolean NOT NULL DEFAULT true CHECK (deployment_managed),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  password_changed_at timestamptz,
  last_login_at timestamptz,
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  platform_incarnation_id uuid NOT NULL,
  application_deployment_epoch bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kcml.owner_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_identity_id uuid NOT NULL REFERENCES kcml.owner_identity(id),
  lookup_digest bytea NOT NULL UNIQUE CHECK (octet_length(lookup_digest) = 32),
  session_hash bytea NOT NULL CHECK (octet_length(session_hash) = 32),
  csrf_digest bytea NOT NULL CHECK (octet_length(csrf_digest) = 32),
  session_epoch bigint NOT NULL,
  mfa_verified boolean NOT NULL DEFAULT false,
  trusted_device_id uuid,
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reauthenticated_at timestamptz,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS owner_session_active_idx ON kcml.owner_session(expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS kcml.owner_recovery_code (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_identity_id uuid NOT NULL REFERENCES kcml.owner_identity(id),
  code_hash bytea NOT NULL UNIQUE CHECK (octet_length(code_hash) = 32),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  consumed_at timestamptz
);

CREATE TABLE IF NOT EXISTS kcml.owner_login_throttle (
  attempt_key_digest bytea PRIMARY KEY CHECK (octet_length(attempt_key_digest) = 32),
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  first_failure_at timestamptz,
  last_failure_at timestamptz,
  locked_until timestamptz,
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0)
);
CREATE INDEX IF NOT EXISTS owner_login_throttle_lock_idx ON kcml.owner_login_throttle(locked_until) WHERE locked_until IS NOT NULL;

CREATE TABLE IF NOT EXISTS kcml.owner_mfa_enrollment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_identity_id uuid NOT NULL REFERENCES kcml.owner_identity(id) ON DELETE CASCADE,
  enrollment_token_digest bytea NOT NULL UNIQUE CHECK (octet_length(enrollment_token_digest) = 32),
  seed_ciphertext bytea NOT NULL,
  seed_nonce bytea NOT NULL CHECK (octet_length(seed_nonce) = 12),
  seed_auth_tag bytea NOT NULL CHECK (octet_length(seed_auth_tag) = 16),
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS owner_mfa_enrollment_active_idx ON kcml.owner_mfa_enrollment(owner_identity_id, expires_at DESC) WHERE verified_at IS NULL;

CREATE TABLE IF NOT EXISTS kcml.secret_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stable_name text NOT NULL UNIQUE CHECK (stable_name ~ '^[A-Z][A-Z0-9_]{1,127}$'),
  display_name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('PASSWORD','API_KEY','TOKEN','TOTP','CERTIFICATE','PRIVATE_KEY','OPAQUE')),
  lifecycle text NOT NULL DEFAULT 'ACTIVE' CHECK (lifecycle IN ('ACTIVE','CLOSED')),
  active_version_id uuid,
  secret_activation_epoch bigint NOT NULL DEFAULT 0 CHECK (secret_activation_epoch >= 0),
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  platform_incarnation_id uuid NOT NULL,
  application_deployment_epoch bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS secret_record_active_idx ON kcml.secret_record(stable_name) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS kcml.secret_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  secret_id uuid NOT NULL REFERENCES kcml.secret_record(id) ON DELETE RESTRICT,
  version_number bigint NOT NULL CHECK (version_number > 0),
  ciphertext bytea NOT NULL,
  nonce bytea NOT NULL CHECK (octet_length(nonce) = 12),
  auth_tag bytea NOT NULL CHECK (octet_length(auth_tag) = 16),
  algorithm text NOT NULL DEFAULT 'AES-256-GCM' CHECK (algorithm = 'AES-256-GCM'),
  key_id text NOT NULL,
  fingerprint text NOT NULL,
  value_digest bytea NOT NULL CHECK (octet_length(value_digest) = 32),
  lifecycle text NOT NULL DEFAULT 'CREATED' CHECK (lifecycle IN ('CREATED','ACTIVE','RETIRED')),
  activated_at timestamptz,
  retired_at timestamptz,
  activation_logical_operation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by uuid NOT NULL,
  CHECK ((lifecycle <> 'ACTIVE') OR activated_at IS NOT NULL),
  CHECK ((lifecycle <> 'RETIRED') OR retired_at IS NOT NULL),
  UNIQUE (secret_id, version_number),
  UNIQUE (secret_id, id)
);
ALTER TABLE kcml.secret_record DROP CONSTRAINT IF EXISTS secret_record_active_version_fk;
ALTER TABLE kcml.secret_record ADD CONSTRAINT secret_record_active_version_fk
  FOREIGN KEY (id, active_version_id) REFERENCES kcml.secret_version(secret_id, id) DEFERRABLE INITIALLY DEFERRED;

CREATE UNIQUE INDEX IF NOT EXISTS secret_version_one_active_uq ON kcml.secret_version(secret_id) WHERE lifecycle = 'ACTIVE';
DROP TRIGGER IF EXISTS protect_secret_version_row ON kcml.secret_version;
DROP TRIGGER IF EXISTS protect_secret_version_row ON kcml.secret_version;
CREATE TRIGGER protect_secret_version_row BEFORE UPDATE OR DELETE ON kcml.secret_version FOR EACH ROW EXECUTE FUNCTION kcml.protect_secret_version();

CREATE TABLE IF NOT EXISTS kcml.owner_api_credential (
  singleton_key smallint PRIMARY KEY DEFAULT 1 CHECK (singleton_key = 1),
  id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  stable_name text NOT NULL DEFAULT 'KCML_OWNER_API_KEY' CHECK (stable_name = 'KCML_OWNER_API_KEY'),
  secret_id uuid,
  secret_version_id uuid,
  verifier_hash bytea CHECK (verifier_hash IS NULL OR octet_length(verifier_hash) = 32),
  fingerprint text,
  credential_version bigint NOT NULL DEFAULT 0 CHECK (credential_version >= 0),
  credential_activation_epoch bigint NOT NULL DEFAULT 0 CHECK (credential_activation_epoch >= 0),
  last_rotate_logical_operation uuid,
  last_rotate_outcome_digest bytea,
  last_used_at timestamptz,
  last_usage_metadata jsonb NOT NULL DEFAULT '{}',
  audit_correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  rotated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  FOREIGN KEY (secret_id, secret_version_id) REFERENCES kcml.secret_version(secret_id, id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE IF NOT EXISTS kcml.domain_idempotency_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_digest bytea NOT NULL CHECK (octet_length(scope_digest) = 32),
  key_digest bytea NOT NULL CHECK (octet_length(key_digest) = 32),
  canonical_key text NOT NULL CHECK (length(canonical_key) BETWEEN 1 AND 256),
  request_digest bytea NOT NULL CHECK (octet_length(request_digest) = 32),
  logical_operation_id uuid NOT NULL,
  command_id uuid NOT NULL,
  lifecycle text NOT NULL DEFAULT 'RESERVED' CHECK (lifecycle IN ('RESERVED','EXECUTING','WAITING_FOR_INPUT','WAITING_FOR_RECONCILIATION','SUCCEEDED','FAILED_FINAL','CANCELLED_FINAL','MANUAL_REVIEW')),
  response_status integer,
  response_body jsonb,
  response_digest bytea CHECK (response_digest IS NULL OR octet_length(response_digest) = 32),
  terminal_outcome_digest bytea CHECK (terminal_outcome_digest IS NULL OR octet_length(terminal_outcome_digest) = 32),
  original_attempt integer NOT NULL DEFAULT 1 CHECK (original_attempt > 0),
  current_attempt integer NOT NULL DEFAULT 1 CHECK (current_attempt >= original_attempt),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  expires_at timestamptz NOT NULL,
  UNIQUE (scope_digest, key_digest),
  UNIQUE (logical_operation_id),
  UNIQUE (command_id),
  CHECK ((completed_at IS NULL) = (lifecycle NOT IN ('SUCCEEDED','FAILED_FINAL','CANCELLED_FINAL'))),
  CHECK (expires_at > created_at)
);

CREATE TABLE IF NOT EXISTS kcml.domain_command (
  id uuid PRIMARY KEY,
  logical_operation_id uuid NOT NULL,
  operation_name text NOT NULL,
  operation_revision integer NOT NULL DEFAULT 1 CHECK (operation_revision > 0),
  target_id uuid,
  caller_fingerprint text NOT NULL,
  request_canonical_bytes bytea NOT NULL,
  request jsonb NOT NULL,
  request_digest bytea NOT NULL CHECK (request_digest = kcml.canonical_digest(request_canonical_bytes)),
  expected_state_version bigint,
  expected_activation_epoch bigint,
  status text NOT NULL DEFAULT 'ACCEPTED' CHECK (status IN ('ACCEPTED','RUNNING','WAITING','SUCCEEDED','FAILED_FINAL','CANCELLED_FINAL','MANUAL_REVIEW')),
  result jsonb,
  error jsonb,
  correlation_id uuid NOT NULL,
  causation_id uuid,
  cancellation_version bigint NOT NULL DEFAULT 0,
  deadline_at timestamptz,
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  activation_epoch bigint NOT NULL,
  platform_incarnation_id uuid NOT NULL,
  application_deployment_epoch bigint NOT NULL,
  recovery_epoch bigint NOT NULL DEFAULT 1 CHECK (recovery_epoch > 0),
  concurrency_claim_id uuid,
  concurrency_fencing_token bigint CHECK (concurrency_fencing_token IS NULL OR concurrency_fencing_token > 0),
  UNIQUE (logical_operation_id)
);
CREATE INDEX IF NOT EXISTS domain_command_target_idx ON kcml.domain_command(target_id, accepted_at DESC);

CREATE TABLE IF NOT EXISTS kcml.activation_domain_head (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_key text NOT NULL UNIQUE,
  current_activation_epoch bigint NOT NULL DEFAULT 0,
  barrier_state text NOT NULL DEFAULT 'OPEN' CHECK (barrier_state IN ('OPEN','CLOSING','CLOSED','OPENING','MANUAL_REVIEW')),
  pending_mutating_operation_count bigint NOT NULL DEFAULT 0 CHECK (pending_mutating_operation_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1,
  platform_incarnation_id uuid NOT NULL,
  application_deployment_epoch bigint NOT NULL,
  recovery_epoch bigint NOT NULL DEFAULT 1 CHECK (recovery_epoch > 0)
);

CREATE TABLE IF NOT EXISTS kcml.queue_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_name text NOT NULL,
  partition_key text NOT NULL,
  command_id uuid REFERENCES kcml.domain_command(id),
  payload jsonb NOT NULL,
  priority integer NOT NULL DEFAULT 100,
  status text NOT NULL DEFAULT 'READY' CHECK (status IN ('READY','CLAIMED','SUCCEEDED','FAILED_FINAL','CANCELLED_FINAL','DEAD_LETTER')),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 8 CHECK (max_attempts > 0),
  lease_owner uuid,
  lease_fencing_token bigint NOT NULL DEFAULT 0 CHECK (lease_fencing_token >= 0),
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  platform_incarnation_id uuid NOT NULL,
  application_deployment_epoch bigint NOT NULL,
  recovery_epoch bigint NOT NULL DEFAULT 1 CHECK (recovery_epoch > 0),
  concurrency_claim_id uuid,
  concurrency_fencing_token bigint CHECK (concurrency_fencing_token IS NULL OR concurrency_fencing_token > 0)
);
CREATE INDEX IF NOT EXISTS queue_claim_idx ON kcml.queue_item(queue_name, priority, available_at, id) WHERE status = 'READY';
CREATE UNIQUE INDEX IF NOT EXISTS queue_command_active_uq ON kcml.queue_item(command_id) WHERE command_id IS NOT NULL AND status IN ('READY','CLAIMED');

CREATE TABLE IF NOT EXISTS kcml.concurrency_claim (
  id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  scope_kind text NOT NULL,
  scope_key text NOT NULL,
  scope_key_digest bytea NOT NULL CHECK (octet_length(scope_key_digest) = 32),
  logical_operation_id uuid NOT NULL,
  owner_instance_id uuid NOT NULL,
  fencing_token bigint NOT NULL,
  acquired_at timestamptz NOT NULL,
  heartbeat_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  released_at timestamptz,
  state_version bigint NOT NULL DEFAULT 1,
  platform_incarnation_id uuid NOT NULL,
  application_deployment_epoch bigint NOT NULL,
  recovery_epoch bigint NOT NULL DEFAULT 1 CHECK (recovery_epoch > 0),
  PRIMARY KEY (scope_kind, scope_key_digest)
);
CREATE UNIQUE INDEX IF NOT EXISTS concurrency_claim_scope_uq ON kcml.concurrency_claim(scope_kind, scope_key);

CREATE TABLE IF NOT EXISTS kcml.sequence_allocator (
  sequence_namespace text NOT NULL,
  parent_uuid uuid NOT NULL,
  sequence_kind text NOT NULL,
  last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (sequence_namespace, parent_uuid, sequence_kind)
);

CREATE TABLE IF NOT EXISTS kcml.transactional_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_key text NOT NULL,
  stream_sequence bigint NOT NULL CHECK (stream_sequence > 0),
  purpose text NOT NULL,
  event_type text NOT NULL,
  aggregate_id uuid,
  payload jsonb NOT NULL,
  payload_digest bytea NOT NULL,
  is_dispatch_authority boolean NOT NULL DEFAULT false,
  side_effect_operation_id uuid,
  side_effect_attempt_sequence bigint,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CLAIMED','DELIVERED','FAILED_FINAL')),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  delivery_owner uuid,
  delivery_fencing_token bigint NOT NULL DEFAULT 0,
  delivery_lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  delivered_at timestamptz,
  state_version bigint NOT NULL DEFAULT 1,
  recovery_epoch bigint NOT NULL DEFAULT 1 CHECK (recovery_epoch > 0),
  UNIQUE (stream_key, stream_sequence),
  UNIQUE (side_effect_operation_id, side_effect_attempt_sequence, id)
);
CREATE INDEX IF NOT EXISTS outbox_pending_idx ON kcml.transactional_outbox(available_at, id) WHERE status = 'PENDING';
CREATE UNIQUE INDEX IF NOT EXISTS outbox_dispatch_authority_uq ON kcml.transactional_outbox(side_effect_operation_id, side_effect_attempt_sequence)
  WHERE purpose = 'SIDE_EFFECT_DISPATCH' AND is_dispatch_authority;

CREATE TABLE IF NOT EXISTS kcml.transactional_inbox (
  consumer_id text NOT NULL,
  event_id uuid NOT NULL,
  stream_key text NOT NULL,
  stream_sequence bigint NOT NULL,
  payload_digest bytea NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (consumer_id, event_id),
  UNIQUE (consumer_id, stream_key, stream_sequence)
);

CREATE TABLE IF NOT EXISTS kcml.side_effect_operation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id uuid NOT NULL REFERENCES kcml.domain_command(id),
  step_key text NOT NULL,
  target_binding text NOT NULL,
  request jsonb NOT NULL,
  request_digest bytea NOT NULL,
  idempotency_key text NOT NULL,
  side_effect_class text NOT NULL,
  retry_class text NOT NULL,
  reconciliation_contract jsonb NOT NULL,
  compensation_contract jsonb,
  compensates_operation_id uuid REFERENCES kcml.side_effect_operation(id),
  current_attempt_sequence bigint NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'INTENT_RECORDED' CHECK (status IN ('INTENT_RECORDED','DISPATCHING','OUTCOME_RECORDED','RECONCILING','CONFIRMED_APPLIED','CONFIRMED_NOT_APPLIED','FAILED_FINAL','UNKNOWN')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1,
  platform_incarnation_id uuid NOT NULL,
  application_deployment_epoch bigint NOT NULL,
  recovery_epoch bigint NOT NULL DEFAULT 1 CHECK (recovery_epoch > 0),
  UNIQUE(command_id, step_key)
);

CREATE TABLE IF NOT EXISTS kcml.side_effect_attempt (
  operation_id uuid NOT NULL REFERENCES kcml.side_effect_operation(id),
  attempt_sequence bigint NOT NULL,
  request_evidence jsonb NOT NULL,
  request_digest bytea NOT NULL,
  dispatch_authority_outbox_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (operation_id, attempt_sequence),
  FOREIGN KEY (operation_id, attempt_sequence, dispatch_authority_outbox_id)
    REFERENCES kcml.transactional_outbox(side_effect_operation_id, side_effect_attempt_sequence, id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE IF NOT EXISTS kcml.side_effect_attempt_state (
  operation_id uuid NOT NULL,
  attempt_sequence bigint NOT NULL,
  status text NOT NULL DEFAULT 'INTENT_RECORDED' CHECK (status IN ('INTENT_RECORDED','DISPATCHING','OUTCOME_RECORDED','RECONCILING','CONFIRMED_APPLIED','CONFIRMED_NOT_APPLIED','FAILED_FINAL','UNKNOWN')),
  adapter_request_id text,
  provider_request_id text,
  last_evidence_sequence bigint NOT NULL DEFAULT 0,
  min_dispatch_authority_window interval NOT NULL DEFAULT interval '45 seconds' CHECK (min_dispatch_authority_window >= interval '5 seconds'),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (operation_id, attempt_sequence),
  FOREIGN KEY (operation_id, attempt_sequence) REFERENCES kcml.side_effect_attempt(operation_id, attempt_sequence)
);

CREATE TABLE IF NOT EXISTS kcml.side_effect_attempt_evidence (
  operation_id uuid NOT NULL,
  attempt_sequence bigint NOT NULL,
  evidence_sequence bigint NOT NULL,
  evidence_type text NOT NULL,
  payload jsonb NOT NULL,
  payload_digest bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(operation_id, attempt_sequence, evidence_sequence),
  FOREIGN KEY(operation_id, attempt_sequence) REFERENCES kcml.side_effect_attempt(operation_id, attempt_sequence)
);

CREATE TABLE IF NOT EXISTS kcml.audit_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_sequence bigint NOT NULL UNIQUE CHECK (chain_sequence > 0),
  event_type text NOT NULL,
  actor_kind text NOT NULL,
  actor_id text NOT NULL,
  aggregate_type text,
  aggregate_id uuid,
  correlation_id uuid NOT NULL,
  causation_id uuid,
  payload jsonb NOT NULL,
  payload_canonical_bytes bytea NOT NULL,
  payload_digest bytea NOT NULL CHECK (payload_digest = kcml.canonical_digest(payload_canonical_bytes)),
  previous_hash bytea NOT NULL CHECK (octet_length(previous_hash) = 32),
  event_hash bytea NOT NULL CHECK (octet_length(event_hash) = 32),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS audit_event_correlation_idx ON kcml.audit_event(correlation_id, chain_sequence);

CREATE OR REPLACE FUNCTION kcml.append_audit_event(
  p_event_type text, p_actor_kind text, p_actor_id text, p_aggregate_type text,
  p_aggregate_id uuid, p_correlation_id uuid, p_causation_id uuid,
  p_payload jsonb, p_payload_canonical_bytes bytea
) RETURNS TABLE(event_id uuid, chain_sequence bigint, event_hash bytea)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = kcml, pg_temp AS $$
DECLARE
  v_head kcml.audit_head%ROWTYPE;
  v_id uuid := gen_random_uuid();
  v_sequence bigint;
  v_payload_digest bytea := public.digest(p_payload_canonical_bytes, 'sha256');
  v_event_hash bytea;
BEGIN
  SELECT * INTO STRICT v_head FROM kcml.audit_head WHERE singleton_key = 1 FOR UPDATE;
  v_sequence := v_head.last_sequence + 1;
  v_event_hash := public.digest(v_head.last_hash || int8send(v_sequence) || convert_to(p_event_type, 'UTF8') || v_payload_digest, 'sha256');
  INSERT INTO kcml.audit_event(id, chain_sequence, event_type, actor_kind, actor_id, aggregate_type, aggregate_id,
    correlation_id, causation_id, payload, payload_canonical_bytes, payload_digest, previous_hash, event_hash)
  VALUES (v_id, v_sequence, p_event_type, p_actor_kind, p_actor_id, p_aggregate_type, p_aggregate_id,
    p_correlation_id, p_causation_id, p_payload, p_payload_canonical_bytes, v_payload_digest, v_head.last_hash, v_event_hash);
  UPDATE kcml.audit_head SET last_sequence = v_sequence, last_hash = v_event_hash,
    updated_at = clock_timestamp(), state_version = state_version + 1 WHERE singleton_key = 1;
  RETURN QUERY SELECT v_id, v_sequence, v_event_hash;
END $$;

CREATE TABLE IF NOT EXISTS kcml.binding_set (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_kind text NOT NULL CHECK (owner_kind IN ('COMPONENT','AGENT_DEFINITION','BROWSER_AUTOMATION_DEFINITION')),
  owner_id uuid NOT NULL,
  current_revision_id uuid,
  activation_epoch bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1,
  platform_incarnation_id uuid NOT NULL,
  application_deployment_epoch bigint NOT NULL,
  UNIQUE(owner_kind, owner_id)
);

CREATE TABLE IF NOT EXISTS kcml.binding_set_revision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  binding_set_id uuid NOT NULL REFERENCES kcml.binding_set(id),
  revision_number bigint NOT NULL,
  canonical_bytes bytea NOT NULL,
  document jsonb NOT NULL,
  canonical_digest bytea NOT NULL CHECK (canonical_digest = kcml.canonical_digest(canonical_bytes)),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by uuid NOT NULL,
  UNIQUE(binding_set_id, revision_number),
  UNIQUE(binding_set_id, id)
);

CREATE TABLE IF NOT EXISTS kcml.binding_set_member (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_parent_uuid uuid NOT NULL,
  revision_id uuid NOT NULL REFERENCES kcml.binding_set_revision(id),
  member_kind text NOT NULL,
  source_identity jsonb NOT NULL,
  target_identity jsonb NOT NULL,
  operation_name text NOT NULL,
  purpose text NOT NULL,
  exact_digest bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(revision_id, member_kind, operation_name, purpose, exact_digest)
);

CREATE TABLE IF NOT EXISTS kcml.application_release (
  id text PRIMARY KEY,
  source_sha text NOT NULL CHECK (source_sha ~ '^[0-9a-f]{40}$'),
  bundle_digest bytea NOT NULL CHECK (octet_length(bundle_digest) = 32),
  manifest jsonb NOT NULL,
  signature bytea NOT NULL,
  signer_fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS kcml.generation_activation_set (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT','READY','SWITCHING','VERIFYING','ACTIVE','ROLLING_BACK','ROLLBACK_VERIFYING','ROLLED_BACK','FAILED','MANUAL_REVIEW')),
  previous_snapshot jsonb NOT NULL,
  candidate_snapshot jsonb NOT NULL,
  membership jsonb NOT NULL,
  rollback_plan jsonb NOT NULL,
  activation_epoch bigint,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1,
  platform_incarnation_id uuid NOT NULL,
  application_deployment_epoch bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS kcml.runtime_instance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  runtime_generation bigint NOT NULL CHECK (runtime_generation > 0),
  component_id uuid NOT NULL,
  runtime_target_id uuid NOT NULL,
  source_revision_id uuid NOT NULL,
  release_id uuid NOT NULL,
  artifact_digest bytea NOT NULL,
  runtime_digest bytea NOT NULL,
  dependency_lock_digest bytea NOT NULL,
  binding_set_revision_id uuid NOT NULL,
  activation_epoch bigint NOT NULL CHECK (activation_epoch >= 0),
  platform_incarnation_id uuid NOT NULL,
  application_deployment_epoch bigint NOT NULL CHECK (application_deployment_epoch >= 0),
  desired_state text NOT NULL CHECK (desired_state IN ('STOPPED','STARTING','READY','DRAINING','RESTARTING')),
  effective_state text NOT NULL CHECK (effective_state IN ('ABSENT','STARTING','READY','DRAINING','STOPPED','FAILED','UNKNOWN')),
  systemd_unit_name text NOT NULL,
  expected_service_class text NOT NULL,
  launch_manifest_digest bytea NOT NULL,
  systemd_invocation_id uuid,
  host_boot_id uuid,
  main_pid integer CHECK (main_pid IS NULL OR main_pid > 0),
  process_start_ticks bigint CHECK (process_start_ticks IS NULL OR process_start_ticks >= 0),
  linux_uid integer NOT NULL CHECK (linux_uid >= 0),
  linux_gid integer NOT NULL CHECK (linux_gid >= 0),
  cgroup_path text NOT NULL,
  resource_profile_digest bytea NOT NULL,
  namespace_profile_digest bytea NOT NULL,
  seccomp_profile_digest bytea NOT NULL,
  environment_profile_digest bytea NOT NULL,
  fd_profile_digest bytea NOT NULL,
  runtime_gateway_connection_id uuid,
  ready_sequence bigint NOT NULL DEFAULT 0 CHECK (ready_sequence >= 0),
  heartbeat_sequence bigint NOT NULL DEFAULT 0 CHECK (heartbeat_sequence >= 0),
  effective_at timestamptz,
  drain_logical_operation_id uuid,
  stop_logical_operation_id uuid,
  restart_logical_operation_id uuid,
  cleanup_logical_operation_id uuid,
  terminal_cleanup_state text NOT NULL DEFAULT 'NOT_STARTED',
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  stopped_at timestamptz,
  heartbeat_at timestamptz,
  state_version bigint NOT NULL DEFAULT 1,
  canonical_digest bytea NOT NULL,
  correlation_id uuid,
  UNIQUE(component_id, runtime_generation),
  UNIQUE(id, runtime_generation)
);

CREATE TABLE IF NOT EXISTS kcml.platform_worker_heartbeat (
  service_name text NOT NULL,
  instance_id uuid NOT NULL,
  release_id text NOT NULL,
  source_sha text NOT NULL,
  deployment_epoch bigint NOT NULL,
  platform_incarnation_id uuid NOT NULL,
  heartbeat_sequence bigint NOT NULL CHECK (heartbeat_sequence > 0),
  nonce text NOT NULL CHECK (length(nonce) > 0),
  status text NOT NULL CHECK (status IN ('STARTING','READY','DEGRADED','DRAINING','FAILED')),
  details jsonb NOT NULL DEFAULT '{}',
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > observed_at),
  PRIMARY KEY(service_name, instance_id)
);
CREATE INDEX IF NOT EXISTS service_heartbeat_fresh_idx ON kcml.platform_worker_heartbeat(service_name, expires_at DESC);

CREATE TABLE IF NOT EXISTS kcml.mcp_call_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_event_id uuid NOT NULL,
  logical_operation_id uuid NOT NULL,
  idempotency_record_id uuid,
  server_component_id uuid NOT NULL,
  tool_key text,
  server_revision_id uuid NOT NULL,
  server_contract_digest bytea NOT NULL,
  source_execution_context_id uuid,
  binding_decision jsonb NOT NULL,
  canonical_arguments jsonb NOT NULL,
  arguments_digest bytea NOT NULL,
  native_input_schema_digest bytea,
  native_output_schema_digest bytea,
  openai_projection_digest bytea,
  side_effect_classification text NOT NULL,
  retry_classification text NOT NULL,
  idempotency_classification text NOT NULL,
  concurrency_classification text NOT NULL,
  ordering_classification text NOT NULL,
  idempotency_key text,
  concurrency_claim jsonb,
  state text NOT NULL DEFAULT 'RECEIVED' CHECK (state IN ('RECEIVED','CLAIMED','EXECUTING','WAITING_FOR_INPUT','WAITING_FOR_TASK','RECONCILING','CANCEL_REQUESTED','SUCCEEDED','FAILED','CANCELLED','MANUAL_REVIEW')),
  platform_incarnation_id uuid NOT NULL,
  application_deployment_epoch bigint NOT NULL CHECK (application_deployment_epoch >= 0),
  activation_epoch bigint NOT NULL CHECK (activation_epoch >= 0),
  lease_owner uuid,
  lease_fencing_token bigint,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  cancellation_version bigint NOT NULL DEFAULT 0 CHECK (cancellation_version >= 0),
  latest_checkpoint_id uuid,
  side_effect_operation_ids uuid[] NOT NULL DEFAULT '{}',
  reconciliation_outcome jsonb,
  effective_deadline_at timestamptz NOT NULL,
  idle_timeout_ms bigint NOT NULL CHECK (idle_timeout_ms > 0),
  started_at timestamptz,
  raw_attempt_output jsonb,
  raw_attempt_output_digest bytea,
  structured_result jsonb,
  structured_content jsonb,
  result_digest bytea,
  jsonrpc_error jsonb,
  tool_error jsonb,
  retry_directive text,
  audit_event_id uuid,
  correlation_id uuid NOT NULL,
  terminal_response jsonb,
  response_delivery_state text NOT NULL DEFAULT 'NOT_MATERIALIZED',
  canonical_digest bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  state_version bigint NOT NULL DEFAULT 1,
  CHECK ((state IN ('SUCCEEDED','FAILED','CANCELLED')) = (completed_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS kcml.mcp_input_exchange (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_run_id uuid NOT NULL REFERENCES kcml.mcp_call_run(id),
  logical_operation_id uuid NOT NULL,
  exchange_sequence bigint NOT NULL CHECK (exchange_sequence > 0),
  initial_result_request_id text NOT NULL,
  retry_request_event_id uuid,
  input_requests jsonb,
  input_requests_digest bytea,
  request_state_ciphertext bytea,
  request_state_lookup_digest bytea,
  original_method text NOT NULL,
  original_arguments jsonb NOT NULL,
  source_access_context jsonb NOT NULL,
  server_revision_id uuid NOT NULL,
  tool_revision_id uuid NOT NULL,
  binding_set_revision_id uuid NOT NULL,
  activation_epoch bigint NOT NULL CHECK (activation_epoch >= 0),
  contract_digest_snapshot bytea NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PARTIALLY_FULFILLED','FULFILLED','EXPIRED','CONSUMED','INVALIDATED')),
  consume_idempotency_key text,
  expires_at timestamptz NOT NULL,
  fulfilled_at timestamptz,
  consumed_at timestamptz,
  owner_approval_request_id uuid,
  challenge_id uuid,
  current_outcome jsonb,
  terminal_outcome jsonb,
  state_version bigint NOT NULL DEFAULT 1,
  canonical_digest bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (input_requests IS NOT NULL OR request_state_ciphertext IS NOT NULL),
  UNIQUE(call_run_id,exchange_sequence)
);

CREATE TABLE IF NOT EXISTS kcml.mcp_task (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_component_id uuid NOT NULL,
  tool_key text NOT NULL,
  server_revision_id uuid NOT NULL,
  original_call_run_id uuid NOT NULL REFERENCES kcml.mcp_call_run(id),
  public_task_id text NOT NULL UNIQUE,
  lookup_digest bytea NOT NULL UNIQUE,
  logical_operation_id uuid NOT NULL,
  source_execution_context_id uuid,
  access_context jsonb NOT NULL,
  binding_revision bigint NOT NULL,
  activation_epoch bigint NOT NULL CHECK (activation_epoch >= 0),
  original_request_digest bytea NOT NULL,
  idempotency_key text,
  wire_status text NOT NULL CHECK (wire_status IN ('working','input_required','completed','failed','cancelled')),
  state text NOT NULL DEFAULT 'WORKING' CHECK (state IN ('WORKING','INPUT_REQUIRED','COMPLETED','FAILED','CANCELLED')),
  cancellation_intent jsonb,
  cancellation_version bigint NOT NULL DEFAULT 0 CHECK (cancellation_version >= 0),
  expiry_intent jsonb,
  platform_incarnation_id uuid NOT NULL,
  application_deployment_epoch bigint NOT NULL CHECK (application_deployment_epoch >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ttl_ms bigint NOT NULL CHECK (ttl_ms > 0),
  expires_at timestamptz NOT NULL,
  poll_interval_ms bigint NOT NULL CHECK (poll_interval_ms > 0),
  latest_checkpoint_id uuid,
  pending_side_effect_ids uuid[] NOT NULL DEFAULT '{}',
  final_method_result jsonb,
  final_jsonrpc_error jsonb,
  final_digest bytea,
  lease_owner uuid,
  lease_fencing_token bigint,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  tombstoned_at timestamptz,
  purged_at timestamptz,
  state_version bigint NOT NULL DEFAULT 1,
  canonical_digest bytea NOT NULL,
  CHECK (expires_at = created_at + (ttl_ms * interval '1 millisecond')),
  CHECK ((state IN ('COMPLETED','FAILED','CANCELLED')) = (final_digest IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS kcml.ai_model_call (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_run_id uuid NOT NULL,
  attempt_sequence bigint NOT NULL,
  model text NOT NULL,
  request_descriptor_id uuid,
  request_descriptor jsonb NOT NULL,
  request_digest bytea NOT NULL,
  input_digest bytea NOT NULL,
  instructions_digest bytea NOT NULL,
  tools_digest bytea NOT NULL,
  schema_digest bytea,
  settings_snapshot jsonb NOT NULL,
  submit_state text NOT NULL DEFAULT 'INTENT_RECORDED' CHECK (submit_state IN ('INTENT_RECORDED','DISPATCH_STARTED','RESPONSE_IDENTIFIED','STREAMING','COMPLETED','FAILED_FINAL','MODEL_SUBMIT_OUTCOME_UNKNOWN')),
  provider_response_id text,
  provider_request_id text,
  output_items jsonb,
  usage jsonb,
  cost_microunits bigint,
  latency_ms bigint,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1,
  UNIQUE(parent_run_id, attempt_sequence)
);

CREATE TABLE IF NOT EXISTS kcml.generation_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL CHECK (mode IN ('CREATE','UPDATE','FOLLOW_UP','RETRY','REPAIR')),
  objective text NOT NULL,
  target_object_ids uuid[] NOT NULL DEFAULT '{}',
  source_artifact_ids uuid[] NOT NULL DEFAULT '{}',
  model text,
  lifecycle text NOT NULL DEFAULT 'INTAKE' CHECK (lifecycle IN ('INTAKE','DISCOVERY','SPECIFICATION','APPROVAL_REQUIRED','PLANNING','IMPLEMENTING','VALIDATING','ACTIVATING','SUCCEEDED','FAILED_FINAL','CANCELLED_FINAL','MANUAL_REVIEW')),
  current_phase text NOT NULL DEFAULT 'INTAKE',
  progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  blocker jsonb,
  active_worker_id uuid,
  lease_fencing_token bigint,
  lease_expires_at timestamptz,
  result_object_id uuid,
  approved_spec_revision_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1,
  activation_epoch bigint NOT NULL DEFAULT 0,
  platform_incarnation_id uuid NOT NULL,
  application_deployment_epoch bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS generation_job_state_idx ON kcml.generation_job(lifecycle, updated_at DESC);

CREATE TABLE IF NOT EXISTS kcml.generation_checkpoint (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_job_id uuid NOT NULL REFERENCES kcml.generation_job(id),
  sequence bigint NOT NULL,
  phase text NOT NULL,
  workspace_revision bigint NOT NULL,
  payload jsonb NOT NULL,
  payload_digest bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(generation_job_id, sequence)
);

CREATE TABLE IF NOT EXISTS kcml.generation_artifact (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_job_id uuid NOT NULL REFERENCES kcml.generation_job(id),
  workspace_revision bigint NOT NULL,
  relative_path text NOT NULL CHECK (relative_path !~ '(^/|\.\.)'),
  content_digest bytea NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  media_type text NOT NULL,
  immutable_storage_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(generation_job_id, workspace_revision, relative_path)
);

CREATE TABLE IF NOT EXISTS kcml.agent_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_definition_id uuid NOT NULL,
  agent_revision_id uuid NOT NULL,
  agent_graph_snapshot_digest bytea NOT NULL,
  tool_snapshot_digest bytea NOT NULL,
  guardrail_snapshot_digest bytea NOT NULL,
  source_execution_context_id uuid,
  trigger_id uuid,
  client_run_id text NOT NULL,
  logical_operation_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('INTERACTIVE','TRIGGERED','EVALUATION','REPAIR')),
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','PREPARING','RUNNING','WAITING_FOR_MODEL','WAITING_FOR_TOOL','WAITING_FOR_MCP_INPUT','WAITING_FOR_MCP_TASK','WAITING_FOR_AGENT','WAITING_FOR_OWNER','CHALLENGE_REQUIRED','PAUSED','SUCCEEDED','FAILED','CANCEL_REQUESTED','CANCELLED','MANUAL_REVIEW')),
  input jsonb NOT NULL,
  input_digest bytea NOT NULL,
  output jsonb,
  output_digest bytea,
  session_id uuid,
  context_snapshot jsonb NOT NULL,
  budget jsonb NOT NULL,
  usage jsonb NOT NULL DEFAULT '{}',
  cost_microunits bigint NOT NULL DEFAULT 0 CHECK (cost_microunits >= 0),
  lease_owner uuid,
  lease_fencing_token bigint,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  cancellation_version bigint NOT NULL DEFAULT 0 CHECK (cancellation_version >= 0),
  latest_checkpoint_id uuid,
  checkpoint_sequence bigint NOT NULL DEFAULT 0 CHECK (checkpoint_sequence >= 0),
  pending_side_effect_ids uuid[] NOT NULL DEFAULT '{}',
  correlation_id uuid NOT NULL,
  trace_id text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  error jsonb,
  manual_review_relation jsonb,
  state_version bigint NOT NULL DEFAULT 1,
  platform_incarnation_id uuid NOT NULL,
  application_deployment_epoch bigint NOT NULL,
  activation_epoch bigint NOT NULL CHECK (activation_epoch >= 0),
  canonical_digest bytea NOT NULL,
  UNIQUE(agent_definition_id,client_run_id),
  UNIQUE(agent_definition_id,idempotency_key),
  CHECK ((status IN ('SUCCEEDED','FAILED','CANCELLED')) = (completed_at IS NOT NULL)),
  CHECK ((status = 'SUCCEEDED') = (output_digest IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS kcml.browser_account_binding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_service text NOT NULL,
  stable_account_key text NOT NULL,
  expected_account text,
  expected_tenant text,
  credential_secret_ids uuid[] NOT NULL DEFAULT '{}',
  active_state_bundle_version_id uuid,
  auth_mode text NOT NULL,
  allowed_origins text[] NOT NULL DEFAULT '{}',
  external_session_family text,
  auth_epoch bigint NOT NULL DEFAULT 0,
  concurrency_mode text NOT NULL CHECK (concurrency_mode IN ('EXCLUSIVE','SHARED_READ','SERIALIZED_MUTATION')),
  expires_at timestamptz,
  last_verified_at timestamptz,
  last_used_at timestamptz,
  last_usage_metadata jsonb NOT NULL DEFAULT '{}',
  audit_correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  rotated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1,
  platform_incarnation_id uuid NOT NULL,
  application_deployment_epoch bigint NOT NULL,
  UNIQUE(target_service, stable_account_key)
);

CREATE TABLE IF NOT EXISTS kcml.browser_state_bundle (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_binding_id uuid NOT NULL REFERENCES kcml.browser_account_binding(id),
  version_number bigint NOT NULL,
  runtime_build_digest bytea NOT NULL,
  encrypted_bundle bytea NOT NULL,
  nonce bytea NOT NULL,
  auth_tag bytea NOT NULL,
  member_inventory jsonb NOT NULL,
  canonical_digest bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(account_binding_id, version_number),
  UNIQUE(account_binding_id, id)
);
ALTER TABLE kcml.browser_account_binding DROP CONSTRAINT IF EXISTS browser_account_active_bundle_fk;
ALTER TABLE kcml.browser_account_binding ADD CONSTRAINT browser_account_active_bundle_fk
  FOREIGN KEY (id, active_state_bundle_version_id) REFERENCES kcml.browser_state_bundle(account_binding_id, id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS kcml.browser_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_kind text NOT NULL,
  parent_id uuid NOT NULL,
  purpose text NOT NULL,
  execution_target text NOT NULL CHECK (execution_target IN ('SERVER_MANAGED','OWNER_DEVICE_BRIDGE')),
  runtime_build_id text NOT NULL,
  host_or_bridge_id uuid,
  account_binding_id uuid REFERENCES kcml.browser_account_binding(id),
  operation_scope jsonb NOT NULL,
  lifecycle text NOT NULL DEFAULT 'CREATING' CHECK (lifecycle IN ('CREATING','READY','AI_CONTROLLED','OWNER_CONTROLLED','AUTOMATION_CONTROLLED','TAKEOVER','WAITING_CHALLENGE','RECONCILING','RECOVERING','CLEANING','CLOSED','FAILED_FINAL','MANUAL_REVIEW')),
  current_url text,
  current_page_id uuid,
  current_frame_id uuid,
  context_generation bigint NOT NULL DEFAULT 0,
  page_generation bigint NOT NULL DEFAULT 0,
  document_epoch bigint NOT NULL DEFAULT 0,
  observation_revision bigint NOT NULL DEFAULT 0,
  control_holder text NOT NULL DEFAULT 'AI' CHECK (control_holder IN ('AI','OWNER','AUTOMATION','NONE')),
  control_epoch bigint NOT NULL DEFAULT 0,
  control_fence bigint NOT NULL DEFAULT 0,
  control_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1,
  platform_incarnation_id uuid NOT NULL,
  application_deployment_epoch bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS kcml.browser_observation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES kcml.browser_session(id),
  observation_revision bigint NOT NULL,
  context_generation bigint NOT NULL,
  page_id uuid NOT NULL,
  page_generation bigint NOT NULL,
  frame_id uuid NOT NULL,
  document_epoch bigint NOT NULL,
  url text NOT NULL,
  title text NOT NULL,
  semantic_snapshot jsonb NOT NULL,
  screenshot_artifact_id uuid,
  network_summary jsonb NOT NULL,
  console_summary jsonb NOT NULL,
  canonical_digest bytea NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(session_id, observation_revision)
);

CREATE TABLE IF NOT EXISTS kcml.browser_target_reference (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES kcml.browser_session(id),
  page_id uuid NOT NULL,
  frame_id uuid NOT NULL,
  document_epoch bigint NOT NULL,
  semantic_description text NOT NULL,
  locator_ast jsonb NOT NULL,
  target_fingerprint bytea NOT NULL,
  created_from_observation_revision bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS kcml.browser_action_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES kcml.browser_session(id),
  logical_operation_id uuid NOT NULL,
  action text NOT NULL,
  target_reference_id uuid REFERENCES kcml.browser_target_reference(id),
  payload jsonb NOT NULL,
  expected_control_epoch bigint NOT NULL,
  expected_document_epoch bigint NOT NULL,
  expected_observation_revision bigint NOT NULL,
  dispatch_phase text NOT NULL DEFAULT 'INTENT_RECORDED' CHECK (dispatch_phase IN ('INTENT_RECORDED','TARGET_RESOLVED','PRECONDITION_VERIFIED','DISPATCH_AUTHORIZED','POSSIBLE_EFFECT','OUTCOME_OBSERVED','RECONCILING','CONFIRMED_APPLIED','CONFIRMED_NOT_APPLIED','FAILED_FINAL','UNKNOWN')),
  earliest_mutation_trigger text,
  side_effect_operation_id uuid REFERENCES kcml.side_effect_operation(id),
  outcome jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1,
  UNIQUE(session_id, logical_operation_id)
);

CREATE TABLE IF NOT EXISTS kcml.browser_local_bridge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_label text NOT NULL,
  os_arch text NOT NULL,
  build_id text NOT NULL,
  certificate_generation bigint NOT NULL,
  certificate_fingerprint text NOT NULL UNIQUE,
  connection_epoch bigint NOT NULL DEFAULT 0,
  negotiated_capabilities jsonb NOT NULL,
  inventory jsonb NOT NULL,
  allowed_local_targets jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('ENROLLED','CONNECTED','DEGRADED','REVOKED')),
  heartbeat_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1,
  platform_incarnation_id uuid NOT NULL,
  application_deployment_epoch bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS kcml.monitoring_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stable_key text NOT NULL UNIQUE,
  definition jsonb NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1,
  platform_incarnation_id uuid NOT NULL,
  application_deployment_epoch bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS kcml.monitoring_probe (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES kcml.monitoring_profile(id),
  status text NOT NULL CHECK (status IN ('HEALTHY','DEGRADED','UNHEALTHY','UNKNOWN')),
  latency_ms bigint,
  evidence jsonb NOT NULL,
  correlation_id uuid NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS kcml.operational_alert (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  source_object_type text NOT NULL,
  source_object_id uuid NOT NULL,
  alert_type text NOT NULL,
  condition_digest bytea NOT NULL CHECK (octet_length(condition_digest) = 32),
  fingerprint text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('WARNING','HIGH','CRITICAL')),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACKNOWLEDGED','SUPPRESSED','CLOSED')),
  title text NOT NULL,
  detail text NOT NULL,
  evidence jsonb NOT NULL,
  correlation_id uuid NOT NULL,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  occurrence_count bigint NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  latest_source_sequence bigint NOT NULL CHECK (latest_source_sequence > 0),
  latest_observation_digest bytea NOT NULL CHECK (octet_length(latest_observation_digest) = 32),
  source_release_id uuid,
  source_activation_epoch bigint NOT NULL CHECK (source_activation_epoch >= 0),
  suppressed_until timestamptz,
  acknowledged_at timestamptz,
  closed_at timestamptz,
  recommended_action jsonb,
  repair_reference text,
  logical_operation_id uuid NOT NULL,
  canonical_digest bytea NOT NULL CHECK (octet_length(canonical_digest) = 32),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1,
  platform_incarnation_id uuid NOT NULL,
  application_deployment_epoch bigint NOT NULL CHECK (application_deployment_epoch >= 0),
  recovery_epoch bigint NOT NULL CHECK (recovery_epoch > 0),
  CHECK (first_seen_at <= last_seen_at),
  CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL)),
  CHECK (status <> 'SUPPRESSED' OR suppressed_until IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS alert_open_fingerprint_uq ON kcml.operational_alert(fingerprint) WHERE status IN ('OPEN','ACKNOWLEDGED','SUPPRESSED');
CREATE INDEX IF NOT EXISTS operational_alert_source_episode_idx ON kcml.operational_alert(source_object_type,source_object_id,alert_type,condition_digest,last_seen_at DESC);

CREATE TABLE IF NOT EXISTS kcml.self_test_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suite_key text NOT NULL,
  run_kind text NOT NULL,
  source_sha text NOT NULL,
  release_id text NOT NULL,
  environment_digest bytea NOT NULL,
  seed bigint,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','PASS','FAIL','CANCELLED','NOT_EXECUTED_ENVIRONMENTAL','MANUAL_REVIEW')),
  started_at timestamptz,
  completed_at timestamptz,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1,
  platform_incarnation_id uuid NOT NULL,
  application_deployment_epoch bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS kcml.self_test_case_result (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_run_id uuid NOT NULL REFERENCES kcml.self_test_run(id),
  sequence bigint NOT NULL,
  evidence_kind text NOT NULL,
  artifact_path text,
  payload jsonb NOT NULL,
  canonical_digest bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(test_run_id, sequence)
);

CREATE TABLE IF NOT EXISTS kcml.operational_setting (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stable_key text NOT NULL UNIQUE,
  category text NOT NULL,
  value jsonb NOT NULL,
  secret_id uuid REFERENCES kcml.secret_record(id),
  affected_services text[] NOT NULL DEFAULT '{}',
  restart_required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1,
  platform_incarnation_id uuid NOT NULL,
  application_deployment_epoch bigint NOT NULL,
  CHECK ((secret_id IS NULL) <> (value = 'null'::jsonb) OR secret_id IS NULL)
);

CREATE TABLE IF NOT EXISTS kcml.deployment_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id text NOT NULL,
  source_sha text NOT NULL CHECK (source_sha ~ '^[0-9a-f]{40}$'),
  previous_release_id text,
  deployment_epoch bigint NOT NULL,
  status text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','PREFLIGHT','BACKUP','MIGRATING','INSTALLING','SWITCHING','VERIFYING','SUCCEEDED','ROLLING_BACK','ROLLED_BACK','FAILED','MANUAL_REVIEW')),
  current_step text NOT NULL DEFAULT 'PLANNED',
  evidence jsonb NOT NULL DEFAULT '{}',
  lease_owner uuid,
  lease_fencing_token bigint,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  state_version bigint NOT NULL DEFAULT 1,
  platform_incarnation_id uuid NOT NULL,
  application_deployment_epoch bigint NOT NULL,
  UNIQUE(deployment_epoch)
);
CREATE UNIQUE INDEX IF NOT EXISTS deployment_run_active_uq ON kcml.deployment_run((true))
  WHERE status NOT IN ('SUCCEEDED','ROLLED_BACK','FAILED','MANUAL_REVIEW');

CREATE TABLE IF NOT EXISTS kcml.schema_migration (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL UNIQUE CHECK (version ~ '^[0-9]{14}$'),
  checksum bytea NOT NULL CHECK (octet_length(checksum) = 32),
  previous_checksum bytea CHECK (previous_checksum IS NULL OR octet_length(previous_checksum) = 32),
  release_id text NOT NULL,
  build_id text NOT NULL,
  deployment_run_id uuid REFERENCES kcml.deployment_run(id),
  phase_plan jsonb NOT NULL CHECK (jsonb_typeof(phase_plan) = 'array'),
  current_phase text NOT NULL CHECK (current_phase IN ('EXPAND','MIGRATE','VALIDATE','ACTIVATE','CONTRACT')),
  state text NOT NULL CHECK (state IN ('PLANNED','RUNNING','APPLIED','FAILED','MANUAL_REVIEW')),
  transaction_mode text NOT NULL CHECK (transaction_mode IN ('TRANSACTIONAL','NON_TRANSACTIONAL_FENCED')),
  lease_owner uuid,
  lease_fencing_token bigint CHECK (lease_fencing_token IS NULL OR lease_fencing_token > 0),
  lease_acquired_at timestamptz,
  lease_expires_at timestamptz,
  platform_incarnation_id uuid NOT NULL,
  application_deployment_epoch bigint NOT NULL CHECK (application_deployment_epoch >= 0),
  checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb,
  cursor jsonb,
  schema_fingerprint bytea CHECK (schema_fingerprint IS NULL OR octet_length(schema_fingerprint) = 32),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  error jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  terminal_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  CHECK ((state IN ('APPLIED','FAILED','MANUAL_REVIEW')) = (terminal_at IS NOT NULL)),
  CHECK (lease_expires_at IS NULL OR lease_acquired_at IS NULL OR lease_expires_at > lease_acquired_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_schema_migration_active ON kcml.schema_migration((1)) WHERE terminal_at IS NULL;
DROP TRIGGER IF EXISTS touch_schema_migration ON kcml.schema_migration;
CREATE TRIGGER touch_schema_migration BEFORE UPDATE ON kcml.schema_migration FOR EACH ROW EXECUTE FUNCTION kcml.touch_mutable_row();

CREATE TABLE IF NOT EXISTS kcml.backup_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_run_id uuid REFERENCES kcml.deployment_run(id),
  backup_kind text NOT NULL,
  storage_path text NOT NULL,
  manifest jsonb NOT NULL,
  content_digest bytea NOT NULL,
  encryption_key_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('CREATING','VERIFIED','FAILED','RESTORED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  verified_at timestamptz
);

CREATE TABLE IF NOT EXISTS kcml.cleanup_operation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_kind text NOT NULL,
  parent_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','RUNNING','VERIFYING','CLOSED','FAILED','MANUAL_REVIEW')),
  closure_evidence jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1,
  platform_incarnation_id uuid NOT NULL,
  application_deployment_epoch bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS kcml.cleanup_resource (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cleanup_operation_id uuid NOT NULL REFERENCES kcml.cleanup_operation(id),
  resource_kind text NOT NULL,
  stable_key text NOT NULL,
  desired_terminal_condition jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','CLEANING','VERIFIED_ABSENT','RETAINED_EVIDENCE','FAILED','MANUAL_REVIEW')),
  evidence jsonb,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1,
  UNIQUE(cleanup_operation_id, resource_kind, stable_key)
);

DO $$
DECLARE
  v_platform uuid;
BEGIN
  INSERT INTO kcml.platform_incarnation(singleton_key) VALUES (1) ON CONFLICT DO NOTHING;
  SELECT platform_incarnation_id INTO STRICT v_platform FROM kcml.platform_incarnation WHERE singleton_key = 1;
  INSERT INTO kcml.application_deployment_head(singleton_key) VALUES (1) ON CONFLICT DO NOTHING;
  INSERT INTO kcml.activation_head(singleton_key) VALUES (1) ON CONFLICT DO NOTHING;
  INSERT INTO kcml.audit_head(singleton_key) VALUES (1) ON CONFLICT DO NOTHING;
  INSERT INTO kcml.owner_identity(singleton_key, platform_incarnation_id, application_deployment_epoch)
    VALUES (1, v_platform, 0) ON CONFLICT DO NOTHING;
  INSERT INTO kcml.owner_api_credential(singleton_key) VALUES (1) ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['platform_incarnation','application_deployment_head','activation_head','audit_head','owner_identity','owner_api_credential'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS protect_singleton_row ON kcml.%I', table_name);
    EXECUTE format('CREATE TRIGGER protect_singleton_row BEFORE UPDATE OR DELETE ON kcml.%I FOR EACH ROW EXECUTE FUNCTION kcml.protect_singleton()', table_name);
  END LOOP;
END $$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['binding_set_revision','binding_set_member','application_release','generation_checkpoint','generation_artifact','browser_observation','browser_target_reference','transactional_inbox','side_effect_attempt','side_effect_attempt_evidence','audit_event','self_test_case_result','backup_record'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS immutable_row ON kcml.%I', table_name);
    EXECUTE format('CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml.%I FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation()', table_name);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS guard_mcp_call_lifecycle ON kcml.mcp_call_run;
CREATE TRIGGER guard_mcp_call_lifecycle BEFORE UPDATE OR DELETE ON kcml.mcp_call_run FOR EACH ROW EXECUTE FUNCTION kcml.guard_mcp_lifecycle('state');
DROP TRIGGER IF EXISTS guard_mcp_input_lifecycle ON kcml.mcp_input_exchange;
CREATE TRIGGER guard_mcp_input_lifecycle BEFORE UPDATE OR DELETE ON kcml.mcp_input_exchange FOR EACH ROW EXECUTE FUNCTION kcml.guard_mcp_lifecycle('status');
DROP TRIGGER IF EXISTS guard_mcp_task_lifecycle ON kcml.mcp_task;
CREATE TRIGGER guard_mcp_task_lifecycle BEFORE UPDATE OR DELETE ON kcml.mcp_task FOR EACH ROW EXECUTE FUNCTION kcml.guard_mcp_lifecycle('state');
DROP TRIGGER IF EXISTS guard_agent_run_lifecycle ON kcml.agent_run;
CREATE TRIGGER guard_agent_run_lifecycle BEFORE UPDATE OR DELETE ON kcml.agent_run FOR EACH ROW EXECUTE FUNCTION kcml.guard_agent_run_lifecycle();

COMMIT;
