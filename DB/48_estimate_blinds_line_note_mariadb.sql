-- Per-blinds line note on estimates (carried into orders.blinds_lines.line_note on convert).
ALTER TABLE estimate_blinds
  ADD COLUMN line_note TEXT NULL;
