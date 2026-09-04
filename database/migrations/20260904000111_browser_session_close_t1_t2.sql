-- KCML_PHASE_PLAN: EXPAND, VALIDATE, ACTIVATE
-- KCML_TRANSACTION_MODE: TRANSACTIONAL

ALTER TABLE kcml.browser_session_dispatch_lease
  ADD COLUMN IF NOT EXISTS close_request_id uuid,
  ADD COLUMN IF NOT EXISTS close_t1_committed_at timestamptz,
  ADD COLUMN IF NOT EXISTS close_t2_committed_at timestamptz,
  ADD COLUMN IF NOT EXISTS close_response_digest bytea,
  ADD COLUMN IF NOT EXISTS close_evidence jsonb;

ALTER TABLE kcml.browser_session_dispatch_lease
  DROP CONSTRAINT IF EXISTS browser_session_close_checkpoint_check;
ALTER TABLE kcml.browser_session_dispatch_lease
  ADD CONSTRAINT browser_session_close_checkpoint_check CHECK (
    (close_request_id IS NULL AND close_t1_committed_at IS NULL AND close_t2_committed_at IS NULL AND close_response_digest IS NULL AND close_evidence IS NULL)
    OR
    (close_request_id IS NOT NULL AND close_t1_committed_at IS NOT NULL AND (
      (close_t2_committed_at IS NULL AND close_response_digest IS NULL AND close_evidence IS NULL)
      OR
      (close_t2_committed_at IS NOT NULL AND close_response_digest IS NOT NULL AND close_evidence IS NOT NULL)
    ))
  );

COMMENT ON CONSTRAINT browser_session_close_checkpoint_check ON kcml.browser_session_dispatch_lease IS
  'SSOT_CURRENT.md 49.19 Browser close has a durable pre-effect T1 and fenced post-effect T2 checkpoint';
