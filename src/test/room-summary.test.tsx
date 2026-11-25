import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RoomSummary } from '@/components/shared/room-summary'

const summary = { totalRooms: 15, occupiedRooms: 4, reservedRooms: 2, availableRooms: 8, maintenanceRooms: 1 }

describe('room summary cards', () => {
  it('keeps the title left and icon right in the first row, followed by the value, bar and detail rows', () => {
    render(<RoomSummary summary={summary} />)

    expect(screen.getAllByRole('group')).toHaveLength(4)
    const card = screen.getByRole('group', { name: 'Occupied rooms' })
    const [headingRow, valueRow, progress, detail] = Array.from(card.children) as [HTMLElement, HTMLElement, HTMLElement, HTMLElement]

    expect(headingRow).toHaveClass('flex', 'items-center', 'justify-between')
    expect(headingRow.firstElementChild).toHaveTextContent('Occupied rooms')
    expect(headingRow.firstElementChild?.tagName).toBe('H3')
    expect(headingRow.lastElementChild).toHaveClass('room-metric-icon')

    expect(valueRow).toHaveClass('mt-3', 'flex', 'items-center', 'justify-between')
    expect(within(valueRow).getByText('4')).toBeInTheDocument()
    expect(valueRow).toHaveTextContent('of 15 rooms')
    expect(valueRow.lastElementChild).toHaveTextContent('27%')

    expect(progress).toHaveAttribute('aria-hidden', 'true')
    expect(progress.querySelector('.room-metric-fill')).toHaveStyle({ width: `${4 / 15 * 100}%` })
    expect(detail).toHaveTextContent('Currently rented')
  })

  it('preserves percentages and descriptions for every category', () => {
    render(<RoomSummary summary={summary} />)

    expect(within(screen.getByRole('group', { name: 'Occupied rooms' })).getByText('27%')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Reserved rooms' })).getByText('13%')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Available rooms' })).getByText('53%')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Under repair' })).getByText('7%')).toBeInTheDocument()
    expect(screen.getByText('Approved future tenancy')).toBeInTheDocument()
    expect(screen.getByText('Ready for a new tenant')).toBeInTheDocument()
    expect(screen.getByText('Temporarily unavailable')).toBeInTheDocument()
  })
})
