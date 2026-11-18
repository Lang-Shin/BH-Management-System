import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PaginatedDataTable, TablePagination } from '@/components/shared/table-pagination'

describe('shared table pagination', () => {
  it('shows the range, page count, size options, and previous/next states', async () => {
    const user = userEvent.setup()
    const onPageChange = vi.fn()
    const onPageSizeChange = vi.fn()
    render(<TablePagination page={1} totalRecords={14} pageSize={10} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} recordLabel="transactions" />)

    expect(screen.getByText('Showing 1–10 of 14 transactions')).toBeInTheDocument()
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous page of transactions' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next page of transactions' })).toBeEnabled()
    expect(within(screen.getByLabelText('Rows per page for transactions')).getAllByRole('option').map(option => option.textContent)).toEqual(['5', '10', '20', '50'])

    await user.click(screen.getByRole('button', { name: 'Next page of transactions' }))
    expect(onPageChange).toHaveBeenCalledWith(2)
    await user.selectOptions(screen.getByLabelText('Rows per page for transactions'), '50')
    expect(onPageSizeChange).toHaveBeenCalledWith(50)
  })

  it('shows the last page and disables Next there', async () => {
    const user = userEvent.setup()
    const onPageChange = vi.fn()
    render(<TablePagination page={2} totalRecords={14} pageSize={10} onPageChange={onPageChange} onPageSizeChange={vi.fn()} recordLabel="transactions" />)

    expect(screen.getByText('Showing 11–14 of 14 transactions')).toBeInTheDocument()
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous page of transactions' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Next page of transactions' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Previous page of transactions' }))
    expect(onPageChange).toHaveBeenCalledWith(1)
  })

  it('uses a safe empty summary and never reports Page 1 of 0', () => {
    render(<TablePagination page={1} totalRecords={0} pageSize={10} onPageChange={vi.fn()} onPageSizeChange={vi.fn()} recordLabel="tenants" />)

    expect(screen.getByText('Showing 0 of 0 tenants')).toBeInTheDocument()
    expect(screen.getByText('Page 1 of 1')).toBeInTheDocument()
    expect(screen.queryByText('Page 1 of 0')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous page of tenants' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next page of tenants' })).toBeDisabled()
  })

  it('paginates without duplicate or missing rows and resets for a changed dataset', async () => {
    const user = userEvent.setup()
    const rows = Array.from({ length: 23 }, (_, index) => ({ id: `room-${index + 1}`, name: `Room ${index + 1}` }))
    const columns = [{ key: 'name', label: 'Room', render: (row: typeof rows[number]) => row.name }]
    const { rerender } = render(<PaginatedDataTable rows={rows} columns={columns} caption="Rooms" recordLabel="rooms" resetKey="all" />)

    const table = screen.getByRole('table', { name: 'Rooms' })
    expect(within(table).getAllByRole('row')).toHaveLength(11)
    expect(screen.getByText('Showing 1–10 of 23 rooms')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next page of rooms' }))
    expect(within(table).getAllByRole('row')).toHaveLength(11)
    expect(screen.getByText('Showing 11–20 of 23 rooms')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next page of rooms' }))
    expect(within(table).getAllByRole('row')).toHaveLength(4)
    expect(screen.getByText('Showing 21–23 of 23 rooms')).toBeInTheDocument()

    rerender(<PaginatedDataTable rows={rows} columns={columns} caption="Rooms" recordLabel="rooms" resetKey="refreshed" />)
    expect(screen.getByText('Showing 1–10 of 23 rooms')).toBeInTheDocument()
    expect(within(screen.getByRole('table', { name: 'Rooms' })).getAllByRole('row')).toHaveLength(11)
  })

  it('shows the table empty state without pagination controls', () => {
    const rows: { id: string; name: string }[] = []
    render(<PaginatedDataTable rows={rows} columns={[{ key: 'name', label: 'Room', render: row => row.name }]} caption="Rooms" recordLabel="rooms" />)

    expect(screen.getByText('No results found')).toBeInTheDocument()
    expect(screen.queryByLabelText('Rows per page for rooms')).not.toBeInTheDocument()
    expect(screen.queryByText(/Page 1 of 0/)).not.toBeInTheDocument()
  })
})
