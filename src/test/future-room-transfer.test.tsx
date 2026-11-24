import { StrictMode } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AppRouter } from '@/app/router/app-router'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { TENANT_DEMO_STORAGE_KEY } from '@/app/providers/tenant-demo'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import { createDemoData, DEMO_DATE } from '@/data/fixtures/demo'
import { localStorageRepository, STORAGE_KEY } from '@/data/repositories/local-storage-repository'
import { approveRoomChangeRequest, cancelApprovedRoomChangeRequest, eligibleRoomChangeTargets, rescheduleApprovedRoomChangeRequest, submitRoomChangeRequest } from '@/domain/calculations/room-change-requests'
import { futureRoomReservations, roomCapacityConflict } from '@/domain/calculations/room-capacity'
import { createTenant, validateTenantDraft, type TenantDraft } from '@/domain/calculations/tenant-management'
import { prepareMoveInPayment } from '@/domain/calculations/move-in'
import { roomOccupancy, roomOccupants } from '@/domain/calculations/summary'

const BEFORE_EFFECTIVE = '2026-11-22'
const EFFECTIVE = '2026-12-01'

function renderApp(route: string, date: string, tenantId?: string) {
  if (tenantId) localStorage.setItem(TENANT_DEMO_STORAGE_KEY, tenantId)
  const now = () => new Date(`${date}T12:00:00`)
  return render(<StrictMode><PrototypeProvider repository={localStorageRepository} now={now}><MemoryRouter initialEntries={[route]}><AppRouter /></MemoryRouter></PrototypeProvider></StrictMode>)
}

const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY)!).data

function createScenario() {
  let data = prototypeReducer(createDemoData(), {
    type: 'tenant/created',
    draft: { name: 'Charles', email: 'charles@example.com', phone: '+63 900 555 0401', address: 'Test', roomId: 'room-13', moveInDate: '2026-11-01', notes: '' },
  })
  data = prototypeReducer(data, {
    type: 'tenant/created',
    draft: { name: 'Charise', email: 'charise@example.com', phone: '+63 900 555 0402', address: 'Test', roomId: 'room-13', moveInDate: '2026-11-01', notes: '' },
  })
  const moveIn = data.moveInObligations.find(item => item.roomId === 'room-13')
  if (moveIn) {
    const paid = prepareMoveInPayment(data, { obligationId: moveIn.id, categories: ['ADVANCE', 'SECURITY_DEPOSIT'], paidOn: '2026-11-01' })
    if (!paid.ok) throw new Error(paid.reason)
    data = paid.data
  }
  const room06 = data.rooms.find(room => room.name === '06')!
  const room02 = data.rooms.find(room => room.name === '02')!
  const charles = roomOccupants(data, room06.id, BEFORE_EFFECTIVE).find(tenant => tenant.name === 'Charles')!
  const charise = roomOccupants(data, room06.id, BEFORE_EFFECTIVE).find(tenant => tenant.name === 'Charise')!
  const submitted = submitRoomChangeRequest(data, {
    tenantId: charles.id,
    requestedRoomId: room02.id,
    requestedStartDate: EFFECTIVE,
    reason: 'Approved transfer to Room 02',
  }, BEFORE_EFFECTIVE)
  if (!submitted.ok) throw new Error(JSON.stringify(submitted.errors))
  const approved = approveRoomChangeRequest(submitted.data, submitted.request.id, {
    effectiveDate: EFFECTIVE,
    note: 'Approved transfer',
    billingReviewAcknowledged: true,
    decidedAt: BEFORE_EFFECTIVE,
  })
  if (!approved.ok) throw new Error(JSON.stringify(approved.errors))
  return { data: approved.data, charles, charise, room02, room06, request: approved.request, room06Cycle: approved.data.occupancyCycles.find(cycle => cycle.roomId === room06.id && cycle.status === 'ACTIVE')! }
}

describe('future-dated room transfer', () => {
  it('keeps Charles in Room 06 before December 1 and moves him into Room 02 on the effective date', async () => {
    const scenario = createScenario()
    expect(roomOccupants(scenario.data, scenario.room02.id, BEFORE_EFFECTIVE)).toEqual([])
    expect(roomOccupancy(scenario.data, scenario.room02, BEFORE_EFFECTIVE)).toBe('RESERVED')
    expect(roomOccupants(scenario.data, scenario.room06.id, BEFORE_EFFECTIVE).map(tenant => tenant.name).sort()).toEqual(['Charise', 'Charles'])
    await localStorageRepository.save(scenario.data)

    const before = renderApp('/rooms', BEFORE_EFFECTIVE)
    const room02Before = await screen.findByRole('button', { name: 'Room 02 details' })
    expect(room02Before).toHaveTextContent('Reserved')
    expect(room02Before).toHaveTextContent('Upcoming reservation')
    expect(room02Before).toHaveTextContent('Charles')
    expect(room02Before).toHaveTextContent('effective Dec 1, 2026')
    const room06Before = screen.getByRole('button', { name: 'Room 06 details' })
    expect(room06Before).toHaveTextContent('Charles')
    expect(room06Before).toHaveTextContent('Charise')
    before.unmount()

    const tenantBefore = renderApp('/tenant/room', BEFORE_EFFECTIVE, scenario.charles.id)
    expect(await screen.findByText('Room 06 at a glance')).toBeInTheDocument()
    const scheduledTimeline = screen.getByRole('list', { name: 'Room change request status timeline' })
    expect(within(scheduledTimeline).getByText('Scheduled')).toBeInTheDocument()
    expect(within(scheduledTimeline).getByText('Effective Dec 1, 2026')).toBeInTheDocument()
    expect(within(scheduledTimeline).queryByText('Effective')).not.toBeInTheDocument()
    tenantBefore.unmount()

    const onEffective = renderApp('/rooms', EFFECTIVE)
    const room02 = await screen.findByRole('button', { name: 'Room 02 details' })
    expect(room02).toHaveTextContent('Occupied')
    expect(room02).toHaveTextContent('Charles')
    const room06 = screen.getByRole('button', { name: 'Room 06 details' })
    expect(room06).toHaveTextContent('Charise')
    expect(room06).not.toHaveTextContent('Charles')
    onEffective.unmount()

    const tenantAfter = renderApp('/tenant', EFFECTIVE, scenario.charles.id)
    expect(await screen.findByRole('heading', { level: 2, name: 'Room 02' })).toBeInTheDocument()
    tenantAfter.unmount()

    renderApp('/tenant/room', EFFECTIVE, scenario.charles.id)
    expect(await screen.findByText('Room 02 at a glance')).toBeInTheDocument()
    const effectiveTimeline = screen.getByRole('list', { name: 'Room change request status timeline' })
    expect(within(effectiveTimeline).getByText('Effective')).toBeInTheDocument()
    expect(within(effectiveTimeline).queryByText('Scheduled')).not.toBeInTheDocument()

    await waitFor(() => {
      const saved = stored()
      expect(saved.roomAssignments.find((assignment: { tenantId: string; roomId: string; endDate: string | null }) => assignment.tenantId === scenario.charles.id && assignment.endDate === null)).toMatchObject({ roomId: 'room-15', startDate: EFFECTIVE })
      expect(saved.roomAssignments.find((assignment: { tenantId: string; roomId: string; endDate: string | null }) => assignment.tenantId === scenario.charise.id && assignment.endDate === null)).toMatchObject({ roomId: 'room-13' })
      expect(saved.occupancyCycles.find((cycle: { id: string }) => cycle.id === scenario.room06Cycle.id)).toMatchObject({ status: 'ACTIVE', endedAt: null })
      expect(saved.occupancyCycles.find((cycle: { roomId: string; status: string }) => cycle.roomId === 'room-15' && cycle.status === 'ACTIVE')).toBeDefined()
      expect(saved.charges).toEqual(scenario.data.charges)
      expect(saved.payments).toEqual(scenario.data.payments)
      expect(saved.paymentAllocations).toEqual(scenario.data.paymentAllocations)
      expect(saved.receipts).toEqual(scenario.data.receipts)
      expect(saved.meterReadings).toEqual(scenario.data.meterReadings)
      expect(saved.electricityBillObligations).toEqual(scenario.data.electricityBillObligations)
      expect(saved.roomChangeRequests).toHaveLength(1)
      expect(saved.roomChangeRequests[0]).toMatchObject({ id: scenario.request.id, status: 'APPROVED' })
    })

    const refresh = renderApp('/rooms', EFFECTIVE)
    const room02AfterRefresh = await screen.findByRole('button', { name: 'Room 02 details' })
    expect(room02AfterRefresh).toHaveTextContent('Occupied')
    expect(room02AfterRefresh).toHaveTextContent('Charles')
    refresh.unmount()

    expect(DEMO_DATE).toBe('2026-11-13')
  }, 20_000)

  it('refreshes Room 02 across midnight without reloading the application', async () => {
    const scenario = createScenario()
    await localStorageRepository.save(scenario.data)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      let current = new Date(2026, 10, 30, 23, 59, 30)
      const clock = () => current
      render(<StrictMode><PrototypeProvider repository={localStorageRepository} now={clock}><MemoryRouter initialEntries={['/rooms']}><AppRouter /></MemoryRouter></PrototypeProvider></StrictMode>)
      await act(async () => { await Promise.resolve(); await Promise.resolve() })
      expect(screen.getByRole('button', { name: 'Room 02 details' })).toHaveTextContent('Reserved')

      current = new Date(2026, 11, 1, 0, 0, 1)
      await act(async () => { vi.advanceTimersByTime(31_000); await Promise.resolve() })

      const room02 = screen.getByRole('button', { name: 'Room 02 details' })
      expect(room02).toHaveTextContent('Occupied')
      expect(room02).toHaveTextContent('Charles')
      expect(screen.getByRole('button', { name: 'Room 06 details' })).toHaveTextContent('Charise')
    } finally {
      vi.useRealTimers()
    }
  })

  it('reconciles occupancy cycles when the occupancy date advances past midnight', () => {
    const scenario = createScenario()
    const advanced = prototypeReducer(scenario.data, { type: 'occupancy/dateChanged', asOf: EFFECTIVE })
    expect(roomOccupants(advanced, scenario.room02.id, EFFECTIVE).map(tenant => tenant.name)).toEqual(['Charles'])
    expect(roomOccupants(advanced, scenario.room06.id, EFFECTIVE).map(tenant => tenant.name)).toEqual(['Charise'])
    expect(advanced.occupancyCycles.find(cycle => cycle.id === scenario.room06Cycle.id)).toMatchObject({ status: 'ACTIVE', endedAt: null })
    expect(advanced.occupancyCycles.find(cycle => cycle.roomId === scenario.room02.id && cycle.status === 'ACTIVE')).toBeDefined()
    expect(advanced.charges).toEqual(scenario.data.charges)
    expect(advanced.payments).toEqual(scenario.data.payments)
    expect(advanced.receipts).toEqual(scenario.data.receipts)
    expect(advanced.meterReadings).toEqual(scenario.data.meterReadings)
    expect(advanced.electricityBillObligations).toEqual(scenario.data.electricityBillObligations)
  })

  it('does not reserve a room for a pending request', () => {
    const created = createTenant(createDemoData(), {
      name: 'Pending Requester', email: 'pending@example.com', phone: '+63 900 555 0501',
      address: 'Test', roomId: 'room-13', moveInDate: '2026-11-01', notes: '',
    }, BEFORE_EFFECTIVE)
    if (!created.ok) throw new Error('tenant creation failed')
    const pending = submitRoomChangeRequest(created.data, {
      tenantId: created.tenant.id, requestedRoomId: 'room-15', requestedStartDate: EFFECTIVE, reason: 'Future request',
    }, BEFORE_EFFECTIVE)
    if (!pending.ok) throw new Error(JSON.stringify(pending.errors))
    const room02 = pending.data.rooms.find(room => room.name === '02')!
    expect(pending.data.roomChangeRequests[0]?.status).toBe('PENDING')
    expect(futureRoomReservations(pending.data, room02.id, BEFORE_EFFECTIVE)).toEqual([])
    expect(roomOccupancy(pending.data, room02, BEFORE_EFFECTIVE)).toBe('AVAILABLE')
    const newcomer = createTenant(pending.data, {
      name: 'Pending Does Not Block', email: 'pending.block@example.com', phone: '+63 900 555 0508',
      address: 'Test', roomId: 'room-15', moveInDate: EFFECTIVE, notes: '',
    }, BEFORE_EFFECTIVE)
    expect(newcomer.ok).toBe(true)
  })

  it('excludes a reserved destination from eligible room-change targets', () => {
    const scenario = createScenario()
    const other = createTenant(scenario.data, {
      name: 'Other Current Tenant', email: 'other.current@example.com', phone: '+63 900 555 0507',
      address: 'Test', roomId: 'room-14', moveInDate: '2026-11-01', notes: '',
    }, BEFORE_EFFECTIVE)
    if (!other.ok) throw new Error(JSON.stringify(other.errors))
    const targets = eligibleRoomChangeTargets(other.data, other.tenant.id, EFFECTIVE)
    expect(targets.some(room => room.id === scenario.room02.id)).toBe(false)
  })

  it('reserves capacity for an approved future transfer and blocks double-booking', () => {
    const scenario = createScenario()
    expect(futureRoomReservations(scenario.data, scenario.room02.id, BEFORE_EFFECTIVE)).toMatchObject([
      { effectiveDate: EFFECTIVE, tenant: { name: 'Charles' } },
    ])
    expect(roomOccupancy(scenario.data, scenario.room02, BEFORE_EFFECTIVE)).toBe('RESERVED')
    const draft = (name: string): TenantDraft => ({
      name, email: `${name.replace(/\s/g, '').toLowerCase()}@example.com`, phone: '+63 900 555 0502',
      address: 'Test', roomId: 'room-15', moveInDate: EFFECTIVE, notes: '',
    })
    expect(validateTenantDraft(scenario.data, draft('Double Book'), { asOf: BEFORE_EFFECTIVE }).roomId).toMatch(/exceed its capacity/)
  })

  it('allows shared-room reservations while capacity remains and blocks only excess slots', () => {
    const scenario = createScenario()
    const draft = (name: string): TenantDraft => ({
      name, email: `${name.replace(/\s/g, '').toLowerCase()}@example.com`, phone: '+63 900 555 0503',
      address: 'Test', roomId: 'room-13', moveInDate: EFFECTIVE, notes: '',
    })
    const secondSlot = createTenant(scenario.data, draft('Shared First'), BEFORE_EFFECTIVE)
    expect(secondSlot.ok).toBe(true)
    if (!secondSlot.ok) return
    expect(roomCapacityConflict(secondSlot.data, { roomId: 'room-13', tenantId: 'probe', startDate: EFFECTIVE, endDate: null, capacity: 2 })).not.toBeNull()
    const excess = validateTenantDraft(secondSlot.data, draft('Shared Excess'), { asOf: BEFORE_EFFECTIVE })
    expect(excess.roomId).toMatch(/exceed its capacity/)
  })

  it('checks future assignment overlaps before creating another tenancy', () => {
    const first = createTenant(createDemoData(), {
      name: 'Future First', email: 'future.first@example.com', phone: '+63 900 555 0504',
      address: 'Test', roomId: 'room-15', moveInDate: '2026-12-10', notes: '',
    }, BEFORE_EFFECTIVE)
    if (!first.ok) throw new Error('first tenant creation failed')
    const errors = validateTenantDraft(first.data, {
      name: 'Future Second', email: 'future.second@example.com', phone: '+63 900 555 0505',
      address: 'Test', roomId: 'room-15', moveInDate: EFFECTIVE, notes: '',
    }, { asOf: BEFORE_EFFECTIVE })
    expect(errors.roomId).toBe('This room would exceed its capacity on 2026-12-10.')
  })

  it('cancels an approved future reservation explicitly and restores availability', () => {
    const scenario = createScenario()
    const cancelled = cancelApprovedRoomChangeRequest(scenario.data, scenario.request.id, 'Reservation no longer needed.', BEFORE_EFFECTIVE)
    expect(cancelled.ok).toBe(true)
    if (!cancelled.ok) return
    expect(cancelled.request).toMatchObject({ status: 'CANCELLED', resultingAssignmentId: null })
    expect(cancelled.data.roomAssignments.find(assignment => assignment.id === scenario.request.currentAssignmentId)?.endDate).toBeNull()
    expect(futureRoomReservations(cancelled.data, scenario.room02.id, BEFORE_EFFECTIVE)).toEqual([])
    expect(roomOccupancy(cancelled.data, scenario.room02, BEFORE_EFFECTIVE)).toBe('AVAILABLE')
    expect(roomOccupants(cancelled.data, scenario.room06.id, BEFORE_EFFECTIVE).map(tenant => tenant.name).sort()).toEqual(['Charise', 'Charles'])
    expect(cancelled.data.auditEvents.at(-1)?.action).toBe('ROOM_CHANGE_RESERVATION_CANCELLED')
  })

  it('shows current Room 06 occupancy alongside an upcoming shared-room reservation', async () => {
    const scenario = createScenario()
    const reserved = createTenant(scenario.data, {
      name: 'Shared Future', email: 'shared.future@example.com', phone: '+63 900 555 0506',
      address: 'Test', roomId: 'room-13', moveInDate: EFFECTIVE, notes: '',
    }, BEFORE_EFFECTIVE)
    if (!reserved.ok) throw new Error(JSON.stringify(reserved.errors))
    await localStorageRepository.save(reserved.data)
    renderApp('/rooms', BEFORE_EFFECTIVE)
    const room06 = await screen.findByRole('button', { name: 'Room 06 details' })
    expect(room06).toHaveTextContent('Occupied · 2 current tenants · 1 reserved')
    expect(room06).toHaveTextContent('Charise')
    expect(room06).toHaveTextContent('Upcoming reservation')
    expect(room06).toHaveTextContent('Shared Future')
    expect(room06).toHaveTextContent('effective Dec 1, 2026')
  })

  it('explicitly reschedules a reservation in the landlord UI', async () => {
    const user = userEvent.setup()
    const scenario = createScenario()
    await localStorageRepository.save(scenario.data)
    renderApp('/tenants', BEFORE_EFFECTIVE)
    await screen.findByRole('heading', { level: 1, name: 'Tenants' })
    const panel = screen.getByRole('region', { name: 'Room change request queue' })
    await user.click(within(panel).getByRole('button', { name: /Manage reservation for Charles/ }))
    const dialog = screen.getByRole('dialog', { name: 'Manage approved reservation' })
    const newDate = '2026-12-15'
    await user.clear(within(dialog).getByLabelText('New effective date'))
    await user.type(within(dialog).getByLabelText('New effective date'), newDate)
    await user.type(within(dialog).getByLabelText('Reason for rescheduling (optional)'), 'Tenant requested a later date.')
    await user.click(within(dialog).getByRole('button', { name: 'Save new date' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Manage approved reservation' })).not.toBeInTheDocument())

    const saved = stored()
    expect(saved.roomChangeRequests.find((request: { id: string }) => request.id === scenario.request.id)).toMatchObject({ status: 'APPROVED', approvedStartDate: newDate })
    expect(saved.roomAssignments.find((assignment: { id: string }) => assignment.id === scenario.request.resultingAssignmentId)).toMatchObject({ startDate: newDate, endDate: null })
    expect(saved.auditEvents.at(-1)).toMatchObject({ action: 'ROOM_CHANGE_RESCHEDULED' })
  })

  it('explicitly cancels a reservation in the landlord UI and releases the room', async () => {
    const user = userEvent.setup()
    const scenario = createScenario()
    await localStorageRepository.save(scenario.data)
    const view = renderApp('/tenants', BEFORE_EFFECTIVE)
    await screen.findByRole('heading', { level: 1, name: 'Tenants' })
    const panel = screen.getByRole('region', { name: 'Room change request queue' })
    await user.click(within(panel).getByRole('button', { name: /Manage reservation for Charles/ }))
    const dialog = screen.getByRole('dialog', { name: 'Manage approved reservation' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel reservation' }))
    await user.type(within(dialog).getByLabelText('Reason for cancellation'), 'Reservation no longer needed.')
    await user.click(within(dialog).getByRole('button', { name: 'Confirm cancellation' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Manage approved reservation' })).not.toBeInTheDocument())

    const saved = stored()
    expect(saved.roomChangeRequests.find((request: { id: string }) => request.id === scenario.request.id)).toMatchObject({ status: 'CANCELLED', resultingAssignmentId: null })
    expect(saved.roomAssignments.some((assignment: { id: string }) => assignment.id === scenario.request.resultingAssignmentId)).toBe(false)
    expect(saved.auditEvents.at(-1)).toMatchObject({ action: 'ROOM_CHANGE_RESERVATION_CANCELLED' })

    view.unmount()
    renderApp('/rooms', BEFORE_EFFECTIVE)
    const room02 = await screen.findByRole('button', { name: 'Room 02 details' })
    expect(room02).toHaveTextContent('Available')
    expect(room02).not.toHaveTextContent('Upcoming reservation')
  })

  it('reschedules an approved future reservation and moves the protected capacity', () => {
    const scenario = createScenario()
    const newDate = '2026-12-15'
    const rescheduled = rescheduleApprovedRoomChangeRequest(scenario.data, scenario.request.id, newDate, 'Tenant requested a later date.', BEFORE_EFFECTIVE)
    expect(rescheduled.ok).toBe(true)
    if (!rescheduled.ok) return
    expect(rescheduled.request.approvedStartDate).toBe(newDate)
    expect(futureRoomReservations(rescheduled.data, scenario.room02.id, BEFORE_EFFECTIVE)).toMatchObject([
      { effectiveDate: newDate, tenant: { name: 'Charles' } },
    ])
    expect(rescheduled.data.roomAssignments.find(assignment => assignment.id === scenario.request.resultingAssignmentId)).toMatchObject({ startDate: newDate, endDate: null })
    expect(rescheduled.data.roomAssignments.find(assignment => assignment.id === scenario.request.currentAssignmentId)?.endDate).toBe('2026-12-14')
    expect(rescheduled.data.auditEvents.at(-1)?.action).toBe('ROOM_CHANGE_RESCHEDULED')
  })
})
