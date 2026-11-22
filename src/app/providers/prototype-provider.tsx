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
  const initialDate = useRef(occupancyDate)
  useEffect(() => {
    // Initial loading already reconciles against the occupancy date. Only a real date rollover
    // should become a server command.
    if (occupancyDate === initialDate.current) return
    initialDate.current = occupancyDate
    dispatch({ type: 'occupancy/dateChanged', asOf: occupancyDate })
  }, [dispatch, occupancyDate])
  return children
}

export function PrototypeProvider({ children, repository, now }: { children: ReactNode; repository: PrototypeRepository; now?: ApplicationClock }) {
  const [data, reduce] = useReducer(prototypeReducer, undefined, createDemoData)
  const [storageWarning, setStorageWarning] = useState<string | null>(null)
  const [commandError, setCommandError] = useState<string | null>(null)
  const [pendingCommands, setPendingCommands] = useState(0)
  const [canPersist, setCanPersist] = useState(false)
  const [ready, setReady] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const saveQueue = useRef<Promise<void>>(Promise.resolve())
  const lastSavedJson = useRef<string | null>(null)
  const clock = useMemo<ApplicationClock>(() => now ?? systemClock, [now])
  const serverRepository = useMemo(() => repository.mode === 'server' && repository.command ? repository : null, [repository])
  const confirmedData = useRef<PrototypeData | null>(null)
  const pendingActions = useRef<{ action: PrototypeAction; key: string }[]>([])
  const commandQueue = useRef<Promise<void>>(Promise.resolve())
  const syncGeneration = useRef(0)
  const failedCommand = useRef<{ action: PrototypeAction; key: string } | null>(null)
  const confirmedRevision = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    repository.load().then(snapshot => {
      if (cancelled) return
      confirmedData.current = snapshot.data
      confirmedRevision.current = snapshot.revision ?? null
      reduce(serverRepository
        ? { type: 'data/serverSynced', data: snapshot.data }
        : { type: 'data/loaded', data: snapshot.data, occupancyDate: resolveOccupancyDate(clock()) })
      setStorageWarning(snapshot.warning)
      setCanPersist(serverRepository ? true : snapshot.canPersist)
      setReady(true)
    }).catch(() => { if (!cancelled) setLoadFailed(true) })
    return () => { cancelled = true }
  }, [repository, clock, serverRepository])

  useEffect(() => {
    if (!ready || !canPersist || serverRepository) return
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
  }, [data, ready, canPersist, repository, serverRepository])

  const runServerCommand = useCallback((action: PrototypeAction, key: string, generation: number): Promise<boolean> => {
    if (!serverRepository?.command) return Promise.resolve(false)
    const operation = commandQueue.current.then(async () => {
      if (generation !== syncGeneration.current) return false
      try {
        const result = await serverRepository.command!(action, key)
        if (generation !== syncGeneration.current) return false
        pendingActions.current = pendingActions.current.filter(item => item.key !== key)
        if (confirmedRevision.current !== null && result.revision < confirmedRevision.current) {
          setPendingCommands(pendingActions.current.length)
          return true
        }
        confirmedData.current = result.data
        confirmedRevision.current = result.revision
        setPendingCommands(pendingActions.current.length)
        setCommandError(null)
        failedCommand.current = null
        const optimistic = pendingActions.current.reduce((state, item) => prototypeReducer(state, item.action), result.data)
        reduce({ type: 'data/serverSynced', data: optimistic })
        return true
      } catch (error) {
        if (generation !== syncGeneration.current) return false
        syncGeneration.current += 1
        pendingActions.current = []
        failedCommand.current = { action, key }
        setPendingCommands(0)
        setCommandError(error instanceof Error ? error.message : 'The server could not save this change. Refresh and try again.')
        if (confirmedData.current) reduce({ type: 'data/serverSynced', data: confirmedData.current })
        return false
      }
    })
    commandQueue.current = operation.then(() => undefined, () => undefined)
    return operation
  }, [serverRepository])

  const sendServerAction = useCallback((action: PrototypeAction, key: string = crypto.randomUUID()) => {
    pendingActions.current = [...pendingActions.current, { action, key }]
    setPendingCommands(pendingActions.current.length)
    failedCommand.current = null
    setCommandError(null)
    reduce(action)
    runServerCommand(action, key, syncGeneration.current)
  }, [runServerCommand])

  const commitAction = useCallback((action: PrototypeAction): Promise<boolean> => {
    if (!serverRepository?.command) {
      reduce(action)
      return Promise.resolve(true)
    }
    const key = crypto.randomUUID()
    pendingActions.current = [...pendingActions.current, { action, key }]
    setPendingCommands(pendingActions.current.length)
    failedCommand.current = null
    setCommandError(null)
    return runServerCommand(action, key, syncGeneration.current)
  }, [runServerCommand, serverRepository])

  const persistSnapshot = useCallback((snapshot: PrototypeData): Promise<string | null> => {
    if (serverRepository) return Promise.resolve(null)
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
  }, [canPersist, repository, serverRepository])

  const resetToSample = useCallback((): Promise<string | null> => {
    if (serverRepository?.command) {
      if (pendingActions.current.length > 0) return Promise.resolve('Wait for pending server changes to finish before restoring sample records.')
      try {
        const key = crypto.randomUUID()
        const operation = serverRepository.command({ type: 'demo/reset' }, key).then(result => {
          confirmedData.current = result.data
          confirmedRevision.current = result.revision
          failedCommand.current = null
          pendingActions.current = []
          setPendingCommands(0)
          setCommandError(null)
          setStorageWarning(null)
          setCanPersist(true)
          reduce({ type: 'data/serverSynced', data: result.data })
          return null
        }).catch(error => {
          const warning = error instanceof Error ? error.message : 'The server could not restore sample records.'
          setCommandError(warning)
          return warning
        })
        return operation
      } catch (error) {
        return Promise.resolve(error instanceof Error ? error.message : 'The server could not restore sample records.')
      }
    }
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
  }, [repository, clock, serverRepository])

  const dispatch = useCallback((action: PrototypeAction) => {
    if (serverRepository?.command) {
      // Server mode owns dates and validation. The optimistic reducer is replaced by the server result.
      sendServerAction(action)
      return
    }
    if (action.type === 'demo/reset') setCanPersist(true)
    reduce(action)
  }, [sendServerAction, serverRepository])

  const retryCommand = useCallback(() => {
    const failed = failedCommand.current
    if (!failed || !serverRepository) return
    sendServerAction(failed.action, failed.key)
  }, [sendServerAction, serverRepository])

  const refreshFromServer = useCallback(() => {
    if (!serverRepository || pendingActions.current.length > 0) return
    setCommandError(null)
    serverRepository.load().then(snapshot => {
      confirmedData.current = snapshot.data
      confirmedRevision.current = snapshot.revision ?? confirmedRevision.current
      setStorageWarning(snapshot.warning)
      reduce({ type: 'data/serverSynced', data: snapshot.data })
    }).catch(error => {
      setCommandError(error instanceof Error ? error.message : 'The records could not be refreshed.')
    })
  }, [serverRepository])

  if (loadFailed) return <div className="p-6"><ErrorState title="Your records could not be opened" onRetry={() => window.location.reload()} /></div>
  if (!ready) return <div className="p-6"><LoadingState /></div>
  return <PrototypeContext.Provider value={{
    data, dispatch, commitAction, persistSnapshot, resetToSample, storageWarning,
    pendingCommands, commandError, retryCommand, refreshFromServer,
    repositoryMode: serverRepository ? 'server' : 'local',
  }}>
    <ApplicationDateProvider now={now}>
      <OccupancyDateSync>{children}</OccupancyDateSync>
    </ApplicationDateProvider>
  </PrototypeContext.Provider>
}
