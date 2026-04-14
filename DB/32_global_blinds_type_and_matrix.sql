-- Global `blinds_type` (no company_id) + per-company enablement `company_blinds_type_matrix`.
-- Same pattern as `status_order` / `company_status_order_matrix` and product categories.
-- Idempotent: skips if `blinds_type` has no `company_id` column (already migrated).
-- Run after companies, estimates, orders, blinds_type_category_allowed exist.

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
