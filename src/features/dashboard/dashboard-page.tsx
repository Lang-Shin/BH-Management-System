import { Link } from 'react-router-dom'
import { CircleAlert, ReceiptText, Wallet, Banknote, ArrowRight } from 'lucide-react'
import { PageHeader, StatCard } from '@/components/shared/page'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/shared/data-table'
import { PaymentHistoryTable } from '@/components/shared/payment-history-table'
import { RoomSummary } from '@/components/shared/room-summary'
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
  const recent = data.payments.filter(p => p.state === 'RECORDED' && p.paidOn <= DEMO_DATE)
    .sort((a, b) => b.paidOn.localeCompare(a.paidOn)).slice(0, 5)

  return <>
    <PageHeader title="Home" description="November 2026 · Your rooms and payments at a glance." action={<Button asChild><Link to="/billing">View bills <ArrowRight /></Link></Button>} />
    <section aria-label="Money overview" className="grid gap-5 sm:grid-cols-2 2xl:grid-cols-4">
      <StatCard label="Rent and bills" value={formatMoney(summary.billed)} detail="Total of November’s bills." icon={ReceiptText} />
      <StatCard label="Already paid" value={formatMoney(summary.applied)} detail="Paid toward November’s bills." icon={Banknote} />
      <StatCard label="Still to pay" value={formatMoney(summary.outstanding)} detail="What tenants still owe for November." icon={CircleAlert} />
      <StatCard label="Money received" value={formatMoney(summary.received)} detail="All payments received during November." icon={Wallet} />
    </section>
    <details className="mt-4 text-sm text-muted-foreground"><summary className="min-h-12 cursor-pointer py-3 font-medium">Why are “Already paid” and “Money received” different?</summary><p className="max-w-3xl pb-3 leading-relaxed">Money received includes payments for older bills and payments made in advance. Already paid counts only the money used to pay November’s bills.</p></details>
    <div className="my-6 grid items-start gap-6 xl:grid-cols-2">
      <Card className="shadow-none"><CardHeader><CardTitle>Rooms at a glance</CardTitle><CardDescription>See which rooms are rented or ready for a tenant.</CardDescription></CardHeader><CardContent><RoomSummary summary={summary} /><Button variant="outline" className="mt-6" asChild><Link to="/rooms">View rooms <ArrowRight /></Link></Button></CardContent></Card>
      <Card className="shadow-none"><CardHeader><CardTitle>Bill payments</CardTitle><CardDescription>Rent, electricity, water, and washing are counted separately.</CardDescription></CardHeader><CardContent>
        <dl className="grid grid-cols-3 gap-3">{[{ label: 'Paid', value: summary.paid }, { label: 'Partly paid', value: summary.partial }, { label: 'Not yet paid', value: summary.unpaid }].map(item => <div key={item.label} className="rounded-lg bg-muted px-2 py-4 text-center"><dt className="text-sm text-muted-foreground">{item.label}</dt><dd className="mt-2 text-2xl font-semibold">{item.value}</dd></div>)}</dl>
        <p className="mt-5 text-base">{summary.overdue} bills are past their due date.</p><p className="mt-3 text-sm text-muted-foreground">Advance payments kept for later: <strong className="text-foreground">{formatMoney(summary.credit)}</strong>.</p>
      </CardContent></Card>
    </div>
    <section aria-labelledby="recent-payments"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 id="recent-payments" className="text-xl font-semibold">Recent payments</h2><Button variant="outline" asChild><Link to="/payments">View all payments <ArrowRight /></Link></Button></div><PaymentHistoryTable data={data} payments={recent} compact caption="Recent payments" /></section>
    <section aria-labelledby="upcoming-dues" className="mt-8"><h2 id="upcoming-dues" className="mb-2 text-xl font-semibold">Bills due soon</h2><p className="mb-4 text-base text-muted-foreground">The next {Math.min(6, upcoming.length)} bills to check. Fully paid bills are not shown.</p><DataTable rows={upcoming.slice(0, 6)} caption="Bills due soon" columns={[
      { key: 'tenant', label: 'Tenant', render: c => data.tenants.find(t => t.id === c.tenantId)?.name },
      { key: 'category', label: 'Bill for', render: c => CATEGORY_LABELS[c.category] },
      { key: 'due', label: 'Pay by', render: c => formatDate(c.dueDate) },
      { key: 'balance', label: 'Still to pay', render: c => formatMoney(chargeBalance(data, c, DEMO_DATE)) },
    ]} /></section>
  </>
}
