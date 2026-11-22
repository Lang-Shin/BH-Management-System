import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router/app-router'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { localStorageRepository, STORAGE_KEY } from '@/data/repositories/local-storage-repository'
import { createDemoData, DEMO_DATE } from '@/data/fixtures/demo'

function renderApp(route = '/') {
  return render(<PrototypeProvider repository={localStorageRepository}><MemoryRouter initialEntries={[route]}><AppRouter /></MemoryRouter></PrototypeProvider>)
}

async function addTenant(user: ReturnType<typeof userEvent.setup>, { name, roomId }: { name: string; roomId?: string }) {
  await user.click(await screen.findByRole('button', { name: 'Add tenant' }))
  const dialog = await screen.findByRole('dialog', { name: 'Add a tenant' })
  await user.type(within(dialog).getByLabelText('Full name'), name)
  if (roomId) await user.selectOptions(within(dialog).getByLabelText('Room assignment'), roomId)
  await user.click(within(dialog).getByRole('button', { name: 'Add tenant' }))
  const success = await screen.findByRole('dialog', { name: 'Tenant added successfully' })
  await user.click(within(success).getByRole('button', { name: 'Got it' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
}

describe('tenant management UI', { timeout: 15000 }, () => {
  it('validates and adds a tenant without a room, then persists after a remount', async () => {
    const user = userEvent.setup()
    const app = renderApp('/tenants')
    await user.click(await screen.findByRole('button', { name: 'Add tenant' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add a tenant' })
    expect(dialog).not.toHaveTextContent('Nothing is saved yet')

    await user.click(within(dialog).getByRole('button', { name: 'Add tenant' }))
    expect(within(dialog).getByText('Enter the tenant’s full name.')).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Full name'), 'Test Tenant')
    await user.type(within(dialog).getByLabelText('Email address'), 'bad-email')
    await user.click(within(dialog).getByRole('button', { name: 'Add tenant' }))
    expect(within(dialog).getByText(/valid email/)).toBeInTheDocument()
    await user.clear(within(dialog).getByLabelText('Email address'))
    await user.type(within(dialog).getByLabelText('Phone number'), 'not-a-phone')
    await user.click(within(dialog).getByRole('button', { name: 'Add tenant' }))
    expect(within(dialog).getByText(/valid phone/)).toBeInTheDocument()
    await user.clear(within(dialog).getByLabelText('Phone number'))
    await user.click(within(dialog).getByRole('button', { name: 'Add tenant' }))

    const success = await screen.findByRole('dialog', { name: 'Tenant added successfully' })
    expect(success).toHaveTextContent('Tenant Test Tenant was added and saved')
    await user.click(within(success).getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText('Test Tenant')).toBeInTheDocument()
    expect(screen.getByText(/Showing/, { selector: 'p[role="status"]' })).toHaveTextContent('8 of 8 tenants')
    expect(screen.getByText('Showing 1–8 of 8 tenants')).toBeInTheDocument()
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null').data
      expect(saved.tenants).toHaveLength(11)
      expect(saved.tenants.find((tenant: { name: string }) => tenant.name === 'Test Tenant')).toMatchObject({ status: 'ACTIVE' })
    })

    app.unmount()
    renderApp('/tenants')
    expect(await screen.findByText('Test Tenant')).toBeInTheDocument()
  })

  it('assigns an available room, blocks full or repaired rooms, and updates Room Details', async () => {
    const user = userEvent.setup()
    renderApp('/tenants')
    await user.click(await screen.findByRole('button', { name: 'Add tenant' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add a tenant' })
    await user.type(within(dialog).getByLabelText('Full name'), 'Room Seven Tenant')
    await user.selectOptions(within(dialog).getByLabelText('Room assignment'), 'room-2')
    await user.click(within(dialog).getByRole('button', { name: 'Add tenant' }))
    expect(within(dialog).getByText(/This room would exceed its capacity on/) ).toBeInTheDocument()
    await user.selectOptions(within(dialog).getByLabelText('Room assignment'), 'room-6')
    await user.click(within(dialog).getByRole('button', { name: 'Add tenant' }))
    expect(within(dialog).getByText('This room is under repair and cannot accept a tenant.')).toBeInTheDocument()
    await user.selectOptions(within(dialog).getByLabelText('Room assignment'), 'room-7')
    await user.click(within(dialog).getByRole('button', { name: 'Add tenant' }))
    const success = await screen.findByRole('dialog', { name: 'Tenant added successfully' })
    await user.click(within(success).getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('row', { name: /Room Seven Tenant/ })).toHaveTextContent('Room 7')
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null').data
      const tenant = saved.tenants.find((item: { name: string }) => item.name === 'Room Seven Tenant')
      expect(saved.roomAssignments.find((assignment: { tenantId: string }) => assignment.tenantId === tenant.id)).toMatchObject({ roomId: 'room-7', startDate: DEMO_DATE, endDate: null })
    })

    await user.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'Rooms' }))
    const roomCard = await screen.findByRole('button', { name: 'Room 7 details' })
    expect(roomCard).toHaveTextContent('Room Seven Tenant')
  })

  it('loads existing tenant values, edits safely, and keeps the stable ID and billing history', async () => {
    const user = userEvent.setup()
    const original = createDemoData()
    renderApp('/tenants')
    await user.click(await screen.findByRole('button', { name: 'View Alex Rivera' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Alex Rivera' })).getByRole('button', { name: 'Edit Tenant' }))
    let dialog = screen.getByRole('dialog', { name: 'Edit Tenant Alex Rivera' })
    expect(within(dialog).getByLabelText('Full name')).toHaveValue('Alex Rivera')
    expect(within(dialog).getByLabelText('Email address')).toHaveValue('resident1@example.com')
    expect(within(dialog).getByLabelText('Phone number')).toHaveValue('DEMO +63 000 000 0001')
    expect(within(dialog).getByLabelText('Room assignment')).toHaveValue('room-1')
    expect(within(dialog).getByLabelText('Move-in date')).toHaveValue('2026-09-01')

    await user.clear(within(dialog).getByLabelText('Full name'))
    await user.type(within(dialog).getByLabelText('Full name'), 'Alex Rivera Updated')
    await user.clear(within(dialog).getByLabelText('Email address'))
    await user.type(within(dialog).getByLabelText('Email address'), 'alex.updated@example.com')
    await user.type(within(dialog).getByLabelText('Notes'), 'Updated tenant note')
    await user.click(within(dialog).getByRole('button', { name: 'Save Tenant' }))
    dialog = await screen.findByRole('dialog', { name: 'Alex Rivera Updated' })
    expect(dialog).toHaveTextContent('alex.updated@example.com')
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null').data
      expect(saved.tenants.find((tenant: { id: string }) => tenant.id === 'tenant-1')).toMatchObject({ name: 'Alex Rivera Updated', email: 'alex.updated@example.com', status: 'ACTIVE' })
      expect(saved.charges).toEqual(original.charges)
      expect(saved.payments).toEqual(original.payments)
      expect(saved.receipts).toEqual(original.receipts)
    })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('row', { name: /Alex Rivera Updated/ })).toHaveTextContent('Room 1')
  })

  it('transfers a tenant to another room and updates occupancy without rewriting history', async () => {
    const user = userEvent.setup()
    const original = createDemoData()
    renderApp('/tenants')
    await user.click(await screen.findByRole('button', { name: 'View Alex Rivera' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Alex Rivera' })).getByRole('button', { name: 'Edit Tenant' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit Tenant Alex Rivera' })
    await user.selectOptions(within(dialog).getByLabelText('Room assignment'), 'room-7')
    expect(within(dialog).getByLabelText('Move-in date')).toHaveValue(DEMO_DATE)
    await user.click(within(dialog).getByRole('button', { name: 'Save Tenant' }))
    await screen.findByRole('dialog', { name: 'Alex Rivera' })
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null').data
      const oldAssignment = saved.roomAssignments.find((assignment: { id: string }) => assignment.id === 'assignment-1')
      const newAssignment = saved.roomAssignments.find((assignment: { tenantId: string; roomId: string }) => assignment.tenantId === 'tenant-1' && assignment.roomId === 'room-7')
      expect(oldAssignment.endDate).toBe('2026-11-12')
      expect(newAssignment).toMatchObject({ startDate: DEMO_DATE, endDate: null })
      expect(saved.charges).toEqual(original.charges)
      expect(saved.payments).toEqual(original.payments)
      expect(saved.receipts).toEqual(original.receipts)
    })
    await user.click(within(screen.getByRole('dialog', { name: 'Alex Rivera' })).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('row', { name: /Alex Rivera/ })).toHaveTextContent('Room 7')
    await user.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'Rooms' }))
    expect(await screen.findByRole('button', { name: 'Room 7 details' })).toHaveTextContent('Alex Rivera')
  })

  it('deletes an eligible tenant after confirmation and cancellation', async () => {
    const user = userEvent.setup()
    const app = renderApp('/tenants')
    await addTenant(user, { name: 'Delete Me' })
    await user.click(screen.getByRole('button', { name: 'View Delete Me' }))
    let dialog = screen.getByRole('dialog', { name: 'Delete Me' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete Tenant' }))
    dialog = screen.getByRole('dialog', { name: 'Delete Tenant Delete Me' })
    expect(dialog).toHaveTextContent('No current room')
    expect(dialog).toHaveTextContent('This tenant has no room assignment, bills, payments, receipts, credits, or outstanding balance.')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await screen.findByRole('dialog', { name: 'Delete Me' })
    await user.click(within(screen.getByRole('dialog', { name: 'Delete Me' })).getByRole('button', { name: 'Delete Tenant' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Delete Tenant Delete Me' })).getByRole('button', { name: 'Delete Tenant' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText('Tenant Delete Me was deleted.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'View Delete Me' })).not.toBeInTheDocument()
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null').data
      expect(saved.tenants.some((tenant: { name: string }) => tenant.name === 'Delete Me')).toBe(false)
    })
    app.unmount()
    renderApp('/tenants')
    expect(await screen.findByText('Alex Rivera')).toBeInTheDocument()
    expect(screen.queryByText('Delete Me')).not.toBeInTheDocument()
  })

  it('blocks permanent deletion for financial history and archives the tenant instead', async () => {
    const user = userEvent.setup()
    const original = createDemoData()
    renderApp('/tenants')
    await user.click(await screen.findByRole('button', { name: 'View Alex Rivera' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Alex Rivera' })).getByRole('button', { name: 'Delete Tenant' }))
    let dialog = screen.getByRole('dialog', { name: 'Delete Tenant Alex Rivera' })
    expect(dialog).toHaveTextContent('This tenant cannot be permanently deleted.')
    expect(dialog).toHaveTextContent('room assignment history')
    expect(dialog).toHaveTextContent('issued bill history')
    expect(within(dialog).getByRole('button', { name: 'Delete Tenant' })).toBeDisabled()
    await user.click(within(dialog).getByRole('button', { name: 'Move Out Instead' }))
    dialog = screen.getByRole('dialog', { name: 'Move Out / Archive Alex Rivera' })
    expect(within(dialog).getByRole('button', { name: 'Move Out / Archive' })).toBeEnabled()
    await user.click(within(dialog).getByRole('button', { name: 'Move Out / Archive' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText('Tenant Alex Rivera was moved out. Historical bills and receipts remain available.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'View Alex Rivera' })).not.toBeInTheDocument()
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null').data
      expect(saved.tenants.find((tenant: { id: string }) => tenant.id === 'tenant-1').status).toBe('MOVED_OUT')
      expect(saved.roomAssignments.find((assignment: { id: string }) => assignment.id === 'assignment-1').endDate).toBe('2026-11-12')
      expect(saved.payments).toEqual(original.payments)
      expect(saved.receipts).toEqual(original.receipts)
    })
    await user.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'Rooms' }))
    expect(await screen.findByRole('button', { name: 'Room 1 details' })).toHaveTextContent('Available · 0 current tenants')
  })

  it('blocks move-out while unresolved advance credit exists', async () => {
    const user = userEvent.setup()
    renderApp('/tenants')
    await user.click(await screen.findByRole('button', { name: 'View Jordan Flores' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Jordan Flores' })).getByRole('button', { name: 'Move Out / Archive' }))
    const dialog = screen.getByRole('dialog', { name: 'Move Out / Archive Jordan Flores' })
    expect(dialog).toHaveTextContent('advance credit')
    expect(within(dialog).getByRole('button', { name: 'Move Out / Archive' })).toBeDisabled()
  })
})
