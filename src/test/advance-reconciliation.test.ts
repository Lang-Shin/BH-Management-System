import { describe, expect, it } from 'vitest'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import { createEmptyData } from '@/data/fixtures/empty'
import { repairMissingAdvanceApplications } from '@/domain/calculations/advance-reconciliation'
import { prepareMoveInPayment, selectMoveInObligations } from '@/domain/calculations/move-in'
import { selectBillingRooms } from '@/features/billing/billing-room-status'
import { buildRoomPaymentQuote, prepareRoomPayment } from '@/domain/calculations/room-payment'
import { ensureRegularRentPeriodsThrough } from '@/domain/calculations/rent-schedule'
import { selectSummary } from '@/domain/calculations/summary'
import type { PrototypeAppState } from '@/domain/types/models'

function addPaidTenant(data: PrototypeAppState, input: { roomId: string; name: string; moveInDate: string; email: string }) {
  const created = prototypeReducer(data, {
    type: 'tenant/created', asOf: '2026-11-23',
    draft: {
      name: input.name, email: input.email, phone: '+63 900 555 0800', address: '8 Test Street, Demo City',
      roomId: input.roomId, moveInDate: input.moveInDate, notes: '',
    },
  })
  const view = selectMoveInObligations(created, '2026-11-23', input.roomId).find(item => item.cycle.status === 'ACTIVE')!
  const paid = prepareMoveInPayment(created, {
    obligationId: view.obligation.id, categories: ['ADVANCE', 'SECURITY_DEPOSIT'], paidOn: input.moveInDate,
  })
  if (!paid.ok) throw new Error(paid.reason)
  return { data: paid.data }
}

function seededState() {
  let data = createEmptyData('2026-11-23')
  data = addPaidTenant(data, { roomId: 'room-2', name: 'Room Two Tenant', moveInDate: '2026-11-03', email: 'room2@example.com' }).data
  data = addPaidTenant(data, { roomId: 'room-7', name: 'Room Seven Tenant', moveInDate: '2026-11-06', email: 'room7@example.com' }).data
  data = addPaidTenant(data, { roomId: 'room-9', name: 'Room Zero One Tenant', moveInDate: '2026-11-10', email: 'room01@example.com' }).data
  return data
}

describe('legacy move-in advance reconciliation', () => {
  it('repairs missing first-rent applications for Room 2, Room 7, and Room 01 without creating cash', () => {
    const paid = seededState()
    expect(paid.advanceApplications).toHaveLength(3)
    const paymentCount = paid.payments.length
    const receiptCount = paid.receipts.length
    const broken: PrototypeAppState = { ...paid, advanceApplications: [], auditEvents: paid.auditEvents.filter(event => event.entityType !== 'ADVANCE_APPLICATION') }
    const before = selectSummary(broken, '2026-11-23', 'period-2026-11')

    for (const [roomId, expected] of [
      ['room-2', { name: 'Room 2', billed: 350_000, nextDue: '2026-12-03' }],
      ['room-7', { name: 'Room 7', billed: 350_000, nextDue: '2026-12-06' }],
      ['room-9', { name: 'Room 01', billed: 400_000, nextDue: '2026-12-10' }],
    ] as const) {
      const room = selectBillingRooms(broken, 'period-2026-11', '2026-11-23', false).find(item => item.context.roomId === roomId)!
      expect(room.context.label).toBe(expected.name)
      expect(room.rent).toMatchObject({ status: 'UNPAID', billedCents: expected.billed, paidCents: 0, outstandingCents: expected.billed })
    }

    const repaired = repairMissingAdvanceApplications(broken, '2026-11-23')
    expect(repaired.repaired.map(item => item.roomId).sort()).toEqual(['room-2', 'room-7', 'room-9'])
    expect(repaired.data.payments).toHaveLength(paymentCount)
    expect(repaired.data.receipts).toHaveLength(receiptCount)
    expect(repaired.data.advanceApplications).toHaveLength(3)
    expect(repaired.data.auditEvents.filter(event => event.id.startsWith('audit-advance-repair-'))).toHaveLength(3)

    for (const [roomId, expected] of [
      ['room-2', { billed: 350_000, nextDue: '2026-12-03' }],
      ['room-7', { billed: 350_000, nextDue: '2026-12-06' }],
      ['room-9', { billed: 400_000, nextDue: '2026-12-10' }],
    ] as const) {
      const room = selectBillingRooms(repaired.data, 'period-2026-11', '2026-11-23', false).find(item => item.context.roomId === roomId)!
      expect(room.rent).toMatchObject({
        status: 'PAID', billedCents: expected.billed, paidCents: expected.billed,
        outstandingCents: 0, advanceAppliedCents: expected.billed, cashPaidCents: 0,
      })
      const view = selectMoveInObligations(repaired.data, '2026-11-23', roomId)[0]!
      expect(view).toMatchObject({ advanceStatus: 'PAID', depositStatus: 'PAID', firstRentStatus: 'PAID' })
      expect(view.advanceApplication).toMatchObject({ rentObligationId: view.firstRentObligation!.id, state: 'ACTIVE' })
    }

    const withNextPeriods = ensureRegularRentPeriodsThrough(repaired.data, '2026-12-15')
    for (const [roomId, nextDue] of [['room-2', '2026-12-03'], ['room-7', '2026-12-06'], ['room-9', '2026-12-10']] as const) {
      const cycle = withNextPeriods.occupancyCycles.find(item => item.roomId === roomId && item.status === 'ACTIVE')!
      const nextPeriod = withNextPeriods.rentalPeriods.find(period => period.occupancyCycleId === cycle.id && period.sequence === 2)!
      expect(nextPeriod).toMatchObject({ startDate: nextDue, dueDate: nextDue })
      expect(withNextPeriods.rentObligations.find(item => item.rentalPeriodId === nextPeriod.id)).toMatchObject({ dueDate: nextDue })
    }

    const after = selectSummary(repaired.data, '2026-11-23', 'period-2026-11')
    expect(after.received).toBe(before.received)
    expect(after.applied).toBe(before.applied + 1_100_000)
    expect(after.billed).toBe(before.billed)

    const rentQuote = buildRoomPaymentQuote(repaired.data, {
      roomId: 'room-2', periodId: 'period-2026-11', selected: ['RENT'],
      electricityReadingMilliKwh: null, asOf: '2026-11-23',
    })
    expect(rentQuote.options.find(option => option.category === 'RENT')).toMatchObject({ state: 'PAID', amountCents: 0 })
    expect(rentQuote.selected).toEqual([])
    expect(prepareRoomPayment(repaired.data, {
      roomId: 'room-2', periodId: 'period-2026-11', selected: ['RENT'],
      electricityReadingMilliKwh: null, asOf: '2026-11-23',
    })).toEqual({ ok: false, reason: 'NO_SELECTION' })

    const again = repairMissingAdvanceApplications(repaired.data, '2026-11-23')
    expect(again.repaired).toEqual([])
    expect(again.data).toEqual(repaired.data)
  })

  it('does not settle rent from a deposit-only payment', () => {
    let data = createEmptyData('2026-11-23')
    data = prototypeReducer(data, {
      type: 'tenant/created', asOf: '2026-11-23',
      draft: {
        name: 'Deposit Only Tenant', email: 'deposit@example.com', phone: '+63 900 555 0801',
        address: '8 Test Street, Demo City', roomId: 'room-2', moveInDate: '2026-11-03', notes: '',
      },
    })
    const view = selectMoveInObligations(data, '2026-11-23', 'room-2')[0]!
    const paid = prepareMoveInPayment(data, {
      obligationId: view.obligation.id, categories: ['SECURITY_DEPOSIT'], paidOn: '2026-11-03',
    })
    if (!paid.ok) throw new Error(paid.reason)
    const repaired = repairMissingAdvanceApplications(paid.data, '2026-11-23')
    expect(repaired.repaired).toEqual([])
    expect(repaired.data.advanceApplications).toEqual([])
    const room = selectBillingRooms(repaired.data, 'period-2026-11', '2026-11-23', false).find(item => item.context.roomId === 'room-2')!
    expect(room.rent).toMatchObject({ status: 'UNPAID', outstandingCents: 350_000 })
    expect(selectMoveInObligations(repaired.data, '2026-11-23', 'room-2')[0]).toMatchObject({
      advanceStatus: 'NOT PAID', depositStatus: 'PAID', firstRentStatus: 'NOT PAID',
    })
  })

  it('opens a review instead of applying an advance when first rent already has cash payment', () => {
    const paid = seededState()
    const broken: PrototypeAppState = { ...paid, advanceApplications: [], auditEvents: paid.auditEvents.filter(event => event.entityType !== 'ADVANCE_APPLICATION') }
    const firstRent = broken.rentObligations.find(item => item.roomId === 'room-2')!
    const cashPaymentId = 'legacy-cash-rent-payment'
    broken.payments.push({
      id: cashPaymentId, scope: 'ROOM', tenantId: null, roomId: 'room-2', occupancyCycleId: firstRent.occupancyCycleId,
      amountCents: firstRent.amountCents, paidOn: '2026-11-20', method: null, state: 'RECORDED', correction: null,
    })
    broken.paymentAllocations.push({
      id: 'legacy-cash-rent-allocation', paymentId: cashPaymentId, chargeId: firstRent.id, amountCents: firstRent.amountCents,
      allocatedOn: '2026-11-20', creditId: null, state: 'ACTIVE', reversalAuditEventId: null,
    })

    const repaired = repairMissingAdvanceApplications(broken, '2026-11-23')
    expect(repaired.repaired.some(item => item.roomId === 'room-2')).toBe(false)
    expect(repaired.data.financialReviewCases.some(item => item.occupancyCycleId === firstRent.occupancyCycleId
      && item.type === 'ADVANCE_APPLICATION_REVIEW')).toBe(true)
    expect(repaired.data.advanceApplications.some(item => item.occupancyCycleId === firstRent.occupancyCycleId)).toBe(false)
  })
})
