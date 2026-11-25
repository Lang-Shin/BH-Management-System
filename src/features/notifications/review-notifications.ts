import type { OccupancyCycle, PrototypeAppState, Room, RoomChangeRequest } from '@/domain/types/models'
import { proposedMoveInAdjustment, selectMoveInObligations, type MoveInObligationView } from '@/domain/calculations/move-in'
import { resolveBillingPeriod } from '@/domain/calculations/billing-periods'

export interface MoveInTransferReviewItem {
  cycle: OccupancyCycle
  room: Room
  previousRentCents: number
  currentRentCents: number
}

export interface MoveOutDepositReviewItem {
  view: MoveInObligationView
}

export interface RoomChangeBillingReviewItem {
  request: RoomChangeRequest
  tenantName: string
  fromRoomName: string
  toRoomName: string
  effectiveDate: string
  periodLabels: string[]
}

export function selectMoveInTransferReviews(data: PrototypeAppState): MoveInTransferReviewItem[] {
  return data.occupancyCycles
    .filter(cycle => cycle.status === 'ACTIVE')
    .flatMap(cycle => {
      const room = data.rooms.find(item => item.id === cycle.roomId)
      const proposal = room ? proposedMoveInAdjustment(data, room, cycle) : null
      return room && proposal
        ? [{ cycle, room, previousRentCents: proposal.previousRentCents, currentRentCents: proposal.currentRentCents }]
        : []
    })
    .sort((a, b) => a.room.name.localeCompare(b.room.name, 'en', { numeric: true }) || a.cycle.id.localeCompare(b.cycle.id))
}

export function selectMoveOutDepositReviews(data: PrototypeAppState, asOf: string): MoveOutDepositReviewItem[] {
  return selectMoveInObligations(data, asOf)
    .filter(view => view.cycle.status === 'CLOSED' && (view.depositPaidCents > 0 || view.totalRemainingCents > 0))
    .map(view => ({ view }))
}

export function selectRoomChangeBillingReviews(data: PrototypeAppState, asOf: string): RoomChangeBillingReviewItem[] {
  return data.roomChangeRequests
    .filter(request => request.status === 'APPROVED'
      && request.approvedStartDate !== null
      && request.approvedStartDate > asOf
      && request.billingReviewPeriodIds.length > 0)
    .map(request => ({
      request,
      tenantName: data.tenants.find(tenant => tenant.id === request.tenantId)?.name ?? 'Tenant',
      fromRoomName: data.rooms.find(room => room.id === request.currentRoomId)?.name ?? '-',
      toRoomName: data.rooms.find(room => room.id === request.requestedRoomId)?.name ?? '-',
      effectiveDate: request.approvedStartDate!,
      periodLabels: request.billingReviewPeriodIds.map(periodId => resolveBillingPeriod(data, periodId)?.label ?? periodId),
    }))
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.request.id.localeCompare(b.request.id))
}
