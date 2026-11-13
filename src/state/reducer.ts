import { createDemoData } from '@/data/demo'
import type { PrototypeAction, PrototypeData } from '@/types/domain'

export function prototypeReducer(state: PrototypeData, action: PrototypeAction): PrototypeData {
  switch (action.type) {
    case 'tenant/noteUpdated':
      return {
        ...state,
        tenants: state.tenants.map(tenant => tenant.id === action.tenantId
          ? { ...tenant, notes: action.notes.trim().slice(0, 500) }
          : tenant),
      }
    case 'room/statusToggled': {
      // An occupied room cannot be removed from available capacity.
      if (state.tenants.some(tenant => tenant.roomId === action.roomId)) return state
      return {
        ...state,
        rooms: state.rooms.map(room => room.id === action.roomId
          ? { ...room, status: room.status === 'available' ? 'maintenance' : 'available' }
          : room),
      }
    }
    case 'demo/reset':
      return createDemoData()
  }
}
