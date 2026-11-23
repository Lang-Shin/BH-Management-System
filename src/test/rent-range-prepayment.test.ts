import { describe, expect, it } from 'vitest'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import { createEmptyData } from '@/data/fixtures/empty'
import { calendarBillingPeriodForDate } from '@/domain/calculations/billing-periods'
import { selectBillingRent } from '@/domain/calculations/billing-rent'
import { prepareMoveInPayment } from '@/domain/calculations/move-in'
import { selectSummary } from '@/domain/calculations/summary'
import { prepareMeterInitialization } from '@/domain/calculations/meter-initialization'
import { collectionCatalog, prepareCollection, rentPrepaymentCatalog, type CollectionInput } from '@/domain/calculations/payment-collection'
import { buildPaymentCorrectionQuote } from '@/domain/calculations/payment-correction'
import {
  materializeRentRange, quoteRentRange, rentPrepaymentStarts, type RentRangeQuote,
} from '@/domain/calculations/rent-schedule'
import { rentObligationPaidCents, rentalPeriodsForCycle } from '@/domain/calculations/rental-periods'
import { isPrototypeData } from '@/domain/validation/prototype-data'
import type { Charge, Payment, PaymentAllocation, PrototypeAppState } from '@/domain/types/models'

function charlesWorkspace() {
  let data = createEmptyData('2026-11-13')
  data = prototypeReducer(data, { type: 'tenant/created', asOf: '2026-11-13', draft: {
    name: 'Charles Advance', email: 'charles@example.com', phone: '', address: '', notes: '', roomId: 'room-13', moveInDate: '2026-11-13',
  } })
  const obligation = data.moveInObligations.find(item => item.roomId === 'room-13')!
  const paid = prepareMoveInPayment(data, { obligationId: obligation.id, categories: ['ADVANCE', 'SECURITY_DEPOSIT'], paidOn: '2026-11-13' })
  if (!paid.ok) throw new Error(paid.reason)
  const cycle = paid.data.occupancyCycles.find(item => item.roomId === 'room-13' && item.status === 'ACTIVE')!
  return { data: paid.data, cycle }
}

function collectionInput(data: PrototypeAppState, quote: RentRangeQuote, transactionId: string): CollectionInput {
  const catalog = rentPrepaymentCatalog(data, quote.roomId, {
    cycleId: quote.cycleId, startSequence: quote.startSequence, periodCount: quote.periodCount,
  }, quote.rateLockedOn)
  if (!catalog.quote) throw new Error(catalog.reason ?? 'No rent range quote')
  return {
    transactionId, roomId: quote.roomId, readings: {}, collectedOn: quote.rateLockedOn,
    rentPrepayment: { cycleId: quote.cycleId, startSequence: quote.startSequence, periodCount: quote.periodCount },
    selections: catalog.items.map(({ id, amountCents, periodId, dueDate, basis }) => ({ id, amountCents, periodId, dueDate, basis })),
  }
}

function addPartialRentPayment(data: PrototypeAppState, rentObligationId: string, amountCents: number): PrototypeAppState {
  const payment: Payment = {
    id: 'payment-existing-partial', scope: 'ROOM', tenantId: null, roomId: 'room-13', occupancyCycleId: data.rentObligations.find(item => item.id === rentObligationId)!.occupancyCycleId,
    amountCents, paidOn: '2026-11-13', method: null, state: 'RECORDED', correction: null,
  }
  const allocation: PaymentAllocation = {
    id: `allocation-existing-partial-${rentObligationId}`, paymentId: payment.id, chargeId: rentObligationId,
    amountCents, allocatedOn: '2026-11-13', creditId: null, state: 'ACTIVE', reversalAuditEventId: null,
  }
  return { ...data, payments: [...data.payments, payment], paymentAllocations: [...data.paymentAllocations, allocation] }
}

describe('multi-month consecutive rent prepayment through the collection engine', () => {
  it('collects three periods after the advance-covered first period in one itemized payment', () => {
    const { data, cycle } = charlesWorkspace()
    expect(rentPrepaymentStarts(data, 'room-13', '2026-11-13').map(item => item.sequence)).toEqual([2])
    const quoted = quoteRentRange(data, { cycleId: cycle.id, startSequence: 2, periodCount: 3, asOf: '2026-11-13' })
    expect(quoted.ok).toBe(true)
    if (!quoted.ok) return
    expect(quoted.quote.periods.map(line => line.sequence)).toEqual([2, 3, 4])
    expect(quoted.quote.periods.map(line => line.startDate)).toEqual(['2026-12-13', '2027-01-13', '2027-02-13'])
    expect(quoted.quote.periods.map(line => line.endDateExclusive)).toEqual(['2027-01-13', '2027-02-13', '2027-03-13'])
    expect(quoted.quote.periods.map(line => line.dueDate)).toEqual(['2026-12-13', '2027-01-13', '2027-02-13'])
    expect(quoted.quote.periods.map(line => line.amountCents)).toEqual([400_000, 400_000, 400_000])
    expect(quoted.quote.totalCents).toBe(1_200_000)
    expect(quoted.quote.periods.some(line => line.sequence === 1)).toBe(false)

    const input = collectionInput(data, quoted.quote, 'charles-three-months')
    const result = prepareCollection(data, input)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(isPrototypeData(result.data)).toBe(true)
    expect(result.totalCents).toBe(1_200_000)
    expect(result.items).toHaveLength(3)
    expect(result.prepaymentId).toBe(`rent-prepayment-${cycle.id}-2-3`)
    const payment = result.data.payments.find(item => item.id === result.paymentId)!
    const receipt = result.data.receipts.find(item => item.id === result.receiptId)!
    expect(payment).toMatchObject({ amountCents: 1_200_000, paidOn: '2026-11-13', scope: 'ROOM', occupancyCycleId: cycle.id })
    expect(receipt.allocationIds).toHaveLength(3)
    expect(new Set(receipt.allocationIds).size).toBe(3)
    const obligations = result.data.rentObligations.filter(item => item.occupancyCycleId === cycle.id).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    expect(obligations).toHaveLength(4)
    expect(obligations.every(item => rentObligationPaidCents(result.data, item.id, '2026-11-13') === item.amountCents)).toBe(true)
    expect(obligations[0]!.source).toBe('MOVE_IN_ADVANCE')
    expect(obligations.slice(1).every(item => item.source === 'PREPAYMENT')).toBe(true)
    expect(obligations.every(item => item.rateSnapshotCents === 400_000)).toBe(true)
    expect(result.data.rentPrepayments).toHaveLength(1)
    expect(result.data.rentPrepayments[0]).toMatchObject({ paymentId: result.paymentId, periodCount: 3, totalCents: 1_200_000, rateCents: 400_000, rateLockedOn: '2026-11-13' })
    const november = calendarBillingPeriodForDate('2026-11-13')
    const december = calendarBillingPeriodForDate('2026-12-13')
    expect(selectSummary(result.data, '2026-11-13', november.id).received - selectSummary(data, '2026-11-13', november.id).received).toBe(1_200_000)
    expect(selectSummary(result.data, '2026-11-13', december.id).received).toBe(0)
    expect(selectBillingRent(result.data, 'room-13', december, '2026-11-13')).toMatchObject({ outstandingCents: 0, status: 'PAID' })
    expect(buildPaymentCorrectionQuote(result.data, {
      paymentId: result.paymentId, selectedCategories: ['RENT'], correctedElectricityReadingMilliKwh: null,
      reason: 'Incorrect prepayment', settlementStatus: 'CORRECTED', correctedAt: '2026-11-14',
    })).toEqual({ quoteError: 'RENT_LEDGER_CORRECTION_UNSUPPORTED' })
    expect(rentPrepaymentStarts(result.data, 'room-13', '2026-11-13').map(item => [item.sequence, item.startDate])).toEqual([[5, '2027-03-13']])
    expect(prepareCollection(result.data, { ...input, transactionId: 'charles-three-months-again' })).toEqual({ ok: false, reason: 'PAID_PERIOD_CONFLICT' })
  })

  it('opens an early-departure financial review without moving prepaid rent or refunds', () => {
    const { data, cycle } = charlesWorkspace()
    const tenant = data.tenants[0]!
    const quoted = quoteRentRange(data, { cycleId: cycle.id, startSequence: 2, periodCount: 3, asOf: '2026-11-13' })
    if (!quoted.ok) throw new Error(quoted.reason)
    const prepaid = prepareCollection(data, collectionInput(data, quoted.quote, 'early-departure-prepayment'))
    if (!prepaid.ok) throw new Error(prepaid.reason)
    const movedOut = prototypeReducer(prepaid.data, { type: 'tenant/movedOut', tenantId: tenant.id, asOf: '2027-01-05' })
    expect(movedOut.tenants.find(item => item.id === tenant.id)?.status).toBe('MOVED_OUT')
    expect(movedOut.financialReviewCases).toContainEqual(expect.objectContaining({
      type: 'PREPAID_RENT_EARLY_DEPARTURE', tenantId: tenant.id, occupancyCycleId: cycle.id, status: 'OPEN',
    }))
    expect(movedOut.payments.find(item => item.id === prepaid.paymentId)?.state).toBe('RECORDED')
    expect(movedOut.paymentAllocations.filter(item => item.paymentId === prepaid.paymentId)).toHaveLength(3)
    expect(movedOut.rentPrepayments).toHaveLength(1)
    expect(movedOut.advanceRefunds).toEqual([])
  })

  it('keeps prepaid rent tied to the source cycle when the tenant transfers rooms', () => {
    const { data, cycle } = charlesWorkspace()
    const tenant = data.tenants[0]!
    const quoted = quoteRentRange(data, { cycleId: cycle.id, startSequence: 2, periodCount: 3, asOf: '2026-11-13' })
    if (!quoted.ok) throw new Error(quoted.reason)
    const prepaid = prepareCollection(data, collectionInput(data, quoted.quote, 'transfer-prepayment'))
    if (!prepaid.ok) throw new Error(prepaid.reason)
    const transferred = prototypeReducer(prepaid.data, { type: 'tenant/updated', tenantId: tenant.id, asOf: '2027-01-05', draft: {
      name: tenant.name, email: tenant.email, phone: tenant.phone, address: tenant.address, notes: tenant.notes,
      roomId: 'room-15', moveInDate: '2027-01-05',
    } })
    const destination = transferred.occupancyCycles.find(item => item.status === 'ACTIVE' && item.roomId === 'room-15')!
    expect(transferred.financialReviewCases).toContainEqual(expect.objectContaining({
      type: 'TRANSFER_PREPAID_RENT', status: 'OPEN',
    }))
    expect(transferred.rentPrepayments).toHaveLength(1)
    expect(transferred.rentPrepayments[0]!.occupancyCycleId).toBe(cycle.id)
    expect(transferred.rentalPeriods.filter(item => item.occupancyCycleId === destination.id)).toHaveLength(0)
    expect(transferred.rentObligations.filter(item => item.occupancyCycleId === destination.id)).toHaveLength(0)
    expect(transferred.rentObligations.find(item => item.id === prepaid.items[0]!.id)?.roomId).toBe('room-13')
  })

  it('does not mutate or duplicate periods while quoting and materializes exactly once', () => {
    const { data, cycle } = charlesWorkspace()
    const before = JSON.stringify(data)
    const quoted = quoteRentRange(data, { cycleId: cycle.id, startSequence: 2, periodCount: 3, asOf: '2026-11-13' })
    expect(quoted.ok).toBe(true)
    expect(JSON.stringify(data)).toBe(before)
    if (!quoted.ok) return
    const materialized = materializeRentRange(data, quoted.quote)
    expect(rentalPeriodsForCycle(materialized, cycle.id).map(period => period.sequence)).toEqual([1, 2, 3, 4])
    const again = materializeRentRange(materialized, quoted.quote)
    expect(rentalPeriodsForCycle(again, cycle.id)).toHaveLength(4)
    expect(new Set(again.rentalPeriods.map(period => period.id)).size).toBe(again.rentalPeriods.length)
  })

  it('returns a paid-period conflict and never skips or extends the requested range', () => {
    const { data, cycle } = charlesWorkspace()
    const first = quoteRentRange(data, { cycleId: cycle.id, startSequence: 2, periodCount: 1, asOf: '2026-11-13' })
    if (!first.ok) throw new Error(first.reason)
    const paid = prepareCollection(data, collectionInput(data, first.quote, 'december-only'))
    if (!paid.ok) throw new Error(paid.reason)

    const conflicted = quoteRentRange(paid.data, { cycleId: cycle.id, startSequence: 2, periodCount: 3, asOf: '2026-11-13' })
    expect(conflicted.ok).toBe(false)
    expect(conflicted).toMatchObject({ reason: 'PAID_PERIOD_CONFLICT' })
    if (conflicted.ok) return
    expect(conflicted.quote?.periods.map(line => line.conflict)).toEqual(['ALREADY_PAID', null, null])
    expect(conflicted.quote?.periods.map(line => line.sequence)).toEqual([2, 3, 4])
    expect(rentPrepaymentStarts(paid.data, 'room-13', '2026-11-13').map(item => item.sequence)).toEqual([3])

    const revised = quoteRentRange(paid.data, { cycleId: cycle.id, startSequence: 3, periodCount: 2, asOf: '2026-11-13' })
    expect(revised.ok).toBe(true)
    if (!revised.ok) return
    expect(revised.quote.periods.map(line => line.sequence)).toEqual([3, 4])
    expect(revised.quote.totalCents).toBe(800_000)
    expect(prepareCollection(paid.data, collectionInput(paid.data, first.quote, 'overlapping-range'))).toEqual({ ok: false, reason: 'PAID_PERIOD_CONFLICT' })
  })

  it('locks the collection-time rate for new periods and leaves prepaid snapshots unchanged after a future increase', () => {
    const { data, cycle } = charlesWorkspace()
    const quoted = quoteRentRange(data, { cycleId: cycle.id, startSequence: 2, periodCount: 3, asOf: '2026-11-13' })
    if (!quoted.ok) throw new Error(quoted.reason)
    const paid = prepareCollection(data, collectionInput(data, quoted.quote, 'november-lock'))
    if (!paid.ok) throw new Error(paid.reason)

    const futureRate = { ...paid.data, roomRentRates: [...paid.data.roomRentRates, {
      id: 'rent-rate-RATE_4000-2026-12-01', categoryId: 'RATE_4000' as const, monthlyRentCents: 450_000,
      effectiveFrom: '2026-12-01', recordedOn: '2026-11-13',
    }] }
    expect(futureRate.rentObligations.filter(item => item.occupancyCycleId === cycle.id).every(item => item.rateSnapshotCents === 400_000)).toBe(true)
    const next = quoteRentRange(futureRate, { cycleId: cycle.id, startSequence: 5, periodCount: 1, asOf: '2026-12-01' })
    expect(next.ok).toBe(true)
    if (!next.ok) return
    expect(next.quote.rateCents).toBe(450_000)
    expect(next.quote.periods[0]).toMatchObject({ sequence: 5, originalCents: 450_000, amountCents: 450_000 })

    const stale = prepareCollection(futureRate, { ...collectionInput(data, quoted.quote, 'stale-rate'), collectedOn: '2026-12-01', rentPrepayment: { cycleId: cycle.id, startSequence: 2, periodCount: 3 } })
    expect(stale).toEqual({ ok: false, reason: 'PAID_PERIOD_CONFLICT' })
  })

  it('blocks a partially paid period for reconciliation under the approved all-or-nothing rent rule', () => {
    const { data, cycle } = charlesWorkspace()
    const quoted = quoteRentRange(data, { cycleId: cycle.id, startSequence: 2, periodCount: 1, asOf: '2026-11-13' })
    if (!quoted.ok) throw new Error(quoted.reason)
    const materialized = materializeRentRange(data, quoted.quote)
    const obligation = materialized.rentObligations.find(item => item.rentalPeriodId === quoted.quote.periods[0]!.rentalPeriodId)!
    const partial = addPartialRentPayment(materialized, obligation.id, 150_000)
    const catalog = rentPrepaymentCatalog(partial, 'room-13', { cycleId: cycle.id, startSequence: 2, periodCount: 1 }, '2026-11-13')
    expect(catalog.items[0]).toMatchObject({ amountCents: 0, originalCents: 400_000, periodStatus: 'PARTIALLY_PAID', selectable: false, prepaymentConflict: 'PARTIAL_RENT_REVIEW' })
    expect(catalog.reason).toBe('PARTIAL_RENT')
    const result = prepareCollection(partial, {
      transactionId: 'partial-completion', roomId: 'room-13', readings: {}, collectedOn: '2026-11-13',
      rentPrepayment: { cycleId: cycle.id, startSequence: 2, periodCount: 1 },
      selections: catalog.items.map(({ id, amountCents, periodId, dueDate, basis }) => ({ id, amountCents, periodId, dueDate, basis })),
    })
    expect(result).toEqual({ ok: false, reason: 'PARTIAL_RENT' })
    expect(rentObligationPaidCents(partial, obligation.id, '2026-11-13')).toBe(150_000)
  })

  it('combines prepaid rent with calendar-month water in one collection', () => {
    const { data, cycle } = charlesWorkspace()
    const quoted = quoteRentRange(data, { cycleId: cycle.id, startSequence: 2, periodCount: 3, asOf: '2026-11-13' })
    if (!quoted.ok) throw new Error(quoted.reason)
    const rentCatalog = rentPrepaymentCatalog(data, 'room-13', { cycleId: cycle.id, startSequence: 2, periodCount: 3 }, '2026-11-13')
    const water = collectionCatalog(data, 'room-13', '2026-11-13').find(item => item.category === 'WATER')!
    const selections = [...rentCatalog.items, water].map(({ id, amountCents, periodId, dueDate, basis }) => ({ id, amountCents, periodId, dueDate, basis }))
    const result = prepareCollection(data, {
      transactionId: 'rent-and-water', roomId: 'room-13', readings: {}, collectedOn: '2026-11-13',
      rentPrepayment: { cycleId: cycle.id, startSequence: 2, periodCount: 3 }, selections,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(isPrototypeData(result.data)).toBe(true)
    expect(result.totalCents).toBe(1_210_000)
    expect(result.data.receipts.find(receipt => receipt.id === result.receiptId)?.allocationIds).toHaveLength(4)
    expect(result.data.rentPrepayments[0]?.totalCents).toBe(1_200_000)
  })

  it('combines prepaid rent with water, washing, and one cumulative electricity settlement', () => {
    const { data, cycle } = charlesWorkspace()
    const tenant = data.tenants[0]!
    const initialized = prepareMeterInitialization(data, {
      roomId: 'room-13', readingMilliKwh: 100_000, readOn: '2026-11-13', initializedOn: '2026-11-13', sourceNote: 'Verified baseline',
    })
    if (!initialized.ok) throw new Error(initialized.reason)
    const washing: Charge = {
      id: 'verified-november-washing', tenantId: tenant.id, billingPeriodId: 'period-2026-11', category: 'WASHING_MACHINE',
      amountCents: 10_000, description: 'Verified November washing', entryMethod: 'MANUAL',
      issuedOn: '2026-11-13', dueDate: '2026-11-30', state: 'ISSUED', correction: null,
    }
    const withWashing = { ...initialized.data, charges: [...initialized.data.charges, washing] }
    const readings = { 'reading:meter-room-13:cumulative': 150_000 }
    const rent = rentPrepaymentCatalog(withWashing, 'room-13', { cycleId: cycle.id, startSequence: 2, periodCount: 3 }, '2026-11-13')
    const utilities = collectionCatalog(withWashing, 'room-13', '2026-11-13', readings).filter(item => item.category !== 'RENT')
    expect(utilities.filter(item => item.category === 'ELECTRICITY')).toHaveLength(1)
    expect(utilities.filter(item => item.category === 'WASHING_MACHINE')).toHaveLength(1)
    const selections = [...rent.items, ...utilities].map(({ id, amountCents, periodId, dueDate, basis }) => ({ id, amountCents, periodId, dueDate, basis }))
    const result = prepareCollection(withWashing, {
      transactionId: 'rent-utilities-prepayment', roomId: 'room-13', readings, collectedOn: '2026-11-13',
      rentPrepayment: { cycleId: cycle.id, startSequence: 2, periodCount: 3 }, selections,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(isPrototypeData(result.data)).toBe(true)
    expect(result.totalCents).toBe(1_285_000)
    expect(result.items.filter(item => item.category === 'RENT')).toHaveLength(3)
    expect(result.data.receipts.find(receipt => receipt.id === result.receiptId)?.allocationIds).toHaveLength(6)
    expect(result.data.rentPrepayments[0]?.totalCents).toBe(1_200_000)
    expect(result.data.charges.find(charge => charge.id === 'verified-november-washing')?.amountCents).toBe(10_000)
  })

  it('keeps one room-level schedule when an additional occupant joins', () => {
    const { data, cycle } = charlesWorkspace()
    const shared = prototypeReducer(data, { type: 'tenant/created', asOf: '2026-11-20', draft: {
      name: 'Charles Roommate', email: 'roommate@example.com', phone: '', address: '', notes: '', roomId: 'room-13', moveInDate: '2026-11-20',
    } })
    expect(shared.occupancyCycles.find(item => item.id === cycle.id)?.rentAnchorDate).toBe('2026-11-13')
    const quoted = quoteRentRange(shared, { cycleId: cycle.id, startSequence: 2, periodCount: 3, asOf: '2026-11-23' })
    expect(quoted.ok).toBe(true)
    if (!quoted.ok) return
    expect(quoted.quote.totalCents).toBe(1_200_000)
    const result = prepareCollection(shared, collectionInput(shared, quoted.quote, 'shared-prepayment'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.rentObligations.filter(item => item.occupancyCycleId === cycle.id)).toHaveLength(4)
    expect(result.data.payments.find(item => item.id === result.paymentId)?.tenantId).toBeNull()
  })

  it('derives short-month and leap-year starts from the original anchor', () => {
    let data = createEmptyData('2026-01-31')
    data = prototypeReducer(data, { type: 'tenant/created', asOf: '2026-01-31', draft: {
      name: 'Anchor Tenant', email: 'anchor@example.com', phone: '', address: '', notes: '', roomId: 'room-13', moveInDate: '2026-01-31',
    } })
    const first = data.moveInObligations.find(item => item.roomId === 'room-13')!
    const paid = prepareMoveInPayment(data, { obligationId: first.id, categories: ['ADVANCE', 'SECURITY_DEPOSIT'], paidOn: '2026-01-31' })
    if (!paid.ok) throw new Error(paid.reason)
    const cycle = paid.data.occupancyCycles.find(item => item.roomId === 'room-13' && item.status === 'ACTIVE')!
    const quoted = quoteRentRange(paid.data, { cycleId: cycle.id, startSequence: 2, periodCount: 3, asOf: '2026-01-31' })
    expect(quoted.ok).toBe(true)
    if (!quoted.ok) return
    expect(quoted.quote.periods.map(line => [line.startDate, line.endDateExclusive, line.dueDate])).toEqual([
      ['2026-02-28', '2026-03-31', '2026-02-28'],
      ['2026-03-31', '2026-04-30', '2026-03-31'],
      ['2026-04-30', '2026-05-31', '2026-04-30'],
    ])
  })

  it('derives leap-day anniversaries from the original anchor without drift', () => {
    let data = createEmptyData('2028-01-31')
    data = prototypeReducer(data, { type: 'tenant/created', asOf: '2028-01-31', draft: {
      name: 'Leap Tenant', email: 'leap@example.com', phone: '', address: '', notes: '', roomId: 'room-13', moveInDate: '2028-01-31',
    } })
    const first = data.moveInObligations.find(item => item.roomId === 'room-13')!
    const paid = prepareMoveInPayment(data, { obligationId: first.id, categories: ['ADVANCE', 'SECURITY_DEPOSIT'], paidOn: '2028-01-31' })
    if (!paid.ok) throw new Error(paid.reason)
    const cycle = paid.data.occupancyCycles.find(item => item.roomId === 'room-13' && item.status === 'ACTIVE')!
    const quoted = quoteRentRange(paid.data, { cycleId: cycle.id, startSequence: 2, periodCount: 2, asOf: '2028-01-31' })
    expect(quoted.ok).toBe(true)
    if (!quoted.ok) return
    expect(quoted.quote.periods.map(line => [line.startDate, line.endDateExclusive, line.dueDate])).toEqual([
      ['2028-02-29', '2028-03-31', '2028-02-29'],
      ['2028-03-31', '2028-04-30', '2028-03-31'],
    ])
  })

  it('does not collect an advance-covered range or a range without advance settlement', () => {
    const { data, cycle } = charlesWorkspace()
    const includingAdvance = quoteRentRange(data, { cycleId: cycle.id, startSequence: 1, periodCount: 2, asOf: '2026-11-13' })
    expect(includingAdvance).toMatchObject({ ok: false, reason: 'PAID_PERIOD_CONFLICT' })
    const unpaidAdvanceData = createEmptyData('2026-11-13')
    const created = prototypeReducer(unpaidAdvanceData, { type: 'tenant/created', asOf: '2026-11-13', draft: {
      name: 'Unpaid Advance', email: 'unpaid@example.com', phone: '', address: '', notes: '', roomId: 'room-13', moveInDate: '2026-11-13',
    } })
    const unpaidCycle = created.occupancyCycles.find(item => item.roomId === 'room-13')!
    expect(quoteRentRange(created, { cycleId: unpaidCycle.id, startSequence: 2, periodCount: 1, asOf: '2026-11-13' }))
      .toMatchObject({ ok: false, reason: 'ADVANCE_UNPAID' })
    expect(rentPrepaymentStarts(created, 'room-13', '2026-11-13')).toEqual([])
  })
})
