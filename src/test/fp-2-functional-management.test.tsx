import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router/app-router'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { createDemoData } from '@/data/fixtures/demo'
import { localStorageRepository, STORAGE_KEY } from '@/data/repositories/local-storage-repository'
import { createRoom, validateRoomDraft, type RoomDraft } from '@/domain/calculations/room-management'
import { isPrototypeData } from '@/domain/validation/prototype-data'

function renderApp(route = '/') {
  return render(<PrototypeProvider repository={localStorageRepository}><MemoryRouter initialEntries={[route]}><AppRouter /></MemoryRouter></PrototypeProvider>)
}

function savedData() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')?.data
}

const roomDraft: RoomDraft = { name: '9', capacity: 1, categoryId: 'RATE_4000', kind: 'PRIVATE', status: 'available' }

describe('functional room and tenant management', () => {
  it('keeps room numbers as distinct strings, rejects exact duplicates, and assigns stable IDs/categories', () => {
    const data = createDemoData()
    expect(validateRoomDraft(data, { ...roomDraft, name: '2' }, { asOf: '2026-11-13' }).name).toMatch(/already in use/)
    expect(validateRoomDraft(data, { ...roomDraft, name: ' 2 ' }, { asOf: '2026-11-13' }).name).toMatch(/already in use/)
    expect(validateRoomDraft(data, { ...roomDraft, name: '02' }, { asOf: '2026-11-13' }).name).toMatch(/already in use/)

    const nine = createRoom(data, { ...roomDraft, name: '9' }, '2026-11-13')
    expect(nine.ok).toBe(true)
    if (!nine.ok) return
    const zeroNine = createRoom(nine.data, { ...roomDraft, name: '09' }, '2026-11-13')
    expect(zeroNine.ok).toBe(true)
    if (!zeroNine.ok) return
    expect(zeroNine.room.name).toBe('09')
    expect(zeroNine.room.id).not.toBe(nine.room.id)
    expect(zeroNine.room.categoryId).toBe('RATE_4000')
    expect(zeroNine.data.rooms.filter(room => room.name === '09')).toHaveLength(1)
    expect(createRoom(zeroNine.data, { ...roomDraft, name: '09' }, '2026-11-13').ok).toBe(false)
    expect(isPrototypeData(zeroNine.data)).toBe(true)
    expect(new Set(zeroNine.data.rooms.map(room => room.id)).size).toBe(zeroNine.data.rooms.length)
    expect(new Set(zeroNine.data.rooms.map(room => room.name)).size).toBe(zeroNine.data.rooms.length)
  })

  it('adds a persisted room and tenant, updates selectors/occupancy/tenant UI, and enforces capacity', async () => {
    const user = userEvent.setup()
    const app = renderApp('/rooms')
    await user.click(await screen.findByRole('button', { name: 'Add room' }))
    let dialog = await screen.findByRole('dialog', { name: 'Add a room' })
    await user.type(within(dialog).getByLabelText('Room number or name'), '904')
    await user.selectOptions(within(dialog).getByLabelText('Monthly rental rate'), 'RATE_4000')
    await user.click(within(dialog).getByRole('button', { name: 'Add room' }))
    const roomSuccess = await screen.findByRole('dialog', { name: 'Room added successfully' })
    await user.click(within(roomSuccess).getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(savedData().rooms.some((room: { name: string }) => room.name === '904')).toBe(true))
    const roomId = savedData().rooms.find((room: { name: string }) => room.name === '904').id
    expect(await screen.findByRole('button', { name: 'Room 904 details' })).toBeInTheDocument()

    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    await user.click(within(nav).getByRole('link', { name: 'Tenants' }))
    await user.selectOptions(await screen.findByLabelText('Rows per page for tenants'), '20')
    await user.click(await screen.findByRole('button', { name: 'Add tenant' }))
    dialog = await screen.findByRole('dialog', { name: 'Add a tenant' })
    const assignment = within(dialog).getByLabelText('Room assignment')
    expect(within(assignment).getByRole('option', { name: /^Room 904 ·/ })).toHaveValue(roomId)
    await user.type(within(dialog).getByLabelText('Full name'), 'Functional Resident')
    await user.selectOptions(assignment, roomId)
    await user.click(within(dialog).getByRole('button', { name: 'Add tenant' }))
    const tenantSuccess = await screen.findByRole('dialog', { name: 'Tenant added successfully' })
    await user.click(within(tenantSuccess).getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(savedData().tenants.some((tenant: { name: string }) => tenant.name === 'Functional Resident')).toBe(true))
    const tenantId = savedData().tenants.find((tenant: { name: string }) => tenant.name === 'Functional Resident').id
    expect(savedData().roomAssignments.find((item: { tenantId: string }) => item.tenantId === tenantId)).toMatchObject({ roomId })

    expect(screen.getByRole('row', { name: /Functional Resident/ })).toHaveTextContent('Room 904')
    await user.click(within(nav).getByRole('link', { name: 'Rooms' }))
    const roomCard = await screen.findByRole('button', { name: 'Room 904 details' })
    expect(roomCard).toHaveTextContent('Occupied · 1 current tenant')
    expect(roomCard).toHaveTextContent('Functional Resident')

    await user.click(within(nav).getByRole('link', { name: 'Tenants' }))
    await user.click(await screen.findByRole('button', { name: 'Add tenant' }))
    dialog = await screen.findByRole('dialog', { name: 'Add a tenant' })
    await user.type(within(dialog).getByLabelText('Full name'), 'Capacity Blocked')
    await user.selectOptions(within(dialog).getByLabelText('Room assignment'), roomId)
    await user.click(within(dialog).getByRole('button', { name: 'Add tenant' }))
    expect(await screen.findByText(/This room would exceed its capacity/) ).toBeInTheDocument()
    expect(savedData().tenants.some((tenant: { name: string }) => tenant.name === 'Capacity Blocked')).toBe(false)
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Switch to Tenant UI' }))
    await screen.findByRole('heading', { level: 1, name: 'Overview' })
    const selector = await screen.findByLabelText('Demo tenant')
    await user.selectOptions(selector, within(selector).getByRole('option', { name: 'Functional Resident' }))
    const overview = await screen.findByRole('region', { name: 'Room overview' })
    expect(within(overview).getByRole('heading', { name: 'Room 904' })).toBeInTheDocument()
    expect(within(overview).getByRole('heading', { name: 'Tenant' })).toBeInTheDocument()
    expect(within(overview).getByText('Functional Resident')).toBeInTheDocument()

    app.unmount()
    renderApp('/tenant')
    expect(await screen.findByLabelText('Demo tenant')).toHaveValue(tenantId)
    expect(within(await screen.findByRole('region', { name: 'Room overview' })).getByText('Functional Resident')).toBeInTheDocument()
    expect(savedData().rooms.filter((room: { name: string }) => room.name === '904')).toHaveLength(1)
  }, 30000)

  it('reflects a room rename in the tenant workspace and preserves historical payments and receipts', async () => {
    const user = userEvent.setup()
    const before = savedData() ?? JSON.parse(JSON.stringify(createDemoData()))
    const originalPayments = JSON.stringify(before.payments)
    const originalCharges = JSON.stringify(before.charges)
    const originalReceipts = JSON.stringify(before.receipts)
    const originalAssignments = JSON.stringify(before.roomAssignments)
    renderApp('/rooms')

    await user.click(await screen.findByRole('button', { name: 'Room 2 details' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Room 2' })).getByRole('button', { name: 'Edit Room' }))
    let dialog = screen.getByRole('dialog', { name: 'Edit Room 2' })
    await user.clear(within(dialog).getByLabelText('Room number or name'))
    await user.type(within(dialog).getByLabelText('Room number or name'), '2B')
    await user.click(within(dialog).getByRole('button', { name: 'Save Room' }))
    dialog = await screen.findByRole('dialog', { name: 'Room 2B' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(savedData().rooms.find((room: { id: string }) => room.id === 'room-2').name).toBe('2B'))
    expect(JSON.stringify(savedData().payments)).toBe(originalPayments)
    expect(JSON.stringify(savedData().charges)).toBe(originalCharges)
    expect(JSON.stringify(savedData().receipts)).toBe(originalReceipts)
    expect(JSON.stringify(savedData().roomAssignments)).toBe(originalAssignments)
    expect(savedData().rooms.find((room: { id: string }) => room.id === 'room-15').name).toBe('02')

    await user.click(screen.getByRole('button', { name: 'Switch to Tenant UI' }))
    await screen.findByRole('heading', { level: 1, name: 'Overview' })
    const selector = await screen.findByLabelText('Demo tenant')
    await user.selectOptions(selector, 'tenant-2')
    const overview = await screen.findByRole('region', { name: 'Room overview' })
    expect(within(overview).getByRole('heading', { name: 'Room 2B' })).toBeInTheDocument()
    expect(within(overview).queryByRole('heading', { name: 'Room 02' })).not.toBeInTheDocument()
    await user.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'My Payments & Receipts' }))
    const receipt = await screen.findByRole('article', { name: 'Receipt DEMO-RCT-008' })
    expect(receipt).toHaveTextContent('Room 2B')
    expect(receipt).toHaveTextContent('₱100.00')
    expect(receipt).not.toHaveTextContent('Room 02')
  }, 30000)
})
