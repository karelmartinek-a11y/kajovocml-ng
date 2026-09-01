-- KCML_PHASE_PLAN: EXPAND, VALIDATE, ACTIVATE
-- KCML_TRANSACTION_MODE: TRANSACTIONAL

BEGIN;

ALTER TABLE kcml.ai_model_call
  ADD COLUMN IF NOT EXISTS local_state text,
  ADD COLUMN IF NOT EXISTS provider_status text,
  ADD COLUMN IF NOT EXISTS completion_kind text,
  ADD COLUMN IF NOT EXISTS dispatch_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS transport_evidence jsonb,
  ADD COLUMN IF NOT EXISTS error jsonb,
  ADD COLUMN IF NOT EXISTS model_logical_operation_id uuid;

UPDATE kcml.ai_model_call
SET local_state = CASE submit_state
  WHEN 'INTENT_RECORDED' THEN 'QUEUED'
  WHEN 'DISPATCH_STARTED' THEN 'SUBMITTING'
  WHEN 'RESPONSE_IDENTIFIED' THEN 'IN_PROGRESS'
  WHEN 'STREAMING' THEN 'STREAMING'
  WHEN 'COMPLETED' THEN 'COMPLETED'
  ELSE 'FAILED'
END
WHERE local_state IS NULL;

UPDATE kcml.ai_model_call
SET model_logical_operation_id = id
WHERE model_logical_operation_id IS NULL;

ALTER TABLE kcml.ai_model_call
  ALTER COLUMN local_state SET DEFAULT 'QUEUED',
  ALTER COLUMN local_state SET NOT NULL,
  ALTER COLUMN transport_evidence SET DEFAULT '{}'::jsonb,
  ALTER COLUMN transport_evidence SET NOT NULL,
  ALTER COLUMN model_logical_operation_id SET NOT NULL;

ALTER TABLE kcml.ai_model_call DROP CONSTRAINT IF EXISTS ai_model_call_local_state_check;
ALTER TABLE kcml.ai_model_call ADD CONSTRAINT ai_model_call_local_state_check
  CHECK (local_state IN ('QUEUED','SUBMITTING','IN_PROGRESS','STREAMING','WAITING_FOR_TOOL_OUTPUT','COMPLETED','INCOMPLETE','REFUSED','CANCEL_REQUESTED','CANCELLED','FAILED','EXPIRED'));

CREATE UNIQUE INDEX IF NOT EXISTS ai_model_call_provider_response_id_uq
  ON kcml.ai_model_call(provider_response_id) WHERE provider_response_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS openai_request_descriptor_idempotency_uq
  ON kcml.openai_request_descriptor(owner_kind, owner_object_id, idempotency_scope, idempotency_key)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ai_model_call_logical_attempt_uq
  ON kcml.ai_model_call(model_logical_operation_id, attempt_sequence);
CREATE UNIQUE INDEX IF NOT EXISTS ai_model_event_provider_sequence_uq
  ON kcml.ai_model_event(model_call_id, provider_sequence) WHERE provider_sequence IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ai_model_output_item_provider_index_uq
  ON kcml.ai_model_output_item(model_call_id, output_index);
CREATE UNIQUE INDEX IF NOT EXISTS ai_model_output_item_provider_item_uq
  ON kcml.ai_model_output_item(model_call_id, provider_item_id) WHERE provider_item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ai_tool_dispatch_call_id_uq
  ON kcml.ai_tool_dispatch(model_call_id, provider_call_id);
CREATE UNIQUE INDEX IF NOT EXISTS ai_model_continuation_generation_uq
  ON kcml.ai_model_continuation(parent_run_id, producing_model_call_id, continuation_generation);

COMMIT;
