-- KCML_PHASE_PLAN: EXPAND, VALIDATE, ACTIVATE
-- KCML_TRANSACTION_MODE: TRANSACTIONAL

ALTER TABLE kcml.browser_action_run
  ADD COLUMN IF NOT EXISTS next_attempt bigint NOT NULL DEFAULT 1 CHECK (next_attempt > 0);
ALTER TABLE kcml.browser_session
  ADD COLUMN IF NOT EXISTS next_action_fence bigint NOT NULL DEFAULT 1 CHECK (next_action_fence > 0),
  ADD COLUMN IF NOT EXISTS next_dispatch_lease_fence bigint NOT NULL DEFAULT 1 CHECK (next_dispatch_lease_fence > 0);
ALTER TABLE kcml.browser_page
  ADD COLUMN IF NOT EXISTS next_navigation_sequence bigint NOT NULL DEFAULT 1 CHECK (next_navigation_sequence > 0);

UPDATE kcml.browser_action_run run
SET next_attempt=coalesce((SELECT attempt.attempt FROM kcml.browser_action_attempt attempt WHERE attempt.action_run_id=run.id ORDER BY attempt.attempt DESC LIMIT 1), 0)::bigint+1;
UPDATE kcml.browser_session session
SET next_action_fence=coalesce((SELECT attempt.action_fence FROM kcml.browser_action_attempt attempt JOIN kcml.browser_action_run run ON run.id=attempt.action_run_id WHERE run.session_id=session.id ORDER BY attempt.action_fence DESC LIMIT 1), 0)::bigint+1,
    next_dispatch_lease_fence=coalesce((SELECT lease.fencing_token FROM kcml.browser_session_dispatch_lease lease WHERE lease.session_id=session.id ORDER BY lease.fencing_token DESC LIMIT 1), 0)::bigint+1;
UPDATE kcml.browser_page page
SET next_navigation_sequence=coalesce((SELECT document.navigation_sequence FROM kcml.browser_document document WHERE document.page_id=page.id ORDER BY document.navigation_sequence DESC LIMIT 1), 0)::bigint+1;

COMMENT ON COLUMN kcml.browser_action_run.next_attempt IS 'SSOT_CURRENT.md 49.6 transactionally allocated monotonic action attempt';
COMMENT ON COLUMN kcml.browser_session.next_action_fence IS 'SSOT_CURRENT.md 49.19 transactionally allocated monotonic action fence';
COMMENT ON COLUMN kcml.browser_session.next_dispatch_lease_fence IS 'SSOT_CURRENT.md 49.6 transactionally allocated monotonic host lease fence';
COMMENT ON COLUMN kcml.browser_page.next_navigation_sequence IS 'SSOT_CURRENT.md 49.19 transactionally allocated monotonic navigation sequence';
