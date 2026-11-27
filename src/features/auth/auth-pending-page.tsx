import { Link } from 'react-router-dom'
import { useOptionalAuth } from '@/app/providers/auth'
import { Button } from '@/components/ui/button'
import { AuthCard, AuthLayout } from './auth-components'

export function AuthPendingPage({ kind }: { kind: 'mfa' | 'recovery' | 'tenant' | 'restricted' | 'setup' }) {
  const auth = useOptionalAuth()
  const content = {
    mfa: ['Authenticator verification required', 'Landlord access stays locked until you verify your authenticator. The MFA enrollment and verification screens are being prepared.'],
    recovery: ['Need help signing in?', 'Tenants: contact your landlord to verify your identity and receive a recovery link. Landlord: contact your verified operator. The recovery form is being prepared.'],
    tenant: ['Your account is signed in', 'Your account is recognized. The secure tenant workspace connection is being prepared. No landlord records are available from this page.'],
    restricted: ['Access is restricted', 'This account does not have access to the workspace. Contact your landlord for help.'],
    setup: ['Account setup is being prepared', 'Keep your invitation link private. The secure invitation and initial setup forms will be available in the next frontend phase.'],
  }[kind]
  return <AuthLayout><AuthCard title={content[0]!} description={content[1]!}>
    <div className="mt-6 flex flex-wrap gap-3">{auth?.status === 'authenticated' ? <Button variant="outline" onClick={() => { void auth.signOut().catch(() => {}) }}>Sign out</Button> : <Link to="/sign-in" className="auth-link">Back to sign in</Link>}</div>
  </AuthCard></AuthLayout>
}
