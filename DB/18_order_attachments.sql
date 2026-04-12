-- Order files: photos and spreadsheets; soft-delete via is_deleted.

CREATE TABLE IF NOT EXISTS order_attachments (
  id                 UUID         NOT NULL DEFAULT gen_random_uuid(),
  company_id         UUID         NOT NULL,
  order_id           VARCHAR(16)  NOT NULL,
  kind               TEXT         NOT NULL CHECK (kind IN ('photo', 'excel')),
  original_filename  TEXT         NOT NULL,
  stored_relpath     TEXT         NOT NULL,
  content_type       TEXT,
  file_size          BIGINT,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  is_deleted         BOOLEAN      NOT NULL DEFAULT FALSE,
  PRIMARY KEY (id),
  CONSTRAINT fk_order_attachments_order
    FOREIGN KEY (company_id, order_id)
    REFERENCES orders (company_id, id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_order_attachments_company_order
  ON order_attachments (company_id, order_id, created_at DESC)
  WHERE COALESCE(is_deleted, FALSE) = FALSE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'order_attachments') THEN
    ALTER TABLE public.order_attachments ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.order_attachments FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_order_attachments_isolation ON public.order_attachments;
    CREATE POLICY tenant_order_attachments_isolation ON public.order_attachments
      FOR ALL
      USING (public.rls_company_id_allowed(company_id))
      WITH CHECK (public.rls_company_id_allowed(company_id));
  END IF;
END $$;
