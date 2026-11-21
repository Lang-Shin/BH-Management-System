import type { Payment, PrototypeAppState, Receipt } from '@/domain/types/models'
import { calculateElectricityCharge, type ElectricityCalculationError } from './electricity-calculation'
import { nextReceiptNumbers } from './receipt-numbering'

export type ElectricityPaymentError = ElectricityCalculationError | 'DUPLICATE_PAYMENT'

export type ElectricityPaymentResult =
  | { ok: true; data: PrototypeAppState; payment: Payment; receipt: Receipt; chargeId: string }
  | { ok: false; reason: ElectricityPaymentError }

/**
 * Builds the payment, reading, charge, allocation, and receipt as one immutable snapshot.
 * The reducer applies this result once; localStorage persistence remains non-transactional.
 */
export function prepareElectricityPayment(
  data: PrototypeAppState,
  obligationId: string,
  currentReadingMilliKwh: number,
  paidOn: string,
): ElectricityPaymentResult {
  const calculation = calculateElectricityCharge(data, obligationId, { readingMilliKwh: currentReadingMilliKwh, readOn: paidOn })
  if (!calculation.ok) return calculation
  const paymentId = `payment-${calculation.charge.id}`
  if (data.payments.some(payment => payment.id === paymentId)) return { ok: false, reason: 'DUPLICATE_PAYMENT' }
  const allocationId = `allocation-${paymentId}-${calculation.charge.id}`
  const receiptNumber = nextReceiptNumbers(data, 1)[0]!
  const receipt: Receipt = {
    id: `receipt-${paymentId}`, paymentId, receiptNumber, issuedOn: paidOn,
    amountCents: calculation.charge.amountCents, allocationIds: [allocationId], state: 'ISSUED', revision: 1, supersedesReceiptId: null,
  }
  const payment: Payment = {
    id: paymentId, tenantId: calculation.charge.tenantId, amountCents: calculation.charge.amountCents,
    paidOn, method: 'cash', state: 'RECORDED', correction: null,
  }
  const next: PrototypeAppState = {
    ...data,
    meterReadings: [...data.meterReadings, calculation.currentReading],
    charges: [...data.charges, calculation.charge],
    payments: [...data.payments, payment],
    paymentAllocations: [...data.paymentAllocations, {
      id: allocationId, paymentId, chargeId: calculation.charge.id, amountCents: payment.amountCents,
      allocatedOn: paidOn, creditId: null, state: 'ACTIVE', reversalAuditEventId: null,
    }],
    receipts: [...data.receipts, receipt],
    electricityBillObligations: data.electricityBillObligations.filter(obligation => obligation.id !== obligationId),
    auditEvents: [...data.auditEvents, {
      id: `audit-${paymentId}`, actorId: 'demo-admin', occurredOn: paidOn, action: 'ELECTRICITY_PAYMENT_RECORDED',
      entityType: 'PAYMENT', entityId: paymentId,
      reason: `Cumulative electricity payment for ${calculation.previousReading.readingMilliKwh / 1000} to ${calculation.currentReading.readingMilliKwh / 1000} kWh.`,
      beforeSnapshot: JSON.stringify({ obligationId, previousReadingId: calculation.previousReading.id, previousReadingMilliKwh: calculation.previousReading.readingMilliKwh }),
      afterSnapshot: JSON.stringify({ paymentId, chargeId: calculation.charge.id, receiptNumber, currentReadingMilliKwh: calculation.currentReading.readingMilliKwh, amountCents: payment.amountCents }),
    }],
  }
  return { ok: true, data: next, payment, receipt, chargeId: calculation.charge.id }
}
