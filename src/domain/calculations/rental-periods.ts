import type {
  AdvanceApplication, ChargeStatus, OccupancyCycle, PrototypeAppState, RentObligation, RentalPeriod,
} from '@/domain/types/models'

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function isCivilDate(value: string): boolean {
  const match = ISO_DATE.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1) return false
  return day <= daysInMonth(year, month)
}

export function dateParts(value: string): { year: number; month: number; day: number } {
  if (!isCivilDate(value)) throw new Error(`Invalid civil date: ${value}`)
  const match = ISO_DATE.exec(value)!
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

export function formatCivilDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`
}

/**
 * Adds whole months to the original anchor and clamps only the day. Future periods are always
 * derived from the anchor rather than the previous clamped date, so anchors never drift.
 */
export function addMonthsClamped(anchorDate: string, monthOffset: number): string {
  if (!Number.isSafeInteger(monthOffset)) throw new Error('Month offset must be an integer.')
  const anchor = dateParts(anchorDate)
  const absoluteMonth = anchor.year * 12 + (anchor.month - 1) + monthOffset
  const year = Math.floor(absoluteMonth / 12)
  const month = ((absoluteMonth % 12) + 12) % 12 + 1
  const day = Math.min(anchor.day, daysInMonth(year, month))
  return formatCivilDate(year, month, day)
}

export function rentalPeriodBounds(anchorDate: string, sequence: number): { startDate: string; endDateExclusive: string } {
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('Rental period sequence must be positive.')
  return {
    startDate: addMonthsClamped(anchorDate, sequence - 1),
    endDateExclusive: addMonthsClamped(anchorDate, sequence),
  }
}

export function rentalPeriodId(cycleId: string, sequence: number): string {
  return `rent-period-${cycleId}-${sequence}`
}

export function rentObligationId(cycleId: string, sequence: number): string {
  return `rent-obligation-${cycleId}-${sequence}`
}

export function cycleAnchor(cycle: OccupancyCycle): string | null {
  return cycle.rentSchedule === 'ANNIVERSARY' && cycle.rentAnchorDate ? cycle.rentAnchorDate : null
}

export function anniversaryAnchor(startedAt: string): { rentAnchorDate: string; rentAnchorDay: number } {
  return { rentAnchorDate: startedAt, rentAnchorDay: dateParts(startedAt).day }
}

export function isRentObligationId(data: PrototypeAppState, id: string): boolean {
  return data.rentObligations.some(obligation => obligation.id === id)
}

export function rentObligationPaidCents(data: PrototypeAppState, obligationId: string, asOf: string): number {
  const cash = data.paymentAllocations
    .filter(allocation => allocation.chargeId === obligationId && allocation.state === 'ACTIVE' && allocation.allocatedOn <= asOf
      && data.payments.some(payment => payment.id === allocation.paymentId && payment.state === 'RECORDED' && payment.paidOn <= asOf))
    .reduce((sum, allocation) => sum + allocation.amountCents, 0)
  const advance = data.advanceApplications
    .filter(application => application.rentObligationId === obligationId && application.state === 'ACTIVE' && application.appliedOn <= asOf)
    .reduce((sum, application) => sum + application.amountCents, 0)
  return cash + advance
}

export function rentObligationStatus(data: PrototypeAppState, obligation: RentObligation, asOf: string): ChargeStatus {
  if (obligation.state === 'VOIDED') return 'UNPAID'
  const paid = rentObligationPaidCents(data, obligation.id, asOf)
  return paid === 0 ? 'UNPAID' : paid >= obligation.amountCents ? 'PAID' : 'PARTIALLY_PAID'
}

export function activeAdvanceApplication(data: PrototypeAppState, cycleId: string): AdvanceApplication | undefined {
  return data.advanceApplications.find(application => application.occupancyCycleId === cycleId && application.state === 'ACTIVE')
}

export function rentalPeriodsForCycle(data: PrototypeAppState, cycleId: string): RentalPeriod[] {
  return data.rentalPeriods
    .filter(period => period.occupancyCycleId === cycleId)
    .sort((a, b) => a.sequence - b.sequence)
}

export function rentObligationForPeriod(data: PrototypeAppState, rentalPeriodId: string): RentObligation | undefined {
  return data.rentObligations.find(obligation => obligation.rentalPeriodId === rentalPeriodId)
}

export function nextRentalPeriod(data: PrototypeAppState, cycleId: string, afterSequence = 0): RentalPeriod | undefined {
  return rentalPeriodsForCycle(data, cycleId).find(period => period.sequence > afterSequence)
}

export interface RentalPeriodQuote {
  sequence: number
  startDate: string
  endDateExclusive: string
  dueDate: string
  amountCents: number
  paidCents: number
  status: ChargeStatus
  coveredByAdvance: boolean
}

export function rentalPeriodsFrom(
  cycle: OccupancyCycle,
  firstSequence: number,
  count: number,
): { sequence: number; startDate: string; endDateExclusive: string; dueDate: string }[] {
  const anchor = cycleAnchor(cycle)
  if (!anchor) throw new Error('Cycle does not use anniversary rent.')
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('Period count must be positive.')
  return Array.from({ length: count }, (_, index) => {
    const sequence = firstSequence + index
    const bounds = rentalPeriodBounds(anchor, sequence)
    return { sequence, ...bounds, dueDate: bounds.startDate }
  })
}

export function firstUnpaidSequence(data: PrototypeAppState, cycleId: string, asOf: string): number {
  const periods = rentalPeriodsForCycle(data, cycleId)
  for (const period of periods) {
    const obligation = rentObligationForPeriod(data, period.id)
    if (!obligation || rentObligationPaidCents(data, obligation.id, asOf) < obligation.amountCents) return period.sequence
  }
  return (periods.at(-1)?.sequence ?? 0) + 1
}
