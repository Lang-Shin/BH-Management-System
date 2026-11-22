import { BUSINESS_TIME_ZONE, civilDateInTimeZone } from '@/lib/business-date'

const DEFAULT_TIME_ZONE = BUSINESS_TIME_ZONE

/** Business dates are civil dates in the workspace timezone, never UTC slices of local time. */
export function businessDate(now = new Date(), timeZone = DEFAULT_TIME_ZONE): string {
  return civilDateInTimeZone(now, timeZone)
}

export function assertTimeZone(value: string | undefined): string {
  if (!value) return DEFAULT_TIME_ZONE
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: value }).format(new Date())
    return value
  } catch {
    return DEFAULT_TIME_ZONE
  }
}
