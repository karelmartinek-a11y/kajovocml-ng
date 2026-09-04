-- KCML_PHASE_PLAN: EXPAND, VALIDATE, ACTIVATE
-- KCML_TRANSACTION_MODE: TRANSACTIONAL

BEGIN;

-- REQUIREMENT_TRACE_MIGRATION:KCML-REQ-MONITORING-715041d50cb0e291f866de4cfc0baefb310b43f6e8c9d28efee76ccf478d49e7 sourceRef=ssot://6.8/6-8-chybov-a-retry-kontrakt/atom-27
-- REQUIREMENT_TRACE_MIGRATION:KCML-REQ-CORE-4bf1cf8acf15f1ce64bd66332aa7c37e7ccfb8def2e6bf4c6745013a73413279 sourceRef=ssot://6.8/6-8-chybov-a-retry-kontrakt/atom-28
-- REQUIREMENT_TRACE_MIGRATION:KCML-REQ-CORE-c341e4c01071983e399d1b251e3b5c09ba02fa74955ad5eb4c9cefeac8a6a555 sourceRef=ssot://6.8/6-8-chybov-a-retry-kontrakt/atom-29
-- REQUIREMENT_TRACE_MIGRATION:KCML-REQ-CORE-f09b50cf721e4d3b0a4a68e4ed9c81a87175d13c6b8c9f5db2c7562515d575ef sourceRef=ssot://6.8/6-8-chybov-a-retry-kontrakt/atom-30

CREATE TABLE IF NOT EXISTS kcml.domain_command_failure (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id uuid NOT NULL REFERENCES kcml.domain_command(id),
  logical_operation_id uuid NOT NULL,
  attempt_sequence integer NOT NULL CHECK (attempt_sequence > 0),
  effective_code text NOT NULL,
  classification text NOT NULL,
  side_effect_point text NOT NULL,
  retry_directive text NOT NULL CHECK (retry_directive IN ('DO_NOT_RETRY','RETRY_SAME_OPERATION','REFRESH_AND_RETRY_NEW_COMMAND','RECONCILE_THEN_RETRY','MANUAL_REVIEW')),
  http_status integer NOT NULL CHECK (http_status BETWEEN 100 AND 599),
  registry_version text NOT NULL,
  error_record_digest text NOT NULL CHECK (error_record_digest ~ '^sha256:[0-9a-f]{64}$'),
  canonical_failure jsonb NOT NULL,
  canonical_failure_digest bytea NOT NULL CHECK (octet_length(canonical_failure_digest) = 32),
  cause_digest text CHECK (cause_digest IS NULL OR cause_digest ~ '^sha256:[0-9a-f]{64}$'),
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (command_id, attempt_sequence),
  CHECK (canonical_failure->>'code' = effective_code),
  CHECK (canonical_failure->>'effectiveCode' = effective_code),
  CHECK (canonical_failure->>'classification' = classification),
  CHECK (canonical_failure->>'sideEffectPoint' = side_effect_point),
  CHECK (canonical_failure->>'retryDirective' = retry_directive),
  CHECK (canonical_failure->>'registryVersion' = registry_version),
  CHECK (canonical_failure->>'recordDigest' = error_record_digest),
  CHECK ((canonical_failure->>'httpStatus')::integer = http_status),
  CHECK (canonical_failure_digest = digest(convert_to(canonical_failure::text, 'UTF8'), 'sha256')),
  CHECK (cause_digest IS NOT DISTINCT FROM canonical_failure#>>'{cause,digest}')
);
DROP TRIGGER IF EXISTS immutable_row ON kcml.domain_command_failure;
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml.domain_command_failure FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml.domain_retry_plan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  failure_id uuid NOT NULL UNIQUE REFERENCES kcml.domain_command_failure(id),
  failed_command_id uuid NOT NULL REFERENCES kcml.domain_command(id),
  action text NOT NULL CHECK (action IN ('CLOSE_FAILED_COMMAND','RETRY_SAME_COMMAND','REFRESH_AND_CREATE_SUCCESSOR','ENQUEUE_RECONCILIATION','CREATE_MANUAL_REVIEW')),
  directive text NOT NULL CHECK (directive IN ('DO_NOT_RETRY','RETRY_SAME_OPERATION','REFRESH_AND_RETRY_NEW_COMMAND','RECONCILE_THEN_RETRY','MANUAL_REVIEW')),
  policy_snapshot jsonb NOT NULL,
  policy_snapshot_digest bytea NOT NULL CHECK (octet_length(policy_snapshot_digest) = 32),
  state text NOT NULL DEFAULT 'READY' CHECK (state IN ('READY','CLAIMED','WAITING_RECONCILIATION','WAITING_OWNER','COMPLETED','FAILED_FINAL')),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_owner uuid,
  lease_fencing_token bigint NOT NULL DEFAULT 0 CHECK (lease_fencing_token >= 0),
  lease_expires_at timestamptz,
  successor_command_id uuid REFERENCES kcml.domain_command(id),
  reconciliation_command_id uuid REFERENCES kcml.domain_command(id),
  manual_review_id uuid,
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  platform_incarnation_id uuid NOT NULL,
  application_deployment_epoch bigint NOT NULL,
  recovery_epoch bigint NOT NULL CHECK (recovery_epoch > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  CHECK (policy_snapshot_digest = digest(convert_to(policy_snapshot::text, 'UTF8'), 'sha256')),
  CHECK ((state = 'CLAIMED') = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK ((state IN ('COMPLETED','FAILED_FINAL')) = (completed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS domain_retry_plan_claim_idx ON kcml.domain_retry_plan(available_at, id) WHERE state = 'READY';

CREATE TABLE IF NOT EXISTS kcml.domain_manual_review (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  retry_plan_id uuid NOT NULL UNIQUE REFERENCES kcml.domain_retry_plan(id),
  command_id uuid NOT NULL REFERENCES kcml.domain_command(id),
  failure_id uuid NOT NULL REFERENCES kcml.domain_command_failure(id),
  state text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN','RESOLVED','CANCELLED')),
  evidence_digest bytea NOT NULL CHECK (octet_length(evidence_digest) = 32),
  owner_actor_id text CHECK (owner_actor_id IS NULL OR owner_actor_id = 'KRMAR78'),
  resolution jsonb,
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_at timestamptz,
  CHECK ((state = 'OPEN') = (resolved_at IS NULL)),
  CHECK ((state = 'OPEN') = (resolution IS NULL))
);
ALTER TABLE kcml.domain_retry_plan DROP CONSTRAINT IF EXISTS domain_retry_plan_manual_review_fk;
ALTER TABLE kcml.domain_retry_plan ADD CONSTRAINT domain_retry_plan_manual_review_fk FOREIGN KEY (manual_review_id) REFERENCES kcml.domain_manual_review(id);

CREATE OR REPLACE FUNCTION kcml.protect_retry_plan_policy()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.failure_id IS DISTINCT FROM OLD.failure_id
     OR NEW.failed_command_id IS DISTINCT FROM OLD.failed_command_id
     OR NEW.action IS DISTINCT FROM OLD.action
     OR NEW.directive IS DISTINCT FROM OLD.directive
     OR NEW.policy_snapshot IS DISTINCT FROM OLD.policy_snapshot
     OR NEW.policy_snapshot_digest IS DISTINCT FROM OLD.policy_snapshot_digest
     OR NEW.platform_incarnation_id IS DISTINCT FROM OLD.platform_incarnation_id
     OR NEW.application_deployment_epoch IS DISTINCT FROM OLD.application_deployment_epoch
     OR NEW.recovery_epoch IS DISTINCT FROM OLD.recovery_epoch THEN
    RAISE EXCEPTION 'domain_retry_plan immutable policy changed' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_retry_plan_policy ON kcml.domain_retry_plan;
CREATE TRIGGER protect_retry_plan_policy BEFORE UPDATE ON kcml.domain_retry_plan FOR EACH ROW EXECUTE FUNCTION kcml.protect_retry_plan_policy();

COMMIT;
