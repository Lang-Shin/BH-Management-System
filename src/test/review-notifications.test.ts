import { describe, expect, it } from 'vitest'
import { createDemoData, DEMO_DATE } from '@/data/fixtures/demo'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import { prepareMoveInPayment, selectMoveInObligations } from '@/domain/calculations/move-in'
import { approveRoomChangeRequest, submitRoomChangeRequest } from '@/domain/calculations/room-change-requests'
import { selectMoveInTransferReviews, selectMoveOutDepositReviews, selectRoomChangeBillingReviews } from '@/features/notifications/review-notifications'
import { selectNotifications } from '@/features/notifications/select-notifications'
import type { TenantDraft } from '@/domain/calculations/tenant-management'
import type { PrototypeAppState } from '@/domain/types/models'

const TRANSFER_DATE = '2026-11-20'

function tenantDraft(name: string, roomId: string, moveInDate = DEMO_DATE): TenantDraft {
  return { name, email: `${name.toLowerCase().replaceAll(' ', '.')}@example.com`, phone: '', address: '', roomId, moveInDate, notes: '' }
}

function createInRoom(data: PrototypeAppState, name: string, roomId: string) {
  const next = prototypeReducer(data, { type: 'tenant/created', asOf: DEMO_DATE, draft: tenantDraft(name, roomId) })
  const tenant = next.tenants.find(item => !data.tenants.some(existing => existing.id === item.id))
  if (!tenant) throw new Error(`${name} was not created`)
  return { data: next, tenant }
}

function payRoom(data: PrototypeAppState, roomId: string, paidOn = DEMO_DATE) {
  const view = selectMoveInObligations(data, paidOn, roomId).find(item => item.cycle.status === 'ACTIVE')
  if (!view) throw new Error(`No active move-in obligation for ${roomId}`)
  const paid = prepareMoveInPayment(data, { obligationId: view.obligation.id, categories: ['ADVANCE', 'SECURITY_DEPOSIT'], paidOn })
  if (!paid.ok) throw new Error(paid.reason)
  return paid.data
}

describe('review notification selectors', () => {
  it('groups an active transfer rent difference as a read-able review notification', () => {
    const created = createInRoom(createDemoData(), 'Transfer Review Tenant', 'room-14')
    const paid = payRoom(created.data, 'room-14')
    const transferred = prototypeReducer(paid, {
      type: 'tenant/updated', tenantId: created.tenant.id, asOf: TRANSFER_DATE,
      draft: tenantDraft('Transfer Review Tenant', 'room-15', TRANSFER_DATE),
    })

    const reviews = selectMoveInTransferReviews(transferred)
    expect(reviews).toHaveLength(1)
    expect(reviews[0]).toMatchObject({ room: { id: 'room-15' }, previousRentCents: 400_000, currentRentCents: 500_000 })
    const notification = selectNotifications(transferred, DEMO_DATE).find(item => item.kind === 'move-in-transfer-review')
    expect(notification).toMatchObject({
      title: '1 move-in transfer rent review', href: '/billing', review: 'move-in-transfer-review',
    })
    expect(notification?.id).toContain(reviews[0]!.cycle.id)
  })

  it('groups closed deposit history without counting it as a current occupant', () => {
    let data = createInRoom(createDemoData(), 'Deposit History Tenant', 'room-9').data
    data = payRoom(data, 'room-9')
    const tenant = data.tenants.find(item => item.name === 'Deposit History Tenant')!
    data = prototypeReducer(data, { type: 'tenant/movedOut', tenantId: tenant.id, asOf: TRANSFER_DATE })

    const reviews = selectMoveOutDepositReviews(data, TRANSFER_DATE)
    expect(reviews).toHaveLength(1)
    expect(reviews[0]!.view).toMatchObject({ room: { id: 'room-9' }, depositPaidCents: 400_000 })
    const notification = selectNotifications(data, TRANSFER_DATE).find(item => item.kind === 'move-out-deposit-review')
    expect(notification).toMatchObject({
      title: '1 move-out deposit record retained', href: '/billing', review: 'move-out-deposit-review',
    })
  })

  it('shows approved future room-change billing reviews only until the effective date', () => {
    const first = submitRoomChangeRequest(createDemoData(), { tenantId: 'tenant-1', requestedRoomId: 'room-13', requestedStartDate: TRANSFER_DATE, reason: 'Need more space' }, DEMO_DATE)
    if (!first.ok) throw new Error('request failed')
    const approved = approveRoomChangeRequest(first.data, first.request.id, {
      effectiveDate: TRANSFER_DATE, note: 'Approved', billingReviewAcknowledged: true, decidedAt: DEMO_DATE,
    })
    if (!approved.ok) throw new Error('approval failed')

    expect(selectRoomChangeBillingReviews(approved.data, DEMO_DATE)).toHaveLength(1)
    expect(selectNotifications(approved.data, DEMO_DATE).find(item => item.kind === 'room-change-billing-review')).toMatchObject({
      review: 'room-change-billing-review',
      id: `room-change-billing-review:${first.request.id}:${TRANSFER_DATE}`,
    })
    expect(selectRoomChangeBillingReviews(approved.data, TRANSFER_DATE)).toEqual([])
    expect(selectNotifications(approved.data, TRANSFER_DATE).some(item => item.kind === 'room-change-billing-review')).toBe(false)
  })
})
