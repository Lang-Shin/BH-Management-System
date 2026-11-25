import type { AuditEvent, ElectricityRate, PrototypeAppState, UtilityRate, UtilityRateKind } from '@/domain/types/models'
import {
  eligibleUtilityRate, nextRateEffectiveFrom,
} from './billing-rates'

export type UtilityRateChangeIntent = 'SCHEDULE' | 'EDIT' | 'CANCEL'
export type UtilityRateChangeAction = 'UTILITY_RATE_SCHEDULED' | 'UTILITY_RATE_EDITED' | 'UTILITY_RATE_CANCELED'
export type UtilityRateChangeErrorCode =
  | 'INVALID_RATE_KIND'
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

export interface UtilityRateChangeRequest {
  intent: UtilityRateChangeIntent
  rateKind: UtilityRateKind
  amountCents?: number
  reason?: string
  expectedRateId?: string
  expectedRateRevision?: number
}

export interface UtilityRateChangePlan {
  rateKind: UtilityRateKind
  changeKind: 'SCHEDULE' | 'EDIT' | 'CANCEL'
  effectiveFrom: string
  currentCents: number
  scheduledCents: number | null
  proposedCents: number | null
  reason: string
  expectedRateId: string | null
  expectedRateRevision: number | null
}

export type UtilityRateChangeResult =
  | { ok: true; plan: UtilityRateChangePlan }
  | { ok: false; code: UtilityRateChangeErrorCode; errors: Record<string, string> }

export type UtilityRateApplyResult =
  | { ok: true; data: PrototypeAppState; plan: UtilityRateChangePlan; rate: ElectricityRate | UtilityRate; auditEvent: AuditEvent }
  | { ok: false; code: UtilityRateChangeErrorCode; errors: Record<string, string> }

type AnyUtilityRate = ElectricityRate | UtilityRate

const UTILITY_KINDS: UtilityRateKind[] = ['ELECTRICITY', 'WATER', 'WASHING_MACHINE']

export function utilityRateLabel(rateKind: UtilityRateKind): string {
  return rateKind === 'ELECTRICITY' ? 'Electricity' : rateKind === 'WATER' ? 'Water' : 'Washing machine'
}

export function utilityRateUnit(rateKind: UtilityRateKind): string {
  return rateKind === 'ELECTRICITY' ? 'per kWh'
    : rateKind === 'WATER' ? 'per tenant per billing period'
      : 'per subscribed room per billing period'
}

export function utilityRateCents(rate: AnyUtilityRate): number {
  return 'rateCentsPerKwh' in rate ? rate.rateCentsPerKwh : rate.rateCents
}

function validRateKind(value: string): value is UtilityRateKind {
  return (UTILITY_KINDS as string[]).includes(value)
}

function validAmount(amountCents: number | undefined): amountCents is number {
  return typeof amountCents === 'number' && Number.isSafeInteger(amountCents) && amountCents > 0
}

function validReason(reason: string | undefined): reason is string {
  return typeof reason === 'string' && reason.trim().length >= 3 && reason.trim().length <= 500
}

function failure(code: UtilityRateChangeErrorCode, general: string, field?: 'amount' | 'reason'): UtilityRateChangeResult {
  return { ok: false, code, errors: { general, ...(field ? { [field]: general } : {}) } }
}

function recordsFor(data: PrototypeAppState, rateKind: UtilityRateKind): AnyUtilityRate[] {
  return rateKind === 'ELECTRICITY' ? data.electricityRates
    : rateKind === 'WATER' ? data.waterRates : data.washingRates
}

function withRecords(data: PrototypeAppState, rateKind: UtilityRateKind, records: AnyUtilityRate[]): PrototypeAppState {
  if (rateKind === 'ELECTRICITY') return { ...data, electricityRates: records as ElectricityRate[] }
  if (rateKind === 'WATER') return { ...data, waterRates: records as UtilityRate[] }
  return { ...data, washingRates: records as UtilityRate[] }
}

function activeRate(data: PrototypeAppState, rateKind: UtilityRateKind, asOf: string): AnyUtilityRate | undefined {
  return [...recordsFor(data, rateKind)]
    .filter(rate => eligibleUtilityRate(rate) && rate.effectiveFrom <= asOf)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]
}

function eligibleFutureRates(data: PrototypeAppState, rateKind: UtilityRateKind, asOf: string): AnyUtilityRate[] {
  return recordsFor(data, rateKind)
    .filter(rate => eligibleUtilityRate(rate) && rate.effectiveFrom > asOf)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || (a.revision ?? 1) - (b.revision ?? 1))
}

function pendingRateFor(
  data: PrototypeAppState,
  rateKind: UtilityRateKind,
  asOf: string,
  expectedRateId?: string,
  expectedRateRevision?: number,
): { rate?: AnyUtilityRate; code?: UtilityRateChangeErrorCode } {
  if (expectedRateId) {
    const matched = recordsFor(data, rateKind).find(rate => rate.id === expectedRateId)
    if (!matched || !eligibleUtilityRate(matched)) return { code: 'STALE_CHANGE' }
    if (matched.effectiveFrom <= asOf) return { code: 'EFFECTIVE_DATE_PASSED' }
    if (expectedRateRevision !== undefined && (matched.revision ?? 1) !== expectedRateRevision) return { code: 'STALE_CHANGE' }
    return { rate: matched }
  }
  const pending = eligibleFutureRates(data, rateKind, asOf)
  if (pending.length === 0) return { code: 'NO_PENDING_CHANGE' }
  return { rate: pending[0] }
}

function defaultScheduleReason(rateKind: UtilityRateKind, effectiveFrom: string): string {
  return `Scheduled ${utilityRateLabel(rateKind).toLowerCase()} rate effective ${effectiveFrom}.`
}

export function planUtilityRateChange(
  data: PrototypeAppState,
  request: UtilityRateChangeRequest,
  asOf: string,
): UtilityRateChangeResult {
  if (!validRateKind(request.rateKind)) return failure('INVALID_RATE_KIND', 'Choose a valid utility rate.')
  const rateKind = request.rateKind
  const active = activeRate(data, rateKind, asOf)
  if (!active) return failure('CURRENT_RATE_MISSING', 'The current rate configuration needs review before a change can be scheduled.')
  const currentCents = utilityRateCents(active)
  const pending = eligibleFutureRates(data, rateKind, asOf)[0]

  if (request.intent === 'SCHEDULE') {
    if (!validAmount(request.amountCents)) return failure('INVALID_AMOUNT', 'Enter a positive rate amount.', 'amount')
    if (pending) return failure('PENDING_EXISTS', 'A scheduled change already exists. Edit or cancel it instead.')
    if (request.amountCents === currentCents) return failure('NO_CHANGE', 'Enter a different future amount.', 'amount')
    const effectiveFrom = nextRateEffectiveFrom(data, asOf)
    if (effectiveFrom <= asOf) return failure('INVALID_EFFECTIVE_DATE', 'The next billing period could not be determined safely.')
    return {
      ok: true,
      plan: {
        rateKind, changeKind: 'SCHEDULE', effectiveFrom, currentCents, scheduledCents: null,
        proposedCents: request.amountCents,
        reason: validReason(request.reason) ? request.reason.trim() : defaultScheduleReason(rateKind, effectiveFrom),
        expectedRateId: null, expectedRateRevision: null,
      },
    }
  }

  if (!validReason(request.reason)) return failure('REASON_REQUIRED', 'Enter a reason with at least 3 characters.', 'reason')
  const resolved = pendingRateFor(data, rateKind, asOf, request.expectedRateId, request.expectedRateRevision)
  if (resolved.code === 'NO_PENDING_CHANGE') return failure(resolved.code, 'There is no pending change that can be edited or canceled.')
  if (resolved.code === 'STALE_CHANGE') return failure(resolved.code, 'This scheduled change changed in another session. Refresh and review again.')
  if (resolved.code === 'EFFECTIVE_DATE_PASSED') {
    return failure(resolved.code, 'This scheduled change has already taken effect and can no longer be edited or canceled.')
  }
  const target = resolved.rate!
  if (target.effectiveFrom <= asOf) {
    return failure('EFFECTIVE_DATE_PASSED', 'This scheduled change has already taken effect and can no longer be edited or canceled.')
  }
  if (rateKind === 'ELECTRICITY' && data.charges.some(charge => charge.category === 'ELECTRICITY'
    && charge.electricity.rateId === target.id && charge.issuedOn < target.effectiveFrom)) {
    return failure('DEPENDENCY_REVIEW_REQUIRED',
      'An issued electricity charge already references this pending rate. Review that financial dependency before editing or canceling the schedule.')
  }

  if (request.intent === 'CANCEL') {
    return {
      ok: true,
      plan: {
        rateKind, changeKind: 'CANCEL', effectiveFrom: target.effectiveFrom, currentCents,
        scheduledCents: utilityRateCents(target), proposedCents: null, reason: request.reason.trim(),
        expectedRateId: target.id, expectedRateRevision: target.revision ?? 1,
      },
    }
  }

  if (!validAmount(request.amountCents)) return failure('INVALID_AMOUNT', 'Enter a positive rate amount.', 'amount')
  if (request.amountCents === currentCents) {
    return {
      ok: true,
      plan: {
        rateKind, changeKind: 'CANCEL', effectiveFrom: target.effectiveFrom, currentCents,
        scheduledCents: utilityRateCents(target), proposedCents: null, reason: request.reason.trim(),
        expectedRateId: target.id, expectedRateRevision: target.revision ?? 1,
      },
    }
  }
  if (request.amountCents === utilityRateCents(target)) {
    return failure('UNCHANGED_SCHEDULE', 'Enter a different scheduled rate.', 'amount')
  }
  return {
    ok: true,
    plan: {
      rateKind, changeKind: 'EDIT', effectiveFrom: target.effectiveFrom, currentCents,
      scheduledCents: utilityRateCents(target), proposedCents: request.amountCents,
      reason: request.reason.trim(), expectedRateId: target.id, expectedRateRevision: target.revision ?? 1,
    },
  }
}

function nextRevision(data: PrototypeAppState, rateKind: UtilityRateKind, effectiveFrom: string): number {
  return Math.max(0, ...recordsFor(data, rateKind)
    .filter(rate => rate.effectiveFrom === effectiveFrom)
    .map(rate => rate.revision ?? 1)) + 1
}

function nextRateId(data: PrototypeAppState, rateKind: UtilityRateKind, effectiveFrom: string, revision: number): string {
  const prefix = rateKind === 'ELECTRICITY' ? 'electricity-rate' : rateKind === 'WATER' ? 'water-rate' : 'washing-rate'
  const base = `${prefix}-${effectiveFrom}`
  if (revision <= 1 && !recordsFor(data, rateKind).some(rate => rate.id === base)) return base
  let suffix = revision <= 1 ? 1 : revision
  let candidate = `${base}-r${suffix}`
  while (recordsFor(data, rateKind).some(rate => rate.id === candidate)) {
    suffix += 1
    candidate = `${base}-r${suffix}`
  }
  return candidate
}

function createRate(
  rateKind: UtilityRateKind,
  id: string,
  cents: number,
  effectiveFrom: string,
  asOf: string,
  revision: number,
  reason: string,
  supersedesRateId?: string,
): AnyUtilityRate {
  const lifecycle = {
    revision, recordedOn: asOf, recordedBy: 'landlord', reason,
    ...(supersedesRateId ? { supersedesRateId } : {}),
  }
  return rateKind === 'ELECTRICITY'
    ? { id, rateCentsPerKwh: cents, effectiveFrom, label: `Rate effective ${effectiveFrom}`, ...lifecycle }
    : { id, rateCents: cents, effectiveFrom, ...lifecycle }
}

function auditEvent(
  action: UtilityRateChangeAction,
  rate: AnyUtilityRate,
  plan: UtilityRateChangePlan,
  asOf: string,
  before: unknown,
  after: unknown,
): AuditEvent {
  return {
    id: `utility-rate-audit-${rate.id}-${action.toLowerCase()}-${asOf}`,
    actorId: 'landlord',
    occurredOn: asOf,
    action,
    entityType: 'UTILITY_RATE',
    entityId: rate.id,
    reason: plan.reason,
    beforeSnapshot: JSON.stringify({ rateKind: plan.rateKind, before }),
    afterSnapshot: JSON.stringify({ rateKind: plan.rateKind, after }),
  }
}

function withAudit(data: PrototypeAppState, event: AuditEvent): PrototypeAppState {
  return { ...data, auditEvents: [...data.auditEvents, event] }
}

export function applyUtilityRateChange(
  data: PrototypeAppState,
  request: UtilityRateChangeRequest,
  asOf: string,
): UtilityRateApplyResult {
  const planned = planUtilityRateChange(data, request, asOf)
  if (!planned.ok) return planned
  const plan = planned.plan
  const records = recordsFor(data, plan.rateKind)

  if (plan.changeKind === 'SCHEDULE') {
    const revision = nextRevision(data, plan.rateKind, plan.effectiveFrom)
    const rate = createRate(plan.rateKind, nextRateId(data, plan.rateKind, plan.effectiveFrom, revision),
      plan.proposedCents!, plan.effectiveFrom, asOf, revision, plan.reason)
    const event = auditEvent('UTILITY_RATE_SCHEDULED', rate, plan, asOf,
      { activeCents: plan.currentCents }, rate)
    return {
      ok: true, data: withAudit(withRecords(data, plan.rateKind, [...records, rate]), event),
      plan, rate, auditEvent: event,
    }
  }

  const target = records.find(rate => rate.id === plan.expectedRateId)
  if (!target || !eligibleUtilityRate(target) || target.effectiveFrom <= asOf
    || (plan.expectedRateRevision !== null && (target.revision ?? 1) !== plan.expectedRateRevision)) {
    return { ok: false, code: 'STALE_CHANGE', errors: { general: 'This scheduled change changed in another session. Refresh and review again.' } }
  }

  if (plan.changeKind === 'CANCEL') {
    const canceled = { ...target, canceledOn: asOf, canceledBy: 'landlord', cancelReason: plan.reason } as AnyUtilityRate
    const event = auditEvent('UTILITY_RATE_CANCELED', canceled, plan, asOf, target, canceled)
    return {
      ok: true,
      data: withAudit(withRecords(data, plan.rateKind, records.map(rate => rate.id === target.id ? canceled : rate)), event),
      plan, rate: canceled, auditEvent: event,
    }
  }

  const revision = nextRevision(data, plan.rateKind, plan.effectiveFrom)
  const replacement = createRate(plan.rateKind, nextRateId(data, plan.rateKind, plan.effectiveFrom, revision),
    plan.proposedCents!, plan.effectiveFrom, asOf, revision, plan.reason, target.id)
  const superseded = {
    ...target, supersededOn: asOf, supersededBy: 'landlord',
    supersededReason: plan.reason, supersededByRateId: replacement.id,
  } as AnyUtilityRate
  const event = auditEvent('UTILITY_RATE_EDITED', replacement, plan, asOf, superseded, replacement)
  return {
    ok: true,
    data: withAudit(withRecords(data, plan.rateKind,
      records.map(rate => rate.id === target.id ? superseded : rate).concat(replacement)), event),
    plan, rate: replacement, auditEvent: event,
  }
}

export function pendingUtilityRate(
  data: PrototypeAppState,
  rateKind: UtilityRateKind,
  asOf: string,
): AnyUtilityRate | undefined {
  return eligibleFutureRates(data, rateKind, asOf)[0]
}

export function utilityRateHistory(
  data: PrototypeAppState,
  rateKind: UtilityRateKind,
): AnyUtilityRate[] {
  return [...recordsFor(data, rateKind)]
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)
      || (b.revision ?? 1) - (a.revision ?? 1)
      || b.recordedOn.localeCompare(a.recordedOn))
}
