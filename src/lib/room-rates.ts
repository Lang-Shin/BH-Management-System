import type { PrototypeAppState, Room, RoomCategoryId } from '@/domain/types/models'
import { ROOM_RATE_CATEGORY_IDS, activeRoomRentRate, roomMonthlyRentCents } from '@/domain/calculations/billing-rates'
import { formatMoney } from './format'

export { ROOM_RATE_CATEGORY_IDS }

export function roomCategoryLabel(categoryId: RoomCategoryId): string {
  const labels: Record<RoomCategoryId, string> = {
    RATE_3500: 'Rate category 1 — Public CR',
    RATE_4000: 'Rate category 2 — Private CR',
    RATE_5000: 'Rate category 3 — Private CR + Aircon',
  }
  return labels[categoryId]
}

export function roomRate(data: PrototypeAppState, room: Pick<Room, 'categoryId'>, asOf: string) {
  return activeRoomRentRate(data, room.categoryId, asOf)
}

export function roomMonthlyRateLabel(data: PrototypeAppState, room: Pick<Room, 'categoryId'>, asOf: string): string {
  return `${formatMoney(roomMonthlyRentCents(data, room, asOf))}/month`
}
