import type { PrototypeAppState, Room, RoomAssignment, Tenant } from '@/domain/types/models'
import { activeAssignments } from '@/domain/calculations/summary'
import { DEMO_DATE } from '@/data/fixtures/demo'

export interface TenantPersona {
  tenant: Tenant
  assignment: RoomAssignment | null
  room: Room | null
}

/**
 * Sample tenant persona for the prototype tenant workspace. There is no sign-in in this phase;
 * the workspace previews the first active tenant's existing fictional records only.
 */
export function selectTenantPersona(data: PrototypeAppState): TenantPersona | null {
  const tenant = data.tenants.find(item => item.status === 'ACTIVE')
  if (!tenant) return null
  const assignment = activeAssignments(data, DEMO_DATE).filter(item => item.tenantId === tenant.id).at(0) ?? null
  const room = assignment ? data.rooms.find(item => item.id === assignment.roomId) ?? null : null
  return { tenant, assignment, room }
}
