import { useCallback, useEffect, useState } from 'react'

export const DISMISSED_NOTICES_STORAGE_KEY = 'bhms:dismissed-notices:v1'
const MAX_DISMISSED_NOTICES = 100

function normalize(ids: unknown): string[] {
  if (!Array.isArray(ids)) return []
  const unique = new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))
  return [...unique].slice(-MAX_DISMISSED_NOTICES)
}

export function loadDismissedNoticeIds(): string[] {
  try {
    const raw = localStorage.getItem(DISMISSED_NOTICES_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) return normalize(parsed)
    if (parsed && typeof parsed === 'object' && 'ids' in parsed) {
      return normalize((parsed as { ids: unknown }).ids)
    }
    return []
  } catch {
    return []
  }
}

function saveDismissedNoticeIds(ids: string[]): void {
  try {
    const normalized = normalize(ids)
    if (normalized.length === 0) {
      localStorage.removeItem(DISMISSED_NOTICES_STORAGE_KEY)
      return
    }
    localStorage.setItem(DISMISSED_NOTICES_STORAGE_KEY, JSON.stringify({ version: 1, ids: normalized }))
  } catch {
    // Blocked storage should not break the page; dismissal remains for this render session.
  }
}

export function useDismissedNotices() {
  const [dismissedIds, setDismissedIds] = useState<string[]>(loadDismissedNoticeIds)

  useEffect(() => {
    saveDismissedNoticeIds(dismissedIds)
  }, [dismissedIds])

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === DISMISSED_NOTICES_STORAGE_KEY) setDismissedIds(loadDismissedNoticeIds())
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])

  const dismiss = useCallback((id: string) => {
    setDismissedIds(current => current.includes(id) ? current : [...current, id])
  }, [])

  const isDismissed = useCallback((id: string) => dismissedIds.includes(id), [dismissedIds])

  return { dismissedIds, dismiss, isDismissed }
}
