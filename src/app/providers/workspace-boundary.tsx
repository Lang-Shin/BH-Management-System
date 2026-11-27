import type { ReactNode } from 'react'
import { useOptionalAuth } from '@/app/providers/auth'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { createApiRepository } from '@/data/repositories/api-repository'
import { AuthPendingPage } from '@/features/auth/auth-pending-page'

const adminRepository = createApiRepository()

/** Public auth routes never mount the workspace repository. Tenant UI awaits its scoped adapter. */
export function WorkspaceBoundary({ children, tenant = false }: { children: ReactNode; tenant?: boolean }) {
  const auth = useOptionalAuth()
  if (!auth?.enabled) return children
  if (tenant) return <AuthPendingPage kind="tenant" />
  return <PrototypeProvider key={auth.session?.role} repository={adminRepository}>{children}</PrototypeProvider>
}
