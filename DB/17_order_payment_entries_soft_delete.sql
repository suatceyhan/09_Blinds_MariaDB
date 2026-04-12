-- Soft-delete for payment history lines (DELETE API sets is_deleted; sums exclude deleted rows).

ALTER TABLE order_payment_entries
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_order_payment_entries_active
  ON order_payment_entries (company_id, order_id, created_at DESC)
  WHERE COALESCE(is_deleted, FALSE) = FALSE;
