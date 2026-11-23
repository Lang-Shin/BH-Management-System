import { describe, expect, it } from 'vitest'
import { createDemoData } from '@/data/fixtures/demo'
import { collectionCatalog, prepareCollection, type CollectionInput } from '@/domain/calculations/payment-collection'
import { isPrototypeData } from '@/domain/validation/prototype-data'
import { selectRoomFinance } from '@/domain/calculations/room-finance'
import { pendingPaymentPeriods } from '@/features/dashboard/pending-payment-groups'
import { selectSummary } from '@/domain/calculations/summary'
import { rentObligationPaidCents } from '@/domain/calculations/rental-periods'
import { selectTenantReceipts } from '@/features/tenant/tenant-receipts'
import { overdueWorkspace } from './collection-fixture'
import { prepareMeterInitialization } from '@/domain/calculations/meter-initialization'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import { unresolvedElectricity } from '@/domain/calculations/summary'
import type { Charge } from '@/domain/types/models'

describe('explicit mixed cash collection', () => {
  it('collects the selected August rent and water in November with one itemized receipt', () => {
    const data = overdueWorkspace()
    const catalog = collectionCatalog(data, 'room-2', '2026-11-23')
    const augustRent = catalog.find(item => item.category === 'RENT' && item.dueDate === '2026-08-06')!
    const water = catalog.find(item => item.category === 'WATER' && item.periodStart === '2026-08-01')!
    expect(catalog.filter(item => item.category === 'RENT')).toHaveLength(4)
    expect(catalog.some(item => item.category === 'RENT' && item.dueDate === '2026-07-06')).toBe(false)
    const input: CollectionInput = { transactionId: 'august-mixed', roomId: 'room-2', collectedOn: '2026-11-23', readings: {}, selections: [augustRent, water] }
    const result = prepareCollection(data, input)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(isPrototypeData(result.data)).toBe(true)
    expect(result.totalCents).toBe(360_000)
    expect(result.data.payments).toHaveLength(data.payments.length + 1)
    expect(result.data.receipts).toHaveLength(data.receipts.length + 1)
    expect(result.data.payments.at(-1)).toMatchObject({ paidOn: '2026-11-23', amountCents: 360_000 })
    expect(result.data.receipts.at(-1)?.allocationIds).toHaveLength(2)
    expect(result.data.rentObligations.find(rent => rent.id === augustRent.id)?.dueDate).toBe('2026-08-06')
    expect(rentObligationPaidCents(result.data, augustRent.id, '2026-11-23')).toBe(350_000)
    expect(result.data.rentObligations.filter(rent => rent.dueDate >= '2026-09-01')
      .every(rent => rentObligationPaidCents(result.data, rent.id, '2026-11-23') === 0)).toBe(true)
    const room = selectRoomFinance(result.data, '2026-11-23').find(item => item.context.roomId === 'room-2')!
    expect(pendingPaymentPeriods(result.data, room.charges, '2026-11-23', 'room-2')
      .flatMap(period => period.bills).flatMap(bill => bill.charges).some(charge => charge.id === augustRent.id)).toBe(false)
    expect(selectSummary(result.data, '2026-11-23', 'period-2026-08').applied).toBe(360_000)
    expect(selectSummary(result.data, '2026-11-23', 'period-2026-11').received).toBe(360_000)
    const tenant = data.tenants[0]!
    const receipt = selectTenantReceipts(result.data, tenant.id).receipts.find(item => item.receipt.id === result.receiptId)!
    expect(receipt.categories.find(item => item.category === 'RENT')?.amountCents).toBe(350_000)
    expect(receipt.periods.map(period => period.id)).toContain('period-2026-08')
    expect(prepareCollection(result.data, { ...input, transactionId: 'duplicate-other-key' })).toEqual({ ok: false, reason: 'STALE_SELECTION' })
    expect(prepareCollection(data, { ...input, selections: [{ ...augustRent, amountCents: 1 }] })).toEqual({ ok: false, reason: 'STALE_SELECTION' })
  })

  it('validates combined legacy utilities and electricity as one transaction', () => {
    const data = createDemoData()
    const readings = { 'reading:meter-room-4:cumulative': 325_000 }
    const items = collectionCatalog(data, 'room-4', '2026-11-13', readings)
      .filter(item => item.periodId === 'period-nov' && ['RENT', 'WATER', 'ELECTRICITY'].includes(item.category))
    expect(items.reduce((sum, item) => sum + item.amountCents, 0)).toBe(402_500)
    const result = prepareCollection(data, { roomId: 'room-4', transactionId: 'legacy-mixed', readings, selections: items, collectedOn: '2026-11-13' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(isPrototypeData(result.data)).toBe(true)
  })

  it('collects multiple rent periods without changing anchors and refuses duplicate selections', () => {
    const data = overdueWorkspace()
    const rents = collectionCatalog(data, 'room-2', '2026-11-23').filter(item => item.category === 'RENT').slice(0, 2)
    const input: CollectionInput = { transactionId: 'two-periods', roomId: 'room-2', selections: rents, readings: {}, collectedOn: '2026-11-23' }
    const result = prepareCollection(data, input)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.totalCents).toBe(700_000)
    expect(result.data.occupancyCycles).toEqual(data.occupancyCycles)
    expect(prepareCollection(data, { ...input, selections: [rents[0]!, rents[0]!] })).toEqual({ ok: false, reason: 'INVALID_SELECTION' })
  })

  it('collects historical rent and cumulative electricity only after a verified reading, once per meter', () => {
    const initialized = prepareMeterInitialization(overdueWorkspace(), { roomId: 'room-2', readingMilliKwh: 100_000, readOn: '2026-07-06', initializedOn: '2026-07-06', sourceNote: 'Verified baseline' })
    if (!initialized.ok) throw new Error(initialized.reason)
    const data = initialized.data
    const id = 'reading:meter-room-2:cumulative'
    const awaiting = collectionCatalog(data, 'room-2', '2026-11-23').find(item => item.id === id)!
    expect(awaiting).toMatchObject({ status: 'AWAITING READING', amountCents: 0, selectable: false })
    const readings = { [id]: 150_000 }
    const catalog = collectionCatalog(data, 'room-2', '2026-11-23', readings)
    const electricity = catalog.find(item => item.id === id)!
    const rent = catalog.find(item => item.dueDate === '2026-08-06')!
    expect(electricity.amountCents).toBe(65_000)
    const input = { roomId: 'room-2', transactionId: 'metered-rent', readings, selections: [rent, electricity], collectedOn: '2026-11-23' }
    const result = prepareCollection(data, input)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.totalCents).toBe(415_000)
    expect(isPrototypeData(result.data)).toBe(true)
    expect(result.data.paymentAllocations.filter(item => item.paymentId === result.paymentId)).toHaveLength(2)
    expect(collectionCatalog(result.data, 'room-2', '2026-11-23').some(item => item.id === id)).toBe(false)
    expect(collectionCatalog(data, 'room-2', '2026-11-23', { [id]: 150_000 }).filter(item => item.category === 'ELECTRICITY')).toHaveLength(1)
  })

  it('keeps water and washing monthly while electricity is one five-month cumulative row', () => {
    const initialized = prepareMeterInitialization(overdueWorkspace(), {
      roomId: 'room-2', readingMilliKwh: 155_000, readOn: '2026-07-06', initializedOn: '2026-07-06', sourceNote: 'Verified 155 kWh baseline',
    })
    if (!initialized.ok) throw new Error(initialized.reason)
    const tenant = initialized.data.tenants[0]!
    const washing: Charge[] = [
      { id: 'verified-washing-august', tenantId: tenant.id, billingPeriodId: 'period-2026-08', category: 'WASHING_MACHINE', amountCents: 10_000, description: 'Verified August washing', entryMethod: 'MANUAL', issuedOn: '2026-08-31', dueDate: '2026-08-31', state: 'ISSUED', correction: null },
      { id: 'verified-washing-september', tenantId: tenant.id, billingPeriodId: 'period-2026-09', category: 'WASHING_MACHINE', amountCents: 10_000, description: 'Verified September washing', entryMethod: 'MANUAL', issuedOn: '2026-09-30', dueDate: '2026-09-30', state: 'ISSUED', correction: null },
    ]
    const data = { ...initialized.data, charges: [...initialized.data.charges, ...washing] }
    expect(unresolvedElectricity(data, '2026-11-23', undefined, 'room-2')).toHaveLength(5)
    const id = 'reading:meter-room-2:cumulative'
    const catalog = collectionCatalog(data, 'room-2', '2026-11-23', { [id]: 240_000 })
    const water = catalog.filter(item => item.category === 'WATER').sort((a, b) => a.periodStart.localeCompare(b.periodStart)).slice(0, 3)
    const laundry = catalog.filter(item => item.category === 'WASHING_MACHINE')
    const electricity = catalog.filter(item => item.category === 'ELECTRICITY')
    expect(water.map(item => item.periodStart)).toEqual(['2026-07-01', '2026-08-01', '2026-09-01'])
    expect(laundry.map(item => item.periodStart)).toEqual(['2026-08-01', '2026-09-01'])
    expect(electricity).toHaveLength(1)
    expect(electricity[0]).toMatchObject({ id, amountCents: 110_500, selectable: true })
    expect(electricity[0]?.charge).toMatchObject({
      category: 'ELECTRICITY',
      electricity: {
        previousReadingMilliKwh: 155_000, currentReadingMilliKwh: 240_000, consumptionMilliKwh: 85_000,
        appliedRateCentsPerKwh: 1_300, intervalId: 'meter-room-2:reading-meter-room-2-initial>240000',
      },
    })
    const rent = catalog.find(item => item.category === 'RENT' && item.dueDate === '2026-08-06')!
    const selections = [rent, ...water, ...laundry, ...electricity]
    expect(selections.reduce((sum, item) => sum + item.amountCents, 0)).toBe(510_500)
    const result = prepareCollection(data, { roomId: 'room-2', transactionId: 'five-month-electricity', selections, readings: { [id]: 240_000 }, collectedOn: '2026-11-23' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.totalCents).toBe(510_500)
    expect(result.data.receipts.filter(receipt => receipt.paymentId === result.paymentId)).toHaveLength(1)
    expect(result.data.paymentAllocations.filter(allocation => allocation.paymentId === result.paymentId)).toHaveLength(7)
    expect(collectionCatalog(result.data, 'room-2', '2026-11-23').filter(item => item.category === 'ELECTRICITY')).toHaveLength(0)
    expect(isPrototypeData(result.data)).toBe(true)
  })

  it('rejects a lower meter reading and never invents historical washing usage', () => {
    const initialized = prepareMeterInitialization(overdueWorkspace(), { roomId: 'room-2', readingMilliKwh: 155_000, readOn: '2026-07-06', initializedOn: '2026-07-06', sourceNote: 'Verified baseline' })
    if (!initialized.ok) throw new Error(initialized.reason)
    const id = 'reading:meter-room-2:cumulative'
    const invalid = collectionCatalog(initialized.data, 'room-2', '2026-11-23', { [id]: 150_000 }).find(item => item.category === 'ELECTRICITY')!
    expect(invalid).toMatchObject({ status: 'AWAITING READING', selectable: false, amountCents: 0 })
    expect(invalid.detail).toContain('READING_BELOW_PREVIOUS')
    expect(collectionCatalog(initialized.data, 'room-2', '2026-11-23').filter(item => item.category === 'WASHING_MACHINE')).toHaveLength(0)
  })

  it('collects issued historical washing even when not currently subscribed, without inventing usage', () => {
    const data = overdueWorkspace()
    data.charges.push({ id: 'verified-washing-august', category: 'WASHING_MACHINE', tenantId: data.tenants[0]!.id,
      billingPeriodId: 'period-2026-08', description: 'Verified washing', amountCents: 10_000,
      issuedOn: '2026-08-31', dueDate: '2026-08-31', state: 'ISSUED', entryMethod: 'MANUAL', correction: null })
    const catalog = collectionCatalog(data, 'room-2', '2026-11-23')
    expect(catalog.filter(item => item.category === 'WASHING_MACHINE')).toHaveLength(1)
    const items = catalog.filter(item => item.id === 'verified-washing-august' || item.dueDate === '2026-08-06')
    const result = prepareCollection(data, { roomId: 'room-2', transactionId: 'washing-rent', selections: items, readings: {}, collectedOn: '2026-11-23' })
    expect(result.ok).toBe(true)
    if (result.ok) { expect(result.totalCents).toBe(360_000); expect(isPrototypeData(result.data)).toBe(true) }
  })

  it('collects shared-room historical water only, using original tenant eligibility', () => {
    const data = prototypeReducer(overdueWorkspace(), { type: 'tenant/created', asOf: '2026-11-23', draft: {
      name: 'Second tenant', email: '', phone: '', address: '', notes: '', roomId: 'room-2', moveInDate: '2026-08-10',
    } })
    const catalog = collectionCatalog(data, 'room-2', '2026-11-23')
    expect(catalog.filter(item => item.category === 'WATER' && item.periodId === 'period-2026-07')).toHaveLength(1)
    const augustWater = catalog.filter(item => item.category === 'WATER' && item.periodId === 'period-2026-08')
    expect(augustWater).toHaveLength(2)
    const result = prepareCollection(data, { roomId: 'room-2', transactionId: 'shared-water', selections: augustWater, readings: {}, collectedOn: '2026-11-23' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.totalCents).toBe(20_000)
    expect(isPrototypeData(result.data)).toBe(true)
    expect(result.data.rentObligations.every(rent => rentObligationPaidCents(result.data, rent.id, '2026-11-23') === rentObligationPaidCents(data, rent.id, '2026-11-23'))).toBe(true)
  })
})
