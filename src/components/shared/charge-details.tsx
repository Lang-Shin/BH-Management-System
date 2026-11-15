import type { Charge, PrototypeAppState } from '@/domain/types/models'
import { chargeBalance, chargePaid } from '@/domain/calculations/summary'
import { chargeRoom } from '@/domain/calculations/room-finance'
import { formatDate, formatMoney } from '@/lib/format'
import { CATEGORY_LABELS } from '@/lib/labels'

export function ChargeDetails({ data, charges, asOf, summaryLabel }: { data: PrototypeAppState; charges: Charge[]; asOf: string; summaryLabel?: string }) {
  return <details className="min-w-0 max-w-md whitespace-normal text-left">
    <summary className="min-h-12 cursor-pointer py-3 text-sm font-semibold">{summaryLabel ?? `${charges.length} charge ${charges.length === 1 ? 'detail' : 'details'}`}</summary>
    <p className="mb-3 text-xs text-muted-foreground">Grouped for display only. Each charge stays recorded against its original tenant; joint responsibility is not assumed.</p>
    <ul className="space-y-3">{charges.map(charge => {
      const context = chargeRoom(data, charge)
      const allocations = data.paymentAllocations.filter(item => item.chargeId === charge.id && item.allocatedOn <= asOf)
      return <li key={charge.id} className="min-w-0 rounded-lg border bg-card p-3 text-sm">
        <p className="font-semibold">{data.tenants.find(item => item.id === charge.tenantId)?.name ?? charge.tenantId} · {CATEGORY_LABELS[charge.category]}</p>
        <p className="mt-1 break-all text-xs text-muted-foreground">Charge ID: {charge.id}</p>
        <p className="mt-1">{context.label} · {data.billingPeriods.find(item => item.id === charge.billingPeriodId)?.label}</p>
        <p className="mt-1 text-xs text-muted-foreground">{context.note}</p>
        <p className="mt-2">Due {formatDate(charge.dueDate)}</p>
        <p className="mt-1">Billed {formatMoney(charge.amountCents)} · Applied {formatMoney(chargePaid(data, charge.id, asOf))} · Outstanding {formatMoney(chargeBalance(data, charge, asOf))}</p>
        {allocations.length > 0 && <ul className="mt-2 space-y-2 border-t pt-2" aria-label={`Allocations for ${charge.id}`}>{allocations.map(allocation => {
          const payment = data.payments.find(item => item.id === allocation.paymentId)
          return <li key={allocation.id} className="break-words text-xs"><span className="break-all">{allocation.id} · {allocation.paymentId}</span><br />{data.tenants.find(item => item.id === payment?.tenantId)?.name ?? 'Unknown payer'} · {formatMoney(allocation.amountCents)} · {formatDate(allocation.allocatedOn)} · {allocation.state === 'ACTIVE' && payment?.state === 'RECORDED' && payment.paidOn <= asOf ? 'Active' : 'Not counted as active'}{allocation.reversalAuditEventId && <span className="block break-all">Reversal: {allocation.reversalAuditEventId}</span>}</li>
        })}</ul>}
      </li>
    })}</ul>
  </details>
}
