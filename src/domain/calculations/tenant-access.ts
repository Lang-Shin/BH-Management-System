import type { OccupancyCycle, PrototypeAppState } from '@/domain/types/models'

/** Room access comes from tenancy overlap, never from a room number alone. */
export function tenantOccupiedRoomAt(data: PrototypeAppState, tenantId: string, roomId: string, date: string): boolean {
  return data.roomAssignments.some(assignment => assignment.tenantId === tenantId && assignment.roomId === roomId
    && assignment.startDate <= date && (assignment.endDate === null || assignment.endDate >= date))
}

/**
 * An active-cycle receipt is shared by occupants of that cycle. A former occupant cannot see
 * payments recorded after their tenancy ended, while a later occupant of the same active cycle can
 * see the room-level payment that established it.
 */
export function tenantHasCycleAccess(data: PrototypeAppState, tenantId: string, cycle: OccupancyCycle, paidOn: string): boolean {
  return data.roomAssignments.some(assignment => assignment.tenantId === tenantId && assignment.roomId === cycle.roomId
    && (cycle.endedAt === null || assignment.startDate <= cycle.endedAt)
    && (assignment.endDate === null || assignment.endDate >= cycle.startedAt)
    && (assignment.endDate === null || paidOn <= assignment.endDate))
}
