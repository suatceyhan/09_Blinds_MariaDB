-- Notes / Reminders (tenant-scoped, soft delete) — MariaDB
--
-- - Notes and reminders share the same table.
-- - A note becomes a reminder when `due_at` is set.
-- - Soft-delete via `is_deleted`.

START TRANSACTION;

CREATE TABLE IF NOT EXISTS notes (
  id          CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  company_id  CHAR(36) NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  due_at      DATETIME(6),
  created_by  CHAR(36) NULL,
  is_deleted  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_notes_company
    FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE RESTRICT,
  CONSTRAINT fk_notes_created_by
    FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE INDEX idx_notes_company_created_at
  ON notes (company_id, created_at DESC);
CREATE INDEX idx_notes_company_due_at
  ON notes (company_id, due_at);

-- Ensure `updated_at` is maintained consistently with other tables.
DELIMITER $$
DROP TRIGGER IF EXISTS tr_notes_updated_at$$
CREATE TRIGGER tr_notes_updated_at
BEFORE UPDATE ON notes
FOR EACH ROW
BEGIN
  SET NEW.updated_at = CURRENT_TIMESTAMP(6);
END$$
DELIMITER ;

COMMIT;

