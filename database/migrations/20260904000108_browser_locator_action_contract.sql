-- KCML_PHASE_PLAN: EXPAND, VALIDATE, ACTIVATE
-- KCML_TRANSACTION_MODE: TRANSACTIONAL

ALTER TABLE kcml.browser_target_reference
  ADD COLUMN IF NOT EXISTS locator_schema_version text NOT NULL DEFAULT '1.0',
  ADD COLUMN IF NOT EXISTS context_generation bigint,
  ADD COLUMN IF NOT EXISTS page_generation bigint,
  ADD COLUMN IF NOT EXISTS frame_path jsonb,
  ADD COLUMN IF NOT EXISTS document_id uuid;

WITH resolved AS (
  SELECT r.id,s.context_generation,s.page_generation,
    (SELECT d.id FROM kcml.browser_document d
     WHERE d.page_id=r.page_id AND d.frame_id=r.frame_id AND d.document_epoch=r.document_epoch
     ORDER BY d.created_at DESC LIMIT 1) AS document_id
  FROM kcml.browser_target_reference r
  JOIN kcml.browser_session s ON s.id=r.session_id
  WHERE r.context_generation IS NULL OR r.page_generation IS NULL OR r.frame_path IS NULL OR r.document_id IS NULL
)
UPDATE kcml.browser_target_reference r
SET context_generation = resolved.context_generation,
    page_generation = resolved.page_generation,
    frame_path = '[]'::jsonb,
    document_id = resolved.document_id
FROM resolved
WHERE r.id=resolved.id;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM kcml.browser_target_reference WHERE context_generation IS NULL OR page_generation IS NULL OR frame_path IS NULL OR document_id IS NULL) THEN
    RAISE EXCEPTION 'browser LocatorRef backfill requires a matching canonical browser_document';
  END IF;
END $$;

ALTER TABLE kcml.browser_target_reference
  ALTER COLUMN context_generation SET NOT NULL,
  ALTER COLUMN page_generation SET NOT NULL,
  ALTER COLUMN frame_path SET NOT NULL,
  ALTER COLUMN document_id SET NOT NULL;

ALTER TABLE kcml.browser_target_reference
  DROP CONSTRAINT IF EXISTS browser_target_reference_version_check,
  ADD CONSTRAINT browser_target_reference_version_check CHECK (
    locator_schema_version='1.0'
    AND context_generation > 0
    AND page_generation > 0
    AND document_epoch >= 0
    AND jsonb_typeof(frame_path)='array'
    AND jsonb_array_length(frame_path) <= 64
  );

CREATE INDEX IF NOT EXISTS browser_target_reference_fence_idx
  ON kcml.browser_target_reference(session_id,context_generation,page_id,page_generation,frame_id,document_id,document_epoch);

COMMENT ON CONSTRAINT browser_target_reference_version_check ON kcml.browser_target_reference IS
  'SSOT_CURRENT.md 13.8/49.19 versioned LocatorRef is bound to the complete browser identity fence';
