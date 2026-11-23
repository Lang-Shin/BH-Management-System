import type { Charge, PrototypeAppState } from '@/domain/types/models'
import { chargeBalance, unresolvedElectricity } from '@/domain/calculations/summary'
import { financialTotals, type FinancialTotals } from '@/domain/calculations/room-finance'
import { collectionCatalog } from '@/domain/calculations/payment-collection'

export interface PendingBillGroup extends FinancialTotals {
  id: string
  category: Charge['category']
  dueDate: string
  charges: Charge[]
}

export interface PendingPaymentPeriod {
  id: string
  label: string
  startDate: string
  timing: 'earlier' | 'current' | 'upcoming' | 'review'
  outstanding: number
  unresolved: number
  chargeCount: number
  bills: PendingBillGroup[]
}

export interface PendingPaymentMonth extends FinancialTotals {
  id: string
  label: string
  startDate: string
  timing: PendingPaymentPeriod['timing']
  chargeCount: number
  dueDates: string[]
}

export interface PendingPaymentCategory {
  id: Charge['category']
  category: Charge['category']
  optional: boolean
  outstanding: number
  unresolved: number
  chargeCount: number
  months: PendingPaymentMonth[]
}

const categoryOrder: Charge['category'][] = ['RENT', 'ELECTRICITY', 'WATER', 'WASHING_MACHINE']

type PendingItem =
  | { kind: 'charge'; charge: Charge }
  | { kind: 'obligation'; obligation: PrototypeAppState['electricityBillObligations'][number] }
  | { kind: 'measurement'; periodId: string }

/** Group only remaining amounts; billing periods (not payment dates) determine order. */
export function pendingPaymentPeriods(data: PrototypeAppState, charges: Charge[], asOf: string, roomId?: string): PendingPaymentPeriod[] {
  const pending = [...new Map(charges.map(charge => [charge.id, charge])).values()]
    .filter(charge => charge.state === 'ISSUED' && charge.issuedOn <= asOf && chargeBalance(data, charge, asOf) > 0)
    .map((charge): PendingItem => ({ kind: 'charge', charge }))
  const obligations: PendingItem[] = roomId
    ? unresolvedElectricity(data, asOf, undefined, roomId).map(obligation => ({ kind: 'obligation', obligation }))
    : []
  if (roomId && data.occupancyCycles.some(cycle => cycle.roomId === roomId && cycle.rentSchedule === 'ANNIVERSARY')) {
    // A cumulative meter has one unresolved interval, not one debt per calendar month.
    const awaiting = collectionCatalog(data, roomId, asOf)
      .filter(item => item.needsReading && item.status === 'AWAITING READING')
      .sort((a, b) => b.periodStart.localeCompare(a.periodStart))
    const latest = awaiting[0]
    if (latest) obligations.push({ kind: 'measurement', periodId: latest.periodId })
  }
  const periods = new Map<string, PendingItem[]>()
  for (const item of [...pending, ...obligations]) {
    const periodId = item.kind === 'charge' ? item.charge.billingPeriodId : item.kind === 'obligation' ? item.obligation.billingPeriodId : item.periodId
    const items = periods.get(periodId) ?? []
    items.push(item)
    periods.set(periodId, items)
  }
  return [...periods].map(([id, items]): PendingPaymentPeriod => {
    const period = data.billingPeriods.find(item => item.id === id)
    const groups = new Map<string, PendingItem[]>()
    for (const item of items) {
      const category = item.kind === 'charge' ? item.charge.category : 'ELECTRICITY'
      const dueDate = item.kind === 'charge' ? item.charge.dueDate : item.kind === 'obligation' ? item.obligation.dueDate : ''
      const key = JSON.stringify([category, dueDate])
      const group = groups.get(key) ?? []
      group.push(item)
      groups.set(key, group)
    }
    const bills = [...groups].map(([key, group]): PendingBillGroup => {
      const groupCharges = group.flatMap(item => item.kind === 'charge' ? [item.charge] : [])
      const unresolved = group.filter(item => item.kind !== 'charge').length
      const first = group[0]!
      const firstCategory = first.kind === 'charge' ? first.charge.category : 'ELECTRICITY'
      const firstDueDate = first.kind === 'charge' ? first.charge.dueDate : first.kind === 'obligation' ? first.obligation.dueDate : ''
      return {
        id: key, category: firstCategory, dueDate: firstDueDate, charges: groupCharges,
        ...financialTotals(data, groupCharges, asOf, unresolved),
      }
    }).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category))
    return {
      id, label: period?.label ?? 'Billing period needs review', startDate: period?.startDate ?? '',
      timing: !period ? 'review' : period.endDate < asOf ? 'earlier' : period.startDate > asOf ? 'upcoming' : 'current',
      outstanding: bills.reduce((sum, bill) => sum + bill.outstanding, 0),
      chargeCount: items.length, unresolved: bills.reduce((sum, bill) => sum + bill.unresolved, 0), bills,
    }
  }).sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id))
}

/** Category-first view for a room; each category keeps older pending months first. */
export function pendingPaymentCategories(data: PrototypeAppState, charges: Charge[], asOf: string, roomId?: string): PendingPaymentCategory[] {
  const periods = pendingPaymentPeriods(data, charges, asOf, roomId)
  return categoryOrder.flatMap(category => {
    const months = periods.flatMap((period): PendingPaymentMonth[] => {
      const bills = period.bills.filter(bill => bill.category === category)
      const items = bills.flatMap(bill => bill.charges)
      const unresolved = bills.reduce((sum, bill) => sum + bill.unresolved, 0)
      if (items.length === 0 && unresolved === 0) return []
      return [{
        id: `${period.id}:${category}`,
        label: period.label,
        startDate: period.startDate,
        timing: period.timing,
        chargeCount: items.length + unresolved,
        dueDates: [...new Set(bills.map(bill => bill.dueDate).filter(Boolean))].sort(),
        ...financialTotals(data, items, asOf, unresolved),
      }]
    })
    if (months.length === 0) return []
    return [{
      id: category,
      category,
      optional: category === 'WASHING_MACHINE',
      outstanding: months.reduce((sum, month) => sum + month.outstanding, 0),
      unresolved: months.reduce((sum, month) => sum + month.unresolved, 0),
      chargeCount: months.reduce((sum, month) => sum + month.chargeCount, 0),
      months,
    }]
  })
}
