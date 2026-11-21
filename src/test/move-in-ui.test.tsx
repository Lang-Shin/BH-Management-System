import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router/app-router'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { TENANT_DEMO_STORAGE_KEY } from '@/app/providers/tenant-demo'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import { localStorageRepository, STORAGE_KEY } from '@/data/repositories/local-storage-repository'
import { createDemoData } from '@/data/fixtures/demo'
import { prepareMoveInPayment, selectMoveInObligations } from '@/domain/calculations/move-in'
import type { TenantDraft } from '@/domain/calculations/tenant-management'
import type { PrototypeAppState } from '@/domain/types/models'

function renderApp(route = '/billing') {
  return render(<PrototypeProvider repository={localStorageRepository}><MemoryRouter initialEntries={[route]}><AppRouter /></MemoryRouter></PrototypeProvider>)
}

function savedData(): PrototypeAppState {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null').data
}

const draft: TenantDraft = {
  name: 'Move-in UI Tenant', email: 'movein-ui@example.com', phone: '+63 900 555 0110',
  address: '3 Test Street, Demo City', roomId: 'room-9', moveInDate: '2026-11-01', notes: '',
}

describe('move-in advance and security deposit UI', () => {
  it('records a room-level move-in payment and persists its receipt', async () => {
    const user = userEvent.setup()
    const seeded = prototypeReducer(createDemoData(), { type: 'tenant/created', draft })
    const tenant = seeded.tenants.find(item => item.name === 'Move-in UI Tenant')!
    await localStorageRepository.save(seeded)
    renderApp()

    const section = await screen.findByRole('region', { name: 'Move-in advance & security deposit' })
    expect(within(section).getByText('Room 01')).toBeInTheDocument()
    await user.click(within(section).getByRole('button', { name: 'Record move-in payment for room 01' }))
    const dialog = await screen.findByRole('dialog', { name: 'Record a move-in payment.' })
    expect(within(dialog).getByLabelText(/^Advance/)).toHaveValue('4000.00')
    expect(within(dialog).getByLabelText(/^Security deposit/)).toHaveValue('4000.00')
    await user.click(within(dialog).getByRole('button', { name: 'Record payment' }))

    expect(await within(dialog).findByText('Move-in payment saved.')).toBeInTheDocument()
    expect(within(dialog).getByText(/DEMO-RCT-/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Record a move-in payment.' })).not.toBeInTheDocument())

    await waitFor(() => {
      const data = savedData()
      const view = selectMoveInObligations(data, '2026-11-13', 'room-9')[0]!
      expect(view.status).toBe('PAID')
      expect(view.advancePaidCents).toBe(400_000)
      expect(view.depositPaidCents).toBe(400_000)
      expect(data.payments.filter(payment => payment.tenantId === tenant.id)).toHaveLength(1)
      expect(data.paymentAllocations.filter(allocation => allocation.paymentId === data.payments.at(-1)!.id)).toHaveLength(2)
      expect(data.receipts.filter(receipt => receipt.paymentId === data.payments.at(-1)!.id)).toHaveLength(1)
    })
    expect(within(section).getAllByText('PAID', { selector: '.move-in-status' })).toHaveLength(3)
  }, 30000)

  it('does not invent move-in balances for the sample legacy tenancies', async () => {
    renderApp()
    const section = await screen.findByRole('region', { name: 'Move-in advance & security deposit' })
    expect(within(section).getByText(/No move-in obligation recorded yet/)).toBeInTheDocument()
    expect(within(section).queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument()
  })

  it('shows move-in reporting outside the collapsed settings disclosure', async () => {
    renderApp('/reports')
    expect(await screen.findByRole('heading', { name: 'Advance & security deposit' })).toBeVisible()
    expect(screen.getByText('Move-in outstanding')).toBeVisible()
    expect(screen.getByText('No move-in obligations are recorded yet.')).toBeVisible()
  })

  it('shows the room-level move-in balances to an assigned tenant', async () => {
    const seeded = prototypeReducer(createDemoData(), { type: 'tenant/created', draft })
    const tenant = seeded.tenants.find(item => item.name === 'Move-in UI Tenant')!
    const view = selectMoveInObligations(seeded, '2026-11-13', 'room-9')[0]!
    const paid = prepareMoveInPayment(seeded, {
      obligationId: view.obligation.id, payerTenantId: tenant.id,
      advanceCents: 100_000, depositCents: 0, paidOn: '2026-11-13', method: 'cash',
    })
    if (!paid.ok) throw new Error('Seed payment failed')
    await localStorageRepository.save(paid.data)
    localStorage.setItem(TENANT_DEMO_STORAGE_KEY, tenant.id)
    renderApp('/tenant')
    const section = await screen.findByRole('region', { name: 'Move-in advance and security deposit' })
    expect(within(section).getByText('₱1,000.00 paid of ₱4,000.00')).toBeVisible()
    expect(within(section).getByText('₱3,000.00 remaining')).toBeVisible()
    expect(within(section).getByText('The advance is not automatically used to pay a month. Deposit refund or deduction needs manual review. Monthly bills remain separate.')).toBeVisible()
  })
})
