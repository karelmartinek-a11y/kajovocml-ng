-- KCML_PHASE_PLAN: EXPAND, VALIDATE, ACTIVATE
-- KCML_TRANSACTION_MODE: TRANSACTIONAL

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='kcml' AND table_name='platform_worker_heartbeat' AND column_name='platform_incarnation_id'
  ) AND EXISTS (SELECT 1 FROM kcml.platform_worker_heartbeat) THEN
    RAISE EXCEPTION 'PLATFORM_WORKER_HEARTBEAT_LEGACY_ROWS_REQUIRE_EXACT_LINEAGE_EVIDENCE' USING ERRCODE='55000';
  END IF;
END $$;

ALTER TABLE kcml.platform_worker_heartbeat
  ADD COLUMN IF NOT EXISTS platform_incarnation_id uuid NOT NULL,
  ADD COLUMN IF NOT EXISTS heartbeat_sequence bigint NOT NULL,
  ADD COLUMN IF NOT EXISTS nonce text NOT NULL;

ALTER TABLE kcml.platform_worker_heartbeat DROP CONSTRAINT IF EXISTS platform_worker_heartbeat_heartbeat_sequence_check;
ALTER TABLE kcml.platform_worker_heartbeat ADD CONSTRAINT platform_worker_heartbeat_heartbeat_sequence_check CHECK (heartbeat_sequence>0);
ALTER TABLE kcml.platform_worker_heartbeat DROP CONSTRAINT IF EXISTS platform_worker_heartbeat_nonce_check;
ALTER TABLE kcml.platform_worker_heartbeat ADD CONSTRAINT platform_worker_heartbeat_nonce_check CHECK (length(nonce)>0);
ALTER TABLE kcml.platform_worker_heartbeat DROP CONSTRAINT IF EXISTS platform_worker_heartbeat_check;
ALTER TABLE kcml.platform_worker_heartbeat ADD CONSTRAINT platform_worker_heartbeat_observation_window_check CHECK (expires_at>observed_at);

COMMIT;
