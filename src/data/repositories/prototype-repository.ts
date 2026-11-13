import type { PrototypeData } from '@/domain/types/models'

export interface PrototypeSnapshot {
  data: PrototypeData
  warning: string | null
  canPersist: boolean
}

/** Async boundary shared by the browser adapter and a future API adapter. */
export interface PrototypeRepository {
  load: () => Promise<PrototypeSnapshot>
  save: (data: PrototypeData) => Promise<string | null>
}
