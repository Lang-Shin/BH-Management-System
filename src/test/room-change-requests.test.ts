import { describe, expect, it } from 'vitest'
import { createDemoData, DEMO_DATE, OCCUPANCY_DATE } from '@/data/fixtures/demo'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import {
  approveRoomChangeRequest, approvedRoomChangeBillingReviews, cancelRoomChangeRequest, latestRoomChangeRequest, pendingRoomChangeRequests,
  rejectRoomChangeRequest, roomChangeFinancialWarnings, roomChangeRequestsForTenant, submitRoomChangeRequest,
} from '@/domain/calculations/room-change-requests'
import { selectNotifications } from '@/features/notifications/select-notifications'
import { localStorageRepository, STORAGE_KEY } from '@/data/repositories/local-storage-repository'
import { parsePrototypeSnapshot, STORAGE_SCHEMA_VERSION } from '@/data/repositories/prototype-storage'
import { isPrototypeData } from '@/domain/validation/prototype-data'
import { roomOccupancy, roomOccupants } from '@/domain/calculations/summary'
import { reconcileOccupancy } from '@/domain/calculations/move-in'

const draft = { tenantId: 'tenant-1', requestedRoomId: 'room-13', requestedStartDate: DEMO_DATE, reason: 'Need more space' }
const approval = (ack = true) => ({ effectiveDate: DEMO_DATE, note: 'Approved after review', billingReviewAcknowledged: ack, decidedAt: DEMO_DATE })
const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

describe('tenant room change requests', () => {
  it('submits a pending request without financial or assignment changes', () => {
    const data = createDemoData()
    const before = JSON.stringify(data)
    const result = submitRoomChangeRequest(data, draft, DEMO_DATE)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(JSON.stringify(data)).toBe(before)
    expect(result.request).toMatchObject({ tenantId: 'tenant-1', currentRoomId: 'room-1', requestedRoomId: 'room-13', status: 'PENDING', billingReviewPeriodIds: [] })
    expect(result.data.roomAssignments).toEqual(data.roomAssignments)
    expect(result.data.charges).toEqual(data.charges)
    expect(result.data.payments).toEqual(data.payments)
    expect(result.data.receipts).toEqual(data.receipts)
    expect(result.data.auditEvents.at(-1)?.action).toBe('ROOM_CHANGE_REQUESTED')
    expect(isPrototypeData(result.data)).toBe(true)
  })

  it('rejects a second pending request, same room, maintenance room, full room, invalid dates, and bad reasons', () => {
    const data = createDemoData()
    const first = submitRoomChangeRequest(data, draft, DEMO_DATE)
    if (!first.ok) throw new Error('request failed')
    expect(submitRoomChangeRequest(first.data, { ...draft, requestId: 'second' }, DEMO_DATE)).toEqual({ ok: false, errors: { general: 'You already have a pending room change request.' } })
    expect(submitRoomChangeRequest(data, { ...draft, requestedRoomId: 'room-1' }, DEMO_DATE).ok).toBe(false)
    expect(submitRoomChangeRequest(data, { ...draft, requestedRoomId: 'room-6' }, DEMO_DATE).ok).toBe(false)
    expect(submitRoomChangeRequest(data, { ...draft, requestedRoomId: 'room-2' }, DEMO_DATE).ok).toBe(false)
    expect(submitRoomChangeRequest(data, { ...draft, requestedStartDate: '2026-09-01' }, DEMO_DATE).ok).toBe(false)
    expect(submitRoomChangeRequest(data, { ...draft, requestedStartDate: 'not-a-date' }, DEMO_DATE).ok).toBe(false)
    expect(submitRoomChangeRequest(data, { ...draft, reason: '   ' }, DEMO_DATE).ok).toBe(false)
    expect(submitRoomChangeRequest(data, { ...draft, reason: 'x'.repeat(501) }, DEMO_DATE).ok).toBe(false)
  })

  it('uses stable room IDs and keeps Room 6 and Room 06 distinct', () => {
    const data = createDemoData()
    const room6 = data.rooms.find(room => room.name === '6')!
    const room06 = data.rooms.find(room => room.name === '06')!
    expect(room6.id).toBe('room-6')
    expect(room06.id).toBe('room-13')
    const result = submitRoomChangeRequest(data, { ...draft, requestedRoomId: 'room-6' }, DEMO_DATE)
    expect(result.ok).toBe(false)
    const result06 = submitRoomChangeRequest(data, { ...draft, requestedRoomId: 'room-13' }, DEMO_DATE)
    expect(result06.ok).toBe(true)
    if (result06.ok) expect(result06.request.requestedRoomId).toBe('room-13')
  })

  it('cancels a tenant request without changing assignments or finances', () => {
    const first = submitRoomChangeRequest(createDemoData(), draft, DEMO_DATE)
    if (!first.ok) throw new Error('request failed')
    const cancelled = cancelRoomChangeRequest(first.data, first.request.id, 'tenant-1', 'Changed plans', DEMO_DATE)
    expect(cancelled.ok).toBe(true)
    if (!cancelled.ok) return
    expect(cancelled.request.status).toBe('CANCELLED')
    expect(cancelled.data.roomAssignments).toEqual(first.data.roomAssignments)
    expect(cancelled.data.charges).toEqual(first.data.charges)
    expect(cancelled.data.payments).toEqual(first.data.payments)
    expect(cancelled.data.auditEvents.at(-1)?.action).toBe('ROOM_CHANGE_CANCELLED')
  })

  it('expires a pending request when the tenant moves out or is directly transferred', () => {
    const first = submitRoomChangeRequest(createDemoData(), draft, DEMO_DATE)
    if (!first.ok) throw new Error('request failed')
    const movedOut = prototypeReducer(first.data, { type: 'tenant/movedOut', tenantId: 'tenant-1' })
    expect(movedOut.roomChangeRequests[0]).toMatchObject({ status: 'EXPIRED', decidedBy: 'demo-system' })
    expect(movedOut.auditEvents.at(-1)?.action).toBe('ROOM_CHANGE_EXPIRED')

    const second = submitRoomChangeRequest(createDemoData(), draft, DEMO_DATE)
    if (!second.ok) throw new Error('request failed')
    const tenant = second.data.tenants.find(item => item.id === 'tenant-1')!
    const transferred = prototypeReducer(second.data, { type: 'tenant/updated', tenantId: 'tenant-1', draft: { name: tenant.name, email: tenant.email, phone: tenant.phone, address: tenant.address, roomId: 'room-9', moveInDate: DEMO_DATE, notes: '' } })
    expect(transferred.roomChangeRequests[0]?.status).toBe('EXPIRED')
  })
  it('rejects a request without changing assignments or finances', () => {
    const first = submitRoomChangeRequest(createDemoData(), draft, DEMO_DATE)
    if (!first.ok) throw new Error('request failed')
    const rejected = rejectRoomChangeRequest(first.data, first.request.id, 'No suitable room', DEMO_DATE)
    expect(rejected.ok).toBe(true)
    if (!rejected.ok) return
    expect(rejected.request).toMatchObject({ status: 'REJECTED', decisionReason: 'No suitable room' })
    expect(rejected.data.roomAssignments).toEqual(first.data.roomAssignments)
    expect(rejected.data.charges).toEqual(first.data.charges)
    expect(rejected.data.payments).toEqual(first.data.payments)
    expect(rejected.data.auditEvents.at(-1)?.action).toBe('ROOM_CHANGE_REJECTED')
  })

  it('approves once, closes the old assignment, and preserves all financial and meter records', () => {
    const base = createDemoData()
    const first = submitRoomChangeRequest(base, draft, DEMO_DATE)
    if (!first.ok) throw new Error('request failed')
    const approved = approveRoomChangeRequest(first.data, first.request.id, approval())
    expect(approved.ok).toBe(true)
    if (!approved.ok) return
    const tenant = approved.request.tenantId
    const assignments = approved.data.roomAssignments.filter(item => item.tenantId === tenant)
    const oldAssignment = assignments.find(item => item.id === first.request.currentAssignmentId)!
    const newAssignment = assignments.find(item => item.id === approved.request.resultingAssignmentId)!
    expect(oldAssignment.endDate).toBe('2026-11-12')
    expect(newAssignment).toMatchObject({ roomId: 'room-13', startDate: DEMO_DATE, endDate: null })
    expect(approved.request).toMatchObject({ status: 'APPROVED', approvedStartDate: DEMO_DATE, billingReviewAcknowledged: true, billingReviewPeriodIds: ['period-nov'] })
    expect(approvedRoomChangeBillingReviews(approved.data, 'period-nov').map(item => item.id)).toEqual([approved.request.id])
    expect(approved.data.charges).toEqual(base.charges)
    expect(approved.data.payments).toEqual(base.payments)
    expect(approved.data.paymentAllocations).toEqual(base.paymentAllocations)
    expect(approved.data.receipts).toEqual(base.receipts)
    expect(approved.data.paymentCorrections).toEqual(base.paymentCorrections)
    expect(approved.data.meterReadings).toEqual(base.meterReadings)
    expect(approved.data.moveInObligations).toEqual(base.moveInObligations)
    expect(approved.data.occupancyCycles.find(cycle => cycle.roomId === 'room-1')).toMatchObject({ status: 'CLOSED', endedAt: DEMO_DATE })
    expect(approved.data.occupancyCycles.find(cycle => cycle.roomId === 'room-13')).toMatchObject({ status: 'ACTIVE', endedAt: null })
    expect(isPrototypeData(approved.data)).toBe(true)
  })

  it('requires acknowledgment when financial or mid-period review is needed and posts no top-up', () => {
    const base = createDemoData()
    const first = submitRoomChangeRequest(base, draft, DEMO_DATE)
    if (!first.ok) throw new Error('request failed')
    const warnings = roomChangeFinancialWarnings(base, 'tenant-1', 'room-13', DEMO_DATE)!
    expect(warnings).toMatchObject({ currentRentCents: 350_000, targetRentCents: 400_000, rentDifferenceCents: 50_000, depositTopUpProposalCents: 50_000, billingReviewRequired: true })
    expect(approveRoomChangeRequest(first.data, first.request.id, approval(false))).toEqual({ ok: false, errors: { general: 'Confirm that the financial and billing effects have been reviewed.' } })
    const approved = approveRoomChangeRequest(first.data, first.request.id, approval(true))
    expect(approved.ok).toBe(true)
    if (!approved.ok) return
    expect(approved.data.charges).toEqual(base.charges)
    expect(approved.data.moveInObligations).toEqual(base.moveInObligations)
  })

  it('revalidates capacity and assignment changes at approval time', () => {
    const first = submitRoomChangeRequest(createDemoData(), draft, DEMO_DATE)
    if (!first.ok) throw new Error('request failed')
    const filled = { ...first.data, roomAssignments: [...first.data.roomAssignments,
      { id: 'fill-1', tenantId: 'tenant-8', roomId: 'room-13', startDate: DEMO_DATE, endDate: null, agreedRentCents: 400_000 },
      { id: 'fill-2', tenantId: 'tenant-10', roomId: 'room-13', startDate: DEMO_DATE, endDate: null, agreedRentCents: 400_000 }] }
    const full = approveRoomChangeRequest(filled, first.request.id, approval())
    expect(full.ok).toBe(false)
    const moved = { ...first.data, roomAssignments: first.data.roomAssignments.map(item => item.tenantId === 'tenant-1' ? { ...item, roomId: 'room-2', id: 'changed-current' } : item) }
    expect(approveRoomChangeRequest(moved, first.request.id, approval()).ok).toBe(false)
  })

  it('allows the landlord to choose a different effective date and keeps requested date intact', () => {
    const first = submitRoomChangeRequest(createDemoData(), { ...draft, requestedStartDate: '2026-11-15' }, DEMO_DATE)
    if (!first.ok) throw new Error('request failed')
    const approved = approveRoomChangeRequest(first.data, first.request.id, { ...approval(), effectiveDate: '2026-11-20' })
    expect(approved.ok).toBe(true)
    if (!approved.ok) return
    expect(approved.request.requestedStartDate).toBe('2026-11-15')
    expect(approved.request.approvedStartDate).toBe('2026-11-20')
    expect(approved.data.roomAssignments.find(item => item.id === approved.request.resultingAssignmentId)?.startDate).toBe('2026-11-20')
    const oldAssignment = approved.data.roomAssignments.find(item => item.id === approved.request.currentAssignmentId)!
    expect(oldAssignment.endDate).toBe('2026-11-19')
  })

  it('keeps request history per tenant and exposes pending request notifications', () => {
    const first = submitRoomChangeRequest(createDemoData(), draft, DEMO_DATE)
    if (!first.ok) throw new Error('request failed')
    expect(roomChangeRequestsForTenant(first.data, 'tenant-1')).toHaveLength(1)
    expect(roomChangeRequestsForTenant(first.data, 'tenant-2')).toHaveLength(0)
    expect(pendingRoomChangeRequests(first.data)).toHaveLength(1)
    expect(latestRoomChangeRequest(first.data, 'tenant-1')?.id).toBe(first.request.id)
    expect(selectNotifications(first.data, DEMO_DATE).find(item => item.kind === 'room-change')?.href).toBe('/tenants')
  })

  it('flags the affected billing period only when the effective date is inside that period', () => {
    const base = createDemoData()
    const withDecember = { ...base, billingPeriods: [...base.billingPeriods, { id: 'period-dec', label: 'December 2026 (sample)', startDate: '2026-12-01', endDate: '2026-12-31', status: 'OPEN' as const }] }
    const boundary = submitRoomChangeRequest(withDecember, { ...draft, requestedStartDate: '2026-12-01' }, DEMO_DATE)
    if (!boundary.ok) throw new Error(JSON.stringify(boundary.errors))
    const approvedBoundary = approveRoomChangeRequest(boundary.data, boundary.request.id, { ...approval(), effectiveDate: '2026-12-01' })
    expect(approvedBoundary.ok).toBe(true)
    if (!approvedBoundary.ok) return
    expect(approvedBoundary.request.billingReviewPeriodIds).toEqual([])
    expect(approvedRoomChangeBillingReviews(approvedBoundary.data, 'period-dec')).toEqual([])

    const middle = submitRoomChangeRequest(createDemoData(), { ...draft, requestedStartDate: '2026-11-15' }, DEMO_DATE)
    if (!middle.ok) throw new Error('request failed')
    const approvedMiddle = approveRoomChangeRequest(middle.data, middle.request.id, approval())
    expect(approvedMiddle.ok).toBe(true)
    if (!approvedMiddle.ok) return
    expect(approvedMiddle.request.billingReviewPeriodIds).toEqual(['period-nov'])
    expect(approvedRoomChangeBillingReviews(approvedMiddle.data, 'period-nov')).toHaveLength(1)
  })

  it('moves a tenant into an occupied shared room without replacing either room cycle or creating obligations', () => {
    const base = createDemoData()
    const request = submitRoomChangeRequest(base, { ...draft, tenantId: 'tenant-2', requestedRoomId: 'room-1' }, DEMO_DATE)
    if (!request.ok) throw new Error(JSON.stringify(request.errors))
    const approved = approveRoomChangeRequest(request.data, request.request.id, approval())
    expect(approved.ok).toBe(true)
    if (!approved.ok) return
    expect(approved.data.occupancyCycles).toEqual(base.occupancyCycles)
    expect(approved.data.moveInObligations).toEqual(base.moveInObligations)
    expect(approved.data.occupancyCycles.find(cycle => cycle.roomId === 'room-1')).toMatchObject({ status: 'ACTIVE', endedAt: null })
    expect(approved.data.occupancyCycles.find(cycle => cycle.roomId === 'room-2')).toMatchObject({ status: 'ACTIVE', endedAt: null })
    expect(approved.data.roomAssignments.filter(item => item.roomId === 'room-1' && item.endDate === null).map(item => item.tenantId).sort()).toEqual(['tenant-1', 'tenant-2'])
    expect(approved.data.roomAssignments.filter(item => item.roomId === 'room-2' && item.endDate === null).map(item => item.tenantId)).toEqual(['tenant-4'])
  })

  it('does not duplicate move-in obligations when joining an occupied room with an existing cycle', () => {
    let data = prototypeReducer(createDemoData(), { type: 'tenant/created', draft: { name: 'Target Occupant', email: 'target@example.com', phone: '+63 900 555 0001', address: 'Test', roomId: 'room-10', moveInDate: '2026-11-01', notes: '' } })
    data = prototypeReducer(data, { type: 'tenant/created', draft: { name: 'Moving Tenant', email: 'moving@example.com', phone: '+63 900 555 0002', address: 'Test', roomId: 'room-9', moveInDate: '2026-11-01', notes: '' } })
    const mover = data.tenants.find(tenant => tenant.email === 'moving@example.com')!
    const targetCycle = data.occupancyCycles.find(cycle => cycle.roomId === 'room-10' && cycle.status === 'ACTIVE')!
    const request = submitRoomChangeRequest(data, { ...draft, tenantId: mover.id, requestedRoomId: 'room-10' }, DEMO_DATE)
    if (!request.ok) throw new Error(JSON.stringify(request.errors))
    const approved = approveRoomChangeRequest(request.data, request.request.id, approval())
    expect(approved.ok).toBe(true)
    if (!approved.ok) return
    expect(approved.data.moveInObligations).toHaveLength(2)
    expect(approved.data.charges.filter(charge => charge.category === 'ADVANCE' || charge.category === 'SECURITY_DEPOSIT')).toHaveLength(4)
    expect(approved.data.occupancyCycles.find(cycle => cycle.id === targetCycle.id)).toEqual(targetCycle)
    expect(approved.data.roomAssignments.filter(item => item.roomId === 'room-10' && item.endDate === null)).toHaveLength(2)
    expect(approved.data.occupancyCycles.find(cycle => cycle.roomId === 'room-9')).toMatchObject({ status: 'CLOSED' })
  })

  it('makes Room 02 occupied immediately when a Room 06 occupant transfers effective today', () => {
    let data = prototypeReducer(createDemoData(), { type: 'tenant/created', draft: { name: 'Room 06 First', email: 'r06first@example.com', phone: '+63 900 555 0101', address: 'Test', roomId: 'room-13', moveInDate: '2026-11-01', notes: '' } })
    data = prototypeReducer(data, { type: 'tenant/created', draft: { name: 'Room 06 Second', email: 'r06second@example.com', phone: '+63 900 555 0102', address: 'Test', roomId: 'room-13', moveInDate: '2026-11-01', notes: '' } })
    const room06 = data.rooms.find(room => room.name === '06')!
    const room02 = data.rooms.find(room => room.name === '02')!
    const occupants = roomOccupants(data, room06.id, DEMO_DATE)
    expect(occupants).toHaveLength(2)
    const [mover, remaining] = occupants
    const request = submitRoomChangeRequest(data, { tenantId: mover!.id, requestedRoomId: room02.id, requestedStartDate: DEMO_DATE, reason: 'Move to Room 02' }, DEMO_DATE)
    if (!request.ok) throw new Error(JSON.stringify(request.errors))
    const approved = approveRoomChangeRequest(request.data, request.request.id, approval())
    expect(approved.ok).toBe(true)
    if (!approved.ok) return
    expect(roomOccupants(approved.data, room02.id, DEMO_DATE).map(tenant => tenant.id)).toEqual([mover!.id])
    expect(roomOccupancy(approved.data, room02, DEMO_DATE)).toBe('OCCUPIED')
    expect(roomOccupants(approved.data, room06.id, DEMO_DATE).map(tenant => tenant.id)).toEqual([remaining!.id])
    expect(roomOccupancy(approved.data, room06, DEMO_DATE)).toBe('OCCUPIED')
  })

  it('keeps a future-dated Room 02 transfer inactive until its effective date', () => {
    let data = prototypeReducer(createDemoData(), { type: 'tenant/created', draft: { name: 'Future Mover', email: 'future.mover@example.com', phone: '+63 900 555 0103', address: 'Test', roomId: 'room-13', moveInDate: '2026-11-01', notes: '' } })
    data = prototypeReducer(data, { type: 'tenant/created', draft: { name: 'Future Remaining', email: 'future.remaining@example.com', phone: '+63 900 555 0104', address: 'Test', roomId: 'room-13', moveInDate: '2026-11-01', notes: '' } })
    const room06 = data.rooms.find(room => room.name === '06')!
    const room02 = data.rooms.find(room => room.name === '02')!
    const mover = roomOccupants(data, room06.id, DEMO_DATE).find(tenant => tenant.name === 'Future Mover')!
    const futureDate = addDays(OCCUPANCY_DATE, 5)
    const request = submitRoomChangeRequest(data, { tenantId: mover.id, requestedRoomId: room02.id, requestedStartDate: futureDate, reason: 'Future move' }, DEMO_DATE)
    if (!request.ok) throw new Error(JSON.stringify(request.errors))
    const approved = approveRoomChangeRequest(request.data, request.request.id, { ...approval(), effectiveDate: futureDate })
    expect(approved.ok).toBe(true)
    if (!approved.ok) return
    expect(roomOccupants(approved.data, room02.id, DEMO_DATE)).toEqual([])
    expect(roomOccupancy(approved.data, room02, DEMO_DATE)).toBe('RESERVED')
    expect(roomOccupants(approved.data, room02.id, futureDate).map(tenant => tenant.id)).toEqual([mover.id])
    expect(roomOccupancy(approved.data, room02, futureDate)).toBe('OCCUPIED')
    expect(roomOccupants(approved.data, room06.id, futureDate)).toHaveLength(1)
    const effective = reconcileOccupancy(approved.data, approved.data, futureDate, { createMoveInObligations: false })
    expect(effective.occupancyCycles.find(cycle => cycle.roomId === room02.id && cycle.status === 'ACTIVE')).toBeDefined()
    expect(effective.occupancyCycles.find(cycle => cycle.roomId === room06.id)).toMatchObject({ status: 'ACTIVE', endedAt: null })
  })

  it('persists requests and migrates version 13 with an empty request queue', async () => {
    const first = submitRoomChangeRequest(createDemoData(), draft, DEMO_DATE)
    if (!first.ok) throw new Error('request failed')
    expect(await localStorageRepository.save(first.data)).toBeNull()
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).version).toBe(STORAGE_SCHEMA_VERSION)
    expect((await localStorageRepository.load()).data).toEqual(first.data)
    const legacy = { ...createDemoData(), roomChangeRequests: undefined }
    const parsed = parsePrototypeSnapshot(JSON.stringify({ version: 13, data: legacy }))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.data.roomChangeRequests).toEqual([])

    const approved = approveRoomChangeRequest(first.data, first.request.id, approval())
    if (!approved.ok) throw new Error('approval failed')
    const { billingReviewPeriodIds: legacyField, ...legacyRequest } = approved.data.roomChangeRequests[0]!
    expect(legacyField).toEqual(['period-nov'])
    const version14 = parsePrototypeSnapshot(JSON.stringify({ version: 14, data: { ...approved.data, roomChangeRequests: [legacyRequest] } }))
    expect(version14.ok).toBe(true)
    if (version14.ok) expect(version14.data.roomChangeRequests[0]?.billingReviewPeriodIds).toEqual(['period-nov'])
  })

  it('does not change existing landlord transfer behavior', () => {
    const data = createDemoData()
    const next = prototypeReducer(data, { type: 'tenant/updated', tenantId: 'tenant-1', draft: { name: data.tenants[0]!.name, email: data.tenants[0]!.email, phone: data.tenants[0]!.phone, address: data.tenants[0]!.address, roomId: 'room-13', moveInDate: DEMO_DATE, notes: '' } })
    expect(next.roomAssignments.some(item => item.tenantId === 'tenant-1' && item.roomId === 'room-13')).toBe(true)
    expect(next.roomChangeRequests).toEqual([])
  })
})