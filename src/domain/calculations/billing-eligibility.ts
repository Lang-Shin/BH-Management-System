import type { BillingPeriod, Charge, PrototypeAppState, Room, RoomAssignment } from '@/domain/types/models'
import { activeWashingRate, activeWaterRate } from './billing-rates'
import { resolveBillingPeriod } from './billing-periods'
import { chargeRoom } from './room-finance'
import { issuedCharges, unresolvedElectricity } from './summary'

/** Assignments whose tenancy overlaps the selected billing period, not merely today. */
export function periodAssignments(data: PrototypeAppState, roomId: string, period: BillingPeriod): RoomAssignment[] {
  return data.roomAssignments.filter(assignment => assignment.roomId === roomId
    && assignment.startDate <= period.endDate
    && (assignment.endDate === null || assignment.endDate >= period.startDate))
}

/**
 * Billing eligibility is the union of current/historical tenancy for the period and rooms with
 * issued or pending charges. This keeps vacant rooms with historical bills payable and surfaces
 * newly occupied rooms before their first charge exists.
 */
export function selectBillingEligibleRooms(data: PrototypeAppState, periodId: string, asOf: string): Room[] {
  const period = resolveBillingPeriod(data, periodId)
  if (!period) return []
  const eligible = new Set<string>()
  for (const assignment of data.roomAssignments) {
    if (assignment.startDate <= period.endDate && (assignment.endDate === null || assignment.endDate >= period.startDate)) {
      eligible.add(assignment.roomId)
    }
  }
  for (const charge of issuedCharges(data, asOf, periodId)) {
    const roomId = chargeRoom(data, charge).roomId
    if (roomId) eligible.add(roomId)
  }
  for (const obligation of unresolvedElectricity(data, asOf, periodId)) eligible.add(obligation.roomId)
  return data.rooms.filter(room => eligible.has(room.id))
}

function chargeDates(period: BillingPeriod, asOf: string) {
  return { issuedOn: asOf, dueDate: period.endDate >= asOf ? period.endDate : asOf }
}

/**
 * Builds only the missing period charges for an eligible room. Existing issued charges are never
 * replaced. Rent remains once per room; water is per applicable tenant. Choosing the first period
 * assignment as the room-level payer is a prototype rule pending owner confirmation.
 */
export function proposedRoomCharges(data: PrototypeAppState, room: Room, period: BillingPeriod, asOf: string): Charge[] {
  const assignments = periodAssignments(data, room.id, period)
  if (assignments.length === 0) return []
  const existing = issuedCharges(data, asOf, period.id).filter(charge => chargeRoom(data, charge).roomId === room.id)
  const { issuedOn, dueDate } = chargeDates(period, asOf)
  const base = { roomId: room.id, billingPeriodId: period.id, issuedOn, dueDate, state: 'ISSUED' as const, correction: null }
  const proposed: Charge[] = []
  const roomPayer = assignments[0]!

  if (!existing.some(charge => charge.category === 'RENT')) {
    const id = `rent-${period.id}-${room.id}`
    if (!data.charges.some(charge => charge.id === id)) {
      proposed.push({
        ...base, id, tenantId: roomPayer.tenantId, category: 'RENT', description: 'Room rent — generated for the selected billing period',
        amountCents: roomPayer.agreedRentCents, agreedRentCents: roomPayer.agreedRentCents, roomAssignmentId: roomPayer.id,
      })
    }
  }

  const waterRate = activeWaterRate(data, period.startDate)?.rateCents
  if (waterRate) {
    const existingWaterTenants = new Set(existing.filter(charge => charge.category === 'WATER').map(charge => charge.tenantId))
    for (const assignment of assignments) {
      if (existingWaterTenants.has(assignment.tenantId)) continue
      const id = `water-${period.id}-${assignment.tenantId}`
      if (data.charges.some(charge => charge.id === id)) continue
      proposed.push({
        ...base, id, tenantId: assignment.tenantId, category: 'WATER', description: 'Room water — generated per applicable tenant',
        amountCents: waterRate, entryMethod: 'MANUAL',
      })
    }
  }

  // A current subscription is not evidence that washing was availed in a past month.
  if (room.washingMachineEnabled && period.startDate.slice(0, 7) === asOf.slice(0, 7)
    && !existing.some(charge => charge.category === 'WASHING_MACHINE')) {
    const washingRate = activeWashingRate(data, period.startDate)?.rateCents
    const id = `washing-${period.id}-${room.id}`
    if (washingRate && !data.charges.some(charge => charge.id === id)) {
      proposed.push({
        ...base, id, tenantId: roomPayer.tenantId, category: 'WASHING_MACHINE', description: 'Optional washing machine — generated for the selected billing period',
        amountCents: washingRate, entryMethod: 'MANUAL',
      })
    }
  }

  return proposed
}
