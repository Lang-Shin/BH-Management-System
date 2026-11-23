import type { Charge, ElectricityBillObligation, MeterReading, PrototypeAppState } from '@/domain/types/models'
import { activeElectricityRate } from './billing-rates'
import { electricityBaseline } from './meter-baseline'
import { electricityObligations } from './electricity-obligations'
export { latestSettledReading } from './meter-baseline'

export type ElectricityCalculationError =
  | 'OBLIGATION_NOT_FOUND'
  | 'STALE_BASELINE'
  | 'READING_DATE_INVALID'
  | 'READING_BELOW_PREVIOUS'
  | 'READING_NOT_ADVANCED'
  | 'RATE_NOT_FOUND'
  | 'INVALID_AMOUNT'
  | 'DUPLICATE_INTERVAL'

export type ElectricityCharge = Extract<Charge, { category: 'ELECTRICITY' }>

export type ElectricityCalculationResult =
  | { ok: true; charge: ElectricityCharge; currentReading: MeterReading; previousReading: MeterReading }
  | { ok: false; reason: ElectricityCalculationError }

/** Parse a displayed kWh value into exact milli-kWh without floating-point arithmetic. */
export function parseMeterReadingMilliKwh(value: string): number | null {
  if (!/^\d+(?:\.\d{0,3})?$/.test(value)) return null
  const [whole = '', fraction = ''] = value.split('.')
  const milliKwh = Number(whole) * 1000 + Number(fraction.padEnd(3, '0'))
  return Number.isSafeInteger(milliKwh) ? milliKwh : null
}

/**
 * Applies the landlord-entered current reading to an awaiting cumulative obligation.
 * Nothing is persisted here; confirmation is a separate atomic reducer action.
 */
export function calculateElectricityCharge(data: PrototypeAppState, obligationId: string, current: { readingMilliKwh: number; readOn: string }): ElectricityCalculationResult {
  const obligation = electricityObligations(data, current.readOn).find(item => item.id === obligationId && item.state === 'AWAITING_READING')
  if (!obligation) return { ok: false, reason: 'OBLIGATION_NOT_FOUND' }
  return calculateElectricityChargeForObligation(data, obligation, current)
}

/** Same calculation for a verified persisted or derived awaiting-reading obligation. */
export function calculateElectricityChargeForObligation(
  data: PrototypeAppState,
  obligation: ElectricityBillObligation,
  current: { readingMilliKwh: number; readOn: string },
): ElectricityCalculationResult {
  const previous = electricityBaseline(data, obligation.meterId)
  if (!previous) return { ok: false, reason: 'STALE_BASELINE' }
  if (previous.id !== obligation.previousReadingId) return { ok: false, reason: 'STALE_BASELINE' }
  if (current.readOn < previous.readOn || (previous.status !== 'INITIAL' && current.readOn === previous.readOn)) return { ok: false, reason: 'READING_DATE_INVALID' }
  if (!Number.isSafeInteger(current.readingMilliKwh) || current.readingMilliKwh < 0) return { ok: false, reason: 'INVALID_AMOUNT' }
  if (current.readingMilliKwh < previous.readingMilliKwh) return { ok: false, reason: 'READING_BELOW_PREVIOUS' }
  if (current.readingMilliKwh === previous.readingMilliKwh) return { ok: false, reason: 'READING_NOT_ADVANCED' }
  const rate = activeElectricityRate(data, current.readOn)
  if (!rate) return { ok: false, reason: 'RATE_NOT_FOUND' }

  const intervalId = `${obligation.meterId}:${previous.id}>${current.readingMilliKwh}`
  if (data.charges.some(charge => charge.category === 'ELECTRICITY' && charge.electricity.intervalId === intervalId)) {
    return { ok: false, reason: 'DUPLICATE_INTERVAL' }
  }
  const consumptionMilliKwh = current.readingMilliKwh - previous.readingMilliKwh
  const product = consumptionMilliKwh * rate.rateCentsPerKwh
  if (!Number.isSafeInteger(product) || !Number.isSafeInteger(product / 1000)) return { ok: false, reason: 'INVALID_AMOUNT' }
  const currentReading: MeterReading = {
    id: `reading-${obligation.meterId}-settled-${current.readingMilliKwh}`, meterId: obligation.meterId, readOn: current.readOn,
    readingMilliKwh: current.readingMilliKwh, status: 'CONFIRMED', confirmedBy: 'demo-admin', correction: null,
  }
  const charge: ElectricityCharge = {
    id: `electricity-${obligation.billingPeriodId}-${obligation.roomId}`,
    tenantId: obligation.tenantId,
    billingPeriodId: obligation.billingPeriodId,
    description: 'Cumulative electricity — settled meter interval',
    amountCents: product / 1000,
    issuedOn: current.readOn,
    dueDate: obligation.dueDate,
    state: 'ISSUED',
    correction: null,
    category: 'ELECTRICITY',
    electricity: {
      intervalId,
      meterId: obligation.meterId,
      previousReadingId: previous.id,
      currentReadingId: currentReading.id,
      previousReadingMilliKwh: previous.readingMilliKwh,
      currentReadingMilliKwh: current.readingMilliKwh,
      consumptionMilliKwh,
      rateId: rate.id,
      appliedRateCentsPerKwh: rate.rateCentsPerKwh,
      appliedRateEffectiveFrom: rate.effectiveFrom,
    },
  }
  return { ok: true, charge, currentReading, previousReading: previous }
}
