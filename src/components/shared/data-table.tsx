import type { ReactNode } from 'react'
import { EmptyState } from './states'

export interface Column<T> {
  key: string
  label: string
  render: (row: T) => ReactNode
}

export function DataTable<T extends { id: string }>({ rows, columns, caption }: { rows: T[]; columns: Column<T>[]; caption: string }) {
  if (rows.length === 0) return <EmptyState />
  return <div className="max-w-full overflow-x-auto rounded-xl border bg-card" role="region" aria-label={caption} tabIndex={0}>
    <table className="w-full text-left text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead className="border-b bg-muted/60 text-xs text-muted-foreground"><tr>{columns.map(column => <th key={column.key} scope="col" className="whitespace-nowrap px-5 py-4 font-medium">{column.label}</th>)}</tr></thead>
      <tbody className="divide-y">{rows.map(row => <tr key={row.id} className="transition-colors hover:bg-muted/40">{columns.map(column => <td key={column.key} className="whitespace-nowrap px-5 py-4">{column.render(row)}</td>)}</tr>)}</tbody>
    </table>
  </div>
}
