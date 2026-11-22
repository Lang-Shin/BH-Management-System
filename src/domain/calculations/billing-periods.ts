import type { BillingPeriod, PrototypeAppState } from '@/domain/types/models'
import { dateParts, formatCivilDate } from './rental-periods'

const CALENDAR_START_YEAR = 2026
const CALENDAR_START_MONTH = 1
const monthFormatter = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' })

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function periodId(year: number, month: number): string {
  return `period-${year}-${String(month).padStart(2, '0')}`
}

function periodForMonth(year: number, month: number, open: boolean): BillingPeriod {
  return {
    id: periodId(year, month),
    label: monthFormatter.format(new Date(Date.UTC(year, month - 1, 1))),
    startDate: formatCivilDate(year, month, 1),
    endDate: formatCivilDate(year, month, daysInMonth(year, month)),
    status: open ? 'OPEN' : 'CLOSED',
  }
}

export function calendarBillingPeriodForDate(date: string, open = true): BillingPeriod {
  const parts = dateParts(date)
  return periodForMonth(parts.year, parts.month, open)
}

/** Calendar months from January 2026 through the month containing asOf. */
export function calendarBillingPeriods(data: PrototypeAppState, asOf: string): BillingPeriod[] {
  const parts = dateParts(asOf)
  const result: BillingPeriod[] = []
  let year = CALENDAR_START_YEAR
  let month = CALENDAR_START_MONTH
  while (year < parts.year || (year === parts.year && month <= parts.month)) {
    const generated = periodForMonth(year, month, year === parts.year && month === parts.month)
    const existing = data.billingPeriods.find(item => item.startDate === generated.startDate && item.endDate === generated.endDate)
    result.push(existing ?? generated)
    if (month === 12) { year += 1; month = 1 } else { month += 1 }
  }
  return result
}

export function resolveBillingPeriod(data: PrototypeAppState, periodIdOrDate: string): BillingPeriod | undefined {
  const existing = data.billingPeriods.find(item => item.id === periodIdOrDate)
  if (existing) return existing
  if (/^\d{4}-\d{2}-\d{2}$/.test(periodIdOrDate)) return calendarBillingPeriodForDate(periodIdOrDate)
  const match = /^period-(\d{4})-(\d{2})$/.exec(periodIdOrDate)
  if (!match) return undefined
  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12 || year < CALENDAR_START_YEAR) return undefined
  return periodForMonth(year, month, true)
}

export function billingPeriodForDate(data: PrototypeAppState, date: string): BillingPeriod {
  return data.billingPeriods.find(period => period.startDate <= date && period.endDate >= date)
    ?? calendarBillingPeriodForDate(date)
}

export function ensureBillingPeriod(data: PrototypeAppState, period: BillingPeriod): PrototypeAppState {
  if (data.billingPeriods.some(item => item.id === period.id)) return data
  if (data.billingPeriods.some(item => item.startDate === period.startDate && item.endDate === period.endDate)) return data
  return { ...data, billingPeriods: [...data.billingPeriods, period] }
}

export function ensureBillingPeriodForDate(data: PrototypeAppState, date: string): { data: PrototypeAppState; period: BillingPeriod } {
  const existing = data.billingPeriods.find(period => period.startDate <= date && period.endDate >= date)
  if (existing) return { data, period: existing }
  const period = calendarBillingPeriodForDate(date)
  return { data: ensureBillingPeriod(data, period), period }
}

/** Adds every calendar month from January 2026 through asOf when no period already covers it. */
export function ensureBillingPeriodsThrough(data: PrototypeAppState, asOf: string): PrototypeAppState {
  let next = data
  for (const period of calendarBillingPeriods(data, asOf)) {
    next = ensureBillingPeriod(next, period)
  }
  return next
}

export function currentBillingPeriodId(data: PrototypeAppState, asOf: string): string {
  return billingPeriodForDate(data, asOf).id
}
