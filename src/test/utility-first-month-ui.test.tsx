import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRouter } from '@/app/router/app-router'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { createEmptyData } from '@/data/fixtures/empty'
import { localStorageRepository, STORAGE_KEY } from '@/data/repositories/local-storage-repository'

function renderApp(route = '/') {
  return render(<PrototypeProvider repository={localStorageRepository}><MemoryRouter initialEntries={[route]}><AppRouter /></MemoryRouter></PrototypeProvider>)
}

function savedData() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')!.data
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-07-20T04:00:00.000Z'))
  localStorage.clear()
  const empty = createEmptyData('2026-07-20')
  empty.rooms = empty.rooms.map(room => room.id === 'room-2' ? { ...room, washingMachineEnabled: false } : room)
  expect(await localStorageRepository.save(empty)).toBeNull()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('first-month utility billing UI', () => {
  it('keeps advance-covered rent PAID while water is payable and electricity awaits a reading', async () => {
    const user = userEvent.setup()
    const app = renderApp('/tenants')
    await user.click(await screen.findByRole('button', { name: 'Add tenant' }))
    const addDialog = await screen.findByRole('dialog', { name: 'Add a tenant' })
    await user.type(within(addDialog).getByLabelText('Full name'), 'July Room Two')
    await user.selectOptions(within(addDialog).getByLabelText('Room assignment'), 'room-2')
    const moveIn = within(addDialog).getByLabelText('Move-in date')
    await user.clear(moveIn)
    await user.type(moveIn, '2026-07-06')
    await user.click(within(addDialog).getByRole('button', { name: 'Add tenant' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Tenant added successfully' })).getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    await user.click(within(nav).getByRole('link', { name: 'Billing' }))
    const moveInSection = await screen.findByRole('region', { name: 'Move-in advance & security deposit' })
    await user.click(within(moveInSection).getByRole('button', { name: 'Record move-in payment for room 2' }))
    const moveInDialog = await screen.findByRole('dialog', { name: 'Record a move-in payment.' })
    const paymentDate = within(moveInDialog).getByLabelText(/Payment date/)
    await user.clear(paymentDate)
    await user.type(paymentDate, '2026-07-06')
    await user.click(within(moveInDialog).getByRole('button', { name: 'Record payment' }))
    expect(await within(moveInDialog).findByText('Move-in payment saved.')).toBeInTheDocument()
    await user.click(within(moveInDialog).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    let table = await screen.findByRole('table', { name: 'Who has paid' })
    let row = within(table).getByRole('row', { name: /Room 2/ })
    expect(row).toHaveTextContent('RentPAID')
    expect(row).toHaveTextContent('ElectricityAWAITING READING')
    expect(row).toHaveTextContent(/Water.*100\.00/)
    expect(row).toHaveTextContent('Washing machineDID NOT AVAIL')
    expect(row).toHaveTextContent('StatusPARTLY PAID')

    let data = savedData()
    expect(data.charges.filter((charge: { category: string }) => charge.category === 'WATER')).toHaveLength(0)
    expect(data.charges.filter((charge: { category: string }) => charge.category === 'WASHING_MACHINE')).toHaveLength(0)
    expect(data.advanceApplications).toHaveLength(1)
    expect(data.rentObligations).toHaveLength(1)
    expect(data.charges.find((charge: { category: string }) => charge.category === 'SECURITY_DEPOSIT')).toBeDefined()

    await user.click(await screen.findByRole('button', { name: /Calculate payment/ }))
    let dialog = screen.getByRole('dialog', { name: 'Choose a room and its bills.' })
    await user.selectOptions(within(dialog).getByLabelText('Choose room'), 'room-2')
    const cards = [...dialog.querySelectorAll('details.payment-obligation-card')]
    await user.click(cards.find(card => card.textContent?.includes('Anniversary-based billing'))!.querySelector('summary')!)
    await user.click(cards.find(card => card.textContent?.includes('Calendar-month billing'))!.querySelector('summary')!)
    expect(within(dialog).getByRole('checkbox', { name: 'Rent' })).toBeDisabled()
    await user.click(within(dialog).getByRole('checkbox', { name: 'Water' }))
    expect(within(dialog).getByLabelText('Total to pay')).toHaveTextContent('100.00')
    await user.click(within(dialog).getByRole('button', { name: /Review payment/ }))
    dialog = screen.getByRole('dialog', { name: 'Confirm payment received' })
    await user.click(within(dialog).getByRole('button', { name: 'Confirm payment received' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Payment recorded' })).getByRole('button', { name: 'Got it' }))

    table = await screen.findByRole('table', { name: 'Who has paid' })
    row = within(table).getByRole('row', { name: /Room 2/ })
    expect(row).toHaveTextContent('RentPAID')
    expect(row).toHaveTextContent('ElectricityAWAITING READING')
    expect(row).toHaveTextContent('WaterPAID')
    expect(row).toHaveTextContent('StatusPARTLY PAID')

    data = savedData()
    expect(data.charges.filter((charge: { category: string }) => charge.category === 'WATER')).toHaveLength(1)
    expect(data.charges.filter((charge: { category: string }) => charge.category === 'ELECTRICITY')).toHaveLength(0)
    expect(data.charges.filter((charge: { category: string }) => charge.category === 'WASHING_MACHINE')).toHaveLength(0)

    app.unmount()
    renderApp('/billing')
    table = await screen.findByRole('table', { name: 'Who has paid' })
    row = within(table).getByRole('row', { name: /Room 2/ })
    expect(row).toHaveTextContent('RentPAID')
    expect(row).toHaveTextContent('ElectricityAWAITING READING')
    expect(row).toHaveTextContent('WaterPAID')
    expect(row).toHaveTextContent('StatusPARTLY PAID')
    expect(savedData().charges.filter((charge: { category: string }) => charge.category === 'WATER')).toHaveLength(1)
  }, 40000)
})
