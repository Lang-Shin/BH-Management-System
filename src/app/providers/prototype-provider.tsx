import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react'
import { createDemoData } from '@/data/fixtures/demo'
import type { PrototypeRepository } from '@/data/repositories/prototype-repository'
import { ErrorState, LoadingState } from '@/components/shared/states'
import { PrototypeContext } from '@/app/state/prototype-context'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import type { PrototypeAction } from '@/app/state/actions'

export function PrototypeProvider({ children, repository }: { children: ReactNode; repository: PrototypeRepository }) {
  const [data, reduce] = useReducer(prototypeReducer, undefined, createDemoData)
  const [storageWarning, setStorageWarning] = useState<string | null>(null)
  const [canPersist, setCanPersist] = useState(false)
  const [ready, setReady] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const saveQueue = useRef<Promise<void>>(Promise.resolve())

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
    let cancelled = false
    // Serialize snapshots so an async adapter cannot finish an older write last.
    saveQueue.current = saveQueue.current.then(async () => {
      try {
        const warning = await repository.save(data)
        if (!cancelled) setStorageWarning(warning)
      } catch {
        if (!cancelled) setStorageWarning('Demo changes could not be saved. Your current session is still available. Reset the demo to retry.')
      }
    })
    return () => { cancelled = true }
  }, [data, ready, canPersist, repository])

  function dispatch(action: PrototypeAction) {
    if (action.type === 'demo/reset') setCanPersist(true)
    reduce(action)
  }

  if (loadFailed) return <div className="p-6"><ErrorState title="Workspace could not be loaded" onRetry={() => window.location.reload()} /></div>
  if (!ready) return <div className="p-6"><LoadingState /></div>
  return <PrototypeContext.Provider value={{ data, dispatch, storageWarning }}>{children}</PrototypeContext.Provider>
}
