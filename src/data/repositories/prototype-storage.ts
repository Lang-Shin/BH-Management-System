import type { PrototypeAppState } from '@/domain/types/models'
import { isPrototypeData, isRecord } from '@/domain/validation/prototype-data'

export const STORAGE_SCHEMA_VERSION = 5

type ParseResult =
  | { ok: true; data: PrototypeAppState }
  | { ok: false; reason: 'MALFORMED_JSON' | 'UNSUPPORTED_SCHEMA' | 'INVALID_DATA' }

/** Pure, non-throwing decoding. Storage access and recovery decisions stay in the adapter. */
export function parsePrototypeSnapshot(raw: string): ParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'MALFORMED_JSON' }
  }
  if (!isRecord(parsed)) return { ok: false, reason: 'INVALID_DATA' }
  if (parsed.version !== STORAGE_SCHEMA_VERSION) return { ok: false, reason: 'UNSUPPORTED_SCHEMA' }
  if (!isPrototypeData(parsed.data)) return { ok: false, reason: 'INVALID_DATA' }
  return { ok: true, data: parsed.data }
}
