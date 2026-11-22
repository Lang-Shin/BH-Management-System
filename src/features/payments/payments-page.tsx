import { Wallet, Banknote, CircleDollarSign, ShieldCheck } from 'lucide-react'
import { PageHeader, PreviewNotice, StatCard } from '@/components/shared/page'
import { PaginatedDataTable } from '@/components/shared/table-pagination'
import { usePrototype } from '@/hooks/use-prototype'
import { useOccupancyDate } from '@/hooks/use-occupancy-date'
import { creditRemaining, selectSummary } from '@/domain/calculations/summary'
import { currentBillingPeriodId } from '@/domain/calculations/billing-periods'
import { moveInSummary, selectMoveInObligations } from '@/domain/calculations/move-in'
import { latestPaymentReceipt } from '@/domain/calculations/payment-correction'
import { formatDate, formatMoney } from '@/lib/format'
import { PaymentsTransactionWorkspace } from './payments-transaction-workspace'

export default function Payments() {
  const { data } = usePrototype()
  const occupancyDate = useOccupancyDate()
  const summary = selectSummary(data, occupancyDate, currentBillingPeriodId(data, occupancyDate))
  const moveIn = moveInSummary(data, occupancyDate)
  const moveInRows = selectMoveInObligations(data, occupancyDate).map(view => ({ ...view, id: view.obligation.id }))

  return <>
    <PageHeader title="Payments & Receipts" description="See who paid, when they paid, and what the payment was for." />
    <PreviewNotice>Electricity payments are recorded from Billing or a room pending-payments view. Other payment workflows remain separate.</PreviewNotice>
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
      { key: 'advance', label: 'Advance collected', align: 'right', render: view => <div><span>{formatMoney(view.advanceNetCents)}</span>{view.advanceRefundedCents > 0 && <small className="block text-xs text-muted-foreground">Refunded {formatMoney(view.advanceRefundedCents)}</small>}</div> },
      { key: 'deposit', label: 'Deposit collected', align: 'right', render: view => <div><span>{formatMoney(view.depositPaidCents)}</span><small className="block text-xs text-muted-foreground">{view.obligation.depositDisposition === 'NON_REFUNDABLE' ? 'Non-refundable' : 'Manual review'}</small></div> },
      { key: 'remaining', label: 'Still outstanding', align: 'right', render: view => <span className="font-semibold">{formatMoney(view.totalRemainingCents)}</span> },
      { key: 'status', label: 'Status', render: view => <span className="move-in-status" data-status={view.status}>{view.status}</span> },
    ]} />
    {data.advanceRefunds.length > 0 && <><h2 className="mt-8 mb-2 text-xl font-semibold">Advance refunds</h2><p className="mb-5 text-base text-muted-foreground">Short-stay advance refunds are separate from the original receipts. The security deposit remains held and non-refundable.</p><PaginatedDataTable rows={data.advanceRefunds} resetKey={data.advanceRefunds.length} recordLabel="advance refunds" caption="Advance refunds" columns={[
      { key: 'room', label: 'Room', render: refund => <span className="font-semibold">Room {data.rooms.find(room => room.id === refund.roomId)?.name ?? 'Needs review'}</span> },
      { key: 'tenant', label: 'Tenant', render: refund => data.tenants.find(tenant => tenant.id === refund.tenantId)?.name ?? 'Tenant needs review' },
      { key: 'date', label: 'Date refunded', render: refund => formatDate(refund.refundedOn) },
      { key: 'amount', label: 'Amount refunded', align: 'right', render: refund => <span className="font-semibold">{formatMoney(refund.amountCents)}</span> },
      { key: 'receipt', label: 'Original receipt', render: refund => latestPaymentReceipt(data, refund.sourcePaymentId)?.receiptNumber ?? 'No receipt' },
      { key: 'reason', label: 'Reason', render: refund => <span className="text-sm text-muted-foreground">{refund.reason}</span> },
    ]} /></>}
    <h2 className="mt-8 mb-2 text-xl font-semibold">Unapplied tenant credit</h2><p className="mb-5 text-base text-muted-foreground">This money is kept for later. It has not yet been used to pay a monthly bill.</p><PaginatedDataTable rows={data.tenantCredits} resetKey={data.tenantCredits.length} recordLabel="advance payments" caption="Advance payments" columns={[
      { key: 'tenant', label: 'Tenant', render: c => data.tenants.find(t => t.id === c.tenantId)?.name },
      { key: 'created', label: 'Date paid', render: c => formatDate(c.createdOn) },
      { key: 'original', label: 'Advance paid', align: 'right', render: c => formatMoney(c.amountCents) },
      { key: 'remaining', label: 'Still available', align: 'right', render: c => <span className="font-semibold">{formatMoney(creditRemaining(data, c, occupancyDate))}</span> },
    ]} />
  </>
}
