-- KCML_PHASE_PLAN: EXPAND, VALIDATE, ACTIVATE
-- KCML_TRANSACTION_MODE: TRANSACTIONAL

BEGIN;

-- REQUIREMENT_TRACE_MIGRATION:KCML-REQ-MONITORING-715041d50cb0e291f866de4cfc0baefb310b43f6e8c9d28efee76ccf478d49e7 sourceRef=ssot://6.8/6-8-chybov-a-retry-kontrakt/atom-27
-- REQUIREMENT_TRACE_MIGRATION:KCML-REQ-CORE-4bf1cf8acf15f1ce64bd66332aa7c37e7ccfb8def2e6bf4c6745013a73413279 sourceRef=ssot://6.8/6-8-chybov-a-retry-kontrakt/atom-28
-- REQUIREMENT_TRACE_MIGRATION:KCML-REQ-CORE-c341e4c01071983e399d1b251e3b5c09ba02fa74955ad5eb4c9cefeac8a6a555 sourceRef=ssot://6.8/6-8-chybov-a-retry-kontrakt/atom-29

ALTER TABLE kcml.domain_retry_plan ADD COLUMN IF NOT EXISTS scheduler_attempt_count integer NOT NULL DEFAULT 0 CHECK (scheduler_attempt_count >= 0);
ALTER TABLE kcml.domain_retry_plan ADD COLUMN IF NOT EXISTS scheduler_maximum_attempts integer NOT NULL DEFAULT 8 CHECK (scheduler_maximum_attempts > 0);

CREATE TABLE IF NOT EXISTS kcml.domain_retry_refresh_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  retry_plan_id uuid NOT NULL UNIQUE REFERENCES kcml.domain_retry_plan(id),
  failed_command_id uuid NOT NULL REFERENCES kcml.domain_command(id),
  target_id uuid,
  target_state_version bigint,
  activation_epoch bigint NOT NULL CHECK (activation_epoch >= 0),
  snapshot jsonb NOT NULL,
  snapshot_digest bytea NOT NULL CHECK (octet_length(snapshot_digest) = 32),
  platform_incarnation_id uuid NOT NULL,
  application_deployment_epoch bigint NOT NULL,
  recovery_epoch bigint NOT NULL CHECK (recovery_epoch > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (snapshot_digest = digest(convert_to(snapshot::text, 'UTF8'), 'sha256'))
);
DROP TRIGGER IF EXISTS immutable_row ON kcml.domain_retry_refresh_snapshot;
CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON kcml.domain_retry_refresh_snapshot FOR EACH ROW EXECUTE FUNCTION kcml.reject_mutation();

CREATE TABLE IF NOT EXISTS kcml.domain_reconciliation_command (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  retry_plan_id uuid NOT NULL UNIQUE REFERENCES kcml.domain_retry_plan(id),
  failed_command_id uuid NOT NULL REFERENCES kcml.domain_command(id),
  state text NOT NULL DEFAULT 'READY' CHECK (state IN ('READY','CLAIMED','RETRY_ALLOWED','COMPLETED','MANUAL_REVIEW')),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  maximum_attempts integer NOT NULL DEFAULT 8 CHECK (maximum_attempts > 0),
  lease_owner uuid,
  lease_fencing_token bigint NOT NULL DEFAULT 0 CHECK (lease_fencing_token >= 0),
  lease_expires_at timestamptz,
  oracle_evidence jsonb,
  oracle_evidence_digest bytea,
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  platform_incarnation_id uuid NOT NULL,
  application_deployment_epoch bigint NOT NULL,
  recovery_epoch bigint NOT NULL CHECK (recovery_epoch > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  CHECK ((state = 'CLAIMED') = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK (oracle_evidence_digest IS NULL OR octet_length(oracle_evidence_digest) = 32),
  CHECK (oracle_evidence_digest IS NULL OR oracle_evidence_digest = digest(convert_to(oracle_evidence::text, 'UTF8'), 'sha256')),
  CHECK ((state IN ('COMPLETED','MANUAL_REVIEW')) = (completed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS domain_reconciliation_command_claim_idx ON kcml.domain_reconciliation_command(available_at,id) WHERE state IN ('READY','RETRY_ALLOWED');

ALTER TABLE kcml.domain_retry_plan DROP CONSTRAINT IF EXISTS domain_retry_plan_reconciliation_command_id_fkey;
ALTER TABLE kcml.domain_retry_plan ADD CONSTRAINT domain_retry_plan_reconciliation_command_fk FOREIGN KEY (reconciliation_command_id) REFERENCES kcml.domain_reconciliation_command(id);

COMMIT;
