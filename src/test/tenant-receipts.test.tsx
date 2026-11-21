import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router/app-router'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { localStorageRepository } from '@/data/repositories/local-storage-repository'
import { createDemoData } from '@/data/fixtures/demo'
import { selectTenantReceipts } from '@/features/tenant/tenant-receipts'
import type { PrototypeData } from '@/domain/types/models'

function renderReceipts(repository = localStorageRepository) {
  return render(<PrototypeProvider repository={repository}><MemoryRouter initialEntries={['/tenant/payments']}><AppRouter /></MemoryRouter></PrototypeProvider>)
}

async function waitForPage() {
  expect(await screen.findByRole('heading', { level: 1, name: 'My Payments & Receipts' })).toBeInTheDocument()
}

describe('tenant digital receipts', () => {
  it('defaults to the current billing month and shows every receipt in it', async () => {
    renderReceipts()
    await waitForPage()
    expect(screen.getByLabelText('Billing month')).toHaveValue('period-nov')
    expect(screen.getByText('2 receipts for November 2026 (sample).')).toBeInTheDocument()

    const card = screen.getByRole('article', { name: 'Receipt DEMO-RCT-006' })
    expect(within(card).getByText('November 2026 (sample)')).toBeInTheDocument()
    expect(within(card).getByText('Nov 8, 2026')).toBeInTheDocument()
    expect(within(card).getByText('Room 1')).toBeInTheDocument()
    expect(within(card).getByText('Alex Rivera')).toBeInTheDocument()
    expect(within(card).getByText('Amount paid')).toBeInTheDocument()
    expect(within(card).getByText('₱3,700.00')).toBeInTheDocument()
    expect(within(card).getByText('Issued')).toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'Receipt DEMO-RCT-007' })).toBeInTheDocument()
    expect(screen.queryByRole('article', { name: 'Receipt DEMO-RCT-002' })).not.toBeInTheDocument()
  })

  it('shows only included categories in the shared read-only transaction breakdown', async () => {
    renderReceipts()
    await waitForPage()
    const rentReceipt = screen.getByRole('article', { name: 'Receipt DEMO-RCT-006' })
    const breakdown = within(rentReceipt).getByRole('region', { name: 'What Was Paid' })
    expect(within(breakdown).getByText('Rent')).toBeInTheDocument()
    expect(within(breakdown).queryByText('Electricity')).not.toBeInTheDocument()
    expect(within(breakdown).getByText('Water')).toBeInTheDocument()
    expect(within(breakdown).getByText('Washing machine')).toBeInTheDocument()
    expect(within(rentReceipt).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(within(rentReceipt).queryByRole('button', { name: 'Edit Payment' })).not.toBeInTheDocument()
    expect(within(rentReceipt).getByText('₱3,500.00')).toBeInTheDocument()
    expect(within(rentReceipt).getByText(/Other bills may be settled by separate transactions/)).toBeInTheDocument()

    const electricityReceipt = screen.getByRole('article', { name: 'Receipt DEMO-RCT-007' })
    expect(within(electricityReceipt).getByText('Electricity')).toBeInTheDocument()
    expect(within(electricityReceipt).queryByText('Rent')).not.toBeInTheDocument()
    expect(within(electricityReceipt).getAllByText('₱169.00')).toHaveLength(2)
    expect(within(electricityReceipt).getByText('312 → 325 kWh · 13 kWh × ₱13.00/kWh')).toBeInTheDocument()
  })

  it('lets the tenant view historical billing months', async () => {
    const user = userEvent.setup()
    renderReceipts()
    await waitForPage()
    await user.selectOptions(screen.getByLabelText('Billing month'), 'period-oct')
    const card = await screen.findByRole('article', { name: 'Receipt DEMO-RCT-002' })
    expect(within(card).getByText('October 2026 (sample)')).toBeInTheDocument()
    expect(within(card).getByText('Nov 2, 2026')).toBeInTheDocument()
    expect(within(card).getByText('₱3,856.00')).toBeInTheDocument()
    expect(within(card).getByText('Electricity')).toBeInTheDocument()
    expect(screen.queryByRole('article', { name: 'Receipt DEMO-RCT-006' })).not.toBeInTheDocument()
    expect(screen.getByText('1 receipt for October 2026 (sample).')).toBeInTheDocument()
  })

  it('shares room receipts with every authorized occupant', async () => {
    const user = userEvent.setup()
    renderReceipts()
    await waitForPage()
    await user.selectOptions(screen.getByLabelText('Demo tenant'), 'tenant-2')
    const samWater = await screen.findByRole('article', { name: 'Receipt DEMO-RCT-008' })
    expect(within(samWater).getByText('Room 2')).toBeInTheDocument()
    expect(within(samWater).getByText('Sam Navarro')).toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'Receipt DEMO-RCT-009' })).toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'Receipt DEMO-RCT-012' })).toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'Receipt DEMO-RCT-013' })).toBeInTheDocument()
    expect(within(screen.getByRole('article', { name: 'Receipt DEMO-RCT-012' })).getByText('Shared room payment')).toBeInTheDocument()
    expect(within(screen.getByRole('article', { name: 'Receipt DEMO-RCT-012' })).queryByText('Morgan Cruz')).not.toBeInTheDocument()
    expect(screen.queryByRole('article', { name: 'Receipt DEMO-RCT-006' })).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Demo tenant'), 'tenant-4')
    const morganRent = await screen.findByRole('article', { name: 'Receipt DEMO-RCT-012' })
    expect(within(morganRent).getByText('Room 2')).toBeInTheDocument()
    expect(within(morganRent).getByText('Morgan Cruz')).toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'Receipt DEMO-RCT-013' })).toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'Receipt DEMO-RCT-008' })).toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'Receipt DEMO-RCT-009' })).toBeInTheDocument()
    expect(within(screen.getByRole('article', { name: 'Receipt DEMO-RCT-008' })).getByText('Shared room payment')).toBeInTheDocument()
  })

  it('shows an advance receipt with no bill categories and an unallocated amount', async () => {
    const user = userEvent.setup()
    renderReceipts()
    await waitForPage()
    await user.selectOptions(screen.getByLabelText('Demo tenant'), 'tenant-6')
    const advance = await screen.findByRole('article', { name: 'Receipt DEMO-RCT-014' })
    expect(screen.getByRole('article', { name: 'Receipt DEMO-RCT-011' })).toBeInTheDocument()
    expect(within(advance).getAllByText('₱500.00')).toHaveLength(2)
    expect(within(advance).getByText('Advance payment — Unallocated')).toBeInTheDocument()
    expect(within(advance).getByText(/not yet applied to an issued bill/)).toBeInTheDocument()
    for (const name of ['Rent', 'Electricity', 'Water', 'Washing']) {
      expect(within(advance).queryByText(name)).not.toBeInTheDocument()
    }
  })

  it('shows useful empty states for months and tenants without receipts', async () => {
    const user = userEvent.setup()
    renderReceipts()
    await waitForPage()
    expect(screen.getByRole('article', { name: 'Receipt DEMO-RCT-006' })).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Demo tenant'), 'tenant-6')
    await user.selectOptions(screen.getByLabelText('Billing month'), 'period-oct')
    expect(await screen.findByText('No receipts for October 2026 (sample)')).toBeInTheDocument()
    expect(screen.getByText(/receipts in other billing months/)).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Demo tenant'), 'tenant-5')
    expect(await screen.findByText('No receipts yet')).toBeInTheDocument()
    expect(screen.getByText('This demo tenant has no receipts in the sample records yet.')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Demo tenant'), 'tenant-7')
    await user.selectOptions(screen.getByLabelText('Billing month'), 'period-nov')
    expect(await screen.findByText('No receipts for November 2026 (sample)')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Billing month'), 'period-oct')
    const historical = await screen.findByRole('article', { name: 'Receipt DEMO-RCT-005' })
    expect(within(historical).getByText('October 2026 (sample)')).toBeInTheDocument()
    expect(within(historical).getByText('Room 5')).toBeInTheDocument()
  })

  it('reports receipts whose payment link cannot identify an owner', () => {
    const data = createDemoData()
    const orphan = { ...data.receipts[0]!, id: 'receipt-orphan', paymentId: 'payment-missing', receiptNumber: 'DEMO-RCT-ORPHAN' }
    const result = selectTenantReceipts({ ...data, receipts: [...data.receipts, orphan] }, 'tenant-1')
    expect(result.unmatched).toBe(1)
    expect(result.receipts.some(item => item.receipt.id === 'receipt-orphan')).toBe(false)
    expect(result.receipts.every(item => item.payment.tenantId === 'tenant-1')).toBe(true)
  })

  it('shows an unavailable notice when ownership cannot be resolved', async () => {
    const data = createDemoData()
    const orphan = { ...data.receipts[0]!, id: 'receipt-orphan', paymentId: 'payment-missing', receiptNumber: 'DEMO-RCT-ORPHAN' }
    const withOrphan: PrototypeData = { ...data, receipts: [...data.receipts, orphan] }
    const repository = { load: async () => ({ data: withOrphan, warning: null, canPersist: false }), save: async () => null }
    renderReceipts(repository)
    expect(await screen.findByRole('alert')).toHaveTextContent('1 receipt record could not be matched to a tenant')
  })
})
