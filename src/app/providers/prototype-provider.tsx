import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from 'react'
import { createDemoData } from '@/data/fixtures/demo'
import type { PrototypeRepository } from '@/data/repositories/prototype-repository'
import { ErrorState, LoadingState } from '@/components/shared/states'
import { PrototypeContext } from '@/app/state/prototype-context'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import type { PrototypeAction } from '@/app/state/actions'
import type { PrototypeData } from '@/domain/types/models'

const SAVE_FAILURE = 'Your changes could not be saved. You can keep using this page, but your latest changes may be lost when it closes.'

export function PrototypeProvider({ children, repository }: { children: ReactNode; repository: PrototypeRepository }) {
  const [data, reduce] = useReducer(prototypeReducer, undefined, createDemoData)
  const [storageWarning, setStorageWarning] = useState<string | null>(null)
  const [canPersist, setCanPersist] = useState(false)
  const [ready, setReady] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const saveQueue = useRef<Promise<void>>(Promise.resolve())
  const lastSavedJson = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    repository.load().then(snapshot => {
      if (cancelled) return
      reduce({ type: 'data/loaded', data: snapshot.data })
      setStorageWarning(snapshot.warning)
      setCanPersist(snapshot.canPersist)
      setReady(true)
    }).catch(() => { if (!cancelled) setLoadFailed(true) })
    return () => { cancelled = true }
  }, [repository])

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
        reduce({ type: 'data/loaded', data: snapshot })
        return null
      } catch {
        setStorageWarning(SAVE_FAILURE)
        return SAVE_FAILURE
      }
    })
    saveQueue.current = operation.then(() => undefined)
    return operation
  }, [repository])

  function dispatch(action: PrototypeAction) {
    if (action.type === 'demo/reset') setCanPersist(true)
    reduce(action)
  }

  if (loadFailed) return <div className="p-6"><ErrorState title="Your records could not be opened" onRetry={() => window.location.reload()} /></div>
  if (!ready) return <div className="p-6"><LoadingState /></div>
  return <PrototypeContext.Provider value={{ data, dispatch, persistSnapshot, resetToSample, storageWarning }}>{children}</PrototypeContext.Provider>
}
