import type { selectRoomSummary } from '@/domain/calculations/summary'
import { Building2, CalendarClock, DoorOpen, KeyRound, Wrench } from 'lucide-react'
import type { CSSProperties } from 'react'
import { AnimatedNumber } from './animated-number'

export function RoomSummary({ summary }: { summary: ReturnType<typeof selectRoomSummary> }) {
  const metrics = [
    { label: 'Occupied rooms', value: summary.occupiedRooms, icon: KeyRound, color: 'var(--forest-green)' },
    { label: 'Reserved rooms', value: summary.reservedRooms, icon: CalendarClock, color: '#9a6400' },
    { label: 'Available rooms', value: summary.availableRooms, icon: DoorOpen, color: '#527346' },
    { label: 'Under repair', value: summary.maintenanceRooms, icon: Wrench, color: '#a84625' },
  ]

  return <section aria-label="Room availability summary" className="mb-7">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-base font-semibold">Room availability</h2>
      <p className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground"><Building2 className="size-3.5" aria-hidden="true" /><span><AnimatedNumber value={summary.totalRooms} /> rooms total</span></p>
    </div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map(({ label, value, icon: Icon, color }, index) => {
        const share = summary.totalRooms > 0 ? value / summary.totalRooms * 100 : 0
        return <div key={label} role="group" aria-label={label} className="room-metric" style={{ '--metric-color': color, '--metric-delay': `${index * 60}ms` } as CSSProperties}>
          <div className="flex items-center justify-between gap-3">
            <h3 className="min-w-0 text-sm leading-snug font-semibold text-muted-foreground">{label}</h3>
            <span className="room-metric-icon shrink-0"><Icon className="size-[18px]" aria-hidden="true" /></span>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5"><strong className="text-2xl font-bold tracking-tight tabular-nums"><AnimatedNumber value={value} /></strong><span className="text-xs text-muted-foreground">of <AnimatedNumber value={summary.totalRooms} /> rooms</span></p>
            <span className="shrink-0 rounded-full border bg-card/80 px-2.5 py-1 text-xs font-semibold tabular-nums"><AnimatedNumber value={`${share.toFixed(0)}%`} /></span>
          </div>
          <div aria-hidden="true" className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className="room-metric-fill h-full rounded-full" style={{ width: `${share}%` }} /></div>
        </div>
      })}
    </div>
  </section>
}
