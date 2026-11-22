import { DoorOpen, WashingMachine } from 'lucide-react'
import { PageHeader } from '@/components/shared/page'
import { EmptyState } from '@/components/shared/states'
import { StatusBadge } from '@/components/shared/status-badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { usePrototype } from '@/hooks/use-prototype'
import { useOccupancyDate } from '@/hooks/use-occupancy-date'
import { useTenantDemo } from '@/app/providers/tenant-demo'
import { roomOccupancy } from '@/domain/calculations/summary'
import { formatDate } from '@/lib/format'
import { selectTenantPersona } from './tenant-persona'
import { RoomChangeRequestSection } from './room-change-request-status'

const occupancyLabels = { OCCUPIED: 'Occupied', RESERVED: 'Reserved', AVAILABLE: 'Available', UNDER_REPAIR: 'Under repair' } as const

/** Layout-phase room summary; service requests and management arrive in a later phase. */
export default function TenantRoom() {
  const { data } = usePrototype()
  const { tenantId } = useTenantDemo()
  const occupancyDate = useOccupancyDate()
  const persona = selectTenantPersona(data, tenantId, occupancyDate)
  const room = persona?.room ?? null
  const assignment = persona?.assignment ?? null
  const movedOut = persona?.tenant.status === 'MOVED_OUT'

  return <>
    <PageHeader title="My Room" description="Your room and stay details at Halili BH." />
    {!room || !assignment ? <EmptyState
      title={movedOut ? 'Moved out of Halili BH' : 'No room to show'}
      description={movedOut
        ? 'This tenant no longer has an active room assignment. Historical room details arrive in a later phase.'
        : 'The selected tenant does not have an active room assignment yet.'}
    /> : <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><DoorOpen className="size-5 text-[var(--tint)]" aria-hidden="true" />Room {room.name} at a glance</CardTitle>
        <CardDescription>Existing details for the room you are staying in.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="room-details-grid">
          <div><dt>Room number</dt><dd>Room {room.name}</dd></div>
          <div><dt>Floor</dt><dd>Floor {room.floor}</dd></div>
          <div><dt>Stay started</dt><dd>{formatDate(assignment.startDate)}</dd></div>
          <div><dt>Room status</dt><dd><StatusBadge status={occupancyLabels[roomOccupancy(data, room, occupancyDate)]} /></dd></div>
          <div><dt>Room type</dt><dd>{room.kind === 'SHARED' ? 'Shared-capacity room' : 'Private room'}</dd></div>
          <div><dt>Number of beds</dt><dd>{room.capacity} {room.capacity === 1 ? 'bed' : 'beds'}</dd></div>
          <div><dt>Washing machine</dt><dd className="flex items-center justify-end gap-2"><WashingMachine className="size-4 text-muted-foreground" aria-hidden="true" />{room.washingMachineEnabled ? 'Included' : 'Not subscribed'}</dd></div>
        </dl>
      </CardContent>
    </Card>}
    {room && persona && <div className="mt-6"><RoomChangeRequestSection tenantId={persona.tenant.id} room={room} /></div>}
    {room && <div className="mt-6"><EmptyState title="More room details are coming soon" description="Maintenance requests and additional stay details arrive in a later phase. The landlord workspace still manages rooms for now." /></div>}
  </>
}
