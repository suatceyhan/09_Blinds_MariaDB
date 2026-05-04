-- Per-line product category on estimate lines (matches order blinds_lines.category semantics).
-- Run once on existing MariaDB databases.

ALTER TABLE estimate_blinds
  ADD COLUMN product_category_code VARCHAR(32) NULL;

ALTER TABLE estimate_blinds
  ADD CONSTRAINT fk_estimate_blinds_product_category
  FOREIGN KEY (product_category_code) REFERENCES blinds_product_category (code)
  ON DELETE SET NULL ON UPDATE CASCADE;
