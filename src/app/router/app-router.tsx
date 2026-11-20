import { Navigate, Route, Routes } from 'react-router-dom'
import { AdminShell } from '@/components/layout/admin-shell'
import { TenantShell } from '@/components/layout/tenant-shell'
import { NotFound } from './not-found'

import Dashboard from '@/features/dashboard/dashboard-page'
import Tenants from '@/features/tenants/tenants-page'
import Rooms from '@/features/rooms/rooms-page'
import Billing from '@/features/billing/billing-page'
import Payments from '@/features/payments/payments-page'
import Reports from '@/features/reports/reports-page'
import TenantHome from '@/features/tenant/tenant-home-page'

export function AppRouter() {
  return <Routes>
    <Route element={<AdminShell />}>
      <Route index element={<Navigate to="/dashboard" replace />} />
      <Route path="dashboard" element={<Dashboard />} />
      <Route path="tenants" element={<Tenants />} />
      <Route path="rooms" element={<Rooms />} />
      <Route path="billing" element={<Billing />} />
      <Route path="payments" element={<Payments />} />
      <Route path="reports" element={<Reports />} />
      <Route path="*" element={<NotFound />} />
    </Route>
    <Route path="tenant" element={<TenantShell />}>
      <Route index element={<TenantHome />} />
      <Route path="*" element={<Navigate to="/tenant" replace />} />
    </Route>
  </Routes>
}
