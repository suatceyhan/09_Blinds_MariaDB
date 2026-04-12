-- companies: legacy DBs may lack updated_at while trigger set_updated_at() expects it.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE companies SET updated_at = COALESCE(created_at, NOW()) WHERE updated_at IS NULL;
