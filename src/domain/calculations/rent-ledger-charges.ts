import type { Charge, PrototypeAppState } from '@/domain/types/models'
import { billingPeriodForDate } from './billing-periods'

/** Presentation adapter only: IDs still target the rent ledger; no duplicate calendar rent is persisted. */
export function rentLedgerCharges(data: PrototypeAppState, options: { includeFuturePeriods?: boolean } = {}): Charge[] {
  return data.rentObligations.flatMap(obligation => {
    if (obligation.state !== 'ISSUED') return []
    const rentalPeriod = data.rentalPeriods.find(period => period.id === obligation.rentalPeriodId)
    const month = data.billingPeriods.find(period => period.startDate <= obligation.dueDate && period.endDate >= obligation.dueDate)
      ?? (options.includeFuturePeriods ? billingPeriodForDate(data, obligation.dueDate) : undefined)
    const assignment = data.roomAssignments.find(item => item.roomId === obligation.roomId && rentalPeriod
      && item.startDate < rentalPeriod.endDateExclusive && (item.endDate === null || item.endDate >= rentalPeriod.startDate))
    if (!rentalPeriod || !month || !assignment) return []
    return [{
      id: obligation.id, tenantId: assignment.tenantId, billingPeriodId: month.id,
      category: 'RENT' as const, description: `Anniversary rent ${rentalPeriod.startDate} – ${rentalPeriod.endDateExclusive} (exclusive)`,
      amountCents: obligation.amountCents, agreedRentCents: obligation.amountCents, roomAssignmentId: assignment.id,
      issuedOn: obligation.issuedOn, dueDate: obligation.dueDate, state: 'ISSUED' as const, correction: null,
    }]
  })
}
