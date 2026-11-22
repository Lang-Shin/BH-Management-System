import type { OccupancyCycle, PrototypeAppState, RoomAssignment, RentalPeriod } from '@/domain/types/models'
import { activeAssignments, chargePaid } from './summary'
import {
  dateParts, formatCivilDate, nextAnniversaryStartAfter, rentObligationPaidCents, rentalPeriodsForCycle,
} from './rental-periods'

export interface InternalTransferContext {
  tenantId: string
  sourceAssignment: RoomAssignment
  sourceCycle: OccupancyCycle | null
  transferDate: string
  nextRentStart: string
  sourcePeriodCoveringTransfer: RentalPeriod | null
  sourcePrepaidPeriodStartingAtNextRent: RentalPeriod | null
  sourceHasPaidOrPrepaidCoverage: boolean
}

function nextCalendarMonthStart(date: string): string {
  const parts = dateParts(date)
  return parts.month === 12
    ? formatCivilDate(parts.year + 1, 1, 1)
    : formatCivilDate(parts.year, parts.month + 1, 1)
}

function priorAssignment(data: PrototypeAppState, tenantId: string, destinationRoomId: string, destinationStart: string): RoomAssignment | null {
  return [...data.roomAssignments]
    .filter(assignment => assignment.tenantId === tenantId
      && assignment.roomId !== destinationRoomId
      && assignment.endDate !== null
      && assignment.endDate < destinationStart)
    .sort((a, b) => (b.endDate ?? '').localeCompare(a.endDate ?? '') || b.startDate.localeCompare(a.startDate))[0] ?? null
}

function sourceCycleFor(data: PrototypeAppState, assignment: RoomAssignment): OccupancyCycle | null {
  return [...data.occupancyCycles]
    .filter(cycle => cycle.roomId === assignment.roomId
      && cycle.startedAt <= assignment.startDate
      && (cycle.endedAt === null || cycle.endedAt >= (assignment.endDate ?? assignment.startDate)))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null
}

/**
 * Detects an internal transfer from a destination room's newly active assignment. A transfer
 * schedules the destination rate from the next rent period after the transfer date; it never
 * creates a mid-period destination rent obligation.
 */
export function internalTransferContext(data: PrototypeAppState, destinationRoomId: string, asOf: string): InternalTransferContext | null {
  const destinationOccupants = activeAssignments(data, asOf)
    .filter(assignment => assignment.roomId === destinationRoomId)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id))
  for (const destinationAssignment of destinationOccupants) {
    const sourceAssignment = priorAssignment(data, destinationAssignment.tenantId, destinationRoomId, destinationAssignment.startDate)
    if (!sourceAssignment) continue
    const sourceCycle = sourceCycleFor(data, sourceAssignment)
    if (!sourceCycle) continue
    const transferDate = destinationAssignment.startDate
    const nextRentStart = sourceCycle.rentSchedule === 'ANNIVERSARY' && sourceCycle.rentAnchorDate
      ? nextAnniversaryStartAfter(sourceCycle.rentAnchorDate, transferDate)
      : nextCalendarMonthStart(transferDate)
    const sourcePeriods = rentalPeriodsForCycle(data, sourceCycle.id)
    const sourcePeriodCoveringTransfer = sourcePeriods.find(period =>
      period.startDate <= transferDate && period.endDateExclusive > transferDate) ?? null
    const sourcePrepaidPeriodStartingAtNextRent = sourcePeriods.find(period => period.startDate >= nextRentStart
      && data.rentPrepayments.some(prepayment => prepayment.occupancyCycleId === sourceCycle.id
        && prepayment.rentalPeriodIds.includes(period.id))) ?? null
    const paidCurrent = sourcePeriodCoveringTransfer
      ? data.rentObligations.some(obligation => obligation.rentalPeriodId === sourcePeriodCoveringTransfer.id
        && rentObligationPaidCents(data, obligation.id, transferDate) >= obligation.amountCents)
      : false
    const legacyPeriod = data.billingPeriods.find(item => item.startDate <= transferDate && item.endDate >= transferDate)
    const legacyPaidCurrent = !sourcePeriodCoveringTransfer && Boolean(legacyPeriod && data.charges.some(charge =>
      charge.category === 'RENT' && charge.state === 'ISSUED' && charge.billingPeriodId === legacyPeriod.id
      && data.roomAssignments.some(assignment => assignment.id === charge.roomAssignmentId && assignment.roomId === sourceAssignment.roomId)
      && chargePaid(data, charge.id, transferDate) >= charge.amountCents))
    return {
      tenantId: destinationAssignment.tenantId,
      sourceAssignment,
      sourceCycle,
      transferDate,
      nextRentStart,
      sourcePeriodCoveringTransfer,
      sourcePrepaidPeriodStartingAtNextRent,
      sourceHasPaidOrPrepaidCoverage: paidCurrent || legacyPaidCurrent || Boolean(sourcePrepaidPeriodStartingAtNextRent),
    }
  }
  return null
}
