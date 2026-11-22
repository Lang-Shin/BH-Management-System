import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AppRouter } from '@/app/router/app-router'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { TENANT_DEMO_STORAGE_KEY } from '@/app/providers/tenant-demo'
import { createDemoData } from '@/data/fixtures/demo'
import type { PrototypeRepository } from '@/data/repositories/prototype-repository'
import { localStorageRepository, STORAGE_KEY } from '@/data/repositories/local-storage-repository'

function renderApp(route = '/', repository = localStorageRepository) {
  return render(<PrototypeProvider repository={repository}><MemoryRouter initialEntries={[route]}><AppRouter /></MemoryRouter></PrototypeProvider>)
}

function savedData() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')?.data
}

async function addRoom(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('button', { name: 'Add room' }))
  const dialog = await screen.findByRole('dialog', { name: 'Add a room' })
  await user.type(within(dialog).getByLabelText('Room number or name'), name)
  await user.click(within(dialog).getByRole('button', { name: 'Add room' }))
  const success = await screen.findByRole('dialog', { name: 'Room added successfully' })
  await user.click(within(success).getByRole('button', { name: 'Got it' }))
  await waitFor(() => expect(savedData().rooms.some((room: { name: string }) => room.name === name)).toBe(true))
  return savedData().rooms.find((room: { name: string }) => room.name === name).id as string
}

async function addTenant(user: ReturnType<typeof userEvent.setup>, name: string, roomId: string) {
  await user.click(await screen.findByRole('button', { name: 'Add tenant' }))
  const dialog = await screen.findByRole('dialog', { name: 'Add a tenant' })
  await user.type(within(dialog).getByLabelText('Full name'), name)
  await user.selectOptions(within(dialog).getByLabelText('Room assignment'), roomId)
  await user.click(within(dialog).getByRole('button', { name: 'Add tenant' }))
  const success = await screen.findByRole('dialog', { name: 'Tenant added successfully' })
  await user.click(within(success).getByRole('button', { name: 'Got it' }))
  await waitFor(() => expect(savedData().tenants.some((tenant: { name: string }) => tenant.name === name)).toBe(true))
  return savedData().tenants.find((tenant: { name: string }) => tenant.name === name).id as string
}

async function openClearDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Clear All Records' }))
  return screen.findByRole('dialog', { name: 'Clear all records?' })
}

describe('clear all records', () => {
  it('completes the full lifecycle and preserves room configuration only after confirmation', async () => {
    const user = userEvent.setup()
    const app = renderApp('/rooms')
    const roomId = await addRoom(user, '950')
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    await user.click(within(nav).getByRole('link', { name: 'Tenants' }))
    const tenantId = await addTenant(user, 'Reset Resident', roomId)

    await user.click(within(nav).getByRole('link', { name: 'Billing' }))
    await user.click(await screen.findByRole('button', { name: /Calculate payment/ }))
    let dialog = screen.getByRole('dialog', { name: 'Choose a room and its bills.' })
    await user.selectOptions(within(dialog).getByLabelText('Choose room'), 'room-4')
    await user.click(within(dialog).getByRole('checkbox', { name: 'Rent' }))
    await user.click(within(dialog).getByRole('button', { name: /Review payment/ }))
    dialog = screen.getByRole('dialog', { name: 'Confirm payment received' })
    await user.click(within(dialog).getByRole('button', { name: 'Confirm payment received' }))
    dialog = await screen.findByRole('dialog', { name: 'Payment recorded' })
    await user.click(within(dialog).getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(savedData().payments).toHaveLength(15))
    const paymentId = savedData().payments.find((payment: { id: string }) => payment.id.includes('payment-room-')).id

    await user.click(within(nav).getByRole('link', { name: 'Payments & Receipts' }))
    const transactions = await screen.findByRole('table', { name: 'Transactions' })
    expect(within(transactions).getByRole('row', { name: /BHMS-RCT-015/ })).toBeInTheDocument()
    await user.click(within(within(transactions).getByRole('row', { name: /BHMS-RCT-015/ })).getByRole('button', { name: /See Transaction/ }))
    await user.click(within(screen.getByRole('dialog', { name: 'Transaction Details' })).getByRole('button', { name: 'Edit Payment' }))
    dialog = await screen.findByRole('dialog', { name: 'Correct this transaction.' })
    await user.type(within(dialog).getByLabelText('Reason for correction'), 'Reset lifecycle check')
    await user.click(within(dialog).getByRole('button', { name: /Review Correction/ }))
    dialog = screen.getByRole('dialog', { name: 'Confirm correction' })
    await user.click(within(dialog).getByRole('button', { name: 'Confirm correction' }))
    dialog = await screen.findByRole('dialog', { name: 'Payment corrected' })
    expect(dialog).toHaveTextContent('BHMS-RCT-015-R2')
    await user.click(within(dialog).getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(savedData().paymentCorrections).toHaveLength(1))

    await user.click(screen.getByRole('button', { name: 'Switch to Tenant UI' }))
    await screen.findByRole('heading', { level: 1, name: 'Overview' })
    await user.selectOptions(screen.getByLabelText('Preview tenant'), 'tenant-5')
    await user.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'My Payments & Receipts' }))
    expect(await screen.findByRole('article', { name: 'Receipt BHMS-RCT-015-R2' })).toHaveTextContent('Room 4')

    app.unmount()
    const refreshed = renderApp('/tenant/payments')
    expect(await screen.findByRole('article', { name: 'Receipt BHMS-RCT-015-R2' })).toBeInTheDocument()
    expect(savedData().receipts.some((receipt: { receiptNumber: string }) => receipt.receiptNumber === 'BHMS-RCT-015-R2')).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Switch to Landlord UI' }))
    await screen.findByRole('heading', { level: 1, name: 'Overview' })
    await user.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'Reports & Settings' }))

    dialog = await openClearDialog(user)
    expect(dialog).toHaveTextContent('This permanently removes tenants, occupancy and rental history')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Clear all records?' })).not.toBeInTheDocument())
    expect(savedData().rooms.some((room: { name: string }) => room.name === '950')).toBe(true)
    expect(savedData().payments).toHaveLength(16)
    expect(savedData().paymentCorrections).toHaveLength(1)

    dialog = await openClearDialog(user)
    await user.type(within(dialog).getByLabelText(/Type RESET to confirm/), 'RESET')
    await user.click(within(dialog).getByRole('button', { name: 'Clear All Records' }))
    expect(await screen.findByText('All tenant and financial records were cleared. Room configuration was preserved.')).toBeInTheDocument()
    await waitFor(() => expect(savedData().payments).toHaveLength(0))
    const stored = savedData()
    expect(stored.tenants).toEqual([])
    expect(stored.rooms).toHaveLength(16)
    expect(stored.rooms.some((room: { name: string }) => room.name === '950')).toBe(true)
    expect(stored.tenants.some((tenant: { id: string; name: string }) => tenant.id === tenantId || tenant.name === 'Reset Resident')).toBe(false)
    expect(stored.payments.some((payment: { id: string }) => payment.id === paymentId)).toBe(false)
    expect(stored.receipts.some((receipt: { receiptNumber: string }) => receipt.receiptNumber === 'BHMS-RCT-015-R2')).toBe(false)
    expect(stored.paymentCorrections).toHaveLength(0)
    expect(localStorage.getItem(TENANT_DEMO_STORAGE_KEY)).toBeNull()
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).version).toBe(17)

    refreshed.unmount()
    renderApp('/rooms')
    expect(await screen.findByRole('button', { name: 'Room 1 details' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Room 950 details' })).toBeInTheDocument()
  }, 60000)

  it('does not replace data or claim success when clearing cannot be persisted', async () => {
    const user = userEvent.setup()
    const data = createDemoData()
    data.rooms.push({ ...data.rooms[0]!, id: 'room-custom', name: 'Custom Room' })
    const save = vi.fn<PrototypeRepository['save']>().mockResolvedValue('Simulated reset failure.')
    renderApp('/reports', { load: async () => ({ data, warning: null, canPersist: true }), save })
    const dialog = await openClearDialog(user)
    await user.type(within(dialog).getByLabelText(/Type RESET to confirm/), 'RESET')
    await user.click(within(dialog).getByRole('button', { name: 'Clear All Records' }))
    expect(await within(dialog).findByText(/Records were not cleared\./)).toHaveTextContent('Simulated reset failure.')
    expect(screen.queryByText('All tenant and financial records were cleared. Room configuration was preserved.')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await user.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'Rooms' }))
    expect(await screen.findByRole('button', { name: 'Room Custom Room details' })).toBeInTheDocument()
    expect(save).toHaveBeenCalled()
  }, 20000)
})
