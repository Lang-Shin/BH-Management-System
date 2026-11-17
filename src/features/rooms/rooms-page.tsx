import { useState, type CSSProperties } from 'react'
import { Button, Heading, Select, SegmentedControl, Text } from '@radix-ui/themes'
import { PageHeader } from '@/components/shared/page'
import { EmptyState } from '@/components/shared/states'
import { StatusBadge } from '@/components/shared/status-badge'
import { RoomSummary } from '@/components/shared/room-summary'
import { AnimatedNumber } from '@/components/shared/animated-number'
import { usePrototype } from '@/hooks/use-prototype'
import { roomOccupancy, roomOccupants, selectRoomSummary, type RoomOccupancy } from '@/domain/calculations/summary'
import { DEMO_DATE } from '@/data/fixtures/demo'
import { formatMoney } from '@/lib/format'
import { ROOM_RATE_CATEGORIES, roomRate } from '@/lib/room-rates'
import type { RoomCategoryId } from '@/domain/types/models'
import { AddRoomDialog } from './add-room-dialog'
import './rooms.css'

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
  const hasFilters = filter !== 'ALL' || rateFilter !== 'ALL'
  function clearFilters() { setFilter('ALL'); setRateFilter('ALL') }

  return <>
    <PageHeader title="Rooms" description="A room is occupied when someone rents it, even if some beds are unused." action={<AddRoomDialog />} />
    <RoomSummary summary={summary} />
    <div className="rooms-toolbar">
      <SegmentedControl.Root value={filter} onValueChange={value => { if (value) setFilter(value as Filter) }} aria-label="Show rooms">
        {filters.map(item => <SegmentedControl.Item key={item.value} value={item.value}>{item.label}</SegmentedControl.Item>)}
      </SegmentedControl.Root>
      <div className="rooms-toolbar-field">
        <Text as="label" htmlFor="room-rate-filter" size="2" weight="medium">Rental rate</Text>
        <Select.Root value={rateFilter} onValueChange={value => setRateFilter(value as RateFilter)}>
          <Select.Trigger id="room-rate-filter" variant="surface" color="gray" />
          <Select.Content>
            <Select.Item value="ALL">All rates</Select.Item>
            {ROOM_RATE_CATEGORIES.map(category => <Select.Item key={category.id} value={category.id}>{category.label}/month</Select.Item>)}
          </Select.Content>
        </Select.Root>
      </div>
      {hasFilters && <Button variant="ghost" color="gray" onClick={clearFilters}>Clear filters</Button>}
      <Text as="p" size="2" color="gray" role="status" aria-atomic="true" className="rooms-toolbar-count">Showing <AnimatedNumber value={rooms.length} /> of <AnimatedNumber value={data.rooms.length} /> rooms</Text>
    </div>
    <p role="status" className="sr-only">{notice}</p>
    {rooms.length === 0
      ? <div key={`${filter}:${rateFilter}`}><EmptyState title={data.rooms.length ? 'No rooms here' : 'No rooms yet'} description={data.rooms.length ? 'There are no rooms with this status and rental rate.' : 'Add a room to start tracking its availability and rental rate.'} action={data.rooms.length ? <Button variant="outline" color="gray" onClick={clearFilters}>Show all rooms</Button> : <AddRoomDialog />} /></div>
      : <div key={`${filter}:${rateFilter}`} className="rooms-grid">{rooms.map((room, index) => {
        const tenants = roomOccupants(data, room.id, DEMO_DATE)
        const status = roomOccupancy(data, room, DEMO_DATE)
        return <article key={room.id} aria-label={`Room ${room.name}`} className="panel panel-pad room-card enter" style={{ '--enter-delay': `${Math.min(index, 5) * 45}ms` } as CSSProperties}>
          <div className="room-card-head">
            <Heading as="h2" size="4">Room {room.name}</Heading>
            <StatusBadge status={statusLabels[status]} label={status === 'OCCUPIED' ? `Occupied — ${tenants.length} ${tenants.length === 1 ? 'tenant' : 'tenants'}` : statusLabels[status]} />
          </div>
          <Text as="p" size="3" weight="bold" className="num"><AnimatedNumber value={formatMoney(roomRate(room).monthlyRentCents)} /><Text weight="regular" color="gray" size="2">/month</Text></Text>
          <Text as="p" size="2" color="gray">Floor {room.floor} · <AnimatedNumber value={room.capacity} /> {room.capacity === 1 ? 'bed' : 'beds'}{room.capacity > 1 ? ' · Shared-capacity room' : ' · Single room'}</Text>
          <div className="room-card-body">{status === 'OCCUPIED'
            ? <ul className="room-card-tenants" aria-label={tenants.length === 1 ? 'Tenant' : 'Tenants'}>{tenants.map(t => <li key={t.id}><Text size="2">{t.name}</Text></li>)}</ul>
            : <Text as="p" size="2" color="gray" mt="3">{status === 'UNDER_REPAIR' ? 'Not available while repairs are being done.' : 'Ready for a new tenant.'}</Text>}</div>
          {status !== 'OCCUPIED' && <div className="room-card-action"><Button variant="soft" color="gray" style={{ width: '100%' }} aria-label={status === 'UNDER_REPAIR' ? `Mark room ${room.name} as available` : `Mark room ${room.name} under repair`} onClick={() => { dispatch({ type: 'room/statusToggled', roomId: room.id }); setNotice(`Room ${room.name} is now ${status === 'UNDER_REPAIR' ? 'available' : 'under repair'}.`) }}>{status === 'UNDER_REPAIR' ? 'Mark as available' : 'Needs repair'}</Button></div>}
        </article>
      })}</div>}
  </>
}
