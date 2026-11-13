import { createContext, useContext, useEffect, useReducer, useState, type ReactNode } from 'react'
import type { PrototypeAction, PrototypeData } from '@/types/domain'
import { loadPrototype, savePrototype } from './persistence'
import { prototypeReducer } from './reducer'

interface PrototypeContextValue {
  data: PrototypeData
  dispatch: (action: PrototypeAction) => void
  storageWarning: string | null
}

const PrototypeContext = createContext<PrototypeContextValue | null>(null)

export function PrototypeProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(loadPrototype)
  const [data, reduce] = useReducer(prototypeReducer, initial.data)
  const [storageWarning, setStorageWarning] = useState(initial.warning)
  const [canPersist, setCanPersist] = useState(initial.canPersist)

  useEffect(() => {
    if (!canPersist) return
    const warning = savePrototype(data)
    // Storage is an external system; reflect its result for the user.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStorageWarning(warning)
  }, [data, canPersist])

  function dispatch(action: PrototypeAction) {
    if (action.type === 'demo/reset') setCanPersist(true)
    reduce(action)
  }

  return <PrototypeContext.Provider value={{ data, dispatch, storageWarning }}>{children}</PrototypeContext.Provider>
}

export function usePrototype() {
  const context = useContext(PrototypeContext)
  if (!context) throw new Error('usePrototype must be used within PrototypeProvider')
  return context
}
