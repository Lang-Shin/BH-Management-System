import type { PrototypeAppState, RoomChangeRequest } from '@/domain/types/models'
import { isIsoDate } from '@/domain/validation/date'
import { activeAssignments, tenantAccount } from './summary'
import { roomMonthlyRentCents } from './billing-rates'
import { transferTenantRoom } from './tenant-management'
import { reconcileOccupancy } from './move-in'
import { roomCapacityConflict } from './room-capacity'
import { openFinancialReviewCase, transferRentReviewNeeded } from './rent-schedule'
import { randomSuffix } from './random-id'

export interface RoomChangeRequestDraft {
  tenantId: string
  requestedRoomId: string
  requestedStartDate: string
  reason: string
  requestId?: string
}
export type RoomChangeRequestErrors = Partial<Record<'roomId' | 'startDate' | 'reason' | 'general', string>>

export interface RoomChangeFinancialWarnings {
  outstandingCents: number
  creditCents: number
  currentRentCents: number
  targetRentCents: number
  rentDifferenceCents: number
  depositTopUpProposalCents: number
  billingReviewRequired: boolean
  affectedBillingPeriodIds: string[]
  notes: string[]
}

export type RoomChangeRequestResult =
  | { ok: true; data: PrototypeAppState; request: RoomChangeRequest }
  | { ok: false; errors: RoomChangeRequestErrors }

export type RoomChangeDecisionResult =
  | { ok: true; data: PrototypeAppState; request: RoomChangeRequest; effectiveDate?: string }
  | { ok: false; errors: RoomChangeRequestErrors }

function previousDate(date: string): string {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() - 1)
  return value.toISOString().slice(0, 10)
}

function requestId(): string {
  return `room-change-${randomSuffix()}`
}

export function pendingRoomChangeRequests(data: PrototypeAppState): RoomChangeRequest[] {
  return data.roomChangeRequests.filter(request => request.status === 'PENDING')
}

export function latestRoomChangeRequest(data: PrototypeAppState, tenantId: string): RoomChangeRequest | null {
  return [...data.roomChangeRequests].filter(request => request.tenantId === tenantId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0] ?? null
}

export function roomChangeRequestsForTenant(data: PrototypeAppState, tenantId: string): RoomChangeRequest[] {
  return [...data.roomChangeRequests].filter(request => request.tenantId === tenantId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
}

export function roomChangeFinancialWarnings(data: PrototypeAppState, tenantId: string, targetRoomId: string, startDate: string): RoomChangeFinancialWarnings | null {
  const assignment = activeAssignments(data, startDate).find(item => item.tenantId === tenantId)
  const room = data.rooms.find(item => item.id === targetRoomId)
  if (!assignment || !room) return null
  const account = tenantAccount(data, tenantId, startDate)
  const currentRentCents = assignment.agreedRentCents
  const targetRentCents = roomMonthlyRentCents(data, room, startDate)
  const difference = targetRentCents - currentRentCents
  const period = data.billingPeriods.find(item => item.startDate <= startDate && item.endDate >= startDate)
  const midPeriod = Boolean(period && startDate > period.startDate)
  const affectedBillingPeriodIds = midPeriod && period ? [period.id] : []
  const paidAnniversaryPeriod = transferRentReviewNeeded(data, assignment.roomId, tenantId, startDate)
  const sourceCycle = data.occupancyCycles.find(cycle => cycle.roomId === assignment.roomId && cycle.status === 'ACTIVE')
  const paidPrepaidPeriod = sourceCycle
    ? data.rentPrepayments.filter(prepayment => prepayment.occupancyCycleId === sourceCycle.id)
      .flatMap(prepayment => prepayment.rentalPeriodIds)
      .map(id => data.rentalPeriods.find(item => item.id === id))
      .find(item => Boolean(item && item.startDate >= startDate))
    : undefined
  const notes: string[] = []
  if (account.balance > 0) notes.push('The tenant has an outstanding balance.')
  if (account.credit > 0) notes.push('The tenant has held advance credit that is not automatically applied.')
  if (midPeriod) notes.push('The move date is inside a legacy billing period; review room rent manually because no proration rule exists.')
  if (paidAnniversaryPeriod) notes.push(`The source anniversary rent is already paid through ${paidAnniversaryPeriod.endDateExclusive} (exclusive). Review any destination rent difference manually; no settled payment is modified.`)
  if (paidPrepaidPeriod) notes.push('A future rent period has been prepaid. It stays attached to the source room and requires explicit reconciliation.')
  if (difference > 0) notes.push('The destination room is more expensive. No advance or deposit top-up is collected automatically; the original deposit remains unchanged.')
  if (difference < 0) notes.push('The destination room is cheaper. Deposit or advance differences require manual review.')
  return {
    outstandingCents: account.balance, creditCents: account.credit,
    currentRentCents, targetRentCents, rentDifferenceCents: difference,
    depositTopUpProposalCents: 0,
    billingReviewRequired: notes.length > 0, affectedBillingPeriodIds, notes,
  }
}

export function eligibleRoomChangeTargets(data: PrototypeAppState, tenantId: string, startDate: string) {
  const assignment = activeAssignments(data, startDate).find(item => item.tenantId === tenantId)
  return data.rooms.filter(room => room.id !== assignment?.roomId && room.status !== 'maintenance')
    .filter(room => !roomCapacityConflict(data, {
      roomId: room.id, tenantId, startDate, endDate: null, capacity: room.capacity,
    }))
}

function validateRequest(data: PrototypeAppState, draft: RoomChangeRequestDraft, options: { asOf: string; currentAssignmentId?: string; ignoreRequestId?: string }): RoomChangeRequestErrors {
  const errors: RoomChangeRequestErrors = {}
  const tenant = data.tenants.find(item => item.id === draft.tenantId)
  if (!tenant || tenant.status !== 'ACTIVE') {
    errors.general = 'An active tenant is required to request a room change.'
    return errors
  }
  const current = options.currentAssignmentId
    ? data.roomAssignments.find(item => item.id === options.currentAssignmentId)
    : activeAssignments(data, options.asOf).find(item => item.tenantId === tenant.id)
  if (!current || current.tenantId !== tenant.id || current.endDate !== null) {
    errors.general = 'Your current room assignment has changed. Refresh before requesting a room change.'
    return errors
  }
  const room = data.rooms.find(item => item.id === draft.requestedRoomId)
  if (!room) errors.roomId = 'Choose an existing room.'
  else if (room.id === current.roomId) errors.roomId = 'Choose a room different from your current room.'
  else if (room.status === 'maintenance') errors.roomId = 'This room is under repair and cannot accept a tenant.'
  if (!isIsoDate(draft.requestedStartDate)) errors.startDate = 'Enter a valid requested move date.'
  else if (draft.requestedStartDate <= current.startDate) errors.startDate = 'The requested move date must be after the current tenancy began.'
  else if (draft.requestedStartDate < options.asOf) errors.startDate = 'The requested move date cannot be in the past.'
  if (room && isIsoDate(draft.requestedStartDate)) {
    const conflict = roomCapacityConflict(data, {
      roomId: room.id, tenantId: tenant.id, startDate: draft.requestedStartDate, endDate: null, capacity: room.capacity,
    })
    if (conflict) errors.roomId = `This room would exceed its capacity on ${conflict.date}.`
    const overlap = data.roomAssignments.some(item => item.tenantId === tenant.id && item.id !== current.id
      && item.startDate <= '9999-12-31' && (item.endDate === null || item.endDate >= draft.requestedStartDate))
    if (overlap) errors.startDate = 'This move date overlaps another recorded room assignment.'
  }
  const pending = data.roomChangeRequests.find(item => item.tenantId === tenant.id && item.status === 'PENDING' && item.id !== options.ignoreRequestId)
  if (pending) errors.general = 'You already have a pending room change request.'
  const reason = draft.reason.trim()
  if (reason.length < 3) errors.reason = 'Explain briefly why you want to move.'
  if (reason.length > 500) errors.reason = 'Keep the reason within 500 characters.'
  return errors
}

function audit(data: PrototypeAppState, request: RoomChangeRequest, action: 'ROOM_CHANGE_REQUESTED' | 'ROOM_CHANGE_CANCELLED' | 'ROOM_CHANGE_APPROVED' | 'ROOM_CHANGE_REJECTED', actorId: string, occurredOn: string, reason: string) {
  return [...data.auditEvents, {
    id: `audit-${request.id}-${action.toLowerCase()}`, actorId, occurredOn, action,
    entityType: 'ROOM_CHANGE_REQUEST' as const, entityId: request.id, reason,
    beforeSnapshot: null, afterSnapshot: JSON.stringify(request),
  }]
}

export function submitRoomChangeRequest(data: PrototypeAppState, draft: RoomChangeRequestDraft, asOf: string): RoomChangeRequestResult {
  const errors = validateRequest(data, draft, { asOf })
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  const current = activeAssignments(data, asOf).find(item => item.tenantId === draft.tenantId)!
  const request: RoomChangeRequest = {
    id: draft.requestId ?? requestId(), tenantId: draft.tenantId, currentAssignmentId: current.id, currentRoomId: current.roomId,
    requestedRoomId: draft.requestedRoomId, requestedStartDate: draft.requestedStartDate, reason: draft.reason.trim(),
    status: 'PENDING', createdAt: asOf, decidedAt: null, decidedBy: null, decisionReason: null,
    approvedStartDate: null, resultingAssignmentId: null, billingReviewAcknowledged: false, billingReviewPeriodIds: [],
  }
  return { ok: true, request, data: {
    ...data,
    roomChangeRequests: [...data.roomChangeRequests, request],
    auditEvents: audit(data, request, 'ROOM_CHANGE_REQUESTED', draft.tenantId, asOf, request.reason),
  } }
}

export function cancelRoomChangeRequest(data: PrototypeAppState, requestIdToCancel: string, tenantId: string, reason: string, asOf: string): RoomChangeDecisionResult {
  const request = data.roomChangeRequests.find(item => item.id === requestIdToCancel)
  if (!request || request.tenantId !== tenantId) return { ok: false, errors: { general: 'This request is not available.' } }
  if (request.status !== 'PENDING') return { ok: false, errors: { general: 'Only a pending request can be cancelled.' } }
  const next = {
    ...request, status: 'CANCELLED' as const, decidedAt: asOf, decidedBy: tenantId,
    decisionReason: reason.trim().slice(0, 500) || 'Cancelled by tenant.',
  }
  return { ok: true, request: next, data: {
    ...data, roomChangeRequests: data.roomChangeRequests.map(item => item.id === request.id ? next : item),
    auditEvents: audit(data, next, 'ROOM_CHANGE_CANCELLED', tenantId, asOf, next.decisionReason),
  } }
}

export function rejectRoomChangeRequest(data: PrototypeAppState, requestIdToReject: string, reason: string, asOf: string): RoomChangeDecisionResult {
  const request = data.roomChangeRequests.find(item => item.id === requestIdToReject)
  if (!request) return { ok: false, errors: { general: 'This request no longer exists.' } }
  if (request.status !== 'PENDING') return { ok: false, errors: { general: 'Only a pending request can be rejected.' } }
  if (reason.trim().length < 3) return { ok: false, errors: { reason: 'Enter a short rejection reason.' } }
  if (reason.trim().length > 500) return { ok: false, errors: { reason: 'Keep the reason within 500 characters.' } }
  const next = {
    ...request, status: 'REJECTED' as const, decidedAt: asOf, decidedBy: 'demo-admin',
    decisionReason: reason.trim(),
  }
  return { ok: true, request: next, data: {
    ...data, roomChangeRequests: data.roomChangeRequests.map(item => item.id === request.id ? next : item),
    auditEvents: audit(data, next, 'ROOM_CHANGE_REJECTED', 'demo-admin', asOf, reason.trim()),
  } }
}

export function approveRoomChangeRequest(data: PrototypeAppState, requestIdToApprove: string, input: {
  effectiveDate: string
  note: string
  billingReviewAcknowledged: boolean
  decidedAt: string
}): RoomChangeDecisionResult {
  const request = data.roomChangeRequests.find(item => item.id === requestIdToApprove)
  if (!request) return { ok: false, errors: { general: 'This request no longer exists.' } }
  if (request.status !== 'PENDING') return { ok: false, errors: { general: 'Only a pending request can be approved.' } }
  if (input.note.trim().length > 500) return { ok: false, errors: { general: 'Keep the decision note within 500 characters.' } }
  const errors = validateRequest(data, {
    tenantId: request.tenantId, requestedRoomId: request.requestedRoomId,
    requestedStartDate: input.effectiveDate, reason: request.reason,
  }, { asOf: input.decidedAt, currentAssignmentId: request.currentAssignmentId, ignoreRequestId: request.id })
  if (request.currentRoomId !== data.roomAssignments.find(item => item.id === request.currentAssignmentId)?.roomId) {
    errors.general = 'The current assignment no longer matches this request. Reject it and ask the tenant to submit again.'
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  const warnings = roomChangeFinancialWarnings(data, request.tenantId, request.requestedRoomId, input.effectiveDate)
  if (warnings?.billingReviewRequired && !input.billingReviewAcknowledged) {
    return { ok: false, errors: { general: 'Confirm that the financial and billing effects have been reviewed.' } }
  }
  const transfer = transferTenantRoom(data, request.tenantId, request.requestedRoomId, input.effectiveDate, input.decidedAt)
  if (!transfer || transfer.endedAssignmentId !== request.currentAssignmentId) {
    return { ok: false, errors: { general: 'The tenant assignment changed before approval. Review the request again.' } }
  }
  const next = {
    ...request, status: 'APPROVED' as const, decidedAt: input.decidedAt, decidedBy: 'demo-admin',
    decisionReason: input.note.trim() || 'Approved by landlord.',
    approvedStartDate: input.effectiveDate, resultingAssignmentId: transfer.assignment.id,
    billingReviewAcknowledged: input.billingReviewAcknowledged,
    billingReviewPeriodIds: warnings?.affectedBillingPeriodIds ?? [],
  }
  const approvedData = {
    ...transfer.data,
    roomChangeRequests: transfer.data.roomChangeRequests.map(item => item.id === request.id ? next : item),
    auditEvents: audit(transfer.data, next, 'ROOM_CHANGE_APPROVED', 'demo-admin', input.decidedAt, next.decisionReason),
  }
  let reconciled = reconcileOccupancy(data, approvedData, input.decidedAt, { createMoveInObligations: false })
  const sourceCycle = data.occupancyCycles.find(cycle => cycle.roomId === request.currentRoomId && cycle.status === 'ACTIVE')
  const paidPeriod = transferRentReviewNeeded(data, request.currentRoomId, request.tenantId, input.effectiveDate)
  if (paidPeriod) {
    reconciled = openFinancialReviewCase(reconciled, {
      type: 'TRANSFER_RENT_DIFFERENCE', roomId: request.currentRoomId, occupancyCycleId: sourceCycle?.id ?? null,
      tenantId: request.tenantId, rentalPeriodId: paidPeriod.id, asOf: input.decidedAt,
      note: `Transfer on ${input.effectiveDate} occurs during paid rent ${paidPeriod.startDate} to ${paidPeriod.endDateExclusive} (exclusive). Landlord review is required before any rent difference is charged.`,
    })
  }
  const prepaidFuture = sourceCycle
    ? data.rentPrepayments.filter(prepayment => prepayment.occupancyCycleId === sourceCycle.id)
      .flatMap(prepayment => prepayment.rentalPeriodIds)
      .map(id => data.rentalPeriods.find(item => item.id === id) ?? null)
      .find(item => Boolean(item && item.startDate >= input.effectiveDate))
    : undefined
  if (prepaidFuture) {
    reconciled = openFinancialReviewCase(reconciled, {
      type: 'TRANSFER_PREPAID_RENT', roomId: request.currentRoomId, occupancyCycleId: sourceCycle?.id ?? null,
      tenantId: request.tenantId, rentalPeriodId: prepaidFuture.id, asOf: input.decidedAt,
      note: `Rent starting ${prepaidFuture.startDate} is prepaid and remains attached to the source room. Landlord reconciliation is required.`,
    })
  }
  return { ok: true, request: next, effectiveDate: input.effectiveDate, data: reconciled }
}

/** Releases an approved future reservation. The request and its history remain auditable. */
export function cancelApprovedRoomChangeRequest(data: PrototypeAppState, requestIdToCancel: string, reason: string, asOf: string): RoomChangeDecisionResult {
  const request = data.roomChangeRequests.find(item => item.id === requestIdToCancel)
  if (!request || request.status !== 'APPROVED' || !request.approvedStartDate || !request.resultingAssignmentId) {
    return { ok: false, errors: { general: 'Only an approved future reservation can be cancelled here.' } }
  }
  if (request.approvedStartDate <= asOf) {
    return { ok: false, errors: { general: 'This transfer is already effective. Use the tenancy transfer or move-out workflow instead.' } }
  }
  if (reason.trim().length < 3) return { ok: false, errors: { reason: 'Enter a short cancellation reason.' } }
  if (reason.trim().length > 500) return { ok: false, errors: { reason: 'Keep the reason within 500 characters.' } }
  const resulting = data.roomAssignments.find(item => item.id === request.resultingAssignmentId)
  const source = data.roomAssignments.find(item => item.id === request.currentAssignmentId)
  if (!resulting || !source || resulting.tenantId !== request.tenantId || resulting.roomId !== request.requestedRoomId
    || resulting.startDate !== request.approvedStartDate || resulting.endDate !== null
    || source.tenantId !== request.tenantId || source.endDate !== previousDate(request.approvedStartDate)) {
    return { ok: false, errors: { general: 'The assignments changed. Review the request before cancelling the reservation.' } }
  }
  const next = {
    ...request, status: 'CANCELLED' as const, decidedAt: asOf, decidedBy: 'demo-admin',
    decisionReason: reason.trim(), resultingAssignmentId: null,
  }
  const auditEvent = {
    id: `audit-${request.id}-room_change_reservation_cancelled`, actorId: 'demo-admin', occurredOn: asOf,
    action: 'ROOM_CHANGE_RESERVATION_CANCELLED' as const, entityType: 'ROOM_CHANGE_REQUEST' as const,
    entityId: request.id, reason: reason.trim(), beforeSnapshot: JSON.stringify(request), afterSnapshot: JSON.stringify(next),
  }
  return { ok: true, request: next, data: {
    ...data,
    roomAssignments: data.roomAssignments
      .filter(item => item.id !== resulting.id)
      .map(item => item.id === source.id ? { ...item, endDate: null } : item),
    roomChangeRequests: data.roomChangeRequests.map(item => item.id === request.id ? next : item),
    auditEvents: [...data.auditEvents, auditEvent],
  } }
}

/** Moves an approved future reservation to another date after rechecking all overlapping capacity. */
export function rescheduleApprovedRoomChangeRequest(data: PrototypeAppState, requestIdToReschedule: string, newDate: string, reason: string, asOf: string): RoomChangeDecisionResult {
  const request = data.roomChangeRequests.find(item => item.id === requestIdToReschedule)
  if (!request || request.status !== 'APPROVED' || !request.approvedStartDate || !request.resultingAssignmentId) {
    return { ok: false, errors: { general: 'Only an approved future reservation can be rescheduled here.' } }
  }
  if (request.approvedStartDate <= asOf) {
    return { ok: false, errors: { general: 'This transfer is already effective. Use the tenancy transfer workflow instead.' } }
  }
  if (!isIsoDate(newDate) || newDate <= asOf) return { ok: false, errors: { startDate: 'Choose a future effective date.' } }
  if (newDate === request.approvedStartDate) return { ok: false, errors: { startDate: 'Choose a different effective date.' } }
  if (reason.trim().length > 500) return { ok: false, errors: { general: 'Keep the reason within 500 characters.' } }
  const resulting = data.roomAssignments.find(item => item.id === request.resultingAssignmentId)
  const source = data.roomAssignments.find(item => item.id === request.currentAssignmentId)
  const room = data.rooms.find(item => item.id === request.requestedRoomId)
  if (!resulting || !source || !room || resulting.tenantId !== request.tenantId || resulting.roomId !== room.id
    || resulting.startDate !== request.approvedStartDate || resulting.endDate !== null
    || source.tenantId !== request.tenantId || source.endDate !== previousDate(request.approvedStartDate)) {
    return { ok: false, errors: { general: 'The assignments changed. Review the request before rescheduling the reservation.' } }
  }
  if (newDate <= source.startDate) return { ok: false, errors: { startDate: 'The new date must be after the current tenancy began.' } }
  const conflict = roomCapacityConflict(data, {
    roomId: room.id, tenantId: request.tenantId, startDate: newDate, endDate: null, capacity: room.capacity,
    excludeAssignmentIds: [resulting.id],
  })
  if (conflict) return { ok: false, errors: { roomId: `This room would exceed its capacity on ${conflict.date}.` } }
  const period = data.billingPeriods.find(item => item.startDate <= newDate && item.endDate >= newDate)
  const next = {
    ...request, approvedStartDate: newDate, decidedAt: asOf, decidedBy: 'demo-admin',
    decisionReason: reason.trim() || 'Reservation rescheduled.',
    billingReviewPeriodIds: period && newDate > period.startDate ? [period.id] : [],
  }
  const nextData = {
    ...data,
    roomAssignments: data.roomAssignments.map(item => item.id === resulting.id
      ? { ...item, startDate: newDate, agreedRentCents: roomMonthlyRentCents(data, room, newDate) }
      : item.id === source.id ? { ...item, endDate: previousDate(newDate) } : item),
    roomChangeRequests: data.roomChangeRequests.map(item => item.id === request.id ? next : item),
    auditEvents: [...data.auditEvents, {
      id: `audit-${request.id}-rescheduled-${request.approvedStartDate}-${newDate}`, actorId: 'demo-admin', occurredOn: asOf,
      action: 'ROOM_CHANGE_RESCHEDULED' as const, entityType: 'ROOM_CHANGE_REQUEST' as const,
      entityId: request.id, reason: next.decisionReason, beforeSnapshot: JSON.stringify(request), afterSnapshot: JSON.stringify(next),
    }],
  }
  return { ok: true, request: next, effectiveDate: newDate, data: nextData }
}

/** A direct landlord transfer, move-out, or deletion expires pending requests safely. */
export function expirePendingRoomChangeRequests(data: PrototypeAppState, tenantId: string, asOf: string, reason: string): PrototypeAppState {
  const pending = data.roomChangeRequests.filter(item => item.tenantId === tenantId && item.status === 'PENDING')
  if (pending.length === 0) return data
  const expired = pending.map(request => ({ ...request, status: 'EXPIRED' as const, decidedAt: asOf, decidedBy: 'demo-system', decisionReason: reason }))
  return {
    ...data,
    roomChangeRequests: data.roomChangeRequests.map(request => expired.find(item => item.id === request.id) ?? request),
    auditEvents: [...data.auditEvents, ...expired.map(request => ({
      id: `audit-${request.id}-room_change_expired`, actorId: 'demo-system', occurredOn: asOf,
      action: 'ROOM_CHANGE_EXPIRED' as const, entityType: 'ROOM_CHANGE_REQUEST' as const, entityId: request.id, reason,
      beforeSnapshot: null, afterSnapshot: JSON.stringify(request),
    }))],
  }
}

/** Approved mid-period transfers whose rent effects need manual review in a billing period. */
export function approvedRoomChangeBillingReviews(data: PrototypeAppState, periodId: string): RoomChangeRequest[] {
  return data.roomChangeRequests.filter(request => request.status === 'APPROVED' && request.billingReviewPeriodIds.includes(periodId))
}
