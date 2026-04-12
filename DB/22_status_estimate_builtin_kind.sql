-- Replace legacy `slug` with `builtin_kind` (same semantics; not shown in Lookups UI).
-- Run after 19 / 20 / 21. Updates the order→converted trigger to use `builtin_kind`.
BEGIN;

ALTER TABLE status_estimate ADD COLUMN IF NOT EXISTS builtin_kind TEXT;

UPDATE status_estimate SET builtin_kind = slug WHERE slug IS NOT NULL;

ALTER TABLE status_estimate DROP CONSTRAINT IF EXISTS ck_status_estimate_slug_null_or_enum;
ALTER TABLE status_estimate DROP CONSTRAINT IF EXISTS ck_status_estimate_slug;
DROP INDEX IF EXISTS uq_status_estimate_company_slug_nn;

ALTER TABLE status_estimate DROP COLUMN IF EXISTS slug;

ALTER TABLE status_estimate ADD CONSTRAINT ck_status_estimate_builtin_kind
  CHECK (builtin_kind IS NULL OR builtin_kind IN ('pending', 'converted', 'cancelled'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_status_estimate_company_builtin_nn
  ON status_estimate (company_id, builtin_kind)
  WHERE builtin_kind IS NOT NULL;

CREATE OR REPLACE FUNCTION public.trg_orders_mark_estimate_converted()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.estimate_id IS NOT NULL AND btrim(NEW.estimate_id::text) <> '' THEN
    UPDATE public.estimate
    SET
      status_esti_id = (
        SELECT se.id
        FROM public.status_estimate se
        WHERE se.company_id = NEW.company_id AND se.builtin_kind = 'converted'
        LIMIT 1
      ),
      updated_at = NOW()
    WHERE company_id = NEW.company_id
      AND id = NEW.estimate_id
      AND is_deleted IS NOT TRUE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
