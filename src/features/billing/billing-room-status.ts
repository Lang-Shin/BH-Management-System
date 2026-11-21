import type { Charge, ChargeCategory, ChargeStatus, PrototypeAppState, RoomPaymentStatus } from '@/domain/types/models'
import { roomContext, selectRoomFinance, type RoomFinance } from '@/domain/calculations/room-finance'
import { proposedRoomCharges, selectBillingEligibleRooms } from '@/domain/calculations/billing-eligibility'

export const billingCategories: ChargeCategory[] = ['RENT', 'ELECTRICITY', 'WATER', 'WASHING_MACHINE']
export type BillingRoomStatus = 'PAID' | 'PARTLY PAID' | 'NOT YET PAID'
export type BillingRoom = RoomFinance & {
  billingStatus: BillingRoomStatus
  projectedCharges: Charge[]
  projectedOutstanding: number
}

export function billingRoomStatus(room: RoomFinance): BillingRoomStatus {
  if (room.paymentStatus === 'PAID') return 'PAID'
  if (room.paymentStatus === 'PARTLY_PAID') return 'PARTLY PAID'
  return 'NOT YET PAID'
}

/**
 * One row per eligible room. Issued finance comes from persisted records; missing applicable
 * period charges are projected read-only for display and never written by this selector.
 */
export function selectBillingRooms(data: PrototypeAppState, periodId: string, asOf: string, outstandingOnly: boolean): BillingRoom[] {
  const period = data.billingPeriods.find(item => item.id === periodId)
  const persisted = new Map(selectRoomFinance(data, asOf, periodId)
    .flatMap(row => row.context.roomId ? [[row.context.roomId, row] as const] : []))
  return selectBillingEligibleRooms(data, periodId, asOf).map(room => {
    const finance = persisted.get(room.id)
    const projectedCharges = period ? proposedRoomCharges(data, room, period, asOf) : []
    const projectedOutstanding = projectedCharges.reduce((sum, charge) => sum + charge.amountCents, 0)
    const context = finance?.context ?? roomContext(data, room.id, 'period-assignment', 'Selected room')
    if (!context) throw new Error('Selected room context is missing')
    const billed = (finance?.billed ?? 0) + projectedOutstanding
    const paid = finance?.paid ?? 0
    const outstanding = (finance?.outstanding ?? 0) + projectedOutstanding
    const unresolved = finance?.unresolved ?? 0
    const paymentStatus: RoomPaymentStatus = outstanding === 0 && unresolved === 0 ? 'PAID' : paid > 0 ? 'PARTLY_PAID' : 'NOT_YET_PAID'
    const status: ChargeStatus = paymentStatus === 'PAID' ? 'PAID' : paymentStatus === 'PARTLY_PAID' ? 'PARTIALLY_PAID' : 'UNPAID'
    return {
      id: finance?.id ?? room.id,
      context,
      charges: finance?.charges ?? [],
      projectedCharges,
      projectedOutstanding,
      billed,
      paid,
      outstanding,
      unresolved,
      unpaid: finance?.unpaid ?? 0,
      partial: finance?.partial ?? 0,
      overdue: finance?.overdue ?? 0,
      status,
      paymentStatus,
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
