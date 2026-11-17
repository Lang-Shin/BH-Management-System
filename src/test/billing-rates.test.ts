import { describe, expect, it } from 'vitest'
import { createDemoData, DEMO_DATE } from '@/data/fixtures/demo'
import {
  activeElectricityRate, activeRoomRentRate, activeWashingRate, activeWaterRate, applyRateChange,
  nextRateEffectiveFrom, parseRateInput, planRateChange, scheduledElectricityRate,
  scheduledRoomRentRate, scheduledWashingRate, scheduledWaterRate,
} from '@/domain/calculations/billing-rates'
import { calculateElectricityCharge } from '@/domain/calculations/electricity-calculation'
import { createTenant } from '@/domain/calculations/tenant-management'
import { isPrototypeData } from '@/domain/validation/prototype-data'

describe('billing rate planning', () => {
  it('parses positive centavo amounts and rejects invalid precision or values', () => {
    expect(parseRateInput('3500')).toEqual({ ok: true, cents: 350_000 })
    expect(parseRateInput('₱3,500.00')).toEqual({ ok: true, cents: 350_000 })
    expect(parseRateInput('13.50')).toEqual({ ok: true, cents: 1_350 })
    for (const value of ['', '0', '-1', '1.234', 'NaN', 'Infinity', '1,00']) {
      expect(parseRateInput(value).ok).toBe(false)
    }
  })

  it('schedules rent changes for the next billing period without changing room categories or history', () => {
    const data = createDemoData()
    const before = structuredClone(data)
    const result = planRateChange(data, {
      kind: 'RENT', values: { RATE_3500: 360_000, RATE_4000: 410_000, RATE_5000: 510_000 },
    }, DEMO_DATE)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.effectiveFrom).toBe('2026-12-01')
    expect(result.plan.changes).toHaveLength(3)
    expect(data).toEqual(before)

    const updated = applyRateChange(data, result.plan)
    expect(isPrototypeData(updated)).toBe(true)
    expect(activeRoomRentRate(updated, 'RATE_3500', DEMO_DATE)?.monthlyRentCents).toBe(350_000)
    expect(activeRoomRentRate(updated, 'RATE_3500', '2026-12-01')?.monthlyRentCents).toBe(360_000)
    expect(scheduledRoomRentRate(updated, 'RATE_3500', DEMO_DATE)?.monthlyRentCents).toBe(360_000)
    expect(updated.rooms.map(room => [room.id, room.categoryId])).toEqual(data.rooms.map(room => [room.id, room.categoryId]))
    expect(updated.charges).toEqual(data.charges)
    expect(updated.receipts).toEqual(data.receipts)
    expect(updated.meterReadings).toEqual(data.meterReadings)
    expect(updated.roomAssignments).toEqual(data.roomAssignments)
  })

  it('rejects duplicate rent amounts and a no-op review', () => {
    const data = createDemoData()
    expect(planRateChange(data, { kind: 'RENT', values: { RATE_3500: 400_000, RATE_4000: 400_000, RATE_5000: 500_000 } }, DEMO_DATE))
      .toMatchObject({ ok: false })
    expect(planRateChange(data, { kind: 'RENT', values: { RATE_3500: 350_000, RATE_4000: 400_000, RATE_5000: 500_000 } }, DEMO_DATE))
      .toMatchObject({ ok: false, errors: { general: 'No rate change to review.' } })
  })

  it('schedules and replaces electricity rates without replacing the active rate', () => {
    const data = createDemoData()
    const first = planRateChange(data, { kind: 'ELECTRICITY', amountCents: 1_400 }, DEMO_DATE)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const once = applyRateChange(data, first.plan)
    expect(isPrototypeData(once)).toBe(true)
    expect(activeElectricityRate(once, DEMO_DATE)?.rateCentsPerKwh).toBe(1_300)
    expect(activeElectricityRate(once, '2026-12-01')?.rateCentsPerKwh).toBe(1_400)
    expect(scheduledElectricityRate(once, DEMO_DATE)?.effectiveFrom).toBe('2026-12-01')
    expect(once.charges).toEqual(data.charges)
    expect(once.receipts).toEqual(data.receipts)
    expect(once.meterReadings).toEqual(data.meterReadings)
    const rateCount = once.electricityRates.length

    const second = planRateChange(once, { kind: 'ELECTRICITY', amountCents: 1_500 }, DEMO_DATE)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    const twice = applyRateChange(once, second.plan)
    expect(twice.electricityRates).toHaveLength(rateCount)
    expect(activeElectricityRate(twice, '2026-12-01')?.rateCentsPerKwh).toBe(1_500)
    expect(planRateChange(twice, { kind: 'ELECTRICITY', amountCents: 1_300 }, DEMO_DATE).ok).toBe(false)
  })

  it('schedules water and washing rates independently and keeps subscriptions', () => {
    const data = createDemoData()
    const water = planRateChange(data, { kind: 'WATER', amountCents: 12_500 }, DEMO_DATE)
    const washing = planRateChange(data, { kind: 'WASHING_MACHINE', amountCents: 15_000 }, DEMO_DATE)
    expect(water.ok && washing.ok).toBe(true)
    if (!water.ok || !washing.ok) return
    const withWater = applyRateChange(data, water.plan)
    const updated = applyRateChange(withWater, washing.plan)
    expect(isPrototypeData(updated)).toBe(true)
    expect(activeWaterRate(updated, DEMO_DATE)?.rateCents).toBe(10_000)
    expect(activeWaterRate(updated, '2026-12-01')?.rateCents).toBe(12_500)
    expect(activeWashingRate(updated, DEMO_DATE)?.rateCents).toBe(10_000)
    expect(activeWashingRate(updated, '2026-12-01')?.rateCents).toBe(15_000)
    expect(scheduledWaterRate(updated, DEMO_DATE)?.rateCents).toBe(12_500)
    expect(scheduledWashingRate(updated, DEMO_DATE)?.rateCents).toBe(15_000)
    expect((activeWaterRate(updated, '2026-12-01')?.rateCents ?? 0) * 2).toBe(25_000)
    expect(activeWashingRate(updated, '2026-12-01')?.rateCents).toBe(15_000)
    expect(updated.rooms.map(room => room.washingMachineEnabled)).toEqual(data.rooms.map(room => room.washingMachineEnabled))
    expect(updated.charges).toEqual(data.charges)
  })

  it('applies a scheduled electricity rate to later cumulative readings without rewriting settled history', () => {
    const data = createDemoData()
    const plan = planRateChange(data, { kind: 'ELECTRICITY', amountCents: 1_400 }, DEMO_DATE)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const updated = applyRateChange(data, plan.plan)
    const result = calculateElectricityCharge(updated, 'electricity-nov-room-4-awaiting', { readingMilliKwh: 325_000, readOn: '2026-12-05' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.charge.amountCents).toBe(35_000)
    expect(result.charge.electricity).toMatchObject({ appliedRateCentsPerKwh: 1_400, appliedRateEffectiveFrom: '2026-12-01' })
    expect(updated.charges).toEqual(data.charges)
    expect(updated.receipts).toEqual(data.receipts)
  })

  it('uses the configured future category rate for a later room assignment', () => {
    const data = createDemoData()
    const plan = planRateChange(data, { kind: 'RENT', values: { RATE_3500: 360_000, RATE_4000: 410_000, RATE_5000: 510_000 } }, DEMO_DATE)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const updated = applyRateChange(data, plan.plan)
    const result = createTenant(updated, {
      name: 'Future Tenant', email: '', phone: '', address: '', roomId: 'room-7', moveInDate: '2026-12-02', notes: '',
    }, DEMO_DATE)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.roomAssignments.find(assignment => assignment.tenantId === result.tenant.id)).toMatchObject({ agreedRentCents: 360_000 })
  })

  it('uses the next billing period and preserves rate history recording dates', () => {
    const data = createDemoData()
    expect(nextRateEffectiveFrom(data, DEMO_DATE)).toBe('2026-12-01')
    const plan = planRateChange(data, { kind: 'WATER', amountCents: 11_000 }, DEMO_DATE)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const updated = applyRateChange(data, plan.plan)
    const scheduled = updated.waterRates.find(rate => rate.effectiveFrom === '2026-12-01')
    expect(scheduled).toMatchObject({ rateCents: 11_000, recordedOn: DEMO_DATE })
    expect(updated.waterRates.find(rate => rate.effectiveFrom === '2026-09-01')).toMatchObject({ rateCents: 10_000 })
  })
})
