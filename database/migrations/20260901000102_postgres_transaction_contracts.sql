-- KCML_PHASE_PLAN: EXPAND, VALIDATE, ACTIVATE
-- KCML_TRANSACTION_MODE: TRANSACTIONAL

BEGIN;

-- These constraints are the physical part of the T1/D/T2/T3 contract.  They
-- are deliberately row-local or unique-index constraints; cross-row rules
-- remain in the canonical operation transaction and are tested with real
-- barriers in tests/postgres.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'concurrency_claim_expiry_after_acquire') THEN
    ALTER TABLE kcml.concurrency_claim
      ADD CONSTRAINT concurrency_claim_expiry_after_acquire
      CHECK (expires_at > acquired_at) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'queue_item_claim_fields_consistent') THEN
    ALTER TABLE kcml.queue_item
      ADD CONSTRAINT queue_item_claim_fields_consistent
      CHECK (status <> 'CLAIMED' OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL AND lease_fencing_token > 0)) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactional_outbox_payload_digest_length') THEN
    ALTER TABLE kcml.transactional_outbox
      ADD CONSTRAINT transactional_outbox_payload_digest_length
      CHECK (octet_length(payload_digest) = 32) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactional_outbox_authority_shape') THEN
    ALTER TABLE kcml.transactional_outbox
      ADD CONSTRAINT transactional_outbox_authority_shape
      CHECK (
        (purpose = 'SIDE_EFFECT_DISPATCH' AND is_dispatch_authority = true AND side_effect_operation_id IS NOT NULL AND side_effect_attempt_sequence IS NOT NULL)
        OR (purpose <> 'SIDE_EFFECT_DISPATCH' AND is_dispatch_authority = false)
      ) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'side_effect_attempt_request_digest_length') THEN
    ALTER TABLE kcml.side_effect_attempt
      ADD CONSTRAINT side_effect_attempt_request_digest_length
      CHECK (octet_length(request_digest) = 32) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'side_effect_attempt_evidence_digest_length') THEN
    ALTER TABLE kcml.side_effect_attempt_evidence
      ADD CONSTRAINT side_effect_attempt_evidence_digest_length
      CHECK (octet_length(payload_digest) = 32) NOT VALID;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS transactional_outbox_side_effect_attempt_uq
  ON kcml.transactional_outbox(side_effect_operation_id, side_effect_attempt_sequence)
  WHERE purpose = 'SIDE_EFFECT_DISPATCH' AND is_dispatch_authority = true;

CREATE UNIQUE INDEX IF NOT EXISTS queue_logical_command_active_uq
  ON kcml.queue_item(queue_name, command_id)
  WHERE command_id IS NOT NULL AND status IN ('READY', 'CLAIMED');

ALTER TABLE kcml.concurrency_claim VALIDATE CONSTRAINT concurrency_claim_expiry_after_acquire;
ALTER TABLE kcml.queue_item VALIDATE CONSTRAINT queue_item_claim_fields_consistent;
ALTER TABLE kcml.transactional_outbox VALIDATE CONSTRAINT transactional_outbox_payload_digest_length;
ALTER TABLE kcml.transactional_outbox VALIDATE CONSTRAINT transactional_outbox_authority_shape;
ALTER TABLE kcml.side_effect_attempt VALIDATE CONSTRAINT side_effect_attempt_request_digest_length;
ALTER TABLE kcml.side_effect_attempt_evidence VALIDATE CONSTRAINT side_effect_attempt_evidence_digest_length;

COMMIT;
