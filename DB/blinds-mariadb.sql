-- blinds-mariadb.sql — MariaDB schema (Auth/RBAC + tenant + blinds domain)
--
-- Notes vs PostgreSQL version:
-- - PostgreSQL-only features were removed: RLS policies, plpgsql functions/triggers, DO $$ blocks, partial indexes, and pg_constraint checks.
-- - UUID columns are stored as CHAR(36) with DEFAULT (UUID()).
-- - TIMESTAMPTZ is mapped to TIMESTAMP (stored without timezone metadata).
-- - BOOLEAN is mapped to TINYINT(1).
-- - JSONB is mapped to JSON (MariaDB JSON type/alias).
-- - This script focuses on creating the final schema. (Re-running may fail if you add extra constraints manually.)
--
-- Recommended:
--   mysql -u <user> -p <db> < DB/blinds-mariadb.sql
--
-- Charset / collation
SET NAMES utf8mb4;
SET time_zone = '+00:00';

START TRANSACTION;

-- -----------------------------------------------------------------------------
-- Auth / RBAC
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS role_groups (
  id           CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  name         VARCHAR(255) NOT NULL,
  description  TEXT,
  is_deleted   TINYINT(1) NOT NULL DEFAULT 0,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by   CHAR(36),
  updated_by   CHAR(36),
  UNIQUE KEY uq_role_groups_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id                      CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  first_name              VARCHAR(255) NOT NULL,
  last_name               VARCHAR(255) NOT NULL,
  phone                   VARCHAR(255) NOT NULL,
  password                VARCHAR(255) NOT NULL,
  email                   VARCHAR(255) NOT NULL,
  created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by              CHAR(36),
  updated_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by              CHAR(36),
  is_deleted              TINYINT(1) NOT NULL DEFAULT 0,
  last_login              TIMESTAMP NULL,
  failed_login_attempts   INT NOT NULL DEFAULT 0,
  account_locked_until    TIMESTAMP NULL,
  is_password_set         TINYINT(1) NOT NULL DEFAULT 0,
  is_first_login          TINYINT(1) NOT NULL DEFAULT 1,
  must_change_password    TINYINT(1) NOT NULL DEFAULT 0,
  role_group_id           CHAR(36),
  default_role            CHAR(36),
  photo_url               VARCHAR(255),
  company_id              CHAR(36),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_phone (phone),
  KEY ix_users_role_group_id (role_group_id),
  KEY ix_users_company_id (company_id),
  CONSTRAINT fk_users_role_group_id FOREIGN KEY (role_group_id) REFERENCES role_groups (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Note: created_by/updated_by audit FKs are intentionally omitted to avoid circular FK dependencies
-- and to keep the schema bootstrap predictable across MariaDB versions.

CREATE TABLE IF NOT EXISTS roles (
  id             CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  name           VARCHAR(255) NOT NULL,
  description    TEXT,
  is_protected   TINYINT(1) NOT NULL DEFAULT 0,
  is_deleted     TINYINT(1) NOT NULL DEFAULT 0,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by     CHAR(36),
  updated_by     CHAR(36),
  role_group_id  CHAR(36),
  UNIQUE KEY uq_roles_name (name),
  KEY ix_roles_role_group_id (role_group_id),
  CONSTRAINT fk_roles_created_by FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT fk_roles_updated_by FOREIGN KEY (updated_by) REFERENCES users (id),
  CONSTRAINT fk_roles_role_group_id FOREIGN KEY (role_group_id) REFERENCES role_groups (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Note: users.default_role and role_groups.created_by/updated_by FKs are intentionally omitted (see note above).

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
  is_deleted   TINYINT(1) NOT NULL DEFAULT 0,
  created_at   TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by   CHAR(36),
  updated_by   CHAR(36),
  UNIQUE KEY uq_permissions_key (`key`),
  KEY ix_permissions_parent_key (parent_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id        CHAR(36) NOT NULL,
  permission_id  CHAR(36) NOT NULL,
  is_granted     TINYINT(1) NOT NULL DEFAULT 0,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by     CHAR(36),
  updated_by     CHAR(36),
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted     TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_role_permissions_role_id FOREIGN KEY (role_id) REFERENCES roles (id),
  CONSTRAINT fk_role_permissions_permission_id FOREIGN KEY (permission_id) REFERENCES permissions (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_roles (
  id          CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id     CHAR(36),
  role_id     CHAR(36),
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by  CHAR(36),
  updated_by  CHAR(36),
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted  TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY uq_user_roles_user_role (user_id, role_id),
  KEY ix_user_roles_user_id (user_id),
  KEY ix_user_roles_role_id (role_id),
  CONSTRAINT fk_user_roles_user_id FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_user_roles_role_id FOREIGN KEY (role_id) REFERENCES roles (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_permissions (
  user_id        CHAR(36) NOT NULL,
  permission_id  CHAR(36) NOT NULL,
  role_id        CHAR(36) NOT NULL,
  is_granted     TINYINT(1) NOT NULL DEFAULT 0,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by     CHAR(36),
  updated_by     CHAR(36),
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted     TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, permission_id, role_id),
  CONSTRAINT fk_user_permissions_user_id FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_user_permissions_permission_id FOREIGN KEY (permission_id) REFERENCES permissions (id),
  CONSTRAINT fk_user_permissions_role_id FOREIGN KEY (role_id) REFERENCES roles (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS revoked_tokens (
  id          CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  token       VARCHAR(255) NOT NULL,
  user_id     CHAR(36),
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_used     TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY uq_revoked_tokens_token (token),
  KEY ix_revoked_tokens_user_id (user_id),
  CONSTRAINT fk_revoked_tokens_user_id FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS login_attempts (
  id            CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id       CHAR(36),
  ip_address    VARCHAR(45),
  user_agent    VARCHAR(255),
  success       TINYINT(1) NOT NULL DEFAULT 0,
  attempted_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_login_attempts_user_ip_time (user_id, ip_address, attempted_at),
  KEY ix_login_attempts_user_id (user_id),
  CONSTRAINT fk_login_attempts_user_id FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_sessions (
  id              CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id         CHAR(36),
  session_token   VARCHAR(255) NOT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at    TIMESTAMP NULL,
  expires_at      TIMESTAMP NULL,
  is_active       TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_user_sessions_token (session_token),
  KEY ix_user_sessions_user_id (user_id),
  CONSTRAINT fk_user_sessions_user_id FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id           CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id      CHAR(36) NOT NULL,
  token        VARCHAR(100) NOT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at   TIMESTAMP NOT NULL,
  is_used      TINYINT(1) NOT NULL DEFAULT 0,
  used_at      TIMESTAMP NULL,
  ip_address   VARCHAR(45),
  user_agent   VARCHAR(255),
  attempts     INT NOT NULL DEFAULT 0,
  UNIQUE KEY uq_password_reset_tokens_token (token),
  KEY ix_password_reset_tokens_user_id (user_id),
  CONSTRAINT fk_password_reset_tokens_user_id FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pending_employee_self_registrations (
  id                   CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  first_name           VARCHAR(255) NOT NULL,
  last_name            VARCHAR(255) NOT NULL,
  email                VARCHAR(255) NOT NULL,
  phone                VARCHAR(255) NOT NULL,
  password             VARCHAR(255) NOT NULL,
  role_group_id        CHAR(36),
  request_note         TEXT,
  verification_token   VARCHAR(255) NOT NULL,
  token_sent_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_email_verified    TINYINT(1) NOT NULL DEFAULT 0,
  email_verified_at    TIMESTAMP NULL,
  pending_status       VARCHAR(32) NOT NULL DEFAULT 'EMAIL_NOT_VERIFIED',
  approved_by          CHAR(36),
  approved_at          TIMESTAMP NULL,
  requested_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_deleted           TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY uq_pending_employee_email (email),
  KEY idx_pending_employee_token (verification_token),
  CONSTRAINT fk_pending_employee_role_group_id FOREIGN KEY (role_group_id) REFERENCES role_groups (id),
  CONSTRAINT fk_pending_employee_approved_by FOREIGN KEY (approved_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -----------------------------------------------------------------------------
-- Tenant / Companies
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS companies (
  id            CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  name          VARCHAR(255) NOT NULL,
  phone         VARCHAR(255),
  website       VARCHAR(255),
  email         VARCHAR(255),
  address       VARCHAR(2000),
  postal_code   VARCHAR(32),
  maps_url      VARCHAR(2000),
  owner_user_id CHAR(36),
  logo_url      VARCHAR(500),
  tax_rate_percent DECIMAL(6, 3),
  country_code  VARCHAR(2) NULL,
  region_code   VARCHAR(8) NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted    TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY uq_companies_name (name),
  KEY ix_companies_owner_user_id (owner_user_id),
  CONSTRAINT fk_companies_owner_user_id FOREIGN KEY (owner_user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Note: users.company_id FK is intentionally omitted (see audit FK note above).

CREATE TABLE IF NOT EXISTS company_document_templates (
  company_id   CHAR(36) NOT NULL,
  kind         VARCHAR(64) NOT NULL,
  subject      VARCHAR(300) NOT NULL DEFAULT '',
  body_html    TEXT NOT NULL,
  preset_key   VARCHAR(64) NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted   TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, kind),
  CONSTRAINT fk_company_document_templates_company FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS company_members (
  company_id  CHAR(36) NOT NULL,
  user_id     CHAR(36) NOT NULL,
  role        VARCHAR(32) NOT NULL DEFAULT 'member',
  active      TINYINT(1) NOT NULL DEFAULT 1,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (company_id, user_id),
  KEY idx_company_members_user (user_id),
  CONSTRAINT fk_company_members_company FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE CASCADE,
  CONSTRAINT fk_company_members_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT ck_company_members_role CHECK (role IN ('owner', 'admin', 'member', 'viewer'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -----------------------------------------------------------------------------
-- Blinds domain (tenant lookups + customers + estimates + orders)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS status_user (
  company_id  CHAR(36) NOT NULL,
  id          VARCHAR(16) NOT NULL,
  name        TEXT NOT NULL,
  active      TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (company_id, id),
  KEY idx_status_user_company_active (company_id, active),
  CONSTRAINT fk_status_user_company FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS status_order (
  company_id  CHAR(36) NOT NULL,
  id          VARCHAR(16) NOT NULL,
  name        TEXT NOT NULL,
  active      TINYINT(1) NOT NULL DEFAULT 1,
  sort_order  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, id),
  KEY idx_status_order_company_active (company_id, active),
  CONSTRAINT fk_status_order_company FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS status_estimate (
  company_id  CHAR(36) NOT NULL,
  id          VARCHAR(16) NOT NULL,
  slug        VARCHAR(32) NULL,
  name        TEXT NOT NULL,
  active      TINYINT(1) NOT NULL DEFAULT 1,
  sort_order  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, id),
  UNIQUE KEY uq_status_estimate_company_slug (company_id, slug),
  KEY idx_status_estimate_company_active (company_id, active),
  CONSTRAINT fk_status_estimate_company FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE CASCADE,
  CONSTRAINT ck_status_estimate_slug_null_or_enum CHECK (slug IS NULL OR slug IN ('pending', 'converted', 'cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Global blinds types (final state) + per-company enablement matrix
CREATE TABLE IF NOT EXISTS blinds_type (
  id          VARCHAR(16) PRIMARY KEY,
  name        TEXT NOT NULL,
  aciklama    TEXT,
  active      TINYINT(1) NOT NULL DEFAULT 1,
  sort_order  INT NOT NULL DEFAULT 0,
  KEY idx_blinds_type_global_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS company_blinds_type_matrix (
  company_id      CHAR(36) NOT NULL,
  blinds_type_id  VARCHAR(16) NOT NULL,
  PRIMARY KEY (company_id, blinds_type_id),
  KEY idx_company_blinds_type_matrix_company (company_id),
  CONSTRAINT fk_company_blinds_type_matrix_company FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE CASCADE,
  CONSTRAINT fk_company_blinds_type_matrix_blinds_type FOREIGN KEY (blinds_type_id) REFERENCES blinds_type (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
  active          TINYINT(1) NOT NULL DEFAULT 1,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (company_id, id),
  KEY idx_customers_company_active (company_id, active),
  KEY idx_customers_company_created (company_id, created_at),
  KEY idx_customers_company_name (company_id, name(64)),
  CONSTRAINT fk_customers_company FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE CASCADE,
  CONSTRAINT fk_customers_status_user FOREIGN KEY (company_id, status_user_id) REFERENCES status_user (company_id, id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS leads (
  id           CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  company_id   CHAR(36) NOT NULL,
  first_name   TEXT,
  last_name    TEXT,
  phone        TEXT,
  email        TEXT,
  address      TEXT,
  source       TEXT,
  note         TEXT,
  status       VARCHAR(32) NOT NULL DEFAULT 'new',
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted   TINYINT(1) NOT NULL DEFAULT 0,
  KEY idx_leads_company_created_at (company_id, created_at),
  KEY idx_leads_company_status (company_id, status),
  CONSTRAINT fk_leads_company FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE CASCADE,
  CONSTRAINT ck_leads_status CHECK (status IN ('new','contacted','estimate_scheduled','estimated','won','lost','archived'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS estimate (
  company_id            CHAR(36) NOT NULL,
  id                    VARCHAR(16) NOT NULL,
  customer_id           VARCHAR(16) NULL,
  blinds_id             VARCHAR(16) NULL,
  perde_sayisi          INT,
  tarih_saat            TIMESTAMP NULL,
  lead_source           VARCHAR(32) NULL,
  lead_id               CHAR(36) NULL,
  scheduled_start_at    TIMESTAMP NULL,
  scheduled_end_at      TIMESTAMP NULL,
  calendar_provider     TEXT,
  calendar_id           TEXT,
  google_event_id       TEXT,
  calendar_last_synced_at TIMESTAMP NULL,
  visit_time_zone       TEXT,
  visit_address         TEXT,
  visit_postal_code     TEXT,
  visit_notes           TEXT,
  visit_organizer_name  TEXT,
  visit_organizer_email VARCHAR(320),
  visit_guest_emails    JSON NOT NULL DEFAULT (JSON_ARRAY()),
  visit_recurrence_rrule TEXT,
  prospect_name         TEXT,
  prospect_surname      TEXT,
  prospect_phone        TEXT,
  prospect_email        TEXT,
  prospect_address      TEXT,
  prospect_postal_code  TEXT,
  status_esti_id        VARCHAR(16) NOT NULL,
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted            TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, id),
  KEY idx_estimate_company_customer (company_id, customer_id),
  KEY idx_estimate_company_tarih (company_id, tarih_saat),
  KEY idx_estimate_company_lead_source (company_id, lead_source),
  KEY idx_estimate_company_status (company_id, status_esti_id),
  CONSTRAINT fk_estimate_company FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE CASCADE,
  CONSTRAINT fk_estimate_customer FOREIGN KEY (company_id, customer_id) REFERENCES customers (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_estimate_lead FOREIGN KEY (lead_id) REFERENCES leads (id) ON DELETE SET NULL,
  CONSTRAINT fk_estimate_status_estimate FOREIGN KEY (company_id, status_esti_id) REFERENCES status_estimate (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_estimate_lead_source CHECK (lead_source IS NULL OR lead_source IN ('referral', 'advertising'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS estimate_blinds (
  company_id   CHAR(36) NOT NULL,
  estimate_id  VARCHAR(16) NOT NULL,
  blinds_id    VARCHAR(16) NOT NULL,
  sort_order   INT NOT NULL DEFAULT 0,
  perde_sayisi INT,
  line_amount  DECIMAL(14, 2),
  PRIMARY KEY (company_id, estimate_id, blinds_id),
  KEY idx_estimate_blinds_company_estimate (company_id, estimate_id),
  CONSTRAINT fk_estimate_blinds_company FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE CASCADE,
  CONSTRAINT fk_estimate_blinds_estimate FOREIGN KEY (company_id, estimate_id) REFERENCES estimate (company_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_estimate_blinds_blinds_type FOREIGN KEY (blinds_id) REFERENCES blinds_type (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS orders (
  company_id              CHAR(36) NOT NULL,
  id                      VARCHAR(16) NOT NULL,
  customer_id             VARCHAR(16) NOT NULL,
  estimate_id             VARCHAR(16) NULL,
  total_amount            DECIMAL(14, 2),
  downpayment             DECIMAL(14, 2),
  final_payment           DECIMAL(14, 2),
  balance                 DECIMAL(14, 2),
  agree_data              TEXT,
  agreement_date          DATE,
  installation_date       DATE,
  extra_harcama           DECIMAL(14, 2),
  tax_uygulanacak_miktar  DECIMAL(14, 2),
  tax_amount              DECIMAL(14, 2),
  blinds_lines            JSON NOT NULL DEFAULT (JSON_ARRAY()),
  order_note              TEXT,
  blinds_type_add_id      VARCHAR(16),
  parent_order_id         VARCHAR(16),
  status_orde_id          VARCHAR(16),
  status_code             VARCHAR(32) NOT NULL DEFAULT 'order_created',
  ready_at                TIMESTAMP NULL,
  installed_at            TIMESTAMP NULL,
  installation_scheduled_start_at TIMESTAMP NULL,
  installation_scheduled_end_at   TIMESTAMP NULL,
  installation_calendar_provider  TEXT,
  installation_calendar_id        TEXT,
  installation_google_event_id    TEXT,
  installation_calendar_last_synced_at TIMESTAMP NULL,
  active                  TINYINT(1) NOT NULL DEFAULT 1,
  created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (company_id, id),
  KEY idx_orders_company_active (company_id, active),
  KEY idx_orders_company_customer (company_id, customer_id),
  KEY idx_orders_company_created (company_id, created_at),
  KEY idx_orders_company_status (company_id, status_orde_id),
  KEY idx_orders_company_parent (company_id, parent_order_id),
  CONSTRAINT fk_orders_company FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE CASCADE,
  CONSTRAINT fk_orders_customer FOREIGN KEY (company_id, customer_id) REFERENCES customers (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_orders_status_order FOREIGN KEY (company_id, status_orde_id) REFERENCES status_order (company_id, id) ON DELETE SET NULL,
  CONSTRAINT fk_orders_parent_order FOREIGN KEY (company_id, parent_order_id) REFERENCES orders (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_orders_status_code CHECK (status_code IN ('order_created','deposit_paid','in_production','ready_for_install','install_scheduled','installed','final_paid','cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS order_items (
  company_id        CHAR(36) NOT NULL,
  id                CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  order_id          VARCHAR(16) NOT NULL,
  catalog_category  VARCHAR(32) NOT NULL,
  model             VARCHAR(32) NOT NULL,
  lifting_system    VARCHAR(32) NOT NULL,
  kasa_type         VARCHAR(32) NOT NULL,
  fabric_insert     TINYINT(1) NOT NULL DEFAULT 0,
  width_mm          INT,
  height_mm         INT,
  quantity          INT NOT NULL DEFAULT 1,
  notes             TEXT,
  unit_price        DECIMAL(14, 2),
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted        TINYINT(1) NOT NULL DEFAULT 0,
  KEY idx_order_items_company_order (company_id, order_id),
  CONSTRAINT fk_order_items_order FOREIGN KEY (company_id, order_id) REFERENCES orders (company_id, id) ON DELETE CASCADE,
  CONSTRAINT ck_order_items_category CHECK (catalog_category IN ('classic', 'delux', 'premium')),
  CONSTRAINT ck_order_items_model CHECK (model IN ('zebra', 'roller_shade', 'honecomb', 'galaxy', 'curtains')),
  CONSTRAINT ck_order_items_lifting CHECK (lifting_system IN ('chain', 'cordless', 'motorized')),
  CONSTRAINT ck_order_items_kasa CHECK (kasa_type IN ('square', 'square_curved', 'round'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS order_payments (
  id            CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  company_id    CHAR(36) NOT NULL,
  order_id      VARCHAR(16) NOT NULL,
  payment_type  VARCHAR(32) NOT NULL,
  amount        DECIMAL(14, 2) NOT NULL,
  paid_at       TIMESTAMP NULL,
  method        TEXT,
  note          TEXT,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_deleted    TINYINT(1) NOT NULL DEFAULT 0,
  KEY idx_order_payments_company_paid_at (company_id, paid_at),
  CONSTRAINT fk_order_payments_order FOREIGN KEY (company_id, order_id) REFERENCES orders (company_id, id) ON DELETE CASCADE,
  CONSTRAINT ck_order_payments_type CHECK (payment_type IN ('deposit','final','other'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS order_payment_entries (
  id               CHAR(36) NOT NULL DEFAULT (UUID()),
  company_id        CHAR(36) NOT NULL,
  order_id          VARCHAR(16) NOT NULL,
  amount            DECIMAL(14, 2) NOT NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  payment_group_id  CHAR(36) NULL,
  is_deleted        TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_order_payment_entries_company_order_created (company_id, order_id, created_at),
  KEY idx_order_payment_entries_group (company_id, payment_group_id, created_at),
  CONSTRAINT fk_order_payment_entries_order FOREIGN KEY (company_id, order_id) REFERENCES orders (company_id, id) ON DELETE CASCADE,
  CONSTRAINT ck_order_payment_entries_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS order_expense_entries (
  id                 CHAR(36) NOT NULL DEFAULT (UUID()),
  company_id          CHAR(36) NOT NULL,
  order_id            VARCHAR(16) NOT NULL,
  amount              DECIMAL(14, 2) NOT NULL,
  note                TEXT,
  spent_at            TIMESTAMP NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id  CHAR(36) NULL,
  is_deleted          TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_order_expense_entries_company_order_created (company_id, order_id, created_at),
  CONSTRAINT fk_order_expense_entries_order FOREIGN KEY (company_id, order_id) REFERENCES orders (company_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_order_expense_entries_created_by FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT ck_order_expense_entries_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS blinds_type_add (
  company_id        CHAR(36) NOT NULL,
  id                VARCHAR(16) NOT NULL,
  blinds_type_id    VARCHAR(16) NOT NULL,
  product_category  VARCHAR(32) NOT NULL DEFAULT 'classic',
  amount            DECIMAL(14, 2),
  number_of_blinds  INT,
  square_meter      DECIMAL(14, 4),
  number_of_motor   INT,
  order_id          VARCHAR(16) NOT NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (company_id, id),
  KEY idx_blinds_type_add_company_order (company_id, order_id),
  KEY idx_blinds_type_add_company_type (company_id, blinds_type_id),
  CONSTRAINT fk_blinds_type_add_order FOREIGN KEY (company_id, order_id) REFERENCES orders (company_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_blinds_type_add_blinds_type FOREIGN KEY (blinds_type_id) REFERENCES blinds_type (id) ON DELETE RESTRICT,
  CONSTRAINT ck_blinds_type_add_category CHECK (product_category IN ('classic', 'delux', 'premium'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Note: orders.blinds_type_add_id FK is intentionally omitted to keep bootstrap single-pass.

CREATE TABLE IF NOT EXISTS order_attachments (
  id                 CHAR(36) NOT NULL DEFAULT (UUID()),
  company_id          CHAR(36) NOT NULL,
  order_id            VARCHAR(16) NOT NULL,
  kind               VARCHAR(32) NOT NULL,
  blinds_type_id     VARCHAR(16),
  original_filename  TEXT NOT NULL,
  stored_relpath     TEXT NOT NULL,
  content_type       TEXT,
  file_size          BIGINT,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_deleted         TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_order_attachments_company_order (company_id, order_id, created_at),
  CONSTRAINT fk_order_attachments_order FOREIGN KEY (company_id, order_id) REFERENCES orders (company_id, id) ON DELETE CASCADE,
  CONSTRAINT ck_order_attachments_kind CHECK (kind IN ('photo', 'excel', 'line_photo'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS attachments (
  id            CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  company_id    CHAR(36) NOT NULL,
  entity_type   VARCHAR(32) NOT NULL,
  entity_id     TEXT NOT NULL,
  media_type    VARCHAR(32) NOT NULL,
  url           TEXT NOT NULL,
  taken_at      TIMESTAMP NULL,
  uploaded_by   CHAR(36) NULL,
  note          TEXT,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_deleted    TINYINT(1) NOT NULL DEFAULT 0,
  KEY idx_attachments_company_entity (company_id, entity_type, entity_id(64)),
  CONSTRAINT fk_attachments_company FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE CASCADE,
  CONSTRAINT fk_attachments_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT ck_attachments_entity_type CHECK (entity_type IN ('lead','estimate','order','installation')),
  CONSTRAINT ck_attachments_media_type CHECK (media_type IN ('photo','video','file'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -----------------------------------------------------------------------------
-- Lookups: product categories + per-company matrices
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS blinds_product_category (
  code        VARCHAR(32) NOT NULL PRIMARY KEY,
  name        TEXT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  active      TINYINT(1) NOT NULL DEFAULT 1,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_blinds_product_category_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS company_blinds_product_category_matrix (
  company_id    CHAR(36) NOT NULL,
  category_code VARCHAR(32) NOT NULL,
  PRIMARY KEY (company_id, category_code),
  KEY idx_company_blinds_product_category_matrix_company (company_id),
  CONSTRAINT fk_cbpcm_company FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE CASCADE,
  CONSTRAINT fk_cbpcm_category FOREIGN KEY (category_code) REFERENCES blinds_product_category (code) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS blinds_type_category_allowed (
  company_id     CHAR(36) NOT NULL,
  blinds_type_id VARCHAR(16) NOT NULL,
  category_code  VARCHAR(32) NOT NULL,
  PRIMARY KEY (company_id, blinds_type_id, category_code),
  KEY idx_btca_company_type (company_id, blinds_type_id),
  CONSTRAINT fk_btca_company FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE CASCADE,
  CONSTRAINT fk_btca_blinds_type FOREIGN KEY (blinds_type_id) REFERENCES blinds_type (id) ON DELETE CASCADE,
  CONSTRAINT fk_btca_category FOREIGN KEY (category_code) REFERENCES blinds_product_category (code) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS blinds_line_extra_kind (
  id            VARCHAR(32) NOT NULL PRIMARY KEY,
  name          TEXT NOT NULL,
  line_json_key VARCHAR(32) NOT NULL UNIQUE,
  sort_order    INT NOT NULL DEFAULT 0,
  active        TINYINT(1) NOT NULL DEFAULT 1,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_blinds_line_extra_kind_active (active),
  CONSTRAINT ck_blinds_line_extra_kind_json_key CHECK (line_json_key REGEXP '^[a-z][a-z0-9_]*$' AND line_json_key <> 'category')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS blinds_line_extra_option (
  kind_id     VARCHAR(32) NOT NULL,
  code        VARCHAR(32) NOT NULL,
  name        TEXT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  active      TINYINT(1) NOT NULL DEFAULT 1,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (kind_id, code),
  KEY idx_blinds_line_extra_option_kind_active (kind_id, active),
  CONSTRAINT fk_bleo_kind FOREIGN KEY (kind_id) REFERENCES blinds_line_extra_kind (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS blinds_type_extra_allowed (
  company_id     CHAR(36) NOT NULL,
  blinds_type_id VARCHAR(16) NOT NULL,
  kind_id        VARCHAR(32) NOT NULL,
  option_code    VARCHAR(32) NOT NULL,
  PRIMARY KEY (company_id, blinds_type_id, kind_id, option_code),
  KEY idx_btea_company_type (company_id, blinds_type_id),
  CONSTRAINT fk_btea_company FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE CASCADE,
  CONSTRAINT fk_btea_blinds_type FOREIGN KEY (blinds_type_id) REFERENCES blinds_type (id) ON DELETE CASCADE,
  CONSTRAINT fk_btea_option FOREIGN KEY (kind_id, option_code) REFERENCES blinds_line_extra_option (kind_id, code) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -----------------------------------------------------------------------------
-- Registration / memberships / integrations / audit
-- -----------------------------------------------------------------------------

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
  token_sent_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_email_verified  TINYINT(1) NOT NULL DEFAULT 0,
  email_verified_at  TIMESTAMP NULL,
  pending_status     VARCHAR(32) NOT NULL DEFAULT 'EMAIL_NOT_VERIFIED',
  approved_by        CHAR(36) NULL,
  approved_at        TIMESTAMP NULL,
  requested_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_deleted         TINYINT(1) NOT NULL DEFAULT 0,
  KEY idx_pending_company_token (verification_token),
  CONSTRAINT fk_pending_company_approved_by FOREIGN KEY (approved_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_company_memberships (
  id         CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id    CHAR(36) NOT NULL,
  company_id CHAR(36) NOT NULL,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_company_memberships_user_company (user_id, company_id),
  CONSTRAINT fk_ucm_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_ucm_company FOREIGN KEY (company_id) REFERENCES companies (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS company_google_calendar (
  company_id            CHAR(36) NOT NULL,
  refresh_token         TEXT NOT NULL,
  calendar_id           TEXT NOT NULL,
  google_account_email  TEXT,
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (company_id),
  CONSTRAINT fk_company_google_calendar_company FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
  `timestamp`  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_audit_user_action_table_time (executed_by, action, table_name, `timestamp`),
  KEY idx_user_audit_logs_timestamp (`timestamp`),
  CONSTRAINT fk_user_audit_logs_executed_by FOREIGN KEY (executed_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS system_audit_logs (
  id            CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  service_name  VARCHAR(100) NOT NULL,
  action        VARCHAR(100) NOT NULL,
  status        VARCHAR(20) NOT NULL,
  details       JSON,
  executed_by   VARCHAR(100),
  ip_address    VARCHAR(45),
  `timestamp`   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_system_audit_service_action_time (service_name, action, `timestamp`),
  KEY idx_system_audit_logs_timestamp (`timestamp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -----------------------------------------------------------------------------
-- Seed (idempotent)
-- -----------------------------------------------------------------------------

INSERT IGNORE INTO blinds_product_category (code, name, sort_order, active) VALUES
  ('classic', 'Classic', 1, 1),
  ('delux', 'Delux', 2, 1),
  ('premium', 'Premium', 3, 1);

INSERT IGNORE INTO blinds_line_extra_kind (id, name, line_json_key, sort_order, active) VALUES
  ('lifting_system', 'Lifting system', 'lifting_system', 10, 1),
  ('cassette_type', 'Cassette type', 'cassette_type', 20, 1);

COMMIT;

