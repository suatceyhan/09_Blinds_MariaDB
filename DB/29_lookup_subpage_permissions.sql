-- Granular Lookups submenu permissions (matrix + API). Legacy ``lookups.view`` / ``lookups.edit`` remain
-- for the hub and backward compatibility; routes accept granular OR legacy.
-- Run after app has seeded permissions at least once, or rely on these INSERTs before first deploy.

INSERT INTO permissions (key, name, parent_key, target_type, target_id, action, module_name, sort_index, is_deleted)
VALUES
  ('lookups.blinds_types.view', 'Lookups / Blinds types — view', NULL, 'module', 'lookups', 'access', 'lookups', 124, FALSE),
  ('lookups.blinds_types.edit', 'Lookups / Blinds types — edit', NULL, 'module', 'lookups', 'access', 'lookups', 125, FALSE),
  ('lookups.order_statuses.view', 'Lookups / Order statuses — view', NULL, 'module', 'lookups', 'access', 'lookups', 126, FALSE),
  ('lookups.order_statuses.edit', 'Lookups / Order statuses — edit', NULL, 'module', 'lookups', 'access', 'lookups', 127, FALSE),
  ('lookups.estimate_statuses.view', 'Lookups / Estimate statuses — view', NULL, 'module', 'lookups', 'access', 'lookups', 128, FALSE),
  ('lookups.estimate_statuses.edit', 'Lookups / Estimate statuses — edit', NULL, 'module', 'lookups', 'access', 'lookups', 129, FALSE),
  ('lookups.product_categories.view', 'Lookups / Product categories — view', NULL, 'module', 'lookups', 'access', 'lookups', 130, FALSE),
  ('lookups.product_categories.edit', 'Lookups / Product categories — edit', NULL, 'module', 'lookups', 'access', 'lookups', 131, FALSE),
  ('lookups.blinds_extra_lifting_system.view', 'Lookups / Lifting system options — view', NULL, 'module', 'lookups', 'access', 'lookups', 132, FALSE),
  ('lookups.blinds_extra_lifting_system.edit', 'Lookups / Lifting system options — edit', NULL, 'module', 'lookups', 'access', 'lookups', 133, FALSE),
  ('lookups.blinds_extra_cassette_type.view', 'Lookups / Cassette type options — view', NULL, 'module', 'lookups', 'access', 'lookups', 134, FALSE),
  ('lookups.blinds_extra_cassette_type.edit', 'Lookups / Cassette type options — edit', NULL, 'module', 'lookups', 'access', 'lookups', 135, FALSE)
ON CONFLICT (key) DO NOTHING;

-- Roles that had broad Lookups view: grant each granular .view
INSERT INTO role_permissions (role_id, permission_id, is_granted, is_deleted)
SELECT rp.role_id, pn.id, TRUE, FALSE
FROM role_permissions rp
JOIN permissions po ON po.id = rp.permission_id AND po.key = 'lookups.view'
JOIN permissions pn ON pn.key IN (
  'lookups.blinds_types.view',
  'lookups.order_statuses.view',
  'lookups.estimate_statuses.view',
  'lookups.product_categories.view',
  'lookups.blinds_extra_lifting_system.view',
  'lookups.blinds_extra_cassette_type.view'
)
WHERE rp.is_deleted IS NOT TRUE AND rp.is_granted IS TRUE
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Same for edit
INSERT INTO role_permissions (role_id, permission_id, is_granted, is_deleted)
SELECT rp.role_id, pn.id, TRUE, FALSE
FROM role_permissions rp
JOIN permissions po ON po.id = rp.permission_id AND po.key = 'lookups.edit'
JOIN permissions pn ON pn.key IN (
  'lookups.blinds_types.edit',
  'lookups.order_statuses.edit',
  'lookups.estimate_statuses.edit',
  'lookups.product_categories.edit',
  'lookups.blinds_extra_lifting_system.edit',
  'lookups.blinds_extra_cassette_type.edit'
)
WHERE rp.is_deleted IS NOT TRUE AND rp.is_granted IS TRUE
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- User overrides: explicit deny on lookups.view → deny all granular views (same role scope)
INSERT INTO user_permissions (user_id, permission_id, role_id, is_granted, is_deleted)
SELECT up.user_id, pn.id, up.role_id, FALSE, FALSE
FROM user_permissions up
JOIN permissions po ON po.id = up.permission_id AND po.key = 'lookups.view'
JOIN permissions pn ON pn.key IN (
  'lookups.blinds_types.view',
  'lookups.order_statuses.view',
  'lookups.estimate_statuses.view',
  'lookups.product_categories.view',
  'lookups.blinds_extra_lifting_system.view',
  'lookups.blinds_extra_cassette_type.view'
)
WHERE up.is_deleted IS NOT TRUE AND up.is_granted IS NOT TRUE
ON CONFLICT (user_id, permission_id, role_id) DO NOTHING;

INSERT INTO user_permissions (user_id, permission_id, role_id, is_granted, is_deleted)
SELECT up.user_id, pn.id, up.role_id, FALSE, FALSE
FROM user_permissions up
JOIN permissions po ON po.id = up.permission_id AND po.key = 'lookups.edit'
JOIN permissions pn ON pn.key IN (
  'lookups.blinds_types.edit',
  'lookups.order_statuses.edit',
  'lookups.estimate_statuses.edit',
  'lookups.product_categories.edit',
  'lookups.blinds_extra_lifting_system.edit',
  'lookups.blinds_extra_cassette_type.edit'
)
WHERE up.is_deleted IS NOT TRUE AND up.is_granted IS NOT TRUE
ON CONFLICT (user_id, permission_id, role_id) DO NOTHING;

-- User overrides: explicit grant on lookups.view → grant granular (so matrix split stays consistent)
INSERT INTO user_permissions (user_id, permission_id, role_id, is_granted, is_deleted)
SELECT up.user_id, pn.id, up.role_id, TRUE, FALSE
FROM user_permissions up
JOIN permissions po ON po.id = up.permission_id AND po.key = 'lookups.view'
JOIN permissions pn ON pn.key IN (
  'lookups.blinds_types.view',
  'lookups.order_statuses.view',
  'lookups.estimate_statuses.view',
  'lookups.product_categories.view',
  'lookups.blinds_extra_lifting_system.view',
  'lookups.blinds_extra_cassette_type.view'
)
WHERE up.is_deleted IS NOT TRUE AND up.is_granted IS TRUE
ON CONFLICT (user_id, permission_id, role_id) DO NOTHING;

INSERT INTO user_permissions (user_id, permission_id, role_id, is_granted, is_deleted)
SELECT up.user_id, pn.id, up.role_id, TRUE, FALSE
FROM user_permissions up
JOIN permissions po ON po.id = up.permission_id AND po.key = 'lookups.edit'
JOIN permissions pn ON pn.key IN (
  'lookups.blinds_types.edit',
  'lookups.order_statuses.edit',
  'lookups.estimate_statuses.edit',
  'lookups.product_categories.edit',
  'lookups.blinds_extra_lifting_system.edit',
  'lookups.blinds_extra_cassette_type.edit'
)
WHERE up.is_deleted IS NOT TRUE AND up.is_granted IS TRUE
ON CONFLICT (user_id, permission_id, role_id) DO NOTHING;
