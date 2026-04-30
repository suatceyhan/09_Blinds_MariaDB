-- blinds-mariadb.sql
-- MariaDB 10.5+ uyumlu şema
-- PostgreSQL'den otomatik dönüştürülmüştür.
--
-- Önemli notlar:
--   1. UUID alanlar CHAR(36) olarak tanımlanmıştır.
--   2. JSONB → JSON (MariaDB JSON tipi kullanılır).
--   3. BOOLEAN → TINYINT(1) (1=TRUE, 0=FALSE).
--   4. PostgreSQL DO $$ ... $$ blokları (procedural logic, RLS, trigger fonksiyonları)
--      MariaDB'de desteklenmediğinden kaldırılmıştır.
--   5. Row Level Security (RLS) MariaDB'de yoktur; uygulama katmanında yönetilmeli.
--   6. Kısmi index'ler (WHERE koşullu) MariaDB'de desteklenmez; WHERE kısmı kaldırılmıştır.
--   7. TIMESTAMPTZ → DATETIME (timezone bilgisi uygulama katmanında yönetilmeli).
--   8. ON CONFLICT DO NOTHING → kaldırıldı; gerekirse INSERT IGNORE kullanın.
--   9. NULLS LAST → kaldırıldı.
--  10. Trigger fonksiyonları (set_updated_at, trg_orders_mark_estimate_converted) 
--      MariaDB stored procedure/trigger syntax'ına manuel olarak çevrilmesi gerekir.
--
-- Kullanım:
--   mysql -u <kullanıcı> -p <veritabanı> < blinds-mariadb.sql
--
-- Charset:
SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;
SET collation_connection = utf8mb4_unicode_ci;
SET foreign_key_checks = 0;

-- blinds-postgresql.sql — Auth / RBAC + kiracı iskeleti + blinds iş alanı şeması
-- PostgreSQL 13+ (gen_random_uuid).
--
-- Idempotent: Mevcut tablolar korunur; dosyayı tekrar çalıştırmak güvenlidir.
--   psql -U <kullanıcı> -d <veritabanı> -f DB/blinds-postgresql.sql
-- Not: CREATE TABLE IF NOT EXISTS yeni kolon eklemez; şema değişince ayrı ALTER migration gerekir.
--
-- Tam sıfırlama (tüm veriyi siler):
--   psql -U <kullanıcı> -d <veritabanı> -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO CURRENT_USER; GRANT ALL ON SCHEMA public TO public;"
--   ardından yine bu dosya.

BEGIN;

-- ############################################################################
-- # BÖLÜM 1 — Auth / RBAC / JWT yardımcı tablolar                                    #
-- ############################################################################

CREATE TABLE IF NOT EXISTS role_groups (
  id           CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  name         VARCHAR(255) NOT NULL,
  description  TEXT,
  is_deleted   TINYINT(1) NOT NULL DEFAULT 0,
  created_at   DATETIME NOT NULL DEFAULT NOW(),
  updated_at   DATETIME NOT NULL DEFAULT NOW(),
  created_by   CHAR(36),
  updated_by   CHAR(36),
  CONSTRAINT uq_role_groups_name UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS users (
  id                      CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  first_name              VARCHAR(255) NOT NULL,
  last_name               VARCHAR(255) NOT NULL,
  phone                   VARCHAR(255) NOT NULL,
  password                VARCHAR(255) NOT NULL,
  email                   VARCHAR(255) NOT NULL,
  created_at              DATETIME NOT NULL DEFAULT NOW(),
  created_by              CHAR(36) REFERENCES users (id),
  updated_at              DATETIME NOT NULL DEFAULT NOW(),
  updated_by              CHAR(36) REFERENCES users (id),
  is_deleted              TINYINT(1) NOT NULL DEFAULT 0,
  last_login              DATETIME,
  failed_login_attempts   INTEGER NOT NULL DEFAULT 0,
  account_locked_until    DATETIME,
  is_password_set         TINYINT(1) NOT NULL DEFAULT 0,
  is_first_login          TINYINT(1) NOT NULL DEFAULT 1,
  must_change_password    TINYINT(1) NOT NULL DEFAULT 0,
  role_group_id           CHAR(36) REFERENCES role_groups (id),
  default_role            CHAR(36),
  photo_url               VARCHAR(255),
  CONSTRAINT uq_users_email UNIQUE (email),
  CONSTRAINT uq_users_phone UNIQUE (phone)
);

CREATE TABLE IF NOT EXISTS roles (
  id             CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  name           VARCHAR(255) NOT NULL,
  description    TEXT,
  is_protected   TINYINT(1) NOT NULL DEFAULT 0,
  is_deleted     TINYINT(1) NOT NULL DEFAULT 0,
  created_at     DATETIME NOT NULL DEFAULT NOW(),
  updated_at     DATETIME NOT NULL DEFAULT NOW(),
  created_by     CHAR(36) REFERENCES users (id),
  updated_by     CHAR(36) REFERENCES users (id),
  role_group_id  CHAR(36) REFERENCES role_groups (id),
  CONSTRAINT uq_roles_name UNIQUE (name)
);


CREATE TABLE IF NOT EXISTS permissions (
  id           CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  key          VARCHAR(255) NOT NULL,
  parent_key   VARCHAR(255),
  name         VARCHAR(255) NOT NULL,
  target_type  VARCHAR(255) NOT NULL,
  target_id    VARCHAR(255) NOT NULL,
  action       VARCHAR(255) NOT NULL,
  module_name  VARCHAR(255),
  route_path   VARCHAR(255),
  lookup_key   VARCHAR(255),
  sort_index   INTEGER NOT NULL DEFAULT 0,
  is_deleted   TINYINT(1) NOT NULL DEFAULT 0,
  created_at   DATETIME,
  updated_at   DATETIME,
  created_by   CHAR(36) REFERENCES users (id),
  updated_by   CHAR(36) REFERENCES users (id),
  CONSTRAINT uq_permissions_key UNIQUE (key)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id        CHAR(36) NOT NULL REFERENCES roles (id),
  permission_id  CHAR(36) NOT NULL REFERENCES permissions (id),
  is_granted     TINYINT(1) NOT NULL DEFAULT 0,
  created_at     DATETIME NOT NULL DEFAULT NOW(),
  created_by     CHAR(36) REFERENCES users (id),
  updated_by     CHAR(36) REFERENCES users (id),
  updated_at     DATETIME NOT NULL DEFAULT NOW(),
  is_deleted     TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
  id          CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id     CHAR(36) REFERENCES users (id),
  role_id     CHAR(36) REFERENCES roles (id),
  created_at  DATETIME NOT NULL DEFAULT NOW(),
  created_by  CHAR(36) REFERENCES users (id),
  updated_by  CHAR(36) REFERENCES users (id),
  updated_at  DATETIME NOT NULL DEFAULT NOW(),
  is_deleted  TINYINT(1) NOT NULL DEFAULT 0,
  CONSTRAINT uq_user_roles_user_role UNIQUE (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS user_permissions (
  user_id        CHAR(36) NOT NULL REFERENCES users (id),
  permission_id  CHAR(36) NOT NULL REFERENCES permissions (id),
  role_id        CHAR(36) NOT NULL REFERENCES roles (id),
  is_granted     TINYINT(1) NOT NULL DEFAULT 0,
  created_at     DATETIME NOT NULL DEFAULT NOW(),
  created_by     CHAR(36) REFERENCES users (id),
  updated_by     CHAR(36) REFERENCES users (id),
  updated_at     DATETIME NOT NULL DEFAULT NOW(),
  is_deleted     TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, permission_id, role_id)
);

CREATE TABLE IF NOT EXISTS revoked_tokens (
  id          CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  token       VARCHAR(255) NOT NULL,
  user_id     CHAR(36) REFERENCES users (id),
  created_at  DATETIME NOT NULL DEFAULT NOW(),
  revoked_at  DATETIME NOT NULL DEFAULT NOW(),
  is_used     TINYINT(1) NOT NULL DEFAULT 0,
  CONSTRAINT uq_revoked_tokens_token UNIQUE (token)
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id            CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id       CHAR(36) REFERENCES users (id),
  ip_address    VARCHAR(45),
  user_agent    VARCHAR(255),
  success       TINYINT(1) NOT NULL DEFAULT 0,
  attempted_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_login_attempts_user_ip_time UNIQUE (user_id, ip_address, attempted_at)
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id              CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id         CHAR(36) REFERENCES users (id),
  session_token   VARCHAR(255) NOT NULL,
  created_at      DATETIME NOT NULL DEFAULT NOW(),
  last_seen_at    DATETIME,
  expires_at      TIMESTAMP,
  is_active       TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT uq_user_sessions_token UNIQUE (session_token)
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id           CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id      CHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token        VARCHAR(100) NOT NULL,
  created_at   DATETIME NOT NULL DEFAULT NOW(),
  expires_at   DATETIME NOT NULL,
  is_used      TINYINT(1) NOT NULL DEFAULT 0,
  used_at      DATETIME,
  ip_address   VARCHAR(45),
  user_agent   VARCHAR(255),
  attempts     INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT uq_password_reset_tokens_token UNIQUE (token)
);

CREATE TABLE IF NOT EXISTS pending_employee_self_registrations (
  id                   CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  first_name           VARCHAR(255) NOT NULL,
  last_name            VARCHAR(255) NOT NULL,
  email                VARCHAR(255) NOT NULL,
  phone                VARCHAR(255) NOT NULL,
  password             VARCHAR(255) NOT NULL,
  role_group_id        CHAR(36) REFERENCES role_groups (id),
  request_note         TEXT,
  verification_token   VARCHAR(255) NOT NULL,
  token_sent_at        DATETIME NOT NULL DEFAULT NOW(),
  is_email_verified    TINYINT(1) NOT NULL DEFAULT 0,
  email_verified_at    DATETIME,
  pending_status       VARCHAR(32) NOT NULL DEFAULT 'EMAIL_NOT_VERIFIED',
  approved_by          CHAR(36) REFERENCES users (id),
  approved_at          DATETIME,
  requested_at         DATETIME NOT NULL DEFAULT NOW(),
  is_deleted           TINYINT(1) NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_employee_email_active
  ON pending_employee_self_registrations (lower(email))
  WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_pending_employee_token
  ON pending_employee_self_registrations (verification_token)
  WHERE is_deleted = FALSE;

-- ############################################################################
-- # BÖLÜM 2 — Kiracı iskeleti                                                        #
-- ############################################################################

-- companies: güncel şema (01 + 04 + 05 migration içerir)
CREATE TABLE IF NOT EXISTS companies (
  id           CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  name         VARCHAR(255) NOT NULL,
  phone        VARCHAR(255),
  website      VARCHAR(255),
  email        VARCHAR(255),
  address      VARCHAR(2000),
  postal_code  VARCHAR(32),
  maps_url     VARCHAR(2000),
  owner_user_id CHAR(36) REFERENCES users (id),
  logo_url     VARCHAR(500),
  created_at   DATETIME NOT NULL DEFAULT NOW(),
  updated_at   DATETIME NOT NULL DEFAULT NOW(),
  is_deleted   TINYINT(1) NOT NULL DEFAULT 0
);

-- Eski blinds şeması kaldıysa (slug/active vb.), eksik kolonları tamamla.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS phone VARCHAR(255);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS website VARCHAR(255);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS address VARCHAR(2000);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS postal_code VARCHAR(32);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS maps_url VARCHAR(2000);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS owner_user_id CHAR(36);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_url VARCHAR(500);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_deleted TINYINT(1);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS tax_rate_percent NUMERIC(6, 3);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS country_code VARCHAR(2) NULL;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS region_code VARCHAR(8) NULL;

UPDATE companies SET is_deleted = FALSE WHERE is_deleted IS NULL;

-- ############################################################################
-- # Contract / Invoice templates (per company)                                #
-- ############################################################################

CREATE TABLE IF NOT EXISTS company_document_templates (
  company_id   CHAR(36) NOT NULL REFERENCES companies (id),
  kind         VARCHAR(64) NOT NULL, -- deposit_contract | final_invoice
  subject      VARCHAR(300) NOT NULL DEFAULT '',
  body_html    TEXT NOT NULL DEFAULT '',
  created_at   DATETIME NOT NULL DEFAULT NOW(),
  updated_at   DATETIME NOT NULL DEFAULT NOW(),
  is_deleted   TINYINT(1) NOT NULL DEFAULT 0,
  CONSTRAINT pk_company_document_templates PRIMARY KEY (company_id, kind)
);
-- 34_company_document_templates_preset_key.sql
ALTER TABLE company_document_templates
  ADD COLUMN IF NOT EXISTS preset_key VARCHAR(64) NULL;
ALTER TABLE companies MODIFY COLUMN is_deleted 0;
ALTER TABLE companies -- MODIFY COLUMN is_deleted NOT NULL (handle manually);

-- Eski kurulumlarda tetikleyici varken kolon eksik kalabiliyor.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS updated_at DATETIME NOT NULL DEFAULT NOW();
UPDATE companies SET updated_at = COALESCE(created_at, NOW()) WHERE updated_at IS NULL;


CREATE UNIQUE INDEX IF NOT EXISTS uq_companies_name ON companies (name);
CREATE INDEX IF NOT EXISTS ix_companies_owner_user_id ON companies (owner_user_id);


CREATE TABLE IF NOT EXISTS company_members (
  company_id  CHAR(36)        NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  user_id     CHAR(36)        NOT NULL REFERENCES users (id) ON UPDATE CASCADE ON DELETE CASCADE,
  role        TEXT        NOT NULL DEFAULT 'member'
              CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  active      TINYINT(1)     NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_company_members_user ON company_members (user_id);


-- ############################################################################
-- # BÖLÜM 2.1 — Blinds iş alanı tabloları (template uyumlu, idempotent)              #
-- ############################################################################

CREATE TABLE IF NOT EXISTS status_user (
  company_id  CHAR(36)        NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  id          VARCHAR(16) NOT NULL,
  name        TEXT        NOT NULL,
  active      TINYINT(1)     NOT NULL DEFAULT 1,
  PRIMARY KEY (company_id, id)
);

CREATE INDEX IF NOT EXISTS idx_status_user_company_active ON status_user (company_id);

CREATE TABLE IF NOT EXISTS status_order (
  company_id  CHAR(36)        NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  id          VARCHAR(16) NOT NULL,
  name        TEXT        NOT NULL,
  active      TINYINT(1)     NOT NULL DEFAULT 1,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, id)
);

CREATE INDEX IF NOT EXISTS idx_status_order_company_active ON status_order (company_id);

CREATE TABLE IF NOT EXISTS blinds_type (
  company_id  CHAR(36)        NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  id          VARCHAR(16) NOT NULL,
  name        TEXT        NOT NULL,
  aciklama    TEXT,
  active      TINYINT(1)     NOT NULL DEFAULT 1,
  PRIMARY KEY (company_id, id)
);

CREATE INDEX IF NOT EXISTS idx_blinds_type_company_active ON blinds_type (company_id);

CREATE TABLE IF NOT EXISTS customers (
  company_id      CHAR(36)        NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  id              VARCHAR(16) NOT NULL,
  name            TEXT        NOT NULL,
  surname         TEXT,
  phone           TEXT,
  email           TEXT,
  address         TEXT,
  postal_code     TEXT,
  status_user_id  VARCHAR(16),
  active          TINYINT(1)     NOT NULL DEFAULT 1,
  created_at      DATETIME NOT NULL DEFAULT NOW(),
  updated_at      DATETIME NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id),
  CONSTRAINT fk_customers_status_user
    FOREIGN KEY (company_id, status_user_id)
    REFERENCES status_user (company_id, id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_customers_company_active ON customers (company_id);
CREATE INDEX IF NOT EXISTS idx_customers_company_created ON customers (company_id, created_at DESC);
-- Prefix on TEXT name: full-column index exceeds InnoDB max key length (utf8mb4).
CREATE INDEX IF NOT EXISTS idx_customers_company_name ON customers (company_id, name(191));

CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_company_email
  ON customers (company_id, lower(TRIM(email)))
  WHERE email IS NOT NULL AND TRIM(email) <> '';

CREATE TABLE IF NOT EXISTS estimate (
  company_id    CHAR(36)        NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  id            VARCHAR(16) NOT NULL,
  customer_id   VARCHAR(16) NOT NULL,
  blinds_id     VARCHAR(16),
  perde_sayisi  INTEGER,
  tarih_saat    DATETIME,
  lead_source   TEXT,
  created_at    DATETIME NOT NULL DEFAULT NOW(),
  updated_at    DATETIME NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id),
  CONSTRAINT fk_estimate_customer
    FOREIGN KEY (company_id, customer_id)
    REFERENCES customers (company_id, id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_estimate_blinds_type
    FOREIGN KEY (company_id, blinds_id)
    REFERENCES blinds_type (company_id, id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
);


CREATE INDEX IF NOT EXISTS idx_estimate_company_customer ON estimate (company_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_estimate_company_tarih ON estimate (company_id, tarih_saat DESC);
CREATE INDEX IF NOT EXISTS idx_estimate_company_lead_source ON estimate (company_id, lead_source);

-- Many blinds types per estimate (preferred); estimate.blinds_id is optional legacy pointer.
CREATE TABLE IF NOT EXISTS estimate_blinds (
  company_id   CHAR(36)        NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  estimate_id  VARCHAR(16) NOT NULL,
  blinds_id    VARCHAR(16) NOT NULL,
  sort_order   INTEGER     NOT NULL DEFAULT 0,
  perde_sayisi INTEGER,
  PRIMARY KEY (company_id, estimate_id, blinds_id),
  CONSTRAINT fk_estimate_blinds_estimate
    FOREIGN KEY (company_id, estimate_id)
    REFERENCES estimate (company_id, id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  CONSTRAINT fk_estimate_blinds_blinds_type
    FOREIGN KEY (company_id, blinds_id)
    REFERENCES blinds_type (company_id, id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_estimate_blinds_company_estimate
  ON estimate_blinds (company_id, estimate_id);

ALTER TABLE estimate -- MODIFY COLUMN blinds_id (DROP NOT NULL - handle manually);

CREATE TABLE IF NOT EXISTS orders (
  company_id              CHAR(36)        NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  id                      VARCHAR(16) NOT NULL,
  customer_id             VARCHAR(16) NOT NULL,
  total_amount            NUMERIC(14, 2),
  downpayment             NUMERIC(14, 2),
  final_payment           NUMERIC(14, 2),
  balance                 NUMERIC(14, 2),
  agree_data              TEXT,
  agreement_date          DATE,
  installation_date       DATE,
  extra_harcama           NUMERIC(14, 2),
  tax_uygulanacak_miktar  NUMERIC(14, 2),
  tax_amount              NUMERIC(14, 2),
  blinds_lines            JSON       NOT NULL DEFAULT ('[]'),
  order_note              TEXT,
  blinds_type_add_id      VARCHAR(16),
  parent_order_id         VARCHAR(16),
  status_orde_id          VARCHAR(16),
  active                  TINYINT(1)     NOT NULL DEFAULT 1,
  created_at              DATETIME NOT NULL DEFAULT NOW(),
  updated_at              DATETIME NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id),
  CONSTRAINT fk_orders_customer
    FOREIGN KEY (company_id, customer_id)
    REFERENCES customers (company_id, id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_orders_status_order
    FOREIGN KEY (company_id, status_orde_id)
    REFERENCES status_order (company_id, id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,
  CONSTRAINT fk_orders_parent_order
    FOREIGN KEY (company_id, parent_order_id)
    REFERENCES orders (company_id, id)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_orders_company_parent ON orders (company_id, parent_order_id)
  WHERE parent_order_id IS NOT NULL AND active = 1;

CREATE INDEX IF NOT EXISTS idx_orders_company_active ON orders (company_id);
CREATE INDEX IF NOT EXISTS idx_orders_company_customer ON orders (company_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_company_created ON orders (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_company_status ON orders (company_id, status_orde_id);

CREATE TABLE IF NOT EXISTS order_payment_entries (
  id           CHAR(36)         NOT NULL DEFAULT (UUID()),
  company_id   CHAR(36)         NOT NULL,
  order_id     VARCHAR(16)  NOT NULL,
  amount       NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  created_at   DATETIME  NOT NULL DEFAULT NOW(),
  payment_group_id CHAR(36),
  is_deleted   TINYINT(1)      NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  CONSTRAINT fk_order_payment_entries_order
    FOREIGN KEY (company_id, order_id)
    REFERENCES orders (company_id, id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_order_payment_entries_company_order_created
  ON order_payment_entries (company_id, order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_order_payment_entries_active
  ON order_payment_entries (company_id, order_id, created_at DESC)
  WHERE COALESCE(is_deleted, 0) = FALSE;

CREATE INDEX IF NOT EXISTS idx_order_payment_entries_group
  ON order_payment_entries (company_id, payment_group_id, created_at DESC)
  WHERE payment_group_id IS NOT NULL AND COALESCE(is_deleted, 0) = FALSE;

CREATE TABLE IF NOT EXISTS order_attachments (
  id                 CHAR(36)         NOT NULL DEFAULT (UUID()),
  company_id         CHAR(36)         NOT NULL,
  order_id           VARCHAR(16)  NOT NULL,
  kind               TEXT         NOT NULL CHECK (kind IN ('photo', 'excel', 'line_photo')),
  blinds_type_id     VARCHAR(16),
  original_filename  TEXT         NOT NULL,
  stored_relpath     TEXT         NOT NULL,
  content_type       TEXT,
  file_size          BIGINT,
  created_at         DATETIME  NOT NULL DEFAULT NOW(),
  is_deleted         TINYINT(1)      NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  CONSTRAINT fk_order_attachments_order
    FOREIGN KEY (company_id, order_id)
    REFERENCES orders (company_id, id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_order_attachments_company_order
  ON order_attachments (company_id, order_id, created_at DESC)
  WHERE COALESCE(is_deleted, 0) = FALSE;

-- Order-level expenses (cost ledger): affects profit only, not payments/balance.
CREATE TABLE IF NOT EXISTS order_expense_entries (
  id           CHAR(36)          NOT NULL DEFAULT (UUID()),
  company_id   CHAR(36)          NOT NULL,
  order_id     VARCHAR(16)   NOT NULL,
  amount       NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  note         TEXT,
  spent_at     DATETIME,
  created_at   DATETIME   NOT NULL DEFAULT NOW(),
  created_by_user_id CHAR(36),
  is_deleted   TINYINT(1)       NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  CONSTRAINT fk_order_expense_entries_order
    FOREIGN KEY (company_id, order_id)
    REFERENCES orders (company_id, id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  CONSTRAINT fk_order_expense_entries_created_by
    FOREIGN KEY (created_by_user_id)
    REFERENCES users (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_order_expense_entries_company_order_created
  ON order_expense_entries (company_id, order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_order_expense_entries_active
  ON order_expense_entries (company_id, order_id, created_at DESC)
  WHERE COALESCE(is_deleted, 0) = FALSE;

CREATE TABLE IF NOT EXISTS blinds_type_add (
  company_id        CHAR(36)        NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  id                VARCHAR(16) NOT NULL,
  blinds_type_id    VARCHAR(16) NOT NULL,
  product_category  TEXT        NOT NULL DEFAULT 'classic'
                      CHECK (product_category IN ('classic', 'delux', 'premium')),
  amount            NUMERIC(14, 2),
  number_of_blinds  INTEGER,
  square_meter      NUMERIC(14, 4),
  number_of_motor   INTEGER,
  order_id          VARCHAR(16) NOT NULL,
  created_at        DATETIME NOT NULL DEFAULT NOW(),
  updated_at        DATETIME NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id),
  CONSTRAINT fk_blinds_type_add_blinds_type
    FOREIGN KEY (company_id, blinds_type_id)
    REFERENCES blinds_type (company_id, id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_blinds_type_add_order
    FOREIGN KEY (company_id, order_id)
    REFERENCES orders (company_id, id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_blinds_type_add_company_order ON blinds_type_add (company_id, order_id);
CREATE INDEX IF NOT EXISTS idx_blinds_type_add_company_type ON blinds_type_add (company_id, blinds_type_id);


-- ############################################################################
-- # BÖLÜM 2.2 — Blinds iş akışı: lead / kalem / ödeme / ekler / calendar sync        #
-- ############################################################################

-- Leads (inquiries)
CREATE TABLE IF NOT EXISTS leads (
  id            CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  company_id    CHAR(36) NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  first_name    TEXT,
  last_name     TEXT,
  phone         TEXT,
  email         TEXT,
  address       TEXT,
  source        TEXT,
  note          TEXT,
  status        TEXT NOT NULL DEFAULT 'new'
                CHECK (status IN ('new', 'contacted', 'estimate_scheduled', 'estimated', 'won', 'lost', 'archived')),
  created_at    DATETIME NOT NULL DEFAULT NOW(),
  updated_at    DATETIME NOT NULL DEFAULT NOW(),
  is_deleted    TINYINT(1) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_leads_company_created_at ON leads (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_company_status ON leads (company_id, status);

-- Estimate schedule + Google Calendar event mapping (one-way: app -> Google)
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS lead_id CHAR(36);
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS scheduled_start_at DATETIME;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS scheduled_end_at DATETIME;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS calendar_provider TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS calendar_id TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS google_event_id TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS calendar_last_synced_at DATETIME;

ALTER TABLE estimate ADD COLUMN IF NOT EXISTS visit_time_zone TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS visit_address TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS visit_postal_code TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS visit_notes TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS visit_organizer_name TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS visit_organizer_email VARCHAR(320);
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS visit_guest_emails JSON NOT NULL DEFAULT ('[]');
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS visit_recurrence_rrule TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS is_deleted TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE estimate ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';


CREATE INDEX IF NOT EXISTS idx_estimate_company_not_deleted
  ON estimate (company_id)
  WHERE is_deleted != 1;

CREATE INDEX IF NOT EXISTS idx_estimate_company_status
  ON estimate (company_id, status)
  WHERE is_deleted != 1;


CREATE INDEX IF NOT EXISTS idx_estimate_company_scheduled_start
  ON estimate (company_id, scheduled_start_at DESC);

-- Orders: production + installation window + Google Calendar event mapping
ALTER TABLE orders ADD COLUMN IF NOT EXISTS status_code TEXT NOT NULL DEFAULT 'order_created'
  CHECK (status_code IN (
    'order_created',
    'deposit_paid',
    'in_production',
    'ready_for_install',
    'install_scheduled',
    'installed',
    'final_paid',
    'cancelled'
  ));

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS blinds_lines JSON NOT NULL DEFAULT ('[]');

ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(14, 2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_note TEXT;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS ready_at DATETIME;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS installed_at DATETIME;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS installation_scheduled_start_at DATETIME;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS installation_scheduled_end_at DATETIME;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS installation_calendar_provider TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS installation_calendar_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS installation_google_event_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS installation_calendar_last_synced_at DATETIME;

-- Order items (each order may include multiple models; all items must share same catalog_category)
CREATE TABLE IF NOT EXISTS order_items (
  company_id        CHAR(36)        NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  id                CHAR(36)        PRIMARY KEY DEFAULT (UUID()),
  order_id          VARCHAR(16) NOT NULL,
  catalog_category  TEXT        NOT NULL CHECK (catalog_category IN ('classic', 'delux', 'premium')),
  model             TEXT        NOT NULL CHECK (model IN ('zebra', 'roller_shade', 'honecomb', 'galaxy', 'curtains')),
  lifting_system    TEXT        NOT NULL CHECK (lifting_system IN ('chain', 'cordless', 'motorized')),
  kasa_type         TEXT        NOT NULL CHECK (kasa_type IN ('square', 'square_curved', 'round')),
  fabric_insert     TINYINT(1)     NOT NULL DEFAULT 0,
  width_mm          INTEGER,
  height_mm         INTEGER,
  quantity          INTEGER     NOT NULL DEFAULT 1,
  notes             TEXT,
  unit_price        NUMERIC(14, 2),
  created_at        DATETIME NOT NULL DEFAULT NOW(),
  updated_at        DATETIME NOT NULL DEFAULT NOW(),
  is_deleted        TINYINT(1)     NOT NULL DEFAULT 0,
  CONSTRAINT fk_order_items_order
    FOREIGN KEY (company_id, order_id)
    REFERENCES orders (company_id, id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_order_items_company_order ON order_items (company_id, order_id);

-- Payments (supports deposit/final; allows future expansion)
CREATE TABLE IF NOT EXISTS order_payments (
  id            CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  company_id    CHAR(36) NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  order_id      VARCHAR(16) NOT NULL,
  payment_type  TEXT NOT NULL CHECK (payment_type IN ('deposit', 'final', 'other')),
  amount        NUMERIC(14, 2) NOT NULL,
  paid_at       DATETIME,
  method        TEXT,
  note          TEXT,
  created_at    DATETIME NOT NULL DEFAULT NOW(),
  is_deleted    TINYINT(1) NOT NULL DEFAULT 0,
  CONSTRAINT fk_order_payments_order
    FOREIGN KEY (company_id, order_id)
    REFERENCES orders (company_id, id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_order_payments_company_paid_at ON order_payments (company_id, paid_at DESC);

-- Attachments for lead/estimate/order/installation
CREATE TABLE IF NOT EXISTS attachments (
  id            CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  company_id    CHAR(36) NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  entity_type   TEXT NOT NULL CHECK (entity_type IN ('lead', 'estimate', 'order', 'installation')),
  entity_id     TEXT NOT NULL,
  media_type    TEXT NOT NULL CHECK (media_type IN ('photo', 'video', 'file')),
  url           TEXT NOT NULL,
  taken_at      DATETIME,
  uploaded_by   CHAR(36) REFERENCES users (id) ON DELETE SET NULL,
  note          TEXT,
  created_at    DATETIME NOT NULL DEFAULT NOW(),
  is_deleted    TINYINT(1) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_attachments_company_entity ON attachments (company_id, entity_type, entity_id);

-- users.company_id (01 migration)
ALTER TABLE users ADD COLUMN IF NOT EXISTS company_id CHAR(36);


CREATE INDEX IF NOT EXISTS ix_users_company_id ON users (company_id);

-- pending company self-registration (01 migration)
CREATE TABLE IF NOT EXISTS pending_company_self_registrations (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  first_name VARCHAR(255) NOT NULL,
  last_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(255) NOT NULL,
  password VARCHAR(255) NOT NULL,
  company_name VARCHAR(255) NOT NULL,
  company_phone VARCHAR(255),
  website VARCHAR(255),
  request_note TEXT,
  verification_token VARCHAR(255) NOT NULL,
  token_sent_at DATETIME NOT NULL DEFAULT NOW(),
  is_email_verified TINYINT(1) NOT NULL DEFAULT 0,
  email_verified_at DATETIME,
  pending_status VARCHAR(32) NOT NULL DEFAULT 'EMAIL_NOT_VERIFIED',
  approved_by CHAR(36) REFERENCES users(id),
  approved_at DATETIME,
  requested_at DATETIME NOT NULL DEFAULT NOW(),
  is_deleted TINYINT(1) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pending_company_token
  ON pending_company_self_registrations (verification_token)
  WHERE is_deleted = FALSE;

-- user_company_memberships (02 migration) — çoklu şirket üyeliği
CREATE TABLE IF NOT EXISTS user_company_memberships (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id CHAR(36) NOT NULL REFERENCES users(id),
  company_id CHAR(36) NOT NULL REFERENCES companies(id),
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_company_memberships_user_company
  ON user_company_memberships (user_id, company_id);

-- Mevcut users.company_id -> üyelik (güvenli backfill)
INSERT INTO user_company_memberships (user_id, company_id, is_deleted)
SELECT u.id, u.company_id, FALSE
FROM users u
WHERE u.company_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM user_company_memberships m
    WHERE m.user_id = u.id AND m.company_id = u.company_id
  );

-- Şirket başına Google Calendar OAuth (05_company_google_calendar.sql ile uyumlu)
CREATE TABLE IF NOT EXISTS company_google_calendar (
  company_id          CHAR(36)        NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  refresh_token       TEXT        NOT NULL,
  calendar_id         TEXT        NOT NULL DEFAULT 'primary',
  google_account_email TEXT,
  created_at          DATETIME NOT NULL DEFAULT NOW(),
  updated_at          DATETIME NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id)
);

CREATE INDEX IF NOT EXISTS idx_company_google_calendar_company ON company_google_calendar (company_id);

-- ############################################################################
-- # Denetim                                                                          #
-- ############################################################################

CREATE TABLE IF NOT EXISTS user_audit_logs (
  id           CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  executed_by  CHAR(36) REFERENCES users (id) ON DELETE SET NULL,
  action       VARCHAR(50) NOT NULL,
  table_name   VARCHAR(100) NOT NULL,
  table_id     CHAR(36),
  before_data  JSON,
  after_data   JSON,
  ip_address   VARCHAR(45),
  user_agent   VARCHAR(255),
  timestamp    DATETIME NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_audit_user_action_table_time UNIQUE (executed_by, action, table_name, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_user_audit_logs_timestamp ON user_audit_logs (timestamp DESC);

CREATE TABLE IF NOT EXISTS system_audit_logs (
  id            CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  service_name  VARCHAR(100) NOT NULL,
  action        VARCHAR(100) NOT NULL,
  status        VARCHAR(20) NOT NULL,
  details       JSON,
  executed_by   VARCHAR(100),
  ip_address    VARCHAR(45),
  timestamp     DATETIME NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_system_audit_service_action_time UNIQUE (service_name, action, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_system_audit_logs_timestamp ON system_audit_logs (timestamp DESC);

-- ############################################################################
-- # Tetikleyiciler                                                                   #
-- ############################################################################


  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- Blinds iş tabloları updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

  BEFORE UPDATE ON estimate
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();


  AFTER INSERT ON orders
  FOR EACH ROW EXECUTE PROCEDURE trg_orders_mark_estimate_converted();

  BEFORE UPDATE ON blinds_type_add
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

  BEFORE UPDATE ON company_google_calendar
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- ############################################################################
-- # BÖLÜM 3 — Kiracı RLS (03 migration içerir)                                   #
-- ############################################################################
-- Uygulama GUC: app.rls_bypass, app.tenant_company_id, app.current_user_id

  AFTER INSERT ON orders
  FOR EACH ROW
  EXECUTE PROCEDURE trg_orders_mark_estimate_converted();
COMMIT;

-- 10_orders_blinds_lines.sql
-- Store chosen blinds lines (from estimate or manual) on orders as JSON.
-- Idempotent: safe to run multiple times.
BEGIN;
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS blinds_lines JSON NOT NULL DEFAULT ('[]');
CREATE INDEX IF NOT EXISTS idx_orders_company_blinds_lines
  ON orders (company_id)
  WHERE active = 1;
COMMIT;

-- 11_company_tax_orders_tax_amount.sql
-- Default sales tax % on company; order tax = taxable base * rate / 100.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS tax_rate_percent NUMERIC(6, 3);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(14, 2);

-- 12_orders_order_note.sql
-- Free-text note on the order (internal / customer-facing at team discretion).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_note TEXT;

-- 13_blinds_product_categories.sql
-- Global product categories (shared by all companies) + per-company matrix:
-- which categories are allowed for each blinds type.
-- Orders store blinds_lines[].category = blinds_product_category.code (exposed as "id" in the API).
-- Global catalog starts empty: add categories under Lookups (superadmin). type×category backfill below inserts nothing until categories exist.
-- Idempotent: safe to run multiple times on empty or already-migrated DB.
BEGIN;
CREATE TABLE IF NOT EXISTS blinds_product_category (
  code         VARCHAR(32) NOT NULL PRIMARY KEY,
  name         TEXT         NOT NULL,
  sort_order   INTEGER      NOT NULL DEFAULT 0,
  active       TINYINT(1)      NOT NULL DEFAULT 1,
  created_at   DATETIME  NOT NULL DEFAULT NOW(),
  updated_at   DATETIME  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_blinds_product_category_active
  ON blinds_product_category (active) WHERE active = 1;
CREATE TABLE IF NOT EXISTS blinds_type_category_allowed (
  company_id       CHAR(36)         NOT NULL,
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
-- Backfill matrix (name-based rules), excluding curtain types (no rows until blinds_product_category has codes).
INSERT INTO blinds_type_category_allowed (company_id, blinds_type_id, category_code)
SELECT bt.company_id, bt.id, pc.code
FROM blinds_type bt
JOIN blinds_product_category pc ON pc.active = 1
WHERE NOT (lower(bt.name) ~ 'curtain')
  AND (
    (lower(bt.name) ~ '(zebra|roller)' AND pc.code IN ('classic', 'delux', 'premium'))
    OR (lower(bt.name) ~ 'galaxy' AND pc.code IN ('classic', 'premium'))
    OR (
      (lower(bt.name) ~ 'honeycomb' OR lower(bt.name) ~ 'honeyc')
      AND pc.code IN ('delux', 'premium')
    )
  )
;
COMMIT;

-- 14_migrate_product_category_to_global.sql
-- Use ONLY if a previous version of 13 created blinds_product_category WITH company_id.
-- Fresh installs: run the current 13_blinds_product_categories.sql only (no 14).
BEGIN;
COMMIT;

-- 15_blinds_line_extra_attributes REMOVED — lifting system / cassette type matrices retired.
-- Fresh installs skip creation; existing DBs drop leftover tables when this script is reapplied.
BEGIN;
DROP TABLE IF EXISTS blinds_type_extra_allowed CASCADE;
DROP TABLE IF EXISTS blinds_line_extra_option CASCADE;
DROP TABLE IF EXISTS blinds_line_extra_kind CASCADE;
COMMIT;

-- 16_order_payment_entries.sql
-- Record each POST /orders/{id}/record-payment for history (amount + timestamp).
-- Run after existing blinds migrations; idempotent.
CREATE TABLE IF NOT EXISTS order_payment_entries (
  id           CHAR(36)         NOT NULL DEFAULT (UUID()),
  company_id   CHAR(36)         NOT NULL,
  order_id     VARCHAR(16)  NOT NULL,
  amount       NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  created_at   DATETIME  NOT NULL DEFAULT NOW(),
  is_deleted   TINYINT(1)      NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  CONSTRAINT fk_order_payment_entries_order
    FOREIGN KEY (company_id, order_id)
    REFERENCES orders (company_id, id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_order_payment_entries_company_order_created
  ON order_payment_entries (company_id, order_id, created_at DESC);

-- 17_order_payment_entries_soft_delete.sql
-- Soft-delete for payment history lines (DELETE API sets is_deleted; sums exclude deleted rows).
ALTER TABLE order_payment_entries
  ADD COLUMN IF NOT EXISTS is_deleted TINYINT(1) NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_order_payment_entries_active
  ON order_payment_entries (company_id, order_id, created_at DESC)
  WHERE COALESCE(is_deleted, 0) = FALSE;

-- 18_order_attachments.sql
-- Order files: photos and spreadsheets; soft-delete via is_deleted.
CREATE TABLE IF NOT EXISTS order_attachments (
  id                 CHAR(36)         NOT NULL DEFAULT (UUID()),
  company_id         CHAR(36)         NOT NULL,
  order_id           VARCHAR(16)  NOT NULL,
  kind               TEXT         NOT NULL CHECK (kind IN ('photo', 'excel', 'line_photo')),
  blinds_type_id     VARCHAR(16),
  original_filename  TEXT         NOT NULL,
  stored_relpath     TEXT         NOT NULL,
  content_type       TEXT,
  file_size          BIGINT,
  created_at         DATETIME  NOT NULL DEFAULT NOW(),
  is_deleted         TINYINT(1)      NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  CONSTRAINT fk_order_attachments_order
    FOREIGN KEY (company_id, order_id)
    REFERENCES orders (company_id, id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_order_attachments_company_order
  ON order_attachments (company_id, order_id, created_at DESC)
  WHERE COALESCE(is_deleted, 0) = FALSE;

-- 19_status_estimate_lookup.sql
-- Estimate workflow labels in tenant lookup table (mirrors status_order pattern).
-- Replaces estimate.status TEXT with estimate.status_esti_id FK; slug keeps filter/trigger semantics.
BEGIN;
CREATE TABLE IF NOT EXISTS status_estimate (
  company_id CHAR(36) NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  id VARCHAR(16) NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (company_id, id),
  CONSTRAINT ck_status_estimate_slug CHECK (slug IN ('pending', 'converted', 'cancelled')),
  CONSTRAINT uq_status_estimate_company_slug UNIQUE (company_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_status_estimate_company_active
  ON status_estimate (company_id) WHERE active = 1;
INSERT INTO status_estimate (company_id, id, slug, name, active)
SELECT c.id,
  substring(md5(c.id || ':est:' || x.slug), 1, 16),
  x.slug,
  x.name,
  TRUE
FROM companies c
CROSS JOIN (
  VALUES
    ('pending', 'Pending'),
    ('converted', 'Converted to order'),
    ('cancelled', 'Cancelled')
) AS x(slug, name)
;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS status_esti_id VARCHAR(16);
UPDATE estimate e
SET status_esti_id = COALESCE(
  (
    SELECT se.id
    FROM status_estimate se
    WHERE se.company_id = e.company_id
      AND se.slug = lower(trim(COALESCE(e.status, 'pending')))
    LIMIT 1
  ),
  (
    SELECT se2.id
    FROM status_estimate se2
    WHERE se2.company_id = e.company_id AND se2.slug = 'pending'
    LIMIT 1
  )
)
WHERE e.status_esti_id IS NULL;
ALTER TABLE estimate DROP CONSTRAINT IF EXISTS ck_estimate_status;
ALTER TABLE estimate DROP COLUMN IF EXISTS status;
ALTER TABLE estimate -- MODIFY COLUMN status_esti_id NOT NULL (handle manually);
ALTER TABLE estimate DROP CONSTRAINT IF EXISTS fk_estimate_status_estimate;
ALTER TABLE estimate
  ADD CONSTRAINT fk_estimate_status_estimate
  FOREIGN KEY (company_id, status_esti_id)
  REFERENCES status_estimate (company_id, id)
  ON UPDATE CASCADE
  ON DELETE RESTRICT;
COMMIT;

-- 20_status_estimate_custom_rows.sql
-- Allow extra estimate statuses (slug NULL) like custom order labels; keep slug only for built-in workflow rows.
BEGIN;
ALTER TABLE status_estimate DROP CONSTRAINT IF EXISTS ck_status_estimate_slug;
ALTER TABLE status_estimate DROP CONSTRAINT IF EXISTS uq_status_estimate_company_slug;
ALTER TABLE status_estimate -- MODIFY COLUMN slug (DROP NOT NULL - handle manually);
ALTER TABLE status_estimate ADD CONSTRAINT ck_status_estimate_slug_null_or_enum
  CHECK (slug IS NULL OR slug IN ('pending', 'converted', 'cancelled'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_status_estimate_company_slug_nn
  ON status_estimate (company_id, slug)
  WHERE slug IS NOT NULL;
COMMIT;

-- 21_status_sort_order.sql
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

-- 22_status_estimate_builtin_kind.sql
-- Replace legacy `slug` with `builtin_kind` (same semantics; not shown in Lookups UI).
-- Run after 19 / 20 / 21. Updates the order→converted trigger to use `builtin_kind`.
BEGIN;
ALTER TABLE status_estimate ADD COLUMN IF NOT EXISTS builtin_kind TEXT;
UPDATE status_estimate SET builtin_kind = slug WHERE slug IS NOT NULL;
ALTER TABLE status_estimate DROP CONSTRAINT IF EXISTS ck_status_estimate_slug_null_or_enum;
ALTER TABLE status_estimate DROP CONSTRAINT IF EXISTS ck_status_estimate_slug;
DROP INDEX IF EXISTS uq_status_estimate_company_slug_nn;
ALTER TABLE status_estimate DROP COLUMN IF EXISTS slug;
ALTER TABLE status_estimate ADD CONSTRAINT ck_status_estimate_builtin_kind
  CHECK (builtin_kind IS NULL OR builtin_kind IN ('pending', 'converted', 'cancelled'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_status_estimate_company_builtin_nn
  ON status_estimate (company_id, builtin_kind)
  WHERE builtin_kind IS NOT NULL;
COMMIT;

-- 23_companies_country_code.sql
-- ISO 3166-1 alpha-2: restricts Photon address autocomplete to this country when set.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS country_code VARCHAR(2) NULL;

-- 24_companies_region_code.sql
-- Province/state for company address context (CA/US only in app); drives Photon bias + ranking.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS region_code VARCHAR(8) NULL;

-- 25_status_estimate_backfill_builtin_kind_by_name.sql
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

-- 26_status_estimate_builtin_kind_add_new.sql
-- Fourth built-in workflow label: `new` (e.g. display name "New Estimate"), distinct from `pending`.
-- Application seeds this per company; optional backfill in `25_*.sql` (re-run after this if needed).
BEGIN;
ALTER TABLE status_estimate DROP CONSTRAINT IF EXISTS ck_status_estimate_builtin_kind;
ALTER TABLE status_estimate ADD CONSTRAINT ck_status_estimate_builtin_kind
  CHECK (
    builtin_kind IS NULL
    OR builtin_kind IN ('new', 'pending', 'converted', 'cancelled')
  );
COMMIT;

-- 27_global_status_tables_and_matrix.sql
-- Global `status_estimate` / `status_order` (no company_id) + per-company matrix tables.
-- Run after **26_status_estimate_builtin_kind_add_new.sql**. Migrates tenant-scoped legacy rows.
-- Fixed global ids (md5 first 16 hex): see `global_status_seed.py` in backend.
BEGIN;
-- ---- Drop dependent FKs ----
ALTER TABLE estimate DROP CONSTRAINT IF EXISTS fk_estimate_status_estimate;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS fk_orders_status_order;
-- ---- RLS: drop policies before rename ----
ALTER TABLE IF EXISTS status_estimate RENAME TO status_estimate_legacy;
ALTER TABLE IF EXISTS status_order RENAME TO status_order_legacy;
-- ---- New global catalog tables ----
CREATE TABLE status_estimate (
  id           VARCHAR(16) PRIMARY KEY,
  name         TEXT        NOT NULL,
  active       TINYINT(1)     NOT NULL DEFAULT 1,
  sort_order   INTEGER     NOT NULL DEFAULT 0,
  builtin_kind TEXT        NULL,
  CONSTRAINT ck_status_estimate_builtin_kind_global CHECK (
    builtin_kind IS NULL
    OR builtin_kind IN ('new', 'pending', 'converted', 'cancelled')
  )
);
CREATE UNIQUE INDEX uq_status_estimate_global_builtin_nn
  ON status_estimate (builtin_kind)
  WHERE builtin_kind IS NOT NULL;
CREATE INDEX idx_status_estimate_global_active
  ON status_estimate (active) WHERE active = 1;
CREATE TABLE status_order (
  id           VARCHAR(16) PRIMARY KEY,
  name         TEXT        NOT NULL,
  active       TINYINT(1)     NOT NULL DEFAULT 1,
  sort_order   INTEGER     NOT NULL DEFAULT 0,
  builtin_kind TEXT        NULL,
  CONSTRAINT ck_status_order_builtin_kind_global CHECK (
    builtin_kind IS NULL
    OR builtin_kind IN ('new', 'ready_for_install', 'in_production', 'done')
  )
);
CREATE INDEX idx_status_order_global_active
  ON status_order (active) WHERE active = 1;
CREATE UNIQUE INDEX uq_status_order_global_builtin_nn
  ON status_order (builtin_kind)
  WHERE builtin_kind IS NOT NULL;
CREATE TABLE company_status_estimate_matrix (
  company_id          CHAR(36)        NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  status_estimate_id  VARCHAR(16) NOT NULL REFERENCES status_estimate (id) ON UPDATE CASCADE ON DELETE CASCADE,
  PRIMARY KEY (company_id, status_estimate_id)
);
CREATE TABLE company_status_order_matrix (
  company_id        CHAR(36)        NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  status_order_id   VARCHAR(16) NOT NULL REFERENCES status_order (id) ON UPDATE CASCADE ON DELETE CASCADE,
  PRIMARY KEY (company_id, status_order_id)
);
-- ---- Seed built-in estimate statuses (global ids) ----
INSERT INTO status_estimate (id, name, active, sort_order, builtin_kind)
SELECT substring(md5((UUID())) for 16), 'New Estimate', 1, -1, 'new'
WHERE NOT EXISTS (SELECT 1 FROM status_estimate se WHERE se.builtin_kind = 'new');
INSERT INTO status_estimate (id, name, active, sort_order, builtin_kind)
SELECT substring(md5((UUID())) for 16), 'Pending', 1, 0, 'pending'
WHERE NOT EXISTS (SELECT 1 FROM status_estimate se WHERE se.builtin_kind = 'pending');
INSERT INTO status_estimate (id, name, active, sort_order, builtin_kind)
SELECT substring(md5((UUID())) for 16), 'Converted to order', 1, 1, 'converted'
WHERE NOT EXISTS (SELECT 1 FROM status_estimate se WHERE se.builtin_kind = 'converted');
INSERT INTO status_estimate (id, name, active, sort_order, builtin_kind)
SELECT substring(md5((UUID())) for 16), 'Cancelled', 1, 2, 'cancelled'
WHERE NOT EXISTS (SELECT 1 FROM status_estimate se WHERE se.builtin_kind = 'cancelled');

-- ---- Seed built-in order status (New order) ----
INSERT INTO status_order (id, name, active, sort_order, builtin_kind)
SELECT substring(md5((UUID())) for 16), 'New order', 1, 0, 'new'
WHERE NOT EXISTS (SELECT 1 FROM status_order so WHERE so.builtin_kind = 'new');
-- ---- Custom global estimate rows from legacy (NULL builtin_kind), one row per distinct name ----
INSERT INTO status_estimate (id, name, active, sort_order, builtin_kind)
SELECT
  substring(md5('global:est:custom:' || lower(trim(name))), 1, 16) AS id,
  max(trim(name)) AS name,
  MAX(active) AS active,
  min(sort_order)::int AS sort_order,
  NULL AS builtin_kind
FROM status_estimate_legacy
WHERE builtin_kind IS NULL
GROUP BY lower(trim(name))
;
-- ---- Map legacy estimate status -> global id ----
SELECT
  l.company_id,
  l.id AS old_id,
  COALESCE(
    CASE l.builtin_kind
      WHEN 'new' THEN (SELECT se.id FROM status_estimate se WHERE se.builtin_kind = 'new' LIMIT 1)
      WHEN 'pending' THEN (SELECT se.id FROM status_estimate se WHERE se.builtin_kind = 'pending' LIMIT 1)
      WHEN 'converted' THEN (SELECT se.id FROM status_estimate se WHERE se.builtin_kind = 'converted' LIMIT 1)
      WHEN 'cancelled' THEN (SELECT se.id FROM status_estimate se WHERE se.builtin_kind = 'cancelled' LIMIT 1)
    END,
    substring(md5('global:est:custom:' || lower(trim(l.name))), 1, 16)
  ) AS new_id
FROM status_estimate_legacy l;
UPDATE estimate e
SET status_esti_id = m.new_id
FROM tmp_est_map m
WHERE e.company_id = m.company_id AND e.status_esti_id = m.old_id;
UPDATE estimate e
SET status_esti_id = (SELECT se.id FROM status_estimate se WHERE se.builtin_kind = 'pending' LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM status_estimate s WHERE s.id = e.status_esti_id);
INSERT INTO company_status_estimate_matrix (company_id, status_estimate_id)
SELECT DISTINCT company_id, new_id
FROM tmp_est_map
;
-- Enable all built-in estimate statuses for every active company
INSERT INTO company_status_estimate_matrix (company_id, status_estimate_id)
SELECT c.id, s.id
FROM companies c
CROSS JOIN status_estimate s
WHERE c.is_deleted != 1
  AND s.builtin_kind IS NOT NULL
;
-- ---- Order statuses: custom globals from legacy (excluding canonical New order name) ----
INSERT INTO status_order (id, name, active, sort_order, builtin_kind)
SELECT
  substring(md5('global:ord:custom:' || lower(trim(name))), 1, 16) AS id,
  max(trim(name)) AS name,
  MAX(active) AS active,
  min(sort_order)::int AS sort_order,
  NULL AS builtin_kind
FROM status_order_legacy
WHERE lower(trim(name)) <> 'new order'
GROUP BY lower(trim(name))
;
SELECT
  l.company_id,
  l.id AS old_id,
  CASE
    WHEN lower(trim(l.name)) = 'new order' THEN (SELECT so.id FROM status_order so WHERE so.builtin_kind = 'new' LIMIT 1)
    ELSE substring(md5('global:ord:custom:' || lower(trim(l.name))), 1, 16)
  END AS new_id
FROM status_order_legacy l;
UPDATE orders o
SET status_orde_id = m.new_id
FROM tmp_ord_map m
WHERE o.company_id = m.company_id AND o.status_orde_id = m.old_id;
UPDATE orders o
SET status_orde_id = (SELECT so.id FROM status_order so WHERE so.builtin_kind = 'new' LIMIT 1)
WHERE o.status_orde_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM status_order s WHERE s.id = o.status_orde_id);
INSERT INTO company_status_order_matrix (company_id, status_order_id)
SELECT DISTINCT company_id, new_id
FROM tmp_ord_map
;
INSERT INTO company_status_order_matrix (company_id, status_order_id)
SELECT c.id, (SELECT so.id FROM status_order so WHERE so.builtin_kind = 'new' LIMIT 1)
FROM companies c
WHERE c.is_deleted != 1
;
-- ---- Drop legacy ----
DROP TABLE status_estimate_legacy;
DROP TABLE status_order_legacy;
-- ---- FKs (single-column) ----
ALTER TABLE estimate
  ADD CONSTRAINT fk_estimate_status_estimate
  FOREIGN KEY (status_esti_id) REFERENCES status_estimate (id)
  ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE orders
  ADD CONSTRAINT fk_orders_status_order
  FOREIGN KEY (status_orde_id) REFERENCES status_order (id)
  ON UPDATE CASCADE ON DELETE SET NULL;
-- ---- Trigger: mark estimate converted (global converted row) ----
-- ---- RLS: global catalogs (read all; write only bypass) ----
COMMIT;

-- 28_estimate_prospect_line_amount_ready_install_status.sql
-- Prospect-only estimates (no customers row until order save), per-line amounts, global order status "Ready for installation".
-- Run after **27_global_status_tables_and_matrix.sql**.
BEGIN;
ALTER TABLE estimate -- MODIFY COLUMN customer_id (DROP NOT NULL - handle manually);
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS prospect_name TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS prospect_surname TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS prospect_phone TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS prospect_email TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS prospect_address TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS prospect_postal_code TEXT;
ALTER TABLE estimate_blinds ADD COLUMN IF NOT EXISTS line_amount NUMERIC(14, 2);
-- Stable id: md5('global:ord:builtin:ready_for_install') first 16 hex = 4827ac7d03a3c7ae
INSERT INTO status_order (id, name, active, sort_order, builtin_kind)
VALUES ('4827ac7d03a3c7ae', 'Ready for installation', 1, 10, 'ready_for_install')
;
INSERT INTO company_status_order_matrix (company_id, status_order_id)
SELECT c.id, '4827ac7d03a3c7ae'
FROM companies c
WHERE COALESCE(c.is_deleted, 0) != 1
;
COMMIT;

-- 29_lookup_subpage_permissions.sql
-- Granular Lookups submenu permissions (matrix + API). Legacy ``lookups.view`` / ``lookups.edit`` remain
-- for the hub and backward compatibility; routes accept granular OR legacy.
-- Run after app has seeded permissions at least once, or rely on these INSERTs before first deploy.
INSERT INTO permissions (key, name, parent_key, target_type, target_id, action, module_name, sort_index, is_deleted)
VALUES
  ('lookups.blinds_types.view', 'Lookups / Blinds types — view', NULL, 'module', 'lookups', 'access', 'lookups', 124, 0),
  ('lookups.blinds_types.edit', 'Lookups / Blinds types — edit', NULL, 'module', 'lookups', 'access', 'lookups', 125, 0),
  ('lookups.order_statuses.view', 'Lookups / Order statuses — view', NULL, 'module', 'lookups', 'access', 'lookups', 126, 0),
  ('lookups.order_statuses.edit', 'Lookups / Order statuses — edit', NULL, 'module', 'lookups', 'access', 'lookups', 127, 0),
  ('lookups.estimate_statuses.view', 'Lookups / Estimate statuses — view', NULL, 'module', 'lookups', 'access', 'lookups', 128, 0),
  ('lookups.estimate_statuses.edit', 'Lookups / Estimate statuses — edit', NULL, 'module', 'lookups', 'access', 'lookups', 129, 0),
  ('lookups.product_categories.view', 'Lookups / Product categories — view', NULL, 'module', 'lookups', 'access', 'lookups', 130, 0),
  ('lookups.product_categories.edit', 'Lookups / Product categories — edit', NULL, 'module', 'lookups', 'access', 'lookups', 131, 0)
;

-- 32_settings_contract_invoice_permissions.sql
-- Settings → Contract/Invoice permissions (view/edit).
-- Adds new permission rows and grants them to roles that already have Settings access,
-- so existing deployments pick up the new submenu without manual backfills.
INSERT INTO permissions (key, name, parent_key, target_type, target_id, action, module_name, sort_index, is_deleted)
VALUES
  ('settings.contract_invoice.view', 'Settings — Contract / Invoice — view', NULL, 'module', 'settings', 'access', 'settings', 88, 0),
  ('settings.contract_invoice.edit', 'Settings — Contract / Invoice — edit', NULL, 'module', 'settings', 'access', 'settings', 89, 0)
;

-- Grant to any role that can view Settings (keeps existing customizations intact by only inserting missing pairs).
INSERT INTO role_permissions (role_id, permission_id, is_granted, is_deleted)
SELECT
  rp.role_id,
  p_new.id,
  TRUE,
  FALSE
FROM role_permissions rp
JOIN permissions p_settings ON p_settings.id = rp.permission_id AND p_settings.key = 'settings.access.view'
JOIN permissions p_new ON p_new.key IN ('settings.contract_invoice.view', 'settings.contract_invoice.edit')
LEFT JOIN role_permissions exists_rp
  ON exists_rp.role_id = rp.role_id AND exists_rp.permission_id = p_new.id
WHERE rp.is_deleted != 1 AND rp.is_granted = 1
  AND exists_rp.role_id IS NULL;
-- Roles that had broad Lookups view: grant each granular .view
INSERT INTO role_permissions (role_id, permission_id, is_granted, is_deleted)
SELECT rp.role_id, pn.id, 1, FALSE
FROM role_permissions rp
JOIN permissions po ON po.id = rp.permission_id AND po.key = 'lookups.view'
JOIN permissions pn ON pn.key IN (
  'lookups.blinds_types.view',
  'lookups.order_statuses.view',
  'lookups.estimate_statuses.view',
  'lookups.product_categories.view'
)
WHERE rp.is_deleted != 1 AND rp.is_granted = 1
;
-- Same for edit
INSERT INTO role_permissions (role_id, permission_id, is_granted, is_deleted)
SELECT rp.role_id, pn.id, 1, FALSE
FROM role_permissions rp
JOIN permissions po ON po.id = rp.permission_id AND po.key = 'lookups.edit'
JOIN permissions pn ON pn.key IN (
  'lookups.blinds_types.edit',
  'lookups.order_statuses.edit',
  'lookups.estimate_statuses.edit',
  'lookups.product_categories.edit'
)
WHERE rp.is_deleted != 1 AND rp.is_granted = 1
;
-- User overrides: explicit deny on lookups.view → deny all granular views (same role scope)
INSERT INTO user_permissions (user_id, permission_id, role_id, is_granted, is_deleted)
SELECT up.user_id, pn.id, up.role_id, 0, FALSE
FROM user_permissions up
JOIN permissions po ON po.id = up.permission_id AND po.key = 'lookups.view'
JOIN permissions pn ON pn.key IN (
  'lookups.blinds_types.view',
  'lookups.order_statuses.view',
  'lookups.estimate_statuses.view',
  'lookups.product_categories.view'
)
WHERE up.is_deleted != 1 AND up.is_granted != 1
;
INSERT INTO user_permissions (user_id, permission_id, role_id, is_granted, is_deleted)
SELECT up.user_id, pn.id, up.role_id, 0, FALSE
FROM user_permissions up
JOIN permissions po ON po.id = up.permission_id AND po.key = 'lookups.edit'
JOIN permissions pn ON pn.key IN (
  'lookups.blinds_types.edit',
  'lookups.order_statuses.edit',
  'lookups.estimate_statuses.edit',
  'lookups.product_categories.edit'
)
WHERE up.is_deleted != 1 AND up.is_granted != 1
;
-- User overrides: explicit grant on lookups.view → grant granular (so matrix split stays consistent)
INSERT INTO user_permissions (user_id, permission_id, role_id, is_granted, is_deleted)
SELECT up.user_id, pn.id, up.role_id, 1, FALSE
FROM user_permissions up
JOIN permissions po ON po.id = up.permission_id AND po.key = 'lookups.view'
JOIN permissions pn ON pn.key IN (
  'lookups.blinds_types.view',
  'lookups.order_statuses.view',
  'lookups.estimate_statuses.view',
  'lookups.product_categories.view'
)
WHERE up.is_deleted != 1 AND up.is_granted = 1
;
INSERT INTO user_permissions (user_id, permission_id, role_id, is_granted, is_deleted)
SELECT up.user_id, pn.id, up.role_id, 1, FALSE
FROM user_permissions up
JOIN permissions po ON po.id = up.permission_id AND po.key = 'lookups.edit'
JOIN permissions pn ON pn.key IN (
  'lookups.blinds_types.edit',
  'lookups.order_statuses.edit',
  'lookups.estimate_statuses.edit',
  'lookups.product_categories.edit'
)
WHERE up.is_deleted != 1 AND up.is_granted = 1
;

-- Retire removed lookups.blinds_extra_* keys (lifting/cassette options) on databases that already had them.
UPDATE permissions
SET is_deleted = TRUE
WHERE key IN (
  'lookups.blinds_extra_lifting_system.view',
  'lookups.blinds_extra_lifting_system.edit',
  'lookups.blinds_extra_cassette_type.view',
  'lookups.blinds_extra_cassette_type.edit'
)
AND COALESCE(is_deleted, 0) != 1;

-- 31_company_blinds_product_category_matrix.sql
-- Per-company enablement of global product categories (same pattern as company_status_*_matrix).
-- INSERT below adds rows only when blinds_product_category already has active rows (fresh install: empty matrix).
BEGIN;
CREATE TABLE IF NOT EXISTS company_blinds_product_category_matrix (
  company_id    CHAR(36)        NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  category_code VARCHAR(32) NOT NULL REFERENCES blinds_product_category (code) ON UPDATE CASCADE ON DELETE CASCADE,
  PRIMARY KEY (company_id, category_code)
);
CREATE INDEX IF NOT EXISTS idx_company_blinds_product_category_matrix_company
  ON company_blinds_product_category_matrix (company_id);
INSERT INTO company_blinds_product_category_matrix (company_id, category_code)
SELECT c.id, pc.code
FROM companies c
CROSS JOIN blinds_product_category pc
WHERE COALESCE(c.is_deleted, 0) != 1
  AND pc.active = 1
;
COMMIT;

-- 32_global_blinds_type_and_matrix.sql — global blinds_type + company_blinds_type_matrix
-- (copy kept in DB/32_global_blinds_type_and_matrix.sql for standalone runs.)

-- -----------------------------------------------------------------------------
-- Kullanım notları
-- -----------------------------------------------------------------------------
-- • Idempotent çalıştırma: mevcut tablolar atlanır; FK’ler yoksa eklenir.
-- • Bu dosya DB/01..32 ve workflow/status migration’ları (40–45) içeriğini kapsar; yeni şema değişiklikleri için buraya veya ayrı migration ile ekleyin.
-- • Tam blinds şeması için DB/blinds-postgresql.sql; FastAPI create_all ile çift şema oluşturmayın.
-- • Employee/company başvurusu için pending_*_self_registrations tabloları; PUBLIC_REGISTRATION_ENABLED yalnızca POST /auth/register (anında kayıt) anahtarıdır.

-- -----------------------------------------------------------------------------
-- Migration 40 — workflow engine tables + RLS (no global Order workflow transitions seed; configure in Settings).
-- -----------------------------------------------------------------------------

-- Migration 42 — workflow_transitions.soft_delete (eski DB/42_workflow_transitions_soft_delete.sql)

-- Migration 41 — Settings / Order workflow permissions (eski DB/41_permissions_order_workflow.sql)

-- Migration 43 — Estimate workflow: no global seed (company workflow created on first Save in Settings).

-- Migration 44 — Settings / Estimate workflow permissions (eski DB/44_permissions_estimate_workflow.sql)

-- Migration 45 — status_order.builtin_kind backfill (eski DB/45_status_order_builtin_kind.sql)


-- ============================================================================
-- MariaDB Trigger Karşılıkları (Manuel Eklenmesi Gerekir)
-- ============================================================================
-- Aşağıdaki trigger'lar PostgreSQL'den çevrilmiştir.
-- MariaDB syntax'ına göre düzenlenmiştir:

DELIMITER //

-- updated_at trigger (örnek: companies tablosu için)
-- Her tablo için ayrı ayrı oluşturun:
CREATE TRIGGER IF NOT EXISTS tr_companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW
BEGIN
  SET NEW.updated_at = NOW();
END//

CREATE TRIGGER IF NOT EXISTS tr_customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW
BEGIN
  SET NEW.updated_at = NOW();
END//

CREATE TRIGGER IF NOT EXISTS tr_estimate_updated_at
  BEFORE UPDATE ON estimate
  FOR EACH ROW
BEGIN
  SET NEW.updated_at = NOW();
END//

CREATE TRIGGER IF NOT EXISTS tr_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW
BEGIN
  SET NEW.updated_at = NOW();
END//

CREATE TRIGGER IF NOT EXISTS tr_leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW
BEGIN
  SET NEW.updated_at = NOW();
END//

CREATE TRIGGER IF NOT EXISTS tr_order_items_updated_at
  BEFORE UPDATE ON order_items
  FOR EACH ROW
BEGIN
  SET NEW.updated_at = NOW();
END//

CREATE TRIGGER IF NOT EXISTS tr_blinds_type_add_updated_at
  BEFORE UPDATE ON blinds_type_add
  FOR EACH ROW
BEGIN
  SET NEW.updated_at = NOW();
END//

CREATE TRIGGER IF NOT EXISTS tr_company_google_calendar_updated_at
  BEFORE UPDATE ON company_google_calendar
  FOR EACH ROW
BEGIN
  SET NEW.updated_at = NOW();
END//

-- estimate → converted trigger (order oluşturulunca estimate'i converted yap)
CREATE TRIGGER IF NOT EXISTS tr_orders_mark_estimate_converted
  AFTER INSERT ON orders
  FOR EACH ROW
BEGIN
  IF NEW.estimate_id IS NOT NULL AND NEW.estimate_id != '' THEN
    UPDATE estimate
    SET
      status_esti_id = (
        SELECT id FROM status_estimate
        WHERE builtin_kind = 'converted' LIMIT 1
      ),
      updated_at = NOW()
    WHERE company_id = NEW.company_id
      AND id = NEW.estimate_id
      AND (is_deleted IS NULL OR is_deleted = 0);
  END IF;
END//

DELIMITER ;

SET foreign_key_checks = 1;
