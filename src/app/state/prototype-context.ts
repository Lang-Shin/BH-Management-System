import { createContext } from 'react'
import type { PrototypeData } from '@/domain/types/models'
import type { PrototypeAction } from './actions'

export interface PrototypeContextValue {
  data: PrototypeData
  dispatch: (action: PrototypeAction) => void
  /** Applies a local action or waits for authoritative server confirmation before returning true. */
  commitAction: (action: PrototypeAction) => Promise<boolean>
  /** Saves an already-validated next snapshot through the shared write queue before success is shown. */
  persistSnapshot: (snapshot: PrototypeData) => Promise<string | null>
  /** Clears transactional records while preserving room configuration. */
  clearAllRecords: () => Promise<string | null>
  canClearRecords: boolean
  storageWarning: string | null
  /** Server-authoritative mode exposes sync state and safe recovery controls. */
  pendingCommands: number
  commandError: string | null
  retryCommand: () => void
  refreshFromServer: () => void
  repositoryMode: 'local' | 'server'
}

export const PrototypeContext = createContext<PrototypeContextValue | null>(null)
