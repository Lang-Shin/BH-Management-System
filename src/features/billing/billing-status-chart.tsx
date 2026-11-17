import { useEffect, useRef, useState } from 'react'
import { Text } from '@radix-ui/themes'
import { Section } from '@/components/shared/page'
import { AnimatedNumber } from '@/components/shared/animated-number'
import { billingStatusCounts, type BillingRoom } from './billing-room-status'
import '@/components/shared/shared-parts.css'
import './billing.css'

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
    { label: 'PAID', value: counts.paid, color: 'var(--accent-9)' },
    { label: 'PARTLY PAID', value: counts.partlyPaid, color: 'var(--amber-8)' },
    { label: 'NOT YET PAID', value: counts.notPaid, color: 'var(--red-9)' },
  ]

  return <Section title="Billing status at a glance" description={`${periodLabel} · ${outstandingOnly ? 'Rooms with unpaid bills' : 'All billed rooms'}`}>
    <div className="panel panel-pad enter">
      <figure ref={figureRef} className="chart billing-room-status-chart" data-revealed={revealed} aria-label="Billing room payment status">
        <div key={segments.map(segment => segment.value).join(':')} className="chart-body">
          <div className="chart-donut">
            <svg viewBox="0 0 200 200" aria-hidden="true">
              <circle cx="100" cy="100" r="80" fill="none" stroke="var(--gray-4)" strokeWidth="22" />
              {segments.map((segment, index) => {
                const length = percentage(segment.value)
                const start = percentage(segments.slice(0, index).reduce((sum, previous) => sum + previous.value, 0))
                return segment.value > 0 && <circle key={segment.label} className="analytics-doughnut-segment billing-status-doughnut-segment" cx="100" cy="100" r="80" pathLength="100" fill="none" stroke={segment.color} strokeWidth="22" strokeDasharray={`${length} ${100 - length}`} strokeDashoffset={-start} />
              })}
            </svg>
            <div className="chart-donut-center">
              <Text size="7" weight="bold" className="num"><AnimatedNumber value={`${percentage(counts.paid).toFixed(0)}%`} /></Text>
              <Text size="2" color="gray">fully paid</Text>
            </div>
          </div>
          <dl className="chart-legend" aria-label="Room payment status counts">
            {segments.map(segment => <div key={segment.label}>
              <dt><span className="chart-swatch" style={{ background: segment.color }} aria-hidden="true" />{segment.label}</dt>
              <dd><Text weight="bold"><AnimatedNumber value={segment.value} /></Text><Text color="gray" ml="2">(<AnimatedNumber value={`${percentage(segment.value).toFixed(1)}%`} />)</Text></dd>
            </div>)}
          </dl>
        </div>
        <Text as="p" size="2" color="gray" className="chart-caption">{counts.total > 0 ? <><AnimatedNumber value={counts.paid} /> of <AnimatedNumber value={counts.total} /> rooms fully paid · Counts rooms, not individual charges or money.</> : 'No billed rooms match this view.'}</Text>
      </figure>
    </div>
  </Section>
}
