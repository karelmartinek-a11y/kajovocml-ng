-- KCML_PHASE_PLAN: EXPAND, VALIDATE, ACTIVATE
-- KCML_TRANSACTION_MODE: TRANSACTIONAL

ALTER TABLE kcml.generation_job
  ADD COLUMN IF NOT EXISTS active_phase_run_id uuid,
  ADD COLUMN IF NOT EXISTS latest_checkpoint_id uuid,
  ADD COLUMN IF NOT EXISTS workspace_revision_id uuid,
  ADD COLUMN IF NOT EXISTS approved_spec_digest bytea,
  ADD COLUMN IF NOT EXISTS execution_authority_id uuid,
  ADD COLUMN IF NOT EXISTS candidate_id uuid,
  ADD COLUMN IF NOT EXISTS activation_set_id uuid,
  ADD COLUMN IF NOT EXISTS previous_activation_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS recovery_state text NOT NULL DEFAULT 'READY',
  ADD COLUMN IF NOT EXISTS cancellation_version bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provisional_identity jsonb,
  ADD COLUMN IF NOT EXISTS result_digest bytea,
  ADD COLUMN IF NOT EXISTS terminal_evidence jsonb,
  ADD COLUMN IF NOT EXISTS cleanup_operation_id uuid,
  ADD COLUMN IF NOT EXISTS logical_operation_id uuid,
  ADD COLUMN IF NOT EXISTS correlation_id uuid;

ALTER TABLE kcml.generation_job DROP CONSTRAINT IF EXISTS generation_job_lifecycle_check;
UPDATE kcml.generation_job SET lifecycle = CASE lifecycle
  WHEN 'INTAKE' THEN 'DISCUSSING' WHEN 'DISCOVERY' THEN 'ANALYZING'
  WHEN 'SPECIFICATION' THEN 'ANALYZING' WHEN 'APPROVAL_REQUIRED' THEN 'ANALYZING'
  WHEN 'PLANNING' THEN 'IMPLEMENTING' WHEN 'SUCCEEDED' THEN 'COMPLETED'
  WHEN 'FAILED_FINAL' THEN 'FAILED' WHEN 'CANCELLED_FINAL' THEN 'CANCELLED'
  WHEN 'MANUAL_REVIEW' THEN 'BLOCKED' ELSE lifecycle END,
  current_phase = CASE current_phase
  WHEN 'INTAKE' THEN 'DISCUSSING' WHEN 'DISCOVERY' THEN 'ANALYZING'
  WHEN 'SPECIFICATION' THEN 'ANALYZING' WHEN 'APPROVAL_REQUIRED' THEN 'ANALYZING'
  WHEN 'PLANNING' THEN 'IMPLEMENTING' WHEN 'SUCCEEDED' THEN 'COMPLETED'
  WHEN 'FAILED_FINAL' THEN 'FAILED' WHEN 'CANCELLED_FINAL' THEN 'CANCELLED'
  WHEN 'MANUAL_REVIEW' THEN 'BLOCKED' ELSE current_phase END;
ALTER TABLE kcml.generation_job ADD CONSTRAINT generation_job_lifecycle_check CHECK (lifecycle IN ('DISCUSSING','ANALYZING','IMPLEMENTING','INTEGRATING','VALIDATING','CML_CONFORMANCE','ACTIVATING','COMPLETED','BLOCKED','FAILED','CANCELLED'));
ALTER TABLE kcml.generation_job DROP CONSTRAINT IF EXISTS generation_job_recovery_state_check; ALTER TABLE kcml.generation_job ADD CONSTRAINT generation_job_recovery_state_check CHECK (recovery_state IN ('READY','RECOVERY_REQUIRED','RECONCILING','MANUAL_REVIEW'));
ALTER TABLE kcml.generation_job DROP CONSTRAINT IF EXISTS generation_job_cancellation_version_check; ALTER TABLE kcml.generation_job ADD CONSTRAINT generation_job_cancellation_version_check CHECK (cancellation_version >= 0);

CREATE OR REPLACE FUNCTION kcml.guard_generation_job_lifecycle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE allowed boolean := false;
BEGIN
  IF NEW.state_version <= OLD.state_version THEN RAISE EXCEPTION 'generation_job state_version must increase' USING ERRCODE = '40001'; END IF;
  IF OLD.lifecycle IN ('COMPLETED','FAILED','CANCELLED') THEN RAISE EXCEPTION 'generation_job terminal row is immutable' USING ERRCODE = '55000'; END IF;
  allowed := OLD.lifecycle = NEW.lifecycle OR
    (OLD.lifecycle = 'DISCUSSING' AND NEW.lifecycle IN ('ANALYZING','BLOCKED','FAILED','CANCELLED')) OR
    (OLD.lifecycle = 'ANALYZING' AND NEW.lifecycle IN ('IMPLEMENTING','BLOCKED','FAILED','CANCELLED')) OR
    (OLD.lifecycle = 'IMPLEMENTING' AND NEW.lifecycle IN ('INTEGRATING','BLOCKED','FAILED','CANCELLED')) OR
    (OLD.lifecycle = 'INTEGRATING' AND NEW.lifecycle IN ('VALIDATING','BLOCKED','FAILED','CANCELLED')) OR
    (OLD.lifecycle = 'VALIDATING' AND NEW.lifecycle IN ('CML_CONFORMANCE','IMPLEMENTING','BLOCKED','FAILED','CANCELLED')) OR
    (OLD.lifecycle = 'CML_CONFORMANCE' AND NEW.lifecycle IN ('ACTIVATING','IMPLEMENTING','BLOCKED','FAILED','CANCELLED')) OR
    (OLD.lifecycle = 'ACTIVATING' AND NEW.lifecycle IN ('COMPLETED','BLOCKED','FAILED','CANCELLED')) OR
    (OLD.lifecycle = 'BLOCKED' AND NEW.lifecycle IN ('DISCUSSING','ANALYZING','IMPLEMENTING','INTEGRATING','VALIDATING','CML_CONFORMANCE','ACTIVATING','FAILED','CANCELLED'));
  IF NOT allowed THEN RAISE EXCEPTION 'invalid generation_job lifecycle transition % -> %', OLD.lifecycle, NEW.lifecycle USING ERRCODE = '23514'; END IF;
  NEW.updated_at := clock_timestamp(); RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_generation_job_lifecycle ON kcml.generation_job;
CREATE TRIGGER guard_generation_job_lifecycle BEFORE UPDATE ON kcml.generation_job FOR EACH ROW EXECUTE FUNCTION kcml.guard_generation_job_lifecycle();

ALTER TABLE kcml.generation_checkpoint
  ADD COLUMN IF NOT EXISTS phase_run_id uuid,
  ADD COLUMN IF NOT EXISTS checkpoint_kind text NOT NULL DEFAULT 'PHASE_PROGRESS',
  ADD COLUMN IF NOT EXISTS terminal_evidence jsonb,
  ADD COLUMN IF NOT EXISTS successor_phase text;
ALTER TABLE kcml.generation_checkpoint DROP CONSTRAINT IF EXISTS generation_checkpoint_checkpoint_kind_check;
ALTER TABLE kcml.generation_checkpoint DROP CONSTRAINT IF EXISTS generation_checkpoint_checkpoint_kind_check; ALTER TABLE kcml.generation_checkpoint ADD CONSTRAINT generation_checkpoint_checkpoint_kind_check CHECK (checkpoint_kind IN ('SOURCE_INTAKE','TURN','SPECIFICATION','APPROVAL','PLAN_VALIDATED','WORKSPACE_REVISION','INTEGRATION_STEP','VALIDATION_STEP','ACTIVATION_PRE','ACTIVATION_POST','PHASE_PROGRESS','PHASE_TERMINAL','RECOVERY'));

CREATE INDEX IF NOT EXISTS generation_phase_recovery_idx ON kcml.generation_phase_run(job_id,state,lease_expires_at);
CREATE INDEX IF NOT EXISTS generation_checkpoint_job_sequence_idx ON kcml.generation_checkpoint(generation_job_id,sequence DESC);

CREATE OR REPLACE FUNCTION kcml.guard_generation_phase_run() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE allowed boolean := false;
BEGIN
  IF NEW.state_version <= OLD.state_version THEN RAISE EXCEPTION 'generation_phase_run state_version must increase' USING ERRCODE = '40001'; END IF;
  IF OLD.state IN ('SUCCEEDED','FAILED','CANCELLED') THEN RAISE EXCEPTION 'generation_phase_run terminal row is immutable' USING ERRCODE = '55000'; END IF;
  allowed := OLD.state = NEW.state OR
    (OLD.state = 'QUEUED' AND NEW.state IN ('RUNNING','CANCEL_REQUESTED','CANCELLED')) OR
    (OLD.state = 'RUNNING' AND NEW.state IN ('WAITING_FOR_DEPENDENCY','WAITING_FOR_OWNER','REPAIRING','SUCCEEDED','FAILED','CANCEL_REQUESTED','CANCELLED')) OR
    (OLD.state IN ('WAITING_FOR_DEPENDENCY','WAITING_FOR_OWNER') AND NEW.state IN ('RUNNING','REPAIRING','FAILED','CANCEL_REQUESTED','CANCELLED')) OR
    (OLD.state = 'REPAIRING' AND NEW.state IN ('RUNNING','SUCCEEDED','FAILED','CANCEL_REQUESTED','CANCELLED')) OR
    (OLD.state = 'CANCEL_REQUESTED' AND NEW.state IN ('FAILED','CANCELLED'));
  IF NOT allowed THEN RAISE EXCEPTION 'invalid generation_phase_run state transition % -> %', OLD.state, NEW.state USING ERRCODE = '23514'; END IF;
  NEW.updated_at := clock_timestamp(); RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_generation_phase_run ON kcml.generation_phase_run;
CREATE TRIGGER guard_generation_phase_run BEFORE UPDATE ON kcml.generation_phase_run FOR EACH ROW EXECUTE FUNCTION kcml.guard_generation_phase_run();

CREATE OR REPLACE FUNCTION kcml.guard_generation_activation_set() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE allowed boolean := false;
BEGIN
  IF NEW.state_version <= OLD.state_version THEN RAISE EXCEPTION 'generation_activation_set state_version must increase' USING ERRCODE = '40001'; END IF;
  IF OLD.state IN ('ROLLED_BACK','FAILED','MANUAL_REVIEW') THEN RAISE EXCEPTION 'generation_activation_set terminal row is immutable' USING ERRCODE = '55000'; END IF;
  allowed := OLD.state = NEW.state OR
    (OLD.state = 'DRAFT' AND NEW.state IN ('READY','FAILED','MANUAL_REVIEW')) OR
    (OLD.state = 'READY' AND NEW.state IN ('SWITCHING','ROLLING_BACK','FAILED','MANUAL_REVIEW')) OR
    (OLD.state = 'SWITCHING' AND NEW.state IN ('VERIFYING','ROLLING_BACK','FAILED','MANUAL_REVIEW')) OR
    (OLD.state = 'VERIFYING' AND NEW.state IN ('ACTIVE','ROLLING_BACK','FAILED','MANUAL_REVIEW')) OR
    (OLD.state = 'ACTIVE' AND NEW.state IN ('ROLLING_BACK')) OR
    (OLD.state = 'ROLLING_BACK' AND NEW.state IN ('ROLLBACK_VERIFYING','ROLLED_BACK','FAILED','MANUAL_REVIEW')) OR
    (OLD.state = 'ROLLBACK_VERIFYING' AND NEW.state IN ('ROLLED_BACK','FAILED','MANUAL_REVIEW'));
  IF NOT allowed THEN RAISE EXCEPTION 'invalid generation_activation_set state transition % -> %', OLD.state, NEW.state USING ERRCODE = '23514'; END IF;
  NEW.updated_at := clock_timestamp(); RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_generation_activation_set ON kcml.generation_activation_set;
CREATE TRIGGER guard_generation_activation_set BEFORE UPDATE ON kcml.generation_activation_set FOR EACH ROW EXECUTE FUNCTION kcml.guard_generation_activation_set();
