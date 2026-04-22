-- Per-blinds-line photos for orders (fabric selection reference).
-- Stored as order_attachments(kind='line_photo') with an associated blinds_type_id.

ALTER TABLE order_attachments
  ADD COLUMN IF NOT EXISTS blinds_type_id VARCHAR(16);

-- Expand kind enum (was: photo|excel).
ALTER TABLE order_attachments
  DROP CONSTRAINT IF EXISTS order_attachments_kind_check;

ALTER TABLE order_attachments
  ADD CONSTRAINT order_attachments_kind_check
  CHECK (kind IN ('photo', 'excel', 'line_photo'));

CREATE INDEX IF NOT EXISTS idx_order_attachments_line_photos
  ON order_attachments (company_id, order_id, blinds_type_id, created_at DESC)
  WHERE COALESCE(is_deleted, FALSE) = FALSE
    AND kind = 'line_photo'
    AND blinds_type_id IS NOT NULL;

