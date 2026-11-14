import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnimatedPageTitle } from '@/components/shared/animated-page-title'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

function mockMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: reduce, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
}

describe('header typewriter', () => {
  it('types, holds the completed title for five seconds, erases one character at a time, and repeats', () => {
    vi.useFakeTimers()
    mockMotion(false)
    const { container, unmount } = render(<AnimatedPageTitle text="Rooms" />)
    const visual = container.querySelector('[data-typed-title]')!
    expect(screen.getByText('Rooms', { selector: '.sr-only' })).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(180))
    expect(visual).toHaveTextContent(/^R$/)
    act(() => vi.advanceTimersByTime(4 * 95))
    expect(visual).toHaveTextContent(/^Rooms$/)
    act(() => vi.advanceTimersByTime(4999))
    expect(visual).toHaveTextContent(/^Rooms$/)
    act(() => vi.advanceTimersByTime(1))
    expect(visual).toHaveTextContent(/^Room$/)
    act(() => vi.advanceTimersByTime(4 * 55))
    expect(visual).toBeEmptyDOMElement()
    act(() => vi.advanceTimersByTime(450))
    expect(visual).toHaveTextContent(/^R$/)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('shows a static full title for reduced motion and updates it when the route changes', () => {
    vi.useFakeTimers()
    mockMotion(true)
    const { container, rerender } = render(<AnimatedPageTitle text="Dashboard" />)
    expect(container.querySelector('[data-typed-title]')).toHaveTextContent('Dashboard')
    expect(vi.getTimerCount()).toBe(0)
    rerender(<AnimatedPageTitle text="Tenants" />)
    expect(container.querySelector('[data-typed-title]')).toHaveTextContent('Tenants')
    expect(vi.getTimerCount()).toBe(0)
  })
})
