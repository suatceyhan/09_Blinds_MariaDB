-- blinds-postgresql.clean.sql — Fresh install (clean, consolidated)
-- PostgreSQL 13+ (gen_random_uuid via pgcrypto)
--
-- Goals:
-- - Final schema only (no duplicated migrations / legacy backfills)
-- - Fix "status_orde_id" typo -> status_order_id (consistent FK naming)
-- - Keep soft-delete for domain data
-- - Safer deletes: avoid hard cascades from companies to domain data
-- - RLS-ready (tenant isolation via GUCs)
--
-- Usage:
--   psql -U <user> -d <db> -f DB/blinds-postgresql.clean.sql
--
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================================
-- Helpers
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- App GUCs used by RLS:
--   app.rls_bypass = '1' to bypass all tenant policies (service/superadmin)
--   app.tenant_company_id = '<uuid>' current tenant scope
--   app.current_user_id = '<uuid>' current user id
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

-- =============================================================================
-- Auth / RBAC
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.role_groups (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         varchar NOT NULL,
  description  text,
  is_deleted   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,
  updated_by   uuid,
  CONSTRAINT uq_role_groups_name UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS public.users (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NULL,
  first_name              varchar NOT NULL,
  last_name               varchar NOT NULL,
  phone                   varchar NOT NULL,
  password                varchar NOT NULL,
  email                   varchar NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NULL,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid NULL,
  is_deleted              boolean NOT NULL DEFAULT false,
  last_login              timestamptz NULL,
  failed_login_attempts   integer NOT NULL DEFAULT 0,
  account_locked_until    timestamptz NULL,
  is_password_set         boolean NOT NULL DEFAULT false,
  is_first_login          boolean NOT NULL DEFAULT true,
  must_change_password    boolean NOT NULL DEFAULT false,
  role_group_id           uuid NULL,
  default_role_id         uuid NULL,
  photo_url               varchar NULL
);

-- When re-applying on an existing DB, `CREATE TABLE IF NOT EXISTS` will not add columns.
-- Ensure renamed/added columns exist before adding FK constraints below.
DO $$
BEGIN
  -- default_role (legacy) -> default_role_id (current)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'default_role_id'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'default_role'
    ) THEN
      EXECUTE 'ALTER TABLE public.users RENAME COLUMN default_role TO default_role_id';
    ELSE
      EXECUTE 'ALTER TABLE public.users ADD COLUMN default_role_id uuid NULL';
    END IF;
  END IF;

  -- company_id may be missing on very old DBs
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'company_id'
  ) THEN
    EXECUTE 'ALTER TABLE public.users ADD COLUMN company_id uuid NULL';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.roles (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           varchar NOT NULL,
  description    text,
  is_protected   boolean NOT NULL DEFAULT false,
  is_deleted     boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NULL,
  updated_by     uuid NULL,
  role_group_id  uuid NULL,
  CONSTRAINT uq_roles_name UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS public.permissions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key          varchar NOT NULL,
  parent_key   varchar,
  name         varchar NOT NULL,
  target_type  varchar NOT NULL,
  target_id    varchar NOT NULL,
  action       varchar NOT NULL,
  module_name  varchar,
  route_path   varchar,
  lookup_key   varchar,
  sort_index   integer NOT NULL DEFAULT 0,
  is_deleted   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NULL,
  updated_by   uuid NULL,
  CONSTRAINT uq_permissions_key UNIQUE (key)
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
  role_id        uuid NOT NULL REFERENCES public.roles (id),
  permission_id  uuid NOT NULL REFERENCES public.permissions (id),
  is_granted     boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NULL REFERENCES public.users (id) ON DELETE SET NULL,
  updated_by     uuid NULL REFERENCES public.users (id) ON DELETE SET NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  is_deleted     boolean NOT NULL DEFAULT false,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS public.user_roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users (id),
  role_id     uuid NOT NULL REFERENCES public.roles (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NULL REFERENCES public.users (id) ON DELETE SET NULL,
  updated_by  uuid NULL REFERENCES public.users (id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  is_deleted  boolean NOT NULL DEFAULT false,
  CONSTRAINT uq_user_roles_user_role UNIQUE (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS public.user_permissions (
  user_id        uuid NOT NULL REFERENCES public.users (id),
  permission_id  uuid NOT NULL REFERENCES public.permissions (id),
  role_id        uuid NOT NULL REFERENCES public.roles (id),
  is_granted     boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NULL REFERENCES public.users (id) ON DELETE SET NULL,
  updated_by     uuid NULL REFERENCES public.users (id) ON DELETE SET NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  is_deleted     boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, permission_id, role_id)
);

CREATE TABLE IF NOT EXISTS public.revoked_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token       varchar NOT NULL,
  user_id     uuid NULL REFERENCES public.users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz NOT NULL DEFAULT now(),
  is_used     boolean NOT NULL DEFAULT false,
  CONSTRAINT uq_revoked_tokens_token UNIQUE (token)
);

CREATE TABLE IF NOT EXISTS public.login_attempts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NULL REFERENCES public.users (id) ON DELETE SET NULL,
  ip_address    varchar(45),
  user_agent    varchar,
  success       boolean NOT NULL DEFAULT false,
  attempted_at  timestamptz NOT NULL DEFAULT current_timestamp
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_user_time
  ON public.login_attempts (user_id, attempted_at DESC);

CREATE TABLE IF NOT EXISTS public.user_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  session_token   varchar NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz,
  expires_at      timestamptz,
  is_active       boolean NOT NULL DEFAULT true,
  CONSTRAINT uq_user_sessions_token UNIQUE (session_token)
);

CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  token        varchar(100) NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  is_used      boolean NOT NULL DEFAULT false,
  used_at      timestamptz,
  ip_address   varchar(45),
  user_agent   varchar,
  attempts     integer NOT NULL DEFAULT 0,
  CONSTRAINT uq_password_reset_tokens_token UNIQUE (token)
);

CREATE TABLE IF NOT EXISTS public.pending_employee_self_registrations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name           varchar NOT NULL,
  last_name            varchar NOT NULL,
  email                varchar NOT NULL,
  phone                varchar NOT NULL,
  password             varchar NOT NULL,
  role_group_id        uuid NULL REFERENCES public.role_groups (id),
  request_note         text,
  verification_token   varchar NOT NULL,
  token_sent_at        timestamptz NOT NULL DEFAULT now(),
  is_email_verified    boolean NOT NULL DEFAULT false,
  email_verified_at    timestamptz,
  pending_status       varchar(32) NOT NULL DEFAULT 'EMAIL_NOT_VERIFIED',
  approved_by          uuid NULL REFERENCES public.users (id) ON DELETE SET NULL,
  approved_at          timestamptz,
  requested_at         timestamptz NOT NULL DEFAULT now(),
  is_deleted           boolean NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_employee_email_active
  ON public.pending_employee_self_registrations (lower(email))
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_pending_employee_token
  ON public.pending_employee_self_registrations (verification_token)
  WHERE is_deleted = false;

-- Users: case-insensitive unique email + phone
DROP INDEX IF EXISTS public.uq_users_email_ci;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_ci
  ON public.users (lower(btrim(email)))
  WHERE btrim(email) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_phone
  ON public.users (phone);

-- FK wiring (created after both tables exist)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_role_groups_created_by') THEN
    ALTER TABLE public.role_groups
      ADD CONSTRAINT fk_role_groups_created_by
      FOREIGN KEY (created_by) REFERENCES public.users (id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_role_groups_updated_by') THEN
    ALTER TABLE public.role_groups
      ADD CONSTRAINT fk_role_groups_updated_by
      FOREIGN KEY (updated_by) REFERENCES public.users (id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_created_by') THEN
    ALTER TABLE public.users
      ADD CONSTRAINT fk_users_created_by
      FOREIGN KEY (created_by) REFERENCES public.users (id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_updated_by') THEN
    ALTER TABLE public.users
      ADD CONSTRAINT fk_users_updated_by
      FOREIGN KEY (updated_by) REFERENCES public.users (id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_role_group') THEN
    ALTER TABLE public.users
      ADD CONSTRAINT fk_users_role_group
      FOREIGN KEY (role_group_id) REFERENCES public.role_groups (id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_roles_created_by') THEN
    ALTER TABLE public.roles
      ADD CONSTRAINT fk_roles_created_by
      FOREIGN KEY (created_by) REFERENCES public.users (id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_roles_updated_by') THEN
    ALTER TABLE public.roles
      ADD CONSTRAINT fk_roles_updated_by
      FOREIGN KEY (updated_by) REFERENCES public.users (id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_roles_role_group') THEN
    ALTER TABLE public.roles
      ADD CONSTRAINT fk_roles_role_group
      FOREIGN KEY (role_group_id) REFERENCES public.role_groups (id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_permissions_created_by') THEN
    ALTER TABLE public.permissions
      ADD CONSTRAINT fk_permissions_created_by
      FOREIGN KEY (created_by) REFERENCES public.users (id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_permissions_updated_by') THEN
    ALTER TABLE public.permissions
      ADD CONSTRAINT fk_permissions_updated_by
      FOREIGN KEY (updated_by) REFERENCES public.users (id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_default_role') THEN
    ALTER TABLE public.users
      ADD CONSTRAINT fk_users_default_role
      FOREIGN KEY (default_role_id) REFERENCES public.roles (id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_users_company_id ON public.users (company_id);

-- =============================================================================
-- Tenant core
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.companies (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           varchar NOT NULL,
  phone          varchar,
  website        varchar,
  email          varchar,
  address        varchar(2000),
  postal_code    varchar(32),
  maps_url       varchar(2000),
  owner_user_id  uuid NULL REFERENCES public.users (id) ON DELETE SET NULL,
  logo_url       varchar(500),
  tax_rate_percent numeric(6,3) NULL,
  country_code   varchar(2) NULL,
  region_code    varchar(8) NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  is_deleted     boolean NOT NULL DEFAULT false,
  CONSTRAINT uq_companies_name UNIQUE (name)
);

DROP TRIGGER IF EXISTS tr_companies_updated_at ON public.companies;
CREATE TRIGGER tr_companies_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

CREATE INDEX IF NOT EXISTS ix_companies_owner_user_id ON public.companies (owner_user_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_company_id') THEN
    ALTER TABLE public.users
      ADD CONSTRAINT fk_users_company_id
      FOREIGN KEY (company_id) REFERENCES public.companies (id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.company_members (
  company_id  uuid NOT NULL REFERENCES public.companies (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  user_id     uuid NOT NULL REFERENCES public.users (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  role        text NOT NULL DEFAULT 'member'
              CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_company_members_user
  ON public.company_members (user_id)
  WHERE active = true;

CREATE TABLE IF NOT EXISTS public.user_company_memberships (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE RESTRICT,
  is_deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_company_memberships_user_company UNIQUE (user_id, company_id)
);

CREATE TABLE IF NOT EXISTS public.pending_company_self_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name varchar NOT NULL,
  last_name varchar NOT NULL,
  email varchar NOT NULL,
  phone varchar NOT NULL,
  password varchar NOT NULL,
  company_name varchar NOT NULL,
  company_phone varchar,
  website varchar,
  request_note text,
  verification_token varchar NOT NULL,
  token_sent_at timestamptz NOT NULL DEFAULT now(),
  is_email_verified boolean NOT NULL DEFAULT false,
  email_verified_at timestamptz,
  pending_status varchar(32) NOT NULL DEFAULT 'EMAIL_NOT_VERIFIED',
  approved_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  requested_at timestamptz NOT NULL DEFAULT now(),
  is_deleted boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_pending_company_token
  ON public.pending_company_self_registrations (verification_token)
  WHERE is_deleted = false;

-- =============================================================================
-- Company settings: contract / invoice templates
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.company_document_templates (
  company_id   uuid NOT NULL REFERENCES public.companies (id) ON DELETE RESTRICT,
  kind         varchar(64) NOT NULL, -- deposit_contract | final_invoice
  preset_key   varchar(64) NULL,
  subject      varchar(300) NOT NULL DEFAULT '',
  body_html    text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  is_deleted   boolean NOT NULL DEFAULT false,
  PRIMARY KEY (company_id, kind)
);

DROP TRIGGER IF EXISTS tr_company_document_templates_updated_at ON public.company_document_templates;
CREATE TRIGGER tr_company_document_templates_updated_at
  BEFORE UPDATE ON public.company_document_templates
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- =============================================================================
-- Global catalogs + per-company enablement matrices
-- =============================================================================

-- Global order statuses (builtin_kind distinguishes canonical rows vs custom)
CREATE TABLE IF NOT EXISTS public.status_order (
  id           varchar(16) PRIMARY KEY,
  name         text NOT NULL,
  active       boolean NOT NULL DEFAULT true,
  sort_order   integer NOT NULL DEFAULT 0,
  builtin_kind text NULL,
  CONSTRAINT ck_status_order_builtin_kind_global CHECK (
    builtin_kind IS NULL OR builtin_kind IN ('new', 'ready_for_install', 'in_production', 'done')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_status_order_global_builtin_nn
  ON public.status_order (builtin_kind)
  WHERE builtin_kind IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_status_order_global_active
  ON public.status_order (active)
  WHERE active = true;

CREATE TABLE IF NOT EXISTS public.company_status_order_matrix (
  company_id      uuid NOT NULL REFERENCES public.companies (id) ON DELETE RESTRICT,
  status_order_id varchar(16) NOT NULL REFERENCES public.status_order (id) ON DELETE RESTRICT,
  PRIMARY KEY (company_id, status_order_id)
);

CREATE INDEX IF NOT EXISTS idx_company_status_order_matrix_company
  ON public.company_status_order_matrix (company_id);

-- Seed canonical builtin order statuses (stable ids by md5)
INSERT INTO public.status_order (id, name, active, sort_order, builtin_kind)
VALUES
  (substring(md5('global:ord:builtin:new') for 16), 'New order', true, 0, 'new'),
  (substring(md5('global:ord:builtin:in_production') for 16), 'In production', true, 5, 'in_production'),
  (substring(md5('global:ord:builtin:ready_for_install') for 16), 'Ready for installation', true, 10, 'ready_for_install'),
  (substring(md5('global:ord:builtin:done') for 16), 'Done', true, 20, 'done')
ON CONFLICT (id) DO NOTHING;

-- Global estimate statuses
CREATE TABLE IF NOT EXISTS public.status_estimate (
  id           varchar(16) PRIMARY KEY,
  slug         text NULL,
  name         text NOT NULL,
  active       boolean NOT NULL DEFAULT true,
  sort_order   integer NOT NULL DEFAULT 0,
  builtin_kind text NULL,
  CONSTRAINT ck_status_estimate_slug_null_or_enum
    CHECK (slug IS NULL OR slug IN ('new', 'pending', 'converted', 'cancelled')),
  CONSTRAINT ck_status_estimate_builtin_kind
    CHECK (builtin_kind IS NULL OR builtin_kind IN ('new', 'pending', 'converted', 'cancelled'))
);

-- If DB already exists, ensure constraints allow builtin_kind='new' (backend seed expects it).
ALTER TABLE public.status_estimate DROP CONSTRAINT IF EXISTS ck_status_estimate_slug_null_or_enum;
ALTER TABLE public.status_estimate
  ADD CONSTRAINT ck_status_estimate_slug_null_or_enum
  CHECK (slug IS NULL OR slug IN ('new', 'pending', 'converted', 'cancelled'));
ALTER TABLE public.status_estimate DROP CONSTRAINT IF EXISTS ck_status_estimate_builtin_kind;
ALTER TABLE public.status_estimate
  ADD CONSTRAINT ck_status_estimate_builtin_kind
  CHECK (builtin_kind IS NULL OR builtin_kind IN ('new', 'pending', 'converted', 'cancelled'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_status_estimate_global_builtin_nn
  ON public.status_estimate (builtin_kind)
  WHERE builtin_kind IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_status_estimate_global_slug_nn
  ON public.status_estimate (slug)
  WHERE slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_status_estimate_global_active
  ON public.status_estimate (active)
  WHERE active = true;

CREATE TABLE IF NOT EXISTS public.company_status_estimate_matrix (
  company_id         uuid NOT NULL REFERENCES public.companies (id) ON DELETE RESTRICT,
  status_estimate_id varchar(16) NOT NULL REFERENCES public.status_estimate (id) ON DELETE RESTRICT,
  PRIMARY KEY (company_id, status_estimate_id)
);

CREATE INDEX IF NOT EXISTS idx_company_status_estimate_matrix_company
  ON public.company_status_estimate_matrix (company_id);

INSERT INTO public.status_estimate (id, slug, name, active, sort_order, builtin_kind)
VALUES
  (substring(md5('global:est:builtin:new') for 16), 'new', 'New Estimate', true, -1, 'new'),
  (substring(md5('global:est:builtin:pending') for 16), 'pending', 'Pending', true, 0, 'pending'),
  (substring(md5('global:est:builtin:converted') for 16), 'converted', 'Converted to order', true, 10, 'converted'),
  (substring(md5('global:est:builtin:cancelled') for 16), 'cancelled', 'Cancelled', true, 20, 'cancelled')
ON CONFLICT (id) DO NOTHING;

-- Global blinds types + per-company matrix
CREATE TABLE IF NOT EXISTS public.blinds_type (
  id          varchar(16) PRIMARY KEY,
  name        text NOT NULL,
  aciklama    text,
  active      boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_blinds_type_global_active
  ON public.blinds_type (active)
  WHERE active = true;

CREATE TABLE IF NOT EXISTS public.company_blinds_type_matrix (
  company_id      uuid NOT NULL REFERENCES public.companies (id) ON DELETE RESTRICT,
  blinds_type_id  varchar(16) NOT NULL REFERENCES public.blinds_type (id) ON DELETE RESTRICT,
  PRIMARY KEY (company_id, blinds_type_id)
);

CREATE INDEX IF NOT EXISTS idx_company_blinds_type_matrix_company
  ON public.company_blinds_type_matrix (company_id);

-- Global product categories + per-company enablement + per-type allowed matrix
CREATE TABLE IF NOT EXISTS public.blinds_product_category (
  code         varchar(32) PRIMARY KEY,
  name         text NOT NULL,
  sort_order   integer NOT NULL DEFAULT 0,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS tr_blinds_product_category_updated_at ON public.blinds_product_category;
CREATE TRIGGER tr_blinds_product_category_updated_at
  BEFORE UPDATE ON public.blinds_product_category
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_blinds_product_category_active
  ON public.blinds_product_category (active)
  WHERE active = true;

CREATE TABLE IF NOT EXISTS public.company_blinds_product_category_matrix (
  company_id    uuid NOT NULL REFERENCES public.companies (id) ON DELETE RESTRICT,
  category_code varchar(32) NOT NULL REFERENCES public.blinds_product_category (code) ON DELETE RESTRICT,
  PRIMARY KEY (company_id, category_code)
);

CREATE INDEX IF NOT EXISTS idx_company_blinds_product_category_matrix_company
  ON public.company_blinds_product_category_matrix (company_id);

CREATE TABLE IF NOT EXISTS public.blinds_type_category_allowed (
  company_id       uuid NOT NULL REFERENCES public.companies (id) ON DELETE RESTRICT,
  blinds_type_id   varchar(16) NOT NULL REFERENCES public.blinds_type (id) ON DELETE RESTRICT,
  category_code    varchar(32) NOT NULL REFERENCES public.blinds_product_category (code) ON DELETE RESTRICT,
  PRIMARY KEY (company_id, blinds_type_id, category_code)
);

CREATE INDEX IF NOT EXISTS idx_btca_company_type
  ON public.blinds_type_category_allowed (company_id, blinds_type_id);

-- =============================================================================
-- Blinds domain (tenant-scoped)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.status_user (
  company_id  uuid NOT NULL REFERENCES public.companies (id) ON DELETE RESTRICT,
  id          varchar(16) NOT NULL,
  name        text NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  PRIMARY KEY (company_id, id)
);

CREATE INDEX IF NOT EXISTS idx_status_user_company_active
  ON public.status_user (company_id)
  WHERE active = true;

CREATE TABLE IF NOT EXISTS public.customers (
  company_id      uuid NOT NULL REFERENCES public.companies (id) ON DELETE RESTRICT,
  id              varchar(16) NOT NULL,
  name            text NOT NULL,
  surname         text,
  phone           text,
  email           text,
  address         text,
  postal_code     text,
  status_user_id  varchar(16),
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, id),
  CONSTRAINT fk_customers_status_user
    FOREIGN KEY (company_id, status_user_id)
    REFERENCES public.status_user (company_id, id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
);

DROP TRIGGER IF EXISTS tr_customers_updated_at ON public.customers;
CREATE TRIGGER tr_customers_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_customers_company_active
  ON public.customers (company_id)
  WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_customers_company_created
  ON public.customers (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customers_company_name
  ON public.customers (company_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_company_email
  ON public.customers (company_id, lower(btrim(email)))
  WHERE email IS NOT NULL AND btrim(email) <> '';

-- Leads
CREATE TABLE IF NOT EXISTS public.leads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies (id) ON DELETE RESTRICT,
  first_name    text,
  last_name     text,
  phone         text,
  email         text,
  address       text,
  source        text,
  note          text,
  status        text NOT NULL DEFAULT 'new'
                CHECK (status IN ('new', 'contacted', 'estimate_scheduled', 'estimated', 'won', 'lost', 'archived')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  is_deleted    boolean NOT NULL DEFAULT false
);

DROP TRIGGER IF EXISTS tr_leads_updated_at ON public.leads;
CREATE TRIGGER tr_leads_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_leads_company_created_at
  ON public.leads (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_company_status
  ON public.leads (company_id, status)
  WHERE is_deleted = false;

-- Estimates (customer_id is nullable to support prospect-only estimates)
CREATE TABLE IF NOT EXISTS public.estimate (
  company_id                uuid NOT NULL REFERENCES public.companies (id) ON DELETE RESTRICT,
  id                        varchar(16) NOT NULL,
  customer_id               varchar(16) NULL,
  blinds_id                 varchar(16) NULL,
  perde_sayisi              integer,
  tarih_saat                timestamptz,
  lead_source               text,
  lead_id                   uuid NULL REFERENCES public.leads (id) ON DELETE SET NULL,
  scheduled_start_at        timestamptz,
  scheduled_end_at          timestamptz,
  calendar_provider         text,
  calendar_id               text,
  google_event_id           text,
  calendar_last_synced_at   timestamptz,
  visit_time_zone           text,
  visit_address             text,
  visit_postal_code         text,
  visit_notes               text,
  visit_organizer_name      text,
  visit_organizer_email     varchar(320),
  visit_guest_emails        jsonb NOT NULL DEFAULT '[]'::jsonb,
  visit_recurrence_rrule    text,
  status_esti_id            varchar(16) NOT NULL,
  prospect_name             text,
  prospect_surname          text,
  prospect_phone            text,
  prospect_email            text,
  prospect_address          text,
  prospect_postal_code      text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  is_deleted                boolean NOT NULL DEFAULT false,
  PRIMARY KEY (company_id, id),
  CONSTRAINT fk_estimate_customer
    FOREIGN KEY (company_id, customer_id)
    REFERENCES public.customers (company_id, id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_estimate_blinds_type
    FOREIGN KEY (blinds_id)
    REFERENCES public.blinds_type (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_estimate_status_estimate
    FOREIGN KEY (status_esti_id)
    REFERENCES public.status_estimate (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
);

DROP TRIGGER IF EXISTS tr_estimate_updated_at ON public.estimate;
CREATE TRIGGER tr_estimate_updated_at
  BEFORE UPDATE ON public.estimate
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_estimate_company_customer
  ON public.estimate (company_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_estimate_company_tarih
  ON public.estimate (company_id, tarih_saat DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_estimate_company_lead_source
  ON public.estimate (company_id, lead_source);
CREATE INDEX IF NOT EXISTS idx_estimate_company_scheduled_start
  ON public.estimate (company_id, scheduled_start_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_estimate_company_not_deleted
  ON public.estimate (company_id)
  WHERE is_deleted IS NOT true;
CREATE INDEX IF NOT EXISTS idx_estimate_company_status
  ON public.estimate (company_id, status_esti_id)
  WHERE is_deleted IS NOT true;
CREATE INDEX IF NOT EXISTS idx_estimate_company_lead
  ON public.estimate (company_id, lead_id)
  WHERE is_deleted IS NOT true;

-- Many blinds types per estimate
CREATE TABLE IF NOT EXISTS public.estimate_blinds (
  company_id    uuid NOT NULL REFERENCES public.companies (id) ON DELETE RESTRICT,
  estimate_id   varchar(16) NOT NULL,
  blinds_id     varchar(16) NOT NULL REFERENCES public.blinds_type (id) ON DELETE RESTRICT,
  sort_order    integer NOT NULL DEFAULT 0,
  perde_sayisi  integer,
  line_amount   numeric(14,2),
  PRIMARY KEY (company_id, estimate_id, blinds_id),
  CONSTRAINT fk_estimate_blinds_estimate
    FOREIGN KEY (company_id, estimate_id)
    REFERENCES public.estimate (company_id, id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_estimate_blinds_company_estimate
  ON public.estimate_blinds (company_id, estimate_id);

-- Orders
CREATE TABLE IF NOT EXISTS public.orders (
  company_id                     uuid NOT NULL REFERENCES public.companies (id) ON DELETE RESTRICT,
  id                             varchar(16) NOT NULL,
  customer_id                    varchar(16) NOT NULL,
  estimate_id                    varchar(16) NULL,
  total_amount                   numeric(14, 2),
  downpayment                    numeric(14, 2),
  final_payment                  numeric(14, 2),
  balance                        numeric(14, 2),
  agree_data                     text,
  agreement_date                 date,
  installation_date              date,
  extra_harcama                  numeric(14, 2),
  tax_uygulanacak_miktar         numeric(14, 2),
  tax_amount                     numeric(14, 2),
  blinds_lines                   jsonb NOT NULL DEFAULT '[]'::jsonb,
  order_note                     text,
  blinds_type_add_id             varchar(16),
  parent_order_id                varchar(16),
  status_order_id                varchar(16) NULL,
  status_code                    text NOT NULL DEFAULT 'order_created'
                                 CHECK (status_code IN (
                                   'order_created',
                                   'deposit_paid',
                                   'in_production',
                                   'ready_for_install',
                                   'install_scheduled',
                                   'installed',
                                   'final_paid',
                                   'cancelled'
                                 )),
  ready_at                       timestamptz,
  installed_at                   timestamptz,
  installation_scheduled_start_at timestamptz,
  installation_scheduled_end_at   timestamptz,
  installation_calendar_provider  text,
  installation_calendar_id        text,
  installation_google_event_id    text,
  installation_calendar_last_synced_at timestamptz,
  active                         boolean NOT NULL DEFAULT true,
  created_at                     timestamptz NOT NULL DEFAULT now(),
  updated_at                     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, id),
  CONSTRAINT fk_orders_customer
    FOREIGN KEY (company_id, customer_id)
    REFERENCES public.customers (company_id, id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_orders_estimate
    FOREIGN KEY (company_id, estimate_id)
    REFERENCES public.estimate (company_id, id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,
  CONSTRAINT fk_orders_parent_order
    FOREIGN KEY (company_id, parent_order_id)
    REFERENCES public.orders (company_id, id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_orders_status_order
    FOREIGN KEY (status_order_id)
    REFERENCES public.status_order (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
);

DROP TRIGGER IF EXISTS tr_orders_updated_at ON public.orders;
CREATE TRIGGER tr_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_orders_company_active
  ON public.orders (company_id)
  WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_orders_company_customer
  ON public.orders (company_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_company_created
  ON public.orders (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_company_status_order
  ON public.orders (company_id, status_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_company_parent
  ON public.orders (company_id, parent_order_id)
  WHERE parent_order_id IS NOT NULL AND active is true;
CREATE INDEX IF NOT EXISTS idx_orders_company_estimate
  ON public.orders (company_id, estimate_id)
  WHERE estimate_id IS NOT NULL;

-- Mark estimate converted when an order is created with estimate_id
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
      updated_at = now()
    WHERE company_id = NEW.company_id
      AND id = NEW.estimate_id
      AND is_deleted IS NOT true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_orders_mark_estimate_converted ON public.orders;
CREATE TRIGGER tr_orders_mark_estimate_converted
  AFTER INSERT ON public.orders
  FOR EACH ROW EXECUTE PROCEDURE public.trg_orders_mark_estimate_converted();

-- Order items
CREATE TABLE IF NOT EXISTS public.order_items (
  company_id        uuid NOT NULL REFERENCES public.companies (id) ON DELETE RESTRICT,
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          varchar(16) NOT NULL,
  catalog_category  text NOT NULL CHECK (catalog_category IN ('classic', 'delux', 'premium')),
  model             text NOT NULL CHECK (model IN ('zebra', 'roller_shade', 'honecomb', 'galaxy', 'curtains')),
  lifting_system    text NOT NULL CHECK (lifting_system IN ('chain', 'cordless', 'motorized')),
  kasa_type         text NOT NULL CHECK (kasa_type IN ('square', 'square_curved', 'round')),
  fabric_insert     boolean NOT NULL DEFAULT false,
  width_mm          integer,
  height_mm         integer,
  quantity          integer NOT NULL DEFAULT 1,
  notes             text,
  unit_price        numeric(14, 2),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  is_deleted        boolean NOT NULL DEFAULT false,
  CONSTRAINT fk_order_items_order
    FOREIGN KEY (company_id, order_id)
    REFERENCES public.orders (company_id, id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
);

DROP TRIGGER IF EXISTS tr_order_items_updated_at ON public.order_items;
CREATE TRIGGER tr_order_items_updated_at
  BEFORE UPDATE ON public.order_items
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_order_items_company_order
  ON public.order_items (company_id, order_id);

-- Payments (newer unified table)
CREATE TABLE IF NOT EXISTS public.order_payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies (id) ON DELETE RESTRICT,
  order_id      varchar(16) NOT NULL,
  payment_type  text NOT NULL CHECK (payment_type IN ('deposit', 'final', 'other')),
  amount        numeric(14, 2) NOT NULL CHECK (amount > 0),
  paid_at       timestamptz,
  method        text,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  is_deleted    boolean NOT NULL DEFAULT false,
  CONSTRAINT fk_order_payments_order
    FOREIGN KEY (company_id, order_id)
    REFERENCES public.orders (company_id, id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_order_payments_company_paid_at
  ON public.order_payments (company_id, paid_at DESC NULLS LAST);

-- Payment history entries (API "record-payment" log)
CREATE TABLE IF NOT EXISTS public.order_payment_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES public.companies (id) ON DELETE RESTRICT,
  order_id         varchar(16) NOT NULL,
  amount           numeric(14, 2) NOT NULL CHECK (amount > 0),
  payment_group_id uuid NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  is_deleted       boolean NOT NULL DEFAULT false,
  CONSTRAINT fk_order_payment_entries_order
    FOREIGN KEY (company_id, order_id)
    REFERENCES public.orders (company_id, id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_order_payment_entries_company_order_created
  ON public.order_payment_entries (company_id, order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_payment_entries_active
  ON public.order_payment_entries (company_id, order_id, created_at DESC)
  WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_order_payment_entries_group
  ON public.order_payment_entries (company_id, payment_group_id, created_at DESC)
  WHERE payment_group_id IS NOT NULL AND is_deleted = false;

-- Attachments (generic)
CREATE TABLE IF NOT EXISTS public.attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies (id) ON DELETE RESTRICT,
  entity_type   text NOT NULL CHECK (entity_type IN ('lead', 'estimate', 'order', 'installation')),
  entity_id     text NOT NULL,
  media_type    text NOT NULL CHECK (media_type IN ('photo', 'video', 'file')),
  url           text NOT NULL,
  taken_at      timestamptz,
  uploaded_by   uuid NULL REFERENCES public.users (id) ON DELETE SET NULL,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  is_deleted    boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_attachments_company_entity
  ON public.attachments (company_id, entity_type, entity_id)
  WHERE is_deleted = false;

-- Legacy: order_attachments kept as a separate table (some flows may depend on stored_relpath)
CREATE TABLE IF NOT EXISTS public.order_attachments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES public.companies (id) ON DELETE RESTRICT,
  order_id           varchar(16) NOT NULL,
  kind               text NOT NULL CHECK (kind IN ('photo', 'excel', 'line_photo')),
  blinds_type_id     varchar(16),
  original_filename  text NOT NULL,
  stored_relpath     text NOT NULL,
  content_type       text,
  file_size          bigint,
  created_at         timestamptz NOT NULL DEFAULT now(),
  is_deleted         boolean NOT NULL DEFAULT false,
  CONSTRAINT fk_order_attachments_order
    FOREIGN KEY (company_id, order_id)
    REFERENCES public.orders (company_id, id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_order_attachments_company_order
  ON public.order_attachments (company_id, order_id, created_at DESC)
  WHERE is_deleted = false;

-- Order expenses (cost ledger)
CREATE TABLE IF NOT EXISTS public.order_expense_entries (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES public.companies (id) ON DELETE RESTRICT,
  order_id            varchar(16) NOT NULL,
  amount              numeric(14,2) NOT NULL CHECK (amount > 0),
  note                text,
  spent_at            timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by_user_id  uuid NULL REFERENCES public.users (id) ON DELETE SET NULL,
  is_deleted          boolean NOT NULL DEFAULT false,
  CONSTRAINT fk_order_expense_entries_order
    FOREIGN KEY (company_id, order_id)
    REFERENCES public.orders (company_id, id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_order_expense_entries_company_order_created
  ON public.order_expense_entries (company_id, order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_expense_entries_company_created
  ON public.order_expense_entries (company_id, created_at DESC)
  WHERE is_deleted = false;

-- Add-on summary row (kept for compatibility)
CREATE TABLE IF NOT EXISTS public.blinds_type_add (
  company_id        uuid NOT NULL REFERENCES public.companies (id) ON DELETE RESTRICT,
  id                varchar(16) NOT NULL,
  blinds_type_id    varchar(16) NOT NULL REFERENCES public.blinds_type (id) ON DELETE RESTRICT,
  product_category  text NOT NULL DEFAULT 'classic'
                    CHECK (product_category IN ('classic', 'delux', 'premium')),
  amount            numeric(14, 2),
  number_of_blinds  integer,
  square_meter      numeric(14, 4),
  number_of_motor   integer,
  order_id          varchar(16) NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, id),
  CONSTRAINT fk_blinds_type_add_order
    FOREIGN KEY (company_id, order_id)
    REFERENCES public.orders (company_id, id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
);

DROP TRIGGER IF EXISTS tr_blinds_type_add_updated_at ON public.blinds_type_add;
CREATE TRIGGER tr_blinds_type_add_updated_at
  BEFORE UPDATE ON public.blinds_type_add
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_blinds_type_add_company_order
  ON public.blinds_type_add (company_id, order_id);
CREATE INDEX IF NOT EXISTS idx_blinds_type_add_company_type
  ON public.blinds_type_add (company_id, blinds_type_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_orders_blinds_type_add_first') THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT fk_orders_blinds_type_add_first
      FOREIGN KEY (company_id, blinds_type_add_id)
      REFERENCES public.blinds_type_add (company_id, id)
      ON UPDATE CASCADE
      ON DELETE SET NULL;
  END IF;
END $$;

-- =============================================================================
-- Company Google Calendar OAuth
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.company_google_calendar (
  company_id           uuid PRIMARY KEY REFERENCES public.companies (id) ON DELETE RESTRICT,
  refresh_token        text NOT NULL,
  calendar_id          text NOT NULL DEFAULT 'primary',
  google_account_email text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS tr_company_google_calendar_updated_at ON public.company_google_calendar;
CREATE TRIGGER tr_company_google_calendar_updated_at
  BEFORE UPDATE ON public.company_google_calendar
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- =============================================================================
-- Audit
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.user_audit_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  executed_by  uuid NULL REFERENCES public.users (id) ON DELETE SET NULL,
  action       varchar(50) NOT NULL,
  table_name   varchar(100) NOT NULL,
  table_id     uuid,
  before_data  jsonb,
  after_data   jsonb,
  ip_address   varchar(45),
  user_agent   varchar,
  "timestamp"  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_audit_logs_timestamp
  ON public.user_audit_logs ("timestamp" DESC);

CREATE TABLE IF NOT EXISTS public.system_audit_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_name  varchar(100) NOT NULL,
  action        varchar(100) NOT NULL,
  status        varchar(20) NOT NULL,
  details       jsonb,
  executed_by   varchar(100),
  ip_address    varchar(45),
  "timestamp"   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_audit_logs_timestamp
  ON public.system_audit_logs ("timestamp" DESC);

-- =============================================================================
-- Workflow engine (global + company overrides without NULL-as-global antipattern)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.workflow_definitions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  is_global   boolean NOT NULL DEFAULT false,
  company_id  uuid NULL REFERENCES public.companies (id) ON DELETE RESTRICT,
  entity_type text NOT NULL,
  code        text NOT NULL,
  name        text NOT NULL,
  version     integer NOT NULL DEFAULT 1,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_workflow_definitions_scope CHECK (
    (is_global = true AND company_id IS NULL)
    OR (is_global = false AND company_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_definitions_global_entity_code_version
  ON public.workflow_definitions (entity_type, code, version)
  WHERE is_global = true;

CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_definitions_company_entity_code_version
  ON public.workflow_definitions (company_id, entity_type, code, version)
  WHERE is_global = false;

CREATE TABLE IF NOT EXISTS public.workflow_transitions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_definition_id  uuid NOT NULL REFERENCES public.workflow_definitions(id) ON DELETE CASCADE,
  from_status_id          varchar(32) NULL,
  to_status_id            varchar(32) NOT NULL,
  sort_order              integer NOT NULL DEFAULT 0,
  required_permission     text NULL,
  guard_json              jsonb NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz NULL
);

CREATE INDEX IF NOT EXISTS ix_workflow_transitions_def_from
  ON public.workflow_transitions (workflow_definition_id, from_status_id);
CREATE INDEX IF NOT EXISTS ix_workflow_transitions_def_to
  ON public.workflow_transitions (workflow_definition_id, to_status_id);
CREATE INDEX IF NOT EXISTS ix_workflow_transitions_def_active
  ON public.workflow_transitions (workflow_definition_id)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.workflow_transition_actions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transition_id uuid NOT NULL REFERENCES public.workflow_transitions(id) ON DELETE CASCADE,
  type        text NOT NULL,
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order  integer NOT NULL DEFAULT 0,
  is_required boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_workflow_transition_actions_transition
  ON public.workflow_transition_actions (transition_id, sort_order);

-- =============================================================================
-- Row Level Security (RLS)
-- =============================================================================

-- companies
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_companies_isolation ON public.companies;
CREATE POLICY tenant_companies_isolation ON public.companies
  FOR ALL
  USING (public.rls_company_id_allowed(id))
  WITH CHECK (public.rls_company_id_allowed(id));

-- users (tenant or self access; superadmin/service bypass via app.rls_bypass)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_users_select ON public.users;
DROP POLICY IF EXISTS tenant_users_insert ON public.users;
DROP POLICY IF EXISTS tenant_users_update ON public.users;
DROP POLICY IF EXISTS tenant_users_delete ON public.users;

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
      AND users.company_id = NULLIF(current_setting('app.tenant_company_id', true), '')::uuid
    )
  );

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
      AND users.company_id = NULLIF(current_setting('app.tenant_company_id', true), '')::uuid
    )
  )
  WITH CHECK (
    COALESCE(current_setting('app.rls_bypass', true), '') = '1'
    OR company_id IS NULL
    OR (
      NULLIF(current_setting('app.tenant_company_id', true), '') IS NOT NULL
      AND company_id = NULLIF(current_setting('app.tenant_company_id', true), '')::uuid
    )
  );

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
  USING (COALESCE(current_setting('app.rls_bypass', true), '') = '1');

-- tenant-scoped domain tables
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'company_members',
    'user_company_memberships',
    'company_document_templates',
    'company_google_calendar',
    'company_status_order_matrix',
    'company_status_estimate_matrix',
    'company_blinds_type_matrix',
    'company_blinds_product_category_matrix',
    'blinds_type_category_allowed',
    'status_user',
    'customers',
    'leads',
    'estimate',
    'estimate_blinds',
    'orders',
    'order_items',
    'order_payments',
    'order_payment_entries',
    'order_attachments',
    'order_expense_entries',
    'attachments'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_%I_isolation ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY tenant_%I_isolation ON public.%I FOR ALL USING (public.rls_company_id_allowed(company_id)) WITH CHECK (public.rls_company_id_allowed(company_id))',
      t, t
    );
  END LOOP;
END $$;

-- global catalogs: readable by all authenticated app roles; write only when bypass
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'status_order',
    'status_estimate',
    'blinds_type',
    'blinds_product_category'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_select_authenticated ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_select_authenticated ON public.%I FOR SELECT USING (true)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_ins_bypass ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_ins_bypass ON public.%I FOR INSERT WITH CHECK (COALESCE(current_setting(''app.rls_bypass'', true), '''') = ''1'')', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_upd_bypass ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_upd_bypass ON public.%I FOR UPDATE USING (COALESCE(current_setting(''app.rls_bypass'', true), '''') = ''1'') WITH CHECK (COALESCE(current_setting(''app.rls_bypass'', true), '''') = ''1'')', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_del_bypass ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_del_bypass ON public.%I FOR DELETE USING (COALESCE(current_setting(''app.rls_bypass'', true), '''') = ''1'')', t, t);
  END LOOP;
END $$;

-- workflow: select global + tenant; write only bypass
ALTER TABLE public.workflow_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_definitions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workflow_definitions_select ON public.workflow_definitions;
CREATE POLICY workflow_definitions_select ON public.workflow_definitions
  FOR SELECT
  USING (is_global = true OR public.rls_company_id_allowed(company_id));
DROP POLICY IF EXISTS workflow_definitions_bypass_all ON public.workflow_definitions;
CREATE POLICY workflow_definitions_bypass_all ON public.workflow_definitions
  FOR ALL
  USING (COALESCE(current_setting('app.rls_bypass', true), '') = '1')
  WITH CHECK (COALESCE(current_setting('app.rls_bypass', true), '') = '1');

ALTER TABLE public.workflow_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_transitions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workflow_transitions_select ON public.workflow_transitions;
CREATE POLICY workflow_transitions_select ON public.workflow_transitions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.workflow_definitions wd
      WHERE wd.id = workflow_definition_id
        AND (wd.is_global = true OR public.rls_company_id_allowed(wd.company_id))
    )
  );
DROP POLICY IF EXISTS workflow_transitions_bypass_all ON public.workflow_transitions;
CREATE POLICY workflow_transitions_bypass_all ON public.workflow_transitions
  FOR ALL
  USING (COALESCE(current_setting('app.rls_bypass', true), '') = '1')
  WITH CHECK (COALESCE(current_setting('app.rls_bypass', true), '') = '1');

ALTER TABLE public.workflow_transition_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_transition_actions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workflow_transition_actions_select ON public.workflow_transition_actions;
CREATE POLICY workflow_transition_actions_select ON public.workflow_transition_actions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.workflow_transitions wt
      JOIN public.workflow_definitions wd ON wd.id = wt.workflow_definition_id
      WHERE wt.id = transition_id
        AND (wd.is_global = true OR public.rls_company_id_allowed(wd.company_id))
    )
  );
DROP POLICY IF EXISTS workflow_transition_actions_bypass_all ON public.workflow_transition_actions;
CREATE POLICY workflow_transition_actions_bypass_all ON public.workflow_transition_actions
  FOR ALL
  USING (COALESCE(current_setting('app.rls_bypass', true), '') = '1')
  WITH CHECK (COALESCE(current_setting('app.rls_bypass', true), '') = '1');

-- =============================================================================
-- Optional: seed nav/menu permissions (superadmin grants only)
-- =============================================================================
-- Enable by setting:
--   SET app.seed_permissions = '1';
-- Notes:
-- - Workspace policy: auto-grant ONLY to superadmin; other roles must be configured via UI matrix.
DO $$
DECLARE
  do_seed boolean := COALESCE(current_setting('app.seed_permissions', true), '') = '1';
  r_super uuid;
BEGIN
  IF NOT do_seed THEN
    RETURN;
  END IF;

  INSERT INTO public.permissions (key, name, parent_key, target_type, target_id, action, module_name, sort_index, is_deleted)
  VALUES
    ('lookups.blinds_types.view', 'Lookups / Blinds types — view', NULL, 'module', 'lookups', 'access', 'lookups', 124, FALSE),
    ('lookups.blinds_types.edit', 'Lookups / Blinds types — edit', NULL, 'module', 'lookups', 'access', 'lookups', 125, FALSE),
    ('lookups.order_statuses.view', 'Lookups / Order statuses — view', NULL, 'module', 'lookups', 'access', 'lookups', 126, FALSE),
    ('lookups.order_statuses.edit', 'Lookups / Order statuses — edit', NULL, 'module', 'lookups', 'access', 'lookups', 127, FALSE),
    ('lookups.estimate_statuses.view', 'Lookups / Estimate statuses — view', NULL, 'module', 'lookups', 'access', 'lookups', 128, FALSE),
    ('lookups.estimate_statuses.edit', 'Lookups / Estimate statuses — edit', NULL, 'module', 'lookups', 'access', 'lookups', 129, FALSE),
    ('lookups.product_categories.view', 'Lookups / Product categories — view', NULL, 'module', 'lookups', 'access', 'lookups', 130, FALSE),
    ('lookups.product_categories.edit', 'Lookups / Product categories — edit', NULL, 'module', 'lookups', 'access', 'lookups', 131, FALSE),
    ('settings.contract_invoice.view', 'Settings — Contract / Invoice — view', NULL, 'module', 'settings', 'access', 'settings', 88, FALSE),
    ('settings.contract_invoice.edit', 'Settings — Contract / Invoice — edit', NULL, 'module', 'settings', 'access', 'settings', 89, FALSE),
    ('settings.order_workflow.view', 'Order workflow — view', NULL, 'module', 'settings', 'access', 'settings', 72, FALSE),
    ('settings.order_workflow.edit', 'Order workflow — edit', NULL, 'module', 'settings', 'access', 'settings', 73, FALSE),
    ('settings.estimate_workflow.view', 'Estimate workflow — view', NULL, 'module', 'settings', 'access', 'settings', 74, FALSE),
    ('settings.estimate_workflow.edit', 'Estimate workflow — edit', NULL, 'module', 'settings', 'access', 'settings', 75, FALSE)
  ON CONFLICT (key) DO NOTHING;

  SELECT id INTO r_super FROM public.roles WHERE name = 'superadmin' AND is_deleted IS NOT TRUE LIMIT 1;
  IF r_super IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.role_permissions (role_id, permission_id, is_granted, is_deleted)
  SELECT r_super, p.id, TRUE, FALSE
  FROM public.permissions p
  LEFT JOIN public.role_permissions rp
    ON rp.role_id = r_super AND rp.permission_id = p.id
  WHERE p.is_deleted IS NOT TRUE
    AND rp.role_id IS NULL;
END $$;

COMMIT;

