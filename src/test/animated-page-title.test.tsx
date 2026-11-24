import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnimatedPageTitle } from '@/components/shared/animated-page-title'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

function mockMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: reduce, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
}

describe('header typewriter', () => {
  it('loops through typing, a five-second hold, deletion, a short pause, and retyping while reserving the full title', () => {
    vi.useFakeTimers()
    mockMotion(false)
    const { container, unmount } = render(<AnimatedPageTitle text="Rooms" />)
    const visual = container.querySelector('[data-typed-title]')!
    const reserve = container.querySelector('.header-title-reserve')!
    expect(screen.getByText('Rooms', { selector: '.sr-only' })).toBeInTheDocument()
    expect(reserve).toHaveTextContent('Rooms')
    expect(container.querySelector('.header-title-frame')).toHaveAttribute('aria-hidden', 'true')
    act(() => vi.advanceTimersByTime(179))
    expect(visual).toBeEmptyDOMElement()
    act(() => vi.advanceTimersByTime(1))
    expect(visual).toHaveTextContent(/^R$/)
    act(() => vi.advanceTimersByTime(4 * 95))
    expect(visual).toHaveTextContent(/^Rooms$/)
    act(() => vi.advanceTimersByTime(4_999))
    expect(visual).toHaveTextContent(/^Rooms$/)
    act(() => vi.advanceTimersByTime(1))
    expect(visual).toHaveTextContent(/^Room$/)
    act(() => vi.advanceTimersByTime(4 * 55))
    expect(visual).toBeEmptyDOMElement()
    act(() => vi.advanceTimersByTime(449))
    expect(visual).toBeEmptyDOMElement()
    act(() => vi.advanceTimersByTime(1))
    expect(visual).toHaveTextContent(/^R$/)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('shows the complete title without timers for reduced motion and restarts with a new route title', () => {
    vi.useFakeTimers()
    mockMotion(true)
    const { container, rerender } = render(<AnimatedPageTitle text="Dashboard" />)
    expect(container.querySelector('[data-typed-title]')).toHaveTextContent('Dashboard')
    expect(container.querySelector('.header-title-reserve')).toHaveTextContent('Dashboard')
    expect(vi.getTimerCount()).toBe(0)
    rerender(<AnimatedPageTitle text="My Payments & Receipts" />)
    expect(container.querySelector('[data-typed-title]')).toHaveTextContent('My Payments & Receipts')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels the previous title timer when the route changes', () => {
    vi.useFakeTimers()
    mockMotion(false)
    const { container, rerender } = render(<AnimatedPageTitle text="Rooms" />)
    const visual = container.querySelector('[data-typed-title]')!
    act(() => vi.advanceTimersByTime(180 + 3 * 95))
    expect(visual).toHaveTextContent(/^Room$/)
    rerender(<AnimatedPageTitle text="Billing" />)
    expect(visual).toBeEmptyDOMElement()
    act(() => vi.advanceTimersByTime(180 + 6 * 95))
    expect(visual).toHaveTextContent(/^Billing$/)
    expect(vi.getTimerCount()).toBe(1)
  })
})
