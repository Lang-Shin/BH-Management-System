import type { PrototypeAction } from '@/app/state/actions'
import type { PrototypeData } from '@/domain/types/models'

export interface RepositoryCapabilities {
  clearAllRecords: boolean
}

export interface PrototypeSnapshot {
  data: PrototypeData
  warning: string | null
  canPersist: boolean
  revision?: number
  serverDate?: string
  capabilities?: RepositoryCapabilities
}

export interface PrototypeCommandResult {
  data: PrototypeData
  revision: number
  replayed: boolean
}

/** Async boundary shared by the browser adapter and the server-authoritative API adapter. */
export interface PrototypeRepository {
  load: () => Promise<PrototypeSnapshot>
  save: (data: PrototypeData) => Promise<string | null>
  mode?: 'local' | 'server'
  command?: (action: PrototypeAction, idempotencyKey?: string) => Promise<PrototypeCommandResult>
  clearAllRecords?: (expectedRevision: number) => Promise<PrototypeCommandResult>
}
