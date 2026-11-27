import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '@/app/providers/auth'
import { AppProviders } from '@/app/providers/app-providers'
import { AppearanceProvider } from '@/app/providers/appearance'
import { localStorageRepository } from '@/data/repositories/local-storage-repository'
import SignInPage from '@/features/auth/sign-in-page'
import { AuthCodeField, AuthPasswordConfirmation, AuthProgress } from '@/features/auth/auth-components'
import { AuthPendingPage } from '@/features/auth/auth-pending-page'
import { RequireAuth } from '@/features/auth/require-auth'
import { AuthApiError, getAuthSession, signIn, type AuthSession } from '@/features/auth/auth-api'

vi.mock('@/features/auth/auth-api', async importOriginal => ({
  ...await importOriginal<typeof import('@/features/auth/auth-api')>(),
  getAuthSession: vi.fn(), signIn: vi.fn(), signOut: vi.fn(),
}))

beforeEach(() => {
  vi.mocked(getAuthSession).mockRejectedValue(new AuthApiError('Sign in required', 401, 'UNAUTHENTICATED'))
  vi.mocked(signIn).mockReset()
})

function openSignIn() {
  return render(<AppearanceProvider><AuthProvider><MemoryRouter initialEntries={['/sign-in']}><Routes>
    <Route path="/sign-in" element={<SignInPage />} />
    <Route path="/dashboard" element={<RequireAuth roles={['OWNER']}><p>Authorized dashboard</p></RequireAuth>} />
    <Route path="/tenant" element={<AuthPendingPage kind="tenant" />} />
    <Route path="/auth/mfa" element={<AuthPendingPage kind="mfa" />} />
  </Routes></MemoryRouter></AuthProvider></AppearanceProvider>)
}

async function enterCredentials() {
  const user = userEvent.setup()
  await screen.findByRole('button', { name: /sign in/i })
  await user.type(screen.getByLabelText('Email address'), 'tenant@example.invalid')
  await user.type(screen.getByLabelText('Password', { exact: true }), 'Synthetic password')
  return user
}

describe('authentication UI foundation', () => {
  it('validates required fields and focuses the first error', async () => {
    openSignIn()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /sign in/i }))
    expect(screen.getByText('Enter your email address.')).toBeVisible()
    expect(screen.getByText('Enter your password.')).toBeVisible()
    expect(screen.getByLabelText('Email address')).toHaveFocus()
    expect(signIn).not.toHaveBeenCalled()
  })

  it('toggles password visibility without submitting', async () => {
    openSignIn()
    const user = await enterCredentials()
    const input = screen.getByLabelText('Password', { exact: true })
    expect(input).toHaveAttribute('type', 'password')
    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(input).toHaveAttribute('type', 'text')
    await user.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(input).toHaveAttribute('type', 'password')
    expect(signIn).not.toHaveBeenCalled()
  })

  it('preserves email and clears password after a safe server rejection', async () => {
    vi.mocked(signIn).mockRejectedValue(new AuthApiError('The supplied credentials are not valid.', 401, 'INVALID_CREDENTIALS'))
    openSignIn()
    const user = await enterCredentials()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('The supplied credentials are not valid.')
    expect(screen.getByLabelText('Email address')).toHaveValue('tenant@example.invalid')
    expect(screen.getByLabelText('Password', { exact: true })).toHaveValue('')
    expect(signIn).toHaveBeenCalledWith('tenant@example.invalid', 'Synthetic password')
    expect(localStorage.getItem('password')).toBeNull()
  })

  it('prevents duplicate submissions and keeps loading controls stable', async () => {
    let reject!: (reason: Error) => void
    vi.mocked(signIn).mockImplementation(() => new Promise((_resolve, fail) => { reject = fail }))
    openSignIn()
    await enterCredentials()
    const form = screen.getByRole('button', { name: /^sign in/i }).closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(signIn).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled()
    expect(screen.getByLabelText('Email address')).toBeDisabled()
    await act(async () => reject(new Error('offline')))
    expect(await screen.findByRole('alert')).toHaveTextContent('Please try again')
  })

  it.each([
    ['OWNER', 'aal2', false, 'Authorized dashboard'],
    ['OWNER', 'aal1', true, 'Authenticator verification required'],
    ['OWNER', 'aal1', false, 'Authenticator verification required'],
    ['TENANT', 'aal1', false, 'Your account is signed in'],
  ] as const)('routes %s / %s using server session state', async (role, aal, mfaRequired, heading) => {
    vi.mocked(signIn).mockResolvedValue({ authenticated: true, role, aal, mfaRequired, tenantId: role === 'TENANT' ? 'tenant-1' : null, csrfToken: 'test' } satisfies AuthSession)
    openSignIn()
    const user = await enterCredentials()
    await user.click(screen.getByRole('button', { name: /^sign in/i }))
    expect(await screen.findByText(heading)).toBeVisible()
    if (aal !== 'aal2') expect(screen.queryByText('Authorized dashboard')).not.toBeInTheDocument()
  })

  it('provides accessible confirmation, OTP, and progress primitives', async () => {
    render(<><AuthPasswordConfirmation required /><AuthCodeField hint="Enter six digits." /><AuthProgress steps={['Account', 'Authenticator']} current={1} /></>)
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('autocomplete', 'new-password')
    expect(screen.getByLabelText('Verification code')).toHaveAttribute('inputmode', 'numeric')
    expect(screen.getByLabelText('Verification code')).toHaveAccessibleDescription('Enter six digits.')
    expect(screen.getByText('Authenticator').closest('li')).toHaveAttribute('aria-current', 'step')
  })

  it('redirects unauthenticated protected navigation to sign-in', async () => {
    render(<AuthProvider><MemoryRouter initialEntries={['/dashboard']}><Routes>
      <Route path="/dashboard" element={<RequireAuth roles={['OWNER']}><p>Protected records</p></RequireAuth>} />
      <Route path="/sign-in" element={<SignInPage />} />
    </Routes></MemoryRouter></AuthProvider>)
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeVisible()
    expect(screen.queryByText('Protected records')).not.toBeInTheDocument()
  })

  it('renders public sign-in without mounting the workspace repository', async () => {
    vi.stubEnv('VITE_BHMS_API_BASE_URL', '/api/v1')
    window.history.replaceState(null, '', '/sign-in')
    const load = vi.spyOn(localStorageRepository, 'load')
    try {
      render(<AppProviders><SignInPage /></AppProviders>)
      await waitFor(() => expect(screen.getByRole('button', { name: /^sign in/i })).toBeEnabled())
      expect(load).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
      window.history.replaceState(null, '', '/')
    }
  })
})
