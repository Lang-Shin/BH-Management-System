import { useState, type FormEvent } from 'react'
import { ArrowLeft, CalendarClock, Check, History, ShieldCheck, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { usePrototype } from '@/hooks/use-prototype'
import { useOccupancyDate } from '@/hooks/use-occupancy-date'
import {
  activeRoomRentRate, nextRateEffectiveFrom, parseRateInput, ROOM_RATE_CATEGORY_IDS,
} from '@/domain/calculations/billing-rates'
import {
  categoryPendingRate, categoryRateHistory, planRentRateChange,
  type RentRateChangeIntent, type RentRateChangePlan,
} from '@/domain/calculations/rent-rate-management'
import { formatDate, formatMoney, formatMonthYear } from '@/lib/format'
import { roomCategoryLabel } from '@/lib/room-rates'
import type { RoomCategoryId, RoomRentRate } from '@/domain/types/models'

type DialogMode = 'list' | 'form' | 'review' | 'cancel'

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2)
}

function rateStatus(rate: RoomRentRate, active: RoomRentRate | undefined, asOf: string): string {
  if (rate.canceledOn) return 'Canceled'
  if (rate.supersededOn) return 'Replaced'
  if (rate.effectiveFrom > asOf) return 'Scheduled'
  if (active?.id === rate.id) return 'Current'
  return 'Effective'
}

function rateNote(rate: RoomRentRate): string | null {
  if (rate.canceledOn) return `Cancellation: ${rate.cancelReason ?? 'No reason recorded.'}`
  if (rate.supersededOn) return `Replaced: ${rate.supersededReason ?? 'No reason recorded.'}`
  return rate.reason ? `Reason: ${rate.reason}` : null
}

export function RentRateManager({ onSaved, onClose }: { onSaved: (message: string) => void; onClose: () => void }) {
  const { data, commitAction } = usePrototype()
  const occupancyDate = useOccupancyDate()
  const [mode, setMode] = useState<DialogMode>('list')
  const [intent, setIntent] = useState<RentRateChangeIntent>('SCHEDULE')
  const [selectedCategory, setSelectedCategory] = useState<RoomCategoryId | null>(null)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [plan, setPlan] = useState<RentRateChangePlan | null>(null)
  const [saving, setSaving] = useState(false)

  const categories = ROOM_RATE_CATEGORY_IDS.map(categoryId => {
    const active = activeRoomRentRate(data, categoryId, occupancyDate)
    const pending = categoryPendingRate(data, categoryId, occupancyDate)
    const roomCount = data.rooms.filter(room => room.categoryId === categoryId).length
    return { categoryId, active, pending, roomCount }
  })
  const activeRates = new Map(categories.map(item => [item.categoryId, item.active]))
  const nextEffectiveFrom = nextRateEffectiveFrom(data, occupancyDate)
  const selected = selectedCategory ? categories.find(item => item.categoryId === selectedCategory) : undefined

  function startSchedule(categoryId: RoomCategoryId) {
    const active = activeRoomRentRate(data, categoryId, occupancyDate)
    setSelectedCategory(categoryId)
    setIntent('SCHEDULE')
    setAmount(active ? centsToInput(active.monthlyRentCents) : '')
    setReason('')
    setErrors({})
    setPlan(null)
    setMode('form')
  }

  function startEdit(categoryId: RoomCategoryId) {
    const pending = categoryPendingRate(data, categoryId, occupancyDate)
    if (!pending) return
    setSelectedCategory(categoryId)
    setIntent('EDIT')
    setAmount(centsToInput(pending.monthlyRentCents))
    setReason('')
    setErrors({})
    setPlan(null)
    setMode('form')
  }

  function startCancel(categoryId: RoomCategoryId) {
    if (!categoryPendingRate(data, categoryId, occupancyDate)) return
    setSelectedCategory(categoryId)
    setIntent('CANCEL')
    setReason('')
    setErrors({})
    setPlan(null)
    setMode('cancel')
  }

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) return
    const parsed = plan?.kind === 'CANCEL' ? null : parseRateInput(amount)
    if (parsed && !parsed.ok) {
      setErrors({ amount: parsed.message })
      return
    }
    const pending = selected.pending
    const result = planRentRateChange(data, {
      intent: intent === 'CANCEL' ? 'CANCEL' : intent,
      categoryId: selected.categoryId,
      ...(parsed?.ok ? { amountCents: parsed.cents } : {}),
      reason,
      ...(pending ? { expectedRateId: pending.id, expectedRateRevision: pending.revision ?? 1 } : {}),
    }, occupancyDate)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    setPlan(result.plan)
    setMode(result.plan.kind === 'CANCEL' ? 'cancel' : 'review')
  }

  function reviewCancellation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected?.pending) return
    const result = planRentRateChange(data, {
      intent: 'CANCEL', categoryId: selected.categoryId, reason,
      expectedRateId: selected.pending.id, expectedRateRevision: selected.pending.revision ?? 1,
    }, occupancyDate)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    setPlan(result.plan)
    void save(result.plan)
  }

  async function save(nextPlan: RentRateChangePlan) {
    if (saving) return
    setSaving(true)
    const accepted = await commitAction({
      type: 'rates/scheduledChange',
      intent: nextPlan.kind === 'CANCEL' ? 'CANCEL' : nextPlan.kind,
      categoryId: nextPlan.categoryId,
      ...(nextPlan.proposedCents !== null ? { amountCents: nextPlan.proposedCents } : {}),
      reason: nextPlan.reason,
      ...(nextPlan.expectedRateId ? {
        expectedRateId: nextPlan.expectedRateId,
        expectedRateRevision: nextPlan.expectedRateRevision ?? 1,
      } : {}),
      asOf: occupancyDate,
    })
    setSaving(false)
    if (!accepted) {
      setErrors({ general: 'The server did not confirm this rate change. Review the current records and try again.' })
      return
    }
    const label = roomCategoryLabel(nextPlan.categoryId)
    const message = nextPlan.kind === 'CANCEL'
      ? `${label} remains at ${formatMoney(nextPlan.currentCents)}/month. The scheduled change was canceled and kept in rate history.`
      : nextPlan.kind === 'EDIT'
        ? `${label} scheduled rate was updated to ${formatMoney(nextPlan.proposedCents ?? 0)}/month for ${formatMonthYear(nextPlan.effectiveFrom)}. The current rate remains ${formatMoney(nextPlan.currentCents)}/month.`
        : `${label} was scheduled at ${formatMoney(nextPlan.proposedCents ?? 0)}/month starting ${formatMonthYear(nextPlan.effectiveFrom)}. Existing bills and receipts were not changed.`
    onSaved(message)
    onClose()
  }

  function backToList() {
    setMode('list')
    setPlan(null)
    setErrors({})
  }

  if (mode === 'list') {
    return <DialogContent className="billing-rate-dialog billing-rate-manager-dialog sm:max-w-2xl" aria-describedby="billing-rate-description">
      <DialogHeader className="pr-6">
        <span className="billing-rate-dialog-icon"><CalendarClock aria-hidden="true" /></span>
        <DialogTitle>Edit Monthly Rent Rates</DialogTitle>
        <DialogDescription id="billing-rate-description">Manage each rental category independently. Future changes never rewrite issued bills or receipts.</DialogDescription>
      </DialogHeader>

      <section className="billing-rate-dialog-section" aria-labelledby="rental-categories-title">
        <h2 id="rental-categories-title">Rental categories</h2>
        <div className="billing-rate-manager-list">
          {categories.map(({ categoryId, active, pending, roomCount }) => <article key={categoryId} className="billing-rate-manager-row" aria-label={roomCategoryLabel(categoryId)}>
            <div className="billing-rate-manager-heading">
              <div><h3>{roomCategoryLabel(categoryId)}</h3><p>{roomCount} {roomCount === 1 ? 'room' : 'rooms'}</p></div>
              {pending
                ? <span className="billing-rate-pending"><CalendarClock aria-hidden="true" />Pending change</span>
                : <span className="billing-rate-no-change">No pending change</span>}
            </div>
            <dl className="billing-rate-category-values">
              <div><dt>Current active rate</dt><dd>{active ? `${formatMoney(active.monthlyRentCents)}/month` : 'Rate needs review'}</dd></div>
              <div><dt>Scheduled rate</dt><dd>{pending ? `${formatMoney(pending.monthlyRentCents)}/month` : 'None'}</dd></div>
              <div><dt>Effective date</dt><dd>{pending ? formatDate(pending.effectiveFrom) : `Next eligible ${formatDate(nextEffectiveFrom)}`}</dd></div>
            </dl>
            <div className="billing-rate-manager-actions">
              {pending
                ? <><Button type="button" variant="outline" onClick={() => startEdit(categoryId)}>Edit Rate</Button><Button type="button" variant="ghost" onClick={() => startCancel(categoryId)}><XCircle aria-hidden="true" />Cancel Change</Button></>
                : <Button type="button" variant="outline" onClick={() => startSchedule(categoryId)}>Schedule Rate</Button>}
            </div>
          </article>)}
        </div>
      </section>

      <section className="billing-rate-dialog-section" aria-labelledby="effective-period-title">
        <h2 id="effective-period-title">Rate protections</h2>
        <p className="billing-rate-protection"><ShieldCheck aria-hidden="true" />A scheduled rate only affects future anniversary rental periods. Canceled or replaced changes stay in history. Existing bills, receipts, payments, prepaid periods, and settled electricity readings keep their original rates.</p>
      </section>

      <details className="billing-rate-history">
        <summary><History aria-hidden="true" />Rate history</summary>
        <ul>{categoryRateHistory(data, 'RATE_3500').concat(categoryRateHistory(data, 'RATE_4000'), categoryRateHistory(data, 'RATE_5000'))
          .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || (b.revision ?? 1) - (a.revision ?? 1))
          .map(rate => {
            const note = rateNote(rate)
            return <li key={rate.id}><span>{roomCategoryLabel(rate.categoryId)}<small>{formatDate(rate.effectiveFrom)} · Recorded {formatDate(rate.recordedOn)}{rate.recordedBy ? ` by ${rate.recordedBy}` : ''}</small>{note && <small>{note}</small>}</span><span>{formatMoney(rate.monthlyRentCents)}<small>{rateStatus(rate, activeRates.get(rate.categoryId), occupancyDate)}</small></span></li>
          })}</ul>
      </details>

      <DialogFooter className="mt-5"><DialogClose asChild><Button type="button" variant="outline">Close</Button></DialogClose></DialogFooter>
    </DialogContent>
  }

  if (mode === 'form' && selected) {
    return <DialogContent className="billing-rate-dialog billing-rate-manager-dialog sm:max-w-xl" aria-describedby="billing-rate-description">
      <form onSubmit={review} noValidate>
        <DialogHeader className="pr-6">
          <span className="billing-rate-dialog-icon"><CalendarClock aria-hidden="true" /></span>
          <DialogTitle>{intent === 'EDIT' ? 'Edit Scheduled Rate' : 'Schedule Monthly Rent Rate'}</DialogTitle>
          <DialogDescription id="billing-rate-description">{roomCategoryLabel(selected.categoryId)} · {selected.roomCount} {selected.roomCount === 1 ? 'room' : 'rooms'}. {intent === 'EDIT' ? 'The current active rate and the original effective date remain unchanged.' : 'The current active rate remains unchanged until the effective date.'}</DialogDescription>
        </DialogHeader>
        <section className="billing-rate-dialog-section">
          <dl className="billing-rate-current-list">
            <div><dt>Current active rate</dt><dd>{selected.active ? formatMoney(selected.active.monthlyRentCents) : 'Rate needs review'}</dd></div>
            {selected.pending && <div><dt>Scheduled rate</dt><dd>{formatMoney(selected.pending.monthlyRentCents)}</dd></div>}
            <div><dt>Effective date</dt><dd>{formatDate(selected.pending?.effectiveFrom ?? nextEffectiveFrom)}</dd></div>
          </dl>
        </section>
        <section className="billing-rate-dialog-section" aria-labelledby="new-rate-title">
          <h2 id="new-rate-title">{intent === 'EDIT' ? 'Replacement scheduled rate' : 'New scheduled rate'}</h2>
          <div className="billing-rate-inputs">
            <div className="grid gap-2">
              <label htmlFor="scheduled-rent-amount" className="text-sm font-semibold">Monthly rate per room</label>
              <div className="billing-rate-input-wrap"><span aria-hidden="true">₱</span><input id="scheduled-rent-amount" type="text" inputMode="decimal" value={amount} onChange={event => { setAmount(event.target.value); setErrors({}) }} aria-invalid={Boolean(errors.amount)} aria-describedby={errors.amount ? 'scheduled-rent-amount-error' : undefined} autoFocus /></div>
              {errors.amount && <p id="scheduled-rent-amount-error" role="alert" className="text-sm text-destructive">{errors.amount}</p>}
            </div>
            <div className="grid gap-2">
              <label htmlFor="scheduled-rent-reason" className="text-sm font-semibold">Reason {intent === 'EDIT' ? '' : '(optional)'}</label>
              <textarea id="scheduled-rent-reason" value={reason} maxLength={500} onChange={event => { setReason(event.target.value); setErrors({}) }} aria-invalid={Boolean(errors.reason)} aria-describedby={errors.reason ? 'scheduled-rent-reason-error' : undefined} />
              {errors.reason && <p id="scheduled-rent-reason-error" role="alert" className="text-sm text-destructive">{errors.reason}</p>}
            </div>
          </div>
          {errors.general && errors.general !== errors.amount && errors.general !== errors.reason && <p role="alert" className="mt-3 text-sm text-destructive">{errors.general}</p>}
          {intent === 'EDIT' && <p className="billing-rate-scheduled-note">Entering the current active rate is treated as a cancellation. You will review that cancellation before anything is saved.</p>}
        </section>
        <DialogFooter className="mt-5"><Button type="button" variant="outline" onClick={backToList}>Back</Button><Button type="submit">Review Changes</Button></DialogFooter>
      </form>
    </DialogContent>
  }

  if (mode === 'cancel' && selected?.pending) {
    return <DialogContent className="billing-rate-dialog billing-rate-manager-dialog sm:max-w-xl" aria-describedby="billing-rate-cancel-description">
      <form onSubmit={reviewCancellation} noValidate>
        <DialogHeader className="pr-6">
          <span className="billing-rate-dialog-icon billing-rate-cancel-icon"><XCircle aria-hidden="true" /></span>
          <DialogTitle>Cancel Scheduled Rate Change</DialogTitle>
          <DialogDescription id="billing-rate-cancel-description">Canceling this scheduled rate change will retain the current rental rate. Historical bills, payments, and receipts will not be modified.</DialogDescription>
        </DialogHeader>
        <section className="billing-rate-dialog-section">
          <dl className="billing-rate-review billing-rate-cancel-review">
            <div><dt>Rental category</dt><dd>{roomCategoryLabel(selected.categoryId)}</dd></div>
            <div><dt>Current active rate</dt><dd><strong>{selected.active ? `${formatMoney(selected.active.monthlyRentCents)}/month` : 'Rate needs review'}</strong></dd></div>
            <div><dt>Scheduled rate being canceled</dt><dd><del>{formatMoney(selected.pending.monthlyRentCents)}/month</del></dd></div>
            <div><dt>Scheduled effective date</dt><dd>{formatDate(selected.pending.effectiveFrom)}</dd></div>
            <div><dt>Affected rooms</dt><dd>{selected.roomCount}</dd></div>
          </dl>
        </section>
        <section className="billing-rate-dialog-section">
          <div className="grid gap-2">
            <label htmlFor="scheduled-rent-cancel-reason" className="text-sm font-semibold">Cancellation reason</label>
            <textarea id="scheduled-rent-cancel-reason" value={reason} maxLength={500} onChange={event => { setReason(event.target.value); setErrors({}) }} aria-invalid={Boolean(errors.reason)} aria-describedby={errors.reason ? 'scheduled-rent-cancel-reason-error' : undefined} autoFocus />
            {errors.reason && <p id="scheduled-rent-cancel-reason-error" role="alert" className="text-sm text-destructive">{errors.reason}</p>}
          </div>
          {errors.general && errors.general !== errors.amount && errors.general !== errors.reason && <p role="alert" className="mt-3 text-sm text-destructive">{errors.general}</p>}
          <p className="billing-rate-protection"><ShieldCheck aria-hidden="true" />No payment, refund, or financial transaction is created. The canceled change remains in rate history.</p>
        </section>
        <DialogFooter className="billing-rate-cancel-footer"><Button type="button" variant="outline" onClick={backToList} disabled={saving}>Keep Scheduled Change</Button><Button type="submit" variant="destructive" disabled={saving} aria-busy={saving}>{saving ? 'Canceling…' : 'Confirm Cancellation'}</Button></DialogFooter>
      </form>
    </DialogContent>
  }

  if (mode === 'review' && plan) {
    return <DialogContent className="billing-rate-dialog billing-rate-manager-dialog sm:max-w-xl" aria-describedby="billing-rate-description">
      <DialogHeader className="pr-6">
        <span className="billing-rate-dialog-icon"><Check aria-hidden="true" /></span>
        <DialogTitle>Review Rate Change</DialogTitle>
        <DialogDescription id="billing-rate-description">Nothing has been saved yet. Confirm the prospective scheduled rate below.</DialogDescription>
      </DialogHeader>
      <section className="billing-rate-dialog-section">
        <dl className="billing-rate-review">
          <div><dt>{roomCategoryLabel(plan.categoryId)} · {plan.roomCount} {plan.roomCount === 1 ? 'room' : 'rooms'}</dt><dd><span><small>Current</small><strong>{formatMoney(plan.currentCents)}</strong></span>{plan.scheduledCents !== null && <span><small>Scheduled</small><del>{formatMoney(plan.scheduledCents)}</del></span>}<span><small>New</small><strong>{formatMoney(plan.proposedCents ?? 0)}</strong></span><small>per room per month</small></dd></div>
          <div><dt>Effective date</dt><dd><strong>{formatDate(plan.effectiveFrom)}</strong><small>Unchanged by this edit</small></dd></div>
          <div><dt>Reason</dt><dd>{plan.reason}</dd></div>
        </dl>
        <p className="billing-rate-protection"><ShieldCheck aria-hidden="true" />Only the future rate configuration changes. Issued bills, receipts, payments, prepaid rent, and settled electricity readings remain unchanged.</p>
        {errors.general && errors.general !== errors.amount && errors.general !== errors.reason && <p role="alert" className="mt-3 text-sm text-destructive">{errors.general}</p>}
      </section>
      <DialogFooter className="mt-5"><Button type="button" variant="outline" onClick={() => { setMode(intent === 'EDIT' ? 'form' : 'list'); setPlan(null) }} disabled={saving}><ArrowLeft aria-hidden="true" />Back</Button><Button type="button" onClick={() => void save(plan)} disabled={saving} aria-busy={saving}>{saving ? 'Saving…' : 'Confirm Changes'}</Button></DialogFooter>
    </DialogContent>
  }

  return null
}
