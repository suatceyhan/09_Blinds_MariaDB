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
