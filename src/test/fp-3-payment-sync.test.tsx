import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AppRouter } from '@/app/router/app-router'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { createDemoData } from '@/data/fixtures/demo'
import type { PrototypeRepository } from '@/data/repositories/prototype-repository'
import { localStorageRepository, STORAGE_KEY } from '@/data/repositories/local-storage-repository'

function renderApp(route = '/', repository = localStorageRepository) {
  return render(<PrototypeProvider repository={repository}><MemoryRouter initialEntries={[route]}><AppRouter /></MemoryRouter></PrototypeProvider>)
}

async function reviewRoomRentPayment(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /Calculate payment/ }))
  const calculator = screen.getByRole('dialog', { name: 'Choose a room and its bills.' })
  await user.selectOptions(within(calculator).getByLabelText('Choose room'), 'room-4')
  await user.click(within(calculator).getByRole('checkbox', { name: 'Rent' }))
  await user.click(within(calculator).getByRole('button', { name: /Review payment/ }))
  return screen.getByRole('dialog', { name: 'Confirm payment received' })
}

describe('recorded payment synchronization', () => {
  it('records rent, updates the receipt, tenant status, and unpaid categories', async () => {
    const user = userEvent.setup()
    renderApp('/billing')
    const confirm = await reviewRoomRentPayment(user)
    expect(confirm).toHaveTextContent('₱3,500.00')
    await user.click(within(confirm).getByRole('button', { name: 'Confirm payment received' }))
    const success = await screen.findByRole('dialog', { name: 'Payment recorded' })
    expect(success).toHaveTextContent('BHMS-RCT-015')
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null').data
      expect(saved.payments).toHaveLength(15)
      expect(saved.receipts).toHaveLength(15)
      expect(saved.receipts.find((receipt: { receiptNumber: string }) => receipt.receiptNumber === 'BHMS-RCT-015')).toMatchObject({ amountCents: 350_000, state: 'ISSUED' })
      expect(saved.payments.find((payment: { id: string }) => payment.id.includes('payment-collection-')).amountCents).toBe(350_000)
      expect(saved.paymentAllocations.filter((allocation: { paymentId: string }) => allocation.paymentId.includes('payment-collection-')).reduce((sum: number, allocation: { amountCents: number }) => sum + allocation.amountCents, 0)).toBe(350_000)
    })
    await user.click(within(success).getByRole('button', { name: 'Got it' }))

    await user.click(screen.getByRole('button', { name: 'Switch to Tenant UI' }))
    await screen.findByRole('heading', { level: 1, name: 'Overview' })
    await user.selectOptions(screen.getByLabelText('Preview tenant'), 'tenant-5')
    const billing = screen.getByRole('region', { name: 'Monthly room billing' })
    expect(within(billing).getByRole('status')).toHaveTextContent('PARTLY PAID')
    const unpaid = screen.getByRole('region', { name: 'Bill categories' })
    expect(unpaid).toHaveTextContent(/Water.*200\.00/)
    expect(unpaid).toHaveTextContent('ElectricityAWAITING READING')
    expect(unpaid).toHaveTextContent(/RentPAID/)

    await user.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'My Payments & Receipts' }))
    const receipt = await screen.findByRole('article', { name: 'Receipt BHMS-RCT-015' })
    expect(receipt).toHaveTextContent('Room 4')
    expect(receipt).toHaveTextContent('Rent')
    expect(receipt).toHaveTextContent('₱3,500.00')
    expect(receipt).not.toHaveTextContent('Water')
    await user.selectOptions(screen.getByLabelText('Preview tenant'), 'tenant-8')
    const sharedReceipt = await screen.findByRole('article', { name: 'Receipt BHMS-RCT-015' })
    expect(sharedReceipt).toHaveTextContent('Room 4')
    expect(sharedReceipt).not.toHaveTextContent(/Paid by|payer|Shared room payment/)
  }, 20000)

  it('does not report payment success when persistence fails', async () => {
    const user = userEvent.setup()
    const save = vi.fn<PrototypeRepository['save']>().mockResolvedValue('Simulated storage failure.')
    const repository: PrototypeRepository = { load: async () => ({ data: createDemoData(), warning: null, canPersist: true }), save }
    renderApp('/billing', repository)
    const confirm = await reviewRoomRentPayment(user)
    await user.click(within(confirm).getByRole('button', { name: 'Confirm payment received' }))
    expect(await within(confirm).findByText(/Payment was not saved\./)).toHaveTextContent('Simulated storage failure.')
    expect(screen.queryByRole('dialog', { name: 'Payment recorded' })).not.toBeInTheDocument()
    expect(within(confirm).getByRole('button', { name: 'Retry payment' })).toBeEnabled()
    expect(save).toHaveBeenCalled()
  }, 20000)

  it('does not report correction success when persistence fails and leaves the transaction unchanged', async () => {
    localStorage.clear()
    const user = userEvent.setup()
    const repository: PrototypeRepository = {
      load: async () => ({ data: createDemoData(), warning: null, canPersist: true }),
      save: async () => 'Simulated storage failure.',
    }
    renderApp('/payments', repository)
    const table = await screen.findByRole('table', { name: 'Transactions' })
    await user.click(within(within(table).getByRole('row', { name: /BHMS-RCT-006/ })).getByRole('button', { name: /See Transaction/ }))
    await user.click(within(screen.getByRole('dialog', { name: 'Transaction Details' })).getByRole('button', { name: 'Edit Payment' }))
    let dialog = await screen.findByRole('dialog', { name: 'Correct this transaction.' })
    await user.click(within(dialog).getByRole('checkbox', { name: 'Water' }))
    await user.type(within(dialog).getByLabelText('Reason for correction'), 'Storage failure check')
    await user.click(within(dialog).getByRole('button', { name: /Review Correction/ }))
    dialog = screen.getByRole('dialog', { name: 'Confirm correction' })
    await user.click(within(dialog).getByRole('radio', { name: /Recorded amount was wrong/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Confirm correction' }))
    expect(await within(dialog).findByText(/The correction was not saved\./)).toHaveTextContent('Simulated storage failure.')
    expect(screen.queryByRole('dialog', { name: 'Payment corrected' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Confirm correction' })).toBeEnabled()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  }, 20000)
})
