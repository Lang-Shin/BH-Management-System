import { useState } from 'react'
import { ReceiptText, CircleAlert, Wallet } from 'lucide-react'
import { PageHeader, PreviewNotice, StatCard } from '@/components/shared/page'
import { AnimatedNumber } from '@/components/shared/animated-number'
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
    <PageHeader title="Billing" description="Check rent, electricity, water, and washing payments in one place." />
    <PreviewNotice>You can look through these bills. Creating and changing bills will be added later.</PreviewNotice>
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div className="max-w-full"><label htmlFor="billing-period" className="mb-2 block text-base font-semibold">Choose a month</label><select id="billing-period" value={periodId} onChange={e => setPeriodId(e.target.value)} className="min-h-14 max-w-full rounded-lg border bg-card px-4 py-3 text-base">{data.billingPeriods.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></div><Button variant={outstandingOnly ? 'default' : 'outline'} aria-pressed={outstandingOnly} onClick={() => setOutstandingOnly(v => !v)}>{outstandingOnly ? 'Show all bills' : 'Show unpaid bills'}</Button></div>
    <section className="mb-7 grid gap-5 xl:grid-cols-3" aria-label="Bills overview">
      <StatCard label="Total bills" value={formatMoney(summary.billed)} detail="All bills for the month you chose." icon={ReceiptText} />
      <StatCard label="Already paid" value={formatMoney(summary.applied)} detail="Payments used to pay these bills." icon={Wallet} />
      <StatCard label="Still to pay" value={formatMoney(summary.outstanding)} detail={<><AnimatedNumber value={summary.overdue} /> bills are past their due date.</>} icon={CircleAlert} />
    </section>
    <h2 className="mb-2 text-xl font-semibold">Who has paid?</h2><p className="mb-5 text-base text-muted-foreground">“No bill” means there is nothing to pay for that item.</p>
    <BillingStatusMatrix data={data} periodId={periodId} asOf={DEMO_DATE} outstandingOnly={outstandingOnly} />
    <details className="mt-7 rounded-xl border bg-card p-5 sm:p-6"><summary className="min-h-12 cursor-pointer py-2 text-lg font-semibold">View bill amounts and due dates</summary><div className="mt-5"><DataTable rows={charges} caption="Bill amounts and due dates" columns={[
      { key: 'tenant', label: 'Tenant', render: c => data.tenants.find(t => t.id === c.tenantId)?.name },
      { key: 'bill', label: 'Bill for', render: c => CATEGORY_LABELS[c.category] },
      { key: 'amount', label: 'Bill amount', align: 'right', render: c => <AnimatedNumber value={formatMoney(c.amountCents)} /> },
      { key: 'paid', label: 'Paid', render: c => <div><p><AnimatedNumber value={formatMoney(chargePaid(data, c.id, DEMO_DATE))} /></p><div className="mt-2"><StatusBadge status={CHARGE_STATUS_LABELS[chargeStatus(data, c, DEMO_DATE)]} /></div></div> },
      { key: 'balance', label: 'Still to pay', align: 'right', render: c => <span className="font-semibold"><AnimatedNumber value={formatMoney(chargeBalance(data, c, DEMO_DATE))} /></span> },
      { key: 'due', label: 'Pay by', render: c => <div>{formatDate(c.dueDate)}{c.dueDate < DEMO_DATE && chargeBalance(data, c, DEMO_DATE) > 0 && <div className="mt-2"><StatusBadge status="Late payment" /></div>}</div> },
    ]} /></div></details>
    <ElectricityPreview data={data} periodId={periodId} />
    <WorkflowPlaceholders title="More billing tools" items={[
      { title: 'Make a new bill', description: 'Adding rent, electricity, water, and optional washing bills will be available later.' },
      { title: 'Correct a bill', description: 'Corrections will keep a record of what changed and why. This tool is not available yet.' },
    ]} />
  </>
}
