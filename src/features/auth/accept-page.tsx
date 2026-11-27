import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/app/providers/auth'
import { AuthApiError, getInvitationStatus } from './auth-api'
import { AuthCard, AuthField, AuthLayout, AuthMessage, AuthPasswordConfirmation, AuthPasswordField, AuthProgress, AuthSubmit } from './auth-components'

type Invitation = { kind: string; expiresAt: string }
type State = 'loading' | 'invalid' | 'ready' | 'success'

export default function AcceptPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [token] = useState(() => new URLSearchParams(window.location.search).get('token') ?? '')
  const [state, setState] = useState<State>(token ? 'loading' : 'invalid')
  const [invitation, setInvitation] = useState<Invitation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [errors, setErrors] = useState<{ email?: string; password?: string; confirmation?: string }>({})
  const [pending, setPending] = useState(false)
  const submitting = useRef(false)
  const emailRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!token) return
    window.history.replaceState(null, '', window.location.pathname)
    let cancelled = false
    getInvitationStatus(token).then(value => {
      if (cancelled) return
      if (value.kind !== 'LANDLORD_SETUP' && value.kind !== 'TENANT') {
        setError('This link is not an account setup invitation.')
        setState('invalid')
        return
      }
      setInvitation({ kind: value.kind, expiresAt: value.expiresAt })
      setState('ready')
    }).catch((failure: unknown) => {
      if (cancelled) return
      setError(failure instanceof AuthApiError
        ? failure.code === 'INVITATION_EXPIRED' ? 'This invitation has expired or was cancelled. Ask your landlord for a new link.'
          : failure.code === 'INVITATION_USED' ? 'This invitation has already been used. Sign in or ask your landlord for a new link.'
            : failure.message
        : 'This invitation could not be checked right now.')
      setState('invalid')
    })
    return () => { cancelled = true }
  }, [token])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting.current) return
    const next = {
      email: !email.trim() ? 'Enter your email address.' : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? 'Enter a valid email address.' : undefined,
      password: password.length < 12 ? 'Use at least 12 characters.' : password.length > 128 ? 'Use no more than 128 characters.' : undefined,
      confirmation: confirmation !== password ? 'Passwords do not match.' : undefined,
    }
    setErrors(next)
    setError(null)
    if (next.email || next.password || next.confirmation) {
      if (next.email) emailRef.current?.focus()
      return
    }
    submitting.current = true
    setPending(true)
    try {
      const result = await auth.acceptInvitation(token, email.trim(), password)
      setPassword('')
      setConfirmation('')
      if (result.authenticated) {
        navigate(result.role === 'TENANT' ? '/tenant' : '/auth/mfa', { replace: true })
      } else {
        setState('success')
      }
    } catch (failure) {
      const message = failure instanceof AuthApiError
        ? failure.code === 'IDENTITY_CONFLICT' ? 'That email is already in use. Sign in or contact the landlord.'
          : failure.code === 'INVITATION_USED' ? 'This invitation was already used. Sign in instead.'
            : failure.code === 'INVITATION_EXPIRED' ? 'This invitation has expired. Ask your landlord for a new link.'
              : failure.code === 'AUTH_UNAVAILABLE' ? 'Authentication is temporarily unavailable. Try again shortly.'
                : failure.message
        : 'The account could not be created. Try again.'
      setError(message)
    } finally {
      setPending(false)
      submitting.current = false
    }
  }

  if (state === 'loading') return <AuthLayout><AuthCard title="Checking invitation" description="Please wait while we verify this link."><p role="status" className="text-sm text-muted-foreground">Checking invitation…</p></AuthCard></AuthLayout>
  if (state === 'invalid') return <AuthLayout><AuthCard title="Invitation unavailable" description={error ?? 'This invitation link cannot be used.'}><Link className="auth-link" to="/sign-in">Back to sign in</Link></AuthCard></AuthLayout>
  if (state === 'success') return <AuthLayout><AuthCard title="Account created" description="Your account is ready. Sign in to continue."><Link className="auth-submit inline-flex items-center justify-center" to="/sign-in">Go to sign in</Link></AuthCard></AuthLayout>

  const landlord = invitation?.kind === 'LANDLORD_SETUP'
  return <AuthLayout><AuthCard title={landlord ? 'Set up your landlord account' : 'Create your tenant account'} description={landlord ? 'Choose the email and password you will use to manage Halili BH.' : 'Choose the email and password you will use for your tenant account.'} footer={<p>{landlord ? 'This private setup link can only be used once.' : 'Use the private link from your landlord. Do not share it.'}</p>}>
    {landlord && <AuthProgress steps={['Account', 'Authenticator']} current={0} />}
    <form className="auth-form" noValidate onSubmit={submit} aria-busy={pending}>
      {error && <AuthMessage>{error}</AuthMessage>}
      <AuthField ref={emailRef} label="Email address" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} required value={email} onChange={event => { setEmail(event.target.value); setErrors(value => ({ ...value, email: undefined })) }} error={errors.email} disabled={pending} placeholder="you@example.com" />
      <AuthPasswordField label="Password" autoComplete="new-password" required value={password} onChange={event => { setPassword(event.target.value); setErrors(value => ({ ...value, password: undefined })) }} error={errors.password} hint="Use 12 to 128 characters." disabled={pending} />
      <AuthPasswordConfirmation required value={confirmation} onChange={event => { setConfirmation(event.target.value); setErrors(value => ({ ...value, confirmation: undefined })) }} error={errors.confirmation} disabled={pending} />
      <AuthSubmit pending={pending} pendingLabel="Creating account…">{landlord ? 'Continue to authenticator' : 'Create account'}</AuthSubmit>
    </form>
  </AuthCard></AuthLayout>
}
