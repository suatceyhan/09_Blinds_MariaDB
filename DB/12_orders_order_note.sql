-- Free-text note on the order (internal / customer-facing at team discretion).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_note TEXT;
