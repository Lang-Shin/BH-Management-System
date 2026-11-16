import { useEffect, useRef, useState } from 'react'
import { AnimatedNumber } from '@/components/shared/animated-number'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { billingStatusCounts, type BillingRoom } from './billing-room-status'

export function BillingStatusChart({ rooms, periodLabel, outstandingOnly }: { rooms: BillingRoom[]; periodLabel: string; outstandingOnly: boolean }) {
  const figureRef = useRef<HTMLElement>(null)
  const [revealed, setRevealed] = useState(() => typeof IntersectionObserver !== 'function')
  useEffect(() => {
    const figure = figureRef.current
    if (!figure || typeof IntersectionObserver !== 'function') return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setRevealed(true)
        observer.disconnect()
      }
    }, { threshold: 0.1 })
    observer.observe(figure)
    return () => observer.disconnect()
  }, [])
  const counts = billingStatusCounts(rooms)
  const percentage = (value: number) => counts.total > 0 ? value / counts.total * 100 : 0
  const segments = [
    { label: 'PAID', value: counts.paid, color: 'var(--forest-green)' },
    { label: 'PARTLY PAID', value: counts.partlyPaid, color: '#7c9770' },
    { label: 'NOT YET PAID', value: counts.notPaid, color: 'var(--tomato-red)' },
  ]

  return <Card className="mb-7">
    <CardHeader><CardTitle>Billing status at a glance</CardTitle><CardDescription>{periodLabel} · {outstandingOnly ? 'Rooms with unpaid bills' : 'All billed rooms'} · Matches the table’s Status column.</CardDescription></CardHeader>
    <CardContent>
      <figure ref={figureRef} className="billing-room-status-chart m-0" data-revealed={revealed} aria-label="Billing room payment status">
        <div key={segments.map(segment => segment.value).join(':')} className="flex flex-col items-center gap-6 sm:flex-row sm:gap-8">
          <div className="relative size-48 shrink-0 sm:size-52">
            <svg className="size-full -rotate-90" viewBox="0 0 200 200" aria-hidden="true">
              <circle cx="100" cy="100" r="80" fill="none" stroke="var(--border)" strokeWidth="22" />
              {segments.map((segment, index) => {
                const length = percentage(segment.value)
                const start = percentage(segments.slice(0, index).reduce((sum, previous) => sum + previous.value, 0))
                return segment.value > 0 && <circle key={segment.label} className="billing-status-doughnut-segment" cx="100" cy="100" r="80" pathLength="100" fill="none" stroke={segment.color} strokeWidth="22" strokeDasharray={`${length} ${100 - length}`} strokeDashoffset={-start} />
              })}
            </svg>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <strong className="text-3xl font-bold tracking-tight tabular-nums"><AnimatedNumber value={`${percentage(counts.paid).toFixed(0)}%`} /></strong>
              <span className="text-sm text-muted-foreground">fully paid</span>
            </div>
          </div>
          <dl className="w-full min-w-0 flex-1 divide-y" aria-label="Room payment status counts">
            {segments.map(segment => <div key={segment.label} className="flex items-center justify-between gap-3 py-4">
              <dt className="flex items-center gap-2 text-sm font-semibold"><span className="size-3 shrink-0 rounded-full" style={{ background: segment.color }} aria-hidden="true" />{segment.label}</dt>
              <dd className="whitespace-nowrap text-sm tabular-nums"><strong><AnimatedNumber value={segment.value} /></strong><span className="ml-2 text-muted-foreground">(<AnimatedNumber value={`${percentage(segment.value).toFixed(1)}%`} />)</span></dd>
            </div>)}
          </dl>
        </div>
        <figcaption className="mt-4 text-sm text-muted-foreground">{counts.total > 0 ? <><AnimatedNumber value={counts.paid} /> of <AnimatedNumber value={counts.total} /> rooms fully paid · Counts rooms, not individual charges or money.</> : 'No billed rooms match this view.'}</figcaption>
      </figure>
    </CardContent>
  </Card>
}
