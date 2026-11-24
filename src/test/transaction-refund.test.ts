import { describe, expect, it } from 'vitest'
import { createDemoData, DEMO_DATE, DEMO_PERIOD } from '@/data/fixtures/demo'
import { createEmptyData } from '@/data/fixtures/empty'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import { prepareMoveInPayment } from '@/domain/calculations/move-in'
import { prepareCollection } from '@/domain/calculations/payment-collection'
import { materializeRentRange, quoteRentRange, rentPrepaymentBasis } from '@/domain/calculations/rent-schedule'
import { rentObligationPaidCents } from '@/domain/calculations/rental-periods'
import { selectSummary } from '@/domain/calculations/summary'
import {
  buildUnifiedCorrectionQuote, prepareUnifiedCorrection, type CorrectionLineInput,
} from '@/domain/calculations/transaction-correction'
import {
  approvePrepaidRefund, completePrepaidRefund, preparePrepaidRefundProposal, prepaidRentReconciliation,
  reversePrepaidRefund, prepaidRefundCashOutCents,
} from '@/domain/calculations/prepaid-rent-refund'
import { isPrototypeData } from '@/domain/validation/prototype-data'
import type { PrototypeAppState } from '@/domain/types/models'

function createPaidTenant(data: PrototypeAppState, roomId: string, name: string, moveInDate: string) {
  const withTenant = prototypeReducer(data, { type: 'tenant/created', asOf: moveInDate, draft: {
    name, email: `${name.replace(/\s/g, '.')}@example.com`, phone: '', address: '', notes: '', roomId, moveInDate,
  } })
  const obligation = withTenant.moveInObligations.find(item => item.roomId === roomId)!
  const paid = prepareMoveInPayment(withTenant, { obligationId: obligation.id, categories: ['ADVANCE', 'SECURITY_DEPOSIT'], paidOn: moveInDate })
  if (!paid.ok) throw new Error(paid.reason)
  return paid.data
}

function charlesWorkspace(periodCount = 3, moveInDate = '2026-11-13') {
  const data = createPaidTenant(createEmptyData(moveInDate), 'room-13', 'Charles Refund', moveInDate)
  const cycle = data.occupancyCycles.find(item => item.roomId === 'room-13' && item.status === 'ACTIVE')!
  const quote = quoteRentRange(data, { cycleId: cycle.id, startSequence: 2, periodCount, asOf: moveInDate })
  if (!quote.ok) throw new Error(quote.reason)
  const paidRent = prepareCollection(data, {
    transactionId: `charles-refund-${periodCount}`, roomId: 'room-13', readings: {}, collectedOn: moveInDate,
    rentPrepayment: { cycleId: cycle.id, startSequence: 2, periodCount },
    selections: quote.quote.periods.map(line => ({
      id: line.rentObligationId, amountCents: line.amountCents, periodId: line.rentalPeriodId,
      dueDate: line.dueDate, basis: rentPrepaymentBasis(quote.quote, line),
    })),
  })
  if (!paidRent.ok) throw new Error(paidRent.reason)
  return { data: paidRent.data, cycle, tenant: paidRent.data.tenants.find(item => item.name === 'Charles Refund')!, paymentId: paidRent.paymentId }
}

function linesFromQuote(data: PrototypeAppState, paymentId: string): CorrectionLineInput[] {
  const quote = buildUnifiedCorrectionQuote(data, { paymentId, reason: 'Test correction', correctedAt: '2026-11-15' })
  if ('quoteError' in quote) throw new Error(quote.quoteError)
  return quote.originalLines.map(line => ({ targetId: line.targetId, category: line.category, amountCents: line.amountCents, sourceAllocationId: line.allocationId }))
}

function moveOut(data: PrototypeAppState, tenantId: string, date: string) {
  const next = prototypeReducer(data, { type: 'tenant/movedOut', tenantId, asOf: date })
  expect(next).not.toBe(data)
  expect(isPrototypeData(next)).toBe(true)
  return next
}

describe('unified transaction corrections', () => {
  it('corrects a mixed legacy rent, water, and washing transaction without changing unrelated cash', () => {
    const data = createDemoData()
    const lines = linesFromQuote(data, 'payment-1-rent-water-washing').filter(line => line.category !== 'WATER')
    const result = prepareUnifiedCorrection(data, {
      paymentId: 'payment-1-rent-water-washing', reason: 'Water belongs to another transaction', correctedAt: DEMO_DATE,
      lines, settlementStatus: 'CORRECTED',
    })
    if (!result.ok) throw new Error(result.reason)
    expect(isPrototypeData(result.data)).toBe(true)
    expect(result.receipt.amountCents).toBe(360_000)
    expect(result.correction).toMatchObject({ differenceCents: -10_000, settlementStatus: 'CORRECTED' })
    expect(result.data.payments.find(payment => payment.id === 'payment-1-rent-water-washing')?.state).toBe('VOIDED')
    expect(result.data.receipts.find(receipt => receipt.id === 'receipt-6')).toMatchObject({ state: 'SUPERSEDED', amountCents: 370_000 })
    expect(selectSummary(result.data, DEMO_DATE, DEMO_PERIOD).received).toBe(selectSummary(data, DEMO_DATE, DEMO_PERIOD).received - 10_000)
  })

  it('fully reverses a transaction without deleting its receipt or double-counting cash', () => {
    const data = createDemoData()
    const result = prepareUnifiedCorrection(data, {
      paymentId: 'payment-1-rent-water-washing', reason: 'Duplicate recording', correctedAt: DEMO_DATE,
      reverseAll: true, settlementStatus: 'CORRECTED',
    })
    if (!result.ok) throw new Error(result.reason)
    expect(isPrototypeData(result.data)).toBe(true)
    expect(result.payment.amountCents).toBe(0)
    expect(result.receipt.allocationIds).toEqual([])
    expect(result.correction).toMatchObject({ correctedAmountCents: 0, differenceCents: -370_000, settlementStatus: 'CORRECTED' })
    expect(result.data.receipts.find(receipt => receipt.id === 'receipt-6')?.state).toBe('SUPERSEDED')
    expect(result.data.receipts.find(receipt => receipt.id === result.receipt.id)?.state).toBe('ISSUED')
    expect(result.data.paymentAllocations.filter(allocation => allocation.paymentId === 'payment-1-rent-water-washing').every(allocation => allocation.state === 'REVERSED')).toBe(true)
    expect(selectSummary(result.data, DEMO_DATE, DEMO_PERIOD).received).toBe(selectSummary(data, DEMO_DATE, DEMO_PERIOD).received - 370_000)
    expect(prepareUnifiedCorrection(result.data, {
      paymentId: 'payment-1-rent-water-washing', reason: 'Duplicate', correctedAt: DEMO_DATE, reverseAll: true, settlementStatus: 'CORRECTED',
    })).toEqual({ ok: false, reason: 'PAYMENT_NOT_FOUND' })
  })

  it('corrects anniversary rent period allocation while preserving cash and historical rates', () => {
    const seeded = charlesWorkspace(3)
    const nextPeriod = quoteRentRange(seeded.data, { cycleId: seeded.cycle.id, startSequence: 5, periodCount: 1, asOf: '2026-11-13' })
    if (!nextPeriod.ok) throw new Error(nextPeriod.reason)
    const data = materializeRentRange(seeded.data, nextPeriod.quote)
    const target = nextPeriod.quote.periods[0]!
    const firstAllocation = data.paymentAllocations.find(allocation => allocation.paymentId === seeded.paymentId
      && allocation.chargeId === data.rentObligations.find(obligation => obligation.rentalPeriodId === seeded.data.rentPrepayments[0]!.rentalPeriodIds[0])!.id)!
    const lines = linesFromQuote(data, seeded.paymentId).map(line => line.targetId === firstAllocation.chargeId
      ? { ...line, targetId: target.rentObligationId, amountCents: target.originalCents } : line)
    const result = prepareUnifiedCorrection(data, {
      paymentId: seeded.paymentId, reason: 'Wrong anniversary period selected', correctedAt: '2026-11-15',
      lines, settlementStatus: 'CORRECTED',
    })
    if (!result.ok) throw new Error(result.reason)
    expect(isPrototypeData(result.data)).toBe(true)
    expect(result.payment.amountCents).toBe(1_200_000)
    expect(result.correction.differenceCents).toBe(0)
    expect(rentObligationPaidCents(result.data, firstAllocation.chargeId, '2026-11-15')).toBe(0)
    expect(rentObligationPaidCents(result.data, target.rentObligationId, '2026-11-15')).toBe(target.originalCents)
    expect(result.data.rentPrepayments.filter(item => (item.state ?? 'ACTIVE') === 'ACTIVE')).toHaveLength(1)
    expect(result.data.rentPrepayments.find(item => item.paymentId === result.payment.id)?.supersedesPrepaymentId).toBe(seeded.data.rentPrepayments[0]!.id)
    expect(result.data.rentPrepayments.find(item => item.id === seeded.data.rentPrepayments[0]!.id)?.state).toBe('SUPERSEDED')
  })

  it('keeps a move-in advance application consistent when the deposit is corrected independently', () => {
    let data = createEmptyData('2026-11-13')
    data = createPaidTenant(data, 'room-9', 'Advance Tenant', '2026-11-13')
    const obligation = data.moveInObligations[0]!
    const paymentId = data.payments.find(payment => payment.id.startsWith('payment-move-in-'))!.id
    const result = prepareUnifiedCorrection(data, {
      paymentId, reason: 'Deposit was not received', correctedAt: '2026-11-14',
      lines: linesFromQuote(data, paymentId).filter(line => line.category === 'ADVANCE'), settlementStatus: 'CORRECTED',
    })
    if (!result.ok) throw new Error(result.reason)
    expect(isPrototypeData(result.data)).toBe(true)
    expect(result.payment.amountCents).toBe(obligation.advanceRequiredCents)
    expect(result.data.advanceApplications[0]).toMatchObject({ state: 'ACTIVE', sourcePaymentId: result.payment.id })
    expect(result.data.paymentAllocations.some(allocation => allocation.chargeId === obligation.depositChargeId && allocation.state === 'ACTIVE')).toBe(false)
    expect(result.data.rentObligations[0]!.source).toBe('MOVE_IN_ADVANCE')
  })

  it('reverses a move-in advance and restores the first rent obligation', () => {
    let data = createEmptyData('2026-11-13')
    data = createPaidTenant(data, 'room-9', 'Advance Reverse', '2026-11-13')
    const paymentId = data.payments.find(payment => payment.id.startsWith('payment-move-in-'))!.id
    const result = prepareUnifiedCorrection(data, {
      paymentId, reason: 'Advance never received', correctedAt: '2026-11-14', reverseAll: true, settlementStatus: 'CORRECTED',
    })
    if (!result.ok) throw new Error(result.reason)
    expect(isPrototypeData(result.data)).toBe(true)
    expect(result.data.advanceApplications[0]?.state).toBe('REVERSED')
    expect(result.data.rentObligations[0]?.source).toBe('MOVE_IN_ADVANCE')
    expect(rentObligationPaidCents(result.data, result.data.rentObligations[0]!.id, '2026-11-14')).toBe(0)
    expect(result.payment.amountCents).toBe(0)
  })

  it('corrects a permitted payment method and a partial utility allocation', () => {
    const data = createDemoData()
    const initial = buildUnifiedCorrectionQuote(data, { paymentId: 'payment-1-rent-water-washing', reason: 'Method check', correctedAt: DEMO_DATE })
    if ('quoteError' in initial) throw new Error(initial.quoteError)
    const lines = initial.originalLines.map(line => ({ targetId: line.targetId, category: line.category, amountCents: line.amountCents, sourceAllocationId: line.allocationId }))
    const methodResult = prepareUnifiedCorrection(data, {
      paymentId: 'payment-1-rent-water-washing', reason: 'Method was recorded incorrectly', correctedAt: DEMO_DATE,
      lines, correctedMethod: 'bank-transfer', settlementStatus: 'CORRECTED',
    })
    if (!methodResult.ok) throw new Error(methodResult.reason)
    expect(isPrototypeData(methodResult.data)).toBe(true)
    expect(methodResult.payment.method).toBe('bank-transfer')

    const waterLine = initial.originalLines.find(line => line.category === 'WATER')!
    const partialResult = prepareUnifiedCorrection(data, {
      paymentId: 'payment-1-rent-water-washing', reason: 'Water amount was recorded too high', correctedAt: DEMO_DATE,
      lines: lines.map(line => line.targetId === waterLine.targetId ? { ...line, amountCents: line.amountCents - 1_000 } : line),
      settlementStatus: 'CORRECTED',
    })
    if (!partialResult.ok) throw new Error(partialResult.reason)
    expect(isPrototypeData(partialResult.data)).toBe(true)
    expect(partialResult.payment.amountCents).toBe(369_000)
    const waterPaid = partialResult.data.paymentAllocations.filter(allocation => allocation.chargeId === 'water-nov-tenant-1' && allocation.state === 'ACTIVE')
      .reduce((total, allocation) => total + allocation.amountCents, 0)
    expect(waterPaid).toBe(9_000)
  })
})

describe('prepaid rent refunds', () => {
  it('applies the seven-day rule to Charles and refunds exactly the future periods', () => {
    const seeded = charlesWorkspace(3)
    const movedOut = moveOut(seeded.data, seeded.tenant.id, '2026-12-20')
    const reconciliation = prepaidRentReconciliation(movedOut, seeded.tenant.id, '2026-12-20')!
    expect(reconciliation.periods.map(period => [period.startDate, period.occupiedDays, period.refundableCents])).toEqual([
      ['2026-12-13', 7, 0],
      ['2027-01-13', 0, 400_000],
      ['2027-02-13', 0, 400_000],
    ])
    expect(reconciliation).toMatchObject({ refundableCents: 800_000, nonRefundableCents: 400_000, totalPrepaidCents: 1_200_000 })
    const proposed = preparePrepaidRefundProposal(movedOut, { tenantId: seeded.tenant.id, moveOutDate: '2026-12-20', reason: 'Charles is moving out early.', asOf: '2026-12-20' })
    if (!proposed.ok) throw new Error(proposed.error)
    expect(proposed.refund).toMatchObject({ status: 'PROPOSED', amountCents: 800_000, refundedOn: null })
    expect(proposed.data.payments.find(payment => payment.id === seeded.paymentId)?.state).toBe('RECORDED')
    const approved = approvePrepaidRefund(proposed.data, { refundId: proposed.refund.id, asOf: '2026-12-20' })
    if (!approved.ok) throw new Error(approved.error)
    expect(approved.refund).toMatchObject({ status: 'APPROVED', refundedOn: null })
    expect(approved.data.paymentAllocations.filter(allocation => allocation.paymentId === seeded.paymentId && allocation.state === 'ACTIVE')).toHaveLength(3)
    const completed = completePrepaidRefund(approved.data, { refundId: approved.refund.id, refundedOn: '2026-12-20', asOf: '2026-12-20' })
    if (!completed.ok) throw new Error(completed.error)
    expect(isPrototypeData(completed.data)).toBe(true)
    expect(completed.refund).toMatchObject({ status: 'COMPLETED', amountCents: 800_000, refundedOn: '2026-12-20' })
    const futureObligations = completed.data.rentObligations.filter(obligation => obligation.occupancyCycleId === seeded.cycle.id)
      .filter(obligation => completed.data.rentalPeriods.find(period => period.id === obligation.rentalPeriodId)!.startDate >= '2026-12-20')
    expect(futureObligations.every(obligation => obligation.state === 'VOIDED')).toBe(true)
    expect(completed.data.payments.find(payment => payment.id === seeded.paymentId)?.amountCents).toBe(1_200_000)
    expect(completed.data.receipts.find(receipt => receipt.paymentId === seeded.paymentId)?.state).toBe('ISSUED')
    expect(completed.data.auditEvents.some(event => event.action === 'PREPAID_RENT_REFUND_COMPLETED' && event.entityId === completed.refund.id)).toBe(true)
    expect(selectSummary(completed.data, '2026-12-20').refundPaid).toBe(800_000)
    expect(buildUnifiedCorrectionQuote(completed.data, { paymentId: seeded.paymentId, reason: '', correctedAt: '2026-12-20' })).toEqual({ quoteError: 'REFUND_EXISTS' })
    expect(preparePrepaidRefundProposal(completed.data, {
      tenantId: seeded.tenant.id, moveOutDate: '2026-12-20', reason: 'Duplicate refund', asOf: '2026-12-20',
    })).toMatchObject({ ok: false, error: 'DUPLICATE_REFUND' })
  })

  it('requires review for a started period under seven days and still refunds future periods', () => {
    const seeded = charlesWorkspace(3)
    const movedOut = moveOut(seeded.data, seeded.tenant.id, '2026-12-19')
    const reconciliation = prepaidRentReconciliation(movedOut, seeded.tenant.id, '2026-12-19')!
    expect(reconciliation.periods[0]).toMatchObject({ occupiedDays: 6, status: 'REVIEW_REQUIRED', refundableCents: 0 })
    expect(reconciliation).toMatchObject({ refundableCents: 800_000, reviewRequiredCents: 400_000 })
  })

  it('supports long prepaid coverage without a new duration limit', () => {
    const seeded = charlesWorkspace(36)
    const movedOut = moveOut(seeded.data, seeded.tenant.id, '2026-11-20')
    const reconciliation = prepaidRentReconciliation(movedOut, seeded.tenant.id, '2026-11-20')!
    expect(reconciliation.periods).toHaveLength(36)
    expect(reconciliation.refundableCents).toBe(36 * 400_000)
    expect(reconciliation.periods.every(period => period.rateSnapshotCents === 400_000)).toBe(true)
  })

  it('corrects one allocation out of a three-year prepaid range', () => {
    const seeded = charlesWorkspace(36)
    const quote = buildUnifiedCorrectionQuote(seeded.data, { paymentId: seeded.paymentId, reason: '', correctedAt: '2026-11-15' })
    if ('quoteError' in quote) throw new Error(quote.quoteError)
    expect(quote.originalLines).toHaveLength(36)
    expect(new Set(quote.originalLines.map(line => line.periodLabel)).size).toBe(36)
    expect(quote.originalLines.every(line => /20\d{2}/.test(line.periodLabel ?? ''))).toBe(true)
    const result = prepareUnifiedCorrection(seeded.data, {
      paymentId: seeded.paymentId, reason: 'One future period was not prepaid', correctedAt: '2026-11-15',
      lines: quote.originalLines.slice(1).map(line => ({ targetId: line.targetId, category: line.category, amountCents: line.amountCents, sourceAllocationId: line.allocationId })),
      settlementStatus: 'CORRECTED',
    })
    if (!result.ok) throw new Error(result.reason)
    expect(isPrototypeData(result.data)).toBe(true)
    expect(result.payment.amountCents).toBe(35 * 400_000)
    expect(result.data.paymentAllocations.filter(allocation => allocation.paymentId === result.payment.id && allocation.state === 'ACTIVE')).toHaveLength(35)
    expect(result.data.rentPrepayments.filter(item => (item.state ?? 'ACTIVE') === 'ACTIVE')[0]?.periodCount).toBe(35)
  })

  it('rejects an amount above the eligible refund and blocks outstanding rooms', () => {
    const seeded = charlesWorkspace(3)
    const movedOut = moveOut(seeded.data, seeded.tenant.id, '2026-12-20')
    expect(preparePrepaidRefundProposal(movedOut, {
      tenantId: seeded.tenant.id, moveOutDate: '2026-12-20', reason: 'Too much', asOf: '2026-12-20', amountCents: 900_000,
    })).toMatchObject({ ok: false, error: 'REFUND_EXCEEDS_ELIGIBLE' })
    const withBill = { ...seeded.data, charges: [...seeded.data.charges, {
      id: 'unpaid-utility-block', tenantId: seeded.tenant.id, roomId: 'room-13', billingPeriodId: DEMO_PERIOD,
      category: 'WATER' as const, description: 'Unpaid water', amountCents: 10_000, issuedOn: '2026-11-13',
      dueDate: '2026-11-20', state: 'ISSUED' as const, correction: null, entryMethod: 'MANUAL' as const,
    }] }
    expect(preparePrepaidRefundProposal(withBill, {
      tenantId: seeded.tenant.id, moveOutDate: '2026-12-20', reason: 'Outstanding bill', asOf: '2026-12-20',
    })).toMatchObject({ ok: false, error: 'OUTSTANDING_BALANCE' })
  })

  it('requires entitlement verification for a shared-room refund', () => {
    const seeded = charlesWorkspace(3)
    const data = prototypeReducer(seeded.data, { type: 'tenant/created', asOf: '2026-11-13', draft: {
      name: 'Roommate', email: 'roommate@example.com', phone: '', address: '', notes: '', roomId: 'room-13', moveInDate: '2026-11-13',
    } })
    const movedOut = moveOut(data, seeded.tenant.id, '2026-12-20')
    const proposed = preparePrepaidRefundProposal(movedOut, { tenantId: seeded.tenant.id, moveOutDate: '2026-12-20', reason: 'Shared room review', asOf: '2026-12-20' })
    if (!proposed.ok) throw new Error(proposed.error)
    expect(proposed.refund.entitlementReviewRequired).toBe(true)
    expect(approvePrepaidRefund(proposed.data, { refundId: proposed.refund.id, asOf: '2026-12-20' }))
      .toMatchObject({ ok: false, error: 'ENTITLEMENT_REVIEW_REQUIRED' })
    expect(approvePrepaidRefund(proposed.data, { refundId: proposed.refund.id, asOf: '2026-12-20', entitlementConfirmed: true }).ok).toBe(true)
  })

  it('reverses a completed refund and restores its audited coverage', () => {
    const seeded = charlesWorkspace(3)
    const movedOut = moveOut(seeded.data, seeded.tenant.id, '2026-12-20')
    const proposed = preparePrepaidRefundProposal(movedOut, { tenantId: seeded.tenant.id, moveOutDate: '2026-12-20', reason: 'Refund and reversal', asOf: '2026-12-20' })
    if (!proposed.ok) throw new Error(proposed.error)
    const approved = approvePrepaidRefund(proposed.data, { refundId: proposed.refund.id, asOf: '2026-12-20' })
    if (!approved.ok) throw new Error(approved.error)
    const completed = completePrepaidRefund(approved.data, { refundId: approved.refund.id, refundedOn: '2026-12-20', asOf: '2026-12-20' })
    if (!completed.ok) throw new Error(completed.error)
    const reversed = reversePrepaidRefund(completed.data, { refundId: completed.refund.id, asOf: '2026-12-21', reason: 'Refund was returned by mistake' })
    if (!reversed.ok) throw new Error(reversed.error)
    expect(isPrototypeData(reversed.data)).toBe(true)
    expect(reversed.refund.status).toBe('REVERSED')
    expect(prepaidRefundCashOutCents(reversed.data)).toBe(0)
    expect(selectSummary(reversed.data, '2026-12-21').refundPaid).toBe(0)
    expect(reversed.data.rentObligations.filter(obligation => obligation.occupancyCycleId === seeded.cycle.id).every(obligation => obligation.state === 'ISSUED')).toBe(true)
    expect(reversed.data.paymentAllocations.filter(allocation => allocation.paymentId === seeded.paymentId && allocation.state === 'ACTIVE')).toHaveLength(3)
  })

  it('uses anniversary clamping for short months and leap years', () => {
    const seeded = charlesWorkspace(3, '2027-01-31')
    expect(seeded.data.rentalPeriods.filter(period => period.occupancyCycleId === seeded.cycle.id).map(period => period.startDate)).toEqual([
      '2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30',
    ])
    const movedOut = moveOut(seeded.data, seeded.tenant.id, '2027-03-02')
    const reconciliation = prepaidRentReconciliation(movedOut, seeded.tenant.id, '2027-03-02')!
    expect(reconciliation.periods[0]).toMatchObject({ startDate: '2027-02-28', occupiedDays: 2, status: 'REVIEW_REQUIRED', refundableCents: 0 })
    expect(reconciliation.periods.slice(1).every(period => period.status === 'FUTURE' && period.refundableCents === 400_000)).toBe(true)
  })
})
