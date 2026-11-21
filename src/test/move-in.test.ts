import { describe, expect, it } from 'vitest'
import { createDemoData, DEMO_DATE, DEMO_PERIOD } from '@/data/fixtures/demo'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import {
  moveInSummary, prepareMoveInPayment, proposedMoveInAdjustment, reconcileOccupancy, selectMoveInObligations,
} from '@/domain/calculations/move-in'
import { createTenant } from '@/domain/calculations/tenant-management'
import { selectSummary } from '@/domain/calculations/summary'
import { preparePaymentCorrection } from '@/domain/calculations/payment-correction'
import { selectTenantReceipts } from '@/features/tenant/tenant-receipts'
import { parsePrototypeSnapshot } from '@/data/repositories/prototype-storage'
import type { PrototypeAppState, Tenant } from '@/domain/types/models'
import type { TenantDraft } from '@/domain/calculations/tenant-management'

function draft(overrides: Partial<TenantDraft> = {}): TenantDraft {
  return {
    name: 'Move-in Test Tenant', email: 'movein@example.com', phone: '+63 900 555 0100',
    address: '2 Test Street, Demo City', roomId: 'room-9', moveInDate: '2026-11-01', notes: '', ...overrides,
  }
}

function createInRoom(data: PrototypeAppState, overrides: Partial<TenantDraft> = {}) {
  const next = prototypeReducer(data, { type: 'tenant/created', draft: draft(overrides) })
  const tenant = next.tenants.find(item => !data.tenants.some(existing => existing.id === item.id))
  if (!tenant) throw new Error('Tenant was not created')
  return { data: next, tenant }
}

function viewFor(data: PrototypeAppState, tenant: Tenant) {
  const assignment = data.roomAssignments.find(item => item.tenantId === tenant.id && item.endDate === null)
  if (!assignment) throw new Error('Tenant assignment missing')
  return selectMoveInObligations(data, DEMO_DATE, assignment.roomId)[0]
}

describe('room-level move-in advance and security deposit', () => {
  it('creates one obligation for a vacant room and excludes it from monthly billed totals', () => {
    const base = createDemoData()
    const { data, tenant } = createInRoom(base)
    const view = viewFor(data, tenant)
    expect(view).toBeDefined()
    expect(view!.cycle.startedAt).toBe('2026-11-01')
    expect(view!.cycle.status).toBe('ACTIVE')
    expect(view!.obligation.agreedMonthlyRentCents).toBe(400_000)
    expect(view!.obligation.advanceRequiredCents).toBe(400_000)
    expect(view!.obligation.depositRequiredCents).toBe(400_000)
    expect(view!.obligation.policyVersion).toBe(2)
    expect(view!.obligation.depositDisposition).toBe('NON_REFUNDABLE')
    expect(view!.obligation.depositIncomeRecognition).toBe('NOT_RECOGNIZED')
    expect(data.charges.filter(charge => charge.category === 'ADVANCE' || charge.category === 'SECURITY_DEPOSIT')).toHaveLength(2)
    expect(data.charges.find(charge => charge.category === 'ADVANCE')?.tenantId).toBe(tenant.id)
    expect(selectSummary(data, DEMO_DATE, DEMO_PERIOD)).toMatchObject({
      billed: selectSummary(base, DEMO_DATE, DEMO_PERIOD).billed,
      applied: selectSummary(base, DEMO_DATE, DEMO_PERIOD).applied,
      outstanding: selectSummary(base, DEMO_DATE, DEMO_PERIOD).outstanding,
      received: selectSummary(base, DEMO_DATE, DEMO_PERIOD).received,
    })
  })

  it('adds a roommate without creating a second room obligation', () => {
    const first = createInRoom(createDemoData())
    const second = createInRoom(first.data, { name: 'Second Occupant', email: 'second@example.com', moveInDate: '2026-11-05' })
    expect(second.data.moveInObligations).toHaveLength(1)
    expect(second.data.occupancyCycles.filter(cycle => cycle.roomId === 'room-9' && cycle.status === 'ACTIVE')).toHaveLength(1)
    expect(second.data.charges.filter(charge => charge.category === 'ADVANCE' || charge.category === 'SECURITY_DEPOSIT')).toHaveLength(2)
  })

  it('uses the actual assigned room rate for the money snapshot', () => {
    const { data, tenant } = createInRoom(createDemoData(), {
      roomId: 'room-15', name: 'Aircon Tenant', email: 'aircon@example.com',
    })
    const view = viewFor(data, tenant)
    expect(view!.obligation.agreedMonthlyRentCents).toBe(500_000)
    expect(view!.obligation.advanceRequiredCents).toBe(500_000)
    expect(view!.obligation.depositRequiredCents).toBe(500_000)
    expect(view!.room.name).toBe('02')
  })

  it('records separate partial advance and deposit payments with unique receipts', () => {
    const { data, tenant } = createInRoom(createDemoData())
    const view = viewFor(data, tenant)
    const first = prepareMoveInPayment(data, {
      obligationId: view!.obligation.id, payerTenantId: tenant.id,
      advanceCents: 100_000, depositCents: 0, paidOn: DEMO_DATE, method: 'cash',
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(selectMoveInObligations(first.data, DEMO_DATE, 'room-9')[0]).toMatchObject({
      advancePaidCents: 100_000, depositPaidCents: 0, advanceStatus: 'PARTLY PAID', depositStatus: 'NOT PAID', status: 'PARTLY PAID',
    })
    const second = prepareMoveInPayment(first.data, {
      obligationId: view!.obligation.id, payerTenantId: tenant.id,
      advanceCents: 300_000, depositCents: 400_000, paidOn: DEMO_DATE, method: 'bank-transfer',
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.receipt.receiptNumber).not.toBe(first.receipt.receiptNumber)
    expect(selectMoveInObligations(second.data, DEMO_DATE, 'room-9')[0]).toMatchObject({
      advancePaidCents: 400_000, depositPaidCents: 400_000, status: 'PAID', totalRemainingCents: 0,
    })
    expect(moveInSummary(second.data, DEMO_DATE)).toMatchObject({
      advanceCollectedCents: 400_000, depositCollectedCents: 400_000, outstandingCents: 0, paidObligations: 1,
    })
    expect(second.data.receipts.filter(receipt => receipt.paymentId === second.payment.id)).toHaveLength(1)
  })

  it('rejects overpayment, empty selections, and a payer unrelated to the room', () => {
    const { data, tenant } = createInRoom(createDemoData())
    const obligation = data.moveInObligations[0]!
    const base = { obligationId: obligation.id, payerTenantId: tenant.id, paidOn: DEMO_DATE, method: 'cash' as const }
    expect(prepareMoveInPayment(data, { ...base, advanceCents: 400_001, depositCents: 0 })).toEqual({ ok: false, reason: 'OVERPAYMENT' })
    expect(prepareMoveInPayment(data, { ...base, advanceCents: 0, depositCents: 0 })).toEqual({ ok: false, reason: 'NO_SELECTION' })
    expect(prepareMoveInPayment(data, { ...base, payerTenantId: 'tenant-1', advanceCents: 1, depositCents: 0 })).toEqual({ ok: false, reason: 'PAYER_NOT_OCCUPANT' })
    expect(prepareMoveInPayment(data, { ...base, advanceCents: -1, depositCents: 0 })).toEqual({ ok: false, reason: 'INVALID_AMOUNT' })
    expect(prepareMoveInPayment(data, { ...base, paidOn: '2026-10-01', advanceCents: 1, depositCents: 0 })).toEqual({ ok: false, reason: 'INVALID_DATE' })
  })

  it('closes the room cycle when everyone leaves and creates a fresh obligation for the next occupancy', () => {
    const first = createInRoom(createDemoData())
    const second = createInRoom(first.data, { name: 'Roommate', email: 'roommate@example.com', moveInDate: '2026-11-05' })
    const firstOut = prototypeReducer(second.data, { type: 'tenant/movedOut', tenantId: first.tenant.id })
    expect(firstOut.occupancyCycles.find(cycle => cycle.roomId === 'room-9' && cycle.status === 'ACTIVE')).toBeDefined()
    const allOut = prototypeReducer(firstOut, { type: 'tenant/movedOut', tenantId: second.tenant.id })
    const closed = allOut.occupancyCycles.find(cycle => cycle.roomId === 'room-9' && cycle.endedAt !== null)
    expect(closed?.status).toBe('CLOSED')
    expect(allOut.occupancyCycles.some(cycle => cycle.roomId === 'room-9' && cycle.status === 'ACTIVE')).toBe(false)
    const laterDraft = draft({ name: 'Next Occupant', email: 'next@example.com', moveInDate: '2026-11-14' })
    const later = createTenant(allOut, laterDraft, '2026-11-14')
    if (!later.ok) throw new Error('Later tenant was not created')
    const next = {
      data: reconcileOccupancy(allOut, later.data, '2026-11-14', { createMoveInObligations: true }),
      tenant: later.tenant,
    }
    const active = next.data.occupancyCycles.find(cycle => cycle.roomId === 'room-9' && cycle.status === 'ACTIVE')
    expect(active).toBeDefined()
    expect(active!.id).not.toBe(closed!.id)
    expect(active!.startedAt).toBe('2026-11-14')
    expect(next.data.moveInObligations.filter(item => item.roomId === 'room-9')).toHaveLength(2)
    expect(next.data.moveInObligations.filter(item => item.roomId === 'room-9').every(item => item.depositDisposition === 'NON_REFUNDABLE')).toBe(true)
  })

  it('does not create another obligation when all occupants are replaced on the same day', () => {
    const first = createInRoom(createDemoData())
    const allOut = prototypeReducer(first.data, { type: 'tenant/movedOut', tenantId: first.tenant.id })
    const replacement = createInRoom(allOut, { name: 'Same-day Replacement', email: 'replacement@example.com', moveInDate: DEMO_DATE })
    const active = replacement.data.occupancyCycles.find(cycle => cycle.roomId === 'room-9' && cycle.status === 'ACTIVE')
    expect(active).toBeDefined()
    expect(active!.id).toBe(first.data.occupancyCycles.find(cycle => cycle.roomId === 'room-9')!.id)
    expect(replacement.data.moveInObligations).toHaveLength(1)
    expect(selectMoveInObligations(replacement.data, DEMO_DATE, 'room-9')).toHaveLength(1)
  })

  it('preserves an obligation during a transfer and proposes a top-up without posting charges', () => {
    const created = createInRoom(createDemoData())
    const tenant = created.tenant
    const transfer = prototypeReducer(created.data, {
      type: 'tenant/updated',
      tenantId: tenant.id,
      draft: draft({ name: tenant.name, email: tenant.email, phone: tenant.phone, address: tenant.address, roomId: 'room-15', moveInDate: DEMO_DATE }),
    })
    expect(transfer.moveInObligations).toHaveLength(1)
    expect(transfer.charges.filter(charge => charge.category === 'ADVANCE' || charge.category === 'SECURITY_DEPOSIT')).toHaveLength(2)
    const oldCycle = transfer.occupancyCycles.find(cycle => cycle.roomId === 'room-9' && cycle.status === 'CLOSED')
    const newCycle = transfer.occupancyCycles.find(cycle => cycle.roomId === 'room-15' && cycle.status === 'ACTIVE')
    expect(oldCycle).toBeDefined()
    expect(newCycle).toBeDefined()
    const room = transfer.rooms.find(item => item.id === 'room-15')!
    expect(proposedMoveInAdjustment(transfer, room, newCycle!)).toMatchObject({
      previousRentCents: 400_000, currentRentCents: 500_000, advanceTopUpCents: 100_000, depositTopUpCents: 100_000, kind: 'TOP_UP',
    })
    expect(transfer.moveInObligations.some(obligation => obligation.occupancyCycleId === newCycle!.id)).toBe(false)
  })

  it('proposes a top-up when a tenant transfers into an already occupied, more expensive room', () => {
    const first = createInRoom(createDemoData(), { roomId: 'room-7', name: 'First Transfer', email: 'first-transfer@example.com' })
    const second = createInRoom(first.data, { roomId: 'room-10', name: 'Second Transfer', email: 'second-transfer@example.com' })
    const tenant = first.tenant
    const transferred = prototypeReducer(second.data, {
      type: 'tenant/updated', tenantId: tenant.id,
      draft: draft({ name: tenant.name, email: tenant.email, phone: tenant.phone, address: tenant.address, roomId: 'room-10', moveInDate: DEMO_DATE }),
    })
    const room = transferred.rooms.find(item => item.id === 'room-10')!
    const cycle = transferred.occupancyCycles.find(item => item.roomId === 'room-10' && item.status === 'ACTIVE')!
    expect(transferred.moveInObligations).toHaveLength(2)
    expect(transferred.charges.filter(charge => charge.category === 'ADVANCE' || charge.category === 'SECURITY_DEPOSIT')).toHaveLength(4)
    expect(proposedMoveInAdjustment(transferred, room, cycle)).toMatchObject({
      previousRentCents: 350_000, currentRentCents: 400_000, advanceTopUpCents: 50_000, depositTopUpCents: 50_000, kind: 'TOP_UP',
    })
    expect(transferred.moveInObligations.some(obligation => obligation.occupancyCycleId === cycle.id)).toBe(true)
  })

  it('versions policy changes without rewriting existing charges or obligations', () => {
    const created = createInRoom(createDemoData())
    const before = created.data.moveInObligations[0]!
    const updated = prototypeReducer(created.data, { type: 'moveIn/policyUpdated', advanceApplication: 'MANUAL' })
    expect(updated.moveInPolicy).toMatchObject({ version: 3, advanceApplication: 'MANUAL', depositDisposition: 'NON_REFUNDABLE' })
    expect(updated.moveInObligations[0]).toEqual(before)
    expect(updated.charges.filter(charge => charge.category === 'ADVANCE' || charge.category === 'SECURITY_DEPOSIT'))
      .toEqual(created.data.charges.filter(charge => charge.category === 'ADVANCE' || charge.category === 'SECURITY_DEPOSIT'))
  })

  it('applies deposit policy changes only to future obligations', () => {
    const created = createInRoom(createDemoData())
    const existing = created.data.moveInObligations[0]!
    const changed = prototypeReducer(created.data, { type: 'moveIn/policyUpdated', depositDisposition: 'MANUAL_REVIEW' })
    expect(changed.moveInPolicy).toMatchObject({ version: 3, depositDisposition: 'MANUAL_REVIEW', depositIncomeRecognition: 'NOT_RECOGNIZED' })
    expect(changed.moveInObligations[0]).toEqual(existing)
    expect(changed.moveInObligations[0]!.depositDisposition).toBe('NON_REFUNDABLE')
    const next = createInRoom(changed, { roomId: 'room-10', name: 'Future Deposit', email: 'future-deposit@example.com' })
    const future = next.data.moveInObligations.find(obligation => obligation.roomId === 'room-10')!
    expect(future).toMatchObject({ policyVersion: 3, depositDisposition: 'MANUAL_REVIEW', depositIncomeRecognition: 'NOT_RECOGNIZED' })
  })

  it('keeps non-refundable deposits as separate records without refunds or rental income on move-out', () => {
    const baseSummary = selectSummary(createDemoData(), DEMO_DATE, DEMO_PERIOD)
    const created = createInRoom(createDemoData())
    const tenant = created.tenant
    const view = viewFor(created.data, tenant)
    const paid = prepareMoveInPayment(created.data, {
      obligationId: view!.obligation.id, payerTenantId: tenant.id,
      advanceCents: 400_000, depositCents: 400_000, paidOn: DEMO_DATE, method: 'cash',
    })
    expect(paid.ok).toBe(true)
    if (!paid.ok) return
    const beforeMoveOutPayments = paid.data.payments.length
    const beforeMoveOutCredits = paid.data.tenantCredits.length
    const beforeSummary = selectSummary(paid.data, DEMO_DATE, DEMO_PERIOD)
    expect(beforeSummary.billed).toBe(baseSummary.billed)
    expect(beforeSummary.applied).toBe(baseSummary.applied)
    expect(beforeSummary.received - baseSummary.received).toBe(800_000)
    const movedOut = prototypeReducer(paid.data, { type: 'tenant/movedOut', tenantId: tenant.id })
    const closed = movedOut.occupancyCycles.find(cycle => cycle.roomId === 'room-9' && cycle.status === 'CLOSED')
    expect(closed).toBeDefined()
    expect(movedOut.moveInObligations[0]).toEqual(paid.data.moveInObligations[0])
    expect(movedOut.payments).toHaveLength(beforeMoveOutPayments)
    expect(movedOut.receipts).toEqual(paid.data.receipts)
    expect(movedOut.paymentAllocations).toEqual(paid.data.paymentAllocations)
    expect(movedOut.tenantCredits).toHaveLength(beforeMoveOutCredits)
    expect(movedOut.charges.filter(charge => charge.category === 'SECURITY_DEPOSIT')).toHaveLength(1)
    expect(selectSummary(movedOut, DEMO_DATE, DEMO_PERIOD)).toMatchObject({
      billed: beforeSummary.billed, applied: beforeSummary.applied, outstanding: beforeSummary.outstanding,
      received: beforeSummary.received,
    })
    expect(moveInSummary(movedOut, DEMO_DATE).depositCollectedCents).toBe(400_000)
    expect(movedOut.auditEvents.filter(event => event.action === 'MOVE_IN_PAYMENT_RECORDED')).toHaveLength(1)
  })

  it('migrates version 10 provisional deposits without rewriting their recorded terms', () => {
    const created = createInRoom(createDemoData())
    const seededView = viewFor(created.data, created.tenant)
    const paid = prepareMoveInPayment(created.data, {
      obligationId: seededView!.obligation.id, payerTenantId: created.tenant.id,
      advanceCents: 100_000, depositCents: 100_000, paidOn: DEMO_DATE, method: 'cash',
    })
    if (!paid.ok) throw new Error('Seed payment failed')
    const obligation = paid.data.moveInObligations[0]!
    const { depositDisposition, depositIncomeRecognition, ...legacyObligation } = obligation
    void depositDisposition
    void depositIncomeRecognition
    const legacyPolicy = {
      version: 1, advanceApplication: 'LAST_MONTH' as const, depositDisposition: 'MANUAL_REVIEW' as const,
      transferIncrease: 'PROPOSE_TOP_UP' as const, transferDecrease: 'MANUAL_REVIEW' as const, moveOutSettlement: 'MANUAL_REVIEW' as const,
    }
    const result = parsePrototypeSnapshot(JSON.stringify({
      version: 10,
      data: { ...paid.data, moveInObligations: [legacyObligation], moveInPolicy: legacyPolicy },
    }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.moveInPolicy).toMatchObject({ version: 2, depositDisposition: 'NON_REFUNDABLE', depositIncomeRecognition: 'NOT_RECOGNIZED' })
    expect(result.data.moveInObligations[0]).toMatchObject({
      id: obligation.id, advanceRequiredCents: obligation.advanceRequiredCents,
      depositDisposition: 'MANUAL_REVIEW', depositIncomeRecognition: 'NOT_RECOGNIZED',
    })
    expect(result.data.payments).toEqual(paid.data.payments)
    expect(result.data.receipts).toEqual(paid.data.receipts)
    expect(result.data.paymentAllocations).toEqual(paid.data.paymentAllocations)
  })

  it('supports receipt corrections while keeping the room obligation intact', () => {
    const { data, tenant } = createInRoom(createDemoData())
    const obligation = data.moveInObligations[0]!
    const paid = prepareMoveInPayment(data, {
      obligationId: obligation.id, payerTenantId: tenant.id,
      advanceCents: 100_000, depositCents: 100_000, paidOn: DEMO_DATE, method: 'cash',
    })
    expect(paid.ok).toBe(true)
    if (!paid.ok) return
    const receipt = selectTenantReceipts(paid.data, tenant.id).receipts.find(item => item.payment.id === paid.payment.id)!
    expect(receipt.categories.filter(category => category.included).map(category => category.category)).toEqual(['ADVANCE', 'SECURITY_DEPOSIT'])
    expect(receipt.rooms.label).toBe('Room 01')
    const corrected = preparePaymentCorrection(paid.data, {
      paymentId: paid.payment.id, selectedCategories: ['ADVANCE'], correctedElectricityReadingMilliKwh: null,
      reason: 'Deposit was not received', settlementStatus: 'REFUNDED', moneyExchangeConfirmed: true, correctedAt: DEMO_DATE,
    })
    expect(corrected.ok).toBe(true)
    if (!corrected.ok) return
    expect(corrected.correction).toMatchObject({ originalAmountCents: 200_000, correctedAmountCents: 100_000, differenceCents: -100_000, settlementStatus: 'REFUNDED' })
    expect(corrected.data.moveInObligations).toEqual(paid.data.moveInObligations)
    expect(corrected.data.charges.filter(charge => charge.category === 'ADVANCE' || charge.category === 'SECURITY_DEPOSIT')).toHaveLength(2)
    expect(selectMoveInObligations(corrected.data, DEMO_DATE, 'room-9')[0]).toMatchObject({
      advancePaidCents: 100_000, depositPaidCents: 0, advanceStatus: 'PARTLY PAID', depositStatus: 'NOT PAID',
    })
    expect(corrected.receipt.revision).toBe(2)
  })

  it('migrates version 9 without inventing move-in balances', () => {
    const current = createDemoData()
    const { occupancyCycles, moveInObligations, moveInPolicy, ...legacy } = current
    void occupancyCycles
    void moveInObligations
    void moveInPolicy
    const result = parsePrototypeSnapshot(JSON.stringify({ version: 9, data: legacy }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.occupancyCycles).toHaveLength(4)
    expect(result.data.occupancyCycles.every(cycle => cycle.status === 'ACTIVE')).toBe(true)
    expect(result.data.moveInObligations).toEqual([])
    expect(result.data.moveInPolicy.version).toBe(2)
    expect(result.data.moveInPolicy).toMatchObject({ depositDisposition: 'NON_REFUNDABLE', depositIncomeRecognition: 'NOT_RECOGNIZED' })
    expect(result.data.rooms.map(room => room.name)).toEqual(current.rooms.map(room => room.name))
  })
})
