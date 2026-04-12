-- 13_blinds_product_categories.sql
-- Global product categories (shared by all companies) + per-company matrix:
-- which categories are allowed for each blinds type.
-- Orders store blinds_lines[].category = blinds_product_category.code (exposed as "id" in the API).
-- Starter rows below run only when you apply this SQL; the application does not re-insert them at runtime.
-- Idempotent: safe to run multiple times on empty or already-migrated DB.

BEGIN;

CREATE TABLE IF NOT EXISTS blinds_product_category (
  code         VARCHAR(32) NOT NULL PRIMARY KEY,
  name         TEXT         NOT NULL,
  sort_order   INTEGER      NOT NULL DEFAULT 0,
  active       BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blinds_product_category_active
  ON blinds_product_category (active) WHERE active IS TRUE;

CREATE TABLE IF NOT EXISTS blinds_type_category_allowed (
  company_id       UUID         NOT NULL,
  blinds_type_id   VARCHAR(16)  NOT NULL,
  category_code    VARCHAR(32)  NOT NULL,
  PRIMARY KEY (company_id, blinds_type_id, category_code),
  CONSTRAINT fk_btca_blinds_type
    FOREIGN KEY (company_id, blinds_type_id)
    REFERENCES blinds_type (company_id, id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  CONSTRAINT fk_btca_category
    FOREIGN KEY (category_code)
    REFERENCES blinds_product_category (code)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_btca_company_type
  ON blinds_type_category_allowed (company_id, blinds_type_id);

INSERT INTO blinds_product_category (code, name, sort_order, active) VALUES
  ('classic', 'Classic', 1, TRUE),
  ('delux', 'Delux', 2, TRUE),
  ('premium', 'Premium', 3, TRUE)
ON CONFLICT (code) DO NOTHING;

-- Backfill matrix (name-based rules), excluding curtain types.
INSERT INTO blinds_type_category_allowed (company_id, blinds_type_id, category_code)
SELECT bt.company_id, bt.id, pc.code
FROM blinds_type bt
JOIN blinds_product_category pc ON pc.active IS TRUE
WHERE NOT (lower(bt.name) ~ 'curtain')
  AND (
    (lower(bt.name) ~ '(zebra|roller)' AND pc.code IN ('classic', 'delux', 'premium'))
    OR (lower(bt.name) ~ 'galaxy' AND pc.code IN ('classic', 'premium'))
    OR (
      (lower(bt.name) ~ 'honeycomb' OR lower(bt.name) ~ 'honeyc')
      AND pc.code IN ('delux', 'premium')
    )
  )
ON CONFLICT DO NOTHING;

COMMIT;
