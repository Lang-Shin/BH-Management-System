import { chargeBalance, creditRemaining, issuedCharges, roomOccupancy, unresolvedElectricity } from '@/domain/calculations/summary'
import type { PrototypeAppState } from '@/domain/types/models'
import { formatMoney } from '@/lib/format'

export type NotificationKind = 'overdue' | 'due-soon' | 'repair' | 'credit'

export interface AppNotification {
  id: string
  kind: NotificationKind
  title: string
  description: string
  href: string
}

const MAX_NOTIFICATIONS = 4
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
