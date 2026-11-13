import { useState } from 'react'
import { ReceiptText, CircleAlert, Wallet } from 'lucide-react'
import { PageHeader, PreviewNotice, StatCard } from '@/components/shared/page'
import { DataTable } from '@/components/shared/data-table'
import { StatusBadge } from '@/components/shared/status-badge'
import { WorkflowPlaceholders } from '@/components/shared/workflow-placeholders'
import { Button } from '@/components/ui/button'
import { usePrototype } from '@/hooks/use-prototype'
import { chargeBalance, chargePaid, chargeStatus, issuedCharges, selectSummary } from '@/domain/calculations/summary'
import { DEMO_DATE, DEMO_PERIOD } from '@/data/fixtures/demo'
import { formatDate, formatMoney } from '@/lib/format'
import { CATEGORY_LABELS, CHARGE_STATUS_LABELS } from '@/lib/labels'
import { BillingStatusMatrix } from './billing-status-matrix'
import { ElectricityPreview } from './electricity-preview'

export default function Billing() {
  const { data } = usePrototype()
  const [periodId, setPeriodId] = useState(DEMO_PERIOD)
  const [outstandingOnly, setOutstandingOnly] = useState(false)
  const summary = selectSummary(data, DEMO_DATE, periodId)
  const charges = issuedCharges(data, DEMO_DATE, periodId).filter(c => !outstandingOnly || chargeBalance(data, c, DEMO_DATE) > 0)

  return <>
    <PageHeader title="Billing" description="Read-only fictional charges by category and billing period. Each category has its own balance, due date, and allocation history." />
    <PreviewNotice>Sample periods and due dates illustrate the UI; the actual billing-cycle policy is unconfirmed. No bills can be generated or issued here.</PreviewNotice>
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><label htmlFor="billing-period" className="mb-2 block text-sm font-medium">Billing period</label><select id="billing-period" value={periodId} onChange={e => setPeriodId(e.target.value)} className="h-11 max-w-full rounded-md border bg-card px-3 text-sm">{data.billingPeriods.map(p => <option key={p.id} value={p.id}>{p.label} · {p.status}</option>)}</select></div><Button variant={outstandingOnly ? 'secondary' : 'outline'} aria-pressed={outstandingOnly} onClick={() => setOutstandingOnly(v => !v)}>{outstandingOnly ? 'Show all charges' : 'Show outstanding only'}</Button></div>
    <section className="mb-6 grid gap-4 sm:grid-cols-3" aria-label="Sample billing summary"><StatCard label="Issued charges" value={formatMoney(summary.billed)} detail="Selected sample billing period" icon={ReceiptText} /><StatCard label="Applied payments" value={formatMoney(summary.applied)} detail="Explicit allocations to these charges" icon={Wallet} /><StatCard label="Outstanding" value={formatMoney(summary.outstanding)} detail={`${summary.overdue} overdue charges as of ${formatDate(DEMO_DATE)}`} icon={CircleAlert} /></section>
    <h2 className="mb-2 text-lg font-semibold">Billing status matrix</h2><p className="mb-4 text-sm leading-relaxed text-muted-foreground">“Not applicable” means no issued charge exists for that category in this sample period. It is distinct from an unpaid charge. No washing charge is assumed unless explicitly entered.</p>
    <BillingStatusMatrix data={data} periodId={periodId} asOf={DEMO_DATE} outstandingOnly={outstandingOnly} />
    <h2 className="mt-7 mb-4 text-lg font-semibold">Charge details and due dates</h2>
    <DataTable rows={charges} caption="Fictional issued charge details" columns={[
      { key: 'charge', label: 'Charge', render: c => <div><p className="font-medium">{CATEGORY_LABELS[c.category]}</p><p className="mt-1 text-xs text-muted-foreground">{c.id}</p></div> },
      { key: 'tenant', label: 'Tenant', render: c => data.tenants.find(t => t.id === c.tenantId)?.name },
      { key: 'amount', label: 'Issued amount', render: c => formatMoney(c.amountCents) },
      { key: 'paid', label: 'Allocated', render: c => formatMoney(chargePaid(data, c.id, DEMO_DATE)) },
      { key: 'balance', label: 'Outstanding', render: c => formatMoney(chargeBalance(data, c, DEMO_DATE)) },
      { key: 'due', label: 'Due date', render: c => <div>{formatDate(c.dueDate)}{c.dueDate < DEMO_DATE && chargeBalance(data, c, DEMO_DATE) > 0 && <div className="mt-1"><StatusBadge status="Overdue" /></div>}</div> },
      { key: 'status', label: 'Payment status', render: c => <StatusBadge status={CHARGE_STATUS_LABELS[chargeStatus(data, c, DEMO_DATE)]} /> },
    ]} />
    <ElectricityPreview data={data} periodId={periodId} />
    <WorkflowPlaceholders title="Billing workflow foundations" items={[
      { title: 'Rent and billing periods', description: 'Rent uses an agreed rental amount. The actual billing-cycle and proration policies remain unconfirmed; sample calendar periods are not a permanent rule.' },
      { title: 'Water and washing machine entry', description: 'Both amounts will be entered manually per tenant. Washing machine charges are optional. No automatic water-meter calculation is planned.' },
      { title: 'Meter readings and rate configuration', description: 'Current reading entry, previous-confirmed-reading lookup, and effective-dated rate changes are future workflows. Issued reading and rate snapshots must remain intact.' },
      { title: 'Bill generation and authorized corrections', description: 'Issuance, corrections, and shared-room electricity allocation are not implemented. Ownership and allocation rules still require landlord confirmation.' },
    ]} />
  </>
}
