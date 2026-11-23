import type { Charge, ChargeCategory, MeterReading, PrototypeAppState } from '@/domain/types/models'
import { calendarBillingPeriods, ensureBillingPeriod, resolveBillingPeriod } from './billing-periods'
import { proposedRoomCharges } from './billing-eligibility'
import { anniversaryCycleForBillingPeriod } from './billing-rent'
import { chargeRoom } from './room-finance'
import { chargeBalance } from './summary'
import { rentObligationPaidCents } from './rental-periods'
import { buildRoomPaymentQuote } from './room-payment'
import { electricityBaseline, metersForRoom } from './meter-baseline'
import { nextReceiptNumbers } from './receipt-numbering'
import { formatDate, formatShortDateRange } from '@/lib/format'

export interface CollectionSelection {
  id: string
  amountCents: number
  periodId: string
  dueDate: string | null
  basis: string
}

export interface CollectionInput {
  transactionId: string
  roomId: string
  selections: CollectionSelection[]
  readings: Record<string, number>
  collectedOn: string
}

export interface CollectibleItem extends CollectionSelection {
  category: ChargeCategory
  label: string
  periodLabel: string
  periodStart: string
  status: 'OVERDUE' | 'DUE' | 'UNPAID' | 'AWAITING READING'
  originalCents: number | null
  selectable: boolean
  detail: string
  charge?: Charge
  reading?: MeterReading
  meterId?: string
  needsReading?: boolean
}

const collectibleCategories: ChargeCategory[] = ['RENT', 'WATER', 'ELECTRICITY', 'WASHING_MACHINE']

function status(dueDate: string | null, asOf: string): CollectibleItem['status'] {
  return dueDate && dueDate < asOf ? 'OVERDUE' : dueDate === asOf ? 'DUE' : 'UNPAID'
}

/** Read-only catalog shared by the authenticated API and the payment review UI. */
export function collectionCatalog(data: PrototypeAppState, roomId: string, asOf: string, readings: Record<string, number> = {}): CollectibleItem[] {
  const room = data.rooms.find(item => item.id === roomId)
  if (!room) return []
  const items: CollectibleItem[] = []
  for (const obligation of data.rentObligations) {
    if (obligation.roomId !== roomId || obligation.state !== 'ISSUED' || obligation.issuedOn > asOf || obligation.dueDate > asOf) continue
    const remaining = obligation.amountCents - rentObligationPaidCents(data, obligation.id, asOf)
    const period = data.rentalPeriods.find(item => item.id === obligation.rentalPeriodId)
    if (!period || remaining <= 0) continue
    const reviewRequired = data.financialReviewCases.some(review => review.occupancyCycleId === obligation.occupancyCycleId && review.status === 'OPEN')
    const advanceRequired = obligation.source === 'MOVE_IN_ADVANCE'
    items.push({
      id: obligation.id, category: 'RENT', label: 'Rent', periodId: period.id,
      periodLabel: `${formatShortDateRange(period.startDate, period.endDateExclusive)}, ${period.startDate.slice(0, 4)}`,
      periodStart: period.startDate, dueDate: obligation.dueDate, originalCents: obligation.amountCents,
      amountCents: remaining, status: status(obligation.dueDate, asOf), selectable: !reviewRequired && !advanceRequired,
      basis: JSON.stringify([obligation.rateId, obligation.rateEffectiveFrom, obligation.amountCents, period.startDate, period.endDateExclusive]),
      detail: advanceRequired ? 'Settle the mandatory move-in advance in the move-in payment section; do not collect first rent separately.'
        : reviewRequired ? 'An open financial review must be resolved before collection.' : `Due ${formatDate(obligation.dueDate)} · original rent-rate snapshot`,
    })
  }

  const periods = [...new Map([...data.billingPeriods, ...calendarBillingPeriods(data, asOf)]
    .filter(period => period.startDate <= asOf).map(period => [period.id, period])).values()]
  for (const period of periods) {
    const issued = data.charges.filter(charge => collectibleCategories.includes(charge.category)
      && charge.state === 'ISSUED' && charge.issuedOn <= asOf && charge.billingPeriodId === period.id
      && chargeRoom(data, charge).roomId === roomId)
    for (const charge of issued) {
      if (charge.category === 'RENT' && anniversaryCycleForBillingPeriod(data, roomId, period)) continue
      const remaining = chargeBalance(data, charge, asOf)
      if (remaining <= 0) continue
      items.push({
        id: charge.id, category: charge.category, label: charge.category === 'WASHING_MACHINE' ? 'Washing machine' : charge.category === 'RENT' ? 'Rent (legacy calendar)' : charge.category === 'WATER' ? 'Water' : 'Electricity',
        periodId: period.id, periodLabel: period.label, periodStart: period.startDate,
        dueDate: charge.dueDate, originalCents: charge.amountCents, amountCents: remaining,
        status: status(charge.dueDate, asOf), selectable: true, detail: 'Issued obligation · original rate retained', charge,
        basis: JSON.stringify([charge.id, charge.amountCents, charge.issuedOn, charge.dueDate, charge.correction]),
      })
    }
    const currentMonth = period.startDate.slice(0, 7) === asOf.slice(0, 7)
    for (const charge of proposedRoomCharges(data, room, period, asOf)) {
      // Current subscription state is not proof of historical washing usage.
      if (charge.category !== 'WATER' && !(charge.category === 'WASHING_MACHINE' && currentMonth)) continue
      if (chargeRoom(ensureBillingPeriod(data, period), charge).roomId !== roomId) continue
      if (data.charges.some(existing => existing.id === charge.id)) continue
      items.push({
        id: charge.id, category: charge.category,
        label: charge.category === 'WATER' ? `Water · ${data.tenants.find(tenant => tenant.id === charge.tenantId)?.name ?? 'eligible tenant'}` : 'Washing machine',
        periodId: period.id, periodLabel: period.label, periodStart: period.startDate,
        dueDate: null, originalCents: charge.amountCents, amountCents: charge.amountCents,
        status: 'UNPAID', selectable: true, detail: 'Eligible monthly charge · not issued yet; no historical due date recorded', charge,
        basis: JSON.stringify([charge.category, charge.tenantId, charge.amountCents, period.id]),
      })
    }
    const electricityId = `reading:${period.id}:${roomId}`
    const quote = buildRoomPaymentQuote(data, {
      roomId, periodId: period.id, selected: ['ELECTRICITY'],
      electricityReadingMilliKwh: readings[electricityId] ?? null, asOf,
    })
    const option = quote.options.find(item => item.category === 'ELECTRICITY')!
    if (issued.some(charge => charge.category === 'ELECTRICITY') || option.state === 'PAID' || option.state === 'UNAVAILABLE') continue
    const meter = metersForRoom(data, roomId)
    const baseline = meter.length === 1 ? electricityBaseline(data, meter[0]!.id) : null
    // A later settled cumulative interval must never be billed again in an older month.
    if (baseline && (baseline.readOn > period.endDate || baseline.readOn > asOf)) continue
    const calculated = quote.electricity?.charge
    items.push({
      id: electricityId, category: 'ELECTRICITY', label: 'Electricity', periodId: period.id,
      periodLabel: period.label, periodStart: period.startDate, dueDate: null,
      originalCents: calculated?.amountCents ?? null, amountCents: calculated?.amountCents ?? 0,
      status: calculated ? 'UNPAID' : 'AWAITING READING', selectable: Boolean(calculated),
      detail: meter.length !== 1 || !baseline ? 'Set a verified initial meter reading in Room Details first.'
        : quote.electricity?.error ?? `Cumulative from ${baseline.readingMilliKwh / 1000} kWh on ${formatDate(baseline.readOn)}; select only one pending month per meter.`,
      charge: calculated, reading: quote.electricity?.currentReading, meterId: meter[0]?.id, needsReading: true,
      basis: JSON.stringify([baseline?.id, calculated?.electricity.rateId, readings[electricityId], period.id]),
    })
  }
  return [...new Map(items.map(item => [item.id, item])).values()]
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart) || a.category.localeCompare(b.category) || a.id.localeCompare(b.id))
}

export type CollectionResult =
  | { ok: true; data: PrototypeAppState; paymentId: string; receiptId: string; totalCents: number; items: CollectibleItem[] }
  | { ok: false; reason: string }

/** One cash transaction, one receipt, explicit allocations; no sequential/implicit settlement. */
export function prepareCollection(data: PrototypeAppState, input: CollectionInput): CollectionResult {
  if (!input.transactionId || !/^\d{4}-\d{2}-\d{2}$/.test(input.collectedOn)) return { ok: false, reason: 'INVALID_PAYMENT' }
  if (!input.selections.length || new Set(input.selections.map(item => item.id)).size !== input.selections.length) return { ok: false, reason: 'INVALID_SELECTION' }
  const paymentId = `payment-collection-${input.transactionId}`
  if (data.payments.some(payment => payment.id === paymentId)) return { ok: false, reason: 'DUPLICATE_PAYMENT' }
  const catalog = collectionCatalog(data, input.roomId, input.collectedOn, input.readings)
  const items: CollectibleItem[] = []
  for (const selection of input.selections) {
    const item = catalog.find(candidate => candidate.id === selection.id)
    if (!item || !item.selectable || item.amountCents <= 0 || item.amountCents !== selection.amountCents
      || item.periodId !== selection.periodId || item.dueDate !== selection.dueDate || item.basis !== selection.basis) return { ok: false, reason: 'STALE_SELECTION' }
    if (item.category === 'RENT') {
      const cycleId = data.rentObligations.find(rent => rent.id === item.id)?.occupancyCycleId
      if (cycleId && data.financialReviewCases.some(review => review.occupancyCycleId === cycleId && review.status === 'OPEN')) {
        return { ok: false, reason: 'FINANCIAL_REVIEW_REQUIRED' }
      }
    }
    items.push(item)
  }
  const metered = items.filter(item => item.needsReading)
  if (new Set(metered.map(item => item.meterId)).size !== metered.length) return { ok: false, reason: 'ONE_INTERVAL_PER_METER' }
  const totalCents = items.reduce((sum, item) => sum + item.amountCents, 0)
  if (!Number.isSafeInteger(totalCents)) return { ok: false, reason: 'INVALID_TOTAL' }
  const cycle = data.occupancyCycles.filter(item => item.roomId === input.roomId)
    .sort((a, b) => (b.endedAt ?? '9999').localeCompare(a.endedAt ?? '9999'))[0]
  if (!cycle) return { ok: false, reason: 'ROOM_CYCLE_REQUIRED' }
  let next = data
  for (const item of items) {
    if (item.charge) {
      const period = resolveBillingPeriod(next, item.charge.billingPeriodId)
      if (!period) return { ok: false, reason: 'PERIOD_NOT_FOUND' }
      next = ensureBillingPeriod(next, period)
    }
  }
  const extraCharges = items.flatMap(item => item.charge && !next.charges.some(charge => charge.id === item.charge!.id) ? [item.charge] : [])
  const allocations = items.map(item => ({
    id: `allocation-${paymentId}-${item.id}`, paymentId, chargeId: item.charge?.id ?? item.id,
    amountCents: item.amountCents, allocatedOn: input.collectedOn, creditId: null,
    state: 'ACTIVE' as const, reversalAuditEventId: null,
  }))
  const receiptId = `receipt-${paymentId}`
  next = {
    ...next, charges: [...next.charges, ...extraCharges],
    meterReadings: [...next.meterReadings, ...items.flatMap(item => item.reading ? [item.reading] : [])],
    electricityBillObligations: next.electricityBillObligations.filter(obligation => !metered.some(item => item.periodId === obligation.billingPeriodId && obligation.roomId === input.roomId)),
    payments: [...next.payments, {
      id: paymentId, scope: 'ROOM', roomId: input.roomId, tenantId: null, occupancyCycleId: cycle.id,
      paidOn: input.collectedOn, amountCents: totalCents, method: null, state: 'RECORDED', correction: null,
    }],
    paymentAllocations: [...next.paymentAllocations, ...allocations],
    receipts: [...next.receipts, {
      id: receiptId, paymentId, receiptNumber: nextReceiptNumbers(next, 1)[0]!, issuedOn: input.collectedOn,
      amountCents: totalCents, allocationIds: allocations.map(item => item.id), state: 'ISSUED', revision: 1, supersedesReceiptId: null,
    }],
    auditEvents: [...next.auditEvents, {
      id: `audit-${paymentId}`, actorId: 'landlord', occurredOn: input.collectedOn,
      action: 'ROOM_PAYMENT_RECORDED', entityType: 'PAYMENT', entityId: paymentId,
      reason: 'Collected explicitly selected historical rent and calendar utility obligations in one cash transaction.',
      beforeSnapshot: JSON.stringify({ selectedCount: items.length, collectedOn: input.collectedOn }),
      afterSnapshot: JSON.stringify({ paymentId, receiptId, totalCents, allocationCount: allocations.length }),
    }],
  }
  return { ok: true, data: next, paymentId, receiptId, totalCents, items }
}
