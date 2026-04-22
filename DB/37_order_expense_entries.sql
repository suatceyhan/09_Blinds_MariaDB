-- Order-level expense ledger (costs) that affect profit only.
-- Does not change totals/balance/payments.

CREATE TABLE IF NOT EXISTS order_expense_entries (
  id           UUID          NOT NULL DEFAULT gen_random_uuid(),
  company_id   UUID          NOT NULL,
  order_id     VARCHAR(16)   NOT NULL,
  amount       NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  note         TEXT,
  spent_at     TIMESTAMPTZ,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by_user_id UUID,
  is_deleted   BOOLEAN       NOT NULL DEFAULT FALSE,
  PRIMARY KEY (id),
  CONSTRAINT fk_order_expense_entries_order
    FOREIGN KEY (company_id, order_id)
    REFERENCES orders (company_id, id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  CONSTRAINT fk_order_expense_entries_created_by
    FOREIGN KEY (created_by_user_id)
    REFERENCES users (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_order_expense_entries_company_order_created
  ON order_expense_entries (company_id, order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_order_expense_entries_active
  ON order_expense_entries (company_id, order_id, created_at DESC)
  WHERE COALESCE(is_deleted, FALSE) = FALSE;

