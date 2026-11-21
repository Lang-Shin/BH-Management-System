import { describe, expect, it } from 'vitest'
import { createDemoData, DEMO_DATE, DEMO_PERIOD } from '@/data/fixtures/demo'
import { buildRoomPaymentQuote, prepareRoomPayment } from '@/domain/calculations/room-payment'
import { latestSettledReading } from '@/domain/calculations/electricity-calculation'
import { isPrototypeData } from '@/domain/validation/prototype-data'

const base = { periodId: DEMO_PERIOD, asOf: DEMO_DATE }

describe('room-based checkbox payment calculator', () => {
  it('derives rent, duo water, optional washing, and pending electricity without manual amounts', () => {
    const data = createDemoData()
    const quote = buildRoomPaymentQuote(data, { ...base, roomId: 'room-4', selected: [], electricityReadingMilliKwh: null })
    expect(quote.options.find(option => option.category === 'RENT')).toMatchObject({ state: 'SELECTABLE', amountCents: 350_000 })
    expect(quote.options.find(option => option.category === 'WATER')).toMatchObject({ state: 'SELECTABLE', amountCents: 20_000 })
    expect(quote.options.find(option => option.category === 'ELECTRICITY')).toMatchObject({ state: 'AWAITING_READING', amountCents: null })
    expect(quote.options.find(option => option.category === 'WASHING_MACHINE')).toMatchObject({ state: 'UNAVAILABLE', amountCents: null })
    expect(quote.totalCents).toBe(0)
  })

  it('updates the total from selected categories and excludes uncalculated electricity', () => {
    const data = createDemoData()
    const rentAndWater = buildRoomPaymentQuote(data, { ...base, roomId: 'room-4', selected: ['RENT', 'WATER'], electricityReadingMilliKwh: null })
    expect(rentAndWater.totalCents).toBe(370_000)
    expect(rentAndWater.canConfirm).toBe(true)
    const withPendingElectricity = buildRoomPaymentQuote(data, { ...base, roomId: 'room-4', selected: ['RENT', 'WATER', 'ELECTRICITY'], electricityReadingMilliKwh: null })
    expect(withPendingElectricity.totalCents).toBe(370_000)
    expect(withPendingElectricity.pendingElectricity).toBe(true)
    expect(withPendingElectricity.canConfirm).toBe(false)
    const calculated = buildRoomPaymentQuote(data, { ...base, roomId: 'room-4', selected: ['RENT', 'WATER', 'ELECTRICITY'], electricityReadingMilliKwh: 325_000 })
    expect(calculated.totalCents).toBe(402_500)
    expect(calculated.electricity).toMatchObject({ consumptionMilliKwh: 25_000, amountCents: 32_500 })
    expect(calculated.canConfirm).toBe(true)
    const withoutWater = buildRoomPaymentQuote(data, { ...base, roomId: 'room-4', selected: ['RENT', 'ELECTRICITY'], electricityReadingMilliKwh: 325_000 })
    expect(withoutWater.totalCents).toBe(382_500)
  })

  it('uses PHP 3,500 solo rent and PHP 100 solo water', () => {
    const data = createDemoData()
    data.paymentAllocations = data.paymentAllocations.filter(allocation => !['rent-nov-room-1', 'water-nov-tenant-1'].includes(allocation.chargeId))
    const quote = buildRoomPaymentQuote(data, { ...base, roomId: 'room-1', selected: ['RENT', 'WATER'], electricityReadingMilliKwh: null })
    expect(quote.options.find(option => option.category === 'RENT')).toMatchObject({ amountCents: 350_000 })
    expect(quote.options.find(option => option.category === 'WATER')).toMatchObject({ amountCents: 10_000 })
    expect(quote.totalCents).toBe(360_000)
  })

  it('disables already-paid bills and protects a fully settled room', () => {
    const data = createDemoData()
    const quote = buildRoomPaymentQuote(data, { ...base, roomId: 'room-1', selected: ['RENT', 'WATER'], electricityReadingMilliKwh: null })
    expect(quote.options.every(option => ['PAID', 'UNAVAILABLE'].includes(option.state))).toBe(true)
    expect(quote.selected).toEqual([])
    expect(quote.totalCents).toBe(0)
    expect(quote.canConfirm).toBe(false)
  })

  it('keeps an optional unpaid washing charge selectable at PHP 100 per room', () => {
    const data = createDemoData()
    data.paymentAllocations = data.paymentAllocations.filter(allocation => allocation.chargeId !== 'washing-nov-room-1')
    const quote = buildRoomPaymentQuote(data, { ...base, roomId: 'room-1', selected: ['WASHING_MACHINE'], electricityReadingMilliKwh: null })
    expect(quote.options.find(option => option.category === 'WASHING_MACHINE')).toMatchObject({ state: 'SELECTABLE', amountCents: 10_000 })
    expect(quote.totalCents).toBe(10_000)
  })

  it('records a combined room payment once as a room-level transaction and advances electricity', () => {
    const data = createDemoData()
    const before = JSON.stringify(data)
    const result = prepareRoomPayment(data, { ...base, roomId: 'room-4', selected: ['RENT', 'WATER', 'ELECTRICITY'], electricityReadingMilliKwh: 325_000 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(JSON.stringify(data)).toBe(before)
    expect(result.totalCents).toBe(402_500)
    expect(result.payments).toHaveLength(1)
    expect(result.payments[0]).toMatchObject({ scope: 'ROOM', tenantId: null, roomId: 'room-4', method: null, amountCents: 402_500 })
    expect(result.receipts.map(receipt => receipt.receiptNumber)).toEqual(['DEMO-RCT-015'])
    expect(isPrototypeData(result.data)).toBe(true)
    expect(latestSettledReading(result.data, 'meter-room-4')).toMatchObject({ readingMilliKwh: 325_000 })
    expect(result.data.electricityBillObligations.some(item => item.roomId === 'room-4')).toBe(false)
    expect(result.data.charges.filter(charge => charge.category === 'ELECTRICITY' && charge.electricity.meterId === 'meter-room-4')).toHaveLength(1)
    expect(prepareRoomPayment(result.data, { ...base, roomId: 'room-4', selected: ['RENT', 'WATER', 'ELECTRICITY'], electricityReadingMilliKwh: 325_000 })).toEqual({ ok: false, reason: 'NO_SELECTION' })
  })

  it('records electricity alone as one room-level payment', () => {
    const data = createDemoData()
    const result = prepareRoomPayment(data, { ...base, roomId: 'room-4', selected: ['ELECTRICITY'], electricityReadingMilliKwh: 325_000 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.payments).toHaveLength(1)
    expect(result.receipts).toHaveLength(1)
    expect(result.totalCents).toBe(32_500)
  })
})
