import { useEffect, useState, type ReactNode } from 'react'
import { resolveOccupancyDate } from '@/data/fixtures/demo'
import { ApplicationDateContext } from './application-date-context'

export type ApplicationClock = () => Date

const systemClock: ApplicationClock = () => new Date()

function nextMidnight(date: Date): Date {
  const next = new Date(date)
  next.setHours(24, 0, 0, 0)
  return next
}

/**
 * Keeps date-dependent UI current without reloading. Tests and future adapters can inject a clock
 * instead of changing the machine clock.
 */
export function ApplicationDateProvider({ children, now = systemClock }: {
  children: ReactNode
  now?: ApplicationClock
}) {
  const [occupancyDate, setOccupancyDate] = useState(() => resolveOccupancyDate(now()))

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    function schedule() {
      const current = now()
      const delay = Math.max(1_000, nextMidnight(current).getTime() - current.getTime() + 1_000)
      timer = setTimeout(() => {
        setOccupancyDate(resolveOccupancyDate(now()))
        schedule()
      }, delay)
    }
    schedule()
    return () => clearTimeout(timer)
  }, [now])

  return <ApplicationDateContext.Provider value={occupancyDate}>{children}</ApplicationDateContext.Provider>
}
