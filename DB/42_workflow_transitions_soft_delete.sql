-- Soft delete for workflow_transitions (Order workflow settings: show deleted / restore).
-- Idempotent.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'workflow_transitions'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'workflow_transitions'
        AND column_name = 'deleted_at'
    ) THEN
      ALTER TABLE public.workflow_transitions
        ADD COLUMN deleted_at timestamptz NULL;
    END IF;

    CREATE INDEX IF NOT EXISTS ix_workflow_transitions_def_active
      ON public.workflow_transitions (workflow_definition_id)
      WHERE deleted_at IS NULL;
  END IF;
END $$;
