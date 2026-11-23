import { describe, expect, it } from 'vitest'
import { createDemoData } from '@/data/fixtures/demo'
import { createEmptyData } from '@/data/fixtures/empty'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import { occupiedRoomSelection } from '@/domain/calculations/occupied-rooms'
import { activeAssignments } from '@/domain/calculations/summary'
import { prepareMoveInPayment, selectMoveInObligations } from '@/domain/calculations/move-in'

const ids = (data: Parameters<typeof occupiedRoomSelection>[0]) => occupiedRoomSelection(data, '2026-11-23').rooms.map(room => room.id)

describe('occupied Calculate Payment rooms', () => {
  it('includes occupied and shared rooms while excluding vacant and repaired rooms', () => {
    const demo = createDemoData()
    expect(ids(demo)).toEqual(['room-1', 'room-2', 'room-3', 'room-4'])
    expect(createEmptyData('2026-11-23').rooms).toHaveLength(15)
    expect(ids(createEmptyData('2026-11-23'))).toEqual([])
  })

  it('keeps Room 6 and Room 06 distinct and updates after move-in, move-out, and transfer', () => {
    let data = createEmptyData('2026-11-23')
    data = prototypeReducer(data, { type: 'tenant/created', asOf: '2026-11-23', draft: {
      name: 'Room 06 Tenant', email: '', phone: '', address: '', notes: '', roomId: 'room-13', moveInDate: '2026-11-01',
    } })
    expect(ids(data)).toEqual(['room-13'])
    expect(ids(data)).not.toContain('room-6')
    const tenantId = data.tenants[0]!.id
    const moveIn = selectMoveInObligations(data, '2026-11-23', 'room-13').find(item => item.cycle.status === 'ACTIVE')!
    const paid = prepareMoveInPayment(data, { obligationId: moveIn.obligation.id, categories: ['ADVANCE', 'SECURITY_DEPOSIT'], paidOn: '2026-11-01' })
    if (!paid.ok) throw new Error(paid.reason)
    data = paid.data

    data = prototypeReducer(data, { type: 'tenant/updated', tenantId, asOf: '2026-11-23', draft: {
      name: 'Room 06 Tenant', email: '', phone: '', address: '', notes: '', roomId: 'room-15', moveInDate: '2026-11-02',
    } })
    expect(ids(data)).toEqual(['room-15'])

    data = prototypeReducer(data, { type: 'tenant/movedOut', tenantId, asOf: '2026-11-23' })
    expect(ids(data)).toEqual([])
    expect(activeAssignments(data, '2026-11-23')).toHaveLength(0)
  })

  it('includes an occupied under-repair room and reports inconsistent cycle/assignment data', () => {
    const data = createDemoData()
    const room = data.rooms.find(item => item.id === 'room-1')!
    room.status = 'maintenance'
    data.occupancyCycles = data.occupancyCycles.filter(cycle => cycle.roomId !== 'room-2')
    data.roomAssignments = data.roomAssignments.filter(assignment => assignment.roomId !== 'room-3')
    const selection = occupiedRoomSelection(data, '2026-11-23')
    expect(selection.rooms.map(item => item.id)).toContain('room-1')
    expect(selection.warnings.join(' ')).toMatch(/Room 1 is marked under repair but has an active occupant/)
    expect(selection.rooms.map(item => item.id)).toContain('room-2')
    expect(selection.warnings.join(' ')).toMatch(/Room 2 has an active tenant assignment but no active occupancy cycle/)
    expect(selection.rooms.map(item => item.id)).not.toContain('room-3')
    expect(selection.warnings.join(' ')).toMatch(/Room 3 has an active occupancy cycle but no active tenant assignment/)
  })
})
