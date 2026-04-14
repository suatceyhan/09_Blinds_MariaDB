-- Per-company enablement of global product categories (same pattern as company_status_*_matrix).
-- Run after blinds_product_category and companies exist.
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
