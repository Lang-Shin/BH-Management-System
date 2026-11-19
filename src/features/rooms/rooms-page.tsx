import { useRef, useState, type CSSProperties } from 'react'
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
import { roomMonthlyRentCents } from '@/domain/calculations/billing-rates'
import { AddRoomDialog } from './add-room-dialog'
import { RoomDetailsDialog } from './room-details-dialog'

type Filter = 'ALL' | RoomOccupancy
const filters: { value: Filter; label: string }[] = [
  { value: 'ALL', label: 'All rooms' }, { value: 'OCCUPIED', label: 'Occupied' },
  { value: 'AVAILABLE', label: 'Available' }, { value: 'UNDER_REPAIR', label: 'Under repair' },
]
const statusLabels: Record<RoomOccupancy, string> = { OCCUPIED: 'Occupied', AVAILABLE: 'Available', UNDER_REPAIR: 'Under repair' }

export default function Rooms() {
  const { data } = usePrototype()
  const [filter, setFilter] = useState<Filter>('ALL')
  const [notice, setNotice] = useState('')
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null)
  const roomTrigger = useRef<HTMLElement | null>(null)
  const summary = selectRoomSummary(data, DEMO_DATE)
  const rooms = data.rooms.filter(room => filter === 'ALL' || roomOccupancy(data, room, DEMO_DATE) === filter)
  const selectedRoom = data.rooms.find(room => room.id === selectedRoomId)
  const filterIndex = filters.findIndex(item => item.value === filter)

  return <>
    <PageHeader title="Rooms" description="A room is occupied when someone rents it, even if some beds are unused." action={<AddRoomDialog onSaved={setNotice} />} />
    <RoomSummary summary={summary} />
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4"><div className="room-segmented-control" role="group" aria-label="Show rooms" style={{ '--filter-index': filterIndex, '--filter-column': filterIndex % 2, '--filter-row': Math.floor(filterIndex / 2) } as CSSProperties}>{filters.map(item => <Button key={item.value} variant="ghost" className="room-filter" aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label}</Button>)}</div><p role="status" className="text-sm text-muted-foreground">Showing <AnimatedNumber value={rooms.length} /> of <AnimatedNumber value={data.rooms.length} /> rooms</p></div>
    {notice ? <p role="status" className="room-management-notice">{notice}</p> : <p role="status" className="sr-only" />}
    {rooms.length === 0 ? <div key={filter} className="room-filter-empty"><EmptyState title="No rooms here" description="There are no rooms with this status." action={<Button variant="outline" onClick={() => setFilter('ALL')}>Show all rooms</Button>} /></div> : <div key={filter} className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">{rooms.map((room, index) => {
      const tenants = roomOccupants(data, room.id, DEMO_DATE)
      const status = roomOccupancy(data, room, DEMO_DATE)
      return <Card role="button" tabIndex={0} aria-haspopup="dialog" aria-label={`Room ${room.name} details`} key={room.id} className="room-result-card shadow-none" style={{ '--room-card-delay': `${Math.min(index, 5) * 45}ms` } as CSSProperties} onClick={event => { roomTrigger.current = event.currentTarget; setSelectedRoomId(room.id) }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); roomTrigger.current = event.currentTarget; setSelectedRoomId(room.id) } }}><CardContent>
        <div className="flex flex-wrap items-center justify-between gap-3"><span className="rounded-xl bg-accent p-3 text-[var(--tint)]"><DoorOpen className="size-6" aria-hidden="true" /></span><StatusBadge status={statusLabels[status]} /></div>
        <h2 className="mt-5 text-xl font-bold">Room {room.name}</h2><p className="mt-1 text-lg font-bold text-[var(--tint)]">{formatMoney(roomMonthlyRentCents(data, room, DEMO_DATE))}<span className="text-sm font-medium text-muted-foreground">/month</span></p><p className="mt-2 text-sm text-muted-foreground">Floor {room.floor} · <AnimatedNumber value={room.capacity} /> {room.capacity === 1 ? 'bed' : 'beds'}{room.capacity > 1 ? ' · Shared-capacity room' : ' · Single room'}</p>
        <p className="mt-2 text-sm font-semibold">{statusLabels[status]} — <AnimatedNumber value={tenants.length} /> {tenants.length === 1 ? 'tenant' : 'tenants'}</p>
        <div className="mt-5 border-t pt-4">{status === 'OCCUPIED' ? <><p className="mb-2 text-sm text-muted-foreground">{tenants.length === 1 ? 'Tenant' : 'Tenants'}</p><ul className="space-y-2 text-base font-medium">{tenants.map(t => <li key={t.id}>{t.name}</li>)}</ul></> : <p className="text-base text-muted-foreground">{status === 'UNDER_REPAIR' ? 'Not available while repairs are being done.' : 'Ready for a new tenant.'}</p>}</div>
      </CardContent></Card>
    })}</div>}
    {selectedRoom && <RoomDetailsDialog roomId={selectedRoom.id} onClose={() => setSelectedRoomId(null)} onReturnFocus={() => roomTrigger.current?.focus()} onNotice={setNotice} />}
  </>
}
