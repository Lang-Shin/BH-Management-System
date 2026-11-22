import type { ChargeStatus, PrototypeAppState, RentObligation, RentalPeriod } from '@/domain/types/models'
import {
  rentObligationAdvanceAppliedCents, rentObligationCashPaidCents, rentObligationPaidCents, rentObligationStatus,
  rentalPeriodsForCycle,
} from './rental-periods'

export interface RentPeriodReport {
  period: RentalPeriod
  obligation: RentObligation | null
  amountCents: number
  cashPaidCents: number
  advanceAppliedCents: number
  paidCents: number
  balanceCents: number
  status: ChargeStatus
  coveredByAdvance: boolean
}

export interface RentCycleReport {
  cycleId: string
  roomId: string
  roomName: string
  anchorDate: string
  periods: RentPeriodReport[]
  billedCents: number
  cashAppliedCents: number
  advanceAppliedCents: number
  paidCents: number
  outstandingCents: number
}

export function selectRentCycleReport(data: PrototypeAppState, cycleId: string, asOf: string): RentCycleReport | null {
  const cycle = data.occupancyCycles.find(item => item.id === cycleId)
  const room = cycle && data.rooms.find(item => item.id === cycle.roomId)
  if (!cycle || !room || cycle.rentSchedule !== 'ANNIVERSARY' || !cycle.rentAnchorDate) return null
  const periods: RentPeriodReport[] = rentalPeriodsForCycle(data, cycle.id).map(period => {
    const obligation = data.rentObligations.find(item => item.rentalPeriodId === period.id) ?? null
    const cashPaidCents = obligation ? rentObligationCashPaidCents(data, obligation.id, asOf) : 0
    const advanceAppliedCents = obligation ? rentObligationAdvanceAppliedCents(data, obligation.id, asOf) : 0
    const paidCents = obligation ? rentObligationPaidCents(data, obligation.id, asOf) : 0
    return {
      period, obligation,
      amountCents: obligation?.amountCents ?? 0,
      cashPaidCents, advanceAppliedCents, paidCents,
      balanceCents: obligation ? Math.max(0, obligation.amountCents - paidCents) : 0,
      status: obligation ? rentObligationStatus(data, obligation, asOf) : 'UNPAID',
      coveredByAdvance: advanceAppliedCents > 0,
    }
  })
  return {
    cycleId: cycle.id, roomId: room.id, roomName: room.name, anchorDate: cycle.rentAnchorDate, periods,
    billedCents: periods.reduce((sum, period) => sum + period.amountCents, 0),
    cashAppliedCents: periods.reduce((sum, period) => sum + period.cashPaidCents, 0),
    advanceAppliedCents: periods.reduce((sum, period) => sum + period.advanceAppliedCents, 0),
    paidCents: periods.reduce((sum, period) => sum + period.paidCents, 0),
    outstandingCents: periods.reduce((sum, period) => sum + period.balanceCents, 0),
  }
}

export function selectAnniversaryRentReport(data: PrototypeAppState, asOf: string): RentCycleReport[] {
  return data.occupancyCycles
    .filter(cycle => cycle.rentSchedule === 'ANNIVERSARY' && cycle.status === 'ACTIVE')
    .flatMap(cycle => selectRentCycleReport(data, cycle.id, asOf) ?? [])
    .sort((a, b) => a.roomName.localeCompare(b.roomName, 'en', { numeric: true }))
}

export function selectRentPrepaymentReview(data: PrototypeAppState, asOf: string) {
  return data.rentPrepayments.filter(prepayment => prepayment.createdAt <= asOf)
    .map(prepayment => ({
      prepayment,
      room: data.rooms.find(room => room.id === prepayment.roomId),
      payment: data.payments.find(payment => payment.id === prepayment.paymentId),
      periods: prepayment.rentalPeriodIds.flatMap(id => {
        const period = data.rentalPeriods.find(item => item.id === id)
        return period ? [period] : []
      }),
    }))
}
