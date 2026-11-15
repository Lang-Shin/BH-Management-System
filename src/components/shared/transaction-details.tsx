import type { Payment, PrototypeAppState } from '@/domain/types/models'
import { paymentRooms } from '@/domain/calculations/room-finance'
import { formatDate, formatMoney } from '@/lib/format'
import { CATEGORY_LABELS } from '@/lib/labels'

export function TransactionDetails({ data, payment, asOf }: { data: PrototypeAppState; payment: Payment; asOf: string }) {
  const context = paymentRooms(data, payment, asOf)
  return <details className="max-w-md whitespace-normal text-left">
    <summary className="min-h-12 cursor-pointer py-3 text-sm font-semibold">Payment details</summary>
    <p className="text-sm font-semibold">Payer: {data.tenants.find(item => item.id === payment.tenantId)?.name ?? payment.tenantId}</p>
    <p className="mt-1 break-all text-xs text-muted-foreground">Payment ID: {payment.id}</p>
    <p className="mt-1 text-sm">{payment.method === 'cash' ? 'Cash' : 'Bank transfer'} · {formatDate(payment.paidOn)}</p>
    <p className="mt-1 text-xs text-muted-foreground">{context.note}</p>
    <ul className="mt-2 space-y-2">{context.allocations.map(allocation => {
      const charge = data.charges.find(item => item.id === allocation.chargeId)
      return <li key={allocation.id} className="text-sm"><p>{allocation.context.label} · {charge ? CATEGORY_LABELS[charge.category] : 'Bill'} · {formatMoney(allocation.amountCents)}</p><p className="break-all text-xs text-muted-foreground">Charge: {allocation.chargeId} · Allocation: {allocation.id}</p></li>
    })}</ul>
    {context.unallocated > 0 && <p className="mt-2 text-sm">Unallocated: {formatMoney(context.unallocated)}{data.tenantCredits.some(item => item.sourcePaymentId === payment.id) ? ' · Includes money held in advance, not collected toward bills.' : ''}</p>}
    {payment.correction && <p className="mt-2 break-all text-xs">Correction of {payment.correction.supersedesId} · Audit {payment.correction.auditEventId}</p>}
  </details>
}
