import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router/app-router'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { localStorageRepository } from '@/data/repositories/local-storage-repository'

function renderTenantApp(route = '/tenant') {
  return render(<PrototypeProvider repository={localStorageRepository}><MemoryRouter initialEntries={[route]}><AppRouter /></MemoryRouter></PrototypeProvider>)
}

describe('tenant workspace layout', () => {
  it('shows the sample tenant overview with existing fictional data only', async () => {
    renderTenantApp()
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument()
    expect(screen.getByText('Alex Rivera')).toBeInTheDocument()
    expect(screen.getAllByText('Room 101').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0)
    expect(screen.getAllByText('November 2026').length).toBeGreaterThan(0)
    expect(screen.getByText('Current open billing period.')).toBeInTheDocument()
    expect(screen.getByText(/previews one fictional tenant’s existing records/)).toBeInTheDocument()
    expect(screen.getByText(/Tenant sign-in is not part of this phase/)).toBeInTheDocument()
  })

  it('summarizes the sample tenant payments without inventing values', async () => {
    renderTenantApp()
    const summaryCard = await screen.findByText('Payment summary').then(title => title.closest('[data-slot="card"]') as HTMLElement)
    expect(within(summaryCard).getByText('Payments made')).toBeInTheDocument()
    expect(within(summaryCard).getByText('Receipts issued')).toBeInTheDocument()
    expect(within(summaryCard).getByText('Last payment')).toBeInTheDocument()
    expect(within(summaryCard).getAllByText('₱0.00')).toHaveLength(2)
    expect(within(summaryCard).getByText('Clear')).toBeInTheDocument()
    expect(within(summaryCard).getByRole('link', { name: /View My Payments & Receipts/ })).toHaveAttribute('href', '/tenant/payments')
  })

  it('highlights only the active tenant navigation item on every tenant route', async () => {
    const user = userEvent.setup()
    renderTenantApp()
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' })
    expect(within(nav).getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'My Payments & Receipts' })).not.toHaveAttribute('aria-current')
    expect(within(nav).getByRole('link', { name: 'My Room' })).not.toHaveAttribute('aria-current')

    await user.click(within(nav).getByRole('link', { name: 'My Payments & Receipts' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'My Payments & Receipts' })).toBeInTheDocument()
    const paymentsNav = screen.getByRole('navigation', { name: 'Main navigation' })
    expect(within(paymentsNav).getByRole('link', { name: 'My Payments & Receipts' })).toHaveAttribute('aria-current', 'page')
    expect(within(paymentsNav).getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current')

    await user.click(within(paymentsNav).getByRole('link', { name: 'My Room' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'My Room' })).toBeInTheDocument()
    const roomNav = screen.getByRole('navigation', { name: 'Main navigation' })
    expect(within(roomNav).getByRole('link', { name: 'My Room' })).toHaveAttribute('aria-current', 'page')
    expect(within(roomNav).getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current')
  })

  it('shows the payments placeholder without building tenant receipts yet', async () => {
    renderTenantApp('/tenant/payments')
    expect(await screen.findByRole('heading', { level: 1, name: 'My Payments & Receipts' })).toBeInTheDocument()
    expect(screen.getByText('Tenant receipts are coming soon')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/Receipt viewing arrives in a later phase/)
  })

  it('shows the sample tenant room details without landlord controls', async () => {
    renderTenantApp('/tenant/room')
    const card = await screen.findByText('Room 101 at a glance').then(title => title.closest('[data-slot="card"]') as HTMLElement)
    expect(within(card).getByText('Floor 1')).toBeInTheDocument()
    expect(within(card).getByText('Stay started')).toBeInTheDocument()
    expect(within(card).getAllByText('Occupied').length).toBeGreaterThan(0)
    expect(within(card).getByText('Shared-capacity room')).toBeInTheDocument()
    expect(within(card).getByText('Included')).toBeInTheDocument()
    expect(screen.getByText('More room details are coming soon')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Edit Room|Delete Room|Add Room/ })).not.toBeInTheDocument()
  })

  it('keeps landlord management controls out of every tenant route and switches back', async () => {
    const user = userEvent.setup()
    for (const route of ['/tenant', '/tenant/payments', '/tenant/room']) {
      const view = renderTenantApp(route)
      expect(await screen.findByRole('button', { name: 'Switch to Landlord UI' })).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Billing' })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Tenants' })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Reports & Settings' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Add Room' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Calculate payment/ })).not.toBeInTheDocument()
      view.unmount()
    }

    renderTenantApp('/tenant')
    await user.click(await screen.findByRole('button', { name: 'Switch to Landlord UI' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'Rooms' })).toBeInTheDocument()
  })
})
