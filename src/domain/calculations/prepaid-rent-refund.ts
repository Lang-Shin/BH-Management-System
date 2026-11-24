import type {
  PaymentAllocation, PrepaidRentRefund, PrepaidRentRefundAllocation, PrototypeAppState, RentPrepayment,
} from '@/domain/types/models'
import { activeAssignments } from './summary'
import { roomFinancialEligibility } from './occupancy-financial-eligibility'
import { latestPaymentReceipt } from './payment-correction'
import { rentalPeriodsForCycle } from './rental-periods'
import { isIsoDate } from '@/domain/validation/date'
import { formatMoney, formatShortDateRange } from '@/lib/format'

export type PrepaidRefundPeriodStatus = 'FUTURE' | 'NON_REFUNDABLE' | 'REVIEW_REQUIRED' | 'PARTIALLY_RESERVED'

export interface PrepaidRefundPeriod {
  rentalPeriodId: string
  rentObligationId: string
  sequence: number
  startDate: string
  endDateExclusive: string
  dueDate: string
  amountCents: number
  paidCents: number
  reservedCents: number
  refundableCents: number
  occupiedDays: number
  status: PrepaidRefundPeriodStatus
  allocationIds: string[]
  paymentIds: string[]
  receiptNumbers: string[]
  rateSnapshotCents: number
  note: string
}

export interface PrepaidRentReconciliation {
  tenantId: string
  tenantName: string
  roomId: string
  roomName: string
  occupancyCycleId: string | null
  moveOutDate: string
  periods: PrepaidRefundPeriod[]
  totalPrepaidCents: number
  refundableCents: number
  nonRefundableCents: number
  reviewRequiredCents: number
  reservationsCents: number
  entitlementReviewRequired: boolean
  blockers: string[]
  refunds: PrepaidRentRefund[]
  currentRefund: PrepaidRentRefund | null
  status: PrepaidRentRefund['status'] | null
  canPropose: boolean
}

export type PrepaidRefundError =
  | 'TENANT_NOT_FOUND' | 'NO_REFUNDABLE_RENT' | 'OUTSTANDING_BALANCE' | 'DUPLICATE_REFUND'
  | 'REFUND_NOT_FOUND' | 'INVALID_STATUS' | 'INVALID_DATE' | 'REASON_REQUIRED' | 'REASON_TOO_LONG'
  | 'ENTITLEMENT_REVIEW_REQUIRED' | 'STALE_REFUND' | 'REFUND_EXCEEDS_ELIGIBLE'

export type PrepaidRefundResult =
  | { ok: true; data: PrototypeAppState; refund: PrepaidRentRefund }
  | { ok: false; error: PrepaidRefundError; blockers?: string[] }

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000)
}

function previousDate(date: string): string {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() - 1)
  return value.toISOString().slice(0, 10)
}

function assignmentForMoveOut(data: PrototypeAppState, tenantId: string, moveOutDate: string) {
  return [...data.roomAssignments].reverse().find(assignment => assignment.tenantId === tenantId
    && assignment.startDate <= moveOutDate
    && (assignment.endDate === null || assignment.endDate >= previousDate(moveOutDate)))
    ?? data.roomAssignments.find(assignment => assignment.tenantId === tenantId
      && assignment.startDate <= moveOutDate && assignment.endDate !== null && assignment.endDate < moveOutDate)
}


export function prepaidRentReconciliation(data: PrototypeAppState, tenantId: string, moveOutDate: string): PrepaidRentReconciliation | null {
  const tenant = data.tenants.find(item => item.id === tenantId)
  const assignment = assignmentForMoveOut(data, tenantId, moveOutDate)
  const room = assignment ? data.rooms.find(item => item.id === assignment.roomId) : undefined
  if (!tenant || !assignment || !room) return null
  const cycle = data.occupancyCycles
    .filter(item => item.roomId === room.id && item.startedAt <= moveOutDate
      && (item.endedAt === null || item.endedAt >= moveOutDate))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]
  const refunds = (data.prepaidRentRefunds ?? []).filter(refund => refund.tenantId === tenantId
    && refund.occupancyCycleId === (cycle?.id ?? '') && refund.roomId === room.id)
  const currentRefund = [...refunds].filter(refund => refund.status !== 'REVERSED')
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0] ?? null
  const obligations = cycle ? data.rentObligations.filter(obligation => obligation.occupancyCycleId === cycle.id) : []
  const periodsData = cycle ? rentalPeriodsForCycle(data, cycle.id) : []
  const obligationIds = new Set(obligations.map(obligation => obligation.id))
  const activeAllocations = data.paymentAllocations.filter(allocation => allocation.state === 'ACTIVE'
    && obligationIds.has(allocation.chargeId)
    && data.payments.some(payment => payment.id === allocation.paymentId && payment.state === 'RECORDED'))
  const reservedByAllocation = new Map<string, number>()
  for (const refund of refunds.filter(item => item.status !== 'REVERSED')) {
    for (const allocation of refund.allocations) {
      reservedByAllocation.set(allocation.paymentAllocationId,
        (reservedByAllocation.get(allocation.paymentAllocationId) ?? 0) + allocation.amountCents)
    }
  }
  const occupants = activeAssignments(data, moveOutDate).filter(item => item.roomId === room.id && item.tenantId !== tenantId)
  const tenantScopedPayment = activeAllocations.some(allocation => {
    const payment = data.payments.find(item => item.id === allocation.paymentId)
    return payment?.scope === 'TENANT' && payment.tenantId !== null && payment.tenantId !== tenantId
  })
  const entitlementReviewRequired = occupants.length > 0 || tenantScopedPayment
  const blockers: string[] = []
  const occupancy = roomFinancialEligibility(data, room.id, moveOutDate)
  if (!occupancy.eligible) {
    blockers.push(`Move-out remains blocked: Room ${room.name} has outstanding room-level obligations. Settle them before recording a completed refund.`)
  }
  if (entitlementReviewRequired) {
    blockers.push('Refund entitlement is ambiguous because the room is shared or another payer is linked. Landlord entitlement verification is required.')
  }
  const periodRows: PrepaidRefundPeriod[] = periodsData.flatMap(period => {
    const obligation = obligations.find(item => item.rentalPeriodId === period.id)
    if (!obligation || obligation.state !== 'ISSUED') return []
    const allocations = activeAllocations.filter(allocation => allocation.chargeId === obligation.id)
    const paidCents = sum(allocations.map(allocation => allocation.amountCents))
    if (paidCents <= 0) return []
    const reservedCents = Math.min(paidCents, sum(allocations.map(allocation => reservedByAllocation.get(allocation.id) ?? 0)))
    const occupiedDays = Math.max(0, daysBetween(period.startDate, moveOutDate))
    const future = period.startDate >= moveOutDate
    const status: PrepaidRefundPeriodStatus = future ? (reservedCents > 0 ? 'PARTIALLY_RESERVED' : 'FUTURE')
      : occupiedDays >= 7 ? 'NON_REFUNDABLE' : 'REVIEW_REQUIRED'
    const refundableCents = future ? Math.max(0, paidCents - reservedCents) : 0
    const paymentIds = [...new Set(allocations.map(allocation => allocation.paymentId))]
    return [{
      rentalPeriodId: period.id, rentObligationId: obligation.id, sequence: period.sequence,
      startDate: period.startDate, endDateExclusive: period.endDateExclusive, dueDate: period.dueDate,
      amountCents: obligation.amountCents, paidCents, reservedCents, refundableCents, occupiedDays, status,
      allocationIds: allocations.map(allocation => allocation.id), paymentIds,
      receiptNumbers: paymentIds.map(paymentId => latestPaymentReceipt(data, paymentId)?.receiptNumber ?? 'No receipt'),
      rateSnapshotCents: obligation.rateSnapshotCents,
      note: future ? 'The anniversary period has not started; the actual prepaid allocation is fully refundable.'
        : occupiedDays >= 7 ? `The tenant occupied ${occupiedDays} elapsed days. This period is nonrefundable under the confirmed seven-day rule.`
          : `The tenant occupied ${occupiedDays} elapsed day${occupiedDays === 1 ? '' : 's'}. The refund policy for this started period requires landlord review.`,
    }]
  })
  const totalPrepaidCents = sum(periodRows.map(period => period.paidCents))
  const refundableCents = sum(periodRows.map(period => period.refundableCents))
  const nonRefundableCents = sum(periodRows.filter(period => period.status === 'NON_REFUNDABLE').map(period => period.paidCents))
  const reviewRequiredCents = sum(periodRows.filter(period => period.status === 'REVIEW_REQUIRED').map(period => period.paidCents))
  const reservationsCents = sum(periodRows.map(period => period.reservedCents))
  if (refundableCents <= 0) blockers.push('No unrefunded future prepaid rent is available for a refund.')
  return {
    tenantId, tenantName: tenant.name, roomId: room.id, roomName: room.name,
    occupancyCycleId: cycle?.id ?? null, moveOutDate, periods: periodRows,
    totalPrepaidCents, refundableCents, nonRefundableCents, reviewRequiredCents, reservationsCents,
    entitlementReviewRequired, blockers, refunds, currentRefund,
    status: currentRefund?.status ?? null,
    canPropose: refundableCents > 0 && !refunds.some(refund => refund.status !== 'REVERSED')
      && !blockers.some(blocker => blocker.startsWith('Move-out remains blocked')),
  }
}

function auditEvent(refund: PrepaidRentRefund, action: 'PREPAID_RENT_REFUND_PROPOSED' | 'PREPAID_RENT_REFUND_APPROVED' | 'PREPAID_RENT_REFUND_COMPLETED' | 'PREPAID_RENT_REFUND_REVERSED',
  reason: string, before: unknown, occurredOn: string) {
  const id = `audit-${refund.id}-${action.toLowerCase()}`
  return {
    id, actorId: 'demo-admin', occurredOn, action, entityType: 'PREPAID_RENT_REFUND' as const,
    entityId: refund.id, reason,
    beforeSnapshot: JSON.stringify(before), afterSnapshot: JSON.stringify(refund),
  }
}

function validReason(reason: string): PrepaidRefundError | null {
  const trimmed = reason.trim()
  return trimmed.length < 3 ? 'REASON_REQUIRED' : trimmed.length > 500 ? 'REASON_TOO_LONG' : null
}

export function preparePrepaidRefundProposal(data: PrototypeAppState, input: {
  tenantId: string; moveOutDate: string; reason: string; asOf: string; amountCents?: number
}): PrepaidRefundResult {
  const reasonError = validReason(input.reason)
  if (reasonError) return { ok: false, error: reasonError }
  if (!isIsoDate(input.moveOutDate) || !isIsoDate(input.asOf) || input.asOf < input.moveOutDate) return { ok: false, error: 'INVALID_DATE' }
  const reconciliation = prepaidRentReconciliation(data, input.tenantId, input.moveOutDate)
  if (!reconciliation) return { ok: false, error: 'TENANT_NOT_FOUND' }
  if (!reconciliation.occupancyCycleId) return { ok: false, error: 'NO_REFUNDABLE_RENT', blockers: reconciliation.blockers }
  if (reconciliation.blockers.some(blocker => blocker.startsWith('Move-out remains blocked'))) {
    return { ok: false, error: 'OUTSTANDING_BALANCE', blockers: reconciliation.blockers }
  }
  if (reconciliation.currentRefund) return { ok: false, error: 'DUPLICATE_REFUND', blockers: reconciliation.blockers }
  if (reconciliation.refundableCents <= 0) return { ok: false, error: 'NO_REFUNDABLE_RENT', blockers: reconciliation.blockers }
  if (input.amountCents !== undefined && (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0
    || input.amountCents !== reconciliation.refundableCents)) return { ok: false, error: 'REFUND_EXCEEDS_ELIGIBLE' }
  const allocationRows = reconciliation.periods.filter(period => period.refundableCents > 0).flatMap(period =>
    period.allocationIds.flatMap(allocationId => {
      const allocation = data.paymentAllocations.find(item => item.id === allocationId && item.state === 'ACTIVE')
      if (!allocation) return []
      return [{
        paymentAllocationId: allocation.id, paymentId: allocation.paymentId,
        receiptId: latestPaymentReceipt(data, allocation.paymentId)?.id ?? null,
        rentObligationId: period.rentObligationId, rentalPeriodId: period.rentalPeriodId,
        amountCents: allocation.amountCents,
      }]
    }))
  const count = (data.prepaidRentRefunds ?? []).length + 1
  const refund: PrepaidRentRefund = {
    id: `prepaid-refund-${reconciliation.occupancyCycleId}-${count}`,
    status: 'PROPOSED', tenantId: input.tenantId, roomId: reconciliation.roomId,
    occupancyCycleId: reconciliation.occupancyCycleId, moveOutDate: input.moveOutDate,
    amountCents: sum(allocationRows.map(allocation => allocation.amountCents)), reason: input.reason.trim(),
    recordedBy: 'demo-admin', recordedAt: input.asOf, approvedAt: null, approvedBy: null,
    refundedOn: null, completedBy: null, reversedAt: null, reversedBy: null, reversalReason: null,
    allocations: allocationRows, entitlementReviewRequired: reconciliation.entitlementReviewRequired,
    auditEventId: '', lastAuditEventId: '',
  }
  const event = auditEvent(refund, 'PREPAID_RENT_REFUND_PROPOSED', `Prepaid rent refund proposed: ${refund.reason}`, null, input.asOf)
  refund.auditEventId = event.id
  refund.lastAuditEventId = event.id
  return {
    ok: true, refund,
    data: {
      ...data,
      prepaidRentRefunds: [...(data.prepaidRentRefunds ?? []), refund],
      auditEvents: [...data.auditEvents, { ...event, afterSnapshot: JSON.stringify(refund) }],
    },
  }
}

export function approvePrepaidRefund(data: PrototypeAppState, input: {
  refundId: string; asOf: string; reason?: string; entitlementConfirmed?: boolean
}): PrepaidRefundResult {
  const existing = (data.prepaidRentRefunds ?? []).find(refund => refund.id === input.refundId)
  if (!existing) return { ok: false, error: 'REFUND_NOT_FOUND' }
  if (existing.status !== 'PROPOSED') return { ok: false, error: 'INVALID_STATUS' }
  if (existing.entitlementReviewRequired && input.entitlementConfirmed !== true) {
    return { ok: false, error: 'ENTITLEMENT_REVIEW_REQUIRED' }
  }
  if (!isIsoDate(input.asOf) || input.asOf < existing.recordedAt) return { ok: false, error: 'INVALID_DATE' }
  const reconciliation = prepaidRentReconciliation(data, existing.tenantId, existing.moveOutDate)
  if (!reconciliation) return { ok: false, error: 'REFUND_NOT_FOUND' }
  if (reconciliation.blockers.some(blocker => blocker.startsWith('Move-out remains blocked'))) {
    return { ok: false, error: 'OUTSTANDING_BALANCE', blockers: reconciliation.blockers }
  }
  const before = { ...existing }
  const refund: PrepaidRentRefund = {
    ...existing, status: 'APPROVED', approvedAt: input.asOf, approvedBy: 'demo-admin',
    lastAuditEventId: '',
  }
  const event = auditEvent(refund, 'PREPAID_RENT_REFUND_APPROVED', input.reason?.trim() || `Prepaid rent refund approved: ${existing.reason}`, before, input.asOf)
  refund.lastAuditEventId = event.id
  return {
    ok: true, refund,
    data: {
      ...data,
      prepaidRentRefunds: (data.prepaidRentRefunds ?? []).map(item => item.id === refund.id ? refund : item),
      auditEvents: [...data.auditEvents, event],
    },
  }
}

export function completePrepaidRefund(data: PrototypeAppState, input: {
  refundId: string; refundedOn: string; asOf: string; reason?: string
}): PrepaidRefundResult {
  const existing = (data.prepaidRentRefunds ?? []).find(refund => refund.id === input.refundId)
  if (!existing) return { ok: false, error: 'REFUND_NOT_FOUND' }
  if (existing.status !== 'APPROVED') return { ok: false, error: 'INVALID_STATUS' }
  if (!isIsoDate(input.refundedOn) || !isIsoDate(input.asOf)
    || input.refundedOn < existing.moveOutDate || input.asOf < input.refundedOn) return { ok: false, error: 'INVALID_DATE' }
  const reconciliation = prepaidRentReconciliation(data, existing.tenantId, existing.moveOutDate)
  if (!reconciliation) return { ok: false, error: 'REFUND_NOT_FOUND' }
  if (reconciliation.blockers.some(blocker => blocker.startsWith('Move-out remains blocked'))) {
    return { ok: false, error: 'OUTSTANDING_BALANCE', blockers: reconciliation.blockers }
  }
  const active = existing.allocations.flatMap(allocation => {
    const current = data.paymentAllocations.find(item => item.id === allocation.paymentAllocationId
      && item.state === 'ACTIVE' && item.paymentId === allocation.paymentId && item.amountCents === allocation.amountCents)
    const payment = data.payments.find(item => item.id === allocation.paymentId && item.state === 'RECORDED')
    return current && payment ? [current] : []
  })
  if (active.length !== existing.allocations.length
    || sum(active.map(allocation => allocation.amountCents)) !== existing.amountCents) {
    return { ok: false, error: 'STALE_REFUND' }
  }
  if (existing.amountCents > reconciliation.refundableCents + existing.amountCents
    && existing.amountCents > reconciliation.totalPrepaidCents) return { ok: false, error: 'REFUND_EXCEEDS_ELIGIBLE' }
  const before = { ...existing }
  const completedAt = input.asOf
  const refundedObligations = [...new Set(existing.allocations.map(allocation => allocation.rentObligationId))]
  const futureObligations = refundedObligations.flatMap(obligationId => {
    const obligation = data.rentObligations.find(item => item.id === obligationId)
    const period = obligation ? data.rentalPeriods.find(item => item.id === obligation.rentalPeriodId) : undefined
    return obligation && period && period.startDate >= existing.moveOutDate ? [obligation] : []
  })
  const allocationAudits = active.map(allocation => ({
    id: `audit-${allocation.id}-prepaid-refund`, actorId: 'demo-admin', occurredOn: completedAt,
    action: 'ALLOCATION_REVERSED' as const, entityType: 'PAYMENT_ALLOCATION' as const, entityId: allocation.id,
    reason: `Prepaid rent refund completed: ${input.reason?.trim() || existing.reason}`,
    beforeSnapshot: JSON.stringify({ state: 'ACTIVE', amountCents: allocation.amountCents, chargeId: allocation.chargeId }),
    afterSnapshot: JSON.stringify({ state: 'REVERSED', refundId: existing.id }),
  }))
  const obligationAudits = futureObligations.map(obligation => ({
    id: `audit-${obligation.id}-prepaid-refund`, actorId: 'demo-admin', occurredOn: completedAt,
    action: 'CHARGE_CORRECTED' as const, entityType: 'RENT_OBLIGATION' as const, entityId: obligation.id,
    reason: `Future rent coverage removed by completed prepaid refund: ${input.reason?.trim() || existing.reason}`,
    beforeSnapshot: JSON.stringify({ state: obligation.state, amountCents: obligation.amountCents }),
    afterSnapshot: JSON.stringify({ state: 'VOIDED', refundId: existing.id }),
  }))
  const paymentAllocations = data.paymentAllocations.map(allocation => {
    const reversal = allocationAudits.find(audit => audit.entityId === allocation.id)
    return reversal ? { ...allocation, state: 'REVERSED' as const, reversalAuditEventId: reversal.id } : allocation
  })
  const rentObligations = data.rentObligations.map(obligation => {
    const audit = obligationAudits.find(item => item.entityId === obligation.id)
    return audit ? {
      ...obligation, state: 'VOIDED' as const,
      correction: { supersedesId: obligation.id, auditEventId: audit.id, authorizedBy: 'demo-admin' },
    } : obligation
  })
  let rentPrepayments: RentPrepayment[] = [...data.rentPrepayments]
  const affectedPaymentIds = [...new Set(active.map(allocation => allocation.paymentId))]
  for (const paymentId of affectedPaymentIds) {
    const affected = rentPrepayments.filter(prepayment => prepayment.paymentId === paymentId
      && (prepayment.state ?? 'ACTIVE') === 'ACTIVE'
      && prepayment.rentalPeriodIds.some(periodId => existing.allocations.some(allocation => allocation.rentalPeriodId === periodId)))
    for (const prepayment of affected) {
      const remainingAllocations = paymentAllocations.filter(allocation => allocation.paymentId === paymentId && allocation.state === 'ACTIVE')
      const remainingObligationIds = new Set(remainingAllocations.map(allocation => allocation.chargeId))
      const remainingPeriodIds = rentObligations
        .filter(obligation => remainingObligationIds.has(obligation.id) && obligation.state === 'ISSUED')
        .map(obligation => obligation.rentalPeriodId)
      const newId = remainingPeriodIds.length > 0 ? `${prepayment.id}-refund-${existing.id}` : null
      rentPrepayments = rentPrepayments.map(item => item.id === prepayment.id
        ? { ...item, state: 'SUPERSEDED' as const, supersededByPrepaymentId: newId } : item)
      if (newId) {
        rentPrepayments.push({
          ...prepayment, id: newId, rentalPeriodIds: remainingPeriodIds, periodCount: remainingPeriodIds.length,
          totalCents: sum(remainingAllocations.map(allocation => allocation.amountCents)),
          createdAt: completedAt, state: 'ACTIVE', supersedesPrepaymentId: prepayment.id, supersededByPrepaymentId: null,
        })
      }
    }
  }
  const refund: PrepaidRentRefund = {
    ...existing, status: 'COMPLETED', refundedOn: input.refundedOn, completedBy: 'demo-admin', lastAuditEventId: '',
  }
  const event = auditEvent(refund, 'PREPAID_RENT_REFUND_COMPLETED', input.reason?.trim() || `Prepaid rent refund completed: ${existing.reason}`, before, completedAt)
  refund.lastAuditEventId = event.id
  return {
    ok: true, refund,
    data: {
      ...data,
      prepaidRentRefunds: (data.prepaidRentRefunds ?? []).map(item => item.id === refund.id ? refund : item),
      paymentAllocations, rentObligations, rentPrepayments,
      auditEvents: [...data.auditEvents, ...allocationAudits, ...obligationAudits, event],
    },
  }
}

export function reversePrepaidRefund(data: PrototypeAppState, input: {
  refundId: string; asOf: string; reason: string
}): PrepaidRefundResult {
  const existing = (data.prepaidRentRefunds ?? []).find(refund => refund.id === input.refundId)
  if (!existing) return { ok: false, error: 'REFUND_NOT_FOUND' }
  if (existing.status !== 'COMPLETED') return { ok: false, error: 'INVALID_STATUS' }
  const reasonError = validReason(input.reason)
  if (reasonError) return { ok: false, error: reasonError }
  if (!isIsoDate(input.asOf) || input.asOf < (existing.refundedOn ?? existing.recordedAt)) return { ok: false, error: 'INVALID_DATE' }
  const allocationRows = existing.allocations.flatMap(allocation => {
    const payment = data.payments.find(item => item.id === allocation.paymentId && item.state === 'RECORDED')
    const obligation = data.rentObligations.find(item => item.id === allocation.rentObligationId)
    const previous = data.paymentAllocations.find(item => item.id === allocation.paymentAllocationId && item.state === 'REVERSED')
    if (!payment || !obligation || !previous) return []
    const otherActive = data.paymentAllocations.filter(item => item.chargeId === obligation.id && item.state === 'ACTIVE')
      .reduce((total, item) => total + item.amountCents, 0)
    if (otherActive + allocation.amountCents > obligation.amountCents) return []
    const reinstated: PaymentAllocation = {
      id: `allocation-reinstated-${existing.id}-${previous.id}`, paymentId: allocation.paymentId,
      chargeId: obligation.id, amountCents: allocation.amountCents, allocatedOn: input.asOf,
      creditId: null, state: 'ACTIVE', reversalAuditEventId: null,
    }
    return [{ reinstated, obligation }]
  })
  if (allocationRows.length !== existing.allocations.length) return { ok: false, error: 'STALE_REFUND' }
  const audits = allocationRows.flatMap(({ reinstated, obligation }) => [{
    id: `audit-reinstated-${reinstated.id}`, actorId: 'demo-admin', occurredOn: input.asOf,
    action: 'ALLOCATION_REVERSED' as const, entityType: 'PAYMENT_ALLOCATION' as const, entityId: reinstated.id,
    reason: `Prepaid rent refund reversed and allocation reinstated: ${input.reason.trim()}`,
    beforeSnapshot: JSON.stringify({ refundId: existing.id, state: 'REVERSED' }),
    afterSnapshot: JSON.stringify({ state: 'ACTIVE', amountCents: reinstated.amountCents, rentObligationId: obligation.id }),
  }])
  const reinstatedIds = new Set(allocationRows.map(row => row.obligation.id))
  const rentObligations = data.rentObligations.map(obligation =>
    reinstatedIds.has(obligation.id) ? { ...obligation, state: 'ISSUED' as const, correction: null } : obligation)
  const paymentAllocations = [...data.paymentAllocations, ...allocationRows.map(row => row.reinstated)]
  let rentPrepayments = [...data.rentPrepayments]
  for (const paymentId of [...new Set(allocationRows.map(row => row.reinstated.paymentId))]) {
    const affected = rentPrepayments.filter(prepayment => prepayment.paymentId === paymentId && (prepayment.state ?? 'ACTIVE') === 'ACTIVE')
    const active = paymentAllocations.filter(allocation => allocation.paymentId === paymentId && allocation.state === 'ACTIVE')
    const activeObligationIds = new Set(active.map(allocation => allocation.chargeId))
    const periodIds = rentObligations.filter(obligation => activeObligationIds.has(obligation.id) && obligation.state === 'ISSUED')
      .map(obligation => obligation.rentalPeriodId)
    const template = affected[0] ?? rentPrepayments.find(prepayment => prepayment.paymentId === paymentId)
    if (!template || periodIds.length === 0) continue
    const newId = `${template.id}-reinstated-${existing.id}`
    rentPrepayments = rentPrepayments.map(item => affected.some(e => e.id === item.id)
      ? { ...item, state: 'SUPERSEDED' as const, supersededByPrepaymentId: newId } : item)
    rentPrepayments.push({
      ...template, id: newId, rentalPeriodIds: periodIds, periodCount: periodIds.length,
      totalCents: sum(active.map(allocation => allocation.amountCents)), createdAt: input.asOf,
      state: 'ACTIVE', supersedesPrepaymentId: template.id, supersededByPrepaymentId: null,
    })
  }
  const before = { ...existing }
  const refund: PrepaidRentRefund = {
    ...existing, status: 'REVERSED', reversedAt: input.asOf, reversedBy: 'demo-admin',
    reversalReason: input.reason.trim(), lastAuditEventId: '',
  }
  const event = auditEvent(refund, 'PREPAID_RENT_REFUND_REVERSED', `Prepaid rent refund reversed: ${input.reason.trim()}`, before, input.asOf)
  refund.lastAuditEventId = event.id
  return {
    ok: true, refund,
    data: {
      ...data,
      prepaidRentRefunds: (data.prepaidRentRefunds ?? []).map(item => item.id === refund.id ? refund : item),
      paymentAllocations, rentObligations, rentPrepayments,
      auditEvents: [...data.auditEvents, ...audits, event],
    },
  }
}

export function prepaidRefundCashOutCents(data: PrototypeAppState): number {
  return (data.prepaidRentRefunds ?? []).filter(refund => refund.status === 'COMPLETED')
    .reduce((total, refund) => total + refund.amountCents, 0)
}

export function prepaidRefundSourceReceiptNumbers(data: PrototypeAppState, refund: PrepaidRentRefund): string[] {
  return [...new Set(refund.allocations.flatMap(allocation => {
    const receipt = allocation.receiptId ? data.receipts.find(item => item.id === allocation.receiptId) : latestPaymentReceipt(data, allocation.paymentId)
    return receipt ? [receipt.receiptNumber] : []
  }))]
}

export function prepaidRefundPeriodLabel(data: PrototypeAppState, allocation: PrepaidRentRefundAllocation): string {
  const period = data.rentalPeriods.find(item => item.id === allocation.rentalPeriodId)
  return period ? formatShortDateRange(period.startDate, period.endDateExclusive) : allocation.rentalPeriodId
}

export function prepaidRefundAmountLabel(refund: PrepaidRentRefund): string {
  return formatMoney(refund.amountCents)
}
