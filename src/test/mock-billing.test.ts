import { describe, expect, it } from 'vitest'
import { createDemoData, DEMO_DATE, DEMO_PERIOD, DEMO_RATES } from '@/data/fixtures/demo'
import { roomOccupants } from '@/domain/calculations/summary'
import { chargeRoom } from '@/domain/calculations/room-finance'
import type { ChargeCategory, PrototypeAppState } from '@/domain/types/models'

function chargesFor(data: PrototypeAppState, periodId: string, roomId: string, category: ChargeCategory) {
  return data.charges.filter(charge => charge.billingPeriodId === periodId && charge.category === category && chargeRoom(data, charge).id === roomId)
}

describe('standardized demonstration billing', () => {
  it('charges one PHP 3,500 rent per occupied room, including solo and duo rooms', () => {
    const data = createDemoData()
    expect(roomOccupants(data, 'room-1', DEMO_DATE)).toHaveLength(1)
    expect(roomOccupants(data, 'room-2', DEMO_DATE)).toHaveLength(2)
    expect(chargesFor(data, DEMO_PERIOD, 'room-1', 'RENT')).toMatchObject([{ amountCents: 350_000 }])
    expect(chargesFor(data, DEMO_PERIOD, 'room-2', 'RENT')).toMatchObject([{ amountCents: 350_000 }])
    expect(chargesFor(data, DEMO_PERIOD, 'room-2', 'RENT')).toHaveLength(1)
  })

  it('never creates more than one rent charge for a room and period', () => {
    const data = createDemoData()
    for (const periodId of ['period-oct', DEMO_PERIOD]) {
      const keys = data.charges.filter(charge => charge.billingPeriodId === periodId && charge.category === 'RENT')
        .map(charge => chargeRoom(data, charge).id)
      expect(new Set(keys).size).toBe(keys.length)
      expect(keys.length).toBe(new Set(data.rooms.filter(room => roomOccupants(data, room.id, periodId === 'period-oct' ? '2026-10-15' : DEMO_DATE).length > 0).map(room => room.id)).size)
    }
  })

  it('charges historical and current water per occupant', () => {
    const data = createDemoData()
    expect(chargesFor(data, 'period-oct', 'room-1', 'WATER').reduce((sum, charge) => sum + charge.amountCents, 0)).toBe(10_000)
    expect(chargesFor(data, 'period-oct', 'room-2', 'WATER').reduce((sum, charge) => sum + charge.amountCents, 0)).toBe(20_000)
    expect(chargesFor(data, DEMO_PERIOD, 'room-1', 'WATER').reduce((sum, charge) => sum + charge.amountCents, 0)).toBe(10_000)
    expect(chargesFor(data, DEMO_PERIOD, 'room-2', 'WATER').reduce((sum, charge) => sum + charge.amountCents, 0)).toBe(20_000)
    expect(data.charges.filter(charge => charge.category === 'WATER').every(charge => charge.amountCents === DEMO_RATES.waterCentsPerTenant)).toBe(true)
  })

  it('calculates room electricity from reading differences at PHP 13 per kWh', () => {
    const data = createDemoData()
    expect(chargesFor(data, 'period-oct', 'room-1', 'ELECTRICITY')).toMatchObject([{ amountCents: 15_600 }])
    expect(chargesFor(data, DEMO_PERIOD, 'room-2', 'ELECTRICITY')).toMatchObject([{ amountCents: 14_300 }])
    for (const charge of data.charges.filter(item => item.category === 'ELECTRICITY')) {
      expect(charge.electricity.consumptionMilliKwh).toBe(charge.electricity.currentReadingMilliKwh - charge.electricity.previousReadingMilliKwh)
      expect(charge.electricity.appliedRateCentsPerKwh).toBe(1_300)
      expect(charge.amountCents).toBe(charge.electricity.consumptionMilliKwh * 1_300 / 1000)
    }
  })

  it('keeps meter readings chronological and continuous per room', () => {
    const data = createDemoData()
    for (const meter of data.electricityMeters) {
      const readings = data.meterReadings.filter(reading => reading.meterId === meter.id).sort((a, b) => a.readOn.localeCompare(b.readOn))
      expect(readings.length).toBeGreaterThanOrEqual(2)
      for (let index = 1; index < readings.length; index++) {
        expect(readings[index]!.readOn > readings[index - 1]!.readOn).toBe(true)
        expect(readings[index]!.readingMilliKwh).toBeGreaterThan(readings[index - 1]!.readingMilliKwh)
      }
    }
  })

  it('applies one optional PHP 100 washing charge only where enabled', () => {
    const data = createDemoData()
    expect(chargesFor(data, DEMO_PERIOD, 'room-1', 'WASHING_MACHINE')).toMatchObject([{ amountCents: 10_000 }])
    expect(chargesFor(data, DEMO_PERIOD, 'room-2', 'WASHING_MACHINE')).toMatchObject([{ amountCents: 10_000 }])
    expect(chargesFor(data, DEMO_PERIOD, 'room-3', 'WASHING_MACHINE')).toEqual([])
    expect(chargesFor(data, DEMO_PERIOD, 'room-4', 'WASHING_MACHINE')).toEqual([])
    expect(chargesFor(data, 'period-oct', 'room-5', 'WASHING_MACHINE')).toHaveLength(1)
    expect(chargesFor(data, 'period-oct', 'room-5', 'WASHING_MACHINE')[0]?.amountCents).toBe(10_000)
  })

  it('uses PHP 3,500 original rent in both historical and current periods', () => {
    const data = createDemoData()
    for (const charge of data.charges.filter(item => item.category === 'RENT')) {
      expect(charge.amountCents).toBe(350_000)
      expect(charge.agreedRentCents).toBe(350_000)
    }
    expect(chargesFor(data, 'period-oct', 'room-1', 'RENT')).toHaveLength(1)
    expect(chargesFor(data, DEMO_PERIOD, 'room-1', 'RENT')).toHaveLength(1)
  })

  it('is deterministic across fresh fixture creation', () => {
    expect(createDemoData()).toEqual(createDemoData())
  })
})
