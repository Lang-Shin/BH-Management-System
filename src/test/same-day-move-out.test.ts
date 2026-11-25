import { describe, expect, it } from 'vitest'
import { createDemoData, DEMO_DATE } from '@/data/fixtures/demo'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import { prepareMoveInPayment } from '@/domain/calculations/move-in'
import { activeAssignments, roomOccupancy, roomOccupants } from '@/domain/calculations/summary'
import { roomCapacityConflict, roomPeakOccupancy } from '@/domain/calculations/room-capacity'
import { occupiedRoomSelection } from '@/domain/calculations/occupied-rooms'
import { createTenant, validateTenantDraft, type TenantDraft } from '@/domain/calculations/tenant-management'
import type { PrototypeAppState } from '@/domain/types/models'

function tenantDraft(name: string, roomId: string, moveInDate = DEMO_DATE): TenantDraft {
  return { name, email: `${name.toLowerCase().replaceAll(' ', '.')}@example.com`, phone: '', address: '', roomId, moveInDate, notes: '' }
}

function createInRoom(data: PrototypeAppState, name: string, roomId = 'room-9', moveInDate = DEMO_DATE) {
  const next = prototypeReducer(data, { type: 'tenant/created', draft: tenantDraft(name, roomId, moveInDate), asOf: DEMO_DATE })
  const tenant = next.tenants.find(item => !data.tenants.some(existing => existing.id === item.id))
  if (!tenant) throw new Error(`${name} was not created`)
  return { data: next, tenant }
}

function settleRoomMoveIn(data: PrototypeAppState, roomId: string) {
  const obligation = data.moveInObligations.find(item => item.roomId === roomId && item.status === 'OPEN')
  if (!obligation) throw new Error(`No open move-in obligation for ${roomId}`)
  const paid = prepareMoveInPayment(data, { obligationId: obligation.id, categories: ['ADVANCE', 'SECURITY_DEPOSIT'], paidOn: DEMO_DATE })
  if (!paid.ok) throw new Error(paid.reason)
  return paid.data
}

function moveOut(data: PrototypeAppState, tenantId: string) {
  return prototypeReducer(data, { type: 'tenant/movedOut', tenantId, asOf: DEMO_DATE })
}

function sharedRoomScenario() {
  let data = createDemoData()
  const renzo = createInRoom(data, 'Renzo Ballesteros')
  data = renzo.data
  const eduard = createInRoom(data, 'Eduard Jeus')
  data = settleRoomMoveIn(eduard.data, 'room-9')
  data = moveOut(data, eduard.tenant.id)
  return { data, renzo: renzo.tenant, eduard: eduard.tenant }
}

describe('same-day move-out occupancy', () => {
  it('frees the moved-out tenant slot while keeping the remaining roommate and assignment history', () => {
    const { data, renzo, eduard } = sharedRoomScenario()
    const room = data.rooms.find(item => item.id === 'room-9')!

    expect(data.tenants.find(tenant => tenant.id === eduard.id)?.status).toBe('MOVED_OUT')
    expect(data.roomAssignments.find(assignment => assignment.tenantId === eduard.id)?.endDate).toBe(DEMO_DATE)
    expect(activeAssignments(data, DEMO_DATE).filter(assignment => assignment.roomId === room.id).map(assignment => assignment.tenantId)).toEqual([renzo.id])
    expect(roomOccupants(data, room.id, DEMO_DATE).map(tenant => tenant.name)).toEqual(['Renzo Ballesteros'])
    expect(roomOccupancy(data, room, DEMO_DATE)).toBe('OCCUPIED')
    expect(occupiedRoomSelection(data, DEMO_DATE).rooms.map(item => item.id)).toContain(room.id)
    expect(data.occupancyCycles.some(cycle => cycle.roomId === room.id && cycle.status === 'ACTIVE')).toBe(true)
  })

  it('allows exactly one replacement in the freed slot and keeps the next admission blocked', () => {
    const { data, renzo } = sharedRoomScenario()
    const draft = tenantDraft('Replacement Tenant', 'room-9')
    expect(roomCapacityConflict(data, { roomId: 'room-9', tenantId: '__new__', startDate: DEMO_DATE, endDate: null, capacity: 2 })).toBeNull()
    expect(validateTenantDraft(data, draft, { asOf: DEMO_DATE }).roomId).toBeUndefined()

    const created = createTenant(data, draft, DEMO_DATE)
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(roomOccupants(created.data, 'room-9', DEMO_DATE).map(tenant => tenant.name).sort()).toEqual(['Renzo Ballesteros', 'Replacement Tenant'])
    expect(roomPeakOccupancy(created.data, 'room-9')).toBe(2)
    expect(validateTenantDraft(created.data, tenantDraft('Third Tenant', 'room-9'), { asOf: DEMO_DATE }).roomId).toMatch(/exceed its capacity/)
    expect(created.data.roomAssignments.find(assignment => assignment.tenantId === renzo.id)?.endDate).toBeNull()
  })

  it('frees a private room and closes its occupancy cycle when the last same-day tenant leaves', () => {
    let data = createDemoData()
    const created = createInRoom(data, 'Private Tenant', 'room-15')
    data = settleRoomMoveIn(created.data, 'room-15')
    data = moveOut(data, created.tenant.id)
    const room = data.rooms.find(item => item.id === 'room-15')!

    expect(activeAssignments(data, DEMO_DATE).filter(assignment => assignment.roomId === room.id)).toEqual([])
    expect(roomOccupants(data, room.id, DEMO_DATE)).toEqual([])
    expect(roomOccupancy(data, room, DEMO_DATE)).toBe('AVAILABLE')
    expect(occupiedRoomSelection(data, DEMO_DATE).rooms.map(item => item.id)).not.toContain(room.id)
    expect(data.occupancyCycles.some(cycle => cycle.roomId === room.id && cycle.status === 'ACTIVE')).toBe(false)
    expect(roomCapacityConflict(data, { roomId: room.id, tenantId: '__new__', startDate: DEMO_DATE, endDate: null, capacity: 1 })).toBeNull()
  })

  it('repairs a stale active cycle left by a pre-fix same-day move-out when records reload', () => {
    let data = createDemoData()
    const created = createInRoom(data, 'Stale Cycle Tenant', 'room-15')
    data = settleRoomMoveIn(created.data, 'room-15')
    const staleCycle = data.occupancyCycles.find(cycle => cycle.roomId === 'room-15' && cycle.status === 'ACTIVE')!
    data = moveOut(data, created.tenant.id)
    const stale = { ...data, occupancyCycles: data.occupancyCycles.map(cycle => cycle.id === staleCycle.id ? staleCycle : cycle) }
    const loaded = prototypeReducer(stale, { type: 'data/loaded', data: stale, occupancyDate: DEMO_DATE })

    expect(loaded.occupancyCycles.some(cycle => cycle.roomId === 'room-15' && cycle.status === 'ACTIVE')).toBe(false)
    expect(roomOccupancy(loaded, loaded.rooms.find(room => room.id === 'room-15')!, DEMO_DATE)).toBe('AVAILABLE')
  })

  it('still counts moved-out residents on historical dates before their assignment ended', () => {
    const data = createDemoData()
    expect(roomCapacityConflict(data, { roomId: 'room-5', tenantId: '__new__', startDate: '2026-10-15', endDate: null, capacity: 2 })).toMatchObject({ date: '2026-10-15', occupants: 3, capacity: 2 })
    expect(roomPeakOccupancy(data, 'room-5')).toBe(2)
  })
})
