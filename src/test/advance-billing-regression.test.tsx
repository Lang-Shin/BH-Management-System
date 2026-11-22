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
  vi.setSystemTime(new Date('2026-11-23T04:00:00.000Z'))
  localStorage.clear()
  await localStorageRepository.save(createEmptyData('2026-11-23'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('advance billing repro', () => {
  it('marks Room 2 first anniversary rent PAID after advance and deposit collection', async () => {
    const user = userEvent.setup()
    renderApp('/tenants')
    await user.click(await screen.findByRole('button', { name: 'Add tenant' }))
    const addDialog = await screen.findByRole('dialog', { name: 'Add a tenant' })
    await user.type(within(addDialog).getByLabelText('Full name'), 'Room Two Tenant')
    await user.selectOptions(within(addDialog).getByLabelText('Room assignment'), 'room-2')
    const moveIn = within(addDialog).getByLabelText('Move-in date')
    await user.clear(moveIn)
    await user.type(moveIn, '2026-11-03')
    await user.click(within(addDialog).getByRole('button', { name: 'Add tenant' }))
    const added = await screen.findByRole('dialog', { name: 'Tenant added successfully' })
    await user.click(within(added).getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    expect(savedData().moveInObligations).toHaveLength(1)
    expect(savedData().rentObligations).toHaveLength(1)

    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    await user.click(within(nav).getByRole('link', { name: 'Billing' }))
    const moveInSection = await screen.findByRole('region', { name: 'Move-in advance & security deposit' })
    await user.click(within(moveInSection).getByRole('button', { name: 'Record move-in payment for room 2' }))
    const dialog = await screen.findByRole('dialog', { name: 'Record a move-in payment.' })
    expect(within(dialog).getByLabelText('Advance', { selector: 'input' })).toBeChecked()
    expect(within(dialog).getByLabelText('Security deposit', { selector: 'input' })).toBeChecked()
    await user.click(within(dialog).getByRole('button', { name: 'Record payment' }))
    expect(await within(dialog).findByText('Move-in payment saved.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    const data = savedData()
    expect(data.advanceApplications).toHaveLength(1)
    expect(data.advanceApplications[0].rentObligationId).toBe(data.rentObligations[0].id)

    const table = await screen.findByRole('table', { name: 'Who has paid' })
    const row = within(table).getByRole('row', { name: /Room 2/ })
    expect(row).not.toHaveTextContent('3,500.00')
    expect(row).toHaveTextContent('PAID')
  })
})
