import { useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { DoorOpen } from 'lucide-react'
import { PageHeader } from '@/components/shared/page'
import { EmptyState } from '@/components/shared/states'
import { StatusBadge } from '@/components/shared/status-badge'
import { RoomSummary } from '@/components/shared/room-summary'
import { AnimatedNumber } from '@/components/shared/animated-number'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { usePrototype } from '@/hooks/use-prototype'
import { useOccupancyDate } from '@/hooks/use-occupancy-date'
import { roomOccupancy, roomOccupants, selectRoomSummary, type RoomOccupancy } from '@/domain/calculations/summary'
import { futureRoomReservations } from '@/domain/calculations/room-capacity'
import { DEMO_DATE } from '@/data/fixtures/demo'
import { formatDate, formatMoney } from '@/lib/format'
import { roomMonthlyRentCents } from '@/domain/calculations/billing-rates'
import { roomCategoryLabel } from '@/lib/room-rates'
import { AddRoomDialog } from './add-room-dialog'
import { RoomDetailsDialog } from './room-details-dialog'
import { RoomFiltersMenu, type RoomFilter } from './room-filters-menu'

const statusLabels: Record<RoomOccupancy, string> = { OCCUPIED: 'Occupied', RESERVED: 'Reserved', AVAILABLE: 'Available', UNDER_REPAIR: 'Under repair' }

export default function Rooms() {
  const { data } = usePrototype()
  const occupancyDate = useOccupancyDate()
  const [filter, setFilter] = useState<RoomFilter>('ALL')
  const [notice, setNotice] = useState('')
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null)
  const roomTrigger = useRef<HTMLElement | null>(null)
  const summary = selectRoomSummary(data, occupancyDate)
  const rooms = data.rooms.filter(room => filter === 'ALL' || roomOccupancy(data, room, occupancyDate) === filter)
  const selectedRoom = data.rooms.find(room => room.id === selectedRoomId)
  const hasLegacyRoomNumbers = data.rooms.some(room => /^(10[1-9]|11[0-5])$/.test(room.name))

  return <>
    <PageHeader title="Rooms" description="A room is occupied when someone rents it, even if some beds are unused." action={<AddRoomDialog onSaved={setNotice} />} />
    <RoomSummary summary={summary} />
    {hasLegacyRoomNumbers && <p role="note" className="room-management-notice mb-6">
      Some saved room numbers match the earlier fictional layout (101–115). They have not been mapped to actual rooms: an owner-approved correspondence is required. Tenant assignments and financial records are retained. “Restore sample records” in <Link to="/reports" className="font-semibold underline">Reports &amp; Settings</Link> explicitly replaces the saved demo dataset; it is not a historical-data migration.
    </p>}
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4"><RoomFiltersMenu value={filter} onChange={setFilter} /><p role="status" className="text-sm text-muted-foreground">Showing <AnimatedNumber value={rooms.length} /> of <AnimatedNumber value={data.rooms.length} /> rooms</p></div>
    {notice ? <p role="status" className="room-management-notice">{notice}</p> : <p role="status" className="sr-only" />}
    {rooms.length === 0 ? <div key={filter} className="room-filter-empty"><EmptyState title="No rooms here" description="There are no rooms with this status." action={<Button variant="outline" onClick={() => setFilter('ALL')}>Show all rooms</Button>} /></div> : <div key={filter} className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">{rooms.map((room, index) => {
      const tenants = roomOccupants(data, room.id, occupancyDate)
      const reservations = futureRoomReservations(data, room.id, occupancyDate)
      const status = roomOccupancy(data, room, occupancyDate)
      return <Card role="button" tabIndex={0} aria-haspopup="dialog" aria-label={`Room ${room.name} details`} key={room.id} className="room-result-card shadow-none" style={{ '--room-card-delay': `${Math.min(index, 5) * 45}ms` } as CSSProperties} onClick={event => { roomTrigger.current = event.currentTarget; setSelectedRoomId(room.id) }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); roomTrigger.current = event.currentTarget; setSelectedRoomId(room.id) } }}><CardContent>
        <div className="flex flex-wrap items-center justify-between gap-3"><span className="rounded-xl bg-accent p-3 text-[var(--tint)]"><DoorOpen className="size-6" aria-hidden="true" /></span><StatusBadge status={statusLabels[status]} /></div>
        <h2 className="mt-5 text-xl font-bold">Room {room.name}</h2><p className="mt-1 text-lg font-bold text-[var(--tint)]">{formatMoney(roomMonthlyRentCents(data, room, DEMO_DATE))}<span className="text-sm font-medium text-muted-foreground">/month</span></p><p className="mt-2 text-sm text-muted-foreground">Floor {room.floor} · <AnimatedNumber value={room.capacity} /> {room.capacity === 1 ? 'bed' : 'beds'}{room.capacity > 1 ? ' · Shared-capacity room' : ' · Single room'}</p>
        <p className="mt-2 text-sm text-muted-foreground">{roomCategoryLabel(room.categoryId)}</p>
        <p className="mt-2 text-sm font-semibold">{statusLabels[status]} · <AnimatedNumber value={tenants.length} /> current {tenants.length === 1 ? 'tenant' : 'tenants'}{reservations.length > 0 ? ` · ${reservations.length} reserved` : ''}</p>
        <div className="mt-5 border-t pt-4">
          {tenants.length > 0 && <><p className="mb-2 text-sm text-muted-foreground">{tenants.length === 1 ? 'Current tenant' : 'Current tenants'}</p><ul className="space-y-2 text-base font-medium">{tenants.map(t => <li key={t.id}>{t.name}</li>)}</ul></>}
          {reservations.length > 0 && <div className="room-reservation-note">
            <p className="font-semibold">Upcoming reservation</p>
            <ul>{reservations.map(reservation => <li key={reservation.assignment.id}>{reservation.tenant.name} · effective {formatDate(reservation.effectiveDate)}</li>)}</ul>
          </div>}
          {status === 'UNDER_REPAIR' && <p className="text-base text-muted-foreground">Not available while repairs are being done.</p>}
          {status === 'AVAILABLE' && <p className="text-base text-muted-foreground">Ready for a new tenant.</p>}
        </div>
      </CardContent></Card>
    })}</div>}
    {selectedRoom && <RoomDetailsDialog key={selectedRoom.id} roomId={selectedRoom.id} onClose={() => setSelectedRoomId(null)} onReturnFocus={() => roomTrigger.current?.focus()} onNotice={setNotice} />}
  </>
}
