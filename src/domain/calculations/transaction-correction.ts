import type {
  AdvanceApplication, Charge, ChargeCategory, CorrectionSettlementStatus, MeterReading,
  Payment, PaymentAllocation, PaymentCorrection, PrototypeAppState, Receipt, RentObligation, RentPrepayment,
} from '@/domain/types/models'
import { latestPaymentReceipt } from './payment-correction'
import { chargeRoom } from './room-finance'
import { rentObligationAdvanceAppliedCents, rentalPeriodsForCycle } from './rental-periods'
import { isIsoDate } from '@/domain/validation/date'
import { formatDate, formatMoney, previousCalendarDate } from '@/lib/format'

export interface CorrectionTargetOption {
  targetId: string
  category: ChargeCategory
  kind: 'CHARGE' | 'RENT'
  label: string
  detail: string
  periodLabel: string | null
  availableCents: number
  originalCents: number
  currentPaymentCents: number
  roomId: string | null
}

export interface CorrectionOriginalLine {
  allocationId: string
  targetId: string
  category: ChargeCategory
  label: string
  periodLabel: string | null
  amountCents: number
  kind: 'CHARGE' | 'RENT'
}

export interface CorrectionLineInput {
  targetId: string
  category: ChargeCategory
  amountCents: number
  sourceAllocationId?: string | null
}

export interface UnifiedCorrectionInput {
  paymentId: string
  reason: string
  correctedAt: string
  lines?: CorrectionLineInput[]
  /** Checkbox corrections send identities only; amounts and targets come from saved allocations. */
  retainedAllocationIds?: string[]
  expectedReceiptId?: string
  expectedReceiptRevision?: number
  reverseAll?: boolean
  correctedMethod?: 'cash' | 'bank-transfer' | null
  correctedElectricityReadingMilliKwh?: number | null
  /** Legacy fields remain accepted by the original correction adapter. */
  selectedCategories?: ChargeCategory[]
  settlementStatus?: CorrectionSettlementStatus | ''
  moneyExchangeConfirmed?: boolean
}

export interface UnifiedCorrectionQuote {
  payment: Payment
  receipt: Receipt
  originalLines: CorrectionOriginalLine[]
  targets: CorrectionTargetOption[]
  requestedLines: CorrectionLineInput[]
  correctedLines: CorrectionOriginalLine[]
  correctedTotalCents: number
  differenceCents: number
  canReview: boolean
  error: string | null
  methodChanged: boolean
  correctedElectricityReadingMilliKwh: number | null
}

export type UnifiedCorrectionError =
  | 'PAYMENT_NOT_FOUND' | 'RECEIPT_NOT_FOUND' | 'DUPLICATE_CORRECTION' | 'UNALLOCATED_PAYMENT'
  | 'REASON_REQUIRED' | 'REASON_TOO_LONG' | 'INVALID_DATE' | 'REFUND_EXISTS'
  | 'NO_TARGET' | 'INVALID_CATEGORY' | 'INVALID_AMOUNT' | 'OVER_ALLOCATION'
  | 'PARTIAL_RENT' | 'DUPLICATE_TARGET' | 'INVALID_TOTAL' | 'INVALID_SETTLEMENT'
  | 'LATER_DEPENDENT_READING' | 'INVALID_READING' | 'INVALID_PAYMENT'
  | 'INVALID_ALLOCATION' | 'STALE_CORRECTION' | 'NO_CHANGES'

export type UnifiedCorrectionResult =
  | { ok: true; data: PrototypeAppState; correction: PaymentCorrection; payment: Payment; receipt: Receipt; quote: UnifiedCorrectionQuote }
  | { ok: false; reason: UnifiedCorrectionError }

const categoryLabels: Record<ChargeCategory, string> = {
  RENT: 'Rent', ELECTRICITY: 'Electricity', WATER: 'Water', WASHING_MACHINE: 'Washing machine',
  ADVANCE: 'Move-in advance', SECURITY_DEPOSIT: 'Security deposit',
}
const categoryOrder: ChargeCategory[] = ['RENT', 'WATER', 'WASHING_MACHINE', 'ELECTRICITY', 'ADVANCE', 'SECURITY_DEPOSIT']
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
const uniqueCategories = (categories: ChargeCategory[]) => categoryOrder.filter(category => categories.includes(category))

function activeAllocations(data: PrototypeAppState, paymentId: string): PaymentAllocation[] {
  return data.paymentAllocations.filter(allocation => allocation.paymentId === paymentId && allocation.state === 'ACTIVE')
}

function targetFor(data: PrototypeAppState, targetId: string): { charge?: Charge; rent?: RentObligation; category: ChargeCategory; roomId: string | null } | null {
  const charge = data.charges.find(item => item.id === targetId)
  if (charge) return { charge, category: charge.category, roomId: chargeRoom(data, charge).roomId }
  const rent = data.rentObligations.find(item => item.id === targetId)
  if (rent) return { rent, category: 'RENT', roomId: rent.roomId }
  return null
}

function originalContexts(data: PrototypeAppState, payment: Payment): { roomIds: Set<string>; chargeIds: Set<string> } {
  const allocations = activeAllocations(data, payment.id)
  const roomIds = new Set<string>()
  if (payment.roomId) roomIds.add(payment.roomId)
  for (const allocation of allocations) {
    const context = targetFor(data, allocation.chargeId)
    if (context?.roomId) roomIds.add(context.roomId)
  }
  return { roomIds, chargeIds: new Set(allocations.map(allocation => allocation.chargeId)) }
}

function targetOptions(data: PrototypeAppState, payment: Payment): CorrectionTargetOption[] {
  const allocations = activeAllocations(data, payment.id)
  const contexts = originalContexts(data, payment)
  const ownByTarget = new Map<string, number>()
  for (const allocation of allocations) ownByTarget.set(allocation.chargeId, (ownByTarget.get(allocation.chargeId) ?? 0) + allocation.amountCents)
  const options: CorrectionTargetOption[] = []
  const rooms = [...contexts.roomIds]
  for (const roomId of rooms) {
    const room = data.rooms.find(item => item.id === roomId)
    if (!room) continue
    for (const charge of data.charges) {
      if (charge.state !== 'ISSUED' || chargeRoom(data, charge).roomId !== roomId) continue
      if (payment.scope === 'TENANT' && charge.tenantId !== payment.tenantId) continue
      if (charge.category === 'ADVANCE' || charge.category === 'SECURITY_DEPOSIT') {
        if (!contexts.chargeIds.has(charge.id)) continue
      }
      const currentPaymentCents = ownByTarget.get(charge.id) ?? 0
      const otherPaid = data.paymentAllocations.filter(allocation => allocation.chargeId === charge.id
        && allocation.state === 'ACTIVE' && allocation.paymentId !== payment.id).reduce((total, allocation) => total + allocation.amountCents, 0)
      const availableCents = Math.max(0, charge.amountCents - otherPaid)
      if (availableCents <= 0 && currentPaymentCents === 0) continue
      const period = data.billingPeriods.find(item => item.id === charge.billingPeriodId)
      options.push({
        targetId: charge.id, category: charge.category, kind: 'CHARGE',
        label: `${categoryLabels[charge.category]} · Room ${room.name}`,
        detail: charge.description, periodLabel: period?.label ?? null,
        availableCents, originalCents: charge.amountCents, currentPaymentCents, roomId,
      })
    }
    const cycles = data.occupancyCycles.filter(cycle => cycle.roomId === roomId
      && (payment.occupancyCycleId ? cycle.id === payment.occupancyCycleId : true))
    for (const cycle of cycles) {
      const periods = rentalPeriodsForCycle(data, cycle.id)
      for (const period of periods) {
        const obligation = data.rentObligations.find(item => item.rentalPeriodId === period.id)
        if (!obligation || obligation.state !== 'ISSUED') continue
        const currentPaymentCents = ownByTarget.get(obligation.id) ?? 0
        const otherCash = data.paymentAllocations.filter(allocation => allocation.chargeId === obligation.id
          && allocation.state === 'ACTIVE' && allocation.paymentId !== payment.id).reduce((total, allocation) => total + allocation.amountCents, 0)
        const availableCents = Math.max(0, obligation.amountCents - otherCash
          - rentObligationAdvanceAppliedCents(data, obligation.id, payment.paidOn))
        if (availableCents <= 0 && currentPaymentCents === 0) continue
        options.push({
          targetId: obligation.id, category: 'RENT', kind: 'RENT',
          label: `Rent · Room ${room.name}`,
          detail: `Due ${period.dueDate}. Historical rate ${formatMoney(obligation.rateSnapshotCents)}.`,
          periodLabel: `${formatDate(period.startDate)} – ${formatDate(previousCalendarDate(period.endDateExclusive))}`,
          availableCents, originalCents: obligation.amountCents, currentPaymentCents, roomId,
        })
      }
    }
  }
  return [...new Map(options.map(option => [option.targetId, option])).values()]
    .sort((a, b) => categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category)
      || (a.periodLabel ?? '').localeCompare(b.periodLabel ?? '') || a.targetId.localeCompare(b.targetId))
}

function originalLines(data: PrototypeAppState, payment: Payment, targets: CorrectionTargetOption[]): CorrectionOriginalLine[] {
  return activeAllocations(data, payment.id).flatMap(allocation => {
    const target = targetFor(data, allocation.chargeId)
    if (!target) return []
    const option = targets.find(item => item.targetId === allocation.chargeId)
    return [{
      allocationId: allocation.id, targetId: allocation.chargeId, category: target.category,
      label: option?.label ?? categoryLabels[target.category], periodLabel: option?.periodLabel ?? null,
      amountCents: allocation.amountCents, kind: target.rent ? 'RENT' as const : 'CHARGE' as const,
    }]
  })
}

export function buildUnifiedCorrectionQuote(data: PrototypeAppState, input: UnifiedCorrectionInput): UnifiedCorrectionQuote | { quoteError: UnifiedCorrectionError } {
  const payment = data.payments.find(item => item.id === input.paymentId && item.state === 'RECORDED')
  if (!payment) return { quoteError: 'PAYMENT_NOT_FOUND' }
  const receipt = latestPaymentReceipt(data, payment.id)
  if (!receipt || receipt.state !== 'ISSUED') return { quoteError: 'RECEIPT_NOT_FOUND' }
  if ((input.expectedReceiptId !== undefined && input.expectedReceiptId !== receipt.id)
    || (input.expectedReceiptRevision !== undefined && input.expectedReceiptRevision !== receipt.revision)) {
    return { quoteError: 'STALE_CORRECTION' }
  }
  if (!isIsoDate(input.correctedAt) || input.correctedAt < payment.paidOn) return { quoteError: 'INVALID_DATE' }
  if (data.advanceRefunds.some(refund => refund.sourcePaymentId === payment.id)) return { quoteError: 'REFUND_EXISTS' }
  if ((data.prepaidRentRefunds ?? []).some(refund => refund.status !== 'REVERSED'
    && refund.allocations.some(allocation => allocation.paymentId === payment.id))) return { quoteError: 'REFUND_EXISTS' }
  if (data.paymentCorrections.some(correction => correction.originalPaymentId === payment.id)) return { quoteError: 'DUPLICATE_CORRECTION' }
  const allocations = activeAllocations(data, payment.id)
  if (sum(allocations.map(allocation => allocation.amountCents)) !== payment.amountCents) return { quoteError: 'UNALLOCATED_PAYMENT' }
  const targets = targetOptions(data, payment)
  if (targets.length === 0) return { quoteError: 'NO_TARGET' }
  const originals = originalLines(data, payment, targets)
  const checkboxCorrection = input.retainedAllocationIds !== undefined
  if (checkboxCorrection) {
    const ids = input.retainedAllocationIds!
    if (input.expectedReceiptId === undefined || input.expectedReceiptRevision === undefined) return { quoteError: 'STALE_CORRECTION' }
    if (new Set(ids).size !== ids.length || ids.some(id => !allocations.some(allocation => allocation.id === id))) {
      return { quoteError: 'INVALID_ALLOCATION' }
    }
    if (ids.length === allocations.length) return { quoteError: 'NO_CHANGES' }
    if (input.lines !== undefined || input.correctedMethod !== undefined
      || input.correctedElectricityReadingMilliKwh != null
      || (input.settlementStatus !== undefined && input.settlementStatus !== '' && input.settlementStatus !== 'CORRECTED')
      || input.moneyExchangeConfirmed === true) return { quoteError: 'INVALID_PAYMENT' }
  }
  const reversed = checkboxCorrection ? input.retainedAllocationIds!.length === 0 : input.reverseAll === true
  let requestedLines: CorrectionLineInput[]
  if (checkboxCorrection) {
    const retained = new Set(input.retainedAllocationIds)
    requestedLines = originals.filter(line => retained.has(line.allocationId)).map(line => ({
      targetId: line.targetId, category: line.category, amountCents: line.amountCents, sourceAllocationId: line.allocationId,
    }))
  } else if (reversed) requestedLines = []
  else if (input.lines !== undefined) {
    requestedLines = input.lines.map(line => ({ ...line, amountCents: Math.trunc(line.amountCents) }))
  } else {
    const selected = input.selectedCategories ? new Set(input.selectedCategories) : null
    requestedLines = originals.filter(line => !selected || selected.has(line.category)).map(line => ({
      targetId: line.targetId, category: line.category, amountCents: line.amountCents, sourceAllocationId: line.allocationId,
    }))
  }
  const correctedLines: CorrectionOriginalLine[] = []
  for (const line of requestedLines) {
    if (line.sourceAllocationId != null && !allocations.some(allocation => allocation.id === line.sourceAllocationId)) {
      return { quoteError: 'INVALID_ALLOCATION' }
    }
    const target = targetFor(data, line.targetId)
    if (!target) return { quoteError: 'INVALID_CATEGORY' }
    if (target.category !== line.category || !targets.some(option => option.targetId === line.targetId)) return { quoteError: 'INVALID_CATEGORY' }
    if (!Number.isSafeInteger(line.amountCents) || line.amountCents <= 0) return { quoteError: 'INVALID_AMOUNT' }
    const option = targets.find(item => item.targetId === line.targetId)!
    correctedLines.push({
      allocationId: line.sourceAllocationId ?? '', targetId: line.targetId, category: line.category,
      label: option.label, periodLabel: option.periodLabel, amountCents: line.amountCents,
      kind: target.rent ? 'RENT' : 'CHARGE',
    })
  }
  if (new Set(correctedLines.map(line => line.targetId)).size !== correctedLines.length) return { quoteError: 'DUPLICATE_TARGET' }
  for (const line of correctedLines) {
    const option = targets.find(item => item.targetId === line.targetId)!
    if (line.amountCents > option.availableCents) return { quoteError: 'OVER_ALLOCATION' }
    if (option.kind === 'RENT' && line.amountCents !== option.availableCents) return { quoteError: 'PARTIAL_RENT' }
    if ((line.category === 'ADVANCE' || line.category === 'SECURITY_DEPOSIT') && line.amountCents !== option.availableCents) return { quoteError: 'PARTIAL_RENT' }
  }
  let correctedElectricityReadingMilliKwh: number | null = null
  const electricityLine = correctedLines.find(line => line.category === 'ELECTRICITY')
  const electricityCharge = electricityLine ? data.charges.find(charge => charge.id === electricityLine.targetId && charge.category === 'ELECTRICITY') : undefined
  if (electricityCharge?.category === 'ELECTRICITY' && input.correctedElectricityReadingMilliKwh !== null
    && input.correctedElectricityReadingMilliKwh !== undefined) {
    const previous = data.meterReadings.find(reading => reading.id === electricityCharge.electricity.previousReadingId)
    const current = data.meterReadings.find(reading => reading.id === electricityCharge.electricity.currentReadingId)
    if (!previous || !current) return { quoteError: 'INVALID_READING' }
    const reading = input.correctedElectricityReadingMilliKwh
    if (!Number.isSafeInteger(reading) || reading <= previous.readingMilliKwh) return { quoteError: 'INVALID_READING' }
    if (reading !== current.readingMilliKwh && laterDependentReading(data, electricityCharge)) return { quoteError: 'LATER_DEPENDENT_READING' }
    const product = (reading - previous.readingMilliKwh) * electricityCharge.electricity.appliedRateCentsPerKwh
    if (!Number.isSafeInteger(product) || !Number.isSafeInteger(product / 1000)) return { quoteError: 'INVALID_TOTAL' }
    electricityLine!.amountCents = reading === current.readingMilliKwh ? electricityLine!.amountCents : product / 1000
    correctedElectricityReadingMilliKwh = reading
  }
  const correctedTotalCents = sum(correctedLines.map(line => line.amountCents))
  if (!Number.isSafeInteger(correctedTotalCents) || (correctedTotalCents === 0 && correctedLines.length > 0)) return { quoteError: 'INVALID_TOTAL' }
  if (!reversed && correctedLines.length === 0) return { quoteError: 'NO_TARGET' }
  const differenceCents = correctedTotalCents - payment.amountCents
  const reason = input.reason.trim()
  const error = reason.length < 3 ? 'Enter a reason for the correction.'
    : reason.length > 500 ? 'Keep the correction reason under 500 characters.'
      : null
  const methodChanged = input.correctedMethod !== undefined && input.correctedMethod !== payment.method
  return {
    payment, receipt, originalLines: originals, targets, requestedLines, correctedLines,
    correctedTotalCents, differenceCents, canReview: error === null, error, methodChanged,
    correctedElectricityReadingMilliKwh,
  }
}

function laterDependentReading(data: PrototypeAppState, charge: Extract<Charge, { category: 'ELECTRICITY' }>): boolean {
  const current = data.meterReadings.find(reading => reading.id === charge.electricity.currentReadingId)
  if (!current) return true
  return data.meterReadings.some(reading => reading.meterId === charge.electricity.meterId
    && reading.id !== current.id && reading.status === 'CONFIRMED' && reading.readOn > current.readOn)
    || data.charges.some(item => item.category === 'ELECTRICITY' && item.state === 'ISSUED'
      && item.id !== charge.id && item.electricity.meterId === charge.electricity.meterId
      && (item.electricity.previousReadingId === current.id || item.issuedOn > charge.issuedOn))
}

function settlementStatusFor(differenceCents: number, status: CorrectionSettlementStatus | '', confirmed: boolean): CorrectionSettlementStatus | null {
  if (differenceCents === 0) return status === 'CORRECTED' || status === '' ? 'CORRECTED' : null
  if (differenceCents < 0) {
    if (status === 'CORRECTED') return 'CORRECTED'
    if (status === 'REFUNDED' && confirmed) return 'REFUNDED'
    return null
  }
  return status === 'ADDITIONAL_RECEIVED' && confirmed ? 'ADDITIONAL_RECEIVED' : null
}

export function prepareUnifiedCorrection(data: PrototypeAppState, input: UnifiedCorrectionInput & {
  settlementStatus?: CorrectionSettlementStatus | ''
  moneyExchangeConfirmed?: boolean
}): UnifiedCorrectionResult {
  const quote = buildUnifiedCorrectionQuote(data, input)
  if ('quoteError' in quote) return { ok: false, reason: quote.quoteError }
  if (!quote.canReview) return { ok: false, reason: input.reason.trim().length < 3 ? 'REASON_REQUIRED' : 'REASON_TOO_LONG' }
  if (input.correctedMethod !== undefined && quote.payment.scope === 'ROOM' && input.correctedMethod !== null) return { ok: false, reason: 'INVALID_PAYMENT' }
  if (input.correctedMethod !== undefined && quote.payment.scope === 'TENANT'
    && input.correctedMethod !== 'cash' && input.correctedMethod !== 'bank-transfer') return { ok: false, reason: 'INVALID_PAYMENT' }
  const settlementStatus = settlementStatusFor(quote.differenceCents, input.settlementStatus ?? '', input.moneyExchangeConfirmed === true)
  if (!settlementStatus) return { ok: false, reason: 'INVALID_SETTLEMENT' }
  const original = quote.payment
  const originalReceipt = quote.receipt
  const revision = originalReceipt.revision + 1
  const correctedPaymentId = `payment-${original.id}-r${revision}`
  if (data.payments.some(payment => payment.id === correctedPaymentId)) return { ok: false, reason: 'DUPLICATE_CORRECTION' }
  const correctedReceiptId = `receipt-${correctedPaymentId}`
  const auditEventId = `audit-${correctedPaymentId}`
  const correctionId = `correction-${correctedPaymentId}`

  const extraCharges: Charge[] = []
  const extraReadings: MeterReading[] = []
  const correctedAllocations: PaymentAllocation[] = []
  const electricityLine = quote.correctedLines.find(line => line.category === 'ELECTRICITY')
  const electricityCharge = electricityLine ? data.charges.find(charge => charge.id === electricityLine.targetId && charge.category === 'ELECTRICITY') : undefined
  let electricityTargetId = electricityLine?.targetId ?? null
  if (electricityCharge?.category === 'ELECTRICITY' && quote.correctedElectricityReadingMilliKwh !== null
    && quote.correctedElectricityReadingMilliKwh !== electricityCharge.electricity.currentReadingMilliKwh) {
    const originalReading = data.meterReadings.find(reading => reading.id === electricityCharge.electricity.currentReadingId)
    const previous = data.meterReadings.find(reading => reading.id === electricityCharge.electricity.previousReadingId)
    if (!originalReading || !previous) return { ok: false, reason: 'INVALID_READING' }
    const correctedReading: MeterReading = {
      id: `reading-${correctedPaymentId}`, meterId: electricityCharge.electricity.meterId,
      readOn: originalReading.readOn, readingMilliKwh: quote.correctedElectricityReadingMilliKwh,
      status: 'CONFIRMED', confirmedBy: 'demo-admin',
      correction: { supersedesId: originalReading.id, auditEventId: `audit-reading-${correctedPaymentId}`, authorizedBy: 'demo-admin' },
    }
    const correctedCharge: Charge = {
      ...electricityCharge, id: `electricity-correction-${correctedPaymentId}`,
      amountCents: electricityLine!.amountCents,
      correction: { supersedesId: electricityCharge.id, auditEventId: `audit-charge-${correctedPaymentId}`, authorizedBy: 'demo-admin' },
      electricity: {
        ...electricityCharge.electricity,
        intervalId: `${electricityCharge.electricity.meterId}:${previous.id}>${correctedReading.readingMilliKwh}-${revision}`,
        currentReadingId: correctedReading.id, currentReadingMilliKwh: correctedReading.readingMilliKwh,
        consumptionMilliKwh: correctedReading.readingMilliKwh - previous.readingMilliKwh,
      },
    }
    extraReadings.push(correctedReading)
    extraCharges.push(correctedCharge)
    electricityTargetId = correctedCharge.id
  }
  const finalLines = quote.correctedLines.map(line => ({ ...line, targetId: line.category === 'ELECTRICITY' && electricityTargetId ? electricityTargetId : line.targetId }))
  for (const line of finalLines) {
    if (!Number.isSafeInteger(line.amountCents) || line.amountCents <= 0) return { ok: false, reason: 'INVALID_AMOUNT' }
    correctedAllocations.push({
      id: `allocation-${correctedPaymentId}-${line.targetId}`, paymentId: correctedPaymentId, chargeId: line.targetId,
      amountCents: line.amountCents, allocatedOn: input.correctedAt, creditId: null, state: 'ACTIVE', reversalAuditEventId: null,
    })
  }
  const amountToRecord = sum(correctedAllocations.map(allocation => allocation.amountCents))
  if (amountToRecord !== quote.correctedTotalCents) return { ok: false, reason: 'INVALID_TOTAL' }
  const settlementAmountCents = settlementStatus === 'CORRECTED' ? 0 : Math.abs(quote.differenceCents)
  const reversedAllocations = data.paymentAllocations.map(allocation => allocation.paymentId === original.id && allocation.state === 'ACTIVE'
    ? { ...allocation, state: 'REVERSED' as const, reversalAuditEventId: `audit-reversal-${allocation.id}-${revision}` }
    : allocation)
  const reversalAudits = data.paymentAllocations.filter(allocation => allocation.paymentId === original.id && allocation.state === 'ACTIVE')
    .map(allocation => ({
      id: `audit-reversal-${allocation.id}-${revision}`, actorId: 'demo-admin', occurredOn: input.correctedAt,
      action: 'ALLOCATION_REVERSED' as const, entityType: 'PAYMENT_ALLOCATION' as const, entityId: allocation.id,
      reason: `Reversed for transaction correction: ${input.reason.trim()}`,
      beforeSnapshot: JSON.stringify({ state: 'ACTIVE', amountCents: allocation.amountCents, chargeId: allocation.chargeId }),
      afterSnapshot: JSON.stringify({ state: 'REVERSED' }),
    }))
  const correctedPayment: Payment = {
    id: correctedPaymentId, scope: original.scope, tenantId: original.tenantId, roomId: original.roomId,
    occupancyCycleId: original.occupancyCycleId, amountCents: amountToRecord, paidOn: original.paidOn,
    method: input.correctedMethod !== undefined ? input.correctedMethod : original.method,
    state: 'RECORDED', correction: { supersedesId: original.id, auditEventId, authorizedBy: 'demo-admin' },
  }
  const correctedReceipt: Receipt = {
    id: correctedReceiptId, paymentId: correctedPaymentId, receiptNumber: `${originalReceipt.receiptNumber}-R${revision}`,
    issuedOn: input.correctedAt, amountCents: amountToRecord, allocationIds: correctedAllocations.map(allocation => allocation.id),
    state: 'ISSUED', revision, supersedesReceiptId: originalReceipt.id,
  }
  const originalCategories = uniqueCategories(quote.originalLines.map(line => line.category))
  const correctedCategories = uniqueCategories(finalLines.map(line => line.category))
  const correction: PaymentCorrection = {
    id: correctionId, originalPaymentId: original.id, correctedPaymentId, originalReceiptId: originalReceipt.id,
    correctedReceiptId, correctedAt: input.correctedAt, correctedBy: 'demo-admin', reason: input.reason.trim(),
    originalAmountCents: original.amountCents, correctedAmountCents: amountToRecord,
    differenceCents: quote.differenceCents, settlementStatus, settlementAmountCents,
    originalCategories, correctedCategories,
    originalElectricityReadingMilliKwh: electricityCharge?.category === 'ELECTRICITY'
      ? data.meterReadings.find(reading => reading.id === electricityCharge.electricity.currentReadingId)?.readingMilliKwh ?? null : null,
    correctedElectricityReadingMilliKwh: quote.correctedElectricityReadingMilliKwh,
    auditEventId,
  }
  const paymentAudit = {
    id: auditEventId, actorId: 'demo-admin', occurredOn: input.correctedAt, action: 'PAYMENT_CORRECTED' as const,
    entityType: 'PAYMENT' as const, entityId: correctedPaymentId, reason: correction.reason,
    beforeSnapshot: JSON.stringify({ paymentId: original.id, amountCents: original.amountCents, categories: originalCategories,
      allocations: quote.originalLines.map(line => ({ targetId: line.targetId, amountCents: line.amountCents })) }),
    afterSnapshot: JSON.stringify({ paymentId: correctedPaymentId, amountCents: amountToRecord, categories: correctedCategories,
      allocations: finalLines.map(line => ({ targetId: line.targetId, amountCents: line.amountCents })), settlement: settlementStatus }),
  }
  const auditEvents = [
    ...data.auditEvents, ...reversalAudits, paymentAudit,
    ...(extraReadings.length ? [{
      id: `audit-reading-${correctedPaymentId}`, actorId: 'demo-admin', occurredOn: input.correctedAt,
      action: 'READING_CORRECTED' as const, entityType: 'METER_READING' as const, entityId: extraReadings[0]!.id,
      reason: correction.reason,
      beforeSnapshot: JSON.stringify({ readingId: electricityCharge?.category === 'ELECTRICITY' ? electricityCharge.electricity.currentReadingId : null,
        readingMilliKwh: correction.originalElectricityReadingMilliKwh }),
      afterSnapshot: JSON.stringify({ readingId: extraReadings[0]!.id, readingMilliKwh: correction.correctedElectricityReadingMilliKwh }),
    }, {
      id: `audit-charge-${correctedPaymentId}`, actorId: 'demo-admin', occurredOn: input.correctedAt,
      action: 'CHARGE_CORRECTED' as const, entityType: 'CHARGE' as const, entityId: extraCharges[0]!.id,
      reason: correction.reason,
      beforeSnapshot: JSON.stringify({ chargeId: electricityCharge?.id ?? null, amountCents: electricityCharge?.amountCents ?? null }),
      afterSnapshot: JSON.stringify({ chargeId: extraCharges[0]!.id, amountCents: extraCharges[0]!.amountCents }),
    }] : []),
  ]
  const originalAdvanceApplications = data.advanceApplications.filter(application => application.sourcePaymentId === original.id && application.state === 'ACTIVE')
  const keptAdvance = finalLines.some(line => line.category === 'ADVANCE')
  const advanceApplications: AdvanceApplication[] = data.advanceApplications.map(application => {
    if (!originalAdvanceApplications.some(item => item.id === application.id)) return application
    if (keptAdvance) return { ...application, sourcePaymentId: correctedPaymentId }
    return { ...application, state: 'REVERSED' as const, reversalAuditEventId: `audit-advance-reversal-${application.id}-${revision}` }
  })
  const advanceAudits = originalAdvanceApplications.filter(() => !keptAdvance).map(application => ({
    id: `audit-advance-reversal-${application.id}-${revision}`, actorId: 'demo-admin', occurredOn: input.correctedAt,
    action: 'ADVANCE_APPLICATION_REVERSED' as const, entityType: 'ADVANCE_APPLICATION' as const, entityId: application.id,
    reason: `Advance application reversed by transaction correction: ${correction.reason}`,
    beforeSnapshot: JSON.stringify({ state: 'ACTIVE', rentObligationId: application.rentObligationId }),
    afterSnapshot: JSON.stringify({ state: 'REVERSED' }),
  }))
  const originalPrepayments = data.rentPrepayments.filter(prepayment => prepayment.paymentId === original.id
    && (prepayment.state ?? 'ACTIVE') === 'ACTIVE')
  const rentLines = finalLines.filter(line => line.kind === 'RENT')
  let rentPrepayments: RentPrepayment[] = data.rentPrepayments.map(prepayment =>
    originalPrepayments.some(item => item.id === prepayment.id) ? { ...prepayment, state: 'SUPERSEDED' as const } : prepayment)
  if (originalPrepayments.length > 0 && rentLines.length > 0) {
    const first = originalPrepayments[0]!
    const obligations = rentLines.flatMap(line => {
      const obligation = data.rentObligations.find(item => item.id === line.targetId)
      return obligation ? [obligation] : []
    })
    const rentalPeriodIds = obligations.map(obligation => obligation.rentalPeriodId)
    if (new Set(rentalPeriodIds).size === rentalPeriodIds.length) {
      const replacement: RentPrepayment = {
        id: `${first.id}-r${revision}`, paymentId: correctedPaymentId, occupancyCycleId: first.occupancyCycleId, roomId: first.roomId,
        rentalPeriodIds, periodCount: rentalPeriodIds.length, totalCents: sum(rentLines.map(line => line.amountCents)),
        rateCents: first.rateCents, rateLockedOn: first.rateLockedOn, createdAt: input.correctedAt,
        reviewState: first.reviewState, state: 'ACTIVE', supersedesPrepaymentId: first.id,
      }
      rentPrepayments = [...rentPrepayments, replacement]
    }
  }
  const next: PrototypeAppState = {
    ...data,
    payments: [...data.payments.map(payment => payment.id === original.id ? { ...payment, state: 'VOIDED' as const } : payment), correctedPayment],
    paymentAllocations: [...reversedAllocations, ...correctedAllocations],
    charges: [...data.charges.map(charge => charge.id === electricityCharge?.id && extraCharges.length ? { ...charge, state: 'VOIDED' as const } : charge), ...extraCharges],
    meterReadings: [...data.meterReadings.map(reading => reading.id === (electricityCharge?.category === 'ELECTRICITY' ? electricityCharge.electricity.currentReadingId : '') && extraReadings.length
      ? { ...reading, status: 'SUPERSEDED' as const } : reading), ...extraReadings],
    receipts: [...data.receipts.map(item => item.id === originalReceipt.id ? { ...item, state: 'SUPERSEDED' as const } : item), correctedReceipt],
    paymentCorrections: [...data.paymentCorrections, correction],
    advanceApplications,
    rentPrepayments,
    auditEvents: [...auditEvents, ...advanceAudits],
  }
  return { ok: true, data: next, correction, payment: correctedPayment, receipt: correctedReceipt, quote }
}
