import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/app/providers/auth'
import { getMfaStatus } from './auth-api'
import { authDestination } from './auth-destination'
import { AuthCard, AuthLayout } from './auth-components'

export default function AccountSecurityPage() {
  const auth = useAuth()
  const session = auth.session
  const administrative = session?.role === 'OWNER' || session?.role === 'ADMIN'
  const [mfa, setMfa] = useState<'loading' | 'enrolled' | 'not-enrolled' | 'unavailable'>(administrative ? 'loading' : 'not-enrolled')

  useEffect(() => {
    if (!administrative) return
    let cancelled = false
    getMfaStatus().then(value => { if (!cancelled) setMfa(value.enrolled ? 'enrolled' : 'not-enrolled') })
      .catch(() => { if (!cancelled) setMfa('unavailable') })
    return () => { cancelled = true }
  }, [administrative])

  return <AuthLayout><AuthCard title="Account security" description="Your current authentication details." footer={<p><Link className="auth-link" to={session ? authDestination(session) : '/sign-in'}>Back to workspace</Link></p>}>
    <dl className="mt-6 grid gap-4 text-sm">
      <div><dt className="text-muted-foreground">Email</dt><dd className="mt-1 break-all font-semibold">{session?.email ?? 'Not available'}</dd><dd className="mt-1 text-xs text-muted-foreground">{session?.emailVerified ? 'Verified by the account provider' : 'Stored as unverified (invitation-based account)'}</dd></div>
      <div><dt className="text-muted-foreground">Account type</dt><dd className="mt-1 font-semibold">{session?.role === 'OWNER' || session?.role === 'ADMIN' ? 'Landlord' : session?.role === 'TENANT' ? 'Tenant' : 'Restricted'}</dd></div>
      <div><dt className="text-muted-foreground">Authenticator</dt><dd className="mt-1 font-semibold">{administrative ? mfa === 'loading' ? 'Checking…' : mfa === 'enrolled' ? 'Enrolled' : mfa === 'unavailable' ? 'Status unavailable' : 'Not enrolled' : 'Not required for tenant access'}</dd>{administrative && mfa !== 'enrolled' && <Link className="auth-link mt-2 inline-flex min-h-11 items-center" to="/auth/mfa">Set up authenticator</Link>}</div>
      <div><dt className="text-muted-foreground">Session assurance</dt><dd className="mt-1 font-semibold">{session?.aal === 'aal2' ? 'AAL2 — authenticator verified' : 'AAL1 — password only'}</dd></div>
    </dl>
    <div className="mt-6 grid gap-3">
      <Link className="auth-submit inline-flex items-center justify-center" to={session ? authDestination(session) : '/sign-in'}>Continue to workspace</Link>
      <button type="button" className="auth-link min-h-11" onClick={() => { void auth.signOut().catch(() => {}) }}>Sign out</button>
      {session?.role === 'TENANT' && <p className="text-sm text-muted-foreground">If you lose access, ask your landlord for a single-use recovery link after identity verification.</p>}
      {administrative && <p className="text-sm text-muted-foreground">If you lose your authenticator, contact the verified operator for recovery. You will re-enroll TOTP afterward.</p>}
    </div>
  </AuthCard></AuthLayout>
}
