export const NOTIFICATION_STORAGE_KEY = 'bhms:notifications:v1'
export const NOTIFICATION_CLEARED_EVENT = 'bhms:notifications-cleared'
export const MAX_READ_IDS = 100

function normalize(ids: unknown): string[] {
  if (!Array.isArray(ids)) return []
  const unique = new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))
  return [...unique].slice(-MAX_READ_IDS)
}

export function loadReadIds(): string[] {
  try {
    const raw = localStorage.getItem(NOTIFICATION_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) return normalize(parsed)
    if (parsed && typeof parsed === 'object' && 'readIds' in parsed) {
      return normalize((parsed as { readIds: unknown }).readIds)
    }
    return []
  } catch {
    return []
  }
}

export function saveReadIds(ids: string[]): void {
  try {
    const normalized = normalize(ids)
    if (normalized.length === 0) {
      localStorage.removeItem(NOTIFICATION_STORAGE_KEY)
      return
    }
    localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify({ version: 1, readIds: normalized }))
  } catch {
    // A blocked storage API should not break the prototype.
  }
}

export function clearReadIds(): void {
  try {
    localStorage.removeItem(NOTIFICATION_STORAGE_KEY)
  } catch {
    // Ignore storage failures; the in-memory state still clears below.
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(NOTIFICATION_CLEARED_EVENT))
  }
}
