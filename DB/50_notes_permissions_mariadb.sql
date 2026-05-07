-- Backfill permission keys for Notes menu (existing databases) — MariaDB.
-- Notes keys are seeded at startup, but this script allows manual backfill.

START TRANSACTION;

INSERT INTO permissions (id, `key`, `name`, parent_key, target_type, target_id, `action`, module_name, sort_index, is_deleted)
SELECT UUID(), 'notes.view', 'Notes — view', NULL, 'module', 'notes', 'access', 'notes', 28, FALSE
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE `key` = 'notes.view');

INSERT INTO permissions (id, `key`, `name`, parent_key, target_type, target_id, `action`, module_name, sort_index, is_deleted)
SELECT UUID(), 'notes.edit', 'Notes — edit', NULL, 'module', 'notes', 'access', 'notes', 29, FALSE
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE `key` = 'notes.edit');

-- Auto-grant missing rows to superadmin only (insert-only).
INSERT INTO role_permissions (role_id, permission_id, is_granted, is_deleted)
SELECT r.id, p.id, TRUE, FALSE
FROM roles r
JOIN permissions p ON p.`key` IN ('notes.view', 'notes.edit') AND p.is_deleted <> TRUE
WHERE r.name = 'superadmin' AND r.is_deleted <> TRUE
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

COMMIT;

