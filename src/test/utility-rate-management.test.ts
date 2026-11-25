import { describe, expect, it } from 'vitest'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import { createEmptyData } from '@/data/fixtures/empty'
import {
  activeElectricityRate, activeWashingRate, activeWaterRate,
  scheduledWashingRate, scheduledWaterRate,
} from '@/domain/calculations/billing-rates'
import {
  pendingUtilityRate, planUtilityRateChange, utilityRateHistory, type UtilityRateChangeRequest,
} from '@/domain/calculations/utility-rate-management'
import { isPrototypeData } from '@/domain/validation/prototype-data'
import type { PrototypeAppState, UtilityRateKind } from '@/domain/types/models'

const AS_OF = '2026-11-13'
const EFFECTIVE = '2026-12-01'

function request(
  intent: UtilityRateChangeRequest['intent'],
  rateKind: UtilityRateKind,
  amountCents?: number,
  reason?: string,
): UtilityRateChangeRequest {
  return { intent, rateKind, ...(amountCents !== undefined ? { amountCents } : {}), ...(reason !== undefined ? { reason } : {}) }
}

function apply(data: PrototypeAppState, change: UtilityRateChangeRequest): PrototypeAppState {
  const plan = planUtilityRateChange(data, change, AS_OF)
  if (!plan.ok) throw new Error(`${plan.code}: ${plan.errors.general}`)
  const next = prototypeReducer(data, { type: 'rates/utilityChange', ...change, asOf: AS_OF })
  expect(next).not.toBe(data)
  expect(isPrototypeData(next)).toBe(true)
  return next
}

function editRequest(data: PrototypeAppState, kind: UtilityRateKind, amountCents: number, reason = 'Corrected planned rate'): UtilityRateChangeRequest {
  const pending = pendingUtilityRate(data, kind, AS_OF)!
  return {
    ...request('EDIT', kind, amountCents, reason), expectedRateId: pending.id,
    expectedRateRevision: pending.revision ?? 1,
  }
}

function cancelRequest(data: PrototypeAppState, kind: UtilityRateKind, reason = 'Rate increase no longer needed'): UtilityRateChangeRequest {
  const pending = pendingUtilityRate(data, kind, AS_OF)!
  return {
    ...request('CANCEL', kind, undefined, reason), expectedRateId: pending.id,
    expectedRateRevision: pending.revision ?? 1,
  }
}

describe('scheduled utility rate management', () => {
  it('schedules, edits, and cancels electricity with versioned history and audit', () => {
    let data = createEmptyData(AS_OF)
    data = apply(data, request('SCHEDULE', 'ELECTRICITY', 1_400))
    expect(activeElectricityRate(data, AS_OF)?.rateCentsPerKwh).toBe(1_300)
    const original = pendingUtilityRate(data, 'ELECTRICITY', AS_OF)!
    expect(original).toMatchObject({ rateCentsPerKwh: 1_400, effectiveFrom: EFFECTIVE, revision: 1, recordedBy: 'landlord' })
    expect(data.auditEvents.at(-1)).toMatchObject({ action: 'UTILITY_RATE_SCHEDULED', entityType: 'UTILITY_RATE' })

    data = apply(data, editRequest(data, 'ELECTRICITY', 1_350))
    const replacement = pendingUtilityRate(data, 'ELECTRICITY', AS_OF)!
    expect(replacement).toMatchObject({ rateCentsPerKwh: 1_350, effectiveFrom: EFFECTIVE, revision: 2, supersedesRateId: original.id })
    expect(data.electricityRates.find(rate => rate.id === original.id)).toMatchObject({
      rateCentsPerKwh: 1_400, supersededOn: AS_OF, supersededReason: 'Corrected planned rate', supersededBy: 'landlord',
    })
    expect(data.auditEvents.at(-1)).toMatchObject({ action: 'UTILITY_RATE_EDITED', reason: 'Corrected planned rate' })

    data = apply(data, cancelRequest(data, 'ELECTRICITY'))
    expect(pendingUtilityRate(data, 'ELECTRICITY', AS_OF)).toBeUndefined()
    expect(activeElectricityRate(data, EFFECTIVE)?.rateCentsPerKwh).toBe(1_300)
    expect(data.electricityRates.find(rate => rate.id === replacement.id)).toMatchObject({
      canceledOn: AS_OF, cancelReason: 'Rate increase no longer needed', canceledBy: 'landlord',
    })
    expect(data.auditEvents.at(-1)).toMatchObject({ action: 'UTILITY_RATE_CANCELED', entityType: 'UTILITY_RATE' })
    expect(utilityRateHistory(data, 'ELECTRICITY').some(rate => rate.canceledOn)).toBe(true)
    expect(utilityRateHistory(data, 'ELECTRICITY').some(rate => rate.supersededOn)).toBe(true)
  })

  it('edits a pending water rate and activates only the replacement', () => {
    let data = createEmptyData(AS_OF)
    data = apply(data, request('SCHEDULE', 'WATER', 12_500))
    const original = pendingUtilityRate(data, 'WATER', AS_OF)!
    data = apply(data, editRequest(data, 'WATER', 11_500))
    expect(scheduledWaterRate(data, AS_OF)?.rateCents).toBe(11_500)
    expect(activeWaterRate(data, AS_OF)?.rateCents).toBe(10_000)
    expect(activeWaterRate(data, EFFECTIVE)?.rateCents).toBe(11_500)
    expect(data.auditEvents.at(-1)).toMatchObject({ action: 'UTILITY_RATE_EDITED', entityId: pendingUtilityRate(data, 'WATER', AS_OF)!.id })
    expect(data.auditEvents.at(-1)?.entityId).not.toBe(original.id)
  })

  it('cancels washing independently and leaves electricity and water schedules untouched', () => {
    let data = createEmptyData(AS_OF)
    data = apply(data, request('SCHEDULE', 'ELECTRICITY', 1_400))
    data = apply(data, request('SCHEDULE', 'WATER', 12_500))
    data = apply(data, request('SCHEDULE', 'WASHING_MACHINE', 15_000))
    const electricityBefore = pendingUtilityRate(data, 'ELECTRICITY', AS_OF)
    const waterBefore = pendingUtilityRate(data, 'WATER', AS_OF)
    data = apply(data, cancelRequest(data, 'WASHING_MACHINE'))
    expect(pendingUtilityRate(data, 'WASHING_MACHINE', AS_OF)).toBeUndefined()
    expect(pendingUtilityRate(data, 'ELECTRICITY', AS_OF)).toEqual(electricityBefore)
    expect(pendingUtilityRate(data, 'WATER', AS_OF)).toEqual(waterBefore)
    expect(activeWashingRate(data, EFFECTIVE)?.rateCents).toBe(10_000)
  })

  it('treats an edit back to the active rate as a cancellation', () => {
    let data = apply(createEmptyData(AS_OF), request('SCHEDULE', 'ELECTRICITY', 1_400))
    const plan = planUtilityRateChange(data, editRequest(data, 'ELECTRICITY', 1_300, 'Keep current rate'), AS_OF)
    expect(plan).toMatchObject({ ok: true, plan: { changeKind: 'CANCEL', currentCents: 1_300, scheduledCents: 1_400 } })
    data = apply(data, editRequest(data, 'ELECTRICITY', 1_300, 'Keep current rate'))
    expect(pendingUtilityRate(data, 'ELECTRICITY', AS_OF)).toBeUndefined()
    expect(data.auditEvents.at(-1)).toMatchObject({ action: 'UTILITY_RATE_CANCELED', reason: 'Keep current rate' })
  })

  it('rejects unchanged submissions, duplicate schedules, and missing reasons', () => {
    const data = apply(createEmptyData(AS_OF), request('SCHEDULE', 'ELECTRICITY', 1_400))
    expect(planUtilityRateChange(createEmptyData(AS_OF), request('SCHEDULE', 'ELECTRICITY', 1_300), AS_OF))
      .toMatchObject({ ok: false, code: 'NO_CHANGE' })
    expect(planUtilityRateChange(data, request('SCHEDULE', 'ELECTRICITY', 1_500), AS_OF))
      .toMatchObject({ ok: false, code: 'PENDING_EXISTS' })
    expect(planUtilityRateChange(data, editRequest(data, 'ELECTRICITY', 1_400), AS_OF))
      .toMatchObject({ ok: false, code: 'UNCHANGED_SCHEDULE' })
    expect(planUtilityRateChange(data, { ...editRequest(data, 'ELECTRICITY', 1_350), reason: '' }, AS_OF))
      .toMatchObject({ ok: false, code: 'REASON_REQUIRED' })
    expect(planUtilityRateChange(data, { ...cancelRequest(data, 'ELECTRICITY'), reason: ' ' }, AS_OF))
      .toMatchObject({ ok: false, code: 'REASON_REQUIRED' })
  })

  it('rejects stale and post-effective changes', () => {
    const data = apply(createEmptyData(AS_OF), request('SCHEDULE', 'ELECTRICITY', 1_400))
    const pending = pendingUtilityRate(data, 'ELECTRICITY', AS_OF)!
    expect(planUtilityRateChange(data, {
      ...editRequest(data, 'ELECTRICITY', 1_350), expectedRateRevision: 9,
    }, AS_OF)).toMatchObject({ ok: false, code: 'STALE_CHANGE' })
    expect(planUtilityRateChange(data, {
      ...editRequest(data, 'ELECTRICITY', 1_350), expectedRateId: 'missing',
    }, AS_OF)).toMatchObject({ ok: false, code: 'STALE_CHANGE' })
    expect(planUtilityRateChange(data, {
      ...cancelRequest(data, 'ELECTRICITY'), expectedRateId: pending.id, expectedRateRevision: pending.revision,
    }, EFFECTIVE)).toMatchObject({ ok: false, code: 'EFFECTIVE_DATE_PASSED' })
  })

  it('does not rewrite historical charges or their applied electricity rate snapshots', () => {
    const base = createEmptyData(AS_OF)
    const historical = {
      charges: structuredClone(base.charges), readings: structuredClone(base.meterReadings),
      receipts: structuredClone(base.receipts), payments: structuredClone(base.payments),
    }
    let data = apply(base, request('SCHEDULE', 'ELECTRICITY', 1_400))
    data = apply(data, editRequest(data, 'ELECTRICITY', 1_350))
    data = apply(data, cancelRequest(data, 'ELECTRICITY'))
    expect(data.charges).toEqual(historical.charges)
    expect(data.meterReadings).toEqual(historical.readings)
    expect(data.receipts).toEqual(historical.receipts)
    expect(data.payments).toEqual(historical.payments)
  })

  it('keeps canceled and replaced utility records out of active selection', () => {
    let data = createEmptyData(AS_OF)
    data = apply(data, request('SCHEDULE', 'WASHING_MACHINE', 15_000))
    data = apply(data, editRequest(data, 'WASHING_MACHINE', 14_000))
    data = apply(data, cancelRequest(data, 'WASHING_MACHINE'))
    expect(scheduledWashingRate(data, AS_OF)).toBeUndefined()
    expect(activeWashingRate(data, EFFECTIVE)?.rateCents).toBe(10_000)
    const history = utilityRateHistory(data, 'WASHING_MACHINE')
    expect(history.some(rate => rate.canceledOn)).toBe(true)
    expect(history.some(rate => rate.supersededOn)).toBe(true)
  })

  it('allows a fresh schedule after cancellation with a new revision', () => {
    let data = createEmptyData(AS_OF)
    data = apply(data, request('SCHEDULE', 'WATER', 12_500))
    data = apply(data, cancelRequest(data, 'WATER'))
    data = apply(data, request('SCHEDULE', 'WATER', 11_500))
    expect(pendingUtilityRate(data, 'WATER', AS_OF)).toMatchObject({ rateCents: 11_500, revision: 2 })
    expect(utilityRateHistory(data, 'WATER').filter(rate => rate.effectiveFrom === EFFECTIVE)).toHaveLength(2)
  })
})
