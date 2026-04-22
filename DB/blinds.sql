-- blinds.sql — Auth / RBAC + kiracı iskeleti + blinds iş alanı şeması
-- PostgreSQL 13+ (gen_random_uuid).
--
-- Idempotent: Mevcut tablolar korunur; dosyayı tekrar çalıştırmak güvenlidir.
--   psql -U <kullanıcı> -d <veritabanı> -f DB/blinds.sql
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
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR NOT NULL,
  description  TEXT,
  is_deleted   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by   UUID,
  updated_by   UUID,
  CONSTRAINT uq_role_groups_name UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS users (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name              VARCHAR NOT NULL,
  last_name               VARCHAR NOT NULL,
  phone                   VARCHAR NOT NULL,
  password                VARCHAR NOT NULL,
  email                   VARCHAR NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by              UUID REFERENCES users (id),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by              UUID REFERENCES users (id),
  is_deleted              BOOLEAN NOT NULL DEFAULT FALSE,
  last_login              TIMESTAMP WITHOUT TIME ZONE,
  failed_login_attempts   INTEGER NOT NULL DEFAULT 0,
  account_locked_until    TIMESTAMP WITHOUT TIME ZONE,
  is_password_set         BOOLEAN NOT NULL DEFAULT FALSE,
  is_first_login          BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password    BOOLEAN NOT NULL DEFAULT FALSE,
  role_group_id           UUID REFERENCES role_groups (id),
  default_role            UUID,
  photo_url               VARCHAR,
  CONSTRAINT uq_users_email UNIQUE (email),
  CONSTRAINT uq_users_phone UNIQUE (phone)
);

CREATE TABLE IF NOT EXISTS roles (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           VARCHAR NOT NULL,
  description    TEXT,
  is_protected   BOOLEAN NOT NULL DEFAULT FALSE,
  is_deleted     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by     UUID REFERENCES users (id),
  updated_by     UUID REFERENCES users (id),
  role_group_id  UUID REFERENCES role_groups (id),
  CONSTRAINT uq_roles_name UNIQUE (name)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_default_role') THEN
    ALTER TABLE users
      ADD CONSTRAINT fk_users_default_role
      FOREIGN KEY (default_role) REFERENCES roles (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_role_groups_created_by') THEN
    ALTER TABLE role_groups
      ADD CONSTRAINT fk_role_groups_created_by FOREIGN KEY (created_by) REFERENCES users (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_role_groups_updated_by') THEN
    ALTER TABLE role_groups
      ADD CONSTRAINT fk_role_groups_updated_by FOREIGN KEY (updated_by) REFERENCES users (id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS permissions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key          VARCHAR NOT NULL,
  parent_key   VARCHAR,
  name         VARCHAR NOT NULL,
  target_type  VARCHAR NOT NULL,
  target_id    VARCHAR NOT NULL,
  action       VARCHAR NOT NULL,
  module_name  VARCHAR,
  route_path   VARCHAR,
  lookup_key   VARCHAR,
  sort_index   INTEGER NOT NULL DEFAULT 0,
  is_deleted   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ,
  created_by   UUID REFERENCES users (id),
  updated_by   UUID REFERENCES users (id),
  CONSTRAINT uq_permissions_key UNIQUE (key)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id        UUID NOT NULL REFERENCES roles (id),
  permission_id  UUID NOT NULL REFERENCES permissions (id),
  is_granted     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by     UUID REFERENCES users (id),
  updated_by     UUID REFERENCES users (id),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted     BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users (id),
  role_id     UUID REFERENCES roles (id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  UUID REFERENCES users (id),
  updated_by  UUID REFERENCES users (id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted  BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT uq_user_roles_user_role UNIQUE (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS user_permissions (
  user_id        UUID NOT NULL REFERENCES users (id),
  permission_id  UUID NOT NULL REFERENCES permissions (id),
  role_id        UUID NOT NULL REFERENCES roles (id),
  is_granted     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by     UUID REFERENCES users (id),
  updated_by     UUID REFERENCES users (id),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted     BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (user_id, permission_id, role_id)
);

CREATE TABLE IF NOT EXISTS revoked_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token       VARCHAR NOT NULL,
  user_id     UUID REFERENCES users (id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_used     BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT uq_revoked_tokens_token UNIQUE (token)
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users (id),
  ip_address    VARCHAR(45),
  user_agent    VARCHAR,
  success       BOOLEAN NOT NULL DEFAULT FALSE,
  attempted_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_login_attempts_user_ip_time UNIQUE (user_id, ip_address, attempted_at)
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users (id),
  session_token   VARCHAR NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ,
  expires_at      TIMESTAMP,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT uq_user_sessions_token UNIQUE (session_token)
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token        VARCHAR(100) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,
  is_used      BOOLEAN NOT NULL DEFAULT FALSE,
  used_at      TIMESTAMPTZ,
  ip_address   VARCHAR(45),
  user_agent   VARCHAR,
  attempts     INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT uq_password_reset_tokens_token UNIQUE (token)
);

CREATE TABLE IF NOT EXISTS pending_employee_self_registrations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name           VARCHAR NOT NULL,
  last_name            VARCHAR NOT NULL,
  email                VARCHAR NOT NULL,
  phone                VARCHAR NOT NULL,
  password             VARCHAR NOT NULL,
  role_group_id        UUID REFERENCES role_groups (id),
  request_note         TEXT,
  verification_token   VARCHAR NOT NULL,
  token_sent_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_email_verified    BOOLEAN NOT NULL DEFAULT FALSE,
  email_verified_at    TIMESTAMPTZ,
  pending_status       VARCHAR(32) NOT NULL DEFAULT 'EMAIL_NOT_VERIFIED',
  approved_by          UUID REFERENCES users (id),
  approved_at          TIMESTAMPTZ,
  requested_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted           BOOLEAN NOT NULL DEFAULT FALSE
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
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR NOT NULL,
  phone        VARCHAR,
  website      VARCHAR,
  email        VARCHAR,
  address      VARCHAR(2000),
  postal_code  VARCHAR(32),
  maps_url     VARCHAR(2000),
  owner_user_id UUID REFERENCES users (id),
  logo_url     VARCHAR(500),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted   BOOLEAN NOT NULL DEFAULT FALSE
);

-- Eski blinds şeması kaldıysa (slug/active vb.), eksik kolonları tamamla.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS phone VARCHAR;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS website VARCHAR;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS email VARCHAR;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS address VARCHAR(2000);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS postal_code VARCHAR(32);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS maps_url VARCHAR(2000);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS owner_user_id UUID;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_url VARCHAR(500);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS tax_rate_percent NUMERIC(6, 3);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS country_code VARCHAR(2) NULL;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS region_code VARCHAR(8) NULL;

UPDATE companies SET is_deleted = FALSE WHERE is_deleted IS NULL;

-- ############################################################################
-- # Contract / Invoice templates (per company)                                #
-- ############################################################################

CREATE TABLE IF NOT EXISTS company_document_templates (
  company_id   UUID NOT NULL REFERENCES companies (id),
  kind         VARCHAR(64) NOT NULL, -- deposit_contract | final_invoice
  subject      VARCHAR(300) NOT NULL DEFAULT '',
  body_html    TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted   BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT pk_company_document_templates PRIMARY KEY (company_id, kind)
);
ALTER TABLE companies ALTER COLUMN is_deleted SET DEFAULT FALSE;
ALTER TABLE companies ALTER COLUMN is_deleted SET NOT NULL;

-- Eski kurulumlarda tetikleyici varken kolon eksik kalabiliyor.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
UPDATE companies SET updated_at = COALESCE(created_at, NOW()) WHERE updated_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_companies_owner_user_id') THEN
    ALTER TABLE companies
      ADD CONSTRAINT fk_companies_owner_user_id
      FOREIGN KEY (owner_user_id) REFERENCES users (id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_companies_name ON companies (name);
CREATE INDEX IF NOT EXISTS ix_companies_owner_user_id ON companies (owner_user_id);

COMMENT ON TABLE companies IS 'Kiracı firma; iş alanı tabloları company_id ile bağlanır.';

CREATE TABLE IF NOT EXISTS company_members (
  company_id  UUID        NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES users (id) ON UPDATE CASCADE ON DELETE CASCADE,
  role        TEXT        NOT NULL DEFAULT 'member'
              CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  active      BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_company_members_user ON company_members (user_id) WHERE active = TRUE;

COMMENT ON TABLE company_members IS 'Kullanıcının erişebildiği firmalar; user_id = users.id.';

-- ############################################################################
-- # BÖLÜM 2.1 — Blinds iş alanı tabloları (template uyumlu, idempotent)              #
-- ############################################################################

CREATE TABLE IF NOT EXISTS status_user (
  company_id  UUID        NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  id          VARCHAR(16) NOT NULL,
  name        TEXT        NOT NULL,
  active      BOOLEAN     NOT NULL DEFAULT TRUE,
  PRIMARY KEY (company_id, id)
);

CREATE INDEX IF NOT EXISTS idx_status_user_company_active ON status_user (company_id) WHERE active = TRUE;

CREATE TABLE IF NOT EXISTS status_order (
  company_id  UUID        NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  id          VARCHAR(16) NOT NULL,
  name        TEXT        NOT NULL,
  active      BOOLEAN     NOT NULL DEFAULT TRUE,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, id)
);

CREATE INDEX IF NOT EXISTS idx_status_order_company_active ON status_order (company_id) WHERE active = TRUE;

CREATE TABLE IF NOT EXISTS blinds_type (
  company_id  UUID        NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  id          VARCHAR(16) NOT NULL,
  name        TEXT        NOT NULL,
  aciklama    TEXT,
  active      BOOLEAN     NOT NULL DEFAULT TRUE,
  PRIMARY KEY (company_id, id)
);

CREATE INDEX IF NOT EXISTS idx_blinds_type_company_active ON blinds_type (company_id) WHERE active = TRUE;

CREATE TABLE IF NOT EXISTS customers (
  company_id      UUID        NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  id              VARCHAR(16) NOT NULL,
  name            TEXT        NOT NULL,
  surname         TEXT,
  phone           TEXT,
  email           TEXT,
  address         TEXT,
  postal_code     TEXT,
  status_user_id  VARCHAR(16),
  active          BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id),
  CONSTRAINT fk_customers_status_user
    FOREIGN KEY (company_id, status_user_id)
    REFERENCES status_user (company_id, id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_customers_company_active ON customers (company_id) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_customers_company_created ON customers (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customers_company_name ON customers (company_id, name);

CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_company_email
  ON customers (company_id, lower(btrim(email)))
  WHERE email IS NOT NULL AND btrim(email) <> '';

CREATE TABLE IF NOT EXISTS estimate (
  company_id    UUID        NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  id            VARCHAR(16) NOT NULL,
  customer_id   VARCHAR(16) NOT NULL,
  blinds_id     VARCHAR(16),
  perde_sayisi  INTEGER,
  tarih_saat    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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
CREATE INDEX IF NOT EXISTS idx_estimate_company_tarih ON estimate (company_id, tarih_saat DESC NULLS LAST);

-- Many blinds types per estimate (preferred); estimate.blinds_id is optional legacy pointer.
CREATE TABLE IF NOT EXISTS estimate_blinds (
  company_id   UUID        NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
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

ALTER TABLE estimate ALTER COLUMN blinds_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS orders (
  company_id              UUID        NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
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
  blinds_lines            JSONB       NOT NULL DEFAULT '[]'::jsonb,
  order_note              TEXT,
  blinds_type_add_id      VARCHAR(16),
  parent_order_id         VARCHAR(16),
  status_orde_id          VARCHAR(16),
  active                  BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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
  WHERE parent_order_id IS NOT NULL AND active IS TRUE;

CREATE INDEX IF NOT EXISTS idx_orders_company_active ON orders (company_id) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_orders_company_customer ON orders (company_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_company_created ON orders (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_company_status ON orders (company_id, status_orde_id);

CREATE TABLE IF NOT EXISTS order_payment_entries (
  id           UUID         NOT NULL DEFAULT gen_random_uuid(),
  company_id   UUID         NOT NULL,
  order_id     VARCHAR(16)  NOT NULL,
  amount       NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  payment_group_id UUID,
  is_deleted   BOOLEAN      NOT NULL DEFAULT FALSE,
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
  WHERE COALESCE(is_deleted, FALSE) = FALSE;

CREATE INDEX IF NOT EXISTS idx_order_payment_entries_group
  ON order_payment_entries (company_id, payment_group_id, created_at DESC)
  WHERE payment_group_id IS NOT NULL AND COALESCE(is_deleted, FALSE) = FALSE;

CREATE TABLE IF NOT EXISTS order_attachments (
  id                 UUID         NOT NULL DEFAULT gen_random_uuid(),
  company_id         UUID         NOT NULL,
  order_id           VARCHAR(16)  NOT NULL,
  kind               TEXT         NOT NULL CHECK (kind IN ('photo', 'excel')),
  original_filename  TEXT         NOT NULL,
  stored_relpath     TEXT         NOT NULL,
  content_type       TEXT,
  file_size          BIGINT,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  is_deleted         BOOLEAN      NOT NULL DEFAULT FALSE,
  PRIMARY KEY (id),
  CONSTRAINT fk_order_attachments_order
    FOREIGN KEY (company_id, order_id)
    REFERENCES orders (company_id, id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_order_attachments_company_order
  ON order_attachments (company_id, order_id, created_at DESC)
  WHERE COALESCE(is_deleted, FALSE) = FALSE;

CREATE TABLE IF NOT EXISTS blinds_type_add (
  company_id        UUID        NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  id                VARCHAR(16) NOT NULL,
  blinds_type_id    VARCHAR(16) NOT NULL,
  product_category  TEXT        NOT NULL DEFAULT 'classic'
                      CHECK (product_category IN ('classic', 'delux', 'premium')),
  amount            NUMERIC(14, 2),
  number_of_blinds  INTEGER,
  square_meter      NUMERIC(14, 4),
  number_of_motor   INTEGER,
  order_id          VARCHAR(16) NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_orders_blinds_type_add_first') THEN
    ALTER TABLE orders
      ADD CONSTRAINT fk_orders_blinds_type_add_first
      FOREIGN KEY (company_id, blinds_type_add_id)
      REFERENCES blinds_type_add (company_id, id)
      ON UPDATE CASCADE
      ON DELETE SET NULL;
  END IF;
END $$;

-- ############################################################################
-- # BÖLÜM 2.2 — Blinds iş akışı: lead / kalem / ödeme / ekler / calendar sync        #
-- ############################################################################

-- Leads (inquiries)
CREATE TABLE IF NOT EXISTS leads (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  first_name    TEXT,
  last_name     TEXT,
  phone         TEXT,
  email         TEXT,
  address       TEXT,
  source        TEXT,
  note          TEXT,
  status        TEXT NOT NULL DEFAULT 'new'
                CHECK (status IN ('new', 'contacted', 'estimate_scheduled', 'estimated', 'won', 'lost', 'archived')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted    BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_leads_company_created_at ON leads (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_company_status ON leads (company_id, status) WHERE is_deleted = FALSE;

-- Estimate schedule + Google Calendar event mapping (one-way: app -> Google)
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS lead_id UUID;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS scheduled_start_at TIMESTAMPTZ;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS scheduled_end_at TIMESTAMPTZ;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS calendar_provider TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS calendar_id TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS google_event_id TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS calendar_last_synced_at TIMESTAMPTZ;

ALTER TABLE estimate ADD COLUMN IF NOT EXISTS visit_time_zone TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS visit_address TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS visit_postal_code TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS visit_notes TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS visit_organizer_name TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS visit_organizer_email VARCHAR(320);
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS visit_guest_emails JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS visit_recurrence_rrule TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE estimate ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_estimate_status') THEN
    ALTER TABLE estimate
      ADD CONSTRAINT ck_estimate_status
      CHECK (status IN ('pending', 'converted', 'cancelled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_estimate_company_not_deleted
  ON estimate (company_id)
  WHERE is_deleted IS NOT TRUE;

CREATE INDEX IF NOT EXISTS idx_estimate_company_status
  ON estimate (company_id, status)
  WHERE is_deleted IS NOT TRUE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_estimate_lead') THEN
    ALTER TABLE estimate
      ADD CONSTRAINT fk_estimate_lead
      FOREIGN KEY (lead_id) REFERENCES leads (id)
      ON UPDATE CASCADE
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_estimate_company_scheduled_start
  ON estimate (company_id, scheduled_start_at DESC NULLS LAST);

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
  ADD COLUMN IF NOT EXISTS blinds_lines JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(14, 2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_note TEXT;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS installed_at TIMESTAMPTZ;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS installation_scheduled_start_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS installation_scheduled_end_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS installation_calendar_provider TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS installation_calendar_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS installation_google_event_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS installation_calendar_last_synced_at TIMESTAMPTZ;

-- Order items (each order may include multiple models; all items must share same catalog_category)
CREATE TABLE IF NOT EXISTS order_items (
  company_id        UUID        NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          VARCHAR(16) NOT NULL,
  catalog_category  TEXT        NOT NULL CHECK (catalog_category IN ('classic', 'delux', 'premium')),
  model             TEXT        NOT NULL CHECK (model IN ('zebra', 'roller_shade', 'honecomb', 'galaxy', 'curtains')),
  lifting_system    TEXT        NOT NULL CHECK (lifting_system IN ('chain', 'cordless', 'motorized')),
  kasa_type         TEXT        NOT NULL CHECK (kasa_type IN ('square', 'square_curved', 'round')),
  fabric_insert     BOOLEAN     NOT NULL DEFAULT FALSE,
  width_mm          INTEGER,
  height_mm         INTEGER,
  quantity          INTEGER     NOT NULL DEFAULT 1,
  notes             TEXT,
  unit_price        NUMERIC(14, 2),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted        BOOLEAN     NOT NULL DEFAULT FALSE,
  CONSTRAINT fk_order_items_order
    FOREIGN KEY (company_id, order_id)
    REFERENCES orders (company_id, id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_order_items_company_order ON order_items (company_id, order_id);

-- Payments (supports deposit/final; allows future expansion)
CREATE TABLE IF NOT EXISTS order_payments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  order_id      VARCHAR(16) NOT NULL,
  payment_type  TEXT NOT NULL CHECK (payment_type IN ('deposit', 'final', 'other')),
  amount        NUMERIC(14, 2) NOT NULL,
  paid_at       TIMESTAMPTZ,
  method        TEXT,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted    BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT fk_order_payments_order
    FOREIGN KEY (company_id, order_id)
    REFERENCES orders (company_id, id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_order_payments_company_paid_at ON order_payments (company_id, paid_at DESC NULLS LAST);

-- Attachments for lead/estimate/order/installation
CREATE TABLE IF NOT EXISTS attachments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  entity_type   TEXT NOT NULL CHECK (entity_type IN ('lead', 'estimate', 'order', 'installation')),
  entity_id     TEXT NOT NULL,
  media_type    TEXT NOT NULL CHECK (media_type IN ('photo', 'video', 'file')),
  url           TEXT NOT NULL,
  taken_at      TIMESTAMPTZ,
  uploaded_by   UUID REFERENCES users (id) ON DELETE SET NULL,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted    BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_attachments_company_entity ON attachments (company_id, entity_type, entity_id) WHERE is_deleted = FALSE;

-- users.company_id (01 migration)
ALTER TABLE users ADD COLUMN IF NOT EXISTS company_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_company_id') THEN
    ALTER TABLE users
      ADD CONSTRAINT fk_users_company_id
      FOREIGN KEY (company_id) REFERENCES companies (id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_users_company_id ON users (company_id);

-- pending company self-registration (01 migration)
CREATE TABLE IF NOT EXISTS pending_company_self_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name VARCHAR NOT NULL,
  last_name VARCHAR NOT NULL,
  email VARCHAR NOT NULL,
  phone VARCHAR NOT NULL,
  password VARCHAR NOT NULL,
  company_name VARCHAR NOT NULL,
  company_phone VARCHAR,
  website VARCHAR,
  request_note TEXT,
  verification_token VARCHAR NOT NULL,
  token_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  email_verified_at TIMESTAMPTZ,
  pending_status VARCHAR(32) NOT NULL DEFAULT 'EMAIL_NOT_VERIFIED',
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_pending_company_token
  ON pending_company_self_registrations (verification_token)
  WHERE is_deleted = FALSE;

-- user_company_memberships (02 migration) — çoklu şirket üyeliği
CREATE TABLE IF NOT EXISTS user_company_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  company_id UUID NOT NULL REFERENCES companies(id),
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
  company_id          UUID        NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  refresh_token       TEXT        NOT NULL,
  calendar_id         TEXT        NOT NULL DEFAULT 'primary',
  google_account_email TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id)
);

CREATE INDEX IF NOT EXISTS idx_company_google_calendar_company ON company_google_calendar (company_id);

-- ############################################################################
-- # Denetim                                                                          #
-- ############################################################################

CREATE TABLE IF NOT EXISTS user_audit_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  executed_by  UUID REFERENCES users (id) ON DELETE SET NULL,
  action       VARCHAR(50) NOT NULL,
  table_name   VARCHAR(100) NOT NULL,
  table_id     UUID,
  before_data  JSONB,
  after_data   JSONB,
  ip_address   VARCHAR(45),
  user_agent   VARCHAR,
  timestamp    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_audit_user_action_table_time UNIQUE (executed_by, action, table_name, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_user_audit_logs_timestamp ON user_audit_logs (timestamp DESC);

CREATE TABLE IF NOT EXISTS system_audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_name  VARCHAR(100) NOT NULL,
  action        VARCHAR(100) NOT NULL,
  status        VARCHAR(20) NOT NULL,
  details       JSONB,
  executed_by   VARCHAR(100),
  ip_address    VARCHAR(45),
  timestamp     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_system_audit_service_action_time UNIQUE (service_name, action, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_system_audit_logs_timestamp ON system_audit_logs (timestamp DESC);

-- ############################################################################
-- # Tetikleyiciler                                                                   #
-- ############################################################################

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_companies_updated_at ON companies;
CREATE TRIGGER tr_companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- Blinds iş tabloları updated_at
DROP TRIGGER IF EXISTS tr_customers_updated_at ON customers;
CREATE TRIGGER tr_customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

DROP TRIGGER IF EXISTS tr_estimate_updated_at ON estimate;
CREATE TRIGGER tr_estimate_updated_at
  BEFORE UPDATE ON estimate
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

DROP TRIGGER IF EXISTS tr_orders_updated_at ON orders;
CREATE TRIGGER tr_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE OR REPLACE FUNCTION trg_orders_mark_estimate_converted()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.estimate_id IS NOT NULL AND btrim(NEW.estimate_id::text) <> '' THEN
    UPDATE public.estimate
    SET status = 'converted', updated_at = NOW()
    WHERE company_id = NEW.company_id
      AND id = NEW.estimate_id
      AND is_deleted IS NOT TRUE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_orders_mark_estimate_converted ON orders;
CREATE TRIGGER tr_orders_mark_estimate_converted
  AFTER INSERT ON orders
  FOR EACH ROW EXECUTE PROCEDURE trg_orders_mark_estimate_converted();

DROP TRIGGER IF EXISTS tr_blinds_type_add_updated_at ON blinds_type_add;
CREATE TRIGGER tr_blinds_type_add_updated_at
  BEFORE UPDATE ON blinds_type_add
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

DROP TRIGGER IF EXISTS tr_company_google_calendar_updated_at ON company_google_calendar;
CREATE TRIGGER tr_company_google_calendar_updated_at
  BEFORE UPDATE ON company_google_calendar
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- ############################################################################
-- # BÖLÜM 3 — Kiracı RLS (03 migration içerir)                                   #
-- ############################################################################
-- Uygulama GUC: app.rls_bypass, app.tenant_company_id, app.current_user_id

CREATE OR REPLACE FUNCTION public.rls_company_id_allowed(c_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    COALESCE(current_setting('app.rls_bypass', true), '') = '1'
    OR (
      NULLIF(current_setting('app.tenant_company_id', true), '') IS NOT NULL
      AND c_id IS NOT DISTINCT FROM NULLIF(current_setting('app.tenant_company_id', true), '')::uuid
    );
$$;

-- companies
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_companies_isolation ON public.companies;
CREATE POLICY tenant_companies_isolation ON public.companies
  FOR ALL
  USING (public.rls_company_id_allowed(id))
  WITH CHECK (public.rls_company_id_allowed(id));

-- company_members (opsiyonel; tablo varsa)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'company_members'
  ) THEN
    ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.company_members FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_company_members_isolation ON public.company_members;
    CREATE POLICY tenant_company_members_isolation ON public.company_members
      FOR ALL
      USING (
        COALESCE(current_setting('app.rls_bypass', true), '') = '1'
        OR (
          NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
          AND user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
        )
        OR (
          NULLIF(current_setting('app.tenant_company_id', true), '') IS NOT NULL
          AND company_id = NULLIF(current_setting('app.tenant_company_id', true), '')::uuid
          AND active IS TRUE
        )
      )
      WITH CHECK (
        COALESCE(current_setting('app.rls_bypass', true), '') = '1'
        OR (
          NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
          AND user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
        )
        OR (
          NULLIF(current_setting('app.tenant_company_id', true), '') IS NOT NULL
          AND company_id = NULLIF(current_setting('app.tenant_company_id', true), '')::uuid
        )
      );
  END IF;
END $$;

-- user_company_memberships (opsiyonel; tablo varsa)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_company_memberships'
  ) THEN
    ALTER TABLE public.user_company_memberships ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.user_company_memberships FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_ucm_isolation ON public.user_company_memberships;
    CREATE POLICY tenant_ucm_isolation ON public.user_company_memberships
      FOR ALL
      USING (
        COALESCE(current_setting('app.rls_bypass', true), '') = '1'
        OR (
          NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
          AND user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
        )
        OR (
          NULLIF(current_setting('app.tenant_company_id', true), '') IS NOT NULL
          AND company_id = NULLIF(current_setting('app.tenant_company_id', true), '')::uuid
          AND is_deleted IS NOT TRUE
        )
      )
      WITH CHECK (
        COALESCE(current_setting('app.rls_bypass', true), '') = '1'
        OR (
          NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
          AND user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
        )
        OR (
          NULLIF(current_setting('app.tenant_company_id', true), '') IS NOT NULL
          AND company_id = NULLIF(current_setting('app.tenant_company_id', true), '')::uuid
        )
      );
  END IF;
END $$;

-- users
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_users_select ON public.users;
DROP POLICY IF EXISTS tenant_users_insert ON public.users;
DROP POLICY IF EXISTS tenant_users_update ON public.users;
DROP POLICY IF EXISTS tenant_users_delete ON public.users;

DO $$
DECLARE
  has_ucm boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_company_memberships'
  ) INTO has_ucm;

  IF has_ucm THEN
    EXECUTE $p$
      CREATE POLICY tenant_users_select ON public.users
      FOR SELECT
      USING (
        COALESCE(current_setting('app.rls_bypass', true), '') = '1'
        OR (
          NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
          AND id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
        )
        OR (
          NULLIF(current_setting('app.tenant_company_id', true), '') IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.user_company_memberships m
            WHERE m.user_id = users.id
              AND m.is_deleted IS NOT TRUE
              AND m.company_id = NULLIF(current_setting('app.tenant_company_id', true), '')::uuid
          )
        )
      )
    $p$;
    EXECUTE $p$
      CREATE POLICY tenant_users_update ON public.users
      FOR UPDATE
      USING (
        COALESCE(current_setting('app.rls_bypass', true), '') = '1'
        OR (
          NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
          AND id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
        )
        OR (
          NULLIF(current_setting('app.tenant_company_id', true), '') IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.user_company_memberships m
            WHERE m.user_id = users.id
              AND m.is_deleted IS NOT TRUE
              AND m.company_id = NULLIF(current_setting('app.tenant_company_id', true), '')::uuid
          )
        )
      )
      WITH CHECK (
        COALESCE(current_setting('app.rls_bypass', true), '') = '1'
        OR (
          NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
          AND id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
        )
        OR company_id IS NULL
        OR (
          NULLIF(current_setting('app.tenant_company_id', true), '') IS NOT NULL
          AND company_id = NULLIF(current_setting('app.tenant_company_id', true), '')::uuid
        )
      )
    $p$;
  ELSE
    EXECUTE $p$
      CREATE POLICY tenant_users_select ON public.users
      FOR SELECT
      USING (
        COALESCE(current_setting('app.rls_bypass', true), '') = '1'
        OR (
          NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
          AND id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
        )
        OR (
          NULLIF(current_setting('app.tenant_company_id', true), '') IS NOT NULL
          AND users.company_id IS NOT NULL
          AND users.company_id = NULLIF(current_setting('app.tenant_company_id', true), '')::uuid
        )
      )
    $p$;
    EXECUTE $p$
      CREATE POLICY tenant_users_update ON public.users
      FOR UPDATE
      USING (
        COALESCE(current_setting('app.rls_bypass', true), '') = '1'
        OR (
          NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
          AND id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
        )
        OR (
          NULLIF(current_setting('app.tenant_company_id', true), '') IS NOT NULL
          AND users.company_id IS NOT NULL
          AND users.company_id = NULLIF(current_setting('app.tenant_company_id', true), '')::uuid
        )
      )
      WITH CHECK (
        COALESCE(current_setting('app.rls_bypass', true), '') = '1'
        OR (
          NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
          AND id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
        )
        OR company_id IS NULL
        OR (
          NULLIF(current_setting('app.tenant_company_id', true), '') IS NOT NULL
          AND company_id = NULLIF(current_setting('app.tenant_company_id', true), '')::uuid
        )
      )
    $p$;
  END IF;
END $$;

CREATE POLICY tenant_users_insert ON public.users
  FOR INSERT
  WITH CHECK (
    COALESCE(current_setting('app.rls_bypass', true), '') = '1'
    OR company_id IS NULL
    OR (
      NULLIF(current_setting('app.tenant_company_id', true), '') IS NOT NULL
      AND company_id = NULLIF(current_setting('app.tenant_company_id', true), '')::uuid
    )
  );

CREATE POLICY tenant_users_delete ON public.users
  FOR DELETE
  USING (
    COALESCE(current_setting('app.rls_bypass', true), '') = '1'
  );

-- Blinds iş alanı tabloları (company_id bazlı tenant izolasyonu)
DO $$
BEGIN
  -- status_user
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'status_user') THEN
    ALTER TABLE public.status_user ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.status_user FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_status_user_isolation ON public.status_user;
    CREATE POLICY tenant_status_user_isolation ON public.status_user
      FOR ALL
      USING (public.rls_company_id_allowed(company_id))
      WITH CHECK (public.rls_company_id_allowed(company_id));
  END IF;

  -- status_order
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'status_order') THEN
    ALTER TABLE public.status_order ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.status_order FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_status_order_isolation ON public.status_order;
    CREATE POLICY tenant_status_order_isolation ON public.status_order
      FOR ALL
      USING (public.rls_company_id_allowed(company_id))
      WITH CHECK (public.rls_company_id_allowed(company_id));
  END IF;

  -- blinds_type (legacy tenant table OR global catalog after migration 32)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'blinds_type') THEN
    ALTER TABLE public.blinds_type ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.blinds_type FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_blinds_type_isolation ON public.blinds_type;
    DROP POLICY IF EXISTS blinds_type_select_authenticated ON public.blinds_type;
    DROP POLICY IF EXISTS blinds_type_ins_bypass ON public.blinds_type;
    DROP POLICY IF EXISTS blinds_type_upd_bypass ON public.blinds_type;
    DROP POLICY IF EXISTS blinds_type_del_bypass ON public.blinds_type;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'blinds_type' AND column_name = 'company_id'
    ) THEN
      CREATE POLICY tenant_blinds_type_isolation ON public.blinds_type
        FOR ALL
        USING (public.rls_company_id_allowed(company_id))
        WITH CHECK (public.rls_company_id_allowed(company_id));
    ELSE
      CREATE POLICY blinds_type_select_authenticated ON public.blinds_type
        FOR SELECT USING (true);
      CREATE POLICY blinds_type_ins_bypass ON public.blinds_type
        FOR INSERT
        WITH CHECK (COALESCE(current_setting('app.rls_bypass', true), '') = '1');
      CREATE POLICY blinds_type_upd_bypass ON public.blinds_type
        FOR UPDATE
        USING (COALESCE(current_setting('app.rls_bypass', true), '') = '1')
        WITH CHECK (COALESCE(current_setting('app.rls_bypass', true), '') = '1');
      CREATE POLICY blinds_type_del_bypass ON public.blinds_type
        FOR DELETE
        USING (COALESCE(current_setting('app.rls_bypass', true), '') = '1');
    END IF;
  END IF;

  -- customers
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'customers') THEN
    ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.customers FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_customers_isolation ON public.customers;
    CREATE POLICY tenant_customers_isolation ON public.customers
      FOR ALL
      USING (public.rls_company_id_allowed(company_id))
      WITH CHECK (public.rls_company_id_allowed(company_id));
  END IF;

  -- estimate
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'estimate') THEN
    ALTER TABLE public.estimate ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.estimate FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_estimate_isolation ON public.estimate;
    CREATE POLICY tenant_estimate_isolation ON public.estimate
      FOR ALL
      USING (public.rls_company_id_allowed(company_id))
      WITH CHECK (public.rls_company_id_allowed(company_id));
  END IF;

  -- estimate_blinds (types on an estimate)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'estimate_blinds') THEN
    ALTER TABLE public.estimate_blinds ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.estimate_blinds FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_estimate_blinds_isolation ON public.estimate_blinds;
    CREATE POLICY tenant_estimate_blinds_isolation ON public.estimate_blinds
      FOR ALL
      USING (public.rls_company_id_allowed(company_id))
      WITH CHECK (public.rls_company_id_allowed(company_id));
  END IF;

  -- orders
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'orders') THEN
    ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.orders FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_orders_isolation ON public.orders;
    CREATE POLICY tenant_orders_isolation ON public.orders
      FOR ALL
      USING (public.rls_company_id_allowed(company_id))
      WITH CHECK (public.rls_company_id_allowed(company_id));
  END IF;

  -- order_payment_entries (per recorded payment via API)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'order_payment_entries') THEN
    ALTER TABLE public.order_payment_entries ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.order_payment_entries FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_order_payment_entries_isolation ON public.order_payment_entries;
    CREATE POLICY tenant_order_payment_entries_isolation ON public.order_payment_entries
      FOR ALL
      USING (public.rls_company_id_allowed(company_id))
      WITH CHECK (public.rls_company_id_allowed(company_id));
  END IF;

  -- order_attachments
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'order_attachments') THEN
    ALTER TABLE public.order_attachments ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.order_attachments FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_order_attachments_isolation ON public.order_attachments;
    CREATE POLICY tenant_order_attachments_isolation ON public.order_attachments
      FOR ALL
      USING (public.rls_company_id_allowed(company_id))
      WITH CHECK (public.rls_company_id_allowed(company_id));
  END IF;

  -- blinds_type_add
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'blinds_type_add') THEN
    ALTER TABLE public.blinds_type_add ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.blinds_type_add FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_blinds_type_add_isolation ON public.blinds_type_add;
    CREATE POLICY tenant_blinds_type_add_isolation ON public.blinds_type_add
      FOR ALL
      USING (public.rls_company_id_allowed(company_id))
      WITH CHECK (public.rls_company_id_allowed(company_id));
  END IF;

  -- company_google_calendar
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'company_google_calendar') THEN
    ALTER TABLE public.company_google_calendar ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.company_google_calendar FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_company_google_calendar_isolation ON public.company_google_calendar;
    CREATE POLICY tenant_company_google_calendar_isolation ON public.company_google_calendar
      FOR ALL
      USING (public.rls_company_id_allowed(company_id))
      WITH CHECK (public.rls_company_id_allowed(company_id));
  END IF;
END $$;

COMMIT;

-- -----------------------------------------------------------------------------
-- CONSOLIDATED MIGRATIONS (01 → 29)
-- -----------------------------------------------------------------------------
-- NOTE: These were previously separate `DB/NN_*.sql` files. They are inlined here
-- so a fresh install can run a single script (`DB/blinds.sql`).
--
-- Some blocks use their own BEGIN/COMMIT; they are kept as-is.

-- 01_blinds_flow_core.sql
-- Blinds iş akışı: lead -> estimate (calendar sync) -> order -> installation (calendar sync) -> payments + attachments.
-- İdempotent: tekrar çalıştırmak güvenlidir.
BEGIN;
-- Leads (inquiries)
CREATE TABLE IF NOT EXISTS leads (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  first_name    TEXT,
  last_name     TEXT,
  phone         TEXT,
  email         TEXT,
  address       TEXT,
  source        TEXT,
  note          TEXT,
  status        TEXT NOT NULL DEFAULT 'new'
                CHECK (status IN ('new', 'contacted', 'estimate_scheduled', 'estimated', 'won', 'lost', 'archived')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted    BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_leads_company_created_at ON leads (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_company_status ON leads (company_id, status) WHERE is_deleted = FALSE;

-- Estimate: schedule window + Google Calendar event mapping (one-way: app -> Google)
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS lead_id UUID;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS scheduled_start_at TIMESTAMPTZ;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS scheduled_end_at TIMESTAMPTZ;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS calendar_provider TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS calendar_id TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS google_event_id TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS calendar_last_synced_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_estimate_lead') THEN
    ALTER TABLE estimate
      ADD CONSTRAINT fk_estimate_lead
      FOREIGN KEY (lead_id) REFERENCES leads (id)
      ON UPDATE CASCADE
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_estimate_company_scheduled_start
  ON estimate (company_id, scheduled_start_at DESC NULLS LAST);

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

ALTER TABLE orders ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS installed_at TIMESTAMPTZ;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS installation_scheduled_start_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS installation_scheduled_end_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS installation_calendar_provider TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS installation_calendar_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS installation_google_event_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS installation_calendar_last_synced_at TIMESTAMPTZ;

-- Order items (each order may include multiple models; all items must share same catalog_category)
CREATE TABLE IF NOT EXISTS order_items (
  company_id        UUID        NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          VARCHAR(16) NOT NULL,
  catalog_category  TEXT        NOT NULL CHECK (catalog_category IN ('classic', 'delux', 'premium')),
  model             TEXT        NOT NULL CHECK (model IN ('zebra', 'roller_shade', 'honecomb', 'galaxy', 'curtains')),
  lifting_system    TEXT        NOT NULL CHECK (lifting_system IN ('chain', 'cordless', 'motorized')),
  kasa_type         TEXT        NOT NULL CHECK (kasa_type IN ('square', 'square_curved', 'round')),
  fabric_insert     BOOLEAN     NOT NULL DEFAULT FALSE,
  width_mm          INTEGER,
  height_mm         INTEGER,
  quantity          INTEGER     NOT NULL DEFAULT 1,
  notes             TEXT,
  unit_price        NUMERIC(14, 2),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted        BOOLEAN     NOT NULL DEFAULT FALSE,
  CONSTRAINT fk_order_items_order
    FOREIGN KEY (company_id, order_id)
    REFERENCES orders (company_id, id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_order_items_company_order ON order_items (company_id, order_id);

-- Payments (supports deposit/final; allows future expansion)
CREATE TABLE IF NOT EXISTS order_payments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  order_id      VARCHAR(16) NOT NULL,
  payment_type  TEXT NOT NULL CHECK (payment_type IN ('deposit', 'final', 'other')),
  amount        NUMERIC(14, 2) NOT NULL,
  paid_at       TIMESTAMPTZ,
  method        TEXT,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted    BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT fk_order_payments_order
    FOREIGN KEY (company_id, order_id)
    REFERENCES orders (company_id, id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_order_payments_company_paid_at ON order_payments (company_id, paid_at DESC NULLS LAST);

-- Attachments for estimate/order/installation (one table for all)
CREATE TABLE IF NOT EXISTS attachments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  entity_type   TEXT NOT NULL CHECK (entity_type IN ('lead', 'estimate', 'order', 'installation')),
  entity_id     TEXT NOT NULL,
  media_type    TEXT NOT NULL CHECK (media_type IN ('photo', 'video', 'file')),
  url           TEXT NOT NULL,
  taken_at      TIMESTAMPTZ,
  uploaded_by   UUID REFERENCES users (id) ON DELETE SET NULL,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted    BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_attachments_company_entity ON attachments (company_id, entity_type, entity_id) WHERE is_deleted = FALSE;

-- updated_at triggers (reuse public.set_updated_at() from blinds.sql)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    DROP TRIGGER IF EXISTS tr_leads_updated_at ON leads;
    CREATE TRIGGER tr_leads_updated_at
      BEFORE UPDATE ON leads
      FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

    DROP TRIGGER IF EXISTS tr_order_items_updated_at ON order_items;
    CREATE TRIGGER tr_order_items_updated_at
      BEFORE UPDATE ON order_items
      FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
  END IF;
END $$;
COMMIT;

-- 02_estimate_to_order_link.sql
-- Estimate -> Order dönüşümü için order üzerinde estimate referansı.
-- İdempotent: tekrar çalıştırmak güvenlidir.
BEGIN;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS estimate_id VARCHAR(16);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_orders_estimate') THEN
    ALTER TABLE orders
      ADD CONSTRAINT fk_orders_estimate
      FOREIGN KEY (company_id, estimate_id)
      REFERENCES estimate (company_id, id)
      ON UPDATE CASCADE
      ON DELETE SET NULL;
  END IF;
END $$;
COMMIT;

-- 03_estimate_multi_blinds.sql
-- Bir tahminde birden fazla blinds_type: estimate_blinds ilişki tablosu.
-- estimate.blinds_id isteğe bağlı (eski kayıtlar / geriye dönük uyum).
BEGIN;
CREATE TABLE IF NOT EXISTS estimate_blinds (
  company_id  UUID        NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  estimate_id VARCHAR(16) NOT NULL,
  blinds_id   VARCHAR(16) NOT NULL,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
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
ALTER TABLE estimate ALTER COLUMN blinds_id DROP NOT NULL;
INSERT INTO estimate_blinds (company_id, estimate_id, blinds_id, sort_order)
SELECT e.company_id, e.id, e.blinds_id, 0
FROM estimate e
WHERE e.blinds_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM estimate_blinds x
    WHERE x.company_id = e.company_id
      AND x.estimate_id = e.id
      AND x.blinds_id = e.blinds_id
  );
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'estimate_blinds'
  ) THEN
    ALTER TABLE public.estimate_blinds ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.estimate_blinds FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_estimate_blinds_isolation ON public.estimate_blinds;
    CREATE POLICY tenant_estimate_blinds_isolation ON public.estimate_blinds
      FOR ALL
      USING (public.rls_company_id_allowed(company_id))
      WITH CHECK (public.rls_company_id_allowed(company_id));
  END IF;
END $$;
COMMIT;

-- 04_estimate_blinds_window_count.sql
-- Her estimate_blinds satırında o tip için pencere sayısı (perde_sayisi).
BEGIN;
ALTER TABLE estimate_blinds ADD COLUMN IF NOT EXISTS perde_sayisi INTEGER;
-- Yalnızca bu tahminde tek bir tip satırı varsa header'daki sayıyı o satıra yazar (çoklu tipte yanlış dağıtım olmasın).
UPDATE estimate_blinds eb
SET perde_sayisi = e.perde_sayisi
FROM estimate e
WHERE e.company_id = eb.company_id
  AND e.id = eb.estimate_id
  AND eb.perde_sayisi IS NULL
  AND e.perde_sayisi IS NOT NULL
  AND (
    SELECT COUNT(*)::int
    FROM estimate_blinds x
    WHERE x.company_id = eb.company_id AND x.estimate_id = eb.estimate_id
  ) = 1;
COMMIT;

-- 05_company_google_calendar.sql
-- Şirket başına Google Calendar OAuth refresh token (estimate → Google etkinlik için).
BEGIN;
CREATE TABLE IF NOT EXISTS company_google_calendar (
  company_id          UUID        NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  refresh_token       TEXT        NOT NULL,
  calendar_id         TEXT        NOT NULL DEFAULT 'primary',
  google_account_email TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id)
);
CREATE INDEX IF NOT EXISTS idx_company_google_calendar_company ON company_google_calendar (company_id);
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'company_google_calendar'
  ) THEN
    ALTER TABLE public.company_google_calendar ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.company_google_calendar FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_company_google_calendar_isolation ON public.company_google_calendar;
    CREATE POLICY tenant_company_google_calendar_isolation ON public.company_google_calendar
      FOR ALL
      USING (public.rls_company_id_allowed(company_id))
      WITH CHECK (public.rls_company_id_allowed(company_id));
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'set_updated_at' AND n.nspname = 'public'
  ) THEN
    DROP TRIGGER IF EXISTS tr_company_google_calendar_updated_at ON company_google_calendar;
    CREATE TRIGGER tr_company_google_calendar_updated_at
      BEFORE UPDATE ON company_google_calendar
      FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
  END IF;
END $$;
COMMIT;

-- 06_estimate_visit_calendar_fields.sql
-- Visit / calendar metadata for estimates (organizer, guests, TZ, address, notes, optional recurrence).
BEGIN;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS visit_time_zone TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS visit_address TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS visit_notes TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS visit_organizer_name TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS visit_organizer_email VARCHAR(320);
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS visit_guest_emails JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS visit_recurrence_rrule TEXT;
COMMENT ON COLUMN estimate.visit_time_zone IS 'IANA timezone for calendar display (e.g. Europe/Istanbul).';
COMMENT ON COLUMN estimate.visit_address IS 'Visit location override for calendar; falls back to customer address.';
COMMENT ON COLUMN estimate.visit_postal_code IS 'Optional postal/ZIP code for visit_address; entered manually.';
COMMENT ON COLUMN estimate.visit_notes IS 'User note; Google description also includes customer name and blinds lines.';
COMMENT ON COLUMN estimate.visit_guest_emails IS 'Additional attendee emails (JSON array of strings).';
COMMENT ON COLUMN estimate.visit_recurrence_rrule IS 'Google Calendar RRULE line(s); NULL = does not repeat.';
COMMIT;

-- 07_estimate_soft_delete.sql
-- Soft-delete flag for estimates (list/detail exclude deleted; workspace policy).
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_estimate_company_not_deleted
  ON estimate (company_id)
  WHERE is_deleted IS NOT TRUE;

-- 08_companies_updated_at.sql
-- companies: legacy DBs may lack updated_at while trigger set_updated_at() expects it.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
UPDATE companies SET updated_at = COALESCE(created_at, NOW()) WHERE updated_at IS NULL;

-- 09_estimate_workflow_status.sql
-- Estimate workflow: pending | converted | cancelled + optional order → converted trigger.
BEGIN;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_estimate_status') THEN
    ALTER TABLE estimate
      ADD CONSTRAINT ck_estimate_status
      CHECK (status IN ('pending', 'converted', 'cancelled'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_estimate_company_status
  ON estimate (company_id, status)
  WHERE is_deleted IS NOT TRUE;
-- When an order is created with estimate_id, mark the estimate converted.
CREATE OR REPLACE FUNCTION public.trg_orders_mark_estimate_converted()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.estimate_id IS NOT NULL AND btrim(NEW.estimate_id::text) <> '' THEN
    UPDATE public.estimate
    SET status = 'converted', updated_at = NOW()
    WHERE company_id = NEW.company_id
      AND id = NEW.estimate_id
      AND is_deleted IS NOT TRUE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS tr_orders_mark_estimate_converted ON orders;
CREATE TRIGGER tr_orders_mark_estimate_converted
  AFTER INSERT ON orders
  FOR EACH ROW
  EXECUTE PROCEDURE public.trg_orders_mark_estimate_converted();
COMMIT;

-- 10_orders_blinds_lines.sql
-- Store chosen blinds lines (from estimate or manual) on orders as JSONB.
-- Idempotent: safe to run multiple times.
BEGIN;
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS blinds_lines JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS idx_orders_company_blinds_lines
  ON orders (company_id)
  WHERE active IS TRUE;
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

-- 16_order_payment_entries.sql
-- Record each POST /orders/{id}/record-payment for history (amount + timestamp).
-- Run after existing blinds migrations; idempotent.
CREATE TABLE IF NOT EXISTS order_payment_entries (
  id           UUID         NOT NULL DEFAULT gen_random_uuid(),
  company_id   UUID         NOT NULL,
  order_id     VARCHAR(16)  NOT NULL,
  amount       NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  is_deleted   BOOLEAN      NOT NULL DEFAULT FALSE,
  PRIMARY KEY (id),
  CONSTRAINT fk_order_payment_entries_order
    FOREIGN KEY (company_id, order_id)
    REFERENCES orders (company_id, id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_order_payment_entries_company_order_created
  ON order_payment_entries (company_id, order_id, created_at DESC);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'order_payment_entries') THEN
    ALTER TABLE public.order_payment_entries ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.order_payment_entries FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_order_payment_entries_isolation ON public.order_payment_entries;
    CREATE POLICY tenant_order_payment_entries_isolation ON public.order_payment_entries
      FOR ALL
      USING (public.rls_company_id_allowed(company_id))
      WITH CHECK (public.rls_company_id_allowed(company_id));
  END IF;
END $$;

-- 17_order_payment_entries_soft_delete.sql
-- Soft-delete for payment history lines (DELETE API sets is_deleted; sums exclude deleted rows).
ALTER TABLE order_payment_entries
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_order_payment_entries_active
  ON order_payment_entries (company_id, order_id, created_at DESC)
  WHERE COALESCE(is_deleted, FALSE) = FALSE;

-- 18_order_attachments.sql
-- Order files: photos and spreadsheets; soft-delete via is_deleted.
CREATE TABLE IF NOT EXISTS order_attachments (
  id                 UUID         NOT NULL DEFAULT gen_random_uuid(),
  company_id         UUID         NOT NULL,
  order_id           VARCHAR(16)  NOT NULL,
  kind               TEXT         NOT NULL CHECK (kind IN ('photo', 'excel')),
  original_filename  TEXT         NOT NULL,
  stored_relpath     TEXT         NOT NULL,
  content_type       TEXT,
  file_size          BIGINT,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  is_deleted         BOOLEAN      NOT NULL DEFAULT FALSE,
  PRIMARY KEY (id),
  CONSTRAINT fk_order_attachments_order
    FOREIGN KEY (company_id, order_id)
    REFERENCES orders (company_id, id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_order_attachments_company_order
  ON order_attachments (company_id, order_id, created_at DESC)
  WHERE COALESCE(is_deleted, FALSE) = FALSE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'order_attachments') THEN
    ALTER TABLE public.order_attachments ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.order_attachments FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_order_attachments_isolation ON public.order_attachments;
    CREATE POLICY tenant_order_attachments_isolation ON public.order_attachments
      FOR ALL
      USING (public.rls_company_id_allowed(company_id))
      WITH CHECK (public.rls_company_id_allowed(company_id));
  END IF;
END $$;

-- 19_status_estimate_lookup.sql
-- Estimate workflow labels in tenant lookup table (mirrors status_order pattern).
-- Replaces estimate.status TEXT with estimate.status_esti_id FK; slug keeps filter/trigger semantics.
BEGIN;
CREATE TABLE IF NOT EXISTS status_estimate (
  company_id UUID NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  id VARCHAR(16) NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (company_id, id),
  CONSTRAINT ck_status_estimate_slug CHECK (slug IN ('pending', 'converted', 'cancelled')),
  CONSTRAINT uq_status_estimate_company_slug UNIQUE (company_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_status_estimate_company_active
  ON status_estimate (company_id) WHERE active IS TRUE;
INSERT INTO status_estimate (company_id, id, slug, name, active)
SELECT c.id,
  substring(md5(c.id::text || ':est:' || x.slug), 1, 16),
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
ON CONFLICT (company_id, slug) DO NOTHING;
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
ALTER TABLE estimate ALTER COLUMN status_esti_id SET NOT NULL;
ALTER TABLE estimate DROP CONSTRAINT IF EXISTS fk_estimate_status_estimate;
ALTER TABLE estimate
  ADD CONSTRAINT fk_estimate_status_estimate
  FOREIGN KEY (company_id, status_esti_id)
  REFERENCES status_estimate (company_id, id)
  ON UPDATE CASCADE
  ON DELETE RESTRICT;
CREATE OR REPLACE FUNCTION public.trg_orders_mark_estimate_converted()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.estimate_id IS NOT NULL AND btrim(NEW.estimate_id::text) <> '' THEN
    UPDATE public.estimate
    SET
      status_esti_id = (
        SELECT se.id
        FROM public.status_estimate se
        WHERE se.company_id = NEW.company_id AND se.slug = 'converted'
        LIMIT 1
      ),
      updated_at = NOW()
    WHERE company_id = NEW.company_id
      AND id = NEW.estimate_id
      AND is_deleted IS NOT TRUE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER TABLE public.status_estimate ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.status_estimate FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_status_estimate_isolation ON public.status_estimate;
CREATE POLICY tenant_status_estimate_isolation ON public.status_estimate
  FOR ALL
  USING (public.rls_company_id_allowed(company_id))
  WITH CHECK (public.rls_company_id_allowed(company_id));
COMMIT;

-- 20_status_estimate_custom_rows.sql
-- Allow extra estimate statuses (slug NULL) like custom order labels; keep slug only for built-in workflow rows.
BEGIN;
ALTER TABLE status_estimate DROP CONSTRAINT IF EXISTS ck_status_estimate_slug;
ALTER TABLE status_estimate DROP CONSTRAINT IF EXISTS uq_status_estimate_company_slug;
ALTER TABLE status_estimate ALTER COLUMN slug DROP NOT NULL;
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
CREATE OR REPLACE FUNCTION public.trg_orders_mark_estimate_converted()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.estimate_id IS NOT NULL AND btrim(NEW.estimate_id::text) <> '' THEN
    UPDATE public.estimate
    SET
      status_esti_id = (
        SELECT se.id
        FROM public.status_estimate se
        WHERE se.company_id = NEW.company_id AND se.builtin_kind = 'converted'
        LIMIT 1
      ),
      updated_at = NOW()
    WHERE company_id = NEW.company_id
      AND id = NEW.estimate_id
      AND is_deleted IS NOT TRUE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
COMMIT;

-- 23_companies_country_code.sql
-- ISO 3166-1 alpha-2: restricts Photon address autocomplete to this country when set.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS country_code VARCHAR(2) NULL;
COMMENT ON COLUMN companies.country_code IS 'ISO 3166-1 alpha-2; address suggestions (Photon) filter; NULL = no country filter.';

-- 24_companies_region_code.sql
-- Province/state for company address context (CA/US only in app); drives Photon bias + ranking.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS region_code VARCHAR(8) NULL;
COMMENT ON COLUMN companies.region_code IS 'ISO 3166-2 subdivision code without country prefix (e.g. ON, BC, CA for California when country_code=US). NULL when not set or country not CA/US.';

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
DROP POLICY IF EXISTS tenant_status_estimate_isolation ON public.status_estimate;
DROP POLICY IF EXISTS tenant_status_order_isolation ON public.status_order;
ALTER TABLE IF EXISTS public.status_estimate RENAME TO status_estimate_legacy;
ALTER TABLE IF EXISTS public.status_order RENAME TO status_order_legacy;
-- ---- New global catalog tables ----
CREATE TABLE public.status_estimate (
  id           VARCHAR(16) PRIMARY KEY,
  name         TEXT        NOT NULL,
  active       BOOLEAN     NOT NULL DEFAULT TRUE,
  sort_order   INTEGER     NOT NULL DEFAULT 0,
  builtin_kind TEXT        NULL,
  CONSTRAINT ck_status_estimate_builtin_kind_global CHECK (
    builtin_kind IS NULL
    OR builtin_kind IN ('new', 'pending', 'converted', 'cancelled')
  )
);
CREATE UNIQUE INDEX uq_status_estimate_global_builtin_nn
  ON public.status_estimate (builtin_kind)
  WHERE builtin_kind IS NOT NULL;
CREATE INDEX idx_status_estimate_global_active
  ON public.status_estimate (active) WHERE active IS TRUE;
CREATE TABLE public.status_order (
  id           VARCHAR(16) PRIMARY KEY,
  name         TEXT        NOT NULL,
  active       BOOLEAN     NOT NULL DEFAULT TRUE,
  sort_order   INTEGER     NOT NULL DEFAULT 0
);
CREATE INDEX idx_status_order_global_active
  ON public.status_order (active) WHERE active IS TRUE;
CREATE TABLE public.company_status_estimate_matrix (
  company_id          UUID        NOT NULL REFERENCES public.companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  status_estimate_id  VARCHAR(16) NOT NULL REFERENCES public.status_estimate (id) ON UPDATE CASCADE ON DELETE CASCADE,
  PRIMARY KEY (company_id, status_estimate_id)
);
CREATE TABLE public.company_status_order_matrix (
  company_id        UUID        NOT NULL REFERENCES public.companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  status_order_id   VARCHAR(16) NOT NULL REFERENCES public.status_order (id) ON UPDATE CASCADE ON DELETE CASCADE,
  PRIMARY KEY (company_id, status_order_id)
);
-- ---- Seed built-in estimate statuses (global ids) ----
INSERT INTO public.status_estimate (id, name, active, sort_order, builtin_kind) VALUES
  ('86de9fe2784b1d0e', 'New Estimate', TRUE, -1, 'new'),
  ('c9dacb6c04910d38', 'Pending', TRUE, 0, 'pending'),
  ('d75df7e9d38dce9a', 'Converted to order', TRUE, 1, 'converted'),
  ('c840548f67545846', 'Cancelled', TRUE, 2, 'cancelled');
INSERT INTO public.status_order (id, name, active, sort_order) VALUES
  ('88efe5e3d3512afe', 'New order', TRUE, 0);
-- ---- Custom global estimate rows from legacy (NULL builtin_kind), one row per distinct name ----
INSERT INTO public.status_estimate (id, name, active, sort_order, builtin_kind)
SELECT
  substring(md5('global:est:custom:' || lower(trim(name)))::text, 1, 16) AS id,
  max(trim(name)) AS name,
  bool_or(active) AS active,
  min(sort_order)::int AS sort_order,
  NULL::text AS builtin_kind
FROM public.status_estimate_legacy
WHERE builtin_kind IS NULL
GROUP BY lower(trim(name))
ON CONFLICT (id) DO NOTHING;
-- ---- Map legacy estimate status -> global id ----
CREATE TEMP TABLE tmp_est_map AS
SELECT
  l.company_id,
  l.id AS old_id,
  COALESCE(
    CASE l.builtin_kind
      WHEN 'new' THEN '86de9fe2784b1d0e'
      WHEN 'pending' THEN 'c9dacb6c04910d38'
      WHEN 'converted' THEN 'd75df7e9d38dce9a'
      WHEN 'cancelled' THEN 'c840548f67545846'
    END,
    substring(md5('global:est:custom:' || lower(trim(l.name)))::text, 1, 16)
  ) AS new_id
FROM public.status_estimate_legacy l;
UPDATE public.estimate e
SET status_esti_id = m.new_id
FROM tmp_est_map m
WHERE e.company_id = m.company_id AND e.status_esti_id = m.old_id;
UPDATE public.estimate e
SET status_esti_id = 'c9dacb6c04910d38'
WHERE NOT EXISTS (SELECT 1 FROM public.status_estimate s WHERE s.id = e.status_esti_id);
INSERT INTO public.company_status_estimate_matrix (company_id, status_estimate_id)
SELECT DISTINCT company_id, new_id
FROM tmp_est_map
ON CONFLICT (company_id, status_estimate_id) DO NOTHING;
-- Enable all built-in estimate statuses for every active company
INSERT INTO public.company_status_estimate_matrix (company_id, status_estimate_id)
SELECT c.id, s.id
FROM public.companies c
CROSS JOIN public.status_estimate s
WHERE c.is_deleted IS NOT TRUE
  AND s.builtin_kind IS NOT NULL
ON CONFLICT (company_id, status_estimate_id) DO NOTHING;
-- ---- Order statuses: custom globals from legacy (excluding canonical New order name) ----
INSERT INTO public.status_order (id, name, active, sort_order)
SELECT
  substring(md5('global:ord:custom:' || lower(trim(name)))::text, 1, 16) AS id,
  max(trim(name)) AS name,
  bool_or(active) AS active,
  min(sort_order)::int AS sort_order
FROM public.status_order_legacy
WHERE lower(trim(name)) <> 'new order'
GROUP BY lower(trim(name))
ON CONFLICT (id) DO NOTHING;
CREATE TEMP TABLE tmp_ord_map AS
SELECT
  l.company_id,
  l.id AS old_id,
  CASE
    WHEN lower(trim(l.name)) = 'new order' THEN '88efe5e3d3512afe'
    ELSE substring(md5('global:ord:custom:' || lower(trim(l.name)))::text, 1, 16)
  END AS new_id
FROM public.status_order_legacy l;
UPDATE public.orders o
SET status_orde_id = m.new_id
FROM tmp_ord_map m
WHERE o.company_id = m.company_id AND o.status_orde_id = m.old_id;
UPDATE public.orders o
SET status_orde_id = '88efe5e3d3512afe'
WHERE o.status_orde_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.status_order s WHERE s.id = o.status_orde_id);
INSERT INTO public.company_status_order_matrix (company_id, status_order_id)
SELECT DISTINCT company_id, new_id
FROM tmp_ord_map
ON CONFLICT (company_id, status_order_id) DO NOTHING;
INSERT INTO public.company_status_order_matrix (company_id, status_order_id)
SELECT c.id, '88efe5e3d3512afe'
FROM public.companies c
WHERE c.is_deleted IS NOT TRUE
ON CONFLICT (company_id, status_order_id) DO NOTHING;
-- ---- Drop legacy ----
DROP TABLE public.status_estimate_legacy;
DROP TABLE public.status_order_legacy;
-- ---- FKs (single-column) ----
ALTER TABLE public.estimate
  ADD CONSTRAINT fk_estimate_status_estimate
  FOREIGN KEY (status_esti_id) REFERENCES public.status_estimate (id)
  ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE public.orders
  ADD CONSTRAINT fk_orders_status_order
  FOREIGN KEY (status_orde_id) REFERENCES public.status_order (id)
  ON UPDATE CASCADE ON DELETE SET NULL;
-- ---- Trigger: mark estimate converted (global converted row) ----
CREATE OR REPLACE FUNCTION public.trg_orders_mark_estimate_converted()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.estimate_id IS NOT NULL AND btrim(NEW.estimate_id::text) <> '' THEN
    UPDATE public.estimate
    SET
      status_esti_id = (
        SELECT se.id
        FROM public.status_estimate se
        WHERE se.builtin_kind = 'converted'
        LIMIT 1
      ),
      updated_at = NOW()
    WHERE company_id = NEW.company_id
      AND id = NEW.estimate_id
      AND is_deleted IS NOT TRUE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- ---- RLS: global catalogs (read all; write only bypass) ----
ALTER TABLE public.status_estimate ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.status_estimate FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS status_estimate_select_authenticated ON public.status_estimate;
CREATE POLICY status_estimate_select_authenticated ON public.status_estimate
  FOR SELECT USING (true);
DROP POLICY IF EXISTS status_estimate_ins_bypass ON public.status_estimate;
CREATE POLICY status_estimate_ins_bypass ON public.status_estimate
  FOR INSERT
  WITH CHECK (COALESCE(current_setting('app.rls_bypass', true), '') = '1');
DROP POLICY IF EXISTS status_estimate_upd_bypass ON public.status_estimate;
CREATE POLICY status_estimate_upd_bypass ON public.status_estimate
  FOR UPDATE
  USING (COALESCE(current_setting('app.rls_bypass', true), '') = '1')
  WITH CHECK (COALESCE(current_setting('app.rls_bypass', true), '') = '1');
DROP POLICY IF EXISTS status_estimate_del_bypass ON public.status_estimate;
CREATE POLICY status_estimate_del_bypass ON public.status_estimate
  FOR DELETE
  USING (COALESCE(current_setting('app.rls_bypass', true), '') = '1');
ALTER TABLE public.status_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.status_order FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS status_order_select_authenticated ON public.status_order;
CREATE POLICY status_order_select_authenticated ON public.status_order
  FOR SELECT USING (true);
DROP POLICY IF EXISTS status_order_ins_bypass ON public.status_order;
CREATE POLICY status_order_ins_bypass ON public.status_order
  FOR INSERT
  WITH CHECK (COALESCE(current_setting('app.rls_bypass', true), '') = '1');
DROP POLICY IF EXISTS status_order_upd_bypass ON public.status_order;
CREATE POLICY status_order_upd_bypass ON public.status_order
  FOR UPDATE
  USING (COALESCE(current_setting('app.rls_bypass', true), '') = '1')
  WITH CHECK (COALESCE(current_setting('app.rls_bypass', true), '') = '1');
DROP POLICY IF EXISTS status_order_del_bypass ON public.status_order;
CREATE POLICY status_order_del_bypass ON public.status_order
  FOR DELETE
  USING (COALESCE(current_setting('app.rls_bypass', true), '') = '1');
ALTER TABLE public.company_status_estimate_matrix ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_status_estimate_matrix FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_company_status_estimate_matrix ON public.company_status_estimate_matrix;
CREATE POLICY tenant_company_status_estimate_matrix ON public.company_status_estimate_matrix
  FOR ALL
  USING (public.rls_company_id_allowed(company_id))
  WITH CHECK (public.rls_company_id_allowed(company_id));
ALTER TABLE public.company_status_order_matrix ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_status_order_matrix FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_company_status_order_matrix ON public.company_status_order_matrix;
CREATE POLICY tenant_company_status_order_matrix ON public.company_status_order_matrix
  FOR ALL
  USING (public.rls_company_id_allowed(company_id))
  WITH CHECK (public.rls_company_id_allowed(company_id));
COMMIT;

-- 28_estimate_prospect_line_amount_ready_install_status.sql
-- Prospect-only estimates (no customers row until order save), per-line amounts, global order status "Ready for installation".
-- Run after **27_global_status_tables_and_matrix.sql**.
BEGIN;
ALTER TABLE estimate ALTER COLUMN customer_id DROP NOT NULL;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS prospect_name TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS prospect_surname TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS prospect_phone TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS prospect_email TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS prospect_address TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS prospect_postal_code TEXT;
ALTER TABLE estimate_blinds ADD COLUMN IF NOT EXISTS line_amount NUMERIC(14, 2);
-- Stable id: md5('global:ord:builtin:ready_for_install') first 16 hex = 4827ac7d03a3c7ae
INSERT INTO public.status_order (id, name, active, sort_order)
VALUES ('4827ac7d03a3c7ae', 'Ready for installation', TRUE, 10)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.company_status_order_matrix (company_id, status_order_id)
SELECT c.id, '4827ac7d03a3c7ae'
FROM public.companies c
WHERE COALESCE(c.is_deleted, FALSE) IS NOT TRUE
ON CONFLICT (company_id, status_order_id) DO NOTHING;
COMMIT;

-- 29_lookup_subpage_permissions.sql
-- Granular Lookups submenu permissions (matrix + API). Legacy ``lookups.view`` / ``lookups.edit`` remain
-- for the hub and backward compatibility; routes accept granular OR legacy.
-- Run after app has seeded permissions at least once, or rely on these INSERTs before first deploy.
INSERT INTO permissions (key, name, parent_key, target_type, target_id, action, module_name, sort_index, is_deleted)
VALUES
  ('lookups.blinds_types.view', 'Lookups / Blinds types — view', NULL, 'module', 'lookups', 'access', 'lookups', 124, FALSE),
  ('lookups.blinds_types.edit', 'Lookups / Blinds types — edit', NULL, 'module', 'lookups', 'access', 'lookups', 125, FALSE),
  ('lookups.order_statuses.view', 'Lookups / Order statuses — view', NULL, 'module', 'lookups', 'access', 'lookups', 126, FALSE),
  ('lookups.order_statuses.edit', 'Lookups / Order statuses — edit', NULL, 'module', 'lookups', 'access', 'lookups', 127, FALSE),
  ('lookups.estimate_statuses.view', 'Lookups / Estimate statuses — view', NULL, 'module', 'lookups', 'access', 'lookups', 128, FALSE),
  ('lookups.estimate_statuses.edit', 'Lookups / Estimate statuses — edit', NULL, 'module', 'lookups', 'access', 'lookups', 129, FALSE),
  ('lookups.product_categories.view', 'Lookups / Product categories — view', NULL, 'module', 'lookups', 'access', 'lookups', 130, FALSE),
  ('lookups.product_categories.edit', 'Lookups / Product categories — edit', NULL, 'module', 'lookups', 'access', 'lookups', 131, FALSE),
  ('lookups.blinds_extra_lifting_system.view', 'Lookups / Lifting system options — view', NULL, 'module', 'lookups', 'access', 'lookups', 132, FALSE),
  ('lookups.blinds_extra_lifting_system.edit', 'Lookups / Lifting system options — edit', NULL, 'module', 'lookups', 'access', 'lookups', 133, FALSE),
  ('lookups.blinds_extra_cassette_type.view', 'Lookups / Cassette type options — view', NULL, 'module', 'lookups', 'access', 'lookups', 134, FALSE),
  ('lookups.blinds_extra_cassette_type.edit', 'Lookups / Cassette type options — edit', NULL, 'module', 'lookups', 'access', 'lookups', 135, FALSE)
ON CONFLICT (key) DO NOTHING;
-- Roles that had broad Lookups view: grant each granular .view
INSERT INTO role_permissions (role_id, permission_id, is_granted, is_deleted)
SELECT rp.role_id, pn.id, TRUE, FALSE
FROM role_permissions rp
JOIN permissions po ON po.id = rp.permission_id AND po.key = 'lookups.view'
JOIN permissions pn ON pn.key IN (
  'lookups.blinds_types.view',
  'lookups.order_statuses.view',
  'lookups.estimate_statuses.view',
  'lookups.product_categories.view',
  'lookups.blinds_extra_lifting_system.view',
  'lookups.blinds_extra_cassette_type.view'
)
WHERE rp.is_deleted IS NOT TRUE AND rp.is_granted IS TRUE
ON CONFLICT (role_id, permission_id) DO NOTHING;
-- Same for edit
INSERT INTO role_permissions (role_id, permission_id, is_granted, is_deleted)
SELECT rp.role_id, pn.id, TRUE, FALSE
FROM role_permissions rp
JOIN permissions po ON po.id = rp.permission_id AND po.key = 'lookups.edit'
JOIN permissions pn ON pn.key IN (
  'lookups.blinds_types.edit',
  'lookups.order_statuses.edit',
  'lookups.estimate_statuses.edit',
  'lookups.product_categories.edit',
  'lookups.blinds_extra_lifting_system.edit',
  'lookups.blinds_extra_cassette_type.edit'
)
WHERE rp.is_deleted IS NOT TRUE AND rp.is_granted IS TRUE
ON CONFLICT (role_id, permission_id) DO NOTHING;
-- User overrides: explicit deny on lookups.view → deny all granular views (same role scope)
INSERT INTO user_permissions (user_id, permission_id, role_id, is_granted, is_deleted)
SELECT up.user_id, pn.id, up.role_id, FALSE, FALSE
FROM user_permissions up
JOIN permissions po ON po.id = up.permission_id AND po.key = 'lookups.view'
JOIN permissions pn ON pn.key IN (
  'lookups.blinds_types.view',
  'lookups.order_statuses.view',
  'lookups.estimate_statuses.view',
  'lookups.product_categories.view',
  'lookups.blinds_extra_lifting_system.view',
  'lookups.blinds_extra_cassette_type.view'
)
WHERE up.is_deleted IS NOT TRUE AND up.is_granted IS NOT TRUE
ON CONFLICT (user_id, permission_id, role_id) DO NOTHING;
INSERT INTO user_permissions (user_id, permission_id, role_id, is_granted, is_deleted)
SELECT up.user_id, pn.id, up.role_id, FALSE, FALSE
FROM user_permissions up
JOIN permissions po ON po.id = up.permission_id AND po.key = 'lookups.edit'
JOIN permissions pn ON pn.key IN (
  'lookups.blinds_types.edit',
  'lookups.order_statuses.edit',
  'lookups.estimate_statuses.edit',
  'lookups.product_categories.edit',
  'lookups.blinds_extra_lifting_system.edit',
  'lookups.blinds_extra_cassette_type.edit'
)
WHERE up.is_deleted IS NOT TRUE AND up.is_granted IS NOT TRUE
ON CONFLICT (user_id, permission_id, role_id) DO NOTHING;
-- User overrides: explicit grant on lookups.view → grant granular (so matrix split stays consistent)
INSERT INTO user_permissions (user_id, permission_id, role_id, is_granted, is_deleted)
SELECT up.user_id, pn.id, up.role_id, TRUE, FALSE
FROM user_permissions up
JOIN permissions po ON po.id = up.permission_id AND po.key = 'lookups.view'
JOIN permissions pn ON pn.key IN (
  'lookups.blinds_types.view',
  'lookups.order_statuses.view',
  'lookups.estimate_statuses.view',
  'lookups.product_categories.view',
  'lookups.blinds_extra_lifting_system.view',
  'lookups.blinds_extra_cassette_type.view'
)
WHERE up.is_deleted IS NOT TRUE AND up.is_granted IS TRUE
ON CONFLICT (user_id, permission_id, role_id) DO NOTHING;
INSERT INTO user_permissions (user_id, permission_id, role_id, is_granted, is_deleted)
SELECT up.user_id, pn.id, up.role_id, TRUE, FALSE
FROM user_permissions up
JOIN permissions po ON po.id = up.permission_id AND po.key = 'lookups.edit'
JOIN permissions pn ON pn.key IN (
  'lookups.blinds_types.edit',
  'lookups.order_statuses.edit',
  'lookups.estimate_statuses.edit',
  'lookups.product_categories.edit',
  'lookups.blinds_extra_lifting_system.edit',
  'lookups.blinds_extra_cassette_type.edit'
)
WHERE up.is_deleted IS NOT TRUE AND up.is_granted IS TRUE
ON CONFLICT (user_id, permission_id, role_id) DO NOTHING;

-- 31_company_blinds_product_category_matrix.sql
-- Per-company enablement of global product categories (same pattern as company_status_*_matrix).
BEGIN;
CREATE TABLE IF NOT EXISTS public.company_blinds_product_category_matrix (
  company_id    UUID        NOT NULL REFERENCES public.companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  category_code VARCHAR(32) NOT NULL REFERENCES public.blinds_product_category (code) ON UPDATE CASCADE ON DELETE CASCADE,
  PRIMARY KEY (company_id, category_code)
);
CREATE INDEX IF NOT EXISTS idx_company_blinds_product_category_matrix_company
  ON public.company_blinds_product_category_matrix (company_id);
INSERT INTO public.company_blinds_product_category_matrix (company_id, category_code)
SELECT c.id, pc.code
FROM public.companies c
CROSS JOIN public.blinds_product_category pc
WHERE COALESCE(c.is_deleted, FALSE) IS NOT TRUE
  AND pc.active IS TRUE
ON CONFLICT (company_id, category_code) DO NOTHING;
ALTER TABLE public.company_blinds_product_category_matrix ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_blinds_product_category_matrix FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_company_blinds_product_category_matrix ON public.company_blinds_product_category_matrix;
CREATE POLICY tenant_company_blinds_product_category_matrix ON public.company_blinds_product_category_matrix
  FOR ALL
  USING (public.rls_company_id_allowed(company_id))
  WITH CHECK (public.rls_company_id_allowed(company_id));
COMMIT;

-- 32_global_blinds_type_and_matrix.sql — global blinds_type + company_blinds_type_matrix
-- (copy kept in DB/32_global_blinds_type_and_matrix.sql for standalone runs.)
DO $mig32$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'blinds_type'
      AND column_name = 'company_id'
  ) THEN
    RAISE NOTICE 'Migration 32 skipped: blinds_type is already global.';
    RETURN;
  END IF;

  RAISE NOTICE 'Migration 32: converting blinds_type to global catalog + company matrix.';

  DROP POLICY IF EXISTS tenant_blinds_type_isolation ON public.blinds_type;

  ALTER TABLE public.estimate_blinds DROP CONSTRAINT IF EXISTS fk_estimate_blinds_blinds_type;
  ALTER TABLE public.estimate DROP CONSTRAINT IF EXISTS fk_estimate_blinds_type;
  ALTER TABLE public.blinds_type_add DROP CONSTRAINT IF EXISTS fk_blinds_type_add_blinds_type;
  ALTER TABLE public.blinds_type_category_allowed DROP CONSTRAINT IF EXISTS fk_btca_blinds_type;
  ALTER TABLE public.blinds_type_extra_allowed DROP CONSTRAINT IF EXISTS fk_btea_blinds_type;

  ALTER TABLE public.blinds_type RENAME TO blinds_type_legacy;

  CREATE TABLE public._tmp_bt_map (
    company_id UUID NOT NULL,
    old_id     VARCHAR(16) NOT NULL,
    new_id     VARCHAR(16) NOT NULL,
    PRIMARY KEY (company_id, old_id)
  );

  INSERT INTO public._tmp_bt_map (company_id, old_id, new_id)
  SELECT
    l.company_id,
    l.id,
    substring(md5('global:bt:' || l.company_id::text || ':' || l.id::text), 1, 16)
  FROM public.blinds_type_legacy l;

  CREATE TABLE public.blinds_type (
    id          VARCHAR(16) PRIMARY KEY,
    name        TEXT        NOT NULL,
    aciklama    TEXT,
    active      BOOLEAN     NOT NULL DEFAULT TRUE,
    sort_order  INTEGER     NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_blinds_type_global_active
    ON public.blinds_type (active) WHERE active IS TRUE;

  INSERT INTO public.blinds_type (id, name, aciklama, active, sort_order)
  SELECT m.new_id, l.name, l.aciklama, l.active, 0
  FROM public.blinds_type_legacy l
  JOIN public._tmp_bt_map m ON m.company_id = l.company_id AND m.old_id = l.id;

  UPDATE public.estimate_blinds eb
  SET blinds_id = m.new_id
  FROM public._tmp_bt_map m
  WHERE eb.company_id = m.company_id AND eb.blinds_id = m.old_id;

  UPDATE public.estimate e
  SET blinds_id = m.new_id
  FROM public._tmp_bt_map m
  WHERE e.company_id = m.company_id AND e.blinds_id = m.old_id;

  UPDATE public.blinds_type_add b
  SET blinds_type_id = m.new_id
  FROM public._tmp_bt_map m
  WHERE b.company_id = m.company_id AND b.blinds_type_id = m.old_id;

  UPDATE public.blinds_type_category_allowed a
  SET blinds_type_id = m.new_id
  FROM public._tmp_bt_map m
  WHERE a.company_id = m.company_id AND a.blinds_type_id = m.old_id;

  UPDATE public.blinds_type_extra_allowed x
  SET blinds_type_id = m.new_id
  FROM public._tmp_bt_map m
  WHERE x.company_id = m.company_id AND x.blinds_type_id = m.old_id;

  UPDATE public.orders o
  SET blinds_lines = COALESCE(tagg.new_lines, '[]'::jsonb)
  FROM (
    SELECT
      o2.company_id,
      o2.id,
      (
        SELECT jsonb_agg(s.elem ORDER BY s.ord)
        FROM (
          SELECT
            CASE
              WHEN m.new_id IS NOT NULL THEN jsonb_set(x.elem, '{id}', to_jsonb(m.new_id::text), true)
              ELSE x.elem
            END AS elem,
            x.ord
          FROM jsonb_array_elements(o2.blinds_lines) WITH ORDINALITY AS x(elem, ord)
          LEFT JOIN public._tmp_bt_map m
            ON m.company_id = o2.company_id AND m.old_id = (x.elem->>'id')
        ) s
      ) AS new_lines
    FROM public.orders o2
    WHERE jsonb_typeof(o2.blinds_lines) = 'array'
      AND jsonb_array_length(o2.blinds_lines) > 0
  ) tagg
  WHERE o.company_id = tagg.company_id
    AND o.id = tagg.id;

  DROP TABLE public.blinds_type_legacy;

  ALTER TABLE public.estimate_blinds
    ADD CONSTRAINT fk_estimate_blinds_blinds_type
    FOREIGN KEY (blinds_id) REFERENCES public.blinds_type (id)
    ON UPDATE CASCADE ON DELETE RESTRICT;

  ALTER TABLE public.estimate
    ADD CONSTRAINT fk_estimate_blinds_type
    FOREIGN KEY (blinds_id) REFERENCES public.blinds_type (id)
    ON UPDATE CASCADE ON DELETE RESTRICT;

  ALTER TABLE public.blinds_type_add
    ADD CONSTRAINT fk_blinds_type_add_blinds_type
    FOREIGN KEY (blinds_type_id) REFERENCES public.blinds_type (id)
    ON UPDATE CASCADE ON DELETE RESTRICT;

  ALTER TABLE public.blinds_type_category_allowed
    ADD CONSTRAINT fk_btca_blinds_type
    FOREIGN KEY (blinds_type_id) REFERENCES public.blinds_type (id)
    ON UPDATE CASCADE ON DELETE CASCADE;

  ALTER TABLE public.blinds_type_extra_allowed
    ADD CONSTRAINT fk_btea_blinds_type
    FOREIGN KEY (blinds_type_id) REFERENCES public.blinds_type (id)
    ON UPDATE CASCADE ON DELETE CASCADE;

  CREATE TABLE public.company_blinds_type_matrix (
    company_id      UUID        NOT NULL REFERENCES public.companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
    blinds_type_id  VARCHAR(16) NOT NULL REFERENCES public.blinds_type (id) ON UPDATE CASCADE ON DELETE CASCADE,
    PRIMARY KEY (company_id, blinds_type_id)
  );
  CREATE INDEX idx_company_blinds_type_matrix_company
    ON public.company_blinds_type_matrix (company_id);

  INSERT INTO public.company_blinds_type_matrix (company_id, blinds_type_id)
  SELECT company_id, new_id
  FROM public._tmp_bt_map
  ON CONFLICT (company_id, blinds_type_id) DO NOTHING;

  DROP TABLE public._tmp_bt_map;

  ALTER TABLE public.blinds_type ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.blinds_type FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS blinds_type_select_authenticated ON public.blinds_type;
  CREATE POLICY blinds_type_select_authenticated ON public.blinds_type
    FOR SELECT USING (true);
  DROP POLICY IF EXISTS blinds_type_ins_bypass ON public.blinds_type;
  CREATE POLICY blinds_type_ins_bypass ON public.blinds_type
    FOR INSERT
    WITH CHECK (COALESCE(current_setting('app.rls_bypass', true), '') = '1');
  DROP POLICY IF EXISTS blinds_type_upd_bypass ON public.blinds_type;
  CREATE POLICY blinds_type_upd_bypass ON public.blinds_type
    FOR UPDATE
    USING (COALESCE(current_setting('app.rls_bypass', true), '') = '1')
    WITH CHECK (COALESCE(current_setting('app.rls_bypass', true), '') = '1');
  DROP POLICY IF EXISTS blinds_type_del_bypass ON public.blinds_type;
  CREATE POLICY blinds_type_del_bypass ON public.blinds_type
    FOR DELETE
    USING (COALESCE(current_setting('app.rls_bypass', true), '') = '1');

  ALTER TABLE public.company_blinds_type_matrix ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.company_blinds_type_matrix FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_company_blinds_type_matrix ON public.company_blinds_type_matrix;
  CREATE POLICY tenant_company_blinds_type_matrix ON public.company_blinds_type_matrix
    FOR ALL
    USING (public.rls_company_id_allowed(company_id))
    WITH CHECK (public.rls_company_id_allowed(company_id));
END
$mig32$;

-- -----------------------------------------------------------------------------
-- Kullanım notları
-- -----------------------------------------------------------------------------
-- • Idempotent çalıştırma: mevcut tablolar atlanır; FK’ler yoksa eklenir.
-- • Bu dosya DB/01..32 içeriklerini de kapsar; yeni şema değişiklikleri için yine ayrı migration ekleyin.
-- • Tam blinds şeması için DB/blinds.sql; FastAPI create_all ile çift şema oluşturmayın.
-- • Employee/company başvurusu için pending_*_self_registrations tabloları; PUBLIC_REGISTRATION_ENABLED yalnızca POST /auth/register (anında kayıt) anahtarıdır.
