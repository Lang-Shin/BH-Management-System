import type { PrototypeAppState, RoomAssignment } from '@/domain/types/models'
import { initialRoomRentRates, initialWashingRates, initialWaterRates } from '@/domain/calculations/billing-rates'
import { DEFAULT_MOVE_IN_POLICY } from '@/domain/calculations/move-in-policy'
import { isPrototypeData, isRecord } from '@/domain/validation/prototype-data'

export const STORAGE_SCHEMA_VERSION = 10

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
 * Version 10 adds occupancy cycles and move-in obligations. Legacy snapshots receive active
 * cycles for already-occupied rooms but no invented deposits or advances. Existing rooms, tenants,
 * bills, payments, receipts, corrections, and room labels are retained unchanged.
 */
function withVersion10(value: unknown): PrototypeAppState | null {
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
  const candidate = {
    ...value,
    occupancyCycles,
    moveInObligations: Array.isArray(value.moveInObligations) ? value.moveInObligations : [],
    moveInPolicy: isRecord(value.moveInPolicy) ? value.moveInPolicy : DEFAULT_MOVE_IN_POLICY,
  }
  return isPrototypeData(candidate) ? candidate : null
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
  if (parsed.version === 9 || parsed.version === 8) {
    const migrated = withVersion10(parsed.data)
    return migrated ? { ok: true, data: migrated } : { ok: false, reason: 'INVALID_DATA' }
  }
  if (parsed.version === 7) {
    const migrated = withVersion10(migrateVersion7(parsed.data))
    return migrated ? { ok: true, data: migrated } : { ok: false, reason: 'INVALID_DATA' }
  }
  if (parsed.version !== STORAGE_SCHEMA_VERSION) return { ok: false, reason: 'UNSUPPORTED_SCHEMA' }
  if (!isPrototypeData(parsed.data)) return { ok: false, reason: 'INVALID_DATA' }
  return { ok: true, data: parsed.data }
}
