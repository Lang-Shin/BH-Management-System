import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter, MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router/app-router'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { localStorageRepository, STORAGE_KEY } from '@/data/repositories/local-storage-repository'

function renderMemoryApp(route = '/') {
  return render(<PrototypeProvider repository={localStorageRepository}><MemoryRouter initialEntries={[route]}><AppRouter /></MemoryRouter></PrototypeProvider>)
}

function renderBrowserApp() {
  return render(<PrototypeProvider repository={localStorageRepository}><BrowserRouter><AppRouter /></BrowserRouter></PrototypeProvider>)
}

describe('workspace switching', () => {
  it('places the workspace switch immediately above Log out in the sidebar', async () => {
    renderMemoryApp('/dashboard')
    const switchButton = await screen.findByRole('button', { name: 'Switch to Tenant UI' })
    const logout = screen.getByRole('button', { name: 'Log out' })
    expect(switchButton).toHaveAttribute('type', 'button')
    expect(logout.previousElementSibling).toBe(switchButton)
  })

  it('switches from admin to the tenant workspace and back to the dashboard', async () => {
    const user = userEvent.setup()
    renderMemoryApp('/dashboard')
    await user.click(await screen.findByRole('button', { name: 'Switch to Tenant UI' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Switch to Landlord UI' })).toBeInTheDocument()
    expect(document.title).toBe('Halili BH · Overview')
    const tenantNav = screen.getByRole('navigation', { name: 'Main navigation' })
    expect(within(tenantNav).getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/tenant')
    expect(within(tenantNav).getByRole('link', { name: 'My Payments & Receipts' })).toHaveAttribute('href', '/tenant/payments')
    expect(within(tenantNav).getByRole('link', { name: 'My Room' })).toHaveAttribute('href', '/tenant/room')
    expect(within(tenantNav).queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument()
    expect(within(tenantNav).queryByRole('link', { name: 'Billing' })).not.toBeInTheDocument()
    expect(within(tenantNav).queryByRole('link', { name: 'Payments & Receipts' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Switch to Landlord UI' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Switch to Tenant UI' })).toBeInTheDocument()
    expect(document.title).toBe('Halili BH · Dashboard')
    expect(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')
  })

  it('keeps shared prototype data and saved records across workspace switches', async () => {
    const user = userEvent.setup()
    renderMemoryApp('/dashboard')
    const occupancy = await screen.findByRole('figure', { name: 'Room occupancy analytics' })
    expect(occupancy).toHaveTextContent('4 of 15 rooms occupied · 10 ready to rent')
    await user.click(screen.getByRole('button', { name: 'Switch to Tenant UI' }))
    await screen.findByRole('heading', { level: 1, name: 'Overview' })
    await user.click(screen.getByRole('button', { name: 'Switch to Landlord UI' }))
    const restored = await screen.findByRole('figure', { name: 'Room occupancy analytics' })
    expect(restored).toHaveTextContent('4 of 15 rooms occupied · 10 ready to rent')
    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull())
  })

  it('offers the same switch above Log out inside the mobile drawer and closes it on switch', async () => {
    const user = userEvent.setup()
    renderMemoryApp('/dashboard')
    await user.click(await screen.findByRole('button', { name: 'Open menu' }))
    const drawer = await screen.findByRole('dialog', { name: 'Main menu' })
    const switchButton = within(drawer).getByRole('button', { name: 'Switch to Tenant UI' })
    expect(within(drawer).getByRole('button', { name: 'Log out' }).previousElementSibling).toBe(switchButton)
    await user.click(switchButton)
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Main menu' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Switch to Landlord UI' })).toBeInTheDocument()
  })

  it('supports browser back and forward navigation between workspaces', async () => {
    window.history.replaceState(null, '', '/dashboard')
    const user = userEvent.setup()
    renderBrowserApp()
    expect(await screen.findByRole('figure', { name: 'Room occupancy analytics' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Switch to Tenant UI' }))
    expect(await screen.findByText('Coming in a later phase')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/tenant')
    window.history.back()
    expect(await screen.findByRole('figure', { name: 'Room occupancy analytics' }, { timeout: 3000 })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/dashboard')
    expect(screen.queryByText('Coming in a later phase')).not.toBeInTheDocument()
    window.history.forward()
    expect(await screen.findByText('Coming in a later phase', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/tenant')
  })

  it('redirects unknown tenant sub-routes back to the tenant home', async () => {
    renderMemoryApp('/tenant/unknown')
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Switch to Landlord UI' })).toBeInTheDocument()
  })

  it('opens the same log-out clarification dialog from the tenant workspace', async () => {
    const user = userEvent.setup()
    renderMemoryApp('/tenant')
    await user.click(await screen.findByRole('button', { name: 'Log out' }))
    const dialog = await screen.findByRole('dialog', { name: 'Log out of BHMS?' })
    expect(within(dialog).getByText(/Signing out is not available in this sample yet/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Log out of BHMS?' })).not.toBeInTheDocument())
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument()
  })
})
