import type { Charge, ChargeStatus, PrototypeAppState, Room, RoomAssignment, TenantCredit } from '@/domain/types/models'
import { electricityObligations } from './electricity-obligations'

export function unresolvedElectricity(data: PrototypeAppState, asOf: string, periodId?: string, roomId?: string) {
  return electricityObligations(data, asOf).filter(item => item.state === 'AWAITING_READING' && item.createdAt <= asOf
    && (!periodId || item.billingPeriodId === periodId) && (!roomId || item.roomId === roomId))
}

export function activeAssignments(data: PrototypeAppState, asOf: string): RoomAssignment[] {
  return data.roomAssignments.filter(a => a.startDate <= asOf && (a.endDate === null || a.endDate >= asOf))
}

export function roomOccupants(data: PrototypeAppState, roomId: string, asOf: string) {
  const ids = new Set(activeAssignments(data, asOf).filter(a => a.roomId === roomId).map(a => a.tenantId))
  return data.tenants.filter(t => ids.has(t.id))
}

export type RoomOccupancy = 'OCCUPIED' | 'AVAILABLE' | 'UNDER_REPAIR'

/** A room is occupied as soon as someone rents it, regardless of its bed count. */
export function roomOccupancy(data: PrototypeAppState, room: Room, asOf: string): RoomOccupancy {
  if (roomOccupants(data, room.id, asOf).length > 0) return 'OCCUPIED'
  return room.status === 'maintenance' ? 'UNDER_REPAIR' : 'AVAILABLE'
}

export function selectRoomSummary(data: PrototypeAppState, asOf: string) {
  const states = data.rooms.map(room => roomOccupancy(data, room, asOf))
  return {
    totalRooms: data.rooms.length,
    occupiedRooms: states.filter(status => status === 'OCCUPIED').length,
    availableRooms: states.filter(status => status === 'AVAILABLE').length,
    maintenanceRooms: states.filter(status => status === 'UNDER_REPAIR').length,
  }
}

export function chargePaid(data: PrototypeAppState, chargeId: string, asOf: string): number {
  return data.paymentAllocations.filter(a => a.chargeId === chargeId && a.state === 'ACTIVE' && a.allocatedOn <= asOf
    && data.payments.some(p => p.id === a.paymentId && p.state === 'RECORDED' && p.paidOn <= asOf))
    .reduce((sum, a) => sum + a.amountCents, 0)
}

export function chargeBalance(data: PrototypeAppState, charge: Charge, asOf: string): number {
  return charge.state === 'VOIDED' ? 0 : charge.amountCents - chargePaid(data, charge.id, asOf)
}

export function chargeStatus(data: PrototypeAppState, charge: Charge, asOf: string): ChargeStatus {
  const paid = chargePaid(data, charge.id, asOf)
  return paid === 0 ? 'UNPAID' : paid < charge.amountCents ? 'PARTIALLY_PAID' : 'PAID'
}

export function creditRemaining(data: PrototypeAppState, credit: TenantCredit, asOf: string): number {
  if (credit.createdOn > asOf || !data.payments.some(p => p.id === credit.sourcePaymentId && p.state === 'RECORDED' && p.paidOn <= asOf)) return 0
  return credit.amountCents - data.paymentAllocations.filter(a => a.creditId === credit.id && a.state === 'ACTIVE' && a.allocatedOn <= asOf)
    .reduce((sum, a) => sum + a.amountCents, 0)
}

export function issuedCharges(data: PrototypeAppState, asOf: string, periodId?: string) {
  return data.charges.filter(c => c.state === 'ISSUED' && c.issuedOn <= asOf
    && c.category !== 'ADVANCE' && c.category !== 'SECURITY_DEPOSIT'
    && (!periodId || c.billingPeriodId === periodId))
}

export function tenantAccount(data: PrototypeAppState, tenantId: string, asOf: string) {
  const charges = issuedCharges(data, asOf).filter(c => c.tenantId === tenantId)
  const balance = charges.reduce((sum, c) => sum + chargeBalance(data, c, asOf), 0)
  const credit = data.tenantCredits.filter(c => c.tenantId === tenantId).reduce((sum, c) => sum + creditRemaining(data, c, asOf), 0)
  const overdue = charges.some(c => c.dueDate < asOf && chargeBalance(data, c, asOf) > 0)
  return { balance, credit, status: overdue ? 'Overdue' : balance > 0 ? 'Outstanding' : credit > 0 ? 'Credit available' : 'Clear' }
}

/** New corrections are settled immediately; legacy pending statuses remain excluded from cash received. */
export function paymentCashReceived(data: PrototypeAppState, payment: { id: string; amountCents: number }): number {
  const correction = data.paymentCorrections.find(item => item.correctedPaymentId === payment.id)
  return correction && (correction.settlementStatus === 'NO_MONEY_MOVED' || correction.settlementStatus === 'REFUND_PENDING')
    ? correction.originalAmountCents
    : payment.amountCents
}

/** Billing-period charges and cash received during that period are distinct. */
export function selectSummary(data: PrototypeAppState, asOf: string, periodId?: string) {
  const charges = issuedCharges(data, asOf, periodId)
  const billed = charges.reduce((sum, c) => sum + c.amountCents, 0)
  const applied = charges.reduce((sum, c) => sum + chargePaid(data, c.id, asOf), 0)
  const unresolved = unresolvedElectricity(data, asOf, periodId).length
  const period = data.billingPeriods.find(p => p.id === periodId)
  const received = data.payments.filter(p => p.state === 'RECORDED' && p.paidOn <= asOf
    && (!period || (p.paidOn >= period.startDate && p.paidOn <= period.endDate))).reduce((sum, p) => sum + paymentCashReceived(data, p), 0)
  return {
    tenants: data.tenants.filter(t => t.status === 'ACTIVE').length,
    ...selectRoomSummary(data, asOf),
    billed, applied, received, outstanding: billed - applied, unresolved,
    credit: data.tenantCredits.reduce((sum, c) => sum + creditRemaining(data, c, asOf), 0),
    overdue: charges.filter(c => c.dueDate < asOf && chargeBalance(data, c, asOf) > 0).length,
    paid: charges.filter(c => chargeStatus(data, c, asOf) === 'PAID').length,
    partial: charges.filter(c => chargeStatus(data, c, asOf) === 'PARTIALLY_PAID').length,
    unpaid: charges.filter(c => chargeStatus(data, c, asOf) === 'UNPAID').length,
  }
}
