import { useState } from 'react'
import type { Receipt } from '@/domain/types/models'
import { correctionSettlementText } from '@/domain/calculations/payment-correction'
import { PageHeader } from '@/components/shared/page'
import { EmptyState } from '@/components/shared/states'
import { StatusBadge } from '@/components/shared/status-badge'
import { Badge } from '@/components/ui/badge'
import { TransactionPaidLines } from '@/components/shared/transaction-paid-lines'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { usePrototype } from '@/hooks/use-prototype'
import { useTenantDemo } from '@/app/providers/tenant-demo'
import { formatDate, formatMoney } from '@/lib/format'
import { receiptsForPeriod, selectTenantReceipts, type TenantReceiptView } from './tenant-receipts'

const receiptStatusLabels: Record<Receipt['state'], string> = {
  ISSUED: 'Issued',
  VOIDED: 'Voided',
  SUPERSEDED: 'Superseded',
}

function ReceiptCard({ view, historical = false }: { view: TenantReceiptView; historical?: boolean }) {
  const { data } = usePrototype()
  const { receipt, payment, periods, rooms } = view
  const periodLabel = periods.map(period => period.label).join(' · ')
  const ambiguousRoom = rooms.label === 'Multiple rooms / contexts' || rooms.label === 'Room needs review'
  const revised = receipt.revision > 1
  const corrected = view.correction?.correctedReceiptId === receipt.id ? view.correction : null

  return <article aria-label={`Receipt ${receipt.receiptNumber}`}>
    <Card className={historical ? 'h-full border-dashed' : 'h-full'}>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">{receipt.receiptNumber}</CardTitle>
            <CardDescription>{periodLabel}</CardDescription>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {revised && !historical && <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-900">Revised</Badge>}
            <StatusBadge status={receiptStatusLabels[receipt.state]} />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <section className="transaction-summary" aria-label="Receipt payment summary">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Room</p>
          <p className="mt-1 break-words text-2xl font-bold">{rooms.label}</p>
          <dl className="transaction-metadata mt-4 grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-muted-foreground">Date paid</dt><dd className="mt-1 font-semibold">{formatDate(payment.paidOn)}</dd></div>
            <div><dt className="text-muted-foreground">Receipt number</dt><dd className="mt-1 break-all font-semibold">{receipt.receiptNumber}</dd></div>
            <div className="transaction-amount-section"><dt className="text-muted-foreground">Amount paid</dt><dd className="transaction-dialog-amount">{formatMoney(receipt.amountCents)}</dd></div>
          </dl>
        </section>
        {ambiguousRoom && <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{rooms.note}</p>}
        <p className="mt-3 text-xs text-muted-foreground">
          Revision {receipt.revision}
          {view.supersedesReceipt ? ` · Supersedes ${view.supersedesReceipt.receiptNumber} (revision ${view.supersedesReceipt.revision})` : ''}
        </p>
        <section aria-label="What Was Paid" className="mt-5 min-w-0">
          <h3 className="mb-3 font-semibold">What Was Paid</h3>
          <TransactionPaidLines data={data} context={rooms} advance={data.tenantCredits.some(item => item.sourcePaymentId === payment.id)} />
          {view.depositDisposition && <p role="note" className="mt-3 text-xs leading-relaxed text-muted-foreground">
            {view.depositDisposition === 'NON_REFUNDABLE'
              ? 'Security deposit is non-refundable under the recorded policy. It remains separate from rent and is not recognized as rental income.'
              : 'Security deposit requires manual review before any refund or deduction. It remains separate from rent.'}
          </p>}
          <p className="mt-3 text-xs text-muted-foreground">Read-only receipt. Only allocations included in this transaction are shown. Other bills may be settled by separate transactions.</p>
        </section>
        {corrected && <div role="note" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <p><strong className="font-semibold">Corrected {formatDate(corrected.correctedAt)}.</strong> {corrected.reason}</p>
          <p className="mt-1">{correctionSettlementText(corrected)}</p>
        </div>}
        {historical && <p role="note" className="mt-4 rounded-xl border border-dashed px-3 py-2 text-sm text-muted-foreground">
          {view.supersededBy
            ? `Replaced by ${view.supersededBy.receiptNumber} (revision ${view.supersededBy.revision}). Kept for history.`
            : 'This receipt is voided and kept for history.'}
        </p>}
      </CardContent>
    </Card>
  </article>
}

/** Tenant receipts come from the same recorded payments and receipts as the landlord workspace. */
export default function TenantPayments() {
  const { data } = usePrototype()
  const { tenantId } = useTenantDemo()
  const { receipts, unmatched } = selectTenantReceipts(data, tenantId)
  const currentPeriod = data.billingPeriods.find(item => item.status === 'OPEN') ?? data.billingPeriods.at(-1)
  const [periodId, setPeriodId] = useState(currentPeriod?.id ?? '')
  const period = data.billingPeriods.find(item => item.id === periodId) ?? currentPeriod
  const visible = period ? receiptsForPeriod(receipts, period.id) : []
  const effective = visible.filter(item => item.effective)
  const history = visible.filter(item => !item.effective)

  return <>
    <PageHeader title="My Payments & Receipts" description="Receipts issued for your recorded payments at Halili BH." />
    {unmatched > 0 && <div role="alert" className="mb-6 max-w-3xl rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
      {unmatched} receipt {unmatched === 1 ? 'record could' : 'records could'} not be matched to a tenant because the payment link is missing. {unmatched === 1 ? 'It is' : 'They are'} not shown.
    </div>}
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <label htmlFor="tenant-receipt-period" className="mb-2 block text-sm font-semibold">Billing month</label>
        <select id="tenant-receipt-period" value={period?.id ?? ''} onChange={event => setPeriodId(event.target.value)} className="min-h-12 max-w-full rounded-lg border bg-card px-3">
          {data.billingPeriods.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </div>
      {period && <p role="status" className="text-sm text-muted-foreground">{effective.length} {effective.length === 1 ? 'receipt' : 'receipts'} for {period.label}.</p>}
    </div>
    {effective.length > 0
      ? <section aria-label="Tenant receipts" className="grid gap-5 xl:grid-cols-2">{effective.map(view => <ReceiptCard key={view.receipt.id} view={view} />)}</section>
      : <EmptyState
        title={receipts.length === 0 ? 'No receipts yet' : `No receipts for ${period?.label ?? 'this billing month'}`}
        description={receipts.length === 0
          ? 'This demo tenant has no receipts in the sample records yet.'
          : 'This tenant has receipts in other billing months. Choose a different month to view them.'}
      />}
    {history.length > 0 && <details className="mt-6">
      <summary className="cursor-pointer text-sm font-semibold">Receipt history for {period?.label} ({history.length})</summary>
      <p className="mt-2 text-xs text-muted-foreground">Superseded receipts are kept unchanged for reference; they are not counted as current receipts.</p>
      <div className="mt-4 grid gap-5 xl:grid-cols-2">{history.map(view => <ReceiptCard key={view.receipt.id} view={view} historical />)}</div>
    </details>}
  </>
}
