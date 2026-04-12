-- 14_migrate_product_category_to_global.sql
-- Use ONLY if a previous version of 13 created blinds_product_category WITH company_id.
-- Fresh installs: run the current 13_blinds_product_categories.sql only (no 14).

BEGIN;

DO $m$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'blinds_product_category'
      AND column_name = 'company_id'
  ) THEN
    RAISE NOTICE 'blinds_product_category is already global; skipped migration.';
  ELSE
    ALTER TABLE blinds_type_category_allowed DROP CONSTRAINT IF EXISTS fk_btca_category;

    ALTER TABLE blinds_product_category RENAME TO blinds_product_category_old;

    CREATE TABLE blinds_product_category (
      code         VARCHAR(32) NOT NULL PRIMARY KEY,
      name         TEXT         NOT NULL,
      sort_order   INTEGER      NOT NULL DEFAULT 0,
      active       BOOLEAN      NOT NULL DEFAULT TRUE,
      created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_blinds_product_category_active
      ON blinds_product_category (active) WHERE active IS TRUE;

    INSERT INTO blinds_product_category (code, name, sort_order, active)
    SELECT DISTINCT ON (o.id)
      SUBSTRING(o.id::text FROM 1 FOR 32),
      o.name,
      o.sort_order,
      o.active
    FROM blinds_product_category_old o
    ORDER BY o.id, o.company_id;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'blinds_type_category_allowed'
        AND column_name = 'category_id'
    ) THEN
      ALTER TABLE blinds_type_category_allowed RENAME COLUMN category_id TO category_code;
    END IF;

    ALTER TABLE blinds_type_category_allowed ALTER COLUMN category_code TYPE VARCHAR(32);

    ALTER TABLE blinds_type_category_allowed
      ADD CONSTRAINT fk_btca_category
      FOREIGN KEY (category_code)
      REFERENCES blinds_product_category (code)
      ON UPDATE CASCADE
      ON DELETE CASCADE;

    DROP TABLE blinds_product_category_old;

    INSERT INTO blinds_product_category (code, name, sort_order, active) VALUES
      ('classic', 'Classic', 1, TRUE),
      ('delux', 'Delux', 2, TRUE),
      ('premium', 'Premium', 3, TRUE)
    ON CONFLICT (code) DO NOTHING;
  END IF;
END
$m$;

COMMIT;
