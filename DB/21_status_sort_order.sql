-- Display / filter order for order and estimate status lookups (per company).
BEGIN;

ALTER TABLE status_order ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE status_estimate ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- Order statuses: stable initial order by name within each company.
WITH ranked AS (
  SELECT company_id, id,
    (ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY name ASC) - 1)::int AS rn
  FROM status_order
)
UPDATE status_order so
SET sort_order = ranked.rn
FROM ranked
WHERE so.company_id = ranked.company_id AND so.id = ranked.id;

-- Built-in estimate slugs keep a fixed band; custom (NULL slug) rows sort after.
UPDATE status_estimate SET sort_order = 0 WHERE slug = 'pending';
UPDATE status_estimate SET sort_order = 1 WHERE slug = 'converted';
UPDATE status_estimate SET sort_order = 2 WHERE slug = 'cancelled';

WITH custom_ranked AS (
  SELECT company_id, id,
    (100 + ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY name ASC))::int AS rn
  FROM status_estimate
  WHERE slug IS NULL
)
UPDATE status_estimate se
SET sort_order = custom_ranked.rn
FROM custom_ranked
WHERE se.company_id = custom_ranked.company_id AND se.id = custom_ranked.id;

COMMIT;
