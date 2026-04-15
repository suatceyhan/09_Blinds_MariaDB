-- Per-company editable HTML templates for Contract / Invoice documents.

CREATE TABLE IF NOT EXISTS company_document_templates (
  company_id   UUID NOT NULL REFERENCES companies (id),
  kind         VARCHAR(64) NOT NULL, -- deposit_contract | final_invoice
  subject      VARCHAR(300) NOT NULL DEFAULT '',
  body_html    TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted   BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT pk_company_document_templates PRIMARY KEY (company_id, kind)
);

