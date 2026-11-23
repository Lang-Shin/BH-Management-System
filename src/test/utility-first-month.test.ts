import { describe, expect, it } from 'vitest'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import { createEmptyData } from '@/data/fixtures/empty'
import { prepareMoveInPayment, selectMoveInObligations } from '@/domain/calculations/move-in'
import { buildRoomPaymentQuote, prepareRoomPayment } from '@/domain/calculations/room-payment'
import { prepareMeterInitialization } from '@/domain/calculations/meter-initialization'
import { pendingElectricityForRoom } from '@/domain/calculations/electricity-pending'
import { selectBillingRooms } from '@/features/billing/billing-room-status'
import { selectSummary } from '@/domain/calculations/summary'
import { ensureRegularRentPeriodsThrough } from '@/domain/calculations/rent-schedule'
import { ensureBillingPeriodsThrough } from '@/domain/calculations/billing-periods'

import type { PrototypeAppState } from '@/domain/types/models'

function julyWorkspace() {
  const data = createEmptyData('2026-07-20')
  data.rooms = data.rooms.map(room => room.id === 'room-2' ? { ...room, washingMachineEnabled: false } : room)
  return data
}

function addJulyTenant(data: PrototypeAppState, input: { name: string; email: string; roomId?: string; moveInDate?: string }) {
  return prototypeReducer(data, {
    type: 'tenant/created', asOf: '2026-07-20',
    draft: {
      name: input.name, email: input.email, phone: '+63 900 555 0700', address: '6 July Street, Demo City',
      roomId: input.roomId ?? 'room-2', moveInDate: input.moveInDate ?? '2026-07-06', notes: '',
    },
  })
}

function payAdvanceAndDeposit(data: PrototypeAppState, roomId = 'room-2', paidOn = '2026-07-06') {
  const view = selectMoveInObligations(data, '2026-07-20', roomId).find(item => item.cycle.status === 'ACTIVE')!
  const paid = prepareMoveInPayment(data, { obligationId: view.obligation.id, categories: ['ADVANCE', 'SECURITY_DEPOSIT'], paidOn })
  if (!paid.ok) throw new Error(paid.reason)
  return paid.data
}

describe('first-month utility billing with an advance-covered rent period', () => {
  it('backfills the January default utility baseline for legacy September-only rate data', () => {
    const legacy = createEmptyData('2026-07-20')
    legacy.electricityRates = legacy.electricityRates.filter(rate => rate.effectiveFrom === '2026-09-01')
    legacy.roomRentRates = legacy.roomRentRates.filter(rate => rate.effectiveFrom === '2026-09-01')
    legacy.waterRates = legacy.waterRates.filter(rate => rate.effectiveFrom === '2026-09-01')
    legacy.washingRates = legacy.washingRates.filter(rate => rate.effectiveFrom === '2026-09-01')
    const data = addJulyTenant(legacy, { name: 'Legacy July', email: 'legacy.july@example.com' })
    expect(data.electricityRates.some(rate => rate.effectiveFrom === '2026-01-01')).toBe(true)
    expect(data.waterRates.some(rate => rate.effectiveFrom === '2026-01-01')).toBe(true)
    expect(data.washingRates.some(rate => rate.effectiveFrom === '2026-01-01')).toBe(true)
    expect(data.roomRentRates.filter(rate => rate.effectiveFrom === '2026-01-01')).toHaveLength(3)
    expect(data.waterRates).toHaveLength(2)
  })

  it('keeps rent PAID while water is independently payable and electricity awaits a reading', () => {
    let data = addJulyTenant(julyWorkspace(), { name: 'Room Two July', email: 'room2.july@example.com' })
    data = payAdvanceAndDeposit(data)
    const period = data.billingPeriods.find(item => item.startDate === '2026-07-01')!
    const room = selectBillingRooms(data, period.id, '2026-07-20', false).find(item => item.context.roomId === 'room-2')!

    expect(room.rent).toMatchObject({
      source: 'ANNIVERSARY', status: 'PAID', billedCents: 350_000, paidCents: 350_000,
      advanceAppliedCents: 350_000, cashPaidCents: 0, outstandingCents: 0,
    })
    expect(room.projectedCharges.filter(charge => charge.category === 'WATER')).toHaveLength(1)
    expect(room.projectedCharges.find(charge => charge.category === 'WATER')?.amountCents).toBe(10_000)
    expect(room.projectedCharges.some(charge => charge.category === 'WASHING_MACHINE')).toBe(false)
    expect(room.unresolved).toBe(1)
    expect(room.outstanding).toBe(10_000)
    expect(room.billingStatus).toBe('PARTLY PAID')
    expect(pendingElectricityForRoom(data, 'room-2', period, '2026-07-20')).toMatchObject({
      baseline: null, obligation: { state: 'AWAITING_READING', roomId: 'room-2', billingPeriodId: period.id },
    })

    const rentQuote = buildRoomPaymentQuote(data, {
      roomId: 'room-2', periodId: period.id, selected: ['RENT'],
      electricityReadingMilliKwh: null, asOf: '2026-07-20',
    })
    expect(rentQuote.options.find(option => option.category === 'RENT')).toMatchObject({ state: 'PAID', amountCents: 0 })
    expect(rentQuote.options.find(option => option.category === 'WATER')).toMatchObject({ state: 'SELECTABLE', amountCents: 10_000 })
    expect(rentQuote.options.find(option => option.category === 'ELECTRICITY')).toMatchObject({
      state: 'AWAITING_READING', amountCents: null, detail: 'Initial meter reading required',
    })
    expect(rentQuote.options.find(option => option.category === 'WASHING_MACHINE')?.state).toBe('UNAVAILABLE')

    const deposit = data.charges.find(charge => charge.category === 'SECURITY_DEPOSIT')!
    expect(data.charges.find(charge => charge.category === 'ADVANCE')).toMatchObject({ amountCents: 350_000 })
    expect(deposit).toMatchObject({ amountCents: 350_000 })
    expect(data.advanceApplications).toHaveLength(1)
    expect(data.payments).toHaveLength(1)
    expect(data.payments[0]!.amountCents).toBe(700_000)

    const nextMonth = ensureRegularRentPeriodsThrough(ensureBillingPeriodsThrough(data, '2026-08-06'), '2026-08-06')
    const august = nextMonth.billingPeriods.find(item => item.startDate === '2026-08-01')!
    const augustRoom = selectBillingRooms(nextMonth, august.id, '2026-08-06', false).find(item => item.context.roomId === 'room-2')!
    expect(augustRoom.rent).toMatchObject({ billedCents: 350_000, paidCents: 0, outstandingCents: 350_000, status: 'UNPAID' })
    expect(augustRoom.projectedCharges.filter(charge => charge.category === 'WATER')).toHaveLength(1)
    expect(nextMonth.rentalPeriods.filter(period => period.roomId === 'room-2' && period.dueDate === '2026-08-06')).toHaveLength(1)
  })

  it('settles water then electricity at the approved rate without duplicate charges', () => {
    let data = addJulyTenant(julyWorkspace(), { name: 'Room Two July', email: 'room2.july@example.com' })
    data = payAdvanceAndDeposit(data)
    const period = data.billingPeriods.find(item => item.startDate === '2026-07-01')!
    const cashBeforeUtilities = selectSummary(data, '2026-07-20', period.id).received

    const initialized = prepareMeterInitialization(data, {
      roomId: 'room-2', readingMilliKwh: 100_000, readOn: '2026-07-06',
      sourceNote: 'Verified move-in reading', initializedOn: '2026-07-06',
    })
    expect(initialized.ok).toBe(true)
    if (!initialized.ok) return
    const electricityQuote = buildRoomPaymentQuote(initialized.data, {
      roomId: 'room-2', periodId: period.id, selected: ['ELECTRICITY'],
      electricityReadingMilliKwh: 150_000, asOf: '2026-07-20',
    })
    expect(electricityQuote.electricity).toMatchObject({
      previousReadingMilliKwh: 100_000, consumptionMilliKwh: 50_000, amountCents: 65_000, rateCentsPerKwh: 1_300,
    })
    expect(electricityQuote.totalCents).toBe(65_000)

    const paid = prepareRoomPayment(initialized.data, {
      roomId: 'room-2', periodId: period.id, selected: ['WATER', 'ELECTRICITY'],
      electricityReadingMilliKwh: 150_000, asOf: '2026-07-20',
    })
    expect(paid.ok).toBe(true)
    if (!paid.ok) return
    data = paid.data
    expect(paid.totalCents).toBe(75_000)
    expect(data.charges.filter(charge => charge.category === 'WATER')).toHaveLength(1)
    expect(data.charges.filter(charge => charge.category === 'ELECTRICITY')).toHaveLength(1)
    expect(data.charges.filter(charge => charge.category === 'WASHING_MACHINE')).toHaveLength(0)

    const room = selectBillingRooms(data, period.id, '2026-07-20', false).find(item => item.context.roomId === 'room-2')!
    expect(room.rent.status).toBe('PAID')
    expect(room.outstanding).toBe(0)
    expect(room.unresolved).toBe(0)
    expect(room.billingStatus).toBe('PAID')
    expect(room.charges.find(charge => charge.category === 'WATER')).toMatchObject({ amountCents: 10_000 })
    expect(room.charges.find(charge => charge.category === 'ELECTRICITY')).toMatchObject({ amountCents: 65_000 })
    expect(selectSummary(data, '2026-07-20', period.id).received).toBe(cashBeforeUtilities + 75_000)

    const duplicate = prepareRoomPayment(data, {
      roomId: 'room-2', periodId: period.id, selected: ['WATER', 'ELECTRICITY'],
      electricityReadingMilliKwh: 150_000, asOf: '2026-07-20',
    })
    expect(duplicate).toEqual({ ok: false, reason: 'NO_SELECTION' })
  })

  it('bills washing only when the room has the service enabled', () => {
    const workspace = julyWorkspace()
    workspace.rooms = workspace.rooms.map(room => room.id === 'room-2' ? { ...room, washingMachineEnabled: true } : room)
    let data = addJulyTenant(workspace, { name: 'Room Two Washing', email: 'room2.washing@example.com' })
    data = payAdvanceAndDeposit(data)
    const period = data.billingPeriods.find(item => item.startDate === '2026-07-01')!
    const room = selectBillingRooms(data, period.id, '2026-07-20', false).find(item => item.context.roomId === 'room-2')!
    expect(room.projectedCharges.filter(charge => charge.category === 'WASHING_MACHINE')).toHaveLength(1)
    expect(room.projectedCharges.find(charge => charge.category === 'WASHING_MACHINE')?.amountCents).toBe(10_000)
    expect(room.outstanding).toBe(20_000)
    const quote = buildRoomPaymentQuote(data, {
      roomId: 'room-2', periodId: period.id, selected: ['WASHING_MACHINE'],
      electricityReadingMilliKwh: null, asOf: '2026-07-20',
    })
    expect(quote.options.find(option => option.category === 'WASHING_MACHINE')).toMatchObject({ state: 'SELECTABLE', amountCents: 10_000 })
    const paid = prepareRoomPayment(data, {
      roomId: 'room-2', periodId: period.id, selected: ['WASHING_MACHINE'],
      electricityReadingMilliKwh: null, asOf: '2026-07-20',
    })
    expect(paid.ok).toBe(true)
    if (!paid.ok) return
    expect(paid.data.charges.filter(charge => charge.category === 'WASHING_MACHINE')).toHaveLength(1)
    const after = selectBillingRooms(paid.data, period.id, '2026-07-20', false).find(item => item.context.roomId === 'room-2')!
    expect(after.charges.find(charge => charge.category === 'WASHING_MACHINE')).toMatchObject({ amountCents: 10_000 })
    expect(after.outstanding).toBe(10_000)
  })

  it('bills shared-room water per eligible tenant without duplicate rent or washing charges', () => {
    let data = addJulyTenant(julyWorkspace(), { name: 'Shared July One', email: 'shared1.july@example.com' })
    data = addJulyTenant(data, { name: 'Shared July Two', email: 'shared2.july@example.com' })
    data = payAdvanceAndDeposit(data)
    const period = data.billingPeriods.find(item => item.startDate === '2026-07-01')!
    const room = selectBillingRooms(data, period.id, '2026-07-20', false).find(item => item.context.roomId === 'room-2')!
    expect(room.rent).toMatchObject({ billedCents: 350_000, outstandingCents: 0, status: 'PAID' })
    expect(room.projectedCharges.filter(charge => charge.category === 'WATER')).toHaveLength(2)
    expect(room.projectedCharges.filter(charge => charge.category === 'WATER').reduce((sum, charge) => sum + charge.amountCents, 0)).toBe(20_000)
    expect(room.projectedCharges.some(charge => charge.category === 'WASHING_MACHINE')).toBe(false)
    expect(room.outstanding).toBe(20_000)
    expect(room.billingStatus).toBe('PARTLY PAID')

    const quote = buildRoomPaymentQuote(data, {
      roomId: 'room-2', periodId: period.id, selected: ['WATER'],
      electricityReadingMilliKwh: null, asOf: '2026-07-20',
    })
    expect(quote.options.find(option => option.category === 'WATER')).toMatchObject({ state: 'SELECTABLE', amountCents: 20_000 })
    expect(quote.totalCents).toBe(20_000)
  })
})
