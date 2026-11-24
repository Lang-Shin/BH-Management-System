import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router/app-router'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { localStorageRepository, STORAGE_KEY } from '@/data/repositories/local-storage-repository'
import { OCCUPANCY_DATE } from '@/data/fixtures/demo'
import { formatDate } from '@/lib/format'

function renderApp(route = '/payments') {
  return render(<PrototypeProvider repository={localStorageRepository}><MemoryRouter initialEntries={[route]}><AppRouter /></MemoryRouter></PrototypeProvider>)
}

async function openTenantReceipts(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Switch to Tenant UI' }))
  expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument()
  await user.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'My Payments & Receipts' }))
  expect(await screen.findByRole('heading', { level: 1, name: 'My Payments & Receipts' })).toBeInTheDocument()
}

async function correctWaterRemoved(user: ReturnType<typeof userEvent.setup>) {
  const transactions = await screen.findByRole('table', { name: 'Transactions' })
  const row = within(transactions).getByRole('row', { name: /BHMS-RCT-006/ })
  await user.click(within(row).getByRole('button', { name: /See Transaction/ }))
  await user.click(within(screen.getByRole('dialog', { name: 'Transaction Details' })).getByRole('button', { name: 'Correct Transaction' }))
  let dialog = await screen.findByRole('dialog', { name: 'Correct this transaction.' })
  await user.click(within(dialog).getByRole('checkbox', { name: /^Water / }))
  expect(within(dialog).getByLabelText('Corrected total')).toHaveTextContent('₱3,600.00')
  await user.type(within(dialog).getByLabelText('Reason for correction'), 'Incorrect bill selected')
  await user.click(within(dialog).getByRole('button', { name: /Review Correction/ }))
  dialog = screen.getByRole('dialog', { name: 'Confirm correction' })
  expect(dialog).toHaveTextContent('Removed amount')
  await user.click(within(dialog).getByRole('button', { name: 'Confirm & Save Correction' }))
  dialog = screen.getByRole('dialog', { name: 'Payment corrected' })
  expect(dialog).toHaveTextContent('BHMS-RCT-006-R2')
  expect(dialog).toHaveTextContent('Recorded amount corrected; no refund was required.')
  await user.click(within(dialog).getByRole('button', { name: 'Got it' }))
  await waitFor(() => {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    expect(saved?.data.receipts.find((receipt: { id: string }) => receipt.id === 'receipt-6').state).toBe('SUPERSEDED')
    expect(saved?.data.receipts.some((receipt: { receiptNumber: string }) => receipt.receiptNumber === 'BHMS-RCT-006-R2')).toBe(true)
  })
}

describe('tenant receipt corrections', () => {
  it('shows the latest revised receipt after the landlord corrects a payment', async () => {
    const user = userEvent.setup()
    renderApp('/payments')
    await correctWaterRemoved(user)
    await openTenantReceipts(user)

    expect(screen.getByText('2 receipts for November 2026 (sample).')).toBeInTheDocument()
    const revised = screen.getByRole('article', { name: 'Receipt BHMS-RCT-006-R2' })
    expect(within(revised).getByText('Revised')).toBeInTheDocument()
    expect(within(revised).getByText(/Supersedes BHMS-RCT-006 \(revision 1\)/)).toBeInTheDocument()
    expect(within(revised).getByText('Amount paid')).toBeInTheDocument()
    expect(within(revised).getByText('₱3,600.00')).toBeInTheDocument()
    expect(within(revised).getByText('₱3,500.00')).toBeInTheDocument()
    expect(within(revised).getByText('₱100.00')).toBeInTheDocument()
    expect(within(revised).getByText('Rent')).toBeInTheDocument()
    expect(within(revised).queryByText('Water')).not.toBeInTheDocument()
    expect(within(revised).getByText('Washing machine')).toBeInTheDocument()
    expect(within(revised).queryByText('Electricity')).not.toBeInTheDocument()
    expect(within(revised).getByText(`Corrected ${formatDate(OCCUPANCY_DATE)}.`)).toBeInTheDocument()
    expect(within(revised).getByText(/Recorded amount corrected; no refund was required/)).toBeInTheDocument()
    expect(screen.getAllByRole('article', { name: 'Receipt BHMS-RCT-006-R2' })).toHaveLength(1)

    const original = screen.getByRole('article', { name: 'Receipt BHMS-RCT-006' })
    expect(within(original).getByText('Superseded')).toBeInTheDocument()
    expect(within(original).getByText(/Replaced by BHMS-RCT-006-R2 \(revision 2\)/)).toBeInTheDocument()
    expect(within(original).getByText('₱3,700.00')).toBeInTheDocument()
    expect(within(original).getByText('Water')).toBeInTheDocument()
    expect(within(original).getByText('Rent')).toBeInTheDocument()
    expect(screen.getByText(/Receipt history for November 2026 \(sample\) \(1\)/)).toBeInTheDocument()

    await user.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'Overview' }))
    const monthlyBilling = screen.getByRole('region', { name: 'Monthly room billing' })
    expect(within(monthlyBilling).getByRole('status')).toHaveTextContent('PARTLY PAID')
    expect(screen.getByRole('region', { name: 'Bill categories' })).toHaveTextContent(/Water.*100\.00/)
    await user.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'My Payments & Receipts' }))

    await user.selectOptions(screen.getByLabelText('Preview tenant'), 'tenant-2')
    expect(await screen.findByRole('article', { name: 'Receipt BHMS-RCT-008' })).toBeInTheDocument()
    expect(screen.queryByRole('article', { name: 'Receipt BHMS-RCT-006-R2' })).not.toBeInTheDocument()
    expect(screen.queryByText('Revised')).not.toBeInTheDocument()
    expect(screen.queryByText(/Receipt history for/)).not.toBeInTheDocument()
  }, 15000)

  it('keeps the revised receipt after a refresh', async () => {
    const user = userEvent.setup()
    const first = renderApp('/payments')
    await correctWaterRemoved(user)
    first.unmount()

    renderApp('/tenant/payments')
    const revised = await screen.findByRole('article', { name: 'Receipt BHMS-RCT-006-R2' })
    expect(within(revised).getByText('₱3,600.00')).toBeInTheDocument()
    expect(within(revised).queryByText('Water')).not.toBeInTheDocument()
    expect(within(revised).getByText(/Recorded amount corrected; no refund was required/)).toBeInTheDocument()
    expect(screen.getByText('2 receipts for November 2026 (sample).')).toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'Receipt BHMS-RCT-006' })).toHaveTextContent('Superseded')
  }, 15000)

  it('reverses an electricity payment and makes the tenant bill unpaid again', async () => {
    const user = userEvent.setup()
    renderApp('/payments')
    await user.type(await screen.findByRole('searchbox', { name: 'Search by room or receipt number' }), 'BHMS-RCT-007')
    const transactions = screen.getByRole('table', { name: 'Transactions' })
    await user.click(within(within(transactions).getByRole('row', { name: /BHMS-RCT-007/ })).getByRole('button', { name: /See Transaction/ }))
    await user.click(within(screen.getByRole('dialog', { name: 'Transaction Details' })).getByRole('button', { name: 'Correct Transaction' }))
    let dialog = await screen.findByRole('dialog', { name: 'Correct this transaction.' })
    await user.click(within(dialog).getByRole('checkbox', { name: /^Electricity / }))
    await user.type(within(dialog).getByLabelText('Reason for correction'), 'Electricity was not actually paid')
    await user.click(within(dialog).getByRole('button', { name: /Review Correction/ }))
    dialog = screen.getByRole('dialog', { name: 'Confirm correction' })
    expect(dialog).toHaveTextContent('No allocations retained. This is a full transaction reversal.')
    await user.click(within(dialog).getByRole('button', { name: 'Confirm & Save Correction' }))
    dialog = screen.getByRole('dialog', { name: 'Payment corrected' })
    expect(dialog).toHaveTextContent('Recorded amount corrected; no refund was required.')
    await user.click(within(dialog).getByRole('button', { name: 'Got it' }))

    await user.click(screen.getByRole('button', { name: 'Switch to Tenant UI' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Bill categories' })).toHaveTextContent(/Electricity.*169\.00/)
    await user.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'My Payments & Receipts' }))
    expect(await screen.findByRole('article', { name: 'Receipt BHMS-RCT-007' })).toHaveTextContent('Superseded')
    expect(screen.getByRole('article', { name: 'Receipt BHMS-RCT-007-R2' })).toBeInTheDocument()
  }, 15000)

})
