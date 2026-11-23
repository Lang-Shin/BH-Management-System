import type { BillingPeriod, ChargeCategory, DepositDisposition, Payment, PaymentCorrection, PrototypeAppState, Receipt, Tenant } from '@/domain/types/models'
import { paymentRooms, chargeRoom, type PaymentRoomPresentation } from '@/domain/calculations/room-finance'
import { tenantHasCycleAccess, tenantOccupiedRoomAt } from '@/domain/calculations/tenant-access'
import { rentLedgerCharges } from '@/domain/calculations/rent-ledger-charges'

export const RECEIPT_CATEGORIES: { category: ChargeCategory; label: string }[] = [
  { category: 'RENT', label: 'Rent' },
  { category: 'ELECTRICITY', label: 'Electricity' },
  { category: 'WATER', label: 'Water' },
  { category: 'WASHING_MACHINE', label: 'Washing' },
  { category: 'ADVANCE', label: 'Advance payment' },
  { category: 'SECURITY_DEPOSIT', label: 'Security deposit' },
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
  /** Historical payer when one was recorded; room-level payments have no payer. */
  tenant: Tenant | null
  viewerIsPayer: boolean
  periods: BillingPeriod[]
  rooms: PaymentRoomPresentation
  categories: ReceiptCategoryLine[]
  unallocatedCents: number
  otherTenantNames: string[]
  depositDisposition: DepositDisposition | null
  /** ISSUED receipts are effective; superseded/voided receipts are retained history only. */
  effective: boolean
  correction: PaymentCorrection | null
  supersedesReceipt: Receipt | null
  supersededBy: Receipt | null
}

/**
 * Receipt visibility follows the transaction's room/cycle and the viewer's tenancy overlap.
 * Tenant-owned receipts remain visible to their historical payer; room-level receipts are shared
 * with every authorized occupant of that occupancy cycle or room-date.
 */
export function selectTenantReceipts(data: PrototypeAppState, tenantId: string): { receipts: TenantReceiptView[]; unmatched: number } {
  const tenantsById = new Map(data.tenants.map(item => [item.id, item]))
  const paymentsById = new Map(data.payments.map(item => [item.id, item]))
  const chargesById = new Map([...data.charges, ...rentLedgerCharges(data)].map(item => [item.id, item]))
  const periodsById = new Map(data.billingPeriods.map(item => [item.id, item]))
  const cyclesById = new Map(data.occupancyCycles.map(item => [item.id, item]))
  let unmatched = 0
  const receipts: TenantReceiptView[] = []

  for (const receipt of data.receipts) {
    const payment = paymentsById.get(receipt.paymentId)
    if (!payment) {
      unmatched += 1
      continue
    }
    const allocationIds = new Set(receipt.allocationIds)
    const allocations = data.paymentAllocations.filter(item => allocationIds.has(item.id))
    const payer = payment.tenantId ? tenantsById.get(payment.tenantId) ?? null : null
    const viewerIsPayer = Boolean(payer && payment.tenantId === tenantId)
    const roomIds = [...new Set(allocations.flatMap(item => {
      const charge = chargesById.get(item.chargeId)
      const roomId = charge ? chargeRoom(data, charge).roomId : null
      return roomId ? [roomId] : []
    }))]
    const cycle = payment.occupancyCycleId ? cyclesById.get(payment.occupancyCycleId) : undefined
    const sharedRoomAccess = roomIds.some(roomId => tenantOccupiedRoomAt(data, tenantId, roomId, payment.paidOn))
    const roomLevelCycleAccess = payment.scope === 'ROOM' && cycle
      ? tenantHasCycleAccess(data, tenantId, cycle, payment.paidOn)
      : false
    if (!viewerIsPayer && !sharedRoomAccess && !roomLevelCycleAccess) continue

    const categories = RECEIPT_CATEGORIES.map(({ category, label }) => {
      const matching = allocations.filter(item => chargesById.get(item.chargeId)?.category === category)
      return { category, label, included: matching.length > 0, amountCents: matching.reduce((sum, item) => sum + item.amountCents, 0) }
    })
    const periodIds = [...new Set(allocations.map(item => chargesById.get(item.chargeId)?.billingPeriodId).filter((id): id is string => Boolean(id)))]
    const depositCharge = allocations.map(item => chargesById.get(item.chargeId)).find(charge => charge?.category === 'SECURITY_DEPOSIT')
    const depositDisposition = depositCharge?.category === 'SECURITY_DEPOSIT'
      ? data.moveInObligations.find(obligation => obligation.id === depositCharge.moveInObligationId)?.depositDisposition ?? null
      : null
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
      receipt, payment, tenant: payer, viewerIsPayer, periods, rooms, categories, unallocatedCents: rooms.unallocated, otherTenantNames, depositDisposition,
      effective: receipt.state === 'ISSUED', correction, supersedesReceipt, supersededBy,
    })
  }

  receipts.sort((a, b) => b.receipt.issuedOn.localeCompare(a.receipt.issuedOn) || b.receipt.receiptNumber.localeCompare(a.receipt.receiptNumber))
  return { receipts, unmatched }
}

export function receiptsForPeriod(receipts: TenantReceiptView[], periodId: string) {
  return receipts.filter(item => item.periods.some(period => period.id === periodId))
}
