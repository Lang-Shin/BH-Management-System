import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router/app-router'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import { createDemoData } from '@/data/fixtures/demo'
import { localStorageRepository } from '@/data/repositories/local-storage-repository'
import { prepareMoveInPayment, selectMoveInObligations } from '@/domain/calculations/move-in'
import { selectNotifications } from '@/features/notifications/select-notifications'
import type { TenantDraft } from '@/domain/calculations/tenant-management'
import type { PrototypeAppState } from '@/domain/types/models'

const AS_OF = '2026-11-20'

function tenantDraft(name: string, roomId: string, moveInDate: string): TenantDraft {
  return { name, email: `${name.toLowerCase().replaceAll(' ', '.')}@example.com`, phone: '', address: '', roomId, moveInDate, notes: '' }
}

function createInRoom(data: PrototypeAppState, name: string, roomId: string, asOf: string) {
  const next = prototypeReducer(data, { type: 'tenant/created', asOf, draft: tenantDraft(name, roomId, asOf) })
  const tenant = next.tenants.find(item => !data.tenants.some(existing => existing.id === item.id))
  if (!tenant) throw new Error(`${name} was not created`)
  return { data: next, tenant }
}

function payRoom(data: PrototypeAppState, roomId: string, paidOn: string) {
  const view = selectMoveInObligations(data, paidOn, roomId).find(item => item.cycle.status === 'ACTIVE')
  if (!view) throw new Error(`No active move-in obligation for ${roomId}`)
  const paid = prepareMoveInPayment(data, { obligationId: view.obligation.id, categories: ['ADVANCE', 'SECURITY_DEPOSIT'], paidOn })
  if (!paid.ok) throw new Error(paid.reason)
  return paid.data
}

function fixture() {
  const transfer = createInRoom(createDemoData(), 'Transfer Review Tenant', 'room-14', '2026-11-13')
  let data = payRoom(transfer.data, 'room-14', '2026-11-13')
  data = prototypeReducer(data, {
    type: 'tenant/updated', tenantId: transfer.tenant.id, asOf: AS_OF,
    draft: tenantDraft('Transfer Review Tenant', 'room-15', AS_OF),
  })
  const deposit = createInRoom(data, 'Deposit History Tenant', 'room-9', AS_OF)
  data = payRoom(deposit.data, 'room-9', AS_OF)
  data = prototypeReducer(data, { type: 'tenant/movedOut', tenantId: deposit.tenant.id, asOf: AS_OF })
  return data
}

function renderAppAt(data: PrototypeAppState) {
  return localStorageRepository.save(data).then(warning => {
    if (warning) throw new Error(warning)
    return render(<PrototypeProvider repository={localStorageRepository} now={() => new Date(AS_OF + 'T04:00:00.000Z')}><MemoryRouter initialEntries={['/billing']}><AppRouter /></MemoryRouter></PrototypeProvider>)
  })
}

describe('review notification center flow', () => {
  it('opens transfer and deposit review dialogs without rendering static billing panels', async () => {
    const data = fixture()
    const user = userEvent.setup()
    const expectedUnread = selectNotifications(data, AS_OF).length
    await renderAppAt(data)
    expect(await screen.findByRole('heading', { level: 1, name: 'Billing' })).toBeInTheDocument()
    expect(screen.queryByText('Transfer review proposals')).not.toBeInTheDocument()
    expect(screen.queryByText('Move-out deposit records')).not.toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: `Notifications, ${expectedUnread} unread` }))
    let panel = await screen.findByRole('dialog', { name: 'Notifications' })
    await user.click(within(panel).getByRole('button', { name: /1 move-in transfer rent review/ }))
    let review = await screen.findByRole('dialog', { name: 'Move-in transfer rent reviews' })
    expect(review).toHaveTextContent('Room 02')
    expect(review).toHaveTextContent('₱4,000.00')
    expect(review).toHaveTextContent('₱5,000.00')
    await user.click(within(review).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.getByRole('button', { name: `Notifications, ${expectedUnread - 1} unread` })).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: `Notifications, ${expectedUnread - 1} unread` }))
    panel = await screen.findByRole('dialog', { name: 'Notifications' })
    await user.click(within(panel).getByRole('button', { name: /move-out deposit records retained/ }))
    review = await screen.findByRole('dialog', { name: 'Move-out deposit records' })
    expect(review).toHaveTextContent('Room 01')
    expect(review).toHaveTextContent('Deposit held')
    expect(review).toHaveTextContent('₱4,000.00')
    await user.click(within(review).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.getByRole('button', { name: `Notifications, ${expectedUnread - 2} unread` })).toBeInTheDocument())
  }, 15000)
})
