import { useState, type CSSProperties } from 'react'
import { DoorOpen } from 'lucide-react'
import { PageHeader } from '@/components/shared/page'
import { EmptyState } from '@/components/shared/states'
import { StatusBadge } from '@/components/shared/status-badge'
import { RoomSummary } from '@/components/shared/room-summary'
import { AnimatedNumber } from '@/components/shared/animated-number'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { usePrototype } from '@/hooks/use-prototype'
import { roomOccupancy, roomOccupants, selectRoomSummary, type RoomOccupancy } from '@/domain/calculations/summary'
import { DEMO_DATE } from '@/data/fixtures/demo'
import { formatMoney } from '@/lib/format'
import { ROOM_RATE_CATEGORIES, roomRate } from '@/lib/room-rates'
import type { RoomCategoryId } from '@/domain/types/models'
import { AddRoomDialog } from './add-room-dialog'

type Filter = 'ALL' | RoomOccupancy
type RateFilter = 'ALL' | RoomCategoryId
const filters: { value: Filter; label: string }[] = [
  { value: 'ALL', label: 'All rooms' }, { value: 'OCCUPIED', label: 'Occupied' },
  { value: 'AVAILABLE', label: 'Available' }, { value: 'UNDER_REPAIR', label: 'Under repair' },
]
const statusLabels: Record<RoomOccupancy, string> = { OCCUPIED: 'Occupied', AVAILABLE: 'Available', UNDER_REPAIR: 'Under repair' }

export default function Rooms() {
  const { data, dispatch } = usePrototype()
  const [filter, setFilter] = useState<Filter>('ALL')
  const [rateFilter, setRateFilter] = useState<RateFilter>('ALL')
  const [notice, setNotice] = useState('')
  const summary = selectRoomSummary(data, DEMO_DATE)
  const rooms = data.rooms.filter(room => (filter === 'ALL' || roomOccupancy(data, room, DEMO_DATE) === filter)
    && (rateFilter === 'ALL' || room.categoryId === rateFilter))
  const filterIndex = filters.findIndex(item => item.value === filter)

  return <>
    <PageHeader title="Rooms" description="A room is occupied when someone rents it, even if some beds are unused." action={<AddRoomDialog />} />
    <RoomSummary summary={summary} />
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4"><div className="room-segmented-control" role="group" aria-label="Show rooms" style={{ '--filter-index': filterIndex, '--filter-column': filterIndex % 2, '--filter-row': Math.floor(filterIndex / 2) } as CSSProperties}>{filters.map(item => <Button key={item.value} variant="ghost" className="room-filter" aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label}</Button>)}</div><div className="flex flex-wrap items-center gap-3"><label htmlFor="room-rate-filter" className="text-sm font-semibold">Rental rate</label><select id="room-rate-filter" value={rateFilter} onChange={event => setRateFilter(event.target.value as RateFilter)} className="min-h-12 rounded-lg border bg-card px-3 py-2 text-base"><option value="ALL">All rates</option>{ROOM_RATE_CATEGORIES.map(category => <option key={category.id} value={category.id}>{category.label}/month</option>)}</select></div><p role="status" className="text-sm text-muted-foreground">Showing <AnimatedNumber value={rooms.length} /> of <AnimatedNumber value={data.rooms.length} /> rooms</p></div>
    <p role="status" className="sr-only">{notice}</p>
    {rooms.length === 0 ? <div key={`${filter}:${rateFilter}`} className="room-filter-empty"><EmptyState title="No rooms here" description="There are no rooms with this status and rental rate." action={<Button variant="outline" onClick={() => { setFilter('ALL'); setRateFilter('ALL') }}>Show all rooms</Button>} /></div> : <div key={`${filter}:${rateFilter}`} className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">{rooms.map((room, index) => {
      const tenants = roomOccupants(data, room.id, DEMO_DATE)
      const status = roomOccupancy(data, room, DEMO_DATE)
      return <Card role="article" aria-label={`Room ${room.name}`} key={room.id} className="room-result-card shadow-none" style={{ '--room-card-delay': `${Math.min(index, 5) * 45}ms` } as CSSProperties}><CardContent>
        <div className="flex flex-wrap items-center justify-between gap-3"><span className="rounded-xl bg-accent p-3 text-primary"><DoorOpen className="size-6" aria-hidden="true" /></span><StatusBadge status={statusLabels[status]} /></div>
        <h2 className="mt-5 text-xl font-bold">Room {room.name}</h2><p className="mt-1 text-lg font-bold text-primary"><AnimatedNumber value={formatMoney(roomRate(room).monthlyRentCents)} /><span className="text-sm font-medium text-muted-foreground">/month</span></p><p className="mt-2 text-sm text-muted-foreground">Floor {room.floor} · <AnimatedNumber value={room.capacity} /> {room.capacity === 1 ? 'bed' : 'beds'}{room.capacity > 1 ? ' · Shared-capacity room' : ' · Single room'}</p>
        <p className="mt-2 text-sm font-semibold">{statusLabels[status]} — <AnimatedNumber value={tenants.length} /> {tenants.length === 1 ? 'tenant' : 'tenants'}</p>
        <div className="mt-5 border-t pt-4">{status === 'OCCUPIED' ? <><p className="mb-2 text-sm text-muted-foreground">{tenants.length === 1 ? 'Tenant' : 'Tenants'}</p><ul className="space-y-2 text-base font-medium">{tenants.map(t => <li key={t.id}>{t.name}</li>)}</ul></> : <p className="text-base text-muted-foreground">{status === 'UNDER_REPAIR' ? 'Not available while repairs are being done.' : 'Ready for a new tenant.'}</p>}</div>
        {status !== 'OCCUPIED' && <Button variant="outline" className="mt-6 w-full" aria-label={status === 'UNDER_REPAIR' ? `Mark room ${room.name} as available` : `Mark room ${room.name} under repair`} onClick={() => { dispatch({ type: 'room/statusToggled', roomId: room.id }); setNotice(`Room ${room.name} is now ${status === 'UNDER_REPAIR' ? 'available' : 'under repair'}.`); }}>{status === 'UNDER_REPAIR' ? 'Mark as available' : 'Needs repair'}</Button>}
      </CardContent></Card>
    })}</div>}
  </>
}
