import { Input } from '@/components/ui/input'
import { usePrototype } from '@/hooks/use-prototype'
import { activeAssignments } from '@/domain/calculations/summary'
import type { TenantDraft, TenantDraftErrors } from '@/domain/calculations/tenant-management'
import { DEMO_DATE } from '@/data/fixtures/demo'

export function TenantFormFields({ idPrefix, values, errors, onChange }: {
  idPrefix: string
  values: TenantDraft
  errors: TenantDraftErrors
  onChange: (field: keyof TenantDraft, value: string | null) => void
}) {
  const { data } = usePrototype()
  const active = activeAssignments(data, DEMO_DATE)

  return <>
    <div className="grid gap-2">
      <label htmlFor={`${idPrefix}-name`} className="text-sm font-semibold">Full name</label>
      <Input id={`${idPrefix}-name`} value={values.name} onChange={event => onChange('name', event.target.value)} autoComplete="name" placeholder="For example: Alex Rivera" maxLength={1000} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? `${idPrefix}-name-error` : undefined} className="h-12 bg-card" />
      {errors.name && <p id={`${idPrefix}-name-error`} role="alert" className="text-sm text-destructive">{errors.name}</p>}
    </div>
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-2">
        <label htmlFor={`${idPrefix}-email`} className="text-sm font-semibold">Email address</label>
        <Input id={`${idPrefix}-email`} value={values.email} onChange={event => onChange('email', event.target.value)} type="email" autoComplete="email" placeholder="resident@example.com" aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? `${idPrefix}-email-error` : undefined} className="h-12 bg-card" />
        {errors.email && <p id={`${idPrefix}-email-error`} role="alert" className="text-sm text-destructive">{errors.email}</p>}
      </div>
      <div className="grid gap-2">
        <label htmlFor={`${idPrefix}-phone`} className="text-sm font-semibold">Phone number</label>
        <Input id={`${idPrefix}-phone`} value={values.phone} onChange={event => onChange('phone', event.target.value)} type="tel" autoComplete="tel" placeholder="Sample phone number" aria-invalid={Boolean(errors.phone)} aria-describedby={errors.phone ? `${idPrefix}-phone-error` : undefined} className="h-12 bg-card" />
        {errors.phone && <p id={`${idPrefix}-phone-error`} role="alert" className="text-sm text-destructive">{errors.phone}</p>}
      </div>
    </div>
    <div className="grid gap-2">
      <label htmlFor={`${idPrefix}-address`} className="text-sm font-semibold">Home address</label>
      <Input id={`${idPrefix}-address`} value={values.address} onChange={event => onChange('address', event.target.value)} autoComplete="street-address" placeholder="Sample address" maxLength={1000} className="h-12 bg-card" />
      {errors.address && <p role="alert" className="text-sm text-destructive">{errors.address}</p>}
    </div>
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-2">
        <label htmlFor={`${idPrefix}-room`} className="text-sm font-semibold">Room assignment</label>
        <select id={`${idPrefix}-room`} value={values.roomId ?? ''} onChange={event => onChange('roomId', event.target.value || null)} aria-invalid={Boolean(errors.roomId)} aria-describedby={errors.roomId ? `${idPrefix}-room-error` : undefined} className="h-12 w-full rounded-xl border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <option value="">No room</option>
          {data.rooms.map(room => {
            const occupants = new Set(active.filter(assignment => assignment.roomId === room.id).map(assignment => assignment.tenantId)).size
            const full = occupants >= room.capacity
            return <option key={room.id} value={room.id}>Room {room.name} · {occupants}/{room.capacity} tenants{room.status === 'maintenance' ? ' · Under repair' : full ? ' · Full' : ''}</option>
          })}
        </select>
        <p className="text-xs text-muted-foreground">A room must exist, be free of repairs, and have available capacity. Choosing a different room records a transfer.</p>
        {errors.roomId && <p id={`${idPrefix}-room-error`} role="alert" className="text-sm text-destructive">{errors.roomId}</p>}
      </div>
      <div className="grid gap-2">
        <label htmlFor={`${idPrefix}-date`} className="text-sm font-semibold">Move-in date</label>
        <Input id={`${idPrefix}-date`} type="date" value={values.moveInDate} onChange={event => onChange('moveInDate', event.target.value)} aria-invalid={Boolean(errors.moveInDate)} aria-describedby={errors.moveInDate ? `${idPrefix}-date-error` : undefined} className="h-12 bg-card" />
        {errors.moveInDate && <p id={`${idPrefix}-date-error`} role="alert" className="text-sm text-destructive">{errors.moveInDate}</p>}
      </div>
    </div>
    <div className="grid gap-2">
      <label htmlFor={`${idPrefix}-notes`} className="text-sm font-semibold">Notes</label>
      <textarea id={`${idPrefix}-notes`} value={values.notes} onChange={event => onChange('notes', event.target.value)} rows={3} maxLength={500} placeholder="Optional note" className="min-h-24 w-full resize-y rounded-xl border border-input bg-card p-3 text-base outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50" />
      <p className="text-right text-xs text-muted-foreground">{values.notes.length} / 500 characters</p>
      {errors.notes && <p role="alert" className="text-sm text-destructive">{errors.notes}</p>}
    </div>
    {errors.general && <p role="alert" className="text-sm text-destructive">{errors.general}</p>}
  </>
}
