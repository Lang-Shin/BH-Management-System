import { createDemoData } from '@/data/fixtures/demo'
import { isPrototypeData } from '@/domain/validation/prototype-data'
import type { PrototypeRepository } from './prototype-repository'
import { parsePrototypeSnapshot, STORAGE_SCHEMA_VERSION } from './prototype-storage'

export const STORAGE_KEY = 'bhms:prototype:v1'
// Keep the key so old snapshots trigger explicit recovery rather than vanish.

export const localStorageRepository: PrototypeRepository = {
  async load() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw === null) return { data: createDemoData(), warning: null, canPersist: true }
      const parsed = parsePrototypeSnapshot(raw)
      if (!parsed.ok) throw new Error(parsed.reason)
      return { data: parsed.data, warning: null, canPersist: true }
    } catch {
      return {
        data: createDemoData(),
        warning: 'Your saved sample records could not be opened. Fresh sample records are shown for now. In Reports & Settings, choose “Restore sample records” to start again.',
        canPersist: false,
      }
    }
  },
  async save(data) {
    if (!isPrototypeData(data)) {
      return 'Your changes could not be saved because a record needs checking. Previously saved records have not been changed. Open Reports & Settings for help.'
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_SCHEMA_VERSION, data }))
      return null
    } catch {
      return 'Your changes could not be saved in this browser. You can keep using this page, but your latest changes will be lost when it closes.'
    }
  },
}
