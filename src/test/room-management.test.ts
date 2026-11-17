import { describe, expect, it } from 'vitest'
import { createDemoData, DEMO_DATE } from '@/data/fixtures/demo'
import {
  createRoom, deleteRoom, roomDeletionBlockers, updateRoom, validateRoomDraft, type RoomDraft,
} from '@/domain/calculations/room-management'
import { selectRoomSummary } from '@/domain/calculations/summary'
import { isPrototypeData } from '@/domain/validation/prototype-data'
import type { RoomCategoryId } from '@/domain/types/models'

const draft: RoomDraft = { name: '116', capacity: 2, categoryId: 'RATE_4000', kind: 'SHARED', status: 'available' }

describe('room management', () => {
  it('creates an unoccupied room with a stable id and supported rate', () => {
    const data = createDemoData()
    const before = selectRoomSummary(data, DEMO_DATE)
    const result = createRoom(data, draft, DEMO_DATE)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(isPrototypeData(result.data)).toBe(true)
    expect(result.room).toMatchObject({ name: '116', floor: 1, capacity: 2, kind: 'SHARED', categoryId: 'RATE_4000', status: 'available', washingMachineEnabled: false })
    expect(result.room.id).toMatch(/^room-/)
    expect(result.data.roomAssignments.some(assignment => assignment.roomId === result.room.id)).toBe(false)
    const after = selectRoomSummary(result.data, DEMO_DATE)
    expect(after.totalRooms).toBe(before.totalRooms + 1)
    expect(after.availableRooms).toBe(before.availableRooms + 1)
    expect(after.occupiedRooms).toBe(before.occupiedRooms)
  })

  it.each(['101', ' 101 '])('rejects duplicate room names: %s', name => {
    const data = createDemoData()
    expect(validateRoomDraft(data, { ...draft, name }, { asOf: DEMO_DATE }).name).toMatch(/already in use/)
    expect(createRoom(data, { ...draft, name }, DEMO_DATE).ok).toBe(false)
  })

  it('checks duplicate room names case-insensitively', () => {
    const data = createDemoData()
    data.rooms[0]!.name = 'Alex Room'
    expect(validateRoomDraft(data, { ...draft, name: '  aLeX roOm ' }, { asOf: DEMO_DATE }).name).toMatch(/already in use/)
  })

  it('rejects a missing room name', () => {
    const data = createDemoData()
    expect(validateRoomDraft(data, { ...draft, name: '   ' }, { asOf: DEMO_DATE }).name).toMatch(/Enter a room/)
  })

  it.each([null, 0, -1, 1.5])('rejects invalid bed counts: %s', capacity => {
    const data = createDemoData()
    expect(validateRoomDraft(data, { ...draft, capacity }, { asOf: DEMO_DATE }).capacity).toMatch(/whole number of beds/)
  })

  it('rejects an unsupported monthly rate', () => {
    const data = createDemoData()
    expect(validateRoomDraft(data, { ...draft, categoryId: 'RATE_9999' as RoomCategoryId }, { asOf: DEMO_DATE }).categoryId).toMatch(/supported monthly rental rate/)
  })

  it('edits an empty room while preserving its stable id and floor', () => {
    const data = createDemoData()
    const result = updateRoom(data, 'room-6', { name: '206', capacity: 2, categoryId: 'RATE_4000', kind: 'SHARED', status: 'available' }, DEMO_DATE)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(isPrototypeData(result.data)).toBe(true)
    expect(result.room).toMatchObject({ id: 'room-6', name: '206', floor: 1, capacity: 2, categoryId: 'RATE_4000', kind: 'SHARED', status: 'available' })
    expect(result.data.roomAssignments).toEqual(data.roomAssignments)
    expect(result.data.charges).toEqual(data.charges)
  })

  it('blocks duplicate room names during editing', () => {
    const data = createDemoData()
    const result = updateRoom(data, 'room-6', { ...draft, name: '101' }, DEMO_DATE)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.name).toMatch(/already in use/)
  })

  it('does not reduce beds below current occupancy', () => {
    const data = createDemoData()
    const result = updateRoom(data, 'room-2', { name: '102', capacity: 1, categoryId: 'RATE_3500', kind: 'SHARED', status: 'available' }, DEMO_DATE)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.capacity).toMatch(/2 assigned tenants/)
  })

  it('rejects changing an occupied room to under repair', () => {
    const data = createDemoData()
    const result = updateRoom(data, 'room-1', { name: '101', capacity: 2, categoryId: 'RATE_3500', kind: 'SHARED', status: 'maintenance' }, DEMO_DATE)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.status).toMatch(/occupied room/i)
  })

  it('preserves historical bills and tenant agreements when the room rate changes', () => {
    const data = createDemoData()
    const result = updateRoom(data, 'room-1', { name: '101', capacity: 2, categoryId: 'RATE_5000', kind: 'SHARED', status: 'available' }, DEMO_DATE)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.charges).toEqual(data.charges)
    expect(result.data.roomAssignments).toEqual(data.roomAssignments)
    expect(result.data.payments).toEqual(data.payments)
  })

  it('renames a room without breaking id-based relationships', () => {
    const data = createDemoData()
    const result = updateRoom(data, 'room-1', { name: '101A', capacity: 2, categoryId: 'RATE_3500', kind: 'SHARED', status: 'available' }, DEMO_DATE)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(isPrototypeData(result.data)).toBe(true)
    expect(result.data.roomAssignments.filter(assignment => assignment.roomId === 'room-1')).toEqual(data.roomAssignments.filter(assignment => assignment.roomId === 'room-1'))
    expect(result.data.charges.find(charge => charge.id === 'rent-nov-room-1')).toEqual(data.charges.find(charge => charge.id === 'rent-nov-room-1'))
  })

  it('deletes only an unlinked room and updates the summary', () => {
    const data = createDemoData()
    expect(roomDeletionBlockers(data, 'room-6', DEMO_DATE)).toEqual([])
    const result = deleteRoom(data, 'room-6', DEMO_DATE)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(isPrototypeData(result.data)).toBe(true)
    expect(result.data.rooms.some(room => room.id === 'room-6')).toBe(false)
    expect(selectRoomSummary(result.data, DEMO_DATE).totalRooms).toBe(data.rooms.length - 1)
  })

  it('blocks deletion of an occupied room', () => {
    const data = createDemoData()
    const blockers = roomDeletionBlockers(data, 'room-1', DEMO_DATE)
    expect(blockers.some(blocker => blocker.includes('occupied'))).toBe(true)
    expect(deleteRoom(data, 'room-1', DEMO_DATE).ok).toBe(false)
  })

  it('blocks deletion of an empty room with retained financial history', () => {
    const data = createDemoData()
    const blockers = roomDeletionBlockers(data, 'room-5', DEMO_DATE)
    expect(blockers.some(blocker => blocker.includes('assignment history'))).toBe(true)
    expect(blockers.some(blocker => blocker.includes('bill history'))).toBe(true)
    expect(blockers.some(blocker => blocker.includes('payment transaction history'))).toBe(true)
    expect(deleteRoom(data, 'room-5', DEMO_DATE).ok).toBe(false)
  })
})
