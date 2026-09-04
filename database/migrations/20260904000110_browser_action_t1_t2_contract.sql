-- KCML_PHASE_PLAN: EXPAND, VALIDATE, ACTIVATE
-- KCML_TRANSACTION_MODE: TRANSACTIONAL

CREATE UNIQUE INDEX IF NOT EXISTS browser_action_attempt_dispatch_fence_uq
  ON kcml.browser_action_attempt(dispatch_lease_id,action_fence)
  WHERE dispatch_lease_id IS NOT NULL;

ALTER TABLE kcml.browser_action_attempt DROP CONSTRAINT IF EXISTS browser_action_attempt_t2_check;
ALTER TABLE kcml.browser_action_attempt ADD CONSTRAINT browser_action_attempt_t2_check CHECK (
  (t2_committed_at IS NULL AND adapter_response_digest IS NULL)
  OR
  (t2_committed_at IS NOT NULL AND adapter_response_digest IS NOT NULL AND t1_committed_at IS NOT NULL)
);

ALTER TABLE kcml.browser_action_attempt DROP CONSTRAINT IF EXISTS browser_action_attempt_mutation_checkpoint_check;
ALTER TABLE kcml.browser_action_attempt ADD CONSTRAINT browser_action_attempt_mutation_checkpoint_check CHECK (
  mutation_trigger_observed_at IS NULL OR t2_committed_at IS NOT NULL
);

COMMENT ON CONSTRAINT browser_action_attempt_t2_check ON kcml.browser_action_attempt IS
  'SSOT_CURRENT.md 49.19 T2 requires a durable adapter response digest and a preceding T1';
COMMENT ON CONSTRAINT browser_action_attempt_mutation_checkpoint_check ON kcml.browser_action_attempt IS
  'SSOT_CURRENT.md 49.19 a possible mutation trigger is persisted only with the T2 adapter checkpoint';
