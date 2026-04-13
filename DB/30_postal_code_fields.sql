-- 30_postal_code_fields.sql
-- Optional postal codes stored separately from address lines.
-- Rationale: Photon/OpenStreetMap postcodes are often street-segment approximations; users enter the true code manually.
BEGIN;

ALTER TABLE companies ADD COLUMN IF NOT EXISTS postal_code VARCHAR(32);

ALTER TABLE customers ADD COLUMN IF NOT EXISTS postal_code TEXT;

ALTER TABLE estimate ADD COLUMN IF NOT EXISTS visit_postal_code TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS prospect_postal_code TEXT;

COMMIT;

