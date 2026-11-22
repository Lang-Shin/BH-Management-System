import { useRef, useState, type FormEvent } from 'react'
import { Check, DoorOpen, Pencil, Trash2, WashingMachine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useAnimatedDialogClose } from '@/components/ui/use-animated-dialog-close'
import { StatusBadge } from '@/components/shared/status-badge'
import { usePrototype } from '@/hooks/use-prototype'
import { useOccupancyDate } from '@/hooks/use-occupancy-date'
import { roomOccupancy, roomOccupants } from '@/domain/calculations/summary'
import { RoomElectricityMeter } from './room-electricity-meter'
import { roomDeletionBlockers, validateRoomDraft, type RoomDraft, type RoomDraftErrors } from '@/domain/calculations/room-management'
import { futureRoomReservations } from '@/domain/calculations/room-capacity'
import { activeRoomRentRate, activeWashingRate, roomMonthlyRentCents, ROOM_RATE_CATEGORY_IDS } from '@/domain/calculations/billing-rates'
import { formatDate, formatMoney } from '@/lib/format'
import { roomCategoryLabel } from '@/lib/room-rates'
import type { RoomCategoryId } from '@/domain/types/models'

const statusLabels = { OCCUPIED: 'Occupied', RESERVED: 'Reserved', AVAILABLE: 'Available', UNDER_REPAIR: 'Under repair' } as const
const fieldClass = 'h-12 w-full rounded-xl border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50'

export function RoomDetailsDialog({ roomId, onClose, onReturnFocus, onNotice }: {
  roomId: string
  onClose: () => void
  onReturnFocus: () => void
  onNotice: (message: string) => void
}) {
  const { data, dispatch } = usePrototype()
  const occupancyDate = useOccupancyDate()
  const room = data.rooms.find(item => item.id === roomId)
  const [washingEnabled, setWashingEnabled] = useState(room?.washingMachineEnabled ?? false)
  const [saving, setSaving] = useState(false)
  const [mode, setMode] = useState<'details' | 'edit' | 'delete'>('details')
  const [name, setName] = useState(room?.name ?? '')
  const [capacity, setCapacity] = useState(String(room?.capacity ?? 1))
  const [categoryId, setCategoryId] = useState<RoomCategoryId>(room?.categoryId ?? 'RATE_3500')
  const [kind, setKind] = useState<RoomDraft['kind']>(room?.kind ?? 'PRIVATE')
  const [roomStatus, setRoomStatus] = useState<RoomDraft['status']>(room?.status ?? 'available')
  const [errors, setErrors] = useState<RoomDraftErrors>({})
  const [deleting, setDeleting] = useState(false)
  const submitting = useRef(false)
  const { open, requestClose, onOpenChange, onAnimationEnd } = useAnimatedDialogClose(onClose)
  if (!room) return null

  const status = roomOccupancy(data, room, occupancyDate)
  const tenants = roomOccupants(data, room.id, occupancyDate)
  const reservations = futureRoomReservations(data, room.id, occupancyDate)
  const monthlyRentCents = roomMonthlyRentCents(data, room, occupancyDate)
  const washingRateCents = activeWashingRate(data, occupancyDate)?.rateCents ?? null
  const dirty = washingEnabled !== room.washingMachineEnabled
  const deleteBlockers = roomDeletionBlockers(data, room.id, occupancyDate)

  function save() {
    if (!dirty || saving) return
    setSaving(true)
    dispatch({ type: 'room/washingMachineUpdated', roomId: room!.id, enabled: washingEnabled })
    onNotice(`Room ${room!.name} washing-machine service is now ${washingEnabled ? 'enabled' : 'disabled'} for future applicable billing periods.`)
    requestClose()
  }

  function startEdit() {
    if (dirty) return
    submitting.current = false
    setName(room!.name)
    setCapacity(String(room!.capacity))
    setCategoryId(room!.categoryId)
    setKind(room!.kind)
    setRoomStatus(room!.status)
    setErrors({})
    setMode('edit')
  }

  function saveRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    const draft: RoomDraft = { name, capacity: capacity.trim() === '' ? null : Number(capacity), categoryId, kind, status: roomStatus }
    const nextErrors = validateRoomDraft(data, draft, { roomId: room!.id, asOf: occupancyDate })
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    submitting.current = true
    dispatch({ type: 'room/updated', roomId: room!.id, draft })
    onNotice(`Room ${name.trim()} was updated.`)
    setMode('details')
  }

  function confirmDelete() {
    if (deleting || submitting.current || roomDeletionBlockers(data, room!.id, occupancyDate).length > 0) return
    submitting.current = true
    setDeleting(true)
    dispatch({ type: 'room/deleted', roomId: room!.id })
    onNotice(`Room ${room!.name} was deleted.`)
    requestClose()
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="room-details-dialog sm:max-w-2xl" onAnimationEnd={onAnimationEnd} onCloseAutoFocus={event => { event.preventDefault(); onReturnFocus() }}>
      {mode === 'details' && <>
        <DialogHeader className="room-details-heading pr-6">
          <span className="room-details-icon"><DoorOpen aria-hidden="true" /></span>
          <DialogTitle>Room {room.name}</DialogTitle>
          <DialogDescription>{formatMoney(monthlyRentCents)}/month · {statusLabels[status]}</DialogDescription>
          <div><StatusBadge status={statusLabels[status]} /></div>
        </DialogHeader>

        <section className="room-details-section" aria-labelledby="room-information-title">
          <h2 id="room-information-title">Room information</h2>
          <dl className="room-details-grid">
            <div><dt>Room number</dt><dd>{room.name}</dd></div>
            <div><dt>Monthly rental rate</dt><dd>{formatMoney(monthlyRentCents)}/month</dd></div>
            <div><dt>Floor</dt><dd>{room.floor}</dd></div>
            <div><dt>Number of beds</dt><dd>{room.capacity}</dd></div>
            <div><dt>Room type</dt><dd>{room.kind === 'SHARED' ? 'Shared-capacity room' : 'Private room'}</dd></div>
            <div><dt>Rental category</dt><dd>{roomCategoryLabel(room.categoryId)}</dd></div>
            <div><dt>Maximum occupancy</dt><dd>{room.capacity} {room.capacity === 1 ? 'tenant' : 'tenants'}</dd></div>
            <div><dt>Current occupancy</dt><dd>{tenants.length} {tenants.length === 1 ? 'tenant' : 'tenants'}</dd></div>
            <div><dt>Room status</dt><dd>{statusLabels[status]}</dd></div>
          </dl>
          {status !== 'OCCUPIED' && status !== 'RESERVED' && <><Button variant="outline" className="mt-4" onClick={() => {
            dispatch({ type: 'room/statusToggled', roomId: room.id, asOf: occupancyDate })
            onNotice(`Room ${room.name} is now ${status === 'UNDER_REPAIR' ? 'available' : 'under repair'}.`)
          }}>{status === 'UNDER_REPAIR' ? 'Mark as available' : 'Needs repair'}</Button><p className="mt-2 text-xs text-muted-foreground">Room status changes apply immediately; Cancel only discards unsaved washing-machine changes.</p></>}
          <div className="room-details-management">
            <Button type="button" variant="outline" onClick={startEdit} disabled={dirty}><Pencil aria-hidden="true" />Edit Room</Button>
            <Button type="button" variant="outline" className="text-destructive hover:text-destructive" onClick={() => { submitting.current = false; setErrors({}); setMode('delete') }} disabled={dirty}><Trash2 aria-hidden="true" />Delete Room</Button>
          </div>
          {dirty && <p className="mt-2 text-xs text-muted-foreground">Save or cancel the washing-machine change before editing or deleting this room.</p>}
        </section>

        <section className="room-details-section" aria-labelledby="room-tenants-title">
          <h2 id="room-tenants-title">Tenants</h2>
          {tenants.length > 0 ? <ul className="room-details-tenants">{tenants.map(tenant => <li key={tenant.id}><span className="font-semibold">{tenant.name}</span><span className="text-xs text-muted-foreground">{tenant.status === 'ACTIVE' ? 'Current tenant' : 'Moved out'}</span></li>)}</ul> : <p className="room-details-empty">No tenants are currently assigned.</p>}
        </section>

        <section className="room-details-section" aria-labelledby="room-reservations-title">
          <h2 id="room-reservations-title">Upcoming reservations</h2>
          {reservations.length > 0
            ? <ul className="room-details-tenants">{reservations.map(reservation => <li key={reservation.assignment.id}><span className="font-semibold">{reservation.tenant.name}</span><span className="text-xs text-muted-foreground">Effective {formatDate(reservation.effectiveDate)}</span></li>)}</ul>
            : <p className="room-details-empty">No approved future reservations.</p>}
          {reservations.length > 0 && <p className="mt-3 text-xs text-muted-foreground">Reservations come from approved future transfer assignments and are not counted as current occupants.</p>}
        </section>

        <section className="room-details-section" aria-labelledby="room-washing-title">
          <h2 id="room-washing-title" className="flex items-center gap-2"><WashingMachine className="size-5" aria-hidden="true" />Washing machine</h2>
          <label className="room-details-check">
            <input type="checkbox" checked={washingEnabled} onChange={event => setWashingEnabled(event.target.checked)} />
              <span><span className="block font-semibold">Washing Machine</span><span className="mt-0.5 block text-sm text-muted-foreground">{washingRateCents === null ? 'Rate needs review.' : `${formatMoney(washingRateCents)} per room per applicable billing period.`}</span></span>
          </label>
          <p className="room-details-note">Changes apply to future applicable billing periods only. Existing issued bills, payments, and unpaid obligations are not rewritten. Saving this checkbox does not record a payment.</p>
        </section>

        <RoomElectricityMeter key={room.id} roomId={room.id} />

        <DialogFooter className="room-details-footer">
          <Button variant="outline" onClick={requestClose}>Cancel</Button>
          <Button onClick={save} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save Changes'}</Button>
        </DialogFooter>
      </>}

      {mode === 'edit' && <form onSubmit={saveRoom} noValidate>
        <DialogHeader className="room-details-heading pr-6">
          <span className="room-details-icon"><Pencil aria-hidden="true" /></span>
          <DialogTitle>Edit Room {room.name}</DialogTitle>
          <DialogDescription>Update the room record. Tenant assignments and historical bills are not changed.</DialogDescription>
        </DialogHeader>
        <section className="room-details-section mt-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <label htmlFor="edit-room-name" className="text-sm font-semibold">Room number or name</label>
              <Input id="edit-room-name" value={name} onChange={event => { setName(event.target.value); setErrors({}) }} maxLength={80} autoComplete="off" aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'edit-room-name-error' : undefined} className="h-12 bg-card" />
              {errors.name && <p id="edit-room-name-error" role="alert" className="text-sm text-destructive">{errors.name}</p>}
            </div>
            <div className="grid gap-2">
              <label htmlFor="edit-room-beds" className="text-sm font-semibold">Number of beds</label>
              <Input id="edit-room-beds" type="number" min={1} step={1} value={capacity} onChange={event => { setCapacity(event.target.value); setErrors({}) }} aria-invalid={Boolean(errors.capacity)} aria-describedby={errors.capacity ? 'edit-room-beds-error' : undefined} className="h-12 bg-card" />
              {errors.capacity && <p id="edit-room-beds-error" role="alert" className="text-sm text-destructive">{errors.capacity}</p>}
            </div>
            <div className="grid gap-2">
              <label htmlFor="edit-room-rate" className="text-sm font-semibold">Monthly rental rate</label>
              <select id="edit-room-rate" value={categoryId} onChange={event => { setCategoryId(event.target.value as RoomCategoryId); setErrors({}) }} aria-invalid={Boolean(errors.categoryId)} className={fieldClass}>
                {ROOM_RATE_CATEGORY_IDS.map(id => {
                  const rate = activeRoomRentRate(data, id, occupancyDate)
                  return <option key={id} value={id}>{roomCategoryLabel(id)} · {rate ? formatMoney(rate.monthlyRentCents) : 'Rate needs review'}/month</option>
                })}
              </select>
              {errors.categoryId && <p role="alert" className="text-sm text-destructive">{errors.categoryId}</p>}
            </div>
            <div className="grid gap-2">
              <label htmlFor="edit-room-type" className="text-sm font-semibold">Room type</label>
              <select id="edit-room-type" value={kind} onChange={event => { setKind(event.target.value as RoomDraft['kind']); setErrors({}) }} className={fieldClass}>
                <option value="PRIVATE">Private</option>
                <option value="SHARED">Shared</option>
              </select>
            </div>
            <div className="grid gap-2">
              <label htmlFor="edit-room-status" className="text-sm font-semibold">Room status</label>
              {tenants.length > 0
                ? <><Input id="edit-room-status" value="Occupied" readOnly aria-describedby="edit-room-status-help" className="h-12 bg-muted" /><p id="edit-room-status-help" className="text-xs text-muted-foreground">Occupied comes from tenant assignments and cannot be changed here.</p></>
                : reservations.length > 0
                  ? <><Input id="edit-room-status" value="Reserved" readOnly aria-describedby="edit-room-status-help" className="h-12 bg-muted" /><p id="edit-room-status-help" className="text-xs text-muted-foreground">An approved future tenancy reserves this room. Release or reschedule the reservation before changing room status.</p></>
                  : <><select id="edit-room-status" value={roomStatus} onChange={event => { setRoomStatus(event.target.value as RoomDraft['status']); setErrors({}) }} aria-invalid={Boolean(errors.status)} className={fieldClass}><option value="available">Available</option><option value="maintenance">Under repair</option></select>{errors.status && <p role="alert" className="text-sm text-destructive">{errors.status}</p>}</>}
            </div>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">Changing the monthly rate does not rewrite already issued rent charges or existing tenant agreements.</p>
          {errors.general && <p role="alert" className="mt-3 text-sm text-destructive">{errors.general}</p>}
        </section>
        <DialogFooter className="room-details-footer mt-5">
          <Button type="button" variant="outline" onClick={() => setMode('details')}>Cancel</Button>
          <Button type="submit"><Check aria-hidden="true" />Save Room</Button>
        </DialogFooter>
      </form>}

      {mode === 'delete' && <>
        <DialogHeader className="room-details-heading pr-6">
          <span className="room-details-icon text-destructive"><Trash2 aria-hidden="true" /></span>
          <DialogTitle>Delete Room {room.name}</DialogTitle>
          <DialogDescription>Deletion removes this room from the prototype room list and updates room counts and selectors.</DialogDescription>
        </DialogHeader>
        <section className="room-details-section mt-5">
          {deleteBlockers.length > 0
            ? <div role="alert"><p className="font-semibold text-destructive">This room cannot be deleted yet.</p><ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">{deleteBlockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul><p className="mt-3 text-sm text-muted-foreground">No linked records will be removed or changed.</p></div>
            : <><p className="font-semibold">Delete Room {room.name}?</p><p className="mt-2 text-sm text-muted-foreground">This room has no tenant assignments, bills, payments, receipts, meter history, or outstanding financial references. This action cannot be undone.</p></>}
        </section>
        <DialogFooter className="room-details-footer mt-5">
          <Button type="button" variant="outline" onClick={() => setMode('details')}>Cancel</Button>
          <Button type="button" variant="destructive" onClick={confirmDelete} disabled={deleteBlockers.length > 0 || deleting} aria-busy={deleting}>{deleting ? 'Deleting…' : 'Delete Room'}</Button>
        </DialogFooter>
      </>}
    </DialogContent>
  </Dialog>
}
