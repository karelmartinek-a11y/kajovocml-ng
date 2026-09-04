-- KCML_PHASE_PLAN: EXPAND, VALIDATE, ACTIVATE
-- KCML_TRANSACTION_MODE: TRANSACTIONAL

ALTER TABLE kcml.browser_action_attempt
  ADD COLUMN IF NOT EXISTS effect_commands_admitted_at timestamptz;

COMMENT ON COLUMN kcml.browser_action_attempt.effect_commands_admitted_at IS
  'SSOT_CURRENT.md 49.25 durable checkpoint after browser T2 and canonical upload/download/challenge command admission';
