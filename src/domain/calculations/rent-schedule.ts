import type {
  ChargeStatus, FinancialReviewCase, FinancialReviewType, OccupancyCycle, Payment, PaymentAllocation, PrototypeAppState,
  Receipt, RentObligation, RentalPeriod,
} from '@/domain/types/models'
import { activeRoomRentRate, DEFAULT_RENT_CENTS, roomMonthlyRentCents } from './billing-rates'
import { nextReceiptNumbers } from './receipt-numbering'
import {
  anniversaryAnchor, dateParts, firstUnpaidSequence, isCivilDate, rentObligationForPeriod,
  rentDueDate, rentObligationPaidCents, rentObligationStatus, rentalPeriodBounds, rentalPeriodId, rentalPeriodsForCycle,
  rentObligationId,
} from './rental-periods'

export type RentScheduleError =
  | 'CYCLE_NOT_FOUND'
  | 'CYCLE_NOT_ACTIVE'
  | 'NOT_ANNIVERSARY'
  | 'NO_ROOM'
  | 'NO_RATE'
  | 'NO_ASSIGNMENT'
  | 'ADVANCE_UNPAID'
  | 'FIRST_RENT_REVIEW_REQUIRED'
  | 'INVALID_PERIOD_COUNT'
  | 'INVALID_PAYMENT_DATE'
  | 'PAYMENT_DATE_BEFORE_CYCLE'
  | 'DUPLICATE_PREPAYMENT'
  | 'PARTIAL_RENT'
  | 'UNPAID_PERIOD_CONFLICT'
  | 'INVALID_AMOUNT'
  | 'TRANSFER_REVIEW_REQUIRED'

export interface RentPeriodQuoteLine {
  sequence: number
  rentalPeriodId: string
  rentObligationId: string
  startDate: string
  endDateExclusive: string
  dueDate: string
  amountCents: number
  paidCents: number
  status: ChargeStatus
  coveredByAdvance: boolean
  existing: boolean
}

export interface RentPrepaymentQuote {
  cycleId: string
  roomId: string
  rateId: string
  rateCents: number
  rateLockedOn: string
  periods: RentPeriodQuoteLine[]
  totalCents: number
}

export type RentPrepaymentQuoteResult =
  | { ok: true; quote: RentPrepaymentQuote }
  | { ok: false; reason: RentScheduleError }

function cycleFor(data: PrototypeAppState, cycleId: string): OccupancyCycle | undefined {
  return data.occupancyCycles.find(cycle => cycle.id === cycleId)
}

function currentRate(data: PrototypeAppState, cycle: OccupancyCycle, asOf: string) {
  const room = data.rooms.find(item => item.id === cycle.roomId)
  if (!room) return null
  const rate = activeRoomRentRate(data, room.categoryId, asOf)
  if (!rate) return null
  return { room, rate }
}

function firstOccupancyAssignment(data: PrototypeAppState, cycle: OccupancyCycle) {
  return [...data.roomAssignments]
    .filter(assignment => assignment.roomId === cycle.roomId && assignment.startDate <= cycle.startedAt
      && (assignment.endDate === null || assignment.endDate >= cycle.startedAt))
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id))[0]
}

/**
 * Idempotently establishes the first period and obligation for an anniversary cycle.
 * Imported LEGACY_CALENDAR cycles are never converted by this helper.
 */
export function ensureFirstRentalPeriod(
  data: PrototypeAppState,
  cycle: OccupancyCycle,
  source: RentObligation['source'],
): PrototypeAppState {
  if (cycle.rentSchedule !== 'ANNIVERSARY' || !cycle.rentAnchorDate) return data
  const existing = rentalPeriodsForCycle(data, cycle.id).find(period => period.sequence === 1)
  if (existing) return data
  const room = data.rooms.find(item => item.id === cycle.roomId)
  const rate = room ? activeRoomRentRate(data, room.categoryId, cycle.rentAnchorDate) : undefined
  if (!room || !rate) return data
  const assignment = firstOccupancyAssignment(data, cycle)
  const amountCents = assignment?.agreedRentCents ?? roomMonthlyRentCents(data, room, cycle.rentAnchorDate)
  const bounds = rentalPeriodBounds(cycle.rentAnchorDate, 1)
  const periodId = rentalPeriodId(cycle.id, 1)
  const period: RentalPeriod = {
    id: periodId, occupancyCycleId: cycle.id, roomId: room.id, sequence: 1,
    startDate: bounds.startDate, endDateExclusive: bounds.endDateExclusive, dueDate: rentDueDate(bounds.startDate),
    status: 'OPEN', origin: 'ANNIVERSARY',
  }
  const obligation: RentObligation = {
    id: rentObligationId(cycle.id, 1), occupancyCycleId: cycle.id, rentalPeriodId: periodId, roomId: room.id,
    amountCents, rateId: rate.id, rateEffectiveFrom: rate.effectiveFrom, rateSnapshotCents: amountCents,
    issuedOn: cycle.startedAt, dueDate: rentDueDate(bounds.startDate), source, state: 'ISSUED', correction: null,
  }
  return {
    ...data,
    rentalPeriods: [...data.rentalPeriods, period],
    rentObligations: [...data.rentObligations, obligation],
    occupancyCycles: data.occupancyCycles.map(item => item.id === cycle.id ? { ...item, updatedAt: cycle.updatedAt } : item),
  }
}

/**
 * Materializes every regular anniversary rent period whose start date has arrived. This keeps
 * the next month visible in Bills without requiring a payment or a special user action.
 */
export function ensureRegularRentPeriodsThrough(data: PrototypeAppState, asOf: string): PrototypeAppState {
  let next = data
  for (const cycle of data.occupancyCycles) {
    if (cycle.status !== 'ACTIVE' || cycle.rentSchedule !== 'ANNIVERSARY' || !cycle.rentAnchorDate) continue
    if (next.financialReviewCases.some(review => review.occupancyCycleId === cycle.id
      && review.status === 'OPEN' && review.type === 'TRANSFER_PREPAID_RENT')) continue
    const room = next.rooms.find(item => item.id === cycle.roomId)
    if (!room) continue
    for (let sequence = 1; sequence <= 240; sequence += 1) {
      const bounds = rentalPeriodBounds(cycle.rentAnchorDate, sequence)
      if (bounds.startDate > asOf) break
      const periodId = rentalPeriodId(cycle.id, sequence)
      const hasPeriod = next.rentalPeriods.some(period => period.id === periodId)
      const hasObligation = next.rentObligations.some(obligation => obligation.rentalPeriodId === periodId)
      if (hasPeriod && hasObligation) continue
      const rate = activeRoomRentRate(next, room.categoryId, bounds.startDate)
        ?? activeRoomRentRate(next, room.categoryId, asOf)
      if (!rate) break
      if (!hasPeriod) {
        next = materializePeriod(next, cycle, sequence, rate, bounds.startDate, 'REGULAR')
      } else if (!hasObligation) {
        const period = next.rentalPeriods.find(item => item.id === periodId)!
        const obligation: RentObligation = {
          id: rentObligationId(cycle.id, sequence), occupancyCycleId: cycle.id, rentalPeriodId: periodId,
          roomId: cycle.roomId, amountCents: roomMonthlyRentCents(next, room, bounds.startDate),
          rateId: rate.id, rateEffectiveFrom: rate.effectiveFrom, rateSnapshotCents: roomMonthlyRentCents(next, room, bounds.startDate),
          issuedOn: bounds.startDate, dueDate: rentDueDate(period.startDate), source: 'REGULAR', state: 'ISSUED', correction: null,
        }
        next = { ...next, rentObligations: [...next.rentObligations, obligation] }
      }
    }
  }
  return next
}

function materializePeriod(
  data: PrototypeAppState,
  cycle: OccupancyCycle,
  sequence: number,
  rate: { id: string; effectiveFrom: string; monthlyRentCents: number },
  issuedOn: string,
  source: RentObligation['source'] = 'PREPAYMENT',
): PrototypeAppState {
  if (!cycle.rentAnchorDate) return data
  if (rentalPeriodsForCycle(data, cycle.id).some(period => period.sequence === sequence)) return data
  const bounds = rentalPeriodBounds(cycle.rentAnchorDate, sequence)
  const periodId = rentalPeriodId(cycle.id, sequence)
  const period: RentalPeriod = {
    id: periodId, occupancyCycleId: cycle.id, roomId: cycle.roomId, sequence,
    startDate: bounds.startDate, endDateExclusive: bounds.endDateExclusive, dueDate: rentDueDate(bounds.startDate),
    status: 'OPEN', origin: 'ANNIVERSARY',
  }
  const obligation: RentObligation = {
    id: rentObligationId(cycle.id, sequence), occupancyCycleId: cycle.id, rentalPeriodId: periodId, roomId: cycle.roomId,
    amountCents: rate.monthlyRentCents, rateId: rate.id, rateEffectiveFrom: rate.effectiveFrom,
    rateSnapshotCents: rate.monthlyRentCents, issuedOn, dueDate: rentDueDate(bounds.startDate),
    source, state: 'ISSUED', correction: null,
  }
  return {
    ...data,
    rentalPeriods: [...data.rentalPeriods, period],
    rentObligations: [...data.rentObligations, obligation],
  }
}

/**
 * Quotes voluntary rent prepayment using one current rate locked across every new future period.
 * The mandatory first-period advance must be settled first and is never collected again.
 */
export function quoteRentPrepayment(
  data: PrototypeAppState,
  input: { cycleId: string; periodCount: number; asOf: string },
): RentPrepaymentQuoteResult {
  const cycle = cycleFor(data, input.cycleId)
  if (!cycle) return { ok: false, reason: 'CYCLE_NOT_FOUND' }
  if (cycle.status !== 'ACTIVE') return { ok: false, reason: 'CYCLE_NOT_ACTIVE' }
  if (cycle.rentSchedule !== 'ANNIVERSARY' || !cycle.rentAnchorDate) return { ok: false, reason: 'NOT_ANNIVERSARY' }
  if (data.financialReviewCases.some(review => review.occupancyCycleId === cycle.id
    && review.status === 'OPEN' && review.type === 'TRANSFER_PREPAID_RENT')) {
    return { ok: false, reason: 'TRANSFER_REVIEW_REQUIRED' }
  }
  if (!Number.isSafeInteger(input.periodCount) || input.periodCount < 1 || input.periodCount > 120) {
    return { ok: false, reason: 'INVALID_PERIOD_COUNT' }
  }
  if (!isCivilDate(input.asOf)) return { ok: false, reason: 'INVALID_PAYMENT_DATE' }
  const current = currentRate(data, cycle, input.asOf)
  if (!current) return { ok: false, reason: current === null && !data.rooms.some(room => room.id === cycle.roomId) ? 'NO_ROOM' : 'NO_RATE' }
  let working = ensureFirstRentalPeriod(data, cycle, 'REGULAR')
  const firstPeriod = rentalPeriodsForCycle(working, cycle.id).find(period => period.sequence === 1)
  const firstObligation = firstPeriod ? rentObligationForPeriod(working, firstPeriod.id) : undefined
  if (!firstPeriod || !firstObligation) return { ok: false, reason: 'FIRST_RENT_REVIEW_REQUIRED' }

  const firstPaid = rentObligationPaidCents(working, firstObligation.id, input.asOf)
  const firstActiveAdvance = working.advanceApplications.find(application =>
    application.rentObligationId === firstObligation.id && application.state === 'ACTIVE')
  if (firstObligation.source === 'MOVE_IN_ADVANCE' && firstPaid < firstObligation.amountCents) {
    return { ok: false, reason: firstActiveAdvance ? 'FIRST_RENT_REVIEW_REQUIRED' : 'ADVANCE_UNPAID' }
  }

  let sequence = firstUnpaidSequence(working, cycle.id, input.asOf)
  if (sequence === 1 && firstObligation.source !== 'MOVE_IN_ADVANCE') sequence = 1
  const lines: RentPeriodQuoteLine[] = []
  for (let offset = 0; offset < input.periodCount; offset += 1) {
    const targetSequence = sequence + offset
    let period = rentalPeriodsForCycle(working, cycle.id).find(item => item.sequence === targetSequence)
    if (!period) {
      working = materializePeriod(working, cycle, targetSequence, current.rate, input.asOf)
      period = rentalPeriodsForCycle(working, cycle.id).find(item => item.sequence === targetSequence)!
    }
    let obligation = rentObligationForPeriod(working, period.id)
    if (!obligation) {
      working = materializePeriod(working, cycle, targetSequence, current.rate, input.asOf)
      obligation = rentObligationForPeriod(working, rentalPeriodId(cycle.id, targetSequence))!
    }
    const paidCents = rentObligationPaidCents(working, obligation.id, input.asOf)
    const status = rentObligationStatus(working, obligation, input.asOf)
    if (paidCents > 0 && paidCents < obligation.amountCents) return { ok: false, reason: 'PARTIAL_RENT' }
    if (paidCents >= obligation.amountCents) return { ok: false, reason: 'UNPAID_PERIOD_CONFLICT' }
    lines.push({
      sequence: targetSequence, rentalPeriodId: period.id, rentObligationId: obligation.id,
      startDate: period.startDate, endDateExclusive: period.endDateExclusive, dueDate: period.dueDate,
      amountCents: obligation.amountCents, paidCents, status,
      coveredByAdvance: Boolean(working.advanceApplications.some(application =>
        application.rentObligationId === obligation!.id && application.state === 'ACTIVE')),
      existing: data.rentalPeriods.some(item => item.id === period!.id),
    })
  }
  const totalCents = lines.reduce((sum, line) => sum + line.amountCents, 0)
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) return { ok: false, reason: 'INVALID_AMOUNT' }
  return {
    ok: true,
    quote: {
      cycleId: cycle.id, roomId: cycle.roomId, rateId: current.rate.id,
      rateCents: current.rate.monthlyRentCents, rateLockedOn: input.asOf, periods: lines, totalCents,
    },
  }
}

export type RentPrepaymentResult =
  | { ok: true; data: PrototypeAppState; payment: Payment; receipt: Receipt; prepaymentId: string; quote: RentPrepaymentQuote }
  | { ok: false; reason: RentScheduleError }

/** Posts one cash payment, one receipt, and one allocation per locked anniversary period. */
export function prepareRentPrepayment(
  data: PrototypeAppState,
  input: { cycleId: string; periodCount: number; paidOn: string },
): RentPrepaymentResult {
  const cycle = cycleFor(data, input.cycleId)
  if (!cycle) return { ok: false, reason: 'CYCLE_NOT_FOUND' }
  if (!isCivilDate(input.paidOn)) return { ok: false, reason: 'INVALID_PAYMENT_DATE' }
  if (input.paidOn < cycle.startedAt) return { ok: false, reason: 'PAYMENT_DATE_BEFORE_CYCLE' }
  const quoted = quoteRentPrepayment(data, { ...input, asOf: input.paidOn })
  if (!quoted.ok) return quoted
  const { quote } = quoted
  let next = data
  for (const line of quote.periods) {
    if (!line.existing) {
      next = materializePeriod(next, cycle, line.sequence, {
        id: quote.rateId, effectiveFrom: quote.rateLockedOn, monthlyRentCents: quote.rateCents,
      }, input.paidOn)
    }
  }
  const beforePeriods = next.rentalPeriods.filter(period => !data.rentalPeriods.some(existing => existing.id === period.id))
  const sequenceKey = quote.periods[0]!.sequence
  const prepaymentId = `rent-prepayment-${cycle.id}-${sequenceKey}-${quote.periods.length}`
  if (next.rentPrepayments.some(item => item.id === prepaymentId)) return { ok: false, reason: 'DUPLICATE_PREPAYMENT' }
  const paymentId = `payment-${prepaymentId}`
  const allocations: PaymentAllocation[] = quote.periods.map(line => ({
    id: `allocation-${paymentId}-${line.rentObligationId}`, paymentId, chargeId: line.rentObligationId,
    amountCents: line.amountCents, allocatedOn: input.paidOn, creditId: null, state: 'ACTIVE', reversalAuditEventId: null,
  }))
  const receipt: Receipt = {
    id: `receipt-${paymentId}`, paymentId, receiptNumber: nextReceiptNumbers(next, 1)[0]!,
    issuedOn: input.paidOn, amountCents: quote.totalCents, allocationIds: allocations.map(item => item.id),
    state: 'ISSUED', revision: 1, supersedesReceiptId: null,
  }
  const payment: Payment = {
    id: paymentId, scope: 'ROOM', tenantId: null, roomId: cycle.roomId, occupancyCycleId: cycle.id,
    amountCents: quote.totalCents, paidOn: input.paidOn, method: null, state: 'RECORDED', correction: null,
  }
  const auditEventId = `audit-${prepaymentId}`
  next = {
    ...next,
    payments: [...next.payments, payment],
    paymentAllocations: [...next.paymentAllocations, ...allocations],
    receipts: [...next.receipts, receipt],
    rentPrepayments: [...next.rentPrepayments, {
      id: prepaymentId, paymentId, occupancyCycleId: cycle.id, roomId: cycle.roomId,
      rentalPeriodIds: quote.periods.map(line => line.rentalPeriodId), periodCount: quote.periods.length,
      totalCents: quote.totalCents, rateCents: quote.rateCents, rateLockedOn: quote.rateLockedOn,
      createdAt: input.paidOn, reviewState: 'NONE',
    }],
    auditEvents: [...next.auditEvents, {
      id: auditEventId, actorId: 'landlord', occurredOn: input.paidOn, action: 'RENT_PREPAYMENT_RECORDED',
      entityType: 'RENT_PREPAYMENT', entityId: prepaymentId,
      reason: `Voluntary rent prepayment for ${quote.periods.length} anniversary period(s) in Room ${cycle.roomId}.`,
      beforeSnapshot: JSON.stringify({ rentalPeriodIds: beforePeriods.map(period => period.id) }),
      afterSnapshot: JSON.stringify({
        paymentId: payment.id, receiptNumber: receipt.receiptNumber, totalCents: quote.totalCents,
        rentalPeriodIds: quote.periods.map(line => line.rentalPeriodId), rateCents: quote.rateCents,
      }),
    }],
  }
  return { ok: true, data: next, payment, receipt, prepaymentId, quote }
}

export function openFinancialReviewCase(
  data: PrototypeAppState,
  input: {
    type: FinancialReviewType
    roomId: string
    occupancyCycleId?: string | null
    tenantId?: string | null
    rentalPeriodId?: string | null
    note: string
    asOf: string
  },
): PrototypeAppState {
  const identity = [input.type, input.rentalPeriodId ?? input.occupancyCycleId ?? input.roomId, input.tenantId ?? 'none'].join(':')
  const id = `financial-review-${identity}`
  if (data.financialReviewCases.some(review => review.id === id)) return data
  const review: FinancialReviewCase = {
    id, type: input.type, roomId: input.roomId, occupancyCycleId: input.occupancyCycleId ?? null,
    tenantId: input.tenantId ?? null, rentalPeriodId: input.rentalPeriodId ?? null,
    status: 'OPEN', note: input.note.trim().slice(0, 500), createdAt: input.asOf, resolvedAt: null,
  }
  return {
    ...data,
    financialReviewCases: [...data.financialReviewCases, review],
    auditEvents: [...data.auditEvents, {
      id: `audit-${id}`, actorId: 'landlord', occurredOn: input.asOf, action: 'FINANCIAL_REVIEW_OPENED',
      entityType: 'FINANCIAL_REVIEW_CASE', entityId: id, reason: review.note,
      beforeSnapshot: null, afterSnapshot: JSON.stringify(review),
    }],
  }
}

/** Opens transfer review when a paid/prepaid source rent period covers the transfer date. */
export function transferRentReviewNeeded(data: PrototypeAppState, sourceRoomId: string, _tenantId: string, effectiveDate: string): RentalPeriod | null {
  const active = data.occupancyCycles.find(cycle => cycle.roomId === sourceRoomId && cycle.status === 'ACTIVE')
  if (!active || active.rentSchedule !== 'ANNIVERSARY') return null
  const paidPeriod = rentalPeriodsForCycle(data, active.id).find(period => {
    if (period.startDate > effectiveDate || period.endDateExclusive <= effectiveDate) return false
    const obligation = rentObligationForPeriod(data, period.id)
    return Boolean(obligation && rentObligationPaidCents(data, obligation.id, effectiveDate) >= obligation.amountCents)
  })
  if (!paidPeriod) return null
  return paidPeriod
}

export function nextPeriodAfterTransfer(data: PrototypeAppState, cycle: OccupancyCycle, effectiveDate: string): RentalPeriod | undefined {
  const periods = rentalPeriodsForCycle(data, cycle.id)
  return periods.find(period => period.startDate > effectiveDate)
    ?? (cycle.rentAnchorDate ? (() => {
      const last = periods.at(-1)
      const sequence = last ? last.sequence + 1 : 1
      const bounds = rentalPeriodBounds(cycle.rentAnchorDate!, sequence)
      return { id: rentalPeriodId(cycle.id, sequence), sequence, ...bounds } as RentalPeriod
    })() : undefined)
}

export function currentAnniversaryRate(data: PrototypeAppState, cycleId: string, asOf: string) {
  const cycle = cycleFor(data, cycleId)
  if (!cycle) return null
  const current = currentRate(data, cycle, asOf)
  return current ? { id: current.rate.id, amountCents: current.rate.monthlyRentCents, effectiveFrom: current.rate.effectiveFrom } : null
}

export function defaultFirstRentRate(data: PrototypeAppState, cycle: OccupancyCycle, amountCents?: number) {
  const room = data.rooms.find(item => item.id === cycle.roomId)
  if (!room) return null
  const rate = activeRoomRentRate(data, room.categoryId, cycle.rentAnchorDate ?? cycle.startedAt)
  if (!rate) return null
  return {
    id: rate.id,
    effectiveFrom: rate.effectiveFrom,
    monthCents: amountCents ?? roomMonthlyRentCents(data, room, cycle.startedAt),
    fallbackCents: DEFAULT_RENT_CENTS[room.categoryId],
  }
}

export function anchorFields(startedAt: string) {
  return { ...anniversaryAnchor(startedAt), rentSchedule: 'ANNIVERSARY' as const, rentAnchorDay: dateParts(startedAt).day }
}
