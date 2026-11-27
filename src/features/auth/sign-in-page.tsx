import { useRef, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { useAuth } from '@/app/providers/auth'
import { AuthApiError } from './auth-api'
import { authDestination } from './auth-destination'
import { AuthCard, AuthField, AuthLayout, AuthMessage, AuthPasswordField, AuthSubmit } from './auth-components'

export default function SignInPage() {
  const auth = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({})
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const submitting = useRef(false)
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  if (auth.status === 'authenticated' && auth.session) return <Navigate to={authDestination(auth.session)} replace />

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting.current || auth.status === 'loading') return
    const next = {
      email: !email.trim() ? 'Enter your email address.' : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? 'Enter a valid email address.' : undefined,
      password: !password ? 'Enter your password.' : undefined,
    }
    setErrors(next)
    setError(null)
    if (next.email || next.password) {
      if (next.email) emailRef.current?.focus()
      else passwordRef.current?.focus()
      return
    }
    submitting.current = true
    setPending(true)
    try {
      await auth.signIn(email.trim(), password)
    } catch (failure) {
      setError(failure instanceof AuthApiError ? failure.message : 'We couldn’t sign you in. Please try again.')
    } finally {
      setPassword('')
      setPending(false)
      submitting.current = false
    }
  }

  return <AuthLayout><AuthCard title="Welcome back" description="Sign in to your Halili BH account." footer={<p>Need an account? Contact your landlord for an invitation.</p>}>
    <form className="auth-form" noValidate onSubmit={submit} aria-busy={pending}>
      {error && <AuthMessage>{error}</AuthMessage>}
      {auth.status === 'unavailable' && !error && <AuthMessage>{auth.error ?? 'Authentication is temporarily unavailable. You can try signing in again.'}</AuthMessage>}
      <AuthField ref={emailRef} id="sign-in-email" label="Email address" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} required value={email} onChange={event => { setEmail(event.target.value); setErrors(value => ({ ...value, email: undefined })) }} placeholder="you@example.com" error={errors.email} disabled={pending} />
      <AuthPasswordField ref={passwordRef} id="sign-in-password" label="Password" required value={password} onChange={event => { setPassword(event.target.value); setErrors(value => ({ ...value, password: undefined })) }} error={errors.password} disabled={pending} />
      <div className="auth-forgot"><Link className="auth-link" to="/forgot-password">Forgot password?</Link></div>
      <AuthSubmit pending={pending || auth.status === 'loading'} pendingLabel={auth.status === 'loading' ? 'Checking session…' : 'Signing in…'}>Sign in <ArrowRight aria-hidden="true" /></AuthSubmit>
    </form>
  </AuthCard></AuthLayout>
}
