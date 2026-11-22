import { isIsoDate } from '@/domain/validation/date'

const pesoFormatter = new Intl.NumberFormat('en-PH', {
  style: 'currency', currency: 'PHP', minimumFractionDigits: 2, maximumFractionDigits: 2,
})
const dateFormatter = new Intl.DateTimeFormat('en', {
  month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
})
const monthFormatter = new Intl.DateTimeFormat('en', {
  month: 'long', year: 'numeric', timeZone: 'UTC',
})
const shortDateFormatter = new Intl.DateTimeFormat('en', {
  month: 'short', day: 'numeric', timeZone: 'UTC',
})

export function formatMoney(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError('Currency formatting requires safe integer centavos')
  return pesoFormatter.format(cents / 100)
}

export function formatDate(date: string): string {
  if (!isIsoDate(date)) return 'Invalid date'
  return dateFormatter.format(new Date(`${date}T00:00:00Z`))
}

export function formatMonthYear(date: string): string {
  if (!isIsoDate(date)) return 'Invalid date'
  return monthFormatter.format(new Date(`${date}T00:00:00Z`))
}

/** Short visible dates intentionally omit the year; full ISO dates remain authoritative elsewhere. */
export function formatShortDate(date: string): string {
  if (!isIsoDate(date)) return 'Invalid date'
  return shortDateFormatter.format(new Date(`${date}T00:00:00Z`))
}

export function previousCalendarDate(date: string): string {
  if (!isIsoDate(date)) return 'Invalid date'
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() - 1)
  return value.toISOString().slice(0, 10)
}

/** Formats an inclusive-start/exclusive-end anniversary period without visible years. */
export function formatShortDateRange(startDate: string, endDateExclusive: string): string {
  return `${formatShortDate(startDate)} – ${formatShortDate(previousCalendarDate(endDateExclusive))}`
}
