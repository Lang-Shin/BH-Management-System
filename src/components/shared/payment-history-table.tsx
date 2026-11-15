import type { Payment, PrototypeAppState } from '@/domain/types/models'
import { DataTable, type Column } from './data-table'
import { formatDate, formatMoney } from '@/lib/format'
import { CATEGORY_LABELS } from '@/lib/labels'
import { StatusBadge } from './status-badge'
import { paymentRooms } from '@/domain/calculations/room-finance'
import { DEMO_DATE } from '@/data/fixtures/demo'
import { TransactionDetails } from './transaction-details'

export function PaymentHistoryTable({ data, payments, caption = 'Payment history', compact = false, asOf = DEMO_DATE }: { data: PrototypeAppState; payments: Payment[]; caption?: string; compact?: boolean; asOf?: string }) {
  const columns: Column<Payment>[] = [
    { key: 'room', label: 'Room', render: p => { const context = paymentRooms(data, p, asOf); return <div className="max-w-xs whitespace-normal"><p className="font-semibold">{context.label}</p>{(context.unallocated > 0 || context.allocations.some(item => item.context.roomId === null)) && <p className="mt-1 text-xs text-muted-foreground">{context.note}</p>}</div> } },
    { key: 'date', label: 'Date paid', render: p => formatDate(p.paidOn) },
    { key: 'amount', label: 'Amount paid', align: 'right', render: p => <span className="font-semibold tabular-nums">{formatMoney(p.amountCents)}</span> },
  ]
  if (!compact) columns.push(
    { key: 'status', label: 'Status', render: () => <StatusBadge status="Recorded" /> },
    { key: 'items', label: 'What was paid', render: p => {
      const allocations = data.paymentAllocations.filter(a => a.paymentId === p.id && a.state === 'ACTIVE' && a.allocatedOn <= asOf)
      return <div><ul className="space-y-2">{allocations.map(a => {
        const charge = data.charges.find(c => c.id === a.chargeId)
        return <li key={a.id} className="text-sm">{charge ? CATEGORY_LABELS[charge.category] : 'Bill'} · {formatMoney(a.amountCents)}{a.allocatedOn !== p.paidOn && <span className="block text-muted-foreground">Used on {formatDate(a.allocatedOn)}</span>}</li>
      })}</ul>{!allocations.length && <p className="text-sm">{data.tenantCredits.some(c => c.sourcePaymentId === p.id) ? 'Advance payment — kept for a future bill' : 'Not yet used to pay a bill'}</p>}<p className="mt-2 text-sm text-muted-foreground">{p.method === 'cash' ? 'Cash' : 'Bank transfer'}</p></div>
    } },
    { key: 'receipt', label: 'Receipt number', render: p => <span className="text-sm">{data.receipts.find(r => r.paymentId === p.id && r.state === 'ISSUED')?.receiptNumber ?? 'No receipt yet'}</span> },
  )
  columns.push({ key: 'details', label: 'Transaction', render: p => <TransactionDetails data={data} payment={p} asOf={asOf} /> })
  return <DataTable rows={payments} caption={caption} columns={columns} />
}
