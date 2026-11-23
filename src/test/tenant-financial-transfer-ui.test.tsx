import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router/app-router'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import { createEmptyData } from '@/data/fixtures/empty'
import { localStorageRepository, STORAGE_KEY } from '@/data/repositories/local-storage-repository'
import { prepareMoveInPayment, selectMoveInObligations } from '@/domain/calculations/move-in'
import { collectionCatalog, prepareCollection } from '@/domain/calculations/payment-collection'
import { ensureRegularRentPeriodsThrough } from '@/domain/calculations/rent-schedule'
import type { PrototypeAppState } from '@/domain/types/models'
import type { TenantDraft } from '@/domain/calculations/tenant-management'

const AS_OF = '2026-11-23'
const now = () => new Date(`${AS_OF}T04:00:00Z`)
const draft = (name: string, email: string, roomId: string, moveInDate: string): TenantDraft =>
  ({ name, email, phone: '', address: '', notes: '', roomId, moveInDate })
const savedData = (): PrototypeAppState => JSON.parse(localStorage.getItem(STORAGE_KEY)!).data

function addTenant(data: PrototypeAppState, input: TenantDraft) {
  const next = prototypeReducer(data, { type: 'tenant/created', asOf: input.moveInDate, draft: input })
  return { data: next, tenant: next.tenants.find(tenant => tenant.email === input.email)! }
}
function payMoveIn(data: PrototypeAppState, roomId: string, paidOn = '2026-11-01') {
  const view = selectMoveInObligations(data, paidOn, roomId).find(item => item.cycle.status === 'ACTIVE')!
  const paid = prepareMoveInPayment(data, { obligationId: view.obligation.id, categories: ['ADVANCE', 'SECURITY_DEPOSIT'], paidOn })
  if (!paid.ok) throw new Error(paid.reason)
  return paid.data
}
function renderApp() {
  return render(<PrototypeProvider repository={localStorageRepository} now={now}><MemoryRouter initialEntries={['/tenants']}><AppRouter /></MemoryRouter></PrototypeProvider>)
}
async function openTenant(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('button', { name: `View ${name}` }))
  return screen.getByRole('dialog', { name })
}

describe('room-level financial validation in tenant workflows', () => {
  it('shows the room-level move-out blocker to every shared-room occupant', async () => {
    let data = ensureRegularRentPeriodsThrough(createEmptyData(AS_OF), AS_OF)
    const eduard = addTenant(data, draft('Eduard UI', 'eduard.ui@example.com', 'room-8', '2026-10-01'))
    data = payMoveIn(eduard.data, 'room-8', '2026-10-01')
    const renzo = addTenant(data, draft('Renzo UI', 'renzo.ui@example.com', 'room-8', '2026-10-10'))
    data = ensureRegularRentPeriodsThrough(renzo.data, AS_OF)
    expect(await localStorageRepository.save(data)).toBeNull()
    const user = userEvent.setup()
    for (const name of ['Eduard UI', 'Renzo UI']) {
      const app = renderApp()
      const dialog = await openTenant(user, name)
      await user.click(within(dialog).getByRole('button', { name: /Move Out \/ Archive/ }))
      expect(within(dialog).getByRole('alert')).toHaveTextContent('Move-out blocked: Room 8 has unpaid rent')
      expect(within(dialog).getByRole('button', { name: 'Move Out / Archive' })).toBeDisabled()
      app.unmount()
    }
    expect(savedData().tenants.filter(tenant => [eduard.tenant.id, renzo.tenant.id].includes(tenant.id)).every(tenant => tenant.status === 'ACTIVE')).toBe(true)
  }, 30_000)

  it('blocks a direct transfer form and preserves the source room assignment', async () => {
    let data = ensureRegularRentPeriodsThrough(createEmptyData(AS_OF), AS_OF)
    const eduard = addTenant(data, draft('Eduard Transfer', 'eduard.transfer@example.com', 'room-8', '2026-10-01'))
    data = payMoveIn(eduard.data, 'room-8', '2026-10-01')
    const renzo = addTenant(data, draft('Renzo Transfer', 'renzo.transfer@example.com', 'room-8', '2026-10-10'))
    data = ensureRegularRentPeriodsThrough(renzo.data, AS_OF)
    expect(await localStorageRepository.save(data)).toBeNull()
    const user = userEvent.setup()
    renderApp()
    const dialog = await openTenant(user, 'Renzo Transfer')
    await user.click(within(dialog).getByRole('button', { name: 'Edit Tenant' }))
    await user.selectOptions(within(dialog).getByLabelText('Room assignment'), 'room-1')
    fireEvent.change(within(dialog).getByLabelText('Move-in date'), { target: { value: AS_OF } })
    await user.click(within(dialog).getByRole('button', { name: /Save Tenant/ }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Transfer blocked: Room 8 has unpaid rent')
    expect(savedData().roomAssignments.find(assignment => assignment.tenantId === renzo.tenant.id && assignment.endDate === null)?.roomId).toBe('room-8')
  }, 30_000)

  it('saves a fully paid boundary transfer and keeps it after refresh', async () => {
    let data = ensureRegularRentPeriodsThrough(createEmptyData(AS_OF), AS_OF)
    const charise = addTenant(data, draft('Charise UI Transfer', 'charise.ui@example.com', 'room-15', '2026-10-01'))
    data = payMoveIn(charise.data, 'room-15', '2026-10-01')
    data = ensureRegularRentPeriodsThrough(data, AS_OF)
    const items = collectionCatalog(data, 'room-15', AS_OF).filter(item => item.category !== 'ELECTRICITY')
    const paid = prepareCollection(data, {
      transactionId: 'charise-ui-bills', roomId: 'room-15', readings: {}, collectedOn: AS_OF,
      selections: items.map(({ id, amountCents, periodId, dueDate, basis }) => ({ id, amountCents, periodId, dueDate, basis })),
    })
    if (!paid.ok) throw new Error(paid.reason)
    expect(await localStorageRepository.save(paid.data)).toBeNull()
    const user = userEvent.setup()
    const app = renderApp()
    const dialog = await openTenant(user, 'Charise UI Transfer')
    await user.click(within(dialog).getByRole('button', { name: 'Edit Tenant' }))
    await user.selectOptions(within(dialog).getByLabelText('Room assignment'), 'room-1')
    fireEvent.change(within(dialog).getByLabelText('Move-in date'), { target: { value: '2026-11-01' } })
    expect(within(dialog).getByLabelText('Move-in date')).toHaveValue('2026-11-01')
    await user.click(within(dialog).getByRole('button', { name: /Save Tenant/ }))
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Charise UI Transfer' })).not.toBeInTheDocument(), { timeout: 3000 })
    await waitFor(() => {
      const saved = savedData()
      expect(saved.roomAssignments.find(assignment => assignment.tenantId === charise.tenant.id && assignment.endDate === null)?.roomId).toBe('room-1')
      expect(saved.roomAssignments.find(assignment => assignment.tenantId === charise.tenant.id && assignment.roomId === 'room-15')?.endDate).toBe('2026-10-31')
    })
    app.unmount()
    renderApp()
    await waitFor(() => expect(screen.getByText('Charise UI Transfer')).toBeInTheDocument())
    const refreshedRow = screen.getByText('Charise UI Transfer').closest('tr')!
    expect(refreshedRow).toHaveTextContent('Room 1')
    expect(refreshedRow).not.toHaveTextContent('Room 02')
  }, 30_000)
})
