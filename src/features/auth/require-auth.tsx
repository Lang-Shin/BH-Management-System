import type { ReactNode } from 'react'
import { EmptyState, LoadingState } from '@/components/shared/states'
import { useOptionalAuth } from '@/app/providers/auth'
import type { AuthRole } from './auth-api'

export function RequireAuth({ children, roles }: { children: ReactNode; roles?: AuthRole[] }) {
  const auth = useOptionalAuth()
  if (!auth || !auth.enabled) return children
  const { status, session, error } = auth
  if (status === 'loading') return <LoadingState />
  if (status === 'unavailable') {
    return <EmptyState title="Authentication unavailable" description={error ?? 'The authentication service is not available right now. Try again shortly.'} />
  }
  if (status !== 'authenticated' || !session) {
    return <EmptyState title="Sign in required" description="Sign in to continue. The sign-in screen is implemented in the next frontend phase." />
  }
  if (roles && !roles.includes(session.role)) {
    return <EmptyState title="Not authorized" description="This account does not have access to this area." />
  }
  if (session.mfaRequired) {
    return <EmptyState title="MFA required" description="Landlord access requires authenticator verification. The MFA screen is implemented in the next frontend phase." />
  }
  return children
}
