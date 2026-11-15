import { useCallback, useEffect, useState } from 'react'
import {
  loadReadIds,
  NOTIFICATION_CLEARED_EVENT,
  saveReadIds,
} from './read-state'

export function useNotificationReadState() {
  const [readIds, setReadIds] = useState<string[]>(loadReadIds)

  useEffect(() => {
    saveReadIds(readIds)
  }, [readIds])

  useEffect(() => {
    const reset = () => setReadIds([])
    window.addEventListener(NOTIFICATION_CLEARED_EVENT, reset)
    return () => window.removeEventListener(NOTIFICATION_CLEARED_EVENT, reset)
  }, [])

  const markRead = useCallback((id: string) => {
    setReadIds(current => current.includes(id) ? current : [...current, id])
  }, [])

  const markAllRead = useCallback((ids: string[]) => {
    setReadIds(current => [...new Set([...current, ...ids])])
  }, [])

  return { readIds, markRead, markAllRead }
}
