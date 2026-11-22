import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRouter } from '@/app/router/app-router'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import { createEmptyData } from '@/data/fixtures/empty'
import { prepareMoveInPayment } from '@/domain/calculations/move-in'
import { selectBillingRent } from '@/domain/calculations/billing-rent'
import { calendarBillingPeriods } from '@/domain/calculations/billing-periods'
import { localStorageRepository } from '@/data/repositories/local-storage-repository'

function renderApp(route = '/') {
  return render(<PrototypeProvider repository={localStorageRepository}><MemoryRouter initialEntries={[route]}><AppRouter /></MemoryRouter></PrototypeProvider>)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-23T04:00:00.000Z'))
  localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('deployment readiness', () => {
  it('starts an empty local workspace with January through the current month', async () => {
    const loaded = await localStorageRepository.load()
    expect(loaded.warning).toBeNull()
    expect(loaded.canPersist).toBe(true)
    expect(loaded.data.tenants).toEqual([])
    expect(loaded.data.payments).toEqual([])
    expect(loaded.data.charges).toEqual([])
    expect(loaded.data.rooms).toHaveLength(15)
    expect(loaded.data.billingPeriods.map(period => period.id)).toEqual([
      'period-2026-01', 'period-2026-02', 'period-2026-03', 'period-2026-04', 'period-2026-05', 'period-2026-06',
      'period-2026-07', 'period-2026-08', 'period-2026-09', 'period-2026-10', 'period-2026-11',
    ])
    expect(loaded.data.billingPeriods.every(period => !period.label.includes('(sample)'))).toBe(true)

    const user = userEvent.setup()
    renderApp('/billing')
    const selector = await screen.findByLabelText('Choose a month')
    expect(selector).toHaveValue('period-2026-11')
    expect(within(selector).getAllByRole('option').map(option => option.textContent)).toEqual([
      'January 2026', 'February 2026', 'March 2026', 'April 2026', 'May 2026', 'June 2026',
      'July 2026', 'August 2026', 'September 2026', 'October 2026', 'November 2026',
    ])
    await user.selectOptions(selector, 'period-2026-10')
    expect(selector).toHaveValue('period-2026-10')
  })

  it('adds future months dynamically without reverting to sample records', () => {
    const future = createEmptyData('2027-02-05')
    expect(calendarBillingPeriods(future, '2027-02-05').map(period => period.id)).toEqual([
      ...Array.from({ length: 12 }, (_, index) => `period-2026-${String(index + 1).padStart(2, '0')}`),
      'period-2027-01', 'period-2027-02',
    ])
    expect(future.tenants).toEqual([])
  })

  it('bills Room 8 from an October 3 move-in and shows the next rent in November once', () => {
    let data = createEmptyData('2026-11-13')
    data = prototypeReducer(data, {
      type: 'tenant/created', asOf: '2026-11-13',
      draft: {
        name: 'Charles Room Eight', email: 'charles.room8@example.com', phone: '+63 900 555 0808',
        address: '8 Test Street, Demo City', roomId: 'room-8', moveInDate: '2026-10-03', notes: '',
      },
    })
    expect(data.occupancyCycles).toHaveLength(1)
    expect(data.occupancyCycles[0]).toMatchObject({
      roomId: 'room-8', startedAt: '2026-10-03', rentAnchorDate: '2026-10-03', rentAnchorDay: 3, status: 'ACTIVE',
    })
    const obligation = data.moveInObligations[0]
    expect(obligation).toBeDefined()
    const paid = prepareMoveInPayment(data, {
      obligationId: obligation!.id, categories: ['ADVANCE', 'SECURITY_DEPOSIT'], paidOn: '2026-10-03',
    })
    expect(paid.ok).toBe(true)
    if (!paid.ok) return
    data = paid.data

    expect(data.rentalPeriods.map(period => ({ sequence: period.sequence, startDate: period.startDate, dueDate: period.dueDate }))).toEqual([
      { sequence: 1, startDate: '2026-10-03', dueDate: '2026-10-03' },
      { sequence: 2, startDate: '2026-11-03', dueDate: '2026-11-03' },
    ])
    expect(data.rentObligations.map(item => ({ sequence: data.rentalPeriods.find(period => period.id === item.rentalPeriodId)?.sequence, amountCents: item.amountCents }))).toEqual([
      { sequence: 1, amountCents: 350_000 },
      { sequence: 2, amountCents: 350_000 },
    ])
    expect(data.advanceApplications).toHaveLength(1)
    expect(data.payments).toHaveLength(1)
    expect(data.charges.filter(charge => charge.category === 'RENT')).toEqual([])

    const periods = calendarBillingPeriods(data, '2026-11-13')
    const october = periods.find(period => period.id === 'period-2026-10')!
    const november = periods.find(period => period.id === 'period-2026-11')!
    expect(selectBillingRent(data, 'room-8', october, '2026-11-13')).toMatchObject({
      source: 'ANNIVERSARY', billedCents: 350_000, paidCents: 350_000, advanceAppliedCents: 350_000,
      cashPaidCents: 0, outstandingCents: 0, status: 'PAID',
    })
    expect(selectBillingRent(data, 'room-8', november, '2026-11-13')).toMatchObject({
      source: 'ANNIVERSARY', billedCents: 350_000, paidCents: 0,
      cashPaidCents: 0, outstandingCents: 350_000, status: 'UNPAID',
    })
    expect(data.rentPrepayments).toEqual([])
    expect(data.tenantCredits).toEqual([])
  })
})
