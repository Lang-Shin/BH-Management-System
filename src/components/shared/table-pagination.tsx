import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DataTable, type Column } from './data-table'
import { PAGE_SIZE_OPTIONS, useTablePagination, type PageSize } from './use-table-pagination'

export function TablePagination({ page, totalRecords, pageSize, onPageChange, onPageSizeChange, recordLabel, className }: {
  page: number
  totalRecords: number
  pageSize: PageSize
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: PageSize) => void
  recordLabel: string
  className?: string
}) {
  const pageCount = Math.max(1, Math.ceil(totalRecords / pageSize))
  const currentPage = Math.min(Math.max(1, page), pageCount)
  const startRecord = totalRecords === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const endRecord = Math.min(currentPage * pageSize, totalRecords)
  const summary = totalRecords === 0
    ? `Showing 0 of 0 ${recordLabel}`
    : `Showing ${startRecord}–${endRecord} of ${totalRecords} ${recordLabel}`

  return <div className={className ? `table-pagination ${className}` : 'table-pagination'}>
    <p className="table-pagination-summary" aria-live="polite">{summary}</p>
    <div className="table-pagination-controls">
      <label className="table-page-size"><span>Rows per page</span><select aria-label={`Rows per page for ${recordLabel}`} value={pageSize} onChange={event => onPageSizeChange(Number(event.target.value) as PageSize)}>{PAGE_SIZE_OPTIONS.map(size => <option key={size} value={size}>{size}</option>)}</select></label>
      <div className="table-pagination-nav">
        <Button variant="outline" size="sm" aria-label={`Previous page of ${recordLabel}`} disabled={currentPage <= 1} onClick={() => onPageChange(Math.max(1, currentPage - 1))}><ChevronLeft className="size-4" aria-hidden="true" />Previous</Button>
        <span className="table-pagination-page">Page {currentPage} of {pageCount}</span>
        <Button variant="outline" size="sm" aria-label={`Next page of ${recordLabel}`} disabled={currentPage >= pageCount} onClick={() => onPageChange(Math.min(pageCount, currentPage + 1))}>Next<ChevronRight className="size-4" aria-hidden="true" /></Button>
      </div>
    </div>
  </div>
}

function PaginatedRows<T extends { id: string }>({ rows, columns, caption, recordLabel, resetKey }: {
  rows: T[]
  columns: Column<T>[]
  caption: string
  recordLabel: string
  resetKey?: string | number | boolean | null
}) {
  const pagination = useTablePagination(rows, resetKey)
  return <>
    <DataTable rows={pagination.visibleRows} columns={columns} caption={caption} />
    <TablePagination page={pagination.page} totalRecords={pagination.totalRecords} pageSize={pagination.pageSize} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} recordLabel={recordLabel} />
  </>
}

export function PaginatedDataTable<T extends { id: string }>({ rows, columns, caption, recordLabel, resetKey, emptyState }: {
  rows: T[]
  columns: Column<T>[]
  caption: string
  recordLabel: string
  resetKey?: string | number | boolean | null
  emptyState?: ReactNode
}) {
  if (rows.length === 0) return emptyState ?? <DataTable rows={rows} columns={columns} caption={caption} />
  return <PaginatedRows rows={rows} columns={columns} caption={caption} recordLabel={recordLabel} resetKey={resetKey} />
}
