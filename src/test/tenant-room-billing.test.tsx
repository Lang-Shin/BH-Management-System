import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router/app-router'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { createDemoData, DEMO_DATE, DEMO_PERIOD } from '@/data/fixtures/demo'
import { localStorageRepository } from '@/data/repositories/local-storage-repository'
import { tenantRoomBilling } from '@/features/tenant/tenant-room-billing'
import { preparePaymentCorrection } from '@/domain/calculations/payment-correction'
import { TENANT_DEMO_STORAGE_KEY } from '@/app/providers/tenant-demo'

describe('tenant room billing status and ownership', () => {
  it('derives PAID, PARTLY PAID, and NOT PAID from issued room charges and active allocations', () => {
    const data = createDemoData()
    expect(tenantRoomBilling(data, 'tenant-1', 'room-1', DEMO_PERIOD, DEMO_DATE)).toMatchObject({ status: 'PAID', unsettled: [] })
    expect(tenantRoomBilling(data, 'tenant-2', 'room-2', DEMO_PERIOD, DEMO_DATE)).toMatchObject({
      status: 'PARTLY PAID', outstandingCents: 0, pendingCalculation: true,
      unsettled: [{ category: 'ELECTRICITY', outstandingCents: 0, pendingCalculation: true }],
    })
    const unpaid = tenantRoomBilling(data, 'tenant-5', 'room-4', DEMO_PERIOD, DEMO_DATE)
    expect(unpaid.status).toBe('NOT PAID')
    expect(unpaid.unsettled).toEqual([
      { category: 'RENT', outstandingCents: 350_000, pendingCalculation: false },
      { category: 'WATER', outstandingCents: 20_000, pendingCalculation: false },
      { category: 'ELECTRICITY', outstandingCents: 0, pendingCalculation: true },
    ])
    expect(unpaid.unsettled.some(item => item.category === 'WASHING_MACHINE')).toBe(false)
  })

  it('counts a partial allocation as PARTLY PAID even when no category has been fully settled', () => {
    const data = createDemoData()
    data.payments = [{ id: 'partial-water', scope: 'TENANT' as const, roomId: null, occupancyCycleId: null, tenantId: 'tenant-5', amountCents: 5_000, paidOn: DEMO_DATE, method: 'cash', state: 'RECORDED', correction: null }]
    data.paymentAllocations = [{ id: 'partial-allocation', paymentId: 'partial-water', chargeId: 'water-nov-tenant-5', amountCents: 5_000, allocatedOn: DEMO_DATE, creditId: null, state: 'ACTIVE', reversalAuditEventId: null }]
    const view = tenantRoomBilling(data, 'tenant-5', 'room-4', DEMO_PERIOD, DEMO_DATE)
    expect(view.status).toBe('PARTLY PAID')
    expect(view.appliedCents).toBe(5_000)
    expect(view.unsettled.find(item => item.category === 'WATER')?.outstandingCents).toBe(15_000)
  })

  it('does not turn missing bills, missing tenancy, or unresolved attribution into NOT PAID', () => {
    const data = createDemoData()
    expect(tenantRoomBilling(data, 'tenant-1', 'room-15', DEMO_PERIOD, DEMO_DATE).status).toBe('UNAVAILABLE')
    data.roomAssignments.push({ id: 'new-tenancy', tenantId: 'tenant-9', roomId: 'room-15', startDate: '2026-11-01', endDate: null, agreedRentCents: 500_000 })
    expect(tenantRoomBilling(data, 'tenant-9', 'room-15', DEMO_PERIOD, DEMO_DATE).status).toBe('NOT PAID')
    const awaitingOnly = { ...data, charges: [] }
    expect(tenantRoomBilling(awaitingOnly, 'tenant-2', 'room-2', DEMO_PERIOD, DEMO_DATE).status).toBe('NOT PAID')
    data.roomAssignments.find(item => item.id === 'assignment-2')!.endDate = '2026-11-06'
    data.roomAssignments.push({ id: 'transfer', tenantId: 'tenant-2', roomId: 'room-15', startDate: '2026-11-07', endDate: null, agreedRentCents: 500_000 })
    expect(tenantRoomBilling(data, 'tenant-9', 'room-2', DEMO_PERIOD, DEMO_DATE).status).toBe('UNAVAILABLE')
  })

  it('recalculates after a correction and does not count reversed allocations or advance credit', () => {
    const data = createDemoData()
    const original = tenantRoomBilling(data, 'tenant-1', 'room-1', DEMO_PERIOD, DEMO_DATE)
    const corrected = preparePaymentCorrection(data, {
      paymentId: 'payment-1-rent-water-washing', selectedCategories: ['RENT', 'WASHING_MACHINE'],
      correctedElectricityReadingMilliKwh: null, reason: 'Water was recorded incorrectly',
      settlementStatus: 'CORRECTED', correctedAt: DEMO_DATE,
    })
    expect(corrected.ok).toBe(true)
    if (!corrected.ok) return
    const view = tenantRoomBilling(corrected.data, 'tenant-1', 'room-1', DEMO_PERIOD, DEMO_DATE)
    expect(view.status).toBe('PARTLY PAID')
    expect(view.appliedCents).toBe(original.appliedCents - 10_000)
    expect(view.unsettled).toEqual([{ category: 'WATER', outstandingCents: 10_000, pendingCalculation: false }])
    expect(tenantRoomBilling(data, 'tenant-6', 'room-3', 'period-oct', DEMO_DATE).status).toBe('NOT PAID')
    expect(tenantRoomBilling(data, 'tenant-6', 'room-3', DEMO_PERIOD, DEMO_DATE).status).toBe('PAID')
  })
})

describe('room-first tenant overview', () => {
  it('shows current occupants only with singular/plural titles and period-specific unpaid categories', async () => {
    const user = userEvent.setup()
    render(<PrototypeProvider repository={localStorageRepository}><MemoryRouter initialEntries={['/tenant']}><AppRouter /></MemoryRouter></PrototypeProvider>)
    const room = await screen.findByRole('region', { name: 'Room overview' })
    expect(within(room).getByRole('heading', { name: 'Room 1', level: 2 })).toHaveClass('text-5xl')
    expect(within(room).getByRole('heading', { name: 'Tenant' })).toBeInTheDocument()
    expect(within(room).queryByText('Avery Lim')).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Demo tenant'), 'tenant-2')
    expect(within(room).getByRole('heading', { name: 'Tenants' })).toBeInTheDocument()
    expect(within(room).getByText('Sam Navarro')).toBeInTheDocument()
    expect(within(room).getByText('Morgan Cruz')).toBeInTheDocument()
    const bills = screen.getByRole('region', { name: 'Monthly room billing' })
    expect(within(bills).getByRole('status')).toHaveTextContent('PARTLY PAID')
    expect(screen.getByRole('region', { name: 'Bill categories' })).toHaveTextContent('ElectricityAWAITING READING')
    expect(within(bills).queryByText('₱13.00')).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Billing month'), 'period-oct')
    expect(screen.getByRole('region', { name: 'Bill categories' })).toHaveTextContent(/Rent.*3,500\.00/)
    expect(within(bills).queryByText('Sam Navarro')).not.toBeInTheDocument()
    expect(within(bills).queryByText('Morgan Cruz')).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Demo tenant'), 'tenant-7')
    expect(within(room).getByRole('heading', { name: 'No current tenants' })).toBeInTheDocument()
    expect(within(bills).getByRole('status')).toHaveTextContent('UNAVAILABLE')
  })

  it('preserves the leading zero for an assigned Room 02 without showing Room 2 bills', async () => {
    const data = createDemoData()
    data.tenants.push({ ...data.tenants[0]!, id: 'tenant-new', name: 'New demo occupant' })
    data.roomAssignments.push({ id: 'assignment-new', tenantId: 'tenant-new', roomId: 'room-15', startDate: '2026-11-01', endDate: null, agreedRentCents: 500_000 })
    localStorage.setItem(TENANT_DEMO_STORAGE_KEY, 'tenant-new')
    const repository = { load: async () => ({ data, warning: null, canPersist: false }), save: async () => null }
    render(<PrototypeProvider repository={repository}><MemoryRouter initialEntries={['/tenant']}><AppRouter /></MemoryRouter></PrototypeProvider>)
    const room = await screen.findByRole('region', { name: 'Room overview' })
    expect(within(room).getByRole('heading', { name: 'Room 02' })).toBeInTheDocument()
    expect(within(room).getByText('Rate category 3 — Private CR + Aircon')).toBeInTheDocument()
    expect(within(room).queryByText('Room 2')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Monthly room billing' })).not.toHaveTextContent('Pending calculation')
    expect(within(screen.getByRole('region', { name: 'Monthly room billing' })).getByRole('status')).toHaveTextContent('NOT PAID')
  })
})
