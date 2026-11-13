import { createDemoData } from '@/data/fixtures/demo'
import { isPrototypeData, isRecord } from '@/domain/validation/prototype-data'
import type { PrototypeRepository } from './prototype-repository'

export const STORAGE_KEY = 'bhms:prototype:v1'
const SCHEMA_VERSION = 1

export const localStorageRepository: PrototypeRepository = {
  async load() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw === null) return { data: createDemoData(), warning: null, canPersist: true }
      const parsed: unknown = JSON.parse(raw)
      if (!isRecord(parsed) || parsed.version !== SCHEMA_VERSION || !isPrototypeData(parsed.data)) {
        throw new Error('Invalid or unsupported saved demo')
      }
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
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: SCHEMA_VERSION, data }))
      return null
    } catch {
      return 'Browser storage is unavailable or full. Changes work for this session but will not survive a reload. Reset the demo to retry.'
    }
  },
}
