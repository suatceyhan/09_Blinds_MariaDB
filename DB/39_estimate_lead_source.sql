-- 39_estimate_lead_source.sql
-- Adds estimate.lead_source for monthly marketing-source reports.
-- Allowed values: 'referral' | 'advertising' (NULL = unknown).

BEGIN;

ALTER TABLE estimate
  ADD COLUMN IF NOT EXISTS lead_source TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_estimate_lead_source'
  ) THEN
    ALTER TABLE estimate
      ADD CONSTRAINT ck_estimate_lead_source
      CHECK (lead_source IS NULL OR lead_source IN ('referral', 'advertising'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_estimate_company_lead_source
  ON estimate (company_id, lead_source);

COMMIT;

