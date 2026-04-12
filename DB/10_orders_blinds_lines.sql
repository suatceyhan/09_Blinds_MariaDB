-- 10_orders_blinds_lines.sql
-- Store chosen blinds lines (from estimate or manual) on orders as JSONB.
-- Idempotent: safe to run multiple times.

BEGIN;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS blinds_lines JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_orders_company_blinds_lines
  ON orders (company_id)
  WHERE active IS TRUE;

COMMIT;

