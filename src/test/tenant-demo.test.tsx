import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router/app-router'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { TENANT_DEMO_STORAGE_KEY } from '@/app/providers/tenant-demo'
import { localStorageRepository } from '@/data/repositories/local-storage-repository'

function renderTenantApp(route = '/tenant') {
  return render(<PrototypeProvider repository={localStorageRepository}><MemoryRouter initialEntries={[route]}><AppRouter /></MemoryRouter></PrototypeProvider>)
}

function paymentSummary() {
  return screen.getByText('Payment summary').closest('[data-slot="card"]') as HTMLElement
}

describe('demo tenant context', () => {
  it('lists every fictional tenant once using stable ids and defaults to the first active tenant', async () => {
    renderTenantApp()
    const select = await screen.findByLabelText('Preview tenant')
    expect(select).toHaveValue('tenant-1')
    const options = within(select).getAllByRole('option')
    expect(options).toHaveLength(10)
    expect(new Set(options.map(option => (option as HTMLOptionElement).value)).size).toBe(10)
    expect(options.map(option => (option as HTMLOptionElement).value)).toEqual([
      'tenant-1', 'tenant-2', 'tenant-3', 'tenant-4', 'tenant-5',
      'tenant-6', 'tenant-7', 'tenant-8', 'tenant-9', 'tenant-10',
    ])
    expect(within(select).getByRole('option', { name: 'Sam Navarro' })).toHaveValue('tenant-2')
    expect(within(select).getByRole('option', { name: 'Casey Ramos' })).toHaveValue('tenant-7')
    expect(screen.getAllByText('Alex Rivera').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Room 1').length).toBeGreaterThan(0)
    expect(TENANT_DEMO_STORAGE_KEY).toBe('bhms:tenant-demo:v1')
  })

  it('updates the overview, selector summary, and record list when the demo tenant changes', async () => {
    const user = userEvent.setup()
    renderTenantApp()
    const select = await screen.findByLabelText('Preview tenant')
    await user.selectOptions(select, 'tenant-2')
    const main = screen.getByRole('main')
    expect(within(main).getByText('Sam Navarro')).toBeInTheDocument()
    expect(within(main).getByText('Room 2')).toBeInTheDocument()
    expect(select).toHaveValue('tenant-2')
    expect(screen.getAllByText('Sam Navarro').length).toBeGreaterThan(0)
    expect(within(select).getAllByRole('option')).toHaveLength(10)
    expect(localStorage.getItem(TENANT_DEMO_STORAGE_KEY)).toBe('tenant-2')
  })

  it('shares room payment history with both occupants', async () => {
    const user = userEvent.setup()
    renderTenantApp()
    const select = await screen.findByLabelText('Preview tenant')
    await user.selectOptions(select, 'tenant-2')
    expect(within(paymentSummary()).getByText('Nov 12, 2026')).toBeInTheDocument()
    await user.selectOptions(select, 'tenant-4')
    expect(within(screen.getByRole('main')).getByText('Morgan Cruz')).toBeInTheDocument()
    expect(within(screen.getByRole('main')).getByText('Room 2')).toBeInTheDocument()
    expect(within(paymentSummary()).getByText('Nov 12, 2026')).toBeInTheDocument()
    expect(within(paymentSummary()).queryByText('Nov 6, 2026')).not.toBeInTheDocument()
  })

  it('handles moved-out tenants without an assigned room', async () => {
    const user = userEvent.setup()
    renderTenantApp()
    await user.selectOptions(await screen.findByLabelText('Preview tenant'), 'tenant-7')
    const main = screen.getByRole('main')
    expect(within(main).getByText('Casey Ramos')).toBeInTheDocument()
    expect(within(main).getByText('Not assigned')).toBeInTheDocument()
    expect(within(main).getByText('Moved out')).toBeInTheDocument()
    expect(within(main).getByText(/retained historical records/)).toBeInTheDocument()
    expect(screen.getByText('No current room')).toBeInTheDocument()
    expect(within(paymentSummary()).getByText('Nov 2, 2026')).toBeInTheDocument()
    expect(within(paymentSummary()).getAllByText('1')).toHaveLength(2)

    await user.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'My Room' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'My Room' })).toBeInTheDocument()
    expect(screen.getByText('Moved out of Halili BH')).toBeInTheDocument()
    expect(screen.queryByText(/at a glance/)).not.toBeInTheDocument()
  })

  it('persists the demo selection across reloads and workspace switches', async () => {
    const user = userEvent.setup()
    const first = renderTenantApp()
    await user.selectOptions(await screen.findByLabelText('Preview tenant'), 'tenant-3')
    expect(localStorage.getItem(TENANT_DEMO_STORAGE_KEY)).toBe('tenant-3')
    first.unmount()

    renderTenantApp('/tenant/room')
    expect(await screen.findByLabelText('Preview tenant')).toHaveValue('tenant-3')
    expect(within(screen.getByRole('main')).getByText('Room 3 at a glance')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Switch to Landlord UI' }))
    await screen.findByRole('button', { name: 'Switch to Tenant UI' })
    await user.click(screen.getByRole('button', { name: 'Switch to Tenant UI' }))
    expect(await screen.findByLabelText('Preview tenant')).toHaveValue('tenant-3')
    expect(within(screen.getByRole('main')).getByText('Jamie Santos')).toBeInTheDocument()
  })

  it('falls back to the first active tenant when the stored selection is invalid', async () => {
    localStorage.setItem(TENANT_DEMO_STORAGE_KEY, 'tenant-does-not-exist')
    renderTenantApp()
    const select = await screen.findByLabelText('Preview tenant')
    expect(select).toHaveValue('tenant-1')
    expect(within(screen.getByRole('main')).getByText('Alex Rivera')).toBeInTheDocument()
    expect(within(select).getAllByRole('option')).toHaveLength(10)
  })
})
