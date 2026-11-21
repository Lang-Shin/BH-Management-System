import { describe, expect, it } from 'vitest'
import { createDemoData, DEMO_DATE, DEMO_PERIOD } from '@/data/fixtures/demo'
import { activeRoomRentRate, ROOM_RATE_CATEGORY_IDS } from '@/domain/calculations/billing-rates'
import { isPrototypeData } from '@/domain/validation/prototype-data'
import { roomMonthlyRateLabel, roomRate } from '@/lib/room-rates'

describe('rental-rate room categories', () => {
  it('defines exactly the approved rate categories and room counts', () => {
    const data = createDemoData()
    expect(ROOM_RATE_CATEGORY_IDS.map(categoryId => {
      const rate = activeRoomRentRate(data, categoryId, DEMO_DATE)
      return [categoryId, rate?.monthlyRentCents, data.rooms.filter(room => room.categoryId === categoryId).length]
    })).toEqual([
      ['RATE_3500', 350_000, 8], ['RATE_4000', 400_000, 6], ['RATE_5000', 500_000, 1],
    ])
    expect(data.rooms).toHaveLength(15)
  })

  it('assigns all 15 fixture rooms to the approved categories', () => {
    const data = createDemoData()
    const counts = new Map(ROOM_RATE_CATEGORY_IDS.map(categoryId => [categoryId, data.rooms.filter(room => room.categoryId === categoryId).length]))
    expect([...counts]).toEqual([['RATE_3500', 8], ['RATE_4000', 6], ['RATE_5000', 1]])
    expect(roomMonthlyRateLabel(data, data.rooms.find(room => room.name === '1')!, DEMO_DATE)).toBe('₱3,500.00/month')
    expect(roomMonthlyRateLabel(data, data.rooms.find(room => room.name === '01')!, DEMO_DATE)).toBe('₱4,000.00/month')
    expect(roomMonthlyRateLabel(data, data.rooms.find(room => room.name === '02')!, DEMO_DATE)).toBe('₱5,000.00/month')
    expect(JSON.stringify(data.rooms)).not.toMatch(/Public CR|Private CR|Aircon/)
  })

  it('locks issued rent while preserving the configured category rate', () => {
    const data = createDemoData()
    const rent = data.charges.find(charge => charge.id === 'rent-nov-room-1')!
    expect(rent.category === 'RENT' ? rent.amountCents : 0).toBe(350_000)
    const room = data.rooms.find(item => item.id === 'room-1')!
    room.categoryId = 'RATE_5000'
    expect(isPrototypeData(data)).toBe(true)
    expect(rent.category === 'RENT' ? rent.amountCents : 0).toBe(350_000)
    expect(roomRate(data, room, DEMO_DATE)?.monthlyRentCents).toBe(500_000)
  })

  it('keeps room rate and occupancy filters independent in their source data', () => {
    const data = createDemoData()
    const rate3500 = data.rooms.filter(room => room.categoryId === 'RATE_3500')
    expect(rate3500).toHaveLength(8)
    expect(rate3500.find(room => room.name === '6')?.status).toBe('maintenance')
    expect(data.rooms.filter(room => room.categoryId === 'RATE_4000' && room.status === 'maintenance')).toHaveLength(0)
    expect(DEMO_PERIOD).toBe('period-nov')
    expect(DEMO_DATE).toBe('2026-11-13')
  })
})
