import { describe, expect, it, vi } from 'vitest'
import { createDemoData } from '@/data/demo'
import { isPrototypeData, loadPrototype, savePrototype, STORAGE_KEY } from './persistence'
import { prototypeReducer } from './reducer'
import { selectSummary } from './selectors'

describe('prototype state and persistence', () => {
  it('starts with consistent relationships and financial sample totals', () => {
    const data = createDemoData()
    expect(isPrototypeData(data)).toBe(true)
    expect(selectSummary(data)).toEqual({ tenants: 22, capacity: 27, availableBeds: 5, occupancy: 81, billed: 8_690_000, collected: 7_110_000, outstanding: 1_580_000, overdue: 2 })
  })

  it('saves notes immutably and restores them from versioned storage', () => {
    const original = createDemoData()
    const changed = prototypeReducer(original, { type: 'tenant/noteUpdated', tenantId: 'tenant-1', notes: '  Sample reminder  ' })
    expect(original.tenants[0]?.notes).toBe('')
    expect(changed.tenants[0]?.notes).toBe('Sample reminder')
    expect(savePrototype(changed)).toBeNull()
    expect(loadPrototype().data).toEqual(changed)
  })

  it('protects occupied rooms and recalculates capacity for empty rooms', () => {
    const data = createDemoData()
    expect(prototypeReducer(data, { type: 'room/statusToggled', roomId: 'room-1' })).toBe(data)
    const changed = prototypeReducer(data, { type: 'room/statusToggled', roomId: 'room-10' })
    expect(selectSummary(changed).capacity).toBe(30)
    expect(selectSummary(changed).availableBeds).toBe(8)
    expect(isPrototypeData(changed)).toBe(true)
    expect(prototypeReducer(changed, { type: 'demo/reset' })).toEqual(createDemoData())
  })

  it.each(['{broken', JSON.stringify({ version: 99, data: createDemoData() }), JSON.stringify({ version: 1, data: {} })])('recovers safely from malformed or unsupported storage: %s', raw => {
    localStorage.setItem(STORAGE_KEY, raw)
    const loaded = loadPrototype()
    expect(loaded.data).toEqual(createDemoData())
    expect(loaded.canPersist).toBe(false)
    expect(loaded.warning).toContain('could not be loaded')
    expect(localStorage.getItem(STORAGE_KEY)).toBe(raw)
  })

  it('rejects orphaned relationships, duplicate IDs, impossible dates, and over-capacity rooms', () => {
    const orphan = createDemoData()
    orphan.tenants[0]!.roomId = 'missing'
    expect(isPrototypeData(orphan)).toBe(false)
    const duplicate = createDemoData()
    duplicate.rooms[1]!.id = 'room-1'
    expect(isPrototypeData(duplicate)).toBe(false)
    const date = createDemoData()
    date.tenants[0]!.moveInDate = '2026-02-30'
    expect(isPrototypeData(date)).toBe(false)
    const capacity = createDemoData()
    capacity.rooms[0]!.capacity = 1
    expect(isPrototypeData(capacity)).toBe(false)
  })

  it('handles denied reads and quota-exceeded writes without crashing', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Denied', 'SecurityError') })
    expect(loadPrototype().canPersist).toBe(false)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError') })
    expect(savePrototype(createDemoData())).toContain('unavailable or full')
  })
})
