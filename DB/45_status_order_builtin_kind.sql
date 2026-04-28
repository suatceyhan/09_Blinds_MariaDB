-- Add builtin_kind support to global status_order (align with status_estimate).
-- Enables removing hardcoded order status ids by resolving via builtin_kind.
-- Idempotent.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'status_order'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'status_order' AND column_name = 'builtin_kind'
    ) THEN
      ALTER TABLE public.status_order ADD COLUMN builtin_kind TEXT NULL;
    END IF;

    -- Constraint (safe if already present)
    ALTER TABLE public.status_order DROP CONSTRAINT IF EXISTS ck_status_order_builtin_kind_global;
    ALTER TABLE public.status_order ADD CONSTRAINT ck_status_order_builtin_kind_global CHECK (
      builtin_kind IS NULL
      OR builtin_kind IN ('new', 'ready_for_install', 'in_production', 'done')
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uq_status_order_global_builtin_nn
      ON public.status_order (builtin_kind)
      WHERE builtin_kind IS NOT NULL;

    -- Backfill: prefer known seeded ids (computed) for additional built-ins.
    UPDATE public.status_order
    SET builtin_kind = 'ready_for_install'
    WHERE builtin_kind IS NULL
      AND id = substring(md5('global:ord:builtin:ready_for_install') for 16);

    UPDATE public.status_order
    SET builtin_kind = 'in_production'
    WHERE builtin_kind IS NULL
      AND id = substring(md5('global:ord:builtin:in_production') for 16);

    UPDATE public.status_order
    SET builtin_kind = 'done'
    WHERE builtin_kind IS NULL
      AND id = substring(md5('global:ord:builtin:done') for 16);

    -- Backfill New order by label (legacy global seed uses a non-md5 id).
    UPDATE public.status_order
    SET builtin_kind = 'new'
    WHERE builtin_kind IS NULL
      AND lower(trim(name)) = 'new order';
  END IF;
END $$;

