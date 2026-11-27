import type { AuthSession } from './auth-api'

export function authDestination(session: AuthSession): string {
  if (session.role === 'TENANT') return '/tenant'
  if (session.role === 'OWNER' || session.role === 'ADMIN') {
    return session.mfaRequired || session.aal !== 'aal2' ? '/auth/mfa' : '/dashboard'
  }
  return '/auth/restricted'
}
