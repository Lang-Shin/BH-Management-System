import { Link } from 'react-router-dom'
import { CircleAlert, ReceiptText, Wallet, Banknote, ArrowRight } from 'lucide-react'
import { PageHeader, StatCard } from '@/components/shared/page'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/shared/data-table'
import { PaymentHistoryTable } from '@/components/shared/payment-history-table'
import { usePrototype } from '@/hooks/use-prototype'
import { chargeBalance, issuedCharges, selectSummary } from '@/domain/calculations/summary'
import { DEMO_DATE, DEMO_PERIOD } from '@/data/fixtures/demo'
import { formatDate, formatMoney } from '@/lib/format'
import { CATEGORY_LABELS } from '@/lib/labels'

export default function Dashboard() {
  const { data } = usePrototype()
  const summary = selectSummary(data, DEMO_DATE, DEMO_PERIOD)
  const upcoming = issuedCharges(data, DEMO_DATE).filter(c => c.dueDate >= DEMO_DATE && chargeBalance(data, c, DEMO_DATE) > 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  const recent = data.payments.filter(p => p.state === 'RECORDED' && p.paidOn <= DEMO_DATE).sort((a, b) => b.paidOn.localeCompare(a.paidOn)).slice(0, 5)

  return <>
    <PageHeader title="A clear view of your boarding house." description="Fictional November 2026 overview, as of November 13. All figures come from the shared charges, payments, and allocations." />
    <section aria-label="Financial overview" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="November charges" value={formatMoney(summary.billed)} detail="Issued charges for the sample billing period" icon={ReceiptText} />
      <StatCard label="Applied to November charges" value={formatMoney(summary.applied)} detail="Explicit allocations; excludes unapplied advances" icon={Banknote} />
      <StatCard label="Cash received in November" value={formatMoney(summary.received)} detail="Includes prior-period payments and advances" icon={Wallet} />
      <StatCard label="November outstanding" value={formatMoney(summary.outstanding)} detail={`${summary.overdue} overdue charges · remaining due dates below`} icon={CircleAlert} />
    </section>
    <div className="my-6 grid gap-6 md:grid-cols-2">
      <Card className="shadow-none"><CardHeader><CardTitle>Payment status summary</CardTitle><CardDescription>Per-category charge status, derived from allocations.</CardDescription></CardHeader><CardContent><dl className="grid grid-cols-3 gap-3 text-center">{[{ label: 'Paid', value: summary.paid }, { label: 'Partially paid', value: summary.partial }, { label: 'Unpaid', value: summary.unpaid }].map(item => <div key={item.label} className="rounded-lg bg-muted p-3"><dt className="text-xs text-muted-foreground">{item.label}</dt><dd className="mt-2 text-2xl font-semibold">{item.value}</dd></div>)}</dl><p className="mt-4 text-sm text-muted-foreground">Unapplied tenant credit: <strong className="text-foreground">{formatMoney(summary.credit)}</strong>. Credit does not automatically settle a charge.</p></CardContent></Card>
      <Card className="shadow-none"><CardHeader><CardTitle>Property occupancy</CardTitle><CardDescription>{summary.tenants} active fictional tenants · {data.tenants.filter(t => t.status === 'MOVED_OUT').length} moved-out example</CardDescription></CardHeader><CardContent><p className="text-3xl font-semibold text-primary">{summary.occupancy}%</p><p className="mt-3 text-sm text-muted-foreground">{summary.occupiedBeds} occupied / {summary.capacity} usable beds · {summary.availableBeds} available. Maintenance rooms are excluded.</p><Button variant="outline" className="mt-5" asChild><Link to="/rooms">Explore rooms <ArrowRight /></Link></Button></CardContent></Card>
    </div>
    <section aria-labelledby="recent-payments"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 id="recent-payments" className="text-lg font-semibold">Recent payments</h2><Button variant="outline" asChild><Link to="/payments">All sample payments <ArrowRight /></Link></Button></div><PaymentHistoryTable data={data} payments={recent} caption="Five most recent fictional payments" /></section>
    <section aria-labelledby="upcoming-dues" className="mt-7"><h2 id="upcoming-dues" className="mb-2 text-lg font-semibold">Upcoming due dates</h2><p className="mb-4 text-sm text-muted-foreground">Next {Math.min(6, upcoming.length)} of {upcoming.length} outstanding sample charges due on or after {formatDate(DEMO_DATE)}.</p><DataTable rows={upcoming.slice(0, 6)} caption="Upcoming fictional charge due dates" columns={[
      { key: 'tenant', label: 'Tenant', render: c => data.tenants.find(t => t.id === c.tenantId)?.name },
      { key: 'category', label: 'Category', render: c => CATEGORY_LABELS[c.category] },
      { key: 'due', label: 'Due date', render: c => formatDate(c.dueDate) },
      { key: 'balance', label: 'Outstanding', render: c => formatMoney(chargeBalance(data, c, DEMO_DATE)) },
    ]} /></section>
  </>
}
