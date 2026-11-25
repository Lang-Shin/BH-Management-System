import type { PrototypeAppState, RoomAssignment, Tenant } from '@/domain/types/models'
import { assignmentIsCurrentAt } from './assignment-occupancy'

export interface RoomReservation {
  assignment: RoomAssignment
  tenant: Tenant
  effectiveDate: string
}

export interface RoomCapacityConflict {
  date: string
  occupants: number
  capacity: number
}

const END_OF_TIME = '9999-12-31'

/** Approved or scheduled future assignments are reservations; pending requests never appear here. */
export function futureRoomReservations(data: PrototypeAppState, roomId: string, asOf: string): RoomReservation[] {
  const tenants = new Map(data.tenants.map(tenant => [tenant.id, tenant]))
  return data.roomAssignments
    .filter(assignment => assignment.roomId === roomId && assignment.startDate > asOf
      && (assignment.endDate === null || assignment.endDate >= asOf))
    .flatMap(assignment => {
      const tenant = tenants.get(assignment.tenantId)
      return tenant ? [{ assignment, tenant, effectiveDate: assignment.startDate }] : []
    })
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.tenant.name.localeCompare(b.tenant.name))
}

export function futureReservationCount(data: PrototypeAppState, roomId: string, asOf: string): number {
  return new Set(futureRoomReservations(data, roomId, asOf).map(reservation => reservation.tenant.id)).size
}

/**
 * Capacity is checked at every assignment start inside the candidate interval. Distinct tenants are
 * counted, so a shared room reserves only its occupied slots instead of blocking the whole room.
 */
export function roomCapacityConflict(data: PrototypeAppState, input: {
  roomId: string
  tenantId: string
  startDate: string
  endDate: string | null
  capacity: number
  excludeAssignmentIds?: string[]
}): RoomCapacityConflict | null {
  const excluded = new Set(input.excludeAssignmentIds ?? [])
  const lastDate = input.endDate ?? END_OF_TIME
  const relevant = data.roomAssignments.filter(assignment => assignment.roomId === input.roomId
    && !excluded.has(assignment.id)
    && assignment.startDate <= lastDate
    && (assignment.endDate === null || assignment.endDate >= input.startDate))
  const boundaries = [...new Set([input.startDate, ...relevant
    .filter(assignment => assignment.startDate >= input.startDate && assignment.startDate <= lastDate)
    .map(assignment => assignment.startDate)])].sort()

  for (const date of boundaries) {
    const tenantIds = new Set(relevant.filter(assignment => assignmentIsCurrentAt(data, assignment, date)).map(assignment => assignment.tenantId))
    tenantIds.add(input.tenantId)
    if (tenantIds.size > input.capacity) {
      return { date, occupants: tenantIds.size, capacity: input.capacity }
    }
  }
  return null
}

/** Peak distinct occupancy across current and future assignment starts, used when changing capacity. */
export function roomPeakOccupancy(data: PrototypeAppState, roomId: string): number {
  const assignments = data.roomAssignments.filter(assignment => assignment.roomId === roomId)
  const dates = [...new Set(assignments.map(assignment => assignment.startDate))]
  let peak = 0
  for (const date of dates) {
    peak = Math.max(peak, new Set(assignments.filter(assignment => assignmentIsCurrentAt(data, assignment, date)).map(assignment => assignment.tenantId)).size)
  }
  return peak
}
