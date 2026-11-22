import { useState } from 'react'
import { DoorOpen, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePrototype } from '@/hooks/use-prototype'
import { DEMO_DATE } from '@/data/fixtures/demo'
import { formatDate } from '@/lib/format'
import type { Room, RoomChangeRequest } from '@/domain/types/models'
import { cancelRoomChangeRequest, roomChangeRequestsForTenant } from '@/domain/calculations/room-change-requests'
import { RoomChangeRequestDialog } from './room-change-request-dialog'

const statusLabels: Record<RoomChangeRequest['status'], string> = {
  PENDING: 'Pending landlord review', APPROVED: 'Approved', REJECTED: 'Not approved',
  CANCELLED: 'Cancelled', EXPIRED: 'Expired',
}

export function RoomChangeRequestSection({ tenantId, room }: { tenantId: string; room: Room }) {
  const { data, dispatch, persistSnapshot } = usePrototype()
  const [saving, setSaving] = useState(false)
  const [requestOpen, setRequestOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const requests = roomChangeRequestsForTenant(data, tenantId)
  const latest = requests[0] ?? null
  const pending = latest?.status === 'PENDING' ? latest : null
  const roomName = (id: string) => data.rooms.find(item => item.id === id)?.name ?? 'Room needs review'
  async function cancel(requestId: string) {
    if (saving) return
    const result = cancelRoomChangeRequest(data, requestId, tenantId, 'Cancelled by tenant.', DEMO_DATE)
    if (!result.ok) { setNotice(result.errors.general ?? 'The request could not be cancelled.'); return }
    setSaving(true)
    const warning = await persistSnapshot(result.data)
    setSaving(false)
    if (warning) { setNotice(`Request was not cancelled. ${warning}`); return }
    dispatch({ type: 'roomChange/cancelled', requestId, tenantId, reason: 'Cancelled by tenant.' })
    setNotice('Your room change request was cancelled. No tenancy or financial record changed.')
  }

  return <section className="room-change-section" aria-labelledby="room-change-title">
    <div className="room-change-heading">
      <div><h2 id="room-change-title">Request a room change</h2><p>Requests are reviewed by the landlord. A request does not reserve a room or change your current tenancy.</p></div>
      {!pending && <Button type="button" variant="outline" onClick={() => setRequestOpen(true)}><Plus aria-hidden="true" />Request a room change</Button>}
    </div>
    {notice && <p role="status" className="room-change-notice">{notice}</p>}
    {pending ? <article className="room-change-card" aria-label="Pending room change request">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><span className="room-change-status" data-status="PENDING">{statusLabels.PENDING}</span><p className="mt-3 font-semibold">Room {roomName(pending.currentRoomId)} → Room {roomName(pending.requestedRoomId)}</p></div><p className="text-sm text-muted-foreground">Requested {formatDate(pending.requestedStartDate)}</p></div>
      <p className="mt-3 text-sm text-muted-foreground">Reason: {pending.reason}</p>
      <p className="mt-2 text-xs text-muted-foreground">Submitted {formatDate(pending.createdAt)}. The landlord may adjust the effective date during approval.</p>
      <Button type="button" variant="outline" className="mt-4" disabled={saving} onClick={() => cancel(pending.id)}>{saving ? 'Cancelling�' : 'Cancel request'}</Button>
    </article> : latest ? <div className="room-change-card">
      <span className="room-change-status" data-status={latest.status}>{statusLabels[latest.status]}</span>
      <p className="mt-3 font-semibold">Room {roomName(latest.currentRoomId)} → Room {roomName(latest.requestedRoomId)}</p>
      <p className="mt-2 text-sm text-muted-foreground">Requested {formatDate(latest.requestedStartDate)}{latest.decidedAt ? ` · Reviewed ${formatDate(latest.decidedAt)}` : ''}</p>
      {latest.decisionReason && <p className="mt-2 text-sm text-muted-foreground">Landlord note: {latest.decisionReason}</p>}
      {latest.status === 'APPROVED' && latest.approvedStartDate && <p className="mt-2 text-xs text-muted-foreground">Approved effective {formatDate(latest.approvedStartDate)}. Historical bills and receipts are unchanged.</p>}
    </div> : <p className="room-change-empty"><DoorOpen aria-hidden="true" />No room change requests yet. Your current room is Room {room.name}.</p>}
    {requestOpen && <RoomChangeRequestDialog tenantId={tenantId} room={room} onClose={() => setRequestOpen(false)} onSaved={message => { setNotice(message); setRequestOpen(false) }} />}
  </section>
}
