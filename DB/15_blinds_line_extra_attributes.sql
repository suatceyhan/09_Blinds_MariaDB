-- 15_blinds_line_extra_attributes.sql
-- Extra per-blinds-type line attributes (e.g. lifting system, cassette type), in addition to product category.
-- Orders: blinds_lines[].<line_json_key> stores option code (same pattern as category).
-- Configure allowed combinations under Settings (one matrix per kind). Manage options under Lookups.

BEGIN;

CREATE TABLE IF NOT EXISTS blinds_line_extra_kind (
  id            VARCHAR(32)  NOT NULL PRIMARY KEY,
  name          TEXT           NOT NULL,
  line_json_key VARCHAR(32)    NOT NULL UNIQUE,
  sort_order    INTEGER        NOT NULL DEFAULT 0,
  active        BOOLEAN        NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_blinds_line_extra_kind_json_key
    CHECK (line_json_key ~ '^[a-z][a-z0-9_]*$' AND line_json_key <> 'category')
);

CREATE INDEX IF NOT EXISTS idx_blinds_line_extra_kind_active
  ON blinds_line_extra_kind (active) WHERE active IS TRUE;

CREATE TABLE IF NOT EXISTS blinds_line_extra_option (
  kind_id     VARCHAR(32) NOT NULL,
  code        VARCHAR(32) NOT NULL,
  name        TEXT        NOT NULL,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  active      BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (kind_id, code),
  CONSTRAINT fk_bleo_kind
    FOREIGN KEY (kind_id)
    REFERENCES blinds_line_extra_kind (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_blinds_line_extra_option_kind_active
  ON blinds_line_extra_option (kind_id) WHERE active IS TRUE;

CREATE TABLE IF NOT EXISTS blinds_type_extra_allowed (
  company_id       UUID        NOT NULL,
  blinds_type_id   VARCHAR(16) NOT NULL,
  kind_id          VARCHAR(32) NOT NULL,
  option_code      VARCHAR(32) NOT NULL,
  PRIMARY KEY (company_id, blinds_type_id, kind_id, option_code),
  CONSTRAINT fk_btea_blinds_type
    FOREIGN KEY (company_id, blinds_type_id)
    REFERENCES blinds_type (company_id, id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  CONSTRAINT fk_btea_option
    FOREIGN KEY (kind_id, option_code)
    REFERENCES blinds_line_extra_option (kind_id, code)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_btea_company_type
  ON blinds_type_extra_allowed (company_id, blinds_type_id);

INSERT INTO blinds_line_extra_kind (id, name, line_json_key, sort_order, active) VALUES
  ('lifting_system', 'Lifting system', 'lifting_system', 10, TRUE),
  ('cassette_type', 'Cassette type', 'cassette_type', 20, TRUE)
ON CONFLICT (id) DO NOTHING;

COMMIT;
