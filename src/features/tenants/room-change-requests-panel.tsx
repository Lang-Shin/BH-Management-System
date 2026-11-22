import { useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PaginatedDataTable } from '@/components/shared/table-pagination'
import { usePrototype } from '@/hooks/use-prototype'
import { OCCUPANCY_DATE } from '@/data/fixtures/demo'
import { formatDate, formatMoney } from '@/lib/format'
import type { RoomChangeRequest } from '@/domain/types/models'
import { activeAssignments } from '@/domain/calculations/summary'
import {
  approveRoomChangeRequest, pendingRoomChangeRequests, rejectRoomChangeRequest, roomChangeFinancialWarnings,
} from '@/domain/calculations/room-change-requests'

const statusLabels: Record<RoomChangeRequest['status'], string> = {
  PENDING: 'PENDING', APPROVED: 'APPROVED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED', EXPIRED: 'EXPIRED',
}

function RoomChangeReviewDialog({ request, onClose, onNotice }: {
  request: RoomChangeRequest
  onClose: () => void
  onNotice: (message: string) => void
}) {
  const { data, dispatch, persistSnapshot } = usePrototype()
  const [mode, setMode] = useState<'approve' | 'reject'>('approve')
  const [effectiveDate, setEffectiveDate] = useState(request.requestedStartDate >= OCCUPANCY_DATE ? request.requestedStartDate : OCCUPANCY_DATE)
  const [note, setNote] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const tenant = data.tenants.find(item => item.id === request.tenantId)
  const fromRoom = data.rooms.find(item => item.id === request.currentRoomId)
  const toRoom = data.rooms.find(item => item.id === request.requestedRoomId)
  const warnings = toRoom ? roomChangeFinancialWarnings(data, request.tenantId, toRoom.id, effectiveDate) : null
  const requiresAcknowledgment = Boolean(warnings?.billingReviewRequired)
  const targetOccupants = toRoom
    ? new Set(activeAssignments(data, effectiveDate)
      .filter(item => item.roomId === toRoom.id && item.tenantId !== request.tenantId)
      .map(item => item.tenantId)).size
    : 0

  async function approve() {
    if (saving) return
    const result = approveRoomChangeRequest(data, request.id, {
      effectiveDate, note, billingReviewAcknowledged: acknowledged, decidedAt: OCCUPANCY_DATE,
    })
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setSaving(true)
    const warning = await persistSnapshot(result.data)
    setSaving(false)
    if (warning) {
      setErrors({ general: `Request was not saved. ${warning}` })
      return
    }
    dispatch({ type: 'roomChange/approved', requestId: request.id, effectiveDate, note, billingReviewAcknowledged: acknowledged, decidedAt: OCCUPANCY_DATE })
    onNotice(`Room change approved for ${tenant?.name ?? 'tenant'} effective ${formatDate(effectiveDate)}. Historical records were preserved.`)
    onClose()
  }

  async function reject() {
    if (saving) return
    const result = rejectRoomChangeRequest(data, request.id, note, OCCUPANCY_DATE)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setSaving(true)
    const warning = await persistSnapshot(result.data)
    setSaving(false)
    if (warning) {
      setErrors({ general: `Request was not saved. ${warning}` })
      return
    }
    dispatch({ type: 'roomChange/rejected', requestId: request.id, reason: note.trim(), decidedAt: OCCUPANCY_DATE })
    onNotice(`Room change request for ${tenant?.name ?? 'tenant'} was rejected. No tenancy or financial record changed.`)
    onClose()
  }

  return <Dialog open onOpenChange={next => { if (!next) onClose() }}>
    <DialogContent className="max-h-[88dvh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Review room change request</DialogTitle>
        <DialogDescription>{tenant?.name ?? 'Tenant'} · submitted {formatDate(request.createdAt)}</DialogDescription>
      </DialogHeader>
      <section className="room-change-review-summary">
        <div><span>Current room</span><strong>Room {fromRoom?.name ?? 'Needs review'} · {formatMoney(data.roomAssignments.find(item => item.id === request.currentAssignmentId)?.agreedRentCents ?? 0)}/month</strong></div>
        <div><span>Requested room</span><strong>Room {toRoom?.name ?? 'Needs review'}{warnings ? ` · ${formatMoney(warnings.targetRentCents)}/month` : ''}</strong></div>
        <div><span>Tenant's requested date</span><strong>{formatDate(request.requestedStartDate)}</strong></div>
        {toRoom && <div><span>Target availability on effective date</span><strong>Room {toRoom.name} · {targetOccupants}/{toRoom.capacity} occupied</strong></div>}
        <div><span>Reason</span><strong>{request.reason}</strong></div>
      </section>
      {warnings && <div className="room-change-warnings" role="note">
        <p className="font-semibold">Financial review</p>
        <dl>
          <div><dt>Rent difference</dt><dd>{warnings.rentDifferenceCents === 0 ? 'No change' : `${warnings.rentDifferenceCents > 0 ? '+' : '−'}${formatMoney(Math.abs(warnings.rentDifferenceCents))}`}</dd></div>
          {warnings.depositTopUpProposalCents > 0 && <div><dt>Deposit top-up proposal</dt><dd>{formatMoney(warnings.depositTopUpProposalCents)} · not posted</dd></div>}
          {warnings.outstandingCents > 0 && <div><dt>Outstanding balance</dt><dd>{formatMoney(warnings.outstandingCents)}</dd></div>}
          {warnings.creditCents > 0 && <div><dt>Held advance</dt><dd>{formatMoney(warnings.creditCents)}</dd></div>}
        </dl>
        <ul>{warnings.notes.map(item => <li key={item}>{item}</li>)}</ul>
      </div>}
      <div className="flex gap-2" role="group" aria-label="Decision">
        <Button type="button" variant={mode === 'approve' ? 'default' : 'outline'} onClick={() => { setMode('approve'); setErrors({}) }}>Approve</Button>
        <Button type="button" variant={mode === 'reject' ? 'destructive' : 'outline'} onClick={() => { setMode('reject'); setErrors({}) }}>Reject</Button>
      </div>
      {mode === 'approve' && <div className="grid gap-4">
        <label className="grid gap-2 text-sm font-semibold">Effective move date
          <input type="date" min={OCCUPANCY_DATE} value={effectiveDate} onChange={event => { setEffectiveDate(event.target.value); setAcknowledged(false); setErrors({}) }} className="min-h-12 rounded-xl border border-input bg-card px-3" aria-invalid={Boolean(errors.startDate)} />
        </label>
        <label className="grid gap-2 text-sm font-semibold">Decision note (optional)
          <textarea rows={3} maxLength={500} value={note} onChange={event => setNote(event.target.value)} className="w-full rounded-xl border border-input bg-card p-3" />
        </label>
        {requiresAcknowledgment && <label className="flex items-start gap-3 rounded-xl border bg-muted/40 p-3 text-sm">
          <input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />
          <span>I reviewed the outstanding balance, advance credit, rent difference, deposit top-up proposal, and mid-period billing effect. No financial adjustment will be posted automatically.</span>
        </label>}
        {errors.general && <p role="alert" className="text-sm text-destructive">{errors.general}</p>}
        {errors.startDate && <p role="alert" className="text-sm text-destructive">{errors.startDate}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="button" onClick={approve} disabled={(requiresAcknowledgment && !acknowledged) || saving} aria-busy={saving}><Check aria-hidden="true" />{saving ? 'Saving…' : 'Approve transfer'}</Button>
        </DialogFooter>
      </div>}
      {mode === 'reject' && <div className="grid gap-4">
        <label className="grid gap-2 text-sm font-semibold">Rejection reason
          <textarea rows={3} maxLength={500} value={note} onChange={event => { setNote(event.target.value); setErrors({}) }} className="w-full rounded-xl border border-input bg-card p-3" aria-invalid={Boolean(errors.reason)} />
        </label>
        {errors.reason && <p role="alert" className="text-sm text-destructive">{errors.reason}</p>}
        {errors.general && <p role="alert" className="text-sm text-destructive">{errors.general}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="button" variant="destructive" onClick={reject} disabled={saving} aria-busy={saving}><X aria-hidden="true" />{saving ? 'Saving…' : 'Reject request'}</Button>
        </DialogFooter>
      </div>}
    </DialogContent>
  </Dialog>
}

export function RoomChangeRequestsPanel({ onNotice }: { onNotice: (message: string) => void }) {
  const { data } = usePrototype()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const pending = pendingRoomChangeRequests(data)
  const requests = [...data.roomChangeRequests].sort((a, b) => {
    if (a.status === 'PENDING' && b.status !== 'PENDING') return -1
    if (b.status === 'PENDING' && a.status !== 'PENDING') return 1
    return b.createdAt.localeCompare(a.createdAt)
  })
  const selected = selectedId ? requests.find(item => item.id === selectedId) : undefined
  return <section className="room-change-panel" aria-label="Room change request queue">
    <div className="room-change-panel-heading">
      <div><h2 id="room-change-requests-title">Room change requests</h2><p>Review tenant requests before changing any assignment. Approval rechecks room availability.</p></div>
      <span className="room-change-panel-count">{pending.length} pending</span>
    </div>
    {requests.length === 0
      ? <p className="room-change-empty">No room change requests have been submitted.</p>
      : <PaginatedDataTable rows={requests} resetKey={requests.length} recordLabel="room change requests" caption="Room change requests" columns={[
        { key: 'tenant', label: 'Tenant', render: request => <span className="font-semibold">{data.tenants.find(item => item.id === request.tenantId)?.name ?? 'Tenant needs review'}</span> },
        { key: 'rooms', label: 'Room change', render: request => <span>Room {data.rooms.find(item => item.id === request.currentRoomId)?.name ?? '—'} → Room {data.rooms.find(item => item.id === request.requestedRoomId)?.name ?? '—'}</span> },
        { key: 'date', label: 'Requested date', render: request => formatDate(request.requestedStartDate) },
        { key: 'status', label: 'Status', render: request => <span className="room-change-status" data-status={request.status}>{statusLabels[request.status]}</span> },
        { key: 'action', label: '', align: 'right', render: request => request.status === 'PENDING'
          ? <Button variant="outline" onClick={event => { trigger.current = event.currentTarget; setSelectedId(request.id) }} aria-label={`Review room change request from ${data.tenants.find(item => item.id === request.tenantId)?.name ?? 'tenant'}`}>Review</Button>
          : <span className="text-xs text-muted-foreground">{request.decidedAt ? formatDate(request.decidedAt) : '—'}</span> },
      ]} />}
    {selected && <RoomChangeReviewDialog key={selected.id} request={selected} onClose={() => { setSelectedId(null); window.setTimeout(() => trigger.current?.focus(), 0) }} onNotice={onNotice} />}
  </section>
}
