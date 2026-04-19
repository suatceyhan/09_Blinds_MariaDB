-- Optional preset selection for company_document_templates (built-in HTML per preset key).

ALTER TABLE company_document_templates
  ADD COLUMN IF NOT EXISTS preset_key VARCHAR(64) NULL;
