import { Link } from 'react-router-dom'
import { ArrowRight, Users, BedDouble, Wallet, CircleAlert, DoorOpen, ReceiptText } from 'lucide-react'
import { PageHeader, StatCard } from '@/components/shared/page'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/shared/status-badge'
import { EmptyState } from '@/components/shared/states'
import { usePrototype } from '@/hooks/use-prototype'
import { invoiceBalance, invoiceStatus, selectSummary } from '@/domain/calculations/summary'
import { DEMO_DATE } from '@/data/fixtures/demo'
import { formatMoney } from '@/lib/format'

export default function Dashboard() {
  const { data } = usePrototype()
  const summary = selectSummary(data, DEMO_DATE)
  const outstanding = data.invoices.filter(invoice => invoiceBalance(data, invoice) > 0)
  return <>
    <PageHeader title="A clear view of your boarding house." description="Welcome to Maple House. Here’s a snapshot of the people, spaces, and sample records that keep it running." action={<Button variant="outline" asChild><Link to="/rooms"><DoorOpen />Explore rooms</Link></Button>} />
    <section aria-label="Property overview" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Active tenants" value={summary.tenants} detail="Fictional residents across 8 rooms" icon={Users} />
      <StatCard label="Available beds" value={summary.availableBeds} detail={`${summary.capacity} usable beds · excludes maintenance`} icon={BedDouble} />
      <StatCard label="Sample collections" value={formatMoney(summary.collected)} detail="November 2026 · demonstration figures" icon={Wallet} />
      <StatCard label="Outstanding balance" value={formatMoney(summary.outstanding)} detail={`${summary.overdue} sample invoices past their due date`} icon={CircleAlert} />
    </section>
    <div className="mt-6 grid items-start gap-6 xl:grid-cols-[1.5fr_1fr]">
      <Card className="shadow-none"><CardHeader className="flex-row items-start justify-between gap-3"><div><CardTitle>Room occupancy</CardTitle><CardDescription className="mt-2">A little space to grow.</CardDescription></div><span className="text-2xl font-semibold text-primary">{summary.occupancy}%</span></CardHeader><CardContent>
        <div role="meter" aria-label="Usable bed occupancy" aria-valuemin={0} aria-valuemax={100} aria-valuenow={summary.occupancy} className="h-3 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${summary.occupancy}%` }} /></div>
        <div className="mt-3 flex justify-between text-xs text-muted-foreground"><span>{summary.tenants} occupied beds</span><span>{summary.availableBeds} available beds</span></div>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">{data.rooms.map(room => {
          const count = data.tenants.filter(tenant => tenant.roomId === room.id).length
          return <Link to="/rooms" key={room.id} className="rounded-lg border bg-muted/30 p-3 transition-colors hover:border-primary/50 hover:bg-accent"><DoorOpen className="mb-2 size-4 text-primary" aria-hidden="true" /><p className="text-sm font-semibold">Room {room.name}</p><p className="mt-1 text-xs text-muted-foreground">{room.status === 'maintenance' ? 'Maintenance' : `${count} / ${room.capacity} beds`}</p></Link>
        })}</div>
        <p className="mt-5 text-xs leading-relaxed text-muted-foreground">30 beds in total. Rooms under maintenance are excluded from usable capacity.</p>
      </CardContent></Card>
      <Card className="shadow-none"><CardHeader><CardTitle>Balances to keep an eye on</CardTitle><CardDescription>Sample records as of November 13, 2026.</CardDescription></CardHeader><CardContent>
        {outstanding.length === 0 ? <EmptyState title="All caught up" description="There are no outstanding sample balances." /> : <ul className="divide-y">{outstanding.map(invoice => <li key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0"><div><p className="text-sm font-medium">{data.tenants.find(tenant => tenant.id === invoice.tenantId)?.name}</p><div className="mt-1.5"><StatusBadge status={invoiceStatus(data, invoice, DEMO_DATE)} /></div></div><p className="text-sm font-semibold tabular-nums">{formatMoney(invoiceBalance(data, invoice))}</p></li>)}</ul>}
        <Button variant="outline" className="mt-5 w-full" asChild><Link to="/billing">View sample billing <ArrowRight /></Link></Button>
      </CardContent></Card>
    </div>
    <section className="mt-6 rounded-xl border bg-card p-6 sm:flex sm:items-center sm:justify-between sm:gap-6"><div className="flex items-start gap-4"><span className="rounded-xl bg-accent p-3 text-primary"><ReceiptText className="size-5" aria-hidden="true" /></span><div><h2 className="font-semibold">Your next step: explore the workspace</h2><p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">Browse tenants, save a sample note, or change an empty room’s maintenance status. Your demo changes stay here when you reload.</p></div></div><Button asChild className="mt-5 shrink-0 sm:mt-0"><Link to="/tenants">Meet the tenants <ArrowRight /></Link></Button></section>
  </>
}
