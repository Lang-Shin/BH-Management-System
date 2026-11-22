import { useEffect, useState, type ReactNode } from 'react'
import { civilDateInTimeZone } from '@/lib/business-date'
import { millisecondsUntilNextBusinessMidnight } from '@/lib/business-date'
import { ApplicationDateContext } from './application-date-context'

export type ApplicationClock = () => Date

const systemClock: ApplicationClock = () => new Date()

/**
 * Keeps date-dependent UI current without reloading. Tests and future adapters can inject a clock
 * instead of changing the machine clock.
 */
export function ApplicationDateProvider({ children, now = systemClock }: {
  children: ReactNode
  now?: ApplicationClock
}) {
  const [occupancyDate, setOccupancyDate] = useState(() => civilDateInTimeZone(now()))

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    function schedule() {
      const current = now()
      const delay = millisecondsUntilNextBusinessMidnight(current)
      timer = setTimeout(() => {
        setOccupancyDate(civilDateInTimeZone(now()))
        schedule()
      }, delay)
    }
    schedule()
    return () => clearTimeout(timer)
  }, [now])

  return <ApplicationDateContext.Provider value={occupancyDate}>{children}</ApplicationDateContext.Provider>
}
