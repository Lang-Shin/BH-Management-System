import { useMemo, useState } from 'react'
import { ReceiptText, CircleAlert, Wallet } from 'lucide-react'
import { PageHeader, PreviewNotice, StatCard } from '@/components/shared/page'
import { AnimatedNumber } from '@/components/shared/animated-number'
import { usePrototype } from '@/hooks/use-prototype'
import { useOccupancyDate } from '@/hooks/use-occupancy-date'
import { calendarBillingPeriods, currentBillingPeriodId, resolveBillingPeriod } from '@/domain/calculations/billing-periods'
import { formatDate, formatMoney } from '@/lib/format'
import { BillingStatusMatrix } from './billing-status-matrix'
import { BillingRatesSection } from './billing-rates-section'
import { PaymentCalculator } from './payment-calculator'
import { MoveInSection } from './move-in-section'
import { BillingStatusChart } from './billing-status-chart'
import { billingOverview, selectBillingRooms } from './billing-room-status'
import { BillingFiltersMenu } from './billing-filters-menu'
import type { BillingRoomStatus } from './billing-room-status'
import { approvedRoomChangeBillingReviews } from '@/domain/calculations/room-change-requests'

export default function Billing() {
  const { data } = usePrototype()
  const occupancyDate = useOccupancyDate()
  const billingPeriods = useMemo(() => calendarBillingPeriods(data, occupancyDate), [data, occupancyDate])
  const [periodId, setPeriodId] = useState(() => currentBillingPeriodId(data, occupancyDate))
  const [statusFilter, setStatusFilter] = useState<BillingRoomStatus | null>(null)
  const selectedPeriod = billingPeriods.find(period => period.id === periodId) ?? resolveBillingPeriod(data, periodId)
  const billingRooms = selectBillingRooms(data, periodId, occupancyDate, false)
  const summary = billingOverview(billingRooms)
  const billingReviews = approvedRoomChangeBillingReviews(data, periodId)
  const financialReviews = data.financialReviewCases.filter(review => review.status === 'OPEN'
    && (review.type === 'TRANSFER_RENT_DIFFERENCE' || review.type === 'TRANSFER_PREPAID_RENT'))

  return <>
    <PageHeader title="Billing" description="Check rent, electricity, water, and washing payments in one place." />
    <PreviewNotice>Rent shows the anniversary period due in the selected month; electricity, water, and washing use the selected calendar month. Electricity bills are created only when you confirm a payment-time meter reading. Advance and security deposit remain separate room-level balances. Recorded payment corrections are available from Payments &amp; Receipts.</PreviewNotice>
    <div className="mb-6"><div className="max-w-full"><label htmlFor="billing-period" className="mb-2 block text-base font-semibold">Choose a month</label><select id="billing-period" value={periodId} onChange={e => { setPeriodId(e.target.value); setStatusFilter(null) }} className="min-h-14 max-w-full rounded-lg border bg-card px-4 py-3 text-base">{billingPeriods.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></div></div>
    {billingReviews.length > 0 && <div className="room-change-billing-review" role="note">
      <strong>Room change billing review</strong>
      <p>{billingReviews.length === 1 ? 'One approved mid-period transfer affects' : `${billingReviews.length} approved mid-period transfers affect`} this billing period. Review room rent manually; no proration or duplicate rent was generated automatically.</p>
      <ul>{billingReviews.map(request => <li key={request.id}>{data.tenants.find(tenant => tenant.id === request.tenantId)?.name ?? 'Tenant'}: Room {data.rooms.find(room => room.id === request.currentRoomId)?.name ?? '—'} → Room {data.rooms.find(room => room.id === request.requestedRoomId)?.name ?? '—'}{request.approvedStartDate ? `, effective ${formatDate(request.approvedStartDate)}` : ''}</li>)}</ul>
    </div>}
    {financialReviews.length > 0 && <div className="room-change-billing-review" role="note">
      <strong>Transfer financial review</strong>
      <p>{financialReviews.length === 1 ? 'One internal transfer has an unresolved financial reconciliation.' : `${financialReviews.length} internal transfers have unresolved financial reconciliations.`} No rent, refund, prepayment, or deposit was moved automatically.</p>
      <ul>{financialReviews.map(review => <li key={review.id}>
        Room {data.rooms.find(room => room.id === review.roomId)?.name ?? '—'}: {review.note}
      </li>)}</ul>
    </div>}
    <section className="mb-7 grid gap-5 xl:grid-cols-3" aria-label="Bills overview">
      <StatCard label="Total bills" value={formatMoney(summary.billed)} detail="All bills for the month you chose." icon={ReceiptText} />
      <StatCard label="Already paid" value={formatMoney(summary.paid)} detail="Payments and advance applications used to pay these bills." icon={Wallet} />
      <StatCard label={summary.unresolved > 0 ? 'Known outstanding' : 'Still to pay'} value={formatMoney(summary.outstanding)} detail={<><AnimatedNumber value={summary.overdue} /> bills are past their due date.{summary.unresolved > 0 && <> Plus <AnimatedNumber value={summary.unresolved} /> electricity {summary.unresolved === 1 ? 'bill' : 'bills'} awaiting a meter reading.</>}</>} icon={CircleAlert} />
    </section>
    <BillingStatusChart key={periodId} rooms={billingRooms} periodLabel={selectedPeriod?.label ?? 'Selected billing period'} outstandingOnly={false} />
    <div className="billing-table-toolbar">
      <BillingFiltersMenu value={statusFilter} onChange={setStatusFilter} />
      <PaymentCalculator key={periodId} periodId={periodId} periodLabel={selectedPeriod?.label ?? 'Selected billing period'} />
    </div>
    <div key={statusFilter ?? 'ALL'} className="billing-table-enter">
      <BillingStatusMatrix data={data} periodId={periodId} asOf={occupancyDate} outstandingOnly={false} statusFilter={statusFilter} />
    </div>
    <div className="mt-8"><MoveInSection /></div>
    <BillingRatesSection />
  </>
}
