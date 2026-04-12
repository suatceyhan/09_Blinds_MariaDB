-- Allow extra estimate statuses (slug NULL) like custom order labels; keep slug only for built-in workflow rows.
BEGIN;

ALTER TABLE status_estimate DROP CONSTRAINT IF EXISTS ck_status_estimate_slug;
ALTER TABLE status_estimate DROP CONSTRAINT IF EXISTS uq_status_estimate_company_slug;

ALTER TABLE status_estimate ALTER COLUMN slug DROP NOT NULL;

ALTER TABLE status_estimate ADD CONSTRAINT ck_status_estimate_slug_null_or_enum
  CHECK (slug IS NULL OR slug IN ('pending', 'converted', 'cancelled'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_status_estimate_company_slug_nn
  ON status_estimate (company_id, slug)
  WHERE slug IS NOT NULL;

COMMIT;
