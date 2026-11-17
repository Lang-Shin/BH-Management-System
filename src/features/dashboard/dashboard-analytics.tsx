import { Text } from '@radix-ui/themes'
import type { selectRoomSummary, selectSummary } from '@/domain/calculations/summary'
import { AnimatedNumber } from '@/components/shared/animated-number'
import '@/components/shared/shared-parts.css'

type Segment = { label: string; value: number; color: string }
const percentage = (value: number, total: number) => total > 0 ? value / total * 100 : 0

function AnalyticsLegend({ segments, total }: { segments: Segment[]; total: number }) {
  return <dl className="chart-legend">
    {segments.map(segment => <div key={segment.label}>
      <dt><span aria-hidden="true" className="chart-swatch" style={{ background: segment.color }} />{segment.label}</dt>
      <dd><Text weight="bold"><AnimatedNumber value={segment.value} /></Text><Text color="gray" ml="2">(<AnimatedNumber value={`${percentage(segment.value, total).toFixed(1)}%`} />)</Text></dd>
    </div>)}
  </dl>
}

export function RoomOccupancyChart({ summary }: { summary: ReturnType<typeof selectRoomSummary> }) {
  const segments: Segment[] = [
    { label: 'Occupied', value: summary.occupiedRooms, color: 'var(--accent-9)' },
    { label: 'Available', value: summary.availableRooms, color: 'var(--accent-6)' },
    { label: 'Under repair', value: summary.maintenanceRooms, color: 'var(--amber-8)' },
  ]
  let offset = 0

  return <figure aria-label="Room occupancy analytics" className="chart">
    <div className="chart-body">
      <div className="chart-donut">
        <svg viewBox="0 0 200 200" aria-hidden="true">
          <circle cx="100" cy="100" r="80" fill="none" stroke="var(--gray-4)" strokeWidth="22" />
          {segments.map(segment => {
            const length = percentage(segment.value, summary.totalRooms)
            const start = offset
            offset += length
            return segment.value > 0 && <circle key={segment.label} className="analytics-doughnut-segment" cx="100" cy="100" r="80" pathLength="100" fill="none" stroke={segment.color} strokeWidth="22" strokeDasharray={`${length} ${100 - length}`} strokeDashoffset={-start} />
          })}
        </svg>
        <div className="chart-donut-center">
          <Text size="7" weight="bold" className="num"><AnimatedNumber value={`${percentage(summary.occupiedRooms, summary.totalRooms).toFixed(0)}%`} /></Text>
          <Text size="2" color="gray">occupied</Text>
        </div>
      </div>
      <AnalyticsLegend segments={segments} total={summary.totalRooms} />
    </div>
    <Text as="p" size="2" color="gray" className="chart-caption">{summary.totalRooms > 0 ? <><AnimatedNumber value={summary.occupiedRooms} /> of <AnimatedNumber value={summary.totalRooms} /> rooms occupied · <AnimatedNumber value={summary.availableRooms} /> ready to rent</> : 'No rooms recorded yet.'}</Text>
  </figure>
}

export function BillPaymentChart({ summary }: { summary: ReturnType<typeof selectSummary> }) {
  const segments: Segment[] = [
    { label: 'Paid', value: summary.paid, color: 'var(--accent-9)' },
    { label: 'Partly paid', value: summary.partial, color: 'var(--amber-8)' },
    { label: 'Not yet paid', value: summary.unpaid, color: 'var(--red-9)' },
  ]
  const total = summary.paid + summary.partial + summary.unpaid

  return <figure aria-label="Bill payment analytics" className="chart">
    <Text as="p" mb="3"><Text size="7" weight="bold" className="num"><AnimatedNumber value={`${percentage(summary.paid, total).toFixed(0)}%`} /></Text> <Text size="2" color="gray">of bills fully paid</Text></Text>
    <div aria-hidden="true" className="chart-track">
      <div className="analytics-payment-bar">
        {segments.map(segment => <span key={segment.label} style={{ width: `${percentage(segment.value, total)}%`, background: segment.color }} />)}
      </div>
    </div>
    <AnalyticsLegend segments={segments} total={total} />
    <Text as="p" size="2" color="gray" className="chart-caption">{total > 0 ? <><AnimatedNumber value={total} /> issued bills this month · counts, not payment amounts{summary.unresolved > 0 ? ` · plus ${summary.unresolved} electricity ${summary.unresolved === 1 ? 'bill' : 'bills'} awaiting a reading` : ''}</> : summary.unresolved > 0 ? `${summary.unresolved} electricity ${summary.unresolved === 1 ? 'bill is' : 'bills are'} awaiting a meter reading.` : 'No issued bills for this month.'}</Text>
  </figure>
}
