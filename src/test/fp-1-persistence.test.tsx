import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router/app-router'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { TENANT_DEMO_STORAGE_KEY } from '@/app/providers/tenant-demo'
import { localStorageRepository, STORAGE_KEY } from '@/data/repositories/local-storage-repository'
import { createDemoData } from '@/data/fixtures/demo'

function renderApp(route = '/') {
  return render(<PrototypeProvider repository={localStorageRepository}><MemoryRouter initialEntries={[route]}><AppRouter /></MemoryRouter></PrototypeProvider>)
}

function savedData() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null').data
}

describe('single-source prototype persistence', () => {
  it('shares user-created rooms and tenants across landlord and tenant workspaces after refresh', async () => {
    const user = userEvent.setup()
    const first = renderApp('/rooms')
    await user.click(await screen.findByRole('button', { name: 'Add room' }))
    let dialog = await screen.findByRole('dialog', { name: 'Add a room' })
    await user.type(within(dialog).getByLabelText('Room number or name'), '900')
    await user.click(within(dialog).getByRole('button', { name: 'Add room' }))
    const roomSaved = await screen.findByRole('dialog', { name: 'Room added successfully' })
    await user.click(within(roomSaved).getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(savedData().rooms.some((room: { name: string }) => room.name === '900')).toBe(true))
    const roomId = savedData().rooms.find((room: { name: string }) => room.name === '900').id
    expect(savedData().rooms.find((room: { id: string }) => room.id === roomId).name).toBe('900')

    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    await user.click(within(nav).getByRole('link', { name: 'Tenants' }))
    await user.click(await screen.findByRole('button', { name: 'Add tenant' }))
    dialog = await screen.findByRole('dialog', { name: 'Add a tenant' })
    await user.type(within(dialog).getByLabelText('Full name'), 'Persistence Tenant')
    await user.selectOptions(within(dialog).getByLabelText('Room assignment'), roomId)
    await user.click(within(dialog).getByRole('button', { name: 'Add tenant' }))
    const tenantSaved = await screen.findByRole('dialog', { name: 'Tenant added successfully' })
    await user.click(within(tenantSaved).getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(savedData().tenants.some((tenant: { name: string }) => tenant.name === 'Persistence Tenant')).toBe(true))
    const tenantId = savedData().tenants.find((tenant: { name: string }) => tenant.name === 'Persistence Tenant').id
    expect(savedData().roomAssignments.find((assignment: { tenantId: string }) => assignment.tenantId === tenantId)).toMatchObject({ roomId })

    await user.click(screen.getByRole('button', { name: 'Switch to Tenant UI' }))
    await screen.findByRole('heading', { level: 1, name: 'Overview' })
    const demoTenant = await screen.findByLabelText('Demo tenant')
    await user.selectOptions(demoTenant, within(demoTenant).getByRole('option', { name: 'Persistence Tenant' }))
    const roomOverview = await screen.findByRole('region', { name: 'Room overview' })
    expect(within(roomOverview).getByRole('heading', { name: 'Room 900' })).toBeInTheDocument()
    expect(within(roomOverview).getByRole('heading', { name: 'Tenant' })).toBeInTheDocument()
    expect(localStorage.getItem(TENANT_DEMO_STORAGE_KEY)).toBe(tenantId)

    first.unmount()
    renderApp('/tenant')
    expect(await screen.findByLabelText('Demo tenant')).toHaveValue(tenantId)
    expect(within(await screen.findByRole('region', { name: 'Room overview' })).getByRole('heading', { name: 'Room 900' })).toBeInTheDocument()
    expect(savedData().rooms.filter((room: { name: string }) => room.name === '900')).toHaveLength(1)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).version).toBe(9)
  }, 30000)

  it('restores sample records through the shared reducer without leaving stale demo selection', async () => {
    const user = userEvent.setup()
    const data = createDemoData()
    data.rooms.push({ ...data.rooms[0]!, id: 'room-custom', name: '900' })
    data.rooms[0]!.name = 'Saved Room'
    await localStorageRepository.save(data)
    localStorage.setItem(TENANT_DEMO_STORAGE_KEY, 'tenant-missing')

    renderApp('/rooms')
    await screen.findByRole('button', { name: 'Room 900 details' })
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    await user.click(within(nav).getByRole('link', { name: 'Reports & Settings' }))
    await user.click(await screen.findByRole('button', { name: 'Restore sample records' }))
    const dialog = await screen.findByRole('dialog', { name: 'Restore the sample records?' })
    await user.click(within(dialog).getByRole('button', { name: 'Yes, restore records' }))
    await waitFor(() => expect(savedData().rooms).toHaveLength(15))
    expect(savedData().rooms.some((room: { id: string }) => room.id === 'room-custom')).toBe(false)
    expect(savedData().rooms[0].name).toBe('1')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).version).toBe(9)

    await user.click(within(nav).getByRole('link', { name: 'Rooms' }))
    await screen.findByRole('button', { name: 'Room 1 details' })
    expect(screen.queryByRole('button', { name: 'Room 900 details' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Switch to Tenant UI' }))
    await screen.findByRole('heading', { level: 1, name: 'Overview' })
    expect(await screen.findByLabelText('Demo tenant')).toHaveValue('tenant-1')
  }, 30000)
})
