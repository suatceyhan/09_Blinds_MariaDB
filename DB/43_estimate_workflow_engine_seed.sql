-- Seed a minimal global Estimate workflow definition + transitions.
-- Idempotent.
--
-- Uses built-in global estimate status ids (see backend global_status_seed.py).
-- Default: New → Pending → (Converted | Cancelled), and New → Cancelled.

DO $$
DECLARE
  def_id uuid;
  st_new varchar(16);
  st_pending varchar(16);
  st_converted varchar(16);
  st_cancelled varchar(16);
BEGIN
  -- Built-in ids
  st_new := '86de9fe2784b1d0e';
  st_pending := 'c9dacb6c04910d38';
  st_converted := 'd75df7e9d38dce9a';
  st_cancelled := 'c840548f67545846';

  -- Ensure global definition exists
  INSERT INTO public.workflow_definitions (company_id, entity_type, code, name, version, is_active)
  SELECT NULL, 'estimate', 'default_estimate', 'Global estimate workflow', 1, TRUE
  WHERE NOT EXISTS (
    SELECT 1 FROM public.workflow_definitions wd
    WHERE wd.company_id IS NULL AND wd.entity_type = 'estimate' AND wd.code = 'default_estimate' AND wd.version = 1
  );

  SELECT id INTO def_id
  FROM public.workflow_definitions
  WHERE company_id IS NULL AND entity_type = 'estimate' AND code = 'default_estimate' AND version = 1
  ORDER BY created_at ASC
  LIMIT 1;

  IF def_id IS NULL THEN
    RAISE NOTICE 'workflow_definitions missing for estimate; skipping seed.';
    RETURN;
  END IF;

  -- Seed transitions (no actions by default)
  INSERT INTO public.workflow_transitions (workflow_definition_id, from_status_id, to_status_id, sort_order, deleted_at)
  SELECT def_id, st_new, st_pending, 10, NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM public.workflow_transitions t
    WHERE t.workflow_definition_id = def_id
      AND COALESCE(t.from_status_id,'') = COALESCE(st_new,'')
      AND t.to_status_id = st_pending
  );

  INSERT INTO public.workflow_transitions (workflow_definition_id, from_status_id, to_status_id, sort_order, deleted_at)
  SELECT def_id, st_pending, st_converted, 20, NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM public.workflow_transitions t
    WHERE t.workflow_definition_id = def_id
      AND COALESCE(t.from_status_id,'') = COALESCE(st_pending,'')
      AND t.to_status_id = st_converted
  );

  INSERT INTO public.workflow_transitions (workflow_definition_id, from_status_id, to_status_id, sort_order, deleted_at)
  SELECT def_id, st_pending, st_cancelled, 30, NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM public.workflow_transitions t
    WHERE t.workflow_definition_id = def_id
      AND COALESCE(t.from_status_id,'') = COALESCE(st_pending,'')
      AND t.to_status_id = st_cancelled
  );

  INSERT INTO public.workflow_transitions (workflow_definition_id, from_status_id, to_status_id, sort_order, deleted_at)
  SELECT def_id, st_new, st_cancelled, 40, NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM public.workflow_transitions t
    WHERE t.workflow_definition_id = def_id
      AND COALESCE(t.from_status_id,'') = COALESCE(st_new,'')
      AND t.to_status_id = st_cancelled
  );
END $$;

