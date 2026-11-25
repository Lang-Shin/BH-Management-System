import { useState, type FormEvent } from 'react'
import { ArrowLeft, CalendarClock, Check, History, ShieldCheck, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { usePrototype } from '@/hooks/use-prototype'
import { useOccupancyDate } from '@/hooks/use-occupancy-date'
import {
  activeElectricityRate, activeWashingRate, activeWaterRate, nextRateEffectiveFrom, parseRateInput,
} from '@/domain/calculations/billing-rates'
import {
  pendingUtilityRate, planUtilityRateChange, utilityRateCents, utilityRateHistory, utilityRateLabel,
  utilityRateUnit, type UtilityRateChangePlan,
} from '@/domain/calculations/utility-rate-management'
import { formatDate, formatMoney, formatMonthYear } from '@/lib/format'
import type { ElectricityRate, UtilityRate, UtilityRateKind } from '@/domain/types/models'

type UtilityKind = Exclude<UtilityRateKind, never>
type UtilityDialogMode = 'list' | 'form' | 'review' | 'cancel'
type AnyUtilityRate = ElectricityRate | UtilityRate

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2)
}

function rateStatus(rate: AnyUtilityRate, active: AnyUtilityRate | undefined, asOf: string): string {
  if (rate.canceledOn) return 'Canceled'
  if (rate.supersededOn) return 'Replaced'
  if (rate.effectiveFrom > asOf) return 'Scheduled'
  if (active?.id === rate.id) return 'Current'
  return 'Effective'
}

function rateNote(rate: AnyUtilityRate): string | null {
  if (rate.canceledOn) return `Cancellation: ${rate.cancelReason ?? 'No reason recorded.'}`
  if (rate.supersededOn) return `Replaced: ${rate.supersededReason ?? 'No reason recorded.'}`
  return rate.reason ? `Reason: ${rate.reason}` : null
}

export function UtilityRateManager({ kind, title, onSaved, onClose }: {
  kind: UtilityKind
  title: string
  onSaved: (message: string) => void
  onClose: () => void
}) {
  const { data, commitAction } = usePrototype()
  const occupancyDate = useOccupancyDate()
  const active = kind === 'ELECTRICITY' ? activeElectricityRate(data, occupancyDate)
    : kind === 'WATER' ? activeWaterRate(data, occupancyDate) : activeWashingRate(data, occupancyDate)
  const pending = pendingUtilityRate(data, kind, occupancyDate)
  const effectiveFrom = pending?.effectiveFrom ?? nextRateEffectiveFrom(data, occupancyDate)
  const history = utilityRateHistory(data, kind)
  const activeCents = active ? utilityRateCents(active) : null
  const pendingCents = pending ? utilityRateCents(pending) : null
  const unit = utilityRateUnit(kind)
  const rateLabel = utilityRateLabel(kind)

  const [mode, setMode] = useState<UtilityDialogMode>('list')
  const [intent, setIntent] = useState<'SCHEDULE' | 'EDIT'>('SCHEDULE')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [plan, setPlan] = useState<UtilityRateChangePlan | null>(null)
  const [saving, setSaving] = useState(false)

  function startSchedule() {
    setIntent('SCHEDULE')
    setAmount(activeCents !== null ? centsToInput(activeCents) : '')
    setReason('')
    setErrors({})
    setPlan(null)
    setMode('form')
  }

  function startEdit() {
    if (!pending) return
    setIntent('EDIT')
    setAmount(centsToInput(utilityRateCents(pending)))
    setReason('')
    setErrors({})
    setPlan(null)
    setMode('form')
  }

  function startCancel() {
    if (!pending) return
    setReason('')
    setErrors({})
    setPlan(null)
    setMode('cancel')
  }

  function backToList() {
    setMode('list')
    setPlan(null)
    setErrors({})
  }

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = parseRateInput(amount)
    if (!parsed.ok) {
      setErrors({ amount: parsed.message })
      return
    }
    const result = planUtilityRateChange(data, {
      intent, rateKind: kind, amountCents: parsed.cents, reason,
      ...(pending ? { expectedRateId: pending.id, expectedRateRevision: pending.revision ?? 1 } : {}),
    }, occupancyDate)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    setPlan(result.plan)
    setMode(result.plan.changeKind === 'CANCEL' ? 'cancel' : 'review')
  }

  function reviewCancellation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!pending) return
    const result = planUtilityRateChange(data, {
      intent: 'CANCEL', rateKind: kind, reason,
      expectedRateId: pending.id, expectedRateRevision: pending.revision ?? 1,
    }, occupancyDate)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    setPlan(result.plan)
    void save(result.plan)
  }

  async function save(nextPlan: UtilityRateChangePlan) {
    if (saving) return
    setSaving(true)
    const accepted = await commitAction({
      type: 'rates/utilityChange',
      intent: nextPlan.changeKind === 'CANCEL' ? 'CANCEL' : nextPlan.changeKind,
      rateKind: nextPlan.rateKind,
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
    const message = nextPlan.changeKind === 'CANCEL'
      ? `${rateLabel} remains at ${formatMoney(nextPlan.currentCents)} ${unit}. The scheduled change was canceled and kept in rate history.`
      : nextPlan.changeKind === 'EDIT'
        ? `${rateLabel} scheduled rate was updated to ${formatMoney(nextPlan.proposedCents ?? 0)} ${unit} for ${formatMonthYear(nextPlan.effectiveFrom)}. The current rate remains ${formatMoney(nextPlan.currentCents)} ${unit}.`
        : `${rateLabel} was scheduled at ${formatMoney(nextPlan.proposedCents ?? 0)} ${unit} starting ${formatMonthYear(nextPlan.effectiveFrom)}. Existing bills and readings were not changed.`
    onSaved(message)
    onClose()
  }

  if (mode === 'list') {
    return <DialogContent className="billing-rate-dialog billing-rate-manager-dialog sm:max-w-xl" aria-describedby="billing-rate-description">
      <DialogHeader className="pr-6">
        <span className="billing-rate-dialog-icon"><CalendarClock aria-hidden="true" /></span>
        <DialogTitle>Edit {title}</DialogTitle>
        <DialogDescription id="billing-rate-description">Review the current rate and manage its future schedule. Existing bills, readings, receipts, and payments keep their original rates.</DialogDescription>
      </DialogHeader>

      <section className="billing-rate-dialog-section" aria-labelledby="utility-current-title">
        <div className="billing-rate-manager-heading">
          <div><h2 id="utility-current-title">{rateLabel} rate</h2><p>{unit}</p></div>
          {pending
            ? <span className="billing-rate-pending"><CalendarClock aria-hidden="true" />Pending change</span>
            : <span className="billing-rate-no-change">No pending change</span>}
        </div>
        <dl className="billing-rate-category-values">
          <div><dt>Current active rate</dt><dd>{activeCents !== null ? formatMoney(activeCents) : 'Rate needs review'}</dd></div>
          <div><dt>Scheduled rate</dt><dd>{pendingCents !== null ? formatMoney(pendingCents) : 'None'}</dd></div>
          <div><dt>Effective date</dt><dd>{pending ? formatDate(pending.effectiveFrom) : `Next eligible ${formatDate(effectiveFrom)}`}</dd></div>
        </dl>
        <div className="billing-rate-manager-actions">
          {pending
            ? <><Button type="button" variant="outline" onClick={startEdit}>Edit Rate</Button><Button type="button" variant="ghost" onClick={startCancel}><XCircle aria-hidden="true" />Cancel Change</Button></>
            : <Button type="button" variant="outline" onClick={startSchedule}>Schedule Rate</Button>}
        </div>
      </section>

      <section className="billing-rate-dialog-section">
        <p className="billing-rate-protection"><ShieldCheck aria-hidden="true" />Canceled or replaced rate schedules stay in history and never become active. Settled electricity readings and historical bills keep their applied rates.</p>
      </section>

      <details className="billing-rate-history">
        <summary><History aria-hidden="true" />Rate history</summary>
        <ul>{history.map(rate => {
          const note = rateNote(rate)
          return <li key={rate.id}><span>{rateLabel}<small>{formatDate(rate.effectiveFrom)} · Recorded {formatDate(rate.recordedOn)}{rate.recordedBy ? ` by ${rate.recordedBy}` : ''}</small>{note && <small>{note}</small>}</span><span>{formatMoney(utilityRateCents(rate))}<small>{rateStatus(rate, active, occupancyDate)}</small></span></li>
        })}</ul>
      </details>

      <DialogFooter className="mt-5"><DialogClose asChild><Button type="button" variant="outline">Close</Button></DialogClose></DialogFooter>
    </DialogContent>
  }

  if (mode === 'form') {
    return <DialogContent className="billing-rate-dialog billing-rate-manager-dialog sm:max-w-xl" aria-describedby="billing-rate-description">
      <form onSubmit={review} noValidate>
        <DialogHeader className="pr-6">
          <span className="billing-rate-dialog-icon"><CalendarClock aria-hidden="true" /></span>
          <DialogTitle>{intent === 'EDIT' ? `Edit Scheduled ${rateLabel} Rate` : `Schedule ${rateLabel} Rate`}</DialogTitle>
          <DialogDescription id="billing-rate-description">{intent === 'EDIT' ? 'The current active rate and original effective date remain unchanged.' : 'The current active rate remains unchanged until the effective date.'}</DialogDescription>
        </DialogHeader>
        <section className="billing-rate-dialog-section">
          <dl className="billing-rate-current-list">
            <div><dt>Current active rate</dt><dd>{activeCents !== null ? formatMoney(activeCents) : 'Rate needs review'}</dd></div>
            {pendingCents !== null && <div><dt>Scheduled rate</dt><dd>{formatMoney(pendingCents)}</dd></div>}
            <div><dt>Effective date</dt><dd>{formatDate(effectiveFrom)}</dd></div>
          </dl>
        </section>
        <section className="billing-rate-dialog-section">
          <div className="billing-rate-inputs">
            <div className="grid gap-2">
              <label htmlFor="billing-rate-amount" className="text-sm font-semibold">New rate {unit}</label>
              <div className="billing-rate-input-wrap"><span aria-hidden="true">₱</span><input id="billing-rate-amount" type="text" inputMode="decimal" value={amount} onChange={event => { setAmount(event.target.value); setErrors({}) }} aria-invalid={Boolean(errors.amount)} aria-describedby={errors.amount ? 'billing-rate-amount-error' : undefined} autoFocus /></div>
              {errors.amount && <p id="billing-rate-amount-error" role="alert" className="text-sm text-destructive">{errors.amount}</p>}
            </div>
            <div className="grid gap-2">
              <label htmlFor="billing-rate-reason" className="text-sm font-semibold">Reason {intent === 'EDIT' ? '' : '(optional)'}</label>
              <textarea id="billing-rate-reason" value={reason} maxLength={500} onChange={event => { setReason(event.target.value); setErrors({}) }} aria-invalid={Boolean(errors.reason)} aria-describedby={errors.reason ? 'billing-rate-reason-error' : undefined} />
              {errors.reason && <p id="billing-rate-reason-error" role="alert" className="text-sm text-destructive">{errors.reason}</p>}
            </div>
          </div>
          {errors.general && errors.general !== errors.amount && errors.general !== errors.reason && <p role="alert" className="mt-3 text-sm text-destructive">{errors.general}</p>}
          {intent === 'EDIT' && <p className="billing-rate-scheduled-note">Entering the current active rate is treated as a cancellation. You will review that cancellation before anything is saved.</p>}
        </section>
        <DialogFooter className="mt-5"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit">Review Changes</Button></DialogFooter>
      </form>
    </DialogContent>
  }

  if (mode === 'cancel' && pending) {
    return <DialogContent className="billing-rate-dialog billing-rate-manager-dialog sm:max-w-xl" aria-describedby="billing-rate-cancel-description">
      <form onSubmit={reviewCancellation} noValidate>
        <DialogHeader className="pr-6">
          <span className="billing-rate-dialog-icon billing-rate-cancel-icon"><XCircle aria-hidden="true" /></span>
          <DialogTitle>Cancel Scheduled {rateLabel} Rate Change</DialogTitle>
          <DialogDescription id="billing-rate-cancel-description">Canceling this scheduled rate change will retain the current rate. Historical bills, payments, receipts, and settled electricity readings will not be modified.</DialogDescription>
        </DialogHeader>
        <section className="billing-rate-dialog-section">
          <dl className="billing-rate-review billing-rate-cancel-review">
            <div><dt>Rate</dt><dd>{rateLabel} · {unit}</dd></div>
            <div><dt>Current active rate</dt><dd><strong>{activeCents !== null ? formatMoney(activeCents) : 'Rate needs review'}</strong></dd></div>
            <div><dt>Scheduled rate being canceled</dt><dd><del>{formatMoney(pendingCents ?? 0)}</del></dd></div>
            <div><dt>Scheduled effective date</dt><dd>{formatDate(pending.effectiveFrom)}</dd></div>
          </dl>
        </section>
        <section className="billing-rate-dialog-section">
          <div className="grid gap-2">
            <label htmlFor="billing-rate-cancel-reason" className="text-sm font-semibold">Cancellation reason</label>
            <textarea id="billing-rate-cancel-reason" value={reason} maxLength={500} onChange={event => { setReason(event.target.value); setErrors({}) }} aria-invalid={Boolean(errors.reason)} aria-describedby={errors.reason ? 'billing-rate-cancel-reason-error' : undefined} autoFocus />
            {errors.reason && <p id="billing-rate-cancel-reason-error" role="alert" className="text-sm text-destructive">{errors.reason}</p>}
          </div>
          {errors.general && errors.general !== errors.reason && <p role="alert" className="mt-3 text-sm text-destructive">{errors.general}</p>}
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
          <div><dt>{rateLabel} · {unit}</dt><dd><span><small>Current</small><strong>{formatMoney(plan.currentCents)}</strong></span>{plan.scheduledCents !== null && <span><small>Scheduled</small><del>{formatMoney(plan.scheduledCents)}</del></span>}<span><small>New</small><strong>{formatMoney(plan.proposedCents ?? 0)}</strong></span></dd></div>
          <div><dt>Effective date</dt><dd><strong>{formatDate(plan.effectiveFrom)}</strong><small>Unchanged by this edit</small></dd></div>
          <div><dt>Reason</dt><dd>{plan.reason}</dd></div>
        </dl>
        <p className="billing-rate-protection"><ShieldCheck aria-hidden="true" />This only changes future rate configuration. Existing bills, receipts, payments, and settled electricity readings remain unchanged.</p>
        {errors.general && <p role="alert" className="mt-3 text-sm text-destructive">{errors.general}</p>}
      </section>
      <DialogFooter className="mt-5"><Button type="button" variant="outline" onClick={() => { setMode(intent === 'EDIT' ? 'form' : 'list'); setPlan(null) }} disabled={saving}><ArrowLeft aria-hidden="true" />Back</Button><Button type="button" onClick={() => void save(plan)} disabled={saving} aria-busy={saving}>{saving ? 'Saving…' : 'Confirm Changes'}</Button></DialogFooter>
    </DialogContent>
  }

  return null
}
