import type { ChargeCategory, PrototypeAppState } from '@/domain/types/models'
import { chargeBalance, unresolvedElectricity } from './summary'
import { chargeRoom } from './room-finance'
import { rentObligationPaidCents } from './rental-periods'
import { formatMoney } from '@/lib/format'

export type RoomFinancialBlockerKind = 'RENT' | 'UTILITY' | 'ELECTRICITY_SETTLEMENT'

export interface RoomFinancialBlocker {
  kind: RoomFinancialBlockerKind
  amountCents: number
  chargeIds: string[]
  rentObligationIds: string[]
  categories: ChargeCategory[]
}

export interface RoomFinancialEligibility {
  roomId: string
  roomName: string
  cycleId: string | null
  eligible: boolean
  amountCents: number
  blockers: RoomFinancialBlocker[]
}

/**
 * Room-level release blocker. Every occupant shares this result, so one tenant cannot bypass
 * unpaid room rent or issued utilities by having a zero personal tenant balance.
 */
export function roomFinancialEligibility(data: PrototypeAppState, roomId: string, asOf: string): RoomFinancialEligibility {
  const room = data.rooms.find(item => item.id === roomId)
  const cycle = data.occupancyCycles.find(item => item.roomId === roomId && item.status === 'ACTIVE')
  if (!room) return { roomId, roomName: 'Unknown room', cycleId: null, eligible: false, amountCents: 0, blockers: [] }
  const cycleStart = cycle?.startedAt ?? null
  const rentObligations = data.rentObligations.filter(obligation => obligation.roomId === roomId
    && obligation.state === 'ISSUED' && obligation.issuedOn <= asOf && obligation.dueDate <= asOf
    && (!cycle || obligation.occupancyCycleId === cycle.id)
    && rentObligationPaidCents(data, obligation.id, asOf) < obligation.amountCents)
  const rentAmount = rentObligations.reduce((sum, obligation) =>
    sum + Math.max(0, obligation.amountCents - rentObligationPaidCents(data, obligation.id, asOf)), 0)

  const charges = data.charges.filter(charge => charge.state === 'ISSUED' && charge.issuedOn <= asOf
    && ['RENT', 'WATER', 'WASHING_MACHINE', 'ELECTRICITY'].includes(charge.category)
    && (!cycleStart || charge.issuedOn >= cycleStart)
    && chargeRoom(data, charge).roomId === roomId
    && chargeBalance(data, charge, asOf) > 0
    && (charge.category !== 'RENT' || charge.dueDate <= asOf))
  const rentCharges = charges.filter(charge => charge.category === 'RENT')
  const utilities = charges.filter(charge => charge.category !== 'RENT')
  const legacyRentAmount = rentCharges.reduce((sum, charge) => sum + chargeBalance(data, charge, asOf), 0)
  const utilityAmount = utilities.reduce((sum, charge) => sum + chargeBalance(data, charge, asOf), 0)
  const blockers: RoomFinancialBlocker[] = []

  if (rentObligations.length > 0 || rentCharges.length > 0) blockers.push({
    kind: 'RENT', amountCents: rentAmount + legacyRentAmount,
    chargeIds: rentCharges.map(charge => charge.id),
    rentObligationIds: rentObligations.map(obligation => obligation.id),
    categories: ['RENT'],
  })
  if (utilities.length > 0) blockers.push({
    kind: 'UTILITY', amountCents: utilityAmount, chargeIds: utilities.map(charge => charge.id),
    rentObligationIds: [], categories: [...new Set(utilities.map(charge => charge.category))],
  })
  const awaitingReading = unresolvedElectricity(data, asOf, undefined, roomId).filter(item => item.createdAt <= asOf)
  if (awaitingReading.length > 0) {
    blockers.push({
      kind: 'ELECTRICITY_SETTLEMENT', amountCents: 0, chargeIds: [], rentObligationIds: [],
      categories: ['ELECTRICITY'],
    })
  }
  const amountCents = blockers.reduce((sum, blocker) => sum + blocker.amountCents, 0)
  return { roomId, roomName: room.name, cycleId: cycle?.id ?? null, eligible: blockers.length === 0, amountCents, blockers }
}

export function occupancyFinancialMessage(
  eligibility: RoomFinancialEligibility,
  action: 'Transfer' | 'Move-out',
): string | null {
  if (eligibility.eligible) return null
  const room = `Room ${eligibility.roomName}`
  const settlement = eligibility.blockers.some(blocker => blocker.kind === 'ELECTRICITY_SETTLEMENT')
  const unpaid = eligibility.amountCents > 0
  if (settlement && unpaid) return `${action} blocked: ${room} has unpaid rent or utility bills and requires electricity settlement.`
  if (settlement) return `${action} blocked: ${room} requires an electricity meter reading and settlement.`
  const hasRent = eligibility.blockers.some(blocker => blocker.kind === 'RENT')
  const hasUtility = eligibility.blockers.some(blocker => blocker.kind === 'UTILITY')
  const what = hasRent && hasUtility ? 'unpaid rent or utility bills'
    : hasRent ? 'unpaid rent' : 'unpaid utility bills'
  return `${action} blocked: ${room} has ${what} (${formatMoney(eligibility.amountCents)} outstanding).`
}
