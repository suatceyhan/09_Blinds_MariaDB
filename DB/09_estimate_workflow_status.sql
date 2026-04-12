-- Estimate workflow: pending | converted | cancelled + optional order → converted trigger.
BEGIN;

ALTER TABLE estimate ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_estimate_status') THEN
    ALTER TABLE estimate
      ADD CONSTRAINT ck_estimate_status
      CHECK (status IN ('pending', 'converted', 'cancelled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_estimate_company_status
  ON estimate (company_id, status)
  WHERE is_deleted IS NOT TRUE;

-- When an order is created with estimate_id, mark the estimate converted.
CREATE OR REPLACE FUNCTION public.trg_orders_mark_estimate_converted()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.estimate_id IS NOT NULL AND btrim(NEW.estimate_id::text) <> '' THEN
    UPDATE public.estimate
    SET status = 'converted', updated_at = NOW()
    WHERE company_id = NEW.company_id
      AND id = NEW.estimate_id
      AND is_deleted IS NOT TRUE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_orders_mark_estimate_converted ON orders;
CREATE TRIGGER tr_orders_mark_estimate_converted
  AFTER INSERT ON orders
  FOR EACH ROW
  EXECUTE PROCEDURE public.trg_orders_mark_estimate_converted();

COMMIT;
