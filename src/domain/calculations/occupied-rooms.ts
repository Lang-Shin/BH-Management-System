import type { PrototypeAppState, Room } from '@/domain/types/models'

export interface OccupiedRoomSelection {
  rooms: Room[]
  warnings: string[]
}

/**
 * Ordinary payment collection is limited to rooms with an active occupant assignment.
 * Cycle/status fields only corroborate or warn; they never substitute for an occupant.
 */
export function occupiedRoomSelection(data: PrototypeAppState, asOf: string): OccupiedRoomSelection {
  const activeAssignments = data.roomAssignments.filter(assignment => assignment.startDate <= asOf
    && (assignment.endDate === null || assignment.endDate >= asOf))
  const assignedRoomIds = new Set(activeAssignments.map(assignment => assignment.roomId))
  const activeCycleRoomIds = new Set(data.occupancyCycles.filter(cycle => cycle.status === 'ACTIVE').map(cycle => cycle.roomId))
  const warnings: string[] = []

  for (const roomId of activeCycleRoomIds) {
    if (!assignedRoomIds.has(roomId)) {
      const room = data.rooms.find(candidate => candidate.id === roomId)
      warnings.push(`Room ${room?.name ?? roomId} has an active occupancy cycle but no active tenant assignment; it is not offered for collection.`)
    }
  }

  const rooms = data.rooms.filter(room => assignedRoomIds.has(room.id))
  for (const room of rooms) {
    if (room.status === 'maintenance') {
      warnings.push(`Room ${room.name} is marked under repair but has an active occupant; occupancy data takes precedence.`)
    }
    if (!activeCycleRoomIds.has(room.id)) {
      warnings.push(`Room ${room.name} has an active tenant assignment but no active occupancy cycle; review the room record.`)
    }
  }

  return { rooms, warnings }
}
