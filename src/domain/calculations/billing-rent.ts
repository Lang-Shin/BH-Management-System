import type {
  BillingPeriod, Charge, ChargeStatus, OccupancyCycle, PrototypeAppState, RentObligation, RentalPeriod,
} from '@/domain/types/models'
import { chargeBalance, chargePaid } from './summary'
import {
  rentObligationAdvanceAppliedCents, rentObligationCashPaidCents, rentObligationPaidCents,
} from './rental-periods'

export type BillingRentStatus = ChargeStatus | 'NO_BILL'
export type BillingRentSource = 'ANNIVERSARY' | 'LEGACY' | 'NONE'

export interface BillingRentLine {
  source: BillingRentSource
  /** Rent due dates that fall inside the selected utility period, inclusive on both ends. */
  selection: 'DUE_IN_CALENDAR_PERIOD' | 'LEGACY_CALENDAR_CHARGES' | 'NONE'
  periods: RentalPeriod[]
  obligations: RentObligation[]
  billedCents: number
  paidCents: number
  cashPaidCents: number
  advanceAppliedCents: number
  outstandingCents: number
  status: BillingRentStatus
}

export function anniversaryCycleForBillingPeriod(
  data: PrototypeAppState,
  roomId: string,
  period: BillingPeriod,
): OccupancyCycle | null {
  return data.occupancyCycles.find(cycle => cycle.roomId === roomId
    && cycle.rentSchedule === 'ANNIVERSARY'
    && cycle.startedAt <= period.endDate
    && (cycle.endedAt === null || cycle.endedAt >= period.startDate)) ?? null
}

/**
 * Bills-table policy: the rent shown for a selected calendar month is every anniversary rent
 * obligation whose due date falls inside that utility period. If more than one period is due
 * (for example after a re-occupancy in the same month), the row aggregates them rather than
 * choosing an arbitrary period. Legacy rooms without an anniversary cycle fall back to their
 * historical calendar rent charges.
 */
export function selectBillingRent(
  data: PrototypeAppState,
  roomId: string,
  period: BillingPeriod,
  asOf: string,
  legacyCharges: Charge[] = [],
  projectedLegacyCharges: Charge[] = [],
): BillingRentLine {
  const anniversaryCycle = anniversaryCycleForBillingPeriod(data, roomId, period)
  const periodIdsWithObligations = new Set(data.rentObligations
    .filter(obligation => obligation.roomId === roomId && obligation.state === 'ISSUED')
    .map(obligation => obligation.rentalPeriodId))
  const periods = data.rentalPeriods
    .filter(item => item.roomId === roomId
      && item.dueDate >= period.startDate
      && item.dueDate <= period.endDate
      && periodIdsWithObligations.has(item.id))
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.sequence - b.sequence)
  const obligations = periods.flatMap(item => {
    const obligation = data.rentObligations.find(candidate => candidate.rentalPeriodId === item.id && candidate.state === 'ISSUED')
    return obligation ? [obligation] : []
  })

  if (anniversaryCycle || periods.length > 0) {
    const billedCents = obligations.reduce((sum, obligation) => sum + obligation.amountCents, 0)
    const paidCents = obligations.reduce((sum, obligation) => sum + rentObligationPaidCents(data, obligation.id, asOf), 0)
    const cashPaidCents = obligations.reduce((sum, obligation) => sum + rentObligationCashPaidCents(data, obligation.id, asOf), 0)
    const advanceAppliedCents = obligations.reduce((sum, obligation) => sum + rentObligationAdvanceAppliedCents(data, obligation.id, asOf), 0)
    const outstandingCents = Math.max(0, billedCents - paidCents)
    return {
      source: 'ANNIVERSARY',
      selection: 'DUE_IN_CALENDAR_PERIOD',
      periods, obligations, billedCents, paidCents, cashPaidCents, advanceAppliedCents, outstandingCents,
      status: aggregateRentStatus(billedCents, paidCents, outstandingCents),
    }
  }

  const legacy = [...legacyCharges, ...projectedLegacyCharges].filter(charge => charge.category === 'RENT' && charge.state === 'ISSUED')
  if (legacy.length > 0) {
    const billedCents = legacy.reduce((sum, charge) => sum + charge.amountCents, 0)
    const paidCents = legacyCharges.reduce((sum, charge) => sum + chargePaid(data, charge.id, asOf), 0)
    const outstandingCents = legacyCharges.reduce((sum, charge) => sum + chargeBalance(data, charge, asOf), 0)
      + projectedLegacyCharges.reduce((sum, charge) => sum + charge.amountCents, 0)
    return {
      source: 'LEGACY', selection: 'LEGACY_CALENDAR_CHARGES',
      periods: [], obligations: [], billedCents, paidCents, cashPaidCents: paidCents, advanceAppliedCents: 0,
      outstandingCents, status: aggregateRentStatus(billedCents, paidCents, outstandingCents),
    }
  }

  return {
    source: 'NONE', selection: 'NONE', periods: [], obligations: [],
    billedCents: 0, paidCents: 0, cashPaidCents: 0, advanceAppliedCents: 0, outstandingCents: 0,
    status: 'NO_BILL',
  }
}

function aggregateRentStatus(billedCents: number, paidCents: number, outstandingCents: number): BillingRentStatus {
  if (billedCents === 0) return 'NO_BILL'
  if (outstandingCents === 0) return 'PAID'
  return paidCents > 0 ? 'PARTIALLY_PAID' : 'UNPAID'
}
