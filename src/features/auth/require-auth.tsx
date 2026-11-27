import type { ReactNode } from 'react'
import { EmptyState, LoadingState } from '@/components/shared/states'
import { useOptionalAuth } from '@/app/providers/auth'
import type { AuthRole } from './auth-api'
import { Navigate } from 'react-router-dom'
import { authDestination } from './auth-destination'

export function RequireAuth({ children, roles }: { children: ReactNode; roles?: AuthRole[] }) {
  const auth = useOptionalAuth()
  if (!auth || !auth.enabled) return children
  const { status, session, error } = auth
  if (status === 'loading') return <LoadingState />
  if (status === 'unavailable') {
    return <EmptyState title="Authentication unavailable" description={error ?? 'The authentication service is not available right now. Try again shortly.'} />
  }
  if (status !== 'authenticated' || !session) {
    return <Navigate to="/sign-in" replace />
  }
  if (roles && !roles.includes(session.role)) {
    return <Navigate to={authDestination(session)} replace />
  }
  if (session.mfaRequired || ((session.role === 'OWNER' || session.role === 'ADMIN') && session.aal !== 'aal2')) {
    return <Navigate to="/auth/mfa" replace />
  }
  return children
}
