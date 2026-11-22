import { createContext } from 'react'
import type { PrototypeData } from '@/domain/types/models'
import type { PrototypeAction } from './actions'

export interface PrototypeContextValue {
  data: PrototypeData
  dispatch: (action: PrototypeAction) => void
  /** Saves an already-validated next snapshot through the shared write queue before success is shown. */
  persistSnapshot: (snapshot: PrototypeData) => Promise<string | null>
  /** Persists and installs the canonical sample dataset as one replace operation. */
  resetToSample: () => Promise<string | null>
  storageWarning: string | null
  /** Server-authoritative mode exposes sync state and safe recovery controls. */
  pendingCommands: number
  commandError: string | null
  retryCommand: () => void
  refreshFromServer: () => void
  repositoryMode: 'local' | 'server'
}

export const PrototypeContext = createContext<PrototypeContextValue | null>(null)
