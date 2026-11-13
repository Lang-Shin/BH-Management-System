import { isIsoDate } from '@/domain/validation/date'

const pesoFormatter = new Intl.NumberFormat('en-PH', {
  style: 'currency', currency: 'PHP', minimumFractionDigits: 2, maximumFractionDigits: 2,
})
const dateFormatter = new Intl.DateTimeFormat('en', {
  month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
})

export function formatMoney(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError('Currency formatting requires safe integer centavos')
  return pesoFormatter.format(cents / 100)
}

export function formatDate(date: string): string {
  if (!isIsoDate(date)) return 'Invalid date'
  return dateFormatter.format(new Date(`${date}T00:00:00Z`))
}
