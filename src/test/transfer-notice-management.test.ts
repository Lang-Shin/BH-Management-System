import { describe, expect, it } from 'vitest'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import { createDemoData, DEMO_DATE } from '@/data/fixtures/demo'
import { createEmptyData } from '@/data/fixtures/empty'
import { legacyRoomLayoutRooms } from '@/domain/calculations/room-management'
import { reconcileOccupancy, prepareMoveInPayment, selectMoveInObligations } from '@/domain/calculations/move-in'
import { prepareRentPrepayment } from '@/domain/calculations/rent-schedule'
import { collectionCatalog } from '@/domain/calculations/payment-collection'
import {
  financialReviewResolutionBlockers, resolveFinancialReview,
} from '@/domain/calculations/financial-review-resolution'
import { isPrototypeData } from '@/domain/validation/prototype-data'
import type { PrototypeAppState } from '@/domain/types/models'
import type { TenantDraft } from '@/domain/calculations/tenant-management'

function draft(overrides: Partial<TenantDraft> = {}): TenantDraft {
  return {
    name: 'Notice Tenant', email: 'notice@example.com', phone: '+63 900 555 0121',
    address: 'Notice Street, Demo City', roomId: 'room-14', moveInDate: '2026-11-13', notes: '', ...overrides,
  }
}

function createTenant(data: PrototypeAppState, overrides: Partial<TenantDraft> = {}, asOf = '2026-11-13') {
  const next = prototypeReducer(data, { type: 'tenant/created', draft: draft(overrides), asOf })
  return { data: next, tenant: next.tenants.find(item => item.email === (overrides.email ?? draft().email))! }
}

function payMoveIn(data: PrototypeAppState, roomId: string, paidOn = DEMO_DATE) {
  const view = selectMoveInObligations(data, paidOn, roomId).find(item => item.cycle.status === 'ACTIVE')!
  const paid = prepareMoveInPayment(data, { obligationId: view.obligation.id, categories: ['ADVANCE', 'SECURITY_DEPOSIT'], paidOn })
  if (!paid.ok) throw new Error(paid.reason)
  return paid.data
}

function transferTenant(data: PrototypeAppState, tenantId: string, roomId: string, transferDate: string): PrototypeAppState {
  const tenant = data.tenants.find(item => item.id === tenantId)!
  return prototypeReducer(data, {
    type: 'tenant/updated', tenantId, asOf: transferDate,
    draft: draft({
      name: tenant.name, email: tenant.email, phone: tenant.phone, address: tenant.address,
      roomId, moveInDate: transferDate,
    }),
  })
}

describe('room provenance warning', () => {
  it('does not classify a newly created Room 101 as legacy', () => {
    const empty = createEmptyData(DEMO_DATE)
    const data = prototypeReducer(empty, {
      type: 'room/created', asOf: DEMO_DATE,
      draft: { name: '101', capacity: 1, categoryId: 'RATE_3500', kind: 'PRIVATE', status: 'available' },
    })
    const room = data.rooms.find(item => item.name === '101')!
    expect(room.origin).toBe('USER_CREATED')
    expect(legacyRoomLayoutRooms(data)).toEqual([])
  })

  it('does not classify an older custom room with a generated ID as legacy', () => {
    const data = structuredClone(createEmptyData(DEMO_DATE))
    data.rooms.push({
      id: 'room-custom-101', name: '101', floor: 1, capacity: 1, kind: 'PRIVATE',
      status: 'available', categoryId: 'RATE_3500', washingMachineEnabled: false,
    })
    expect(legacyRoomLayoutRooms(data)).toEqual([])
  })

  it('retains the warning for confirmed or strongly inferred legacy rooms', () => {
    const data = structuredClone(createEmptyData(DEMO_DATE))
    data.rooms.push(
      {
        id: 'room-101', name: '101', floor: 1, capacity: 2, kind: 'SHARED',
        status: 'available', categoryId: 'RATE_3500', washingMachineEnabled: false,
      },
      {
        id: 'legacy-import-02', name: '102', floor: 1, capacity: 2, kind: 'SHARED',
        status: 'available', categoryId: 'RATE_3500', washingMachineEnabled: false, origin: 'LEGACY_IMPORT',
      },
      {
        id: 'room-103', name: '103', floor: 1, capacity: 2, kind: 'SHARED',
        status: 'available', categoryId: 'RATE_3500', washingMachineEnabled: false, origin: 'STANDARD',
      },
    )
    expect(legacyRoomLayoutRooms(data).map(room => room.name)).toEqual(['101', '102'])
    expect(isPrototypeData(data)).toBe(true)
  })
})

describe('transfer review reconciliation', () => {
  it('does not turn an empty-destination prepaid transfer into a second occupied-destination review', () => {
    const created = createTenant(createDemoData())
    const paid = payMoveIn(created.data, 'room-14')
    const sourceCycle = paid.occupancyCycles.find(item => item.roomId === 'room-14' && item.status === 'ACTIVE')!
    const prepaid = prepareRentPrepayment(paid, { cycleId: sourceCycle.id, periodCount: 1, paidOn: DEMO_DATE })
    if (!prepaid.ok) throw new Error(prepaid.reason)
    const transferred = transferTenant(prepaid.data, created.tenant.id, 'room-15', '2026-11-20')
    const destination = transferred.occupancyCycles.find(cycle => cycle.roomId === 'room-15' && cycle.status === 'ACTIVE')!
    expect(destination.cycleOrigin).toBe('TRANSFER')
    expect(destination.transferSourceAssignmentId).toBe(created.data.roomAssignments.find(item => item.tenantId === created.tenant.id)!.id)
    const before = transferred.financialReviewCases.filter(review => review.status === 'OPEN')
    expect(before.filter(review => review.type === 'TRANSFER_PREPAID_RENT')).toHaveLength(1)
    expect(before.filter(review => review.type === 'TRANSFER_RENT_DIFFERENCE')).toHaveLength(0)

    const reconciled = reconcileOccupancy(transferred, transferred, '2026-11-20', { createMoveInObligations: false })
    expect(reconciled.financialReviewCases.filter(review => review.status === 'OPEN')).toEqual(before)
  })

  it('still creates the occupied-destination review when the destination cycle pre-existed', () => {
    const first = createTenant(createDemoData())
    const paidFirst = payMoveIn(first.data, 'room-14')
    const second = createTenant(paidFirst, {
      name: 'Occupied Destination', email: 'occupied.notice@example.com', roomId: 'room-15',
    }, '2026-11-14')
    const paidSecond = payMoveIn(second.data, 'room-15', '2026-11-14')
    const transferred = transferTenant(paidSecond, second.tenant.id, 'room-14', '2026-11-18')
    const destination = transferred.occupancyCycles.find(cycle => cycle.roomId === 'room-14' && cycle.status === 'ACTIVE')!
    expect(destination.transferSourceAssignmentId).toBeNull()
    expect(transferred.financialReviewCases.some(review => review.type === 'TRANSFER_RENT_DIFFERENCE'
      && review.roomId === 'room-14' && review.status === 'OPEN')).toBe(true)
  })
})

describe('financial review resolution', () => {
  it('requires an open case, reason, and acknowledgment', () => {
    const transferred = occupiedTransfer()
    const review = transferred.financialReviewCases.find(item => item.type === 'TRANSFER_RENT_DIFFERENCE' && item.status === 'OPEN')!
    expect(resolveFinancialReview(transferred, { reviewId: 'missing', reason: 'Reviewed', acknowledged: true, asOf: '2026-11-20' }))
      .toMatchObject({ ok: false, error: 'REVIEW_NOT_FOUND' })
    expect(resolveFinancialReview(transferred, { reviewId: review.id, reason: '', acknowledged: true, asOf: '2026-11-20' }))
      .toMatchObject({ ok: false, error: 'REASON_REQUIRED' })
    expect(resolveFinancialReview(transferred, { reviewId: review.id, reason: 'Reviewed', acknowledged: false, asOf: '2026-11-20' }))
      .toMatchObject({ ok: false, error: 'ACKNOWLEDGEMENT_REQUIRED' })
  })

  it('resolves an eligible transfer review, audits it, and preserves financial records', () => {
    const transferred = occupiedTransfer()
    const review = transferred.financialReviewCases.find(item => item.type === 'TRANSFER_RENT_DIFFERENCE' && item.status === 'OPEN')!
    const before = {
      payments: structuredClone(transferred.payments), receipts: structuredClone(transferred.receipts),
      charges: structuredClone(transferred.charges), obligations: structuredClone(transferred.rentObligations),
      allocations: structuredClone(transferred.paymentAllocations),
    }
    const result = resolveFinancialReview(transferred, {
      reviewId: review.id, reason: 'Reviewed source and destination periods with the authorized workflow.',
      acknowledged: true, asOf: '2026-11-20',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(isPrototypeData(result.data)).toBe(true)
    expect(result.review).toMatchObject({ status: 'RESOLVED', resolvedAt: '2026-11-20', resolvedBy: 'landlord', resolutionReason: expect.stringContaining('Reviewed source') })
    expect(result.data.auditEvents.at(-1)).toMatchObject({
      action: 'FINANCIAL_REVIEW_RESOLVED', entityType: 'FINANCIAL_REVIEW_CASE', entityId: review.id,
    })
    expect(result.data.payments).toEqual(before.payments)
    expect(result.data.receipts).toEqual(before.receipts)
    expect(result.data.charges).toEqual(before.charges)
    expect(result.data.rentObligations).toEqual(before.obligations)
    expect(result.data.paymentAllocations).toEqual(before.allocations)
    expect(resolveFinancialReview(result.data, {
      reviewId: review.id, reason: 'Second resolution', acknowledged: true, asOf: '2026-11-21',
    })).toMatchObject({ ok: false, error: 'ALREADY_RESOLVED' })
  })

  it('restores rent collection eligibility only after a legitimate transfer review resolution', () => {
    const transferred = occupiedTransfer()
    const review = transferred.financialReviewCases.find(item => item.type === 'TRANSFER_RENT_DIFFERENCE' && item.status === 'OPEN')!
    const destinationCycle = transferred.occupancyCycles.find(cycle => cycle.id === review.occupancyCycleId)!
    const obligation = transferred.rentObligations.find(item => item.occupancyCycleId === destinationCycle.id)!
    const modified: PrototypeAppState = {
      ...transferred,
      rentObligations: transferred.rentObligations.map(item => item.id === obligation.id
        ? { ...item, source: 'REGULAR', amountCents: item.amountCents + 100_000, rateSnapshotCents: item.amountCents + 100_000 }
        : item),
    }
    const blocked = collectionCatalog(modified, destinationCycle.roomId, '2026-11-20').find(item => item.category === 'RENT')!
    expect(blocked.selectable).toBe(false)
    expect(blocked.detail).toContain('open financial review')
    const resolved = resolveFinancialReview(modified, {
      reviewId: review.id, reason: 'Reviewed and reconciled the transfer rent difference.', acknowledged: true, asOf: '2026-11-20',
    })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    const available = collectionCatalog(resolved.data, destinationCycle.roomId, '2026-11-20').find(item => item.category === 'RENT')!
    expect(available.selectable).toBe(true)
    expect(available.amountCents).toBeGreaterThan(0)
  })

  it('blocks resolution while source prepaid rent remains allocated', () => {
    const created = createTenant(createDemoData())
    const paid = payMoveIn(created.data, 'room-14')
    const cycle = paid.occupancyCycles.find(item => item.roomId === 'room-14' && item.status === 'ACTIVE')!
    const prepaid = prepareRentPrepayment(paid, { cycleId: cycle.id, periodCount: 1, paidOn: DEMO_DATE })
    if (!prepaid.ok) throw new Error(prepaid.reason)
    const transferred = transferTenant(prepaid.data, created.tenant.id, 'room-15', '2026-11-20')
    const review = transferred.financialReviewCases.find(item => item.type === 'TRANSFER_PREPAID_RENT' && item.status === 'OPEN')!
    expect(financialReviewResolutionBlockers(transferred, review, '2026-11-20')).toHaveLength(1)
    expect(resolveFinancialReview(transferred, {
      reviewId: review.id, reason: 'Reviewed prepaid transfer', acknowledged: true, asOf: '2026-11-20',
    })).toMatchObject({ ok: false, error: 'FINANCIAL_OPERATION_REQUIRED' })
    expect(transferred.payments).toEqual(prepaid.data.payments)
    expect(transferred.receipts).toEqual(prepaid.data.receipts)
  })
})

function occupiedTransfer(): PrototypeAppState {
  const first = createTenant(createDemoData())
  const firstPaid = payMoveIn(first.data, 'room-14')
  const second = createTenant(firstPaid, {
    name: 'Occupied Destination', email: 'occupied.resolution@example.com', roomId: 'room-15',
  }, '2026-11-14')
  const secondPaid = payMoveIn(second.data, 'room-15', '2026-11-14')
  return transferTenant(secondPaid, second.tenant.id, 'room-14', '2026-11-18')
}
