import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createDemoData, DEMO_DATE, DEMO_PERIOD } from '@/data/fixtures/demo'
import { BillingStatusChart } from '@/features/billing/billing-status-chart'
import { billingStatusCounts, selectBillingRooms } from '@/features/billing/billing-room-status'

describe('Billing room-status chart', () => {
  it('counts each room once using the same category-based Status as the table', () => {
    const data = createDemoData()
    const before = JSON.stringify(data)
    const rooms = selectBillingRooms(data, DEMO_PERIOD, DEMO_DATE, false)
    expect(rooms.map(room => [room.context.label, room.billingStatus])).toEqual([
      ['Room 101', 'PARTLY PAID'], ['Room 102', 'PARTLY PAID'], ['Room 103', 'PAID'], ['Room 104', 'PARTLY PAID'],
    ])
    expect(billingStatusCounts(rooms)).toEqual({ total: 4, paid: 1, partlyPaid: 3, notPaid: 0 })
    render(<BillingStatusChart rooms={rooms} periodLabel="November 2026" outstandingOnly={false} />)
    const figure = screen.getByRole('figure', { name: 'Billing room payment status' })
    const paidRow = within(figure).getByText('PAID', { exact: true }).closest('div')!
    const legend = within(paidRow).getByRole('definition')
    expect(legend).toHaveTextContent('1(25.0%)')
    expect(figure).toHaveTextContent('1 of 4 rooms fully paid')
    expect(figure.querySelectorAll('circle.billing-status-doughnut-segment')).toHaveLength(2)
    expect(JSON.stringify(data)).toBe(before)
  })

  it('ignores NO BILL categories and applies the unpaid-room filter without losing partially paid rooms', () => {
    const data = createDemoData()
    const rooms = selectBillingRooms(data, 'period-oct', DEMO_DATE, false)
    expect(billingStatusCounts(rooms)).toEqual({ total: 5, paid: 1, partlyPaid: 2, notPaid: 2 })
    const filtered = selectBillingRooms(data, 'period-oct', DEMO_DATE, true)
    expect(billingStatusCounts(filtered)).toEqual({ total: 4, paid: 0, partlyPaid: 2, notPaid: 2 })
    expect(filtered.map(room => room.context.label)).toEqual(['Room 101', 'Room 102', 'Room 103', 'Room 104'])
    render(<BillingStatusChart rooms={rooms} periodLabel="October 2026" outstandingOnly={false} />)
    const paidSegment = screen.getByRole('figure', { name: 'Billing room payment status' }).querySelector('.billing-status-doughnut-segment')
    expect(parseFloat(paidSegment?.getAttribute('stroke-dasharray') ?? '')).toBeCloseTo(100 / 5)
  })

  it('shows an empty chart without NaN values or colored phantom segments', () => {
    render(<BillingStatusChart rooms={[]} periodLabel="Empty month" outstandingOnly={false} />)
    const figure = screen.getByRole('figure', { name: 'Billing room payment status' })
    expect(figure).toHaveTextContent('No billed rooms match this view.')
    expect(figure).not.toHaveTextContent(/NaN|Infinity/)
    expect(figure.querySelectorAll('.billing-status-doughnut-segment')).toHaveLength(0)
  })
})
