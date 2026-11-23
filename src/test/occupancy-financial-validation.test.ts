import { describe, expect, it } from 'vitest'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import { createEmptyData } from '@/data/fixtures/empty'
import { prepareMoveInPayment, selectMoveInObligations } from '@/domain/calculations/move-in'
import { prepareMeterInitialization } from '@/domain/calculations/meter-initialization'
import { roomFinancialEligibility, occupancyFinancialMessage } from '@/domain/calculations/occupancy-financial-eligibility'
import { collectionCatalog, prepareCollection } from '@/domain/calculations/payment-collection'
import { tenantAccount } from '@/domain/calculations/summary'
import { moveOutBlockers, updateTenant, validateTenantDraft, type TenantDraft } from '@/domain/calculations/tenant-management'
import { ensureRegularRentPeriodsThrough } from '@/domain/calculations/rent-schedule'
import { isPrototypeData } from '@/domain/validation/prototype-data'
import type { Charge, PrototypeAppState } from '@/domain/types/models'

const AS_OF = '2026-11-23'
function draft(name: string, email: string, roomId: string, moveInDate: string): TenantDraft {
  return { name, email, phone: '', address: '', notes: '', roomId, moveInDate }
}
function addTenant(data: PrototypeAppState, input: TenantDraft) {
  const next = prototypeReducer(data, { type: 'tenant/created', asOf: input.moveInDate, draft: input })
  return { data: next, tenant: next.tenants.find(item => item.email === input.email)! }
}
function payMoveIn(data: PrototypeAppState, roomId: string, paidOn: string) {
  const view = selectMoveInObligations(data, paidOn, roomId).find(item => item.cycle.status === 'ACTIVE')!
  const paid = prepareMoveInPayment(data, { obligationId: view.obligation.id, categories: ['ADVANCE', 'SECURITY_DEPOSIT'], paidOn })
  if (!paid.ok) throw new Error(paid.reason)
  return paid.data
}
function addIssuedUtility(data: PrototypeAppState, roomId: string, tenantId: string, category: 'WATER' | 'WASHING_MACHINE' | 'ELECTRICITY', amountCents = 10_000): PrototypeAppState {
  const charge: Charge = category === 'ELECTRICITY'
    ? {
      id: `issued-${category}-${roomId}`, roomId, tenantId, billingPeriodId: 'period-2026-11', category,
      amountCents, description: 'Verified unpaid electricity', issuedOn: '2026-11-01', dueDate: '2026-11-20',
      state: 'ISSUED', correction: null,
      electricity: {
        intervalId: 'meter-room-8:test>200000', meterId: 'meter-room-8', previousReadingId: 'previous-test', currentReadingId: 'current-test',
        previousReadingMilliKwh: 100_000, currentReadingMilliKwh: 150_000, consumptionMilliKwh: 50_000,
        rateId: 'rate-test', appliedRateCentsPerKwh: 1_300, appliedRateEffectiveFrom: '2026-01-01',
      },
    }
    : {
      id: `issued-${category}-${roomId}`, roomId, tenantId, billingPeriodId: 'period-2026-11', category,
      amountCents, description: 'Verified unpaid utility', issuedOn: '2026-11-01', dueDate: '2026-11-20',
      state: 'ISSUED', correction: null, entryMethod: 'MANUAL',
    }
  return { ...data, charges: [...data.charges, charge] }
}

function sharedOctoberRoom() {
  let data = ensureRegularRentPeriodsThrough(createEmptyData(AS_OF), AS_OF)
  const eduard = addTenant(data, draft('Eduard', 'eduard@example.com', 'room-8', '2026-10-01'))
  data = payMoveIn(eduard.data, 'room-8', '2026-10-01')
  const renzo = addTenant(data, draft('Renzo', 'renzo@example.com', 'room-8', '2026-10-10'))
  return { data: ensureRegularRentPeriodsThrough(renzo.data, AS_OF), eduard: eduard.tenant, renzo: renzo.tenant }
}

describe('room-level occupancy financial validation', () => {
  it('blocks both shared-room occupants when room rent is unpaid', () => {
    const { data, eduard, renzo } = sharedOctoberRoom()
    expect(tenantAccount(data, renzo.id, AS_OF).balance).toBe(0)
    const eligibility = roomFinancialEligibility(data, 'room-8', AS_OF)
    expect(eligibility.eligible).toBe(false)
    expect(eligibility.amountCents).toBeGreaterThan(0)
    expect(eligibility.blockers.some(blocker => blocker.kind === 'RENT')).toBe(true)
    expect(occupancyFinancialMessage(eligibility, 'Move-out')).toBe('Move-out blocked: Room 8 has unpaid rent (₱3,500.00 outstanding).')
    expect(moveOutBlockers(data, eduard.id, AS_OF)[0]).toContain('Room 8 has unpaid rent')
    expect(moveOutBlockers(data, renzo.id, AS_OF)[0]).toContain('Room 8 has unpaid rent')
    expect(prototypeReducer(data, { type: 'tenant/movedOut', tenantId: eduard.id, asOf: AS_OF })).toBe(data)
    expect(prototypeReducer(data, { type: 'tenant/movedOut', tenantId: renzo.id, asOf: AS_OF })).toBe(data)
  })

  it('blocks shared-room move-out for unpaid water, washing, or electricity bills', () => {
    let data = ensureRegularRentPeriodsThrough(createEmptyData(AS_OF), AS_OF)
    const eduard = addTenant(data, draft('Eduard', 'eduard@example.com', 'room-8', '2026-11-01'))
    data = payMoveIn(eduard.data, 'room-8', '2026-11-01')
    const renzo = addTenant(data, draft('Renzo', 'renzo@example.com', 'room-8', '2026-11-10'))
    data = addIssuedUtility(renzo.data, 'room-8', renzo.tenant.id, 'WATER')
    data = addIssuedUtility(data, 'room-8', renzo.tenant.id, 'WASHING_MACHINE')
    const eligibility = roomFinancialEligibility(data, 'room-8', AS_OF)
    expect(eligibility.amountCents).toBe(20_000)
    expect(eligibility.blockers.find(blocker => blocker.kind === 'UTILITY')?.categories).toEqual(['WATER', 'WASHING_MACHINE'])
    expect(moveOutBlockers(data, eduard.tenant.id, AS_OF)[0]).toBe('Move-out blocked: Room 8 has unpaid utility bills (₱200.00 outstanding).')
    expect(moveOutBlockers(data, renzo.tenant.id, AS_OF)[0]).toContain('unpaid utility bills')
    const paidElectricity = addIssuedUtility(data, 'room-8', eduard.tenant.id, 'ELECTRICITY', 65_000)
    expect(roomFinancialEligibility(paidElectricity, 'room-8', AS_OF).blockers.find(blocker => blocker.kind === 'UTILITY')?.categories).toContain('ELECTRICITY')
  })

  it('does not treat awaiting electricity as zero owed', () => {
    let data = createEmptyData(AS_OF)
    const eduard = addTenant(data, draft('Eduard', 'eduard@example.com', 'room-8', '2026-11-01'))
    data = payMoveIn(eduard.data, 'room-8', '2026-11-01')
    const initialized = prepareMeterInitialization(data, {
      roomId: 'room-8', readingMilliKwh: 100_000, readOn: '2026-11-01', initializedOn: '2026-11-01', sourceNote: 'Verified baseline',
    })
    if (!initialized.ok) throw new Error(initialized.reason)
    const eligibility = roomFinancialEligibility(initialized.data, 'room-8', AS_OF)
    expect(eligibility.blockers.some(blocker => blocker.kind === 'ELECTRICITY_SETTLEMENT')).toBe(true)
    expect(moveOutBlockers(initialized.data, eduard.tenant.id, AS_OF)[0]).toBe('Move-out blocked: Room 8 requires an electricity meter reading and settlement.')
  })

  it('allows both tenants to move out from a fully settled shared room', () => {
    let data = createEmptyData(AS_OF)
    const first = addTenant(data, draft('Eduard', 'eduard@example.com', 'room-4', '2026-11-01'))
    data = payMoveIn(first.data, 'room-4', '2026-11-01')
    const second = addTenant(data, draft('Renzo', 'renzo@example.com', 'room-4', '2026-11-01'))
    expect(moveOutBlockers(second.data, first.tenant.id, AS_OF)).toEqual([])
    expect(moveOutBlockers(second.data, second.tenant.id, AS_OF)).toEqual([])
    const firstOut = prototypeReducer(second.data, { type: 'tenant/movedOut', tenantId: first.tenant.id, asOf: AS_OF })
    expect(firstOut.tenants.find(tenant => tenant.id === first.tenant.id)?.status).toBe('MOVED_OUT')
    expect(moveOutBlockers(firstOut, second.tenant.id, AS_OF)).toEqual([])
    const secondOut = prototypeReducer(firstOut, { type: 'tenant/movedOut', tenantId: second.tenant.id, asOf: AS_OF })
    expect(secondOut.tenants.find(tenant => tenant.id === second.tenant.id)?.status).toBe('MOVED_OUT')
    expect(secondOut.occupancyCycles.filter(cycle => cycle.roomId === 'room-4' && cycle.status === 'ACTIVE')).toHaveLength(0)
  })

  it('blocks direct transfer when the source room has unpaid room-level obligations', () => {
    const { data, renzo } = sharedOctoberRoom()
    const errors = validateTenantDraft(data, draft('Renzo', 'renzo@example.com', 'room-1', AS_OF), { tenantId: renzo.id, asOf: AS_OF })
    expect(errors.general).toBe('Transfer blocked: Room 8 has unpaid rent (₱3,500.00 outstanding).')
    const result = updateTenant(data, renzo.id, draft('Renzo', 'renzo@example.com', 'room-1', AS_OF), AS_OF)
    expect(result.ok).toBe(false)
    expect(prototypeReducer(data, { type: 'tenant/updated', tenantId: renzo.id, asOf: AS_OF, draft: draft('Renzo', 'renzo@example.com', 'room-1', AS_OF) })).toBe(data)
  })

  it('lets a fully paid tenant transfer at a billing boundary without losing historical utility attribution', () => {
    let data = ensureRegularRentPeriodsThrough(createEmptyData(AS_OF), AS_OF)
    const charise = addTenant(data, draft('Charise', 'charise@example.com', 'room-15', '2026-10-01'))
    data = payMoveIn(charise.data, 'room-15', '2026-10-01')
    const utilities = collectionCatalog(data, 'room-15', AS_OF).filter(item => item.category !== 'ELECTRICITY')
    const paid = prepareCollection(data, {
      transactionId: 'charise-paid-bills', roomId: 'room-15', readings: {}, collectedOn: AS_OF,
      selections: utilities.map(({ id, amountCents, periodId, dueDate, basis }) => ({ id, amountCents, periodId, dueDate, basis })),
    })
    if (!paid.ok) throw new Error(paid.reason)
    data = paid.data
    expect(roomFinancialEligibility(data, 'room-15', AS_OF).eligible).toBe(true)
    expect(data.charges.filter(charge => charge.category === 'WATER').every(charge => charge.roomId === 'room-15')).toBe(true)
    const beforePayments = data.payments.length
    const beforeAdvances = data.charges.filter(charge => charge.category === 'ADVANCE' || charge.category === 'SECURITY_DEPOSIT').length
    const beforeRoom2 = JSON.stringify({
      assignments: data.roomAssignments.filter(assignment => assignment.roomId === 'room-2'),
      charges: data.charges.filter(charge => charge.roomId === 'room-2'),
    })
    const moved = prototypeReducer(data, {
      type: 'tenant/updated', tenantId: charise.tenant.id, asOf: AS_OF,
      draft: draft('Charise', 'charise@example.com', 'room-1', '2026-11-01'),
    })
    expect(moved).not.toBe(data)
    expect(isPrototypeData(moved)).toBe(true)
    expect(moved.roomAssignments.find(assignment => assignment.tenantId === charise.tenant.id && assignment.endDate === null)?.roomId).toBe('room-1')
    expect(moved.roomAssignments.find(assignment => assignment.tenantId === charise.tenant.id && assignment.roomId === 'room-15')?.endDate).toBe('2026-10-31')
    expect(moved.payments).toHaveLength(beforePayments)
    expect(moved.charges.filter(charge => charge.category === 'ADVANCE' || charge.category === 'SECURITY_DEPOSIT')).toHaveLength(beforeAdvances)
    expect(JSON.stringify({
      assignments: moved.roomAssignments.filter(assignment => assignment.roomId === 'room-2'),
      charges: moved.charges.filter(charge => charge.roomId === 'room-2'),
    })).toBe(beforeRoom2)
  })

  it('validates destination capacity independently from source financial eligibility', () => {
    let data = createEmptyData(AS_OF)
    const first = addTenant(data, draft('Room One A', 'room1a@example.com', 'room-1', '2026-11-01'))
    data = payMoveIn(first.data, 'room-1', '2026-11-01')
    data = addTenant(data, draft('Room One B', 'room1b@example.com', 'room-1', '2026-11-01')).data
    const charise = addTenant(data, draft('Charise', 'charise@example.com', 'room-15', '2026-11-01'))
    data = payMoveIn(charise.data, 'room-15', '2026-11-01')
    expect(roomFinancialEligibility(data, 'room-15', AS_OF).eligible).toBe(true)
    const errors = validateTenantDraft(data, draft('Charise', 'charise@example.com', 'room-1', AS_OF), { tenantId: charise.tenant.id, asOf: AS_OF })
    expect(errors.roomId).toMatch(/exceed its capacity/)
  })
})
