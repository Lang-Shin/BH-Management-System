import { describe, expect, it } from 'vitest'
import { createDemoData, DEMO_DATE, DEMO_PERIOD } from '@/data/fixtures/demo'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import { prepareMoveInPayment, selectMoveInObligations } from '@/domain/calculations/move-in'
import { buildRoomPaymentQuote, prepareRoomPayment } from '@/domain/calculations/room-payment'
import { prepareMeterInitialization } from '@/domain/calculations/meter-initialization'
import { selectBillingRent } from '@/domain/calculations/billing-rent'
import { selectBillingRooms } from '@/features/billing/billing-room-status'
import { formatShortDateRange } from '@/lib/format'
import type { PrototypeAppState } from '@/domain/types/models'
import type { TenantDraft } from '@/domain/calculations/tenant-management'

function draft(overrides: Partial<TenantDraft> = {}): TenantDraft {
  return {
    name: 'Bills Rent Tenant', email: 'bills-rent@example.com', phone: '+63 900 555 0155',
    address: '7 Bills Street, Demo City', roomId: 'room-14', moveInDate: DEMO_DATE, notes: '', ...overrides,
  }
}

function createTenant(data: PrototypeAppState, overrides: Partial<TenantDraft> = {}) {
  const next = prototypeReducer(data, { type: 'tenant/created', draft: draft(overrides), asOf: DEMO_DATE })
  const tenant = next.tenants.find(item => item.email === (overrides.email ?? draft().email))!
  return { data: next, tenant }
}

function payMoveIn(data: PrototypeAppState, roomId: string, categories: ('ADVANCE' | 'SECURITY_DEPOSIT')[], paidOn = DEMO_DATE) {
  const views = selectMoveInObligations(data, DEMO_DATE, roomId)
  const view = views.find(item => item.cycle.status === 'ACTIVE') ?? views[0]!
  const paid = prepareMoveInPayment(data, { obligationId: view.obligation.id, categories, paidOn })
  if (!paid.ok) throw new Error(paid.reason)
  return paid.data
}

describe('Bills anniversary rent synchronization', () => {
  it('marks first-period rent PAID from the advance and classifies paid rent plus unpaid utilities as PARTLY PAID', () => {
    const created = createTenant(createDemoData())
    const data = payMoveIn(created.data, 'room-14', ['ADVANCE', 'SECURITY_DEPOSIT'])
    const room = selectBillingRooms(data, DEMO_PERIOD, DEMO_DATE, false).find(item => item.context.roomId === 'room-14')!
    expect(room.rent).toMatchObject({
      source: 'ANNIVERSARY', status: 'PAID', billedCents: 400_000, paidCents: 400_000,
      outstandingCents: 0, advanceAppliedCents: 400_000, cashPaidCents: 0,
    })
    expect(room.rent.periods).toHaveLength(1)
    expect(room.rent.periods[0]).toMatchObject({
      startDate: DEMO_DATE, endDateExclusive: '2026-12-13', dueDate: DEMO_DATE,
    })
    expect(room.paymentStatus).toBe('PARTLY_PAID')
    expect(room.billingStatus).toBe('PARTLY PAID')
    expect(room.outstanding).toBe(10_000)
    expect(room.charges.find(charge => charge.category === 'WATER')).toBeUndefined()
    expect(room.projectedCharges.find(charge => charge.category === 'WATER')?.amountCents).toBe(10_000)
  })

  it('does not let a security deposit settle rent', () => {
    const created = createTenant(createDemoData(), {
      name: 'Deposit Only Tenant', email: 'deposit-only@example.com', roomId: 'room-15', moveInDate: DEMO_DATE,
    })
    const data = payMoveIn(created.data, 'room-15', ['SECURITY_DEPOSIT'])
    const room = selectBillingRooms(data, DEMO_PERIOD, DEMO_DATE, false).find(item => item.context.roomId === 'room-15')!
    expect(room.rent).toMatchObject({
      source: 'ANNIVERSARY', status: 'UNPAID', billedCents: 500_000, paidCents: 0, outstandingCents: 500_000,
    })
    expect(room.paymentStatus).toBe('NOT_YET_PAID')
    expect(data.advanceApplications).toHaveLength(0)
  })

  it('marks a room PAID only when rent and applicable utilities are settled', () => {
    const created = createTenant(createDemoData())
    let data = payMoveIn(created.data, 'room-14', ['ADVANCE', 'SECURITY_DEPOSIT'])
    const before = selectBillingRooms(data, DEMO_PERIOD, DEMO_DATE, false).find(item => item.context.roomId === 'room-14')!
    expect(before.billingStatus).toBe('PARTLY PAID')

    const water = prepareRoomPayment(data, {
      roomId: 'room-14', periodId: DEMO_PERIOD, selected: ['WATER'], electricityReadingMilliKwh: null, asOf: DEMO_DATE,
    })
    expect(water.ok).toBe(true)
    if (!water.ok) return
    data = water.data
    const awaiting = selectBillingRooms(data, DEMO_PERIOD, DEMO_DATE, false).find(item => item.context.roomId === 'room-14')!
    expect(awaiting.rent.status).toBe('PAID')
    expect(awaiting.outstanding).toBe(0)
    expect(awaiting.unresolved).toBe(1)
    expect(awaiting.billingStatus).toBe('PARTLY PAID')

    const meter = prepareMeterInitialization(data, {
      roomId: 'room-14', readingMilliKwh: 0, readOn: DEMO_DATE,
      sourceNote: 'Verified starting reading', initializedOn: DEMO_DATE,
    })
    expect(meter.ok).toBe(true)
    if (!meter.ok) return
    const electricity = prepareRoomPayment(meter.data, {
      roomId: 'room-14', periodId: DEMO_PERIOD, selected: ['ELECTRICITY'],
      electricityReadingMilliKwh: 500_000, asOf: DEMO_DATE,
    })
    expect(electricity.ok).toBe(true)
    if (!electricity.ok) return
    const room = selectBillingRooms(electricity.data, DEMO_PERIOD, DEMO_DATE, false).find(item => item.context.roomId === 'room-14')!
    expect(room.rent.status).toBe('PAID')
    expect(room.outstanding).toBe(0)
    expect(room.unresolved).toBe(0)
    expect(room.billingStatus).toBe('PAID')
  })

  it('prevents collecting anniversary rent again through the room payment calculator', () => {
    const created = createTenant(createDemoData())
    const data = payMoveIn(created.data, 'room-14', ['ADVANCE', 'SECURITY_DEPOSIT'])
    const quote = buildRoomPaymentQuote(data, {
      roomId: 'room-14', periodId: DEMO_PERIOD, selected: ['RENT'], electricityReadingMilliKwh: null, asOf: DEMO_DATE,
    })
    expect(quote.options.find(option => option.category === 'RENT')).toMatchObject({ state: 'PAID', amountCents: 0, chargeIds: [] })
    expect(quote.selected).toEqual([])

    const duplicate = prepareRoomPayment(data, {
      roomId: 'room-14', periodId: DEMO_PERIOD, selected: ['RENT'], electricityReadingMilliKwh: null, asOf: DEMO_DATE,
    })
    expect(duplicate).toEqual({ ok: false, reason: 'NO_SELECTION' })
  })

  it('keeps shared-room rent at one room obligation and one anniversary period', () => {
    const first = createTenant(createDemoData())
    const second = createTenant(first.data, {
      name: 'Second Bills Occupant', email: 'second-bills@example.com', roomId: 'room-14', moveInDate: '2026-11-20',
    })
    const rooms = selectBillingRooms(second.data, DEMO_PERIOD, DEMO_DATE, false)
    const room = rooms.find(item => item.context.roomId === 'room-14')!
    expect(room.rent.billedCents).toBe(400_000)
    expect(room.rent.periods).toHaveLength(1)
    expect(second.data.moveInObligations.filter(item => item.roomId === 'room-14')).toHaveLength(1)
    expect(second.data.rentObligations.filter(item => item.roomId === 'room-14')).toHaveLength(1)
  })

  it('associates anniversary rent with the selected utility period by due date', () => {
    const created = createTenant(createDemoData())
    const data = payMoveIn(created.data, 'room-14', ['ADVANCE', 'SECURITY_DEPOSIT'])
    const november = data.billingPeriods.find(period => period.id === DEMO_PERIOD)!
    const october = data.billingPeriods.find(period => period.id === 'period-oct')!
    expect(selectBillingRent(data, 'room-14', november, DEMO_DATE)).toMatchObject({
      source: 'ANNIVERSARY', selection: 'DUE_IN_CALENDAR_PERIOD', status: 'PAID',
    })
    expect(selectBillingRent(data, 'room-14', october, DEMO_DATE)).toMatchObject({
      source: 'NONE', selection: 'NONE', status: 'NO_BILL',
    })
  })

  it('aggregates multiple anniversary periods due in the same selected month', () => {
    const first = createTenant(createDemoData(), {
      name: 'First Bills Cycle', email: 'first-bills-cycle@example.com', moveInDate: '2026-11-01',
    })
    let data = payMoveIn(first.data, 'room-14', ['ADVANCE'], '2026-11-01')
    data = prototypeReducer(data, { type: 'tenant/movedOut', tenantId: first.tenant.id, asOf: '2026-11-03' })
    const second = createTenant(data, {
      name: 'Second Bills Cycle', email: 'second-bills-cycle@example.com', moveInDate: '2026-11-04',
    })
    data = payMoveIn(second.data, 'room-14', ['ADVANCE'], '2026-11-04')
    const november = data.billingPeriods.find(period => period.id === DEMO_PERIOD)!
    const rent = selectBillingRent(data, 'room-14', november, DEMO_DATE)
    expect(rent.source).toBe('ANNIVERSARY')
    expect(rent.periods).toHaveLength(2)
    expect(rent.periods.map(period => period.startDate)).toEqual(['2026-11-01', '2026-11-04'])
    expect(rent.billedCents).toBe(800_000)
    expect(rent.paidCents).toBe(800_000)
    expect(rent.outstandingCents).toBe(0)
    expect(rent.status).toBe('PAID')
  })

  it('formats short anniversary ranges without visible years, including cross-year periods', () => {
    expect(formatShortDateRange('2026-11-13', '2026-12-13')).toBe('Nov 13 – Dec 12')
    expect(formatShortDateRange('2026-12-13', '2027-01-13')).toBe('Dec 13 – Jan 12')
    expect(formatShortDateRange('2026-11-13', '2026-12-13')).not.toMatch(/2026|2027/)
  })
})
