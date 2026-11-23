import { DEFAULT_ACTION_DATE } from './action-date'
import { prepareCollection } from '@/domain/calculations/payment-collection'
import { ensureInitialRateBaseline } from '@/domain/calculations/rate-baseline'
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
import { createTenant, deleteTenant, moveOutBlockers, moveOutTenant, updateTenant } from '@/domain/calculations/tenant-management'
import { prepareShortStayAdvanceRefund } from '@/domain/calculations/advance-refund'
import { prepareRentPrepayment } from '@/domain/calculations/rent-schedule'

export function prototypeReducer(state: PrototypeData, action: StateAction): PrototypeData {
  switch (action.type) {
    case 'payment/collected': {
      const result = prepareCollection(state, action.input)
      return result.ok ? result.data : state
    }
    case 'data/loaded':
      return repairNewCycleMoveInObligations(reconcileOccupancy(action.data, action.data, action.occupancyDate, { createMoveInObligations: false }), action.occupancyDate, DEFAULT_ACTION_DATE)
    case 'data/serverSynced':
      return action.data
    case 'tenant/noteUpdated':
      return {
        ...state,
        tenants: state.tenants.map(tenant => tenant.id === action.tenantId
          ? { ...tenant, notes: action.notes.trim().slice(0, 500) }
          : tenant),
      }
    case 'tenant/created': {
      const asOf = action.asOf ?? DEFAULT_ACTION_DATE
      const result = createTenant(state, action.draft, asOf)
      return result.ok ? ensureInitialRateBaseline(reconcileOccupancy(state, result.data, asOf, { createMoveInObligations: true })) : state
    }
    case 'tenant/updated': {
      const asOf = action.asOf ?? DEFAULT_ACTION_DATE
      const previousRoom = activeAssignments(state, asOf).find(item => item.tenantId === action.tenantId)?.roomId
      const result = updateTenant(state, action.tenantId, action.draft, asOf)
      if (!result.ok) return state
      const nextRoom = activeAssignments(result.data, asOf).find(item => item.tenantId === action.tenantId)?.roomId
      const withRequests = previousRoom !== nextRoom
        ? expirePendingRoomChangeRequests(result.data, action.tenantId, asOf, 'Tenant assignment changed before the request was reviewed.')
        : result.data
      return ensureInitialRateBaseline(reconcileOccupancy(state, withRequests, asOf, { createMoveInObligations: false }))
    }
    case 'tenant/movedOut': {
      const asOf = action.asOf ?? DEFAULT_ACTION_DATE
      if (moveOutBlockers(state, action.tenantId, asOf).length > 0) return state
      let working = state
      if (action.refundAdvance) {
        const refund = prepareShortStayAdvanceRefund(state, {
          tenantId: action.tenantId, moveOutDate: asOf,
          refundedOn: action.refundAdvance.refundedOn, reason: action.refundAdvance.reason,
        })
        if (!refund.ok) return state
        working = refund.data
      }
      const result = moveOutTenant(working, action.tenantId, asOf)
      return result.ok ? reconcileOccupancy(working, expirePendingRoomChangeRequests(result.data, action.tenantId, asOf, 'Tenant moved out before the request was reviewed.'), asOf, { createMoveInObligations: false }) : state
    }
    case 'tenant/deleted': {
      const asOf = action.asOf ?? DEFAULT_ACTION_DATE
      const result = deleteTenant(state, action.tenantId, asOf)
      return result.ok ? reconcileOccupancy(state, expirePendingRoomChangeRequests(result.data, action.tenantId, asOf, 'Tenant was deleted before the request was reviewed.'), asOf, { createMoveInObligations: false }) : state
    }
    case 'rates/planned':
      return applyRateChange(state, action.plan)
    case 'room/created': {
      const result = createRoom(state, action.draft, action.asOf ?? DEFAULT_ACTION_DATE)
      return result.ok ? result.data : state
    }
    case 'room/updated': {
      const result = updateRoom(state, action.roomId, action.draft, action.asOf ?? DEFAULT_ACTION_DATE)
      return result.ok ? result.data : state
    }
    case 'room/deleted': {
      const result = deleteRoom(state, action.roomId, action.asOf ?? DEFAULT_ACTION_DATE)
      return result.ok ? result.data : state
    }
    case 'room/statusToggled': {
      const asOf = action.asOf ?? DEFAULT_ACTION_DATE
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
    case 'rent/prepaymentRecorded': {
      const result = prepareRentPrepayment(state, action)
      return result.ok ? result.data : state
    }
    case 'moveIn/policyUpdated': {
      const asOf = action.asOf ?? DEFAULT_ACTION_DATE
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
          id: `audit-move-in-policy-${next.version}`, actorId: 'demo-admin', occurredOn: asOf,
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
      return repairNewCycleMoveInObligations(reconcileOccupancy(state, state, action.asOf, { createMoveInObligations: false }), action.asOf, DEFAULT_ACTION_DATE)
  }
}
