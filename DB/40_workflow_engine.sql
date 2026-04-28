-- Workflow engine (configurable transitions + actions)
-- PostgreSQL migration for 09_Blinds.
--
-- Notes:
-- - Tenant scoped by `company_id` where applicable; global defaults use `company_id IS NULL`.
-- - This migration is idempotent.
-- - Seeded with a minimal default Order workflow (New → In Production → Ready for installation → Done).

DO $$
BEGIN
  -- ---------------------------------------------------------------------------
  -- Core tables
  -- ---------------------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'workflow_definitions'
  ) THEN
    CREATE TABLE public.workflow_definitions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id uuid NULL,
      entity_type text NOT NULL, -- e.g. 'order', 'estimate'
      code text NOT NULL,        -- e.g. 'default_order'
      name text NOT NULL,
      version integer NOT NULL DEFAULT 1,
      is_active boolean NOT NULL DEFAULT TRUE,
      created_at timestamptz NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX uq_workflow_definitions_company_entity_code_version
      ON public.workflow_definitions (COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid), entity_type, code, version);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'workflow_transitions'
  ) THEN
    CREATE TABLE public.workflow_transitions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workflow_definition_id uuid NOT NULL REFERENCES public.workflow_definitions(id) ON DELETE CASCADE,
      from_status_id varchar(32) NULL, -- status_order.id etc.
      to_status_id varchar(32) NOT NULL,
      sort_order integer NOT NULL DEFAULT 0,
      required_permission text NULL, -- optional permission key (checked by API)
      guard_json jsonb NULL,
      created_at timestamptz NOT NULL DEFAULT NOW()
    );
    CREATE INDEX ix_workflow_transitions_def_from ON public.workflow_transitions (workflow_definition_id, from_status_id);
    CREATE INDEX ix_workflow_transitions_def_to ON public.workflow_transitions (workflow_definition_id, to_status_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'workflow_transition_actions'
  ) THEN
    CREATE TABLE public.workflow_transition_actions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      transition_id uuid NOT NULL REFERENCES public.workflow_transitions(id) ON DELETE CASCADE,
      type text NOT NULL, -- ask_form | webhook | send_notification | require_approval | ui_hint | ...
      config jsonb NOT NULL DEFAULT '{}'::jsonb,
      sort_order integer NOT NULL DEFAULT 0,
      is_required boolean NOT NULL DEFAULT TRUE,
      created_at timestamptz NOT NULL DEFAULT NOW()
    );
    CREATE INDEX ix_workflow_transition_actions_transition ON public.workflow_transition_actions (transition_id, sort_order);
  END IF;

  -- ---------------------------------------------------------------------------
  -- RLS policies (tenant scoping)
  -- ---------------------------------------------------------------------------
  -- workflow_definitions: allow tenant read of global defaults + own company overrides;
  -- allow bypass for writes (same pattern as other tables).
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rls_company_id_allowed') THEN
    ALTER TABLE public.workflow_definitions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.workflow_definitions FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS workflow_definitions_tenant ON public.workflow_definitions;
    CREATE POLICY workflow_definitions_tenant ON public.workflow_definitions
      FOR SELECT
      USING (company_id IS NULL OR public.rls_company_id_allowed(company_id));
    DROP POLICY IF EXISTS workflow_definitions_bypass_ins ON public.workflow_definitions;
    CREATE POLICY workflow_definitions_bypass_ins ON public.workflow_definitions
      FOR INSERT
      WITH CHECK (COALESCE(current_setting('app.rls_bypass', true), '') = '1');
    DROP POLICY IF EXISTS workflow_definitions_bypass_upd ON public.workflow_definitions;
    CREATE POLICY workflow_definitions_bypass_upd ON public.workflow_definitions
      FOR UPDATE
      USING (COALESCE(current_setting('app.rls_bypass', true), '') = '1')
      WITH CHECK (COALESCE(current_setting('app.rls_bypass', true), '') = '1');
    DROP POLICY IF EXISTS workflow_definitions_bypass_del ON public.workflow_definitions;
    CREATE POLICY workflow_definitions_bypass_del ON public.workflow_definitions
      FOR DELETE
      USING (COALESCE(current_setting('app.rls_bypass', true), '') = '1');

    -- transitions/actions: readable if the owning workflow_definition row is readable.
    ALTER TABLE public.workflow_transitions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.workflow_transitions FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS workflow_transitions_tenant ON public.workflow_transitions;
    CREATE POLICY workflow_transitions_tenant ON public.workflow_transitions
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM public.workflow_definitions wd
          WHERE wd.id = workflow_definition_id
            AND (wd.company_id IS NULL OR public.rls_company_id_allowed(wd.company_id))
        )
      );
    DROP POLICY IF EXISTS workflow_transitions_bypass_all ON public.workflow_transitions;
    CREATE POLICY workflow_transitions_bypass_all ON public.workflow_transitions
      FOR ALL
      USING (COALESCE(current_setting('app.rls_bypass', true), '') = '1')
      WITH CHECK (COALESCE(current_setting('app.rls_bypass', true), '') = '1');

    ALTER TABLE public.workflow_transition_actions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.workflow_transition_actions FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS workflow_transition_actions_tenant ON public.workflow_transition_actions;
    CREATE POLICY workflow_transition_actions_tenant ON public.workflow_transition_actions
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM public.workflow_transitions wt
          JOIN public.workflow_definitions wd ON wd.id = wt.workflow_definition_id
          WHERE wt.id = transition_id
            AND (wd.company_id IS NULL OR public.rls_company_id_allowed(wd.company_id))
        )
      );
    DROP POLICY IF EXISTS workflow_transition_actions_bypass_all ON public.workflow_transition_actions;
    CREATE POLICY workflow_transition_actions_bypass_all ON public.workflow_transition_actions
      FOR ALL
      USING (COALESCE(current_setting('app.rls_bypass', true), '') = '1')
      WITH CHECK (COALESCE(current_setting('app.rls_bypass', true), '') = '1');
  END IF;

  -- ---------------------------------------------------------------------------
  -- Seed minimal default workflow for Orders (global)
  -- ---------------------------------------------------------------------------
  -- Status IDs match `app/domains/business_lookups/services/global_status_seed.py`:
  -- - New order: 88efe5e3d3512afe
  -- - Ready for installation: md5('global:ord:builtin:ready_for_install')[:16]
  -- - In Production: md5('global:ord:builtin:in_production')[:16]
  -- - Done: md5('global:ord:builtin:done')[:16]

  -- Ensure definition exists (global default: company_id NULL)
  INSERT INTO public.workflow_definitions (company_id, entity_type, code, name, version, is_active)
  SELECT NULL, 'order', 'default_order', 'Default order workflow', 1, TRUE
  WHERE NOT EXISTS (
    SELECT 1 FROM public.workflow_definitions
    WHERE company_id IS NULL AND entity_type = 'order' AND code = 'default_order' AND version = 1
  );

  -- Insert transitions (idempotent by matching definition + from/to)
  WITH def AS (
    SELECT id
    FROM public.workflow_definitions
    WHERE company_id IS NULL AND entity_type = 'order' AND code = 'default_order' AND version = 1
    LIMIT 1
  ),
  ids AS (
    SELECT
      '88efe5e3d3512afe'::varchar(32) AS st_new,
      substring(md5('global:ord:builtin:in_production') for 16)::varchar(32) AS st_prod,
      substring(md5('global:ord:builtin:ready_for_install') for 16)::varchar(32) AS st_rfi,
      substring(md5('global:ord:builtin:done') for 16)::varchar(32) AS st_done
  ),
  ins AS (
    INSERT INTO public.workflow_transitions (workflow_definition_id, from_status_id, to_status_id, sort_order)
    SELECT def.id, ids.st_new, ids.st_prod, 10
    FROM def, ids
    WHERE NOT EXISTS (
      SELECT 1 FROM public.workflow_transitions t
      WHERE t.workflow_definition_id = def.id AND COALESCE(t.from_status_id,'') = COALESCE(ids.st_new,'') AND t.to_status_id = ids.st_prod
    )
    UNION ALL
    SELECT def.id, ids.st_prod, ids.st_rfi, 20
    FROM def, ids
    WHERE NOT EXISTS (
      SELECT 1 FROM public.workflow_transitions t
      WHERE t.workflow_definition_id = def.id AND COALESCE(t.from_status_id,'') = COALESCE(ids.st_prod,'') AND t.to_status_id = ids.st_rfi
    )
    UNION ALL
    SELECT def.id, ids.st_rfi, ids.st_done, 30
    FROM def, ids
    WHERE NOT EXISTS (
      SELECT 1 FROM public.workflow_transitions t
      WHERE t.workflow_definition_id = def.id AND COALESCE(t.from_status_id,'') = COALESCE(ids.st_rfi,'') AND t.to_status_id = ids.st_done
    )
    RETURNING id, from_status_id, to_status_id
  )
  -- Add an ask_form action for the Production → Ready for installation transition.
  INSERT INTO public.workflow_transition_actions (transition_id, type, config, sort_order, is_required)
  SELECT
    ins.id,
    'ask_form',
    jsonb_build_object(
      'title', 'Schedule installation',
      'description', 'Enter the installation date-time for this order.',
      'fields', jsonb_build_array(
        jsonb_build_object(
          'key', 'installation_scheduled_start_at',
          'label', 'Installation date-time',
          'kind', 'datetime'
        )
      )
    ),
    0,
    TRUE
  FROM ins
  WHERE ins.from_status_id = (SELECT substring(md5('global:ord:builtin:in_production') for 16))
    AND ins.to_status_id = (SELECT substring(md5('global:ord:builtin:ready_for_install') for 16))
    AND NOT EXISTS (
      SELECT 1 FROM public.workflow_transition_actions a
      WHERE a.transition_id = ins.id AND a.type = 'ask_form'
    );
END $$;

