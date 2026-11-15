import type { ChargeCategory, PrototypeAppState } from '@/domain/types/models'
import { financialTotals, selectRoomFinance, type RoomFinance } from '@/domain/calculations/room-finance'

export const billingCategories: ChargeCategory[] = ['RENT', 'ELECTRICITY', 'WATER', 'WASHING_MACHINE']
export type BillingRoomStatus = 'PAID' | 'PARTLY PAID' | 'NOT PAID'
export type BillingRoom = RoomFinance & { billingStatus: BillingRoomStatus }

/** Same category-column rule for the room table and chart; NO BILL is ignored. */
export function billingRoomStatus(data: PrototypeAppState, room: RoomFinance, asOf: string): BillingRoomStatus {
  const states = billingCategories.flatMap(category => {
    const items = room.charges.filter(charge => charge.category === category)
    return items.length ? [financialTotals(data, items, asOf).outstanding === 0] : []
  })
  const paid = states.filter(Boolean).length
  if (states.length > 0 && paid === states.length) return 'PAID'
  return paid > 0 ? 'PARTLY PAID' : 'NOT PAID'
}

export function selectBillingRooms(data: PrototypeAppState, periodId: string, asOf: string, outstandingOnly: boolean): BillingRoom[] {
  return selectRoomFinance(data, asOf, periodId)
    .filter(room => !outstandingOnly || room.outstanding > 0)
    .map(room => ({ ...room, billingStatus: billingRoomStatus(data, room, asOf) }))
}

export function billingStatusCounts(rooms: BillingRoom[]) {
  return {
    total: rooms.length,
    paid: rooms.filter(room => room.billingStatus === 'PAID').length,
    partlyPaid: rooms.filter(room => room.billingStatus === 'PARTLY PAID').length,
    notPaid: rooms.filter(room => room.billingStatus === 'NOT PAID').length,
  }
}
