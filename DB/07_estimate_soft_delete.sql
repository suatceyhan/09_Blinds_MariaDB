-- Soft-delete flag for estimates (list/detail exclude deleted; workspace policy).
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_estimate_company_not_deleted
  ON estimate (company_id)
  WHERE is_deleted IS NOT TRUE;
