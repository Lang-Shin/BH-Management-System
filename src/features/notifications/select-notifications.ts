import { chargeBalance, creditRemaining, issuedCharges, roomOccupancy, unresolvedElectricity } from '@/domain/calculations/summary'
import type { PrototypeAppState } from '@/domain/types/models'
import { pendingRoomChangeRequests } from '@/domain/calculations/room-change-requests'
import { formatMoney } from '@/lib/format'
import { selectMoveInTransferReviews, selectMoveOutDepositReviews, selectRoomChangeBillingReviews } from './review-notifications'

export type ReviewNotificationKind = 'move-in-transfer-review' | 'move-out-deposit-review' | 'room-change-billing-review'
export type NotificationKind = 'overdue' | 'due-soon' | 'repair' | 'credit' | 'room-change' | ReviewNotificationKind

export interface AppNotification {
  id: string
  kind: NotificationKind
  title: string
  description: string
  href: string
  review?: ReviewNotificationKind
}

const MAX_NOTIFICATIONS = 8
const DUE_SOON_DAYS = 7

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function bills(count: number): string {
  return count === 1 ? '1 bill' : `${count} bills`
}

function isAre(count: number): string {
  return count === 1 ? 'is' : 'are'
}

export function selectNotifications(data: PrototypeAppState, asOf: string): AppNotification[] {
  const withBalance = issuedCharges(data, asOf)
    .map(charge => ({ charge, balance: chargeBalance(data, charge, asOf) }))
    .filter(item => item.balance > 0)

  const overdue = withBalance.filter(item => item.charge.dueDate < asOf)
  const dueSoonEnd = addDays(asOf, DUE_SOON_DAYS)
  const dueSoon = withBalance.filter(item => item.charge.dueDate >= asOf && item.charge.dueDate <= dueSoonEnd)
  const repairRooms = data.rooms
    .filter(room => roomOccupancy(data, room, asOf) === 'UNDER_REPAIR')
    .sort((a, b) => a.name.localeCompare(b.name))
  const credits = data.tenantCredits
    .map(credit => ({ credit, remaining: creditRemaining(data, credit, asOf) }))
    .filter(item => item.remaining > 0)
  const awaitingElectricity = unresolvedElectricity(data, asOf).length
  const roomChangeRequests = pendingRoomChangeRequests(data)
  const moveInTransferReviews = selectMoveInTransferReviews(data)
  const moveOutDepositReviews = selectMoveOutDepositReviews(data, asOf)
  const roomChangeBillingReviews = selectRoomChangeBillingReviews(data, asOf)

  const notifications: AppNotification[] = []

  if (overdue.length > 0) {
    const total = overdue.reduce((sum, item) => sum + item.balance, 0)
    notifications.push({
      id: `overdue:${overdue.length}:${total}:${awaitingElectricity}`,
      kind: 'overdue',
      title: `${bills(overdue.length)} ${isAre(overdue.length)} past due`,
      description: `${formatMoney(total)} known still to pay.${awaitingElectricity > 0 ? ` Plus ${awaitingElectricity} electricity ${awaitingElectricity === 1 ? 'bill' : 'bills'} awaiting a meter reading.` : ''} Open Billing to see who owes what.`,
      href: '/billing',
    })
  }

  if (dueSoon.length > 0) {
    const total = dueSoon.reduce((sum, item) => sum + item.balance, 0)
    notifications.push({
      id: `due-soon:${dueSoonEnd}:${dueSoon.length}:${total}`,
      kind: 'due-soon',
      title: `${bills(dueSoon.length)} ${isAre(dueSoon.length)} due in the next ${DUE_SOON_DAYS} days`,
      description: `${formatMoney(total)} still to pay.`,
      href: '/billing',
    })
  }

  if (repairRooms.length > 0) {
    const names = repairRooms.map(room => room.name).join(', ')
    notifications.push({
      id: `repair:${repairRooms.map(room => room.id).join(',')}`,
      kind: 'repair',
      title: repairRooms.length === 1 ? `Room ${names} is under repair` : `${repairRooms.length} rooms are under repair`,
      description: repairRooms.length === 1
        ? 'It is unavailable until you mark it as available.'
        : `Rooms ${names} are unavailable until marked as available.`,
      href: '/rooms',
    })
  }
  if (roomChangeRequests.length > 0) {
    notifications.push({
      id: `room-change:${roomChangeRequests.map(request => request.id).join(',')}`,
      kind: 'room-change',
      title: roomChangeRequests.length === 1 ? '1 tenant requested a room change' : `${roomChangeRequests.length} tenants requested room changes`,
      description: 'Review the request before changing any room assignment.',
      href: '/tenants',
    })
  }
  if (moveInTransferReviews.length > 0) {
    notifications.push({
      id: `move-in-transfer-review:${moveInTransferReviews.map(item => `${item.cycle.id}:${item.previousRentCents}:${item.currentRentCents}`).join('|')}`,
      kind: 'move-in-transfer-review',
      title: moveInTransferReviews.length === 1 ? '1 move-in transfer rent review' : `${moveInTransferReviews.length} move-in transfer rent reviews`,
      description: 'Review the rent differences manually. No advance or deposit top-up was posted.',
      href: '/billing',
      review: 'move-in-transfer-review',
    })
  }
  if (moveOutDepositReviews.length > 0) {
    notifications.push({
      id: `move-out-deposit-review:${moveOutDepositReviews.map(item => `${item.view.obligation.id}:${item.view.depositPaidCents}:${item.view.totalRemainingCents}`).join('|')}`,
      kind: 'move-out-deposit-review',
      title: moveOutDepositReviews.length === 1 ? '1 move-out deposit record retained' : `${moveOutDepositReviews.length} move-out deposit records retained`,
      description: 'Review the historical deposit and remaining balances. No automatic refund or forfeiture was posted.',
      href: '/billing',
      review: 'move-out-deposit-review',
    })
  }
  if (roomChangeBillingReviews.length > 0) {
    notifications.push({
      id: `room-change-billing-review:${roomChangeBillingReviews.map(item => `${item.request.id}:${item.effectiveDate}`).join('|')}`,
      kind: 'room-change-billing-review',
      title: roomChangeBillingReviews.length === 1 ? '1 room change billing review pending' : `${roomChangeBillingReviews.length} room change billing reviews pending`,
      description: 'Review room rent before each future transfer takes effect.',
      href: '/billing',
      review: 'room-change-billing-review',
    })
  }
  if (credits.length > 0) {
    const total = credits.reduce((sum, item) => sum + item.remaining, 0)
    const tenantIds = [...new Set(credits.map(item => item.credit.tenantId))].sort()
    const tenantNames = tenantIds
      .map(id => data.tenants.find(tenant => tenant.id === id)?.name)
      .filter((name): name is string => Boolean(name))
    notifications.push({
      id: `credit:${total}:${tenantIds.join(',')}`,
      kind: 'credit',
      title: credits.length === 1 ? `${formatMoney(total)} advance payment is held` : `${formatMoney(total)} in advance payments are held`,
      description: credits.length === 1
        ? `For ${tenantNames[0] ?? 'a tenant'}. It can pay a future bill.`
        : `For ${tenantNames.join(', ')}. They can pay future bills.`,
      href: '/payments',
    })
  }

  return notifications.slice(0, MAX_NOTIFICATIONS)
}
