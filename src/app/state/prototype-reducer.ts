import { createDemoData } from '@/data/fixtures/demo'
import type { PrototypeData } from '@/domain/types/models'
import type { StateAction } from './actions'

export function prototypeReducer(state: PrototypeData, action: StateAction): PrototypeData {
  switch (action.type) {
    case 'data/loaded':
      return action.data
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
