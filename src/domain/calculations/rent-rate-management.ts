import type { AuditEvent, PrototypeAppState, RoomCategoryId, RoomRentRate } from '@/domain/types/models'
import {
  activeRoomRentRate, eligibleRoomRentRate, nextRateEffectiveFrom, ROOM_RATE_CATEGORY_IDS,
} from './billing-rates'

export type RentRateChangeIntent = 'SCHEDULE' | 'EDIT' | 'CANCEL'
export type RentRateChangeAction = 'RENT_RATE_SCHEDULED' | 'RENT_RATE_EDITED' | 'RENT_RATE_CANCELED'
export type RentRateChangeErrorCode =
  | 'INVALID_CATEGORY'
  | 'CURRENT_RATE_MISSING'
  | 'INVALID_AMOUNT'
  | 'NO_CHANGE'
  | 'UNCHANGED_SCHEDULE'
  | 'PENDING_EXISTS'
  | 'NO_PENDING_CHANGE'
  | 'EFFECTIVE_DATE_PASSED'
  | 'STALE_CHANGE'
  | 'REASON_REQUIRED'
  | 'INVALID_EFFECTIVE_DATE'
  | 'DEPENDENCY_REVIEW_REQUIRED'

export interface RentRateChangeRequest {
  intent: RentRateChangeIntent
  categoryId: RoomCategoryId
  amountCents?: number
  reason?: string
  expectedRateId?: string
  expectedRateRevision?: number
}

export interface RentRateChangePlan {
  kind: 'SCHEDULE' | 'EDIT' | 'CANCEL'
  categoryId: RoomCategoryId
  effectiveFrom: string
  currentCents: number
  scheduledCents: number | null
  proposedCents: number | null
  roomCount: number
  reason: string
  expectedRateId: string | null
  expectedRateRevision: number | null
}

export type RentRateChangeResult =
  | { ok: true; plan: RentRateChangePlan }
  | { ok: false; code: RentRateChangeErrorCode; errors: Record<string, string> }

export type RentRateApplyResult =
  | { ok: true; data: PrototypeAppState; plan: RentRateChangePlan; rate: RoomRentRate; auditEvent: AuditEvent }
  | { ok: false; code: RentRateChangeErrorCode; errors: Record<string, string> }

function validCategory(categoryId: string): categoryId is RoomCategoryId {
  return (ROOM_RATE_CATEGORY_IDS as readonly string[]).includes(categoryId)
}

function validAmount(amountCents: number | undefined): amountCents is number {
  return typeof amountCents === 'number' && Number.isSafeInteger(amountCents) && amountCents > 0
}

export function validRentRateReason(reason: string | undefined): reason is string {
  return typeof reason === 'string' && reason.trim().length >= 3 && reason.trim().length <= 500
}

function failure(code: RentRateChangeErrorCode, general: string, field?: 'amount' | 'reason'): RentRateChangeResult {
  return { ok: false, code, errors: { general, ...(field ? { [field]: general } : {}) } }
}

function eligibleFutureRates(data: PrototypeAppState, categoryId: RoomCategoryId, asOf: string): RoomRentRate[] {
  return data.roomRentRates
    .filter(rate => rate.categoryId === categoryId && eligibleRoomRentRate(rate) && rate.effectiveFrom > asOf)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || (a.revision ?? 1) - (b.revision ?? 1))
}

function pendingRateFor(
  data: PrototypeAppState,
  categoryId: RoomCategoryId,
  asOf: string,
  expectedRateId?: string,
  expectedRateRevision?: number,
): { rate?: RoomRentRate; code?: RentRateChangeErrorCode } {
  if (expectedRateId) {
    const matched = data.roomRentRates.find(rate => rate.id === expectedRateId && rate.categoryId === categoryId)
    if (!matched || !eligibleRoomRentRate(matched)) return { code: 'STALE_CHANGE' }
    if (matched.effectiveFrom <= asOf) return { code: 'EFFECTIVE_DATE_PASSED' }
    if (expectedRateRevision !== undefined && (matched.revision ?? 1) !== expectedRateRevision) return { code: 'STALE_CHANGE' }
    return { rate: matched }
  }
  const pending = eligibleFutureRates(data, categoryId, asOf)
  if (pending.length === 0) return { code: 'NO_PENDING_CHANGE' }
  return { rate: pending[0] }
}

function defaultScheduleReason(effectiveFrom: string): string {
  return `Scheduled monthly rent rate effective ${effectiveFrom}.`
}

export function planRentRateChange(
  data: PrototypeAppState,
  request: RentRateChangeRequest,
  asOf: string,
): RentRateChangeResult {
  if (!validCategory(request.categoryId)) return failure('INVALID_CATEGORY', 'Choose a valid rental category.')
  const categoryId = request.categoryId
  const active = activeRoomRentRate(data, categoryId, asOf)
  if (!active) return failure('CURRENT_RATE_MISSING', 'The current rent rate needs review before a change can be scheduled.')
  const roomCount = data.rooms.filter(room => room.categoryId === categoryId).length
  const pending = eligibleFutureRates(data, categoryId, asOf)[0]

  if (request.intent === 'SCHEDULE') {
    if (!validAmount(request.amountCents)) return failure('INVALID_AMOUNT', 'Enter a positive monthly rent amount.', 'amount')
    if (pending) return failure('PENDING_EXISTS', 'A scheduled change already exists. Edit or cancel it instead.')
    if (request.amountCents === active.monthlyRentCents) return failure('NO_CHANGE', 'Enter a different future amount.', 'amount')
    const effectiveFrom = nextRateEffectiveFrom(data, asOf)
    if (effectiveFrom <= asOf) return failure('INVALID_EFFECTIVE_DATE', 'The next rental period could not be determined safely.')
    return {
      ok: true,
      plan: {
        kind: 'SCHEDULE', categoryId, effectiveFrom, currentCents: active.monthlyRentCents,
        scheduledCents: null, proposedCents: request.amountCents, roomCount,
        reason: validRentRateReason(request.reason) ? request.reason.trim() : defaultScheduleReason(effectiveFrom),
        expectedRateId: null, expectedRateRevision: null,
      },
    }
  }

  if (!validRentRateReason(request.reason)) {
    return failure('REASON_REQUIRED', 'Enter a reason with at least 3 characters.', 'reason')
  }
  const resolved = pendingRateFor(data, categoryId, asOf, request.expectedRateId, request.expectedRateRevision)
  if (resolved.code === 'NO_PENDING_CHANGE') return failure(resolved.code, 'There is no pending change that can be edited or canceled.')
  if (resolved.code === 'STALE_CHANGE') return failure(resolved.code, 'This scheduled change changed in another session. Refresh and review again.')
  if (resolved.code === 'EFFECTIVE_DATE_PASSED') {
    return failure(resolved.code, 'This scheduled change has already taken effect and can no longer be edited or canceled.')
  }
  const target = resolved.rate!
  if (target.effectiveFrom <= asOf) {
    return failure('EFFECTIVE_DATE_PASSED', 'This scheduled change has already taken effect and can no longer be edited or canceled.')
  }
  const dependentObligations = data.rentObligations.filter(obligation =>
    obligation.rateId === target.id && obligation.issuedOn < target.effectiveFrom)
  if (dependentObligations.length > 0) {
    return failure('DEPENDENCY_REVIEW_REQUIRED',
      'An issued rent obligation already references this pending rate. Review that financial dependency before editing or canceling the schedule.')
  }

  if (request.intent === 'CANCEL') {
    return {
      ok: true,
      plan: {
        kind: 'CANCEL', categoryId, effectiveFrom: target.effectiveFrom, currentCents: active.monthlyRentCents,
        scheduledCents: target.monthlyRentCents, proposedCents: null, roomCount, reason: request.reason.trim(),
        expectedRateId: target.id, expectedRateRevision: target.revision ?? 1,
      },
    }
  }

  if (!validAmount(request.amountCents)) return failure('INVALID_AMOUNT', 'Enter a positive monthly rent amount.', 'amount')
  if (request.amountCents === active.monthlyRentCents) {
    return {
      ok: true,
      plan: {
        kind: 'CANCEL', categoryId, effectiveFrom: target.effectiveFrom, currentCents: active.monthlyRentCents,
        scheduledCents: target.monthlyRentCents, proposedCents: null, roomCount, reason: request.reason.trim(),
        expectedRateId: target.id, expectedRateRevision: target.revision ?? 1,
      },
    }
  }
  if (request.amountCents === target.monthlyRentCents) {
    return failure('UNCHANGED_SCHEDULE', 'Enter a different scheduled rate.', 'amount')
  }
  return {
    ok: true,
    plan: {
      kind: 'EDIT', categoryId, effectiveFrom: target.effectiveFrom, currentCents: active.monthlyRentCents,
      scheduledCents: target.monthlyRentCents, proposedCents: request.amountCents, roomCount, reason: request.reason.trim(),
      expectedRateId: target.id, expectedRateRevision: target.revision ?? 1,
    },
  }
}

function nextRateRevision(data: PrototypeAppState, categoryId: RoomCategoryId, effectiveFrom: string): number {
  const revisions = data.roomRentRates
    .filter(rate => rate.categoryId === categoryId && rate.effectiveFrom === effectiveFrom)
    .map(rate => rate.revision ?? 1)
  return Math.max(0, ...revisions) + 1
}

function nextRateId(data: PrototypeAppState, categoryId: RoomCategoryId, effectiveFrom: string, revision: number): string {
  const base = `rent-rate-${categoryId}-${effectiveFrom}`
  if (revision <= 1 && !data.roomRentRates.some(rate => rate.id === base)) return base
  let candidate = revision <= 1 ? `${base}-r1` : `${base}-r${revision}`
  let suffix = revision <= 1 ? 1 : revision
  while (data.roomRentRates.some(rate => rate.id === candidate)) {
    suffix += 1
    candidate = `${base}-r${suffix}`
  }
  return candidate
}

function auditEvent(
  action: RentRateChangeAction,
  rate: RoomRentRate,
  plan: RentRateChangePlan,
  asOf: string,
  before: unknown,
  after: unknown,
): AuditEvent {
  return {
    id: `rent-rate-audit-${rate.id}-${action.toLowerCase()}-${asOf}`,
    actorId: 'landlord',
    occurredOn: asOf,
    action,
    entityType: 'RENT_RATE',
    entityId: rate.id,
    reason: plan.reason,
    beforeSnapshot: JSON.stringify(before),
    afterSnapshot: JSON.stringify(after),
  }
}

function withAudit(data: PrototypeAppState, event: AuditEvent): PrototypeAppState {
  return { ...data, auditEvents: [...data.auditEvents, event] }
}

/**
 * Applies a previously reviewed plan against the current state. The caller must build the plan
 * from the same authoritative state; the expected ID/revision guard detects stale browser data.
 */
export function applyRentRateChange(
  data: PrototypeAppState,
  request: RentRateChangeRequest,
  asOf: string,
): RentRateApplyResult {
  const planned = planRentRateChange(data, request, asOf)
  if (!planned.ok) return planned
  const plan = planned.plan
  const active = activeRoomRentRate(data, plan.categoryId, asOf)!

  if (plan.kind === 'SCHEDULE') {
    const revision = nextRateRevision(data, plan.categoryId, plan.effectiveFrom)
    const rate: RoomRentRate = {
      id: nextRateId(data, plan.categoryId, plan.effectiveFrom, revision),
      categoryId: plan.categoryId,
      monthlyRentCents: plan.proposedCents!,
      effectiveFrom: plan.effectiveFrom,
      recordedOn: asOf,
      revision,
      recordedBy: 'landlord',
      reason: plan.reason,
    }
    const event = auditEvent('RENT_RATE_SCHEDULED', rate, plan, asOf, {
      categoryId: plan.categoryId, activeRateId: active.id, activeAmountCents: active.monthlyRentCents,
    }, rate)
    return {
      ok: true, data: withAudit({ ...data, roomRentRates: [...data.roomRentRates, rate] }, event),
      plan, rate, auditEvent: event,
    }
  }

  const target = data.roomRentRates.find(rate => rate.id === plan.expectedRateId)
  if (!target || !eligibleRoomRentRate(target) || target.effectiveFrom <= asOf
    || (plan.expectedRateRevision !== null && (target.revision ?? 1) !== plan.expectedRateRevision)) {
    return { ok: false, code: 'STALE_CHANGE', errors: { general: 'This scheduled change changed in another session. Refresh and review again.' } }
  }

  if (plan.kind === 'CANCEL') {
    const canceled: RoomRentRate = {
      ...target,
      canceledOn: asOf,
      canceledBy: 'landlord',
      cancelReason: plan.reason,
    }
    const event = auditEvent('RENT_RATE_CANCELED', canceled, plan, asOf, target, canceled)
    return {
      ok: true,
      data: withAudit({
        ...data,
        roomRentRates: data.roomRentRates.map(rate => rate.id === target.id ? canceled : rate),
      }, event),
      plan, rate: canceled, auditEvent: event,
    }
  }

  const revision = nextRateRevision(data, plan.categoryId, plan.effectiveFrom)
  const replacement: RoomRentRate = {
    id: nextRateId(data, plan.categoryId, plan.effectiveFrom, revision),
    categoryId: plan.categoryId,
    monthlyRentCents: plan.proposedCents!,
    effectiveFrom: plan.effectiveFrom,
    recordedOn: asOf,
    revision,
    recordedBy: 'landlord',
    reason: plan.reason,
    supersedesRateId: target.id,
  }
  const superseded: RoomRentRate = {
    ...target,
    supersededOn: asOf,
    supersededBy: 'landlord',
    supersededReason: plan.reason,
    supersededByRateId: replacement.id,
  }
  const event = auditEvent('RENT_RATE_EDITED', replacement, plan, asOf, superseded, replacement)
  return {
    ok: true,
    data: withAudit({
      ...data,
      roomRentRates: [...data.roomRentRates.map(rate => rate.id === target.id ? superseded : rate), replacement],
    }, event),
    plan, rate: replacement, auditEvent: event,
  }
}

export function categoryPendingRate(
  data: PrototypeAppState,
  categoryId: RoomCategoryId,
  asOf: string,
): RoomRentRate | undefined {
  return eligibleFutureRates(data, categoryId, asOf)[0]
}

export function categoryRateHistory(
  data: PrototypeAppState,
  categoryId: RoomCategoryId,
): RoomRentRate[] {
  return data.roomRentRates
    .filter(rate => rate.categoryId === categoryId)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)
      || (b.revision ?? 1) - (a.revision ?? 1)
      || b.recordedOn.localeCompare(a.recordedOn))
}
