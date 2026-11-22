import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApplicationDateProvider } from '@/app/providers/application-date'
import { resolveOccupancyDate } from '@/data/fixtures/demo'
import { useOccupancyDate } from '@/hooks/use-occupancy-date'

function DateProbe() {
  return <p>Occupancy date: {useOccupancyDate()}</p>
}

describe('application occupancy date', () => {
  afterEach(() => vi.useRealTimers())

  it('uses Asia/Manila business dates before the demo clamp', () => {
    expect(resolveOccupancyDate(new Date('2026-11-12T15:59:59Z'))).toBe('2026-11-13')
    expect(resolveOccupancyDate(new Date('2026-11-30T15:59:59Z'))).toBe('2026-11-30')
    expect(resolveOccupancyDate(new Date('2026-11-30T16:00:00Z'))).toBe('2026-12-01')
  })

  it('refreshes date-dependent UI after Manila midnight without a reload', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let current = new Date('2026-11-30T15:59:30Z') // 23:59:30 in Asia/Manila
    render(<ApplicationDateProvider now={() => current}><DateProbe /></ApplicationDateProvider>)
    expect(screen.getByText('Occupancy date: 2026-11-30')).toBeInTheDocument()

    current = new Date('2026-11-30T16:00:01Z') // 00:00:01 in Asia/Manila
    act(() => vi.advanceTimersByTime(31_000))

    expect(screen.getByText('Occupancy date: 2026-12-01')).toBeInTheDocument()
  })
})
