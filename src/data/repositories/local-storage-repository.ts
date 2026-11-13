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
        warning: 'Saved demo data could not be loaded. Fresh sample data is shown in memory. Reset the demo to replace saved data and retry persistence.',
        canPersist: false,
      }
    }
  },
  async save(data) {
    if (!isPrototypeData(data)) {
      return 'Demo changes failed validation. Previously saved data was left unchanged. Reset the demo to recover.'
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_SCHEMA_VERSION, data }))
      return null
    } catch {
      return 'Browser storage is unavailable or full. Changes work for this session but will not survive a reload. Reset the demo to retry.'
    }
  },
}
