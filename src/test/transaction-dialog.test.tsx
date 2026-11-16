import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createDemoData, DEMO_DATE } from '@/data/fixtures/demo'
import { PaymentHistoryTable } from '@/components/shared/payment-history-table'
import { formatDate, formatMoney } from '@/lib/format'
import type { Payment, PrototypeAppState } from '@/domain/types/models'

function renderPayment(data: PrototypeAppState, payment: Payment) {
  return render(<PaymentHistoryTable data={data} payments={[payment]} />)
}

function paymentFrom(data: PrototypeAppState, id: string): Payment {
  const payment = data.payments.find(item => item.id === id)
  if (!payment) throw new Error(`Missing payment ${id}`)
  return payment
}

describe('Payment History transaction dialog', () => {
  it('removes What Was Paid and gives every payment a See Transaction button', () => {
    const data = createDemoData()
    render(<PaymentHistoryTable data={data} payments={data.payments} />)
    const table = screen.getByRole('table', { name: 'Payment history' })
    expect(within(table).queryByRole('columnheader', { name: /what was paid/i })).not.toBeInTheDocument()
    expect(within(table).getAllByRole('button', { name: /See Transaction/ })).toHaveLength(data.payments.length)
    expect(within(table).getByRole('columnheader', { name: 'Receipt number' })).toBeInTheDocument()
  })

  it('shows Room, date, amount, status, receipt, payer, and allocations without payment method', async () => {
    const user = userEvent.setup()
    const data = createDemoData()
    const payment = paymentFrom(data, 'payment-3')
    const receipt = data.receipts.find(item => item.paymentId === payment.id)!.receiptNumber
    renderPayment(data, payment)
    await user.click(screen.getByRole('button', { name: /See Transaction/ }))
    const dialog = screen.getByRole('dialog', { name: 'Transaction Details' })
    expect(dialog).toHaveTextContent('Payment information for the selected room.')
    expect(within(dialog).getAllByText('Room 103')).toHaveLength(1)
    expect(dialog).toHaveTextContent(formatDate(payment.paidOn))
    expect(dialog).toHaveTextContent(formatMoney(payment.amountCents))
    const amount = within(dialog).getByText('Amount paid').parentElement!
    expect(amount).toHaveClass('transaction-amount-section')
    expect(amount.parentElement).toHaveClass('transaction-metadata', 'grid-cols-2')
    expect(amount.querySelector('dd')).toHaveTextContent(formatMoney(payment.amountCents))
    expect(dialog).toHaveTextContent('Recorded')
    expect(dialog).toHaveTextContent(receipt)
    expect(dialog).toHaveTextContent('Paid by: Jamie Santos')
    expect(dialog).not.toHaveTextContent(/Payment method|Cash|Bank transfer/)
    expect(dialog).toHaveTextContent('Rent')
    expect(dialog).toHaveTextContent('Water')
    expect(dialog).not.toHaveTextContent('Electricity')
    expect(dialog).toHaveTextContent(`${formatMoney(350_000)}`)
    expect(dialog).toHaveTextContent(`${formatMoney(10_000)}`)
  })

  it('shows electricity and washing-machine allocations accurately', async () => {
    const user = userEvent.setup()
    const data = createDemoData()
    const electricity = paymentFrom(data, 'payment-1-electricity')
    const electricityRender = renderPayment(data, electricity)
    await user.click(screen.getByRole('button', { name: /See Transaction/ }))
    let dialog = screen.getByRole('dialog', { name: 'Transaction Details' })
    expect(dialog).toHaveTextContent('Electricity')
    expect(dialog).toHaveTextContent('₱169.00')
    expect(dialog).toHaveTextContent('312 → 325 kWh')
    expect(dialog).toHaveTextContent('13 kWh × ₱13.00/kWh')
    expect(dialog).not.toHaveTextContent('Rent')
    electricityRender.unmount()

    const washing = paymentFrom(data, 'payment-2-washing')
    renderPayment(data, washing)
    await user.click(screen.getByRole('button', { name: /See Transaction/ }))
    dialog = screen.getByRole('dialog', { name: 'Transaction Details' })
    expect(dialog).toHaveTextContent('Washing machine')
    expect(dialog).toHaveTextContent('₱100.00')
  })

  it('shows the actual allocated amount for a partial payment', async () => {
    const user = userEvent.setup()
    const data = createDemoData()
    const original = paymentFrom(data, 'payment-2-water')
    const payment: Payment = { ...original, id: 'partial-test', amountCents: 5_000, paidOn: DEMO_DATE }
    data.payments = [payment]
    data.paymentAllocations = [{ id: 'partial-water', paymentId: payment.id, chargeId: 'water-nov-tenant-2', amountCents: 5_000, allocatedOn: DEMO_DATE, state: 'ACTIVE', creditId: null, reversalAuditEventId: null }]
    data.receipts = []
    renderPayment(data, payment)
    await user.click(screen.getByRole('button', { name: /See Transaction/ }))
    const dialog = screen.getByRole('dialog', { name: 'Transaction Details' })
    expect(dialog).toHaveTextContent(formatMoney(5_000))
    expect(dialog).toHaveTextContent('Water')
    expect(dialog).toHaveTextContent('No receipt yet')
    expect(dialog).not.toHaveTextContent('Unallocated')
  })

  it('labels an unallocated advance without inventing a billing category', async () => {
    const user = userEvent.setup()
    const data = createDemoData()
    const advance = paymentFrom(data, 'payment-advance')
    renderPayment(data, advance)
    await user.click(screen.getByRole('button', { name: /See Transaction/ }))
    const dialog = screen.getByRole('dialog', { name: 'Transaction Details' })
    expect(dialog).toHaveTextContent('Advance payment — Unallocated')
    expect(dialog).toHaveTextContent(formatMoney(advance.amountCents))
    expect(dialog).toHaveTextContent('Paid by: Jordan Flores')
    expect(dialog).not.toHaveTextContent('Rent')
    expect(dialog).not.toHaveTextContent('Electricity')
    expect(dialog).not.toHaveTextContent('Water')
  })

  it('shows a neutral payer fallback when no tenant identity exists', async () => {
    const user = userEvent.setup()
    const data = createDemoData()
    const payment: Payment = { id: 'unknown-payer', tenantId: 'missing-tenant', amountCents: 10_000, paidOn: DEMO_DATE, method: 'cash', state: 'RECORDED', correction: null }
    data.payments = [payment]
    data.paymentAllocations = []
    data.tenantCredits = []
    data.receipts = []
    renderPayment(data, payment)
    await user.click(screen.getByRole('button', { name: /See Transaction/ }))
    const dialog = screen.getByRole('dialog', { name: 'Transaction Details' })
    expect(dialog).toHaveTextContent('Paid by: Not recorded')
  })

  it('closes with X, Done, and Escape, restores focus, and leaves records unchanged', async () => {
    const user = userEvent.setup()
    const data = createDemoData()
    const payment = paymentFrom(data, 'payment-2-water')
    const before = JSON.stringify(data)
    renderPayment(data, payment)
    const trigger = screen.getByRole('button', { name: /See Transaction/ })

    await user.click(trigger)
    let dialog = screen.getByRole('dialog', { name: 'Transaction Details' })
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Transaction Details' })).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())

    await user.click(trigger)
    dialog = screen.getByRole('dialog', { name: 'Transaction Details' })
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Transaction Details' })).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())

    await user.click(trigger)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Transaction Details' })).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(JSON.stringify(data)).toBe(before)
  })
})
