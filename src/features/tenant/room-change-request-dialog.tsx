import { useState, type FormEvent } from 'react'
import { ArrowRight, DoorOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { usePrototype } from '@/hooks/use-prototype'
import { useOccupancyDate } from '@/hooks/use-occupancy-date'
import { formatMoney } from '@/lib/format'
import { roomCategoryLabel } from '@/lib/room-rates'
import { roomMonthlyRentCents } from '@/domain/calculations/billing-rates'
import { eligibleRoomChangeTargets, roomChangeFinancialWarnings, submitRoomChangeRequest, type RoomChangeRequestDraft, type RoomChangeRequestErrors } from '@/domain/calculations/room-change-requests'
import { activeAssignments } from '@/domain/calculations/summary'
import type { Room } from '@/domain/types/models'

export function RoomChangeRequestDialog({ tenantId, room, onClose, onSaved }: {
  tenantId: string
  room: Room
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const { data, dispatch, persistSnapshot } = usePrototype()
  const occupancyDate = useOccupancyDate()
  const [requestedRoomId, setRequestedRoomId] = useState('')
  const [requestedStartDate, setRequestedStartDate] = useState(occupancyDate)
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<RoomChangeRequestErrors>({})
  const [saving, setSaving] = useState(false)
  const targets = eligibleRoomChangeTargets(data, tenantId, requestedStartDate)
  const target = targets.find(item => item.id === requestedRoomId)
  const assignment = activeAssignments(data, occupancyDate).find(item => item.tenantId === tenantId)
  const warnings = target ? roomChangeFinancialWarnings(data, tenantId, target.id, requestedStartDate) : null

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    if (!requestedRoomId) {
      setErrors({ roomId: 'Choose the room you want to move to.' })
      return
    }
    const draft: RoomChangeRequestDraft = { tenantId, requestedRoomId, requestedStartDate, reason }
    const result = submitRoomChangeRequest(data, draft, occupancyDate)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setSaving(true)
    setErrors({})
    const warning = await persistSnapshot(result.data)
    setSaving(false)
    if (warning) {
      setErrors({ general: `Request was not saved. ${warning}` })
      return
    }
    dispatch({ type: 'roomChange/requested', draft: { ...draft, requestId: result.request.id }, asOf: occupancyDate })
    onSaved('Room change request submitted. The landlord must review it before any transfer occurs.')
    onClose()
  }

  return <Dialog open onOpenChange={next => { if (!next) onClose() }}>
    <DialogContent className="room-change-dialog">
      <form onSubmit={submit} noValidate className="grid gap-5">
        <DialogHeader><DialogTitle>Request a room change</DialogTitle><DialogDescription>Your request does not reserve a room or change your current tenancy. The landlord must approve it first.</DialogDescription></DialogHeader>
        <div className="room-change-current"><DoorOpen aria-hidden="true" /><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current room</p><p className="mt-1 font-semibold">Room {room.name} · {formatMoney(assignment?.agreedRentCents ?? 0)}/month</p></div></div>
        <div className="grid gap-2">
          <label htmlFor="room-change-target" className="text-sm font-semibold">Room you want</label>
          <select id="room-change-target" value={requestedRoomId} onChange={event => { setRequestedRoomId(event.target.value); setErrors({}) }} className="min-h-12 rounded-xl border border-input bg-card px-3" aria-invalid={Boolean(errors.roomId)} aria-describedby={errors.roomId ? 'room-change-target-error' : undefined}>
            <option value="">Choose an available room</option>
            {targets.map(item => <option key={item.id} value={item.id}>Room {item.name} · {roomCategoryLabel(item.categoryId)} · {formatMoney(roomMonthlyRentCents(data, item, requestedStartDate))}/month</option>)}
          </select>
          {errors.roomId && <p id="room-change-target-error" role="alert" className="text-sm text-destructive">{errors.roomId}</p>}
        </div>
        <div className="grid gap-2">
          <label htmlFor="room-change-date" className="text-sm font-semibold">Requested move date</label>
          <input id="room-change-date" type="date" min={occupancyDate} value={requestedStartDate} onChange={event => { setRequestedStartDate(event.target.value); setErrors({}) }} className="min-h-12 rounded-xl border border-input bg-card px-3" aria-invalid={Boolean(errors.startDate)} aria-describedby={errors.startDate ? 'room-change-date-error' : undefined} />
          {errors.startDate && <p id="room-change-date-error" role="alert" className="text-sm text-destructive">{errors.startDate}</p>}
          <p className="text-xs text-muted-foreground">The landlord may adjust this date during review. The app has no automatic proration rule.</p>
        </div>
        <div className="grid gap-2">
          <label htmlFor="room-change-reason" className="text-sm font-semibold">Reason</label>
          <textarea id="room-change-reason" rows={3} maxLength={500} value={reason} onChange={event => { setReason(event.target.value); setErrors({}) }} placeholder="Explain briefly why you want to move." className="min-h-24 w-full resize-y rounded-xl border border-input bg-card p-3" aria-invalid={Boolean(errors.reason)} aria-describedby={errors.reason ? 'room-change-reason-error' : undefined} />
          <p className="text-right text-xs text-muted-foreground">{reason.length} / 500 characters</p>
          {errors.reason && <p id="room-change-reason-error" role="alert" className="text-sm text-destructive">{errors.reason}</p>}
        </div>
        {warnings && <div className="room-change-warnings" role="note"><p className="font-semibold">Before you submit</p><dl><div><dt>Target rent</dt><dd>{formatMoney(warnings.targetRentCents)}/month</dd></div><div><dt>Rent difference</dt><dd>{warnings.rentDifferenceCents === 0 ? 'No change' : `${warnings.rentDifferenceCents > 0 ? '+' : '−'}${formatMoney(Math.abs(warnings.rentDifferenceCents))}`}</dd></div>{warnings.outstandingCents > 0 && <div><dt>Outstanding balance</dt><dd>{formatMoney(warnings.outstandingCents)}</dd></div>}{warnings.creditCents > 0 && <div><dt>Held advance</dt><dd>{formatMoney(warnings.creditCents)}</dd></div>}</dl><ul>{warnings.notes.map(note => <li key={note}>{note}</li>)}</ul></div>}
        {errors.general && <p role="alert" className="text-sm text-destructive">{errors.general}</p>}
        <DialogFooter className="room-change-dialog-footer"><Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button><Button type="submit" disabled={saving} aria-busy={saving}>{saving ? 'Submitting…' : <><ArrowRight aria-hidden="true" />Submit request</>}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}
