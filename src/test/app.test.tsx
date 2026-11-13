import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { App } from '@/app'
import { PrototypeProvider } from '@/state/prototype-context'
import { STORAGE_KEY } from '@/state/persistence'

function renderApp(route = '/') {
  return render(<PrototypeProvider><MemoryRouter initialEntries={[route]}><App /></MemoryRouter></PrototypeProvider>)
}

describe('admin workspace integration', () => {
  it('redirects the root and navigates all six modules', async () => {
    const user = userEvent.setup()
    renderApp()
    expect(await screen.findByRole('heading', { name: 'A clear view of your boarding house.' })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    for (const title of ['Tenants', 'Rooms', 'Billing', 'Payments', 'Reports']) {
      await user.click(within(nav).getByRole('link', { name: title }))
      expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument()
    }
  })

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
    expect(screen.getByRole('alert')).toHaveTextContent('Saved demo data could not be loaded')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('{broken')
    await user.click(screen.getByRole('button', { name: 'Reset demo' }))
    const dialog = screen.getByRole('dialog', { name: 'Reset the demo workspace?' })
    await user.click(within(dialog).getByRole('button', { name: 'Reset demo' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toHaveProperty('version', 1)
  })

  it('handles unknown deep links with a route back home', async () => {
    renderApp('/missing-page')
    expect(await screen.findByText('This page has no room here')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/dashboard')
  })
})
