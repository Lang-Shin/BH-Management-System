import type { PrototypeAction } from '@/app/state/actions'
import type { ChargeCategory, CorrectionSettlementStatus, RoomCategoryId } from '@/domain/types/models'
import type { RatePlan } from '@/domain/calculations/billing-rates'
import type { RoomDraft } from '@/domain/calculations/room-management'
import type { TenantDraft } from '@/domain/calculations/tenant-management'
import type { MeterInitializationInput } from '@/domain/calculations/meter-initialization'
import type { RoomChangeRequestDraft } from '@/domain/calculations/room-change-requests'
import { isIsoDate } from '@/domain/validation/date'
import { ApiError } from './http'

type JsonRecord = Record<string, unknown>
const isRecord = (value: unknown): value is JsonRecord => typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (value: unknown, max = 1000): value is string => typeof value === 'string' && value.length <= max
const isId = (value: unknown): value is string => isText(value) && value.length > 0
const isIdOrNull = (value: unknown): value is string | null => value === null || isId(value)
const isMoney = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const isInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value)
const oneOf = <T extends string>(value: unknown, values: readonly T[]): value is T => typeof value === 'string' && (values as readonly string[]).includes(value)
const optionalIso = (value: unknown) => value === undefined || isIsoDate(value)

const categories: ChargeCategory[] = ['RENT', 'ELECTRICITY', 'WATER', 'WASHING_MACHINE', 'ADVANCE', 'SECURITY_DEPOSIT']
const roomCategories: RoomCategoryId[] = ['RATE_3500', 'RATE_4000', 'RATE_5000']

function invalid(message: string): never {
  throw new ApiError(400, 'INVALID_COMMAND', message)
}

function tenantDraft(value: unknown): TenantDraft {
  if (!isRecord(value) || !isText(value.name) || !isText(value.email) || !isText(value.phone) || !isText(value.address)
    || !isIdOrNull(value.roomId) || !isIsoDate(value.moveInDate) || !isText(value.notes, 500)) {
    invalid('The tenant draft is invalid.')
  }
  return value as unknown as TenantDraft
}

function roomDraft(value: unknown): RoomDraft {
  if (!isRecord(value) || !isText(value.name) || !(value.capacity === null || isInteger(value.capacity))
    || !(value.categoryId === null || oneOf(value.categoryId, roomCategories))
    || !oneOf(value.kind, ['PRIVATE', 'SHARED']) || !oneOf(value.status, ['available', 'maintenance'])) {
    invalid('The room draft is invalid.')
  }
  return value as unknown as RoomDraft
}

function roomChangeDraft(value: unknown): RoomChangeRequestDraft {
  if (!isRecord(value) || !isId(value.tenantId) || !isId(value.requestedRoomId) || !isIsoDate(value.requestedStartDate)
    || !isText(value.reason, 500) || (value.requestId !== undefined && !isId(value.requestId))) {
    invalid('The room change request is invalid.')
  }
  return value as unknown as RoomChangeRequestDraft
}

function ratePlan(value: unknown): RatePlan {
  if (!isRecord(value) || !oneOf(value.kind, ['RENT', 'ELECTRICITY', 'WATER', 'WASHING_MACHINE'])
    || !isIsoDate(value.effectiveFrom) || !isIsoDate(value.recordedOn) || !Array.isArray(value.changes)) {
    invalid('The rate plan is invalid.')
  }
  if (value.kind === 'RENT') {
    const values = value.values
    if (!isRecord(values) || roomCategories.some(category => !isMoney(values[category]))) invalid('The rent rate plan is invalid.')
  } else if (!isMoney(value.amountCents)) invalid('The utility rate plan is invalid.')
  return value as unknown as RatePlan
}

function meterInput(value: JsonRecord): MeterInitializationInput {
  if (!isId(value.roomId) || !Number.isSafeInteger(value.readingMilliKwh) || (value.readingMilliKwh as number) < 0
    || !isIsoDate(value.readOn) || !isIsoDate(value.initializedOn) || !isText(value.sourceNote, 500)) {
    invalid('The meter initialization is invalid.')
  }
  return value as unknown as MeterInitializationInput
}

function categoryArray(value: unknown): ChargeCategory[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > categories.length || !value.every(item => oneOf(item, categories))) {
    invalid('Expected valid charge categories.')
  }
  return value as ChargeCategory[]
}

const actionTypes = new Set<PrototypeAction['type']>([
  'payment/collected',
  'tenant/noteUpdated', 'tenant/created', 'tenant/updated', 'tenant/movedOut', 'tenant/deleted',
  'rates/planned', 'rates/scheduledChange', 'rates/utilityChange', 'room/created', 'room/updated', 'room/deleted', 'room/statusToggled',
  'room/washingMachineUpdated', 'electricity/paymentConfirmed', 'electricity/meterInitialized',
  'room/paymentConfirmed', 'payment/corrected', 'moveIn/paymentRecorded', 'rent/prepaymentRecorded',
  'moveIn/policyUpdated', 'roomChange/requested', 'roomChange/cancelled', 'roomChange/approved',
  'roomChange/rejected', 'roomChange/reservationCancelled', 'roomChange/reservationRescheduled',
  'prepaidRefund/proposed', 'prepaidRefund/approved', 'prepaidRefund/completed', 'prepaidRefund/reversed',
  'occupancy/dateChanged',
])

/** Runtime allow-list for the typed client action union. Unknown actions never reach the reducer. */
export function parseAction(value: unknown): PrototypeAction {
  if (!isRecord(value) || !oneOf(value.type, [...actionTypes])) invalid('Unknown command type.')
  const action = value
  switch (action.type) {
    case 'payment/collected': {
      const input = action.input
      if (!isRecord(input) || !isId(input.transactionId) || !isId(input.roomId) || !isIsoDate(input.collectedOn)
        || !Array.isArray(input.selections) || input.selections.length === 0 || input.selections.length > 200
        || !input.selections.every(item => isRecord(item) && isId(item.id) && isId(item.basis) && isMoney(item.amountCents)
          && isId(item.periodId) && (item.dueDate === null || isIsoDate(item.dueDate)))
        || !isRecord(input.readings) || Object.values(input.readings).some(reading => !Number.isSafeInteger(reading) || (reading as number) < 0)) {
        invalid('Select valid obligations and verified meter readings.')
      }
      if (input.rentPrepayment !== undefined) {
        const prepayment = input.rentPrepayment
        if (!isRecord(prepayment) || !isId(prepayment.cycleId)
          || !Number.isSafeInteger(prepayment.startSequence) || (prepayment.startSequence as number) < 1
          || !Number.isSafeInteger(prepayment.periodCount) || (prepayment.periodCount as number) < 1
          || (prepayment.startSequence as number) + (prepayment.periodCount as number) - 1 > 120) {
          invalid('The rent prepayment range is invalid.')
        }
      }
      return { type: 'payment/collected', input: input as unknown as Extract<PrototypeAction, { type: 'payment/collected' }>['input'] }
    }
    case 'tenant/noteUpdated':
      if (!isId(action.tenantId) || !isText(action.notes, 500)) invalid('The tenant note is invalid.')
      return { type: action.type, tenantId: action.tenantId, notes: action.notes }
    case 'tenant/created':
      if (!optionalIso(action.asOf)) invalid('The effective date is invalid.')
      return { type: action.type, draft: tenantDraft(action.draft), ...(action.asOf ? { asOf: action.asOf as string } : {}) }
    case 'tenant/updated':
      if (!isId(action.tenantId) || !optionalIso(action.asOf)) invalid('The tenant update is invalid.')
      return { type: action.type, tenantId: action.tenantId, draft: tenantDraft(action.draft), ...(action.asOf ? { asOf: action.asOf as string } : {}) }
    case 'tenant/movedOut':
      if (!isId(action.tenantId) || !optionalIso(action.asOf)) invalid('The move-out is invalid.')
      if (action.refundAdvance !== undefined) {
        if (!isRecord(action.refundAdvance) || !isIsoDate(action.refundAdvance.refundedOn) || !isText(action.refundAdvance.reason, 500)) {
          invalid('The advance refund details are invalid.')
        }
      }
      return { ...(action as unknown as Extract<PrototypeAction, { type: 'tenant/movedOut' }>) }
    case 'tenant/deleted':
      if (!isId(action.tenantId) || !optionalIso(action.asOf)) invalid('The tenant deletion is invalid.')
      return { type: action.type, tenantId: action.tenantId, ...(action.asOf ? { asOf: action.asOf as string } : {}) }
    case 'rates/planned': {
      ratePlan(action.plan)
      return invalid('Rate changes must use the category-specific scheduled rate command.')
    }
    case 'rates/scheduledChange': {
      if (!oneOf(action.intent, ['SCHEDULE', 'EDIT', 'CANCEL']) || !oneOf(action.categoryId, roomCategories)
        || !optionalIso(action.asOf)) invalid('The scheduled rent rate change is invalid.')
      if (action.intent !== 'CANCEL' && !isMoney(action.amountCents)) invalid('Enter a positive monthly rent amount.')
      if (action.reason !== undefined && !isText(action.reason, 500)) invalid('The rate change reason is invalid.')
      if (action.intent !== 'SCHEDULE' && (typeof action.reason !== 'string' || action.reason.trim().length < 3)) {
        invalid('Enter a reason with at least 3 characters.')
      }
      if (action.expectedRateId !== undefined && !isId(action.expectedRateId)) invalid('The scheduled rate identifier is invalid.')
      if (action.expectedRateRevision !== undefined
        && (!Number.isSafeInteger(action.expectedRateRevision) || (action.expectedRateRevision as number) < 1)) {
        invalid('The scheduled rate revision is invalid.')
      }
      return {
        type: action.type, intent: action.intent, categoryId: action.categoryId,
        ...(action.amountCents !== undefined ? { amountCents: action.amountCents } : {}),
        ...(action.reason !== undefined ? { reason: action.reason } : {}),
        ...(action.expectedRateId !== undefined ? { expectedRateId: action.expectedRateId } : {}),
        ...(action.expectedRateRevision !== undefined ? { expectedRateRevision: action.expectedRateRevision } : {}),
        ...(action.asOf ? { asOf: action.asOf as string } : {}),
      } as unknown as PrototypeAction
    }
    case 'rates/utilityChange': {
      if (!oneOf(action.intent, ['SCHEDULE', 'EDIT', 'CANCEL'])
        || !oneOf(action.rateKind, ['ELECTRICITY', 'WATER', 'WASHING_MACHINE'])
        || !optionalIso(action.asOf)) invalid('The scheduled utility rate change is invalid.')
      if (action.intent !== 'CANCEL' && !isMoney(action.amountCents)) invalid('Enter a positive rate amount.')
      if (action.reason !== undefined && !isText(action.reason, 500)) invalid('The rate change reason is invalid.')
      if (action.intent !== 'SCHEDULE' && (typeof action.reason !== 'string' || action.reason.trim().length < 3)) {
        invalid('Enter a reason with at least 3 characters.')
      }
      if (action.expectedRateId !== undefined && !isId(action.expectedRateId)) invalid('The scheduled rate identifier is invalid.')
      if (action.expectedRateRevision !== undefined
        && (!Number.isSafeInteger(action.expectedRateRevision) || (action.expectedRateRevision as number) < 1)) {
        invalid('The scheduled rate revision is invalid.')
      }
      return {
        type: action.type, intent: action.intent, rateKind: action.rateKind,
        ...(action.amountCents !== undefined ? { amountCents: action.amountCents } : {}),
        ...(action.reason !== undefined ? { reason: action.reason } : {}),
        ...(action.expectedRateId !== undefined ? { expectedRateId: action.expectedRateId } : {}),
        ...(action.expectedRateRevision !== undefined ? { expectedRateRevision: action.expectedRateRevision } : {}),
        ...(action.asOf ? { asOf: action.asOf as string } : {}),
      } as unknown as PrototypeAction
    }
    case 'room/created':
      if (!optionalIso(action.asOf)) invalid('The effective date is invalid.')
      return { type: action.type, draft: roomDraft(action.draft), ...(action.asOf ? { asOf: action.asOf as string } : {}) }
    case 'room/updated':
      if (!isId(action.roomId) || !optionalIso(action.asOf)) invalid('The room update is invalid.')
      return { type: action.type, roomId: action.roomId, draft: roomDraft(action.draft), ...(action.asOf ? { asOf: action.asOf as string } : {}) }
    case 'room/deleted':
      if (!isId(action.roomId) || !optionalIso(action.asOf)) invalid('The room deletion is invalid.')
      return { type: action.type, roomId: action.roomId, ...(action.asOf ? { asOf: action.asOf as string } : {}) }
    case 'room/statusToggled':
      if (!isId(action.roomId) || !optionalIso(action.asOf)) invalid('The room status change is invalid.')
      return { type: action.type, roomId: action.roomId, ...(action.asOf ? { asOf: action.asOf as string } : {}) }
    case 'room/washingMachineUpdated':
      if (!isId(action.roomId) || typeof action.enabled !== 'boolean') invalid('The washing-machine change is invalid.')
      return { type: action.type, roomId: action.roomId, enabled: action.enabled }
    case 'electricity/paymentConfirmed':
      if (!isId(action.obligationId) || !Number.isSafeInteger(action.currentReadingMilliKwh) || (action.currentReadingMilliKwh as number) < 0 || !isIsoDate(action.paidOn)) {
        invalid('The electricity payment is invalid.')
      }
      return action as unknown as PrototypeAction
    case 'electricity/meterInitialized':
      return { type: action.type, ...meterInput(action) }
    case 'room/paymentConfirmed':
      if (!isId(action.roomId) || !isId(action.periodId) || !Array.isArray(action.selected)
        || !action.selected.every(item => oneOf(item, categories)) || !isIsoDate(action.asOf)
        || !(action.electricityReadingMilliKwh === null || (Number.isSafeInteger(action.electricityReadingMilliKwh) && (action.electricityReadingMilliKwh as number) >= 0))) {
        invalid('The room payment is invalid.')
      }
      return action as unknown as PrototypeAction
    case 'payment/corrected':
      categoryArray(action.selectedCategories)
      if (!isId(action.paymentId) || !isText(action.reason, 500) || action.reason.trim().length < 3 || !isIsoDate(action.correctedAt)
        || !(action.correctedElectricityReadingMilliKwh === null || Number.isSafeInteger(action.correctedElectricityReadingMilliKwh))
        || typeof action.moneyExchangeConfirmed !== 'boolean'
        || !oneOf(action.settlementStatus, ['', 'CORRECTED', 'REFUNDED', 'ADDITIONAL_RECEIVED'])
        || (action.reverseAll !== undefined && typeof action.reverseAll !== 'boolean')
        || (action.correctedMethod !== undefined && action.correctedMethod !== null
          && !oneOf(action.correctedMethod, ['cash', 'bank-transfer']))) {
        invalid('The payment correction is invalid.')
      }
      if (action.lines !== undefined && (!Array.isArray(action.lines) || action.lines.length > 200
        || !action.lines.every(line => isRecord(line) && isId(line.targetId) && oneOf(line.category, categories)
          && isMoney(line.amountCents) && line.amountCents > 0
          && (line.sourceAllocationId === undefined || line.sourceAllocationId === null || isId(line.sourceAllocationId))))) {
        invalid('The corrected allocation lines are invalid.')
      }
      if (action.retainedAllocationIds !== undefined && (!Array.isArray(action.retainedAllocationIds)
        || action.retainedAllocationIds.length > 1000 || !action.retainedAllocationIds.every(isId)
        || !isId(action.expectedReceiptId) || !Number.isSafeInteger(action.expectedReceiptRevision)
        || (action.expectedReceiptRevision as number) < 1 || action.lines !== undefined)) {
        invalid('The original receipt and retained payment allocation identifiers are required.')
      }
      return { ...(action as unknown as Extract<PrototypeAction, { type: 'payment/corrected' }>), settlementStatus: action.settlementStatus as CorrectionSettlementStatus | '' }
    case 'moveIn/paymentRecorded':
      if (!isId(action.obligationId) || !isIsoDate(action.paidOn) || !Array.isArray(action.categories)
        || action.categories.length === 0 || !action.categories.every(item => oneOf(item, ['ADVANCE', 'SECURITY_DEPOSIT']))) {
        invalid('The move-in payment is invalid.')
      }
      return action as unknown as PrototypeAction
    case 'rent/prepaymentRecorded':
      if (!isId(action.cycleId) || !Number.isSafeInteger(action.periodCount) || (action.periodCount as number) < 1
        || (action.periodCount as number) > 120 || !isIsoDate(action.paidOn)) invalid('The rent prepayment is invalid.')
      return { type: action.type, cycleId: action.cycleId, periodCount: action.periodCount as number, paidOn: action.paidOn }
    case 'moveIn/policyUpdated':
      if (!optionalIso(action.asOf) || (action.advanceApplication !== undefined
        && !oneOf(action.advanceApplication, ['FIRST_MONTH', 'LAST_MONTH', 'MANUAL']))
        || (action.depositDisposition !== undefined && !oneOf(action.depositDisposition, ['NON_REFUNDABLE', 'MANUAL_REVIEW']))) {
        invalid('The move-in policy update is invalid.')
      }
      return action as unknown as PrototypeAction
    case 'roomChange/requested':
      if (!isIsoDate(action.asOf)) invalid('The request date is invalid.')
      return { type: action.type, draft: roomChangeDraft(action.draft), asOf: action.asOf }
    case 'roomChange/cancelled':
      if (!isId(action.requestId) || !isId(action.tenantId) || !isText(action.reason, 500) || !isIsoDate(action.asOf)) invalid('The cancellation is invalid.')
      return action as unknown as PrototypeAction
    case 'roomChange/approved':
      if (!isId(action.requestId) || !isIsoDate(action.effectiveDate) || !isText(action.note, 500)
        || typeof action.billingReviewAcknowledged !== 'boolean' || !isIsoDate(action.decidedAt)) invalid('The approval is invalid.')
      return action as unknown as PrototypeAction
    case 'roomChange/rejected':
      if (!isId(action.requestId) || !isText(action.reason, 500) || !isIsoDate(action.decidedAt)) invalid('The rejection is invalid.')
      return action as unknown as PrototypeAction
    case 'roomChange/reservationCancelled':
      if (!isId(action.requestId) || !isText(action.reason, 500) || !isIsoDate(action.asOf)) invalid('The reservation cancellation is invalid.')
      return action as unknown as PrototypeAction
    case 'roomChange/reservationRescheduled':
      if (!isId(action.requestId) || !isIsoDate(action.effectiveDate) || !isText(action.reason, 500) || !isIsoDate(action.asOf)) invalid('The reschedule is invalid.')
      return action as unknown as PrototypeAction
    case 'prepaidRefund/proposed':
      if (!isId(action.tenantId) || !isIsoDate(action.moveOutDate) || !isText(action.reason, 500)
        || action.reason.trim().length < 3 || !isIsoDate(action.asOf)) invalid('The prepaid refund proposal is invalid.')
      return action as unknown as PrototypeAction
    case 'prepaidRefund/approved':
      if (!isId(action.refundId) || !isIsoDate(action.asOf)
        || (action.reason !== undefined && !isText(action.reason, 500))
        || (action.entitlementConfirmed !== undefined && typeof action.entitlementConfirmed !== 'boolean')) {
        invalid('The prepaid refund approval is invalid.')
      }
      return action as unknown as PrototypeAction
    case 'prepaidRefund/completed':
      if (!isId(action.refundId) || !isIsoDate(action.refundedOn) || !isIsoDate(action.asOf)
        || (action.reason !== undefined && !isText(action.reason, 500))) invalid('The prepaid refund completion is invalid.')
      return action as unknown as PrototypeAction
    case 'prepaidRefund/reversed':
      if (!isId(action.refundId) || !isIsoDate(action.asOf) || !isText(action.reason, 500)
        || action.reason.trim().length < 3) invalid('The prepaid refund reversal is invalid.')
      return action as unknown as PrototypeAction
    case 'occupancy/dateChanged':
      if (!isIsoDate(action.asOf)) invalid('The occupancy date is invalid.')
      return action as unknown as PrototypeAction
    default:
      return invalid('Unknown command type.')
  }
}

/** Server-owned civil dates override client clocks for system-time mutations. */
export function withServerDate(action: PrototypeAction, serverDate: string): PrototypeAction {
  switch (action.type) {
    case 'payment/collected': return { ...action, input: { ...action.input, collectedOn: serverDate } }
    case 'rent/prepaymentRecorded': return { ...action, paidOn: serverDate }
    case 'tenant/created': return { ...action, asOf: serverDate }
    case 'tenant/updated': return { ...action, asOf: serverDate }
    case 'tenant/movedOut': return { ...action, asOf: serverDate }
    case 'tenant/deleted': return { ...action, asOf: serverDate }
    case 'room/created': return { ...action, asOf: serverDate }
    case 'room/updated': return { ...action, asOf: serverDate }
    case 'room/deleted': return { ...action, asOf: serverDate }
    case 'room/statusToggled': return { ...action, asOf: serverDate }
    case 'room/paymentConfirmed': return { ...action, asOf: serverDate }
    case 'payment/corrected': return { ...action, correctedAt: serverDate }
    case 'prepaidRefund/proposed': return { ...action, asOf: serverDate }
    case 'prepaidRefund/approved': return { ...action, asOf: serverDate }
    case 'prepaidRefund/completed': return { ...action, refundedOn: serverDate, asOf: serverDate }
    case 'prepaidRefund/reversed': return { ...action, asOf: serverDate }
    case 'moveIn/policyUpdated': return { ...action, asOf: serverDate }
    case 'rates/scheduledChange': return { ...action, asOf: serverDate }
    case 'rates/utilityChange': return { ...action, asOf: serverDate }
    case 'occupancy/dateChanged': return { ...action, asOf: serverDate }
    default: return action
  }
}

export function parseRentQuoteBody(value: unknown): { cycleId: string; periodCount: number } {
  if (!isRecord(value) || !isId(value.cycleId) || !Number.isSafeInteger(value.periodCount)
    || (value.periodCount as number) < 1 || (value.periodCount as number) > 120) {
    throw new ApiError(400, 'INVALID_QUOTE', 'Choose a cycle and between 1 and 120 rent periods.')
  }
  return { cycleId: value.cycleId, periodCount: value.periodCount as number }
}

export function parseImportBody(value: unknown): string {
  if (!isRecord(value) || typeof value.snapshot !== 'string' || value.snapshot.length > 2_000_000) {
    throw new ApiError(400, 'INVALID_IMPORT', 'Provide a localStorage snapshot string.')
  }
  return value.snapshot
}

export function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length > 200) throw new ApiError(400, 'INVALID_REQUEST', 'Expected a short string.')
  return value
}

export function assertNoUnexpectedKeys(value: JsonRecord, allowed: string[]): void {
  const extra = Object.keys(value).filter(key => !allowed.includes(key))
  if (extra.length > 0) throw new ApiError(400, 'UNEXPECTED_FIELD', 'The request contains unsupported fields.', extra)
}
