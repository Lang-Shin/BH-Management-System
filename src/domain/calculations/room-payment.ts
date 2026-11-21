import type { Charge, ChargeCategory, MeterReading, Payment, PrototypeAppState, Receipt } from '@/domain/types/models'
import { chargeBalance, issuedCharges, unresolvedElectricity } from './summary'
import { chargeRoom, roomContext } from './room-finance'
import { calculateElectricityCharge, latestSettledReading, type ElectricityCharge } from './electricity-calculation'
import { activeElectricityRate } from './billing-rates'
import { proposedRoomCharges } from './billing-eligibility'

export const roomPaymentCategories: ChargeCategory[] = ['RENT', 'ELECTRICITY', 'WATER', 'WASHING_MACHINE']

export type RoomPaymentOptionState = 'SELECTABLE' | 'PAID' | 'UNAVAILABLE' | 'AWAITING_READING' | 'INVALID_READING'

export interface RoomPaymentOption {
  category: ChargeCategory
  state: RoomPaymentOptionState
  amountCents: number | null
  chargeIds: string[]
  detail: string
  obligationId?: string
  /** Missing period charges created only when this category is confirmed. */
  proposedCharges?: Charge[]
}

export interface RoomElectricityQuote {
  previousReadingMilliKwh: number
  previousReadOn: string
  rateCentsPerKwh: number
  currentReadingMilliKwh?: number
  consumptionMilliKwh?: number
  amountCents?: number
  error?: string
  charge?: ElectricityCharge
  currentReading?: MeterReading
}

export interface RoomPaymentQuote {
  roomId: string
  roomLabel: string
  periodId: string
  periodLabel: string
  options: RoomPaymentOption[]
  selected: ChargeCategory[]
  totalCents: number
  pendingElectricity: boolean
  canConfirm: boolean
  electricity?: RoomElectricityQuote
}

export interface RoomPaymentInput {
  roomId: string
  periodId: string
  selected: ChargeCategory[]
  electricityReadingMilliKwh: number | null
  asOf: string
}

function categoryCharges(data: PrototypeAppState, roomId: string, periodId: string, asOf: string, category: ChargeCategory): Charge[] {
  return issuedCharges(data, asOf, periodId)
    .filter(charge => charge.category === category && chargeRoom(data, charge).roomId === roomId)
}

function finalizedOption(category: ChargeCategory, charges: Charge[], data: PrototypeAppState, asOf: string, proposedCharges: Charge[] = []): RoomPaymentOption {
  const proposedTotal = proposedCharges.reduce((sum, charge) => sum + charge.amountCents, 0)
  if (charges.length === 0 && proposedCharges.length === 0) return { category, state: 'UNAVAILABLE', amountCents: null, chargeIds: [], detail: category === 'WASHING_MACHINE' ? 'Did not avail' : 'No bill' }
  const unpaid = charges.filter(charge => chargeBalance(data, charge, asOf) > 0)
  const unpaidTotal = unpaid.reduce((sum, charge) => sum + chargeBalance(data, charge, asOf), 0)
  if (unpaid.length === 0 && proposedCharges.length === 0) return { category, state: 'PAID', amountCents: 0, chargeIds: [], detail: 'Paid' }
  return {
    category, state: 'SELECTABLE', amountCents: unpaidTotal + proposedTotal,
    chargeIds: unpaid.map(charge => charge.id), detail: proposedCharges.length > 0 ? 'Newly applicable' : 'Unpaid',
    proposedCharges: proposedCharges.length > 0 ? proposedCharges : undefined,
  }
}

export function buildRoomPaymentQuote(data: PrototypeAppState, input: RoomPaymentInput): RoomPaymentQuote {
  const period = data.billingPeriods.find(item => item.id === input.periodId)
  const room = data.rooms.find(item => item.id === input.roomId)
  const context = room ? roomContext(data, room.id, 'period-assignment', 'Selected room') : null
  const proposed = room && period ? proposedRoomCharges(data, room, period, input.asOf) : []
  const options: RoomPaymentOption[] = []
  let electricity: RoomElectricityQuote | undefined

  for (const category of roomPaymentCategories) {
    if (category !== 'ELECTRICITY') {
      options.push(finalizedOption(category, categoryCharges(data, input.roomId, input.periodId, input.asOf, category), data, input.asOf, proposed.filter(charge => charge.category === category)))
      continue
    }
    const obligation = unresolvedElectricity(data, input.asOf, input.periodId, input.roomId)[0]
    if (!obligation) {
      options.push(finalizedOption(category, categoryCharges(data, input.roomId, input.periodId, input.asOf, category), data, input.asOf, proposed.filter(charge => charge.category === category)))
      continue
    }
    const previous = latestSettledReading(data, obligation.meterId)
    const rate = activeElectricityRate(data, input.asOf)
    if (!previous || !rate) {
      options.push({ category, state: 'INVALID_READING', amountCents: null, chargeIds: [], detail: 'Meter baseline unavailable', obligationId: obligation.id })
      continue
    }
    electricity = {
      previousReadingMilliKwh: previous.readingMilliKwh,
      previousReadOn: previous.readOn,
      rateCentsPerKwh: rate.rateCentsPerKwh,
    }
    if (input.electricityReadingMilliKwh === null) {
      options.push({ category, state: 'AWAITING_READING', amountCents: null, chargeIds: [], detail: 'Amount pending calculation', obligationId: obligation.id })
      continue
    }
    const calculation = calculateElectricityCharge(data, obligation.id, { readingMilliKwh: input.electricityReadingMilliKwh, readOn: input.asOf })
    if (!calculation.ok) {
      electricity.error = calculation.reason
      options.push({ category, state: 'INVALID_READING', amountCents: null, chargeIds: [], detail: 'Current reading cannot be used', obligationId: obligation.id })
      continue
    }
    electricity = {
      ...electricity,
      currentReadingMilliKwh: calculation.charge.electricity.currentReadingMilliKwh,
      consumptionMilliKwh: calculation.charge.electricity.consumptionMilliKwh,
      amountCents: calculation.charge.amountCents,
      charge: calculation.charge,
      currentReading: calculation.currentReading,
    }
    options.push({ category, state: 'SELECTABLE', amountCents: calculation.charge.amountCents, chargeIds: [], detail: 'Calculated from current reading', obligationId: obligation.id })
  }

  const optionMap = new Map(options.map(option => [option.category, option]))
  const selected = input.selected.filter(category => ['SELECTABLE', 'AWAITING_READING', 'INVALID_READING'].includes(optionMap.get(category)?.state ?? ''))
  const totalCents = selected.reduce((sum, category) => sum + (optionMap.get(category)?.amountCents ?? 0), 0)
  const pendingElectricity = selected.includes('ELECTRICITY') && optionMap.get('ELECTRICITY')?.amountCents == null
  const canConfirm = selected.length > 0 && !pendingElectricity && selected.every(category => optionMap.get(category)?.amountCents != null)
  return {
    roomId: input.roomId, roomLabel: context?.label ?? 'Selected room', periodId: input.periodId,
    periodLabel: period?.label ?? input.periodId, options, selected, totalCents,
    pendingElectricity, canConfirm, electricity,
  }
}

function nextReceiptNumbers(data: PrototypeAppState, count: number): string[] {
  const used = new Set(data.receipts.map(receipt => receipt.receiptNumber))
  const numbers: string[] = []
  let sequence = data.receipts.reduce((max, receipt) => {
    const match = /^DEMO-RCT-(\d+)$/.exec(receipt.receiptNumber)
    return match ? Math.max(max, Number(match[1])) : max
  }, 0) + 1
  while (numbers.length < count) {
    const number = `DEMO-RCT-${String(sequence).padStart(3, '0')}`
    if (!used.has(number)) numbers.push(number)
    sequence += 1
  }
  return numbers
}

function stableDigest(value: string): string {
  let hash = 2_166_136_261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return (hash >>> 0).toString(36)
}

export type RoomPaymentError = 'NO_SELECTION' | 'ELECTRICITY_READING_REQUIRED' | 'STALE_SELECTION' | 'DUPLICATE_PAYMENT' | 'INVALID_TOTAL'

export type RoomPaymentResult =
  | { ok: true; data: PrototypeAppState; quote: RoomPaymentQuote; payments: Payment[]; receipts: Receipt[]; totalCents: number }
  | { ok: false; reason: RoomPaymentError }

/**
 * Builds all tenant-owned payments, allocations, receipts, and an optional
 * electricity reading/charge as one immutable room-payment batch.
 */
export function prepareRoomPayment(data: PrototypeAppState, input: RoomPaymentInput): RoomPaymentResult {
  const quote = buildRoomPaymentQuote(data, input)
  if (quote.selected.length === 0) return { ok: false, reason: 'NO_SELECTION' }
  if (!quote.canConfirm) return { ok: false, reason: quote.pendingElectricity || quote.options.some(option => option.state === 'INVALID_READING') ? 'ELECTRICITY_READING_REQUIRED' : 'STALE_SELECTION' }

  const lines: { charge: Charge; amountCents: number }[] = []
  for (const category of quote.selected) {
    const option = quote.options.find(item => item.category === category)!
    if (category === 'ELECTRICITY' && option.obligationId) {
      if (!quote.electricity?.charge || quote.electricity.amountCents == null) return { ok: false, reason: 'ELECTRICITY_READING_REQUIRED' }
      lines.push({ charge: quote.electricity.charge, amountCents: quote.electricity.amountCents })
      continue
    }
    for (const chargeId of option.chargeIds) {
      const charge = data.charges.find(item => item.id === chargeId)
      if (!charge || charge.state !== 'ISSUED') continue
      const balance = chargeBalance(data, charge, input.asOf)
      if (balance > 0) lines.push({ charge, amountCents: balance })
    }
    for (const charge of option.proposedCharges ?? []) {
      if (data.charges.some(item => item.id === charge.id) || lines.some(line => line.charge.id === charge.id)) return { ok: false, reason: 'STALE_SELECTION' }
      lines.push({ charge, amountCents: charge.amountCents })
    }
  }
  if (lines.length === 0) return { ok: false, reason: 'STALE_SELECTION' }
  const totalCents = lines.reduce((sum, line) => sum + line.amountCents, 0)
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) return { ok: false, reason: 'INVALID_TOTAL' }

  const batches = new Map<string, { charge: Charge; amountCents: number }[]>()
  for (const line of lines) {
    const items = batches.get(line.charge.tenantId) ?? []
    items.push(line)
    batches.set(line.charge.tenantId, items)
  }
  const chargeIds = lines.map(line => line.charge.id).sort()
  const interval = quote.electricity?.charge?.electricity.intervalId ?? ''
  const digest = stableDigest(`${input.roomId}:${input.periodId}:${chargeIds.join('|')}:${interval}`)
  const receiptNumbers = nextReceiptNumbers(data, batches.size)
  const payments: Payment[] = []
  const receipts: Receipt[] = []
  const allocations = lines.map(line => {
    const paymentId = `payment-room-${digest}-${line.charge.tenantId}`
    return {
      id: `allocation-${paymentId}-${line.charge.id}`, paymentId, chargeId: line.charge.id, amountCents: line.amountCents,
      allocatedOn: input.asOf, creditId: null, state: 'ACTIVE' as const, reversalAuditEventId: null,
    }
  })
  let receiptIndex = 0
  for (const [tenantId, tenantLines] of batches) {
    const paymentId = `payment-room-${digest}-${tenantId}`
    if (data.payments.some(payment => payment.id === paymentId)) return { ok: false, reason: 'DUPLICATE_PAYMENT' }
    const amountCents = tenantLines.reduce((sum, line) => sum + line.amountCents, 0)
    const payment: Payment = { id: paymentId, tenantId, amountCents, paidOn: input.asOf, method: 'cash', state: 'RECORDED', correction: null }
    const receipt: Receipt = {
      id: `receipt-${paymentId}`, paymentId, receiptNumber: receiptNumbers[receiptIndex++]!, issuedOn: input.asOf,
      amountCents, allocationIds: allocations.filter(allocation => allocation.paymentId === paymentId).map(allocation => allocation.id), state: 'ISSUED', revision: 1, supersedesReceiptId: null,
    }
    payments.push(payment)
    receipts.push(receipt)
  }

  const extraCharges: Charge[] = [
    ...(quote.electricity?.charge ? [quote.electricity.charge] : []),
    ...quote.selected.flatMap(category => quote.options.find(option => option.category === category)?.proposedCharges ?? []),
  ]
  const extraReadings: MeterReading[] = quote.electricity?.currentReading ? [quote.electricity.currentReading] : []
  const next: PrototypeAppState = {
    ...data,
    meterReadings: [...data.meterReadings, ...extraReadings],
    charges: [...data.charges, ...extraCharges],
    payments: [...data.payments, ...payments],
    paymentAllocations: [...data.paymentAllocations, ...allocations],
    receipts: [...data.receipts, ...receipts],
    electricityBillObligations: quote.electricity?.charge
      ? data.electricityBillObligations.filter(obligation => obligation.id !== quote.options.find(option => option.category === 'ELECTRICITY')?.obligationId)
      : data.electricityBillObligations,
    auditEvents: [...data.auditEvents, ...payments.map(payment => ({
      id: `audit-room-${payment.id}`, actorId: 'demo-admin', occurredOn: input.asOf, action: 'ROOM_PAYMENT_RECORDED' as const,
      entityType: 'PAYMENT' as const, entityId: payment.id,
      reason: `Room payment recorded for ${tenantIdToName(data, payment.tenantId)} (${payment.amountCents} centavos).`,
      beforeSnapshot: JSON.stringify({ roomId: input.roomId, periodId: input.periodId, selected: quote.selected }),
      afterSnapshot: JSON.stringify({ paymentId: payment.id, chargeIds: allocations.filter(allocation => allocation.paymentId === payment.id).map(allocation => allocation.chargeId), amountCents: payment.amountCents }),
    }))],
  }
  return { ok: true, data: next, quote, payments, receipts, totalCents }
}

function tenantIdToName(data: PrototypeAppState, tenantId: string) {
  return data.tenants.find(tenant => tenant.id === tenantId)?.name ?? 'Unknown tenant'
}
