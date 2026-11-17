import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router/app-router'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { localStorageRepository, STORAGE_KEY } from '@/data/repositories/local-storage-repository'
import { createDemoData } from '@/data/fixtures/demo'

function renderApp(route = '/') {
  return render(<PrototypeProvider repository={localStorageRepository}><MemoryRouter initialEntries={[route]}><AppRouter /></MemoryRouter></PrototypeProvider>)
}

describe('room management UI', () => {
  it('adds a room with validation, updates counts, and persists after a remount', async () => {
    const user = userEvent.setup()
    const app = renderApp('/rooms')
    await user.click(await screen.findByRole('button', { name: 'Add room' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add a room' })
    expect(within(dialog).queryByLabelText('Floor')).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Add room' }))
    expect(within(dialog).getByText('Enter a room number or name.')).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Room number or name'), '101')
    await user.click(within(dialog).getByRole('button', { name: 'Add room' }))
    expect(within(dialog).getByText('That room number or name is already in use.')).toBeInTheDocument()

    await user.clear(within(dialog).getByLabelText('Room number or name'))
    await user.type(within(dialog).getByLabelText('Room number or name'), '116')
    await user.clear(within(dialog).getByLabelText('Number of beds'))
    await user.type(within(dialog).getByLabelText('Number of beds'), '0')
    await user.click(within(dialog).getByRole('button', { name: 'Add room' }))
    expect(within(dialog).getByText('Enter a whole number of beds greater than zero.')).toBeInTheDocument()

    await user.clear(within(dialog).getByLabelText('Number of beds'))
    await user.type(within(dialog).getByLabelText('Number of beds'), '2')
    await user.selectOptions(within(dialog).getByLabelText('Monthly rental rate'), 'RATE_4000')
    await user.selectOptions(within(dialog).getByLabelText('Room type'), 'SHARED')
    await user.selectOptions(within(dialog).getByLabelText('Room status'), 'available')
    await user.click(within(dialog).getByRole('button', { name: 'Add room' }))

    const success = await screen.findByRole('dialog', { name: 'Room added successfully' })
    expect(success).toHaveTextContent('Room 116 was added and saved to the room list.')
    await user.click(within(success).getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const card = await screen.findByRole('button', { name: 'Room 116 details' })
    expect(card).toHaveTextContent('Available — 0 tenants')
    expect(card).toHaveTextContent('₱4,000.00/month')
    await waitFor(() => expect(screen.getByText(/rooms total/).closest('p')).toHaveTextContent('16 rooms total'))
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null').data
      expect(saved.rooms).toHaveLength(16)
      const createdRoom = saved.rooms.find((room: { name: string }) => room.name === '116')
      expect(createdRoom).toMatchObject({ floor: 1, capacity: 2, kind: 'SHARED', categoryId: 'RATE_4000', status: 'available', washingMachineEnabled: false })
      expect(saved.roomAssignments.some((assignment: { roomId: string }) => assignment.roomId === createdRoom.id)).toBe(false)
    })

    app.unmount()
    renderApp('/rooms')
    expect(await screen.findByRole('button', { name: 'Room 116 details' })).toBeInTheDocument()
  })

  it('edits an empty room with prefilled values and without a Floor field', async () => {
    const user = userEvent.setup()
    renderApp('/rooms')
    await user.click(await screen.findByRole('button', { name: 'Room 106 details' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Room 106' })).getByRole('button', { name: 'Edit Room' }))
    let dialog = screen.getByRole('dialog', { name: 'Edit Room 106' })
    expect(within(dialog).getByLabelText('Room number or name')).toHaveValue('106')
    expect(within(dialog).getByLabelText('Number of beds')).toHaveValue(1)
    expect(within(dialog).getByLabelText('Monthly rental rate')).toHaveValue('RATE_3500')
    expect(within(dialog).getByLabelText('Room type')).toHaveValue('PRIVATE')
    expect(within(dialog).getByLabelText('Room status')).toHaveValue('maintenance')
    expect(within(dialog).queryByLabelText('Floor')).not.toBeInTheDocument()

    await user.clear(within(dialog).getByLabelText('Room number or name'))
    await user.type(within(dialog).getByLabelText('Room number or name'), '101')
    await user.click(within(dialog).getByRole('button', { name: 'Save Room' }))
    expect(within(dialog).getByText('That room number or name is already in use.')).toBeInTheDocument()

    await user.clear(within(dialog).getByLabelText('Room number or name'))
    await user.type(within(dialog).getByLabelText('Room number or name'), '206')
    await user.clear(within(dialog).getByLabelText('Number of beds'))
    await user.type(within(dialog).getByLabelText('Number of beds'), '2')
    await user.selectOptions(within(dialog).getByLabelText('Monthly rental rate'), 'RATE_4000')
    await user.selectOptions(within(dialog).getByLabelText('Room type'), 'SHARED')
    await user.selectOptions(within(dialog).getByLabelText('Room status'), 'available')
    await user.click(within(dialog).getByRole('button', { name: 'Save Room' }))

    dialog = await screen.findByRole('dialog', { name: 'Room 206' })
    expect(dialog).toHaveTextContent('₱4,000.00/month')
    expect(screen.getByText('Room 206 was updated.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Room 206 details' })).toBeInTheDocument()
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null').data
      expect(saved.rooms.find((room: { id: string }) => room.id === 'room-6')).toMatchObject({ name: '206', capacity: 2, kind: 'SHARED', categoryId: 'RATE_4000', status: 'available' })
    })
  })

  it('keeps occupied-room safeguards and historical bills when the rate changes', async () => {
    const user = userEvent.setup()
    const original = createDemoData()
    renderApp('/rooms')
    await user.click(await screen.findByRole('button', { name: 'Room 102 details' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Room 102' })).getByRole('button', { name: 'Edit Room' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit Room 102' })
    expect(within(dialog).getByLabelText('Room status')).toHaveValue('Occupied')
    expect(within(dialog).getByLabelText('Room status')).toHaveAttribute('readonly')
    expect(within(dialog).queryByRole('option', { name: 'Available' })).not.toBeInTheDocument()

    await user.clear(within(dialog).getByLabelText('Number of beds'))
    await user.type(within(dialog).getByLabelText('Number of beds'), '1')
    await user.click(within(dialog).getByRole('button', { name: 'Save Room' }))
    expect(within(dialog).getByText(/2 assigned tenants/)).toBeInTheDocument()

    await user.clear(within(dialog).getByLabelText('Number of beds'))
    await user.type(within(dialog).getByLabelText('Number of beds'), '2')
    await user.clear(within(dialog).getByLabelText('Room number or name'))
    await user.type(within(dialog).getByLabelText('Room number or name'), '101')
    await user.click(within(dialog).getByRole('button', { name: 'Save Room' }))
    expect(within(dialog).getByText('That room number or name is already in use.')).toBeInTheDocument()

    await user.clear(within(dialog).getByLabelText('Room number or name'))
    await user.type(within(dialog).getByLabelText('Room number or name'), '102')
    await user.selectOptions(within(dialog).getByLabelText('Monthly rental rate'), 'RATE_4000')
    await user.click(within(dialog).getByRole('button', { name: 'Save Room' }))
    await screen.findByRole('dialog', { name: 'Room 102' })
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null').data
      expect(saved.rooms.find((room: { id: string }) => room.id === 'room-2').categoryId).toBe('RATE_4000')
      expect(saved.charges).toEqual(original.charges)
      expect(saved.roomAssignments).toEqual(original.roomAssignments)
      expect(saved.payments).toEqual(original.payments)
    })
  })

  it('deletes an eligible room after confirmation and keeps it deleted after remount', async () => {
    const user = userEvent.setup()
    const app = renderApp('/rooms')
    await user.click(await screen.findByRole('button', { name: 'Room 106 details' }))
    let dialog = screen.getByRole('dialog', { name: 'Room 106' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete Room' }))
    dialog = screen.getByRole('dialog', { name: 'Delete Room 106' })
    expect(dialog).toHaveTextContent('Delete Room 106?')
    expect(dialog).toHaveTextContent('no tenant assignments, bills, payments, receipts, meter history')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByRole('dialog', { name: 'Room 106' })).toBeInTheDocument()

    await user.click(within(screen.getByRole('dialog', { name: 'Room 106' })).getByRole('button', { name: 'Delete Room' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Delete Room 106' })).getByRole('button', { name: 'Delete Room' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText('Room 106 was deleted.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Room 106 details' })).not.toBeInTheDocument()
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null').data
      expect(saved.rooms).toHaveLength(14)
      expect(saved.rooms.some((room: { id: string }) => room.id === 'room-6')).toBe(false)
    })

    app.unmount()
    renderApp('/rooms')
    expect(await screen.findByRole('button', { name: 'Room 101 details' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Room 106 details' })).not.toBeInTheDocument()
  })

  it('blocks deleting an occupied room', async () => {
    const user = userEvent.setup()
    renderApp('/rooms')
    await user.click(await screen.findByRole('button', { name: 'Room 101 details' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Room 101' })).getByRole('button', { name: 'Delete Room' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete Room 101' })
    expect(dialog).toHaveTextContent('This room cannot be deleted yet.')
    expect(dialog).toHaveTextContent('This room is occupied')
    expect(within(dialog).getByRole('button', { name: 'Delete Room' })).toBeDisabled()
  })

  it('blocks deleting an empty room with retained financial history', async () => {
    const user = userEvent.setup()
    renderApp('/rooms')
    await user.click(await screen.findByRole('button', { name: 'Room 105 details' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Room 105' })).getByRole('button', { name: 'Delete Room' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete Room 105' })
    expect(dialog).toHaveTextContent('tenant assignment history')
    expect(dialog).toHaveTextContent('issued bill history')
    expect(dialog).toHaveTextContent('payment transaction history')
    expect(within(dialog).getByRole('button', { name: 'Delete Room' })).toBeDisabled()
  })
})
