import type { ChargeCategory, PrototypeAppState } from '@/domain/types/models'
import { selectRoomFinance, type RoomFinance } from '@/domain/calculations/room-finance'

export const billingCategories: ChargeCategory[] = ['RENT', 'ELECTRICITY', 'WATER', 'WASHING_MACHINE']
export type BillingRoomStatus = 'PAID' | 'PARTLY PAID' | 'NOT YET PAID'
export type BillingRoom = RoomFinance & { billingStatus: BillingRoomStatus }

export function billingRoomStatus(room: RoomFinance): BillingRoomStatus {
  if (room.paymentStatus === 'PAID') return 'PAID'
  if (room.paymentStatus === 'PARTLY_PAID') return 'PARTLY PAID'
  return 'NOT YET PAID'
}

export function selectBillingRooms(data: PrototypeAppState, periodId: string, asOf: string, outstandingOnly: boolean): BillingRoom[] {
  return selectRoomFinance(data, asOf, periodId)
    .filter(room => !outstandingOnly || room.outstanding > 0 || room.unresolved > 0)
    .map(room => ({ ...room, billingStatus: billingRoomStatus(room) }))
}

export function billingStatusCounts(rooms: BillingRoom[]) {
  return {
    total: rooms.length,
    paid: rooms.filter(room => room.billingStatus === 'PAID').length,
    partlyPaid: rooms.filter(room => room.billingStatus === 'PARTLY PAID').length,
    notPaid: rooms.filter(room => room.billingStatus === 'NOT YET PAID').length,
  }
}
