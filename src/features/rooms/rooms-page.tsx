import { useState } from 'react'
import { DoorOpen, Users } from 'lucide-react'
import { PageHeader } from '@/components/shared/page'
import { EmptyState } from '@/components/shared/states'
import { StatusBadge } from '@/components/shared/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { usePrototype } from '@/hooks/use-prototype'
import { formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'

type Filter = 'all' | 'available' | 'maintenance'
const filters: { value: Filter; label: string }[] = [{ value: 'all', label: 'All rooms' }, { value: 'available', label: 'With vacancy' }, { value: 'maintenance', label: 'Maintenance' }]

export default function Rooms() {
  const { data, dispatch } = usePrototype()
  const [filter, setFilter] = useState<Filter>('all')
  const [notice, setNotice] = useState('')
  const rooms = data.rooms.filter(room => filter === 'all' || (filter === 'maintenance' ? room.status === 'maintenance' : room.status === 'available' && data.tenants.filter(t => t.roomId === room.id).length < room.capacity))
  return <>
    <PageHeader title="Rooms" description="A home for every resident. Explore occupancy and try changing maintenance status on an empty room." />
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4"><div className="flex flex-wrap gap-1 rounded-lg border bg-card p-1" role="group" aria-label="Filter rooms">{filters.map(item => <Button key={item.value} size="sm" variant="ghost" aria-pressed={filter === item.value} onClick={() => setFilter(item.value)} className={cn(filter === item.value && 'bg-accent text-primary')}>{item.label}</Button>)}</div><p className="text-xs text-muted-foreground">{rooms.length} of {data.rooms.length} rooms · 30 total beds</p></div>
    <p role="status" className="sr-only">{notice}</p>
    {rooms.length === 0 ? <EmptyState title="No rooms in this view" action={<Button variant="outline" onClick={() => setFilter('all')}>Show all rooms</Button>} /> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{rooms.map(room => {
      const tenants = data.tenants.filter(tenant => tenant.roomId === room.id)
      const isEmpty = tenants.length === 0
      return <Card key={room.id} className="shadow-none"><CardContent>
        <div className="flex flex-wrap items-center justify-between gap-3"><span className="rounded-lg bg-accent p-2.5 text-primary"><DoorOpen className="size-5" aria-hidden="true" /></span><StatusBadge status={room.status === 'maintenance' ? 'Maintenance' : 'Available'} /></div>
        <h2 className="mt-4 text-xl font-semibold">Room {room.name}</h2><p className="mt-1 text-xs text-muted-foreground">Floor {room.floor} · {formatMoney(room.monthlyRateCents)} / bed / month</p>
        <div className="my-5 flex items-center justify-between rounded-lg bg-muted/70 px-3 py-3 text-sm"><span className="flex items-center gap-2 text-muted-foreground"><Users className="size-4" aria-hidden="true" />Occupancy</span><span className="font-semibold">{tenants.length} / {room.capacity} beds</span></div>
        <p className="min-h-10 text-xs leading-relaxed text-muted-foreground">{room.status === 'maintenance' ? 'Not included in usable bed capacity.' : isEmpty ? 'Empty and ready for the next resident.' : tenants.map(tenant => tenant.name).join(' · ')}</p>
        <Button variant="outline" className="mt-5 w-full" disabled={!isEmpty} aria-label={`${room.status === 'maintenance' ? 'Make available' : 'Set maintenance'} for room ${room.name}`} onClick={() => { dispatch({ type: 'room/statusToggled', roomId: room.id }); setNotice(`Room ${room.name} ${room.status === 'maintenance' ? 'made available' : 'set to maintenance'}.`); }}>{room.status === 'maintenance' ? 'Make available' : 'Set maintenance'}</Button>
        {!isEmpty && <p className="mt-2 text-center text-xs text-muted-foreground">Only empty rooms can change status.</p>}
      </CardContent></Card>
    })}</div>}
  </>
}
