import { createDemoData, DEMO_DATE } from '@/data/fixtures/demo'
import type { PrototypeData } from '@/domain/types/models'
import type { StateAction } from './actions'
import { activeAssignments } from '@/domain/calculations/summary'
import { futureReservationCount } from '@/domain/calculations/room-capacity'
import { applyRateChange } from '@/domain/calculations/billing-rates'
import { prepareElectricityPayment } from '@/domain/calculations/electricity-payment'
import { prepareMeterInitialization } from '@/domain/calculations/meter-initialization'
import { prepareRoomPayment } from '@/domain/calculations/room-payment'
import { preparePaymentCorrection } from '@/domain/calculations/payment-correction'
import { prepareMoveInPayment, reconcileOccupancy, repairNewCycleMoveInObligations } from '@/domain/calculations/move-in'
import { activeMoveInPolicy } from '@/domain/calculations/move-in-policy'
import { approveRoomChangeRequest, cancelApprovedRoomChangeRequest, cancelRoomChangeRequest, expirePendingRoomChangeRequests, rejectRoomChangeRequest, rescheduleApprovedRoomChangeRequest, submitRoomChangeRequest } from '@/domain/calculations/room-change-requests'
import { createRoom, deleteRoom, updateRoom } from '@/domain/calculations/room-management'
import { createTenant, deleteTenant, moveOutTenant, updateTenant } from '@/domain/calculations/tenant-management'

export function prototypeReducer(state: PrototypeData, action: StateAction): PrototypeData {
  switch (action.type) {
    case 'data/loaded':
      return repairNewCycleMoveInObligations(reconcileOccupancy(action.data, action.data, action.occupancyDate, { createMoveInObligations: false }), action.occupancyDate, DEMO_DATE)
    case 'tenant/noteUpdated':
      return {
        ...state,
        tenants: state.tenants.map(tenant => tenant.id === action.tenantId
          ? { ...tenant, notes: action.notes.trim().slice(0, 500) }
          : tenant),
      }
    case 'tenant/created': {
      const asOf = action.asOf ?? DEMO_DATE
      const result = createTenant(state, action.draft, asOf)
      return result.ok ? reconcileOccupancy(state, result.data, asOf, { createMoveInObligations: true }) : state
    }
    case 'tenant/updated': {
      const previousRoom = activeAssignments(state, DEMO_DATE).find(item => item.tenantId === action.tenantId)?.roomId
      const result = updateTenant(state, action.tenantId, action.draft, DEMO_DATE)
      if (!result.ok) return state
      const nextRoom = activeAssignments(result.data, DEMO_DATE).find(item => item.tenantId === action.tenantId)?.roomId
      const withRequests = previousRoom !== nextRoom
        ? expirePendingRoomChangeRequests(result.data, action.tenantId, DEMO_DATE, 'Tenant assignment changed before the request was reviewed.')
        : result.data
      return reconcileOccupancy(state, withRequests, DEMO_DATE, { createMoveInObligations: false })
    }
    case 'tenant/movedOut': {
      const result = moveOutTenant(state, action.tenantId, DEMO_DATE)
      return result.ok ? reconcileOccupancy(state, expirePendingRoomChangeRequests(result.data, action.tenantId, DEMO_DATE, 'Tenant moved out before the request was reviewed.'), DEMO_DATE, { createMoveInObligations: false }) : state
    }
    case 'tenant/deleted': {
      const result = deleteTenant(state, action.tenantId, DEMO_DATE)
      return result.ok ? reconcileOccupancy(state, expirePendingRoomChangeRequests(result.data, action.tenantId, DEMO_DATE, 'Tenant was deleted before the request was reviewed.'), DEMO_DATE, { createMoveInObligations: false }) : state
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
      const asOf = action.asOf ?? DEMO_DATE
      // An occupied or reserved room cannot be removed from available capacity.
      if (activeAssignments(state, asOf).some(assignment => assignment.roomId === action.roomId) || futureReservationCount(state, action.roomId, asOf) > 0) return state
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
    case 'electricity/meterInitialized': {
      const result = prepareMeterInitialization(state, action)
      return result.ok ? result.data : state
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
    case 'moveIn/paymentRecorded': {
      const result = prepareMoveInPayment(state, action)
      return result.ok ? result.data : state
    }
    case 'moveIn/policyUpdated': {
      const current = activeMoveInPolicy(state)
      const next = {
        ...current,
        version: current.version + 1,
        advanceApplication: action.advanceApplication ?? current.advanceApplication,
        depositDisposition: action.depositDisposition ?? current.depositDisposition,
      }
      const change = action.depositDisposition
        ? `Deposit terms set to ${action.depositDisposition === 'NON_REFUNDABLE' ? 'non-refundable' : 'refundable with manual review'}.`
        : `Advance application policy set to ${next.advanceApplication}.`
      return {
        ...state,
        moveInPolicy: next,
        auditEvents: [...state.auditEvents, {
          id: `audit-move-in-policy-${next.version}`, actorId: 'demo-admin', occurredOn: DEMO_DATE,
          action: 'MOVE_IN_POLICY_UPDATED' as const, entityType: 'PROTOTYPE' as const, entityId: 'move-in-policy',
          reason: change,
          beforeSnapshot: JSON.stringify(current), afterSnapshot: JSON.stringify(next),
        }],
      }
    }
    case 'roomChange/requested': {
      const result = submitRoomChangeRequest(state, action.draft, action.asOf)
      return result.ok ? result.data : state
    }
    case 'roomChange/cancelled': {
      const result = cancelRoomChangeRequest(state, action.requestId, action.tenantId, action.reason, action.asOf)
      return result.ok ? result.data : state
    }
    case 'roomChange/rejected': {
      const result = rejectRoomChangeRequest(state, action.requestId, action.reason, action.decidedAt)
      return result.ok ? result.data : state
    }
    case 'roomChange/approved': {
      const result = approveRoomChangeRequest(state, action.requestId, action)
      if (!result.ok) return state
      return reconcileOccupancy(state, result.data, action.decidedAt, { createMoveInObligations: false })
    }
    case 'roomChange/reservationCancelled': {
      const result = cancelApprovedRoomChangeRequest(state, action.requestId, action.reason, action.asOf)
      return result.ok ? result.data : state
    }
    case 'roomChange/reservationRescheduled': {
      const result = rescheduleApprovedRoomChangeRequest(state, action.requestId, action.effectiveDate, action.reason, action.asOf)
      return result.ok ? result.data : state
    }
    case 'occupancy/dateChanged':
      return repairNewCycleMoveInObligations(reconcileOccupancy(state, state, action.asOf, { createMoveInObligations: false }), action.asOf, DEMO_DATE)
    case 'demo/reset':
      return createDemoData()
  }
}
