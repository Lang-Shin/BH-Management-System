import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/app/providers/auth'
import { AuthApiError, getInvitationStatus, recoverAccount } from './auth-api'
import { AuthCard, AuthLayout, AuthMessage, AuthPasswordConfirmation, AuthPasswordField, AuthSubmit } from './auth-components'

type State = 'loading' | 'invalid' | 'ready' | 'success'

export default function ResetPasswordPage() {
  const auth = useAuth()
  const [token] = useState(() => new URLSearchParams(window.location.search).get('token') ?? '')
  const [state, setState] = useState<State>(token ? 'loading' : 'invalid')
  const [error, setError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [errors, setErrors] = useState<{ password?: string; confirmation?: string }>({})
  const [pending, setPending] = useState(false)
  const submitting = useRef(false)

  useEffect(() => {
    if (!token) return
    window.history.replaceState(null, '', window.location.pathname)
    let cancelled = false
    getInvitationStatus(token).then(value => {
      if (cancelled) return
      if (value.kind !== 'LANDLORD_RECOVERY' && value.kind !== 'TENANT_RECOVERY') {
        setError('This link is not a password recovery link.')
        setState('invalid')
        return
      }
      setState('ready')
    }).catch((failure: unknown) => {
      if (cancelled) return
      setError(failure instanceof AuthApiError
        ? failure.code === 'INVITATION_EXPIRED' ? 'This recovery link has expired or was cancelled. Ask for a new link.'
          : failure.code === 'INVITATION_USED' ? 'This recovery link has already been used. Sign in or ask for a new link.'
            : failure.message
        : 'This recovery link could not be checked right now.')
      setState('invalid')
    })
    return () => { cancelled = true }
  }, [token])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting.current) return
    const next = {
      password: password.length < 12 ? 'Use at least 12 characters.' : password.length > 128 ? 'Use no more than 128 characters.' : undefined,
      confirmation: confirmation !== password ? 'Passwords do not match.' : undefined,
    }
    setErrors(next)
    setError(null)
    if (next.password || next.confirmation) return
    submitting.current = true
    setPending(true)
    try {
      await recoverAccount(token, password)
      setPassword('')
      setConfirmation('')
      setState('success')
    } catch (failure) {
      setError(failure instanceof AuthApiError
        ? failure.code === 'INVITATION_USED' || failure.code === 'INVITATION_EXPIRED' ? 'This recovery link is no longer available. Ask for a new link.'
          : failure.code === 'AUTH_UNAVAILABLE' ? 'Authentication is temporarily unavailable. Try again shortly.'
            : failure.message
        : 'Password recovery could not be completed.')
    } finally {
      setPending(false)
      submitting.current = false
    }
  }

  if (state === 'loading') return <AuthLayout><AuthCard title="Checking recovery link" description="Please wait while we verify this link."><p role="status" className="text-sm text-muted-foreground">Checking recovery link…</p></AuthCard></AuthLayout>
  if (state === 'invalid') return <AuthLayout><AuthCard title="Recovery link unavailable" description={error ?? 'This recovery link cannot be used.'}><Link className="auth-link" to="/sign-in">Back to sign in</Link></AuthCard></AuthLayout>
  if (state === 'success') return <AuthLayout><AuthCard title="Password updated" description={auth.session?.role === 'OWNER' ? 'Your password was reset. Sign in and re-enroll your authenticator.' : 'Your password was reset. Sign in with the new password.'}><Link className="auth-submit inline-flex items-center justify-center" to="/sign-in">Go to sign in</Link></AuthCard></AuthLayout>

  return <AuthLayout><AuthCard title="Choose a new password" description="Enter a new password for your Halili BH account." footer={<p>Only you choose this password. Recovery links are single-use.</p>}>
    <form className="auth-form" noValidate onSubmit={submit} aria-busy={pending}>
      {error && <AuthMessage>{error}</AuthMessage>}
      <AuthPasswordField label="New password" autoComplete="new-password" required value={password} onChange={event => { setPassword(event.target.value); setErrors(value => ({ ...value, password: undefined })) }} error={errors.password} hint="Use 12 to 128 characters." disabled={pending} />
      <AuthPasswordConfirmation required value={confirmation} onChange={event => { setConfirmation(event.target.value); setErrors(value => ({ ...value, confirmation: undefined })) }} error={errors.confirmation} disabled={pending} />
      <AuthSubmit pending={pending} pendingLabel="Updating password…">Update password</AuthSubmit>
    </form>
  </AuthCard></AuthLayout>
}
