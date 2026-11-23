import type { PrototypeAppState } from '@/domain/types/models'
import {
  DEFAULT_ELECTRICITY_RATE_CENTS, DEFAULT_RENT_CENTS, DEFAULT_WASHING_RATE_CENTS, DEFAULT_WATER_RATE_CENTS,
  ROOM_RATE_CATEGORY_IDS,
} from './billing-rates'

const BASELINE_EFFECTIVE_FROM = '2026-01-01'
const LEGACY_DEFAULT_EFFECTIVE_FROM = '2026-09-01'

/**
 * The initial workspace is usable from January 2026, while early builds created default rates
 * effective September 2026. Add the missing default baseline once so historical move-ins can
 * receive water/washing/electricity charges without rewriting later rate records.
 */
export function ensureInitialRateBaseline(data: PrototypeAppState, options: { force?: boolean } = {}): PrototypeAppState {
  if (!options.force
    && !data.roomAssignments.some(assignment => assignment.startDate < LEGACY_DEFAULT_EFFECTIVE_FROM)
    && !data.occupancyCycles.some(cycle => cycle.startedAt < LEGACY_DEFAULT_EFFECTIVE_FROM)
    && !data.rentalPeriods.some(period => period.startDate < LEGACY_DEFAULT_EFFECTIVE_FROM)) return data
  let changed = false
  const electricityRates = [...data.electricityRates]
  const roomRentRates = [...data.roomRentRates]
  const waterRates = [...data.waterRates]
  const washingRates = [...data.washingRates]

  if (!electricityRates.some(rate => rate.effectiveFrom <= BASELINE_EFFECTIVE_FROM)) {
    const earliest = [...electricityRates].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0]
    if (earliest?.effectiveFrom === LEGACY_DEFAULT_EFFECTIVE_FROM && earliest.rateCentsPerKwh === DEFAULT_ELECTRICITY_RATE_CENTS) {
      electricityRates.push({ ...earliest, id: `electricity-rate-${BASELINE_EFFECTIVE_FROM}`, effectiveFrom: BASELINE_EFFECTIVE_FROM, recordedOn: BASELINE_EFFECTIVE_FROM })
      changed = true
    }
  }

  for (const categoryId of ROOM_RATE_CATEGORY_IDS) {
    const categoryRates = roomRentRates.filter(rate => rate.categoryId === categoryId)
    if (categoryRates.some(rate => rate.effectiveFrom <= BASELINE_EFFECTIVE_FROM)) continue
    const earliest = [...categoryRates].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0]
    if (earliest?.effectiveFrom === LEGACY_DEFAULT_EFFECTIVE_FROM && earliest.monthlyRentCents === DEFAULT_RENT_CENTS[categoryId]) {
      roomRentRates.push({ ...earliest, id: `rent-rate-${categoryId}-${BASELINE_EFFECTIVE_FROM}`, effectiveFrom: BASELINE_EFFECTIVE_FROM, recordedOn: BASELINE_EFFECTIVE_FROM })
      changed = true
    }
  }

  if (!waterRates.some(rate => rate.effectiveFrom <= BASELINE_EFFECTIVE_FROM)) {
    const earliest = [...waterRates].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0]
    if (earliest?.effectiveFrom === LEGACY_DEFAULT_EFFECTIVE_FROM && earliest.rateCents === DEFAULT_WATER_RATE_CENTS) {
      waterRates.push({ ...earliest, id: `water-rate-${BASELINE_EFFECTIVE_FROM}`, effectiveFrom: BASELINE_EFFECTIVE_FROM, recordedOn: BASELINE_EFFECTIVE_FROM })
      changed = true
    }
  }

  if (!washingRates.some(rate => rate.effectiveFrom <= BASELINE_EFFECTIVE_FROM)) {
    const earliest = [...washingRates].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0]
    if (earliest?.effectiveFrom === LEGACY_DEFAULT_EFFECTIVE_FROM && earliest.rateCents === DEFAULT_WASHING_RATE_CENTS) {
      washingRates.push({ ...earliest, id: `washing-rate-${BASELINE_EFFECTIVE_FROM}`, effectiveFrom: BASELINE_EFFECTIVE_FROM, recordedOn: BASELINE_EFFECTIVE_FROM })
      changed = true
    }
  }

  return changed ? { ...data, electricityRates, roomRentRates, waterRates, washingRates } : data
}
