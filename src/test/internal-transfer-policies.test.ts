import { describe, expect, it } from 'vitest'
import { createDemoData, DEMO_DATE } from '@/data/fixtures/demo'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import { prepareMoveInPayment, selectMoveInObligations } from '@/domain/calculations/move-in'
import { prepareRentPrepayment, quoteRentPrepayment } from '@/domain/calculations/rent-schedule'
import { rentObligationPaidCents, rentalPeriodsForCycle } from '@/domain/calculations/rental-periods'
import type { PrototypeAppState } from '@/domain/types/models'
import type { TenantDraft } from '@/domain/calculations/tenant-management'

function draft(overrides: Partial<TenantDraft> = {}): TenantDraft {
  return {
    name: 'Transfer Tenant', email: 'transfer@example.com', phone: '+63 900 555 0133',
    address: 'Transfer Street, Demo City', roomId: 'room-14', moveInDate: '2026-11-13', notes: '', ...overrides,
  }
}

function createTenant(data: PrototypeAppState, overrides: Partial<TenantDraft> = {}, asOf = '2026-11-13') {
  const next = prototypeReducer(data, { type: 'tenant/created', draft: draft(overrides), asOf })
  const tenant = next.tenants.find(item => item.email === (overrides.email ?? draft().email))!
  const cycle = next.occupancyCycles.find(item => item.roomId === (overrides.roomId ?? 'room-14') && item.status === 'ACTIVE')!
  return { data: next, tenant, cycle }
}

function payMoveIn(data: PrototypeAppState, roomId: string, paidOn = DEMO_DATE) {
  const view = selectMoveInObligations(data, paidOn, roomId).find(item => item.cycle.status === 'ACTIVE')!
  const paid = prepareMoveInPayment(data, { obligationId: view.obligation.id, categories: ['ADVANCE', 'SECURITY_DEPOSIT'], paidOn })
  if (!paid.ok) throw new Error(paid.reason)
  return paid.data
}

function transferTenant(data: PrototypeAppState, tenantId: string, roomId: string, transferDate: string, asOf = transferDate) {
  const tenant = data.tenants.find(item => item.id === tenantId)!
  return prototypeReducer(data, {
    type: 'tenant/updated', tenantId, asOf,
    draft: draft({
      name: tenant.name, email: tenant.email, phone: tenant.phone, address: tenant.address,
      roomId, moveInDate: transferDate,
    }),
  })
}

describe('confirmed internal transfer policies', () => {
  it('starts a more expensive destination rate in the next period without new advance or deposit', () => {
    const created = createTenant(createDemoData())
    const paid = payMoveIn(created.data, 'room-14')
    const transfer = transferTenant(paid, created.tenant.id, 'room-15', '2026-11-20')
    const destination = transfer.occupancyCycles.find(cycle => cycle.roomId === 'room-15' && cycle.status === 'ACTIVE')!
    const destinationPeriods = rentalPeriodsForCycle(transfer, destination.id)
    expect(destination).toMatchObject({ rentAnchorDate: '2026-12-13', rentAnchorDay: 13 })
    expect(destinationPeriods).toHaveLength(1)
    expect(destinationPeriods[0]).toMatchObject({ startDate: '2026-12-13', endDateExclusive: '2027-01-13', dueDate: '2026-12-13' })
    expect(transfer.rentObligations.find(item => item.occupancyCycleId === destination.id)).toMatchObject({ amountCents: 500_000, dueDate: '2026-12-13' })
    expect(transfer.moveInObligations.filter(item => item.roomId === 'room-15')).toHaveLength(0)
    expect(transfer.charges.filter(item => item.category === 'ADVANCE' || item.category === 'SECURITY_DEPOSIT')).toHaveLength(2)
  })

  it('starts a cheaper destination rate in the next period without refunding the old rate difference', () => {
    const created = createTenant(createDemoData(), {
      name: 'Cheaper Destination Tenant', email: 'cheaper@example.com', roomId: 'room-15',
    })
    const paid = payMoveIn(created.data, 'room-15')
    const sourcePaymentIds = paid.payments.map(payment => payment.id)
    const transfer = transferTenant(paid, created.tenant.id, 'room-14', '2026-11-20')
    const destination = transfer.occupancyCycles.find(cycle => cycle.roomId === 'room-14' && cycle.status === 'ACTIVE')!
    const destinationRent = transfer.rentObligations.find(item => item.occupancyCycleId === destination.id)!
    expect(destinationRent).toMatchObject({ amountCents: 400_000, dueDate: '2026-12-13' })
    expect(transfer.payments.map(payment => payment.id)).toEqual(expect.arrayContaining(sourcePaymentIds))
    expect(transfer.charges.filter(item => item.category === 'ADVANCE' || item.category === 'SECURITY_DEPOSIT')).toHaveLength(2)
    expect(transfer.financialReviewCases.filter(review => review.type === 'TRANSFER_RENT_DIFFERENCE')).toHaveLength(0)
  })

  it('establishes an empty-room cycle without move-in charges and leaves the paid source period untouched', () => {
    const created = createTenant(createDemoData())
    const paid = payMoveIn(created.data, 'room-14')
    const sourceRent = paid.rentObligations.find(item => item.roomId === 'room-14')!
    const sourcePaidBefore = rentObligationPaidCents(paid, sourceRent.id, DEMO_DATE)
    const receiptCount = paid.receipts.length
    const transfer = transferTenant(paid, created.tenant.id, 'room-15', '2026-11-20')
    expect(rentObligationPaidCents(transfer, sourceRent.id, DEMO_DATE)).toBe(sourcePaidBefore)
    expect(transfer.receipts).toHaveLength(receiptCount)
    expect(transfer.payments).toHaveLength(paid.payments.length)
    expect(transfer.rentObligations.filter(item => item.roomId === 'room-14')).toHaveLength(1)
    expect(transfer.rentObligations.filter(item => item.roomId === 'room-15')).toHaveLength(1)
  })

  it('preserves an occupied destination anniversary and creates a review case instead of charging a difference', () => {
    const first = createTenant(createDemoData())
    const paidFirst = payMoveIn(first.data, 'room-14')
    const second = createTenant(paidFirst, {
      name: 'Occupied Destination Transfer', email: 'occupied-transfer@example.com', roomId: 'room-15',
    }, '2026-11-14')
    const paidSecond = payMoveIn(second.data, 'room-15', '2026-11-14')
    const transfer = transferTenant(paidSecond, second.tenant.id, 'room-14', '2026-11-18')
    const destination = transfer.occupancyCycles.find(cycle => cycle.roomId === 'room-14' && cycle.status === 'ACTIVE')!
    expect(destination.id).toBe(first.cycle.id)
    expect(destination.rentAnchorDate).toBe('2026-11-13')
    expect(transfer.rentObligations.filter(item => item.occupancyCycleId === destination.id)).toHaveLength(1)
    expect(transfer.moveInObligations.filter(item => item.roomId === 'room-14')).toHaveLength(1)
    expect(transfer.financialReviewCases.some(review => review.type === 'TRANSFER_RENT_DIFFERENCE'
      && review.roomId === 'room-14' && review.status === 'OPEN')).toBe(true)
  })

  it('flags different source and destination anniversaries without reallocating payments', () => {
    const first = createTenant(createDemoData())
    const paidFirst = payMoveIn(first.data, 'room-14')
    const second = createTenant(paidFirst, {
      name: 'Different Anniversary Tenant', email: 'different-anniversary@example.com', roomId: 'room-15', moveInDate: '2026-11-20',
    }, '2026-11-20')
    const paidSecond = payMoveIn(second.data, 'room-15', '2026-11-20')
    const before = JSON.stringify(paidSecond.paymentAllocations)
    const transfer = transferTenant(paidSecond, second.tenant.id, 'room-14', '2026-11-22')
    expect(JSON.stringify(transfer.paymentAllocations)).toBe(before)
    expect(transfer.financialReviewCases.some(review => review.type === 'TRANSFER_RENT_DIFFERENCE')).toBe(true)
    expect(transfer.rentObligations.filter(item => item.roomId === 'room-14')).toHaveLength(1)
  })

  it('defers a future-dated transfer until the effective date and then starts the next destination period', () => {
    const created = createTenant(createDemoData())
    const paid = payMoveIn(created.data, 'room-14')
    const scheduled = transferTenant(paid, created.tenant.id, 'room-15', '2026-12-01', '2026-11-20')
    expect(scheduled.occupancyCycles.some(cycle => cycle.roomId === 'room-15' && cycle.status === 'ACTIVE')).toBe(false)
    const effective = prototypeReducer(scheduled, { type: 'occupancy/dateChanged', asOf: '2026-12-01' })
    const destination = effective.occupancyCycles.find(cycle => cycle.roomId === 'room-15' && cycle.status === 'ACTIVE')!
    const period = rentalPeriodsForCycle(effective, destination.id)[0]!
    expect(period).toMatchObject({ startDate: '2026-12-13', endDateExclusive: '2027-01-13' })
    expect(effective.rentObligations.find(item => item.occupancyCycleId === destination.id)).toMatchObject({ amountCents: 500_000, dueDate: '2026-12-13' })
  })

  it('requires the original source period to remain paid without collecting destination rent twice for the transfer month', () => {
    const created = createTenant(createDemoData())
    const paid = payMoveIn(created.data, 'room-14')
    const sourceObligation = paid.rentObligations.find(item => item.roomId === 'room-14')!
    const transfer = transferTenant(paid, created.tenant.id, 'room-15', '2026-11-20')
    expect(rentObligationPaidCents(transfer, sourceObligation.id, '2026-11-20')).toBe(400_000)
    const novemberDueDest = transfer.rentObligations.filter(item => item.roomId === 'room-15'
      && item.dueDate >= '2026-11-01' && item.dueDate <= '2026-11-30')
    expect(novemberDueDest).toHaveLength(0)
    expect(transfer.rentObligations.filter(item => item.roomId === 'room-15')).toHaveLength(1)
  })

  it('flags prepaid future source rent and blocks automatic destination rent generation', () => {
    const created = createTenant(createDemoData())
    const paid = payMoveIn(created.data, 'room-14')
    const prepaid = prepareRentPrepayment(paid, { cycleId: created.cycle.id, periodCount: 1, paidOn: DEMO_DATE })
    if (!prepaid.ok) throw new Error(prepaid.reason)
    const transfer = transferTenant(prepaid.data, created.tenant.id, 'room-15', '2026-11-20')
    const destination = transfer.occupancyCycles.find(cycle => cycle.roomId === 'room-15' && cycle.status === 'ACTIVE')!
    expect(transfer.financialReviewCases.some(review => review.type === 'TRANSFER_PREPAID_RENT'
      && review.occupancyCycleId === destination.id && review.status === 'OPEN')).toBe(true)
    expect(transfer.rentalPeriods.filter(period => period.occupancyCycleId === destination.id)).toHaveLength(0)
    expect(transfer.rentObligations.filter(obligation => obligation.occupancyCycleId === destination.id)).toHaveLength(0)
    expect(quoteRentPrepayment(transfer, { cycleId: destination.id, periodCount: 1, asOf: '2026-11-20' }))
      .toEqual({ ok: false, reason: 'TRANSFER_REVIEW_REQUIRED' })
  })

  it('flags legacy paid source rent when transferring into an occupied anniversary room', () => {
    const destinationTenant = createTenant(createDemoData(), {
      name: 'Legacy Destination Occupant', email: 'legacy-destination@example.com', roomId: 'room-10',
    })
    const transfer = transferTenant(destinationTenant.data, 'tenant-1', 'room-10', '2026-11-20')
    expect(transfer.financialReviewCases.some(review => review.type === 'TRANSFER_RENT_DIFFERENCE'
      && review.tenantId === 'tenant-1' && review.roomId === 'room-10')).toBe(true)
    expect(transfer.moveInObligations.filter(item => item.roomId === 'room-10')).toHaveLength(1)
  })

  it('treats a completed move-out and later return as a new admission with new advance and deposit', () => {
    const created = createTenant(createDemoData())
    let data = payMoveIn(created.data, 'room-14')
    const oldPaymentIds = data.payments.map(payment => payment.id)
    data = prototypeReducer(data, { type: 'tenant/movedOut', tenantId: created.tenant.id, asOf: '2026-11-20' })
    expect(data.tenants.find(tenant => tenant.id === created.tenant.id)?.status).toBe('MOVED_OUT')
    expect(data.occupancyCycles.find(cycle => cycle.id === created.cycle.id)?.status).toBe('CLOSED')

    const returning = createTenant(data, {
      name: 'Returning Tenant', email: 'returning@example.com', roomId: 'room-15', moveInDate: '2026-11-25',
    }, '2026-11-25')
    const newCycle = returning.cycle
    expect(newCycle.id).not.toBe(created.cycle.id)
    expect(returning.data.moveInObligations.filter(item => item.roomId === 'room-15')).toHaveLength(1)
    const newView = selectMoveInObligations(returning.data, '2026-11-25', 'room-15').find(item => item.cycle.id === newCycle.id)!
    expect(newView.obligation).toMatchObject({ advanceRequiredCents: 500_000, depositRequiredCents: 500_000 })
    const newRentBeforePayment = returning.data.rentObligations.find(item => item.occupancyCycleId === newCycle.id)!
    expect(newRentBeforePayment).toMatchObject({ amountCents: 500_000, dueDate: '2026-11-25' })
    const readmitted = payMoveIn(returning.data, 'room-15', '2026-11-25')
    expect(readmitted.payments.map(payment => payment.id)).toEqual(expect.arrayContaining(oldPaymentIds))
    expect(readmitted.advanceApplications).toHaveLength(2)
    expect(readmitted.advanceApplications.some(application => application.rentObligationId === newRentBeforePayment.id)).toBe(true)
    expect(rentObligationPaidCents(readmitted, newRentBeforePayment.id, '2026-11-25')).toBe(500_000)
    expect(readmitted.charges.filter(charge => charge.category === 'ADVANCE' || charge.category === 'SECURITY_DEPOSIT')).toHaveLength(4)
  })
})
