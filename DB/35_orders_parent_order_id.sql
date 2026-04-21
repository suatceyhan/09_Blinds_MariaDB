-- Line-item additions: optional parent order (same customer job; excluded from main list).

ALTER TABLE orders ADD COLUMN IF NOT EXISTS parent_order_id VARCHAR(16);

ALTER TABLE orders DROP CONSTRAINT IF EXISTS fk_orders_parent_order;

ALTER TABLE orders
  ADD CONSTRAINT fk_orders_parent_order
  FOREIGN KEY (company_id, parent_order_id)
  REFERENCES orders (company_id, id)
  ON UPDATE CASCADE ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_orders_company_parent ON orders (company_id, parent_order_id)
  WHERE parent_order_id IS NOT NULL AND active IS TRUE;
