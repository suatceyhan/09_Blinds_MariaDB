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

