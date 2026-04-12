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
