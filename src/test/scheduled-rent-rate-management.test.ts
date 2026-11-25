import { describe, expect, it } from 'vitest'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import { createEmptyData } from '@/data/fixtures/empty'
import {
  activeRoomRentRate, eligibleRoomRentRate, scheduledRoomRentRate,
} from '@/domain/calculations/billing-rates'
import {
  categoryPendingRate, categoryRateHistory, planRentRateChange,
  type RentRateChangeRequest,
} from '@/domain/calculations/rent-rate-management'
import { prepareMoveInPayment } from '@/domain/calculations/move-in'
import { ensureRegularRentPeriodsThrough, prepareRentPrepayment, quoteRentPrepayment } from '@/domain/calculations/rent-schedule'
import { prepaidRentReconciliation } from '@/domain/calculations/prepaid-rent-refund'
import { businessDate } from '@/server/date'
import { isPrototypeData } from '@/domain/validation/prototype-data'
import type { PrototypeAppState, RoomCategoryId } from '@/domain/types/models'

const AS_OF = '2026-11-13'
const EFFECTIVE = '2026-12-01'

function request(intent: RentRateChangeRequest['intent'], categoryId: RoomCategoryId, amountCents?: number, reason?: string): RentRateChangeRequest {
  return { intent, categoryId, ...(amountCents !== undefined ? { amountCents } : {}), ...(reason !== undefined ? { reason } : {}) }
}

function apply(data: PrototypeAppState, change: RentRateChangeRequest, asOf = AS_OF): PrototypeAppState {
  const plan = planRentRateChange(data, change, asOf)
  if (!plan.ok) throw new Error(`${plan.code}: ${plan.errors.general}`)
  const next = prototypeReducer(data, { type: 'rates/scheduledChange', ...change, ...(change.expectedRateId ? {} : {}), asOf })
  expect(next).not.toBe(data)
  expect(isPrototypeData(next)).toBe(true)
  return next
}

function pending(data: PrototypeAppState, categoryId: RoomCategoryId, asOf = AS_OF) {
  return categoryPendingRate(data, categoryId, asOf)
}

function editRequest(
  data: PrototypeAppState, categoryId: RoomCategoryId, amountCents: number, reason = 'Corrected planned increase',
  asOf = AS_OF,
): RentRateChangeRequest {
  const scheduled = pending(data, categoryId, asOf)
  if (!scheduled) throw new Error('Expected a pending rate')
  return {
    ...request('EDIT', categoryId, amountCents, reason), expectedRateId: scheduled.id,
    expectedRateRevision: scheduled.revision ?? 1,
  }
}

function cancelRequest(
  data: PrototypeAppState, categoryId: RoomCategoryId, reason = 'Rent increase no longer needed', asOf = AS_OF,
): RentRateChangeRequest {
  const scheduled = pending(data, categoryId, asOf)
  if (!scheduled) throw new Error('Expected a pending rate')
  return {
    ...request('CANCEL', categoryId, undefined, reason), expectedRateId: scheduled.id,
    expectedRateRevision: scheduled.revision ?? 1,
  }
}

function charlesWorkspace() {
  let data = createEmptyData(AS_OF)
  data = prototypeReducer(data, {
    type: 'tenant/created', asOf: AS_OF,
    draft: { name: 'Charles', email: 'charles@example.com', phone: '', address: '', notes: '', roomId: 'room-1', moveInDate: AS_OF },
  })
  const obligation = data.moveInObligations.find(item => item.roomId === 'room-1')!
  const paid = prepareMoveInPayment(data, {
    obligationId: obligation.id, categories: ['ADVANCE', 'SECURITY_DEPOSIT'], paidOn: AS_OF,
  })
  if (!paid.ok) throw new Error(paid.reason)
  const cycle = paid.data.occupancyCycles.find(item => item.roomId === 'room-1' && item.status === 'ACTIVE')!
  return { data: paid.data, cycle, tenant: paid.data.tenants.find(item => item.name === 'Charles')! }
}

describe('scheduled rental rate management', () => {
  it('schedules an independent category rate without changing the active rate or historical records', () => {
    const data = createEmptyData(AS_OF)
    const charges = structuredClone(data.charges)
    const receipts = structuredClone(data.receipts)
    const next = apply(data, request('SCHEDULE', 'RATE_3500', 380_000))
    expect(activeRoomRentRate(next, 'RATE_3500', AS_OF)?.monthlyRentCents).toBe(350_000)
    expect(scheduledRoomRentRate(next, 'RATE_3500', AS_OF)).toMatchObject({
      monthlyRentCents: 380_000, effectiveFrom: EFFECTIVE, revision: 1, recordedBy: 'landlord',
    })
    expect(scheduledRoomRentRate(next, 'RATE_4000', AS_OF)).toBeUndefined()
    expect(next.charges).toEqual(charges)
    expect(next.receipts).toEqual(receipts)
    expect(next.auditEvents.at(-1)).toMatchObject({ action: 'RENT_RATE_SCHEDULED', entityType: 'RENT_RATE' })
  })

  it('edits a pending rate, keeps the effective date, and preserves the replaced schedule', () => {
    let data = apply(createEmptyData(AS_OF), request('SCHEDULE', 'RATE_3500', 380_000))
    const original = pending(data, 'RATE_3500')!
    data = apply(data, editRequest(data, 'RATE_3500', 360_000))
    const replacement = pending(data, 'RATE_3500')!
    expect(activeRoomRentRate(data, 'RATE_3500', AS_OF)?.monthlyRentCents).toBe(350_000)
    expect(replacement).toMatchObject({
      monthlyRentCents: 360_000, effectiveFrom: original.effectiveFrom, revision: 2,
      supersedesRateId: original.id,
    })
    const superseded = data.roomRentRates.find(rate => rate.id === original.id)!
    expect(superseded).toMatchObject({
      monthlyRentCents: 380_000, supersededByRateId: replacement.id,
      supersededReason: 'Corrected planned increase',
    })
    expect(superseded.supersededOn).toBe(AS_OF)
    expect(eligibleRoomRentRate(superseded)).toBe(false)
    expect(data.auditEvents.at(-1)).toMatchObject({ action: 'RENT_RATE_EDITED', reason: 'Corrected planned increase' })
  })

  it('cancels a pending rate without generating money records and retains cancellation history', () => {
    let data = apply(createEmptyData(AS_OF), request('SCHEDULE', 'RATE_3500', 380_000))
    const paymentCount = data.payments.length
    const receiptCount = data.receipts.length
    data = apply(data, cancelRequest(data, 'RATE_3500'))
    expect(pending(data, 'RATE_3500')).toBeUndefined()
    expect(scheduledRoomRentRate(data, 'RATE_3500', AS_OF)).toBeUndefined()
    expect(activeRoomRentRate(data, 'RATE_3500', AS_OF)?.monthlyRentCents).toBe(350_000)
    expect(activeRoomRentRate(data, 'RATE_3500', EFFECTIVE)?.monthlyRentCents).toBe(350_000)
    const canceled = data.roomRentRates.find(rate => rate.canceledOn)!
    expect(canceled).toMatchObject({ monthlyRentCents: 380_000, cancelReason: 'Rent increase no longer needed', canceledBy: 'landlord' })
    expect(eligibleRoomRentRate(canceled)).toBe(false)
    expect(data.payments).toHaveLength(paymentCount)
    expect(data.receipts).toHaveLength(receiptCount)
    expect(data.auditEvents.at(-1)).toMatchObject({ action: 'RENT_RATE_CANCELED', entityType: 'RENT_RATE' })
  })

  it('interprets an edit back to the current amount as a cancellation', () => {
    let data = apply(createEmptyData(AS_OF), request('SCHEDULE', 'RATE_3500', 380_000))
    const result = planRentRateChange(data, editRequest(data, 'RATE_3500', 350_000, 'Keep the current rent'), AS_OF)
    expect(result).toMatchObject({ ok: true, plan: { kind: 'CANCEL', currentCents: 350_000, scheduledCents: 380_000 } })
    data = apply(data, editRequest(data, 'RATE_3500', 350_000, 'Keep the current rent'))
    expect(pending(data, 'RATE_3500')).toBeUndefined()
    expect(activeRoomRentRate(data, 'RATE_3500', EFFECTIVE)?.monthlyRentCents).toBe(350_000)
    expect(data.auditEvents.at(-1)).toMatchObject({ action: 'RENT_RATE_CANCELED', reason: 'Keep the current rent' })
  })

  it('rejects no-change submissions, unchanged edits, and duplicate schedules', () => {
    const data = createEmptyData(AS_OF)
    expect(planRentRateChange(data, request('SCHEDULE', 'RATE_3500', 350_000), AS_OF))
      .toMatchObject({ ok: false, code: 'NO_CHANGE' })
    const scheduled = apply(data, request('SCHEDULE', 'RATE_3500', 380_000))
    expect(planRentRateChange(scheduled, request('SCHEDULE', 'RATE_3500', 390_000), AS_OF))
      .toMatchObject({ ok: false, code: 'PENDING_EXISTS' })
    expect(planRentRateChange(scheduled, editRequest(scheduled, 'RATE_3500', 380_000), AS_OF))
      .toMatchObject({ ok: false, code: 'UNCHANGED_SCHEDULE' })
  })

  it('requires reasons for edits and cancellations but not for initial scheduling', () => {
    const data = apply(createEmptyData(AS_OF), request('SCHEDULE', 'RATE_3500', 380_000))
    for (const change of [
      { ...editRequest(data, 'RATE_3500', 360_000), reason: '' },
      { ...cancelRequest(data, 'RATE_3500'), reason: '  ' },
    ]) {
      expect(planRentRateChange(data, change, AS_OF)).toMatchObject({ ok: false, code: 'REASON_REQUIRED' })
    }
  })

  it('edits and cancels categories independently without replacing unrelated pending changes', () => {
    let data = createEmptyData(AS_OF)
    data = apply(data, request('SCHEDULE', 'RATE_3500', 380_000))
    data = apply(data, request('SCHEDULE', 'RATE_4000', 450_000))
    const secondBefore = pending(data, 'RATE_4000')!
    data = apply(data, editRequest(data, 'RATE_3500', 360_000))
    expect(pending(data, 'RATE_4000')).toEqual(secondBefore)
    data = apply(data, cancelRequest(data, 'RATE_3500'))
    expect(pending(data, 'RATE_3500')).toBeUndefined()
    expect(pending(data, 'RATE_4000')).toEqual(secondBefore)
    expect(activeRoomRentRate(data, 'RATE_4000', EFFECTIVE)?.monthlyRentCents).toBe(450_000)
    expect(activeRoomRentRate(data, 'RATE_5000', EFFECTIVE)?.monthlyRentCents).toBe(500_000)
  })

  it('keeps canceled and replaced records in history but never activates them', () => {
    let data = createEmptyData(AS_OF)
    data = apply(data, request('SCHEDULE', 'RATE_3500', 380_000))
    data = apply(data, editRequest(data, 'RATE_3500', 360_000))
    data = apply(data, cancelRequest(data, 'RATE_3500'))
    const history = categoryRateHistory(data, 'RATE_3500')
    expect(history.some(rate => rate.monthlyRentCents === 380_000 && rate.supersededOn)).toBe(true)
    expect(history.some(rate => rate.monthlyRentCents === 360_000 && rate.canceledOn)).toBe(true)
    expect(activeRoomRentRate(data, 'RATE_3500', EFFECTIVE)?.monthlyRentCents).toBe(350_000)
    expect(scheduledRoomRentRate(data, 'RATE_3500', AS_OF)).toBeUndefined()
  })

  it('activates only the replacement rate on its effective date', () => {
    let data = createEmptyData(AS_OF)
    data = apply(data, request('SCHEDULE', 'RATE_3500', 380_000))
    data = apply(data, editRequest(data, 'RATE_3500', 360_000))
    expect(activeRoomRentRate(data, 'RATE_3500', EFFECTIVE)?.monthlyRentCents).toBe(360_000)
    expect(activeRoomRentRate(data, 'RATE_3500', '2026-11-30')?.monthlyRentCents).toBe(350_000)
  })

  it('rejects editing or canceling after the effective boundary', () => {
    const scheduled = apply(createEmptyData(AS_OF), request('SCHEDULE', 'RATE_3500', 380_000))
    const original = pending(scheduled, 'RATE_3500')!
    const staleEdit = {
      ...request('EDIT', 'RATE_3500', 360_000, 'Too late'), expectedRateId: original.id,
      expectedRateRevision: original.revision ?? 1,
    }
    const staleCancel = {
      ...request('CANCEL', 'RATE_3500', undefined, 'Too late'), expectedRateId: original.id,
      expectedRateRevision: original.revision ?? 1,
    }
    expect(planRentRateChange(scheduled, staleEdit, EFFECTIVE)).toMatchObject({ ok: false, code: 'EFFECTIVE_DATE_PASSED' })
    expect(planRentRateChange(scheduled, staleCancel, EFFECTIVE)).toMatchObject({ ok: false, code: 'EFFECTIVE_DATE_PASSED' })
  })

  it('rejects stale schedule identifiers and revisions', () => {
    const scheduled = apply(createEmptyData(AS_OF), request('SCHEDULE', 'RATE_3500', 380_000))
    const original = pending(scheduled, 'RATE_3500')!
    expect(planRentRateChange(scheduled, {
      ...request('EDIT', 'RATE_3500', 360_000, 'Stale browser'), expectedRateId: 'missing-rate', expectedRateRevision: 1,
    }, AS_OF)).toMatchObject({ ok: false, code: 'STALE_CHANGE' })
    expect(planRentRateChange(scheduled, {
      ...request('EDIT', 'RATE_3500', 360_000, 'Stale revision'), expectedRateId: original.id, expectedRateRevision: 9,
    }, AS_OF)).toMatchObject({ ok: false, code: 'STALE_CHANGE' })
    const first = apply(scheduled, editRequest(scheduled, 'RATE_3500', 360_000))
    const second = pending(first, 'RATE_3500')!
    expect(planRentRateChange(first, {
      ...request('CANCEL', 'RATE_3500', undefined, 'Second tab'), expectedRateId: original.id,
      expectedRateRevision: original.revision ?? 1,
    }, AS_OF)).toMatchObject({ ok: false, code: 'STALE_CHANGE' })
    expect(second.id).not.toBe(original.id)
  })

  it('blocks an edit or cancellation when an issued obligation depends on the pending rate', () => {
    let data = apply(createEmptyData(AS_OF), request('SCHEDULE', 'RATE_3500', 380_000))
    const pendingRate = pending(data, 'RATE_3500')!
    data = {
      ...data,
      rentObligations: [{
        id: 'rent-obligation-dependency', occupancyCycleId: 'cycle-dependency', rentalPeriodId: 'period-dependency', roomId: 'room-1',
        amountCents: 380_000, rateId: pendingRate.id, rateEffectiveFrom: pendingRate.effectiveFrom, rateSnapshotCents: 380_000,
        issuedOn: AS_OF, dueDate: '2027-01-01', source: 'REGULAR', state: 'ISSUED', correction: null,
      }],
    }
    expect(planRentRateChange(data, editRequest(data, 'RATE_3500', 360_000), AS_OF)).toMatchObject({ ok: false, code: 'DEPENDENCY_REVIEW_REQUIRED' })
    expect(planRentRateChange(data, cancelRequest(data, 'RATE_3500'), AS_OF)).toMatchObject({ ok: false, code: 'DEPENDENCY_REVIEW_REQUIRED' })
  })

  it('allows a new version to be scheduled after a cancellation without losing history', () => {
    let data = apply(createEmptyData(AS_OF), request('SCHEDULE', 'RATE_3500', 380_000))
    data = apply(data, cancelRequest(data, 'RATE_3500'))
    data = apply(data, request('SCHEDULE', 'RATE_3500', 370_000))
    const replacement = pending(data, 'RATE_3500')!
    expect(replacement).toMatchObject({ monthlyRentCents: 370_000, revision: 2 })
    expect(categoryRateHistory(data, 'RATE_3500').filter(rate => rate.effectiveFrom === EFFECTIVE)).toHaveLength(2)
    expect(categoryRateHistory(data, 'RATE_3500').some(rate => rate.canceledOn)).toBe(true)
  })

  it('uses the Asia/Manila calendar boundary for the business date', () => {
    expect(businessDate(new Date('2026-11-30T15:59:59.000Z'), 'Asia/Manila')).toBe('2026-11-30')
    expect(businessDate(new Date('2026-11-30T16:00:00.000Z'), 'Asia/Manila')).toBe('2026-12-01')
  })

  it('does not split anniversary periods or recalculate historical issued rent', () => {
    const { data, cycle } = charlesWorkspace()
    const firstObligation = data.rentObligations.find(item => item.occupancyCycleId === cycle.id)!
    const updated = ensureRegularRentPeriodsThrough(apply(data, request('SCHEDULE', 'RATE_3500', 380_000)), '2026-12-13')
    const periods = updated.rentalPeriods.filter(item => item.occupancyCycleId === cycle.id).sort((a, b) => a.sequence - b.sequence)
    const obligations = updated.rentObligations.filter(item => item.occupancyCycleId === cycle.id).sort((a, b) => a.rentalPeriodId.localeCompare(b.rentalPeriodId))
    expect(periods[0]).toMatchObject({ startDate: '2026-11-13', endDateExclusive: '2026-12-13' })
    expect(periods[1]).toMatchObject({ startDate: '2026-12-13', endDateExclusive: '2027-01-13' })
    expect(updated.rentObligations.find(item => item.id === firstObligation.id)).toEqual(firstObligation)
    expect(obligations.find(item => item.rentalPeriodId === periods[0]!.id)?.amountCents).toBe(350_000)
    expect(obligations.find(item => item.rentalPeriodId === periods[1]!.id)).toMatchObject({
      amountCents: 380_000, rateSnapshotCents: 380_000, rateEffectiveFrom: EFFECTIVE,
    })
  })

  it('keeps edited and canceled schedules from touching issued bills, receipts, or settled readings', () => {
    const scheduled = apply(createEmptyData(AS_OF), request('SCHEDULE', 'RATE_3500', 380_000))
    const snapshot = {
      charges: structuredClone(scheduled.charges), receipts: structuredClone(scheduled.receipts),
      meterReadings: structuredClone(scheduled.meterReadings), rentObligations: structuredClone(scheduled.rentObligations),
    }
    const edited = apply(scheduled, editRequest(scheduled, 'RATE_3500', 360_000))
    const canceled = apply(edited, cancelRequest(edited, 'RATE_3500'))
    expect(canceled.charges).toEqual(snapshot.charges)
    expect(canceled.receipts).toEqual(snapshot.receipts)
    expect(canceled.meterReadings).toEqual(snapshot.meterReadings)
    expect(canceled.rentObligations).toEqual(snapshot.rentObligations)
  })

  it('preserves every prepaid period and original receipt after a future rate increase', () => {
    const { data, cycle, tenant } = charlesWorkspace()
    const prepaid = prepareRentPrepayment(data, { cycleId: cycle.id, periodCount: 3, paidOn: AS_OF })
    if (!prepaid.ok) throw new Error(prepaid.reason)
    const receiptBefore = structuredClone(prepaid.receipt)
    const allocationsBefore = structuredClone(prepaid.data.paymentAllocations)
    const updated = apply(prepaid.data, request('SCHEDULE', 'RATE_3500', 380_000))
    const obligations = updated.rentObligations.filter(item => item.occupancyCycleId === cycle.id)
    expect(obligations).toHaveLength(4)
    expect(obligations.every(item => item.amountCents === 350_000 && item.rateSnapshotCents === 350_000)).toBe(true)
    expect(updated.receipts.find(item => item.id === receiptBefore.id)).toEqual(receiptBefore)
    expect(updated.paymentAllocations.filter(item => allocationsBefore.some(existing => existing.id === item.id))).toEqual(allocationsBefore)
    expect(updated.payments.find(item => item.id === prepaid.payment.id)?.amountCents).toBe(1_050_000)
    const reconciliationBefore = prepaidRentReconciliation(prepaid.data, tenant.id, '2027-03-13')!
    const reconciliationAfter = prepaidRentReconciliation(updated, tenant.id, '2027-03-13')!
    expect(reconciliationAfter.refundableCents).toBe(reconciliationBefore.refundableCents)
    const next = quoteRentPrepayment(ensureRegularRentPeriodsThrough(updated, '2027-03-13'), {
      cycleId: cycle.id, periodCount: 1, asOf: '2027-03-13',
    })
    expect(next.ok).toBe(true)
    if (!next.ok) return
    expect(next.quote.rateCents).toBe(380_000)
    expect(next.quote.periods[0]!.amountCents).toBe(380_000)
  })

  it('preserves a three-year prepayment at its original locked rate', () => {
    const { data, cycle } = charlesWorkspace()
    const prepaid = prepareRentPrepayment(data, { cycleId: cycle.id, periodCount: 36, paidOn: AS_OF })
    if (!prepaid.ok) throw new Error(prepaid.reason)
    const beforeReceipts = structuredClone(prepaid.data.receipts)
    const updated = apply(prepaid.data, request('SCHEDULE', 'RATE_3500', 380_000))
    const obligations = updated.rentObligations.filter(item => item.occupancyCycleId === cycle.id)
    expect(obligations).toHaveLength(37)
    expect(obligations.every(item => item.amountCents === 350_000 && item.rateSnapshotCents === 350_000)).toBe(true)
    expect(updated.receipts).toEqual(beforeReceipts)
    expect(updated.rentPrepayments[0]).toMatchObject({ periodCount: 36, rateCents: 350_000, totalCents: 12_600_000 })
  })
})
