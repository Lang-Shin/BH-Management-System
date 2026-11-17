import type { PrototypeAppState, Room, RoomCategoryId } from '@/domain/types/models'
import { ROOM_RATE_CATEGORY_IDS } from './billing-rates'
import { activeAssignments, chargeBalance } from './summary'

export interface RoomDraft {
  name: string
  capacity: number | null
  categoryId: RoomCategoryId | null
  kind: Room['kind']
  status: Room['status']
}

export type RoomDraftField = 'name' | 'capacity' | 'categoryId' | 'kind' | 'status' | 'general'
export type RoomDraftErrors = Partial<Record<RoomDraftField, string>>

export type RoomMutationResult =
  | { ok: true; data: PrototypeAppState; room: Room }
  | { ok: false; errors: RoomDraftErrors }

export type RoomDeletionResult =
  | { ok: true; data: PrototypeAppState }
  | { ok: false; blockers: string[] }

function normalizedName(value: string): string {
  return value.trim().toLocaleLowerCase('en')
}

function roomLabel(name: string): string {
  return name.trim()
}

function roomMeterIds(data: PrototypeAppState, room: Room): Set<string> {
  const suffix = room.id.replace(/^room-/, '')
  return new Set(data.electricityMeters.filter(meter => meter.id === `meter-room-${suffix}`).map(meter => meter.id))
}

export function roomDeletionBlockers(data: PrototypeAppState, roomId: string, asOf: string): string[] {
  const room = data.rooms.find(item => item.id === roomId)
  if (!room) return ['This room no longer exists.']

  const assignments = data.roomAssignments.filter(assignment => assignment.roomId === roomId)
  const activeTenantIds = new Set(activeAssignments(data, asOf).filter(assignment => assignment.roomId === roomId).map(assignment => assignment.tenantId))
  const assignmentIds = new Set(assignments.map(assignment => assignment.id))
  const tenantIds = new Set(assignments.map(assignment => assignment.tenantId))
  const meterIds = roomMeterIds(data, room)
  const charges = data.charges.filter(charge => assignmentIds.has(charge.category === 'RENT' ? charge.roomAssignmentId : '')
    || (charge.category === 'ELECTRICITY' && meterIds.has(charge.electricity.meterId))
    || (charge.category !== 'RENT' && tenantIds.has(charge.tenantId)))
  const chargeIds = new Set(charges.map(charge => charge.id))
  const allocations = data.paymentAllocations.filter(allocation => chargeIds.has(allocation.chargeId))
  const paymentIds = new Set(allocations.map(allocation => allocation.paymentId))
  const receipts = data.receipts.filter(receipt => paymentIds.has(receipt.paymentId)
    || receipt.allocationIds.some(allocationId => allocations.some(allocation => allocation.id === allocationId)))
  const obligations = data.electricityBillObligations.filter(obligation => obligation.roomId === roomId || meterIds.has(obligation.meterId))
  const readings = data.meterReadings.filter(reading => meterIds.has(reading.meterId))
  const credits = data.tenantCredits.filter(credit => paymentIds.has(credit.sourcePaymentId) || tenantIds.has(credit.tenantId))
  const outstanding = charges.filter(charge => charge.state === 'ISSUED' && chargeBalance(data, charge, asOf) > 0)
  const blockers: string[] = []

  if (activeTenantIds.size > 0) blockers.push(`This room is occupied by ${activeTenantIds.size} ${activeTenantIds.size === 1 ? 'tenant' : 'tenants'}. Reassign those tenants before deleting the room; this form does not change tenant assignments.`)
  else if (assignments.length > 0) blockers.push('This room has tenant assignment history that must be retained.')
  if (charges.length > 0) blockers.push('This room has issued bill history. Deleting it would remove the room context for those bills.')
  if (outstanding.length > 0) blockers.push('This room has an outstanding balance.')
  if (allocations.length > 0 || paymentIds.size > 0) blockers.push('This room has payment transaction history.')
  if (receipts.length > 0) blockers.push('This room has receipt history.')
  if (meterIds.size > 0 || readings.length > 0) blockers.push('This room has electricity meter or reading history.')
  if (obligations.length > 0) blockers.push('This room has an electricity bill awaiting a reading.')
  if (credits.length > 0) blockers.push('This room has advance-credit or other financial references.')

  return blockers
}

export function validateRoomDraft(data: PrototypeAppState, draft: RoomDraft, options: { roomId?: string; asOf: string }): RoomDraftErrors {
  const errors: RoomDraftErrors = {}
  const name = draft.name.trim()
  if (!name) errors.name = 'Enter a room number or name.'
  else if (data.rooms.some(room => room.id !== options.roomId && normalizedName(room.name) === normalizedName(name))) {
    errors.name = 'That room number or name is already in use.'
  }

  if (draft.capacity === null || !Number.isSafeInteger(draft.capacity) || draft.capacity <= 0) {
    errors.capacity = 'Enter a whole number of beds greater than zero.'
  }
  if (!draft.categoryId || !ROOM_RATE_CATEGORY_IDS.includes(draft.categoryId)) errors.categoryId = 'Choose a supported monthly rental rate.'
  if (draft.kind !== 'PRIVATE' && draft.kind !== 'SHARED') errors.kind = 'Choose a supported room type.'
  if (draft.status !== 'available' && draft.status !== 'maintenance') errors.status = 'Choose a supported room status.'

  if (options.roomId) {
    const room = data.rooms.find(item => item.id === options.roomId)
    if (!room) {
      errors.general = 'This room no longer exists.'
      return errors
    }
    const occupants = new Set(activeAssignments(data, options.asOf).filter(assignment => assignment.roomId === room.id).map(assignment => assignment.tenantId))
    if (draft.capacity !== null && Number.isSafeInteger(draft.capacity) && draft.capacity < occupants.size) {
      errors.capacity = `This room has ${occupants.size} assigned ${occupants.size === 1 ? 'tenant' : 'tenants'}. Beds cannot be fewer than the current occupancy.`
    }
    if (occupants.size > 0 && draft.status !== room.status) {
      errors.status = 'Occupied rooms cannot be changed to Available or Under repair while tenants remain assigned. Change tenant assignments before changing room status; this form does not change assignments.'
    }
    if (occupants.size > 0 && draft.status === 'maintenance') {
      errors.status = 'An occupied room cannot be marked Under repair while tenants remain assigned.'
    }
  }

  return errors
}

function newRoomId(data: PrototypeAppState): string {
  let id = ''
  do {
    const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    id = `room-${random}`
  } while (data.rooms.some(room => room.id === id))
  return id
}

export function createRoom(data: PrototypeAppState, draft: RoomDraft, asOf: string): RoomMutationResult {
  const errors = validateRoomDraft(data, draft, { asOf })
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  const room: Room = {
    id: newRoomId(data), name: roomLabel(draft.name), floor: 1, capacity: draft.capacity!,
    kind: draft.kind, status: draft.status, categoryId: draft.categoryId!, washingMachineEnabled: false,
  }
  return { ok: true, data: { ...data, rooms: [...data.rooms, room] }, room }
}

export function updateRoom(data: PrototypeAppState, roomId: string, draft: RoomDraft, asOf: string): RoomMutationResult {
  const errors = validateRoomDraft(data, draft, { roomId, asOf })
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  const current = data.rooms.find(room => room.id === roomId)
  if (!current) return { ok: false, errors: { general: 'This room no longer exists.' } }
  const room: Room = {
    ...current, name: roomLabel(draft.name), capacity: draft.capacity!, kind: draft.kind,
    status: draft.status, categoryId: draft.categoryId!,
  }
  return { ok: true, data: { ...data, rooms: data.rooms.map(item => item.id === roomId ? room : item) }, room }
}

export function deleteRoom(data: PrototypeAppState, roomId: string, asOf: string): RoomDeletionResult {
  const blockers = roomDeletionBlockers(data, roomId, asOf)
  if (blockers.length > 0) return { ok: false, blockers }
  if (!data.rooms.some(room => room.id === roomId)) return { ok: false, blockers: ['This room no longer exists.'] }
  return { ok: true, data: { ...data, rooms: data.rooms.filter(room => room.id !== roomId) } }
}
