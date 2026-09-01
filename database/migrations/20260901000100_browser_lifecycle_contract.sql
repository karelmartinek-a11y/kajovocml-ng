-- KCML_PHASE_PLAN: EXPAND, VALIDATE, ACTIVATE
-- KCML_TRANSACTION_MODE: TRANSACTIONAL

-- Browser lifecycle is separate from control-holder identity.  Older rows used
-- holder-shaped lifecycle values; new writes are constrained to the SSOT state
-- machine and a recovery worker can only move a session through RECOVERING.
ALTER TABLE kcml.browser_session DROP CONSTRAINT IF EXISTS browser_session_lifecycle_check;
ALTER TABLE kcml.browser_session DROP CONSTRAINT IF EXISTS browser_session_lifecycle_contract_check;
ALTER TABLE kcml.browser_session ADD CONSTRAINT browser_session_lifecycle_contract_check
  CHECK (lifecycle IN ('CREATING','READY','ACTIVE','CHALLENGE_REQUIRED','PAUSED','RECOVERING','CLOSING','CLOSED','FAILED','EXPIRED'));

ALTER TABLE kcml.browser_action_dispatch_event DROP CONSTRAINT IF EXISTS browser_action_dispatch_phase_contract_check;
ALTER TABLE kcml.browser_action_dispatch_event ADD CONSTRAINT browser_action_dispatch_phase_contract_check
  CHECK (phase IN ('COMMAND_ACCEPTED','TARGET_RESOLVED','ACTIONABILITY_PASSED','INPUT_SEQUENCE_STARTED','MUTATION_TRIGGER_POSSIBLY_ISSUED','NAVIGATION_OR_REQUEST_OBSERVED','METHOD_RETURNED','POST_OBSERVATION_CAPTURED'));

ALTER TABLE kcml.browser_download DROP CONSTRAINT IF EXISTS browser_download_completed_contract_check;
ALTER TABLE kcml.browser_download ADD CONSTRAINT browser_download_completed_contract_check
  CHECK (state <> 'COMPLETED' OR (artifact_id IS NOT NULL AND size_bytes IS NOT NULL AND content_digest IS NOT NULL AND content_verification IS NOT NULL));

ALTER TABLE kcml.browser_upload_handle DROP CONSTRAINT IF EXISTS browser_upload_handle_safe_name_check;
ALTER TABLE kcml.browser_upload_handle ADD CONSTRAINT browser_upload_handle_safe_name_check
  CHECK (safe_name <> '' AND safe_name NOT LIKE '%/%' AND safe_name NOT LIKE '%' || chr(92) || '%' AND safe_name NOT IN ('.','..'));

-- Artifact bytes and identity stay immutable, while cleanup is an explicit
-- persisted lifecycle transition needed before a Browser session can close.
DROP TRIGGER IF EXISTS immutable_row ON kcml.browser_automation_artifact;
CREATE OR REPLACE FUNCTION kcml.guard_browser_artifact_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.session_id IS DISTINCT FROM OLD.session_id
     OR NEW.storage_reference IS DISTINCT FROM OLD.storage_reference
     OR NEW.artifact_digest IS DISTINCT FROM OLD.artifact_digest
     OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes
     OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
     OR NEW.safe_name IS DISTINCT FROM OLD.safe_name
     OR NEW.source_origin IS DISTINCT FROM OLD.source_origin
     OR NEW.state_version <> OLD.state_version + 1 THEN
    RAISE EXCEPTION 'browser artifact identity is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS browser_artifact_cleanup_guard ON kcml.browser_automation_artifact;
CREATE TRIGGER browser_artifact_cleanup_guard
  BEFORE UPDATE ON kcml.browser_automation_artifact
  FOR EACH ROW EXECUTE FUNCTION kcml.guard_browser_artifact_cleanup();

CREATE UNIQUE INDEX IF NOT EXISTS browser_action_dispatch_event_identity_uq
  ON kcml.browser_action_dispatch_event(action_attempt_id, phase, event_digest);
CREATE INDEX IF NOT EXISTS browser_download_recovery_idx
  ON kcml.browser_download(session_id, state, cleanup_state, updated_at);
CREATE INDEX IF NOT EXISTS browser_upload_recovery_idx
  ON kcml.browser_upload_handle(session_id, consumed_at, expires_at, cleanup_at);

COMMENT ON CONSTRAINT browser_session_lifecycle_contract_check ON kcml.browser_session IS
  'SSOT_CURRENT.md 13.6 persisted Browser Interaction Plane lifecycle; control holder is separate authority';
COMMENT ON CONSTRAINT browser_action_dispatch_phase_contract_check ON kcml.browser_action_dispatch_event IS
  'SSOT_CURRENT.md 49.19 canonical monotonic host/bridge dispatch phase set';
