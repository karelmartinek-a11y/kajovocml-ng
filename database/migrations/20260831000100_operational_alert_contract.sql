-- KCML_PHASE_PLAN: EXPAND, VALIDATE, ACTIVATE
-- KCML_TRANSACTION_MODE: TRANSACTIONAL

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='kcml' AND table_name='operational_alert' AND column_name='source_object_type'
  ) AND EXISTS (SELECT 1 FROM kcml.operational_alert) THEN
    RAISE EXCEPTION 'OPERATIONAL_ALERT_LEGACY_ROWS_REQUIRE_EXACT_EVIDENCE_MIGRATION' USING ERRCODE='55000';
  END IF;
END $$;

ALTER TABLE kcml.operational_alert
  ADD COLUMN IF NOT EXISTS episode_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS source_object_type text NOT NULL,
  ADD COLUMN IF NOT EXISTS source_object_id uuid NOT NULL,
  ADD COLUMN IF NOT EXISTS alert_type text NOT NULL,
  ADD COLUMN IF NOT EXISTS condition_digest bytea NOT NULL,
  ADD COLUMN IF NOT EXISTS detail text NOT NULL,
  ADD COLUMN IF NOT EXISTS correlation_id uuid NOT NULL,
  ADD COLUMN IF NOT EXISTS latest_source_sequence bigint NOT NULL,
  ADD COLUMN IF NOT EXISTS latest_observation_digest bytea NOT NULL,
  ADD COLUMN IF NOT EXISTS source_release_id uuid,
  ADD COLUMN IF NOT EXISTS source_activation_epoch bigint NOT NULL,
  ADD COLUMN IF NOT EXISTS suppressed_until timestamptz,
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS recommended_action jsonb,
  ADD COLUMN IF NOT EXISTS repair_reference text,
  ADD COLUMN IF NOT EXISTS logical_operation_id uuid NOT NULL,
  ADD COLUMN IF NOT EXISTS canonical_digest bytea NOT NULL,
  ADD COLUMN IF NOT EXISTS recovery_epoch bigint NOT NULL;

ALTER TABLE kcml.operational_alert DROP CONSTRAINT IF EXISTS operational_alert_severity_check;
ALTER TABLE kcml.operational_alert ADD CONSTRAINT operational_alert_severity_check CHECK (severity IN ('WARNING','HIGH','CRITICAL'));
ALTER TABLE kcml.operational_alert DROP CONSTRAINT IF EXISTS operational_alert_condition_digest_check;
ALTER TABLE kcml.operational_alert ADD CONSTRAINT operational_alert_condition_digest_check CHECK (octet_length(condition_digest)=32);
ALTER TABLE kcml.operational_alert DROP CONSTRAINT IF EXISTS operational_alert_latest_observation_digest_check;
ALTER TABLE kcml.operational_alert ADD CONSTRAINT operational_alert_latest_observation_digest_check CHECK (octet_length(latest_observation_digest)=32);
ALTER TABLE kcml.operational_alert DROP CONSTRAINT IF EXISTS operational_alert_occurrence_count_check;
ALTER TABLE kcml.operational_alert ADD CONSTRAINT operational_alert_occurrence_count_check CHECK (occurrence_count>0);
ALTER TABLE kcml.operational_alert DROP CONSTRAINT IF EXISTS operational_alert_latest_source_sequence_check;
ALTER TABLE kcml.operational_alert ADD CONSTRAINT operational_alert_latest_source_sequence_check CHECK (latest_source_sequence>0);
ALTER TABLE kcml.operational_alert DROP CONSTRAINT IF EXISTS operational_alert_source_activation_epoch_check;
ALTER TABLE kcml.operational_alert ADD CONSTRAINT operational_alert_source_activation_epoch_check CHECK (source_activation_epoch>=0);
ALTER TABLE kcml.operational_alert DROP CONSTRAINT IF EXISTS operational_alert_canonical_digest_check;
ALTER TABLE kcml.operational_alert ADD CONSTRAINT operational_alert_canonical_digest_check CHECK (octet_length(canonical_digest)=32);
ALTER TABLE kcml.operational_alert DROP CONSTRAINT IF EXISTS operational_alert_recovery_epoch_check;
ALTER TABLE kcml.operational_alert ADD CONSTRAINT operational_alert_recovery_epoch_check CHECK (recovery_epoch>0);
ALTER TABLE kcml.operational_alert DROP CONSTRAINT IF EXISTS operational_alert_first_seen_at_last_seen_at_check;
ALTER TABLE kcml.operational_alert DROP CONSTRAINT IF EXISTS operational_alert_seen_interval_check;
ALTER TABLE kcml.operational_alert ADD CONSTRAINT operational_alert_seen_interval_check CHECK (first_seen_at<=last_seen_at);
ALTER TABLE kcml.operational_alert DROP CONSTRAINT IF EXISTS operational_alert_check;
ALTER TABLE kcml.operational_alert DROP CONSTRAINT IF EXISTS operational_alert_closed_timestamp_check;
ALTER TABLE kcml.operational_alert ADD CONSTRAINT operational_alert_closed_timestamp_check CHECK ((status='CLOSED')=(closed_at IS NOT NULL));
ALTER TABLE kcml.operational_alert DROP CONSTRAINT IF EXISTS operational_alert_check1;
ALTER TABLE kcml.operational_alert DROP CONSTRAINT IF EXISTS operational_alert_suppression_interval_check;
ALTER TABLE kcml.operational_alert ADD CONSTRAINT operational_alert_suppression_interval_check CHECK (status<>'SUPPRESSED' OR suppressed_until IS NOT NULL);
ALTER TABLE kcml.operational_alert DROP CONSTRAINT IF EXISTS operational_alert_episode_id_key;
ALTER TABLE kcml.operational_alert ADD CONSTRAINT operational_alert_episode_id_key UNIQUE (episode_id);

DROP INDEX IF EXISTS kcml.alert_open_fingerprint_uq;
CREATE UNIQUE INDEX alert_open_fingerprint_uq ON kcml.operational_alert(fingerprint) WHERE status IN ('OPEN','ACKNOWLEDGED','SUPPRESSED');
CREATE INDEX IF NOT EXISTS operational_alert_source_episode_idx ON kcml.operational_alert(source_object_type,source_object_id,alert_type,condition_digest,last_seen_at DESC);

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
