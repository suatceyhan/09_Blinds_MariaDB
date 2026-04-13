-- Fourth built-in workflow label: `new` (e.g. display name "New Estimate"), distinct from `pending`.
-- Application seeds this per company; optional backfill in `25_*.sql` (re-run after this if needed).
BEGIN;

ALTER TABLE status_estimate DROP CONSTRAINT IF EXISTS ck_status_estimate_builtin_kind;

ALTER TABLE status_estimate ADD CONSTRAINT ck_status_estimate_builtin_kind
  CHECK (
    builtin_kind IS NULL
    OR builtin_kind IN ('new', 'pending', 'converted', 'cancelled')
  );

COMMIT;
