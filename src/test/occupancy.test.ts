import { describe, expect, it } from 'vitest'
import { createDemoData, DEMO_DATE } from '@/data/fixtures/demo'
import { roomOccupancy, roomOccupants, selectRoomSummary } from '@/domain/calculations/summary'
import { isPrototypeData } from '@/domain/validation/prototype-data'

describe('room-based occupancy', () => {
  it.each([
    ['2026-08-31', 0], ['2026-09-01', 2], ['2026-10-31', 2], ['2026-11-01', 0],
  ])('honors assignment boundaries on %s', (date, count) => {
    expect(roomOccupants(createDemoData(), 'room-5', date)).toHaveLength(count)
  })

  it('keeps current and historical occupancy at two tenants or fewer', () => {
    const data = createDemoData()
    for (const date of [DEMO_DATE, '2026-10-15', '2026-09-15']) {
      for (const room of data.rooms) expect(roomOccupants(data, room.id, date).length).toBeLessThanOrEqual(2)
    }
    expect(data.rooms.every(room => room.capacity <= 2)).toBe(true)
  })

  it('counts rented rooms once and keeps repairs separate from available rooms', () => {
    const data = createDemoData()
    expect(roomOccupants(data, 'room-1', DEMO_DATE)).toHaveLength(1)
    expect(roomOccupants(data, 'room-2', DEMO_DATE)).toHaveLength(2)
    expect(roomOccupants(data, 'room-3', DEMO_DATE)).toHaveLength(2)
    expect(selectRoomSummary(data, DEMO_DATE)).toEqual({ totalRooms: 6, occupiedRooms: 4, availableRooms: 1, maintenanceRooms: 1 })
  })

  it('treats one person renting a two-bed room as occupied, not available', () => {
    const data = createDemoData()
    data.roomAssignments = data.roomAssignments.filter(a => a.roomId !== 'room-3' || a.tenantId === 'tenant-3')
    expect(data.rooms[2]?.capacity).toBe(2)
    expect(roomOccupants(data, 'room-3', DEMO_DATE)).toHaveLength(1)
    expect(roomOccupancy(data, data.rooms[2]!, DEMO_DATE)).toBe('OCCUPIED')
    expect(selectRoomSummary(data, DEMO_DATE).availableRooms).toBe(1)
  })

  it('does not change availability or reject rental records when bed counts change', () => {
    const data = createDemoData()
    const before = selectRoomSummary(data, DEMO_DATE)
    data.rooms.forEach(room => { room.capacity = 1 })
    expect(isPrototypeData(data)).toBe(true)
    expect(selectRoomSummary(data, DEMO_DATE)).toEqual(before)
  })

  it('supports the landlord example: six occupied out of ten rooms, four available', () => {
    const data = createDemoData()
    const room = data.rooms[0]!
    data.rooms = Array.from({ length: 10 }, (_, i) => ({ ...room, id: `room-${i + 1}`, name: String(101 + i), status: 'available' }))
    data.roomAssignments = data.roomAssignments.slice(0, 6).map((a, i) => ({ ...a, roomId: `room-${i + 1}` }))
    expect(selectRoomSummary(data, DEMO_DATE)).toEqual({ totalRooms: 10, occupiedRooms: 6, availableRooms: 4, maintenanceRooms: 0 })
  })
})
