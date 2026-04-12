-- 02_estimate_to_order_link.sql
-- Estimate -> Order dönüşümü için order üzerinde estimate referansı.
-- İdempotent: tekrar çalıştırmak güvenlidir.

BEGIN;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS estimate_id VARCHAR(16);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_orders_estimate') THEN
    ALTER TABLE orders
      ADD CONSTRAINT fk_orders_estimate
      FOREIGN KEY (company_id, estimate_id)
      REFERENCES estimate (company_id, id)
      ON UPDATE CASCADE
      ON DELETE SET NULL;
  END IF;
END $$;

COMMIT;

