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
import { prepareCollection, rentPrepaymentCatalog } from '@/domain/calculations/payment-collection'
import { quoteRentRange } from '@/domain/calculations/rent-schedule'
import { rentObligationPaidCents } from '@/domain/calculations/rental-periods'
import type { PrototypeAppState } from '@/domain/types/models'

const now = () => new Date('2026-11-13T04:00:00Z')

async function seedPrepaymentWorkspace() {
  let data = createEmptyData('2026-11-13')
  data = prototypeReducer(data, { type: 'tenant/created', asOf: '2026-11-13', draft: {
    name: 'Charles UI', email: 'charles.ui@example.com', phone: '', address: '', notes: '', roomId: 'room-13', moveInDate: '2026-11-13',
  } })
  const obligation = data.moveInObligations.find(item => item.roomId === 'room-13')!
  const paid = prepareMoveInPayment(data, { obligationId: obligation.id, categories: ['ADVANCE', 'SECURITY_DEPOSIT'], paidOn: '2026-11-13' })
  if (!paid.ok) throw new Error(paid.reason)
  expect(await localStorageRepository.save(paid.data)).toBeNull()
}

function renderApp(route = '/billing') {
  return render(<PrototypeProvider repository={localStorageRepository} now={now}><MemoryRouter initialEntries={[route]}><AppRouter /></MemoryRouter></PrototypeProvider>)
}

async function seedConflictPrepayment() {
  let data = createEmptyData('2026-11-13')
  data = prototypeReducer(data, { type: 'tenant/created', asOf: '2026-11-13', draft: {
    name: 'Conflict Tenant', email: 'conflict@example.com', phone: '', address: '', notes: '', roomId: 'room-13', moveInDate: '2026-11-13',
  } })
  const obligation = data.moveInObligations.find(item => item.roomId === 'room-13')!
  const paid = prepareMoveInPayment(data, { obligationId: obligation.id, categories: ['ADVANCE', 'SECURITY_DEPOSIT'], paidOn: '2026-11-13' })
  if (!paid.ok) throw new Error(paid.reason)
  let working = paid.data
  for (const [startSequence, transactionId] of [[2, 'conflict-december'], [4, 'conflict-february']] as const) {
    const cycle = working.occupancyCycles.find(item => item.roomId === 'room-13' && item.status === 'ACTIVE')!
    const quoted = quoteRentRange(working, { cycleId: cycle.id, startSequence, periodCount: 1, asOf: '2026-11-13' })
    if (!quoted.ok) throw new Error(quoted.reason)
    const catalog = rentPrepaymentCatalog(working, 'room-13', { cycleId: cycle.id, startSequence, periodCount: 1 }, '2026-11-13')
    const result = prepareCollection(working, {
      transactionId, roomId: 'room-13', readings: {}, collectedOn: '2026-11-13',
      rentPrepayment: { cycleId: cycle.id, startSequence, periodCount: 1 },
      selections: catalog.items.map(({ id, amountCents, periodId, dueDate, basis }) => ({ id, amountCents, periodId, dueDate, basis })),
    })
    if (!result.ok) throw new Error(result.reason)
    working = result.data
  }
  expect(await localStorageRepository.save(working)).toBeNull()
}
async function seedThreeMonthPrepayment() {
  let data = createEmptyData('2026-11-13')
  data = prototypeReducer(data, { type: 'tenant/created', asOf: '2026-11-13', draft: {
    name: 'Covered Tenant', email: 'covered@example.com', phone: '', address: '', notes: '', roomId: 'room-13', moveInDate: '2026-11-13',
  } })
  const obligation = data.moveInObligations.find(item => item.roomId === 'room-13')!
  const paid = prepareMoveInPayment(data, { obligationId: obligation.id, categories: ['ADVANCE', 'SECURITY_DEPOSIT'], paidOn: '2026-11-13' })
  if (!paid.ok) throw new Error(paid.reason)
  const cycle = paid.data.occupancyCycles.find(item => item.roomId === 'room-13' && item.status === 'ACTIVE')!
  const quoted = quoteRentRange(paid.data, { cycleId: cycle.id, startSequence: 2, periodCount: 3, asOf: '2026-11-13' })
  if (!quoted.ok) throw new Error(quoted.reason)
  const catalog = rentPrepaymentCatalog(paid.data, 'room-13', { cycleId: cycle.id, startSequence: 2, periodCount: 3 }, '2026-11-13')
  const result = prepareCollection(paid.data, {
    transactionId: 'tenant-covered', roomId: 'room-13', readings: {}, collectedOn: '2026-11-13',
    rentPrepayment: { cycleId: cycle.id, startSequence: 2, periodCount: 3 },
    selections: catalog.items.map(({ id, amountCents, periodId, dueDate, basis }) => ({ id, amountCents, periodId, dueDate, basis })),
  })
  if (!result.ok) throw new Error(result.reason)
  expect(await localStorageRepository.save(result.data)).toBeNull()
}

function savedData(): PrototypeAppState {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null').data
}

async function openRentCard() {
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: /Calculate payment/ }))
  const dialog = screen.getByRole('dialog', { name: 'Choose a room and its bills.' })
  await user.selectOptions(within(dialog).getByLabelText('Choose room'), 'room-13')
  const rentCard = [...dialog.querySelectorAll<HTMLDetailsElement>('details.payment-obligation-card')]
    .find(card => card.textContent?.includes('Anniversary-based billing'))!
  if (!rentCard.open) await user.click(rentCard.querySelector('summary')!)
  return { user, dialog, rentCard }
}

describe('multi-month rent prepayment in Calculate Payment', () => {
  it('previews and confirms three consecutive future periods and persists the locked schedule', async () => {
    await seedPrepaymentWorkspace()
    const app = renderApp()
    const { user, dialog, rentCard } = await openRentCard()
    expect(within(rentCard).getByRole('button', { name: /Pay outstanding rent/ })).toHaveAttribute('aria-pressed', 'true')
    await user.click(within(rentCard).getByRole('button', { name: /Pay multiple months in advance/ }))

    const start = within(rentCard).getByLabelText('Starting rental period')
    expect(start).toHaveValue('2')
    expect([...(start as HTMLSelectElement).options].map(option => option.textContent)).toEqual(['Dec 13, 2026 – Jan 12, 2027'])
    await user.clear(within(rentCard).getByLabelText('Consecutive months'))
    await user.type(within(rentCard).getByLabelText('Consecutive months'), '2')

    const preview = await within(rentCard).findByRole('region', { name: 'Selected prepayment periods' })
    expect(within(preview).getAllByRole('listitem')).toHaveLength(2)
    expect(preview).toHaveTextContent('Dec 13, 2026 – Jan 12, 2027')
    expect(preview).toHaveTextContent('Jan 13, 2027 – Feb 12, 2027')
    expect(within(dialog).getByLabelText('Total to pay')).toHaveTextContent('8,000.00')

    await user.click(within(dialog).getByRole('button', { name: /Review payment/ }))
    const review = screen.getByRole('dialog', { name: 'Confirm payment received' })
    expect(review).toHaveTextContent('8,000.00')
    await user.click(within(review).getByRole('button', { name: 'Confirm payment received' }))
    const success = await screen.findByRole('dialog', { name: 'Payment recorded' })
    expect(success).toHaveTextContent('8,000.00')
    expect(within(success).getByRole('list', { name: 'Receipt items' }).children).toHaveLength(2)
    await user.click(within(success).getByRole('button', { name: 'Got it' }))

    await waitFor(() => {
      const data = savedData()
      expect(data.rentPrepayments).toHaveLength(1)
      expect(data.rentPrepayments[0]).toMatchObject({ periodCount: 2, totalCents: 800_000, rateCents: 400_000, rateLockedOn: '2026-11-13' })
      expect(data.payments.at(-1)).toMatchObject({ amountCents: 800_000, paidOn: '2026-11-13' })
      const paidPeriods = data.rentObligations.filter(item => item.occupancyCycleId === data.rentPrepayments[0]!.occupancyCycleId)
      expect(paidPeriods).toHaveLength(3)
      expect(paidPeriods.every(item => rentObligationPaidCents(data, item.id, '2026-11-13') === item.amountCents)).toBe(true)
      expect(paidPeriods[0]!.source).toBe('MOVE_IN_ADVANCE')
    })

    app.unmount()
    renderApp()
    const refreshed = await openRentCard()
    await refreshed.user.click(within(refreshed.rentCard).getByRole('button', { name: /Pay multiple months in advance/ }))
    const refreshedStart = within(refreshed.rentCard).getByLabelText('Starting rental period') as HTMLSelectElement
    expect(refreshedStart.value).toBe('4')
    expect([...refreshedStart.options].map(option => option.textContent)).toEqual(['Feb 13, 2027 – Mar 12, 2027'])
    expect(within(refreshed.dialog).getByText(/Rate ₱4,000.00/)).toBeInTheDocument()
  }, 30_000)


  it('shows the tenant covered periods, advance/prepayment sources, and next unpaid rent', async () => {
    await seedThreeMonthPrepayment()
    renderApp('/tenant')
    const coverage = await screen.findByRole('region', { name: 'Rent coverage' })
    expect(within(coverage).getByText('Move-in advance')).toBeInTheDocument()
    expect(within(coverage).getAllByText('Prepaid rent')).toHaveLength(3)
    expect(within(coverage).getByText('Mar 13, 2027 – Apr 12, 2027')).toBeInTheDocument()
    expect(within(coverage).getAllByRole('listitem')).toHaveLength(4)
    expect(within(coverage).getAllByText('PAID')).toHaveLength(4)
    expect(within(coverage).getByRole('link', { name: /View payment dates and receipts/ })).toHaveAttribute('href', '/tenant/payments')
  }, 30_000)
  it('blocks a prepayment range that crosses an already-paid period without silently adjusting it', async () => {
    await seedConflictPrepayment()
    renderApp()
    const { user, dialog, rentCard } = await openRentCard()
    await user.click(within(rentCard).getByRole('button', { name: /Pay multiple months in advance/ }))
    const start = within(rentCard).getByLabelText('Starting rental period') as HTMLSelectElement
    expect([...start.options].map(option => option.value)).toEqual(['3', '5'])
    await user.selectOptions(start, '3')
    await user.clear(within(rentCard).getByLabelText('Consecutive months'))
    await user.type(within(rentCard).getByLabelText('Consecutive months'), '2')
    const preview = await within(rentCard).findByRole('region', { name: 'Selected prepayment periods' })
    expect(within(preview).getAllByRole('listitem')).toHaveLength(2)
    expect(preview).toHaveTextContent('Already settled')
    expect(preview).toHaveTextContent('One or more periods are already paid')
    expect(start).toHaveValue('3')
    expect(within(rentCard).getByLabelText('Consecutive months')).toHaveValue(2)
    expect(within(dialog).getByRole('button', { name: /Review payment/ })).toBeDisabled()
    expect(within(dialog).getByLabelText('Total to pay')).toHaveTextContent('0.00')
  }, 30_000)
  it('lists every covered rental period on the tenant receipt', async () => {
    await seedThreeMonthPrepayment()
    renderApp('/tenant/payments')
    const covered = await screen.findByRole('region', { name: 'Covered rent periods' })
    expect(within(covered).getAllByRole('listitem')).toHaveLength(3)
    expect(covered).toHaveTextContent('Dec 13, 2026 – Jan 12, 2027')
    expect(covered).toHaveTextContent('Jan 13, 2027 – Feb 12, 2027')
    expect(covered).toHaveTextContent('Feb 13, 2027 – Mar 12, 2027')
    const receipt = covered.closest('article')!
    expect(within(receipt).getAllByText('Rent').length).toBeGreaterThan(0)
    expect(receipt).toHaveTextContent('₱12,000.00')
  }, 30_000)

  it('keeps rent and monthly water in one prepayment transaction and receipt', async () => {
    await seedPrepaymentWorkspace()
    renderApp()
    const { user, dialog, rentCard } = await openRentCard()
    await user.click(within(rentCard).getByRole('button', { name: /Pay multiple months in advance/ }))
    await user.clear(within(rentCard).getByLabelText('Consecutive months'))
    await user.type(within(rentCard).getByLabelText('Consecutive months'), '3')
    const utilitiesCard = [...dialog.querySelectorAll<HTMLDetailsElement>('details.payment-obligation-card')]
      .find(card => card.textContent?.includes('Calendar-month billing'))!
    if (!utilitiesCard.open) await user.click(utilitiesCard.querySelector('summary')!)
    await user.click(within(utilitiesCard).getByRole('checkbox', { name: 'Water' }))
    expect(within(dialog).getByLabelText('Total to pay')).toHaveTextContent('12,100.00')

    await user.click(within(dialog).getByRole('button', { name: /Review payment/ }))
    const review = screen.getByRole('dialog', { name: 'Confirm payment received' })
    expect(review).toHaveTextContent('12,100.00')
    expect(review).toHaveTextContent('Water · November 2026')
    await user.click(within(review).getByRole('button', { name: 'Confirm payment received' }))
    const success = await screen.findByRole('dialog', { name: 'Payment recorded' })
    expect(success).toHaveTextContent('12,100.00')
    await user.click(within(success).getByRole('button', { name: 'Got it' }))
    await waitFor(() => {
      const data = savedData()
      expect(data.payments.at(-1)).toMatchObject({ amountCents: 1_210_000 })
      expect(data.rentPrepayments[0]?.totalCents).toBe(1_200_000)
      const paymentId = data.rentPrepayments[0]!.paymentId
      expect(data.receipts.find(receipt => receipt.paymentId === paymentId)?.allocationIds).toHaveLength(4)
      expect(data.paymentAllocations.filter(allocation => allocation.paymentId === paymentId)).toHaveLength(4)
    })
  }, 30_000)
})
