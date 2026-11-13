import { lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AdminShell } from '@/components/layout/admin-shell'
import { NotFound } from './not-found'

const Dashboard = lazy(() => import('@/features/dashboard/dashboard-page'))
const Tenants = lazy(() => import('@/features/tenants/tenants-page'))
const Rooms = lazy(() => import('@/features/rooms/rooms-page'))
const Billing = lazy(() => import('@/features/billing/billing-page'))
const Payments = lazy(() => import('@/features/payments/payments-page'))
const Reports = lazy(() => import('@/features/reports/reports-page'))

export function AppRouter() {
  return <Routes><Route element={<AdminShell />}>
    <Route index element={<Navigate to="/dashboard" replace />} />
    <Route path="dashboard" element={<Dashboard />} />
    <Route path="tenants" element={<Tenants />} />
    <Route path="rooms" element={<Rooms />} />
    <Route path="billing" element={<Billing />} />
    <Route path="payments" element={<Payments />} />
    <Route path="reports" element={<Reports />} />
    <Route path="*" element={<NotFound />} />
  </Route></Routes>
}
