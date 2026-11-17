import { describe, expect, it } from 'vitest'
import { createDemoData, DEMO_DATE } from '@/data/fixtures/demo'
import {
  createTenant, deleteTenant, moveOutBlockers, moveOutTenant, tenantDeletionBlockers,
  updateTenant, validateTenantDraft, type TenantDraft,
} from '@/domain/calculations/tenant-management'
import { roomOccupants, tenantAccount } from '@/domain/calculations/summary'
import { isPrototypeData } from '@/domain/validation/prototype-data'

const draft: TenantDraft = {
  name: 'Test Tenant', email: 'tenant@example.com', phone: '+63 900 123 4567',
  address: '1 Sample Street, Demo City', roomId: null, moveInDate: '2026-11-01', notes: '',
}

describe('tenant management', () => {
  it('creates a tenant without a room', () => {
    const data = createDemoData()
    const result = createTenant(data, draft, DEMO_DATE)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(isPrototypeData(result.data)).toBe(true)
    expect(result.tenant).toMatchObject({ name: 'Test Tenant', status: 'ACTIVE', email: 'tenant@example.com' })
    expect(result.data.tenants).toHaveLength(data.tenants.length + 1)
    expect(result.data.roomAssignments.some(assignment => assignment.tenantId === result.tenant.id)).toBe(false)
  })

  it('creates a tenant in an available room and updates occupancy', () => {
    const data = createDemoData()
    const result = createTenant(data, { ...draft, roomId: 'room-7' }, DEMO_DATE)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.roomAssignments.find(assignment => assignment.tenantId === result.tenant.id)).toMatchObject({ roomId: 'room-7', startDate: '2026-11-01', endDate: null })
    expect(roomOccupants(result.data, 'room-7', DEMO_DATE)).toHaveLength(1)
    expect(isPrototypeData(result.data)).toBe(true)
  })

  it('allows tenants with the same name but unique IDs', () => {
    const data = createDemoData()
    const first = createTenant(data, { ...draft, name: 'Same Name' }, DEMO_DATE)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = createTenant(first.data, { ...draft, name: 'Same Name' }, DEMO_DATE)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.tenant.id).not.toBe(first.tenant.id)
  })

  it('validates a required name', () => {
    const data = createDemoData()
    expect(validateTenantDraft(data, { ...draft, name: '  ' }, { asOf: DEMO_DATE }).name).toMatch(/full name/i)
  })

  it.each(['not-an-email', 'one@', '@example.com'])('rejects invalid email: %s', email => {
    const data = createDemoData()
    expect(validateTenantDraft(data, { ...draft, email }, { asOf: DEMO_DATE }).email).toMatch(/valid email/)
  })

  it('rejects invalid phone numbers while accepting the sample phone format', () => {
    const data = createDemoData()
    expect(validateTenantDraft(data, { ...draft, phone: 'not-a-phone' }, { asOf: DEMO_DATE }).phone).toMatch(/valid phone/)
    expect(validateTenantDraft(data, { ...draft, phone: 'DEMO +63 000 000 0001' }, { asOf: DEMO_DATE }).phone).toBeUndefined()
  })

  it('rejects invalid move-in dates', () => {
    const data = createDemoData()
    expect(validateTenantDraft(data, { ...draft, moveInDate: 'not-a-date' }, { asOf: DEMO_DATE }).moveInDate).toMatch(/valid move-in date/)
  })

  it('blocks a full room and a room under repair', () => {
    const data = createDemoData()
    expect(validateTenantDraft(data, { ...draft, roomId: 'room-2' }, { asOf: DEMO_DATE }).roomId).toMatch(/already full/)
    expect(validateTenantDraft(data, { ...draft, roomId: 'room-6' }, { asOf: DEMO_DATE }).roomId).toMatch(/under repair/)
  })

  it('edits contact details without changing the tenant ID or financial history', () => {
    const data = createDemoData()
    const result = updateTenant(data, 'tenant-1', {
      ...draft, name: 'Alex Updated', email: 'alex.updated@example.com', phone: '+63 900 111 2222',
      address: 'Updated address', roomId: 'room-1', moveInDate: '2026-09-01', notes: 'Updated note',
    }, DEMO_DATE)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.tenant).toMatchObject({ id: 'tenant-1', name: 'Alex Updated', status: 'ACTIVE', notes: 'Updated note' })
    expect(result.data.charges).toEqual(data.charges)
    expect(result.data.payments).toEqual(data.payments)
    expect(result.data.receipts).toEqual(data.receipts)
    expect(isPrototypeData(result.data)).toBe(true)
  })

  it('transfers a tenant safely while preserving historical assignments and bills', () => {
    const data = createDemoData()
    const result = updateTenant(data, 'tenant-1', {
      ...draft, name: 'Alex Rivera', email: 'resident1@example.com', phone: 'DEMO +63 000 000 0001',
      address: data.tenants[0]!.address, roomId: 'room-7', moveInDate: DEMO_DATE, notes: '',
    }, DEMO_DATE)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const oldAssignment = result.data.roomAssignments.find(assignment => assignment.id === 'assignment-1')!
    const newAssignment = result.data.roomAssignments.find(assignment => assignment.tenantId === 'tenant-1' && assignment.roomId === 'room-7')!
    expect(oldAssignment.endDate).toBe('2026-11-12')
    expect(newAssignment).toMatchObject({ startDate: DEMO_DATE, endDate: null, agreedRentCents: 350_000 })
    expect(roomOccupants(result.data, 'room-1', DEMO_DATE)).toHaveLength(0)
    expect(roomOccupants(result.data, 'room-7', DEMO_DATE)).toHaveLength(1)
    expect(result.data.charges).toEqual(data.charges)
    expect(result.data.receipts).toEqual(data.receipts)
    expect(isPrototypeData(result.data)).toBe(true)
  })

  it('locks a historical move-in date when the room does not change', () => {
    const data = createDemoData()
    const result = updateTenant(data, 'tenant-1', { ...draft, name: 'Alex Rivera', roomId: 'room-1', moveInDate: '2026-10-01' }, DEMO_DATE)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.moveInDate).toMatch(/fixed because this tenant has financial history/)
  })

  it('deletes a tenant with no assignments or financial history', () => {
    const data = createDemoData()
    const created = createTenant(data, draft, DEMO_DATE)
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(tenantDeletionBlockers(created.data, created.tenant.id, DEMO_DATE)).toEqual([])
    const result = deleteTenant(created.data, created.tenant.id, DEMO_DATE)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.tenants.some(tenant => tenant.id === created.tenant.id)).toBe(false)
    expect(isPrototypeData(result.data)).toBe(true)
  })

  it('blocks permanent deletion when assignment or financial history exists', () => {
    const data = createDemoData()
    const blockers = tenantDeletionBlockers(data, 'tenant-1', DEMO_DATE)
    expect(blockers.some(blocker => blocker.includes('assignment history'))).toBe(true)
    expect(blockers.some(blocker => blocker.includes('issued bill'))).toBe(true)
    expect(blockers.some(blocker => blocker.includes('payment history'))).toBe(true)
    expect(deleteTenant(data, 'tenant-1', DEMO_DATE).ok).toBe(false)
  })

  it('moves out a settled tenant, ends occupancy, and preserves receipts', () => {
    const data = createDemoData()
    const created = createTenant(data, { ...draft, roomId: 'room-7' }, DEMO_DATE)
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(moveOutBlockers(created.data, created.tenant.id, DEMO_DATE)).toEqual([])
    const result = moveOutTenant(created.data, created.tenant.id, DEMO_DATE)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.tenants.find(tenant => tenant.id === created.tenant.id)?.status).toBe('MOVED_OUT')
    expect(roomOccupants(result.data, 'room-7', DEMO_DATE)).toHaveLength(0)
    expect(result.data.receipts).toEqual(created.data.receipts)
    expect(isPrototypeData(result.data)).toBe(true)
  })

  it('blocks move-out while an outstanding balance or advance credit exists', () => {
    const data = createDemoData()
    expect(tenantAccount(data, 'tenant-6', DEMO_DATE).credit).toBeGreaterThan(0)
    expect(moveOutBlockers(data, 'tenant-6', DEMO_DATE).some(blocker => blocker.includes('advance credit'))).toBe(true)
    expect(moveOutTenant(data, 'tenant-6', DEMO_DATE).ok).toBe(false)
  })
})
