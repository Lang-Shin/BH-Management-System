import type { BillingPeriod, ChargeCategory, Payment, PaymentCorrection, PrototypeAppState, Receipt, Tenant } from '@/domain/types/models'
import { paymentRooms, type PaymentRoomPresentation } from '@/domain/calculations/room-finance'

export const RECEIPT_CATEGORIES: { category: ChargeCategory; label: string }[] = [
  { category: 'RENT', label: 'Rent' },
  { category: 'ELECTRICITY', label: 'Electricity' },
  { category: 'WATER', label: 'Water' },
  { category: 'WASHING_MACHINE', label: 'Washing' },
]

export interface ReceiptCategoryLine {
  category: ChargeCategory
  label: string
  included: boolean
  amountCents: number
}

export interface TenantReceiptView {
  receipt: Receipt
  payment: Payment
  tenant: Tenant
  periods: BillingPeriod[]
  rooms: PaymentRoomPresentation
  categories: ReceiptCategoryLine[]
  unallocatedCents: number
  otherTenantNames: string[]
  /** ISSUED receipts are effective; superseded/voided receipts are retained history only. */
  effective: boolean
  correction: PaymentCorrection | null
  supersedesReceipt: Receipt | null
  supersededBy: Receipt | null
}

/**
 * Receipt ownership is resolved through receipt → payment → tenant. Room occupancy is never used
 * to decide who owns a receipt, and receipt categories come from the receipt's allocation snapshot
 * so later corrections do not rewrite what was issued. Receipts that cannot be linked to a tenant
 * are counted instead of being guessed or shown.
 */
export function selectTenantReceipts(data: PrototypeAppState, tenantId: string): { receipts: TenantReceiptView[]; unmatched: number } {
  const tenantsById = new Map(data.tenants.map(item => [item.id, item]))
  const paymentsById = new Map(data.payments.map(item => [item.id, item]))
  const chargesById = new Map(data.charges.map(item => [item.id, item]))
  const periodsById = new Map(data.billingPeriods.map(item => [item.id, item]))
  let unmatched = 0
  const receipts: TenantReceiptView[] = []

  for (const receipt of data.receipts) {
    const payment = paymentsById.get(receipt.paymentId)
    const tenant = payment ? tenantsById.get(payment.tenantId) : undefined
    if (!payment || !tenant) {
      unmatched += 1
      continue
    }
    if (payment.tenantId !== tenantId) continue

    const allocationIds = new Set(receipt.allocationIds)
    const allocations = data.paymentAllocations.filter(item => allocationIds.has(item.id))
    const categories = RECEIPT_CATEGORIES.map(({ category, label }) => {
      const matching = allocations.filter(item => chargesById.get(item.chargeId)?.category === category)
      return { category, label, included: matching.length > 0, amountCents: matching.reduce((sum, item) => sum + item.amountCents, 0) }
    })
    const periodIds = [...new Set(allocations.map(item => chargesById.get(item.chargeId)?.billingPeriodId).filter((id): id is string => Boolean(id)))]
    const allocatedPeriods = periodIds
      .map(id => periodsById.get(id))
      .filter((period): period is BillingPeriod => Boolean(period))
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
    const periods = allocatedPeriods.length > 0
      ? allocatedPeriods
      : data.billingPeriods.filter(item => item.startDate <= payment.paidOn && item.endDate >= payment.paidOn)
    const rooms = paymentRooms(data, payment, receipt.issuedOn, receipt.allocationIds)
    const otherTenantNames = [...new Set(allocations
      .map(item => chargesById.get(item.chargeId)?.tenantId)
      .filter((id): id is string => Boolean(id) && id !== payment.tenantId)
      .map(id => tenantsById.get(id)?.name)
      .filter((name): name is string => Boolean(name)))]
    const correction = data.paymentCorrections.find(item => item.correctedReceiptId === receipt.id)
      ?? data.paymentCorrections.find(item => item.originalReceiptId === receipt.id)
      ?? null
    const supersedesReceipt = receipt.supersedesReceiptId
      ? data.receipts.find(item => item.id === receipt.supersedesReceiptId) ?? null
      : null
    const supersededBy = receipt.state === 'SUPERSEDED'
      ? data.receipts.find(item => item.supersedesReceiptId === receipt.id) ?? null
      : null

    receipts.push({
      receipt, payment, tenant, periods, rooms, categories, unallocatedCents: rooms.unallocated, otherTenantNames,
      effective: receipt.state === 'ISSUED', correction, supersedesReceipt, supersededBy,
    })
  }

  receipts.sort((a, b) => b.receipt.issuedOn.localeCompare(a.receipt.issuedOn) || b.receipt.receiptNumber.localeCompare(a.receipt.receiptNumber))
  return { receipts, unmatched }
}

export function receiptsForPeriod(receipts: TenantReceiptView[], periodId: string) {
  return receipts.filter(item => item.periods.some(period => period.id === periodId))
}
