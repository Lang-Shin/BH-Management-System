import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router/app-router'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import { createEmptyData } from '@/data/fixtures/empty'
import { localStorageRepository, STORAGE_KEY } from '@/data/repositories/local-storage-repository'
import { prepareMoveInPayment } from '@/domain/calculations/move-in'
import { prepareCollection } from '@/domain/calculations/payment-collection'
import { quoteRentRange, rentPrepaymentBasis } from '@/domain/calculations/rent-schedule'
import type { PrototypeAppState } from '@/domain/types/models'

const AS_OF = '2026-11-13'
function charlesWorkspace(periodCount = 3) {
  let data = createEmptyData(AS_OF)
  data = prototypeReducer(data, { type: 'tenant/created', asOf: AS_OF, draft: {
    name: 'Charles UI Refund', email: 'charles.ui@example.com', phone: '', address: '', notes: '', roomId: 'room-13', moveInDate: AS_OF,
  } })
  const obligation = data.moveInObligations.find(item => item.roomId === 'room-13')!
  const paid = prepareMoveInPayment(data, { obligationId: obligation.id, categories: ['ADVANCE', 'SECURITY_DEPOSIT'], paidOn: AS_OF })
  if (!paid.ok) throw new Error(paid.reason)
  data = paid.data
  const cycle = data.occupancyCycles.find(item => item.roomId === 'room-13' && item.status === 'ACTIVE')!
  const quote = quoteRentRange(data, { cycleId: cycle.id, startSequence: 2, periodCount, asOf: AS_OF })
  if (!quote.ok) throw new Error(quote.reason)
  const paidRent = prepareCollection(data, {
    transactionId: 'charles-ui-prepay', roomId: 'room-13', readings: {}, collectedOn: AS_OF,
    rentPrepayment: { cycleId: cycle.id, startSequence: 2, periodCount },
    selections: quote.quote.periods.map(line => ({ id: line.rentObligationId, amountCents: line.amountCents,
      periodId: line.rentalPeriodId, dueDate: line.dueDate, basis: rentPrepaymentBasis(quote.quote, line) })),
  })
  if (!paidRent.ok) throw new Error(paidRent.reason)
  return { data: paidRent.data, cycle, tenant: paidRent.data.tenants.find(item => item.name === 'Charles UI Refund')! }
}
function saved(): PrototypeAppState { return JSON.parse(localStorage.getItem(STORAGE_KEY)!).data }
function renderAt(route: string) { return render(<PrototypeProvider repository={localStorageRepository} now={() => new Date('2026-12-20T04:00:00Z')}><MemoryRouter initialEntries={[route]}><AppRouter /></MemoryRouter></PrototypeProvider>) }

describe('unified correction and prepaid refund UI', () => {
  it('unchecks one of multiple prepaid rent allocations with immediate totals and preserved unrelated coverage', async () => {
    const seeded = charlesWorkspace(3)
    expect(await localStorageRepository.save(seeded.data)).toBeNull()
    const payment = seeded.data.payments.find(item => item.id === seeded.data.rentPrepayments[0]!.paymentId)!
    const receipt = seeded.data.receipts.find(item => item.paymentId === payment.id)!
    const firstRentAllocation = seeded.data.paymentAllocations.filter(allocation => allocation.paymentId === payment.id && allocation.state === 'ACTIVE')[0]!
    const user = userEvent.setup()
    renderAt('/payments')
    const table = await screen.findByRole('table', { name: 'Transactions' })
    const row = within(table).getByRole('row', { name: new RegExp(receipt.receiptNumber) })
    await user.click(within(row).getByRole('button', { name: /See Transaction/ }))
    await user.click(within(screen.getByRole('dialog', { name: 'Transaction Details' })).getByRole('button', { name: 'Correct Transaction' }))
    const dialog = await screen.findByRole('dialog', { name: 'Correct this transaction.' })
    const rentCheckboxes = within(dialog).getAllByRole('checkbox', { name: /^Rent / })
    expect(rentCheckboxes).toHaveLength(3)
    expect(rentCheckboxes.every(checkbox => (checkbox as HTMLInputElement).checked)).toBe(true)
    const rentCategory = within(dialog).getByRole('region', { name: 'Rent' })
    expect(rentCategory).toHaveTextContent('3 paid allocations')
    expect(rentCategory).toHaveTextContent('₱12,000.00 of ₱12,000.00')
    await user.click(rentCheckboxes[0]!)
    expect(rentCategory).toHaveTextContent('₱8,000.00 of ₱12,000.00')
    expect(within(dialog).getByLabelText('Corrected total')).toHaveTextContent('₱8,000.00')
    expect(within(dialog).getByLabelText('Removed amount')).toHaveTextContent('₱4,000.00')
    await user.type(within(dialog).getByLabelText('Reason for correction'), 'The last prepaid period was included incorrectly')
    await user.click(within(dialog).getByRole('button', { name: /Review Correction/ }))
    const review = screen.getByRole('dialog', { name: 'Confirm correction' })
    expect(review).toHaveTextContent('Removed amount')
    expect(review).toHaveTextContent('2 of 3')
    await user.click(within(review).getByRole('button', { name: 'Confirm & Save Correction' }))
    expect(await screen.findByRole('dialog', { name: 'Payment corrected' })).toBeInTheDocument()
    await waitFor(() => {
      const result = saved()
      expect(result.payments.find(item => item.id === payment.id)?.state).toBe('VOIDED')
      const corrected = result.payments.find(item => item.correction?.supersedesId === payment.id)!
      expect(corrected.amountCents).toBe(800_000)
      expect(result.paymentAllocations.some(allocation => allocation.state === 'ACTIVE' && allocation.chargeId === firstRentAllocation.chargeId)).toBe(false)
      expect(result.paymentAllocations.filter(allocation => allocation.paymentId === corrected.id && allocation.state === 'ACTIVE')).toHaveLength(2)
      expect(result.paymentCorrections).toHaveLength(1)
      expect(result.receipts.find(item => item.id === receipt.id)?.state).toBe('SUPERSEDED')
    })
  }, 30_000)

  it('proposes, approves, and completes Charles\'s ₱8,000 prepaid refund through the move-out and payments workflows', async () => {
    const seeded = charlesWorkspace(3)
    expect(await localStorageRepository.save(seeded.data)).toBeNull()
    const user = userEvent.setup()
    const app = renderAt('/tenants')
    await user.click(await screen.findByRole('button', { name: 'View Charles UI Refund' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Charles UI Refund' })).getByRole('button', { name: 'Move Out / Archive' }))
    const moveOut = screen.getByRole('dialog', { name: 'Move Out / Archive Charles UI Refund' })
    expect(within(moveOut).getByRole('heading', { name: 'Prepaid Rent Reconciliation' })).toBeInTheDocument()
    expect(moveOut).toHaveTextContent('₱8,000.00')
    await user.click(within(moveOut).getByRole('checkbox', { name: /Record a proposed prepaid rent refund of ₱8,000.00/ }))
    await user.type(within(moveOut).getByLabelText('Refund proposal reason'), 'Charles is moving out after seven days.')
    await user.click(within(moveOut).getByRole('button', { name: 'Move Out / Archive' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Move Out / Archive Charles UI Refund' })).not.toBeInTheDocument())
    await waitFor(() => {
      const result = saved()
      expect(result.tenants.find(item => item.id === seeded.tenant.id)?.status).toBe('MOVED_OUT')
      expect(result.prepaidRentRefunds?.[0]).toMatchObject({ status: 'PROPOSED', amountCents: 800_000 })
    })
    app.unmount()
    renderAt('/payments')
    const refundSection = await screen.findByRole('region', { name: 'Prepaid rent refunds' })
    expect(within(refundSection).getByText('₱8,000.00')).toBeInTheDocument()
    await user.click(within(refundSection).getByRole('button', { name: 'Approve' }))
    let dialog = screen.getByRole('dialog', { name: 'Approve prepaid rent refund' })
    await user.click(within(dialog).getByRole('button', { name: 'Approve refund' }))
    await waitFor(() => expect(saved().prepaidRentRefunds?.[0]?.status).toBe('APPROVED'))
    const approvedSection = await screen.findByRole('region', { name: 'Prepaid rent refunds' })
    await user.click(within(approvedSection).getByRole('button', { name: 'Record refund' }))
    dialog = screen.getByRole('dialog', { name: 'Complete prepaid rent refund' })
    await user.click(within(dialog).getByRole('checkbox', { name: /actually returned to the tenant/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Complete refund' }))
    await waitFor(() => {
      const result = saved()
      expect(result.prepaidRentRefunds?.[0]).toMatchObject({ status: 'COMPLETED', amountCents: 800_000, refundedOn: '2026-12-20' })
      expect(result.payments.find(item => item.id === seeded.data.rentPrepayments[0]!.paymentId)?.amountCents).toBe(1_200_000)
    })
  }, 30_000)
})
