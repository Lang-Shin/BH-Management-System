import { Wallet, Banknote, CircleDollarSign } from 'lucide-react'
import { PageHeader, PreviewNotice, StatCard } from '@/components/shared/page'
import { AnimatedNumber } from '@/components/shared/animated-number'
import { PaymentHistoryTable } from '@/components/shared/payment-history-table'
import { DataTable } from '@/components/shared/data-table'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { StatusBadge } from '@/components/shared/status-badge'
import { WorkflowPlaceholders } from '@/components/shared/workflow-placeholders'
import { usePrototype } from '@/hooks/use-prototype'
import { creditRemaining, selectSummary } from '@/domain/calculations/summary'
import { DEMO_DATE, DEMO_PERIOD } from '@/data/fixtures/demo'
import { formatDate, formatMoney } from '@/lib/format'

export default function Payments() {
  const { data } = usePrototype()
  const summary = selectSummary(data, DEMO_DATE, DEMO_PERIOD)
  const payments = data.payments.filter(p => p.state === 'RECORDED' && p.paidOn <= DEMO_DATE).sort((a, b) => b.paidOn.localeCompare(a.paidOn))
  const receipt = [...data.receipts].filter(r => r.state === 'ISSUED').sort((a, b) => b.issuedOn.localeCompare(a.issuedOn))[0]
  const receiptPayment = data.payments.find(p => p.id === receipt?.paymentId)

  return <>
    <PageHeader title="Payments & Receipts" description="See who paid, when they paid, and what the payment was for." />
    <PreviewNotice>These payments and receipts are examples. Recording new payments will be added later.</PreviewNotice>
    <section className="mb-7 grid gap-5 xl:grid-cols-3" aria-label="Payments overview">
      <StatCard label="Money received" value={formatMoney(summary.received)} detail="All payments received in November." icon={Wallet} />
      <StatCard label="Advance payments" value={formatMoney(summary.credit)} detail="Money kept for a future bill." icon={CircleDollarSign} />
      <StatCard label="Partly paid bills" value={summary.partial} detail="November bills that still have an amount left to pay." icon={Banknote} />
    </section>
    <h2 className="mb-4 text-xl font-semibold">Payment history</h2><PaymentHistoryTable data={data} payments={payments} />
    <h2 className="mt-8 mb-2 text-xl font-semibold">Money paid in advance</h2><p className="mb-5 text-base text-muted-foreground">This money is kept for later. It has not yet been used to pay a bill.</p><DataTable rows={data.tenantCredits} caption="Advance payments" columns={[
      { key: 'tenant', label: 'Tenant', render: c => data.tenants.find(t => t.id === c.tenantId)?.name },
      { key: 'created', label: 'Date paid', render: c => formatDate(c.createdOn) },
      { key: 'original', label: 'Advance paid', align: 'right', render: c => formatMoney(c.amountCents) },
      { key: 'remaining', label: 'Still available', align: 'right', render: c => <span className="font-semibold">{formatMoney(creditRemaining(data, c, DEMO_DATE))}</span> },
    ]} />
    <details className="mt-7 rounded-xl border bg-card p-5 sm:p-6"><summary className="min-h-12 cursor-pointer py-2 text-lg font-semibold">View receipt list</summary><p className="my-5 text-sm text-muted-foreground">These receipt numbers are examples. Making or printing receipts will be added later.</p>
    {receipt && <Card className="mb-5 max-w-lg bg-muted/40"><CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle>Sample receipt preview</CardTitle><StatusBadge status="Recorded" /></div><CardDescription>Halili BH · {receipt.receiptNumber}</CardDescription></CardHeader><CardContent><dl className="grid grid-cols-2 gap-4 text-sm"><div><dt className="text-muted-foreground">Received from</dt><dd className="mt-1 font-semibold">{data.tenants.find(t => t.id === receiptPayment?.tenantId)?.name ?? 'Unknown tenant'}</dd></div><div><dt className="text-muted-foreground">Date</dt><dd className="mt-1">{formatDate(receipt.issuedOn)}</dd></div><div className="col-span-2 border-t pt-4"><dt className="text-muted-foreground">Amount paid</dt><dd className="mt-1 text-2xl font-bold tabular-nums"><AnimatedNumber value={formatMoney(receipt.amountCents)} /></dd></div></dl><p className="mt-4 text-xs text-muted-foreground">Demonstration preview · Not an official receipt</p></CardContent></Card>}
    <DataTable rows={data.receipts} caption="Sample receipts" columns={[
      { key: 'number', label: 'Receipt number', render: r => r.receiptNumber },
      { key: 'tenant', label: 'Tenant', render: r => data.tenants.find(t => t.id === data.payments.find(p => p.id === r.paymentId)?.tenantId)?.name },
      { key: 'date', label: 'Receipt date', render: r => formatDate(r.issuedOn) },
      { key: 'amount', label: 'Amount paid', align: 'right', render: r => formatMoney(r.amountCents) },
    ]} /></details>
    <WorkflowPlaceholders title="More payment tools" items={[
      { title: 'Record a payment', description: 'Saving a new full or part payment will be available later.' },
      { title: 'Use an advance payment', description: 'You will be able to choose which bill an advance payment pays for.' },
      { title: 'Print or send a receipt', description: 'Making a receipt for a tenant will be added later.' },
      { title: 'Correct a payment', description: 'Corrections will keep the original record and a note explaining the change.' },
    ]} />
  </>
}
