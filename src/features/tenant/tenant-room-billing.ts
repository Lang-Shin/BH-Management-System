import type { ChargeCategory, PrototypeAppState } from '@/domain/types/models'
import { proposedRoomCharges } from '@/domain/calculations/billing-eligibility'
import { anniversaryCycleForBillingPeriod, selectBillingRent } from '@/domain/calculations/billing-rent'
import { resolveBillingPeriod } from '@/domain/calculations/billing-periods'
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
  const period = resolveBillingPeriod(data, periodId)
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
  const anniversaryCycle = anniversaryCycleForBillingPeriod(data, room.id, period)
  const issuedRoomCharges = allCharges.filter(charge => chargeRoom(data, charge).roomId === room.id)
  const allProjected = proposedRoomCharges(data, room, period, asOf)
  const legacyRentCharges = anniversaryCycle ? [] : issuedRoomCharges.filter(charge => charge.category === 'RENT')
  const charges = issuedRoomCharges.filter(charge => charge.category !== 'RENT')
  const projected = allProjected.filter(charge => charge.category !== 'RENT')
  const projectedLegacyRent = anniversaryCycle ? [] : allProjected.filter(charge => charge.category === 'RENT')
  const rent = selectBillingRent(data, room.id, period, asOf, legacyRentCharges, projectedLegacyRent)
  const awaiting = unresolvedElectricity(data, asOf, periodId, room.id)
  if (charges.length === 0 && projected.length === 0 && rent.billedCents === 0) {
    return awaiting.length > 0
      ? { ...empty('PENDING CALCULATION', 'Electricity awaits a valid payment-time meter reading; no issued amount is available.'), pendingCalculation: true }
      : empty('NOT YET BILLED', 'No applicable issued bills are recorded for this room and month.')
  }
  const utilityBilled = charges.reduce((sum, charge) => sum + charge.amountCents, 0)
    + projected.reduce((sum, charge) => sum + charge.amountCents, 0)
  const utilityApplied = charges.reduce((sum, charge) => sum + chargePaid(data, charge.id, asOf), 0)
  const utilityOutstanding = charges.reduce((sum, charge) => sum + chargeBalance(data, charge, asOf), 0)
    + projected.reduce((sum, charge) => sum + charge.amountCents, 0)
  const billedCents = rent.billedCents + utilityBilled
  const appliedCents = rent.paidCents + utilityApplied
  const outstandingCents = rent.outstandingCents + utilityOutstanding
  const pendingCalculation = awaiting.length > 0
  const status: TenantRoomPaymentStatus = outstandingCents === 0 && !pendingCalculation ? 'PAID'
    : appliedCents > 0 ? 'PARTLY PAID' : 'NOT PAID'
  const categories: ChargeCategory[] = ['RENT', 'WATER', 'ELECTRICITY', 'WASHING_MACHINE']
  const categoryLines: TenantRoomCategoryLine[] = categories.map(category => {
    if (category === 'RENT') {
      return {
        category, billedCents: rent.billedCents, paidCents: rent.paidCents, outstandingCents: rent.outstandingCents,
        status: rent.status === 'NO_BILL' ? 'NO BILL'
          : rent.outstandingCents === 0 ? 'PAID'
            : rent.paidCents > 0 ? 'PARTLY PAID' : 'NOT PAID',
      }
    }
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
    const amount = category === 'RENT'
      ? rent.outstandingCents
      : charges.filter(charge => charge.category === category)
        .reduce((sum, charge) => sum + chargeBalance(data, charge, asOf), 0)
        + projected.filter(charge => charge.category === category).reduce((sum, charge) => sum + charge.amountCents, 0)
    const pending = category === 'ELECTRICITY' && pendingCalculation
    return amount > 0 || pending ? [{ category, outstandingCents: amount, pendingCalculation: pending }] : []
  })
  return {
    status, detail: tenancy.startDate > period.startDate || (tenancy.endDate !== null && tenancy.endDate < period.endDate)
      ? 'Room-level billing totals for this period. A partial-period tenancy is billed for the applicable period without a proration rule.'
      : 'Room-level billing totals across applicable charges and anniversary rent obligations. These are not an individual tenant balance.',
    billedCents, appliedCents, outstandingCents, pendingCalculation, unsettled, categories: categoryLines,
  }
}
