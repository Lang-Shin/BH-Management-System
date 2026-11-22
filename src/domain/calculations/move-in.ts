import type {
  AdvanceApplication, Charge, MoveInObligation, OccupancyCycle, OccupancyCycle as Cycle, Payment, PrototypeAppState, Receipt,
  RentObligation, RentalPeriod, Room,
} from '@/domain/types/models'
import { activeAssignments, chargePaid } from './summary'
import { activeMoveInPolicy } from './move-in-policy'
import { nextReceiptNumbers } from './receipt-numbering'
import { dateParts, rentObligationForPeriod, rentObligationPaidCents, rentalPeriodsForCycle } from './rental-periods'
import { ensureFirstRentalPeriod, ensureRegularRentPeriodsThrough, openFinancialReviewCase } from './rent-schedule'
import { internalTransferContext } from './internal-transfer'
import { ensureBillingPeriodForDate } from './billing-periods'

export type MoveInSettlementStatus = 'NOT PAID' | 'PARTLY PAID' | 'PAID' | 'REFUNDED'
export type MoveInCategory = 'ADVANCE' | 'SECURITY_DEPOSIT'

export function activeCycleForRoom(data: PrototypeAppState, roomId: string): OccupancyCycle | null {
  return data.occupancyCycles.find(cycle => cycle.roomId === roomId && cycle.status === 'ACTIVE') ?? null
}

function activeOccupantIds(data: PrototypeAppState, roomId: string, asOf: string) {
  return activeAssignments(data, asOf).filter(assignment => assignment.roomId === roomId).map(assignment => assignment.tenantId)
}

export function ensureMoveInObligation(data: PrototypeAppState, cycle: OccupancyCycle, asOf: string): PrototypeAppState {
  if (data.moveInObligations.some(obligation => obligation.occupancyCycleId === cycle.id)) return data
  const room = data.rooms.find(item => item.id === cycle.roomId)
  if (!room) return data
  const ensured = ensureBillingPeriodForDate(data, cycle.startedAt)
  data = ensured.data
  const period = ensured.period
  const occupants = activeAssignments(data, asOf).filter(assignment => assignment.roomId === room.id)
  const roomPayer = [...occupants].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id))[0]
  if (!roomPayer) return data
  const obligationId = `move-in-${cycle.id}`
  if (data.moveInObligations.some(obligation => obligation.id === obligationId)) return data
  const advanceChargeId = `move-in-advance-${cycle.id}`
  const depositChargeId = `move-in-deposit-${cycle.id}`
  const advanceRequiredCents = roomPayer.agreedRentCents
  const depositRequiredCents = roomPayer.agreedRentCents
  const base = {
    tenantId: roomPayer.tenantId, billingPeriodId: period.id, amountCents: advanceRequiredCents,
    issuedOn: cycle.startedAt, dueDate: cycle.startedAt, state: 'ISSUED' as const, correction: null,
  }
  const advance: Charge = {
    ...base, id: advanceChargeId, category: 'ADVANCE', description: 'One-month advance — room occupancy cycle',
    moveInObligationId: obligationId,
  }
  const deposit: Charge = {
    ...base, id: depositChargeId, amountCents: depositRequiredCents, category: 'SECURITY_DEPOSIT',
    description: 'One-month security deposit — room occupancy cycle', moveInObligationId: obligationId,
  }
  const policy = activeMoveInPolicy(data)
  const obligation: MoveInObligation = {
    id: obligationId, occupancyCycleId: cycle.id, roomId: room.id,
    agreedMonthlyRentCents: roomPayer.agreedRentCents,
    advanceRequiredCents, depositRequiredCents, advanceChargeId, depositChargeId,
    policyVersion: policy.version,
    depositDisposition: policy.depositDisposition,
    depositIncomeRecognition: policy.depositIncomeRecognition,
    createdAt: asOf, status: 'OPEN',
  }
  return {
    ...data,
    occupancyCycles: data.occupancyCycles.map(item => item.id === cycle.id ? { ...item, updatedAt: asOf } : item),
    moveInObligations: [...data.moveInObligations, obligation],
    charges: [...data.charges, advance, deposit],
  }
}

/**
 * Reconciles occupancy cycles after tenant assignment changes. New cycles get a move-in
 * obligation only when a previously vacant room is first occupied by a newly created tenant.
 * Transfers preserve existing obligations and never post uncertain top-ups automatically.
 */
export function reconcileOccupancy(
  previous: PrototypeAppState,
  next: PrototypeAppState,
  asOf: string,
  options: { createMoveInObligations: boolean },
): PrototypeAppState {
  let data = next
  for (const room of data.rooms) {
    const nextOccupants = activeOccupantIds(data, room.id, asOf)
    const previousOccupants = activeOccupantIds(previous, room.id, asOf)
    let cycle = activeCycleForRoom(data, room.id)
    let sameDayReplacement = false
    let createdCycle = false
    if (nextOccupants.length > 0) {
      const existingCycle = cycle
      const transfer = options.createMoveInObligations ? null : internalTransferContext(data, room.id, asOf)
      if (!cycle) {
        const closedToday = data.occupancyCycles
          .filter(item => item.roomId === room.id && item.status === 'CLOSED' && item.endedAt === asOf)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
        if (closedToday) {
          cycle = { ...closedToday, status: 'ACTIVE', endedAt: null, updatedAt: asOf }
          sameDayReplacement = true
          data = { ...data, occupancyCycles: data.occupancyCycles.map(item => item.id === closedToday.id ? cycle! : item) }
        }
      }
      if (!cycle) {
        const startedAt = activeAssignments(data, asOf)
          .filter(assignment => assignment.roomId === room.id)
          .map(assignment => assignment.startDate)
          .sort()[0] ?? asOf
        const rentAnchorDate = transfer?.nextRentStart ?? startedAt
        const anchorDay = dateParts(rentAnchorDate).day
        cycle = {
          id: `cycle-${room.id}-${startedAt}`, roomId: room.id, startedAt, endedAt: null, status: 'ACTIVE',
          rentSchedule: 'ANNIVERSARY', rentAnchorDate, rentAnchorDay: anchorDay,
          cycleOrigin: options.createMoveInObligations ? 'NEW_MOVE_IN' : 'TRANSFER',
          createdAt: asOf, updatedAt: asOf,
        }
        createdCycle = true
        data = { ...data, occupancyCycles: [...data.occupancyCycles, cycle] }
      }
      if (transfer) {
        if (cycle.rentSchedule === 'ANNIVERSARY' && !transfer.sourcePrepaidPeriodStartingAtNextRent) {
          data = ensureFirstRentalPeriod(data, cycle, options.createMoveInObligations ? 'MOVE_IN_ADVANCE' : 'REGULAR')
        }
        if (transfer.sourcePrepaidPeriodStartingAtNextRent) {
          data = openFinancialReviewCase(data, {
            type: 'TRANSFER_PREPAID_RENT', roomId: room.id, occupancyCycleId: cycle.id,
            tenantId: transfer.tenantId, rentalPeriodId: transfer.sourcePrepaidPeriodStartingAtNextRent.id, asOf,
            note: `Source rent is prepaid for the period starting ${transfer.sourcePrepaidPeriodStartingAtNextRent.startDate}. The destination rate starts with the next applicable period; no automatic charge or reallocation was posted.`,
          })
        } else if (createdCycle && cycle.rentSchedule === 'ANNIVERSARY') {
          data = ensureFirstRentalPeriod(data, cycle, 'REGULAR')
        }
        if (existingCycle && (transfer.sourceHasPaidOrPrepaidCoverage
          || (existingCycle.rentSchedule === 'ANNIVERSARY' && transfer.sourceCycle?.rentAnchorDate
            && existingCycle.rentAnchorDate !== transfer.sourceCycle.rentAnchorDate))) {
          const destinationPeriod = rentalPeriodsForCycle(data, existingCycle.id)
            .find(period => period.startDate <= transfer.transferDate && period.endDateExclusive > transfer.transferDate)
          data = openFinancialReviewCase(data, {
            type: 'TRANSFER_RENT_DIFFERENCE', roomId: room.id, occupancyCycleId: existingCycle.id,
            tenantId: transfer.tenantId, rentalPeriodId: destinationPeriod?.id ?? null, asOf,
            note: `Destination room already has an occupancy rent schedule for ${transfer.transferDate}; source and destination anniversaries or paid coverage differ. No mid-period charge, refund, or reallocation was posted.`,
          })
        }
      } else if (cycle.rentSchedule === 'ANNIVERSARY') {
        data = ensureFirstRentalPeriod(data, cycle, options.createMoveInObligations ? 'MOVE_IN_ADVANCE' : 'REGULAR')
      }
      if (options.createMoveInObligations && previousOccupants.length === 0 && !sameDayReplacement) {
        data = ensureMoveInObligation(data, cycle, asOf)
      }
    } else if (cycle) {
      data = {
        ...data,
        occupancyCycles: data.occupancyCycles.map(item => item.id === cycle!.id
          ? { ...item, endedAt: asOf, status: 'CLOSED' as const, updatedAt: asOf }
          : item),
      }
    }
  }
  return ensureRegularRentPeriodsThrough(data, asOf)
}

/** Repairs newly created active cycles that missed their move-in obligation; legacy cycles are untouched. */
export function repairNewCycleMoveInObligations(data: PrototypeAppState, asOf: string, createdAfter: string): PrototypeAppState {
  let next = data
  for (const cycle of data.occupancyCycles) {
    if (cycle.status !== 'ACTIVE' || cycle.createdAt <= createdAfter) continue
    if (next.moveInObligations.some(obligation => obligation.occupancyCycleId === cycle.id)) continue
    const occupantIds = new Set(activeOccupantIds(next, cycle.roomId, asOf))
    if (occupantIds.size === 0) continue
    const hasPriorMoveIn = next.moveInObligations.some(obligation => {
      const advance = next.charges.find(charge => charge.id === obligation.advanceChargeId)
      return Boolean(advance && 'tenantId' in advance && occupantIds.has(advance.tenantId))
    })
    if (hasPriorMoveIn) continue
    next = ensureMoveInObligation(next, cycle, asOf)
    next = ensureFirstRentalPeriod(next, cycle, 'MOVE_IN_ADVANCE')
  }
  return next
}

export interface MoveInObligationView {
  obligation: MoveInObligation
  cycle: Cycle
  room: Room
  payerName: string
  advancePaidCents: number
  advanceRefundedCents: number
  advanceNetCents: number
  depositPaidCents: number
  advanceRemainingCents: number
  depositRemainingCents: number
  totalRequiredCents: number
  totalPaidCents: number
  totalRemainingCents: number
  advanceStatus: MoveInSettlementStatus
  depositStatus: MoveInSettlementStatus
  status: MoveInSettlementStatus
  firstRentalPeriod: RentalPeriod | null
  firstRentObligation: RentObligation | null
  firstRentPaidCents: number
  firstRentStatus: MoveInSettlementStatus
  advanceApplication: AdvanceApplication | null
}

function settlementStatus(required: number, paid: number): MoveInSettlementStatus {
  return paid >= required ? 'PAID' : paid > 0 ? 'PARTLY PAID' : 'NOT PAID'
}

export function selectMoveInObligations(data: PrototypeAppState, asOf: string, roomId?: string): MoveInObligationView[] {
  const result: MoveInObligationView[] = []
  for (const obligation of data.moveInObligations) {
    if (roomId && obligation.roomId !== roomId) continue
    const cycle = data.occupancyCycles.find(item => item.id === obligation.occupancyCycleId)
    const room = data.rooms.find(item => item.id === obligation.roomId)
    const advanceCharge = data.charges.find(item => item.id === obligation.advanceChargeId)
    const depositCharge = data.charges.find(item => item.id === obligation.depositChargeId)
    if (!cycle || !room || !advanceCharge || !depositCharge) continue
    const advancePaidCents = chargePaid(data, advanceCharge.id, asOf)
    const advanceRefundedCents = data.advanceRefunds.filter(refund => refund.advanceChargeId === advanceCharge.id).reduce((sum, refund) => sum + refund.amountCents, 0)
    const depositPaidCents = chargePaid(data, depositCharge.id, asOf)
    const advanceRemainingCents = advanceRefundedCents >= obligation.advanceRequiredCents ? 0 : Math.max(0, obligation.advanceRequiredCents - advancePaidCents)
    const depositRemainingCents = Math.max(0, obligation.depositRequiredCents - depositPaidCents)
    const totalRequiredCents = obligation.advanceRequiredCents + obligation.depositRequiredCents
    const totalPaidCents = advancePaidCents + depositPaidCents
    const totalRemainingCents = advanceRemainingCents + depositRemainingCents
    const firstRentalPeriod = rentalPeriodsForCycle(data, cycle.id).find(period => period.sequence === 1) ?? null
    const firstRentObligation = firstRentalPeriod ? rentObligationForPeriod(data, firstRentalPeriod.id) ?? null : null
    const firstRentPaidCents = firstRentObligation ? rentObligationPaidCents(data, firstRentObligation.id, asOf) : 0
    const advanceApplication = data.advanceApplications.find(application =>
      application.occupancyCycleId === cycle.id && application.state === 'ACTIVE') ?? null
    result.push({
      obligation, cycle, room, payerName: data.tenants.find(tenant => tenant.id === advanceCharge.tenantId)?.name ?? 'Unknown tenant',
      advancePaidCents, advanceRefundedCents, advanceNetCents: Math.max(0, advancePaidCents - advanceRefundedCents), depositPaidCents, advanceRemainingCents, depositRemainingCents,
      totalRequiredCents, totalPaidCents, totalRemainingCents,
      advanceStatus: advanceRefundedCents >= obligation.advanceRequiredCents ? 'REFUNDED' : settlementStatus(obligation.advanceRequiredCents, advancePaidCents),
      depositStatus: settlementStatus(obligation.depositRequiredCents, depositPaidCents),
      status: totalRemainingCents === 0 ? 'PAID' : settlementStatus(totalRequiredCents, totalPaidCents),
      firstRentalPeriod, firstRentObligation, firstRentPaidCents,
      firstRentStatus: firstRentObligation ? settlementStatus(firstRentObligation.amountCents, firstRentPaidCents) : 'NOT PAID',
      advanceApplication,
    })
  }
  return result.sort((a, b) => a.room.name.localeCompare(b.room.name, 'en', { numeric: true }) || a.obligation.id.localeCompare(b.obligation.id))
}

export function moveInSummary(data: PrototypeAppState, asOf: string) {
  const views = selectMoveInObligations(data, asOf)
  return {
    obligations: views.length,
    advanceCollectedCents: views.reduce((sum, view) => sum + view.advanceNetCents, 0),
    depositCollectedCents: views.reduce((sum, view) => sum + view.depositPaidCents, 0),
    outstandingCents: views.reduce((sum, view) => sum + view.totalRemainingCents, 0),
    paidObligations: views.filter(view => view.status === 'PAID').length,
  }
}

export interface MoveInAdjustmentProposal {
  previousRentCents: number
  currentRentCents: number
  advanceTopUpCents: 0
  depositTopUpCents: 0
  kind: 'REVIEW'
}

/**
 * Read-only transfer review. Existing advances are already consumed by their first rental period,
 * and the original deposit does not change when the destination room costs more.
 */
export function proposedMoveInAdjustment(data: PrototypeAppState, room: Room, cycle: Cycle): MoveInAdjustmentProposal | null {
  const occupantIds = new Set(data.roomAssignments
    .filter(assignment => assignment.roomId === room.id && assignment.endDate === null)
    .map(assignment => assignment.tenantId))
  if (occupantIds.size === 0) return null
  const existingObligation = data.moveInObligations.find(obligation => obligation.occupancyCycleId === cycle.id)
  const currentRent = existingObligation?.agreedMonthlyRentCents ?? data.roomRentRates
    .filter(rate => rate.categoryId === room.categoryId && rate.effectiveFrom <= cycle.startedAt)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]?.monthlyRentCents
  if (!currentRent) return null
  const previousObligation = data.moveInObligations.find(obligation => obligation.roomId !== room.id
    && data.charges.some(charge => charge.id === obligation.advanceChargeId && occupantIds.has(charge.tenantId)))
  if (!previousObligation) return null
  const difference = currentRent - previousObligation.agreedMonthlyRentCents
  if (difference === 0) return null
  return {
    previousRentCents: previousObligation.agreedMonthlyRentCents,
    currentRentCents: currentRent,
    advanceTopUpCents: 0,
    depositTopUpCents: 0,
    kind: 'REVIEW',
  }
}

export type MoveInPaymentError = 'OBLIGATION_NOT_FOUND' | 'INVALID_AMOUNT' | 'PARTIAL_CATEGORY' | 'ALREADY_PAID' | 'NO_SELECTION' | 'DUPLICATE_PAYMENT' | 'INVALID_DATE'
export type MoveInPaymentResult =
  | { ok: true; data: PrototypeAppState; payment: Payment; receipt: Receipt }
  | { ok: false; reason: MoveInPaymentError }

/**
 * Room-level move-in collection. A selected category is always collected in full; advance and
 * deposit may be collected separately on different dates. Legacy cents arguments remain readable
 * for callers, but partial amounts are rejected.
 */
export function prepareMoveInPayment(data: PrototypeAppState, input: {
  obligationId: string
  paidOn: string
  categories?: MoveInCategory[]
  advanceCents?: number
  depositCents?: number
  /** Legacy caller metadata; new room-level payments never store a tenant payer or method. */
  payerTenantId?: string
  method?: 'cash' | 'bank-transfer'
}): MoveInPaymentResult {
  const obligation = data.moveInObligations.find(item => item.id === input.obligationId)
  if (!obligation) return { ok: false, reason: 'OBLIGATION_NOT_FOUND' }
  const cycle = data.occupancyCycles.find(item => item.id === obligation.occupancyCycleId)
  if (!cycle) return { ok: false, reason: 'OBLIGATION_NOT_FOUND' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.paidOn) || input.paidOn < cycle.startedAt) return { ok: false, reason: 'INVALID_DATE' }
  const advance = data.charges.find(charge => charge.id === obligation.advanceChargeId)
  const deposit = data.charges.find(charge => charge.id === obligation.depositChargeId)
  if (!advance || !deposit) return { ok: false, reason: 'OBLIGATION_NOT_FOUND' }
  const advanceRemaining = Math.max(0, obligation.advanceRequiredCents - chargePaid(data, advance.id, input.paidOn))
  const depositRemaining = Math.max(0, obligation.depositRequiredCents - chargePaid(data, deposit.id, input.paidOn))

  let selected: MoveInCategory[]
  if (input.categories) {
    selected = [...new Set(input.categories)]
    if (selected.some(category => category !== 'ADVANCE' && category !== 'SECURITY_DEPOSIT')) return { ok: false, reason: 'INVALID_AMOUNT' }
  } else {
    const advanceCents = input.advanceCents ?? 0
    const depositCents = input.depositCents ?? 0
    if (!Number.isSafeInteger(advanceCents) || !Number.isSafeInteger(depositCents) || advanceCents < 0 || depositCents < 0) {
      return { ok: false, reason: 'INVALID_AMOUNT' }
    }
    if ((advanceCents > 0 && advanceCents !== advanceRemaining) || (depositCents > 0 && depositCents !== depositRemaining)) {
      return { ok: false, reason: 'PARTIAL_CATEGORY' }
    }
    selected = [
      ...(advanceCents > 0 ? ['ADVANCE' as const] : []),
      ...(depositCents > 0 ? ['SECURITY_DEPOSIT' as const] : []),
    ]
  }
  if (selected.length === 0) return { ok: false, reason: 'NO_SELECTION' }
  if (selected.includes('ADVANCE') && advanceRemaining === 0
    || selected.includes('SECURITY_DEPOSIT') && depositRemaining === 0) return { ok: false, reason: 'ALREADY_PAID' }
  const advanceCents = selected.includes('ADVANCE') ? advanceRemaining : 0
  const depositCents = selected.includes('SECURITY_DEPOSIT') ? depositRemaining : 0
  const amountCents = advanceCents + depositCents
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return { ok: false, reason: 'INVALID_AMOUNT' }

  const sequence = data.payments.filter(payment => payment.id.startsWith(`payment-move-in-${obligation.id}-`)).length + 1
  const paymentId = `payment-move-in-${obligation.id}-${sequence}`
  if (data.payments.some(payment => payment.id === paymentId)) return { ok: false, reason: 'DUPLICATE_PAYMENT' }
  const allocations = [
    ...(advanceCents > 0 ? [{ id: `allocation-${paymentId}-${advance.id}`, paymentId, chargeId: advance.id, amountCents: advanceCents, allocatedOn: input.paidOn, creditId: null, state: 'ACTIVE' as const, reversalAuditEventId: null }] : []),
    ...(depositCents > 0 ? [{ id: `allocation-${paymentId}-${deposit.id}`, paymentId, chargeId: deposit.id, amountCents: depositCents, allocatedOn: input.paidOn, creditId: null, state: 'ACTIVE' as const, reversalAuditEventId: null }] : []),
  ]
  const receipt: Receipt = {
    id: `receipt-${paymentId}`, paymentId, receiptNumber: nextReceiptNumbers(data, 1)[0]!,
    issuedOn: input.paidOn, amountCents, allocationIds: allocations.map(allocation => allocation.id),
    state: 'ISSUED', revision: 1, supersedesReceiptId: null,
  }
  const payment: Payment = {
    id: paymentId, scope: 'ROOM', tenantId: null, roomId: obligation.roomId, occupancyCycleId: obligation.occupancyCycleId,
    amountCents, paidOn: input.paidOn, method: null, state: 'RECORDED', correction: null,
  }
  let next: PrototypeAppState = {
    ...data,
    payments: [...data.payments, payment],
    paymentAllocations: [...data.paymentAllocations, ...allocations],
    receipts: [...data.receipts, receipt],
    auditEvents: [...data.auditEvents, {
      id: `audit-${paymentId}`, actorId: 'demo-admin', occurredOn: input.paidOn, action: 'MOVE_IN_PAYMENT_RECORDED' as const,
      entityType: 'PAYMENT' as const, entityId: paymentId, reason: `Room-level move-in payment recorded for Room ${data.rooms.find(room => room.id === obligation.roomId)?.name ?? obligation.roomId}.`,
      beforeSnapshot: JSON.stringify({ obligationId: obligation.id, advanceRemaining, depositRemaining }),
      afterSnapshot: JSON.stringify({ paymentId, roomId: obligation.roomId, occupancyCycleId: obligation.occupancyCycleId, advanceCents, depositCents }),
    }],
  }

  if (advanceCents > 0) {
    next = ensureFirstRentalPeriod(next, cycle, 'MOVE_IN_ADVANCE')
    const firstPeriod = rentalPeriodsForCycle(next, cycle.id).find(period => period.sequence === 1)
    const firstRent = firstPeriod ? rentObligationForPeriod(next, firstPeriod.id) : undefined
    if (firstRent && !next.advanceApplications.some(application => application.advanceChargeId === advance.id && application.state === 'ACTIVE')) {
      const firstRentPaidCents = rentObligationPaidCents(next, firstRent.id, input.paidOn)
      if (firstRent.amountCents === advanceCents && firstRentPaidCents === 0) {
        const applicationId = `advance-application-${cycle.id}`
        const application: AdvanceApplication = {
          id: applicationId, occupancyCycleId: cycle.id, roomId: obligation.roomId,
          advanceChargeId: advance.id, sourcePaymentId: paymentId, rentObligationId: firstRent.id,
          amountCents: advanceCents, appliedOn: input.paidOn, state: 'ACTIVE', reversalAuditEventId: null,
        }
        next = {
          ...next,
          advanceApplications: [...next.advanceApplications, application],
          auditEvents: [...next.auditEvents, {
            id: `audit-${applicationId}`, actorId: 'demo-admin', occurredOn: input.paidOn, action: 'ADVANCE_APPLIED',
            entityType: 'ADVANCE_APPLICATION', entityId: applicationId,
            reason: `Mandatory advance settled the first anniversary rent period for Room ${data.rooms.find(room => room.id === obligation.roomId)?.name ?? obligation.roomId}.`,
            beforeSnapshot: JSON.stringify({ advanceChargeId: advance.id, firstRentPaidCents }),
            afterSnapshot: JSON.stringify(application),
          }],
        }
      } else if (firstRentPaidCents > 0 || firstRent.amountCents !== advanceCents) {
        next = openFinancialReviewCase(next, {
          type: 'ADVANCE_APPLICATION_REVIEW', roomId: obligation.roomId, occupancyCycleId: cycle.id,
          tenantId: advance.tenantId, rentalPeriodId: firstPeriod!.id, asOf: input.paidOn,
          note: 'The paid advance and first anniversary rent differ or that rent already has payment. No duplicate application was posted.',
        })
      }
    }
  }
  return { ok: true, data: next, payment, receipt }
}
