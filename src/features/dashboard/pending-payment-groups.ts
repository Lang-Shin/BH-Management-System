import type { Charge, PrototypeAppState } from '@/domain/types/models'
import { chargeBalance } from '@/domain/calculations/summary'
import { financialTotals, type FinancialTotals } from '@/domain/calculations/room-finance'

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
  chargeCount: number
  bills: PendingBillGroup[]
}

export interface PendingPaymentMonth extends FinancialTotals {
  id: string
  label: string
  startDate: string
  timing: PendingPaymentPeriod['timing']
  chargeCount: number
}

export interface PendingPaymentCategory {
  id: Charge['category']
  category: Charge['category']
  optional: boolean
  outstanding: number
  chargeCount: number
  months: PendingPaymentMonth[]
}

const categoryOrder: Charge['category'][] = ['RENT', 'ELECTRICITY', 'WATER', 'WASHING_MACHINE']

/** Group only remaining amounts; billing periods (not payment dates) determine order. */
export function pendingPaymentPeriods(data: PrototypeAppState, charges: Charge[], asOf: string): PendingPaymentPeriod[] {
  const pending = [...new Map(charges.map(charge => [charge.id, charge])).values()]
    .filter(charge => charge.state === 'ISSUED' && charge.issuedOn <= asOf && chargeBalance(data, charge, asOf) > 0)
  const periods = new Map<string, Charge[]>()
  for (const charge of pending) {
    const items = periods.get(charge.billingPeriodId) ?? []
    items.push(charge)
    periods.set(charge.billingPeriodId, items)
  }
  return [...periods].map(([id, items]): PendingPaymentPeriod => {
    const period = data.billingPeriods.find(item => item.id === id)
    const groups = new Map<string, Charge[]>()
    for (const charge of items) {
      const key = JSON.stringify([charge.category, charge.dueDate])
      const group = groups.get(key) ?? []
      group.push(charge)
      groups.set(key, group)
    }
    const bills = [...groups].map(([key, group]): PendingBillGroup => ({
      id: key, category: group[0]!.category, dueDate: group[0]!.dueDate, charges: group,
      ...financialTotals(data, group, asOf),
    })).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category))
    return {
      id, label: period?.label ?? 'Billing period needs review', startDate: period?.startDate ?? '',
      timing: !period ? 'review' : period.endDate < asOf ? 'earlier' : period.startDate > asOf ? 'upcoming' : 'current',
      outstanding: bills.reduce((sum, bill) => sum + bill.outstanding, 0), chargeCount: items.length, bills,
    }
  }).sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id))
}

/** Category-first view for a room; each category keeps older pending months first. */
export function pendingPaymentCategories(data: PrototypeAppState, charges: Charge[], asOf: string): PendingPaymentCategory[] {
  const periods = pendingPaymentPeriods(data, charges, asOf)
  return categoryOrder.flatMap(category => {
    const months = periods.flatMap((period): PendingPaymentMonth[] => {
      const items = period.bills.filter(bill => bill.category === category).flatMap(bill => bill.charges)
      if (items.length === 0) return []
      return [{
        id: `${period.id}:${category}`,
        label: period.label,
        startDate: period.startDate,
        timing: period.timing,
        chargeCount: items.length,
        ...financialTotals(data, items, asOf),
      }]
    })
    if (months.length === 0) return []
    return [{
      id: category,
      category,
      optional: category === 'WASHING_MACHINE',
      outstanding: months.reduce((sum, month) => sum + month.outstanding, 0),
      chargeCount: months.reduce((sum, month) => sum + month.chargeCount, 0),
      months,
    }]
  })
}
