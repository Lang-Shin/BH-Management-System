import type { AdvanceRefund, Payment, PaymentAllocation, PrototypeAppState } from '@/domain/types/models'
import { activeAssignments, chargePaid, tenantAccount, unresolvedElectricity } from './summary'
import { activeCycleForRoom } from './move-in'
import { activeMoveInPolicy } from './move-in-policy'
import { isIsoDate } from '@/domain/validation/date'

export interface ShortStayRefundEligibility {
  eligible: boolean
  blockers: string[]
  stayDays: number | null
  windowDays: number
  refundableCents: number
  moveInDate: string | null
  moveOutDate: string
}

export type AdvanceRefundError =
  | 'NOT_ELIGIBLE' | 'REASON_REQUIRED' | 'REASON_TOO_LONG' | 'INVALID_DATE'
  | 'DUPLICATE_REFUND' | 'PAYMENT_NOT_FOUND' | 'OBLIGATION_NOT_FOUND'

export type AdvanceRefundResult =
  | { ok: true; data: PrototypeAppState; refund: AdvanceRefund }
  | { ok: false; error: AdvanceRefundError; blockers?: string[] }

function calendarDaysBetween(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`)
  const end = Date.parse(`${endDate}T00:00:00Z`)
  return Math.round((end - start) / 86_400_000)
}

/**
 * Short-stay refunds are tied to one accommodation cycle and require that the room is fully
 * vacating. A roommate leaving a still-occupied shared room needs an explicit manual review.
 */
export function evaluateShortStayAdvanceRefund(data: PrototypeAppState, tenantId: string, moveOutDate: string): ShortStayRefundEligibility {
  const policy = activeMoveInPolicy(data)
  const windowDays = policy.shortStayAdvanceRefundDays
  const assignment = data.roomAssignments.find(item => item.tenantId === tenantId
    && item.startDate <= moveOutDate && (item.endDate === null || item.endDate >= moveOutDate))
  const room = assignment ? data.rooms.find(item => item.id === assignment.roomId) : undefined
  const cycle = room ? activeCycleForRoom(data, room.id) : null
  const obligation = cycle ? data.moveInObligations.find(item => item.occupancyCycleId === cycle.id) : undefined
  const advance = obligation ? data.charges.find(item => item.id === obligation.advanceChargeId && item.category === 'ADVANCE') : undefined
  const blockers: string[] = []
  const stayDays = assignment ? calendarDaysBetween(assignment.startDate, moveOutDate) : null

  if (!assignment || !room || !cycle || !obligation || !advance) {
    blockers.push('No room-level advance requirement is available for this tenant.')
  } else {
    if (stayDays === null || stayDays < 0) blockers.push('Choose a valid move-out date.')
    else if (stayDays >= windowDays) blockers.push(`The tenant has completed the ${windowDays}-day minimum stay, so the short-stay advance refund does not apply.`)
    if (chargePaid(data, advance.id, moveOutDate) < obligation.advanceRequiredCents) blockers.push('The advance has not been paid in full.')
    if (data.advanceRefunds.some(refund => refund.advanceChargeId === advance.id)) blockers.push('This advance has already been refunded.')
    const otherOccupants = activeAssignments(data, moveOutDate)
      .filter(item => item.roomId === room.id && item.tenantId !== tenantId)
    if (otherOccupants.length > 0) blockers.push('Another tenant still occupies this shared room. Refund the room advance only through manual review after the room is vacated.')
    if (tenantAccount(data, tenantId, moveOutDate).balance > 0) blockers.push('Outstanding bills must be settled before an advance refund.')
    if (unresolvedElectricity(data, moveOutDate).some(item => item.tenantId === tenantId)) blockers.push('Electricity awaiting a meter reading must be completed before an advance refund.')
  }

  return {
    eligible: blockers.length === 0,
    blockers,
    stayDays,
    windowDays,
    refundableCents: obligation?.advanceRequiredCents ?? 0,
    moveInDate: assignment?.startDate ?? null,
    moveOutDate,
  }
}

export function prepareShortStayAdvanceRefund(data: PrototypeAppState, input: {
  tenantId: string
  moveOutDate: string
  refundedOn: string
  reason: string
}): AdvanceRefundResult {
  const eligibility = evaluateShortStayAdvanceRefund(data, input.tenantId, input.moveOutDate)
  if (!eligibility.eligible) return { ok: false, error: 'NOT_ELIGIBLE', blockers: eligibility.blockers }
  if (!isIsoDate(input.refundedOn) || input.refundedOn < input.moveOutDate) return { ok: false, error: 'INVALID_DATE' }
  const reason = input.reason.trim()
  if (reason.length < 3) return { ok: false, error: 'REASON_REQUIRED' }
  if (reason.length > 500) return { ok: false, error: 'REASON_TOO_LONG' }
  const assignment = data.roomAssignments.find(item => item.tenantId === input.tenantId
    && item.startDate <= input.moveOutDate && (item.endDate === null || item.endDate >= input.moveOutDate))!
  const cycle = activeCycleForRoom(data, assignment.roomId)!
  const obligation = data.moveInObligations.find(item => item.occupancyCycleId === cycle.id)
  if (!obligation) return { ok: false, error: 'OBLIGATION_NOT_FOUND' }
  if (data.advanceRefunds.some(refund => refund.advanceChargeId === obligation.advanceChargeId)) return { ok: false, error: 'DUPLICATE_REFUND' }
  const advance = data.charges.find(item => item.id === obligation.advanceChargeId && item.category === 'ADVANCE')
  if (!advance) return { ok: false, error: 'OBLIGATION_NOT_FOUND' }
  const allocation = data.paymentAllocations.find((item): item is PaymentAllocation & { paymentId: string } => item.chargeId === advance.id
    && item.state === 'ACTIVE')
  const payment = allocation ? data.payments.find((item): item is Payment => item.id === allocation.paymentId && item.state === 'RECORDED') : undefined
  if (!payment) return { ok: false, error: 'PAYMENT_NOT_FOUND' }
  const policy = activeMoveInPolicy(data)
  const refundId = `advance-refund-${obligation.id}`
  const auditEventId = `audit-${refundId}`
  const refund: AdvanceRefund = {
    id: refundId,
    occupancyCycleId: cycle.id,
    roomId: assignment.roomId,
    tenantId: input.tenantId,
    advanceChargeId: advance.id,
    sourcePaymentId: payment.id,
    amountCents: obligation.advanceRequiredCents,
    refundedOn: input.refundedOn,
    reason,
    policyVersion: policy.version,
    refundWindowDays: policy.shortStayAdvanceRefundDays,
    auditEventId,
  }
  return {
    ok: true,
    refund,
    data: {
      ...data,
      advanceRefunds: [...data.advanceRefunds, refund],
      auditEvents: [...data.auditEvents, {
        id: auditEventId, actorId: 'demo-admin', occurredOn: input.refundedOn,
        action: 'ADVANCE_REFUNDED' as const, entityType: 'PAYMENT' as const, entityId: payment.id,
        reason: `Short-stay advance refund for Room ${data.rooms.find(room => room.id === assignment.roomId)?.name ?? assignment.roomId}: ${reason}`,
        beforeSnapshot: JSON.stringify({ refundId, advanceChargeId: advance.id, amountCents: refund.amountCents, sourcePaymentId: payment.id }),
        afterSnapshot: JSON.stringify(refund),
      }],
    },
  }
}
