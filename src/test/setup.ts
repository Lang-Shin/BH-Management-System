import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { createDemoData } from '@/data/fixtures/demo'
import { STORAGE_SCHEMA_VERSION } from '@/data/repositories/prototype-storage'

const TEST_STORAGE_KEY = 'bhms:prototype:v1'

// Existing UI tests intentionally exercise the fictional fixture. Production startup never uses it.
beforeEach(() => {
  if (typeof window !== 'undefined' && window.localStorage.getItem(TEST_STORAGE_KEY) === null) {
    window.localStorage.setItem(TEST_STORAGE_KEY, JSON.stringify({ version: STORAGE_SCHEMA_VERSION, data: createDemoData() }))
  }
})

afterEach(() => {
  if (typeof window !== 'undefined') {
    cleanup()
    localStorage.clear()
    sessionStorage.clear()
  }
  vi.restoreAllMocks()
})
if (typeof window !== 'undefined') Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true })

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!('ResizeObserver' in globalThis)) {
  Object.defineProperty(globalThis, 'ResizeObserver', { value: ResizeObserverMock, writable: true })
}
