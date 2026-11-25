import type { PrototypeAppState, RoomAssignment } from '@/domain/types/models'

/**
 * An assignment is current through its inclusive end date. The exception is a completed same-day
 * tenancy: it retains endDate = startDate for record validity, but the moved-out tenant must no
 * longer consume the room or a capacity slot. Multi-day assignments keep their final occupied date.
 */
export function assignmentIsCurrentAt(data: PrototypeAppState, assignment: RoomAssignment, date: string): boolean {
  if (assignment.startDate > date || (assignment.endDate !== null && assignment.endDate < date)) return false
  if (assignment.endDate !== date || assignment.startDate !== assignment.endDate) return true
  return !data.tenants.some(tenant => tenant.id === assignment.tenantId && tenant.status === 'MOVED_OUT')
}

export function activeAssignments(data: PrototypeAppState, asOf: string): RoomAssignment[] {
  return data.roomAssignments.filter(assignment => assignmentIsCurrentAt(data, assignment, asOf))
}
