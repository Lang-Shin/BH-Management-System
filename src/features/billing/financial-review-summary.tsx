import { useState, type FormEvent } from 'react'
import { AlertTriangle, Check, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { usePrototype } from '@/hooks/use-prototype'
import { useOccupancyDate } from '@/hooks/use-occupancy-date'
import {
  financialReviewResolutionBlockers, financialReviewResolutionEffect, financialReviewTypeLabel, resolveFinancialReview,
} from '@/domain/calculations/financial-review-resolution'
import { formatDate, previousCalendarDate } from '@/lib/format'
import type { FinancialReviewCase } from '@/domain/types/models'

function isBillingReview(review: FinancialReviewCase): boolean {
  return review.type === 'TRANSFER_RENT_DIFFERENCE' || review.type === 'TRANSFER_PREPAID_RENT'
    || review.type === 'PREPAID_RENT_EARLY_DEPARTURE'
}

function reviewContext(data: ReturnType<typeof usePrototype>['data'], review: FinancialReviewCase) {
  const tenant = review.tenantId ? data.tenants.find(item => item.id === review.tenantId) : null
  const room = data.rooms.find(item => item.id === review.roomId)
  const period = review.rentalPeriodId ? data.rentalPeriods.find(item => item.id === review.rentalPeriodId) : null
  return { tenant, room, period }
}

export function FinancialReviewSummary() {
  const { data, commitAction } = usePrototype()
  const occupancyDate = useOccupancyDate()
  const reviews = data.financialReviewCases.filter(review => review.status === 'OPEN' && isBillingReview(review))
  const [open, setOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const selected = reviews.find(review => review.id === selectedId)

  if (reviews.length === 0) return null
  const transferCount = reviews.filter(review => review.type !== 'PREPAID_RENT_EARLY_DEPARTURE').length
  const summary = transferCount === reviews.length
    ? `${reviews.length} transfer review ${reviews.length === 1 ? 'item' : 'items'}`
    : `${reviews.length} financial review ${reviews.length === 1 ? 'item' : 'items'}`

  function closeDialog() {
    setOpen(false)
    setSelectedId(null)
    setReason('')
    setAcknowledged(false)
    setErrors({})
  }

  function startResolution(review: FinancialReviewCase) {
    setSelectedId(review.id)
    setReason('')
    setAcknowledged(false)
    setErrors({})
  }

  async function resolve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected || saving) return
    const result = resolveFinancialReview(data, {
      reviewId: selected.id, reason, acknowledged, asOf: occupancyDate,
    })
    if (!result.ok) {
      setErrors({ [result.error === 'REASON_REQUIRED' ? 'reason' : 'general']: result.message })
      return
    }
    setSaving(true)
    const accepted = await commitAction({ type: 'financialReview/resolved', reviewId: selected.id, reason, acknowledged, asOf: occupancyDate })
    setSaving(false)
    if (!accepted) {
      setErrors({ general: 'The server did not confirm this resolution. Refresh and review the current records.' })
      return
    }
    setSelectedId(null)
    setReason('')
    setAcknowledged(false)
    setErrors({})
    if (reviews.filter(review => review.id !== selected.id).length === 0) closeDialog()
  }

  return <>
    <div className="financial-review-summary">
      <div className="flex min-w-0 items-start gap-3">
        <span className="financial-review-summary-icon"><ShieldAlert aria-hidden="true" /></span>
        <div className="min-w-0">
          <p className="font-semibold">{summary} {reviews.length === 1 ? 'needs' : 'need'} attention</p>
          <p>Financial records were preserved. No rent, refund, prepayment, deposit, or reallocation was posted automatically.</p>
        </div>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>View</Button>
    </div>

    <Dialog open={open} onOpenChange={next => { if (!next) closeDialog(); else setOpen(true) }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" aria-describedby="financial-review-description">
        {selected
          ? <form onSubmit={resolve} noValidate>
              <DialogHeader className="pr-6">
                <span className="billing-rate-dialog-icon billing-rate-cancel-icon"><AlertTriangle aria-hidden="true" /></span>
                <DialogTitle>Resolve financial review</DialogTitle>
                <DialogDescription id="financial-review-description">This resolves the review notice only. It does not post, move, forgive, or refund money.</DialogDescription>
              </DialogHeader>
              <section className="billing-rate-dialog-section">
                <dl className="billing-rate-review">
                  <div><dt>Review type</dt><dd>{financialReviewTypeLabel(selected)}</dd></div>
                  <div><dt>Context</dt><dd>{reviewContext(data, selected).tenant?.name ?? 'Tenant'}{reviewContext(data, selected).room ? ` · Room ${reviewContext(data, selected).room!.name}` : ''}{reviewContext(data, selected).period ? ` · ${formatDate(reviewContext(data, selected).period!.startDate)} – ${formatDate(previousCalendarDate(reviewContext(data, selected).period!.endDateExclusive))}` : ''}</dd></div>
                  <div><dt>Original note</dt><dd>{selected.note}</dd></div>
                  <div><dt>After resolving</dt><dd>{financialReviewResolutionEffect(selected)}</dd></div>
                </dl>
              </section>
              <section className="billing-rate-dialog-section">
                <div className="grid gap-2">
                  <label htmlFor="financial-review-reason" className="text-sm font-semibold">Resolution reason</label>
                  <textarea id="financial-review-reason" value={reason} maxLength={500} onChange={event => { setReason(event.target.value); setErrors({}) }} aria-invalid={Boolean(errors.reason)} aria-describedby={errors.reason ? 'financial-review-reason-error' : undefined} autoFocus />
                  {errors.reason && <p id="financial-review-reason-error" role="alert" className="text-sm text-destructive">{errors.reason}</p>}
                </div>
                <label className="mt-4 flex items-start gap-3 text-sm">
                  <input type="checkbox" checked={acknowledged} onChange={event => { setAcknowledged(event.target.checked); setErrors({}) }} />
                  <span>I reviewed this financial case and confirm any required treatment was handled through an authorized workflow. I understand resolving it does not create or reverse money.</span>
                </label>
                {errors.general && <p role="alert" className="mt-3 text-sm text-destructive">{errors.general}</p>}
              </section>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { setSelectedId(null); setErrors({}) }} disabled={saving}>Back</Button>
                <Button type="submit" disabled={saving} aria-busy={saving}>{saving ? 'Saving…' : <><Check aria-hidden="true" />Confirm resolution</>}</Button>
              </DialogFooter>
            </form>
          : <>
              <DialogHeader className="pr-6">
                <span className="billing-rate-dialog-icon"><ShieldAlert aria-hidden="true" /></span>
                <DialogTitle>Financial review items</DialogTitle>
                <DialogDescription id="financial-review-description">These items remain open until you explicitly resolve them. Hiding this dialog does not change their financial safeguards.</DialogDescription>
              </DialogHeader>
              <div className="financial-review-list">
                {reviews.map(review => {
                  const context = reviewContext(data, review)
                  return <article key={review.id} className="financial-review-item">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div><h3>{financialReviewTypeLabel(review)}</h3><p>{context.tenant?.name ?? 'Tenant'}{context.room ? ` · Room ${context.room.name}` : ''}{context.period ? ` · ${formatDate(context.period.startDate)} – ${formatDate(previousCalendarDate(context.period.endDateExclusive))}` : ''}</p></div>
                      <span className="financial-review-open">OPEN</span>
                    </div>
                    <p>{review.note}</p>
                    {financialReviewResolutionBlockers(data, review, occupancyDate).map(blocker => <p key={blocker} className="financial-review-blocker">{blocker}</p>)}
                    <Button type="button" variant="outline" size="sm" onClick={() => startResolution(review)}>Resolve review</Button>
                  </article>
                })}
              </div>
              <DialogFooter><Button type="button" variant="outline" onClick={closeDialog}>Hide for now</Button></DialogFooter>
            </>}
      </DialogContent>
    </Dialog>
  </>
}
