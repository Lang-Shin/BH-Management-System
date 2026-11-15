import { describe, expect, it, vi } from 'vitest'
import { createDemoData, DEMO_DATE, DEMO_PERIOD } from '@/data/fixtures/demo'
import { isPrototypeData } from '@/domain/validation/prototype-data'
import { localStorageRepository, STORAGE_KEY } from '@/data/repositories/local-storage-repository'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import { chargeBalance, chargeStatus, creditRemaining, roomOccupants, selectSummary, tenantAccount } from '@/domain/calculations/summary'
import type { PrototypeAppState } from '@/domain/types/models'

describe('shared fictional financial model', () => {
  it('starts with consistent references, allocations, credits, and November summaries', () => {
    const data = createDemoData()
    expect(isPrototypeData(data)).toBe(true)
    expect(selectSummary(data, DEMO_DATE, DEMO_PERIOD)).toEqual({ tenants: 9, totalRooms: 6, occupiedRooms: 4, availableRooms: 1, maintenanceRooms: 1,
      billed: 2_958_600, applied: 768_600, received: 1_545_400, outstanding: 2_190_000, credit: 50_000, overdue: 4, paid: 7, partial: 0, unpaid: 13 })
    const received = data.payments.reduce((sum, p) => sum + p.amountCents, 0)
    const allocated = data.paymentAllocations.reduce((sum, a) => sum + a.amountCents, 0)
    expect(received - allocated).toBe(50_000)
    expect(data.tenants).toHaveLength(10)
    expect(roomOccupants(data, 'room-1', DEMO_DATE)).toHaveLength(2)
    expect(roomOccupants(data, 'room-5', DEMO_DATE)).toHaveLength(0)
    expect(roomOccupants(data, 'room-5', '2026-10-30')).toHaveLength(1)
  })

  it('keeps categories independently payable and does not auto-apply advance credit', () => {
    const data = createDemoData()
    const rent = data.charges.find(c => c.id === 'rent-1')!
    const water = data.charges.find(c => c.id === 'water-1')!
    const electricity = data.charges.find(c => c.id === 'electricity-1')!
    expect(chargeStatus(data, rent, '2026-11-04')).toBe('UNPAID')
    expect(chargeStatus(data, water, '2026-11-04')).toBe('UNPAID')
    expect(chargeStatus(data, electricity, DEMO_DATE)).toBe('PAID')
    expect(chargeBalance(data, electricity, DEMO_DATE)).toBe(0)
    expect(creditRemaining(data, data.tenantCredits[0]!, DEMO_DATE)).toBe(50_000)
    expect(tenantAccount(data, 'tenant-6', DEMO_DATE)).toMatchObject({ balance: 365_000, credit: 50_000 })
    expect(data.charges.some(c => c.tenantId === 'tenant-1' && c.category === 'WASHING_MACHINE')).toBe(false)
  })

  it('preserves the 300 → 312 kWh × PHP 13 example and historical applied rates', () => {
    const data = createDemoData()
    const electricity = data.charges.find(c => c.id === 'electricity-1')!
    expect(electricity.category).toBe('ELECTRICITY')
    if (electricity.category !== 'ELECTRICITY') throw new Error('Fixture missing electricity basis')
    expect(electricity.electricity).toMatchObject({ previousReadingMilliKwh: 300_000, currentReadingMilliKwh: 312_000, consumptionMilliKwh: 12_000, appliedRateCentsPerKwh: 1_300 })
    expect(electricity.amountCents).toBe(15_600)
    data.electricityRates.push({ id: 'new-rate', label: 'Later test rate', rateCentsPerKwh: 2_000, effectiveFrom: '2027-01-01' })
    expect(isPrototypeData(data)).toBe(true)
    expect(electricity.amountCents).toBe(15_600)
    expect(electricity.electricity.appliedRateCentsPerKwh).toBe(1_300)
    expect(data.charges.find(c => c.id === 'electricity-old')?.amountCents).toBe(14_400)
  })

  it('distinguishes receipt-month collections from allocations against a prior billing period', () => {
    const data = createDemoData()
    const october = selectSummary(data, DEMO_DATE, 'period-oct')
    expect(october).toMatchObject({ billed: 1_091_800, applied: 726_800, received: 0, outstanding: 365_000 })
    expect(selectSummary(data, '2026-11-01', DEMO_PERIOD).received).toBe(0)
    expect(selectSummary(data, '2026-11-21', DEMO_PERIOD).overdue).toBe(13)
  })

  const invalidCases: { name: string; change: (data: PrototypeAppState) => void }[] = [
    { name: 'orphan assignment', change: d => { d.roomAssignments[0]!.roomId = 'missing' } },
    { name: 'duplicate IDs', change: d => { d.rooms[1]!.id = 'room-1' } },
    { name: 'impossible date', change: d => { d.roomAssignments[0]!.startDate = '2026-02-30' } },
    { name: 'occupied room marked under repair', change: d => { d.rooms[0]!.status = 'maintenance' } },
    { name: 'fractional currency', change: d => { d.payments[0]!.amountCents = 1.5 } },
    { name: 'negative currency', change: d => { d.charges[0]!.amountCents = -1 } },
    { name: 'charge over-allocation', change: d => { d.paymentAllocations[0]!.amountCents = 500_000 } },
    { name: 'payment over-allocation within a valid charge balance', change: d => { d.paymentAllocations.find(a => a.paymentId === 'payment-1-water')!.amountCents = 20_000 } },
    { name: 'credit over-consumption', change: d => { d.paymentAllocations.push({ id: 'overspent-credit', paymentId: 'payment-advance', chargeId: 'rent-6', amountCents: 60_000, allocatedOn: DEMO_DATE, creditId: 'credit-6', state: 'ACTIVE', reversalAuditEventId: null }) } },
    { name: 'aggregate overpayment from otherwise valid separate payments', change: d => {
      d.payments.push({ id: 'extra-payment', tenantId: 'tenant-1', amountCents: 200_000, paidOn: DEMO_DATE, method: 'cash', state: 'RECORDED', correction: null })
      d.paymentAllocations.push({ id: 'extra-allocation', paymentId: 'extra-payment', chargeId: 'rent-1', amountCents: 200_000, allocatedOn: DEMO_DATE, creditId: null, state: 'ACTIVE', reversalAuditEventId: null })
    } },
    { name: 'cross-tenant allocation', change: d => { d.paymentAllocations[0]!.chargeId = 'rent-1' } },
    { name: 'advance double spending', change: d => { d.tenantCredits[0]!.sourcePaymentId = 'payment-1-rent'; d.tenantCredits[0]!.tenantId = 'tenant-1' } },
    { name: 'wrong receipt allocation', change: d => { d.receipts[0]!.allocationIds = ['allocation-payment-1-rent-rent-1'] } },
    { name: 'unauthorized reading correction', change: d => { d.meterReadings[2]!.correction = { supersedesId: 'reading-oct', auditEventId: 'missing', authorizedBy: 'unknown' } } },
    { name: 'inconsistent consumption', change: d => { const c = d.charges.find(c => c.category === 'ELECTRICITY'); if (c?.category === 'ELECTRICITY') c.electricity.consumptionMilliKwh = 99_000 } },
  ]
  it.each(invalidCases)('rejects $name in persisted data', ({ change }) => {
    const data = createDemoData()
    change(data)
    expect(isPrototypeData(data)).toBe(false)
  })

  it('can retain an authorized corrected reading without overwriting an issued charge', () => {
    const data = createDemoData()
    const original = data.meterReadings[2]!
    original.status = 'SUPERSEDED'
    const corrected = { ...original, id: 'corrected-reading', readingMilliKwh: 313_000, status: 'CONFIRMED' as const,
      correction: { supersedesId: original.id, auditEventId: 'audit-correction', authorizedBy: 'demo-admin' } }
    data.meterReadings.push(corrected)
    data.auditEvents.push({ id: 'audit-correction', actorId: 'demo-admin', occurredOn: DEMO_DATE, action: 'READING_CORRECTED', entityType: 'METER_READING', entityId: corrected.id, reason: 'Fictional authorized correction example', beforeSnapshot: JSON.stringify(original), afterSnapshot: JSON.stringify(corrected) })
    expect(isPrototypeData(data)).toBe(true)
    expect(data.charges.find(c => c.id === 'electricity-1')?.amountCents).toBe(15_600)
  })
})

describe('prototype reducer and persistence', () => {
  it('saves demo notes immutably and round-trips all expanded records', async () => {
    const original = createDemoData()
    const changed = prototypeReducer(original, { type: 'tenant/noteUpdated', tenantId: 'tenant-1', notes: '  Sample reminder  ' })
    expect(original.tenants[0]?.notes).toBe('')
    expect(changed.tenants[0]?.notes).toBe('Sample reminder')
    expect(await localStorageRepository.save(changed)).toBeNull()
    expect((await localStorageRepository.load()).data).toEqual(changed)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toHaveProperty('version', 2)
  })

  it('protects occupied rooms and preserves historical assignments during maintenance toggles', () => {
    const data = createDemoData()
    expect(prototypeReducer(data, { type: 'room/statusToggled', roomId: 'room-1' })).toBe(data)
    const changed = prototypeReducer(data, { type: 'room/statusToggled', roomId: 'room-6' })
    expect(selectSummary(changed, DEMO_DATE)).toMatchObject({ totalRooms: 6, occupiedRooms: 4, availableRooms: 2, maintenanceRooms: 0 })
    expect(isPrototypeData(changed)).toBe(true)
    const historicalRoom = prototypeReducer(data, { type: 'room/statusToggled', roomId: 'room-5' })
    expect(isPrototypeData(historicalRoom)).toBe(true)
    expect(historicalRoom.roomAssignments).toEqual(data.roomAssignments)
    expect(prototypeReducer(changed, { type: 'demo/reset' })).toEqual(createDemoData())
  })

  it.each(['{broken', JSON.stringify({ version: 1, data: { tenants: [] } }), JSON.stringify({ version: 99, data: createDemoData() }), JSON.stringify({ version: 2, data: {} })])('preserves malformed or unsupported storage until an explicit reset: %s', async raw => {
    localStorage.setItem(STORAGE_KEY, raw)
    const loaded = await localStorageRepository.load()
    expect(loaded.data).toEqual(createDemoData())
    expect(loaded.canPersist).toBe(false)
    expect(loaded.warning).toContain('could not be opened')
    expect(localStorage.getItem(STORAGE_KEY)).toBe(raw)
  })

  it('handles denied reads and quota-exceeded writes without crashing', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Denied', 'SecurityError') })
    expect((await localStorageRepository.load()).canPersist).toBe(false)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError') })
    expect(await localStorageRepository.save(createDemoData())).toContain('could not be saved in this browser')
  })
})
