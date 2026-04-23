/**
 * Menu + permission matrix tree (same idea as DWP pageConfig).
 * Keys must match backend `app_nav_permissions.APP_PERMISSION_SEEDS`.
 *
 * Pages: always a .view / .edit pair. Action rows: `showInNav: false`.
 */
export type PagePermissions = { view: string; edit: string }

export type PageConfig = {
  id: string
  name: string
  basePath?: string
  parent?: string
  module: string
  permissions: PagePermissions
  showInNav?: boolean
}

export const appPages: PageConfig[] = [
  {
    id: 'dashboard',
    name: 'Dashboard',
    basePath: '/',
    module: 'dashboard',
    permissions: { view: 'dashboard.view', edit: 'dashboard.edit' },
    showInNav: true,
  },
  {
    id: 'customers-root',
    name: 'Customers',
    basePath: '/customers',
    module: 'customers',
    permissions: { view: 'customers.view', edit: 'customers.edit' },
    showInNav: true,
  },
  {
    id: 'estimates-root',
    name: 'Estimates',
    basePath: '/estimates',
    module: 'estimates',
    permissions: { view: 'estimates.view', edit: 'estimates.edit' },
    showInNav: true,
  },
  {
    id: 'orders-root',
    name: 'Orders',
    basePath: '/orders',
    module: 'orders',
    permissions: { view: 'orders.view', edit: 'orders.edit' },
    showInNav: true,
  },
  {
    id: 'lookups-root',
    name: 'Lookups',
    basePath: '/lookups',
    module: 'lookups',
    permissions: { view: 'lookups.view', edit: 'lookups.edit' },
    showInNav: true,
  },
  {
    id: 'lookups-blinds-types',
    name: 'Blinds types',
    basePath: '/lookups/blinds-types',
    parent: 'lookups-root',
    module: 'lookups',
    permissions: { view: 'lookups.blinds_types.view', edit: 'lookups.blinds_types.edit' },
    showInNav: true,
  },
  {
    id: 'lookups-blinds-product-categories',
    name: 'Product categories',
    basePath: '/lookups/blinds-product-categories',
    parent: 'lookups-root',
    module: 'lookups',
    permissions: { view: 'lookups.product_categories.view', edit: 'lookups.product_categories.edit' },
    showInNav: true,
  },
  {
    id: 'lookups-estimate-statuses',
    name: 'Estimate statuses',
    basePath: '/lookups/estimate-statuses',
    parent: 'lookups-root',
    module: 'settings',
    permissions: {
      view: 'settings.estimate_status_matrix.view',
      edit: 'settings.estimate_status_matrix.edit',
    },
    showInNav: true,
  },
  {
    id: 'lookups-order-statuses',
    name: 'Order statuses',
    basePath: '/lookups/order-statuses',
    parent: 'lookups-root',
    module: 'settings',
    permissions: {
      view: 'settings.order_status_matrix.view',
      edit: 'settings.order_status_matrix.edit',
    },
    showInNav: true,
  },
  {
    id: 'companies-root',
    name: 'Companies',
    basePath: '/companies',
    module: 'companies',
    permissions: { view: 'companies.view', edit: 'companies.edit' },
    showInNav: true,
  },
  {
    id: 'users-root',
    name: 'Users',
    basePath: '/users',
    module: 'users',
    permissions: { view: 'users.directory.view', edit: 'users.directory.edit' },
    showInNav: true,
  },
  {
    id: 'reports-root',
    name: 'Reports',
    basePath: '/reports',
    module: 'reports',
    permissions: { view: 'reports.access.view', edit: 'reports.access.edit' },
    showInNav: true,
  },
  {
    id: 'reports-financial',
    name: 'Financial',
    basePath: '/reports/financial',
    parent: 'reports-root',
    module: 'reports',
    permissions: { view: 'reports.access.view', edit: 'reports.access.edit' },
    showInNav: true,
  },
  {
    id: 'settings-group',
    name: 'Settings',
    basePath: '/settings',
    module: 'settings',
    permissions: { view: 'settings.access.view', edit: 'settings.access.edit' },
    showInNav: true,
  },
  {
    id: 'settings-contract-invoice',
    name: 'Contract/Invoice',
    basePath: '/settings/contract-invoice',
    parent: 'settings-group',
    module: 'settings',
    permissions: { view: 'settings.contract_invoice.view', edit: 'settings.contract_invoice.edit' },
    showInNav: true,
  },
  {
    id: 'permissions-group',
    name: 'Permissions',
    basePath: '/permissions',
    module: 'permissions',
    permissions: { view: 'permissions.access.view', edit: 'permissions.access.edit' },
    showInNav: true,
  },
  {
    id: 'settings-roles',
    name: 'Roles',
    basePath: '/permissions/roles',
    parent: 'permissions-group',
    module: 'settings',
    permissions: { view: 'settings.roles.view', edit: 'settings.roles.edit' },
    showInNav: true,
  },
  {
    id: 'settings-role-matrix',
    name: 'Role permissions',
    basePath: '/permissions/role-matrix',
    parent: 'permissions-group',
    module: 'settings',
    permissions: { view: 'settings.role_matrix.view', edit: 'settings.role_matrix.edit' },
    showInNav: true,
  },
  {
    id: 'settings-user-roles',
    name: 'User roles',
    basePath: '/permissions/user-roles',
    parent: 'permissions-group',
    module: 'settings',
    permissions: { view: 'settings.user_roles.view', edit: 'settings.user_roles.edit' },
    showInNav: true,
  },
  {
    id: 'settings-user-permissions',
    name: 'User permissions',
    basePath: '/permissions/user-permissions',
    parent: 'permissions-group',
    module: 'settings',
    permissions: {
      view: 'settings.user_permissions.view',
      edit: 'settings.user_permissions.edit',
    },
    showInNav: true,
  },
  {
    id: 'settings-pending-applications',
    name: 'Pending applications',
    basePath: '/settings/pending-applications',
    parent: 'settings-group',
    module: 'settings',
    permissions: {
      view: 'settings.pending_applications.view',
      edit: 'settings.pending_applications.edit',
    },
    showInNav: true,
  },
  {
    id: 'settings-company-info',
    name: 'Company info',
    basePath: '/settings/company-info',
    parent: 'settings-group',
    module: 'settings',
    permissions: { view: 'settings.company_info.view', edit: 'settings.company_info.edit' },
    showInNav: true,
  },
  {
    id: 'settings-integrations',
    name: 'Integrations',
    basePath: '/settings/integrations',
    parent: 'settings-group',
    module: 'settings',
    permissions: { view: 'settings.integrations.view', edit: 'settings.integrations.edit' },
    showInNav: true,
  },
  {
    id: 'settings-blinds-line-matrices',
    name: 'Blinds line matrices',
    basePath: '/settings/blinds-line-matrices',
    parent: 'settings-group',
    module: 'settings',
    permissions: {
      view: 'settings.blinds_line_matrices.view',
      edit: 'settings.blinds_line_matrices.edit',
    },
    showInNav: true,
  },
  {
    id: 'account-profile',
    name: 'Profile',
    basePath: '/account',
    module: 'account',
    permissions: { view: 'account.profile.view', edit: 'account.profile.edit' },
    showInNav: false,
  },
  {
    id: 'account-password',
    name: 'Change password',
    basePath: '/account/password',
    module: 'account',
    permissions: { view: 'account.password.view', edit: 'account.password.edit' },
    showInNav: false,
  },
]
