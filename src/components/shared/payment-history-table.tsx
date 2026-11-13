import type { Payment, PrototypeAppState } from '@/domain/types/models'
import { DataTable } from './data-table'
import { formatDate, formatMoney } from '@/lib/format'
import { CATEGORY_LABELS } from '@/lib/labels'

export function PaymentHistoryTable({ data, payments, caption = 'Fictional payment history' }: { data: PrototypeAppState; payments: Payment[]; caption?: string }) {
  return <DataTable rows={payments} caption={caption} columns={[
    { key: 'reference', label: 'Payment / tenant', render: p => <div><p className="font-medium">{data.tenants.find(t => t.id === p.tenantId)?.name}</p><p className="mt-1 text-xs text-muted-foreground">{p.id}</p></div> },
    { key: 'date', label: 'Received', render: p => formatDate(p.paidOn) },
    { key: 'method', label: 'Method', render: p => p.method === 'cash' ? 'Cash' : 'Bank transfer' },
    { key: 'amount', label: 'Amount', render: p => <span className="font-medium tabular-nums">{formatMoney(p.amountCents)}</span> },
    { key: 'allocations', label: 'Explicit allocations', render: p => {
      const allocations = data.paymentAllocations.filter(a => a.paymentId === p.id && a.state === 'ACTIVE')
      return allocations.length ? <ul className="space-y-1">{allocations.map(a => {
        const charge = data.charges.find(c => c.id === a.chargeId)
        return <li key={a.id} className="text-xs">{charge ? CATEGORY_LABELS[charge.category] : 'Charge'} · {formatMoney(a.amountCents)} · {formatDate(a.allocatedOn)}</li>
      })}</ul> : <span className="text-xs text-muted-foreground">{data.tenantCredits.some(c => c.sourcePaymentId === p.id) ? 'Unallocated advance · tenant credit' : 'No active allocations'}</span>
    } },
    { key: 'receipt', label: 'Sample receipt', render: p => <span className="text-xs">{data.receipts.find(r => r.paymentId === p.id && r.state === 'ISSUED')?.receiptNumber ?? 'No issued sample receipt'}</span> },
  ]} />
}
