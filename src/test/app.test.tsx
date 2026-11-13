import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router/app-router'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { localStorageRepository, STORAGE_KEY } from '@/data/repositories/local-storage-repository'

function renderApp(route = '/') {
  return render(<PrototypeProvider repository={localStorageRepository}><MemoryRouter initialEntries={[route]}><AppRouter /></MemoryRouter></PrototypeProvider>)
}

describe('admin workspace integration', () => {
  it('redirects the root and navigates all six modules', async () => {
    const user = userEvent.setup()
    renderApp()
    expect(await screen.findByRole('heading', { level: 1, name: 'Home' }, { timeout: 5000 })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    for (const title of ['Tenants', 'Rooms', 'Bills', 'Payments & Receipts', 'Reports & Settings']) {
      await user.click(within(nav).getByRole('link', { name: title }))
      // Lazy modules may need an initial transform under parallel Windows test workers.
      expect(await screen.findByRole('heading', { level: 1, name: title }, { timeout: 5000 })).toBeInTheDocument()
      expect(within(nav).getByRole('link', { name: title })).toHaveAttribute('aria-current', 'page')
    }
  }, 15000)

  it('filters tenants, shows an empty state, and preserves saved notes after remount', async () => {
    const user = userEvent.setup()
    const app = renderApp('/tenants')
    const search = await screen.findByRole('searchbox', { name: 'Find a tenant' })
    await user.type(search, 'no such resident')
    expect(screen.getByText('No results found')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    await user.click(screen.getByRole('button', { name: 'View Alex Rivera' }))
    await user.type(screen.getByLabelText('Notes'), 'Fictional reminder')
    await user.click(screen.getByRole('button', { name: 'Save note' }))
    expect(screen.getByText('Note saved')).toBeInTheDocument()
    app.unmount()
    renderApp('/tenants')
    await user.click(await screen.findByRole('button', { name: 'View Alex Rivera' }))
    expect(screen.getByLabelText('Notes')).toHaveValue('Fictional reminder')
  })

  it('opens mobile navigation, changes route, and dismisses the drawer', async () => {
    const user = userEvent.setup()
    renderApp('/dashboard')
    await screen.findByRole('heading', { level: 1 })
    await user.click(screen.getByRole('button', { name: 'Open menu' }))
    const drawer = screen.getByRole('dialog', { name: 'Main menu' })
    await user.click(within(drawer).getByRole('link', { name: 'Rooms' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Rooms' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('keeps damaged saved data until an explicit reset and then persists fresh data', async () => {
    localStorage.setItem(STORAGE_KEY, '{broken')
    const user = userEvent.setup()
    renderApp('/reports')
    expect(await screen.findByRole('alert')).toHaveTextContent('saved sample records could not be opened')
    await screen.findByRole('heading', { level: 1, name: 'Reports & Settings' })
    expect(localStorage.getItem(STORAGE_KEY)).toBe('{broken')
    await user.click(screen.getByRole('button', { name: 'Restore sample records' }))
    const dialog = screen.getByRole('dialog', { name: 'Restore the sample records?' })
    await user.click(within(dialog).getByRole('button', { name: 'Keep my changes' }))
    expect(localStorage.getItem(STORAGE_KEY)).toBe('{broken')
    expect(screen.getByRole('alert')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Restore sample records' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Restore the sample records?' })).getByRole('button', { name: 'Yes, restore records' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toHaveProperty('version', 2)
  })

  it('handles unknown deep links with a route back home', async () => {
    renderApp('/missing-page')
    expect(await screen.findByText('This page could not be found')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Back to Home' })[0]).toHaveAttribute('href', '/dashboard')
  })

  it('shows category applicability separately from unpaid status and can switch sample periods', async () => {
    const user = userEvent.setup()
    renderApp('/billing')
    const matrix = await screen.findByRole('region', { name: 'Who has paid' })
    const alex = within(matrix).getByRole('row', { name: /Alex Rivera/ })
    expect(within(alex).getByText('No bill')).toBeInTheDocument()
    expect(within(alex).getByText('Partly paid')).toBeInTheDocument()
    const taylor = within(matrix).getByRole('row', { name: /Taylor Reyes/ })
    expect(within(taylor).getAllByText('Not yet paid')).toHaveLength(2)
    await user.selectOptions(screen.getByLabelText('Choose a month'), 'period-oct')
    expect(within(matrix).getByRole('row', { name: /Quinn Mendoza/ })).toBeInTheDocument()
    expect(within(matrix).queryByRole('row', { name: /Alex Rivera/ })).not.toBeInTheDocument()
  })

  it('marks financial workflows as placeholders without payment or receipt action buttons', async () => {
    const user = userEvent.setup()
    renderApp('/payments')
    await user.click(await screen.findByText('More payment tools'))
    expect(screen.getByText('Record a payment')).toBeVisible()
    expect(screen.getByText('These tools are not available yet.')).toBeVisible()
    expect(screen.getByRole('region', { name: 'Advance payments' })).toHaveTextContent('₱500.00')
    expect(screen.queryByRole('button', { name: /record payment|issue receipt|allocate|correct payment/i })).not.toBeInTheDocument()
  })

  it('shows room totals and does not offer an occupied shared room as available', async () => {
    const user = userEvent.setup()
    renderApp('/rooms')
    const rentedRoom = await screen.findByRole('article', { name: 'Room 102' })
    expect(rentedRoom).toHaveTextContent('Occupied')
    expect(screen.getByText('4 occupied')).toBeInTheDocument()
    expect(screen.getByText('1 available')).toBeInTheDocument()
    expect(screen.getByText('1 under repair')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Available' }))
    expect(screen.getByRole('article', { name: 'Room 105' })).toBeInTheDocument()
    expect(screen.queryByRole('article', { name: 'Room 102' })).not.toBeInTheDocument()
    expect(screen.queryByRole('article', { name: 'Room 106' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Occupied' }))
    expect(screen.getAllByRole('article')).toHaveLength(4)
  })

  it('uses plain financial labels and keeps sample-reset controls out of the daily header', async () => {
    renderApp('/dashboard')
    await screen.findByRole('heading', { level: 1, name: 'Home' })
    expect(screen.getByRole('heading', { name: 'Already paid' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Still to pay' })).toBeInTheDocument()
    expect(screen.queryByText('Applied to November charges')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reset demo|restore sample records/i })).not.toBeInTheDocument()
  })
})
