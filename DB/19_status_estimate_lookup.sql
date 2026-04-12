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
