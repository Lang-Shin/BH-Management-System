import { useState } from 'react'
import { DoorOpen, Gauge, WashingMachine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAnimatedDialogClose } from '@/components/ui/use-animated-dialog-close'
import { StatusBadge } from '@/components/shared/status-badge'
import { usePrototype } from '@/hooks/use-prototype'
import { roomOccupancy, roomOccupants } from '@/domain/calculations/summary'
import { latestSettledReading } from '@/domain/calculations/electricity-calculation'
import { DEMO_DATE, DEMO_RATES } from '@/data/fixtures/demo'
import { formatDate, formatMoney } from '@/lib/format'
import { roomRate } from '@/lib/room-rates'

const statusLabels = { OCCUPIED: 'Occupied', AVAILABLE: 'Available', UNDER_REPAIR: 'Under repair' } as const

export function RoomDetailsDialog({ roomId, onClose, onReturnFocus, onNotice }: {
  roomId: string
  onClose: () => void
  onReturnFocus: () => void
  onNotice: (message: string) => void
}) {
  const { data, dispatch } = usePrototype()
  const room = data.rooms.find(item => item.id === roomId)
  const [washingEnabled, setWashingEnabled] = useState(room?.washingMachineEnabled ?? false)
  const [saving, setSaving] = useState(false)
  const { open, requestClose, onOpenChange, onAnimationEnd } = useAnimatedDialogClose(onClose)
  if (!room) return null

  const status = roomOccupancy(data, room, DEMO_DATE)
  const tenants = roomOccupants(data, room.id, DEMO_DATE)
  const meterNumber = room.id.replace('room-', '')
  const meter = data.electricityMeters.find(item => item.id === `meter-room-${meterNumber}`)
  const latest = meter ? latestSettledReading(data, meter.id) : null
  const readings = meter ? [...data.meterReadings].filter(reading => reading.meterId === meter.id).sort((a, b) => b.readOn.localeCompare(a.readOn)).slice(0, 4) : []
  const dirty = washingEnabled !== room.washingMachineEnabled

  function save() {
    if (!dirty || saving) return
    setSaving(true)
    dispatch({ type: 'room/washingMachineUpdated', roomId: room!.id, enabled: washingEnabled })
    onNotice(`Room ${room!.name} washing-machine service is now ${washingEnabled ? 'enabled' : 'disabled'} for future applicable billing periods.`)
    requestClose()
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="room-details-dialog sm:max-w-2xl" onAnimationEnd={onAnimationEnd} onCloseAutoFocus={event => { event.preventDefault(); onReturnFocus() }}>
      <DialogHeader className="room-details-heading pr-6">
        <span className="room-details-icon"><DoorOpen aria-hidden="true" /></span>
        <DialogTitle>Room {room.name}</DialogTitle>
        <DialogDescription>{formatMoney(roomRate(room).monthlyRentCents)}/month · {statusLabels[status]}</DialogDescription>
        <div><StatusBadge status={statusLabels[status]} /></div>
      </DialogHeader>

      <section className="room-details-section" aria-labelledby="room-information-title">
        <h2 id="room-information-title">Room information</h2>
        <dl className="room-details-grid">
          <div><dt>Room number</dt><dd>{room.name}</dd></div>
          <div><dt>Monthly rental rate</dt><dd>{formatMoney(roomRate(room).monthlyRentCents)}/month</dd></div>
          <div><dt>Floor</dt><dd>{room.floor}</dd></div>
          <div><dt>Number of beds</dt><dd>{room.capacity}</dd></div>
          <div><dt>Maximum occupancy</dt><dd>{room.capacity} {room.capacity === 1 ? 'tenant' : 'tenants'}</dd></div>
          <div><dt>Current occupancy</dt><dd>{tenants.length} {tenants.length === 1 ? 'tenant' : 'tenants'}</dd></div>
          <div><dt>Room status</dt><dd>{statusLabels[status]}</dd></div>
        </dl>
        {status !== 'OCCUPIED' && <><Button variant="outline" className="mt-4" onClick={() => {
          dispatch({ type: 'room/statusToggled', roomId: room.id })
          onNotice(`Room ${room.name} is now ${status === 'UNDER_REPAIR' ? 'available' : 'under repair'}.`)
        }}>{status === 'UNDER_REPAIR' ? 'Mark as available' : 'Needs repair'}</Button><p className="mt-2 text-xs text-muted-foreground">Room status changes apply immediately; Cancel only discards unsaved washing-machine changes.</p></>}
      </section>

      <section className="room-details-section" aria-labelledby="room-tenants-title">
        <h2 id="room-tenants-title">Tenants</h2>
        {tenants.length > 0 ? <ul className="room-details-tenants">{tenants.map(tenant => <li key={tenant.id}><span className="font-semibold">{tenant.name}</span><span className="text-xs text-muted-foreground">{tenant.status === 'ACTIVE' ? 'Current tenant' : 'Moved out'}</span></li>)}</ul> : <p className="room-details-empty">No tenants are currently assigned.</p>}
      </section>

      <section className="room-details-section" aria-labelledby="room-washing-title">
        <h2 id="room-washing-title" className="flex items-center gap-2"><WashingMachine className="size-5" aria-hidden="true" />Washing machine</h2>
        <label className="room-details-check">
          <input type="checkbox" checked={washingEnabled} onChange={event => setWashingEnabled(event.target.checked)} />
          <span><span className="block font-semibold">Washing Machine</span><span className="mt-0.5 block text-sm text-muted-foreground">{formatMoney(DEMO_RATES.washingCentsPerRoom)} per room per applicable billing period.</span></span>
        </label>
        <p className="room-details-note">Changes apply to future applicable billing periods only. Existing issued bills, payments, and unpaid obligations are not rewritten. Saving this checkbox does not record a payment.</p>
      </section>

      <section className="room-details-section" aria-labelledby="room-meter-title">
        <h2 id="room-meter-title" className="flex items-center gap-2"><Gauge className="size-5" aria-hidden="true" />Electricity meter</h2>
        {meter && latest ? <>
          <dl className="room-details-grid">
            <div><dt>Meter</dt><dd>{meter.label}</dd></div>
            <div><dt>Meter identifier</dt><dd className="break-all">{meter.serialNumber}</dd></div>
            <div><dt>Last settled reading</dt><dd>{latest.readingMilliKwh / 1000} kWh</dd></div>
            <div><dt>Last settled date</dt><dd>{formatDate(latest.readOn)}</dd></div>
            <div><dt>Reading unit</dt><dd>kWh</dd></div>
          </dl>
          <h3 className="mt-5 text-sm font-semibold">Recent reading history</h3>
          <ul className="room-details-readings">{readings.map(reading => <li key={reading.id}><span>{formatDate(reading.readOn)}</span><span className="font-semibold tabular-nums">{reading.readingMilliKwh / 1000} kWh</span></li>)}</ul>
          <div className="room-details-note">
            <p className="font-semibold">Authorized meter corrections</p>
            <p className="mt-1">Editing a settled reading could invalidate historic consumption or payment history, so unrestricted correction is not available here. Meter corrections and payment-time readings require the authorized Billing workflow.</p>
            <Button variant="outline" className="mt-3" disabled aria-label="Edit meter information unavailable">Edit meter information</Button>
          </div>
        </> : <p className="room-details-empty">No electricity meter is recorded for this room.</p>}
      </section>

      <DialogFooter className="room-details-footer">
        <Button variant="outline" onClick={requestClose}>Cancel</Button>
        <Button onClick={save} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save Changes'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
