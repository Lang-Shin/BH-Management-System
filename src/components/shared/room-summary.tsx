import type { selectRoomSummary } from '@/domain/calculations/summary'
import { Building2, DoorOpen, KeyRound, Wrench } from 'lucide-react'
import type { CSSProperties } from 'react'

export function RoomSummary({ summary }: { summary: ReturnType<typeof selectRoomSummary> }) {
  const metrics = [
    { label: 'Occupied rooms', value: summary.occupiedRooms, detail: 'Currently rented', icon: KeyRound, color: 'var(--forest-green)' },
    { label: 'Available rooms', value: summary.availableRooms, detail: 'Ready for a new tenant', icon: DoorOpen, color: '#527346' },
    { label: 'Under repair', value: summary.maintenanceRooms, detail: 'Temporarily unavailable', icon: Wrench, color: '#a84625' },
  ]

  return <section aria-label="Room availability summary" className="mb-7">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-base font-semibold">Room availability</h2>
      <p className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground"><Building2 className="size-3.5" aria-hidden="true" />{summary.totalRooms} rooms total</p>
    </div>
    <div className="grid gap-4 sm:grid-cols-3">
      {metrics.map(({ label, value, detail, icon: Icon, color }, index) => {
        const share = summary.totalRooms > 0 ? value / summary.totalRooms * 100 : 0
        return <div key={label} role="group" aria-label={label} className="room-metric" style={{ '--metric-color': color, '--metric-delay': `${index * 60}ms` } as CSSProperties}>
          <div className="flex items-center justify-between gap-3">
            <span className="room-metric-icon"><Icon className="size-5" aria-hidden="true" /></span>
            <span className="rounded-full border bg-card/80 px-2.5 py-1 text-xs font-semibold tabular-nums">{share.toFixed(0)}%</span>
          </div>
          <h3 className="mt-4 text-sm font-medium text-muted-foreground">{label}</h3>
          <p className="mt-1 flex items-baseline gap-2"><strong className="text-4xl leading-tight font-bold tracking-tight tabular-nums">{value}</strong><span className="text-xs text-muted-foreground">of {summary.totalRooms} rooms</span></p>
          <div aria-hidden="true" className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted"><div className="room-metric-fill h-full rounded-full" style={{ width: `${share}%` }} /></div>
          <p className="mt-3 text-xs text-muted-foreground">{detail}</p>
        </div>
      })}
    </div>
  </section>
}
