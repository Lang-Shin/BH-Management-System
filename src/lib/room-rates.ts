import type { PrototypeAppState, Room, RoomCategoryId } from '@/domain/types/models'
import { ROOM_RATE_CATEGORY_IDS, activeRoomRentRate, roomMonthlyRentCents } from '@/domain/calculations/billing-rates'
import { formatMoney } from './format'

export { ROOM_RATE_CATEGORY_IDS }

export function roomCategoryLabel(categoryId: RoomCategoryId): string {
  const index = ROOM_RATE_CATEGORY_IDS.indexOf(categoryId)
  return `Rate category ${index + 1}`
}

export function roomRate(data: PrototypeAppState, room: Pick<Room, 'categoryId'>, asOf: string) {
  return activeRoomRentRate(data, room.categoryId, asOf)
}

export function roomMonthlyRateLabel(data: PrototypeAppState, room: Pick<Room, 'categoryId'>, asOf: string): string {
  return `${formatMoney(roomMonthlyRentCents(data, room, asOf))}/month`
}
