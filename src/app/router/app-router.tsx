import { Navigate, Route, Routes } from 'react-router-dom'
import { AdminShell } from '@/components/layout/admin-shell'
import { TenantShell } from '@/components/layout/tenant-shell'
import { TenantDemoProvider } from '@/app/providers/tenant-demo'
import { RequireAuth } from '@/features/auth/require-auth'
import SignInPage from '@/features/auth/sign-in-page'
import AcceptPage from '@/features/auth/accept-page'
import MfaPage from '@/features/auth/mfa-page'
import ForgotPasswordPage from '@/features/auth/forgot-password-page'
import ResetPasswordPage from '@/features/auth/reset-password-page'
import AccountSecurityPage from '@/features/auth/account-security-page'
import { AuthPendingPage } from '@/features/auth/auth-pending-page'
import { WorkspaceBoundary } from '@/app/providers/workspace-boundary'
import { NotFound } from './not-found'

import Dashboard from '@/features/dashboard/dashboard-page'
import Tenants from '@/features/tenants/tenants-page'
import Rooms from '@/features/rooms/rooms-page'
import Billing from '@/features/billing/billing-page'
import Payments from '@/features/payments/payments-page'
import Reports from '@/features/reports/reports-page'
import TenantOverview from '@/features/tenant/tenant-overview-page'
import TenantPayments from '@/features/tenant/tenant-payments-page'
import TenantRoom from '@/features/tenant/tenant-room-page'

export function AppRouter() {
  return <Routes>
    <Route path="sign-in" element={<SignInPage />} />
    <Route path="auth/mfa" element={<MfaPage />} />
    <Route path="auth/restricted" element={<AuthPendingPage kind="restricted" />} />
    <Route path="forgot-password" element={<ForgotPasswordPage />} />
    <Route path="reset-password" element={<ResetPasswordPage />} />
    <Route path="accept" element={<AcceptPage />} />
    <Route path="account-security" element={<RequireAuth><AccountSecurityPage /></RequireAuth>} />
    <Route element={<RequireAuth roles={['OWNER', 'ADMIN']}><WorkspaceBoundary><AdminShell /></WorkspaceBoundary></RequireAuth>}>
      <Route index element={<Navigate to="/dashboard" replace />} />
      <Route path="dashboard" element={<Dashboard />} />
      <Route path="tenants" element={<Tenants />} />
      <Route path="rooms" element={<Rooms />} />
      <Route path="billing" element={<Billing />} />
      <Route path="payments" element={<Payments />} />
      <Route path="reports" element={<Reports />} />
      <Route path="*" element={<NotFound />} />
    </Route>
    <Route path="tenant" element={<RequireAuth roles={['TENANT']}><WorkspaceBoundary tenant><TenantDemoProvider><TenantShell /></TenantDemoProvider></WorkspaceBoundary></RequireAuth>}>
      <Route index element={<TenantOverview />} />
      <Route path="payments" element={<TenantPayments />} />
      <Route path="room" element={<TenantRoom />} />
      <Route path="*" element={<Navigate to="/tenant" replace />} />
    </Route>
  </Routes>
}
