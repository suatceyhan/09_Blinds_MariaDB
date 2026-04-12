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
