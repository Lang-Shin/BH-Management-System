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
import { MOVE_IN_UI_STORAGE_KEY } from '@/features/billing/move-in-section'

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
  it('starts expanded and keeps mounted controls, collapsed metrics, and financial records intact through keyboard toggles', async () => {
    const user = userEvent.setup()
    const seeded = prototypeReducer(createDemoData(), { type: 'tenant/created', draft })
    await localStorageRepository.save(seeded)
    renderApp()
    const section = await screen.findByRole('region', { name: 'Move-in advance & security deposit' })
    const toggle = within(section).getByRole('button', { name: 'Collapse move-in advance and security deposit' })
    const policy = within(section).getByLabelText('Security deposit terms')
    const details = document.getElementById(toggle.getAttribute('aria-controls')!)!
    const before = localStorage.getItem(STORAGE_KEY)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(details).toHaveAttribute('aria-hidden', 'false')
    expect(within(section).getByRole('heading', { name: 'Room payment records' })).toBeInTheDocument()
    toggle.focus()
    await user.keyboard('{Enter}')
    expect(toggle).toHaveAccessibleName('Expand move-in advance and security deposit')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveFocus()
    expect(details).toHaveAttribute('aria-hidden', 'true')
    expect(details).toHaveAttribute('inert')
    expect(policy).toBeInTheDocument()
    expect(within(section).queryByRole('combobox', { name: 'Security deposit terms' })).not.toBeInTheDocument()
    expect(within(section).queryByRole('button', { name: 'Record move-in payment for room 01' })).not.toBeInTheDocument()
    const header = section.querySelector('.move-in-heading')!
    expect(header).toHaveTextContent('Still to collect₱8,000.00')
    expect(header).toHaveTextContent('0 of 1 fully settled')
    expect(sessionStorage.getItem(MOVE_IN_UI_STORAGE_KEY)).toBe('false')
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before)
    await user.keyboard(' ')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(details).not.toHaveAttribute('inert')
    expect(within(section).getByLabelText('Security deposit terms')).toBe(policy)
    expect(within(section).getByRole('button', { name: 'Record move-in payment for room 01' })).toBeEnabled()
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before)
  })

  it('remembers the UI-only collapsed preference when navigating back to Billing', async () => {
    const user = userEvent.setup()
    renderApp()
    const toggle = await screen.findByRole('button', { name: 'Collapse move-in advance and security deposit' })
    await user.click(toggle)
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    await user.click(within(nav).getByRole('link', { name: 'Payments & Receipts' }))
    await screen.findByRole('heading', { level: 1, name: 'Payments & Receipts' })
    await user.click(within(nav).getByRole('link', { name: 'Billing' }))
    expect(await screen.findByRole('button', { name: 'Expand move-in advance and security deposit' })).toHaveAttribute('aria-expanded', 'false')
    await user.click(screen.getByRole('button', { name: 'Expand move-in advance and security deposit' }))
    expect(screen.getByLabelText('Advance application policy')).toBeInTheDocument()
  })

  it('uses a single responsive row action and preserves fully settled payment eligibility', async () => {
    const seeded = prototypeReducer(createDemoData(), { type: 'tenant/created', draft })
    const view = selectMoveInObligations(seeded, '2026-11-13', 'room-9')[0]!
    const paid = prepareMoveInPayment(seeded, {
      obligationId: view.obligation.id, payerTenantId: seeded.tenants.at(-1)!.id,
      advanceCents: 400_000, depositCents: 400_000, paidOn: '2026-11-13', method: 'cash',
    })
    if (!paid.ok) throw new Error('Seed payment failed')
    await localStorageRepository.save(paid.data)
    renderApp()
    const section = await screen.findByRole('region', { name: 'Move-in advance & security deposit' })
    expect(within(section).getAllByRole('table')).toHaveLength(1)
    const actions = within(section).getAllByRole('button', { name: 'Record move-in payment for room 01' })
    expect(actions).toHaveLength(1)
    expect(actions[0]).toBeDisabled()
    expect(actions[0]).toHaveTextContent('Fully settled')
    expect(section.querySelector('.move-in-heading')).toHaveTextContent('1 of 1 fully settled')
  })

  it('records a room-level move-in payment and persists its receipt', async () => {
    const user = userEvent.setup()
    const seeded = prototypeReducer(createDemoData(), { type: 'tenant/created', draft })
    const tenant = seeded.tenants.find(item => item.name === 'Move-in UI Tenant')!
    await localStorageRepository.save(seeded)
    renderApp()

    const section = await screen.findByRole('region', { name: 'Move-in advance & security deposit' })
    expect(within(section).getByText('Room 01')).toBeInTheDocument()
    expect(within(section).getAllByText(/Non-refundable/).length).toBeGreaterThan(0)
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
    expect(within(section).getByText('Security deposit (non-refundable)')).toBeVisible()
    expect(within(section).getByText(/The advance is not automatically used to pay a month. The security deposit is non-refundable and is not counted as rent income/)).toBeVisible()
  })

  it('updates and persists the versioned deposit policy for future obligations only', async () => {
    const user = userEvent.setup()
    const seeded = prototypeReducer(createDemoData(), { type: 'tenant/created', draft })
    const obligation = seeded.moveInObligations[0]!
    await localStorageRepository.save(seeded)
    renderApp()
    const section = await screen.findByRole('region', { name: 'Move-in advance & security deposit' })
    await user.selectOptions(within(section).getByLabelText('Security deposit terms'), 'MANUAL_REVIEW')
    expect(within(section).getByRole('status')).toHaveTextContent('Deposit policy updated for future obligations.')
    await waitFor(() => {
      const data = savedData()
      expect(data.moveInPolicy).toMatchObject({ version: 3, depositDisposition: 'MANUAL_REVIEW', depositIncomeRecognition: 'NOT_RECOGNIZED' })
      expect(data.moveInObligations[0]).toEqual(obligation)
    })
  })

  it('shows non-refundable deposit terms on tenant payment receipts', async () => {
    const seeded = prototypeReducer(createDemoData(), { type: 'tenant/created', draft })
    const tenant = seeded.tenants.find(item => item.name === 'Move-in UI Tenant')!
    const view = selectMoveInObligations(seeded, '2026-11-13', 'room-9')[0]!
    const paid = prepareMoveInPayment(seeded, {
      obligationId: view.obligation.id, payerTenantId: tenant.id,
      advanceCents: 0, depositCents: 100_000, paidOn: '2026-11-13', method: 'cash',
    })
    if (!paid.ok) throw new Error('Seed payment failed')
    await localStorageRepository.save(paid.data)
    localStorage.setItem(TENANT_DEMO_STORAGE_KEY, tenant.id)
    renderApp('/tenant/payments')
    expect(await screen.findByText('Security deposit is non-refundable under the recorded policy. It remains separate from rent and is not recognized as rental income.')).toBeVisible()
  })
})
