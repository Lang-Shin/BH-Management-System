import type { ReactNode } from 'react'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PrototypeContext } from '@/app/state/prototype-context'
import { createDemoData } from '@/data/fixtures/demo'
import Billing from '@/features/billing/billing-page'
import Payments from '@/features/payments/payments-page'
import Rooms from '@/features/rooms/rooms-page'
import { chooseOption, renderWithTheme } from './test-utils'

function renderCollection(page: ReactNode, data = createDemoData()) {
  return renderWithTheme(<PrototypeContext.Provider value={{ data, dispatch: vi.fn(), storageWarning: null }}>{page}</PrototypeContext.Provider>)
}

describe('collection search and filter recovery', () => {
  it('clears room status and rate together from the toolbar while results still exist', async () => {
    const user = userEvent.setup()
    renderCollection(<Rooms />)
    await user.click(screen.getByRole('radio', { name: 'Occupied' }))
    await chooseOption(user, screen.getByLabelText('Rental rate'), /3,500/)
    expect(screen.getAllByRole('article')).toHaveLength(4)
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByRole('radio', { name: 'All rooms' })).toBeChecked()
    expect(screen.getByLabelText('Rental rate')).toHaveTextContent('All rates')
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('article')).toHaveLength(15)
    expect(screen.getByText(/Showing/)).toHaveAttribute('aria-atomic', 'true')
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 15 of 15 rooms')
  })

  it('shows the active billing filter and restores all rooms from empty results', async () => {
    const user = userEvent.setup()
    const data = createDemoData()
    data.paymentAllocations = []
    const before = JSON.stringify(data)
    renderCollection(<Billing />, data)
    await user.click(screen.getByRole('button', { name: 'Filters' }))
    await user.click(screen.getByRole('menuitemcheckbox', { name: /^PAID/ }))
    expect(screen.getByRole('button', { name: 'Filters: PAID' })).toHaveTextContent('Filters: PAID')
    expect(screen.getByText('No rooms match this filter')).toBeInTheDocument()
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 0 of 4 billed rooms')
    await user.click(screen.getByRole('button', { name: 'Show all billed rooms' }))
    expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Who has paid' })).getAllByRole('row')).toHaveLength(5)
    expect(screen.queryByRole('button', { name: 'Clear filter' })).not.toBeInTheDocument()
    expect(JSON.stringify(data)).toBe(before)
  })

  it('searches recorded payments by receipt and tenant, then recovers from no matches with focus', async () => {
    const user = userEvent.setup()
    const data = createDemoData()
    const before = JSON.stringify(data)
    renderCollection(<Payments />, data)
    const search = screen.getByRole('searchbox', { name: 'Find a payment' })
    const allRows = within(screen.getByRole('region', { name: 'Payment history' })).getAllByRole('row').length
    await user.type(search, 'demo-rct-001')
    expect(within(screen.getByRole('region', { name: 'Payment history' })).getAllByRole('row')).toHaveLength(2)
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 1 of 14 payments')
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(search).toHaveFocus()
    await user.type(search, 'Jordan Flores')
    expect(within(screen.getByRole('region', { name: 'Payment history' })).getAllByRole('row').length).toBeGreaterThan(1)
    await user.clear(search)
    await user.type(search, 'no matching receipt')
    expect(screen.getByText('No payments found')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show all payments' }))
    expect(search).toHaveValue('')
    expect(search).toHaveFocus()
    expect(within(screen.getByRole('region', { name: 'Payment history' })).getAllByRole('row')).toHaveLength(allRows)
    expect(JSON.stringify(data)).toBe(before)
  })
})
