import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AppRouter } from '@/app/router/app-router'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { TENANT_DEMO_STORAGE_KEY } from '@/app/providers/tenant-demo'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import { EditPaymentDialog } from '@/features/billing/edit-payment-dialog'
import type { PrototypeRepository } from '@/data/repositories/prototype-repository'
import { buildUnifiedCorrectionQuote, prepareUnifiedCorrection } from '@/domain/calculations/transaction-correction'
import { chargeBalance } from '@/domain/calculations/summary'
import { isPrototypeData } from '@/domain/validation/prototype-data'
import { checkboxCorrectionFixture } from './checkbox-correction-fixture'

const now = () => new Date('2026-11-23T04:00:00Z')

describe('checkbox correction safety and session synchronization', () => {
  it('calculates the exact 4,300 to 4,200 owner example from saved allocation IDs', () => {
    const fixture = checkboxCorrectionFixture()
    expect(isPrototypeData(fixture.data)).toBe(true)
    expect(fixture.data.payments.find(payment => payment.id === fixture.paymentId)?.amountCents).toBe(430_000)
    const washing = fixture.allocations.find(allocation => fixture.data.charges.find(charge => charge.id === allocation.chargeId)?.category === 'WASHING_MACHINE')!
    const receipt = fixture.data.receipts.find(item => item.id === fixture.receiptId)!
    const input = {
      paymentId: fixture.paymentId, correctedAt: fixture.asOf, reason: 'Charles did not pay washing.',
      retainedAllocationIds: fixture.allocations.filter(allocation => allocation.id !== washing.id).map(allocation => allocation.id),
      expectedReceiptId: receipt.id, expectedReceiptRevision: receipt.revision, settlementStatus: 'CORRECTED' as const,
    }
    const result = prepareUnifiedCorrection(fixture.data, input)
    if (!result.ok) throw new Error(result.reason)
    expect(result.payment.amountCents).toBe(420_000)
    expect(isPrototypeData(result.data)).toBe(true)
    expect(chargeBalance(result.data, result.data.charges.find(charge => charge.id === washing.chargeId)!, fixture.asOf)).toBe(10_000)
    expect(result.data.meterReadings).toEqual(fixture.data.meterReadings)
    expect(result.data.prepaidRentRefunds ?? []).toEqual([])
    expect(buildUnifiedCorrectionQuote(fixture.data, { ...input, retainedAllocationIds: [washing.id, washing.id] })).toEqual({ quoteError: 'INVALID_ALLOCATION' })
    expect(buildUnifiedCorrectionQuote(fixture.data, { ...input, retainedAllocationIds: ['foreign-allocation'] })).toEqual({ quoteError: 'INVALID_ALLOCATION' })
    expect(buildUnifiedCorrectionQuote(fixture.data, { ...input, expectedReceiptRevision: 99 })).toEqual({ quoteError: 'STALE_CORRECTION' })
    expect(buildUnifiedCorrectionQuote(fixture.data, { ...input, retainedAllocationIds: fixture.allocations.map(allocation => allocation.id) })).toEqual({ quoteError: 'NO_CHANGES' })
    expect(buildUnifiedCorrectionQuote(fixture.data, { ...input, lines: [{ targetId: washing.chargeId, category: 'WASHING_MACHINE', amountCents: 1 }] })).toEqual({ quoteError: 'INVALID_PAYMENT' })
  })

  it('refreshes an already-open tenant session from the authoritative repository on focus', async () => {
    const fixture = checkboxCorrectionFixture()
    let authoritative = fixture.data
    let revision = 1
    const repository: PrototypeRepository = {
      mode: 'server', save: async () => null,
      load: vi.fn(async () => ({ data: authoritative, revision, canPersist: true, warning: null })),
      command: vi.fn(async action => {
        authoritative = prototypeReducer(authoritative, action)
        revision += 1
        return { data: authoritative, revision, replayed: false }
      }),
    }
    localStorage.setItem(TENANT_DEMO_STORAGE_KEY, fixture.tenantId)
    const tenant = render(<PrototypeProvider repository={repository} now={now}><MemoryRouter initialEntries={['/tenant']}><AppRouter /></MemoryRouter></PrototypeProvider>)
    await within(tenant.container).findByRole('heading', { level: 1, name: 'Overview' })
    const tenantBills = within(tenant.container).getByRole('region', { name: 'Bill categories' })
    expect(tenantBills).toHaveTextContent(/WashingPAID/)
    render(<PrototypeProvider repository={repository} now={now}><EditPaymentDialog paymentId={fixture.paymentId} onClose={() => {}} onReturnFocus={() => {}} onSaved={() => {}} /></PrototypeProvider>)
    const user = userEvent.setup()
    const dialog = await screen.findByRole('dialog', { name: 'Correct this transaction.' })
    expect(within(dialog).getAllByRole('checkbox')).toHaveLength(4)
    expect(within(dialog).getAllByRole('checkbox').every(checkbox => (checkbox as HTMLInputElement).checked)).toBe(true)
    expect(dialog.querySelector('select')).toBeNull()
    expect(dialog.querySelector('input[inputmode="decimal"]')).toBeNull()
    expect(within(dialog).queryByRole('button', { name: /Remove.*allocation/ })).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('checkbox', { name: /^Washing machine / }))
    expect(within(dialog).getByLabelText('Corrected total')).toHaveTextContent('₱4,200.00')
    await user.type(within(dialog).getByLabelText('Reason for correction'), 'Washing was accidentally included. Charles did not pay washing.')
    await user.click(within(dialog).getByRole('button', { name: /Review Correction/ }))
    await user.click(within(screen.getByRole('dialog', { name: 'Confirm correction' })).getByRole('button', { name: 'Confirm & Save Correction' }))
    await screen.findByRole('dialog', { name: 'Payment corrected' })
    expect(tenantBills).toHaveTextContent(/WashingPAID/)
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    await waitFor(() => expect(tenantBills).toHaveTextContent(/WashingNOT PAID/))
    expect(tenantBills).toHaveTextContent(/100\.00 outstanding/)
    expect(tenantBills).toHaveTextContent(/RentPAID/)
    expect(tenantBills).toHaveTextContent(/WaterPAID/)
    expect(tenantBills).toHaveTextContent(/ElectricityPAID/)
    expect(authoritative.receipts.find(receipt => receipt.id === fixture.receiptId)?.state).toBe('SUPERSEDED')
  }, 15000)

  it('keeps checkbox selections and reason after server failure and retries with the same idempotency key', async () => {
    const fixture = checkboxCorrectionFixture()
    let rejectFirst!: (error: Error) => void
    const command = vi.fn<NonNullable<PrototypeRepository['command']>>()
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject }))
      .mockImplementation(async action => ({ data: prototypeReducer(fixture.data, action), revision: 2, replayed: false }))
    const repository: PrototypeRepository = {
      mode: 'server', save: async () => null, command,
      load: async () => ({ data: fixture.data, revision: 1, warning: null, canPersist: true }),
    }
    const onSaved = vi.fn()
    render(<PrototypeProvider repository={repository} now={now}><EditPaymentDialog paymentId={fixture.paymentId} onClose={() => {}} onReturnFocus={() => {}} onSaved={onSaved} /></PrototypeProvider>)
    const user = userEvent.setup()
    let dialog = await screen.findByRole('dialog', { name: 'Correct this transaction.' })
    await user.click(within(dialog).getByRole('checkbox', { name: /^Washing machine / }))
    await user.type(within(dialog).getByLabelText('Reason for correction'), 'Charles did not pay washing.')
    await user.click(within(dialog).getByRole('button', { name: /Review Correction/ }))
    dialog = screen.getByRole('dialog', { name: 'Confirm correction' })
    await user.click(within(dialog).getByRole('button', { name: 'Confirm & Save Correction' }))
    await waitFor(() => expect(command).toHaveBeenCalledTimes(1))
    expect(onSaved).not.toHaveBeenCalled()
    expect(within(dialog).getByRole('button', { name: 'Saving correction…' })).toBeDisabled()
    await act(async () => { rejectFirst(new Error('Connection interrupted. Retry this correction.')) })
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Connection interrupted')
    await user.click(within(dialog).getByRole('button', { name: 'Back to Correction' }))
    dialog = screen.getByRole('dialog', { name: 'Correct this transaction.' })
    expect(within(dialog).getByRole('checkbox', { name: /^Washing machine / })).not.toBeChecked()
    expect(within(dialog).getByLabelText('Reason for correction')).toHaveValue('Charles did not pay washing.')
    await user.click(within(dialog).getByRole('button', { name: /Review Correction/ }))
    await user.click(within(screen.getByRole('dialog', { name: 'Confirm correction' })).getByRole('button', { name: 'Confirm & Save Correction' }))
    await screen.findByRole('dialog', { name: 'Payment corrected' })
    expect(command).toHaveBeenCalledTimes(2)
    expect(command.mock.calls[0]![1]).toBe(command.mock.calls[1]![1])
    expect(command.mock.calls[0]![0]).toEqual(command.mock.calls[1]![0])
    expect(onSaved).toHaveBeenCalledTimes(1)
  })
})
