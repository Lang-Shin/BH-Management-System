import { describe, expect, it, vi } from 'vitest'
import { createDemoData, DEMO_DATE } from '@/data/fixtures/demo'
import { isPrototypeData } from '@/domain/validation/prototype-data'
import { localStorageRepository, STORAGE_KEY } from '@/data/repositories/local-storage-repository'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import { invoiceStatus, selectSummary } from '@/domain/calculations/summary'

describe('prototype state and persistence', () => {
  it('starts with consistent relationships and financial sample totals', () => {
    const data = createDemoData()
    expect(isPrototypeData(data)).toBe(true)
    expect(selectSummary(data, DEMO_DATE)).toEqual({ tenants: 22, capacity: 27, availableBeds: 5, occupancy: 81, billed: 8_690_000, collected: 7_110_000, outstanding: 1_580_000, overdue: 2 })
  })

  it('saves notes immutably and restores them from versioned storage', async () => {
    const original = createDemoData()
    const changed = prototypeReducer(original, { type: 'tenant/noteUpdated', tenantId: 'tenant-1', notes: '  Sample reminder  ' })
    expect(original.tenants[0]?.notes).toBe('')
    expect(changed.tenants[0]?.notes).toBe('Sample reminder')
    expect(await localStorageRepository.save(changed)).toBeNull()
    expect((await localStorageRepository.load()).data).toEqual(changed)
  })

  it('protects occupied rooms and recalculates capacity for empty rooms', () => {
    const data = createDemoData()
    expect(prototypeReducer(data, { type: 'room/statusToggled', roomId: 'room-1' })).toBe(data)
    const changed = prototypeReducer(data, { type: 'room/statusToggled', roomId: 'room-10' })
    expect(selectSummary(changed, DEMO_DATE).capacity).toBe(30)
    expect(selectSummary(changed, DEMO_DATE).availableBeds).toBe(8)
    expect(isPrototypeData(changed)).toBe(true)
    expect(prototypeReducer(changed, { type: 'demo/reset' })).toEqual(createDemoData())
  })

  it.each(['{broken', JSON.stringify({ version: 99, data: createDemoData() }), JSON.stringify({ version: 1, data: {} })])('recovers safely from malformed or unsupported storage: %s', async raw => {
    localStorage.setItem(STORAGE_KEY, raw)
    const loaded = await localStorageRepository.load()
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

  it('handles denied reads and quota-exceeded writes without crashing', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Denied', 'SecurityError') })
    expect((await localStorageRepository.load()).canPersist).toBe(false)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError') })
    expect(await localStorageRepository.save(createDemoData())).toContain('unavailable or full')
  })

  it('uses an explicit reporting date without depending on demonstration fixtures', () => {
    const data = createDemoData()
    const invoice = data.invoices[20]!
    expect(invoiceStatus(data, invoice, '2026-11-20')).toBe('Upcoming')
    expect(invoiceStatus(data, invoice, '2026-11-21')).toBe('Overdue')
    expect(selectSummary(data, '2026-11-21').overdue).toBe(4)
  })
})
