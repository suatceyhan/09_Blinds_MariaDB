-- Backfill `builtin_kind` on rows that still have NULL but whose `name` matches a built-in workflow.
-- Use when a company was created without seeding (e.g. before registration approval seeded defaults).
-- Picks one row per (company_id, inferred kind) by sort_order, id; skips if that kind already exists for the company.
-- Run **`26_status_estimate_builtin_kind_add_new.sql`** first so `new` is allowed in CHECK.
BEGIN;

WITH labeled AS (
  SELECT
    se.company_id,
    se.id,
    CASE
      WHEN lower(trim(se.name)) = 'new estimate' THEN 'new'
      WHEN lower(trim(se.name)) = 'pending' THEN 'pending'
      WHEN lower(trim(se.name)) IN ('cancelled', 'canceled') THEN 'cancelled'
      WHEN lower(trim(se.name)) LIKE 'converted to ord%'
        OR lower(trim(se.name)) = 'converted to order'
        OR lower(trim(se.name)) = 'convert to order' THEN 'converted'
      ELSE NULL
    END AS kind,
    row_number() OVER (
      PARTITION BY se.company_id,
        CASE
          WHEN lower(trim(se.name)) = 'new estimate' THEN 'new'
          WHEN lower(trim(se.name)) = 'pending' THEN 'pending'
          WHEN lower(trim(se.name)) IN ('cancelled', 'canceled') THEN 'cancelled'
          WHEN lower(trim(se.name)) LIKE 'converted to ord%'
            OR lower(trim(se.name)) = 'converted to order'
            OR lower(trim(se.name)) = 'convert to order' THEN 'converted'
          ELSE NULL
        END
      ORDER BY se.sort_order ASC, se.id ASC
    ) AS rn
  FROM status_estimate se
  WHERE se.builtin_kind IS NULL
),
to_fix AS (
  SELECT company_id, id, kind
  FROM labeled
  WHERE kind IS NOT NULL AND rn = 1
)
UPDATE status_estimate se
SET builtin_kind = tf.kind
FROM to_fix tf
WHERE se.company_id = tf.company_id AND se.id = tf.id
  AND NOT EXISTS (
    SELECT 1
    FROM status_estimate x
    WHERE x.company_id = tf.company_id AND x.builtin_kind = tf.kind
  );

COMMIT;
