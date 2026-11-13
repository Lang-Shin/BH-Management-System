import { describe, expect, it } from 'vitest'
import { formatDate, formatMoney } from './format'

describe('PHP currency formatting', () => {
  it.each([
    [0, '₱0.00'], [1, '₱0.01'], [99, '₱0.99'], [15_600, '₱156.00'],
    [3_308_600, '₱33,086.00'], [-12_550, '-₱125.50'],
  ])('formats %i integer centavos as %s', (cents, expected) => {
    expect(formatMoney(cents)).toBe(expected)
  })

  it.each([NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid centavo input %s', value => {
    expect(() => formatMoney(value)).toThrow(RangeError)
  })
})

describe('date-only formatting', () => {
  it('formats fixed dates and valid leap days without local timezone shifts', () => {
    expect(formatDate('2026-11-13')).toBe('Nov 13, 2026')
    expect(formatDate('2028-02-29')).toBe('Feb 29, 2028')
  })

  it.each(['2026-02-30', '2026-02-29', '2026-13-01', '13/11/2026', '2026-11-13T12:00:00Z', ''])('does not silently normalize invalid date %s', date => {
    expect(formatDate(date)).toBe('Invalid date')
  })
})
