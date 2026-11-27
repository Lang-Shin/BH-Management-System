import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cancelTenantRoomChangeRequest, getTenantRoomChangeOptions, requestTenantRoomChange,
  type TenantRoomChangeOptions, type TenantRoomChangeRequest,
} from '@/features/auth/auth-api'
import { TenantRoomChangeRequestSection } from '@/features/tenant/tenant-room-change-request'

vi.mock('@/features/auth/auth-api', async importOriginal => ({
  ...await importOriginal<typeof import('@/features/auth/auth-api')>(),
  getTenantRoomChangeOptions: vi.fn(), requestTenantRoomChange: vi.fn(), cancelTenantRoomChangeRequest: vi.fn(),
}))

vi.mock('@/hooks/use-prototype', () => ({
  usePrototype: () => ({ refreshFromServer: vi.fn() }),
}))

const options: TenantRoomChangeOptions = {
  current: { roomId: 'room-1', name: '1', agreedRentCents: 350_000 },
  options: [
    { id: 'room-2', name: '2', floor: 1, kind: 'SHARED', capacity: 2, categoryId: 'RATE_3500', monthlyRentCents: 350_000 },
  ],
  requests: [],
  revision: 5,
  serverDate: '2026-11-27',
}

const pending: TenantRoomChangeRequest = {
  id: 'request-1', status: 'PENDING', currentRoomId: 'room-1', currentRoomName: '1',
  requestedRoomId: 'room-2', requestedRoomName: '2', requestedStartDate: '2026-11-28',
  reason: 'Need a quieter room.', createdAt: '2026-11-27', decidedAt: null, decisionReason: null,
  approvedStartDate: null, billingReviewPeriodIds: [],
}

beforeEach(() => {
  vi.mocked(getTenantRoomChangeOptions).mockReset()
  vi.mocked(requestTenantRoomChange).mockReset()
  vi.mocked(cancelTenantRoomChangeRequest).mockReset()
})

describe('tenant room change requests', () => {
  it('loads eligible rooms and submits a reviewed request', async () => {
    vi.mocked(getTenantRoomChangeOptions)
      .mockResolvedValueOnce(options)
      .mockResolvedValueOnce({ ...options, requests: [pending], revision: 6 })
    vi.mocked(requestTenantRoomChange).mockResolvedValue({
      request: pending, revision: 6, replayed: false, serverDate: '2026-11-27',
    })
    const user = userEvent.setup()
    render(<TenantRoomChangeRequestSection />)

    await user.selectOptions(await screen.findByLabelText('Room you want'), 'room-2')
    await user.type(screen.getByLabelText('Reason'), 'Need a quieter room.')
    await user.click(screen.getByRole('button', { name: /submit request/i }))

    await waitFor(() => expect(requestTenantRoomChange).toHaveBeenCalledWith({
      requestedRoomId: 'room-2', requestedStartDate: '2026-11-27', reason: 'Need a quieter room.',
    }))
    expect(await screen.findByText(/room change request submitted/i)).toBeVisible()
    expect(await screen.findByText('Pending landlord review')).toBeVisible()
    expect(screen.getByText('Room 1 → Room 2')).toBeVisible()
  })

  it('shows a pending request and cancels it', async () => {
    vi.mocked(getTenantRoomChangeOptions)
      .mockResolvedValueOnce({ ...options, requests: [pending] })
      .mockResolvedValueOnce({ ...options, requests: [{ ...pending, status: 'CANCELLED' }], revision: 6 })
    vi.mocked(cancelTenantRoomChangeRequest).mockResolvedValue({ cancelled: true, revision: 6, replayed: false, serverDate: '2026-11-27' })
    const user = userEvent.setup()
    render(<TenantRoomChangeRequestSection />)

    expect(await screen.findByText('Pending landlord review')).toBeVisible()
    await user.click(screen.getByRole('button', { name: /cancel request/i }))

    await waitFor(() => expect(cancelTenantRoomChangeRequest).toHaveBeenCalledWith('request-1'))
    expect(await screen.findByText(/was cancelled/i)).toBeVisible()
  })
})
