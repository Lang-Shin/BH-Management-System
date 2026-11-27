import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Copy } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useAuth } from '@/app/providers/auth'
import { AuthApiError, challengeMfa, enrollMfa, getMfaStatus } from './auth-api'
import { AuthCard, AuthCodeField, AuthLayout, AuthMessage, AuthProgress, AuthSubmit } from './auth-components'

type Enrollment = { id: string; uri: string; secret?: string }

export default function MfaPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [status, setStatus] = useState<'loading' | 'enrollment' | 'challenge' | 'unavailable'>('loading')
  const [factorId, setFactorId] = useState('')
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const submitting = useRef(false)

  useEffect(() => {
    if (!auth.enabled || auth.status !== 'authenticated' || !auth.session) return
    let cancelled = false
    getMfaStatus().then(value => {
      if (cancelled) return
      const verified = value.factors.find(factor => factor.status === 'verified' && factor.id)
      if (verified?.id) {
        setFactorId(verified.id)
        setStatus('challenge')
      } else {
        setStatus('enrollment')
      }
    }).catch(() => { if (!cancelled) setStatus('unavailable') })
    return () => { cancelled = true }
  }, [auth.enabled, auth.status, auth.session])

  if (!auth.enabled) return <Navigate to="/sign-in" replace />
  if (auth.status === 'loading') return <AuthLayout><AuthCard title="Checking session" description="Please wait while we verify your session."><p role="status" className="text-sm text-muted-foreground">Checking session…</p></AuthCard></AuthLayout>
  if (auth.status !== 'authenticated' || !auth.session) return <Navigate to="/sign-in" replace />
  if (auth.session.role === 'TENANT') return <Navigate to="/tenant" replace />
  if (auth.session.role !== 'OWNER' && auth.session.role !== 'ADMIN') return <Navigate to="/auth/restricted" replace />
  if (auth.session.aal === 'aal2') return <Navigate to="/dashboard" replace />

  const beginEnrollment = async () => {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const factor = await enrollMfa()
      setEnrollment({ id: factor.id, uri: factor.totp.uri, secret: factor.totp.secret })
    } catch (failure) {
      setError(failure instanceof AuthApiError ? failure.message : 'Authenticator setup could not be started.')
    } finally {
      setPending(false)
    }
  }

  const copySecret = async () => {
    if (!enrollment?.secret) return
    try {
      await navigator.clipboard.writeText(enrollment.secret)
      setNotice('Setup key copied.')
    } catch {
      setError('Could not copy the setup key. Select it manually.')
    }
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting.current || code.length !== 6) {
      if (code.length !== 6) setError('Enter the six-digit code from your authenticator.')
      return
    }
    submitting.current = true
    setPending(true)
    setError(null)
    setNotice(null)
    try {
      const activeFactor = enrollment?.id ?? factorId
      if (!activeFactor) throw new Error('No authenticator factor is available.')
      const challenge = await challengeMfa(activeFactor)
      await auth.completeMfa(activeFactor, challenge.id, code)
      navigate('/dashboard', { replace: true })
    } catch (failure) {
      setCode('')
      setError(failure instanceof AuthApiError && failure.code === 'MFA_FAILED'
        ? 'That code was not accepted. Check the current code and try again.'
        : failure instanceof AuthApiError ? failure.message : 'Verification could not be completed.')
    } finally {
      setPending(false)
      submitting.current = false
    }
  }

  if (status === 'loading') return <AuthLayout><AuthCard title="Preparing authenticator" description="Checking your account security."><p role="status" className="text-sm text-muted-foreground">Checking authenticator status…</p></AuthCard></AuthLayout>
  if (status === 'unavailable') return <AuthLayout><AuthCard title="Authenticator unavailable" description="The authentication service could not be reached. Try again shortly."><div className="grid gap-2"><button type="button" className="auth-link min-h-11" onClick={() => window.location.reload()}>Try again</button><button type="button" className="auth-link min-h-11" onClick={() => { void auth.signOut().catch(() => {}) }}>Sign out</button></div></AuthCard></AuthLayout>

  return <AuthLayout><AuthCard title={status === 'enrollment' ? 'Protect your account' : 'Verify your authenticator'} description={status === 'enrollment' ? 'Set up one authenticator app for landlord access.' : 'Enter the current six-digit code from your authenticator app.'} footer={<p><Link className="auth-link" to="/forgot-password">Need recovery help?</Link></p>}>
    <AuthProgress steps={['Password', 'Authenticator']} current={1} />
    {status === 'enrollment' && !enrollment && <div className="mt-5"><p className="text-sm leading-relaxed text-muted-foreground">Use Google Authenticator, Microsoft Authenticator, 1Password, or another TOTP-compatible app. This setup happens only on your device.</p><div className="mt-5"><AuthSubmit pending={pending} pendingLabel="Preparing setup…" onClick={event => { event.preventDefault(); void beginEnrollment() }}>Set up authenticator</AuthSubmit></div></div>}
    {status === 'enrollment' && enrollment && <div className="mt-5 grid gap-5">
      <div className="flex justify-center rounded-2xl border bg-white p-4"><QRCodeSVG value={enrollment.uri} size={190} level="M" marginSize={2} bgColor="#ffffff" fgColor="#1d4a35" title="Authenticator QR code" /></div>
      <p className="text-sm leading-relaxed text-muted-foreground">Scan the QR code, or enter this setup key manually if the QR code cannot be scanned.</p>
      {enrollment.secret && <div className="grid gap-2"><code className="break-all rounded-xl border bg-muted/50 p-3 text-center text-sm">{enrollment.secret}</code><button type="button" className="auth-link mx-auto inline-flex min-h-11 items-center gap-2" onClick={copySecret}><Copy aria-hidden="true" className="size-4" />Copy setup key</button></div>}
      {notice && <AuthMessage tone="success">{notice}</AuthMessage>}
      <form className="auth-form" onSubmit={submit}>{error && <AuthMessage>{error}</AuthMessage>}<AuthCodeField required value={code} onChange={event => { setCode(event.target.value.replace(/\D/g, '').slice(0, 6)); setError(null) }} hint="Paste or type the six-digit code." disabled={pending} autoFocus /><AuthSubmit pending={pending} pendingLabel="Verifying…">Verify and continue</AuthSubmit></form>
    </div>}
    {status === 'challenge' && <form className="auth-form" onSubmit={submit}>{error && <AuthMessage>{error}</AuthMessage>}<AuthCodeField required value={code} onChange={event => { setCode(event.target.value.replace(/\D/g, '').slice(0, 6)); setError(null) }} hint="Paste or type the six-digit code." disabled={pending} autoFocus /><AuthSubmit pending={pending} pendingLabel="Verifying…">Verify and continue</AuthSubmit></form>}
    <div className="mt-5 text-sm"><button type="button" className="auth-link" onClick={() => { void auth.signOut().catch(() => {}) }}>Sign out</button></div>
  </AuthCard></AuthLayout>
}
