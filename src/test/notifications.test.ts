import { describe, expect, it } from 'vitest'
import { createDemoData, DEMO_DATE } from '@/data/fixtures/demo'
import type { Charge, PrototypeAppState } from '@/domain/types/models'
import { formatMoney } from '@/lib/format'
import { selectNotifications } from '@/features/notifications/select-notifications'

function dataWithSingleCharge(dueDate: string, amountCents = 1_000, state: Charge['state'] = 'ISSUED'): PrototypeAppState {
  const data = createDemoData()
  const charge: Charge = {
    id: 'test-charge',
    tenantId: 'tenant-1',
    billingPeriodId: 'period-nov',
    category: 'WATER',
    description: 'Test charge',
    amountCents,
    issuedOn: '2026-11-01',
    dueDate,
    state,
    entryMethod: 'MANUAL',
    correction: null,
  }
  return { ...data, charges: [charge], electricityBillObligations: [], payments: [], paymentAllocations: [], tenantCredits: [], rooms: [] }
}

describe('notification selector', () => {
  it('builds the four sample digest items with stable fingerprints', () => {
    const data = createDemoData()
    const notifications = selectNotifications(data, DEMO_DATE)

    expect(notifications).toEqual([
      {
        id: 'overdue:8:1105600:2',
        kind: 'overdue',
        title: '8 bills are past due',
        description: `${formatMoney(1_105_600)} known still to pay. Plus 2 electricity bills awaiting a meter reading. Open Billing to see who owes what.`,
        href: '/billing',
      },
      {
        id: 'due-soon:2026-11-20:3:370000',
        kind: 'due-soon',
        title: '3 bills are due in the next 7 days',
        description: `${formatMoney(370_000)} still to pay.`,
        href: '/billing',
      },
      {
        id: 'repair:room-6',
        kind: 'repair',
        title: 'Room 6 is under repair',
        description: 'It is unavailable until you mark it as available.',
        href: '/rooms',
      },
      {
        id: 'credit:50000:tenant-6',
        kind: 'credit',
        title: `${formatMoney(50_000)} advance payment is held`,
        description: 'For Jordan Flores. It can pay a future bill.',
        href: '/payments',
      },
    ])

    expect(selectNotifications(data, DEMO_DATE)).toEqual(notifications)
  })

  it('includes a bill due exactly seven days out and excludes the next day', () => {
    expect(selectNotifications(dataWithSingleCharge('2026-11-20'), DEMO_DATE).map(item => item.kind)).toEqual(['due-soon'])
    expect(selectNotifications(dataWithSingleCharge('2026-11-21'), DEMO_DATE)).toEqual([])
  })

  it('treats a bill due before the sample date as overdue', () => {
    const notifications = selectNotifications(dataWithSingleCharge('2026-11-12'), DEMO_DATE)
    expect(notifications).toHaveLength(1)
    expect(notifications[0]).toMatchObject({ kind: 'overdue', title: '1 bill is past due', href: '/billing' })
  })

  it('excludes voided and fully paid charges', () => {
    const data = createDemoData()
    const notifications = selectNotifications(data, DEMO_DATE)
    expect(notifications.find(item => item.kind === 'overdue')).toMatchObject({
      title: '8 bills are past due',
      description: `${formatMoney(1_105_600)} known still to pay. Plus 2 electricity bills awaiting a meter reading. Open Billing to see who owes what.`,
    })
    expect(notifications.find(item => item.kind === 'overdue')?.description).not.toContain(formatMoney(370_000))

    expect(selectNotifications(dataWithSingleCharge('2026-11-12', 1_000, 'VOIDED'), DEMO_DATE)).toEqual([])
  })

  it('changes the fingerprint when the underlying amount changes', () => {
    const first = selectNotifications(dataWithSingleCharge('2026-11-12', 1_000), DEMO_DATE)
    const second = selectNotifications(dataWithSingleCharge('2026-11-12', 2_000), DEMO_DATE)
    expect(first[0]?.id).not.toBe(second[0]?.id)
  })
})
