import { ReceiptText, Wallet, CircleAlert } from 'lucide-react'
import { PageHeader, PreviewNotice, StatCard } from '@/components/shared/page'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DataTable } from '@/components/shared/data-table'
import { WorkflowPlaceholders } from '@/components/shared/workflow-placeholders'
import { ResetDemoButton } from '@/components/shared/reset-demo-button'
import { usePrototype } from '@/hooks/use-prototype'
import { selectSummary } from '@/domain/calculations/summary'
import { DEMO_DATE, DEMO_PERIOD } from '@/data/fixtures/demo'
import { formatDate, formatMoney } from '@/lib/format'
import type { AuditEvent } from '@/domain/types/models'

const changeLabels: Record<AuditEvent['action'], string> = {
  DEMO_SEEDED: 'Sample records added', READING_CORRECTED: 'Meter reading corrected', CHARGE_CORRECTED: 'Bill corrected',
  PAYMENT_CORRECTED: 'Payment corrected', ALLOCATION_REVERSED: 'Payment removed from a bill',
}

export default function Reports() {
  const { data, storageWarning } = usePrototype()
  const summary = selectSummary(data, DEMO_DATE, DEMO_PERIOD)
  const periods = data.billingPeriods.map(period => ({ ...period, summary: selectSummary(data, DEMO_DATE, period.id) }))
  const currentRate = [...data.electricityRates].filter(r => r.effectiveFrom <= DEMO_DATE).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]

  return <>
    <PageHeader title="Reports & Settings" description="See your monthly totals and find the house settings." />
    <PreviewNotice>The amounts shown here are for trying the app, not your actual earnings.</PreviewNotice>
    <section className="grid gap-5 xl:grid-cols-3" aria-label="Monthly money overview">
      <StatCard label="Money received" value={formatMoney(summary.received)} detail="All payments received in November." icon={Wallet} />
      <StatCard label="Already paid" value={formatMoney(summary.applied)} detail="Paid toward November’s bills." icon={ReceiptText} />
      <StatCard label="Still to pay" value={formatMoney(summary.outstanding)} detail="What tenants still owe for November." icon={CircleAlert} />
    </section>
    <section className="mt-8" aria-labelledby="monthly-reports"><h2 id="monthly-reports" className="mb-2 text-xl font-semibold">Monthly summary</h2><p className="mb-5 text-base text-muted-foreground">Money received may include payments for older bills or money paid in advance.</p><DataTable rows={periods} caption="Monthly summary" columns={[
      { key: 'period', label: 'Month', render: p => p.label },
      { key: 'billed', label: 'Total bills', align: 'right', render: p => formatMoney(p.summary.billed) },
      { key: 'applied', label: 'Paid for these bills', align: 'right', render: p => formatMoney(p.summary.applied) },
      { key: 'balance', label: 'Still to pay', align: 'right', render: p => formatMoney(p.summary.outstanding) },
      { key: 'received', label: 'Money received', align: 'right', render: p => formatMoney(p.summary.received) },
    ]} /></section>
    <Card className="mt-8 shadow-none"><CardHeader><CardTitle>House settings</CardTitle><CardDescription>You can view these settings. Changing them will be added later.</CardDescription></CardHeader><CardContent><dl className="grid gap-6 text-base sm:grid-cols-2">{[
      ['Currency', 'Philippine peso (₱)'],
      ['Rent', 'Based on the agreed rent for each tenant'],
      ['When rent is due', 'To be confirmed'],
      ['Electricity price', currentRate ? `${formatMoney(currentRate.rateCentsPerKwh)} per kWh, starting ${formatDate(currentRate.effectiveFrom)}` : 'No price set'],
      ['Sharing the electricity bill', 'Who uses each meter and how to share the bill still need to be agreed'],
      ['Water and washing', 'Water amounts are entered by hand. Washing is an optional extra bill.'],
    ].map(([label, value]) => <div key={label} className="rounded-lg border bg-muted/40 p-4"><dt className="text-xs font-semibold text-muted-foreground">{label}</dt><dd className="mt-2 text-sm leading-relaxed font-medium">{value}</dd></div>)}</dl></CardContent></Card>
    <details open={Boolean(storageWarning)} className="mt-7 rounded-xl border bg-card p-5 sm:p-6"><summary className="min-h-12 cursor-pointer py-2 text-lg font-semibold">More settings and sample records</summary>
      <section className="mt-5" aria-labelledby="sample-records"><h2 id="sample-records" className="mb-3 text-xl font-semibold">Start again with sample records</h2><p className="mb-5 max-w-2xl text-base text-muted-foreground">Restore the original sample records and remove your saved notes and room changes. This is only for trying the app.</p><ResetDemoButton /></section>
      <section className="mt-7" aria-labelledby="audit-log"><h2 id="audit-log" className="mb-3 text-xl font-semibold">Record of changes</h2><DataTable rows={data.auditEvents} caption="Record of changes" columns={[
        { key: 'date', label: 'Date', render: a => formatDate(a.occurredOn) },
        { key: 'action', label: 'What changed', render: a => changeLabels[a.action] },
        { key: 'reason', label: 'Note', render: a => <span className="inline-block max-w-sm whitespace-normal leading-relaxed">{a.action === 'DEMO_SEEDED' ? 'Sample records were added so you can try the screens.' : a.reason}</span> },
      ]} /></section>
      <p className="mt-5 text-sm text-muted-foreground">Your changes are saved only in this browser. This is not a backup.</p>
    </details>
    <WorkflowPlaceholders title="More report tools" items={[
      { title: 'Print or save a report', description: 'Downloading or printing reports will be available later.' },
      { title: 'Save a backup', description: 'Making a backup copy and bringing back saved records will be added later.' },
    ]} />
  </>
}
