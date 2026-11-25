import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRouter } from '@/app/router/app-router'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { localStorageRepository, STORAGE_KEY } from '@/data/repositories/local-storage-repository'
import { createDemoData } from '@/data/fixtures/demo'

const RATE_1 = 'Rate category 1 — Public CR'
const RATE_2 = 'Rate category 2 — Private CR'

function renderApp(route = '/') {
  return render(<PrototypeProvider repository={localStorageRepository}><MemoryRouter initialEntries={[route]}><AppRouter /></MemoryRouter></PrototypeProvider>)
}

function savedData() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').data
}

async function openRentRates(user: ReturnType<typeof userEvent.setup>) {
  const section = await screen.findByRole('region', { name: 'Billing Rates' })
  await user.click(within(section).getByRole('button', { name: /Monthly Rent Rates/ }))
  return screen.findByRole('dialog', { name: 'Edit Monthly Rent Rates' })
}

function categoryCard(dialog: HTMLElement, name: string) {
  return within(dialog).getByRole('article', { name })
}

async function scheduleRate(user: ReturnType<typeof userEvent.setup>, categoryName: string, amount: string) {
  const dialog = await openRentRates(user)
  await user.click(within(categoryCard(dialog, categoryName)).getByRole('button', { name: 'Schedule Rate' }))
  const form = await screen.findByRole('dialog', { name: 'Schedule Monthly Rent Rate' })
  const input = within(form).getByLabelText('Monthly rate per room')
  await user.clear(input)
  await user.type(input, amount)
  await user.click(within(form).getByRole('button', { name: 'Review Changes' }))
  const review = await screen.findByRole('dialog', { name: 'Review Rate Change' })
  await user.click(within(review).getByRole('button', { name: 'Confirm Changes' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-13T04:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('billing rates UI', { timeout: 20000 }, () => {
  it('renders four rate cards in the billing grid and opens each correct dialog with keyboard focus return', async () => {
    const user = userEvent.setup()
    renderApp('/billing')
    await screen.findByRole('heading', { level: 1, name: 'Billing' })
    const section = screen.getByRole('region', { name: 'Billing Rates' })
    const grid = section.querySelector('.billing-rate-grid')
    expect(grid?.children).toHaveLength(4)
    expect(section).toHaveTextContent('Manage rates for upcoming billing periods.')

    for (const [trigger, title] of [
      [/Monthly Rent Rates/, 'Edit Monthly Rent Rates'],
      [/Edit rate Electricity/, 'Edit Electricity Rate'],
      [/Edit rate Water/, 'Edit Water Rate'],
      [/Edit rate Washing Machine/, 'Edit Washing Machine Rate'],
    ] as const) {
      const card = within(section).getByRole('button', { name: trigger })
      card.focus()
      await user.keyboard('{Enter}')
      expect(await screen.findByRole('dialog', { name: title })).toBeInTheDocument()
      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('dialog', { name: title })).not.toBeInTheDocument())
      expect(card).toHaveFocus()
    }
  })

  it('shows every rental category independently and schedules one without changing the current rate or historic records', async () => {
    const user = userEvent.setup()
    const original = createDemoData()
    renderApp('/billing')
    let dialog = await openRentRates(user)
    const first = categoryCard(dialog, RATE_1)
    expect(first).toHaveTextContent('8 rooms')
    expect(first).toHaveTextContent('₱3,500.00/month')
    expect(first).toHaveTextContent('No pending change')
    expect(categoryCard(dialog, RATE_2)).toHaveTextContent('6 rooms')
    expect(within(dialog).getByRole('article', { name: 'Rate category 3 — Private CR + Aircon' })).toHaveTextContent('1 room')
    expect(within(dialog).getAllByRole('button', { name: 'Schedule Rate' })).toHaveLength(3)
    expect(within(dialog).queryByRole('button', { name: 'Edit Rate' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Cancel Change' })).not.toBeInTheDocument()

    await user.click(within(first).getByRole('button', { name: 'Schedule Rate' }))
    const form = await screen.findByRole('dialog', { name: 'Schedule Monthly Rent Rate' })
    const input = within(form).getByLabelText('Monthly rate per room')
    expect(input).toHaveValue('3500.00')
    await user.clear(input)
    await user.type(input, '3800')
    await user.click(within(form).getByRole('button', { name: 'Review Changes' }))
    const review = await screen.findByRole('dialog', { name: 'Review Rate Change' })
    expect(review).toHaveTextContent('₱3,500.00')
    expect(review).toHaveTextContent('₱3,800.00')
    expect(review).toHaveTextContent('Dec 1, 2026')
    await user.click(within(review).getByRole('button', { name: 'Confirm Changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    dialog = await openRentRates(user)
    expect(categoryCard(dialog, RATE_1)).toHaveTextContent('Pending change')
    expect(categoryCard(dialog, RATE_1)).toHaveTextContent('₱3,800.00/month')
    expect(categoryCard(dialog, RATE_1)).toHaveTextContent('Dec 1, 2026')
    expect(within(categoryCard(dialog, RATE_1)).getByRole('button', { name: 'Edit Rate' })).toBeInTheDocument()
    expect(within(categoryCard(dialog, RATE_1)).getByRole('button', { name: 'Cancel Change' })).toBeInTheDocument()
    expect(categoryCard(dialog, RATE_2)).toHaveTextContent('No pending change')
    const saved = savedData()
    expect(saved.roomRentRates.find((rate: { categoryId: string; effectiveFrom: string }) => rate.categoryId === 'RATE_3500' && rate.effectiveFrom === '2026-12-01')).toMatchObject({ monthlyRentCents: 380_000 })
    expect(saved.charges).toEqual(original.charges)
    expect(saved.receipts).toEqual(original.receipts)
  })

  it('edits a pending rate, preserves the effective date and superseded history, and persists after reload', async () => {
    const user = userEvent.setup()
    const app = renderApp('/billing')
    await scheduleRate(user, RATE_1, '3800')
    let dialog = await openRentRates(user)
    await user.click(within(categoryCard(dialog, RATE_1)).getByRole('button', { name: 'Edit Rate' }))
    const form = await screen.findByRole('dialog', { name: 'Edit Scheduled Rate' })
    expect(within(form).getByLabelText('Monthly rate per room')).toHaveValue('3800.00')
    await user.click(within(form).getByRole('button', { name: 'Review Changes' }))
    expect(within(form).getByText(/at least 3 characters/)).toBeInTheDocument()
    await user.clear(within(form).getByLabelText('Monthly rate per room'))
    await user.type(within(form).getByLabelText('Monthly rate per room'), '3600')
    await user.type(within(form).getByLabelText(/Reason/), 'Planned increase was too high')
    await user.click(within(form).getByRole('button', { name: 'Review Changes' }))
    const review = await screen.findByRole('dialog', { name: 'Review Rate Change' })
    expect(review).toHaveTextContent('₱3,800.00')
    expect(review).toHaveTextContent('₱3,600.00')
    await user.click(within(review).getByRole('button', { name: 'Confirm Changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    const saved = savedData()
    const scheduled = saved.roomRentRates.filter((rate: { categoryId: string; effectiveFrom: string }) => rate.categoryId === 'RATE_3500' && rate.effectiveFrom === '2026-12-01')
    expect(scheduled).toHaveLength(2)
    expect(scheduled.find((rate: { monthlyRentCents: number }) => rate.monthlyRentCents === 360_000)).toMatchObject({ supersedesRateId: expect.any(String), revision: 2 })
    expect(scheduled.find((rate: { monthlyRentCents: number }) => rate.monthlyRentCents === 380_000)).toMatchObject({ supersededOn: '2026-11-13', supersededReason: 'Planned increase was too high' })

    app.unmount()
    renderApp('/billing')
    dialog = await openRentRates(user)
    expect(categoryCard(dialog, RATE_1)).toHaveTextContent('₱3,600.00/month')
    await user.click(within(dialog).getByText('Rate history'))
    expect(dialog).toHaveTextContent('Replaced')
    expect(dialog).toHaveTextContent('Planned increase was too high')
  })

  it('requires a cancellation reason, cancels only one category, and preserves the canceled schedule in history', async () => {
    const user = userEvent.setup()
    const original = createDemoData()
    renderApp('/billing')
    await scheduleRate(user, RATE_1, '3800')
    await scheduleRate(user, RATE_2, '4500')
    let dialog = await openRentRates(user)
    await user.click(within(categoryCard(dialog, RATE_1)).getByRole('button', { name: 'Cancel Change' }))
    const cancel = await screen.findByRole('dialog', { name: 'Cancel Scheduled Rate Change' })
    expect(cancel).toHaveTextContent('Canceling this scheduled rate change will retain the current rental rate.')
    expect(cancel).toHaveTextContent('₱3,800.00/month')
    expect(cancel).toHaveTextContent('8')
    await user.click(within(cancel).getByRole('button', { name: 'Confirm Cancellation' }))
    expect(within(cancel).getByText(/at least 3 characters/)).toBeInTheDocument()
    await user.type(within(cancel).getByLabelText('Cancellation reason'), 'No rent increase this year')
    await user.click(within(cancel).getByRole('button', { name: 'Confirm Cancellation' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    const saved = savedData()
    const canceled = saved.roomRentRates.find((rate: { categoryId: string; monthlyRentCents: number }) => rate.categoryId === 'RATE_3500' && rate.monthlyRentCents === 380_000)
    expect(canceled).toMatchObject({ cancelReason: 'No rent increase this year', canceledOn: '2026-11-13' })
    expect(saved.roomRentRates.find((rate: { categoryId: string; effectiveFrom: string }) => rate.categoryId === 'RATE_4000' && rate.effectiveFrom === '2026-12-01')).toMatchObject({ monthlyRentCents: 450_000 })
    expect(saved.payments).toEqual(original.payments)
    expect(saved.receipts).toEqual(original.receipts)

    dialog = await openRentRates(user)
    expect(categoryCard(dialog, RATE_1)).toHaveTextContent('No pending change')
    expect(categoryCard(dialog, RATE_2)).toHaveTextContent('₱4,500.00/month')
    await user.click(within(dialog).getByText('Rate history'))
    expect(dialog).toHaveTextContent('Canceled')
    expect(dialog).toHaveTextContent('No rent increase this year')
  })

  it('treats an edit back to the current rate as a cancellation and rejects unchanged submissions', async () => {
    const user = userEvent.setup()
    renderApp('/billing')
    let dialog = await openRentRates(user)
    await user.click(within(categoryCard(dialog, RATE_1)).getByRole('button', { name: 'Schedule Rate' }))
    let form = await screen.findByRole('dialog', { name: 'Schedule Monthly Rent Rate' })
    await user.click(within(form).getByRole('button', { name: 'Review Changes' }))
    expect(within(form).getByText('Enter a different future amount.')).toBeInTheDocument()
    await user.clear(within(form).getByLabelText('Monthly rate per room'))
    await user.type(within(form).getByLabelText('Monthly rate per room'), '3800')
    await user.click(within(form).getByRole('button', { name: 'Review Changes' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Review Rate Change' })).getByRole('button', { name: 'Confirm Changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    dialog = await openRentRates(user)
    await user.click(within(categoryCard(dialog, RATE_1)).getByRole('button', { name: 'Edit Rate' }))
    form = await screen.findByRole('dialog', { name: 'Edit Scheduled Rate' })
    await user.click(within(form).getByRole('button', { name: 'Review Changes' }))
    expect(within(form).getByText(/at least 3 characters/)).toBeInTheDocument()
    await user.type(within(form).getByLabelText(/Reason/), 'Return to the current rent')
    await user.clear(within(form).getByLabelText('Monthly rate per room'))
    await user.type(within(form).getByLabelText('Monthly rate per room'), '3500')
    await user.click(within(form).getByRole('button', { name: 'Review Changes' }))
    const cancel = await screen.findByRole('dialog', { name: 'Cancel Scheduled Rate Change' })
    expect(cancel).toHaveTextContent('will retain the current rental rate')
    expect(within(cancel).getByLabelText('Cancellation reason')).toHaveValue('Return to the current rent')
    await user.click(within(cancel).getByRole('button', { name: 'Confirm Cancellation' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(savedData().roomRentRates.some((rate: { categoryId: string; effectiveFrom: string; canceledOn?: string }) => rate.categoryId === 'RATE_3500' && rate.effectiveFrom === '2026-12-01' && rate.canceledOn)).toBe(true)
  })

  it('validates, reviews, schedules, persists, and exposes electricity rate history without changing the active rate', async () => {
    const user = userEvent.setup()
    const app = renderApp('/billing')
    const section = await screen.findByRole('region', { name: 'Billing Rates' })
    await user.click(within(section).getByRole('button', { name: /Edit rate Electricity/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit Electricity Rate' })
    await user.click(within(dialog).getByRole('button', { name: 'Schedule Rate' }))
    expect(within(dialog).getByLabelText(/New rate per kWh/)).toHaveValue('13.00')
    await user.clear(within(dialog).getByLabelText(/New rate per kWh/))
    await user.type(within(dialog).getByLabelText(/New rate per kWh/), '0')
    await user.click(within(dialog).getByRole('button', { name: 'Review Changes' }))
    expect(within(dialog).getByText(/positive amount/)).toBeInTheDocument()

    await user.clear(within(dialog).getByLabelText(/New rate per kWh/))
    await user.type(within(dialog).getByLabelText(/New rate per kWh/), '14')
    await user.click(within(dialog).getByRole('button', { name: 'Review Changes' }))
    const review = await screen.findByRole('dialog', { name: 'Review Rate Change' })
    expect(review).toHaveTextContent('₱13.00')
    expect(review).toHaveTextContent('₱14.00')
    expect(review).toHaveTextContent('Dec 1, 2026')
    await user.click(within(review).getByRole('button', { name: 'Confirm Changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Review Rate Change' })).not.toBeInTheDocument())

    const electricityCard = within(section).getByRole('button', { name: /Edit rate Electricity/ })
    expect(electricityCard).toHaveTextContent('₱13.00')
    expect(electricityCard).toHaveTextContent('Scheduled December 2026 · ₱14.00')
    await waitFor(() => {
      const saved = savedData()
      expect(saved.electricityRates).toHaveLength(3)
      expect(saved.electricityRates.find((rate: { effectiveFrom: string }) => rate.effectiveFrom === '2026-12-01')).toMatchObject({ rateCentsPerKwh: 1_400, recordedOn: '2026-11-13' })
      expect(saved.charges).toEqual(createDemoData().charges)
      expect(saved.receipts).toEqual(createDemoData().receipts)
      expect(saved.meterReadings).toEqual(createDemoData().meterReadings)
    })

    app.unmount()
    renderApp('/billing')
    const persistedSection = await screen.findByRole('region', { name: 'Billing Rates' })
    expect(within(persistedSection).getByRole('button', { name: /Edit rate Electricity/ })).toHaveTextContent('Scheduled December 2026 · ₱14.00')
    await user.click(within(persistedSection).getByRole('button', { name: /Edit rate Electricity/ }))
    const persistedDialog = await screen.findByRole('dialog', { name: 'Edit Electricity Rate' })
    expect(persistedDialog).toHaveTextContent('\u20b114.00')
    await user.click(within(persistedDialog).getByText('Rate history'))
    expect(persistedDialog).toHaveTextContent('Scheduled')
    await user.click(within(persistedDialog).getByRole('button', { name: 'Edit Rate' }))
    expect(within(persistedDialog).getByLabelText(/New rate per kWh/)).toHaveValue('14.00')
    await user.click(within(persistedDialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('edits and cancels scheduled utility rates independently', async () => {
    const user = userEvent.setup()
    renderApp('/billing')
    const section = await screen.findByRole('region', { name: 'Billing Rates' })

    await user.click(within(section).getByRole('button', { name: /Edit rate Electricity/ }))
    let dialog = await screen.findByRole('dialog', { name: 'Edit Electricity Rate' })
    await user.click(within(dialog).getByRole('button', { name: 'Schedule Rate' }))
    await user.clear(within(dialog).getByLabelText(/New rate per kWh/))
    await user.type(within(dialog).getByLabelText(/New rate per kWh/), '14')
    await user.click(within(dialog).getByRole('button', { name: 'Review Changes' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Review Rate Change' })).getByRole('button', { name: 'Confirm Changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.click(within(section).getByRole('button', { name: /Edit rate Water/ }))
    dialog = await screen.findByRole('dialog', { name: 'Edit Water Rate' })
    await user.click(within(dialog).getByRole('button', { name: 'Schedule Rate' }))
    await user.clear(within(dialog).getByLabelText('New rate per tenant per billing period'))
    await user.type(within(dialog).getByLabelText('New rate per tenant per billing period'), '125')
    await user.click(within(dialog).getByRole('button', { name: 'Review Changes' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Review Rate Change' })).getByRole('button', { name: 'Confirm Changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.click(within(section).getByRole('button', { name: /Edit rate Electricity/ }))
    dialog = await screen.findByRole('dialog', { name: 'Edit Electricity Rate' })
    await user.click(within(dialog).getByRole('button', { name: 'Edit Rate' }))
    expect(within(dialog).getByLabelText(/New rate per kWh/)).toHaveValue('14.00')
    await user.click(within(dialog).getByRole('button', { name: 'Review Changes' }))
    expect(within(dialog).getByText(/at least 3 characters/)).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText(/Reason/), 'Electricity increase reduced')
    await user.clear(within(dialog).getByLabelText(/New rate per kWh/))
    await user.type(within(dialog).getByLabelText(/New rate per kWh/), '13.50')
    await user.click(within(dialog).getByRole('button', { name: 'Review Changes' }))
    const review = await screen.findByRole('dialog', { name: 'Review Rate Change' })
    expect(review).toHaveTextContent('₱14.00')
    expect(review).toHaveTextContent('₱13.50')
    await user.click(within(review).getByRole('button', { name: 'Confirm Changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.click(within(section).getByRole('button', { name: /Edit rate Electricity/ }))
    dialog = await screen.findByRole('dialog', { name: 'Edit Electricity Rate' })
    expect(dialog).toHaveTextContent('₱13.50')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel Change' }))
    const cancel = await screen.findByRole('dialog', { name: 'Cancel Scheduled Electricity Rate Change' })
    await user.type(within(cancel).getByLabelText('Cancellation reason'), 'Keep electricity at the current rate')
    await user.click(within(cancel).getByRole('button', { name: 'Confirm Cancellation' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.click(within(section).getByRole('button', { name: /Edit rate Electricity/ }))
    dialog = await screen.findByRole('dialog', { name: 'Edit Electricity Rate' })
    expect(dialog).toHaveTextContent('No pending change')
    expect(dialog).toHaveTextContent('₱13.00')
    await user.click(within(dialog).getByText('Rate history'))
    expect(dialog).toHaveTextContent('Canceled')
    expect(dialog).toHaveTextContent('Replaced')
    await user.click(within(dialog).getAllByRole('button', { name: 'Close' })[0]!)

    await user.click(within(section).getByRole('button', { name: /Edit rate Water/ }))
    dialog = await screen.findByRole('dialog', { name: 'Edit Water Rate' })
    expect(dialog).toHaveTextContent('Pending change')
    expect(dialog).toHaveTextContent('₱125.00')
    expect(dialog).toHaveTextContent('₱100.00')
    await user.click(within(dialog).getAllByRole('button', { name: 'Close' })[0]!)

    const saved = savedData()
    expect(saved.electricityRates.some((rate: { canceledOn?: string }) => rate.canceledOn)).toBe(true)
    expect(saved.electricityRates.some((rate: { supersededOn?: string }) => rate.supersededOn)).toBe(true)
    expect(saved.waterRates.find((rate: { effectiveFrom: string }) => rate.effectiveFrom === '2026-12-01')).toMatchObject({ rateCents: 12_500 })
    expect(saved.payments).toEqual(createDemoData().payments)
    expect(saved.receipts).toEqual(createDemoData().receipts)
  })

  it('cancels without saving and keeps Reports on the active rate', async () => {
    const user = userEvent.setup()
    renderApp('/billing')
    const section = await screen.findByRole('region', { name: 'Billing Rates' })
    await user.click(within(section).getByRole('button', { name: /Edit rate Water/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit Water Rate' })
    await user.click(within(dialog).getByRole('button', { name: 'Schedule Rate' }))
    await user.clear(within(dialog).getByLabelText('New rate per tenant per billing period'))
    await user.type(within(dialog).getByLabelText('New rate per tenant per billing period'), '125')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit Water Rate' })).not.toBeInTheDocument())
    expect(within(section).getByRole('button', { name: /Edit rate Water/ })).toHaveTextContent('₱100.00')
    await waitFor(() => expect(savedData().waterRates).toHaveLength(1))

    await user.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'Reports & Settings' }))
    expect(await screen.findByText('Electricity price')).toBeInTheDocument()
    expect(screen.getByText('Electricity price').closest('div')).toHaveTextContent('₱13.00 per kWh')
    expect(screen.getByText('Water and washing').closest('div')).toHaveTextContent('₱100.00 per tenant for water')
  })
})
