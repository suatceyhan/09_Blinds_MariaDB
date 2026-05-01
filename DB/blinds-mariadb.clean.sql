-- blinds-mariadb.clean.sql — Fresh install (clean, consolidated)
-- MariaDB (tested assumptions: 10.6+ / InnoDB / utf8mb4)
--
-- Converted from `DB/blinds-postgresql.clean.sql`.
--
-- Notes / intentional differences vs PostgreSQL:
-- - PostgreSQL-only features were removed: extensions (pgcrypto), plpgsql functions, DO $$ blocks,
--   RLS policies, `current_setting(...)`, partial indexes (`... WHERE ...`), and `ON CONFLICT`.
-- - `uuid` is represented as CHAR(36) with DEFAULT (UUID()).
-- - `timestamptz` is represented as DATETIME(6) (timezone handling should be done at app layer).
-- - `jsonb` is represented as JSON.
--
-- Usage:
--   mariadb -u <user> -p <db> < DB/blinds-mariadb.clean.sql
START TRANSACTION;
-- =============================================================================
-- Auth / RBAC
-- =============================================================================
CREATE TABLE IF NOT EXISTS role_groups (
  id           CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  name         VARCHAR(255) NOT NULL,
  description  TEXT,
  is_deleted   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_by   CHAR(36),
  updated_by   CHAR(36),
  CONSTRAINT uq_role_groups_name UNIQUE (name)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS users (
  id                      CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  company_id              CHAR(36) NULL,
  first_name              VARCHAR(255) NOT NULL,
  last_name               VARCHAR(255) NOT NULL,
  phone                   VARCHAR(255) NOT NULL,
  password                VARCHAR(255) NOT NULL,
  email                   VARCHAR(255) NOT NULL,
  created_at              DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_by              CHAR(36) NULL,
  updated_at              DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_by              CHAR(36) NULL,
  is_deleted              BOOLEAN NOT NULL DEFAULT FALSE,
  last_login              DATETIME(6) NULL,
  failed_login_attempts   INT NOT NULL DEFAULT 0,
  account_locked_until    DATETIME(6) NULL,
  is_password_set         BOOLEAN NOT NULL DEFAULT FALSE,
  is_first_login          BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password    BOOLEAN NOT NULL DEFAULT FALSE,
  role_group_id           CHAR(36) NULL,
  default_role_id         CHAR(36) NULL,
  photo_url               VARCHAR(255) NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS roles (
  id             CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  name           VARCHAR(255) NOT NULL,
  description    TEXT,
  is_protected   BOOLEAN NOT NULL DEFAULT FALSE,
  is_deleted     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_by     CHAR(36) NULL,
  updated_by     CHAR(36) NULL,
  role_group_id  CHAR(36) NULL,
  CONSTRAINT uq_roles_name UNIQUE (name)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS permissions (
  id           CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  `key`        VARCHAR(255) NOT NULL,
  parent_key   VARCHAR(255),
  name         VARCHAR(255) NOT NULL,
  target_type  VARCHAR(255) NOT NULL,
  target_id    VARCHAR(255) NOT NULL,
  action       VARCHAR(255) NOT NULL,
  module_name  VARCHAR(255),
  route_path   VARCHAR(255),
  lookup_key   VARCHAR(255),
  sort_index   INT NOT NULL DEFAULT 0,
  is_deleted   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_by   CHAR(36) NULL,
  updated_by   CHAR(36) NULL,
  CONSTRAINT uq_permissions_key UNIQUE (`key`)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id        CHAR(36) NOT NULL,
  permission_id  CHAR(36) NOT NULL,
  is_granted     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_by     CHAR(36) NULL,
  updated_by     CHAR(36) NULL,
  updated_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  is_deleted     BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_role_permissions_role
    FOREIGN KEY (role_id) REFERENCES roles (id),
  CONSTRAINT fk_role_permissions_permission
    FOREIGN KEY (permission_id) REFERENCES permissions (id),
  CONSTRAINT fk_role_permissions_created_by
    FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_role_permissions_updated_by
    FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS user_roles (
  id          CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id     CHAR(36) NOT NULL,
  role_id     CHAR(36) NOT NULL,
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_by  CHAR(36) NULL,
  updated_by  CHAR(36) NULL,
  updated_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  is_deleted  BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT uq_user_roles_user_role UNIQUE (user_id, role_id),
  CONSTRAINT fk_user_roles_user
    FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_user_roles_role
    FOREIGN KEY (role_id) REFERENCES roles (id),
  CONSTRAINT fk_user_roles_created_by
    FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_user_roles_updated_by
    FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS user_permissions (
  user_id        CHAR(36) NOT NULL,
  permission_id  CHAR(36) NOT NULL,
  role_id        CHAR(36) NOT NULL,
  is_granted     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_by     CHAR(36) NULL,
  updated_by     CHAR(36) NULL,
  updated_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  is_deleted     BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (user_id, permission_id, role_id),
  CONSTRAINT fk_user_permissions_user
    FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_user_permissions_permission
    FOREIGN KEY (permission_id) REFERENCES permissions (id),
  CONSTRAINT fk_user_permissions_role
    FOREIGN KEY (role_id) REFERENCES roles (id),
  CONSTRAINT fk_user_permissions_created_by
    FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_user_permissions_updated_by
    FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS revoked_tokens (
  id          CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  -- Store a stable fingerprint of the JWT (full JWTs can exceed 255 chars).
  token       CHAR(64) NOT NULL,
  user_id     CHAR(36) NULL,
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  revoked_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  is_used     BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT uq_revoked_tokens_token UNIQUE (token),
  CONSTRAINT fk_revoked_tokens_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS login_attempts (
  id            CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id       CHAR(36) NULL,
  ip_address    VARCHAR(45),
  user_agent    VARCHAR(255),
  success       BOOLEAN NOT NULL DEFAULT FALSE,
  attempted_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_login_attempts_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB;
CREATE INDEX idx_login_attempts_user_time
  ON login_attempts (user_id, attempted_at DESC);
CREATE TABLE IF NOT EXISTS user_sessions (
  id              CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id         CHAR(36) NOT NULL,
  session_token   VARCHAR(255) NOT NULL,
  created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  last_seen_at    DATETIME(6),
  expires_at      DATETIME(6),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT uq_user_sessions_token UNIQUE (session_token),
  CONSTRAINT fk_user_sessions_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id           CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id      CHAR(36) NOT NULL,
  token        VARCHAR(100) NOT NULL,
  created_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  expires_at   DATETIME(6) NOT NULL,
  is_used      BOOLEAN NOT NULL DEFAULT FALSE,
  used_at      DATETIME(6),
  ip_address   VARCHAR(45),
  user_agent   VARCHAR(255),
  attempts     INT NOT NULL DEFAULT 0,
  CONSTRAINT uq_password_reset_tokens_token UNIQUE (token),
  CONSTRAINT fk_password_reset_tokens_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS pending_employee_self_registrations (
  id                   CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  first_name           VARCHAR(255) NOT NULL,
  last_name            VARCHAR(255) NOT NULL,
  email                VARCHAR(255) NOT NULL,
  phone                VARCHAR(255) NOT NULL,
  password             VARCHAR(255) NOT NULL,
  role_group_id        CHAR(36) NULL,
  request_note         TEXT,
  verification_token   VARCHAR(255) NOT NULL,
  token_sent_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  is_email_verified    BOOLEAN NOT NULL DEFAULT FALSE,
  email_verified_at    DATETIME(6),
  pending_status       VARCHAR(32) NOT NULL DEFAULT 'EMAIL_NOT_VERIFIED',
  approved_by          CHAR(36) NULL,
  approved_at          DATETIME(6),
  requested_at         DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  is_deleted           BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT fk_pending_employee_role_group
    FOREIGN KEY (role_group_id) REFERENCES role_groups (id),
  CONSTRAINT fk_pending_employee_approved_by
    FOREIGN KEY (approved_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB;
CREATE INDEX idx_pending_employee_token
  ON pending_employee_self_registrations (verification_token);
-- Users: unique email + phone (case-insensitive depends on collation)
CREATE UNIQUE INDEX uq_users_email_ci ON users (email);
CREATE UNIQUE INDEX uq_users_phone ON users (phone);
CREATE INDEX ix_users_company_id ON users (company_id);
-- =============================================================================
-- Tenant core
-- =============================================================================
CREATE TABLE IF NOT EXISTS companies (
  id             CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  name           VARCHAR(255) NOT NULL,
  phone          VARCHAR(255),
  website        VARCHAR(255),
  email          VARCHAR(255),
  address        VARCHAR(2000),
  postal_code    VARCHAR(32),
  maps_url       VARCHAR(2000),
  owner_user_id  CHAR(36) NULL,
  logo_url       VARCHAR(500),
  tax_rate_percent DECIMAL(6,3) NULL,
  country_code   VARCHAR(2) NULL,
  region_code    VARCHAR(8) NULL,
  created_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  is_deleted     BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT uq_companies_name UNIQUE (name),
  CONSTRAINT fk_companies_owner_user
    FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB;
CREATE INDEX ix_companies_owner_user_id ON companies (owner_user_id);
CREATE TABLE IF NOT EXISTS company_members (
  company_id  CHAR(36) NOT NULL,
  user_id     CHAR(36) NOT NULL,
  role        VARCHAR(16) NOT NULL DEFAULT 'member',
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (company_id, user_id),
  CONSTRAINT ck_company_members_role CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  CONSTRAINT fk_company_members_company
    FOREIGN KEY (company_id) REFERENCES companies (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_company_members_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;
CREATE INDEX idx_company_members_user ON company_members (user_id);
CREATE TABLE IF NOT EXISTS user_company_memberships (
  id         CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id    CHAR(36) NOT NULL,
  company_id CHAR(36) NOT NULL,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT uq_user_company_memberships_user_company UNIQUE (user_id, company_id),
  CONSTRAINT fk_user_company_memberships_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_user_company_memberships_company
    FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE RESTRICT
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS pending_company_self_registrations (
  id                 CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  first_name         VARCHAR(255) NOT NULL,
  last_name          VARCHAR(255) NOT NULL,
  email              VARCHAR(255) NOT NULL,
  phone              VARCHAR(255) NOT NULL,
  password           VARCHAR(255) NOT NULL,
  company_name       VARCHAR(255) NOT NULL,
  company_phone      VARCHAR(255),
  website            VARCHAR(255),
  request_note       TEXT,
  verification_token VARCHAR(255) NOT NULL,
  token_sent_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  is_email_verified  BOOLEAN NOT NULL DEFAULT FALSE,
  email_verified_at  DATETIME(6),
  pending_status     VARCHAR(32) NOT NULL DEFAULT 'EMAIL_NOT_VERIFIED',
  approved_by        CHAR(36) NULL,
  approved_at        DATETIME(6),
  requested_at       DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  is_deleted         BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT fk_pending_company_approved_by
    FOREIGN KEY (approved_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB;
CREATE INDEX idx_pending_company_token
  ON pending_company_self_registrations (verification_token);
-- =============================================================================
-- Company settings: contract / invoice templates
-- =============================================================================
CREATE TABLE IF NOT EXISTS company_document_templates (
  company_id   CHAR(36) NOT NULL,
  kind         VARCHAR(64) NOT NULL,
  preset_key   VARCHAR(64) NULL,
  subject      VARCHAR(300) NOT NULL DEFAULT '',
  body_html    TEXT NOT NULL,
  created_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  is_deleted   BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (company_id, kind),
  CONSTRAINT fk_company_document_templates_company
    FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE RESTRICT
) ENGINE=InnoDB;
-- =============================================================================
-- Global catalogs + per-company enablement matrices
-- =============================================================================
CREATE TABLE IF NOT EXISTS status_order (
  id           VARCHAR(16) PRIMARY KEY,
  name         TEXT NOT NULL,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order   INT NOT NULL DEFAULT 0,
  builtin_kind VARCHAR(32) NULL,
  CONSTRAINT ck_status_order_builtin_kind_global CHECK (
    builtin_kind IS NULL OR builtin_kind IN ('new', 'ready_for_install', 'in_production', 'done')
  )
) ENGINE=InnoDB;
CREATE UNIQUE INDEX uq_status_order_global_builtin_nn
  ON status_order (builtin_kind);
CREATE TABLE IF NOT EXISTS company_status_order_matrix (
  company_id      CHAR(36) NOT NULL,
  status_order_id VARCHAR(16) NOT NULL,
  PRIMARY KEY (company_id, status_order_id),
  CONSTRAINT fk_company_status_order_company
    FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE RESTRICT,
  CONSTRAINT fk_company_status_order_status
    FOREIGN KEY (status_order_id) REFERENCES status_order (id) ON DELETE RESTRICT
) ENGINE=InnoDB;
CREATE INDEX idx_company_status_order_matrix_company
  ON company_status_order_matrix (company_id);
INSERT IGNORE INTO status_order (id, name, active, sort_order, builtin_kind)
VALUES
  (SUBSTRING(MD5('global:ord:builtin:new'), 1, 16), 'New order', TRUE, 0, 'new'),
  (SUBSTRING(MD5('global:ord:builtin:in_production'), 1, 16), 'In production', TRUE, 5, 'in_production'),
  (SUBSTRING(MD5('global:ord:builtin:ready_for_install'), 1, 16), 'Ready for installation', TRUE, 10, 'ready_for_install'),
  (SUBSTRING(MD5('global:ord:builtin:done'), 1, 16), 'Done', TRUE, 20, 'done');
CREATE TABLE IF NOT EXISTS status_estimate (
  id           VARCHAR(16) PRIMARY KEY,
  slug         VARCHAR(32) NULL,
  name         TEXT NOT NULL,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order   INT NOT NULL DEFAULT 0,
  builtin_kind VARCHAR(32) NULL,
  CONSTRAINT ck_status_estimate_slug_null_or_enum
    CHECK (slug IS NULL OR slug IN ('new', 'pending', 'converted', 'cancelled')),
  CONSTRAINT ck_status_estimate_builtin_kind
    CHECK (builtin_kind IS NULL OR builtin_kind IN ('new', 'pending', 'converted', 'cancelled'))
) ENGINE=InnoDB;
CREATE UNIQUE INDEX uq_status_estimate_global_builtin_nn
  ON status_estimate (builtin_kind);
CREATE UNIQUE INDEX uq_status_estimate_global_slug_nn
  ON status_estimate (slug);
CREATE TABLE IF NOT EXISTS company_status_estimate_matrix (
  company_id         CHAR(36) NOT NULL,
  status_estimate_id VARCHAR(16) NOT NULL,
  PRIMARY KEY (company_id, status_estimate_id),
  CONSTRAINT fk_company_status_estimate_company
    FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE RESTRICT,
  CONSTRAINT fk_company_status_estimate_status
    FOREIGN KEY (status_estimate_id) REFERENCES status_estimate (id) ON DELETE RESTRICT
) ENGINE=InnoDB;
CREATE INDEX idx_company_status_estimate_matrix_company
  ON company_status_estimate_matrix (company_id);
INSERT IGNORE INTO status_estimate (id, slug, name, active, sort_order, builtin_kind)
VALUES
  (SUBSTRING(MD5('global:est:builtin:new'), 1, 16), 'new', 'New Estimate', TRUE, -1, 'new'),
  (SUBSTRING(MD5('global:est:builtin:pending'), 1, 16), 'pending', 'Pending', TRUE, 0, 'pending'),
  (SUBSTRING(MD5('global:est:builtin:converted'), 1, 16), 'converted', 'Converted to order', TRUE, 10, 'converted'),
  (SUBSTRING(MD5('global:est:builtin:cancelled'), 1, 16), 'cancelled', 'Cancelled', TRUE, 20, 'cancelled');
CREATE TABLE IF NOT EXISTS blinds_type (
  id          VARCHAR(16) PRIMARY KEY,
  name        TEXT NOT NULL,
  aciklama    TEXT,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INT NOT NULL DEFAULT 0
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS company_blinds_type_matrix (
  company_id      CHAR(36) NOT NULL,
  blinds_type_id  VARCHAR(16) NOT NULL,
  PRIMARY KEY (company_id, blinds_type_id),
  CONSTRAINT fk_company_blinds_type_company
    FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE RESTRICT,
  CONSTRAINT fk_company_blinds_type_type
    FOREIGN KEY (blinds_type_id) REFERENCES blinds_type (id) ON DELETE RESTRICT
) ENGINE=InnoDB;
CREATE INDEX idx_company_blinds_type_matrix_company
  ON company_blinds_type_matrix (company_id);
CREATE TABLE IF NOT EXISTS blinds_product_category (
  code         VARCHAR(32) PRIMARY KEY,
  name         TEXT NOT NULL,
  sort_order   INT NOT NULL DEFAULT 0,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS company_blinds_product_category_matrix (
  company_id    CHAR(36) NOT NULL,
  category_code VARCHAR(32) NOT NULL,
  PRIMARY KEY (company_id, category_code),
  CONSTRAINT fk_company_blinds_product_category_company
    FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE RESTRICT,
  CONSTRAINT fk_company_blinds_product_category_category
    FOREIGN KEY (category_code) REFERENCES blinds_product_category (code) ON DELETE RESTRICT
) ENGINE=InnoDB;
CREATE INDEX idx_company_blinds_product_category_matrix_company
  ON company_blinds_product_category_matrix (company_id);
CREATE TABLE IF NOT EXISTS blinds_type_category_allowed (
  company_id       CHAR(36) NOT NULL,
  blinds_type_id   VARCHAR(16) NOT NULL,
  category_code    VARCHAR(32) NOT NULL,
  PRIMARY KEY (company_id, blinds_type_id, category_code),
  CONSTRAINT fk_btca_company
    FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE RESTRICT,
  CONSTRAINT fk_btca_type
    FOREIGN KEY (blinds_type_id) REFERENCES blinds_type (id) ON DELETE RESTRICT,
  CONSTRAINT fk_btca_category
    FOREIGN KEY (category_code) REFERENCES blinds_product_category (code) ON DELETE RESTRICT
) ENGINE=InnoDB;
CREATE INDEX idx_btca_company_type
  ON blinds_type_category_allowed (company_id, blinds_type_id);
-- =============================================================================
-- Blinds domain (tenant-scoped)
-- =============================================================================
CREATE TABLE IF NOT EXISTS status_user (
  company_id  CHAR(36) NOT NULL,
  id          VARCHAR(16) NOT NULL,
  name        TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (company_id, id),
  CONSTRAINT fk_status_user_company
    FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE RESTRICT
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS customers (
  company_id      CHAR(36) NOT NULL,
  id              VARCHAR(16) NOT NULL,
  name            TEXT NOT NULL,
  surname         TEXT,
  phone           TEXT,
  email           TEXT,
  address         TEXT,
  postal_code     TEXT,
  status_user_id  VARCHAR(16),
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (company_id, id),
  CONSTRAINT fk_customers_company
    FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE RESTRICT,
  CONSTRAINT fk_customers_status_user
    FOREIGN KEY (company_id, status_user_id)
    REFERENCES status_user (company_id, id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
) ENGINE=InnoDB;
CREATE INDEX idx_customers_company_active
  ON customers (company_id, active);
CREATE INDEX idx_customers_company_created
  ON customers (company_id, created_at DESC);
CREATE INDEX idx_customers_company_name
  ON customers (company_id, name(255));
-- Leads
CREATE TABLE IF NOT EXISTS leads (
  id            CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  company_id    CHAR(36) NOT NULL,
  first_name    TEXT,
  last_name     TEXT,
  phone         TEXT,
  email         TEXT,
  address       TEXT,
  source        TEXT,
  note          TEXT,
  status        TEXT NOT NULL DEFAULT 'new',
  created_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  is_deleted    BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT ck_leads_status CHECK (status IN ('new', 'contacted', 'estimate_scheduled', 'estimated', 'won', 'lost', 'archived')),
  CONSTRAINT fk_leads_company
    FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE RESTRICT
) ENGINE=InnoDB;
CREATE INDEX idx_leads_company_created_at
  ON leads (company_id, created_at DESC);
CREATE INDEX idx_leads_company_status
  ON leads (company_id, status(32));
-- Estimates
CREATE TABLE IF NOT EXISTS estimate (
  company_id                CHAR(36) NOT NULL,
  id                        VARCHAR(16) NOT NULL,
  customer_id               VARCHAR(16) NULL,
  blinds_id                 VARCHAR(16) NULL,
  perde_sayisi              INT,
  tarih_saat                DATETIME(6),
  lead_source               TEXT,
  lead_id                   CHAR(36) NULL,
  scheduled_start_at        DATETIME(6),
  scheduled_end_at          DATETIME(6),
  calendar_provider         TEXT,
  calendar_id               TEXT,
  google_event_id           TEXT,
  calendar_last_synced_at   DATETIME(6),
  visit_time_zone           TEXT,
  visit_address             TEXT,
  visit_postal_code         TEXT,
  visit_notes               TEXT,
  visit_organizer_name      TEXT,
  visit_organizer_email     VARCHAR(320),
  visit_guest_emails        JSON NOT NULL DEFAULT (JSON_ARRAY()),
  visit_recurrence_rrule    TEXT,
  status_esti_id            VARCHAR(16) NOT NULL,
  prospect_name             TEXT,
  prospect_surname          TEXT,
  prospect_phone            TEXT,
  prospect_email            TEXT,
  prospect_address          TEXT,
  prospect_postal_code      TEXT,
  created_at                DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at                DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  is_deleted                BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (company_id, id),
  CONSTRAINT fk_estimate_company
    FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE RESTRICT,
  CONSTRAINT fk_estimate_customer
    FOREIGN KEY (company_id, customer_id)
    REFERENCES customers (company_id, id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_estimate_blinds_type
    FOREIGN KEY (blinds_id) REFERENCES blinds_type (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_estimate_status_estimate
    FOREIGN KEY (status_esti_id) REFERENCES status_estimate (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_estimate_lead
    FOREIGN KEY (lead_id) REFERENCES leads (id) ON DELETE SET NULL
) ENGINE=InnoDB;
CREATE INDEX idx_estimate_company_customer
  ON estimate (company_id, customer_id);
CREATE INDEX idx_estimate_company_tarih
  ON estimate (company_id, tarih_saat DESC);
CREATE INDEX idx_estimate_company_lead_source
  ON estimate (company_id, lead_source(32));
CREATE INDEX idx_estimate_company_scheduled_start
  ON estimate (company_id, scheduled_start_at DESC);
CREATE INDEX idx_estimate_company_status
  ON estimate (company_id, status_esti_id);
CREATE INDEX idx_estimate_company_lead
  ON estimate (company_id, lead_id);
CREATE TABLE IF NOT EXISTS estimate_blinds (
  company_id    CHAR(36) NOT NULL,
  estimate_id   VARCHAR(16) NOT NULL,
  blinds_id     VARCHAR(16) NOT NULL,
  sort_order    INT NOT NULL DEFAULT 0,
  perde_sayisi  INT,
  line_amount   DECIMAL(14,2),
  PRIMARY KEY (company_id, estimate_id, blinds_id),
  CONSTRAINT fk_estimate_blinds_company
    FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE RESTRICT,
  CONSTRAINT fk_estimate_blinds_blinds_type
    FOREIGN KEY (blinds_id) REFERENCES blinds_type (id) ON DELETE RESTRICT,
  CONSTRAINT fk_estimate_blinds_estimate
    FOREIGN KEY (company_id, estimate_id)
    REFERENCES estimate (company_id, id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
) ENGINE=InnoDB;
CREATE INDEX idx_estimate_blinds_company_estimate
  ON estimate_blinds (company_id, estimate_id);
-- Orders
CREATE TABLE IF NOT EXISTS orders (
  company_id                     CHAR(36) NOT NULL,
  id                             VARCHAR(16) NOT NULL,
  customer_id                    VARCHAR(16) NOT NULL,
  estimate_id                    VARCHAR(16) NULL,
  total_amount                   DECIMAL(14,2),
  downpayment                    DECIMAL(14,2),
  final_payment                  DECIMAL(14,2),
  balance                        DECIMAL(14,2),
  agree_data                     TEXT,
  agreement_date                 DATE,
  installation_date              DATE,
  extra_harcama                  DECIMAL(14,2),
  tax_uygulanacak_miktar         DECIMAL(14,2),
  tax_amount                     DECIMAL(14,2),
  blinds_lines                   JSON NOT NULL DEFAULT (JSON_ARRAY()),
  order_note                     TEXT,
  blinds_type_add_id             VARCHAR(16),
  parent_order_id                VARCHAR(16),
  status_order_id                VARCHAR(16) NULL,
  status_code                    TEXT NOT NULL DEFAULT 'order_created',
  ready_at                       DATETIME(6),
  installed_at                   DATETIME(6),
  installation_scheduled_start_at DATETIME(6),
  installation_scheduled_end_at   DATETIME(6),
  installation_calendar_provider  TEXT,
  installation_calendar_id        TEXT,
  installation_google_event_id    TEXT,
  installation_calendar_last_synced_at DATETIME(6),
  active                         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at                     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (company_id, id),
  CONSTRAINT ck_orders_status_code CHECK (status_code IN (
    'order_created',
    'deposit_paid',
    'in_production',
    'ready_for_install',
    'install_scheduled',
    'installed',
    'final_paid',
    'cancelled'
  )),
  CONSTRAINT fk_orders_company
    FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE RESTRICT,
  CONSTRAINT fk_orders_customer
    FOREIGN KEY (company_id, customer_id)
    REFERENCES customers (company_id, id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_orders_estimate
    FOREIGN KEY (company_id, estimate_id)
    REFERENCES estimate (company_id, id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_orders_parent_order
    FOREIGN KEY (company_id, parent_order_id)
    REFERENCES orders (company_id, id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_orders_status_order
    FOREIGN KEY (status_order_id) REFERENCES status_order (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
) ENGINE=InnoDB;
CREATE INDEX idx_orders_company_active
  ON orders (company_id, active);
CREATE INDEX idx_orders_company_customer
  ON orders (company_id, customer_id);
CREATE INDEX idx_orders_company_created
  ON orders (company_id, created_at DESC);
CREATE INDEX idx_orders_company_status_order
  ON orders (company_id, status_order_id);
CREATE INDEX idx_orders_company_parent
  ON orders (company_id, parent_order_id);
CREATE INDEX idx_orders_company_estimate
  ON orders (company_id, estimate_id);
-- Order items
CREATE TABLE IF NOT EXISTS order_items (
  company_id        CHAR(36) NOT NULL,
  id                CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  order_id          VARCHAR(16) NOT NULL,
  catalog_category  TEXT NOT NULL,
  model             TEXT NOT NULL,
  lifting_system    TEXT NOT NULL,
  kasa_type         TEXT NOT NULL,
  fabric_insert     BOOLEAN NOT NULL DEFAULT FALSE,
  width_mm          INT,
  height_mm         INT,
  quantity          INT NOT NULL DEFAULT 1,
  notes             TEXT,
  unit_price        DECIMAL(14,2),
  created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  is_deleted        BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT ck_order_items_catalog_category CHECK (catalog_category IN ('classic', 'delux', 'premium')),
  CONSTRAINT ck_order_items_model CHECK (model IN ('zebra', 'roller_shade', 'honecomb', 'galaxy', 'curtains')),
  CONSTRAINT ck_order_items_lifting_system CHECK (lifting_system IN ('chain', 'cordless', 'motorized')),
  CONSTRAINT ck_order_items_kasa_type CHECK (kasa_type IN ('square', 'square_curved', 'round')),
  CONSTRAINT fk_order_items_order
    FOREIGN KEY (company_id, order_id)
    REFERENCES orders (company_id, id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
) ENGINE=InnoDB;
CREATE INDEX idx_order_items_company_order
  ON order_items (company_id, order_id);
-- Payments
CREATE TABLE IF NOT EXISTS order_payments (
  id            CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  company_id    CHAR(36) NOT NULL,
  order_id      VARCHAR(16) NOT NULL,
  payment_type  TEXT NOT NULL,
  amount        DECIMAL(14,2) NOT NULL,
  paid_at       DATETIME(6),
  method        TEXT,
  note          TEXT,
  created_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  is_deleted    BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT ck_order_payments_type CHECK (payment_type IN ('deposit', 'final', 'other')),
  CONSTRAINT ck_order_payments_amount CHECK (amount > 0),
  CONSTRAINT fk_order_payments_order
    FOREIGN KEY (company_id, order_id)
    REFERENCES orders (company_id, id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
) ENGINE=InnoDB;
CREATE INDEX idx_order_payments_company_paid_at
  ON order_payments (company_id, paid_at DESC);
CREATE TABLE IF NOT EXISTS order_payment_entries (
  id              CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  company_id       CHAR(36) NOT NULL,
  order_id         VARCHAR(16) NOT NULL,
  amount           DECIMAL(14,2) NOT NULL,
  payment_group_id CHAR(36) NULL,
  created_at       DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  is_deleted       BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT ck_order_payment_entries_amount CHECK (amount > 0),
  CONSTRAINT fk_order_payment_entries_order
    FOREIGN KEY (company_id, order_id)
    REFERENCES orders (company_id, id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
) ENGINE=InnoDB;
CREATE INDEX idx_order_payment_entries_company_order_created
  ON order_payment_entries (company_id, order_id, created_at DESC);
CREATE INDEX idx_order_payment_entries_group
  ON order_payment_entries (company_id, payment_group_id, created_at DESC);
CREATE TABLE IF NOT EXISTS attachments (
  id            CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  company_id    CHAR(36) NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  media_type    TEXT NOT NULL,
  url           TEXT NOT NULL,
  taken_at      DATETIME(6),
  uploaded_by   CHAR(36) NULL,
  note          TEXT,
  created_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  is_deleted    BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT ck_attachments_entity_type CHECK (entity_type IN ('lead', 'estimate', 'order', 'installation')),
  CONSTRAINT ck_attachments_media_type CHECK (media_type IN ('photo', 'video', 'file')),
  CONSTRAINT fk_attachments_company
    FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE RESTRICT,
  CONSTRAINT fk_attachments_uploaded_by
    FOREIGN KEY (uploaded_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB;
CREATE INDEX idx_attachments_company_entity
  ON attachments (company_id, entity_type(32), entity_id(64));
CREATE TABLE IF NOT EXISTS order_attachments (
  id                 CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  company_id         CHAR(36) NOT NULL,
  order_id           VARCHAR(16) NOT NULL,
  kind               TEXT NOT NULL,
  blinds_type_id     VARCHAR(16),
  original_filename  TEXT NOT NULL,
  stored_relpath     TEXT NOT NULL,
  content_type       TEXT,
  file_size          BIGINT,
  created_at         DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  is_deleted         BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT ck_order_attachments_kind CHECK (kind IN ('photo', 'excel', 'line_photo')),
  CONSTRAINT fk_order_attachments_order
    FOREIGN KEY (company_id, order_id)
    REFERENCES orders (company_id, id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
) ENGINE=InnoDB;
CREATE INDEX idx_order_attachments_company_order
  ON order_attachments (company_id, order_id, created_at DESC);
CREATE TABLE IF NOT EXISTS order_expense_entries (
  id                 CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  company_id          CHAR(36) NOT NULL,
  order_id            VARCHAR(16) NOT NULL,
  amount              DECIMAL(14,2) NOT NULL,
  note                TEXT,
  spent_at            DATETIME(6),
  created_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_by_user_id  CHAR(36) NULL,
  is_deleted          BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT ck_order_expense_entries_amount CHECK (amount > 0),
  CONSTRAINT fk_order_expense_entries_order
    FOREIGN KEY (company_id, order_id)
    REFERENCES orders (company_id, id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_order_expense_entries_created_by
    FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB;
CREATE INDEX idx_order_expense_entries_company_order_created
  ON order_expense_entries (company_id, order_id, created_at DESC);
CREATE INDEX idx_order_expense_entries_company_created
  ON order_expense_entries (company_id, created_at DESC);
CREATE TABLE IF NOT EXISTS blinds_type_add (
  company_id        CHAR(36) NOT NULL,
  id                VARCHAR(16) NOT NULL,
  blinds_type_id    VARCHAR(16) NOT NULL,
  product_category  TEXT NOT NULL DEFAULT 'classic',
  amount            DECIMAL(14,2),
  number_of_blinds  INT,
  square_meter      DECIMAL(14,4),
  number_of_motor   INT,
  order_id          VARCHAR(16) NOT NULL,
  created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (company_id, id),
  CONSTRAINT ck_blinds_type_add_product_category CHECK (product_category IN ('classic', 'delux', 'premium')),
  CONSTRAINT fk_blinds_type_add_company
    FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE RESTRICT,
  CONSTRAINT fk_blinds_type_add_type
    FOREIGN KEY (blinds_type_id) REFERENCES blinds_type (id) ON DELETE RESTRICT,
  CONSTRAINT fk_blinds_type_add_order
    FOREIGN KEY (company_id, order_id)
    REFERENCES orders (company_id, id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
) ENGINE=InnoDB;
CREATE INDEX idx_blinds_type_add_company_order
  ON blinds_type_add (company_id, order_id);
CREATE INDEX idx_blinds_type_add_company_type
  ON blinds_type_add (company_id, blinds_type_id);
-- =============================================================================
-- Company Google Calendar OAuth
-- =============================================================================
CREATE TABLE IF NOT EXISTS company_google_calendar (
  company_id           CHAR(36) PRIMARY KEY,
  refresh_token        TEXT NOT NULL,
  calendar_id          TEXT NOT NULL,
  google_account_email TEXT,
  created_at           DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at           DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_company_google_calendar_company
    FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE RESTRICT
) ENGINE=InnoDB;
-- =============================================================================
-- Audit
-- =============================================================================
CREATE TABLE IF NOT EXISTS user_audit_logs (
  id           CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  executed_by  CHAR(36) NULL,
  action       VARCHAR(50) NOT NULL,
  table_name   VARCHAR(100) NOT NULL,
  table_id     CHAR(36),
  before_data  JSON,
  after_data   JSON,
  ip_address   VARCHAR(45),
  user_agent   VARCHAR(255),
  `timestamp`  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_user_audit_logs_executed_by
    FOREIGN KEY (executed_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB;
CREATE INDEX idx_user_audit_logs_timestamp
  ON user_audit_logs (`timestamp` DESC);
CREATE TABLE IF NOT EXISTS system_audit_logs (
  id            CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  service_name  VARCHAR(100) NOT NULL,
  action        VARCHAR(100) NOT NULL,
  status        VARCHAR(20) NOT NULL,
  details       JSON,
  executed_by   VARCHAR(100),
  ip_address    VARCHAR(45),
  user_agent    VARCHAR(255),
  `timestamp`   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB;
CREATE INDEX idx_system_audit_logs_timestamp
  ON system_audit_logs (`timestamp` DESC);
-- =============================================================================
-- Workflow engine
-- =============================================================================
CREATE TABLE IF NOT EXISTS workflow_definitions (
  id          CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  is_global   BOOLEAN NOT NULL DEFAULT FALSE,
  company_id  CHAR(36) NULL,
  entity_type TEXT NOT NULL,
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  version     INT NOT NULL DEFAULT 1,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT ck_workflow_definitions_scope CHECK (
    (is_global = TRUE AND company_id IS NULL)
    OR (is_global = FALSE AND company_id IS NOT NULL)
  ),
  CONSTRAINT fk_workflow_definitions_company
    FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE RESTRICT
) ENGINE=InnoDB;
CREATE UNIQUE INDEX uq_workflow_definitions_global_entity_code_version
  ON workflow_definitions (entity_type(64), code(64), version);
CREATE UNIQUE INDEX uq_workflow_definitions_company_entity_code_version
  ON workflow_definitions (company_id, entity_type(64), code(64), version);
CREATE TABLE IF NOT EXISTS workflow_transitions (
  id                     CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  workflow_definition_id  CHAR(36) NOT NULL,
  from_status_id          VARCHAR(32) NULL,
  to_status_id            VARCHAR(32) NOT NULL,
  sort_order              INT NOT NULL DEFAULT 0,
  required_permission     TEXT NULL,
  guard_json              JSON NULL,
  created_at              DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  deleted_at              DATETIME(6) NULL,
  CONSTRAINT fk_workflow_transitions_definition
    FOREIGN KEY (workflow_definition_id) REFERENCES workflow_definitions (id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE INDEX ix_workflow_transitions_def_from
  ON workflow_transitions (workflow_definition_id, from_status_id);
CREATE INDEX ix_workflow_transitions_def_to
  ON workflow_transitions (workflow_definition_id, to_status_id);
CREATE INDEX ix_workflow_transitions_def_active
  ON workflow_transitions (workflow_definition_id, deleted_at);
CREATE TABLE IF NOT EXISTS workflow_transition_actions (
  id            CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  transition_id CHAR(36) NOT NULL,
  type          TEXT NOT NULL,
  config        JSON NOT NULL DEFAULT (JSON_OBJECT()),
  sort_order    INT NOT NULL DEFAULT 0,
  is_required   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_workflow_transition_actions_transition
    FOREIGN KEY (transition_id) REFERENCES workflow_transitions (id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE INDEX ix_workflow_transition_actions_transition
  ON workflow_transition_actions (transition_id, sort_order);
-- =============================================================================
-- Triggers (MariaDB)
-- =============================================================================
DELIMITER $$
CREATE TRIGGER tr_companies_updated_at
BEFORE UPDATE ON companies
FOR EACH ROW
BEGIN
  SET NEW.updated_at = CURRENT_TIMESTAMP(6);
END$$
CREATE TRIGGER tr_company_document_templates_updated_at
BEFORE UPDATE ON company_document_templates
FOR EACH ROW
BEGIN
  SET NEW.updated_at = CURRENT_TIMESTAMP(6);
END$$
CREATE TRIGGER tr_blinds_product_category_updated_at
BEFORE UPDATE ON blinds_product_category
FOR EACH ROW
BEGIN
  SET NEW.updated_at = CURRENT_TIMESTAMP(6);
END$$
CREATE TRIGGER tr_customers_updated_at
BEFORE UPDATE ON customers
FOR EACH ROW
BEGIN
  SET NEW.updated_at = CURRENT_TIMESTAMP(6);
END$$
CREATE TRIGGER tr_leads_updated_at
BEFORE UPDATE ON leads
FOR EACH ROW
BEGIN
  SET NEW.updated_at = CURRENT_TIMESTAMP(6);
END$$
CREATE TRIGGER tr_estimate_updated_at
BEFORE UPDATE ON estimate
FOR EACH ROW
BEGIN
  SET NEW.updated_at = CURRENT_TIMESTAMP(6);
END$$
CREATE TRIGGER tr_orders_updated_at
BEFORE UPDATE ON orders
FOR EACH ROW
BEGIN
  SET NEW.updated_at = CURRENT_TIMESTAMP(6);
END$$
CREATE TRIGGER tr_order_items_updated_at
BEFORE UPDATE ON order_items
FOR EACH ROW
BEGIN
  SET NEW.updated_at = CURRENT_TIMESTAMP(6);
END$$
CREATE TRIGGER tr_blinds_type_add_updated_at
BEFORE UPDATE ON blinds_type_add
FOR EACH ROW
BEGIN
  SET NEW.updated_at = CURRENT_TIMESTAMP(6);
END$$
CREATE TRIGGER tr_company_google_calendar_updated_at
BEFORE UPDATE ON company_google_calendar
FOR EACH ROW
BEGIN
  SET NEW.updated_at = CURRENT_TIMESTAMP(6);
END$$
-- Mark estimate converted when an order is created with estimate_id
CREATE TRIGGER tr_orders_mark_estimate_converted
AFTER INSERT ON orders
FOR EACH ROW
BEGIN
  IF NEW.estimate_id IS NOT NULL AND TRIM(NEW.estimate_id) <> '' THEN
    UPDATE estimate
    SET
      status_esti_id = (
        SELECT se.id
        FROM status_estimate se
        WHERE se.builtin_kind = 'converted'
        LIMIT 1
      ),
      updated_at = CURRENT_TIMESTAMP(6)
    WHERE company_id = NEW.company_id
      AND id = NEW.estimate_id
      AND is_deleted <> TRUE;
  END IF;
END$$
DELIMITER ;
COMMIT;

