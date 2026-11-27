import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AuthApiError,
  getAuthSession,
  refreshAuthSession,
  signIn as signInRequest,
  signOut as signOutRequest,
  type AuthSession,
} from '@/features/auth/auth-api'

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated' | 'unavailable'

interface AuthContextValue {
  enabled: boolean
  status: AuthStatus
  session: AuthSession | null
  error: string | null
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
  setSession: (session: AuthSession) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

function messageFor(error: unknown): string {
  if (error instanceof AuthApiError) return error.message
  return 'Authentication is temporarily unavailable.'
}

export function AuthProvider({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const [status, setStatus] = useState<AuthStatus>(enabled ? 'loading' : 'anonymous')
  const [session, setSessionState] = useState<AuthSession | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    getAuthSession().then(value => {
      if (cancelled) return
      setSessionState(value)
      setStatus('authenticated')
      setError(null)
    }).catch((failure: unknown) => {
      if (cancelled) return
      if (failure instanceof AuthApiError && (failure.status === 401 || failure.status === 403)) {
        setSessionState(null)
        setStatus('anonymous')
        setError(null)
      } else {
        setSessionState(null)
        setStatus('unavailable')
        setError(messageFor(failure))
      }
    })
    return () => { cancelled = true }
  }, [enabled])

  const signIn = useCallback(async (email: string, password: string) => {
    const value = await signInRequest(email, password)
    setSessionState(value)
    setStatus('authenticated')
    setError(null)
  }, [])

  const signOut = useCallback(async () => {
    try {
      await signOutRequest()
    } finally {
      setSessionState(null)
      setStatus('anonymous')
      setError(null)
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const value = await refreshAuthSession()
      setSessionState(value)
      setStatus('authenticated')
      setError(null)
    } catch (failure) {
      if (failure instanceof AuthApiError && (failure.status === 401 || failure.status === 403)) {
        setSessionState(null)
        setStatus('anonymous')
        setError(null)
      } else {
        setStatus('unavailable')
        setError(messageFor(failure))
      }
    }
  }, [])

  const setSession = useCallback((value: AuthSession) => {
    setSessionState(value)
    setStatus('authenticated')
    setError(null)
  }, [])

  const value = useMemo(() => ({ enabled, status, session, error, signIn, signOut, refresh, setSession }), [enabled, status, session, error, signIn, signOut, refresh, setSession])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used within AuthProvider')
  return value
}

// eslint-disable-next-line react-refresh/only-export-components
export function useOptionalAuth(): AuthContextValue | null {
  return useContext(AuthContext)
}
