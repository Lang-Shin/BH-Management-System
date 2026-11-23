import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { AppRouter } from '@/app/router/app-router'
import { createEmptyData } from '@/data/fixtures/empty'
import { localStorageRepository, STORAGE_KEY } from '@/data/repositories/local-storage-repository'
import type { PrototypeRepository } from '@/data/repositories/prototype-repository'
import { collectionCatalog } from '@/domain/calculations/payment-collection'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import { rentObligationPaidCents } from '@/domain/calculations/rental-periods'
import { overdueWorkspace } from './collection-fixture'

const now = () => new Date('2026-11-23T04:00:00Z')
const renderApp = (repository: PrototypeRepository = localStorageRepository, route = '/billing') => render(<PrototypeProvider repository={repository} now={now}><MemoryRouter initialEntries={[route]}><AppRouter /></MemoryRouter></PrototypeProvider>)
const cardsFor = (dialog: HTMLElement) => [...dialog.querySelectorAll<HTMLDetailsElement>('details.payment-obligation-card')]
const cardFor = (dialog: HTMLElement, subtitle: string) => cardsFor(dialog).find(card => card.textContent?.includes(subtitle))!
async function expand(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, subtitle: string) {
  const card = cardFor(dialog, subtitle)
  if (!card.open) await user.click(card.querySelector('summary')!)
  return card
}
beforeEach(async () => { expect(await localStorageRepository.save(overdueWorkspace())).toBeNull() })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('two-card historical payment workflow', () => {
  it('lists only occupied rooms, starts collapsed, and collects August rent in November', async () => {
    const user = userEvent.setup()
    const app = renderApp()
    await user.click(await screen.findByRole('button', { name: /Calculate payment/ }))
    const calculator = screen.getByRole('dialog', { name: 'Choose a room and its bills.' })
    const roomSelect = within(calculator).getByLabelText('Choose room') as HTMLSelectElement
    expect([...roomSelect.options].map(option => [option.value, option.textContent])).toEqual([['', 'Choose a room'], ['room-2', 'Room 2']])
    await user.selectOptions(roomSelect, 'room-2')
    const cards = cardsFor(calculator)
    expect(cards).toHaveLength(2)
    const rentCard = cards[0]!
    const utilitiesCard = cards[1]!
    expect(rentCard).not.toHaveAttribute('open')
    expect(utilitiesCard).not.toHaveAttribute('open')
    expect(rentCard.querySelector('.payment-card-chevron')).toHaveAttribute('aria-hidden', 'true')
    const rentSummary = rentCard.querySelector('summary')!
    rentSummary.focus()
    expect(rentSummary).toHaveFocus()
    expect(rentSummary).toHaveAccessibleName(/Rent.*Anniversary-based billing/)
    expect(within(calculator).getByLabelText('Total to pay')).toHaveTextContent('0.00')
    await expand(user, calculator, 'Anniversary-based billing')
    expect(rentCard).toHaveAttribute('open')
    expect(utilitiesCard).not.toHaveAttribute('open')
    expect(within(calculator).queryByText('Rent is due in anniversary billing')).not.toBeInTheDocument()
    expect(within(calculator).queryByRole('checkbox', { name: /Rent — Jul/ })).not.toBeInTheDocument()
    await user.click(within(calculator).getByRole('checkbox', { name: /Rent — Aug 6/ }))
    expect(within(calculator).getByLabelText('Total to pay')).toHaveTextContent('3,500.00')
    await expand(user, calculator, 'Calendar-month billing')
    const cumulativeElectricity = within(calculator).getByRole('checkbox', { name: 'Cumulative electricity' })
    expect(within(calculator).getAllByRole('checkbox', { name: 'Cumulative electricity' })).toHaveLength(1)
    expect(within(calculator).queryByRole('checkbox', { name: /Electricity —/ })).not.toBeInTheDocument()
    await user.click(cumulativeElectricity)
    expect(within(calculator).getByLabelText('Current meter reading (kWh)')).toBeInTheDocument()
    await user.click(cumulativeElectricity)
    expect(within(calculator).queryByLabelText('Current meter reading (kWh)')).not.toBeInTheDocument()
    expect(rentCard).toHaveAttribute('open')
    expect(utilitiesCard).toHaveAttribute('open')
    await user.click(rentCard.querySelector('summary')!)
    expect(rentCard).not.toHaveAttribute('open')
    expect(within(calculator).getByLabelText('Total to pay')).toHaveTextContent('3,500.00')
    await user.click(within(calculator).getByRole('button', { name: /Review payment/ }))
    const review = screen.getByRole('dialog', { name: 'Confirm payment received' })
    expect(review).toHaveTextContent('Aug 6')
    expect(review).toHaveTextContent('Nov 23, 2026')
    await user.click(within(review).getByRole('button', { name: 'Confirm payment received' }))
    const success = await screen.findByRole('dialog', { name: 'Payment recorded' })
    expect(success).toHaveTextContent('3,500.00')
    await user.click(within(success).getByRole('button', { name: 'Got it' }))
    await waitFor(() => {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY)!).data
      const august = data.rentObligations.find((rent: { dueDate: string }) => rent.dueDate === '2026-08-06')
      expect(rentObligationPaidCents(data, august.id, '2026-11-23')).toBe(350_000)
      expect(data.payments.at(-1)).toMatchObject({ paidOn: '2026-11-23', amountCents: 350_000 })
    })
    await user.selectOptions(screen.getByLabelText('Choose a month'), 'period-2026-08')
    expect(within(await screen.findByRole('table', { name: 'Who has paid' })).getByRole('row', { name: /Room 2/ })).toHaveTextContent('RentPAID')
    app.unmount()
    renderApp()
    await user.click(await screen.findByRole('button', { name: /Calculate payment/ }))
    const refreshed = screen.getByRole('dialog', { name: 'Choose a room and its bills.' })
    await user.selectOptions(within(refreshed).getByLabelText('Choose room'), 'room-2')
    expect(cardsFor(refreshed).every(card => !card.open)).toBe(true)
    await expand(user, refreshed, 'Anniversary-based billing')
    expect(within(refreshed).queryByRole('checkbox', { name: /Rent — Aug 6/ })).not.toBeInTheDocument()
    expect(within(refreshed).getByRole('checkbox', { name: /Rent — Sep 6/ })).not.toBeChecked()
  }, 30000)

  it('resets collapsed cards and selections when the room changes', async () => {
    let data = overdueWorkspace()
    data = prototypeReducer(data, { type: 'tenant/created', asOf: '2026-11-23', draft: {
      name: 'Second occupied room', email: 'room3@example.com', phone: '', address: '', notes: '', roomId: 'room-3', moveInDate: '2026-11-01',
    } })
    expect(await localStorageRepository.save(data)).toBeNull()
    const user = userEvent.setup()
    renderApp()
    await user.click(await screen.findByRole('button', { name: /Calculate payment/ }))
    const dialog = screen.getByRole('dialog', { name: 'Choose a room and its bills.' })
    await user.selectOptions(within(dialog).getByLabelText('Choose room'), 'room-2')
    await expand(user, dialog, 'Anniversary-based billing')
    await user.click(within(dialog).getByRole('checkbox', { name: /Rent — Aug 6/ }))
    expect(within(dialog).getByLabelText('Total to pay')).toHaveTextContent('3,500.00')
    expect(cardsFor(dialog)[1]).not.toHaveAttribute('open')
    await user.selectOptions(within(dialog).getByLabelText('Choose room'), 'room-3')
    expect(within(dialog).getByLabelText('Total to pay')).toHaveTextContent('0.00')
    expect(cardsFor(dialog).every(card => !card.open)).toBe(true)
    await user.selectOptions(within(dialog).getByLabelText('Choose room'), 'room-2')
    expect(within(dialog).getByLabelText('Total to pay')).toHaveTextContent('0.00')
    expect(cardsFor(dialog).every(card => !card.open)).toBe(true)
  })

  it('shows a disabled empty state when no rooms are occupied', async () => {
    expect(await localStorageRepository.save(createEmptyData('2026-11-23'))).toBeNull()
    const user = userEvent.setup()
    renderApp()
    await user.click(await screen.findByRole('button', { name: /Calculate payment/ }))
    const dialog = screen.getByRole('dialog', { name: 'Choose a room and its bills.' })
    const roomSelect = within(dialog).getByLabelText('Choose room') as HTMLSelectElement
    expect(roomSelect).toBeDisabled()
    expect(within(roomSelect).getByRole('option', { name: 'No occupied rooms available' })).toBeInTheDocument()
    expect(within(dialog).getByText(/Historical balances remain accessible from Pending Payments/)).toBeInTheDocument()
    expect(cardsFor(dialog)).toHaveLength(0)
    expect(within(dialog).getByRole('button', { name: /Review payment/ })).toBeDisabled()
  })

  it('opens an authorized historical room from Pending Payments without adding it to the occupied selector', async () => {
    const data = overdueWorkspace()
    data.roomAssignments = data.roomAssignments.map(assignment => assignment.roomId === 'room-2' ? { ...assignment, endDate: '2026-11-01' } : assignment)
    expect(await localStorageRepository.save(data)).toBeNull()
    const user = userEvent.setup()
    renderApp(localStorageRepository, '/billing?collectRoom=room-2')
    const dialog = await screen.findByRole('dialog', { name: 'Choose a room and its bills.' })
    const roomSelect = within(dialog).getByLabelText('Choose room') as HTMLSelectElement
    expect(roomSelect).toBeDisabled()
    expect(within(roomSelect).getByRole('option', { name: 'No occupied rooms available' })).toBeInTheDocument()
    expect(within(dialog).getByRole('note', { name: '' })).toHaveTextContent('Historical room collection: Room 2')
    expect(cardsFor(dialog).every(card => !card.open)).toBe(true)
    await expand(user, dialog, 'Anniversary-based billing')
    await user.click(within(dialog).getByRole('checkbox', { name: /Rent — Aug 6/ }))
    expect(within(dialog).getByLabelText('Total to pay')).toHaveTextContent('3,500.00')
  })

  it('uses the server catalog, reports a failed command, retries the same key, and never writes localStorage', async () => {
    vi.stubEnv('VITE_BHMS_API_BASE_URL', '/api/v1')
    const data = overdueWorkspace()
    const items = collectionCatalog(data, 'room-2', '2026-11-23')
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementation(async () => new Response(JSON.stringify({ items, serverDate: '2026-11-23' }), { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const command = vi.fn<NonNullable<PrototypeRepository['command']>>().mockRejectedValue(new Error('Connection lost'))
    const save = vi.fn<PrototypeRepository['save']>()
    renderApp({ mode: 'server', load: async () => ({ data, canPersist: true, warning: null, revision: 1 }), save, command })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Calculate payment/ }))
    const dialog = screen.getByRole('dialog', { name: 'Choose a room and its bills.' })
    await user.selectOptions(within(dialog).getByLabelText('Choose room'), 'room-2')
    expect(within(dialog).getByText('Loading authoritative obligations…')).toBeInTheDocument()
    await user.click(await within(dialog).findByRole('button', { name: 'Retry loading obligations' }))
    await expand(user, dialog, 'Anniversary-based billing')
    await user.click(await within(dialog).findByRole('checkbox', { name: /Rent — Aug 6/ }))
    await user.click(within(dialog).getByRole('button', { name: /Review payment/ }))
    const review = screen.getByRole('dialog', { name: 'Confirm payment received' })
    await user.click(within(review).getByRole('button', { name: 'Confirm payment received' }))
    await user.click(await within(review).findByRole('button', { name: 'Retry payment' }))
    await waitFor(() => expect(command).toHaveBeenCalledTimes(2))
    expect(command.mock.calls[0]![1]).toBe(command.mock.calls[1]![1])
    expect(save).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Payment recorded' })).not.toBeInTheDocument()
  })
})
