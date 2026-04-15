-- Settings → Contract/Invoice permissions (view/edit).
--
-- Adds new permission rows and grants them to roles that already have Settings access,
-- so existing deployments pick up the new submenu without manual backfills.

INSERT INTO permissions (key, name, parent_key, target_type, target_id, action, module_name, sort_index, is_deleted)
VALUES
  ('settings.contract_invoice.view', 'Settings — Contract / Invoice — view', NULL, 'module', 'settings', 'access', 'settings', 88, FALSE),
  ('settings.contract_invoice.edit', 'Settings — Contract / Invoice — edit', NULL, 'module', 'settings', 'access', 'settings', 89, FALSE)
ON CONFLICT (key) DO NOTHING;

-- Grant to any role that can view Settings (keeps existing customizations intact by only inserting missing pairs).
INSERT INTO role_permissions (role_id, permission_id, is_granted, is_deleted)
SELECT
  rp.role_id,
  p_new.id,
  TRUE,
  FALSE
FROM role_permissions rp
JOIN permissions p_settings ON p_settings.id = rp.permission_id AND p_settings.key = 'settings.access.view'
JOIN permissions p_new ON p_new.key IN ('settings.contract_invoice.view', 'settings.contract_invoice.edit')
LEFT JOIN role_permissions exists_rp
  ON exists_rp.role_id = rp.role_id AND exists_rp.permission_id = p_new.id
WHERE rp.is_deleted IS NOT TRUE AND rp.is_granted IS TRUE
  AND exists_rp.role_id IS NULL;

