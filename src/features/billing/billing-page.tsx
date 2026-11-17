import { useState } from 'react'
import { ReceiptText, CircleAlert, Wallet } from 'lucide-react'
import { PageHeader, PreviewNotice, StatCard } from '@/components/shared/page'
import { AnimatedNumber } from '@/components/shared/animated-number'
import { usePrototype } from '@/hooks/use-prototype'
import { selectSummary } from '@/domain/calculations/summary'
import { DEMO_DATE, DEMO_PERIOD } from '@/data/fixtures/demo'
import { formatMoney } from '@/lib/format'
import { BillingStatusMatrix } from './billing-status-matrix'
import { BillingRatesSection } from './billing-rates-section'
import { ElectricityPreview } from './electricity-preview'
import { PaymentCalculator } from './payment-calculator'
import { BillingStatusChart } from './billing-status-chart'
import { selectBillingRooms } from './billing-room-status'
import { BillingFiltersMenu } from './billing-filters-menu'
import type { BillingRoomStatus } from './billing-room-status'

export default function Billing() {
  const { data } = usePrototype()
  const [periodId, setPeriodId] = useState(DEMO_PERIOD)
  const [statusFilter, setStatusFilter] = useState<BillingRoomStatus | null>(null)
  const summary = selectSummary(data, DEMO_DATE, periodId)
  const billingRooms = selectBillingRooms(data, periodId, DEMO_DATE, false)

  return <>
    <PageHeader title="Billing" description="Check rent, electricity, water, and washing payments in one place." />
    <PreviewNotice>Electricity bills are created only when you confirm a payment-time meter reading. Calculate Payment settles existing rent, water, washing, and electricity bills. Recorded payment corrections are available from Payments &amp; Receipts.</PreviewNotice>
    <div className="mb-6"><div className="max-w-full"><label htmlFor="billing-period" className="mb-2 block text-base font-semibold">Choose a month</label><select id="billing-period" value={periodId} onChange={e => { setPeriodId(e.target.value); setStatusFilter(null) }} className="min-h-14 max-w-full rounded-lg border bg-card px-4 py-3 text-base">{data.billingPeriods.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></div></div>
    <section className="mb-7 grid gap-5 xl:grid-cols-3" aria-label="Bills overview">
      <StatCard label="Total bills" value={formatMoney(summary.billed)} detail="All bills for the month you chose." icon={ReceiptText} />
      <StatCard label="Already paid" value={formatMoney(summary.applied)} detail="Payments used to pay these bills." icon={Wallet} />
      <StatCard label={summary.unresolved > 0 ? 'Known outstanding' : 'Still to pay'} value={formatMoney(summary.outstanding)} detail={<><AnimatedNumber value={summary.overdue} /> bills are past their due date.{summary.unresolved > 0 && <> Plus <AnimatedNumber value={summary.unresolved} /> electricity {summary.unresolved === 1 ? 'bill' : 'bills'} awaiting a meter reading.</>}</>} icon={CircleAlert} />
    </section>
    <BillingStatusChart key={periodId} rooms={billingRooms} periodLabel={data.billingPeriods.find(period => period.id === periodId)?.label ?? 'Selected billing period'} outstandingOnly={false} />
    <div className="billing-table-toolbar">
      <BillingFiltersMenu value={statusFilter} onChange={setStatusFilter} />
      <PaymentCalculator key={periodId} periodId={periodId} periodLabel={data.billingPeriods.find(period => period.id === periodId)?.label ?? 'Sample billing period'} />
    </div>
    <div key={statusFilter ?? 'ALL'} className="billing-table-enter">
      <BillingStatusMatrix data={data} periodId={periodId} asOf={DEMO_DATE} outstandingOnly={false} statusFilter={statusFilter} />
    </div>
    <ElectricityPreview data={data} periodId={periodId} asOf={DEMO_DATE} />
    <BillingRatesSection />
  </>
}
