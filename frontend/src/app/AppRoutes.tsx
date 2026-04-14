import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/app/layout/AppLayout'
import { AccountProfilePage } from '@/features/account/AccountProfilePage'
import { ChangePasswordPage } from '@/features/account/ChangePasswordPage'
import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage'
import { LoginPage } from '@/features/auth/LoginPage'
import { RegisterPage } from '@/features/auth/RegisterPage'
import { DirectRegistrationGate } from '@/features/auth/registration/DirectRegistrationGate'
import { PendingCompanyRegisterPage } from '@/features/auth/registration/PendingCompanyRegisterPage'
import { PendingEmployeeRegisterPage } from '@/features/auth/registration/PendingEmployeeRegisterPage'
import { VerifyEmailPage } from '@/features/auth/registration/VerifyEmailPage'
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage'
import { CompaniesPage } from '@/features/companies/CompaniesPage'
import { CompanyViewPage } from '@/features/companies/CompanyViewPage'
import { CustomersPage } from '@/features/customers/CustomersPage'
import { CustomerViewPage } from '@/features/customers/CustomerViewPage'
import { EstimatesPage } from '@/features/estimates/EstimatesPage'
import { OrdersPage } from '@/features/orders/OrdersPage'
import { EstimateEditPage } from '@/features/estimates/EstimateEditPage'
import { EstimateViewPage } from '@/features/estimates/EstimateViewPage'
import { BlindsExtraOptionsLookupPage } from '@/features/lookups/BlindsExtraOptionsLookupPage'
import { BlindsProductCategoriesLookupPage } from '@/features/lookups/BlindsProductCategoriesLookupPage'
import { BlindsTypesLookupPage } from '@/features/lookups/BlindsTypesLookupPage'
import { LookupsHubPage } from '@/features/lookups/LookupsHubPage'
import { UsersPage } from '@/features/users/UsersPage'
import { UserViewPage } from '@/features/users/UserViewPage'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import {
  ReportsHubPage,
  ReportsOpsPage,
  ReportsQuarterDetailPage,
  ReportsQuarterPage,
} from '@/features/reports/ReportsPages'
import { PermissionsHubPage } from '@/features/settings/PermissionsHubPage'
import { SettingsHubPage } from '@/features/settings/SettingsHubPage'
import { SettingsRoleMatrixPage } from '@/features/settings/SettingsRoleMatrixPage'
import { SettingsRolesPage } from '@/features/settings/SettingsRolesPage'
import { SettingsUserPermissionsPage } from '@/features/settings/SettingsUserPermissionsPage'
import { SettingsPendingApplicationsPage } from '@/features/settings/SettingsPendingApplicationsPage'
import { PermissionsEstimateStatusMatrixPage } from '@/features/settings/PermissionsEstimateStatusMatrixPage'
import { PermissionsOrderStatusMatrixPage } from '@/features/settings/PermissionsOrderStatusMatrixPage'
import { SettingsBlindsLineMatricesPage } from '@/features/settings/SettingsBlindsLineMatricesPage'
import { SettingsCompanyInfoPage } from '@/features/settings/SettingsCompanyInfoPage'
import { SettingsIntegrationsPage } from '@/features/settings/SettingsIntegrationsPage'
import { SettingsUserRolesPage } from '@/features/settings/SettingsUserRolesPage'
import { getAccessToken } from '@/lib/authStorage'

function Protected({ children }: Readonly<{ children: React.ReactNode }>) {
  if (!getAccessToken()) {
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/register/direct" element={<DirectRegistrationGate />} />
      <Route path="/register/employee" element={<PendingEmployeeRegisterPage />} />
      <Route path="/register/company" element={<PendingCompanyRegisterPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        path="/"
        element={
          <Protected>
            <AppLayout />
          </Protected>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="customers/:customerId" element={<CustomerViewPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="estimates/:estimateId/edit" element={<EstimateEditPage />} />
        <Route path="estimates/:estimateId" element={<EstimateViewPage />} />
        <Route path="estimates" element={<EstimatesPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="lookups/blinds-types" element={<BlindsTypesLookupPage />} />
        <Route path="lookups/blinds-product-categories" element={<BlindsProductCategoriesLookupPage />} />
        <Route path="lookups/blinds-extra-options/:kindId" element={<BlindsExtraOptionsLookupPage />} />
        <Route path="lookups/estimate-statuses" element={<PermissionsEstimateStatusMatrixPage />} />
        <Route path="lookups/order-statuses" element={<PermissionsOrderStatusMatrixPage />} />
        <Route path="lookups" element={<LookupsHubPage />} />
        <Route path="companies/:companyId" element={<CompanyViewPage />} />
        <Route path="companies" element={<CompaniesPage />} />
        <Route path="users/:userId" element={<UserViewPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="settings" element={<SettingsHubPage />} />
        <Route path="settings/pending-applications" element={<SettingsPendingApplicationsPage />} />
        <Route path="settings/company-info" element={<SettingsCompanyInfoPage />} />
        <Route path="settings/integrations" element={<SettingsIntegrationsPage />} />
        <Route path="settings/blinds-line-matrices" element={<SettingsBlindsLineMatricesPage />} />
        <Route path="settings/blinds-category-matrix" element={<Navigate to="/settings/blinds-line-matrices" replace />} />
        <Route
          path="settings/blinds-extra-matrix/:kindId"
          element={<Navigate to="/settings/blinds-line-matrices" replace />}
        />
        <Route path="settings/roles" element={<Navigate to="/permissions/roles" replace />} />
        <Route path="settings/role-matrix" element={<Navigate to="/permissions/role-matrix" replace />} />
        <Route path="settings/user-roles" element={<Navigate to="/permissions/user-roles" replace />} />
        <Route path="settings/user-permissions" element={<Navigate to="/permissions/user-permissions" replace />} />
        <Route path="permissions" element={<PermissionsHubPage />} />
        <Route path="permissions/roles" element={<SettingsRolesPage />} />
        <Route path="permissions/role-matrix" element={<SettingsRoleMatrixPage />} />
        <Route path="permissions/user-roles" element={<SettingsUserRolesPage />} />
        <Route path="permissions/user-permissions" element={<SettingsUserPermissionsPage />} />
        <Route path="permissions/estimate-status-matrix" element={<Navigate to="/lookups/estimate-statuses" replace />} />
        <Route path="permissions/order-status-matrix" element={<Navigate to="/lookups/order-statuses" replace />} />
        <Route path="account" element={<AccountProfilePage />} />
        <Route path="account/password" element={<ChangePasswordPage />} />
        <Route path="reports" element={<ReportsHubPage />} />
        <Route path="reports/ops" element={<ReportsOpsPage />} />
        <Route path="reports/ops/quarter" element={<ReportsQuarterPage />} />
        <Route path="reports/ops/quarter/detail" element={<ReportsQuarterDetailPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
