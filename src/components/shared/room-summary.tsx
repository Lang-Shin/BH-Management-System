import type { selectRoomSummary } from '@/domain/calculations/summary'

export function RoomSummary({ summary }: { summary: ReturnType<typeof selectRoomSummary> }) {
  return <div className="space-y-5">
    <p className="text-2xl leading-snug sm:text-3xl"><strong className="font-bold">{summary.occupiedRooms} occupied</strong><span className="text-muted-foreground"> / {summary.totalRooms} rooms</span></p>
    <div className="flex flex-wrap gap-3 text-base">
      <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 font-semibold text-emerald-900">{summary.availableRooms} available</p>
      {summary.maintenanceRooms > 0 && <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 font-medium text-amber-950">{summary.maintenanceRooms} under repair</p>}
    </div>
  </div>
}
