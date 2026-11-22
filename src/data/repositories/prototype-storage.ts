import type { PrototypeAppState, RoomAssignment } from '@/domain/types/models'
import { initialRoomRentRates, initialWashingRates, initialWaterRates } from '@/domain/calculations/billing-rates'
import { DEFAULT_MOVE_IN_POLICY } from '@/domain/calculations/move-in-policy'
import { isPrototypeData, isRecord } from '@/domain/validation/prototype-data'

export const STORAGE_SCHEMA_VERSION = 16

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
function withMoveInState(value: unknown, fromVersion: 7 | 8 | 9 | 10): PrototypeAppState | null {
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
  return isPrototypeData(withRequests) ? withRequests : null
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
  // Version 16 adds explicit short-stay advance refunds.
  if (parsed.version === 15) {
    const migrated = withAdvanceRefundState(parsed.data)
    return isPrototypeData(migrated) ? { ok: true, data: migrated } : { ok: false, reason: 'INVALID_DATA' }
  }
  if (parsed.version === 14 || parsed.version === 13 || parsed.version === 12) {
    const migrated = withAdvanceRefundState(withRoomChangeRequests(parsed.data))
    return isPrototypeData(migrated) ? { ok: true, data: migrated } : { ok: false, reason: 'INVALID_DATA' }
  }
  if (parsed.version === 11) {
    const migrated = withAdvanceRefundState(withRoomChangeRequests(withPaymentScope(parsed.data)))
    return isPrototypeData(migrated) ? { ok: true, data: migrated } : { ok: false, reason: 'INVALID_DATA' }
  }
  if (parsed.version === 10) {
    const migrated = withAdvanceRefundState(withMoveInState(parsed.data, 10))
    return migrated && isPrototypeData(migrated) ? { ok: true, data: migrated } : { ok: false, reason: 'INVALID_DATA' }
  }
  if (parsed.version === 9 || parsed.version === 8) {
    const migrated = withAdvanceRefundState(withMoveInState(parsed.data, parsed.version))
    return migrated && isPrototypeData(migrated) ? { ok: true, data: migrated } : { ok: false, reason: 'INVALID_DATA' }
  }
  if (parsed.version === 7) {
    const migrated = withAdvanceRefundState(withMoveInState(migrateVersion7(parsed.data), 7))
    return migrated && isPrototypeData(migrated) ? { ok: true, data: migrated } : { ok: false, reason: 'INVALID_DATA' }
  }
  if (parsed.version !== STORAGE_SCHEMA_VERSION) return { ok: false, reason: 'UNSUPPORTED_SCHEMA' }
  if (!isPrototypeData(parsed.data)) return { ok: false, reason: 'INVALID_DATA' }
  return { ok: true, data: parsed.data }
}
