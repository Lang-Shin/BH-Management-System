import { createContext } from 'react'
import type { PrototypeData } from '@/domain/types/models'
import type { PrototypeAction } from './actions'

export interface PrototypeContextValue {
  data: PrototypeData
  dispatch: (action: PrototypeAction) => void
  storageWarning: string | null
}

export const PrototypeContext = createContext<PrototypeContextValue | null>(null)
