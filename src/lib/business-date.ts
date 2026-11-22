export const BUSINESS_TIME_ZONE = 'Asia/Manila'

type DatePartType = 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second'

function dateParts(now: Date, timeZone: string, includeTime: boolean): Record<DatePartType, number> {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' as const } : {}),
  })
  const parts = formatter.formatToParts(now)
  const value = (type: DatePartType) => Number(parts.find(part => part.type === type)?.value ?? '0')
  return {
    year: value('year'), month: value('month'), day: value('day'),
    hour: includeTime ? value('hour') : 0, minute: includeTime ? value('minute') : 0, second: includeTime ? value('second') : 0,
  }
}

/** Returns the calendar date in the workspace business timezone, not the machine timezone. */
export function civilDateInTimeZone(now = new Date(), timeZone = BUSINESS_TIME_ZONE): string {
  const parts = dateParts(now, timeZone, false)
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

/** Delay until the next business-timezone midnight, independent of the machine timezone. */
export function millisecondsUntilNextBusinessMidnight(now = new Date(), timeZone = BUSINESS_TIME_ZONE): number {
  const parts = dateParts(now, timeZone, true)
  const current = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  const next = Date.UTC(parts.year, parts.month - 1, parts.day + 1, 0, 0, 0)
  return Math.max(1_000, next - current + 1_000)
}
