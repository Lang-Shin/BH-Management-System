import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createDemoData, DEMO_DATE } from '@/data/fixtures/demo'
import { isPrototypeData } from '@/domain/validation/prototype-data'
import { selectRoomFinance } from '@/domain/calculations/room-finance'
import { pendingPaymentCategories, pendingPaymentPeriods } from '@/features/dashboard/pending-payment-groups'
import { OutstandingBalances } from '@/features/dashboard/outstanding-balances'
import type { Charge } from '@/domain/types/models'

function historicalPendingFixture() {
  const data = createDemoData()
  const rent = data.charges.find(charge => charge.id === 'rent-1')!
  const water = data.charges.find(charge => charge.id === 'water-1')!
  const electricity = data.charges.find(charge => charge.id === 'electricity-1')!
  const oldElectricity = data.charges.find(charge => charge.id === 'electricity-old')!
  data.charges = [
    rent, water, electricity,
    { ...water, id: 'oct-water', billingPeriodId: 'period-oct', issuedOn: '2026-10-31', dueDate: '2026-11-05' },
    { ...rent, id: 'oct-rent', billingPeriodId: 'period-oct', issuedOn: '2026-10-31', dueDate: '2026-11-05' },
    { ...oldElectricity, id: 'oct-electricity', tenantId: 'tenant-1' },
  ]
  data.payments = [{ id: 'partial-nov', tenantId: 'tenant-1', amountCents: 115000, paidOn: DEMO_DATE, method: 'cash', state: 'RECORDED', correction: null }]
  data.paymentAllocations = [
    { id: 'partial-rent', paymentId: 'partial-nov', chargeId: 'rent-1', amountCents: 100000, allocatedOn: DEMO_DATE, state: 'ACTIVE', creditId: null, reversalAuditEventId: null },
    { id: 'paid-water', paymentId: 'partial-nov', chargeId: 'water-1', amountCents: 15000, allocatedOn: DEMO_DATE, state: 'ACTIVE', creditId: null, reversalAuditEventId: null },
  ]
  data.tenantCredits = []
  data.receipts = []
  data.billingPeriods.reverse()
  return data
}

describe('room pending-payment presentation', () => {
  it('sorts past billing periods before current bills and shows only remaining amounts', () => {
    const data = historicalPendingFixture()
    expect(isPrototypeData(data)).toBe(true)
    const before = JSON.stringify(data)
    const room = selectRoomFinance(data, DEMO_DATE).find(item => item.id === 'room-1')!
    const periods = pendingPaymentPeriods(data, room.charges, DEMO_DATE)
    expect(periods.map(period => [period.id, period.timing, period.outstanding, period.chargeCount])).toEqual([
      ['period-oct', 'earlier', 204400, 3],
      ['period-nov', 'current', 90600, 2],
    ])
    expect(periods[0]?.bills.map(bill => bill.category)).toEqual(['RENT', 'ELECTRICITY', 'WATER'])
    expect(periods[1]?.bills.find(bill => bill.category === 'RENT')).toMatchObject({ paid: 100000, outstanding: 75000 })
    expect(periods.flatMap(period => period.bills).flatMap(bill => bill.charges.map(charge => charge.id))).not.toContain('water-1')
    expect(periods.reduce((sum, period) => sum + period.outstanding, 0)).toBe(room.outstanding)
    expect(JSON.stringify(data)).toBe(before)
  })

  it('groups each category by month with older months first and no tenant identity', () => {
    const data = historicalPendingFixture()
    const room = selectRoomFinance(data, DEMO_DATE).find(item => item.id === 'room-1')!
    const categories = pendingPaymentCategories(data, room.charges, DEMO_DATE)
    expect(categories.map(category => [category.category, category.outstanding, category.chargeCount])).toEqual([
      ['RENT', 250000, 2],
      ['ELECTRICITY', 30000, 2],
      ['WATER', 15000, 1],
    ])
    expect(categories[0]!.months.map(month => [month.label, month.status, month.outstanding, month.paid])).toEqual([
      ['October 2026 (sample)', 'UNPAID', 175000, 0],
      ['November 2026 (sample)', 'PARTIALLY_PAID', 75000, 100000],
    ])
    expect(categories[2]!.months.map(month => month.label)).toEqual(['October 2026 (sample)'])
    expect(categories[2]!.optional).toBe(false)
  })

  it('marks washing as optional only when a washing bill is pending', () => {
    const data = historicalPendingFixture()
    const washing = createDemoData().charges.find(charge => charge.id === 'washing-2')!
    const room = selectRoomFinance(data, DEMO_DATE).find(item => item.id === 'room-1')!
    const categories = pendingPaymentCategories(data, [...room.charges, washing], DEMO_DATE)
    expect(categories.at(-1)).toMatchObject({ category: 'WASHING_MACHINE', optional: true, outstanding: 8000 })
  })

  it('keeps the requested Room 101 rent arrears and Room 102 rent/water arrears', () => {
    const data = createDemoData()
    const rooms = selectRoomFinance(data, DEMO_DATE)
    const room101 = rooms.find(room => room.id === 'room-1')!
    const room102 = rooms.find(room => room.id === 'room-2')!
    const categories101 = pendingPaymentCategories(data, room101.charges, DEMO_DATE)
    const categories102 = pendingPaymentCategories(data, room102.charges, DEMO_DATE)
    expect(categories101.map(category => [category.category, category.outstanding])).toEqual([['RENT', 700000]])
    expect(categories101[0]!.months.map(month => [month.label, month.status, month.outstanding])).toEqual([
      ['October 2026 (sample)', 'UNPAID', 350000],
      ['November 2026 (sample)', 'UNPAID', 350000],
    ])
    expect(categories102.map(category => [category.category, category.outstanding])).toEqual([['RENT', 350000], ['WATER', 30000]])
    expect(categories102[1]!.months.map(month => [month.label, month.outstanding])).toEqual([
      ['October 2026 (sample)', 15000],
      ['November 2026 (sample)', 15000],
    ])
  })

  it('preserves distinct due dates and excludes duplicate IDs, voided bills and future issues', () => {
    const data = historicalPendingFixture()
    const water = data.charges.find(charge => charge.id === 'oct-water')!
    const items: Charge[] = [
      ...data.charges, water,
      { ...water, id: 'different-due', dueDate: '2026-11-06' },
      { ...water, id: 'voided', state: 'VOIDED' },
      { ...water, id: 'not-issued-yet', issuedOn: '2026-11-14', dueDate: '2026-11-20' },
    ]
    const periods = pendingPaymentPeriods(data, items, DEMO_DATE)
    const oldWater = periods[0]!.bills.filter(bill => bill.category === 'WATER')
    expect(oldWater.map(bill => bill.dueDate)).toEqual(['2026-11-05', '2026-11-06'])
    expect(oldWater.every(bill => bill.charges.length === 1)).toBe(true)
    expect(periods.reduce((sum, period) => sum + period.outstanding, 0)).toBe(310000)
  })

  it('lists pending months instead of tenant names and preserves close/Escape focus behavior', async () => {
    const data = historicalPendingFixture()
    const before = JSON.stringify(data)
    const user = userEvent.setup()
    render(<OutstandingBalances data={data} asOf={DEMO_DATE} />)
    const trigger = screen.getByRole('button', { name: 'View pending payments for Room 101' })
    expect(screen.queryByText('Alex Rivera')).not.toBeInTheDocument()
    await user.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Room 101 · Pending Payments' })
    expect(dialog).toHaveTextContent('All unpaid billing periods — older unpaid months first.')
    expect(dialog).toHaveTextContent('As of Nov 13, 2026 (sample)')
    expect(within(dialog).getAllByRole('region').map(section => section.getAttribute('aria-label'))).toEqual(['Rent pending payments', 'Electricity pending payments', 'Water pending payments'])
    expect(dialog).toHaveTextContent('₱2,950.00')
    expect(dialog).not.toHaveTextContent('Alex Rivera')
    expect(dialog).toHaveTextContent('Washing is optional. If a washing bill is not paid, the washing machine cannot be used.')

    const rent = within(dialog).getByRole('region', { name: 'Rent pending payments' })
    expect(rent).toHaveTextContent('2 pending months')
    await user.click(within(rent).getByText('View bill details'))
    expect(within(rent).getAllByRole('listitem').map(item => item.textContent)).toEqual([
      expect.stringContaining('October 2026 (sample)'),
      expect.stringContaining('November 2026 (sample)'),
    ])
    expect(within(rent).getAllByText('Not yet paid')).toHaveLength(1)
    expect(within(rent).getByText('Partly paid')).toBeInTheDocument()
    expect(rent).toHaveTextContent('Due Nov 5, 2026 · Billed ₱1,750.00 · Paid ₱1,000.00')
    expect(rent).toHaveTextContent('₱750.00')
    expect(within(rent).queryByText('Alex Rivera')).not.toBeInTheDocument()

    const water = within(dialog).getByRole('region', { name: 'Water pending payments' })
    await user.click(within(water).getByText('View bill details'))
    expect(water).toHaveTextContent('October 2026 (sample)')
    expect(water).not.toHaveTextContent('November 2026 (sample)')
    expect(water).toHaveTextContent('Not yet paid')
    await user.click(within(dialog).getByRole('button', { name: 'Close pending payments' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
    await user.click(trigger)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(JSON.stringify(data)).toBe(before)
  })

  it('does not subtract unallocated advance credit from pending room balances', () => {
    const data = createDemoData()
    const room = selectRoomFinance(data, DEMO_DATE).find(item => item.id === 'room-3')!
    const categories = pendingPaymentCategories(data, room.charges, DEMO_DATE)
    expect(categories.map(category => [category.category, category.outstanding])).toEqual([['RENT', 350000]])
    expect(data.tenantCredits.reduce((sum, credit) => sum + credit.amountCents, 0)).toBe(50000)
  })

  it('shows only categories with pending months and keeps the washing note visible', async () => {
    const data = createDemoData()
    const user = userEvent.setup()
    render(<OutstandingBalances data={data} asOf={DEMO_DATE} />)
    await user.click(screen.getByRole('button', { name: 'View pending payments for Room 101' }))
    const dialog = screen.getByRole('dialog', { name: 'Room 101 · Pending Payments' })
    expect(within(dialog).getAllByRole('region').map(section => section.getAttribute('aria-label'))).toEqual(['Rent pending payments'])
    expect(dialog).toHaveTextContent('₱7,000.00')
    expect(within(dialog).queryByRole('region', { name: 'Washing machine pending payments' })).not.toBeInTheDocument()
    expect(dialog).toHaveTextContent('Washing is optional. If a washing bill is not paid, the washing machine cannot be used.')
  })
})
