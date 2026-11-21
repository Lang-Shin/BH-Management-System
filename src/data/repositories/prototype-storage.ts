import type { PrototypeAppState } from '@/domain/types/models'
import { initialRoomRentRates, initialWashingRates, initialWaterRates } from '@/domain/calculations/billing-rates'
import { isPrototypeData, isRecord } from '@/domain/validation/prototype-data'

export const STORAGE_SCHEMA_VERSION = 9

type ParseResult =
  | { ok: true; data: PrototypeAppState }
  | { ok: false; reason: 'MALFORMED_JSON' | 'UNSUPPORTED_SCHEMA' | 'INVALID_DATA' }

function migrateVersion7(value: unknown): PrototypeAppState | null {
  if (!isRecord(value)) return null
  const electricityRates = Array.isArray(value.electricityRates)
    ? value.electricityRates.map(rate => isRecord(rate)
      ? { ...rate, recordedOn: typeof rate.recordedOn === 'string' ? rate.recordedOn : rate.effectiveFrom }
      : rate)
    : value.electricityRates
  const candidate = {
    ...value,
    electricityRates,
    roomRentRates: initialRoomRentRates(),
    waterRates: initialWaterRates(),
    washingRates: initialWashingRates(),
  }
  return isPrototypeData(candidate) ? candidate : null
}

/**
 * Version 9 changes the fresh fixture to the actual 15-room house layout. Older saved
 * snapshots keep their room numbers, tenant assignments, bills, payments, and receipts
 * unchanged: the old fictional room numbers cannot be mapped onto the actual rooms without
 * silently reassigning historical records, so retained data is validated and kept as-is.
 * Restore sample records loads the actual configuration explicitly.
 */
function retainLegacySnapshot(value: unknown): PrototypeAppState | null {
  return isPrototypeData(value) ? value : null
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
  if (parsed.version === 8) {
    const retained = retainLegacySnapshot(parsed.data)
    return retained ? { ok: true, data: retained } : { ok: false, reason: 'INVALID_DATA' }
  }
  if (parsed.version === 7) {
    const migrated = migrateVersion7(parsed.data)
    return migrated ? { ok: true, data: migrated } : { ok: false, reason: 'INVALID_DATA' }
  }
  if (parsed.version !== STORAGE_SCHEMA_VERSION) return { ok: false, reason: 'UNSUPPORTED_SCHEMA' }
  if (!isPrototypeData(parsed.data)) return { ok: false, reason: 'INVALID_DATA' }
  return { ok: true, data: parsed.data }
}
