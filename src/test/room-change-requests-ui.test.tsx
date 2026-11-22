import { StrictMode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router/app-router'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { TENANT_DEMO_STORAGE_KEY } from '@/app/providers/tenant-demo'
import { createDemoData, DEMO_DATE, OCCUPANCY_DATE } from '@/data/fixtures/demo'
import { localStorageRepository, STORAGE_KEY } from '@/data/repositories/local-storage-repository'
import { approveRoomChangeRequest, submitRoomChangeRequest } from '@/domain/calculations/room-change-requests'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import { roomOccupants } from '@/domain/calculations/summary'

function renderApp(route: string) {
  return render(<StrictMode><PrototypeProvider repository={localStorageRepository}><MemoryRouter initialEntries={[route]}><AppRouter /></MemoryRouter></PrototypeProvider></StrictMode>)
}
const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY)!).data
const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

describe('tenant room change request UI', () => {
  it('submits a request from My Room without changing the tenancy or money', async () => {
    const user = userEvent.setup()
    const base = createDemoData()
    renderApp('/tenant/room')
    await screen.findByRole('heading', { level: 1, name: 'My Room' })
    await user.click(await screen.findByRole('button', { name: 'Request a room change' }))
    const dialog = screen.getByRole('dialog', { name: 'Request a room change' })
    await user.selectOptions(within(dialog).getByLabelText('Room you want'), 'room-13')
    await user.type(within(dialog).getByLabelText('Reason'), 'Need a private room')
    await user.click(within(dialog).getByRole('button', { name: 'Submit request' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Request a room change' })).not.toBeInTheDocument())
    expect(screen.getByText('Pending landlord review')).toBeInTheDocument()
    expect(screen.getByText(/Room 1.*Room 06/)).toBeInTheDocument()
    const saved = stored()
    expect(saved.roomChangeRequests).toHaveLength(1)
    expect(saved.roomChangeRequests[0]).toMatchObject({ tenantId: 'tenant-1', requestedRoomId: 'room-13', status: 'PENDING' })
    expect(saved.roomAssignments).toEqual(base.roomAssignments)
    expect(saved.charges).toEqual(base.charges)
    expect(saved.payments).toEqual(base.payments)
    expect(saved.receipts).toEqual(base.receipts)
  })

  it('keeps validation errors visible and cancels without saving', async () => {
    const user = userEvent.setup()
    renderApp('/tenant/room')
    await screen.findByRole('heading', { level: 1, name: 'My Room' })
    await user.click(await screen.findByRole('button', { name: 'Request a room change' }))
    const dialog = screen.getByRole('dialog', { name: 'Request a room change' })
    expect(dialog).toHaveClass('room-change-dialog')
    expect(dialog.querySelector('[data-slot="dialog-footer"]')).toHaveClass('room-change-dialog-footer')

    await user.click(within(dialog).getByRole('button', { name: 'Submit request' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Choose the room you want to move to.')
    await user.selectOptions(within(dialog).getByLabelText('Room you want'), 'room-13')
    await user.click(within(dialog).getByRole('button', { name: 'Submit request' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Explain briefly why you want to move.')

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Request a room change' })).not.toBeInTheDocument())
    expect(stored().roomChangeRequests).toHaveLength(0)
  })

  it('cancels a pending request without assignment changes', async () => {
    const user = userEvent.setup()
    const first = submitRoomChangeRequest(createDemoData(), { tenantId: 'tenant-1', requestedRoomId: 'room-13', requestedStartDate: DEMO_DATE, reason: 'Need more space' }, DEMO_DATE)
    if (!first.ok) throw new Error('request failed')
    await localStorageRepository.save(first.data)
    renderApp('/tenant/room')
    await screen.findByRole('heading', { level: 1, name: 'My Room' })
    await user.click(await screen.findByRole('button', { name: 'Cancel request' }))
    await waitFor(() => expect(stored().roomChangeRequests[0].status).toBe('CANCELLED'))
    expect(stored().roomAssignments).toEqual(first.data.roomAssignments)
    expect(screen.getAllByText('Cancelled').length).toBeGreaterThan(0)
  })

  it('shows the tenant a clear request timeline and flagged billing period after approval', async () => {
    const first = submitRoomChangeRequest(createDemoData(), { tenantId: 'tenant-1', requestedRoomId: 'room-13', requestedStartDate: DEMO_DATE, reason: 'Need more space' }, DEMO_DATE)
    if (!first.ok) throw new Error('request failed')
    const approved = approveRoomChangeRequest(first.data, first.request.id, { effectiveDate: DEMO_DATE, note: 'Approved after review', billingReviewAcknowledged: true, decidedAt: DEMO_DATE })
    if (!approved.ok) throw new Error('approval failed')
    await localStorageRepository.save(approved.data)
    renderApp('/tenant/room')
    const timeline = await screen.findByRole('list', { name: 'Room change request status timeline' })
    expect(within(timeline).getByText('Request submitted')).toBeInTheDocument()
    expect(within(timeline).getByText('Landlord review completed')).toBeInTheDocument()
    expect(within(timeline).getByText('Approved')).toBeInTheDocument()
    expect(within(timeline).getByText('Effective')).toBeInTheDocument()
    expect(within(timeline).getByText('Billing review flagged')).toBeInTheDocument()
    expect(within(timeline).getByText('November 2026 (sample)')).toBeInTheDocument()
  })
})

describe('billing room change review flag', () => {
  it('shows approved mid-period transfers without posting rent or proration', async () => {
    const first = submitRoomChangeRequest(createDemoData(), { tenantId: 'tenant-1', requestedRoomId: 'room-13', requestedStartDate: DEMO_DATE, reason: 'Need more space' }, DEMO_DATE)
    if (!first.ok) throw new Error('request failed')
    const approved = approveRoomChangeRequest(first.data, first.request.id, { effectiveDate: DEMO_DATE, note: 'Approved after review', billingReviewAcknowledged: true, decidedAt: DEMO_DATE })
    if (!approved.ok) throw new Error('approval failed')
    await localStorageRepository.save(approved.data)
    renderApp('/billing')
    expect(await screen.findByText('Room change billing review')).toBeInTheDocument()
    expect(screen.getByText(/Alex Rivera: Room 1.*Room 06.*effective Nov 13, 2026/)).toBeInTheDocument()
  })
})

describe('landlord room change review UI', () => {
  it('requires financial acknowledgment, approves once, and preserves financial history', async () => {
    const user = userEvent.setup()
    const base = createDemoData()
    const first = submitRoomChangeRequest(base, { tenantId: 'tenant-1', requestedRoomId: 'room-13', requestedStartDate: DEMO_DATE, reason: 'Need more space' }, DEMO_DATE)
    if (!first.ok) throw new Error('request failed')
    await localStorageRepository.save(first.data)
    renderApp('/tenants')
    await screen.findByRole('heading', { level: 1, name: 'Tenants' })
    const panel = screen.getByRole('region', { name: 'Room change request queue' })
    await user.click(within(panel).getByRole('button', { name: /Review room change request from Alex Rivera/ }))
    const dialog = screen.getByRole('dialog', { name: 'Review room change request' })
    const approve = within(dialog).getByRole('button', { name: 'Approve transfer' })
    expect(approve).toBeDisabled()
    await user.click(within(dialog).getByRole('checkbox', { name: /I reviewed the outstanding balance/ }))
    await user.click(approve)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Review room change request' })).not.toBeInTheDocument())
    const saved = stored()
    expect(saved.roomChangeRequests[0]).toMatchObject({ status: 'APPROVED', billingReviewAcknowledged: true, resultingAssignmentId: expect.any(String) })
    expect(saved.roomAssignments.find((item: { id: string }) => item.id === saved.roomChangeRequests[0].resultingAssignmentId)).toMatchObject({ tenantId: 'tenant-1', roomId: 'room-13' })
    expect(saved.charges).toEqual(base.charges)
    expect(saved.payments).toEqual(base.payments)
    expect(saved.receipts).toEqual(base.receipts)
    expect(saved.meterReadings).toEqual(base.meterReadings)
    expect(saved.occupancyCycles.find((cycle: { roomId: string }) => cycle.roomId === 'room-1')).toMatchObject({ status: 'CLOSED' })
    expect(saved.occupancyCycles.find((cycle: { roomId: string }) => cycle.roomId === 'room-13')).toMatchObject({ status: 'ACTIVE' })
    expect(screen.getByText('APPROVED')).toBeInTheDocument()
  })

  it('shows Room 02 occupied after approval and keeps the remaining Room 06 occupant', async () => {
    const user = userEvent.setup()
    let data = prototypeReducer(createDemoData(), { type: 'tenant/created', draft: { name: 'Room 06 Mover', email: 'r06.mover@example.com', phone: '+63 900 555 0201', address: 'Test', roomId: 'room-13', moveInDate: '2026-11-01', notes: '' } })
    data = prototypeReducer(data, { type: 'tenant/created', draft: { name: 'Room 06 Remaining', email: 'r06.remaining@example.com', phone: '+63 900 555 0202', address: 'Test', roomId: 'room-13', moveInDate: '2026-11-01', notes: '' } })
    const mover = roomOccupants(data, 'room-13', DEMO_DATE).find(tenant => tenant.name === 'Room 06 Mover')!
    const remaining = roomOccupants(data, 'room-13', DEMO_DATE).find(tenant => tenant.name === 'Room 06 Remaining')!
    const first = submitRoomChangeRequest(data, { tenantId: mover.id, requestedRoomId: 'room-15', requestedStartDate: DEMO_DATE, reason: 'Move to Room 02' }, DEMO_DATE)
    if (!first.ok) throw new Error('request failed')
    await localStorageRepository.save(first.data)
    const view = renderApp('/tenants')
    await screen.findByRole('heading', { level: 1, name: 'Tenants' })
    const panel = screen.getByRole('region', { name: 'Room change request queue' })
    await user.click(within(panel).getByRole('button', { name: /Review room change request from Room 06 Mover/ }))
    const dialog = screen.getByRole('dialog', { name: 'Review room change request' })
    await user.click(within(dialog).getByRole('checkbox', { name: /I reviewed the outstanding balance/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Approve transfer' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Review room change request' })).not.toBeInTheDocument())

    expect(stored().roomAssignments.some((assignment: { tenantId: string; roomId: string; endDate: string | null }) => assignment.tenantId === mover.id && assignment.roomId === 'room-15' && assignment.endDate === null)).toBe(true)
    expect(stored().roomAssignments.some((assignment: { tenantId: string; roomId: string; endDate: string | null }) => assignment.tenantId === remaining.id && assignment.roomId === 'room-13' && assignment.endDate === null)).toBe(true)

    view.unmount()
    const roomsView = renderApp('/rooms')
    const room02 = await screen.findByRole('button', { name: 'Room 02 details' })
    expect(room02).toHaveTextContent('Occupied')
    expect(room02).toHaveTextContent('Room 06 Mover')
    const room06 = screen.getByRole('button', { name: 'Room 06 details' })
    expect(room06).toHaveTextContent('Occupied')
    expect(room06).toHaveTextContent('Room 06 Remaining')
    expect(room06).not.toHaveTextContent('Room 06 Mover')

    roomsView.unmount()
    localStorage.setItem(TENANT_DEMO_STORAGE_KEY, mover.id)
    renderApp('/tenant/room')
    expect(await screen.findByText('Room 02 at a glance')).toBeInTheDocument()
  })

  it('keeps a future-dated transfer scheduled instead of occupying Room 02 early', async () => {
    const user = userEvent.setup()
    const futureDate = addDays(OCCUPANCY_DATE, 5)
    let data = prototypeReducer(createDemoData(), { type: 'tenant/created', draft: { name: 'Future Room 06 Mover', email: 'future.r06.mover@example.com', phone: '+63 900 555 0301', address: 'Test', roomId: 'room-13', moveInDate: '2026-11-01', notes: '' } })
    data = prototypeReducer(data, { type: 'tenant/created', draft: { name: 'Future Room 06 Remaining', email: 'future.r06.remaining@example.com', phone: '+63 900 555 0302', address: 'Test', roomId: 'room-13', moveInDate: '2026-11-01', notes: '' } })
    const mover = roomOccupants(data, 'room-13', OCCUPANCY_DATE).find(tenant => tenant.name === 'Future Room 06 Mover')!
    const request = submitRoomChangeRequest(data, { tenantId: mover.id, requestedRoomId: 'room-15', requestedStartDate: futureDate, reason: 'Future move to Room 02' }, OCCUPANCY_DATE)
    if (!request.ok) throw new Error(JSON.stringify(request.errors))
    await localStorageRepository.save(request.data)
    const view = renderApp('/tenants')
    await screen.findByRole('heading', { level: 1, name: 'Tenants' })
    const panel = screen.getByRole('region', { name: 'Room change request queue' })
    await user.click(within(panel).getByRole('button', { name: /Review room change request from Future Room 06 Mover/ }))
    const dialog = screen.getByRole('dialog', { name: 'Review room change request' })
    await user.click(within(dialog).getByRole('checkbox', { name: /I reviewed the outstanding balance/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Approve transfer' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Review room change request' })).not.toBeInTheDocument())
    expect(stored().roomAssignments.find((assignment: { tenantId: string; endDate: string | null }) => assignment.tenantId === mover.id && assignment.endDate === null)).toMatchObject({ roomId: 'room-15', startDate: futureDate })

    view.unmount()
    renderApp('/rooms')
    const room02 = await screen.findByRole('button', { name: 'Room 02 details' })
    expect(room02).toHaveTextContent('Reserved')
    expect(room02).toHaveTextContent('Future Room 06 Mover')
    expect(room02).toHaveTextContent('Upcoming reservation')
    const room06 = screen.getByRole('button', { name: 'Room 06 details' })
    expect(room06).toHaveTextContent('Future Room 06 Mover')
    expect(room06).toHaveTextContent('Future Room 06 Remaining')
  })

  it('rejects with a tenant-visible reason and no assignment changes', async () => {
    const user = userEvent.setup()
    const first = submitRoomChangeRequest(createDemoData(), { tenantId: 'tenant-1', requestedRoomId: 'room-13', requestedStartDate: DEMO_DATE, reason: 'Need more space' }, DEMO_DATE)
    if (!first.ok) throw new Error('request failed')
    await localStorageRepository.save(first.data)
    renderApp('/tenants')
    await screen.findByRole('heading', { level: 1, name: 'Tenants' })
    const panel = screen.getByRole('region', { name: 'Room change request queue' })
    await user.click(within(panel).getByRole('button', { name: /Review room change request from Alex Rivera/ }))
    const dialog = screen.getByRole('dialog', { name: 'Review room change request' })
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }))
    await user.type(within(dialog).getByLabelText('Rejection reason'), 'No suitable room is available.')
    await user.click(within(dialog).getByRole('button', { name: 'Reject request' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Review room change request' })).not.toBeInTheDocument())
    expect(stored().roomChangeRequests[0]).toMatchObject({ status: 'REJECTED', decisionReason: 'No suitable room is available.' })
    expect(stored().roomAssignments).toEqual(first.data.roomAssignments)
    expect(stored().charges).toEqual(first.data.charges)
  })
})