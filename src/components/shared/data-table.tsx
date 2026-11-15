import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { EmptyState } from './states'

export interface Column<T> {
  key: string
  label: string
  render: (row: T) => ReactNode
  align?: 'left' | 'right'
}

export function DataTable<T extends { id: string }>({ rows, columns, caption }: { rows: T[]; columns: Column<T>[]; caption: string }) {
  if (rows.length === 0) return <EmptyState />
  return <div className="table-surface max-w-full overflow-x-auto rounded-xl border bg-card" role="region" aria-label={caption} tabIndex={0}>
    <table role="table" className="block w-full text-left text-sm md:table">
      <caption className="sr-only">{caption}</caption>
      <thead role="rowgroup" className="table-heading sr-only border-b text-xs md:not-sr-only md:table-header-group"><tr role="row">{columns.map(column => <th role="columnheader" key={column.key} scope="col" className={cn('whitespace-nowrap px-4 py-3.5 font-bold uppercase tracking-wide', column.align === 'right' && 'text-right')}>{column.label}</th>)}</tr></thead>
      <tbody role="rowgroup" className="block md:table-row-group">{rows.map(row => <tr role="row" key={row.id} className="table-record block px-4 py-3 md:table-row md:p-0">{columns.map(column => <td role="cell" key={column.key} className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] items-start gap-4 py-2 md:table-cell md:whitespace-nowrap md:px-4 md:py-3.5"><span aria-hidden="true" className="text-xs font-medium uppercase text-muted-foreground md:hidden">{column.label}</span><div className={cn('min-w-0 break-words text-right md:text-left', column.align === 'right' && 'tabular-nums md:text-right')}>{column.render(row)}</div></td>)}</tr>)}</tbody>
    </table>
  </div>
}
