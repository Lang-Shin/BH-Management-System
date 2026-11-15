import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Banknote, ChevronRight, CircleAlert, ReceiptText, TrendingUp } from 'lucide-react'
import { PageHeader, StatCard } from '@/components/shared/page'
import { AnimatedNumber } from '@/components/shared/animated-number'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/shared/data-table'
import { PaymentHistoryTable } from '@/components/shared/payment-history-table'
import { BillPaymentChart, RoomOccupancyChart } from './dashboard-analytics'
import { StatusBadge } from '@/components/shared/status-badge'
import { usePrototype } from '@/hooks/use-prototype'
import { selectSummary } from '@/domain/calculations/summary'
import { selectRoomDues, selectRoomFinance } from '@/domain/calculations/room-finance'
import { OutstandingBalances } from './outstanding-balances'
import { PendingPaymentsDialog } from './pending-payments-dialog'
import { DEMO_DATE, DEMO_PERIOD } from '@/data/fixtures/demo'
import { formatMoney } from '@/lib/format'
import { CHARGE_STATUS_LABELS } from '@/lib/labels'

export default function Dashboard() {
  const { data } = usePrototype()
  const summary = selectSummary(data, DEMO_DATE, DEMO_PERIOD)
  const upcoming = selectRoomDues(data, DEMO_DATE)
  const rooms = selectRoomFinance(data, DEMO_DATE)
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null)
  const billTrigger = useRef<HTMLButtonElement | null>(null)
  const selectedRoom = rooms.find(room => room.id === selectedRoomId)
  const recent = data.payments.filter(p => p.state === 'RECORDED' && p.paidOn <= DEMO_DATE)
    .sort((a, b) => b.paidOn.localeCompare(a.paidOn)).slice(0, 5)
  const collectionRate = summary.billed > 0 ? summary.applied / summary.billed * 100 : 0

  return <>
    <PageHeader title="Overview" description="November 2026 · Your rooms and payments at a glance." action={<Button asChild><Link to="/billing">View billing <ArrowRight /></Link></Button>} />
    <section aria-label="Money overview" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Total billed" value={formatMoney(summary.billed)} detail="November’s issued bills." icon={ReceiptText} />
      <StatCard label="Total collected" value={formatMoney(summary.applied)} detail="Already paid toward November’s bills." icon={Banknote} />
      <StatCard label="Total outstanding" value={formatMoney(summary.outstanding)} detail="Still to pay for November." icon={CircleAlert} />
      <StatCard label="Collection rate" value={`${collectionRate.toFixed(1)}%`} detail="Collected ÷ billed for November." icon={TrendingUp} />
    </section>
    <div className="my-6 grid items-start gap-6 xl:grid-cols-2">
      <Card><CardHeader><CardTitle>Rooms at a glance</CardTitle><CardDescription>Occupancy across your boarding house.</CardDescription></CardHeader><CardContent><RoomOccupancyChart summary={summary} /><Button variant="outline" className="mt-6" asChild><Link to="/rooms">View rooms <ArrowRight /></Link></Button></CardContent></Card>
      <Card><CardHeader><CardTitle>Bill payments</CardTitle><CardDescription>Rent, electricity, water, and washing are counted separately.</CardDescription></CardHeader><CardContent>
        <BillPaymentChart summary={summary} />
        <p className="mt-5 text-base"><AnimatedNumber value={summary.overdue} /> bills are past their due date.</p><p className="mt-3 text-sm text-muted-foreground">Advance payments kept for later: <strong className="text-foreground"><AnimatedNumber value={formatMoney(summary.credit)} /></strong>.</p>
      </CardContent></Card>
    </div>
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
    <section aria-labelledby="recent-payments"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 id="recent-payments" className="text-lg font-bold">Recent payments</h2><Button variant="ghost" asChild><Link to="/payments">View all <ArrowRight /></Link></Button></div><PaymentHistoryTable data={data} payments={recent} compact transactionDisplay="categories" caption="Recent payments" /></section>
    <OutstandingBalances data={data} asOf={DEMO_DATE} />
    </div>
    <section aria-labelledby="upcoming-dues" className="mt-8"><h2 id="upcoming-dues" className="mb-2 text-lg font-bold">Upcoming due dates</h2><p className="mb-4 text-sm text-muted-foreground">The next <AnimatedNumber value={Math.min(6, upcoming.length)} /> room due-date groups to check. Choose <strong className="font-semibold text-foreground">Show Bill</strong> to see every pending month and category for that room.</p><DataTable rows={upcoming.slice(0, 6)} caption="Bills due soon" columns={[
      { key: 'room', label: 'Room', render: c => <span className="font-semibold">{c.context.label}</span> },
      { key: 'bill', label: 'Bill for', render: c => <button type="button" className="upcoming-bill-button" aria-label={`Show Bill for ${c.context.label}`} onClick={event => { billTrigger.current = event.currentTarget; setSelectedRoomId(c.context.id) }}><span className="animated-forest-underline">Show Bill</span><ChevronRight aria-hidden="true" /></button> },
      { key: 'period', label: 'Month', render: c => data.billingPeriods.find(period => period.id === c.periodId)?.label },
      { key: 'balance', label: 'Outstanding', align: 'right', render: c => formatMoney(c.outstanding) },
      { key: 'status', label: 'Status', render: c => <StatusBadge status={CHARGE_STATUS_LABELS[c.status]} /> },
    ]} /></section>
    {selectedRoom && <PendingPaymentsDialog key={selectedRoom.id} data={data} room={selectedRoom} asOf={DEMO_DATE} onClose={() => setSelectedRoomId(null)} onReturnFocus={() => billTrigger.current?.focus()} />}
  </>
}
