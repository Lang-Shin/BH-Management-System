import type {
  Charge, MoveInObligation, OccupancyCycle, OccupancyCycle as Cycle, Payment, PrototypeAppState, Receipt, Room,
} from '@/domain/types/models'
import { activeAssignments, chargePaid } from './summary'
import { activeMoveInPolicy } from './move-in-policy'
import { nextReceiptNumbers } from './receipt-numbering'

export type MoveInSettlementStatus = 'NOT PAID' | 'PARTLY PAID' | 'PAID'

export function activeCycleForRoom(data: PrototypeAppState, roomId: string): OccupancyCycle | null {
  return data.occupancyCycles.find(cycle => cycle.roomId === roomId && cycle.status === 'ACTIVE') ?? null
}

function activeOccupantIds(data: PrototypeAppState, roomId: string, asOf: string) {
  return activeAssignments(data, asOf).filter(assignment => assignment.roomId === roomId).map(assignment => assignment.tenantId)
}

function billingPeriodFor(data: PrototypeAppState, date: string) {
  return data.billingPeriods.find(period => period.startDate <= date && period.endDate >= date)
    ?? data.billingPeriods.find(period => period.status === 'OPEN')
    ?? data.billingPeriods.at(-1)
}

export function ensureMoveInObligation(data: PrototypeAppState, cycle: OccupancyCycle, asOf: string): PrototypeAppState {
  if (data.moveInObligations.some(obligation => obligation.occupancyCycleId === cycle.id)) return data
  const room = data.rooms.find(item => item.id === cycle.roomId)
  const period = billingPeriodFor(data, cycle.startedAt)
  if (!room || !period) return data
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
    if (nextOccupants.length > 0) {
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
        cycle = {
          id: `cycle-${room.id}-${startedAt}`, roomId: room.id, startedAt, endedAt: null, status: 'ACTIVE',
          createdAt: asOf, updatedAt: asOf,
        }
        data = { ...data, occupancyCycles: [...data.occupancyCycles, cycle] }
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
  return data
}

export interface MoveInObligationView {
  obligation: MoveInObligation
  cycle: Cycle
  room: Room
  payerName: string
  advancePaidCents: number
  depositPaidCents: number
  advanceRemainingCents: number
  depositRemainingCents: number
  totalRequiredCents: number
  totalPaidCents: number
  totalRemainingCents: number
  advanceStatus: MoveInSettlementStatus
  depositStatus: MoveInSettlementStatus
  status: MoveInSettlementStatus
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
    const depositPaidCents = chargePaid(data, depositCharge.id, asOf)
    const advanceRemainingCents = Math.max(0, obligation.advanceRequiredCents - advancePaidCents)
    const depositRemainingCents = Math.max(0, obligation.depositRequiredCents - depositPaidCents)
    const totalRequiredCents = obligation.advanceRequiredCents + obligation.depositRequiredCents
    const totalPaidCents = advancePaidCents + depositPaidCents
    const totalRemainingCents = advanceRemainingCents + depositRemainingCents
    result.push({
      obligation, cycle, room, payerName: data.tenants.find(tenant => tenant.id === advanceCharge.tenantId)?.name ?? 'Unknown tenant',
      advancePaidCents, depositPaidCents, advanceRemainingCents, depositRemainingCents,
      totalRequiredCents, totalPaidCents, totalRemainingCents,
      advanceStatus: settlementStatus(obligation.advanceRequiredCents, advancePaidCents),
      depositStatus: settlementStatus(obligation.depositRequiredCents, depositPaidCents),
      status: settlementStatus(totalRequiredCents, totalPaidCents),
    })
  }
  return result.sort((a, b) => a.room.name.localeCompare(b.room.name, 'en', { numeric: true }) || a.obligation.id.localeCompare(b.obligation.id))
}

export function moveInSummary(data: PrototypeAppState, asOf: string) {
  const views = selectMoveInObligations(data, asOf)
  return {
    obligations: views.length,
    advanceCollectedCents: views.reduce((sum, view) => sum + view.advancePaidCents, 0),
    depositCollectedCents: views.reduce((sum, view) => sum + view.depositPaidCents, 0),
    outstandingCents: views.reduce((sum, view) => sum + view.totalRemainingCents, 0),
    paidObligations: views.filter(view => view.status === 'PAID').length,
  }
}

export interface MoveInAdjustmentProposal {
  previousRentCents: number
  currentRentCents: number
  advanceTopUpCents: number
  depositTopUpCents: number
  kind: 'TOP_UP' | 'REVIEW'
}

/** Read-only transfer proposal; nothing is posted until an explicit future landlord action. */
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
  return difference > 0
    ? { previousRentCents: previousObligation.agreedMonthlyRentCents, currentRentCents: currentRent, advanceTopUpCents: difference, depositTopUpCents: difference, kind: 'TOP_UP' }
    : { previousRentCents: previousObligation.agreedMonthlyRentCents, currentRentCents: currentRent, advanceTopUpCents: 0, depositTopUpCents: 0, kind: 'REVIEW' }
}

export type MoveInPaymentError = 'OBLIGATION_NOT_FOUND' | 'PAYER_NOT_OCCUPANT' | 'INVALID_AMOUNT' | 'OVERPAYMENT' | 'NO_SELECTION' | 'DUPLICATE_PAYMENT' | 'INVALID_DATE'
export type MoveInPaymentResult =
  | { ok: true; data: PrototypeAppState; payment: Payment; receipt: Receipt }
  | { ok: false; reason: MoveInPaymentError }

export function prepareMoveInPayment(data: PrototypeAppState, input: {
  obligationId: string
  payerTenantId: string
  advanceCents: number
  depositCents: number
  paidOn: string
  method: 'cash' | 'bank-transfer'
}): MoveInPaymentResult {
  const obligation = data.moveInObligations.find(item => item.id === input.obligationId)
  if (!obligation) return { ok: false, reason: 'OBLIGATION_NOT_FOUND' }
  const cycle = data.occupancyCycles.find(item => item.id === obligation.occupancyCycleId)
  if (!cycle) return { ok: false, reason: 'OBLIGATION_NOT_FOUND' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.paidOn) || input.paidOn < cycle.startedAt) return { ok: false, reason: 'INVALID_DATE' }
  const occupant = data.roomAssignments.some(assignment => assignment.tenantId === input.payerTenantId
    && assignment.roomId === obligation.roomId
    && assignment.startDate <= (cycle.endedAt ?? input.paidOn)
    && (assignment.endDate === null || assignment.endDate >= cycle.startedAt))
  if (!occupant) return { ok: false, reason: 'PAYER_NOT_OCCUPANT' }
  const advance = data.charges.find(charge => charge.id === obligation.advanceChargeId)
  const deposit = data.charges.find(charge => charge.id === obligation.depositChargeId)
  if (!advance || !deposit) return { ok: false, reason: 'OBLIGATION_NOT_FOUND' }
  const advanceRemaining = obligation.advanceRequiredCents - chargePaid(data, advance.id, input.paidOn)
  const depositRemaining = obligation.depositRequiredCents - chargePaid(data, deposit.id, input.paidOn)
  if (!Number.isSafeInteger(input.advanceCents) || !Number.isSafeInteger(input.depositCents)
    || input.advanceCents < 0 || input.depositCents < 0) return { ok: false, reason: 'INVALID_AMOUNT' }
  if (input.advanceCents === 0 && input.depositCents === 0) return { ok: false, reason: 'NO_SELECTION' }
  if (input.advanceCents > advanceRemaining || input.depositCents > depositRemaining) return { ok: false, reason: 'OVERPAYMENT' }
  const amountCents = input.advanceCents + input.depositCents
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return { ok: false, reason: 'INVALID_AMOUNT' }

  const sequence = data.payments.filter(payment => payment.id.startsWith(`payment-move-in-${obligation.id}-`)).length + 1
  const paymentId = `payment-move-in-${obligation.id}-${sequence}`
  if (data.payments.some(payment => payment.id === paymentId)) return { ok: false, reason: 'DUPLICATE_PAYMENT' }
  const allocations = [
    ...(input.advanceCents > 0 ? [{ id: `allocation-${paymentId}-${advance.id}`, paymentId, chargeId: advance.id, amountCents: input.advanceCents, allocatedOn: input.paidOn, creditId: null, state: 'ACTIVE' as const, reversalAuditEventId: null }] : []),
    ...(input.depositCents > 0 ? [{ id: `allocation-${paymentId}-${deposit.id}`, paymentId, chargeId: deposit.id, amountCents: input.depositCents, allocatedOn: input.paidOn, creditId: null, state: 'ACTIVE' as const, reversalAuditEventId: null }] : []),
  ]
  const receipt: Receipt = {
    id: `receipt-${paymentId}`, paymentId, receiptNumber: nextReceiptNumbers(data, 1)[0]!,
    issuedOn: input.paidOn, amountCents, allocationIds: allocations.map(allocation => allocation.id),
    state: 'ISSUED', revision: 1, supersedesReceiptId: null,
  }
  const payment: Payment = {
    id: paymentId, tenantId: input.payerTenantId, amountCents, paidOn: input.paidOn,
    method: input.method, state: 'RECORDED', correction: null,
  }
  const next: PrototypeAppState = {
    ...data,
    payments: [...data.payments, payment],
    paymentAllocations: [...data.paymentAllocations, ...allocations],
    receipts: [...data.receipts, receipt],
    auditEvents: [...data.auditEvents, {
      id: `audit-${paymentId}`, actorId: 'demo-admin', occurredOn: input.paidOn, action: 'MOVE_IN_PAYMENT_RECORDED' as const,
      entityType: 'PAYMENT' as const, entityId: paymentId, reason: 'Move-in advance/security deposit payment recorded.',
      beforeSnapshot: JSON.stringify({ obligationId: obligation.id, advanceRemaining, depositRemaining }),
      afterSnapshot: JSON.stringify({ paymentId, advanceCents: input.advanceCents, depositCents: input.depositCents }),
    }],
  }
  return { ok: true, data: next, payment, receipt }
}
