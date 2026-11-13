import { ReceiptText, Wallet, CircleAlert } from 'lucide-react'
import { PageHeader, PreviewNotice, StatCard } from '@/components/shared/page'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DataTable } from '@/components/shared/data-table'
import { WorkflowPlaceholders } from '@/components/shared/workflow-placeholders'
import { usePrototype } from '@/hooks/use-prototype'
import { selectSummary } from '@/domain/calculations/summary'
import { DEMO_DATE, DEMO_PERIOD } from '@/data/fixtures/demo'
import { formatDate, formatMoney } from '@/lib/format'

export default function Reports() {
  const { data } = usePrototype()
  const summary = selectSummary(data, DEMO_DATE, DEMO_PERIOD)
  const periods = data.billingPeriods.map(period => ({ ...period, summary: selectSummary(data, DEMO_DATE, period.id) }))
  const currentRate = [...data.electricityRates].filter(r => r.effectiveFrom <= DEMO_DATE).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]

  return <>
    <PageHeader title="Reports & Settings" description="Sample collection reports, unconfirmed billing policies, audit visibility, and clearly scoped export and recovery foundations." />
    <PreviewNotice>Reports are derived from shared fictional records as of {formatDate(DEMO_DATE)}. They are not profit reports or accounting statements. Settings are read-only.</PreviewNotice>
    <section className="grid gap-4 sm:grid-cols-3" aria-label="Sample report summary"><StatCard label="November cash received" value={formatMoney(summary.received)} detail="Received during the sample date range" icon={Wallet} /><StatCard label="Applied to November charges" value={formatMoney(summary.applied)} detail="Allocations against this period’s issued charges" icon={ReceiptText} /><StatCard label="November outstanding" value={formatMoney(summary.outstanding)} detail="Billed less allocated; credit remains separate" icon={CircleAlert} /></section>
    <section className="mt-7" aria-labelledby="monthly-reports"><h2 id="monthly-reports" className="mb-2 text-lg font-semibold">Monthly collection report foundations</h2><p className="mb-4 text-sm leading-relaxed text-muted-foreground">Sample calendar months illustrate reporting only. “Received in date range” includes advances and payments for earlier periods; “Applied to period charges” tracks the selected charges regardless of payment month.</p><DataTable rows={periods} caption="Fictional collection report by sample period" columns={[
      { key: 'period', label: 'Sample period', render: p => p.label },
      { key: 'billed', label: 'Period charges', render: p => formatMoney(p.summary.billed) },
      { key: 'received', label: 'Received in date range', render: p => formatMoney(p.summary.received) },
      { key: 'applied', label: 'Applied to period charges', render: p => formatMoney(p.summary.applied) },
      { key: 'balance', label: 'Period outstanding', render: p => formatMoney(p.summary.outstanding) },
    ]} /></section>
    <Card className="mt-7 shadow-none"><CardHeader><CardTitle>Billing settings foundations</CardTitle><CardDescription>Confirmed entry methods and policies awaiting landlord confirmation.</CardDescription></CardHeader><CardContent><dl className="grid gap-5 text-sm sm:grid-cols-2 lg:grid-cols-3">{[
      ['Currency', 'PHP · amounts stored in integer centavos'],
      ['Rent', 'Agreed amount preserved on each issued rent charge'],
      ['Billing-cycle policy', 'Unconfirmed · sample periods are illustrative'],
      ['Electricity rate example', currentRate ? `${formatMoney(currentRate.rateCentsPerKwh)} / kWh, effective ${formatDate(currentRate.effectiveFrom)}` : 'No effective sample rate'],
      ['Meter ownership / shared allocation', 'Both unconfirmed · no allocation rule is assumed'],
      ['Water and washing machine', 'Manually entered per tenant; washing charge optional'],
    ].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 leading-relaxed font-medium">{value}</dd></div>)}</dl></CardContent></Card>
    <section className="mt-7" aria-labelledby="audit-log"><h2 id="audit-log" className="mb-2 text-lg font-semibold">Admin audit log foundation</h2><p className="mb-4 text-sm text-muted-foreground">Read-only seeded events. The demo actor label is not authenticated; production authorization and correction workflows are not implemented.</p><DataTable rows={data.auditEvents} caption="Fictional administrator audit events" columns={[
      { key: 'date', label: 'Date', render: a => formatDate(a.occurredOn) },
      { key: 'actor', label: 'Demo actor', render: a => a.actorId },
      { key: 'action', label: 'Action', render: a => a.action },
      { key: 'entity', label: 'Entity', render: a => a.entityId },
      { key: 'reason', label: 'Reason', render: a => <span className="inline-block max-w-sm whitespace-normal leading-relaxed">{a.reason}</span> },
    ]} /></section>
    <WorkflowPlaceholders title="Reporting and recovery foundations" items={[
      { title: 'Export records', description: 'CSV/PDF export, export history, and scope selection are prototype placeholders. No file export is performed.' },
      { title: 'Billing settings editing', description: 'Rate configuration, billing-cycle decisions, and allocation settings require confirmed requirements before implementation.' },
      { title: 'Admin audit log and authorized corrections', description: 'Future audit events must retain actor references, reasons, dates, and before/after snapshots. The seeded event is not a production audit trail.' },
      { title: 'Backup and recovery', description: 'Backup export, restore, scheduling, and integrity checks are not implemented. Browser localStorage is demo persistence, not a backup. Reset demo only restores the original fixtures.' },
    ]} />
  </>
}
