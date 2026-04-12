-- Default sales tax % on company; order tax = taxable base * rate / 100.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS tax_rate_percent NUMERIC(6, 3);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(14, 2);
