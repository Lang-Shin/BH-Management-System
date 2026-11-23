import { describe, expect, it } from 'vitest'
import { createDemoData, DEMO_DATE, DEMO_PERIOD } from '@/data/fixtures/demo'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import { meterInitializationStatus, electricityBaseline, latestSettledReading } from '@/domain/calculations/meter-baseline'
import { prepareMeterInitialization } from '@/domain/calculations/meter-initialization'
import { buildRoomPaymentQuote, prepareRoomPayment } from '@/domain/calculations/room-payment'
import { parseMeterReadingMilliKwh } from '@/domain/calculations/electricity-calculation'
import { preparePaymentCorrection } from '@/domain/calculations/payment-correction'
import { unresolvedElectricity, selectSummary } from '@/domain/calculations/summary'
import { tenantRoomBilling } from '@/features/tenant/tenant-room-billing'
import { selectTenantReceipts } from '@/features/tenant/tenant-receipts'
import { isPrototypeData } from '@/domain/validation/prototype-data'
import { parsePrototypeSnapshot, STORAGE_SCHEMA_VERSION } from '@/data/repositories/prototype-storage'
import { localStorageRepository, STORAGE_KEY } from '@/data/repositories/local-storage-repository'
import type { PrototypeAppState } from '@/domain/types/models'

const input = { roomId: 'room-13', readingMilliKwh: 850_000, readOn: DEMO_DATE, sourceNote: 'Landlord handwritten records', initializedOn: DEMO_DATE }
function occupiedRoom() {
  let data = createDemoData()
  for (const name of ['Charles Meter', 'Charise Meter']) {
    data = prototypeReducer(data, { type: 'tenant/created', draft: { name, email: '', phone: '', address: '', notes: '', roomId: 'room-13', moveInDate: '2026-11-01' } })
  }
  return data
}
function initialize(data: PrototypeAppState = occupiedRoom()) {
  const result = prepareMeterInitialization(data, input)
  if (!result.ok) throw new Error(result.reason)
  return result
}
const quoteInput = { roomId: 'room-13', periodId: DEMO_PERIOD, selected: ['ELECTRICITY' as const], electricityReadingMilliKwh: 875_000, asOf: DEMO_DATE }

describe('administrative meter initialization', () => {
  it('creates only an explicit room meter, initial reading, and audit record', () => {
    const data = occupiedRoom()
    const before = JSON.stringify(data)
    const result = initialize(data)
    expect(JSON.stringify(data)).toBe(before)
    expect(result.meter).toMatchObject({ id: 'meter-room-13', roomId: 'room-13', label: 'Room 06 meter', serialNumber: null })
    expect(result.reading).toMatchObject({ status: 'INITIAL', readingMilliKwh: 850_000, confirmedBy: null, sourceNote: input.sourceNote })
    expect(result.data.charges).toEqual(data.charges)
    expect(result.data.payments).toEqual(data.payments)
    expect(result.data.receipts).toEqual(data.receipts)
    expect(result.data.paymentCorrections).toEqual(data.paymentCorrections)
    expect(result.data.electricityBillObligations).toEqual(data.electricityBillObligations)
    expect(result.data.auditEvents.at(-1)?.action).toBe('METER_INITIALIZED')
    expect(isPrototypeData(result.data)).toBe(true)
    expect(latestSettledReading(result.data, result.meter.id)).toBeNull()
    expect(electricityBaseline(result.data, result.meter.id)?.id).toBe(result.reading.id)
  })

  it('validates room existence, safe integer precision, non-negative reading, dates, and source note', () => {
    const data = createDemoData()
    expect(prepareMeterInitialization(data, { ...input, roomId: 'missing' })).toEqual({ ok: false, reason: 'ROOM_NOT_FOUND' })
    for (const value of [-1, NaN, Infinity, 850.25, Number.MAX_SAFE_INTEGER + 1]) {
      expect(prepareMeterInitialization(data, { ...input, readingMilliKwh: value })).toEqual({ ok: false, reason: 'INVALID_READING' })
    }
    for (const readOn of ['invalid', '2026-02-30', '2026-11-14']) {
      expect(prepareMeterInitialization(data, { ...input, readOn })).toEqual({ ok: false, reason: 'INVALID_DATE' })
    }
    expect(prepareMeterInitialization(data, { ...input, sourceNote: 'x'.repeat(501) })).toEqual({ ok: false, reason: 'INVALID_SOURCE' })
    expect(parseMeterReadingMilliKwh('850.123')).toBe(850_123)
    expect(parseMeterReadingMilliKwh('850.1234')).toBeNull()
    expect(prepareMeterInitialization(data, { ...input, readingMilliKwh: 0 }).ok).toBe(true)
  })

  it('protects settled readings and rejects duplicate initialization', () => {
    const data = createDemoData()
    expect(meterInitializationStatus(data, 'room-1').state).toBe('HAS_HISTORY')
    expect(prepareMeterInitialization(data, { ...input, roomId: 'room-1' })).toEqual({ ok: false, reason: 'NOT_ELIGIBLE' })
    const result = initialize()
    expect(meterInitializationStatus(result.data, 'room-13').state).toBe('INITIALIZED')
    expect(prepareMeterInitialization(result.data, input)).toEqual({ ok: false, reason: 'NOT_ELIGIBLE' })
  })

  it('requires review for legacy unlinked meters, drafts, orphan history, and conflicting associations', () => {
    const data = createDemoData()
    data.electricityMeters.push({ id: 'meter-room-13', label: 'Legacy', serialNumber: 'OLD', ownership: 'UNCONFIRMED' })
    expect(meterInitializationStatus(data, 'room-13').state).toBe('REQUIRES_REVIEW')
    data.electricityMeters[ data.electricityMeters.length - 1 ]!.roomId = 'room-13'
    data.meterReadings.push({ id: 'draft-13', meterId: 'meter-room-13', readOn: DEMO_DATE, readingMilliKwh: 850_000, status: 'DRAFT', confirmedBy: null, correction: null })
    expect(meterInitializationStatus(data, 'room-13').state).toBe('REQUIRES_REVIEW')
    data.electricityMeters.pop()
    expect(meterInitializationStatus(data, 'room-13').state).toBe('REQUIRES_REVIEW')
    const conflict = createDemoData()
    conflict.electricityMeters.push({ id: 'meter-room-13', roomId: 'room-6', label: 'Wrong link', serialNumber: null, ownership: 'UNCONFIRMED' })
    expect(meterInitializationStatus(conflict, 'room-13').state).toBe('REQUIRES_REVIEW')
    expect(prepareMeterInitialization(conflict, input)).toEqual({ ok: false, reason: 'NOT_ELIGIBLE' })
  })

  it('keeps Room 6 and Room 06 independent and links custom stable room IDs', () => {
    const first = initialize(createDemoData())
    expect(meterInitializationStatus(first.data, 'room-6').state).toBe('ELIGIBLE')
    const second = prepareMeterInitialization(first.data, { ...input, roomId: 'room-6', readingMilliKwh: 100_000 })
    if (!second.ok) throw new Error(second.reason)
    expect(second.meter.id).toBe('meter-room-6')
    expect(electricityBaseline(second.data, 'meter-room-13')?.readingMilliKwh).toBe(850_000)
    const data = createDemoData()
    data.rooms.push({ ...data.rooms[12]!, id: 'room-custom-uuid', name: 'A-01' })
    const custom = prepareMeterInitialization(data, { ...input, roomId: 'room-custom-uuid' })
    if (!custom.ok) throw new Error(custom.reason)
    expect(custom.meter.roomId).toBe('room-custom-uuid')
    expect(custom.meter.id).toBe('meter-room-custom-uuid')
  })

  it('persists and reloads the baseline with no setup activation stored', async () => {
    const result = initialize()
    expect(await localStorageRepository.save(result.data)).toBeNull()
    const raw = localStorage.getItem(STORAGE_KEY)!
    expect(JSON.parse(raw).version).toBe(STORAGE_SCHEMA_VERSION)
    expect((await localStorageRepository.load()).data).toEqual(result.data)
    expect(raw).not.toContain('setupActive')
    expect(parsePrototypeSnapshot(JSON.stringify({ version: 12, data: createDemoData() }))).toEqual({ ok: true, data: createDemoData() })
    expect(parsePrototypeSnapshot(raw)).toEqual({ ok: true, data: result.data })
  })

  it('rejects duplicate or invalid persisted baselines', () => {
    const result = initialize()
    expect(isPrototypeData({ ...result.data, meterReadings: [...result.data.meterReadings, { ...result.reading, id: 'duplicate-initial' }] })).toBe(false)
    expect(isPrototypeData({ ...result.data, electricityMeters: result.data.electricityMeters.map(meter => meter.id === result.meter.id ? { ...meter, roomId: 'missing-room' } : meter) })).toBe(false)
  })
})

describe('billing from an initial meter reading', () => {
  it('quotes 850 → 875 kWh at PHP 13/kWh without mutating or settling the baseline', () => {
    const result = initialize()
    const before = JSON.stringify(result.data)
    const quote = buildRoomPaymentQuote(result.data, quoteInput)
    expect(quote.totalCents).toBe(32_500)
    expect(quote.canConfirm).toBe(true)
    expect(quote.electricity).toMatchObject({ previousReadingMilliKwh: 850_000, consumptionMilliKwh: 25_000, amountCents: 32_500, rateCentsPerKwh: 1_300 })
    expect(JSON.stringify(result.data)).toBe(before)
    expect(latestSettledReading(result.data, result.meter.id)).toBeNull()
    expect(buildRoomPaymentQuote(result.data, { ...quoteInput, electricityReadingMilliKwh: 849_000 }).electricity?.error).toBe('READING_BELOW_PREVIOUS')
    expect(buildRoomPaymentQuote(result.data, { ...quoteInput, electricityReadingMilliKwh: 850_000 }).electricity?.error).toBe('READING_NOT_ADVANCED')
    expect(buildRoomPaymentQuote(result.data, { ...quoteInput, asOf: '2026-11-12' }).options.find(item => item.category === 'ELECTRICITY')?.state).toBe('INVALID_READING')
  })

  it('keeps both tenants awaiting a reading after initialization and shares only a real payment receipt', () => {
    const result = initialize()
    const tenants = result.data.tenants.filter(tenant => ['Charles Meter', 'Charise Meter'].includes(tenant.name))
    for (const tenant of tenants) {
      const billing = tenantRoomBilling(result.data, tenant.id, 'room-13', DEMO_PERIOD, DEMO_DATE)
      expect(billing.pendingCalculation).toBe(true)
      expect(billing.status).not.toBe('PAID')
      expect(billing.categories.find(item => item.category === 'ELECTRICITY')).toMatchObject({ status: 'AWAITING READING', outstandingCents: 0 })
      expect(selectTenantReceipts(result.data, tenant.id).receipts).toHaveLength(0)
    }
    const paid = prepareRoomPayment(result.data, quoteInput)
    if (!paid.ok) throw new Error(paid.reason)
    expect(paid.payments).toHaveLength(1)
    expect(paid.receipts).toHaveLength(1)
    expect(latestSettledReading(paid.data, result.meter.id)?.readingMilliKwh).toBe(875_000)
    expect(paid.data.meterReadings.find(reading => reading.id === result.reading.id)).toEqual(result.reading)
    expect(meterInitializationStatus(paid.data, 'room-13').state).toBe('HAS_HISTORY')
    expect(prepareMeterInitialization(paid.data, input)).toEqual({ ok: false, reason: 'NOT_ELIGIBLE' })
    expect(isPrototypeData(paid.data)).toBe(true)
    for (const tenant of tenants) {
      expect(tenantRoomBilling(paid.data, tenant.id, 'room-13', DEMO_PERIOD, DEMO_DATE).categories.find(item => item.category === 'ELECTRICITY')?.status).toBe('PAID')
      expect(selectTenantReceipts(paid.data, tenant.id).receipts.filter(item => item.receipt.id === paid.receipts[0]!.id)).toHaveLength(1)
    }
  })

  it('preserves unpaid carryover when a recorded electricity payment is reversed by correction', () => {
    const result = initialize()
    const paid = prepareRoomPayment(result.data, { ...quoteInput, selected: ['WATER', 'ELECTRICITY'] })
    if (!paid.ok) throw new Error(paid.reason)
    const corrected = preparePaymentCorrection(paid.data, {
      paymentId: paid.payments[0]!.id, selectedCategories: ['WATER'], correctedElectricityReadingMilliKwh: null,
      reason: 'Electricity was not received', settlementStatus: 'CORRECTED', correctedAt: DEMO_DATE,
    })
    if (!corrected.ok) throw new Error(corrected.reason)
    const quote = buildRoomPaymentQuote(corrected.data, quoteInput)
    expect(quote.options.find(item => item.category === 'ELECTRICITY')).toMatchObject({ state: 'SELECTABLE', amountCents: 32_500 })
    expect(unresolvedElectricity(corrected.data, DEMO_DATE, DEMO_PERIOD, 'room-13')).toHaveLength(0)
    expect(selectSummary(corrected.data, DEMO_DATE, DEMO_PERIOD).outstanding).toBeGreaterThanOrEqual(32_500)
    expect(corrected.data.meterReadings.find(reading => reading.id === result.reading.id)).toEqual(result.reading)
    expect(isPrototypeData(corrected.data)).toBe(true)
  })
})
