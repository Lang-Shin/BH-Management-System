import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '@/app/providers/auth'
import { AppRouter } from '@/app/router/app-router'
import { createDemoData, DEMO_DATE } from '@/data/fixtures/demo'
import { getAuthSession, getTenantBootstrap, getTenantRoomChangeOptions, type AuthSession } from '@/features/auth/auth-api'
import { buildTenantBootstrap } from '@/server/tenant-bootstrap'

vi.mock('@/features/auth/auth-api', async importOriginal => ({
  ...await importOriginal<typeof import('@/features/auth/auth-api')>(),
  getAuthSession: vi.fn(), getTenantBootstrap: vi.fn(), getTenantRoomChangeOptions: vi.fn(),
}))

const session: AuthSession = { authenticated: true, role: 'TENANT', aal: 'aal1', tenantId: 'tenant-2', mfaRequired: false, csrfToken: 'csrf', email: 'resident2@example.com', emailVerified: false }
const bootstrap = buildTenantBootstrap(createDemoData(), 5, 'tenant-2', DEMO_DATE, 'Asia/Manila', 'demo-workspace')

beforeEach(() => {
  vi.mocked(getAuthSession).mockResolvedValue(session)
  vi.mocked(getTenantBootstrap).mockResolvedValue(bootstrap)
  vi.mocked(getTenantRoomChangeOptions).mockResolvedValue({
    current: { roomId: 'room-2', name: '2', agreedRentCents: 350_000 },
    options: [{ id: 'room-15', name: '02', floor: 1, kind: 'PRIVATE', capacity: 1, categoryId: 'RATE_5000', monthlyRentCents: 500_000 }],
    requests: [], revision: 5, serverDate: DEMO_DATE,
  })
})

function renderTenant(path = '/tenant') {
  return render(<AuthProvider><MemoryRouter initialEntries={[path]}><AppRouter /></MemoryRouter></AuthProvider>)
}

describe('tenant-scoped server workspace', () => {
  it('mounts the existing tenant UI from the scoped bootstrap without administrator data', async () => {
    renderTenant()
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeVisible()
    expect(screen.getAllByText('Room 2').length).toBeGreaterThan(0)
    expect(screen.getByText('Morgan Cruz')).toBeVisible()
    expect(screen.queryByText('Alex Rivera')).not.toBeInTheDocument()
    expect(screen.queryByText(/Resident4@example.com/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Switch to Landlord UI/i })).not.toBeInTheDocument()
  })

  it('shows scoped shared receipts and no administrator controls', async () => {
    renderTenant('/tenant/payments')
    expect(await screen.findByRole('heading', { level: 1, name: 'My Payments & Receipts' })).toBeVisible()
    expect(screen.queryByText('Tenant management')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Edit Tenant|Delete Tenant|Record payment/i })).not.toBeInTheDocument()
    const main = screen.getByRole('main')
    expect(within(main).queryByText(/resident4@example.com/i)).not.toBeInTheDocument()
  })

  it('offers an eligible room change without exposing landlord controls', async () => {
    renderTenant('/tenant/room')
    expect(await screen.findByRole('heading', { level: 1, name: 'My Room' })).toBeVisible()
    expect(await screen.findByText('Request a room change')).toBeVisible()
    expect(await screen.findByLabelText('Room you want')).toBeVisible()
    expect(screen.queryByRole('button', { name: /Edit Tenant|Delete Tenant|Record payment|Approve transfer/i })).not.toBeInTheDocument()
    expect(getTenantRoomChangeOptions).toHaveBeenCalled()
  })
})
