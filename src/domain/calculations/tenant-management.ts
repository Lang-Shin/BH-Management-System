import type { PrototypeAppState, RoomAssignment, Tenant } from '@/domain/types/models'
import { isIsoDate } from '@/domain/validation/date'
import { roomMonthlyRentCents } from './billing-rates'
import { activeAssignments, tenantAccount, unresolvedElectricity } from './summary'
import { roomCapacityConflict } from './room-capacity'

export interface TenantDraft {
  name: string
  email: string
  phone: string
  address: string
  roomId: string | null
  moveInDate: string
  notes: string
}

export type TenantDraftField = 'name' | 'email' | 'phone' | 'address' | 'roomId' | 'moveInDate' | 'notes' | 'general'
export type TenantDraftErrors = Partial<Record<TenantDraftField, string>>

export type TenantMutationResult =
  | { ok: true; data: PrototypeAppState; tenant: Tenant }
  | { ok: false; errors: TenantDraftErrors }

export type TenantActionResult =
  | { ok: true; data: PrototypeAppState }
  | { ok: false; blockers: string[] }

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const phonePattern = /^(?:DEMO\s+)?\+?[0-9][0-9\s().-]{5,}$/i

export function validateTenantDraft(data: PrototypeAppState, draft: TenantDraft, options: { tenantId?: string; asOf: string }): TenantDraftErrors {
  const errors: TenantDraftErrors = {}
  const name = draft.name.trim()
  if (!name) errors.name = 'Enter the tenant’s full name.'

  const email = draft.email.trim()
  if (email && !emailPattern.test(email)) errors.email = 'Enter a valid email address, or leave it blank.'

  const phone = draft.phone.trim()
  const phoneDigits = phone.replace(/\D/g, '')
  if (phone && (!phonePattern.test(phone) || phoneDigits.length < 7 || phoneDigits.length > 15)) {
    errors.phone = 'Enter a valid phone number with 7 to 15 digits, or leave it blank.'
  }

  if (!isIsoDate(draft.moveInDate)) errors.moveInDate = 'Enter a valid move-in date.'
  if (draft.notes.length > 500) errors.notes = 'Keep notes under 500 characters.'
  if (draft.address.length > 1000) errors.address = 'Keep the home address under 1,000 characters.'

  const tenant = options.tenantId ? data.tenants.find(item => item.id === options.tenantId) : undefined
  if (options.tenantId && !tenant) {
    errors.general = 'This tenant no longer exists.'
    return errors
  }
  if (tenant?.status === 'MOVED_OUT') {
    errors.general = 'Moved-out tenants cannot be edited from this active tenant form.'
    return errors
  }

  const currentAssignment = tenant ? activeAssignments(data, options.asOf).find(assignment => assignment.tenantId === tenant.id) : undefined
  const room = draft.roomId ? data.rooms.find(item => item.id === draft.roomId) : undefined
  if (draft.roomId && !room) errors.roomId = 'Choose an existing room, or leave the assignment blank.'
  if (room) {
    if (room.status === 'maintenance') errors.roomId = 'This room is under repair and cannot accept a tenant.'
    if (isIsoDate(draft.moveInDate)) {
      const conflict = roomCapacityConflict(data, {
        roomId: room.id, tenantId: options.tenantId ?? '__new-tenant__', startDate: draft.moveInDate,
        endDate: null, capacity: room.capacity,
      })
      if (conflict) errors.roomId = `This room would exceed its capacity on ${conflict.date}.`
    }
  }

  if (tenant) {
    const futureReservation = data.roomAssignments.some(assignment => assignment.tenantId === tenant.id && assignment.startDate > options.asOf)
    if (currentAssignment && futureReservation && (draft.roomId !== currentAssignment.roomId || draft.moveInDate !== currentAssignment.startDate)) {
      errors.general = 'This tenant has an approved future room reservation. Cancel or reschedule that reservation before changing the current tenancy.'
    }
    if (currentAssignment && !draft.roomId) {
      errors.roomId = 'Use Move Out to end this tenant’s current room assignment. The edit form does not clear assignments.'
    }
    if (currentAssignment && draft.roomId === currentAssignment.roomId) {
      if (draft.moveInDate !== currentAssignment.startDate && hasTenantFinancialHistory(data, tenant.id)) {
        errors.moveInDate = 'The move-in date is fixed because this tenant has financial history. Choose a different room to record a transfer instead.'
      }
      if (draft.moveInDate !== currentAssignment.startDate) {
        const overlap = data.roomAssignments.some(assignment => assignment.tenantId === tenant.id && assignment.id !== currentAssignment.id
          && (assignment.endDate === null || assignment.endDate >= draft.moveInDate))
        if (overlap) errors.moveInDate = 'This move-in date overlaps another recorded room assignment.'
      }
    }
    if (currentAssignment && draft.roomId && draft.roomId !== currentAssignment.roomId) {
      if (draft.moveInDate <= currentAssignment.startDate) {
        errors.moveInDate = 'The transfer date must be after the current room assignment started.'
      }
      const overlap = data.roomAssignments.some(assignment => assignment.tenantId === tenant.id && assignment.id !== currentAssignment.id
        && (assignment.endDate === null || assignment.endDate >= draft.moveInDate))
      if (overlap) errors.moveInDate = 'This transfer date overlaps another recorded room assignment.'
    }
    if (!currentAssignment && draft.roomId) {
      const overlap = data.roomAssignments.some(assignment => assignment.tenantId === tenant.id
        && (assignment.endDate === null || assignment.endDate >= draft.moveInDate))
      if (overlap) errors.moveInDate = 'This move-in date overlaps a previous room assignment. Use a later date.'
    }
  }

  return errors
}

export function hasTenantFinancialHistory(data: PrototypeAppState, tenantId: string): boolean {
  const paymentIds = new Set(data.payments.filter(payment => payment.tenantId === tenantId).map(payment => payment.id))
  return data.charges.some(charge => charge.tenantId === tenantId)
    || paymentIds.size > 0
    || data.receipts.some(receipt => paymentIds.has(receipt.paymentId))
    || data.tenantCredits.some(credit => credit.tenantId === tenantId || paymentIds.has(credit.sourcePaymentId))
}

function randomId(prefix: string): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${suffix}`
}

function previousDate(date: string): string {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() - 1)
  return value.toISOString().slice(0, 10)
}

function tenantFromDraft(id: string, draft: TenantDraft, status: Tenant['status']): Tenant {
  return {
    id, name: draft.name.trim(), email: draft.email.trim(), phone: draft.phone.trim(),
    address: draft.address.trim(), status, notes: draft.notes.trim().slice(0, 500),
  }
}

function newAssignment(data: PrototypeAppState, tenantId: string, roomId: string, startDate: string): RoomAssignment {
  const room = data.rooms.find(item => item.id === roomId)!
  return {
    id: randomId('assignment'), tenantId, roomId, startDate, endDate: null,
    agreedRentCents: roomMonthlyRentCents(data, room, startDate),
  }
}

/** Shared transfer primitive used by landlord editing and approved tenant requests. */
export function transferTenantRoom(data: PrototypeAppState, tenantId: string, roomId: string, startDate: string, asOf: string) {
  const current = activeAssignments(data, asOf).find(assignment => assignment.tenantId === tenantId)
  if (!current || current.roomId === roomId) return null
  const assignment = newAssignment(data, tenantId, roomId, startDate)
  return {
    data: {
      ...data,
      roomAssignments: [
        ...data.roomAssignments.map(item => item.id === current.id ? { ...item, endDate: previousDate(startDate) } : item),
        assignment,
      ],
    },
    assignment,
    endedAssignmentId: current.id,
  }
}

export function createTenant(data: PrototypeAppState, draft: TenantDraft, asOf: string): TenantMutationResult {
  const errors = validateTenantDraft(data, draft, { asOf })
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  const tenant = tenantFromDraft(randomId('tenant'), draft, 'ACTIVE')
  return {
    ok: true,
    data: {
      ...data,
      tenants: [...data.tenants, tenant],
      roomAssignments: draft.roomId ? [...data.roomAssignments, newAssignment(data, tenant.id, draft.roomId, draft.moveInDate)] : data.roomAssignments,
    },
    tenant,
  }
}

export function updateTenant(data: PrototypeAppState, tenantId: string, draft: TenantDraft, asOf: string): TenantMutationResult {
  const errors = validateTenantDraft(data, draft, { tenantId, asOf })
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  const current = data.tenants.find(tenant => tenant.id === tenantId)
  if (!current) return { ok: false, errors: { general: 'This tenant no longer exists.' } }
  const existingAssignment = activeAssignments(data, asOf).find(assignment => assignment.tenantId === tenantId)
  let roomAssignments = data.roomAssignments
  if (existingAssignment && draft.roomId && draft.roomId !== existingAssignment.roomId) {
    const transferred = transferTenantRoom(data, tenantId, draft.roomId, draft.moveInDate, asOf)
    if (transferred) roomAssignments = transferred.data.roomAssignments
  } else if (existingAssignment && draft.roomId === existingAssignment.roomId && draft.moveInDate !== existingAssignment.startDate) {
    roomAssignments = roomAssignments.map(assignment => assignment.id === existingAssignment.id ? { ...assignment, startDate: draft.moveInDate } : assignment)
  } else if (!existingAssignment && draft.roomId) {
    roomAssignments = [...roomAssignments, newAssignment(data, tenantId, draft.roomId, draft.moveInDate)]
  }
  const tenant = tenantFromDraft(current.id, draft, current.status)
  return { ok: true, data: { ...data, tenants: data.tenants.map(item => item.id === tenantId ? tenant : item), roomAssignments }, tenant }
}

export function tenantDeletionBlockers(data: PrototypeAppState, tenantId: string, asOf: string): string[] {
  const tenant = data.tenants.find(item => item.id === tenantId)
  if (!tenant) return ['This tenant no longer exists.']
  const assignments = data.roomAssignments.filter(assignment => assignment.tenantId === tenantId)
  const charges = data.charges.filter(charge => charge.tenantId === tenantId)
  const payments = data.payments.filter(payment => payment.tenantId === tenantId)
  const paymentIds = new Set(payments.map(payment => payment.id))
  const receipts = data.receipts.filter(receipt => paymentIds.has(receipt.paymentId))
  const credits = data.tenantCredits.filter(credit => credit.tenantId === tenantId || paymentIds.has(credit.sourcePaymentId))
  const account = tenantAccount(data, tenantId, asOf)
  const blockers: string[] = []
  if (assignments.length > 0) blockers.push('This tenant has room assignment history that must be retained. Use Move Out / Archive instead.')
  if (charges.length > 0) blockers.push('This tenant has issued bill history.')
  if (payments.length > 0) blockers.push('This tenant has payment history.')
  if (receipts.length > 0) blockers.push('This tenant has digital receipt history.')
  if (account.balance > 0) blockers.push('This tenant has an outstanding balance.')
  if (credits.length > 0 || account.credit > 0) blockers.push('This tenant has an advance credit or other financial reference.')
  return blockers
}

export function moveOutBlockers(data: PrototypeAppState, tenantId: string, asOf: string): string[] {
  const tenant = data.tenants.find(item => item.id === tenantId)
  if (!tenant) return ['This tenant no longer exists.']
  if (tenant.status === 'MOVED_OUT') return ['This tenant has already moved out.']
  if (data.roomAssignments.some(assignment => assignment.tenantId === tenantId && assignment.startDate > asOf)) {
    return ['This tenant has an approved future room reservation. Cancel or reschedule that reservation before moving out.']
  }
  const account = tenantAccount(data, tenantId, asOf)
  const blockers: string[] = []
  if (account.balance > 0) blockers.push('This tenant still has an outstanding balance. Settle it through the existing Billing or Payments workflow before moving out.')
  if (account.credit > 0) blockers.push('This tenant still has an advance credit. Resolve or apply it through the existing workflow before moving out.')
  if (unresolvedElectricity(data, asOf).some(obligation => obligation.tenantId === tenantId)) {
    blockers.push('This tenant has electricity awaiting a meter reading. Complete that Billing workflow before moving out.')
  }
  const assignment = activeAssignments(data, asOf).find(item => item.tenantId === tenantId)
  if (assignment && assignment.startDate >= asOf) blockers.push('The move-out date must be after the tenant’s move-in date.')
  return blockers
}

export function moveOutTenant(data: PrototypeAppState, tenantId: string, asOf: string): TenantActionResult {
  const blockers = moveOutBlockers(data, tenantId, asOf)
  if (blockers.length > 0) return { ok: false, blockers }
  const assignment = activeAssignments(data, asOf).find(item => item.tenantId === tenantId)
  return {
    ok: true,
    data: {
      ...data,
      tenants: data.tenants.map(tenant => tenant.id === tenantId ? { ...tenant, status: 'MOVED_OUT' as const } : tenant),
      roomAssignments: assignment
        ? data.roomAssignments.map(item => item.id === assignment.id ? { ...item, endDate: previousDate(asOf) } : item)
        : data.roomAssignments,
    },
  }
}

export function deleteTenant(data: PrototypeAppState, tenantId: string, asOf: string): TenantActionResult {
  const blockers = tenantDeletionBlockers(data, tenantId, asOf)
  if (blockers.length > 0) return { ok: false, blockers }
  if (!data.tenants.some(tenant => tenant.id === tenantId)) return { ok: false, blockers: ['This tenant no longer exists.'] }
  return { ok: true, data: { ...data, tenants: data.tenants.filter(tenant => tenant.id !== tenantId) } }
}
