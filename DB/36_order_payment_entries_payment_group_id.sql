-- Add a grouping id so a single user "record payment" action can be shown as one line,
-- even if it is allocated across multiple orders (anchor + additional orders).

ALTER TABLE order_payment_entries
  ADD COLUMN IF NOT EXISTS payment_group_id UUID;

CREATE INDEX IF NOT EXISTS idx_order_payment_entries_group
  ON order_payment_entries (company_id, payment_group_id, created_at DESC)
  WHERE payment_group_id IS NOT NULL AND COALESCE(is_deleted, FALSE) = FALSE;

