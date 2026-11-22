import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import { createDemoData, resolveOccupancyDate } from '@/data/fixtures/demo'
import type { PrototypeRepository } from '@/data/repositories/prototype-repository'
import { ErrorState, LoadingState } from '@/components/shared/states'
import { PrototypeContext } from '@/app/state/prototype-context'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import type { PrototypeAction } from '@/app/state/actions'
import type { PrototypeData } from '@/domain/types/models'
import { ApplicationDateProvider, type ApplicationClock } from './application-date'
import { useOccupancyDate } from '@/hooks/use-occupancy-date'
import { usePrototype } from '@/hooks/use-prototype'

const systemClock: ApplicationClock = () => new Date()
const SAVE_FAILURE = 'Your changes could not be saved. You can keep using this page, but your latest changes may be lost when it closes.'

function OccupancyDateSync({ children }: { children: ReactNode }) {
  const occupancyDate = useOccupancyDate()
  const { dispatch } = usePrototype()
  useEffect(() => {
    dispatch({ type: 'occupancy/dateChanged', asOf: occupancyDate })
  }, [dispatch, occupancyDate])
  return children
}

export function PrototypeProvider({ children, repository, now }: { children: ReactNode; repository: PrototypeRepository; now?: ApplicationClock }) {
  const [data, reduce] = useReducer(prototypeReducer, undefined, createDemoData)
  const [storageWarning, setStorageWarning] = useState<string | null>(null)
  const [canPersist, setCanPersist] = useState(false)
  const [ready, setReady] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const saveQueue = useRef<Promise<void>>(Promise.resolve())
  const lastSavedJson = useRef<string | null>(null)
  const clock = useMemo<ApplicationClock>(() => now ?? systemClock, [now])

  useEffect(() => {
    let cancelled = false
    repository.load().then(snapshot => {
      if (cancelled) return
      reduce({ type: 'data/loaded', data: snapshot.data, occupancyDate: resolveOccupancyDate(clock()) })
      setStorageWarning(snapshot.warning)
      setCanPersist(snapshot.canPersist)
      setReady(true)
    }).catch(() => { if (!cancelled) setLoadFailed(true) })
    return () => { cancelled = true }
  }, [repository, clock])

  useEffect(() => {
    if (!ready || !canPersist) return
    const json = JSON.stringify(data)
    if (json === lastSavedJson.current) return
    let cancelled = false
    // Serialize snapshots so an async adapter cannot finish an older write last.
    saveQueue.current = saveQueue.current.then(async () => {
      try {
        const warning = await repository.save(data)
        if (!cancelled) {
          setStorageWarning(warning)
          if (!warning) lastSavedJson.current = json
        }
      } catch {
        if (!cancelled) setStorageWarning(SAVE_FAILURE)
      }
    })
    return () => { cancelled = true }
  }, [data, ready, canPersist, repository])

  const persistSnapshot = useCallback((snapshot: PrototypeData): Promise<string | null> => {
    if (!canPersist) {
      const warning = 'Saving is disabled because the saved records could not be opened. Restore sample records before recording changes.'
      setStorageWarning(warning)
      return Promise.resolve(warning)
    }
    const json = JSON.stringify(snapshot)
    const operation = saveQueue.current.then(async () => {
      try {
        const warning = await repository.save(snapshot)
        setStorageWarning(warning)
        if (!warning) lastSavedJson.current = json
        return warning
      } catch {
        setStorageWarning(SAVE_FAILURE)
        return SAVE_FAILURE
      }
    })
    saveQueue.current = operation.then(() => undefined)
    return operation
  }, [canPersist, repository])

  const resetToSample = useCallback((): Promise<string | null> => {
    const snapshot = createDemoData()
    const json = JSON.stringify(snapshot)
    const operation = saveQueue.current.then(async () => {
      try {
        const warning = await repository.save(snapshot)
        if (warning) {
          setStorageWarning(warning)
          return warning
        }
        // Only replace in-memory state after the canonical dataset is durable.
        lastSavedJson.current = json
        setStorageWarning(null)
        setCanPersist(true)
        reduce({ type: 'data/loaded', data: snapshot, occupancyDate: resolveOccupancyDate(clock()) })
        return null
      } catch {
        setStorageWarning(SAVE_FAILURE)
        return SAVE_FAILURE
      }
    })
    saveQueue.current = operation.then(() => undefined)
    return operation
  }, [repository, clock])

  const dispatch = useCallback((action: PrototypeAction) => {
    if (action.type === 'demo/reset') setCanPersist(true)
    reduce(action)
  }, [])

  if (loadFailed) return <div className="p-6"><ErrorState title="Your records could not be opened" onRetry={() => window.location.reload()} /></div>
  if (!ready) return <div className="p-6"><LoadingState /></div>
  return <PrototypeContext.Provider value={{ data, dispatch, persistSnapshot, resetToSample, storageWarning }}>
    <ApplicationDateProvider now={now}>
      <OccupancyDateSync>{children}</OccupancyDateSync>
    </ApplicationDateProvider>
  </PrototypeContext.Provider>
}
