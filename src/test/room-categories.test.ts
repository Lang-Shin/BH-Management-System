import { describe, expect, it } from 'vitest'
import { createDemoData, DEMO_DATE, DEMO_PERIOD } from '@/data/fixtures/demo'
import { isPrototypeData } from '@/domain/validation/prototype-data'
import { ROOM_RATE_BY_ID, ROOM_RATE_CATEGORIES, roomMonthlyRateLabel, roomRate } from '@/lib/room-rates'

describe('rental-rate room categories', () => {
  it('defines exactly the approved rate categories and room counts', () => {
    expect(ROOM_RATE_CATEGORIES.map(category => [category.id, category.monthlyRentCents, category.roomCount])).toEqual([
      ['RATE_3500', 350_000, 8], ['RATE_4000', 400_000, 6], ['RATE_5000', 500_000, 1],
    ])
    expect(ROOM_RATE_CATEGORIES.reduce((sum, category) => sum + category.roomCount, 0)).toBe(15)
    expect(ROOM_RATE_CATEGORIES.map(category => category.label)).toEqual(['₱3,500', '₱4,000', '₱5,000'])
  })

  it('assigns all 15 fixture rooms to the approved categories', () => {
    const data = createDemoData()
    expect(data.rooms).toHaveLength(15)
    const counts = new Map(ROOM_RATE_CATEGORIES.map(category => [category.id, data.rooms.filter(room => room.categoryId === category.id).length]))
    expect([...counts]).toEqual([['RATE_3500', 8], ['RATE_4000', 6], ['RATE_5000', 1]])
    expect(roomMonthlyRateLabel(data.rooms.find(room => room.name === '101')!)).toBe('₱3,500.00/month')
    expect(roomMonthlyRateLabel(data.rooms.find(room => room.name === '109')!)).toBe('₱4,000.00/month')
    expect(roomMonthlyRateLabel(data.rooms.find(room => room.name === '115')!)).toBe('₱5,000.00/month')
    expect(JSON.stringify(data.rooms)).not.toMatch(/Public CR|Private CR|Aircon/)
  })

  it('locks the monthly rent snapshot while preserving the configured category rate', () => {
    const data = createDemoData()
    const rent = data.charges.find(charge => charge.id === 'rent-nov-room-1')!
    expect(rent.category === 'RENT' ? rent.amountCents : 0).toBe(350_000)
    const room = data.rooms.find(item => item.id === 'room-1')!
    room.categoryId = 'RATE_5000'
    expect(isPrototypeData(data)).toBe(true)
    expect(rent.category === 'RENT' ? rent.amountCents : 0).toBe(350_000)
    expect(roomRate(room).monthlyRentCents).toBe(500_000)
    expect(ROOM_RATE_BY_ID.RATE_4000.monthlyRentCents).toBe(400_000)
  })

  it('keeps room rate and occupancy filters independent in their source data', () => {
    const data = createDemoData()
    const rate3500 = data.rooms.filter(room => room.categoryId === 'RATE_3500')
    expect(rate3500).toHaveLength(8)
    expect(rate3500.find(room => room.name === '106')?.status).toBe('maintenance')
    expect(data.rooms.filter(room => room.categoryId === 'RATE_4000' && room.status === 'maintenance')).toHaveLength(0)
    expect(DEMO_PERIOD).toBe('period-nov')
    expect(DEMO_DATE).toBe('2026-11-13')
  })
})
