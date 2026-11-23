import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { AppRouter } from '@/app/router/app-router'
import { localStorageRepository, STORAGE_KEY } from '@/data/repositories/local-storage-repository'
import type { PrototypeRepository } from '@/data/repositories/prototype-repository'
import { collectionCatalog } from '@/domain/calculations/payment-collection'
import { rentObligationPaidCents } from '@/domain/calculations/rental-periods'
import { overdueWorkspace } from './collection-fixture'

const now = () => new Date('2026-11-23T04:00:00Z')
const renderApp = (repository: PrototypeRepository = localStorageRepository) => render(<PrototypeProvider repository={repository} now={now}><MemoryRouter initialEntries={['/billing']}><AppRouter /></MemoryRouter></PrototypeProvider>)
beforeEach(async () => { expect(await localStorageRepository.save(overdueWorkspace())).toBeNull() })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('two-card historical payment workflow', () => {
  it('collects August rent in November, preserves other months, renders the receipt and survives refresh', async () => {
    const user = userEvent.setup()
    const app = renderApp()
    await user.click(await screen.findByRole('button', { name: /Calculate payment/ }))
    const calculator = screen.getByRole('dialog', { name: 'Choose a room and its bills.' })
    await user.selectOptions(within(calculator).getByLabelText('Choose room'), 'room-2')
    expect(calculator.querySelectorAll('.payment-obligation-card')).toHaveLength(2)
    expect(within(calculator).getByText('Anniversary-based billing')).toBeVisible()
    expect(within(calculator).getByText('Calendar-month billing')).toBeVisible()
    expect(within(calculator).queryByText('Rent is due in anniversary billing')).not.toBeInTheDocument()
    expect(within(calculator).queryByRole('checkbox', { name: /Rent — Jul/ })).not.toBeInTheDocument()
    expect(within(calculator).getByLabelText('Total to pay')).toHaveTextContent('0.00')
    await user.click(within(calculator).getByRole('checkbox', { name: /Rent — Aug 6/ }))
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
    expect(within(refreshed).queryByRole('checkbox', { name: /Rent — Aug 6/ })).not.toBeInTheDocument()
    expect(within(refreshed).getByRole('checkbox', { name: /Rent — Sep 6/ })).not.toBeChecked()
  })

  it('collapses cards independently, clears selections on room changes, and displays empty rooms', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.click(await screen.findByRole('button', { name: /Calculate payment/ }))
    const dialog = screen.getByRole('dialog', { name: 'Choose a room and its bills.' })
    await user.selectOptions(within(dialog).getByLabelText('Choose room'), 'room-2')
    await user.click(within(dialog).getByRole('checkbox', { name: /Rent — Aug 6/ }))
    const cards = dialog.querySelectorAll('details.payment-obligation-card')
    await user.click(cards[0]!.querySelector('summary')!)
    expect(cards[0]).not.toHaveAttribute('open')
    expect(cards[1]).toHaveAttribute('open')
    await user.selectOptions(within(dialog).getByLabelText('Choose room'), 'room-8')
    expect(within(dialog).getByLabelText('Total to pay')).toHaveTextContent('0.00')
    expect(within(dialog).getByText('All rent periods paid')).toBeInTheDocument()
    expect(within(dialog).getByText('No unpaid utility obligations.')).toBeInTheDocument()
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
