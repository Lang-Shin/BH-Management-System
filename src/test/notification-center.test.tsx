import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRouter } from '@/app/router/app-router'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { localStorageRepository } from '@/data/repositories/local-storage-repository'
import { loadReadIds, NOTIFICATION_STORAGE_KEY } from '@/features/notifications/read-state'

function renderApp(route = '/dashboard') {
  return render(<PrototypeProvider repository={localStorageRepository}><MemoryRouter initialEntries={[route]}><AppRouter /></MemoryRouter></PrototypeProvider>)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-13T04:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('notification center', () => {
  it('shows the sample digest, marks items read, and persists that state', async () => {
    const user = userEvent.setup()
    const app = renderApp()
    const bell = await screen.findByRole('button', { name: 'Notifications, 4 unread' })
    await user.click(bell)

    const panel = await screen.findByRole('dialog', { name: 'Notifications' })
    expect(within(panel).getByText('8 bills are past due')).toBeInTheDocument()
    expect(within(panel).getByText(/₱11,056\.00 known still to pay/)).toBeInTheDocument()
    expect(within(panel).getByText('3 bills are due in the next 7 days')).toBeInTheDocument()
    expect(within(panel).getByText(/₱3,700\.00 still to pay/)).toBeInTheDocument()
    expect(within(panel).getByText('Room 6 is under repair')).toBeInTheDocument()
    expect(within(panel).getByText('₱500.00 advance payment is held')).toBeInTheDocument()

    await user.click(within(panel).getByRole('link', { name: /8 bills are past due/ }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Billing' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Notifications, 3 unread' })).toBeInTheDocument()

    app.unmount()
    renderApp('/billing')
    expect(await screen.findByRole('button', { name: 'Notifications, 3 unread' })).toBeInTheDocument()
    expect(loadReadIds()).toContain('overdue:8:1105600:2')
  })

  it('marks every item as read and closes with Escape', async () => {
    const user = userEvent.setup()
    renderApp()
    const bell = await screen.findByRole('button', { name: 'Notifications, 4 unread' })
    await user.click(bell)
    const panel = await screen.findByRole('dialog', { name: 'Notifications' })
    await user.click(within(panel).getByRole('button', { name: 'Mark all as read' }))
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument()
    expect(within(panel).queryByText(/Unread:/)).not.toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Notifications' })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Notifications' })).toHaveFocus()
  })

  it('ignores malformed saved read state', async () => {
    localStorage.setItem(NOTIFICATION_STORAGE_KEY, '{not-json')
    renderApp()
    expect(await screen.findByRole('button', { name: 'Notifications, 4 unread' })).toBeInTheDocument()
    expect(loadReadIds()).toEqual([])
  })

  it('clears read state when all records are cleared', async () => {
    localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify({ version: 1, readIds: ['overdue:8:1105600:2'] }))
    const user = userEvent.setup()
    renderApp('/reports')
    expect(await screen.findByRole('button', { name: 'Notifications, 3 unread' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear All Records' }))
    const dialog = screen.getByRole('dialog', { name: 'Clear all records?' })
    await user.type(within(dialog).getByLabelText(/Type RESET to confirm/), 'RESET')
    await user.click(within(dialog).getByRole('button', { name: 'Clear All Records' }))

    await waitFor(() => expect(screen.getByText('All tenant and financial records were cleared. Room configuration was preserved.')).toBeInTheDocument())
    expect(loadReadIds()).toEqual([])
  })
})
