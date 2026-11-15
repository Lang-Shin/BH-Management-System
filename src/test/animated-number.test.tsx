import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnimatedNumber } from '@/components/shared/animated-number'

afterEach(() => { vi.unstubAllGlobals() })

function animationHarness(reduce = false) {
  let now = 0
  let id = 0
  const frames = new Map<number, FrameRequestCallback>()
  let onMotionChange: (() => void) | undefined
  const preference = {
    matches: reduce,
    addEventListener: vi.fn((_type: string, listener: () => void) => { onMotionChange = listener }),
    removeEventListener: vi.fn(),
  }
  vi.stubGlobal('IntersectionObserver', undefined)
  vi.stubGlobal('matchMedia', vi.fn(() => preference))
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.set(++id, callback); return id }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn((frame: number) => frames.delete(frame)))
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  return {
    frames, preference,
    advance(time: number) {
      now = time
      const pending = [...frames.values()]
      frames.clear()
      act(() => pending.forEach(callback => callback(now)))
    },
    reduceMotion() { act(() => { preference.matches = true; onMotionChange?.() }) },
  }
}

describe('animated numeric values', () => {
  it('counts currency from zero to the exact amount while keeping accessible text stable', () => {
    const animation = animationHarness()
    const { container } = render(<AnimatedNumber value="₱33,086.00" />)
    const visual = container.querySelector('.animated-number-visual')!
    expect(visual).toHaveAttribute('data-value', '₱0.00')
    expect(visual).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('₱33,086.00')).toHaveClass('animated-number-final')
    animation.advance(600)
    const intermediate = Number(visual.getAttribute('data-value')!.replace(/[₱,]/g, ''))
    expect(intermediate).toBeGreaterThan(0)
    expect(intermediate).toBeLessThan(33086)
    expect(container).toHaveTextContent(/^₱33,086.00$/)
    animation.advance(1200)
    expect(visual).toHaveAttribute('data-value', '₱33,086.00')
    expect(animation.frames.size).toBe(0)
  })

  it.each([
    ['49.3%', '0.0%'], ['12.125 kWh', '0.000 kWh'], ['-123.50', '0.00'], [6, '0'],
  ])('preserves the formatting of %s', (value, zero) => {
    const animation = animationHarness()
    const { container } = render(<AnimatedNumber value={value} />)
    const visual = container.querySelector('.animated-number-visual')!
    expect(visual).toHaveAttribute('data-value', zero)
    animation.advance(1200)
    expect(visual).toHaveAttribute('data-value', String(value))
  })

  it('waits until an off-screen value is revealed before counting', () => {
    const animation = animationHarness()
    let onIntersect: ((entries: { isIntersecting: boolean }[]) => void) | undefined
    const disconnect = vi.fn()
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: typeof onIntersect) { onIntersect = callback }
      observe = vi.fn()
      disconnect = disconnect
    })
    const { container } = render(<AnimatedNumber value={100} />)
    expect(animation.frames.size).toBe(0)
    act(() => onIntersect?.([{ isIntersecting: false }]))
    expect(animation.frames.size).toBe(0)
    act(() => onIntersect?.([{ isIntersecting: true }]))
    animation.advance(600)
    expect(container.querySelector('[data-value]')).not.toHaveAttribute('data-value', '0')
    animation.advance(1200)
    expect(container.querySelector('[data-value]')).toHaveAttribute('data-value', '100')
    expect(disconnect).toHaveBeenCalled()
  })

  it('shows final values immediately for reduced motion', () => {
    const animation = animationHarness(true)
    const { container, rerender } = render(<AnimatedNumber value="₱33,086.00" />)
    expect(container.querySelector('[data-value]')).toHaveAttribute('data-value', '₱33,086.00')
    rerender(<AnimatedNumber value="₱16,300.00" />)
    expect(container.querySelector('[data-value]')).toHaveAttribute('data-value', '₱16,300.00')
    expect(animation.frames.size).toBe(0)
  })

  it('settles immediately if reduced motion is enabled during an animation', () => {
    const animation = animationHarness()
    const { container } = render(<AnimatedNumber value="66.7%" />)
    animation.advance(300)
    animation.reduceMotion()
    expect(container.querySelector('[data-value]')).toHaveAttribute('data-value', '66.7%')
    expect(animation.frames.size).toBe(0)
  })

  it('restarts for a changed value, keeps the latest target and cancels on unmount', () => {
    const animation = animationHarness()
    const { container, rerender, unmount } = render(<AnimatedNumber value={100} />)
    animation.advance(300)
    rerender(<AnimatedNumber value={200} />)
    expect(container.querySelector('[data-value]')).toHaveAttribute('data-value', '0')
    animation.advance(1500)
    expect(container.querySelector('[data-value]')).toHaveAttribute('data-value', '200')
    rerender(<AnimatedNumber value={300} />)
    unmount()
    expect(animation.frames.size).toBe(0)
    expect(animation.preference.removeEventListener).toHaveBeenCalled()
  })
})
