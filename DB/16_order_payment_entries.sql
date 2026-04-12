-- Record each POST /orders/{id}/record-payment for history (amount + timestamp).
-- Run after existing blinds migrations; idempotent.

CREATE TABLE IF NOT EXISTS order_payment_entries (
  id           UUID         NOT NULL DEFAULT gen_random_uuid(),
  company_id   UUID         NOT NULL,
  order_id     VARCHAR(16)  NOT NULL,
  amount       NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id),
  CONSTRAINT fk_order_payment_entries_order
    FOREIGN KEY (company_id, order_id)
    REFERENCES orders (company_id, id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_order_payment_entries_company_order_created
  ON order_payment_entries (company_id, order_id, created_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'order_payment_entries') THEN
    ALTER TABLE public.order_payment_entries ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.order_payment_entries FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_order_payment_entries_isolation ON public.order_payment_entries;
    CREATE POLICY tenant_order_payment_entries_isolation ON public.order_payment_entries
      FOR ALL
      USING (public.rls_company_id_allowed(company_id))
      WITH CHECK (public.rls_company_id_allowed(company_id));
  END IF;
END $$;
