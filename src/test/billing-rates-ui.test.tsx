import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRouter } from '@/app/router/app-router'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { localStorageRepository, STORAGE_KEY } from '@/data/repositories/local-storage-repository'
import { createDemoData } from '@/data/fixtures/demo'

function renderApp(route = '/') {
  return render(<PrototypeProvider repository={localStorageRepository}><MemoryRouter initialEntries={[route]}><AppRouter /></MemoryRouter></PrototypeProvider>)
}

function savedData() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').data
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

  it('reviews and schedules a rent change while preserving room categories and historical records', async () => {
    const user = userEvent.setup()
    const original = createDemoData()
    renderApp('/billing')
    const section = await screen.findByRole('region', { name: 'Billing Rates' })
    await user.click(within(section).getByRole('button', { name: /Monthly Rent Rates/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit Monthly Rent Rates' })
    const currentRate = within(dialog).getByRole('region', { name: 'Current rate' })
    expect(currentRate).toHaveTextContent('Rate Category 1 · Public CR')
    expect(currentRate).toHaveTextContent('Rate Category 2 · Private CR')
    expect(currentRate).toHaveTextContent('Rate Category 3 · Private CR + Aircon')
    expect(currentRate).not.toHaveTextContent('8 rooms')
    expect(currentRate).not.toHaveTextContent('6 rooms')
    expect(currentRate).not.toHaveTextContent('1 room')
    expect(currentRate).toHaveTextContent('₱3,500.00/month')
    expect(currentRate).toHaveTextContent('₱4,000.00/month')
    expect(currentRate).toHaveTextContent('₱5,000.00/month')
    const newRates = within(dialog).getByRole('region', { name: 'New monthly rates' })
    expect(newRates).toHaveTextContent('Public CR')
    expect(newRates).toHaveTextContent('Private CR + Aircon')
    expect(dialog).toHaveTextContent('8 rooms')
    expect(dialog).toHaveTextContent('6 rooms')
    expect(dialog).toHaveTextContent('1 room')
    expect(within(dialog).getByLabelText(/Rate category 1/)).toHaveValue('3500.00')

    await user.clear(within(dialog).getByLabelText(/Rate category 1/))
    await user.type(within(dialog).getByLabelText(/Rate category 1/), '3600')
    await user.click(within(dialog).getByRole('button', { name: 'Review Changes' }))
    const review = await screen.findByRole('dialog', { name: 'Review Changes' })
    expect(review).toHaveTextContent('₱3,500.00')
    expect(review).toHaveTextContent('₱3,600.00')
    expect(review).toHaveTextContent('December 2026')
    await user.click(within(review).getByRole('button', { name: 'Confirm Changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Review Changes' })).not.toBeInTheDocument())

    const rentCard = within(section).getByRole('button', { name: /Monthly Rent Rates/ })
    expect(rentCard).toHaveTextContent('₱3,500.00')
    expect(rentCard).toHaveTextContent('Scheduled December 2026')
    await waitFor(() => {
      const saved = savedData()
      expect(saved.roomRentRates).toHaveLength(4)
      expect(saved.roomRentRates.find((rate: { categoryId: string; effectiveFrom: string }) => rate.categoryId === 'RATE_3500' && rate.effectiveFrom === '2026-12-01')).toMatchObject({ monthlyRentCents: 360_000 })
      expect(saved.rooms.map((room: { id: string; categoryId: string }) => [room.id, room.categoryId])).toEqual(original.rooms.map(room => [room.id, room.categoryId]))
      expect(saved.charges).toEqual(original.charges)
      expect(saved.receipts).toEqual(original.receipts)
      expect(saved.roomAssignments).toEqual(original.roomAssignments)
    })
  })

  it('validates, reviews, schedules, persists, and exposes electricity rate history without changing the active rate', async () => {
    const user = userEvent.setup()
    const app = renderApp('/billing')
    const section = await screen.findByRole('region', { name: 'Billing Rates' })
    await user.click(within(section).getByRole('button', { name: /Edit rate Electricity/ }))
    let dialog = await screen.findByRole('dialog', { name: 'Edit Electricity Rate' })
    expect(within(dialog).getByLabelText(/New rate per kWh/)).toHaveValue('13.00')
    await user.clear(within(dialog).getByLabelText(/New rate per kWh/))
    await user.type(within(dialog).getByLabelText(/New rate per kWh/), '0')
    await user.click(within(dialog).getByRole('button', { name: 'Review Changes' }))
    expect(within(dialog).getByText(/positive amount/)).toBeInTheDocument()

    await user.clear(within(dialog).getByLabelText(/New rate per kWh/))
    await user.type(within(dialog).getByLabelText(/New rate per kWh/), '14')
    await user.click(within(dialog).getByRole('button', { name: 'Review Changes' }))
    const review = await screen.findByRole('dialog', { name: 'Review Changes' })
    expect(review).toHaveTextContent('₱13.00')
    expect(review).toHaveTextContent('₱14.00')
    expect(review).toHaveTextContent('December 2026')
    await user.click(within(review).getByRole('button', { name: 'Confirm Changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Review Changes' })).not.toBeInTheDocument())

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
    dialog = await screen.findByRole('dialog', { name: 'Edit Electricity Rate' })
    expect(within(dialog).getByLabelText(/New rate per kWh/)).toHaveValue('14.00')
    await user.click(within(dialog).getByText('Rate history'))
    expect(dialog).toHaveTextContent('Scheduled')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit Electricity Rate' })).not.toBeInTheDocument())
  })

  it('cancels without saving and keeps Reports on the active rate', async () => {
    const user = userEvent.setup()
    renderApp('/billing')
    const section = await screen.findByRole('region', { name: 'Billing Rates' })
    await user.click(within(section).getByRole('button', { name: /Edit rate Water/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit Water Rate' })
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
