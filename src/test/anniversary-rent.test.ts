import { describe, expect, it } from 'vitest'
import { createDemoData } from '@/data/fixtures/demo'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import { prepareMoveInPayment, selectMoveInObligations } from '@/domain/calculations/move-in'
import { prepareRentPrepayment, quoteRentPrepayment } from '@/domain/calculations/rent-schedule'
import {
  addMonthsClamped, rentDueDate, rentObligationPaidCents, rentalPeriodBounds, rentalPeriodsForCycle,
} from '@/domain/calculations/rental-periods'
import { selectRentCycleReport } from '@/domain/calculations/rent-reporting'
import { isPrototypeData } from '@/domain/validation/prototype-data'
import type { PrototypeAppState } from '@/domain/types/models'
import type { TenantDraft } from '@/domain/calculations/tenant-management'

function draft(overrides: Partial<TenantDraft> = {}): TenantDraft {
  return {
    name: 'Anniversary Tenant', email: 'anniversary@example.com', phone: '+63 900 555 0177',
    address: '7 Test Street, Demo City', roomId: 'room-14', moveInDate: '2026-11-13', notes: '', ...overrides,
  }
}

function createTenant(data: PrototypeAppState, overrides: Partial<TenantDraft> = {}, asOf = '2026-11-13') {
  const next = prototypeReducer(data, { type: 'tenant/created', draft: draft(overrides), asOf })
  const tenant = next.tenants.find(item => !data.tenants.some(existing => existing.id === item.id))
  if (!tenant) throw new Error('Tenant was not created')
  const cycle = next.occupancyCycles.find(item => item.roomId === (overrides.roomId ?? 'room-14') && item.status === 'ACTIVE')!
  return { data: next, tenant, cycle }
}

function paidThroughFirstPeriod(data: PrototypeAppState, roomId = 'room-14') {
  const view = selectMoveInObligations(data, '2026-11-13', roomId)[0]!
  const paid = prepareMoveInPayment(data, {
    obligationId: view.obligation.id, categories: ['ADVANCE', 'SECURITY_DEPOSIT'], paidOn: '2026-11-13',
  })
  if (!paid.ok) throw new Error(paid.reason)
  return { data: paid.data, view: selectMoveInObligations(paid.data, '2026-11-13', roomId)[0]! }
}

describe('anniversary rent periods', () => {
  it('clamps short months from the original anchor without drift', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonthsClamped('2026-01-31', 2)).toBe('2026-03-31')
    expect(addMonthsClamped('2026-01-31', 3)).toBe('2026-04-30')
    expect(addMonthsClamped('2026-01-30', 1)).toBe('2026-02-28')
    expect(addMonthsClamped('2026-01-30', 2)).toBe('2026-03-30')
    expect(addMonthsClamped('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonthsClamped('2028-01-31', 2)).toBe('2028-03-31')
    expect(addMonthsClamped('2026-12-31', 1)).toBe('2027-01-31')
    expect(rentalPeriodBounds('2026-01-31', 1)).toEqual({ startDate: '2026-01-31', endDateExclusive: '2026-02-28' })
    expect(rentDueDate('2026-01-31')).toBe('2026-01-31')
    expect(rentDueDate(rentalPeriodBounds('2026-01-31', 2).startDate)).toBe('2026-02-28')
    expect(rentDueDate(rentalPeriodBounds('2026-01-31', 3).startDate)).toBe('2026-03-31')
    expect(rentDueDate(rentalPeriodBounds('2028-01-31', 2).startDate)).toBe('2028-02-29')
    expect(rentDueDate(rentalPeriodBounds('2026-12-31', 2).startDate)).toBe('2027-01-31')
  })

  it('establishes one anchor for a new cycle and does not reset it for a roommate', () => {
    const first = createTenant(createDemoData())
    expect(first.cycle).toMatchObject({
      rentSchedule: 'ANNIVERSARY', rentAnchorDate: '2026-11-13', rentAnchorDay: 13, cycleOrigin: 'NEW_MOVE_IN',
    })
    const periods = rentalPeriodsForCycle(first.data, first.cycle.id)
    expect(periods).toHaveLength(1)
    expect(periods[0]).toMatchObject({
      sequence: 1, startDate: '2026-11-13', endDateExclusive: '2026-12-13', dueDate: '2026-11-13',
    })
    expect(first.data.rentObligations.find(item => item.rentalPeriodId === periods[0]!.id)?.dueDate).toBe('2026-11-13')

    const second = createTenant(first.data, {
      name: 'Anniversary Roommate', email: 'anniversary.roommate@example.com', moveInDate: '2026-11-20',
    }, '2026-11-20')
    expect(second.cycle.id).toBe(first.cycle.id)
    expect(second.cycle.rentAnchorDate).toBe('2026-11-13')
    expect(second.data.moveInObligations.filter(item => item.roomId === 'room-14')).toHaveLength(1)
    expect(second.data.rentalPeriods.filter(item => item.occupancyCycleId === first.cycle.id)).toHaveLength(1)
  })

  it('keeps the anchor when the first occupant leaves and starts a new anchor only after full vacancy', () => {
    const first = createTenant(createDemoData())
    const second = createTenant(first.data, {
      name: 'Remaining Occupant', email: 'remaining@example.com', moveInDate: '2026-11-20',
    }, '2026-11-20')
    const firstOut = prototypeReducer(paidThroughFirstPeriod(second.data).data, {
      type: 'tenant/movedOut', tenantId: first.tenant.id, asOf: '2026-11-21',
    })
    const active = firstOut.occupancyCycles.find(item => item.roomId === 'room-14' && item.status === 'ACTIVE')!
    expect(active.id).toBe(first.cycle.id)
    expect(active.rentAnchorDate).toBe('2026-11-13')

    const allOut = prototypeReducer(firstOut, {
      type: 'tenant/movedOut', tenantId: second.tenant.id, asOf: '2026-11-22',
    })
    expect(allOut.occupancyCycles.find(item => item.id === first.cycle.id)?.status).toBe('CLOSED')

    const next = createTenant(allOut, {
      name: 'Next Occupancy', email: 'next-occupancy@example.com', moveInDate: '2026-11-25',
    }, '2026-11-25')
    expect(next.cycle.id).not.toBe(first.cycle.id)
    expect(next.cycle).toMatchObject({ rentAnchorDate: '2026-11-25', rentAnchorDay: 25, cycleOrigin: 'NEW_MOVE_IN' })
    expect(next.data.moveInObligations.filter(item => item.roomId === 'room-14')).toHaveLength(2)
  })

  it('settles the first period through the advance application without adding duplicate cash', () => {
    const created = createTenant(createDemoData())
    const { data, view } = paidThroughFirstPeriod(created.data)
    const firstRent = data.rentObligations.find(item => item.occupancyCycleId === created.cycle.id)!
    expect(view.firstRentStatus).toBe('PAID')
    expect(rentObligationPaidCents(data, firstRent.id, '2026-11-13')).toBe(400_000)
    expect(data.advanceApplications).toHaveLength(1)
    expect(data.payments.filter(payment => payment.id.startsWith('payment-move-in-'))).toHaveLength(1)
    expect(data.payments.filter(payment => payment.id.startsWith('payment-move-in-'))[0]!.amountCents).toBe(800_000)
    expect(data.receipts.filter(receipt => receipt.paymentId.startsWith('payment-move-in-'))).toHaveLength(1)
  })

  it('quotes voluntary prepayment from the next unpaid period at one current locked rate', () => {
    const created = createTenant(createDemoData())
    let data = paidThroughFirstPeriod(created.data).data
    data = {
      ...data,
      roomRentRates: [...data.roomRentRates, {
        id: 'rent-rate-RATE_4000-2026-12-01', categoryId: 'RATE_4000', monthlyRentCents: 450_000,
        effectiveFrom: '2026-12-01', recordedOn: '2026-11-13',
      }],
    }
    const quote = quoteRentPrepayment(data, { cycleId: created.cycle.id, periodCount: 3, asOf: '2026-11-13' })
    expect(quote.ok).toBe(true)
    if (!quote.ok) return
    expect(quote.quote.periods.map(line => line.sequence)).toEqual([2, 3, 4])
    expect(quote.quote.periods.map(line => line.amountCents)).toEqual([400_000, 400_000, 400_000])
    expect(quote.quote.periods.map(line => line.startDate)).toEqual(['2026-12-13', '2027-01-13', '2027-02-13'])
    expect(quote.quote.periods.map(line => line.dueDate)).toEqual(['2026-12-13', '2027-01-13', '2027-02-13'])
    expect(quote.quote.totalCents).toBe(1_200_000)
    expect(quote.quote.rateCents).toBe(400_000)
  })

  it('records one cash payment with separate period allocations and preserves snapshots', () => {
    const created = createTenant(createDemoData())
    const paid = paidThroughFirstPeriod(created.data)
    const prepayment = prepareRentPrepayment(paid.data, { cycleId: created.cycle.id, periodCount: 2, paidOn: '2026-11-13' })
    expect(prepayment.ok).toBe(true)
    if (!prepayment.ok) return
    expect(prepayment.data.rentPrepayments).toHaveLength(1)
    expect(prepayment.data.payments.filter(payment => payment.id === prepayment.payment.id)).toHaveLength(1)
    expect(prepayment.data.paymentAllocations.filter(allocation => allocation.paymentId === prepayment.payment.id)).toHaveLength(2)
    expect(prepayment.receipt.amountCents).toBe(800_000)
    expect(prepayment.quote.periods.map(line => line.sequence)).toEqual([2, 3])
    expect(isPrototypeData(prepayment.data)).toBe(true)

    const obligations = prepayment.data.rentObligations.filter(item => item.occupancyCycleId === created.cycle.id)
    expect(obligations.map(item => item.amountCents)).toEqual([400_000, 400_000, 400_000])
    expect(obligations.every(item => item.rateSnapshotCents === item.amountCents)).toBe(true)
    expect(obligations.map(item => item.dueDate)).toEqual(['2026-11-13', '2026-12-13', '2027-01-13'])
    expect(obligations.map(item => item.issuedOn)).toEqual(['2026-11-13', '2026-11-13', '2026-11-13'])

    const report = selectRentCycleReport(prepayment.data, created.cycle.id, '2026-11-13')!
    expect(report.periods.map(period => period.status)).toEqual(['PAID', 'PAID', 'PAID'])
    expect(report.periods.slice(1).every(period => period.cashPaidCents === 400_000)).toBe(true)
    expect(report.periods[0]).toMatchObject({ cashPaidCents: 0, advanceAppliedCents: 400_000 })

    const remaining = quoteRentPrepayment(prepayment.data, { cycleId: created.cycle.id, periodCount: 2, asOf: '2026-11-13' })
    expect(remaining.ok).toBe(true)
    if (!remaining.ok) return
    expect(remaining.quote.periods.map(line => line.sequence)).toEqual([4, 5])
    expect(remaining.quote.periods.some(line => line.rentalPeriodId === prepayment.quote.periods[0]!.rentalPeriodId)).toBe(false)
  })

  it('keeps the destination room anniversary when moving into an occupied room', () => {
    const first = createTenant(createDemoData())
    const second = createTenant(first.data, {
      name: 'Occupied Destination Tenant', email: 'occupied-destination@example.com',
      roomId: 'room-15', moveInDate: '2026-11-14',
    }, '2026-11-14')
    const destinationCycle = second.data.occupancyCycles.find(item => item.roomId === 'room-14' && item.status === 'ACTIVE')!
    expect(destinationCycle.id).toBe(first.cycle.id)

    const secondMoveIn = selectMoveInObligations(second.data, '2026-11-14', 'room-15').find(item => item.cycle.status === 'ACTIVE')!
    const secondPaid = prepareMoveInPayment(second.data, { obligationId: secondMoveIn.obligation.id, categories: ['ADVANCE', 'SECURITY_DEPOSIT'], paidOn: '2026-11-14' })
    if (!secondPaid.ok) throw new Error(secondPaid.reason)
    const transferred = prototypeReducer(secondPaid.data, {
      type: 'tenant/updated', tenantId: second.tenant.id, asOf: '2026-11-16',
      draft: draft({
        name: second.tenant.name, email: second.tenant.email, phone: second.tenant.phone, address: second.tenant.address,
        roomId: 'room-14', moveInDate: '2026-11-16',
      }),
    })
    const active = transferred.occupancyCycles.find(item => item.roomId === 'room-14' && item.status === 'ACTIVE')!
    expect(active.id).toBe(first.cycle.id)
    expect(active).toMatchObject({ rentAnchorDate: '2026-11-13', rentAnchorDay: 13 })
    expect(transferred.rentalPeriods.filter(item => item.occupancyCycleId === active.id)).toHaveLength(1)
    expect(transferred.rentObligations.filter(item => item.occupancyCycleId === active.id)).toHaveLength(1)
    expect(transferred.moveInObligations.filter(item => item.roomId === 'room-14')).toHaveLength(1)
    expect(transferred.charges.filter(item => item.category === 'ADVANCE' || item.category === 'SECURITY_DEPOSIT')).toHaveLength(4)
    expect(transferred.occupancyCycles.find(item => item.roomId === 'room-15')?.status).toBe('CLOSED')
  })

  it('starts a transfer destination cycle without another advance or deposit', () => {
    const created = createTenant(createDemoData())
    const paid = paidThroughFirstPeriod(created.data)
    const transferred = prototypeReducer(paid.data, {
      type: 'tenant/updated', tenantId: created.tenant.id, asOf: '2026-11-15',
      draft: draft({
        name: created.tenant.name, email: created.tenant.email, phone: created.tenant.phone,
        address: created.tenant.address, roomId: 'room-15', moveInDate: '2026-11-15',
      }),
    })
    const source = transferred.occupancyCycles.find(item => item.id === created.cycle.id)!
    const destination = transferred.occupancyCycles.find(item => item.roomId === 'room-15' && item.status === 'ACTIVE')!
    expect(source.status).toBe('CLOSED')
    expect(destination).toMatchObject({
      startedAt: '2026-11-15', rentSchedule: 'ANNIVERSARY', rentAnchorDate: '2026-12-13', rentAnchorDay: 13, cycleOrigin: 'TRANSFER',
    })
    expect(transferred.moveInObligations.filter(item => item.roomId === 'room-15')).toHaveLength(0)
    expect(transferred.charges.filter(item => item.category === 'ADVANCE' || item.category === 'SECURITY_DEPOSIT')).toHaveLength(2)
    const destinationRent = transferred.rentObligations.find(item => item.occupancyCycleId === destination.id)!
    expect(destinationRent).toMatchObject({ amountCents: 500_000, source: 'REGULAR', issuedOn: '2026-11-15', dueDate: '2026-12-13' })
    const destinationPeriod = transferred.rentalPeriods.find(item => item.occupancyCycleId === destination.id)!
    expect(destinationPeriod).toMatchObject({ startDate: '2026-12-13', endDateExclusive: '2027-01-13', dueDate: '2026-12-13' })
    expect(transferred.rentObligations.some(item => item.occupancyCycleId === destination.id
      && item.issuedOn <= '2026-11-15' && item.dueDate < '2026-12-13')).toBe(false)
    expect(transferred.advanceApplications).toHaveLength(1)
    expect(transferred.advanceApplications[0]!.rentObligationId).toBe(
      transferred.rentObligations.find(item => item.occupancyCycleId === created.cycle.id)!.id,
    )
  })
})
