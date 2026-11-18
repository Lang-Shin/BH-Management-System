import { useRef, useState } from 'react'
import { Wallet, Banknote, CircleDollarSign } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader, PreviewNotice, StatCard } from '@/components/shared/page'
import { AnimatedNumber } from '@/components/shared/animated-number'
import { PaginatedDataTable } from '@/components/shared/table-pagination'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { StatusBadge } from '@/components/shared/status-badge'
import { WorkflowPlaceholders } from '@/components/shared/workflow-placeholders'
import { usePrototype } from '@/hooks/use-prototype'
import { creditRemaining, selectSummary } from '@/domain/calculations/summary'
import { DEMO_DATE, DEMO_PERIOD } from '@/data/fixtures/demo'
import { formatDate, formatMoney } from '@/lib/format'
import { ReceiptDialog } from './receipt-dialog'
import { PaymentsTransactionWorkspace } from './payments-transaction-workspace'
import { paymentRooms } from '@/domain/calculations/room-finance'

export default function Payments() {
  const { data } = usePrototype()
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null)
  const receiptTrigger = useRef<HTMLButtonElement | null>(null)
  const selectedReceipt = data.receipts.find(item => item.id === selectedReceiptId)
  const summary = selectSummary(data, DEMO_DATE, DEMO_PERIOD)
  const receipt = [...data.receipts].filter(r => r.state === 'ISSUED').sort((a, b) => b.issuedOn.localeCompare(a.issuedOn))[0]
  const receiptPayment = data.payments.find(p => p.id === receipt?.paymentId)

  return <>
    <PageHeader title="Payments & Receipts" description="See who paid, when they paid, and what the payment was for." />
    <PreviewNotice>These are sample records. Electricity payments are recorded from Billing or a room’s Pending Payments; other payment workflows will be added later.</PreviewNotice>
    <section className="mb-7 grid gap-5 xl:grid-cols-3" aria-label="Payments overview">
      <StatCard label="Money received" value={formatMoney(summary.received)} detail="All payments received in November." icon={Wallet} />
      <StatCard label="Advance payments" value={formatMoney(summary.credit)} detail="Money kept for a future bill." icon={CircleDollarSign} />
      <StatCard label="Partly paid bills" value={summary.partial} detail="November bills that still have an amount left to pay." icon={Banknote} />
    </section>
    <PaymentsTransactionWorkspace />
    <h2 className="mt-8 mb-2 text-xl font-semibold">Money paid in advance</h2><p className="mb-5 text-base text-muted-foreground">This money is kept for later. It has not yet been used to pay a bill.</p><PaginatedDataTable rows={data.tenantCredits} resetKey={data.tenantCredits.length} recordLabel="advance payments" caption="Advance payments" columns={[
      { key: 'tenant', label: 'Tenant', render: c => data.tenants.find(t => t.id === c.tenantId)?.name },
      { key: 'created', label: 'Date paid', render: c => formatDate(c.createdOn) },
      { key: 'original', label: 'Advance paid', align: 'right', render: c => formatMoney(c.amountCents) },
      { key: 'remaining', label: 'Still available', align: 'right', render: c => <span className="font-semibold">{formatMoney(creditRemaining(data, c, DEMO_DATE))}</span> },
    ]} />
    <details className="mt-7 rounded-xl border bg-card p-5 sm:p-6"><summary className="min-h-12 cursor-pointer py-2 text-lg font-semibold">View receipt list</summary><p className="my-5 text-sm text-muted-foreground">These receipt numbers are examples. Making or printing receipts will be added later.</p>
    {receipt && <Card className="mb-5 max-w-lg bg-muted/40"><CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle>Sample receipt preview</CardTitle><StatusBadge status={receipt.revision > 1 ? 'Corrected' : 'Recorded'} /></div><CardDescription>Halili BH · {receipt.receiptNumber}</CardDescription></CardHeader><CardContent><dl className="grid grid-cols-2 gap-4 text-sm"><div><dt className="text-muted-foreground">Received from</dt><dd className="mt-1 font-semibold">{data.tenants.find(t => t.id === receiptPayment?.tenantId)?.name ?? 'Unknown tenant'}</dd></div><div><dt className="text-muted-foreground">Date</dt><dd className="mt-1">{formatDate(receipt.issuedOn)}</dd></div><div className="col-span-2 border-t pt-4"><dt className="text-muted-foreground">Amount paid</dt><dd className="mt-1 text-2xl font-bold tabular-nums"><AnimatedNumber value={formatMoney(receipt.amountCents)} /></dd></div></dl><p className="mt-4 text-xs text-muted-foreground">Demonstration preview · Not an official receipt</p></CardContent></Card>}
    <PaginatedDataTable rows={data.receipts} resetKey={data.receipts.length} recordLabel="receipts" caption="Sample receipts" columns={[
      { key: 'room', label: 'Room context', render: r => { const payment = data.payments.find(p => p.id === r.paymentId); return <span className="font-semibold">{payment ? paymentRooms(data, payment, r.issuedOn, r.allocationIds).label : 'Room needs review'}</span> } },
      { key: 'number', label: 'Receipt number', render: r => r.receiptNumber },
      { key: 'tenant', label: 'Received from', render: r => data.tenants.find(t => t.id === data.payments.find(p => p.id === r.paymentId)?.tenantId)?.name },
      { key: 'date', label: 'Receipt date', render: r => formatDate(r.issuedOn) },
      { key: 'amount', label: 'Amount paid', align: 'right', render: r => formatMoney(r.amountCents) },
      { key: 'actions', label: 'Actions', render: r => <Button variant="outline" aria-label={`View receipt ${r.receiptNumber}`} onClick={event => { receiptTrigger.current = event.currentTarget; setSelectedReceiptId(r.id) }}>View receipt</Button> },
    ]} /></details>
    <WorkflowPlaceholders title="More payment tools" items={[
      { title: 'Record other payments', description: 'Electricity payment is available from Billing or Pending Payments. Rent, water, washing, and advance entry will be available later.' },
      { title: 'Use an advance payment', description: 'You will be able to choose which bill an advance payment pays for.' },
      { title: 'Print or send a receipt', description: 'Making a receipt for a tenant will be added later.' },
    ]} />
    {selectedReceipt && <ReceiptDialog key={selectedReceipt.id} data={data} receipt={selectedReceipt} onClose={() => setSelectedReceiptId(null)} onReturnFocus={() => receiptTrigger.current?.focus()} />}
  </>
}
