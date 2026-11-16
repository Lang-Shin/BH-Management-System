import type { selectRoomSummary, selectSummary } from '@/domain/calculations/summary'
import { AnimatedNumber } from '@/components/shared/animated-number'

type Segment = { label: string; value: number; color: string }
const percentage = (value: number, total: number) => total > 0 ? value / total * 100 : 0

function AnalyticsLegend({ segments, total }: { segments: Segment[]; total: number }) {
  return <dl className="min-w-0 flex-1 divide-y">
    {segments.map(segment => <div key={segment.label} className="flex items-center justify-between gap-3 py-3">
      <dt className="flex items-center gap-2 text-sm"><span aria-hidden="true" className="size-2.5 shrink-0 rounded-sm" style={{ background: segment.color }} />{segment.label}</dt>
      <dd className="whitespace-nowrap text-sm tabular-nums"><strong className="font-bold"><AnimatedNumber value={segment.value} /></strong><span className="ml-2 text-muted-foreground">(<AnimatedNumber value={`${percentage(segment.value, total).toFixed(1)}%`} />)</span></dd>
    </div>)}
  </dl>
}

export function RoomOccupancyChart({ summary }: { summary: ReturnType<typeof selectRoomSummary> }) {
  const segments: Segment[] = [
    { label: 'Occupied', value: summary.occupiedRooms, color: 'var(--forest-green)' },
    { label: 'Available', value: summary.availableRooms, color: '#7c9770' },
    { label: 'Under repair', value: summary.maintenanceRooms, color: 'var(--tomato-red)' },
  ]
  let offset = 0

  return <figure aria-label="Room occupancy analytics" className="m-0">
    <div className="flex flex-col items-center gap-5 min-[440px]:flex-row">
      <div className="relative size-44 shrink-0 sm:size-48">
        <svg viewBox="0 0 200 200" aria-hidden="true" className="size-full -rotate-90">
          <circle cx="100" cy="100" r="80" fill="none" stroke="var(--border)" strokeWidth="22" />
          {segments.map(segment => {
            const length = percentage(segment.value, summary.totalRooms)
            const start = offset
            offset += length
            return segment.value > 0 && <circle key={segment.label} className="analytics-doughnut-segment" cx="100" cy="100" r="80" pathLength="100" fill="none" stroke={segment.color} strokeWidth="22" strokeDasharray={`${length} ${100 - length}`} strokeDashoffset={-start} />
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <strong className="text-3xl font-bold tracking-tight tabular-nums"><AnimatedNumber value={`${percentage(summary.occupiedRooms, summary.totalRooms).toFixed(0)}%`} /></strong>
          <span className="text-sm text-muted-foreground">occupied</span>
        </div>
      </div>
      <AnalyticsLegend segments={segments} total={summary.totalRooms} />
    </div>
    <figcaption className="mt-4 text-sm text-muted-foreground">{summary.totalRooms > 0 ? <><AnimatedNumber value={summary.occupiedRooms} /> of <AnimatedNumber value={summary.totalRooms} /> rooms occupied · <AnimatedNumber value={summary.availableRooms} /> ready to rent</> : 'No rooms recorded yet.'}</figcaption>
  </figure>
}

export function BillPaymentChart({ summary }: { summary: ReturnType<typeof selectSummary> }) {
  const segments: Segment[] = [
    { label: 'Paid', value: summary.paid, color: 'var(--forest-green)' },
    { label: 'Partly paid', value: summary.partial, color: '#b67c22' },
    { label: 'Not yet paid', value: summary.unpaid, color: 'var(--tomato-red)' },
  ]
  const total = summary.paid + summary.partial + summary.unpaid

  return <figure aria-label="Bill payment analytics" className="m-0">
    <div className="mb-5 flex items-baseline gap-2"><strong className="text-3xl font-bold tracking-tight tabular-nums"><AnimatedNumber value={`${percentage(summary.paid, total).toFixed(0)}%`} /></strong><span className="text-sm text-muted-foreground">of bills fully paid</span></div>
    <div aria-hidden="true" className="overflow-hidden rounded-full bg-muted">
      <div className="analytics-payment-bar flex h-4">
        {segments.map(segment => <span key={segment.label} style={{ width: `${percentage(segment.value, total)}%`, background: segment.color }} />)}
      </div>
    </div>
    <AnalyticsLegend segments={segments} total={total} />
    <figcaption className="mt-3 text-sm text-muted-foreground">{total > 0 ? <><AnimatedNumber value={total} /> issued bills this month · counts, not payment amounts{summary.unresolved > 0 ? ` · plus ${summary.unresolved} electricity ${summary.unresolved === 1 ? 'bill' : 'bills'} awaiting a reading` : ''}</> : summary.unresolved > 0 ? `${summary.unresolved} electricity ${summary.unresolved === 1 ? 'bill is' : 'bills are'} awaiting a meter reading.` : 'No issued bills for this month.'}</figcaption>
  </figure>
}
