import { useState } from 'react'
import { ReceiptText, CircleAlert, Wallet } from 'lucide-react'
import { PageHeader, PreviewNotice, StatCard } from '@/components/shared/page'
import { AnimatedNumber } from '@/components/shared/animated-number'
import { DataTable } from '@/components/shared/data-table'
import { StatusBadge } from '@/components/shared/status-badge'
import { WorkflowPlaceholders } from '@/components/shared/workflow-placeholders'
import { usePrototype } from '@/hooks/use-prototype'
import { chargeBalance, chargePaid, chargeStatus, issuedCharges, selectSummary } from '@/domain/calculations/summary'
import { DEMO_DATE, DEMO_PERIOD } from '@/data/fixtures/demo'
import { formatDate, formatMoney } from '@/lib/format'
import { CATEGORY_LABELS, CHARGE_STATUS_LABELS } from '@/lib/labels'
import { BillingStatusMatrix } from './billing-status-matrix'
import { ElectricityPreview } from './electricity-preview'
import { PaymentCalculator } from './payment-calculator'
import { chargeRoom } from '@/domain/calculations/room-finance'
import { ChargeDetails } from '@/components/shared/charge-details'
import { BillingStatusChart } from './billing-status-chart'
import { selectBillingRooms } from './billing-room-status'
import { BillingFiltersMenu } from './billing-filters-menu'
import type { BillingRoomStatus } from './billing-room-status'

export default function Billing() {
  const { data } = usePrototype()
  const [periodId, setPeriodId] = useState(DEMO_PERIOD)
  const [statusFilter, setStatusFilter] = useState<BillingRoomStatus | null>(null)
  const summary = selectSummary(data, DEMO_DATE, periodId)
  const charges = issuedCharges(data, DEMO_DATE, periodId)
  const billingRooms = selectBillingRooms(data, periodId, DEMO_DATE, false)

  return <>
    <PageHeader title="Billing" description="Check rent, electricity, water, and washing payments in one place." action={<PaymentCalculator key={periodId} periodId={periodId} periodLabel={data.billingPeriods.find(period => period.id === periodId)?.label ?? 'Sample billing period'} />} />
    <PreviewNotice>Electricity bills are created only when you confirm a payment-time meter reading. Other bill-creation and correction workflows will be added later.</PreviewNotice>
    <div className="mb-6"><div className="max-w-full"><label htmlFor="billing-period" className="mb-2 block text-base font-semibold">Choose a month</label><select id="billing-period" value={periodId} onChange={e => { setPeriodId(e.target.value); setStatusFilter(null) }} className="min-h-14 max-w-full rounded-lg border bg-card px-4 py-3 text-base">{data.billingPeriods.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></div></div>
    <section className="mb-7 grid gap-5 xl:grid-cols-3" aria-label="Bills overview">
      <StatCard label="Total bills" value={formatMoney(summary.billed)} detail="All bills for the month you chose." icon={ReceiptText} />
      <StatCard label="Already paid" value={formatMoney(summary.applied)} detail="Payments used to pay these bills." icon={Wallet} />
      <StatCard label={summary.unresolved > 0 ? 'Known outstanding' : 'Still to pay'} value={formatMoney(summary.outstanding)} detail={<><AnimatedNumber value={summary.overdue} /> bills are past their due date.{summary.unresolved > 0 && <> Plus <AnimatedNumber value={summary.unresolved} /> electricity {summary.unresolved === 1 ? 'bill' : 'bills'} awaiting a meter reading.</>}</>} icon={CircleAlert} />
    </section>
    <BillingStatusChart key={periodId} rooms={billingRooms} periodLabel={data.billingPeriods.find(period => period.id === periodId)?.label ?? 'Selected billing period'} outstandingOnly={false} />
    <div className="mb-3 flex justify-end"><BillingFiltersMenu value={statusFilter} onChange={setStatusFilter} /></div>
    <div key={statusFilter ?? 'ALL'} className="billing-table-enter">
      <BillingStatusMatrix data={data} periodId={periodId} asOf={DEMO_DATE} outstandingOnly={false} statusFilter={statusFilter} />
    </div>
    <details className="mt-7 rounded-xl border bg-card p-5 sm:p-6"><summary className="min-h-12 cursor-pointer py-2 text-lg font-semibold">View bill amounts and due dates</summary><div className="mt-5"><DataTable rows={charges} caption="Bill amounts and due dates" columns={[
      { key: 'room', label: 'Room', render: c => <span className="font-semibold">{chargeRoom(data, c).label}</span> },
      { key: 'tenant', label: 'Charge owner / ID', render: c => <div className="max-w-xs whitespace-normal"><p>{data.tenants.find(t => t.id === c.tenantId)?.name}</p><p className="mt-1 break-all text-xs text-muted-foreground">{c.id}</p></div> },
      { key: 'bill', label: 'Bill for', render: c => CATEGORY_LABELS[c.category] },
      { key: 'amount', label: 'Bill amount', align: 'right', render: c => formatMoney(c.amountCents) },
      { key: 'paid', label: 'Paid', render: c => <div><p>{formatMoney(chargePaid(data, c.id, DEMO_DATE))}</p><div className="mt-2"><StatusBadge status={CHARGE_STATUS_LABELS[chargeStatus(data, c, DEMO_DATE)]} /></div></div> },
      { key: 'balance', label: 'Still to pay', align: 'right', render: c => <span className="font-semibold">{formatMoney(chargeBalance(data, c, DEMO_DATE))}</span> },
      { key: 'due', label: 'Pay by', render: c => <div>{formatDate(c.dueDate)}{c.dueDate < DEMO_DATE && chargeBalance(data, c, DEMO_DATE) > 0 && <div className="mt-2"><StatusBadge status="Late payment" /></div>}</div> },
      { key: 'details', label: 'Allocations', render: c => <ChargeDetails data={data} charges={[c]} asOf={DEMO_DATE} /> },
    ]} /></div></details>
    <ElectricityPreview data={data} periodId={periodId} asOf={DEMO_DATE} />
    <WorkflowPlaceholders title="More billing tools" items={[
      { title: 'Make another bill type', description: 'Electricity uses the payment-time meter workflow. Adding rent, water, and optional washing bills will be available later.' },
      { title: 'Correct a bill', description: 'Corrections will keep a record of what changed and why. This tool is not available yet.' },
    ]} />
  </>
}
