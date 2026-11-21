import type { ChargeCategory, PrototypeAppState } from '@/domain/types/models'
import { proposedRoomCharges } from '@/domain/calculations/billing-eligibility'
import { chargeRoom } from '@/domain/calculations/room-finance'
import { chargeBalance, chargePaid, issuedCharges, unresolvedElectricity } from '@/domain/calculations/summary'

export type TenantRoomPaymentStatus = 'PAID' | 'PARTLY PAID' | 'NOT PAID' | 'NOT YET BILLED' | 'PENDING CALCULATION' | 'UNAVAILABLE'
export interface UnsettledRoomCategory {
  category: ChargeCategory
  outstandingCents: number
  pendingCalculation: boolean
}

export type TenantRoomCategoryStatus = 'PAID' | 'PARTLY PAID' | 'NOT PAID' | 'AWAITING READING' | 'DID NOT AVAIL' | 'NO BILL'
export interface TenantRoomCategoryLine {
  category: ChargeCategory
  status: TenantRoomCategoryStatus
  billedCents: number
  paidCents: number
  outstandingCents: number
}

export function tenantRoomBilling(data: PrototypeAppState, tenantId: string, roomId: string | null, periodId: string, asOf: string) {
  const empty = (status: TenantRoomPaymentStatus, detail: string) => ({
    status, detail, billedCents: 0, appliedCents: 0, outstandingCents: 0, pendingCalculation: false,
    unsettled: [] as UnsettledRoomCategory[], categories: [] as TenantRoomCategoryLine[],
  })
  const period = data.billingPeriods.find(item => item.id === periodId)
  const room = roomId ? data.rooms.find(item => item.id === roomId) : undefined
  if (!room || !period) return empty('UNAVAILABLE', 'An assigned room and billing period are required to determine room payment status.')
  // A current room number alone does not authorize access to an earlier tenancy's bills.
  const through = period.endDate < asOf ? period.endDate : asOf
  const tenancy = data.roomAssignments.find(item => item.tenantId === tenantId && item.roomId === room.id
    && item.startDate <= through && (item.endDate === null || item.endDate >= period.startDate))
  if (!tenancy) return empty('UNAVAILABLE', 'This billing period is outside the selected room tenancy. Historical room billing needs review.')
  const allCharges = issuedCharges(data, asOf, periodId)
  const ambiguous = allCharges.some(charge => chargeRoom(data, charge).roomId === null
    && data.roomAssignments.some(item => item.tenantId === charge.tenantId && item.roomId === room.id
      && item.startDate <= period.endDate && (item.endDate === null || item.endDate >= period.startDate)))
  if (ambiguous) return empty('UNAVAILABLE', 'Some bills have ambiguous historical room attribution. Room billing needs review.')
  const charges = allCharges.filter(charge => chargeRoom(data, charge).roomId === room.id)
  const awaiting = unresolvedElectricity(data, asOf, periodId, room.id)
  const projected = proposedRoomCharges(data, room, period, asOf)
  if (charges.length === 0 && projected.length === 0) {
    return awaiting.length > 0
      ? { ...empty('PENDING CALCULATION', 'Electricity awaits a valid payment-time meter reading; no issued amount is available.'), pendingCalculation: true }
      : empty('NOT YET BILLED', 'No applicable issued bills are recorded for this room and month.')
  }
  const billedCents = charges.reduce((sum, charge) => sum + charge.amountCents, 0)
    + projected.reduce((sum, charge) => sum + charge.amountCents, 0)
  const appliedCents = charges.reduce((sum, charge) => sum + chargePaid(data, charge.id, asOf), 0)
  const outstandingCents = charges.reduce((sum, charge) => sum + chargeBalance(data, charge, asOf), 0)
    + projected.reduce((sum, charge) => sum + charge.amountCents, 0)
  const pendingCalculation = awaiting.length > 0
  const status: TenantRoomPaymentStatus = outstandingCents === 0 && !pendingCalculation ? 'PAID'
    : appliedCents > 0 ? 'PARTLY PAID' : 'NOT PAID'
  const categories: ChargeCategory[] = ['RENT', 'WATER', 'ELECTRICITY', 'WASHING_MACHINE']
  const categoryLines: TenantRoomCategoryLine[] = categories.map(category => {
    const categoryCharges = charges.filter(charge => charge.category === category)
    const categoryProjected = projected.filter(charge => charge.category === category)
    const categoryPaid = categoryCharges.reduce((sum, charge) => sum + chargePaid(data, charge.id, asOf), 0)
    const categoryBilled = categoryCharges.reduce((sum, charge) => sum + charge.amountCents, 0)
      + categoryProjected.reduce((sum, charge) => sum + charge.amountCents, 0)
    const categoryOutstanding = categoryCharges.reduce((sum, charge) => sum + chargeBalance(data, charge, asOf), 0)
      + categoryProjected.reduce((sum, charge) => sum + charge.amountCents, 0)
    const pending = category === 'ELECTRICITY' && pendingCalculation
    const categoryStatus: TenantRoomCategoryStatus = pending ? 'AWAITING READING'
      : categoryBilled === 0 ? (category === 'WASHING_MACHINE' ? 'DID NOT AVAIL' : 'NO BILL')
        : categoryOutstanding === 0 ? 'PAID'
          : categoryPaid > 0 ? 'PARTLY PAID' : 'NOT PAID'
    return {
      category, status: categoryStatus, billedCents: categoryBilled, paidCents: categoryPaid,
      outstandingCents: categoryOutstanding,
    }
  })
  const unsettled = categories.flatMap(category => {
    const amount = charges.filter(charge => charge.category === category)
      .reduce((sum, charge) => sum + chargeBalance(data, charge, asOf), 0)
      + projected.filter(charge => charge.category === category).reduce((sum, charge) => sum + charge.amountCents, 0)
    const pending = category === 'ELECTRICITY' && pendingCalculation
    return amount > 0 || pending ? [{ category, outstandingCents: amount, pendingCalculation: pending }] : []
  })
  return {
    status, detail: tenancy.startDate > period.startDate || (tenancy.endDate !== null && tenancy.endDate < period.endDate)
      ? 'Room-level billing totals for this period. A partial-period tenancy is billed for the applicable period without a proration rule.'
      : 'Room-level billing totals across applicable issued charges. These are not an individual tenant balance.',
    billedCents, appliedCents, outstandingCents, pendingCalculation, unsettled, categories: categoryLines,
  }
}
