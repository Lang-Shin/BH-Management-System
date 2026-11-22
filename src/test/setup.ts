import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

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
