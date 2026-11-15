import type { Charge, ChargeStatus, Payment, PrototypeAppState } from '@/domain/types/models'
import { chargeBalance, chargePaid, chargeStatus, issuedCharges } from './summary'

const categoryOrder: Charge['category'][] = ['RENT', 'ELECTRICITY', 'WATER', 'WASHING_MACHINE']

export interface FinancialRoom {
  id: string
  roomId: string | null
  label: string
  source: 'rent-assignment' | 'period-assignment' | 'payment-date' | 'unresolved'
  note: string
}

function roomContext(data: PrototypeAppState, roomId: string, source: FinancialRoom['source'], note: string): FinancialRoom | null {
  const room = data.rooms.find(item => item.id === roomId)
  return room ? { id: room.id, roomId: room.id, label: `Room ${room.name}`, source, note } : null
}

export function chargeRoom(data: PrototypeAppState, charge: Charge): FinancialRoom {
  const unresolved: FinancialRoom = { id: `review:${charge.id}`, roomId: null, label: 'Room needs review', source: 'unresolved', note: 'Missing or ambiguous historical room context; this charge remains in totals.' }
  if (charge.category === 'RENT') {
    const assignment = data.roomAssignments.find(item => item.id === charge.roomAssignmentId && item.tenantId === charge.tenantId)
    return assignment ? roomContext(data, assignment.roomId, 'rent-assignment', 'Recorded rent assignment') ?? unresolved : unresolved
  }
  const period = data.billingPeriods.find(item => item.id === charge.billingPeriodId)
  if (!period) return unresolved
  const roomIds = [...new Set(data.roomAssignments.filter(item => item.tenantId === charge.tenantId
    && item.startDate <= period.endDate && (item.endDate === null || item.endDate >= period.startDate)).map(item => item.roomId))]
  return roomIds.length === 1 && roomIds[0]
    ? roomContext(data, roomIds[0], 'period-assignment', 'Derived from the billed period’s single room context; charge ownership stays with the tenant.') ?? unresolved
    : unresolved
}

export interface FinancialTotals {
  billed: number
  paid: number
  outstanding: number
  unpaid: number
  partial: number
  overdue: number
  status: ChargeStatus
}

export function financialTotals(data: PrototypeAppState, charges: Charge[], asOf: string): FinancialTotals {
  const items = [...new Map(charges.filter(charge => charge.state === 'ISSUED' && charge.issuedOn <= asOf).map(charge => [charge.id, charge])).values()]
  const billed = items.reduce((sum, charge) => sum + charge.amountCents, 0)
  const paid = items.reduce((sum, charge) => sum + chargePaid(data, charge.id, asOf), 0)
  const outstanding = items.reduce((sum, charge) => sum + chargeBalance(data, charge, asOf), 0)
  return {
    billed, paid, outstanding,
    unpaid: items.filter(charge => chargeStatus(data, charge, asOf) === 'UNPAID').length,
    partial: items.filter(charge => chargeStatus(data, charge, asOf) === 'PARTIALLY_PAID').length,
    overdue: items.filter(charge => charge.dueDate < asOf && chargeBalance(data, charge, asOf) > 0).length,
    status: outstanding === 0 ? 'PAID' : paid > 0 ? 'PARTIALLY_PAID' : 'UNPAID',
  }
}

export interface RoomFinance extends FinancialTotals {
  id: string
  context: FinancialRoom
  charges: Charge[]
}

/** A presentation grouping of distinct obligations, never a replacement room charge. */
export function selectRoomFinance(data: PrototypeAppState, asOf: string, periodId?: string): RoomFinance[] {
  const groups = new Map<string, { context: FinancialRoom; charges: Charge[] }>()
  for (const charge of issuedCharges(data, asOf, periodId)) {
    const context = chargeRoom(data, charge)
    const group = groups.get(context.id) ?? { context, charges: [] }
    group.charges.push(charge)
    groups.set(context.id, group)
  }
  return [...groups].map(([id, group]) => ({ id, ...group, ...financialTotals(data, group.charges, asOf) }))
    .sort((a, b) => a.context.label.localeCompare(b.context.label, 'en', { numeric: true }) || a.id.localeCompare(b.id))
}

export interface RoomDueGroup extends RoomFinance {
  categories: Charge['category'][]
  dueDate: string
  periodId: string
}

export function selectRoomDues(data: PrototypeAppState, asOf: string): RoomDueGroup[] {
  const groups = new Map<string, { context: FinancialRoom; charges: Charge[]; dueDate: string; periodId: string }>()
  for (const charge of issuedCharges(data, asOf)) {
    if (charge.dueDate < asOf || chargeBalance(data, charge, asOf) <= 0) continue
    const context = chargeRoom(data, charge)
    // Combine categories sharing a room and due date; keep periods and dates separate.
    const id = JSON.stringify([context.id, charge.billingPeriodId, charge.dueDate])
    const group = groups.get(id) ?? { context, charges: [], dueDate: charge.dueDate, periodId: charge.billingPeriodId }
    group.charges.push(charge)
    groups.set(id, group)
  }
  return [...groups].map(([id, group]) => {
    const categories = categoryOrder.filter(category => group.charges.some(charge => charge.category === category))
    return { id, ...group, categories, ...financialTotals(data, group.charges, asOf) }
  }).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.context.label.localeCompare(b.context.label, 'en', { numeric: true }) || a.id.localeCompare(b.id))
}

export interface PaymentRoomPresentation {
  label: string
  note: string
  allocations: { id: string; chargeId: string; context: FinancialRoom; amountCents: number }[]
  unallocated: number
}

/** Payments remain individual transactions. Rooms come from the charges being paid. */
export function paymentRooms(data: PrototypeAppState, payment: Payment, asOf: string, receiptAllocationIds?: string[]): PaymentRoomPresentation {
  const allocations = data.paymentAllocations.filter(item => item.paymentId === payment.id && item.allocatedOn <= asOf
    && (receiptAllocationIds ? receiptAllocationIds.includes(item.id) : item.state === 'ACTIVE' && payment.state === 'RECORDED'))
    .map(item => {
      const charge = data.charges.find(charge => charge.id === item.chargeId)
      const context: FinancialRoom = charge ? chargeRoom(data, charge) : { id: `review:${item.chargeId}`, roomId: null, label: 'Room needs review', source: 'unresolved', note: 'Charge context missing' }
      return { id: item.id, chargeId: item.chargeId, context, amountCents: item.amountCents }
    })
  const unallocated = payment.amountCents - allocations.reduce((sum, item) => sum + item.amountCents, 0)
  if (allocations.length) {
    const contexts = [...new Map(allocations.map(item => [item.context.id, item.context])).values()]
    const single = contexts.length === 1 ? contexts[0] : undefined
    return {
      label: single ? `${single.label}${unallocated > 0 ? ' + unallocated' : ''}` : 'Multiple rooms / contexts',
      note: single?.roomId && unallocated === 0 ? 'Room context from allocated charges' : 'See transaction details for the allocation breakdown.',
      allocations, unallocated,
    }
  }
  const roomIds = [...new Set(data.roomAssignments.filter(item => item.tenantId === payment.tenantId
    && item.startDate <= payment.paidOn && (item.endDate === null || item.endDate >= payment.paidOn)).map(item => item.roomId))]
  const room = roomIds.length === 1 && roomIds[0] ? roomContext(data, roomIds[0], 'payment-date', '') : null
  return { label: room?.label ?? 'Room needs review', note: room ? 'Payment-date room context only · unallocated money' : 'No allocated charge or unambiguous payment-date room.', allocations, unallocated }
}
