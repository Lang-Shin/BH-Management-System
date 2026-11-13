import { BedDouble, Users, Wallet } from 'lucide-react'
import { PageHeader, PreviewNotice, StatCard } from '@/components/shared/page'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { usePrototype } from '@/state/prototype-context'
import { selectSummary } from '@/state/selectors'
import { formatMoney } from '@/lib/format'

export default function Reports() {
  const { data } = usePrototype()
  const summary = selectSummary(data)
  const collectionRate = summary.billed ? Math.round(summary.collected / summary.billed * 100) : 0
  return <>
    <PageHeader title="Reports" description="Useful questions, clearly answered. A preview of the property insights we can build together." />
    <PreviewNotice>Figures are derived from the same fictional records shown throughout the workspace. Financial reporting, expense tracking, historical trends, and exports will be defined after client feedback.</PreviewNotice>
    <section className="grid gap-4 sm:grid-cols-3" aria-label="Sample report summary"><StatCard label="Usable bed occupancy" value={`${summary.occupancy}%`} detail={`${summary.tenants} residents / ${summary.capacity} usable beds`} icon={BedDouble} /><StatCard label="Active residents" value={summary.tenants} detail="Fictional tenant directory" icon={Users} /><StatCard label="Sample collection rate" value={`${collectionRate}%`} detail="Collected amount / billed amount" icon={Wallet} /></section>
    <div className="mt-6 grid gap-6 md:grid-cols-2"><Card className="shadow-none"><CardHeader><CardTitle>November 2026 overview</CardTitle><CardDescription>Sample billing and collection totals.</CardDescription></CardHeader><CardContent><dl className="divide-y text-sm">{[{ label: 'Total billed', value: summary.billed }, { label: 'Sample collections', value: summary.collected }, { label: 'Outstanding balance', value: summary.outstanding }].map(item => <div key={item.label} className="flex flex-wrap justify-between gap-3 py-4"><dt className="text-muted-foreground">{item.label}</dt><dd className="font-semibold tabular-nums">{formatMoney(item.value)}</dd></div>)}</dl><p className="mt-4 text-xs leading-relaxed text-muted-foreground">Collections are sample rent and utility payments. They do not represent profit or an accounting statement.</p></CardContent></Card>
    <Card className="shadow-none"><CardHeader><CardTitle>Space at a glance</CardTitle><CardDescription>Live summary of the current demo workspace.</CardDescription></CardHeader><CardContent><dl className="divide-y text-sm">{[{ label: 'Rooms', value: data.rooms.length }, { label: 'Rooms under maintenance', value: data.rooms.filter(room => room.status === 'maintenance').length }, { label: 'Usable beds', value: summary.capacity }, { label: 'Available beds', value: summary.availableBeds }].map(item => <div key={item.label} className="flex justify-between gap-3 py-4"><dt className="text-muted-foreground">{item.label}</dt><dd className="font-semibold tabular-nums">{item.value}</dd></div>)}</dl></CardContent></Card></div>
  </>
}
