import { describe, expect, it } from 'vitest'
import { createDemoData, DEMO_DATE } from '@/data/fixtures/demo'
import { roomOccupants, selectSummary } from '@/domain/calculations/summary'

describe('dated room occupancy', () => {
  it.each([
    ['2026-08-31', 0], ['2026-09-01', 1], ['2026-10-31', 1], ['2026-11-01', 0],
  ])('honors assignment boundaries on %s', (date, count) => {
    expect(roomOccupants(createDemoData(), 'room-5', date)).toHaveLength(count)
  })

  it('distinguishes shared-room fullness, vacancy, and unavailable maintenance capacity', () => {
    const data = createDemoData()
    expect(roomOccupants(data, 'room-1', DEMO_DATE)).toHaveLength(3)
    expect(roomOccupants(data, 'room-2', DEMO_DATE)).toHaveLength(2)
    expect(roomOccupants(data, 'room-6', DEMO_DATE)).toHaveLength(0)
    expect(selectSummary(data, DEMO_DATE)).toMatchObject({ capacity: 11, occupiedBeds: 9, availableBeds: 2, occupancy: 82 })
  })
})
