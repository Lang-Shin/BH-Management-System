import type { PrototypeAppState, Room, RoomAssignment, Tenant } from '@/domain/types/models'
import { activeAssignments } from '@/domain/calculations/summary'

export interface TenantPersona {
  tenant: Tenant
  assignment: RoomAssignment | null
  room: Room | null
}

/**
 * Resolves the selected demo tenant against the shared repository snapshot. Payments remain scoped
 * by tenant ID elsewhere; a shared room never decides payment ownership. When no tenant is chosen,
 * the first active tenant is used as the deterministic sample default.
 */
export function selectTenantPersona(data: PrototypeAppState, tenantId: string | undefined, asOf: string): TenantPersona | null {
  const tenant = tenantId
    ? data.tenants.find(item => item.id === tenantId) ?? null
    : data.tenants.find(item => item.status === 'ACTIVE') ?? null
  if (!tenant) return null
  const assignment = activeAssignments(data, asOf).filter(item => item.tenantId === tenant.id).at(0) ?? null
  const room = assignment ? data.rooms.find(item => item.id === assignment.roomId) ?? null : null
  return { tenant, assignment, room }
}
