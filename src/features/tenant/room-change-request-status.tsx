import { useState } from 'react'
import { DoorOpen, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePrototype } from '@/hooks/use-prototype'
import { useOccupancyDate } from '@/hooks/use-occupancy-date'
import { formatDate } from '@/lib/format'
import type { Room, RoomChangeRequest } from '@/domain/types/models'
import { cancelRoomChangeRequest, roomChangeRequestsForTenant } from '@/domain/calculations/room-change-requests'
import { RoomChangeRequestDialog } from './room-change-request-dialog'

const statusLabels: Record<RoomChangeRequest['status'], string> = {
  PENDING: 'Pending landlord review', APPROVED: 'Approved', REJECTED: 'Not approved',
  CANCELLED: 'Cancelled', EXPIRED: 'Expired',
}

function RequestTimeline({ request, periods, asOf }: { request: RoomChangeRequest; periods: string[]; asOf: string }) {
  const effective = request.status === 'APPROVED' && Boolean(request.approvedStartDate && request.approvedStartDate <= asOf)
  const decisionLabel = request.status === 'APPROVED' ? 'Approved'
    : request.status === 'REJECTED' ? 'Not approved'
      : request.status === 'CANCELLED' ? 'Cancelled'
        : request.status === 'EXPIRED' ? 'Expired' : 'Awaiting landlord review'
  return <ol className="room-change-timeline" aria-label="Room change request status timeline">
    <li data-state="DONE"><strong>Request submitted</strong><span>{formatDate(request.createdAt)}</span></li>
    <li data-state={request.status === 'PENDING' ? 'CURRENT' : 'DONE'}><strong>{request.status === 'PENDING' ? 'Awaiting landlord review' : 'Landlord review completed'}</strong><span>{request.decidedAt ? formatDate(request.decidedAt) : 'Pending'}</span></li>
    {request.status !== 'PENDING' && <li data-state="CURRENT"><strong>{decisionLabel}</strong>{request.decisionReason && <span>{request.decisionReason}</span>}</li>}
    {request.status === 'APPROVED' && request.approvedStartDate && (effective
      ? <li data-state="DONE"><strong>Effective</strong><span>{formatDate(request.approvedStartDate)}</span></li>
      : <li data-state="SCHEDULED"><strong>Scheduled</strong><span>Effective {formatDate(request.approvedStartDate)}</span></li>)}
    {periods.length > 0 && <li data-state="REVIEW"><strong>Billing review flagged</strong><span>{periods.join(', ')}</span></li>}
  </ol>
}

export function RoomChangeRequestSection({ tenantId, room }: { tenantId: string; room: Room }) {
  const { data, dispatch, persistSnapshot } = usePrototype()
  const occupancyDate = useOccupancyDate()
  const [saving, setSaving] = useState(false)
  const [requestOpen, setRequestOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const requests = roomChangeRequestsForTenant(data, tenantId)
  const latest = requests[0] ?? null
  const pending = latest?.status === 'PENDING' ? latest : null
  const previous = requests.slice(1)
  const roomName = (id: string) => data.rooms.find(item => item.id === id)?.name ?? 'Room needs review'
  const periodNames = (ids: string[]) => ids.map(id => data.billingPeriods.find(period => period.id === id)?.label).filter((label): label is string => Boolean(label))

  async function cancel(requestId: string) {
    if (saving) return
    const result = cancelRoomChangeRequest(data, requestId, tenantId, 'Cancelled by tenant.', occupancyDate)
    if (!result.ok) {
      setNotice(result.errors.general ?? 'The request could not be cancelled.')
      return
    }
    setSaving(true)
    const warning = await persistSnapshot(result.data)
    setSaving(false)
    if (warning) {
      setNotice(`Request was not cancelled. ${warning}`)
      return
    }
    dispatch({ type: 'roomChange/cancelled', requestId, tenantId, reason: 'Cancelled by tenant.', asOf: occupancyDate })
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
      <RequestTimeline request={pending} periods={periodNames(pending.billingReviewPeriodIds)} asOf={occupancyDate} />
      <Button type="button" variant="outline" className="mt-4" disabled={saving} onClick={() => cancel(pending.id)}>{saving ? 'Cancelling…' : 'Cancel request'}</Button>
    </article> : latest ? <div className="room-change-card">
      <span className="room-change-status" data-status={latest.status}>{statusLabels[latest.status]}</span>
      <p className="mt-3 font-semibold">Room {roomName(latest.currentRoomId)} → Room {roomName(latest.requestedRoomId)}</p>
      <p className="mt-2 text-sm text-muted-foreground">Requested {formatDate(latest.requestedStartDate)}</p>
      <RequestTimeline request={latest} periods={periodNames(latest.billingReviewPeriodIds)} asOf={occupancyDate} />
      {latest.status === 'APPROVED' && latest.approvedStartDate && <p className="mt-2 text-xs text-muted-foreground">Historical bills and receipts remain unchanged. Billing periods flagged for manual review are listed above.</p>}
    </div> : <p className="room-change-empty"><DoorOpen aria-hidden="true" />No room change requests yet. Your current room is Room {room.name}.</p>}
    {previous.length > 0 && <details className="mt-4"><summary className="cursor-pointer text-sm font-semibold">Previous requests ({previous.length})</summary><ul className="mt-3 grid gap-2">{previous.map(request => <li key={request.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm"><span>Room {roomName(request.currentRoomId)} → Room {roomName(request.requestedRoomId)} · requested {formatDate(request.requestedStartDate)}</span><span className="text-muted-foreground">{statusLabels[request.status]}{request.decidedAt ? ` · ${formatDate(request.decidedAt)}` : ''}</span></li>)}</ul></details>}
    {requestOpen && <RoomChangeRequestDialog tenantId={tenantId} room={room} onClose={() => setRequestOpen(false)} onSaved={message => { setNotice(message); setRequestOpen(false) }} />}
  </section>
}
