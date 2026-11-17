import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks() })
Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true })

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// jsdom lacks the pointer-capture and scroll APIs that Radix Select relies on.
const elementPrototype = Element.prototype as unknown as Record<string, unknown>
elementPrototype.hasPointerCapture ??= () => false
elementPrototype.setPointerCapture ??= () => {}
elementPrototype.releasePointerCapture ??= () => {}
elementPrototype.scrollIntoView ??= () => {}

if (!('ResizeObserver' in globalThis)) {
  Object.defineProperty(globalThis, 'ResizeObserver', { value: ResizeObserverMock, writable: true })
}
