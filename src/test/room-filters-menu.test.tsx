import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router/app-router'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { localStorageRepository } from '@/data/repositories/local-storage-repository'

function renderRooms() {
  return render(<PrototypeProvider repository={localStorageRepository}><MemoryRouter initialEntries={['/rooms']}><AppRouter /></MemoryRouter></PrototypeProvider>)
}

describe('room filters dropdown', () => {
  it('opens and closes from the keyboard', async () => {
    const user = userEvent.setup()
    renderRooms()
    await screen.findByRole('heading', { level: 1, name: 'Rooms' })
    const trigger = screen.getByRole('button', { name: 'Filters: All rooms' })
    trigger.focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('menu')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('shows every room-status option and applies the selected filter', async () => {
    const user = userEvent.setup()
    renderRooms()
    await screen.findByRole('heading', { level: 1, name: 'Rooms' })
    const trigger = screen.getByRole('button', { name: 'Filters: All rooms' })
    await user.click(trigger)
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByText('Filters')).toBeInTheDocument()
    for (const option of ['SHOW ALL', 'Occupied', 'Reserved', 'Available', 'Under repair']) {
      expect(within(menu).getByRole('menuitemcheckbox', { name: option })).toBeInTheDocument()
    }

    await user.click(within(menu).getByRole('menuitemcheckbox', { name: 'Occupied' }))
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Filters: Occupied' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Room 1 details' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Room 01 details' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Filters: Occupied' }))
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitemcheckbox', { name: 'Under repair' }))
    expect(await screen.findByRole('button', { name: 'Room 6 details' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Room 1 details' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Filters: Under repair' }))
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitemcheckbox', { name: 'SHOW ALL' }))
    expect(await screen.findByRole('button', { name: 'Room 01 details' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Filters: All rooms' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Filters: All rooms' }))
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitemcheckbox', { name: 'Available' }))
    expect(await screen.findByRole('button', { name: 'Room 01 details' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Room 1 details' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Filters: Available' }))
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitemcheckbox', { name: 'Reserved' }))
    expect(await screen.findByText('No rooms here')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Filters: Reserved' })).toBeInTheDocument()
  })
})
