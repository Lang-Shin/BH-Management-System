import type {
  Charge, ChargeCategory, CorrectionSettlementStatus, MeterReading, Payment, PaymentAllocation,
  PaymentCorrection, PrototypeAppState, Receipt,
} from '@/domain/types/models'
import { chargeRoom } from './room-finance'
import { isIsoDate } from '@/domain/validation/date'
import { formatMoney } from '@/lib/format'

const categoryOrder: ChargeCategory[] = ['RENT', 'ELECTRICITY', 'WATER', 'WASHING_MACHINE', 'ADVANCE', 'SECURITY_DEPOSIT']

export const currentCorrectionStatuses: CorrectionSettlementStatus[] = ['CORRECTED', 'REFUNDED', 'ADDITIONAL_RECEIVED']
export const legacyCorrectionStatuses: CorrectionSettlementStatus[] = ['NO_DIFFERENCE', 'NO_MONEY_MOVED', 'REFUND_COMPLETED', 'REFUND_PENDING', 'ADDITIONAL_PENDING']

export function isLegacyCorrectionStatus(status: CorrectionSettlementStatus): boolean {
  return legacyCorrectionStatuses.includes(status)
}

export function isLegacyPendingCorrection(status: CorrectionSettlementStatus): boolean {
  return status === 'REFUND_PENDING' || status === 'ADDITIONAL_PENDING'
}

/** Keeps the incorrect-recording and actual-refund distinction visible without running a migration. */
export function correctionSettlementText(correction: Pick<PaymentCorrection, 'settlementStatus' | 'differenceCents' | 'settlementAmountCents'>): string {
  const amount = formatMoney(correction.settlementAmountCents)
  switch (correction.settlementStatus) {
    case 'CORRECTED':
      return correction.differenceCents === 0
        ? 'No additional payment or refund required.'
        : 'Recorded amount corrected; no refund was required.'
    case 'REFUNDED':
      return `Refund of ${amount} returned to the tenant.`
    case 'ADDITIONAL_RECEIVED':
      return `Additional payment of ${amount} received from the tenant.`
    case 'NO_DIFFERENCE':
      return 'Legacy correction: no additional payment or refund was recorded.'
    case 'NO_MONEY_MOVED':
      return 'Legacy correction: recorded amount corrected without a refund.'
    case 'REFUND_COMPLETED':
      return 'Legacy correction: refund recorded as completed.'
    case 'REFUND_PENDING':
      return 'Legacy refund pending — no completed refund is recorded. Review this older record before treating the money as returned.'
    case 'ADDITIONAL_PENDING':
      return 'Legacy additional payment pending — no receipt of money is recorded. Review this older record before treating the money as received.'
  }
}

export interface CorrectionCategoryOption {
  category: ChargeCategory
  label: string
  allocationIds: string[]
  chargeIds: string[]
  originalAmountCents: number
  correctedAmountCents: number
  electricity?: {
    charge: Extract<Charge, { category: 'ELECTRICITY' }>
    previousReading: MeterReading
    originalCurrentReading: MeterReading
    appliedRateCentsPerKwh: number
    laterDependentReading: boolean
  }
}

export interface PaymentCorrectionQuote {
  payment: Payment
  receipt: Receipt
  categories: CorrectionCategoryOption[]
  originalAmountCents: number
  correctedTotalCents: number
  differenceCents: number
  selectedCategories: ChargeCategory[]
  correctedElectricityReadingMilliKwh: number | null
  settlementStatus: CorrectionSettlementStatus | ''
  settlementAmountCents: number
  canReview: boolean
  error: string | null
}

export interface PaymentCorrectionInput {
  paymentId: string
  selectedCategories: ChargeCategory[]
  correctedElectricityReadingMilliKwh: number | null
  reason: string
  settlementStatus: CorrectionSettlementStatus | ''
  moneyExchangeConfirmed?: boolean
  correctedAt: string
}

export type PaymentCorrectionError =
  | 'PAYMENT_NOT_FOUND' | 'RECEIPT_NOT_FOUND' | 'NO_CATEGORIES' | 'INVALID_CATEGORY'
  | 'REASON_REQUIRED' | 'REASON_TOO_LONG' | 'DUPLICATE_CORRECTION' | 'UNALLOCATED_PAYMENT'
  | 'LATER_DEPENDENT_READING' | 'INVALID_READING' | 'INVALID_SETTLEMENT'
  | 'INVALID_TOTAL' | 'DUPLICATE_PAYMENT' | 'INVALID_DATE' | 'REFUND_EXISTS'

export type PaymentCorrectionResult =
  | { ok: true; data: PrototypeAppState; correction: PaymentCorrection; payment: Payment; receipt: Receipt }
  | { ok: false; reason: PaymentCorrectionError }

export function latestPaymentReceipt(data: PrototypeAppState, paymentId: string): Receipt | null {
  return [...data.receipts].filter(receipt => receipt.paymentId === paymentId)
    .sort((a, b) => b.revision - a.revision)[0] ?? null
}

function activeAllocations(data: PrototypeAppState, paymentId: string): PaymentAllocation[] {
  return data.paymentAllocations.filter(allocation => allocation.paymentId === paymentId && allocation.state === 'ACTIVE')
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

export function buildPaymentCorrectionQuote(data: PrototypeAppState, input: PaymentCorrectionInput): PaymentCorrectionQuote | { quoteError: PaymentCorrectionError } {
  const payment = data.payments.find(item => item.id === input.paymentId && item.state === 'RECORDED')
  if (!payment) return { quoteError: 'PAYMENT_NOT_FOUND' }
  const receipt = latestPaymentReceipt(data, payment.id)
  if (!receipt || receipt.state !== 'ISSUED') return { quoteError: 'RECEIPT_NOT_FOUND' }
  if (!isIsoDate(input.correctedAt) || input.correctedAt < payment.paidOn) return { quoteError: 'INVALID_DATE' }
  if (data.advanceRefunds.some(refund => refund.sourcePaymentId === payment.id)) return { quoteError: 'REFUND_EXISTS' }
  if (data.paymentCorrections.some(correction => correction.originalPaymentId === payment.id)) return { quoteError: 'DUPLICATE_CORRECTION' }
  const allocations = activeAllocations(data, payment.id)
  if (allocations.reduce((sum, allocation) => sum + allocation.amountCents, 0) !== payment.amountCents) return { quoteError: 'UNALLOCATED_PAYMENT' }
  const chargeById = new Map(allocations.flatMap(allocation => {
    const charge = data.charges.find(item => item.id === allocation.chargeId && item.state === 'ISSUED')
    return charge ? [[charge.id, charge] as const] : []
  }))
  const categories = categoryOrder.flatMap((category): CorrectionCategoryOption[] => {
    const categoryAllocations = allocations.filter(allocation => chargeById.get(allocation.chargeId)?.category === category)
    if (categoryAllocations.length === 0) return []
    const charges = categoryAllocations.flatMap(allocation => {
      const charge = chargeById.get(allocation.chargeId)
      return charge ? [charge] : []
    })
    const originalAmountCents = categoryAllocations.reduce((sum, allocation) => sum + allocation.amountCents, 0)
    if (category !== 'ELECTRICITY') {
      return [{ category, label: category, allocationIds: categoryAllocations.map(item => item.id), chargeIds: charges.map(item => item.id), originalAmountCents, correctedAmountCents: originalAmountCents }]
    }
    const charge = charges.find((item): item is Extract<Charge, { category: 'ELECTRICITY' }> => item.category === 'ELECTRICITY')
    if (!charge) return []
    const previousReading = data.meterReadings.find(reading => reading.id === charge.electricity.previousReadingId)
    const originalCurrentReading = data.meterReadings.find(reading => reading.id === charge.electricity.currentReadingId)
    if (!previousReading || !originalCurrentReading) return []
    return [{
      category, label: category, allocationIds: categoryAllocations.map(item => item.id), chargeIds: [charge.id],
      originalAmountCents, correctedAmountCents: originalAmountCents,
      electricity: {
        charge, previousReading, originalCurrentReading,
        appliedRateCentsPerKwh: charge.electricity.appliedRateCentsPerKwh,
        laterDependentReading: laterDependentReading(data, charge),
      },
    }]
  })
  if (categories.length === 0) return { quoteError: 'NO_CATEGORIES' }
  const selectedCategories = input.selectedCategories.filter(category => categories.some(option => option.category === category))
  const electricity = categories.find(option => option.category === 'ELECTRICITY')
  let correctedElectricityReadingMilliKwh: number | null = null
  if (electricity?.electricity && selectedCategories.includes('ELECTRICITY')) {
    const options = electricity.electricity
    const reading = input.correctedElectricityReadingMilliKwh ?? options.originalCurrentReading.readingMilliKwh
    if (reading < options.previousReading.readingMilliKwh || reading === options.previousReading.readingMilliKwh) return { quoteError: 'INVALID_READING' }
    if (reading !== options.originalCurrentReading.readingMilliKwh && options.laterDependentReading) return { quoteError: 'LATER_DEPENDENT_READING' }
    const product = (reading - options.previousReading.readingMilliKwh) * options.appliedRateCentsPerKwh
    if (!Number.isSafeInteger(product) || !Number.isSafeInteger(product / 1000)) return { quoteError: 'INVALID_TOTAL' }
    electricity.correctedAmountCents = reading === options.originalCurrentReading.readingMilliKwh
      ? electricity.originalAmountCents : product / 1000
    correctedElectricityReadingMilliKwh = reading
  }
  const correctedTotalCents = selectedCategories.reduce((sum, category) => sum + (categories.find(option => option.category === category)?.correctedAmountCents ?? 0), 0)
  const differenceCents = correctedTotalCents - payment.amountCents
  const settlementStatus = differenceCents === 0 ? 'CORRECTED' as const : input.settlementStatus
  const settlementAmountCents = settlementStatus === 'CORRECTED' ? 0 : differenceCents === 0 ? 0 : Math.abs(differenceCents)
  const reason = input.reason.trim()
  const error = selectedCategories.length === 0 ? 'Select at least one category; reversing the whole transaction is blocked.'
    : reason.length < 3 ? 'Enter a reason for the correction.'
      : reason.length > 500 ? 'Keep the correction reason under 500 characters.'
        : null
  return {
    payment, receipt, categories, originalAmountCents: payment.amountCents, correctedTotalCents,
    differenceCents, selectedCategories, correctedElectricityReadingMilliKwh, settlementStatus,
    settlementAmountCents, canReview: !error, error,
  }
}

function settlementStatusForQuote(differenceCents: number, status: CorrectionSettlementStatus | '', confirmed: boolean): CorrectionSettlementStatus | null {
  if (differenceCents === 0) return status === 'CORRECTED' || status === '' ? 'CORRECTED' : null
  if (differenceCents < 0) {
    if (status === 'CORRECTED') return 'CORRECTED'
    if (status === 'REFUNDED' && confirmed) return 'REFUNDED'
    return null
  }
  return status === 'ADDITIONAL_RECEIVED' && confirmed ? 'ADDITIONAL_RECEIVED' : null
}

export function preparePaymentCorrection(data: PrototypeAppState, input: PaymentCorrectionInput): PaymentCorrectionResult {
  const quote = buildPaymentCorrectionQuote(data, input)
  if ('quoteError' in quote) return { ok: false, reason: quote.quoteError }
  if (!quote.canReview) {
    if (quote.selectedCategories.length === 0) return { ok: false, reason: 'NO_CATEGORIES' }
    if (input.reason.trim().length < 3) return { ok: false, reason: 'REASON_REQUIRED' }
    if (input.reason.trim().length > 500) return { ok: false, reason: 'REASON_TOO_LONG' }
    return { ok: false, reason: 'INVALID_TOTAL' }
  }
  const settlementStatus = settlementStatusForQuote(quote.differenceCents, input.settlementStatus, input.moneyExchangeConfirmed === true)
  if (!settlementStatus) return { ok: false, reason: 'INVALID_SETTLEMENT' }
  const settlementAmountCents = settlementStatus === 'CORRECTED' ? 0 : Math.abs(quote.differenceCents)
  const original = quote.payment
  const originalReceipt = quote.receipt
  const previousCorrections = data.paymentCorrections.filter(correction => correction.originalPaymentId === original.id)
  if (previousCorrections.length > 0) return { ok: false, reason: 'DUPLICATE_CORRECTION' }
  const revision = originalReceipt.revision + 1
  const correctedPaymentId = `payment-${original.id}-r${revision}`
  if (data.payments.some(payment => payment.id === correctedPaymentId)) return { ok: false, reason: 'DUPLICATE_PAYMENT' }
  const correctedReceiptId = `receipt-${correctedPaymentId}`
  const auditEventId = `audit-${correctedPaymentId}`
  const correctionId = `correction-${correctedPaymentId}`
  const extraCharges: Charge[] = []
  const extraReadings: MeterReading[] = []
  let electricityChargeId: string | null = null
  const electricityOption = quote.categories.find(option => option.category === 'ELECTRICITY')?.electricity
  if (electricityOption && quote.selectedCategories.includes('ELECTRICITY') && quote.correctedElectricityReadingMilliKwh !== null
    && quote.correctedElectricityReadingMilliKwh !== electricityOption.originalCurrentReading.readingMilliKwh) {
    const currentReading: MeterReading = {
      id: `reading-${correctedPaymentId}`, meterId: electricityOption.charge.electricity.meterId,
      readOn: electricityOption.originalCurrentReading.readOn, readingMilliKwh: quote.correctedElectricityReadingMilliKwh,
      status: 'CONFIRMED', confirmedBy: 'demo-admin',
      correction: { supersedesId: electricityOption.originalCurrentReading.id, auditEventId: `audit-reading-${correctedPaymentId}`, authorizedBy: 'demo-admin' },
    }
    const consumption = currentReading.readingMilliKwh - electricityOption.previousReading.readingMilliKwh
    const correctedCharge: Charge = {
      ...electricityOption.charge, id: `electricity-correction-${correctedPaymentId}`,
      amountCents: quote.categories.find(option => option.category === 'ELECTRICITY')!.correctedAmountCents,
      issuedOn: electricityOption.charge.issuedOn, correction: { supersedesId: electricityOption.charge.id, auditEventId: `audit-charge-${correctedPaymentId}`, authorizedBy: 'demo-admin' },
      electricity: {
        ...electricityOption.charge.electricity,
        intervalId: `${electricityOption.charge.electricity.meterId}:${electricityOption.previousReading.id}>${currentReading.readingMilliKwh}-${revision}`,
        currentReadingId: currentReading.id, currentReadingMilliKwh: currentReading.readingMilliKwh, consumptionMilliKwh: consumption,
      },
    }
    extraReadings.push(currentReading)
    extraCharges.push(correctedCharge)
    electricityChargeId = correctedCharge.id
  }
  const nonElectricAllocations = quote.selectedCategories.filter(category => category !== 'ELECTRICITY').flatMap(category => {
    const option = quote.categories.find(item => item.category === category)!
    return option.allocationIds.map(allocationId => {
      const allocation = data.paymentAllocations.find(item => item.id === allocationId)!
      return { charge: data.charges.find(charge => charge.id === allocation.chargeId)!, amountCents: allocation.amountCents }
    })
  })
  const nonElectricTotal = nonElectricAllocations.reduce((sum, line) => sum + line.amountCents, 0)
  const amountToRecord = quote.correctedTotalCents
  const newAllocations: PaymentAllocation[] = nonElectricAllocations.map(line => ({
    id: `allocation-${correctedPaymentId}-${line.charge.id}`, paymentId: correctedPaymentId, chargeId: line.charge.id,
    amountCents: line.amountCents, allocatedOn: input.correctedAt, creditId: null, state: 'ACTIVE', reversalAuditEventId: null,
  }))
  if (quote.selectedCategories.includes('ELECTRICITY') && electricityOption) {
    const correctedCharge = electricityChargeId ? extraCharges.find(charge => charge.id === electricityChargeId)! : electricityOption.charge
    const electricityAllocation = amountToRecord - nonElectricTotal
    if (electricityAllocation <= 0 || electricityAllocation > correctedCharge.amountCents) return { ok: false, reason: 'INVALID_TOTAL' }
    newAllocations.push({
      id: `allocation-${correctedPaymentId}-${correctedCharge.id}`, paymentId: correctedPaymentId, chargeId: correctedCharge.id,
      amountCents: electricityAllocation, allocatedOn: input.correctedAt, creditId: null, state: 'ACTIVE', reversalAuditEventId: null,
    })
  }
  if (newAllocations.reduce((sum, allocation) => sum + allocation.amountCents, 0) !== amountToRecord) return { ok: false, reason: 'INVALID_TOTAL' }
  const reversedAllocations = data.paymentAllocations.map(allocation => allocation.paymentId === original.id && allocation.state === 'ACTIVE'
    ? { ...allocation, state: 'REVERSED' as const, reversalAuditEventId: `audit-reversal-${allocation.id}-${revision}` }
    : allocation)
  const reversalAudits = data.paymentAllocations.filter(allocation => allocation.paymentId === original.id && allocation.state === 'ACTIVE')
    .map(allocation => ({
      id: `audit-reversal-${allocation.id}-${revision}`, actorId: 'demo-admin', occurredOn: input.correctedAt, action: 'ALLOCATION_REVERSED' as const,
      entityType: 'PAYMENT_ALLOCATION' as const, entityId: allocation.id, reason: `Reversed for payment correction: ${input.reason.trim()}`,
      beforeSnapshot: JSON.stringify({ state: 'ACTIVE', amountCents: allocation.amountCents }), afterSnapshot: JSON.stringify({ state: 'REVERSED' }),
    }))
  const correctedPayment: Payment = {
    id: correctedPaymentId, scope: original.scope, tenantId: original.tenantId,
    roomId: original.roomId, occupancyCycleId: original.occupancyCycleId,
    amountCents: amountToRecord, paidOn: original.paidOn,
    method: original.method, state: 'RECORDED', correction: { supersedesId: original.id, auditEventId, authorizedBy: 'demo-admin' },
  }
  const correctedReceipt: Receipt = {
    id: correctedReceiptId, paymentId: correctedPaymentId, receiptNumber: `${originalReceipt.receiptNumber}-R${revision}`,
    issuedOn: input.correctedAt, amountCents: amountToRecord, allocationIds: newAllocations.map(allocation => allocation.id),
    state: 'ISSUED', revision, supersedesReceiptId: originalReceipt.id,
  }
  const originalCategories = quote.categories.map(option => option.category)
  const correction: PaymentCorrection = {
    id: correctionId, originalPaymentId: original.id, correctedPaymentId, originalReceiptId: originalReceipt.id, correctedReceiptId,
    correctedAt: input.correctedAt, correctedBy: 'demo-admin', reason: input.reason.trim(),
    originalAmountCents: original.amountCents, correctedAmountCents: quote.correctedTotalCents,
    differenceCents: quote.differenceCents, settlementStatus,
    settlementAmountCents, originalCategories, correctedCategories: quote.selectedCategories,
    originalElectricityReadingMilliKwh: electricityOption?.originalCurrentReading.readingMilliKwh ?? null,
    correctedElectricityReadingMilliKwh: quote.correctedElectricityReadingMilliKwh, auditEventId,
  }
  const paymentAudit = {
    id: auditEventId, actorId: 'demo-admin', occurredOn: input.correctedAt, action: 'PAYMENT_CORRECTED' as const,
    entityType: 'PAYMENT' as const, entityId: correctedPaymentId, reason: correction.reason,
    beforeSnapshot: JSON.stringify({ paymentId: original.id, amountCents: original.amountCents, categories: originalCategories }),
    afterSnapshot: JSON.stringify({ paymentId: correctedPaymentId, amountCents: amountToRecord, categories: quote.selectedCategories, settlement: correction.settlementStatus }),
  }
  const next: PrototypeAppState = {
    ...data,
    payments: [...data.payments.map(payment => payment.id === original.id ? { ...payment, state: 'VOIDED' as const } : payment), correctedPayment],
    paymentAllocations: [...reversedAllocations, ...newAllocations],
    charges: [...data.charges.map(charge => charge.id === electricityOption?.charge.id && electricityChargeId ? { ...charge, state: 'VOIDED' as const } : charge), ...extraCharges],
    meterReadings: [...data.meterReadings.map(reading => reading.id === electricityOption?.originalCurrentReading.id && extraReadings.length
      ? { ...reading, status: 'SUPERSEDED' as const } : reading), ...extraReadings],
    receipts: [...data.receipts.map(receipt => receipt.id === originalReceipt.id ? { ...receipt, state: 'SUPERSEDED' as const } : receipt), correctedReceipt],
    paymentCorrections: [...data.paymentCorrections, correction],
    auditEvents: [...data.auditEvents, ...reversalAudits, paymentAudit,
      ...(extraReadings.length ? [{
        id: `audit-reading-${correctedPaymentId}`, actorId: 'demo-admin', occurredOn: input.correctedAt, action: 'READING_CORRECTED' as const,
        entityType: 'METER_READING' as const, entityId: extraReadings[0]!.id, reason: correction.reason,
        beforeSnapshot: JSON.stringify({ readingId: electricityOption?.originalCurrentReading.id, readingMilliKwh: correction.originalElectricityReadingMilliKwh }),
        afterSnapshot: JSON.stringify({ readingId: extraReadings[0]!.id, readingMilliKwh: correction.correctedElectricityReadingMilliKwh }),
      }, {
        id: `audit-charge-${correctedPaymentId}`, actorId: 'demo-admin', occurredOn: input.correctedAt, action: 'CHARGE_CORRECTED' as const,
        entityType: 'CHARGE' as const, entityId: extraCharges[0]!.id, reason: correction.reason,
        beforeSnapshot: JSON.stringify({ chargeId: electricityOption?.charge.id, amountCents: electricityOption?.charge.amountCents }),
        afterSnapshot: JSON.stringify({ chargeId: extraCharges[0]!.id, amountCents: extraCharges[0]!.amountCents }),
      }] : [])],
  }
  return { ok: true, data: next, correction, payment: correctedPayment, receipt: correctedReceipt }
}

export function correctionRoomLabel(data: PrototypeAppState, payment: Payment): string {
  const allocation = data.paymentAllocations.find(item => item.paymentId === payment.id && item.state === 'ACTIVE')
  const charge = allocation && data.charges.find(item => item.id === allocation.chargeId)
  return charge ? chargeRoom(data, charge).label : 'Room needs review'
}
