import { lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AdminShell } from '@/components/layout/admin-shell'
import { NotFound } from '@/pages/not-found'

const Dashboard = lazy(() => import('@/pages/dashboard'))
const Tenants = lazy(() => import('@/pages/tenants'))
const Rooms = lazy(() => import('@/pages/rooms'))
const Billing = lazy(() => import('@/pages/billing'))
const Payments = lazy(() => import('@/pages/payments'))
const Reports = lazy(() => import('@/pages/reports'))

export function App() {
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
