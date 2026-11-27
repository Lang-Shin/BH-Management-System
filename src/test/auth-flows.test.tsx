import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '@/app/providers/auth'
import AcceptPage from '@/features/auth/accept-page'
import MfaPage from '@/features/auth/mfa-page'
import ResetPasswordPage from '@/features/auth/reset-password-page'
import { TenantAccountAccess } from '@/features/tenants/tenant-account-access'
import {
  AuthApiError,
  acceptInvitation,
  challengeMfa,
  enrollMfa,
  getAuthSession,
  getInvitationStatus,
  getMfaStatus,
  createTenantInvitation,
  listAccounts,
  recoverAccount,
  verifyMfa,
  type AuthSession,
} from '@/features/auth/auth-api'

vi.mock('@/features/auth/auth-api', async importOriginal => ({
  ...await importOriginal<typeof import('@/features/auth/auth-api')>(),
  acceptInvitation: vi.fn(), challengeMfa: vi.fn(), enrollMfa: vi.fn(), getAuthSession: vi.fn(),
  getInvitationStatus: vi.fn(), getMfaStatus: vi.fn(), createTenantInvitation: vi.fn(), listAccounts: vi.fn(), recoverAccount: vi.fn(), verifyMfa: vi.fn(),
}))

const ownerAal1: AuthSession = { authenticated: true, role: 'OWNER', aal: 'aal1', tenantId: null, mfaRequired: true, csrfToken: 'csrf', email: 'landlord@example.invalid', emailVerified: false }
const ownerAal2: AuthSession = { ...ownerAal1, aal: 'aal2', mfaRequired: false }

beforeEach(() => {
  vi.mocked(getAuthSession).mockRejectedValue(new AuthApiError('Sign in required', 401, 'UNAUTHENTICATED'))
  vi.mocked(getInvitationStatus).mockReset()
  vi.mocked(acceptInvitation).mockReset()
  vi.mocked(getMfaStatus).mockReset()
  vi.mocked(enrollMfa).mockReset()
  vi.mocked(challengeMfa).mockReset()
  vi.mocked(verifyMfa).mockReset()
  vi.mocked(recoverAccount).mockReset()
  vi.mocked(createTenantInvitation).mockReset()
  vi.mocked(listAccounts).mockReset()
  window.history.replaceState(null, '', '/')
})

function renderRoute(path: string, route: React.ReactNode) {
  window.history.replaceState(null, '', path)
  return render(<AuthProvider><MemoryRouter initialEntries={[path]}><Routes>{route}</Routes></MemoryRouter></AuthProvider>)
}

async function fillAccount(email: string) {
  const user = userEvent.setup()
  await screen.findByRole('heading', { name: /set up your landlord account/i })
  await user.type(screen.getByLabelText('Email address'), email)
  await user.type(screen.getByLabelText('Password', { exact: true }), 'Synthetic-Password-123')
  await user.type(screen.getByLabelText('Confirm password'), 'Synthetic-Password-123')
  return user
}

describe('landlord setup and MFA screens', () => {
  it('validates an invitation, strips the token from the URL, and continues to MFA', async () => {
    vi.mocked(getInvitationStatus).mockResolvedValue({ valid: true, kind: 'LANDLORD_SETUP', state: 'PENDING', expiresAt: '2026-12-01T00:00:00.000Z' })
    vi.mocked(acceptInvitation).mockResolvedValue({ provisioned: true, authenticated: true, role: 'OWNER', aal: 'aal1', csrfToken: 'csrf' })
    renderRoute('/accept?token=private-token', <><Route path="/accept" element={<AcceptPage />} /><Route path="/auth/mfa" element={<p>MFA setup</p>} /></>)
    const user = await fillAccount('landlord@example.invalid')
    expect(window.location.search).toBe('')
    await user.click(screen.getByRole('button', { name: /continue to authenticator/i }))
    expect(await screen.findByText('MFA setup')).toBeVisible()
    expect(acceptInvitation).toHaveBeenCalledWith('private-token', 'landlord@example.invalid', 'Synthetic-Password-123')
  })

  it('blocks mismatched setup passwords and reports invalid invitations safely', async () => {
    vi.mocked(getInvitationStatus).mockResolvedValue({ valid: true, kind: 'TENANT', state: 'PENDING', expiresAt: '2026-12-01T00:00:00.000Z' })
    const view = renderRoute('/accept?token=private-token', <Route path="/accept" element={<AcceptPage />} />)
    const user = userEvent.setup()
    await screen.findByRole('heading', { name: /create your tenant account/i })
    await user.type(screen.getByLabelText('Email address'), 'tenant@example.invalid')
    await user.type(screen.getByLabelText('Password', { exact: true }), 'Synthetic-Password-123')
    await user.type(screen.getByLabelText('Confirm password'), 'Different-Password-123')
    await user.click(screen.getByRole('button', { name: /create account/i }))
    expect(screen.getByText('Passwords do not match.')).toBeVisible()
    expect(acceptInvitation).not.toHaveBeenCalled()
    view.unmount()
    vi.mocked(getInvitationStatus).mockRejectedValue(new AuthApiError('Expired', 410, 'INVITATION_EXPIRED'))
    renderRoute('/accept?token=used', <Route path="/accept" element={<AcceptPage />} />)
    expect(await screen.findByText(/expired or was cancelled/i)).toBeVisible()
  })

  it('enrolls an authenticator locally and only proceeds after verification', async () => {
    vi.mocked(getAuthSession).mockResolvedValue(ownerAal1)
    vi.mocked(getMfaStatus).mockResolvedValue({ enrolled: false, factors: [] })
    vi.mocked(enrollMfa).mockResolvedValue({ id: 'factor-1', totp: { uri: 'otpauth://totp/Halili:landlord?secret=JBSWY3DPEHPK3PXP', secret: 'JBSWY3DPEHPK3PXP' } })
    vi.mocked(challengeMfa).mockResolvedValue({ id: 'challenge-1' })
    vi.mocked(verifyMfa).mockResolvedValue(ownerAal2)
    renderRoute('/auth/mfa', <><Route path="/auth/mfa" element={<MfaPage />} /><Route path="/dashboard" element={<p>Landlord dashboard</p>} /></>)
    await screen.findByRole('heading', { name: /protect your account/i })
    await userEvent.click(screen.getByRole('button', { name: /set up authenticator/i }))
    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeVisible()
    await userEvent.type(screen.getByLabelText('Verification code'), '123456')
    await userEvent.click(screen.getByRole('button', { name: /verify and continue/i }))
    expect(await screen.findByText('Landlord dashboard')).toBeVisible()
    expect(challengeMfa).toHaveBeenCalledWith('factor-1')
    expect(verifyMfa).toHaveBeenCalledWith('factor-1', 'challenge-1', '123456')
  })

  it('generates a tenant invitation from the account access section', async () => {
    vi.mocked(getAuthSession).mockResolvedValue(ownerAal2)
    vi.mocked(listAccounts).mockResolvedValue({ accounts: [], invitations: [] })
    vi.mocked(createTenantInvitation).mockResolvedValue({ invitationId: 'invite-1', inviteUrl: 'https://app.example.com/accept?token=private' })
    const tenant = { id: 'tenant-1', name: 'Tenant One', email: '', phone: '', address: '', notes: '', status: 'ACTIVE' as const }
    render(<AuthProvider><MemoryRouter><TenantAccountAccess tenant={tenant} /></MemoryRouter></AuthProvider>)
    expect(await screen.findByText('No account')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: /generate invitation/i }))
    expect(await screen.findByText(/single-use tenant invitation was created/i)).toBeVisible()
    expect(screen.getByText(/accept\?token=private/)).toBeVisible()
    expect(createTenantInvitation).toHaveBeenCalledWith('tenant-1')
  })

  it('verifies a returning landlord with the enrolled authenticator', async () => {
    vi.mocked(getAuthSession).mockResolvedValue(ownerAal1)
    vi.mocked(getMfaStatus).mockResolvedValue({ enrolled: true, factors: [{ id: 'factor-1', status: 'verified' }] })
    vi.mocked(challengeMfa).mockResolvedValue({ id: 'challenge-returning' })
    vi.mocked(verifyMfa).mockResolvedValue(ownerAal2)
    renderRoute('/auth/mfa', <><Route path="/auth/mfa" element={<MfaPage />} /><Route path="/dashboard" element={<p>Landlord dashboard</p>} /></>)
    expect(await screen.findByRole('heading', { name: /verify your authenticator/i })).toBeVisible()
    await userEvent.type(screen.getByLabelText('Verification code'), '654321')
    await userEvent.click(screen.getByRole('button', { name: /verify and continue/i }))
    expect(await screen.findByText('Landlord dashboard')).toBeVisible()
    expect(challengeMfa).toHaveBeenCalledWith('factor-1')
    expect(verifyMfa).toHaveBeenCalledWith('factor-1', 'challenge-returning', '654321')
  })

  it('completes a valid recovery link and reports success', async () => {
    vi.mocked(getInvitationStatus).mockResolvedValue({ valid: true, kind: 'TENANT_RECOVERY', state: 'PENDING', expiresAt: '2026-12-01T00:00:00.000Z' })
    vi.mocked(recoverAccount).mockResolvedValue({ recovered: true, sessionsRevoked: true })
    renderRoute('/reset-password?token=recovery-token', <Route path="/reset-password" element={<ResetPasswordPage />} />)
    await screen.findByRole('heading', { name: /choose a new password/i })
    await userEvent.type(screen.getByLabelText('New password'), 'New-Synthetic-Password-123')
    await userEvent.type(screen.getByLabelText('Confirm password'), 'New-Synthetic-Password-123')
    await userEvent.click(screen.getByRole('button', { name: /update password/i }))
    expect(await screen.findByRole('heading', { name: /password updated/i })).toBeVisible()
    expect(recoverAccount).toHaveBeenCalledWith('recovery-token', 'New-Synthetic-Password-123')
  })

  it('rejects invalid and expired recovery links without revealing account details', async () => {
    vi.mocked(getInvitationStatus).mockRejectedValue(new AuthApiError('Expired', 410, 'INVITATION_EXPIRED'))
    renderRoute('/reset-password?token=expired', <Route path="/reset-password" element={<ResetPasswordPage />} />)
    expect(await screen.findByText(/expired or was cancelled/i)).toBeVisible()
    expect(screen.queryByText(/landlord@|tenant@/i)).not.toBeInTheDocument()
  })

  it('rejects invitation and recovery links used on the wrong page', async () => {
    vi.mocked(getInvitationStatus).mockResolvedValue({ valid: true, kind: 'TENANT_RECOVERY', state: 'PENDING', expiresAt: '2026-12-01T00:00:00.000Z' })
    const acceptView = renderRoute('/accept?token=wrong-kind', <Route path="/accept" element={<AcceptPage />} />)
    expect(await screen.findByText(/not an account setup invitation/i)).toBeVisible()
    expect(screen.queryByRole('button', { name: /create account|continue to authenticator/i })).not.toBeInTheDocument()
    acceptView.unmount()
    vi.mocked(getInvitationStatus).mockResolvedValue({ valid: true, kind: 'LANDLORD_SETUP', state: 'PENDING', expiresAt: '2026-12-01T00:00:00.000Z' })
    renderRoute('/reset-password?token=wrong-kind', <Route path="/reset-password" element={<ResetPasswordPage />} />)
    expect(await screen.findByText(/not a password recovery link/i)).toBeVisible()
    expect(screen.queryByRole('button', { name: /update password/i })).not.toBeInTheDocument()
  })
})
