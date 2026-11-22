import { describe, expect, it } from 'vitest'
import { createDemoData, DEMO_DATE, DEMO_PERIOD } from '@/data/fixtures/demo'
import { calculateElectricityCharge, latestSettledReading, parseMeterReadingMilliKwh } from '@/domain/calculations/electricity-calculation'
import { prepareElectricityPayment } from '@/domain/calculations/electricity-payment'
import { rentDueForTenant, rentPaymentError } from '@/domain/calculations/payment-rules'
import { roomHasPending, roomPaymentStatus, selectRoomFinance } from '@/domain/calculations/room-finance'
import { chargePaid } from '@/domain/calculations/summary'
import { isPrototypeData } from '@/domain/validation/prototype-data'

describe('owner payment rules', () => {
  it('accepts blank or full rent and rejects partial rent', () => {
    const data = createDemoData()
    expect(rentDueForTenant(data, 'tenant-5', DEMO_PERIOD, DEMO_DATE)).toBe(350_000)
    expect(rentPaymentError(data, 'tenant-5', DEMO_PERIOD, 0, DEMO_DATE)).toBeNull()
    expect(rentPaymentError(data, 'tenant-5', DEMO_PERIOD, 200_000, DEMO_DATE)).toContain('must be paid in full: ₱3,500.00')
    expect(rentPaymentError(data, 'tenant-5', DEMO_PERIOD, 350_000, DEMO_DATE)).toBeNull()
    expect(rentPaymentError(data, 'tenant-2', DEMO_PERIOD, 100, DEMO_DATE)).toContain('No unpaid room rent')
  })

  it('contains no partially settled rent allocation', () => {
    const data = createDemoData()
    for (const charge of data.charges.filter(item => item.category === 'RENT')) {
      const paid = chargePaid(data, charge.id, DEMO_DATE)
      expect(paid === 0 || paid === charge.amountCents).toBe(true)
    }
  })

  it('parses supported meter-reading precision without floating-point arithmetic', () => {
    expect(parseMeterReadingMilliKwh('325')).toBe(325_000)
    expect(parseMeterReadingMilliKwh('325.125')).toBe(325_125)
    expect(parseMeterReadingMilliKwh('325.1250')).toBeNull()
    expect(parseMeterReadingMilliKwh('-1')).toBeNull()
    expect(parseMeterReadingMilliKwh('abc')).toBeNull()
    expect(parseMeterReadingMilliKwh('')).toBeNull()
  })

  it('retrieves the cumulative baseline and charges all consumption since it', () => {
    const data = createDemoData()
    expect(latestSettledReading(data, 'meter-room-4')).toMatchObject({ id: 'reading-room-4-sep', readingMilliKwh: 300_000, readOn: '2026-09-30' })
    const result = calculateElectricityCharge(data, 'electricity-nov-room-4-awaiting', { readingMilliKwh: 325_000, readOn: DEMO_DATE })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.charge).toMatchObject({
      category: 'ELECTRICITY', amountCents: 32_500,
      electricity: {
        intervalId: 'meter-room-4:reading-room-4-sep>325000', previousReadingMilliKwh: 300_000,
        currentReadingMilliKwh: 325_000, consumptionMilliKwh: 25_000, appliedRateCentsPerKwh: 1_300,
      },
    })
  })

  it('rejects lower and non-advancing readings without creating a bill', () => {
    const data = createDemoData()
    expect(calculateElectricityCharge(data, 'electricity-nov-room-4-awaiting', { readingMilliKwh: 299_000, readOn: DEMO_DATE })).toEqual({ ok: false, reason: 'READING_BELOW_PREVIOUS' })
    expect(calculateElectricityCharge(data, 'electricity-nov-room-4-awaiting', { readingMilliKwh: 300_000, readOn: DEMO_DATE })).toEqual({ ok: false, reason: 'READING_NOT_ADVANCED' })
    expect(data.charges.some(charge => charge.category === 'ELECTRICITY' && charge.id.includes('room-4'))).toBe(false)
  })

  it('preserves the rate used for the confirmed interval when the current rate later changes', () => {
    const data = createDemoData()
    data.electricityRates.push({ id: 'rate-future', label: 'Future sample rate', rateCentsPerKwh: 1_400, effectiveFrom: '2026-12-01', recordedOn: DEMO_DATE })
    const result = calculateElectricityCharge(data, 'electricity-nov-room-4-awaiting', { readingMilliKwh: 325_000, readOn: DEMO_DATE })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.charge.electricity).toMatchObject({ rateId: 'rate-nov', appliedRateCentsPerKwh: 1_300, appliedRateEffectiveFrom: '2026-11-01' })
    expect(result.charge.amountCents).toBe(32_500)
  })

  it('confirms one payment, advances the baseline, and prevents duplicate intervals', () => {
    const data = createDemoData()
    const before = JSON.stringify(data)
    const result = prepareElectricityPayment(data, 'electricity-nov-room-4-awaiting', 325_000, DEMO_DATE)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(JSON.stringify(data)).toBe(before)
    expect(result.payment).toMatchObject({ amountCents: 32_500, tenantId: 'tenant-5' })
    expect(result.receipt).toMatchObject({ receiptNumber: 'BHMS-RCT-015', amountCents: 32_500 })
    expect(isPrototypeData(result.data)).toBe(true)
    expect(result.data.electricityBillObligations.some(item => item.id === 'electricity-nov-room-4-awaiting')).toBe(false)
    expect(latestSettledReading(result.data, 'meter-room-4')).toMatchObject({ readingMilliKwh: 325_000 })
    expect(result.data.charges.filter(charge => charge.category === 'ELECTRICITY' && charge.electricity.intervalId.includes('meter-room-4'))).toHaveLength(1)
    expect(result.data.payments.filter(payment => payment.id === result.payment.id)).toHaveLength(1)
    expect(prepareElectricityPayment(result.data, 'electricity-nov-room-4-awaiting', 325_000, DEMO_DATE)).toEqual({ ok: false, reason: 'OBLIGATION_NOT_FOUND' })
  })

  it('derives room status from settled categories and unresolved obligations', () => {
    const data = createDemoData()
    const paid = data.charges.find(charge => charge.id === 'rent-nov-room-1')!
    const unpaid = data.charges.find(charge => charge.id === 'rent-nov-room-4')!
    expect(roomPaymentStatus(data, [], 0, DEMO_DATE)).toBe('NO_BILLS')
    expect(roomPaymentStatus(data, [unpaid], 0, DEMO_DATE)).toBe('NOT_YET_PAID')
    expect(roomPaymentStatus(data, [paid, unpaid], 0, DEMO_DATE)).toBe('PARTLY_PAID')
    expect(roomPaymentStatus(data, [paid], 0, DEMO_DATE)).toBe('PAID')
    expect(roomPaymentStatus(data, [paid], 1, DEMO_DATE)).toBe('PARTLY_PAID')
    expect(roomPaymentStatus(data, [], 1, DEMO_DATE)).toBe('NOT_YET_PAID')
  })

  it('reports unresolved electricity separately from known money', () => {
    const data = createDemoData()
    const partly = selectRoomFinance(data, DEMO_DATE, DEMO_PERIOD).find(item => item.id === 'room-2')!
    expect(partly).toMatchObject({ billed: 380_000, paid: 380_000, outstanding: 0, unresolved: 1, paymentStatus: 'PARTLY_PAID' })
    expect(roomHasPending(partly)).toBe(true)
    const unpaid = selectRoomFinance(data, DEMO_DATE, DEMO_PERIOD).find(item => item.id === 'room-4')!
    expect(unpaid).toMatchObject({ billed: 370_000, paid: 0, outstanding: 370_000, unresolved: 1, paymentStatus: 'NOT_YET_PAID' })
    expect(roomHasPending({ outstanding: 0, unresolved: 0 })).toBe(false)
    expect(data.charges.some(charge => charge.category === 'ELECTRICITY' && charge.id.includes('room-4'))).toBe(false)
  })
})
