-- Prospect-only estimates (no customers row until order save), per-line amounts, global order status "Ready for installation".
-- Run after **27_global_status_tables_and_matrix.sql**.

BEGIN;

ALTER TABLE estimate ALTER COLUMN customer_id DROP NOT NULL;

ALTER TABLE estimate ADD COLUMN IF NOT EXISTS prospect_name TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS prospect_surname TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS prospect_phone TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS prospect_email TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS prospect_address TEXT;

ALTER TABLE estimate_blinds ADD COLUMN IF NOT EXISTS line_amount NUMERIC(14, 2);

-- Stable id: md5('global:ord:builtin:ready_for_install') first 16 hex = 4827ac7d03a3c7ae
INSERT INTO public.status_order (id, name, active, sort_order)
VALUES ('4827ac7d03a3c7ae', 'Ready for installation', TRUE, 10)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.company_status_order_matrix (company_id, status_order_id)
SELECT c.id, '4827ac7d03a3c7ae'
FROM public.companies c
WHERE COALESCE(c.is_deleted, FALSE) IS NOT TRUE
ON CONFLICT (company_id, status_order_id) DO NOTHING;

COMMIT;
