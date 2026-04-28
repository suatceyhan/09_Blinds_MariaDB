-- Backfill permission seeds: Settings / Estimate workflow
-- Adds missing permission keys to `permissions` and grants them to superadmin (missing pairs only).

DO $$
DECLARE
  p_view uuid;
  p_edit uuid;
  r_super uuid;
BEGIN
  -- Insert permission rows if missing
  INSERT INTO permissions (key, name, parent_key, target_type, target_id, action, module_name, sort_index, is_deleted)
  SELECT 'settings.estimate_workflow.view', 'Estimate workflow — view', NULL, 'module', 'settings', 'access', 'settings', 74, FALSE
  WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE key = 'settings.estimate_workflow.view');

  INSERT INTO permissions (key, name, parent_key, target_type, target_id, action, module_name, sort_index, is_deleted)
  SELECT 'settings.estimate_workflow.edit', 'Estimate workflow — edit', NULL, 'module', 'settings', 'access', 'settings', 75, FALSE
  WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE key = 'settings.estimate_workflow.edit');

  SELECT id INTO p_view FROM permissions WHERE key = 'settings.estimate_workflow.view' LIMIT 1;
  SELECT id INTO p_edit FROM permissions WHERE key = 'settings.estimate_workflow.edit' LIMIT 1;
  SELECT id INTO r_super FROM roles WHERE name = 'superadmin' AND is_deleted IS NOT TRUE LIMIT 1;

  IF r_super IS NOT NULL AND p_view IS NOT NULL THEN
    INSERT INTO role_permissions (role_id, permission_id, is_granted, is_deleted)
    SELECT r_super, p_view, TRUE, FALSE
    WHERE NOT EXISTS (
      SELECT 1 FROM role_permissions WHERE role_id = r_super AND permission_id = p_view
    );
  END IF;

  IF r_super IS NOT NULL AND p_edit IS NOT NULL THEN
    INSERT INTO role_permissions (role_id, permission_id, is_granted, is_deleted)
    SELECT r_super, p_edit, TRUE, FALSE
    WHERE NOT EXISTS (
      SELECT 1 FROM role_permissions WHERE role_id = r_super AND permission_id = p_edit
    );
  END IF;
END $$;

