import type { ChargeCategory, PrototypeAppState } from '@/domain/types/models'
import { chargeBalance, chargePaid, issuedCharges } from '@/domain/calculations/summary'
import { DataTable } from '@/components/shared/data-table'
import { StatusBadge } from '@/components/shared/status-badge'
import { CATEGORY_LABELS } from '@/lib/labels'
import { formatMoney } from '@/lib/format'

const categories: ChargeCategory[] = ['RENT', 'ELECTRICITY', 'WATER', 'WASHING_MACHINE']

export function BillingStatusMatrix({ data, periodId, asOf, outstandingOnly }: { data: PrototypeAppState; periodId: string; asOf: string; outstandingOnly: boolean }) {
  const charges = issuedCharges(data, asOf, periodId)
  const tenants = data.tenants.filter(t => charges.some(c => c.tenantId === t.id)
    && (!outstandingOnly || charges.some(c => c.tenantId === t.id && chargeBalance(data, c, asOf) > 0)))
  return <DataTable rows={tenants} caption="Who has paid" columns={[
    { key: 'tenant', label: 'Tenant', render: t => <span className="font-medium">{t.name}</span> },
    ...categories.map(category => ({ key: category, label: CATEGORY_LABELS[category], render: (t: typeof tenants[number]) => {
      const items = charges.filter(c => c.tenantId === t.id && c.category === category)
      if (!items.length) return <span className="text-sm text-muted-foreground">No bill</span>
      const amount = items.reduce((sum, c) => sum + c.amountCents, 0)
      const paid = items.reduce((sum, c) => sum + chargePaid(data, c.id, asOf), 0)
      return <div className="space-y-2"><p className="font-semibold tabular-nums">{formatMoney(amount)}</p><StatusBadge status={paid === amount ? 'Paid' : paid > 0 ? 'Partly paid' : 'Not yet paid'} />{paid > 0 && paid < amount && <p className="text-sm text-muted-foreground">Left to pay: {formatMoney(amount - paid)}</p>}</div>
    } })),
  ]} />
}
