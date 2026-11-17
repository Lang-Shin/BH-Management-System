import type { ReactNode } from 'react'
import { Table } from '@radix-ui/themes'
import { EmptyState } from './states'

export interface Column<T> {
  key: string
  label: string
  render: (row: T) => ReactNode
  align?: 'left' | 'right'
}

/** Plain table: header, dividers, hover tint. Scrolls sideways on narrow screens. */
export function DataTable<T extends { id: string }>({ rows, columns, caption }: { rows: T[]; columns: Column<T>[]; caption: string }) {
  if (rows.length === 0) return <EmptyState />
  return <div className="table-scroll" role="region" aria-label={caption} tabIndex={0}>
    <Table.Root size="2">
      <caption className="sr-only">{caption}</caption>
      <Table.Header>
        <Table.Row>{columns.map(column => <Table.ColumnHeaderCell key={column.key} justify={column.align === 'right' ? 'end' : 'start'}>{column.label}</Table.ColumnHeaderCell>)}</Table.Row>
      </Table.Header>
      <Table.Body>
        {rows.map(row => <Table.Row key={row.id} align="center">
          {columns.map(column => <Table.Cell key={column.key} justify={column.align === 'right' ? 'end' : 'start'} className={column.align === 'right' ? 'num' : undefined}>{column.render(row)}</Table.Cell>)}
        </Table.Row>)}
      </Table.Body>
    </Table.Root>
  </div>
}
