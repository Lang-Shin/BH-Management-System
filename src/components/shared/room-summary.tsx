import { Heading, Text } from '@radix-ui/themes'
import type { selectRoomSummary } from '@/domain/calculations/summary'
import { AnimatedNumber } from './animated-number'
import './room-summary.css'

export function RoomSummary({ summary }: { summary: ReturnType<typeof selectRoomSummary> }) {
  const metrics = [
    { label: 'Occupied rooms', value: summary.occupiedRooms },
    { label: 'Available rooms', value: summary.availableRooms },
    { label: 'Under repair', value: summary.maintenanceRooms, tone: 'repair' },
  ]

  return <section aria-label="Room availability summary">
    <div className="section-head">
      <Heading as="h2" size="4" weight="bold">Room availability</Heading>
      <Text size="2" color="gray"><AnimatedNumber value={summary.totalRooms} /> rooms total</Text>
    </div>
    <div className="room-strip">
      {metrics.map(({ label, value, tone }) => {
        const share = summary.totalRooms > 0 ? value / summary.totalRooms * 100 : 0
        return <div key={label} role="group" aria-label={label} data-tone={tone} className="room-strip-item">
          <Text as="p" size="2" color="gray" weight="medium">{label}</Text>
          <p className="stat-value"><AnimatedNumber value={value} /> <Text size="2" color="gray" weight="regular">of <AnimatedNumber value={summary.totalRooms} /> rooms</Text></p>
          <div aria-hidden="true" className="room-strip-bar"><span style={{ width: `${share}%` }} /></div>
        </div>
      })}
    </div>
  </section>
}
