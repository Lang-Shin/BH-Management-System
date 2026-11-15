import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router/app-router'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { localStorageRepository, STORAGE_KEY } from '@/data/repositories/local-storage-repository'
import { selectSummary } from '@/domain/calculations/summary'
import { DEMO_DATE, DEMO_PERIOD } from '@/data/fixtures/demo'
import { formatMoney } from '@/lib/format'
import { RoomOccupancyChart } from '@/features/dashboard/dashboard-analytics'

function renderApp(route = '/') {
  return render(<PrototypeProvider repository={localStorageRepository}><MemoryRouter initialEntries={[route]}><AppRouter /></MemoryRouter></PrototypeProvider>)
}

describe('admin workspace integration', () => {
  it('offers a back-to-top button on Dashboard and a return link on other pages', async () => {
    const user = userEvent.setup()
    renderApp('/dashboard')
    const button = await screen.findByRole('button', { name: 'Back to top' })
    expect(screen.queryByRole('link', { name: 'Back to Dashboard' })).not.toBeInTheDocument()
    await user.click(button)
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'smooth' })
    expect(screen.getByRole('main')).toHaveFocus()
    await user.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'Tenants' }))
    expect(screen.queryByRole('button', { name: 'Back to top' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Dashboard' })).toHaveAttribute('href', '/dashboard')
  })

  it('refreshes dashboard analytics after a room status changes and returning to Dashboard', async () => {
    const user = userEvent.setup()
    renderApp('/dashboard')
    const chart = await screen.findByRole('figure', { name: 'Room occupancy analytics' })
    expect(chart).toHaveTextContent('4 of 6 rooms occupied · 1 ready to rent')
    expect(chart).toHaveTextContent('66.7%')
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    await user.click(within(nav).getByRole('link', { name: 'Rooms' }))
    await user.click(await screen.findByRole('button', { name: 'Mark room 106 as available' }))
    expect(within(screen.getByRole('group', { name: 'Available rooms' })).getByText('2')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Under repair' })).getByText('0')).toBeInTheDocument()
    await user.click(within(nav).getByRole('link', { name: 'Dashboard' }))
    const updated = await screen.findByRole('figure', { name: 'Room occupancy analytics' })
    expect(updated).not.toBe(chart)
    expect(updated).toHaveTextContent('4 of 6 rooms occupied · 2 ready to rent')
    expect(within(updated).getByText('Under repair').parentElement).toHaveTextContent('0(0.0%)')
  })

  it('renders an empty room chart without invalid percentages or phantom segments', () => {
    render(<RoomOccupancyChart summary={{ totalRooms: 0, occupiedRooms: 0, availableRooms: 0, maintenanceRooms: 0 }} />)
    const chart = screen.getByRole('figure', { name: 'Room occupancy analytics' })
    expect(chart).toHaveTextContent('No rooms recorded yet.')
    expect(chart).not.toHaveTextContent(/NaN|Infinity/)
    expect(chart.querySelectorAll('.analytics-doughnut-segment')).toHaveLength(0)
  })

  it('redirects the root and navigates all six modules', async () => {
    const user = userEvent.setup()
    renderApp()
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' }, { timeout: 5000 })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    const header = screen.getByRole('banner')
    const main = screen.getByRole('main')
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')
    for (const title of ['Tenants', 'Rooms', 'Billing', 'Payments & Receipts', 'Reports & Settings']) {
      await user.click(within(nav).getByRole('link', { name: title }))
      expect(await screen.findByRole('heading', { level: 1, name: title }, { timeout: 5000 })).toBeInTheDocument()
      expect(within(nav).getByRole('link', { name: title })).toHaveAttribute('aria-current', 'page')
      expect(screen.getByRole('banner')).toBe(header)
      expect(screen.getByRole('main')).toBe(main)
      expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBe(nav)
    }
    await user.click(within(nav).getByRole('link', { name: 'Dashboard' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument()
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

  it('previews adding a tenant without saving a new record', async () => {
    const user = userEvent.setup()
    renderApp('/tenants')
    await user.click(await screen.findByRole('button', { name: 'Add tenant' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add a tenant' })
    expect(within(dialog).getByLabelText('Full name')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Email address')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Room')).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Full name'), 'Test Tenant')
    await user.click(within(dialog).getByRole('button', { name: 'Add tenant' }))

    const success = await screen.findByRole('dialog', { name: 'Tenant added successfully' })
    expect(within(success).getByText(/No new tenant was saved/)).toBeInTheDocument()
    await user.click(within(success).getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByText('Test Tenant')).not.toBeInTheDocument()
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 10 of 10 tenants')
  })

  it('previews adding a room without changing room records or counts', async () => {
    const user = userEvent.setup()
    renderApp('/rooms')
    const trigger = await screen.findByRole('button', { name: 'Add room' })
    const savedRooms = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').data.rooms
    await user.click(trigger)
    const dialog = await screen.findByRole('dialog', { name: 'Add a room' })
    await user.type(within(dialog).getByLabelText('Room number or name'), '107')
    await user.selectOptions(within(dialog).getByLabelText('Room status'), 'maintenance')
    await user.click(within(dialog).getByRole('button', { name: 'Add room' }))

    const success = await screen.findByRole('dialog', { name: 'Room added successfully' })
    await user.click(within(success).getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByRole('article', { name: 'Room 107' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('article')).toHaveLength(6)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').data.rooms).toEqual(savedRooms)

    await user.click(trigger)
    expect(within(screen.getByRole('dialog', { name: 'Add a room' })).getByLabelText('Room number or name')).toHaveValue('')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('calculates a tenant payment and previews success without updating the ledger', async () => {
    const user = userEvent.setup()
    renderApp('/billing')
    await user.click(await screen.findByRole('button', { name: /Calculate payment/ }))
    const dialog = screen.getByRole('dialog', { name: 'Let’s total it up.' })
    const savedData = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').data
    const done = within(dialog).getByRole('button', { name: 'Done' })
    expect(done).toBeDisabled()
    await user.selectOptions(within(dialog).getByLabelText('Paying tenant'), 'tenant-1')
    await user.type(within(dialog).getByLabelText('Rent payment in pesos'), '3500.50')
    await user.type(within(dialog).getByLabelText('Electricity payment in pesos'), '156.25')
    await user.type(within(dialog).getByLabelText('Water payment in pesos'), '150')
    expect(within(dialog).getByLabelText('Total to pay')).toHaveTextContent('₱3,806.75')
    await user.selectOptions(within(dialog).getByLabelText('Paying tenant'), 'tenant-2')
    expect(within(dialog).getByLabelText('Total to pay')).toHaveTextContent('₱0.00')
    expect(done).toBeDisabled()
    await user.type(within(dialog).getByLabelText('Rent payment in pesos'), '-1')
    expect(within(dialog).getByRole('alert')).toHaveTextContent('two decimal places')
    expect(done).toBeDisabled()
    await user.clear(within(dialog).getByLabelText('Rent payment in pesos'))
    await user.type(within(dialog).getByLabelText('Rent payment in pesos'), '1750.25')
    await user.click(done)
    const success = screen.getByRole('dialog', { name: 'Paid successfully' })
    expect(success).toHaveTextContent('Sam Navarro')
    expect(success).toHaveTextContent('₱1,750.25')
    await user.click(within(success).getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').data).toEqual(savedData)
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

  it('shows a log-out button that opens a centered clarification dialog without signing out', async () => {
    const user = userEvent.setup()
    renderApp('/dashboard')
    const logout = await screen.findByRole('button', { name: 'Log out' })
    expect(logout).toHaveAttribute('type', 'button')
    await user.click(logout)
    const dialog = await screen.findByRole('dialog', { name: 'Log out of BHMS?' })
    expect(within(dialog).getByText(/Signing out is not available in this sample yet/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument()
  })

  it('handles unknown deep links with a route back home', async () => {
    renderApp('/missing-page')
    expect(await screen.findByText('This page could not be found')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Back to Dashboard' })[0]).toHaveAttribute('href', '/dashboard')
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

  it('views receipt snapshots and advance payments without changing records', async () => {
    const user = userEvent.setup()
    renderApp('/payments')
    await user.click(await screen.findByText('View receipt list'))
    const savedData = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').data
    const trigger = within(screen.getByRole('region', { name: 'Sample receipts' })).getByRole('button', { name: 'View receipt DEMO-RCT-001' })
    await user.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Sample receipt · DEMO-RCT-001' })
    expect(dialog).toHaveTextContent('Quinn Mendoza')
    expect(dialog).toHaveTextContent('Nov 2, 2026')
    expect(dialog).toHaveTextContent('₱3,244.00')
    expect(dialog).toHaveTextContent('Bank transfer')
    expect(within(dialog).getByRole('list')).toHaveTextContent('Rent')
    expect(within(dialog).getByRole('list')).toHaveTextContent('Water')
    expect(within(dialog).getByRole('list')).toHaveTextContent('Electricity')
    expect(dialog).toHaveTextContent('Not an official receipt')
    await user.click(within(dialog).getByRole('button', { name: 'Close receipt' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
    await user.click(trigger)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(trigger).toHaveFocus())

    await user.click(screen.getByRole('button', { name: 'View receipt DEMO-RCT-010' }))
    const advance = screen.getByRole('dialog', { name: 'Sample receipt · DEMO-RCT-010' })
    expect(advance).toHaveTextContent('Jordan Flores')
    expect(advance).toHaveTextContent('₱500.00')
    expect(advance).toHaveTextContent('Advance payment — kept for a future bill')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').data).toEqual(savedData)
  })

  it('keeps recording, issuing, and correction workflows as placeholders', async () => {
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
    expect(within(screen.getByRole('group', { name: 'Occupied rooms' })).getByText('4')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Available rooms' })).getByText('1')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Under repair' })).getByText('1')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Available' }))
    expect(screen.getByRole('article', { name: 'Room 105' })).toBeInTheDocument()
    expect(screen.queryByRole('article', { name: 'Room 102' })).not.toBeInTheDocument()
    expect(screen.queryByRole('article', { name: 'Room 106' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Occupied' }))
    expect(screen.getAllByRole('article')).toHaveLength(4)
  })

  it('preserves shared financial summary values and keeps reset controls out of the dashboard', async () => {
    renderApp('/dashboard')
    await screen.findByRole('heading', { level: 1, name: 'Overview' })
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    const summary = selectSummary(saved.data, DEMO_DATE, DEMO_PERIOD)
    const overview = screen.getByRole('region', { name: 'Money overview' })
    for (const [label, value] of [
      ['Total billed', formatMoney(summary.billed)],
      ['Total collected', formatMoney(summary.applied)],
      ['Total outstanding', formatMoney(summary.outstanding)],
      ['Collection rate', `${(summary.applied / summary.billed * 100).toFixed(1)}%`],
    ] as const) {
      const card = within(overview).getByRole('heading', { name: label }).closest('[data-slot="card"]')
      expect(card).toHaveTextContent(value)
    }
    expect(screen.queryByText('Applied to November charges')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reset demo|restore sample records/i })).not.toBeInTheDocument()
  })
})
