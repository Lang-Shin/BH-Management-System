import { Link } from 'react-router-dom'
import { CircleAlert, ReceiptText, TrendingUp, Banknote, ArrowRight } from 'lucide-react'
import { PageHeader, StatCard } from '@/components/shared/page'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/shared/data-table'
import { PaymentHistoryTable } from '@/components/shared/payment-history-table'
import { RoomSummary } from '@/components/shared/room-summary'
import { StatusBadge } from '@/components/shared/status-badge'
import { usePrototype } from '@/hooks/use-prototype'
import { chargeBalance, chargeStatus, issuedCharges, selectSummary, tenantAccount } from '@/domain/calculations/summary'
import { DEMO_DATE, DEMO_PERIOD } from '@/data/fixtures/demo'
import { formatDate, formatMoney } from '@/lib/format'
import { CATEGORY_LABELS, CHARGE_STATUS_LABELS } from '@/lib/labels'

export default function Dashboard() {
  const { data } = usePrototype()
  const summary = selectSummary(data, DEMO_DATE, DEMO_PERIOD)
  const upcoming = issuedCharges(data, DEMO_DATE).filter(c => c.dueDate >= DEMO_DATE && chargeBalance(data, c, DEMO_DATE) > 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  const recent = data.payments.filter(p => p.state === 'RECORDED' && p.paidOn <= DEMO_DATE)
    .sort((a, b) => b.paidOn.localeCompare(a.paidOn)).slice(0, 5)
  const collectionRate = summary.billed > 0 ? summary.applied / summary.billed * 100 : 0
  const balances = data.tenants.map(tenant => ({ ...tenant, account: tenantAccount(data, tenant.id, DEMO_DATE) }))
    .filter(tenant => tenant.account.balance > 0).sort((a, b) => b.account.balance - a.account.balance).slice(0, 4)

  return <>
    <PageHeader title="Overview" description="November 2026 · Your rooms and payments at a glance." action={<Button asChild><Link to="/billing">View billing <ArrowRight /></Link></Button>} />
    <section aria-label="Money overview" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Total billed" value={formatMoney(summary.billed)} detail="November’s issued bills." icon={ReceiptText} />
      <StatCard label="Total collected" value={formatMoney(summary.applied)} detail="Already paid toward November’s bills." icon={Banknote} />
      <StatCard label="Total outstanding" value={formatMoney(summary.outstanding)} detail="Still to pay for November." icon={CircleAlert} />
      <StatCard label="Collection rate" value={`${collectionRate.toFixed(1)}%`} detail="Collected ÷ billed for November." icon={TrendingUp} />
    </section>
    <details className="mt-3 text-sm text-muted-foreground"><summary className="min-h-12 cursor-pointer py-3 font-medium">How are collections counted?</summary><p className="max-w-3xl pb-3 leading-relaxed">Total collected is the money allocated to November’s bills. Money received during November is {formatMoney(summary.received)} and can include older bills or advance payments. Collection rate uses allocated payments, so these measures can differ.</p></details>
    <div className="my-6 grid items-start gap-6 xl:grid-cols-2">
      <Card className="shadow-none"><CardHeader><CardTitle>Rooms at a glance</CardTitle><CardDescription>See which rooms are rented or ready for a tenant.</CardDescription></CardHeader><CardContent><RoomSummary summary={summary} /><Button variant="outline" className="mt-6" asChild><Link to="/rooms">View rooms <ArrowRight /></Link></Button></CardContent></Card>
      <Card className="shadow-none"><CardHeader><CardTitle>Bill payments</CardTitle><CardDescription>Rent, electricity, water, and washing are counted separately.</CardDescription></CardHeader><CardContent>
        <dl className="grid grid-cols-3 gap-3">{[{ label: 'Paid', value: summary.paid }, { label: 'Partly paid', value: summary.partial }, { label: 'Not yet paid', value: summary.unpaid }].map(item => <div key={item.label} className="rounded-lg bg-muted px-2 py-4 text-center"><dt className="text-sm text-muted-foreground">{item.label}</dt><dd className="mt-2 text-2xl font-semibold">{item.value}</dd></div>)}</dl>
        <p className="mt-5 text-base">{summary.overdue} bills are past their due date.</p><p className="mt-3 text-sm text-muted-foreground">Advance payments kept for later: <strong className="text-foreground">{formatMoney(summary.credit)}</strong>.</p>
      </CardContent></Card>
    </div>
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
    <section aria-labelledby="recent-payments"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 id="recent-payments" className="text-lg font-bold">Recent payments</h2><Button variant="ghost" asChild><Link to="/payments">View all <ArrowRight /></Link></Button></div><PaymentHistoryTable data={data} payments={recent} compact caption="Recent payments" /></section>
    <Card><CardHeader><CardTitle>Outstanding balances</CardTitle><CardDescription>Largest tenant balances · all issued bills</CardDescription></CardHeader><CardContent><ul className="divide-y">{balances.map(tenant => <li key={tenant.id} className="flex flex-wrap items-center justify-between gap-2 py-3"><div><p className="text-sm font-semibold">{tenant.name}</p><p className="mt-1 text-xs text-muted-foreground">{tenant.account.status === 'Overdue' ? 'Includes overdue bills' : 'Payment pending'}</p></div><p className="text-sm font-bold tabular-nums">{formatMoney(tenant.account.balance)}</p></li>)}</ul>{balances.length === 0 && <p className="text-sm text-muted-foreground">No outstanding balances.</p>}</CardContent></Card>
    </div>
    <section aria-labelledby="upcoming-dues" className="mt-8"><h2 id="upcoming-dues" className="mb-2 text-lg font-bold">Upcoming due dates</h2><p className="mb-4 text-sm text-muted-foreground">The next {Math.min(6, upcoming.length)} bills to check. Fully paid bills are not shown.</p><DataTable rows={upcoming.slice(0, 6)} caption="Bills due soon" columns={[
      { key: 'tenant', label: 'Tenant', render: c => data.tenants.find(t => t.id === c.tenantId)?.name },
      { key: 'category', label: 'Bill for', render: c => CATEGORY_LABELS[c.category] },
      { key: 'due', label: 'Pay by', render: c => formatDate(c.dueDate) },
      { key: 'balance', label: 'Outstanding', align: 'right', render: c => formatMoney(chargeBalance(data, c, DEMO_DATE)) },
      { key: 'status', label: 'Status', render: c => <StatusBadge status={CHARGE_STATUS_LABELS[chargeStatus(data, c, DEMO_DATE)]} /> },
    ]} /></section>
  </>
}
