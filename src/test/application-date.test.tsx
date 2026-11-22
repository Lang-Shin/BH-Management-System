import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApplicationDateProvider } from '@/app/providers/application-date'
import { useOccupancyDate } from '@/hooks/use-occupancy-date'

function DateProbe() {
  return <p>Occupancy date: {useOccupancyDate()}</p>
}

describe('application occupancy date', () => {
  afterEach(() => vi.useRealTimers())

  it('refreshes date-dependent UI after midnight without a reload', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let current = new Date(2026, 10, 30, 23, 59, 30)
    render(<ApplicationDateProvider now={() => current}><DateProbe /></ApplicationDateProvider>)
    expect(screen.getByText('Occupancy date: 2026-11-30')).toBeInTheDocument()

    current = new Date(2026, 11, 1, 0, 0, 1)
    act(() => vi.advanceTimersByTime(31_000))

    expect(screen.getByText('Occupancy date: 2026-12-01')).toBeInTheDocument()
  })
})
