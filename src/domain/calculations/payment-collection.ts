import type { Charge, ChargeCategory, ChargeStatus, MeterReading, PrototypeAppState } from '@/domain/types/models'
import { calendarBillingPeriods, ensureBillingPeriod, resolveBillingPeriod } from './billing-periods'
import { proposedRoomCharges } from './billing-eligibility'
import { anniversaryCycleForBillingPeriod } from './billing-rent'
import { chargeRoom } from './room-finance'
import { chargeBalance, unresolvedElectricity } from './summary'
import { rentObligationPaidCents } from './rental-periods'
import { buildRoomPaymentQuote } from './room-payment'
import { electricityBaseline, metersForRoom } from './meter-baseline'
import { materializeRentRange, quoteRentPrepayment, quoteRentRange, rentPrepaymentBasis, type RentPeriodConflict, type RentRangeQuote, type RentRangeSelection } from './rent-schedule'
import { nextReceiptNumbers } from './receipt-numbering'
import { formatDate, formatMoney, formatShortDateRange } from '@/lib/format'

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
  rentPrepayment?: RentRangeSelection
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
  periodStatus?: ChargeStatus
  prepaymentConflict?: RentPeriodConflict | null
  rateCents?: number
}

const collectibleCategories: ChargeCategory[] = ['RENT', 'WATER', 'ELECTRICITY', 'WASHING_MACHINE']

function status(dueDate: string | null, asOf: string): CollectibleItem['status'] {
  return dueDate && dueDate < asOf ? 'OVERDUE' : dueDate === asOf ? 'DUE' : 'UNPAID'
}

export interface RentPrepaymentCatalog {
  quote: RentRangeQuote | null
  items: CollectibleItem[]
  reason: string | null
}

export function rentPrepaymentCollectibles(quote: RentRangeQuote, asOf: string): CollectibleItem[] {
  return quote.periods.map(line => {
    const conflict = line.conflict
    const detail = conflict === 'ALREADY_PAID' ? 'Already PAID. Remove this period from the requested range; it will not be collected twice.'
      : conflict === 'VOIDED' ? 'This rent obligation is voided and needs financial review.'
        : conflict === 'ADVANCE_UNPAID' ? 'The first period is settled by the mandatory move-in advance, not a separate rent collection.'
          : line.paidCents > 0 ? `Partially paid. Only the remaining balance is included at the issued rate.`
            : `Rate locked at ${formatMoney(line.rateSnapshotCents)} per month for this prepayment.`
    return {
      id: line.rentObligationId, category: 'RENT' as const, label: 'Rent',
      periodId: line.rentalPeriodId,
      periodLabel: `${formatShortDateRange(line.startDate, line.endDateExclusive)}, ${line.startDate.slice(0, 4)}`,
      periodStart: line.startDate, dueDate: line.dueDate, originalCents: line.originalCents,
      amountCents: line.amountCents, status: status(line.dueDate, asOf),
      selectable: !conflict && line.amountCents > 0, detail,
      basis: rentPrepaymentBasis(quote, line),
      periodStatus: line.status, prepaymentConflict: conflict, rateCents: line.rateSnapshotCents,
    }
  })
}

/** Shared read model for the range quote endpoint and the landlord UI. */
export function rentPrepaymentCatalog(
  data: PrototypeAppState,
  roomId: string,
  selection: RentRangeSelection,
  asOf: string,
): RentPrepaymentCatalog {
  const result = quoteRentRange(data, { ...selection, asOf })
  if (!result.quote) return { quote: null, items: [], reason: result.ok ? null : result.reason }
  if (result.quote.roomId !== roomId) return { quote: null, items: [], reason: 'ROOM_MISMATCH' }
  return {
    quote: result.quote, items: rentPrepaymentCollectibles(result.quote, asOf),
    reason: result.ok ? null : result.reason,
  }
}

/** Read-only catalog shared by the authenticated API and the payment review UI. */
export function collectionCatalog(data: PrototypeAppState, roomId: string, asOf: string, readings: Record<string, number> = {}): CollectibleItem[] {
  const room = data.rooms.find(item => item.id === roomId)
  if (!room) return []
  const items: CollectibleItem[] = []
  const issuedElectricity: Charge[] = []
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

  const periods = [...new Map([...calendarBillingPeriods(data, asOf), ...data.billingPeriods]
    .filter(period => period.startDate <= asOf).map(period => [period.startDate, period])).values()]
  for (const period of periods) {
    const issued = data.charges.filter(charge => collectibleCategories.includes(charge.category)
      && charge.state === 'ISSUED' && charge.issuedOn <= asOf && charge.billingPeriodId === period.id
      && chargeRoom(data, charge).roomId === roomId)
    for (const charge of issued) {
      if (charge.category === 'RENT' && anniversaryCycleForBillingPeriod(data, roomId, period)) continue
      const remaining = chargeBalance(data, charge, asOf)
      if (remaining <= 0) continue
      if (charge.category === 'ELECTRICITY') issuedElectricity.push(charge)
      items.push({
        id: charge.id, category: charge.category, label: charge.category === 'WASHING_MACHINE' ? 'Washing machine' : charge.category === 'RENT' ? 'Rent (legacy calendar)' : charge.category === 'WATER' ? 'Water' : 'Electricity',
        periodId: period.id, periodLabel: period.label, periodStart: period.startDate,
        dueDate: charge.dueDate, originalCents: charge.amountCents, amountCents: remaining,
        status: status(charge.dueDate, asOf), selectable: true, detail: 'Issued obligation · original rate retained', charge,
        meterId: charge.category === 'ELECTRICITY' ? charge.electricity.meterId : undefined,
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
  }

  if (issuedElectricity.length === 0) {
    const meter = metersForRoom(data, roomId)
    const unresolved = [...unresolvedElectricity(data, asOf, undefined, roomId)]
      .sort((a, b) => (data.billingPeriods.find(period => period.id === b.billingPeriodId)?.startDate ?? '').localeCompare(data.billingPeriods.find(period => period.id === a.billingPeriodId)?.startDate ?? ''))[0]
    const targetPeriod = unresolved
      ? periods.find(period => period.id === unresolved.billingPeriodId)
      : [...periods].sort((a, b) => b.startDate.localeCompare(a.startDate))[0]
    if (targetPeriod) {
      const electricityId = `reading:${meter[0]?.id ?? roomId}:cumulative`
      const quote = meter.length > 1 ? null : buildRoomPaymentQuote(data, {
        roomId, periodId: targetPeriod.id, selected: ['ELECTRICITY'],
        electricityReadingMilliKwh: readings[electricityId] ?? null, asOf,
      })
      const baseline = meter.length === 1 ? electricityBaseline(data, meter[0]!.id) : null
      const calculated = quote?.electricity?.charge
      const electricityOption = quote?.options.find(option => option.category === 'ELECTRICITY')
      const awaiting = !calculated
      if (electricityOption?.state !== 'PAID' && electricityOption?.state !== 'UNAVAILABLE') items.push({
        id: electricityId, category: 'ELECTRICITY', label: 'Cumulative electricity', periodId: targetPeriod.id,
        periodLabel: targetPeriod.label, periodStart: targetPeriod.startDate, dueDate: null,
        originalCents: calculated?.amountCents ?? null, amountCents: calculated?.amountCents ?? 0,
        status: awaiting ? 'AWAITING READING' : status(null, asOf), selectable: Boolean(calculated),
        detail: meter.length > 1 ? 'Multiple meters require review before one cumulative interval can be collected.'
          : meter.length !== 1 || !baseline ? 'Set a verified initial meter reading in Room Details first.'
            : quote?.electricity?.error ?? `Cumulative from ${baseline.readingMilliKwh / 1000} kWh on ${formatDate(baseline.readOn)} since the last settled reading.`,
        charge: calculated, reading: quote?.electricity?.currentReading, meterId: meter[0]?.id, needsReading: true,
        basis: JSON.stringify([baseline?.id, calculated?.electricity.rateId, readings[electricityId], targetPeriod.id]),
      })
    }
  }
  return [...new Map(items.map(item => [item.id, item])).values()]
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart) || a.category.localeCompare(b.category) || a.id.localeCompare(b.id))
}

export type CollectionResult =
  | { ok: true; data: PrototypeAppState; paymentId: string; receiptId: string; totalCents: number; items: CollectibleItem[]; prepaymentId?: string }
  | { ok: false; reason: string }

/** One cash transaction, one receipt, explicit allocations; no sequential/implicit settlement. */
export function prepareCollection(data: PrototypeAppState, input: CollectionInput): CollectionResult {
  if (!input.transactionId || !/^\d{4}-\d{2}-\d{2}$/.test(input.collectedOn)) return { ok: false, reason: 'INVALID_PAYMENT' }
  if (!input.selections.length || new Set(input.selections.map(item => item.id)).size !== input.selections.length) return { ok: false, reason: 'INVALID_SELECTION' }
  const paymentId = `payment-collection-${input.transactionId}`
  if (data.payments.some(payment => payment.id === paymentId)) return { ok: false, reason: 'DUPLICATE_PAYMENT' }

  let prepaymentQuote: RentRangeQuote | undefined
  let prepaymentItems: CollectibleItem[] = []
  let catalog: CollectibleItem[]
  if (input.rentPrepayment) {
    const quoted = quoteRentRange(data, { ...input.rentPrepayment, asOf: input.collectedOn })
    if (!quoted.ok) return { ok: false, reason: quoted.reason }
    prepaymentQuote = quoted.quote
    if (prepaymentQuote.roomId !== input.roomId) return { ok: false, reason: 'STALE_SELECTION' }
    prepaymentItems = rentPrepaymentCollectibles(prepaymentQuote, input.collectedOn)
    const selectedRentIds = new Set(input.selections.map(selection => selection.id)
      .filter(id => prepaymentItems.some(item => item.id === id)))
    if (selectedRentIds.size !== prepaymentItems.length || prepaymentItems.some(item => !item.selectable)) {
      return { ok: false, reason: 'PREPAYMENT_RANGE_INCOMPLETE' }
    }
    catalog = [...prepaymentItems, ...collectionCatalog(data, input.roomId, input.collectedOn, input.readings)
      .filter(item => item.category !== 'RENT')]
  } else {
    catalog = collectionCatalog(data, input.roomId, input.collectedOn, input.readings)
  }

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
  const cycle = prepaymentQuote
    ? data.occupancyCycles.find(item => item.id === prepaymentQuote!.cycleId)
    : data.occupancyCycles.filter(item => item.roomId === input.roomId)
      .sort((a, b) => (b.endedAt ?? '9999').localeCompare(a.endedAt ?? '9999'))[0]
  if (!cycle) return { ok: false, reason: 'ROOM_CYCLE_REQUIRED' }
  const prepaymentId = prepaymentQuote
    ? `rent-prepayment-${prepaymentQuote.cycleId}-${prepaymentQuote.startSequence}-${prepaymentQuote.periodCount}`
    : undefined
  if (prepaymentId && nextPrepaymentExists(data, prepaymentId)) return { ok: false, reason: 'DUPLICATE_PREPAYMENT' }

  let next = prepaymentQuote ? materializeRentRange(data, prepaymentQuote) : data
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
  const prepaymentTotalCents = prepaymentItems.reduce((sum, item) => sum + item.amountCents, 0)
  const newAuditEvents: PrototypeAppState['auditEvents'] = [{
    id: `audit-${paymentId}`, actorId: 'landlord', occurredOn: input.collectedOn,
    action: 'ROOM_PAYMENT_RECORDED', entityType: 'PAYMENT', entityId: paymentId,
    reason: prepaymentQuote
      ? 'Collected selected prepaid rent periods and calendar utility obligations in one cash transaction.'
      : 'Collected explicitly selected historical rent and calendar utility obligations in one cash transaction.',
    beforeSnapshot: JSON.stringify({ selectedCount: items.length, collectedOn: input.collectedOn }),
    afterSnapshot: JSON.stringify({
      paymentId, receiptId, totalCents, allocationCount: allocations.length,
      ...(prepaymentId ? { prepaymentId, prepaidRentCents: prepaymentTotalCents } : {}),
    }),
  }]
  if (prepaymentId && prepaymentQuote) {
    newAuditEvents.push({
      id: `audit-${prepaymentId}`, actorId: 'landlord', occurredOn: input.collectedOn,
      action: 'RENT_PREPAYMENT_RECORDED' as const, entityType: 'RENT_PREPAYMENT' as const, entityId: prepaymentId,
      reason: `Locked ${formatMoney(prepaymentQuote.rateCents)} monthly rent for ${prepaymentQuote.periodCount} prepaid anniversary period(s).`,
      beforeSnapshot: JSON.stringify({
        cycleId: prepaymentQuote.cycleId, startSequence: prepaymentQuote.startSequence,
        periodCount: prepaymentQuote.periodCount, collectionDate: input.collectedOn,
      }),
      afterSnapshot: JSON.stringify({
        paymentId, receiptId, totalCents: prepaymentTotalCents, rateId: prepaymentQuote.rateId,
        rateCents: prepaymentQuote.rateCents, rateLockedOn: prepaymentQuote.rateLockedOn,
        rentalPeriodIds: prepaymentQuote.periods.map(line => line.rentalPeriodId),
      }),
    })
  }
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
    rentPrepayments: prepaymentId && prepaymentQuote ? [...next.rentPrepayments, {
      id: prepaymentId, paymentId, occupancyCycleId: prepaymentQuote.cycleId, roomId: input.roomId,
      rentalPeriodIds: prepaymentQuote.periods.map(line => line.rentalPeriodId),
      periodCount: prepaymentQuote.periodCount, totalCents: prepaymentTotalCents,
      rateCents: prepaymentQuote.rateCents, rateLockedOn: prepaymentQuote.rateLockedOn,
      createdAt: input.collectedOn, reviewState: 'NONE',
    }] : next.rentPrepayments,
    auditEvents: [...next.auditEvents, ...newAuditEvents],
  }
  return { ok: true, data: next, paymentId, receiptId, totalCents, items, ...(prepaymentId ? { prepaymentId } : {}) }
}

export interface PreparedRentPrepaymentCollection {
  input: CollectionInput
  result: Extract<CollectionResult, { ok: true }>
}

/** Server-compatible adapter for the existing cycle/period-count prepayment API. */
export function prepareRentPrepaymentCollection(
  data: PrototypeAppState,
  input: { cycleId: string; periodCount: number; collectedOn: string },
): { ok: true; prepared: PreparedRentPrepaymentCollection } | { ok: false; reason: string } {
  const quoted = quoteRentPrepayment(data, { cycleId: input.cycleId, periodCount: input.periodCount, asOf: input.collectedOn })
  if (!quoted.ok) return { ok: false, reason: quoted.reason }
  const startSequence = quoted.quote.periods[0]?.sequence
  if (!startSequence) return { ok: false, reason: 'INVALID_AMOUNT' }
  const catalog = rentPrepaymentCatalog(data, quoted.quote.roomId, {
    cycleId: input.cycleId, startSequence, periodCount: input.periodCount,
  }, input.collectedOn)
  if (!catalog.quote || !catalog.quote.payable) return { ok: false, reason: catalog.reason ?? 'RENT_QUOTE_REJECTED' }
  const transactionId = `rent-prepayment-${input.cycleId}-${startSequence}-${input.periodCount}`
  const collectionInput: CollectionInput = {
    transactionId, roomId: quoted.quote.roomId, readings: {}, collectedOn: input.collectedOn,
    rentPrepayment: { cycleId: input.cycleId, startSequence, periodCount: input.periodCount },
    selections: catalog.items.map(({ id, amountCents, periodId, dueDate, basis }) => ({ id, amountCents, periodId, dueDate, basis })),
  }
  const result = prepareCollection(data, collectionInput)
  if (!result.ok) return { ok: false, reason: result.reason }
  return { ok: true, prepared: { input: collectionInput, result } }
}
function nextPrepaymentExists(data: PrototypeAppState, prepaymentId: string): boolean {
  return data.rentPrepayments.some(prepayment => prepayment.id === prepaymentId)
}
