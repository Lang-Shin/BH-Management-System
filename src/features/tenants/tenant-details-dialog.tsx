import { useRef, useState, type FormEvent } from 'react'
import { Archive, Check, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAnimatedDialogClose } from '@/components/ui/use-animated-dialog-close'
import { AnimatedNumber } from '@/components/shared/animated-number'
import { StatusBadge } from '@/components/shared/status-badge'
import { usePrototype } from '@/hooks/use-prototype'
import { useOccupancyDate } from '@/hooks/use-occupancy-date'
import { activeAssignments, tenantAccount } from '@/domain/calculations/summary'
import { evaluateShortStayAdvanceRefund } from '@/domain/calculations/advance-refund'
import { prepaidRentReconciliation } from '@/domain/calculations/prepaid-rent-refund'
import {
  moveOutBlockers, tenantDeletionBlockers, validateTenantDraft,
  type TenantDraft, type TenantDraftErrors,
} from '@/domain/calculations/tenant-management'
import { formatDate, formatMoney, previousCalendarDate } from '@/lib/format'
import { ACCOUNT_STATUS_LABELS, TENANT_STATUS_LABELS } from '@/lib/labels'
import type { Tenant } from '@/domain/types/models'
import { TenantFormFields } from './tenant-form-fields'

export function TenantDetailsDialog({ tenant, onClose, onReturnFocus, onNotice }: {
  tenant: Tenant
  onClose: () => void
  onReturnFocus: () => void
  onNotice: (message: string) => void
}) {
  const { data, dispatch, commitAction } = usePrototype()
  const occupancyDate = useOccupancyDate()
  const [notes, setNotes] = useState(tenant.notes)
  const [mode, setMode] = useState<'details' | 'edit' | 'moveOut' | 'delete'>('details')
  const [values, setValues] = useState<TenantDraft>({
    name: tenant.name, email: tenant.email, phone: tenant.phone, address: tenant.address,
    roomId: null, moveInDate: occupancyDate, notes: tenant.notes,
  })
  const [errors, setErrors] = useState<TenantDraftErrors>({})
  const submitting = useRef(false)
  const [movingOut, setMovingOut] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [refundAdvance, setRefundAdvance] = useState(false)
  const [refundReason, setRefundReason] = useState('')
  const [refundError, setRefundError] = useState('')
  const [proposePrepaidRefund, setProposePrepaidRefund] = useState(false)
  const [prepaidReason, setPrepaidReason] = useState('')
  const { open, requestClose, onOpenChange, onAnimationEnd } = useAnimatedDialogClose(onClose)
  const account = tenantAccount(data, tenant.id, occupancyDate)
  const assignments = data.roomAssignments.filter(assignment => assignment.tenantId === tenant.id)
  const activeAssignment = activeAssignments(data, occupancyDate).find(assignment => assignment.tenantId === tenant.id)
  const activeRoom = activeAssignment ? data.rooms.find(room => room.id === activeAssignment.roomId) : undefined
  const deletionBlockers = tenantDeletionBlockers(data, tenant.id, occupancyDate)
  const moveOutIssues = moveOutBlockers(data, tenant.id, occupancyDate)
  const refundEligibility = evaluateShortStayAdvanceRefund(data, tenant.id, occupancyDate)
  const prepaidReconciliation = prepaidRentReconciliation(data, tenant.id, occupancyDate)

  function startEdit() {
    submitting.current = false
    setValues({
      name: tenant.name, email: tenant.email, phone: tenant.phone, address: tenant.address,
      roomId: activeAssignment?.roomId ?? null, moveInDate: activeAssignment?.startDate ?? occupancyDate, notes: tenant.notes,
    })
    setErrors({})
    setMode('edit')
  }

  function changeField(field: keyof TenantDraft, value: string | null) {
    setValues(current => {
      const next = { ...current, [field]: value }
      if (field === 'roomId' && activeAssignment && value && value !== activeAssignment.roomId && next.moveInDate <= activeAssignment.startDate) {
        next.moveInDate = occupancyDate
      }
      return next
    })
    setErrors({})
  }

  function saveTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    const nextErrors = validateTenantDraft(data, values, { tenantId: tenant.id, asOf: occupancyDate })
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    submitting.current = true
    dispatch({ type: 'tenant/updated', tenantId: tenant.id, asOf: occupancyDate, draft: values })
    onNotice(`Tenant ${values.name.trim()} was updated.`)
    setNotes(values.notes.trim().slice(0, 500))
    setMode('details')
  }

  async function confirmMoveOut() {
    if (movingOut || submitting.current || moveOutBlockers(data, tenant.id, occupancyDate).length > 0) return
    if (refundAdvance && !refundEligibility.eligible) {
      setRefundError(refundEligibility.blockers[0] ?? 'The short-stay advance refund is not available.')
      return
    }
    if (refundAdvance && refundReason.trim().length < 3) {
      setRefundError('Enter a reason for the advance refund.')
      return
    }
    if (proposePrepaidRefund) {
      if (!prepaidReconciliation?.canPropose) {
        setRefundError(prepaidReconciliation?.blockers[0] ?? 'The prepaid rent refund cannot be proposed yet.')
        return
      }
      if (prepaidReason.trim().length < 3) {
        setRefundError('Enter a reason for the prepaid rent refund proposal.')
        return
      }
    }
    submitting.current = true
    setMovingOut(true)
    setRefundError('')
    if (proposePrepaidRefund) {
      const proposed = await commitAction({
        type: 'prepaidRefund/proposed', tenantId: tenant.id, moveOutDate: occupancyDate,
        reason: prepaidReason.trim(), asOf: occupancyDate,
      })
      if (!proposed) {
        setMovingOut(false)
        submitting.current = false
        setRefundError('The prepaid rent refund proposal was not saved. Refresh and review the current records.')
        return
      }
    }
    dispatch({
      type: 'tenant/movedOut', tenantId: tenant.id, asOf: occupancyDate,
      refundAdvance: refundAdvance ? { refundedOn: occupancyDate, reason: refundReason.trim() } : undefined,
    })
    onNotice(proposePrepaidRefund
      ? `Tenant ${tenant.name} was moved out. A prepaid rent refund was proposed, not yet paid; review and complete it in Payments & Receipts.`
      : refundAdvance
        ? `Tenant ${tenant.name} was moved out. The unused advance was recorded as refunded; the non-refundable deposit remains held.`
        : `Tenant ${tenant.name} was moved out. Historical bills and receipts remain available.`)
    requestClose()
  }

  function confirmDelete() {
    if (deleting || submitting.current || tenantDeletionBlockers(data, tenant.id, occupancyDate).length > 0) return
    submitting.current = true
    setDeleting(true)
    dispatch({ type: 'tenant/deleted', tenantId: tenant.id })
    onNotice(`Tenant ${tenant.name} was deleted.`)
    requestClose()
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[85dvh] overflow-y-auto" onAnimationEnd={onAnimationEnd} onCloseAutoFocus={event => { event.preventDefault(); onReturnFocus() }}>
      {mode === 'details' && <>
        <DialogHeader className="pr-6"><DialogTitle>{tenant.name}</DialogTitle><DialogDescription>Tenant details</DialogDescription></DialogHeader>
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
          <label htmlFor="tenant-notes" className="text-base font-semibold">Notes</label><p id="notes-help" className="mt-2 text-sm text-muted-foreground">Write a short reminder for this tenant.</p>
          <textarea id="tenant-notes" aria-describedby="notes-help" value={notes} onChange={e => setNotes(e.target.value)} maxLength={500} rows={3} className="mt-3 w-full resize-y rounded-lg border bg-card p-4 text-base" placeholder="For example: prefers a text reminder." />
          <p className="mt-1 text-right text-sm text-muted-foreground">{notes.length} / 500 characters</p>
          <DialogFooter className="mt-5"><Button type="button" variant="outline" onClick={requestClose}>Cancel</Button><Button type="submit">Save note</Button></DialogFooter>
        </form>
      </>}

      {mode === 'edit' && <form className="grid gap-5" noValidate onSubmit={saveTenant}>
        <DialogHeader className="pr-6"><DialogTitle>Edit Tenant {tenant.name}</DialogTitle><DialogDescription>Update tenant details. The stable tenant ID and historical financial records are preserved.</DialogDescription></DialogHeader>
        <TenantFormFields idPrefix="edit-tenant" values={values} errors={errors} onChange={changeField} tenantId={tenant.id} />
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
        {prepaidReconciliation && (prepaidReconciliation.periods.length > 0 || prepaidReconciliation.currentRefund) && <section className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sky-950" aria-labelledby="prepaid-refund-title">
          <h2 id="prepaid-refund-title" className="font-semibold">Prepaid Rent Reconciliation</h2>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-sky-900/70">Tenant and room</dt><dd className="font-semibold">{prepaidReconciliation.tenantName} - Room {prepaidReconciliation.roomName}</dd></div>
            <div><dt className="text-sky-900/70">Effective move-out date</dt><dd className="font-semibold">{formatDate(prepaidReconciliation.moveOutDate)}</dd></div>
            <div><dt className="text-sky-900/70">Total prepaid rent identified</dt><dd className="font-semibold">{formatMoney(prepaidReconciliation.totalPrepaidCents)}</dd></div>
            <div><dt className="text-sky-900/70">Proposed refundable amount</dt><dd className="font-semibold">{formatMoney(prepaidReconciliation.refundableCents)}</dd></div>
            <div><dt className="text-sky-900/70">Nonrefundable started period</dt><dd className="font-semibold">{formatMoney(prepaidReconciliation.nonRefundableCents)}</dd></div>
            <div><dt className="text-sky-900/70">Started periods requiring review</dt><dd className="font-semibold">{formatMoney(prepaidReconciliation.reviewRequiredCents)}</dd></div>
          </dl>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[30rem] text-left text-sm">
              <thead><tr className="border-b border-sky-200"><th className="py-2 pr-3">Anniversary period</th><th className="py-2 pr-3 text-right">Paid</th><th className="py-2 pr-3 text-right">Occupied days</th><th className="py-2 pr-3 text-right">Refundable</th><th className="py-2">Status</th></tr></thead>
              <tbody>{prepaidReconciliation.periods.map(period => <tr key={period.rentalPeriodId} className="border-b border-sky-100 last:border-0">
                <td className="py-2 pr-3">{formatDate(period.startDate)} - {formatDate(previousCalendarDate(period.endDateExclusive))}<small className="block text-xs text-sky-900/70">Rate snapshot {formatMoney(period.rateSnapshotCents)}</small></td>
                <td className="py-2 pr-3 text-right font-semibold">{formatMoney(period.paidCents)}</td>
                <td className="py-2 pr-3 text-right">{period.occupiedDays}</td>
                <td className="py-2 pr-3 text-right font-semibold">{formatMoney(period.refundableCents)}</td>
                <td className="py-2 font-semibold">{period.status === 'FUTURE' ? 'Future - refundable' : period.status === 'NON_REFUNDABLE' ? '7+ days - nonrefundable' : period.status === 'REVIEW_REQUIRED' ? 'Under 7 days - review required' : 'Reserved'}</td>
              </tr>)}</tbody>
            </table>
          </div>
          {prepaidReconciliation.blockers.length > 0 && <ul role="alert" className="mt-3 list-disc space-y-1 pl-5 text-sm font-medium text-rose-900">{prepaidReconciliation.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul>}
          {prepaidReconciliation.currentRefund
            ? <p className="mt-3 rounded-lg border border-sky-200 bg-card p-3 text-sm"><strong>Refund status: {prepaidReconciliation.currentRefund.status}.</strong> {formatMoney(prepaidReconciliation.currentRefund.amountCents)} for {prepaidReconciliation.currentRefund.reason}. {prepaidReconciliation.currentRefund.status === 'PROPOSED' ? 'It is not paid yet. Approve and complete it in Payments & Receipts after review.' : prepaidReconciliation.currentRefund.status === 'APPROVED' ? 'Approved but not yet paid. Complete the actual cash outflow in Payments & Receipts.' : prepaidReconciliation.currentRefund.status === 'COMPLETED' ? `Actual refund recorded on ${formatDate(prepaidReconciliation.currentRefund.refundedOn ?? prepaidReconciliation.currentRefund.recordedAt)}.` : 'This refund was reversed.'}</p>
            : prepaidReconciliation.canPropose
              ? <div className="mt-3 rounded-lg border border-sky-200 bg-card p-3">
                <p className="text-sm">The future periods are fully refundable. The started period follows the confirmed seven-day rule; no amount is automatically prorated for an under-seven-day start.</p>
                <label className="mt-3 flex items-start gap-2 text-sm font-medium"><input type="checkbox" checked={proposePrepaidRefund} onChange={event => { setProposePrepaidRefund(event.target.checked); setRefundError('') }} className="mt-0.5 size-4 shrink-0" /><span>Record a proposed prepaid rent refund of {formatMoney(prepaidReconciliation.refundableCents)}. This does not return cash yet.</span></label>
                {proposePrepaidRefund && <label className="mt-3 grid gap-2 text-sm font-semibold">Refund proposal reason
                  <textarea rows={2} maxLength={500} value={prepaidReason} onChange={event => { setPrepaidReason(event.target.value); setRefundError('') }} className="w-full rounded-xl border border-sky-300 bg-background p-3 text-foreground" placeholder="For example: tenant is moving out with future prepaid periods." />
                </label>}
              </div>
              : <p className="mt-3 rounded-lg border border-sky-200 bg-card p-3 text-sm text-sky-900">No refund is automatically proposed. {prepaidReconciliation.entitlementReviewRequired ? 'Refund entitlement needs landlord verification because this is a shared room.' : 'Review the period calculation before recording any refund.'}</p>}
          {prepaidReconciliation.entitlementReviewRequired && <p role="note" className="mt-3 text-sm font-semibold">Shared-room entitlement review is required. Do not treat the room-level payment as belonging to another tenant or a continuing occupancy.</p>}
          <p className="mt-3 text-xs">Proposed and approved refunds do not count as cash returned. Only an actual completed refund records cash outflow, and the original receipt stays available.</p>
        </section>}
        {refundEligibility.stayDays !== null && refundEligibility.stayDays < refundEligibility.windowDays && (
          <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950" aria-labelledby="short-stay-refund-title">
            <h2 id="short-stay-refund-title" className="font-semibold">Short-stay advance refund</h2>
            {refundEligibility.eligible
              ? <>
                  <p className="mt-1 text-sm">The tenant stayed {refundEligibility.stayDays} of {refundEligibility.windowDays} days. The unused advance of {formatMoney(refundEligibility.refundableCents)} may be refunded; the security deposit remains non-refundable.</p>
                  <label className="mt-3 flex items-start gap-2 text-sm font-medium">
                    <input type="checkbox" checked={refundAdvance} onChange={event => { setRefundAdvance(event.target.checked); setRefundError('') }} className="mt-0.5 size-4 shrink-0" />
                    <span>Record that the unused advance was returned to the tenant.</span>
                  </label>
                  {refundAdvance && <label className="mt-3 grid gap-2 text-sm font-semibold">Refund reason
                    <textarea rows={2} maxLength={500} value={refundReason} onChange={event => { setRefundReason(event.target.value); setRefundError('') }} className="w-full rounded-xl border border-amber-300 bg-card p-3 text-foreground" placeholder="For example: tenant moved out within the seven-day window." />
                  </label>}
                </>
              : <><p className="mt-1 text-sm">This short stay requires manual review before refunding the advance:</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{refundEligibility.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul></>}
            {refundError && <p role="alert" className="mt-2 text-sm font-semibold text-destructive">{refundError}</p>}
            <p className="mt-2 text-xs">No refund is posted automatically. Confirm only after the money has actually been returned. The original payment and receipt remain in history.</p>
          </section>
        )}
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
            : <p className="mt-4 text-sm text-muted-foreground">This tenant has no room assignment, bills, payments, receipts, credits, or outstanding balance. This action cannot be undone.</p>}
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
