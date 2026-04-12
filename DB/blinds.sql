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
ALTER TABLE companies ADD COLUMN IF NOT EXISTS maps_url VARCHAR(2000);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS owner_user_id UUID;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_url VARCHAR(500);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS tax_rate_percent NUMERIC(6, 3);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS country_code VARCHAR(2) NULL;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS region_code VARCHAR(8) NULL;

UPDATE companies SET is_deleted = FALSE WHERE is_deleted IS NULL;
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
    ON DELETE SET NULL
);

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

  -- blinds_type
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'blinds_type') THEN
    ALTER TABLE public.blinds_type ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.blinds_type FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_blinds_type_isolation ON public.blinds_type;
    CREATE POLICY tenant_blinds_type_isolation ON public.blinds_type
      FOR ALL
      USING (public.rls_company_id_allowed(company_id))
      WITH CHECK (public.rls_company_id_allowed(company_id));
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
-- Kullanım notları
-- -----------------------------------------------------------------------------
-- • Idempotent çalıştırma: mevcut tablolar atlanır; FK’ler yoksa eklenir.
-- • Yeni kolon ihtiyacında bu dosyayı değiştirmek yerine ayrı migration kullanın (DB/NN_aciklama.sql, bkz. DB/README.md).
-- • Tam blinds şeması için DB/blinds.sql; FastAPI create_all ile çift şema oluşturmayın.
-- • Employee/company başvurusu için pending_*_self_registrations tabloları; PUBLIC_REGISTRATION_ENABLED yalnızca POST /auth/register (anında kayıt) anahtarıdır.
