import { useRef, useState, type FormEvent } from 'react'
import { Archive, Check, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAnimatedDialogClose } from '@/components/ui/use-animated-dialog-close'
import { AnimatedNumber } from '@/components/shared/animated-number'
import { StatusBadge } from '@/components/shared/status-badge'
import { usePrototype } from '@/hooks/use-prototype'
import { activeAssignments, tenantAccount } from '@/domain/calculations/summary'
import {
  moveOutBlockers, tenantDeletionBlockers, validateTenantDraft,
  type TenantDraft, type TenantDraftErrors,
} from '@/domain/calculations/tenant-management'
import { DEMO_DATE } from '@/data/fixtures/demo'
import { formatDate, formatMoney } from '@/lib/format'
import { ACCOUNT_STATUS_LABELS, TENANT_STATUS_LABELS } from '@/lib/labels'
import type { Tenant } from '@/domain/types/models'
import { TenantFormFields } from './tenant-form-fields'

export function TenantDetailsDialog({ tenant, onClose, onReturnFocus, onNotice }: {
  tenant: Tenant
  onClose: () => void
  onReturnFocus: () => void
  onNotice: (message: string) => void
}) {
  const { data, dispatch } = usePrototype()
  const [notes, setNotes] = useState(tenant.notes)
  const [mode, setMode] = useState<'details' | 'edit' | 'moveOut' | 'delete'>('details')
  const [values, setValues] = useState<TenantDraft>({
    name: tenant.name, email: tenant.email, phone: tenant.phone, address: tenant.address,
    roomId: null, moveInDate: DEMO_DATE, notes: tenant.notes,
  })
  const [errors, setErrors] = useState<TenantDraftErrors>({})
  const submitting = useRef(false)
  const [movingOut, setMovingOut] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { open, requestClose, onOpenChange, onAnimationEnd } = useAnimatedDialogClose(onClose)
  const account = tenantAccount(data, tenant.id, DEMO_DATE)
  const assignments = data.roomAssignments.filter(assignment => assignment.tenantId === tenant.id)
  const activeAssignment = activeAssignments(data, DEMO_DATE).find(assignment => assignment.tenantId === tenant.id)
  const activeRoom = activeAssignment ? data.rooms.find(room => room.id === activeAssignment.roomId) : undefined
  const deletionBlockers = tenantDeletionBlockers(data, tenant.id, DEMO_DATE)
  const moveOutIssues = moveOutBlockers(data, tenant.id, DEMO_DATE)

  function startEdit() {
    submitting.current = false
    setValues({
      name: tenant.name, email: tenant.email, phone: tenant.phone, address: tenant.address,
      roomId: activeAssignment?.roomId ?? null, moveInDate: activeAssignment?.startDate ?? DEMO_DATE, notes: tenant.notes,
    })
    setErrors({})
    setMode('edit')
  }

  function changeField(field: keyof TenantDraft, value: string | null) {
    setValues(current => {
      const next = { ...current, [field]: value }
      if (field === 'roomId' && activeAssignment && value && value !== activeAssignment.roomId && next.moveInDate <= activeAssignment.startDate) {
        next.moveInDate = DEMO_DATE
      }
      return next
    })
    setErrors({})
  }

  function saveTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    const nextErrors = validateTenantDraft(data, values, { tenantId: tenant.id, asOf: DEMO_DATE })
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    submitting.current = true
    dispatch({ type: 'tenant/updated', tenantId: tenant.id, draft: values })
    onNotice(`Tenant ${values.name.trim()} was updated.`)
    setNotes(values.notes.trim().slice(0, 500))
    setMode('details')
  }

  function confirmMoveOut() {
    if (movingOut || submitting.current || moveOutBlockers(data, tenant.id, DEMO_DATE).length > 0) return
    submitting.current = true
    setMovingOut(true)
    dispatch({ type: 'tenant/movedOut', tenantId: tenant.id })
    onNotice(`Tenant ${tenant.name} was moved out. Historical bills and receipts remain available.`)
    requestClose()
  }

  function confirmDelete() {
    if (deleting || submitting.current || tenantDeletionBlockers(data, tenant.id, DEMO_DATE).length > 0) return
    submitting.current = true
    setDeleting(true)
    dispatch({ type: 'tenant/deleted', tenantId: tenant.id })
    onNotice(`Tenant ${tenant.name} was deleted.`)
    requestClose()
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[85dvh] overflow-y-auto" onAnimationEnd={onAnimationEnd} onCloseAutoFocus={event => { event.preventDefault(); onReturnFocus() }}>
      {mode === 'details' && <>
        <DialogHeader className="pr-6"><DialogTitle>{tenant.name}</DialogTitle><DialogDescription>Tenant details · Sample record</DialogDescription></DialogHeader>
        <dl className="grid gap-5 rounded-lg border bg-muted/40 p-4 text-base sm:grid-cols-2">
          <div><dt className="text-muted-foreground">Tenant status</dt><dd className="mt-2"><StatusBadge status={TENANT_STATUS_LABELS[tenant.status]} /></dd></div>
          <div><dt className="text-muted-foreground">Payments</dt><dd className="mt-2"><StatusBadge status={ACCOUNT_STATUS_LABELS[account.status] ?? account.status} /></dd></div>
          <div><dt className="text-muted-foreground">Still to pay</dt><dd className="mt-1 text-xl font-semibold"><AnimatedNumber value={formatMoney(account.balance)} /></dd></div>
          <div><dt className="text-muted-foreground">Advance payment</dt><dd className="mt-1 text-xl font-semibold"><AnimatedNumber value={formatMoney(account.credit)} /></dd></div>
          <div className="min-w-0 sm:col-span-2"><dt className="text-muted-foreground">Contact details</dt><dd className="mt-2 break-all">{tenant.email || 'No email recorded'}</dd><dd className="mt-1 break-words">{tenant.phone || 'No phone recorded'}</dd><dd className="mt-2 leading-relaxed">{tenant.address || 'No home address recorded'}</dd></div>
        </dl>
        <section><h2 className="mb-3 text-lg font-semibold">Rooms rented</h2><p className="mb-3 text-sm text-muted-foreground">Room rent is charged once per occupied room, not once per tenant.</p>{assignments.length > 0 ? <ul className="space-y-3">{assignments.map(a => <li key={a.id} className="rounded-lg border p-4 text-base"><p className="font-semibold">Room {data.rooms.find(r => r.id === a.roomId)?.name ?? 'Room needs review'}</p><p className="mt-2">Room rent: <AnimatedNumber value={formatMoney(a.agreedRentCents)} /></p><p className="mt-2 text-sm text-muted-foreground">{formatDate(a.startDate)} – {a.endDate ? formatDate(a.endDate) : 'Still renting'}</p></li>)}</ul> : <p className="text-sm text-muted-foreground">No room assignments are recorded.</p>}</section>
        <div className="tenant-details-management">
          <Button type="button" variant="outline" onClick={startEdit}><Pencil aria-hidden="true" />Edit Tenant</Button>
          <Button type="button" variant="outline" onClick={() => { submitting.current = false; setMode('moveOut') }}><Archive aria-hidden="true" />Move Out / Archive</Button>
          <Button type="button" variant="outline" className="text-destructive hover:text-destructive" onClick={() => { submitting.current = false; setMode('delete') }}><Trash2 aria-hidden="true" />Delete Tenant</Button>
        </div>
        <form onSubmit={event => { event.preventDefault(); dispatch({ type: 'tenant/noteUpdated', tenantId: tenant.id, notes }); onNotice(`Note saved for ${tenant.name}.`); requestClose() }}>
          <label htmlFor="tenant-notes" className="text-base font-semibold">Notes</label><p id="notes-help" className="mt-2 text-sm text-muted-foreground">Write a short reminder. Try this using sample information.</p>
          <textarea id="tenant-notes" aria-describedby="notes-help" value={notes} onChange={e => setNotes(e.target.value)} maxLength={500} rows={3} className="mt-3 w-full resize-y rounded-lg border bg-card p-4 text-base" placeholder="For example: prefers a text reminder." />
          <p className="mt-1 text-right text-sm text-muted-foreground">{notes.length} / 500 characters</p>
          <DialogFooter className="mt-5"><Button type="button" variant="outline" onClick={requestClose}>Cancel</Button><Button type="submit">Save note</Button></DialogFooter>
        </form>
      </>}

      {mode === 'edit' && <form className="grid gap-5" noValidate onSubmit={saveTenant}>
        <DialogHeader className="pr-6"><DialogTitle>Edit Tenant {tenant.name}</DialogTitle><DialogDescription>Update tenant details. The stable tenant ID and historical financial records are preserved.</DialogDescription></DialogHeader>
        <TenantFormFields idPrefix="edit-tenant" values={values} errors={errors} onChange={changeField} />
        <div className="rounded-xl border bg-muted/40 p-3 text-sm text-muted-foreground">Choosing a different room records a new assignment and closes the current one at the transfer date. Historical bills, payments, and receipts are not rewritten.</div>
        <DialogFooter><Button type="button" variant="outline" onClick={() => setMode('details')}>Cancel</Button><Button type="submit"><Check aria-hidden="true" />Save Tenant</Button></DialogFooter>
      </form>}

      {mode === 'moveOut' && <>
        <DialogHeader className="pr-6"><DialogTitle>Move Out / Archive {tenant.name}</DialogTitle><DialogDescription>This archives the tenant without deleting financial history.</DialogDescription></DialogHeader>
        <section className="rounded-lg border bg-muted/40 p-4">
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-muted-foreground">Tenant</dt><dd className="font-semibold">{tenant.name}</dd></div>
            <div><dt className="text-muted-foreground">Current room</dt><dd className="font-semibold">{activeRoom ? `Room ${activeRoom.name}` : 'No current room'}</dd></div>
          </dl>
          {moveOutIssues.length > 0
            ? <div role="alert" className="mt-4"><p className="font-semibold text-destructive">Move-out cannot be completed yet.</p><ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-muted-foreground">{moveOutIssues.map(issue => <li key={issue}>{issue}</li>)}</ul></div>
            : <p className="mt-4 text-sm text-muted-foreground">The tenant will leave current room occupancy and no longer appear as an active tenant. Historical bills, receipts, and reports remain identifiable.</p>}
        </section>
        <DialogFooter><Button type="button" variant="outline" onClick={() => setMode('details')}>Cancel</Button><Button type="button" onClick={confirmMoveOut} disabled={moveOutIssues.length > 0 || movingOut} aria-busy={movingOut}>{movingOut ? 'Moving out…' : 'Move Out / Archive'}</Button></DialogFooter>
      </>}

      {mode === 'delete' && <>
        <DialogHeader className="pr-6"><DialogTitle>Delete Tenant {tenant.name}</DialogTitle><DialogDescription>Permanent deletion is available only when no financial or assignment history exists.</DialogDescription></DialogHeader>
        <section className="rounded-lg border bg-muted/40 p-4">
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-muted-foreground">Tenant</dt><dd className="font-semibold">{tenant.name}</dd></div>
            <div><dt className="text-muted-foreground">Assigned room</dt><dd className="font-semibold">{activeRoom ? `Room ${activeRoom.name}` : 'No current room'}</dd></div>
          </dl>
          {deletionBlockers.length > 0
            ? <div role="alert" className="mt-4"><p className="font-semibold text-destructive">This tenant cannot be permanently deleted.</p><ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-muted-foreground">{deletionBlockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul><p className="mt-3 text-sm text-muted-foreground">Use Move Out / Archive to retain historical records.</p></div>
            : <p className="mt-4 text-sm text-muted-foreground">This tenant has no room assignment, bills, payments, receipts, credits, or outstanding balance. Deletion cannot be undone in the current demonstration data.</p>}
        </section>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setMode('details')}>Cancel</Button>
          {deletionBlockers.length > 0 && moveOutIssues.length === 0 && <Button type="button" variant="outline" onClick={() => setMode('moveOut')}><Archive aria-hidden="true" />Move Out Instead</Button>}
          <Button type="button" variant="destructive" onClick={confirmDelete} disabled={deletionBlockers.length > 0 || deleting} aria-busy={deleting}>{deleting ? 'Deleting…' : 'Delete Tenant'}</Button>
        </DialogFooter>
      </>}
    </DialogContent>
  </Dialog>
}
