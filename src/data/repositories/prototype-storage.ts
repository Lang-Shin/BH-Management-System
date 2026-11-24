import type { PrototypeAppState, RoomAssignment } from '@/domain/types/models'
import { initialRoomRentRates, initialWashingRates, initialWaterRates } from '@/domain/calculations/billing-rates'
import { DEFAULT_MOVE_IN_POLICY } from '@/domain/calculations/move-in-policy'
import { isPrototypeData, isRecord } from '@/domain/validation/prototype-data'

export const STORAGE_SCHEMA_VERSION = 18

type ParseResult =
  | { ok: true; data: PrototypeAppState }
  | { ok: false; reason: 'MALFORMED_JSON' | 'UNSUPPORTED_SCHEMA' | 'INVALID_DATA' }

function migrateVersion7(value: unknown): unknown {
  if (!isRecord(value)) return null
  const electricityRates = Array.isArray(value.electricityRates)
    ? value.electricityRates.map(rate => isRecord(rate)
      ? { ...rate, recordedOn: typeof rate.recordedOn === 'string' ? rate.recordedOn : rate.effectiveFrom }
      : rate)
    : value.electricityRates
  return {
    ...value,
    electricityRates,
    roomRentRates: initialRoomRentRates(),
    waterRates: initialWaterRates(),
    washingRates: initialWashingRates(),
  }
}

/**
 * Version 12 makes payment ownership explicit. Existing transactions stay tenant-owned and keep
 * their payer/method history; room-level payments use a room and occupancy-cycle reference.
 */
function withPaymentScope(value: unknown): unknown {
  if (!isRecord(value)) return value
  const payments = Array.isArray(value.payments)
    ? value.payments.map(payment => isRecord(payment)
      ? { ...payment, scope: payment.scope === 'ROOM' ? 'ROOM' : 'TENANT', roomId: payment.roomId ?? null, occupancyCycleId: payment.occupancyCycleId ?? null }
      : payment)
    : value.payments
  return { ...value, payments }
}

function withAdvanceRefundState(value: unknown): unknown {
  if (!isRecord(value)) return value
  const policy = isRecord(value.moveInPolicy)
    ? { ...value.moveInPolicy, shortStayAdvanceRefundDays: Number.isSafeInteger(value.moveInPolicy.shortStayAdvanceRefundDays) ? value.moveInPolicy.shortStayAdvanceRefundDays : 7 }
    : value.moveInPolicy
  return { ...value, advanceRefunds: Array.isArray(value.advanceRefunds) ? value.advanceRefunds : [], moveInPolicy: policy }
}

function withRoomChangeRequests(value: unknown): unknown {
  if (!isRecord(value)) return value
  const periods = Array.isArray(value.billingPeriods) ? value.billingPeriods.filter(isRecord) : []
  const requests = (Array.isArray(value.roomChangeRequests) ? value.roomChangeRequests : []).map(request => {
    if (!isRecord(request) || Array.isArray(request.billingReviewPeriodIds)) return request
    const approvedStart = typeof request.approvedStartDate === 'string' ? request.approvedStartDate : null
    const requestedStart = typeof request.requestedStartDate === 'string' ? request.requestedStartDate : null
    const date = approvedStart ?? requestedStart
    const period = date === null ? undefined : periods.find(item => typeof item.id === 'string' && typeof item.startDate === 'string' && typeof item.endDate === 'string' && item.startDate <= date && item.endDate >= date)
    const ids = request.status === 'APPROVED' && period && typeof period.startDate === 'string' && date !== null && date > period.startDate && typeof period.id === 'string' ? [period.id] : []
    return { ...request, billingReviewPeriodIds: ids }
  })
  return { ...value, roomChangeRequests: requests }
}

/**
 * Version 10 added occupancy cycles and move-in obligations; version 11 makes the non-refundable
 * deposit policy explicit without rewriting obligations created under the older provisional policy.
 * Legacy snapshots receive active cycles for already-occupied rooms but no invented deposits.
 */
function withMoveInState(value: unknown, fromVersion: 7 | 8 | 9 | 10): unknown | null {
  if (!isRecord(value)) return null
  const rooms = Array.isArray(value.rooms) ? value.rooms.filter(isRecord) : []
  const assignments = Array.isArray(value.roomAssignments) ? value.roomAssignments as RoomAssignment[] : []
  const existingCycles = Array.isArray(value.occupancyCycles) ? value.occupancyCycles : null
  const occupancyCycles = existingCycles ?? rooms.flatMap(room => {
    const active = assignments.filter(assignment => assignment.roomId === room.id && assignment.endDate === null)
    if (active.length === 0) return []
    const startedAt = active.map(assignment => assignment.startDate).sort()[0] ?? '2026-01-01'
    return [{
      id: `legacy-cycle-${room.id}`, roomId: room.id, startedAt, endedAt: null, status: 'ACTIVE' as const,
      createdAt: startedAt, updatedAt: startedAt,
    }]
  })
  const existingPolicy = isRecord(value.moveInPolicy) ? value.moveInPolicy : null
  const oldDisposition = existingPolicy?.depositDisposition === 'NON_REFUNDABLE' ? 'NON_REFUNDABLE' : 'MANUAL_REVIEW'
  const oldVersion = Number.isSafeInteger(existingPolicy?.version) && (existingPolicy?.version as number) > 0
    ? existingPolicy!.version as number : 1
  const moveInPolicy = fromVersion === 10
    ? {
        ...DEFAULT_MOVE_IN_POLICY,
        version: Math.max(DEFAULT_MOVE_IN_POLICY.version, oldVersion + 1),
        advanceApplication: ['FIRST_MONTH', 'LAST_MONTH', 'MANUAL'].includes(existingPolicy?.advanceApplication as string)
          ? existingPolicy!.advanceApplication : DEFAULT_MOVE_IN_POLICY.advanceApplication,
      }
    : { ...DEFAULT_MOVE_IN_POLICY }
  const moveInObligations = (Array.isArray(value.moveInObligations) ? value.moveInObligations : []).map(obligation => {
    if (!isRecord(obligation)) return obligation
    const disposition = obligation.depositDisposition === 'NON_REFUNDABLE' || obligation.depositDisposition === 'MANUAL_REVIEW'
      ? obligation.depositDisposition : oldDisposition
    return { ...obligation, depositDisposition: disposition, depositIncomeRecognition: 'NOT_RECOGNIZED' }
  })
  const candidate = {
    ...value,
    occupancyCycles,
    moveInObligations,
    moveInPolicy,
  }
  const withPayments = withPaymentScope(candidate)
  const withRequests = withRoomChangeRequests(withPayments)
  return withRequests
}

/**
 * Version 17 adds anniversary rent periods and advance applications. Imported cycles remain on
 * legacy calendar billing until they become vacant; no historical rent is relabelled. Existing
 * paid advances are listed for owner review and never auto-applied to an old first rent period.
 */
function withAnniversaryState(value: unknown, fromVersion: number): unknown {
  if (!isRecord(value)) return value
  if (fromVersion >= 17) return value
  const cycles = (Array.isArray(value.occupancyCycles) ? value.occupancyCycles : []).map(cycle => {
    if (!isRecord(cycle)) return cycle
    const validSchedule = cycle.rentSchedule === 'ANNIVERSARY' || cycle.rentSchedule === 'LEGACY_CALENDAR'
    const anchorDate = typeof cycle.rentAnchorDate === 'string' ? cycle.rentAnchorDate : null
    const anchorDay = Number.isSafeInteger(cycle.rentAnchorDay) ? cycle.rentAnchorDay as number : null
    return validSchedule
      ? cycle
      : {
          ...cycle, rentSchedule: 'LEGACY_CALENDAR', rentAnchorDate: anchorDate, rentAnchorDay: anchorDay,
          cycleOrigin: cycle.cycleOrigin === 'NEW_MOVE_IN' || cycle.cycleOrigin === 'TRANSFER' || cycle.cycleOrigin === 'SAME_DAY_REPLACEMENT'
            ? cycle.cycleOrigin : 'LEGACY',
        }
  })
  const existingPolicy = isRecord(value.moveInPolicy) ? value.moveInPolicy : null
  const oldVersion = Number.isSafeInteger(existingPolicy?.version) && (existingPolicy?.version as number) > 0
    ? existingPolicy!.version as number : 1
  const depositDisposition = existingPolicy?.depositDisposition === 'MANUAL_REVIEW' ? 'MANUAL_REVIEW' : 'NON_REFUNDABLE'
  const moveInPolicy = {
    ...DEFAULT_MOVE_IN_POLICY, version: Math.max(DEFAULT_MOVE_IN_POLICY.version, oldVersion), depositDisposition,
  }
  const rentalPeriods = Array.isArray(value.rentalPeriods) ? value.rentalPeriods : []
  const rentObligations = Array.isArray(value.rentObligations) ? value.rentObligations : []
  const advanceApplications = Array.isArray(value.advanceApplications) ? value.advanceApplications : []
  const rentPrepayments = Array.isArray(value.rentPrepayments) ? value.rentPrepayments : []
  const charges = Array.isArray(value.charges) ? value.charges.filter(isRecord) : []
  const allocations = Array.isArray(value.paymentAllocations) ? value.paymentAllocations.filter(isRecord) : []
  const derivedReviews = (Array.isArray(value.moveInObligations) ? value.moveInObligations : []).flatMap(obligation => {
    if (!isRecord(obligation) || advanceApplications.some(application => isRecord(application) && application.advanceChargeId === obligation.advanceChargeId)) return []
    const advance = charges.find(charge => charge.id === obligation.advanceChargeId && charge.category === 'ADVANCE')
    if (!advance || typeof advance.amountCents !== 'number') return []
    const paid = allocations.filter(allocation => allocation.chargeId === advance.id && allocation.state === 'ACTIVE')
      .reduce((sum, allocation) => sum + (typeof allocation.amountCents === 'number' ? allocation.amountCents : 0), 0)
    if (paid < advance.amountCents) return []
    const paidOn = allocations.filter(allocation => allocation.chargeId === advance.id && allocation.state === 'ACTIVE')
      .map(allocation => typeof allocation.allocatedOn === 'string' ? allocation.allocatedOn : '')
      .filter(Boolean).sort().at(-1) ?? (typeof advance.issuedOn === 'string' ? advance.issuedOn : '2026-01-01')
    return [{
      id: `financial-review-legacy-advance-${String(obligation.id)}`, type: 'LEGACY_ADVANCE_UNALLOCATED',
      roomId: String(obligation.roomId), occupancyCycleId: String(obligation.occupancyCycleId),
      tenantId: typeof advance.tenantId === 'string' ? advance.tenantId : null, rentalPeriodId: null,
      status: 'OPEN', note: 'Paid advance predates first-period application. Owner verification is required; no historical cash or receipt was rewritten.',
      createdAt: paidOn, resolvedAt: null,
    }]
  })
  const existingReviews = Array.isArray(value.financialReviewCases) ? value.financialReviewCases : []
  return {
    ...value,
    occupancyCycles: cycles,
    moveInPolicy,
    rentalPeriods,
    rentObligations,
    advanceApplications,
    rentPrepayments,
    financialReviewCases: existingReviews.length > 0 ? existingReviews : derivedReviews,
  }
}

function withPrepaidRentRefundState(value: unknown): unknown {
  if (!isRecord(value)) return value
  return {
    ...value,
    prepaidRentRefunds: Array.isArray(value.prepaidRentRefunds) ? value.prepaidRentRefunds : [],
    rentPrepayments: (Array.isArray(value.rentPrepayments) ? value.rentPrepayments : []).map(prepayment =>
      isRecord(prepayment) && prepayment.state === undefined ? { ...prepayment, state: 'ACTIVE' } : prepayment),
  }
}

function finish(value: unknown, fromVersion: number): ParseResult {
  const migrated = withPrepaidRentRefundState(withAnniversaryState(value, fromVersion))
  return isPrototypeData(migrated) ? { ok: true, data: migrated } : { ok: false, reason: 'INVALID_DATA' }
}

/** Pure, non-throwing decoding. Storage access and recovery decisions stay in the adapter. */
export function parsePrototypeSnapshot(raw: string): ParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'MALFORMED_JSON' }
  }
  if (!isRecord(parsed)) return { ok: false, reason: 'INVALID_DATA' }
  // Version 18 adds audited prepaid-rent refunds and prepayment supersession.
  if (parsed.version === 17) return finish(parsed.data, 17)
  // Version 17 adds anniversary rent and first-period advance settlement.
  if (parsed.version === 16) return finish(withAdvanceRefundState(parsed.data), 16)
  if (parsed.version === 15) return finish(withAdvanceRefundState(parsed.data), 15)
  if (parsed.version === 14 || parsed.version === 13 || parsed.version === 12) {
    return finish(withAdvanceRefundState(withRoomChangeRequests(parsed.data)), parsed.version)
  }
  if (parsed.version === 11) return finish(withAdvanceRefundState(withRoomChangeRequests(withPaymentScope(parsed.data))), 11)
  if (parsed.version === 10) return finish(withAdvanceRefundState(withMoveInState(parsed.data, 10)), 10)
  if (parsed.version === 9 || parsed.version === 8) return finish(withAdvanceRefundState(withMoveInState(parsed.data, parsed.version)), parsed.version)
  if (parsed.version === 7) return finish(withAdvanceRefundState(withMoveInState(migrateVersion7(parsed.data), 7)), 7)
  if (parsed.version !== STORAGE_SCHEMA_VERSION) return { ok: false, reason: 'UNSUPPORTED_SCHEMA' }
  return finish(parsed.data, STORAGE_SCHEMA_VERSION)
}
