import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppRouter } from '@/app/router/app-router'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { createDemoData, DEMO_DATE } from '@/data/fixtures/demo'
import { localStorageRepository, STORAGE_KEY } from '@/data/repositories/local-storage-repository'
import { submitRoomChangeRequest } from '@/domain/calculations/room-change-requests'

function renderApp(route: string) {
  return render(<PrototypeProvider repository={localStorageRepository}><MemoryRouter initialEntries={[route]}><AppRouter /></MemoryRouter></PrototypeProvider>)
}
const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY)!).data

describe('tenant room change request UI', () => {
  it('submits a request from My Room without changing the tenancy or money', async () => {
    const user = userEvent.setup()
    const base = createDemoData()
    renderApp('/tenant/room')
    await screen.findByRole('heading', { level: 1, name: 'My Room' })
    await user.click(await screen.findByRole('button', { name: 'Request a room change' }))
    const dialog = screen.getByRole('dialog', { name: 'Request a room change' })
    await user.selectOptions(within(dialog).getByLabelText('Room you want'), 'room-13')
    await user.type(within(dialog).getByLabelText('Reason'), 'Need a private room')
    await user.click(within(dialog).getByRole('button', { name: 'Submit request' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Request a room change' })).not.toBeInTheDocument())
    expect(screen.getByText('Pending landlord review')).toBeInTheDocument()
    expect(screen.getByText(/Room 1.*Room 06/)).toBeInTheDocument()
    const saved = stored()
    expect(saved.roomChangeRequests).toHaveLength(1)
    expect(saved.roomChangeRequests[0]).toMatchObject({ tenantId: 'tenant-1', requestedRoomId: 'room-13', status: 'PENDING' })
    expect(saved.roomAssignments).toEqual(base.roomAssignments)
    expect(saved.charges).toEqual(base.charges)
    expect(saved.payments).toEqual(base.payments)
    expect(saved.receipts).toEqual(base.receipts)
  })

  it('cancels a pending request without assignment changes', async () => {
    const user = userEvent.setup()
    const first = submitRoomChangeRequest(createDemoData(), { tenantId: 'tenant-1', requestedRoomId: 'room-13', requestedStartDate: DEMO_DATE, reason: 'Need more space' }, DEMO_DATE)
    if (!first.ok) throw new Error('request failed')
    await localStorageRepository.save(first.data)
    renderApp('/tenant/room')
    await screen.findByRole('heading', { level: 1, name: 'My Room' })
    await user.click(await screen.findByRole('button', { name: 'Cancel request' }))
    await waitFor(() => expect(stored().roomChangeRequests[0].status).toBe('CANCELLED'))
    expect(stored().roomAssignments).toEqual(first.data.roomAssignments)
    expect(screen.getByText('Cancelled')).toBeInTheDocument()
  })
})

describe('landlord room change review UI', () => {
  it('requires financial acknowledgment, approves once, and preserves financial history', async () => {
    const user = userEvent.setup()
    const base = createDemoData()
    const first = submitRoomChangeRequest(base, { tenantId: 'tenant-1', requestedRoomId: 'room-13', requestedStartDate: DEMO_DATE, reason: 'Need more space' }, DEMO_DATE)
    if (!first.ok) throw new Error('request failed')
    await localStorageRepository.save(first.data)
    renderApp('/tenants')
    await screen.findByRole('heading', { level: 1, name: 'Tenants' })
    const panel = screen.getByRole('region', { name: 'Room change request queue' })
    await user.click(within(panel).getByRole('button', { name: /Review room change request from Alex Rivera/ }))
    const dialog = screen.getByRole('dialog', { name: 'Review room change request' })
    const approve = within(dialog).getByRole('button', { name: 'Approve transfer' })
    expect(approve).toBeDisabled()
    await user.click(within(dialog).getByRole('checkbox', { name: /I reviewed the outstanding balance/ }))
    await user.click(approve)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Review room change request' })).not.toBeInTheDocument())
    const saved = stored()
    expect(saved.roomChangeRequests[0]).toMatchObject({ status: 'APPROVED', billingReviewAcknowledged: true, resultingAssignmentId: expect.any(String) })
    expect(saved.roomAssignments.find((item: { id: string }) => item.id === saved.roomChangeRequests[0].resultingAssignmentId)).toMatchObject({ tenantId: 'tenant-1', roomId: 'room-13' })
    expect(saved.charges).toEqual(base.charges)
    expect(saved.payments).toEqual(base.payments)
    expect(saved.receipts).toEqual(base.receipts)
    expect(saved.meterReadings).toEqual(base.meterReadings)
    expect(screen.getByText('APPROVED')).toBeInTheDocument()
  })

  it('rejects with a tenant-visible reason and no assignment changes', async () => {
    const user = userEvent.setup()
    const first = submitRoomChangeRequest(createDemoData(), { tenantId: 'tenant-1', requestedRoomId: 'room-13', requestedStartDate: DEMO_DATE, reason: 'Need more space' }, DEMO_DATE)
    if (!first.ok) throw new Error('request failed')
    await localStorageRepository.save(first.data)
    renderApp('/tenants')
    await screen.findByRole('heading', { level: 1, name: 'Tenants' })
    const panel = screen.getByRole('region', { name: 'Room change request queue' })
    await user.click(within(panel).getByRole('button', { name: /Review room change request from Alex Rivera/ }))
    const dialog = screen.getByRole('dialog', { name: 'Review room change request' })
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }))
    await user.type(within(dialog).getByLabelText('Rejection reason'), 'No suitable room is available.')
    await user.click(within(dialog).getByRole('button', { name: 'Reject request' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Review room change request' })).not.toBeInTheDocument())
    expect(stored().roomChangeRequests[0]).toMatchObject({ status: 'REJECTED', decisionReason: 'No suitable room is available.' })
    expect(stored().roomAssignments).toEqual(first.data.roomAssignments)
    expect(stored().charges).toEqual(first.data.charges)
  })
})