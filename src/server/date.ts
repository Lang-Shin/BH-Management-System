const DEFAULT_TIME_ZONE = 'Asia/Manila'

/** Business dates are civil dates in the workspace timezone, never UTC slices of local time. */
export function businessDate(now = new Date(), timeZone = DEFAULT_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
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
