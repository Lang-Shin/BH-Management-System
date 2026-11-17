import type { AuthorizedCorrection, PrototypeAppState } from '@/domain/types/models'
import { isIsoDate as date } from './date'

type RecordValue = Record<string, unknown>
export const isRecord = (value: unknown): value is RecordValue =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (v: unknown): v is string => typeof v === 'string' && v.length <= 1000
const id = (v: unknown): v is string => text(v) && v.length > 0
const money = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const positive = (v: unknown): v is number => money(v) && v > 0
const nullableText = (v: unknown) => v === null || text(v)
const oneOf = (v: unknown, values: readonly string[]) => typeof v === 'string' && values.includes(v)
const correction = (v: unknown) => v === null || (isRecord(v) && id(v.supersedesId) && id(v.auditEventId) && id(v.authorizedBy))

function rows(value: RecordValue, key: keyof PrototypeAppState, check: (row: RecordValue) => boolean): boolean {
  const items = value[key]
  return Array.isArray(items) && items.length <= 1000
    && items.every((item: unknown) => isRecord(item) && id(item.id) && check(item))
}

/** Validate saved snapshots before casting; never expose unchecked JSON to UI. */
export function isPrototypeData(value: unknown): value is PrototypeAppState {
  if (!isRecord(value)) return false
  if (!rows(value, 'tenants', r => id(r.name) && text(r.email) && text(r.phone) && text(r.address)
    && oneOf(r.status, ['ACTIVE', 'MOVED_OUT']) && text(r.notes) && r.notes.length <= 500)) return false
  if (!rows(value, 'rooms', r => id(r.name) && positive(r.floor) && positive(r.capacity)
    && oneOf(r.kind, ['PRIVATE', 'SHARED']) && oneOf(r.status, ['available', 'maintenance'])
    && oneOf(r.categoryId, ['RATE_3500', 'RATE_4000', 'RATE_5000']) && typeof r.washingMachineEnabled === 'boolean')) return false
  if (!rows(value, 'roomAssignments', r => id(r.tenantId) && id(r.roomId) && date(r.startDate)
    && (r.endDate === null || date(r.endDate)) && positive(r.agreedRentCents))) return false
  if (!rows(value, 'electricityMeters', r => id(r.label) && id(r.serialNumber) && r.ownership === 'UNCONFIRMED')) return false
  if (!rows(value, 'meterReadings', r => id(r.meterId) && date(r.readOn) && money(r.readingMilliKwh)
    && oneOf(r.status, ['DRAFT', 'CONFIRMED', 'SUPERSEDED']) && (r.confirmedBy === null || id(r.confirmedBy)) && correction(r.correction))) return false
  if (!rows(value, 'electricityBillObligations', r => id(r.roomId) && id(r.tenantId) && id(r.billingPeriodId)
    && id(r.meterId) && id(r.previousReadingId) && date(r.createdAt) && date(r.dueDate) && r.state === 'AWAITING_READING')) return false
  if (!rows(value, 'electricityRates', r => positive(r.rateCentsPerKwh) && date(r.effectiveFrom) && text(r.label))) return false
  if (!rows(value, 'billingPeriods', r => id(r.label) && date(r.startDate) && date(r.endDate) && oneOf(r.status, ['OPEN', 'CLOSED']))) return false
  if (!rows(value, 'charges', r => {
    if (!(id(r.tenantId) && id(r.billingPeriodId) && text(r.description) && positive(r.amountCents)
      && date(r.issuedOn) && date(r.dueDate) && oneOf(r.state, ['ISSUED', 'VOIDED']) && correction(r.correction))) return false
    if (r.category === 'RENT') return id(r.roomAssignmentId) && positive(r.agreedRentCents)
    if (r.category === 'WATER' || r.category === 'WASHING_MACHINE') return r.entryMethod === 'MANUAL'
    if (r.category !== 'ELECTRICITY' || !isRecord(r.electricity)) return false
    const e = r.electricity
    return id(e.intervalId) && id(e.meterId) && id(e.previousReadingId) && id(e.currentReadingId) && money(e.previousReadingMilliKwh)
      && money(e.currentReadingMilliKwh) && money(e.consumptionMilliKwh) && id(e.rateId)
      && positive(e.appliedRateCentsPerKwh) && date(e.appliedRateEffectiveFrom)
  })) return false
  if (!rows(value, 'payments', r => id(r.tenantId) && positive(r.amountCents) && date(r.paidOn)
    && oneOf(r.method, ['cash', 'bank-transfer']) && oneOf(r.state, ['RECORDED', 'VOIDED']) && correction(r.correction))) return false
  if (!rows(value, 'paymentAllocations', r => id(r.paymentId) && id(r.chargeId) && positive(r.amountCents)
    && date(r.allocatedOn) && (r.creditId === null || id(r.creditId)) && oneOf(r.state, ['ACTIVE', 'REVERSED'])
    && (r.reversalAuditEventId === null || id(r.reversalAuditEventId)))) return false
  if (!rows(value, 'tenantCredits', r => id(r.tenantId) && id(r.sourcePaymentId) && positive(r.amountCents) && date(r.createdOn))) return false
  if (!rows(value, 'receipts', r => id(r.paymentId) && id(r.receiptNumber) && date(r.issuedOn) && positive(r.amountCents)
    && oneOf(r.state, ['ISSUED', 'VOIDED', 'SUPERSEDED']) && Array.isArray(r.allocationIds) && r.allocationIds.length <= 1000 && r.allocationIds.every(id)
    && Number.isSafeInteger(r.revision) && (r.revision as number) >= 1 && (r.supersedesReceiptId === null || id(r.supersedesReceiptId)))) return false
  if (!rows(value, 'paymentCorrections', r => id(r.originalPaymentId) && id(r.correctedPaymentId) && id(r.originalReceiptId)
    && id(r.correctedReceiptId) && date(r.correctedAt) && id(r.correctedBy) && text(r.reason) && r.reason.length <= 500
    && money(r.originalAmountCents) && money(r.correctedAmountCents) && Number.isSafeInteger(r.differenceCents)
    && oneOf(r.settlementStatus, ['NO_DIFFERENCE', 'NO_MONEY_MOVED', 'ADDITIONAL_RECEIVED', 'ADDITIONAL_PENDING', 'REFUND_COMPLETED', 'REFUND_PENDING'])
    && money(r.settlementAmountCents) && Array.isArray(r.originalCategories) && r.originalCategories.every(category => oneOf(category, ['RENT', 'ELECTRICITY', 'WATER', 'WASHING_MACHINE']))
    && Array.isArray(r.correctedCategories) && r.correctedCategories.every(category => oneOf(category, ['RENT', 'ELECTRICITY', 'WATER', 'WASHING_MACHINE']))
    && (r.originalElectricityReadingMilliKwh === null || money(r.originalElectricityReadingMilliKwh))
    && (r.correctedElectricityReadingMilliKwh === null || money(r.correctedElectricityReadingMilliKwh)) && id(r.auditEventId))) return false
  if (!rows(value, 'auditEvents', r => id(r.actorId) && date(r.occurredOn) && id(r.entityId) && text(r.reason)
    && oneOf(r.action, ['DEMO_SEEDED', 'READING_CORRECTED', 'CHARGE_CORRECTED', 'PAYMENT_CORRECTED', 'ALLOCATION_REVERSED', 'ELECTRICITY_PAYMENT_RECORDED', 'ROOM_PAYMENT_RECORDED'])
    && oneOf(r.entityType, ['PROTOTYPE', 'METER_READING', 'CHARGE', 'PAYMENT', 'PAYMENT_ALLOCATION'])
    && nullableText(r.beforeSnapshot) && nullableText(r.afterSnapshot))) return false

  // Each collection and its discriminated field shapes have been checked above.
  const data = value as unknown as PrototypeAppState
  if ([data.tenants, data.rooms, data.roomAssignments, data.electricityMeters, data.meterReadings,
    data.electricityBillObligations, data.electricityRates, data.billingPeriods, data.charges, data.payments,
    data.paymentAllocations, data.tenantCredits, data.receipts, data.paymentCorrections, data.auditEvents]
    .some(items => new Set(items.map(item => item.id)).size !== items.length)) return false
  const tenant = (key: string) => data.tenants.find(t => t.id === key)
  const audit = (key: string) => data.auditEvents.find(a => a.id === key)
  const sum = (amounts: number[]) => amounts.reduce((total, amount) => total + amount, 0)
  if (![data.charges, data.payments, data.paymentAllocations, data.tenantCredits]
    .every(items => Number.isSafeInteger(sum(items.map(item => item.amountCents))))) return false
  const activeAllocations = data.paymentAllocations.filter(a => a.state === 'ACTIVE')
  function validCorrection(c: AuthorizedCorrection | null, entityId: string, kind: 'METER_READING' | 'CHARGE' | 'PAYMENT') {
    if (!c) return true
    const event = audit(c.auditEventId)
    return c.supersedesId !== entityId && event?.entityType === kind && event.entityId === entityId
      && event.actorId === c.authorizedBy && event.reason.length > 0 && event.beforeSnapshot !== null && event.afterSnapshot !== null
      && event.action === (kind === 'METER_READING' ? 'READING_CORRECTED' : kind === 'CHARGE' ? 'CHARGE_CORRECTED' : 'PAYMENT_CORRECTED')
  }
  if (!data.roomAssignments.every(a => tenant(a.tenantId) && data.rooms.some(r => r.id === a.roomId)
    && (a.endDate === null || a.endDate >= a.startDate))) return false
  if (!data.tenants.every(t => {
    const openAssignments = data.roomAssignments.filter(a => a.tenantId === t.id && a.endDate === null).length
    return openAssignments <= 1 && (t.status !== 'MOVED_OUT' || openAssignments === 0)
  })) return false
  if (!data.roomAssignments.every(a => !data.roomAssignments.some(b => a.id !== b.id && a.tenantId === b.tenantId
    && a.startDate <= (b.endDate ?? '9999-12-31') && b.startDate <= (a.endDate ?? '9999-12-31')))) return false
  // Bed counts are room information, not a rule for renting or availability.
  if (!data.rooms.every(r => !(r.status === 'maintenance' && data.roomAssignments.some(a => a.roomId === r.id && a.endDate === null)))) return false
  if (!data.billingPeriods.every(p => p.startDate <= p.endDate)) return false
  if (!data.meterReadings.every(r => {
    const original = r.correction && data.meterReadings.find(o => o.id === r.correction?.supersedesId)
    return data.electricityMeters.some(m => m.id === r.meterId) && (r.status === 'DRAFT' || r.confirmedBy !== null)
      && validCorrection(r.correction, r.id, 'METER_READING')
      && (!r.correction || (original && original.status === 'SUPERSEDED' && original.meterId === r.meterId))
      && (r.status !== 'CONFIRMED' || !data.meterReadings.some(previous => previous.meterId === r.meterId
        && previous.status === 'CONFIRMED' && previous.readOn < r.readOn && previous.readingMilliKwh > r.readingMilliKwh))
  })) return false
  const electricityIntervals = data.charges.filter(c => c.category === 'ELECTRICITY').map(c => c.electricity.intervalId)
  if (new Set(electricityIntervals).size !== electricityIntervals.length) return false
  if (!data.electricityBillObligations.every(o => {
    const period = data.billingPeriods.find(p => p.id === o.billingPeriodId)
    const meter = data.electricityMeters.find(m => m.id === o.meterId)
    const previous = data.meterReadings.find(r => r.id === o.previousReadingId)
    const latest = [...data.meterReadings]
      .filter(reading => reading.meterId === o.meterId && reading.status === 'CONFIRMED')
      .sort((a, b) => b.readOn.localeCompare(a.readOn) || b.id.localeCompare(a.id))[0]
    return tenant(o.tenantId) && data.rooms.some(r => r.id === o.roomId) && period && meter && previous
      && previous.meterId === o.meterId && previous.status !== 'DRAFT' && previous.readOn <= o.createdAt
      && latest?.id === previous.id
      && o.dueDate >= o.createdAt
      && data.roomAssignments.some(a => a.tenantId === o.tenantId && a.roomId === o.roomId
        && a.startDate <= period.endDate && (a.endDate === null || a.endDate >= period.startDate))
      && !data.charges.some(c => c.category === 'ELECTRICITY' && c.state === 'ISSUED'
        && c.billingPeriodId === o.billingPeriodId && c.electricity.meterId === o.meterId)
  })) return false
  if (new Set(data.electricityBillObligations.map(o => JSON.stringify([o.meterId, o.billingPeriodId]))).size
    !== data.electricityBillObligations.length) return false
  if (!data.charges.every(c => {
    const period = data.billingPeriods.find(p => p.id === c.billingPeriodId)
    const original = c.correction && data.charges.find(o => o.id === c.correction?.supersedesId)
    if (!tenant(c.tenantId) || !period || c.dueDate < c.issuedOn || !validCorrection(c.correction, c.id, 'CHARGE')
      || (c.correction && (!original || original.state !== 'VOIDED' || original.tenantId !== c.tenantId || original.category !== c.category))) return false
    if (c.category === 'RENT') return c.amountCents === c.agreedRentCents
      && data.roomAssignments.some(a => a.id === c.roomAssignmentId && a.tenantId === c.tenantId
        && a.startDate <= period.endDate && (a.endDate === null || a.endDate >= period.startDate))
    if (c.category !== 'ELECTRICITY') return true
    const e = c.electricity
    const previous = data.meterReadings.find(r => r.id === e.previousReadingId)
    const current = data.meterReadings.find(r => r.id === e.currentReadingId)
    const rate = data.electricityRates.find(r => r.id === e.rateId)
    const product = e.consumptionMilliKwh * e.appliedRateCentsPerKwh
    // Demo readings produce exact-cent amounts. Fractional rounding policy is unconfirmed.
    return previous !== undefined && current !== undefined && rate !== undefined
      && previous.meterId === e.meterId && current.meterId === e.meterId && previous.status !== 'DRAFT' && current.status !== 'DRAFT'
      && previous.readOn < current.readOn && current.readOn <= c.issuedOn
      && previous.readingMilliKwh === e.previousReadingMilliKwh && current.readingMilliKwh === e.currentReadingMilliKwh
      && e.currentReadingMilliKwh >= e.previousReadingMilliKwh && e.consumptionMilliKwh === e.currentReadingMilliKwh - e.previousReadingMilliKwh
      && e.appliedRateEffectiveFrom === rate.effectiveFrom && e.appliedRateEffectiveFrom <= c.issuedOn
      && e.appliedRateCentsPerKwh === rate.rateCentsPerKwh && Number.isSafeInteger(product) && c.amountCents === product / 1000
  })) return false
  if (!data.payments.every(p => {
    const original = p.correction && data.payments.find(o => o.id === p.correction?.supersedesId)
    const reserved = sum(data.tenantCredits.filter(c => c.sourcePaymentId === p.id).map(c => c.amountCents))
    const direct = sum(activeAllocations.filter(a => a.paymentId === p.id && a.creditId === null).map(a => a.amountCents))
    return tenant(p.tenantId) && validCorrection(p.correction, p.id, 'PAYMENT')
      && (!p.correction || (original && original.state === 'VOIDED' && original.tenantId === p.tenantId))
      && Number.isSafeInteger(reserved + direct) && reserved + direct <= p.amountCents
  })) return false
  if (!data.paymentAllocations.every(a => {
    const payment = data.payments.find(p => p.id === a.paymentId)
    const charge = data.charges.find(c => c.id === a.chargeId)
    const credit = a.creditId && data.tenantCredits.find(c => c.id === a.creditId)
    const reversal = a.reversalAuditEventId && audit(a.reversalAuditEventId)
    return payment && charge && payment.tenantId === charge.tenantId && a.allocatedOn >= payment.paidOn && a.allocatedOn >= charge.issuedOn
      && (a.state !== 'ACTIVE' || (payment.state === 'RECORDED' && charge.state === 'ISSUED' && a.reversalAuditEventId === null))
      && (a.state !== 'REVERSED' || (reversal && reversal.action === 'ALLOCATION_REVERSED' && reversal.entityType === 'PAYMENT_ALLOCATION' && reversal.entityId === a.id))
      && (a.creditId === null || (credit && credit.sourcePaymentId === a.paymentId && credit.createdOn <= a.allocatedOn))
  })) return false
  if (!data.charges.every(c => {
    const applied = sum(activeAllocations.filter(a => a.chargeId === c.id).map(a => a.amountCents))
    // Rent is all-or-nothing; a sample or user-entered partial rent allocation is invalid.
    return Number.isSafeInteger(applied) && applied <= c.amountCents
      && (c.category !== 'RENT' || applied === 0 || applied === c.amountCents)
  })) return false
  if (!data.tenantCredits.every(c => {
    const payment = data.payments.find(p => p.id === c.sourcePaymentId)
    const used = sum(activeAllocations.filter(a => a.creditId === c.id).map(a => a.amountCents))
    return payment && payment.tenantId === c.tenantId && c.createdOn >= payment.paidOn && Number.isSafeInteger(used) && used <= c.amountCents
  })) return false
  if (new Set(data.receipts.map(r => r.receiptNumber)).size !== data.receipts.length) return false
  if (!data.receipts.every(r => {
    const payment = data.payments.find(p => p.id === r.paymentId)
    const original = r.supersedesReceiptId && data.receipts.find(item => item.id === r.supersedesReceiptId)
    return payment && r.amountCents === payment.amountCents && r.issuedOn >= payment.paidOn
      && (r.state !== 'ISSUED' || payment.state === 'RECORDED') && new Set(r.allocationIds).size === r.allocationIds.length
      && r.allocationIds.every(key => data.paymentAllocations.some(a => a.id === key && a.paymentId === r.paymentId && a.allocatedOn <= r.issuedOn))
      && (r.revision === 1 ? r.supersedesReceiptId === null : Boolean(original && original.state === 'SUPERSEDED' && original.revision === r.revision - 1 && original.paymentId !== r.paymentId))
  })) return false
  if (!data.paymentCorrections.every(correction => {
    const originalPayment = data.payments.find(payment => payment.id === correction.originalPaymentId)
    const correctedPayment = data.payments.find(payment => payment.id === correction.correctedPaymentId)
    const originalReceipt = data.receipts.find(receipt => receipt.id === correction.originalReceiptId)
    const correctedReceipt = data.receipts.find(receipt => receipt.id === correction.correctedReceiptId)
    const event = audit(correction.auditEventId)
    const difference = correction.correctedAmountCents - correction.originalAmountCents
    const expectedSettlement = correction.settlementStatus === 'NO_DIFFERENCE' || correction.settlementStatus === 'NO_MONEY_MOVED' ? 0 : Math.abs(difference)
    return originalPayment?.state === 'VOIDED' && correctedPayment?.state === 'RECORDED'
      && correctedPayment.correction?.supersedesId === originalPayment.id && correctedPayment.tenantId === originalPayment.tenantId
      && originalReceipt?.state === 'SUPERSEDED' && correctedReceipt?.state === 'ISSUED'
      && originalReceipt.paymentId === originalPayment.id
      && correctedReceipt.paymentId === correctedPayment.id && correctedReceipt.supersedesReceiptId === originalReceipt.id
      && difference === correction.differenceCents && correction.settlementAmountCents === expectedSettlement
      && correction.correctedCategories.every(category => correction.originalCategories.includes(category))
      && event?.action === 'PAYMENT_CORRECTED' && event.entityType === 'PAYMENT' && event.entityId === correctedPayment.id
      && event.reason === correction.reason
  })) return false
  if (new Set(data.paymentCorrections.map(correction => correction.correctedPaymentId)).size !== data.paymentCorrections.length) return false
  return data.auditEvents.every(a => a.entityType === 'PROTOTYPE'
    || (a.entityType === 'METER_READING' && data.meterReadings.some(r => r.id === a.entityId))
    || (a.entityType === 'CHARGE' && data.charges.some(c => c.id === a.entityId))
    || (a.entityType === 'PAYMENT' && data.payments.some(p => p.id === a.entityId))
    || (a.entityType === 'PAYMENT_ALLOCATION' && data.paymentAllocations.some(p => p.id === a.entityId)))
}
