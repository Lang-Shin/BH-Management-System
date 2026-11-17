import { createDemoData, DEMO_DATE } from '@/data/fixtures/demo'
import type { PrototypeData } from '@/domain/types/models'
import type { StateAction } from './actions'
import { activeAssignments } from '@/domain/calculations/summary'
import { applyRateChange } from '@/domain/calculations/billing-rates'
import { prepareElectricityPayment } from '@/domain/calculations/electricity-payment'
import { prepareRoomPayment } from '@/domain/calculations/room-payment'
import { preparePaymentCorrection } from '@/domain/calculations/payment-correction'
import { createRoom, deleteRoom, updateRoom } from '@/domain/calculations/room-management'
import { createTenant, deleteTenant, moveOutTenant, updateTenant } from '@/domain/calculations/tenant-management'

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
    case 'tenant/created': {
      const result = createTenant(state, action.draft, DEMO_DATE)
      return result.ok ? result.data : state
    }
    case 'tenant/updated': {
      const result = updateTenant(state, action.tenantId, action.draft, DEMO_DATE)
      return result.ok ? result.data : state
    }
    case 'tenant/movedOut': {
      const result = moveOutTenant(state, action.tenantId, DEMO_DATE)
      return result.ok ? result.data : state
    }
    case 'tenant/deleted': {
      const result = deleteTenant(state, action.tenantId, DEMO_DATE)
      return result.ok ? result.data : state
    }
    case 'rates/planned':
      return applyRateChange(state, action.plan)
    case 'room/created': {
      const result = createRoom(state, action.draft, DEMO_DATE)
      return result.ok ? result.data : state
    }
    case 'room/updated': {
      const result = updateRoom(state, action.roomId, action.draft, DEMO_DATE)
      return result.ok ? result.data : state
    }
    case 'room/deleted': {
      const result = deleteRoom(state, action.roomId, DEMO_DATE)
      return result.ok ? result.data : state
    }
    case 'room/statusToggled': {
      // An occupied room cannot be removed from available capacity.
      if (activeAssignments(state, DEMO_DATE).some(assignment => assignment.roomId === action.roomId)) return state
      return {
        ...state,
        rooms: state.rooms.map(room => room.id === action.roomId
          ? { ...room, status: room.status === 'available' ? 'maintenance' : 'available' }
          : room),
      }
    }
    case 'room/washingMachineUpdated':
      return {
        ...state,
        rooms: state.rooms.map(room => room.id === action.roomId
          ? { ...room, washingMachineEnabled: action.enabled }
          : room),
      }
    case 'electricity/paymentConfirmed': {
      const result = prepareElectricityPayment(state, action.obligationId, action.currentReadingMilliKwh, action.paidOn)
      return result.ok ? result.data : state
    }
    case 'room/paymentConfirmed': {
      const result = prepareRoomPayment(state, {
        roomId: action.roomId, periodId: action.periodId, selected: action.selected,
        electricityReadingMilliKwh: action.electricityReadingMilliKwh, asOf: action.asOf,
      })
      return result.ok ? result.data : state
    }
    case 'payment/corrected': {
      const result = preparePaymentCorrection(state, {
        paymentId: action.paymentId, selectedCategories: action.selectedCategories,
        correctedElectricityReadingMilliKwh: action.correctedElectricityReadingMilliKwh,
        reason: action.reason, settlementStatus: action.settlementStatus,
        moneyExchangeConfirmed: action.moneyExchangeConfirmed, correctedAt: action.correctedAt,
      })
      return result.ok ? result.data : state
    }
    case 'demo/reset':
      return createDemoData()
  }
}
