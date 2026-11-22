import { Wallet, Banknote, CircleDollarSign, ShieldCheck } from 'lucide-react'
import { PageHeader, PreviewNotice, StatCard } from '@/components/shared/page'
import { PaginatedDataTable } from '@/components/shared/table-pagination'
import { usePrototype } from '@/hooks/use-prototype'
import { useOccupancyDate } from '@/hooks/use-occupancy-date'
import { creditRemaining, selectSummary } from '@/domain/calculations/summary'
import { DEMO_DATE, DEMO_PERIOD } from '@/data/fixtures/demo'
import { moveInSummary, selectMoveInObligations } from '@/domain/calculations/move-in'
import { formatDate, formatMoney } from '@/lib/format'
import { PaymentsTransactionWorkspace } from './payments-transaction-workspace'

export default function Payments() {
  const { data } = usePrototype()
  const occupancyDate = useOccupancyDate()
  const summary = selectSummary(data, DEMO_DATE, DEMO_PERIOD)
  const moveIn = moveInSummary(data, occupancyDate)
  const moveInRows = selectMoveInObligations(data, occupancyDate).map(view => ({ ...view, id: view.obligation.id }))

  return <>
    <PageHeader title="Payments & Receipts" description="See who paid, when they paid, and what the payment was for." />
    <PreviewNotice>These are sample records. Electricity payments are recorded from Billing or a room’s Pending Payments; other payment workflows will be added later.</PreviewNotice>
    <section className="mb-7 grid gap-5 xl:grid-cols-4" aria-label="Payments overview">
      <StatCard label="Money received" value={formatMoney(summary.received)} detail="All payments received in November." icon={Wallet} />
      <StatCard label="Move-in deposits held" value={formatMoney(moveIn.depositCollectedCents)} detail={`${data.moveInPolicy.depositDisposition === 'NON_REFUNDABLE' ? 'Non-refundable' : 'Refundable with manual review'} under current policy; plus ${formatMoney(moveIn.advanceCollectedCents)} advance collected.`} icon={ShieldCheck} />
      <StatCard label="Unapplied tenant credit" value={formatMoney(summary.credit)} detail="Money kept for a future monthly bill." icon={CircleDollarSign} />
      <StatCard label="Partly paid bills" value={summary.partial} detail="November bills that still have an amount left to pay." icon={Banknote} />
    </section>
    <PaymentsTransactionWorkspace />
    <h2 className="mt-8 mb-2 text-xl font-semibold">Move-in advance &amp; security deposit</h2><p className="mb-5 text-base text-muted-foreground">Collected at the room level. Deposits are {data.moveInPolicy.depositDisposition === 'NON_REFUNDABLE' ? 'non-refundable' : 'refundable with manual review'} under current policy but remain separate from monthly bills and rental income.</p><PaginatedDataTable rows={moveInRows} resetKey={moveInRows.length} recordLabel="move-in balances" caption="Move-in advance and security deposit" emptyState={<p className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">No move-in obligations are recorded yet.</p>} columns={[
      { key: 'room', label: 'Room', render: view => <span className="font-semibold">Room {view.room.name}</span> },
      { key: 'payer', label: 'Payer', render: view => view.payerName },
      { key: 'advance', label: 'Advance collected', align: 'right', render: view => formatMoney(view.advancePaidCents) },
      { key: 'deposit', label: 'Deposit collected', align: 'right', render: view => <div><span>{formatMoney(view.depositPaidCents)}</span><small className="block text-xs text-muted-foreground">{view.obligation.depositDisposition === 'NON_REFUNDABLE' ? 'Non-refundable' : 'Manual review'}</small></div> },
      { key: 'remaining', label: 'Still outstanding', align: 'right', render: view => <span className="font-semibold">{formatMoney(view.totalRemainingCents)}</span> },
      { key: 'status', label: 'Status', render: view => <span className="move-in-status" data-status={view.status}>{view.status}</span> },
    ]} />
    <h2 className="mt-8 mb-2 text-xl font-semibold">Unapplied tenant credit</h2><p className="mb-5 text-base text-muted-foreground">This money is kept for later. It has not yet been used to pay a monthly bill.</p><PaginatedDataTable rows={data.tenantCredits} resetKey={data.tenantCredits.length} recordLabel="advance payments" caption="Advance payments" columns={[
      { key: 'tenant', label: 'Tenant', render: c => data.tenants.find(t => t.id === c.tenantId)?.name },
      { key: 'created', label: 'Date paid', render: c => formatDate(c.createdOn) },
      { key: 'original', label: 'Advance paid', align: 'right', render: c => formatMoney(c.amountCents) },
      { key: 'remaining', label: 'Still available', align: 'right', render: c => <span className="font-semibold">{formatMoney(creditRemaining(data, c, DEMO_DATE))}</span> },
    ]} />
  </>
}
