import type { Charge, ChargeCategory, ChargeStatus, PrototypeAppState, RoomPaymentStatus } from '@/domain/types/models'
import { roomContext, selectRoomFinance, type RoomFinance } from '@/domain/calculations/room-finance'
import { proposedRoomCharges, selectBillingEligibleRooms } from '@/domain/calculations/billing-eligibility'
import {
  anniversaryCycleForBillingPeriod, selectBillingRent, type BillingRentLine,
} from '@/domain/calculations/billing-rent'
import { chargeBalance } from '@/domain/calculations/summary'
import { resolveBillingPeriod } from '@/domain/calculations/billing-periods'
import { rentObligationPaidCents } from '@/domain/calculations/rental-periods'
import { pendingElectricityForRoom } from '@/domain/calculations/electricity-pending'

export const billingCategories: ChargeCategory[] = ['RENT', 'ELECTRICITY', 'WATER', 'WASHING_MACHINE']
export type BillingRoomStatus = 'PAID' | 'PARTLY PAID' | 'NOT YET PAID'
export type BillingRoom = RoomFinance & {
  billingStatus: BillingRoomStatus
  rent: BillingRentLine
  projectedCharges: Charge[]
  projectedOutstanding: number
  issuedCount: number
  projectedCount: number
}

export function billingRoomStatus(room: RoomFinance): BillingRoomStatus {
  if (room.paymentStatus === 'PAID') return 'PAID'
  if (room.paymentStatus === 'PARTLY_PAID') return 'PARTLY PAID'
  return 'NOT YET PAID'
}

/**
 * One row per eligible room. Anniversary rent uses the authoritative rent-obligation ledger
 * for periods due inside the selected calendar month; utilities keep their calendar charges.
 * Missing applicable utility charges are projected read-only and never written here.
 */
export function selectBillingRooms(data: PrototypeAppState, periodId: string, asOf: string, outstandingOnly: boolean): BillingRoom[] {
  const period = resolveBillingPeriod(data, periodId)
  if (!period) return []
  const persisted = new Map(selectRoomFinance(data, asOf, periodId)
    .flatMap(row => row.context.roomId ? [[row.context.roomId, row] as const] : []))
  return selectBillingEligibleRooms(data, periodId, asOf).map(room => {
    const finance = persisted.get(room.id)
    const anniversaryCycle = anniversaryCycleForBillingPeriod(data, room.id, period)
    const allProjected = proposedRoomCharges(data, room, period, asOf)
    const projectedUtilityCharges = allProjected.filter(charge => charge.category !== 'RENT')
    const issuedCharges = finance?.charges ?? []
    const legacyRentCharges = anniversaryCycle ? [] : issuedCharges.filter(charge => charge.category === 'RENT')
    const utilityCharges = issuedCharges.filter(charge => charge.category !== 'RENT')
    const projectedLegacyRent = anniversaryCycle ? [] : allProjected.filter(charge => charge.category === 'RENT')
    const rent = selectBillingRent(data, room.id, period, asOf, legacyRentCharges, projectedLegacyRent)
    const context = finance?.context ?? roomContext(data, room.id, 'period-assignment', 'Selected room')
    if (!context) throw new Error('Selected room context is missing')

    const pendingElectricity = pendingElectricityForRoom(data, room.id, period, asOf)
    const unresolved = (finance?.unresolved ?? 0) + (pendingElectricity ? 1 : 0)
    const utilityBilled = utilityCharges.reduce((sum, charge) => sum + charge.amountCents, 0)
    const utilityPaid = utilityCharges.reduce((sum, charge) => sum + Math.max(0, charge.amountCents - chargeBalance(data, charge, asOf)), 0)
    const utilityOutstanding = utilityCharges.reduce((sum, charge) => sum + chargeBalance(data, charge, asOf), 0)
    const projectedUtilityOutstanding = projectedUtilityCharges.reduce((sum, charge) => sum + charge.amountCents, 0)
    const billed = rent.billedCents + utilityBilled + projectedUtilityOutstanding
    const paid = rent.paidCents + utilityPaid
    const outstanding = rent.outstandingCents + utilityOutstanding + projectedUtilityOutstanding
    const anyApplicable = rent.billedCents > 0 || utilityCharges.length > 0 || projectedUtilityCharges.length > 0 || unresolved > 0
    const paymentStatus: RoomPaymentStatus = !anyApplicable
      ? 'NO_BILLS'
      : outstanding === 0 && unresolved === 0
        ? 'PAID'
        : paid > 0
          ? 'PARTLY_PAID'
          : 'NOT_YET_PAID'
    const status: ChargeStatus = paymentStatus === 'PAID' ? 'PAID' : paymentStatus === 'PARTLY_PAID' ? 'PARTIALLY_PAID' : 'UNPAID'
    const overdueRent = rent.obligations.filter(obligation => obligation.dueDate < asOf
      && rentObligationPaidCents(data, obligation.id, asOf) < obligation.amountCents).length
    const overdueLegacyRent = legacyRentCharges.filter(charge => charge.dueDate < asOf && chargeBalance(data, charge, asOf) > 0).length
    const overdueUtilities = utilityCharges.filter(charge => charge.dueDate < asOf && chargeBalance(data, charge, asOf) > 0).length

    return {
      id: finance?.id ?? room.id,
      context,
      charges: utilityCharges,
      projectedCharges: projectedUtilityCharges,
      projectedOutstanding: projectedUtilityOutstanding,
      billed,
      paid,
      outstanding,
      unresolved,
      unpaid: utilityCharges.filter(charge => chargeBalance(data, charge, asOf) === charge.amountCents).length
        + (rent.status === 'UNPAID' ? 1 : 0),
      partial: utilityCharges.filter(charge => chargeBalance(data, charge, asOf) > 0 && chargeBalance(data, charge, asOf) < charge.amountCents).length
        + (rent.status === 'PARTIALLY_PAID' ? 1 : 0),
      overdue: overdueRent + overdueLegacyRent + overdueUtilities,
      status,
      paymentStatus,
      rent,
      issuedCount: rent.obligations.length + utilityCharges.length + legacyRentCharges.length,
      projectedCount: projectedUtilityCharges.length + projectedLegacyRent.length,
    }
  })
    .map(room => ({ ...room, billingStatus: billingRoomStatus(room) }))
    .filter(room => !outstandingOnly || room.outstanding > 0 || room.unresolved > 0)
}

export function billingStatusCounts(rooms: BillingRoom[]) {
  return {
    total: rooms.length,
    paid: rooms.filter(room => room.billingStatus === 'PAID').length,
    partlyPaid: rooms.filter(room => room.billingStatus === 'PARTLY PAID').length,
    notPaid: rooms.filter(room => room.billingStatus === 'NOT YET PAID').length,
  }
}

export function billingOverview(rooms: BillingRoom[]) {
  return {
    billed: rooms.reduce((sum, room) => sum + room.billed, 0),
    paid: rooms.reduce((sum, room) => sum + room.paid, 0),
    outstanding: rooms.reduce((sum, room) => sum + room.outstanding, 0),
    unresolved: rooms.reduce((sum, room) => sum + room.unresolved, 0),
    overdue: rooms.reduce((sum, room) => sum + room.overdue, 0),
  }
}
