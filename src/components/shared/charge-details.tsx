import { Text } from '@radix-ui/themes'
import type { Charge, PrototypeAppState } from '@/domain/types/models'
import { chargeBalance, chargePaid } from '@/domain/calculations/summary'
import { chargeRoom } from '@/domain/calculations/room-finance'
import { formatDate, formatMoney } from '@/lib/format'
import { CATEGORY_LABELS } from '@/lib/labels'
import './shared-parts.css'

export function ChargeDetails({ data, charges, asOf, summaryLabel }: { data: PrototypeAppState; charges: Charge[]; asOf: string; summaryLabel?: string }) {
  return <details className="disclosure-inline" style={{ minWidth: 0, maxWidth: '28rem', whiteSpace: 'normal', textAlign: 'left' }}>
    <summary>{summaryLabel ?? `${charges.length} charge ${charges.length === 1 ? 'detail' : 'details'}`}</summary>
    <Text as="p" size="1" color="gray" mb="2">Grouped for display only. Each charge stays recorded against its original tenant; joint responsibility is not assumed.</Text>
    <ul className="row-list">{charges.map(charge => {
      const context = chargeRoom(data, charge)
      const allocations = data.paymentAllocations.filter(item => item.chargeId === charge.id && item.allocatedOn <= asOf)
      return <li key={charge.id} style={{ minWidth: 0, padding: '10px 0' }}>
        <Text as="p" size="2" weight="medium">{data.tenants.find(item => item.id === charge.tenantId)?.name ?? charge.tenantId} · {CATEGORY_LABELS[charge.category]}</Text>
        <Text as="p" size="1" color="gray" style={{ overflowWrap: 'anywhere' }}>Charge ID: {charge.id}</Text>
        <Text as="p" size="2" mt="1">{context.label} · {data.billingPeriods.find(item => item.id === charge.billingPeriodId)?.label}</Text>
        <Text as="p" size="1" color="gray">{context.note}</Text>
        <Text as="p" size="2" mt="1">Due {formatDate(charge.dueDate)}</Text>
        <Text as="p" size="2" className="num">Billed {formatMoney(charge.amountCents)} · Applied {formatMoney(chargePaid(data, charge.id, asOf))} · Outstanding {formatMoney(chargeBalance(data, charge, asOf))}</Text>
        {allocations.length > 0 && <ul className="row-list" aria-label={`Allocations for ${charge.id}`} style={{ marginTop: 8 }}>{allocations.map(allocation => {
          const payment = data.payments.find(item => item.id === allocation.paymentId)
          return <li key={allocation.id} style={{ padding: '6px 0', overflowWrap: 'anywhere' }}><Text size="1"><span>{allocation.id} · {allocation.paymentId}</span><br />{data.tenants.find(item => item.id === payment?.tenantId)?.name ?? 'Unknown payer'} · {formatMoney(allocation.amountCents)} · {formatDate(allocation.allocatedOn)} · {allocation.state === 'ACTIVE' && payment?.state === 'RECORDED' && payment.paidOn <= asOf ? 'Active' : 'Not counted as active'}{allocation.reversalAuditEventId && <span style={{ display: 'block' }}>Reversal: {allocation.reversalAuditEventId}</span>}</Text></li>
        })}</ul>}
      </li>
    })}</ul>
  </details>
}
