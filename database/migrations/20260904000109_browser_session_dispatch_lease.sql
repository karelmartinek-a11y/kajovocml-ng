-- KCML_PHASE_PLAN: EXPAND, VALIDATE, ACTIVATE
-- KCML_TRANSACTION_MODE: TRANSACTIONAL

CREATE TABLE IF NOT EXISTS kcml.browser_session_dispatch_lease (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES kcml.browser_session(id),
  worker_id uuid NOT NULL,
  host_generation bigint NOT NULL CHECK (host_generation > 0),
  fencing_token bigint NOT NULL CHECK (fencing_token > 0),
  identity_snapshot jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('ACQUIRED','ATTACHED','RELEASED','EXPIRED','FAILED')),
  issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  attached_at timestamptz,
  released_at timestamptz,
  last_error jsonb,
  canonical_digest bytea NOT NULL,
  platform_incarnation_id uuid NOT NULL,
  application_deployment_epoch bigint NOT NULL,
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(session_id,fencing_token)
);
CREATE UNIQUE INDEX IF NOT EXISTS browser_session_dispatch_lease_active_uq ON kcml.browser_session_dispatch_lease(session_id) WHERE released_at IS NULL AND state IN ('ACQUIRED','ATTACHED');
CREATE INDEX IF NOT EXISTS browser_session_dispatch_lease_expiry_idx ON kcml.browser_session_dispatch_lease(expires_at) WHERE released_at IS NULL;

ALTER TABLE kcml.browser_action_attempt
  ADD COLUMN IF NOT EXISTS dispatch_worker_id uuid,
  ADD COLUMN IF NOT EXISTS dispatch_lease_id uuid REFERENCES kcml.browser_session_dispatch_lease(id),
  ADD COLUMN IF NOT EXISTS dispatch_lease_fencing_token bigint,
  ADD COLUMN IF NOT EXISTS dispatch_lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS t1_committed_at timestamptz,
  ADD COLUMN IF NOT EXISTS adapter_response_digest bytea,
  ADD COLUMN IF NOT EXISTS mutation_trigger_observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS t2_committed_at timestamptz;

ALTER TABLE kcml.browser_action_attempt DROP CONSTRAINT IF EXISTS browser_action_attempt_dispatch_lease_check;
ALTER TABLE kcml.browser_action_attempt ADD CONSTRAINT browser_action_attempt_dispatch_lease_check CHECK (
  (dispatch_lease_id IS NULL AND dispatch_lease_fencing_token IS NULL AND dispatch_lease_expires_at IS NULL AND t1_committed_at IS NULL)
  OR
  (dispatch_lease_id IS NOT NULL AND dispatch_worker_id IS NOT NULL AND dispatch_lease_fencing_token > 0 AND dispatch_lease_expires_at IS NOT NULL AND t1_committed_at IS NOT NULL)
);

COMMENT ON TABLE kcml.browser_session_dispatch_lease IS 'SSOT_CURRENT.md 49.19 durable BrowserSessionService host attachment lease; host is evidence-only';
COMMENT ON CONSTRAINT browser_action_attempt_dispatch_lease_check ON kcml.browser_action_attempt IS 'SSOT_CURRENT.md 49.19 browser action T1 dispatch authority is complete or absent';
