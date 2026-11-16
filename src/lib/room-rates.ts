import type { Room, RoomCategoryId } from '@/domain/types/models'
import { formatMoney } from './format'

export interface RoomRateCategory {
  id: RoomCategoryId
  label: string
  monthlyRentCents: number
  roomCount: number
}

export const ROOM_RATE_CATEGORIES: RoomRateCategory[] = [
  { id: 'RATE_3500', label: '₱3,500', monthlyRentCents: 350_000, roomCount: 8 },
  { id: 'RATE_4000', label: '₱4,000', monthlyRentCents: 400_000, roomCount: 6 },
  { id: 'RATE_5000', label: '₱5,000', monthlyRentCents: 500_000, roomCount: 1 },
]

export const ROOM_RATE_BY_ID = Object.fromEntries(
  ROOM_RATE_CATEGORIES.map(category => [category.id, category]),
) as Record<RoomCategoryId, RoomRateCategory>

export function roomRate(room: Pick<Room, 'categoryId'>): RoomRateCategory {
  return ROOM_RATE_BY_ID[room.categoryId]
}

export function roomMonthlyRateLabel(room: Pick<Room, 'categoryId'>): string {
  return `${formatMoney(roomRate(room).monthlyRentCents)}/month`
}
