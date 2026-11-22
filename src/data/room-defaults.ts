import type { Room, RoomCategoryId } from '@/domain/types/models'

export function initialRooms(): Room[] {
  const specs: {
    id: string; name: string; capacity: number; kind: 'PRIVATE' | 'SHARED'; status: 'available' | 'maintenance'
    categoryId: RoomCategoryId; washingMachineEnabled: boolean
  }[] = [
    { id: 'room-1', name: '1', capacity: 2, kind: 'SHARED', status: 'available', categoryId: 'RATE_3500', washingMachineEnabled: true },
    { id: 'room-2', name: '2', capacity: 2, kind: 'SHARED', status: 'available', categoryId: 'RATE_3500', washingMachineEnabled: true },
    { id: 'room-3', name: '3', capacity: 2, kind: 'SHARED', status: 'available', categoryId: 'RATE_3500', washingMachineEnabled: false },
    { id: 'room-4', name: '4', capacity: 2, kind: 'SHARED', status: 'available', categoryId: 'RATE_3500', washingMachineEnabled: false },
    { id: 'room-5', name: '5', capacity: 2, kind: 'SHARED', status: 'available', categoryId: 'RATE_3500', washingMachineEnabled: false },
    { id: 'room-6', name: '6', capacity: 1, kind: 'PRIVATE', status: 'maintenance', categoryId: 'RATE_3500', washingMachineEnabled: false },
    { id: 'room-7', name: '7', capacity: 2, kind: 'SHARED', status: 'available', categoryId: 'RATE_3500', washingMachineEnabled: false },
    { id: 'room-8', name: '8', capacity: 2, kind: 'SHARED', status: 'available', categoryId: 'RATE_3500', washingMachineEnabled: false },
    { id: 'room-9', name: '01', capacity: 2, kind: 'SHARED', status: 'available', categoryId: 'RATE_4000', washingMachineEnabled: false },
    { id: 'room-10', name: '03', capacity: 2, kind: 'SHARED', status: 'available', categoryId: 'RATE_4000', washingMachineEnabled: false },
    { id: 'room-11', name: '04', capacity: 2, kind: 'SHARED', status: 'available', categoryId: 'RATE_4000', washingMachineEnabled: false },
    { id: 'room-12', name: '05', capacity: 2, kind: 'SHARED', status: 'available', categoryId: 'RATE_4000', washingMachineEnabled: false },
    { id: 'room-13', name: '06', capacity: 2, kind: 'SHARED', status: 'available', categoryId: 'RATE_4000', washingMachineEnabled: false },
    { id: 'room-14', name: '07', capacity: 2, kind: 'SHARED', status: 'available', categoryId: 'RATE_4000', washingMachineEnabled: false },
    { id: 'room-15', name: '02', capacity: 1, kind: 'PRIVATE', status: 'available', categoryId: 'RATE_5000', washingMachineEnabled: false },
  ]
  return specs.map(({ id, name, ...room }) => ({ id, name, floor: 1, ...room }))
}
