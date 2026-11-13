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
    expect(await screen.findByRole('heading', { name: 'A clear view of your boarding house.' }, { timeout: 5000 })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    for (const title of ['Tenants', 'Rooms', 'Billing', 'Payments & Receipts', 'Reports & Settings']) {
      await user.click(within(nav).getByRole('link', { name: title }))
      // Lazy modules may need an initial transform under parallel Windows test workers.
      expect(await screen.findByRole('heading', { level: 1, name: title }, { timeout: 5000 })).toBeInTheDocument()
      expect(within(nav).getByRole('link', { name: title })).toHaveAttribute('aria-current', 'page')
    }
  }, 15000)

  it('filters tenants, shows an empty state, and preserves saved notes after remount', async () => {
    const user = userEvent.setup()
    const app = renderApp('/tenants')
    const search = await screen.findByRole('searchbox', { name: 'Search tenants' })
    await user.type(search, 'no such resident')
    expect(screen.getByText('No results found')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    await user.click(screen.getByRole('button', { name: 'View Alex Rivera' }))
    await user.type(screen.getByLabelText('Demo notes'), 'Fictional reminder')
    await user.click(screen.getByRole('button', { name: 'Save demo note' }))
    expect(screen.getByText('Demo note saved')).toBeInTheDocument()
    app.unmount()
    renderApp('/tenants')
    await user.click(await screen.findByRole('button', { name: 'View Alex Rivera' }))
    expect(screen.getByLabelText('Demo notes')).toHaveValue('Fictional reminder')
  })

  it('opens mobile navigation, changes route, and dismisses the drawer', async () => {
    const user = userEvent.setup()
    renderApp('/dashboard')
    await screen.findByRole('heading', { level: 1 })
    await user.click(screen.getByRole('button', { name: 'Open navigation' }))
    const drawer = screen.getByRole('dialog', { name: 'Admin navigation' })
    await user.click(within(drawer).getByRole('link', { name: 'Rooms' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Rooms' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('keeps damaged saved data until an explicit reset and then persists fresh data', async () => {
    localStorage.setItem(STORAGE_KEY, '{broken')
    const user = userEvent.setup()
    renderApp('/dashboard')
    expect(await screen.findByRole('alert')).toHaveTextContent('Saved demo data could not be loaded')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('{broken')
    await user.click(screen.getByRole('button', { name: 'Reset demo' }))
    const dialog = screen.getByRole('dialog', { name: 'Reset the demo workspace?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(localStorage.getItem(STORAGE_KEY)).toBe('{broken')
    expect(screen.getByRole('alert')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reset demo' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Reset the demo workspace?' })).getByRole('button', { name: 'Reset demo' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toHaveProperty('version', 2)
  })

  it('handles unknown deep links with a route back home', async () => {
    renderApp('/missing-page')
    expect(await screen.findByText('This page has no room here')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/dashboard')
  })

  it('shows category applicability separately from unpaid status and can switch sample periods', async () => {
    const user = userEvent.setup()
    renderApp('/billing')
    const matrix = await screen.findByRole('region', { name: 'Fictional per-category billing status matrix' })
    const alex = within(matrix).getByRole('row', { name: /Alex Rivera/ })
    expect(within(alex).getByText('Not applicable')).toBeInTheDocument()
    expect(within(alex).getByText('Partially paid')).toBeInTheDocument()
    const taylor = within(matrix).getByRole('row', { name: /Taylor Reyes/ })
    expect(within(taylor).getAllByText('Unpaid')).toHaveLength(2)
    await user.selectOptions(screen.getByLabelText('Billing period'), 'period-oct')
    expect(within(matrix).getByRole('row', { name: /Quinn Mendoza/ })).toBeInTheDocument()
    expect(within(matrix).queryByRole('row', { name: /Alex Rivera/ })).not.toBeInTheDocument()
    expect(screen.getByText('Historical sample rate')).toBeInTheDocument()
  })

  it('marks financial workflows as placeholders without payment or receipt action buttons', async () => {
    renderApp('/payments')
    expect(await screen.findByText('Payment recording and full payments')).toBeInTheDocument()
    expect(screen.getByText('Prototype placeholders · Not implemented')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Fictional advance payment credits' })).toHaveTextContent('₱500.00')
    expect(screen.queryByRole('button', { name: /record payment|issue receipt|allocate|correct payment/i })).not.toBeInTheDocument()
  })
})
