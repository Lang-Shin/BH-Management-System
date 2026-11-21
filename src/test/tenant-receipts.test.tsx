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
    expect(within(card).getByText('Total recorded amount')).toBeInTheDocument()
    expect(within(card).getByText('₱3,700.00')).toBeInTheDocument()
    expect(within(card).getByText('Issued')).toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'Receipt DEMO-RCT-007' })).toBeInTheDocument()
    expect(screen.queryByRole('article', { name: 'Receipt DEMO-RCT-002' })).not.toBeInTheDocument()
  })

  it('shows read-only category checkboxes and per-category amounts for each receipt', async () => {
    renderReceipts()
    await waitForPage()
    const rentReceipt = screen.getByRole('article', { name: 'Receipt DEMO-RCT-006' })
    const rent = within(rentReceipt).getByRole('checkbox', { name: 'Rent' })
    expect(rent).toBeChecked()
    expect(rent).toBeDisabled()
    expect(within(rentReceipt).getByRole('checkbox', { name: 'Electricity' })).not.toBeChecked()
    expect(within(rentReceipt).getByRole('checkbox', { name: 'Water' })).toBeChecked()
    expect(within(rentReceipt).getByRole('checkbox', { name: 'Washing' })).toBeChecked()
    expect(within(rentReceipt).getByText('₱3,500.00')).toBeInTheDocument()
    expect(within(rentReceipt).getByText('Not included')).toBeInTheDocument()
    expect(within(rentReceipt).getByText(/does not mean the bill is unpaid/)).toBeInTheDocument()

    const electricityReceipt = screen.getByRole('article', { name: 'Receipt DEMO-RCT-007' })
    expect(within(electricityReceipt).getByRole('checkbox', { name: 'Electricity' })).toBeChecked()
    expect(within(electricityReceipt).getByRole('checkbox', { name: 'Rent' })).not.toBeChecked()
    expect(within(electricityReceipt).getAllByText('₱169.00')).toHaveLength(2)
    expect(within(electricityReceipt).getAllByText('Not included')).toHaveLength(3)
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
    expect(within(card).getByRole('checkbox', { name: 'Electricity' })).toBeChecked()
    expect(screen.queryByRole('article', { name: 'Receipt DEMO-RCT-006' })).not.toBeInTheDocument()
    expect(screen.getByText('1 receipt for October 2026 (sample).')).toBeInTheDocument()
  })

  it('keeps receipts tenant-owned when two tenants share a room', async () => {
    const user = userEvent.setup()
    renderReceipts()
    await waitForPage()
    await user.selectOptions(screen.getByLabelText('Demo tenant'), 'tenant-2')
    const samWater = await screen.findByRole('article', { name: 'Receipt DEMO-RCT-008' })
    expect(within(samWater).getByText('Room 2')).toBeInTheDocument()
    expect(within(samWater).getByText('Sam Navarro')).toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'Receipt DEMO-RCT-009' })).toBeInTheDocument()
    expect(screen.queryByRole('article', { name: 'Receipt DEMO-RCT-006' })).not.toBeInTheDocument()
    expect(screen.queryByRole('article', { name: 'Receipt DEMO-RCT-007' })).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Demo tenant'), 'tenant-4')
    const morganRent = await screen.findByRole('article', { name: 'Receipt DEMO-RCT-012' })
    expect(within(morganRent).getByText('Room 2')).toBeInTheDocument()
    expect(within(morganRent).getByText('Morgan Cruz')).toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'Receipt DEMO-RCT-013' })).toBeInTheDocument()
    expect(screen.queryByRole('article', { name: 'Receipt DEMO-RCT-008' })).not.toBeInTheDocument()
    expect(screen.queryByRole('article', { name: 'Receipt DEMO-RCT-009' })).not.toBeInTheDocument()
  })

  it('shows an advance receipt with no bill categories and an unallocated amount', async () => {
    const user = userEvent.setup()
    renderReceipts()
    await waitForPage()
    await user.selectOptions(screen.getByLabelText('Demo tenant'), 'tenant-6')
    const advance = await screen.findByRole('article', { name: 'Receipt DEMO-RCT-014' })
    expect(screen.getByRole('article', { name: 'Receipt DEMO-RCT-011' })).toBeInTheDocument()
    expect(within(advance).getByText('₱500.00')).toBeInTheDocument()
    const advanceNote = within(advance).getByRole('note')
    expect(advanceNote).toHaveTextContent('₱500.00')
    expect(advanceNote).toHaveTextContent(/held as credit and not tied to a bill/)
    for (const name of ['Rent', 'Electricity', 'Water', 'Washing']) {
      expect(within(advance).getByRole('checkbox', { name })).not.toBeChecked()
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
