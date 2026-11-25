import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router/app-router'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import { createDemoData, DEMO_DATE } from '@/data/fixtures/demo'
import { localStorageRepository, STORAGE_KEY } from '@/data/repositories/local-storage-repository'
import { prepareMoveInPayment, selectMoveInObligations } from '@/domain/calculations/move-in'
import { prepareRentPrepayment } from '@/domain/calculations/rent-schedule'
import type { PrototypeAppState } from '@/domain/types/models'
import type { TenantDraft } from '@/domain/calculations/tenant-management'

function draft(overrides: Partial<TenantDraft> = {}): TenantDraft {
  return {
    name: 'Review UI Tenant', email: 'review-ui@example.com', phone: '+63 900 555 0122',
    address: 'Review Street, Demo City', roomId: 'room-14', moveInDate: '2026-11-13', notes: '', ...overrides,
  }
}

function createTenant(data: PrototypeAppState, overrides: Partial<TenantDraft> = {}, asOf = '2026-11-13') {
  const next = prototypeReducer(data, { type: 'tenant/created', draft: draft(overrides), asOf })
  return { data: next, tenant: next.tenants.find(item => item.email === (overrides.email ?? draft().email))! }
}

const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY)!).data

function payMoveIn(data: PrototypeAppState, roomId: string, paidOn: string) {
  const view = selectMoveInObligations(data, paidOn, roomId).find(item => item.cycle.status === 'ACTIVE')!
  const paid = prepareMoveInPayment(data, { obligationId: view.obligation.id, categories: ['ADVANCE', 'SECURITY_DEPOSIT'], paidOn })
  if (!paid.ok) throw new Error(paid.reason)
  return paid.data
}

describe('transfer financial review notice', () => {
  it('opens compact review details, hides without resolving, and resolves only after acknowledgment', async () => {
    const user = userEvent.setup()
    const first = createTenant(createDemoData())
    const firstPaid = payMoveIn(first.data, 'room-14', DEMO_DATE)
    const second = createTenant(firstPaid, {
      name: 'Occupied Review Destination', email: 'occupied-review@example.com', roomId: 'room-15',
    }, '2026-11-14')
    const secondPaid = payMoveIn(second.data, 'room-15', '2026-11-14')
    const beforePayments = JSON.stringify(secondPaid.payments)
    const beforeAllocations = JSON.stringify(secondPaid.paymentAllocations)
    const secondTenant = second.tenant
    const transferred = prototypeReducer(secondPaid, {
      type: 'tenant/updated', tenantId: secondTenant.id, asOf: '2026-11-18',
      draft: draft({
        name: secondTenant.name, email: secondTenant.email, phone: secondTenant.phone, address: secondTenant.address,
        roomId: 'room-14', moveInDate: '2026-11-18',
      }),
    })
    expect(JSON.stringify(transferred.payments)).toBe(beforePayments)
    expect(JSON.stringify(transferred.paymentAllocations)).toBe(beforeAllocations)
    await localStorageRepository.save(transferred)

    render(<PrototypeProvider repository={localStorageRepository}><MemoryRouter initialEntries={['/billing']}><AppRouter /></MemoryRouter></PrototypeProvider>)
    expect(await screen.findByText('1 transfer review item needs attention')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'View' }))
    const dialog = await screen.findByRole('dialog', { name: 'Financial review items' })
    expect(within(dialog).getByText(/Destination room already has an occupancy rent schedule/)).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: 'Hide for now' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Financial review items' })).not.toBeInTheDocument())
    expect(stored().financialReviewCases.some((review: { status: string }) => review.status === 'OPEN')).toBe(true)

    await user.click(screen.getByRole('button', { name: 'View' }))
    const reopened = await screen.findByRole('dialog', { name: 'Financial review items' })
    await user.click(within(reopened).getByRole('button', { name: 'Resolve review' }))
    const resolution = await screen.findByRole('dialog', { name: 'Resolve financial review' })
    await user.type(within(resolution).getByLabelText('Resolution reason'), 'Reviewed the destination and source periods.')
    await user.click(within(resolution).getByRole('button', { name: 'Confirm resolution' }))
    expect(await within(resolution).findByText(/reviewed the financial treatment/i)).toBeInTheDocument()
    await user.click(within(resolution).getByLabelText(/I reviewed this financial case/))
    await user.click(within(resolution).getByRole('button', { name: 'Confirm resolution' }))
    await waitFor(() => expect(screen.queryByText(/transfer review item/)).not.toBeInTheDocument())
    await waitFor(() => expect(stored().financialReviewCases.every((review: { status: string }) => review.status !== 'OPEN')).toBe(true))
    expect(stored().payments).toEqual(secondPaid.payments)
    expect(stored().receipts).toEqual(secondPaid.receipts)
  })

  it('counts open review items rather than transfers', async () => {
    const data = createDemoData()
    data.financialReviewCases = [
      { id: 'review-count-a', type: 'TRANSFER_RENT_DIFFERENCE', roomId: data.rooms[0]!.id, occupancyCycleId: null, tenantId: null, rentalPeriodId: null, status: 'OPEN', note: 'First review item', createdAt: DEMO_DATE, resolvedAt: null },
      { id: 'review-count-b', type: 'TRANSFER_RENT_DIFFERENCE', roomId: data.rooms[0]!.id, occupancyCycleId: null, tenantId: null, rentalPeriodId: null, status: 'OPEN', note: 'Second review item', createdAt: DEMO_DATE, resolvedAt: null },
    ]
    await localStorageRepository.save(data)
    render(<PrototypeProvider repository={localStorageRepository}><MemoryRouter initialEntries={['/billing']}><AppRouter /></MemoryRouter></PrototypeProvider>)
    expect(await screen.findByText('2 transfer review items need attention')).toBeVisible()
  })

  it('keeps a prepaid transfer review open until the financial operation is handled', async () => {
    const user = userEvent.setup()
    const first = createTenant(createDemoData())
    const firstPaid = payMoveIn(first.data, 'room-14', DEMO_DATE)
    const sourceCycle = firstPaid.occupancyCycles.find(cycle => cycle.roomId === 'room-14' && cycle.status === 'ACTIVE')!
    const prepaid = prepareRentPrepayment(firstPaid, { cycleId: sourceCycle.id, periodCount: 1, paidOn: DEMO_DATE })
    if (!prepaid.ok) throw new Error(prepaid.reason)
    const tenant = prepaid.data.tenants.find(item => item.id === first.tenant.id)!
    const transferred = prototypeReducer(prepaid.data, {
      type: 'tenant/updated', tenantId: tenant.id, asOf: '2026-11-20',
      draft: draft({ name: tenant.name, email: tenant.email, phone: tenant.phone, address: tenant.address, roomId: 'room-15', moveInDate: '2026-11-20' }),
    })
    const beforePayments = JSON.stringify(transferred.payments)
    const beforeReceipts = JSON.stringify(transferred.receipts)
    await localStorageRepository.save(transferred)
    render(<PrototypeProvider repository={localStorageRepository}><MemoryRouter initialEntries={['/billing']}><AppRouter /></MemoryRouter></PrototypeProvider>)
    expect(await screen.findByText('1 transfer review item needs attention')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'View' }))
    const list = await screen.findByRole('dialog', { name: 'Financial review items' })
    expect(within(list).getByText(/Source prepaid rent is still actively covering/)).toBeVisible()
    await user.click(within(list).getByRole('button', { name: 'Resolve review' }))
    const resolution = await screen.findByRole('dialog', { name: 'Resolve financial review' })
    await user.type(within(resolution).getByLabelText('Resolution reason'), 'Attempted review before refund')
    await user.click(within(resolution).getByLabelText(/I reviewed this financial case/))
    await user.click(within(resolution).getByRole('button', { name: 'Confirm resolution' }))
    expect(await within(resolution).findByText(/still actively covering/)).toBeVisible()
    expect(stored().financialReviewCases.some((review: { status: string }) => review.status === 'OPEN')).toBe(true)
    expect(JSON.stringify(stored().payments)).toBe(beforePayments)
    expect(JSON.stringify(stored().receipts)).toBe(beforeReceipts)
  })
})
