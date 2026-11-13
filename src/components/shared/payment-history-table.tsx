import type { Payment, PrototypeAppState } from '@/domain/types/models'
import { DataTable, type Column } from './data-table'
import { formatDate, formatMoney } from '@/lib/format'
import { CATEGORY_LABELS } from '@/lib/labels'

export function PaymentHistoryTable({ data, payments, caption = 'Payment history', compact = false }: { data: PrototypeAppState; payments: Payment[]; caption?: string; compact?: boolean }) {
  const columns: Column<Payment>[] = [
    { key: 'tenant', label: 'Tenant', render: p => <span className="font-semibold">{data.tenants.find(t => t.id === p.tenantId)?.name}</span> },
    { key: 'date', label: 'Date paid', render: p => formatDate(p.paidOn) },
    { key: 'amount', label: 'Amount paid', render: p => <span className="font-semibold tabular-nums">{formatMoney(p.amountCents)}</span> },
  ]
  if (!compact) columns.push(
    { key: 'items', label: 'What was paid', render: p => {
      const allocations = data.paymentAllocations.filter(a => a.paymentId === p.id && a.state === 'ACTIVE')
      return <div><ul className="space-y-2">{allocations.map(a => {
        const charge = data.charges.find(c => c.id === a.chargeId)
        return <li key={a.id} className="text-sm">{charge ? CATEGORY_LABELS[charge.category] : 'Bill'} · {formatMoney(a.amountCents)}{a.allocatedOn !== p.paidOn && <span className="block text-muted-foreground">Used on {formatDate(a.allocatedOn)}</span>}</li>
      })}</ul>{!allocations.length && <p className="text-sm">{data.tenantCredits.some(c => c.sourcePaymentId === p.id) ? 'Advance payment — kept for a future bill' : 'Not yet used to pay a bill'}</p>}<p className="mt-2 text-sm text-muted-foreground">{p.method === 'cash' ? 'Cash' : 'Bank transfer'}</p></div>
    } },
    { key: 'receipt', label: 'Receipt number', render: p => <span className="text-sm">{data.receipts.find(r => r.paymentId === p.id && r.state === 'ISSUED')?.receiptNumber ?? 'No receipt yet'}</span> },
  )
  return <DataTable rows={payments} caption={caption} columns={columns} />
}
