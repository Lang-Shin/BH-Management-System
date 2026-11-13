import { useState } from 'react'
import { DoorOpen, Users } from 'lucide-react'
import { PageHeader } from '@/components/shared/page'
import { EmptyState } from '@/components/shared/states'
import { StatusBadge } from '@/components/shared/status-badge'
import { WorkflowPlaceholders } from '@/components/shared/workflow-placeholders'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { usePrototype } from '@/hooks/use-prototype'
import { roomOccupants } from '@/domain/calculations/summary'
import { DEMO_DATE } from '@/data/fixtures/demo'
import { cn } from '@/lib/utils'

type Filter = 'all' | 'available' | 'maintenance'
const filters: { value: Filter; label: string }[] = [{ value: 'all', label: 'All rooms' }, { value: 'available', label: 'With vacancy' }, { value: 'maintenance', label: 'Maintenance' }]

export default function Rooms() {
  const { data, dispatch } = usePrototype()
  const [filter, setFilter] = useState<Filter>('all')
  const [notice, setNotice] = useState('')
  const rooms = data.rooms.filter(r => filter === 'all' || (filter === 'maintenance' ? r.status === 'maintenance' : r.status === 'available' && roomOccupants(data, r.id, DEMO_DATE).length < r.capacity))
  const totalBeds = data.rooms.reduce((sum, r) => sum + r.capacity, 0)

  return <>
    <PageHeader title="Rooms" description="Fictional shared and private rooms. Occupancy comes from dated room assignments, keeping moved-out tenants out of current counts." />
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4"><div className="flex flex-wrap gap-1 rounded-lg border bg-card p-1" role="group" aria-label="Filter rooms">{filters.map(item => <Button key={item.value} size="sm" variant="ghost" aria-pressed={filter === item.value} onClick={() => setFilter(item.value)} className={cn(filter === item.value && 'bg-accent text-primary')}>{item.label}</Button>)}</div><p className="text-sm text-muted-foreground">{rooms.length} of {data.rooms.length} rooms · {totalBeds} total beds</p></div>
    <p role="status" className="sr-only">{notice}</p>
    {rooms.length === 0 ? <EmptyState title="No rooms in this view" action={<Button variant="outline" onClick={() => setFilter('all')}>Show all rooms</Button>} /> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{rooms.map(room => {
      const tenants = roomOccupants(data, room.id, DEMO_DATE)
      const isEmpty = tenants.length === 0
      const status = room.status === 'maintenance' ? 'Maintenance' : isEmpty ? 'Available' : tenants.length === room.capacity ? 'Full' : 'With vacancy'
      return <Card key={room.id} className="shadow-none"><CardContent>
        <div className="flex flex-wrap items-center justify-between gap-3"><span className="rounded-lg bg-accent p-2.5 text-primary"><DoorOpen className="size-5" aria-hidden="true" /></span><StatusBadge status={status} /></div>
        <h2 className="mt-4 text-xl font-semibold">Room {room.name}</h2><p className="mt-1 text-sm text-muted-foreground">Floor {room.floor} · {room.kind === 'SHARED' ? 'Shared room' : 'Private room'} · Capacity {room.capacity}</p>
        <div className="my-5 flex items-center justify-between rounded-lg bg-muted/70 px-3 py-3 text-sm"><span className="flex items-center gap-2 text-muted-foreground"><Users className="size-4" aria-hidden="true" />Occupancy</span><span className="font-semibold">{tenants.length} / {room.capacity} beds</span></div>
        <p className="min-h-12 text-sm leading-relaxed text-muted-foreground">{room.status === 'maintenance' ? 'Excluded from usable capacity.' : isEmpty ? 'No current occupants; historical assignments remain available in tenant profiles.' : tenants.map(t => t.name).join(' · ')}</p>
        <Button variant="outline" className="mt-5 w-full" disabled={!isEmpty} aria-label={`${room.status === 'maintenance' ? 'Make available' : 'Set maintenance'} for room ${room.name}`} onClick={() => { dispatch({ type: 'room/statusToggled', roomId: room.id }); setNotice(`Room ${room.name} ${room.status === 'maintenance' ? 'made available' : 'set to maintenance'}.`); }}>{room.status === 'maintenance' ? 'Make available' : 'Set maintenance'}</Button>
        <p className="mt-2 text-center text-xs text-muted-foreground">{isEmpty ? 'Existing demo-only maintenance toggle.' : 'Only empty rooms can change maintenance status.'}</p>
      </CardContent></Card>
    })}</div>}
    <WorkflowPlaceholders title="Room configuration foundations" items={[
      { title: 'Room editing and assignment', description: 'Full configuration, transfers, and assignment editing are deferred. Agreed rent is stored on assignment records, not inferred from room capacity.' },
      { title: 'Shared-room billing', description: 'Several tenants can occupy one room. Electricity meter ownership and shared-room allocation rules remain unconfirmed; no split is calculated.' },
    ]} />
  </>
}
