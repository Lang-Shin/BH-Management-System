import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router/app-router'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { TENANT_DEMO_STORAGE_KEY } from '@/app/providers/tenant-demo'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import { localStorageRepository, STORAGE_KEY } from '@/data/repositories/local-storage-repository'
import { parsePrototypeSnapshot } from '@/data/repositories/prototype-storage'
import { createDemoData, DEMO_DATE, DEMO_PERIOD } from '@/data/fixtures/demo'
import { createTenant, type TenantDraft } from '@/domain/calculations/tenant-management'
import { reconcileOccupancy, prepareMoveInPayment, selectMoveInObligations } from '@/domain/calculations/move-in'
import { preparePaymentCorrection } from '@/domain/calculations/payment-correction'
import { prepareRoomPayment } from '@/domain/calculations/room-payment'
import { createRoom } from '@/domain/calculations/room-management'
import { tenantRoomBilling } from '@/features/tenant/tenant-room-billing'
import { selectTenantReceipts } from '@/features/tenant/tenant-receipts'
import type { PrototypeAppState } from '@/domain/types/models'

const draft = (roomId: string, name: string): TenantDraft => ({
  name, email: `${name.replace(/\s/g, '.').toLowerCase()}@example.com`, phone: '+63 900 555 0123',
  address: 'Shared room test', roomId, moveInDate: '2026-11-01', notes: '',
})

function addTenant(data: PrototypeAppState, roomId: string, name: string) {
  const next = prototypeReducer(data, { type: 'tenant/created', draft: draft(roomId, name) })
  const tenant = next.tenants.find(item => item.name === name)!
  return { data: next, tenant }
}

function renderTenantApp(tenantId: string) {
  localStorage.setItem(TENANT_DEMO_STORAGE_KEY, tenantId)
  return render(<PrototypeProvider repository={localStorageRepository}><MemoryRouter initialEntries={['/tenant']}><AppRouter /></MemoryRouter></PrototypeProvider>)
}

describe('shared room financial visibility', () => {
  it('records one room-level move-in transaction and shows it to both current occupants', async () => {
    const first = addTenant(createDemoData(), 'room-9', 'Charles Shared')
    const second = addTenant(first.data, 'room-9', 'Charise Shared')
    const view = selectMoveInObligations(second.data, DEMO_DATE, 'room-9')[0]!
    const paid = prepareMoveInPayment(second.data, {
      obligationId: view.obligation.id, categories: ['ADVANCE', 'SECURITY_DEPOSIT'], paidOn: DEMO_DATE,
    })
    expect(paid.ok).toBe(true)
    if (!paid.ok) return
    expect(paid.data.payments.filter(payment => payment.id.startsWith('payment-move-in-'))).toHaveLength(1)
    expect(paid.data.receipts.filter(receipt => receipt.paymentId === paid.payment.id)).toHaveLength(1)
    expect(paid.payment).toMatchObject({
      scope: 'ROOM', tenantId: null, roomId: 'room-9', method: null, occupancyCycleId: view.cycle.id,
    })
    for (const tenant of [first.tenant, second.tenant]) {
      const receipts = selectTenantReceipts(paid.data, tenant.id).receipts
      const shared = receipts.filter(item => item.payment.id === paid.payment.id)
      expect(shared).toHaveLength(1)
      expect(shared[0]!.rooms.label).toBe('Room 01')
      expect(shared[0]!.viewerIsPayer).toBe(false)
      expect(shared[0]!.tenant).toBeNull()
    }
    await localStorageRepository.save(paid.data)
    renderTenantApp(first.tenant.id)
    const charlesSection = await screen.findByRole('region', { name: 'Move-in advance and security deposit' })
    expect(within(charlesSection).getAllByText('PAID')).toHaveLength(2)
    await userEvent.setup().selectOptions(screen.getByLabelText('Demo tenant'), second.tenant.id)
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Move-in advance and security deposit' })).getAllByText('PAID')).toHaveLength(2))
  })

  it('shows advance-only and deposit-only collections as separate full-category payments', () => {
    const first = addTenant(createDemoData(), 'room-9', 'Advance Payer')
    const second = addTenant(first.data, 'room-9', 'Deposit Payer')
    const view = selectMoveInObligations(second.data, DEMO_DATE, 'room-9')[0]!
    const advance = prepareMoveInPayment(second.data, { obligationId: view.obligation.id, categories: ['ADVANCE'], paidOn: DEMO_DATE })
    expect(advance.ok).toBe(true)
    if (!advance.ok) return
    expect(selectMoveInObligations(advance.data, DEMO_DATE, 'room-9')[0]).toMatchObject({
      advanceStatus: 'PAID', depositStatus: 'NOT PAID', advanceRemainingCents: 0, depositRemainingCents: 400_000,
    })
    const deposit = prepareMoveInPayment(advance.data, { obligationId: view.obligation.id, categories: ['SECURITY_DEPOSIT'], paidOn: '2026-11-14' })
    expect(deposit.ok).toBe(true)
    if (!deposit.ok) return
    expect(selectMoveInObligations(deposit.data, '2026-11-14', 'room-9')[0]).toMatchObject({ status: 'PAID' })
    expect(deposit.data.payments.filter(payment => payment.id.startsWith('payment-move-in-'))).toHaveLength(2)
    expect(deposit.data.receipts.filter(receipt => receipt.paymentId.startsWith('payment-move-in-'))).toHaveLength(2)
  })

  it('gives a new occupant of an active cycle access to the existing room obligation without duplicating it', () => {
    const first = addTenant(createDemoData(), 'room-9', 'First Occupant')
    const view = selectMoveInObligations(first.data, DEMO_DATE, 'room-9')[0]!
    const paid = prepareMoveInPayment(first.data, {
      obligationId: view.obligation.id, categories: ['ADVANCE', 'SECURITY_DEPOSIT'], paidOn: '2026-11-05',
    })
    expect(paid.ok).toBe(true)
    if (!paid.ok) return
    const joined = createTenant(paid.data, { ...draft('room-9', 'Later Roommate'), moveInDate: '2026-11-15' }, '2026-11-15')
    if (!joined.ok) throw new Error('Later occupant was not created')
    const next = reconcileOccupancy(paid.data, joined.data, '2026-11-15', { createMoveInObligations: true })
    expect(next.moveInObligations).toHaveLength(1)
    expect(next.charges.filter(charge => charge.category === 'ADVANCE' || charge.category === 'SECURITY_DEPOSIT')).toHaveLength(2)
    const receipts = selectTenantReceipts(next, joined.tenant.id).receipts
    expect(receipts.filter(item => item.payment.id === paid.payment.id)).toHaveLength(1)
  })

  it('shares monthly room billing and category statuses between roommates', () => {
    const data = createDemoData()
    const sam = tenantRoomBilling(data, 'tenant-2', 'room-2', DEMO_PERIOD, DEMO_DATE)
    const morgan = tenantRoomBilling(data, 'tenant-4', 'room-2', DEMO_PERIOD, DEMO_DATE)
    expect(sam).toMatchObject({
      status: 'PARTLY PAID', billedCents: morgan.billedCents, appliedCents: morgan.appliedCents,
      outstandingCents: morgan.outstandingCents, pendingCalculation: morgan.pendingCalculation,
    })
    expect(sam.categories.find(item => item.category === 'RENT')).toMatchObject({ status: 'PAID' })
    expect(sam.categories.find(item => item.category === 'ELECTRICITY')).toMatchObject({ status: 'AWAITING READING', outstandingCents: 0 })
    expect(sam.categories.find(item => item.category === 'WASHING_MACHINE')).toMatchObject({ status: 'PAID' })
    for (const tenantId of ['tenant-2', 'tenant-4']) {
      const view = tenantRoomBilling(data, tenantId, 'room-2', DEMO_PERIOD, DEMO_DATE)
      expect(view.categories.map(item => [item.category, item.status])).toEqual([
        ['RENT', 'PAID'], ['WATER', 'PAID'], ['ELECTRICITY', 'AWAITING READING'], ['WASHING_MACHINE', 'PAID'],
      ])
    }
    expect(tenantRoomBilling(data, 'tenant-5', 'room-4', DEMO_PERIOD, DEMO_DATE).categories.find(item => item.category === 'WASHING_MACHINE')).toMatchObject({ status: 'DID NOT AVAIL' })
    expect(tenantRoomBilling(data, 'tenant-1', 'room-1', DEMO_PERIOD, DEMO_DATE).categories.find(item => item.category === 'ELECTRICITY')).toMatchObject({ status: 'PAID' })
  })

  it('shares monthly receipts between roommates while keeping one receipt per transaction', () => {
    const data = createDemoData()
    for (const tenantId of ['tenant-2', 'tenant-4']) {
      const receipts = selectTenantReceipts(data, tenantId).receipts
      const ids = receipts.map(item => item.receipt.id)
      expect(ids).toContain('receipt-8')
      expect(ids).toContain('receipt-9')
      expect(ids).toContain('receipt-12')
      expect(ids).toContain('receipt-13')
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('reflects a corrected payment to both roommates without duplicating receipts', () => {
    const data = createDemoData()
    const corrected = preparePaymentCorrection(data, {
      paymentId: 'payment-2-water', selectedCategories: ['WATER'], correctedElectricityReadingMilliKwh: null,
      reason: 'Shared room correction', settlementStatus: 'CORRECTED', correctedAt: DEMO_DATE,
    })
    expect(corrected.ok).toBe(true)
    if (!corrected.ok) return
    for (const tenantId of ['tenant-2', 'tenant-4']) {
      const views = selectTenantReceipts(corrected.data, tenantId).receipts
      expect(views.filter(item => item.receipt.id === corrected.receipt.id)).toHaveLength(1)
      expect(views.find(item => item.receipt.id === 'receipt-8')?.effective).toBe(false)
    }
    expect(corrected.data.receipts.filter(receipt => receipt.id === corrected.receipt.id)).toHaveLength(1)
  })

  it('limits former occupants to receipts from their tenancy and blocks old cycles from new occupants', () => {
    const first = addTenant(createDemoData(), 'room-9', 'Charles Transfer')
    const second = addTenant(first.data, 'room-9', 'Charise Remain')
    const view = selectMoveInObligations(second.data, DEMO_DATE, 'room-9')[0]!
    const advance = prepareMoveInPayment(second.data, { obligationId: view.obligation.id, categories: ['ADVANCE'], paidOn: '2026-11-05' })
    expect(advance.ok).toBe(true)
    if (!advance.ok) return
    let data: PrototypeAppState = {
      ...advance.data,
      roomAssignments: advance.data.roomAssignments.map(assignment => assignment.tenantId === first.tenant.id && assignment.roomId === 'room-9'
        ? { ...assignment, endDate: '2026-11-10' }
        : assignment),
    }
    data.roomAssignments.push({ id: 'charles-room-10', tenantId: first.tenant.id, roomId: 'room-10', startDate: '2026-11-11', endDate: null, agreedRentCents: 400_000 })
    const deposit = prepareMoveInPayment(data, { obligationId: view.obligation.id, categories: ['SECURITY_DEPOSIT'], paidOn: '2026-11-12' })
    expect(deposit.ok).toBe(true)
    if (!deposit.ok) return
    data = deposit.data
    const charlesReceipts = selectTenantReceipts(data, first.tenant.id).receipts.map(item => item.payment.id)
    expect(charlesReceipts).toContain(advance.payment.id)
    expect(charlesReceipts).not.toContain(deposit.payment.id)
    expect(selectTenantReceipts(data, second.tenant.id).receipts.map(item => item.payment.id)).toEqual(expect.arrayContaining([advance.payment.id, deposit.payment.id]))

    const closed = prototypeReducer(data, { type: 'tenant/movedOut', tenantId: second.tenant.id })
    expect(closed.occupancyCycles.find(cycle => cycle.id === view.cycle.id)?.status).toBe('CLOSED')
    const nextTenant = createTenant(closed, { ...draft('room-9', 'Next Cycle Tenant'), moveInDate: '2026-11-20' }, '2026-11-20')
    if (!nextTenant.ok) throw new Error('Next tenant was not created')
    const next = reconcileOccupancy(closed, nextTenant.data, '2026-11-20', { createMoveInObligations: true })
    const nextCycle = next.occupancyCycles.find(cycle => cycle.roomId === 'room-9' && cycle.status === 'ACTIVE')!
    expect(nextCycle.id).not.toBe(view.cycle.id)
    const nextReceipts = selectTenantReceipts(next, nextTenant.tenant.id).receipts.map(item => item.payment.id)
    expect(nextReceipts).not.toContain(advance.payment.id)
    expect(nextReceipts).not.toContain(deposit.payment.id)
  })

  it('corrects a room-level monthly transaction for both occupants without duplicating receipts', () => {
    const room = createRoom(createDemoData(), { name: '908', capacity: 2, categoryId: 'RATE_4000', kind: 'PRIVATE', status: 'available' }, DEMO_DATE)
    if (!room.ok) throw new Error('Room creation failed')
    const first = addTenant(room.data, room.room.id, 'Correction One')
    const second = addTenant(first.data, room.room.id, 'Correction Two')
    const paid = prepareRoomPayment(second.data, { roomId: room.room.id, periodId: DEMO_PERIOD, selected: ['RENT', 'WATER'], electricityReadingMilliKwh: null, asOf: DEMO_DATE })
    expect(paid.ok).toBe(true)
    if (!paid.ok) return
    expect(paid.payments).toHaveLength(1)
    expect(paid.receipts).toHaveLength(1)
    const corrected = preparePaymentCorrection(paid.data, {
      paymentId: paid.payments[0]!.id, selectedCategories: ['RENT'], correctedElectricityReadingMilliKwh: null,
      reason: 'Water was recorded incorrectly', settlementStatus: 'CORRECTED', correctedAt: DEMO_DATE,
    })
    expect(corrected.ok).toBe(true)
    if (!corrected.ok) return
    for (const tenantId of [first.tenant.id, second.tenant.id]) {
      const receipts = selectTenantReceipts(corrected.data, tenantId).receipts
      expect(receipts.filter(item => item.receipt.id === corrected.receipt.id)).toHaveLength(1)
      expect(receipts.find(item => item.receipt.id === paid.receipts[0]!.id)?.effective).toBe(false)
      const billing = tenantRoomBilling(corrected.data, tenantId, room.room.id, DEMO_PERIOD, DEMO_DATE)
      expect(billing.status).toBe('PARTLY PAID')
      expect(billing.categories.find(item => item.category === 'WATER')).toMatchObject({ status: 'NOT PAID' })
    }
    expect(corrected.data.paymentCorrections).toHaveLength(1)
    expect(corrected.data.receipts.filter(item => item.id === corrected.receipt.id)).toHaveLength(1)
  })

  it('migrates version 11 tenant-owned payments without losing historical payer or method metadata', () => {
    const data = createDemoData()
    const legacyPayments = data.payments.map(({ scope, roomId, occupancyCycleId, ...payment }) => {
      void scope
      void roomId
      void occupancyCycleId
      return payment
    })
    const parsed = parsePrototypeSnapshot(JSON.stringify({ version: 11, data: { ...data, payments: legacyPayments } }))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.data.payments.every(payment => payment.scope === 'TENANT' && payment.roomId === null && payment.occupancyCycleId === null)).toBe(true)
    expect(parsed.data.payments.find(payment => payment.id === 'payment-1-rent-water-washing')).toMatchObject({
      tenantId: 'tenant-1', method: 'cash',
    })
    expect(parsed.data.receipts).toEqual(data.receipts)
    expect(parsed.data.paymentCorrections).toEqual(data.paymentCorrections)
  })

  it('persists room-level payments and preserves a single shared receipt after reload', async () => {
    const first = addTenant(createDemoData(), 'room-9', 'Persisted Room Payer')
    const view = selectMoveInObligations(first.data, DEMO_DATE, 'room-9')[0]!
    const paid = prepareMoveInPayment(first.data, { obligationId: view.obligation.id, categories: ['ADVANCE'], paidOn: DEMO_DATE })
    expect(paid.ok).toBe(true)
    if (!paid.ok) return
    expect(await localStorageRepository.save(paid.data)).toBeNull()
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!).data as PrototypeAppState
    expect(saved.payments.find(payment => payment.id === paid.payment.id)).toMatchObject({ scope: 'ROOM', tenantId: null, method: null })
    expect(saved.receipts.filter(receipt => receipt.paymentId === paid.payment.id)).toHaveLength(1)
    expect(selectTenantReceipts(saved, first.tenant.id).receipts.filter(item => item.payment.id === paid.payment.id)).toHaveLength(1)
  })
})
