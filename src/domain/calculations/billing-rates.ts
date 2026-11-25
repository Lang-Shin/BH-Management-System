import type { ElectricityRate, PrototypeAppState, Room, RoomCategoryId, RoomRentRate, UtilityRate } from '@/domain/types/models'

export const ROOM_RATE_CATEGORY_IDS = ['RATE_3500', 'RATE_4000', 'RATE_5000'] as const satisfies readonly RoomCategoryId[]

export const DEFAULT_RENT_CENTS: Record<RoomCategoryId, number> = {
  RATE_3500: 350_000,
  RATE_4000: 400_000,
  RATE_5000: 500_000,
}

export const DEFAULT_ELECTRICITY_RATE_CENTS = 1_300
export const DEFAULT_WATER_RATE_CENTS = 10_000
export const DEFAULT_WASHING_RATE_CENTS = 10_000
export const INITIAL_RATE_EFFECTIVE_FROM = '2026-09-01'

export function initialElectricityRates(): ElectricityRate[] {
  return [{
    id: `electricity-rate-${INITIAL_RATE_EFFECTIVE_FROM}`,
    rateCentsPerKwh: DEFAULT_ELECTRICITY_RATE_CENTS,
    effectiveFrom: INITIAL_RATE_EFFECTIVE_FROM,
    recordedOn: INITIAL_RATE_EFFECTIVE_FROM,
    label: 'Default electricity rate',
  }]
}

export function initialRoomRentRates(): RoomRentRate[] {
  return ROOM_RATE_CATEGORY_IDS.map(categoryId => ({
    id: `rent-rate-${categoryId}-${INITIAL_RATE_EFFECTIVE_FROM}`,
    categoryId,
    monthlyRentCents: DEFAULT_RENT_CENTS[categoryId],
    effectiveFrom: INITIAL_RATE_EFFECTIVE_FROM,
    recordedOn: INITIAL_RATE_EFFECTIVE_FROM,
  }))
}

export function initialWaterRates(): UtilityRate[] {
  return [{
    id: `water-rate-${INITIAL_RATE_EFFECTIVE_FROM}`,
    rateCents: DEFAULT_WATER_RATE_CENTS,
    effectiveFrom: INITIAL_RATE_EFFECTIVE_FROM,
    recordedOn: INITIAL_RATE_EFFECTIVE_FROM,
  }]
}

export function initialWashingRates(): UtilityRate[] {
  return [{
    id: `washing-rate-${INITIAL_RATE_EFFECTIVE_FROM}`,
    rateCents: DEFAULT_WASHING_RATE_CENTS,
    effectiveFrom: INITIAL_RATE_EFFECTIVE_FROM,
    recordedOn: INITIAL_RATE_EFFECTIVE_FROM,
  }]
}

function latestEffective<T extends { effectiveFrom: string }>(records: T[], asOf: string): T | undefined {
  return [...records]
    .filter(record => record.effectiveFrom <= asOf)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]
}

function earliestFuture<T extends { effectiveFrom: string }>(records: T[], asOf: string): T | undefined {
  return [...records]
    .filter(record => record.effectiveFrom > asOf)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0]
}

export function rateRecordIsEligible(rate: { canceledOn?: string; supersededOn?: string }): boolean {
  return !rate.canceledOn && !rate.supersededOn
}

export function activeElectricityRate(data: PrototypeAppState, asOf: string): ElectricityRate | undefined {
  return latestEffective(data.electricityRates.filter(rateRecordIsEligible), asOf)
}

export function scheduledElectricityRate(data: PrototypeAppState, asOf: string): ElectricityRate | undefined {
  return earliestFuture(data.electricityRates.filter(rateRecordIsEligible), asOf)
}

export function activeWaterRate(data: PrototypeAppState, asOf: string): UtilityRate | undefined {
  return latestEffective(data.waterRates.filter(rateRecordIsEligible), asOf)
}

export function scheduledWaterRate(data: PrototypeAppState, asOf: string): UtilityRate | undefined {
  return earliestFuture(data.waterRates.filter(rateRecordIsEligible), asOf)
}

export function activeWashingRate(data: PrototypeAppState, asOf: string): UtilityRate | undefined {
  return latestEffective(data.washingRates.filter(rateRecordIsEligible), asOf)
}

export function scheduledWashingRate(data: PrototypeAppState, asOf: string): UtilityRate | undefined {
  return earliestFuture(data.washingRates.filter(rateRecordIsEligible), asOf)
}

/** Canceled and replaced schedules remain in history but are never eligible to become active. */
export function eligibleUtilityRate(rate: ElectricityRate | UtilityRate): boolean {
  return rateRecordIsEligible(rate)
}

export function eligibleRoomRentRate(rate: RoomRentRate): boolean {
  return rateRecordIsEligible(rate)
}

export function activeRoomRentRate(data: PrototypeAppState, categoryId: RoomCategoryId, asOf: string): RoomRentRate | undefined {
  return latestEffective(data.roomRentRates.filter(rate => rate.categoryId === categoryId && eligibleRoomRentRate(rate)), asOf)
}

export function scheduledRoomRentRate(data: PrototypeAppState, categoryId: RoomCategoryId, asOf: string): RoomRentRate | undefined {
  return earliestFuture(data.roomRentRates.filter(rate => rate.categoryId === categoryId && eligibleRoomRentRate(rate)), asOf)
}

export function activeRoomRentRates(data: PrototypeAppState, asOf: string): RoomRentRate[] {
  return ROOM_RATE_CATEGORY_IDS
    .map(categoryId => activeRoomRentRate(data, categoryId, asOf))
    .filter((rate): rate is RoomRentRate => Boolean(rate))
}

export function scheduledRoomRentRates(data: PrototypeAppState, asOf: string): RoomRentRate[] {
  return ROOM_RATE_CATEGORY_IDS
    .map(categoryId => scheduledRoomRentRate(data, categoryId, asOf))
    .filter((rate): rate is RoomRentRate => Boolean(rate))
}

export function roomMonthlyRentCents(data: PrototypeAppState, room: Pick<Room, 'categoryId'>, asOf: string): number {
  return activeRoomRentRate(data, room.categoryId, asOf)?.monthlyRentCents ?? DEFAULT_RENT_CENTS[room.categoryId]
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

/** The next period begins the day after the period containing the current sample date. */
export function nextRateEffectiveFrom(data: PrototypeAppState, asOf: string): string {
  const current = [...data.billingPeriods]
    .filter(period => period.startDate <= asOf)
    .sort((a, b) => b.startDate.localeCompare(a.startDate))[0]
  return addDays(current?.endDate ?? asOf, 1)
}

export type RatePlanInput =
  | { kind: 'RENT'; values: Record<RoomCategoryId, number> }
  | { kind: 'ELECTRICITY' | 'WATER' | 'WASHING_MACHINE'; amountCents: number }

export interface RateChangeRow {
  key: string
  label: string
  previousCents: number
  newCents: number
  unit: string
  roomCount?: number
}

export type RatePlan =
  | { kind: 'RENT'; effectiveFrom: string; recordedOn: string; values: Record<RoomCategoryId, number>; changes: RateChangeRow[] }
  | { kind: 'ELECTRICITY' | 'WATER' | 'WASHING_MACHINE'; effectiveFrom: string; recordedOn: string; amountCents: number; changes: RateChangeRow[] }

export type RatePlanResult =
  | { ok: true; plan: RatePlan }
  | { ok: false; errors: Record<string, string> }

function validAmount(amountCents: number): boolean {
  return Number.isSafeInteger(amountCents) && amountCents > 0
}

function categoryLabel(categoryId: RoomCategoryId): string {
  const index = ROOM_RATE_CATEGORY_IDS.indexOf(categoryId)
  return `Rate category ${index + 1}`
}

export function planRateChange(data: PrototypeAppState, input: RatePlanInput, asOf: string): RatePlanResult {
  const effectiveFrom = nextRateEffectiveFrom(data, asOf)
  const errors: Record<string, string> = {}

  if (input.kind === 'RENT') {
    const proposed = new Set<number>()
    for (const categoryId of ROOM_RATE_CATEGORY_IDS) {
      const amount = input.values[categoryId]
      if (!validAmount(amount)) errors[categoryId] = 'Enter a positive rent amount.'
      else if (proposed.has(amount)) errors[categoryId] = 'Each rent category must have a distinct amount.'
      else proposed.add(amount)
    }
    if (Object.keys(errors).length > 0) return { ok: false, errors }

    const changes: RateChangeRow[] = []
    for (const categoryId of ROOM_RATE_CATEGORY_IDS) {
      const active = activeRoomRentRate(data, categoryId, asOf)
      if (!active) {
        errors.general = 'A rent-rate category has no active configuration. The change cannot be scheduled safely.'
        return { ok: false, errors }
      }
      const scheduled = data.roomRentRates.find(rate => rate.categoryId === categoryId && rate.effectiveFrom === effectiveFrom && eligibleRoomRentRate(rate))
      const previousEffective = scheduled?.monthlyRentCents ?? active.monthlyRentCents
      const newAmount = input.values[categoryId]
      if (scheduled && newAmount === active.monthlyRentCents) {
        errors[categoryId] = 'Enter a different future amount.'
      } else if (newAmount !== previousEffective) {
        changes.push({
          key: categoryId,
          label: categoryLabel(categoryId),
          previousCents: active.monthlyRentCents,
          newCents: newAmount,
          unit: 'per room per month',
          roomCount: data.rooms.filter(room => room.categoryId === categoryId).length,
        })
      }
    }
    if (Object.keys(errors).length > 0) return { ok: false, errors }
    if (changes.length === 0) return { ok: false, errors: { general: 'No rate change to review.' } }
    return { ok: true, plan: { kind: 'RENT', effectiveFrom, recordedOn: asOf, values: input.values, changes } }
  }

  if (!validAmount(input.amountCents)) return { ok: false, errors: { amount: 'Enter a positive rate amount.' } }
  const active = input.kind === 'ELECTRICITY'
    ? activeElectricityRate(data, asOf)
    : input.kind === 'WATER' ? activeWaterRate(data, asOf) : activeWashingRate(data, asOf)
  if (!active) return { ok: false, errors: { general: 'The current rate configuration is incomplete.' } }
  const currentCents = 'rateCentsPerKwh' in active ? active.rateCentsPerKwh : active.rateCents
  const scheduled = input.kind === 'ELECTRICITY'
    ? data.electricityRates.find(rate => rate.effectiveFrom === effectiveFrom && eligibleUtilityRate(rate))
    : input.kind === 'WATER'
      ? data.waterRates.find(rate => rate.effectiveFrom === effectiveFrom && eligibleUtilityRate(rate))
      : data.washingRates.find(rate => rate.effectiveFrom === effectiveFrom && eligibleUtilityRate(rate))
  const scheduledCents = scheduled
    ? input.kind === 'ELECTRICITY' ? (scheduled as ElectricityRate).rateCentsPerKwh : (scheduled as UtilityRate).rateCents
    : null
  if (scheduledCents !== null && input.amountCents === currentCents) {
    return { ok: false, errors: { amount: 'Enter a different future amount.' } }
  }
  if (input.amountCents === (scheduledCents ?? currentCents)) return { ok: false, errors: { general: 'No rate change to review.' } }

  const unit = input.kind === 'ELECTRICITY' ? 'per kWh' : input.kind === 'WATER' ? 'per tenant per billing period' : 'per subscribed room per billing period'
  return {
    ok: true,
    plan: {
      kind: input.kind, effectiveFrom, recordedOn: asOf, amountCents: input.amountCents,
      changes: [{ key: input.kind, label: input.kind === 'ELECTRICITY' ? 'Electricity' : input.kind === 'WATER' ? 'Water' : 'Washing machine', previousCents: currentCents, newCents: input.amountCents, unit }],
    },
  }
}

function upsertScheduled<T extends { id: string; effectiveFrom: string; recordedOn: string; canceledOn?: string; supersededOn?: string }>(
  records: T[], effectiveFrom: string, idPrefix: string, create: (id: string) => T, update: (record: T) => T,
): T[] {
  const scheduled = records.find(record => record.effectiveFrom === effectiveFrom && !record.canceledOn && !record.supersededOn)
  return scheduled
    ? records.map(record => record.id === scheduled.id ? update(record) : record)
    : [...records, create(`${idPrefix}-${effectiveFrom}`)]
}

export function applyRateChange(data: PrototypeAppState, plan: RatePlan): PrototypeAppState {
  if (plan.kind === 'RENT') {
    let roomRentRates = data.roomRentRates
    for (const categoryId of ROOM_RATE_CATEGORY_IDS) {
      const active = activeRoomRentRate(data, categoryId, plan.recordedOn)
      const scheduled = data.roomRentRates.find(rate => rate.categoryId === categoryId && rate.effectiveFrom === plan.effectiveFrom && eligibleRoomRentRate(rate))
      const target = scheduled?.monthlyRentCents ?? active?.monthlyRentCents
      if (!active || plan.values[categoryId] === target) continue
      if (scheduled) {
        roomRentRates = roomRentRates.map(rate => rate.id === scheduled.id
          ? { ...rate, monthlyRentCents: plan.values[categoryId], recordedOn: plan.recordedOn }
          : rate)
      } else {
        roomRentRates = [...roomRentRates, {
          id: `rent-rate-${categoryId}-${plan.effectiveFrom}`, categoryId,
          monthlyRentCents: plan.values[categoryId], effectiveFrom: plan.effectiveFrom, recordedOn: plan.recordedOn,
        }]
      }
    }
    return { ...data, roomRentRates }
  }

  if (plan.kind === 'ELECTRICITY') {
    return {
      ...data,
      electricityRates: upsertScheduled(
        data.electricityRates, plan.effectiveFrom, 'electricity-rate',
        id => ({ id, rateCentsPerKwh: plan.amountCents, effectiveFrom: plan.effectiveFrom, recordedOn: plan.recordedOn, label: `Rate effective ${plan.effectiveFrom}` }),
        rate => ({ ...rate, rateCentsPerKwh: plan.amountCents, recordedOn: plan.recordedOn }),
      ),
    }
  }
  const key = plan.kind === 'WATER' ? 'waterRates' : 'washingRates'
  return {
    ...data,
    [key]: upsertScheduled(
      data[key], plan.effectiveFrom, plan.kind === 'WATER' ? 'water-rate' : 'washing-rate',
      id => ({ id, rateCents: plan.amountCents, effectiveFrom: plan.effectiveFrom, recordedOn: plan.recordedOn }),
      rate => ({ ...rate, rateCents: plan.amountCents, recordedOn: plan.recordedOn }),
    ),
  }
}

export function parseRateInput(value: string): { ok: true; cents: number } | { ok: false; message: string } {
  const trimmed = value.trim().replace(/^₱\s*/, '').replace(/\s+/g, '')
  if (!/^\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?$|^\d+(?:\.\d{1,2})?$/.test(trimmed)) {
    return { ok: false, message: 'Enter a positive amount with at most two decimal places.' }
  }
  const [whole = '', fraction = ''] = trimmed.replace(/,/g, '').split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents) || cents <= 0) return { ok: false, message: 'Enter a positive amount with at most two decimal places.' }
  return { ok: true, cents }
}
