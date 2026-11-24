import { useRef, useState } from 'react'
import { ArrowLeft, Check, Droplets, House, ShieldCheck, Wallet, WashingMachine, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useAnimatedDialogClose } from '@/components/ui/use-animated-dialog-close'
import { usePrototype } from '@/hooks/use-prototype'
import { useOccupancyDate } from '@/hooks/use-occupancy-date'
import { correctionSettlementText } from '@/domain/calculations/payment-correction'
import {
  buildUnifiedCorrectionQuote, prepareUnifiedCorrection, type CorrectionLineInput, type UnifiedCorrectionError,
  type UnifiedCorrectionQuote,
} from '@/domain/calculations/transaction-correction'
import { paymentRooms } from '@/domain/calculations/room-finance'
import { formatDate, formatMoney } from '@/lib/format'
import { CATEGORY_LABELS } from '@/lib/labels'

const icons = { RENT: House, ELECTRICITY: Zap, WATER: Droplets, WASHING_MACHINE: WashingMachine, ADVANCE: Wallet, SECURITY_DEPOSIT: ShieldCheck }
const correctionReasonOptions = [
  'Incorrect bill selected',
  'Payment included a bill the tenant did not pay',
  'Wrong rent period included',
  'Payment was recorded incorrectly',
]
const fullReversalWarning = 'All payment allocations have been unchecked. Confirming this correction will reverse the entire recorded payment and restore affected financial obligations.'

const correctionErrors: Partial<Record<UnifiedCorrectionError, string>> = {
  PAYMENT_NOT_FOUND: 'This transaction is no longer editable. Review the latest transaction or correction history.',
  RECEIPT_NOT_FOUND: 'The latest receipt for this transaction is not available. Review the transaction history.',
  DUPLICATE_CORRECTION: 'This transaction is already connected to a correction. Refresh and review the latest corrected transaction.',
  UNALLOCATED_PAYMENT: 'This transaction includes unallocated money, so it cannot be corrected safely from this dialog.',
  INVALID_DATE: 'The correction date cannot be earlier than the original payment date.',
  REFUND_EXISTS: 'This payment has an active refund or refund review. Complete or reverse that refund before correcting the original transaction.',
  NO_TARGET: 'This transaction has no payment allocation that can be corrected.',
  INVALID_CATEGORY: 'Choose a valid bill or rent period for every retained allocation.',
  INVALID_AMOUNT: 'The retained payment allocations are not valid.',
  OVER_ALLOCATION: 'A retained allocation is more than the selected bill or rent period still allows.',
  PARTIAL_RENT: 'Rent periods, move-in advances, and security deposits must remain fully allocated or be removed.',
  DUPLICATE_TARGET: 'The retained allocations are not valid for this transaction.',
  INVALID_TOTAL: 'The corrected payment total is not valid.',
  INVALID_SETTLEMENT: 'The correction cannot be settled automatically.',
  LATER_DEPENDENT_READING: 'A later settled electricity transaction depends on this reading. A reviewed historical adjustment is required.',
  INVALID_READING: 'The electricity allocation cannot be removed safely while a later settlement depends on it.',
  INVALID_PAYMENT: 'This transaction cannot be corrected safely.',
  INVALID_ALLOCATION: 'One of these bills no longer belongs to the recorded payment. Refresh and review the latest transaction.',
  STALE_CORRECTION: 'The original receipt has changed. Refresh and review the latest transaction before saving.',
  NO_CHANGES: 'Uncheck at least one paid bill to make a correction.',
}

function expectedBillingChange(line: UnifiedCorrectionQuote['originalLines'][number], fullReversal: boolean): string {
  const period = line.periodLabel ? ` for ${line.periodLabel}` : ''
  if (fullReversal) return 'All affected obligations return to their outstanding or unpaid state.'
  switch (line.category) {
    case 'RENT': return `Rent${period} loses this payment coverage and becomes collectible according to its original due date.`
    case 'ADVANCE': return 'The mandatory move-in advance and first-rent application are reconciled. The occupancy cycle and anniversary anchor are preserved.'
    case 'SECURITY_DEPOSIT': return 'The recorded security-deposit holding is reconciled independently; rent coverage is not changed automatically.'
    case 'ELECTRICITY': return 'The electricity charge returns to unpaid. Meter readings and consumption history stay unchanged.'
    case 'WATER': return `The water bill${period} returns to unpaid.`
    case 'WASHING_MACHINE': return `The washing-machine bill${period} returns to unpaid.`
  }
}

export function EditPaymentDialog({ paymentId, onClose, onReturnFocus, onSaved }: {
  paymentId: string
  onClose: () => void
  onReturnFocus: () => void
  onSaved: (message: string) => void
}) {
  const { data, commitAction, persistSnapshot, commandError } = usePrototype()
  const occupancyDate = useOccupancyDate()
  const payment = data.payments.find(item => item.id === paymentId)
  const [initialQuote] = useState(() => buildUnifiedCorrectionQuote(data, { paymentId, reason: '', correctedAt: occupancyDate }))
  const submission = useRef<{ payload: string; key: string } | null>(null)
  const initialLines = 'quoteError' in initialQuote ? [] : initialQuote.originalLines
  const [selectedAllocationIds, setSelectedAllocationIds] = useState<Set<string>>(() => new Set(initialLines.map(line => line.allocationId)))
  const [reasonChoice, setReasonChoice] = useState('')
  const [reasonDetails, setReasonDetails] = useState('')
  const [step, setStep] = useState<'edit' | 'review' | 'success'>('edit')
  const [saving, setSaving] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [saved, setSaved] = useState<{ receiptNumber: string; amountCents: number; settlement: string; settlementAmountCents: number } | null>(null)
  const { open, requestClose, onOpenChange, onAnimationEnd } = useAnimatedDialogClose(onClose)
  if (!payment) return null
  if (step === 'success' && saved) return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="payment-calculator edit-payment-dialog" onAnimationEnd={onAnimationEnd} onCloseAutoFocus={event => { event.preventDefault(); onReturnFocus() }}>
      <div className="payment-success">
        <span className="payment-success-icon"><Check className="size-8" aria-hidden="true" /></span>
        <span className="payment-eyebrow mt-5">CORRECTION SAVED</span>
        <DialogTitle className="mt-2 text-2xl">Payment corrected</DialogTitle>
        <DialogDescription className="mt-2">Revised receipt {saved.receiptNumber} · Amount {formatMoney(saved.amountCents)}.</DialogDescription>
        <p className="mt-3 text-sm font-semibold">{saved.settlement}</p>
        {saved.settlementAmountCents > 0 && <p className="mt-1 text-sm text-muted-foreground">Confirmed settlement amount: {formatMoney(saved.settlementAmountCents)}.</p>}
        <Button autoFocus className="mt-5 w-full" onClick={requestClose}>Got it</Button>
      </div>
    </DialogContent>
  </Dialog>
  if ('quoteError' in initialQuote) return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="payment-calculator" onAnimationEnd={onAnimationEnd} onCloseAutoFocus={event => { event.preventDefault(); onReturnFocus() }}>
      <div className="payment-calculator-heading"><DialogTitle>Correct Transaction</DialogTitle><DialogDescription className="mt-2">This transaction cannot be corrected safely.</DialogDescription></div>
      <div className="payment-calculator-body"><p role="alert" className="text-sm text-destructive">{correctionErrors[initialQuote.quoteError] ?? 'This transaction is not eligible for correction.'}</p><Button className="mt-5" variant="outline" onClick={requestClose}>Close</Button></div>
    </DialogContent>
  </Dialog>

  const baseQuote = initialQuote as UnifiedCorrectionQuote
  const reason = [reasonChoice, reasonDetails.trim()].filter(Boolean).join(' · ')
  const selectedLines: CorrectionLineInput[] = baseQuote.originalLines
    .filter(line => selectedAllocationIds.has(line.allocationId))
    .map(line => ({ targetId: line.targetId, category: line.category, amountCents: line.amountCents, sourceAllocationId: line.allocationId }))
  const reverseAll = selectedLines.length === 0
  const quoteResult = buildUnifiedCorrectionQuote(data, {
    paymentId, reason, correctedAt: occupancyDate,
    retainedAllocationIds: [...selectedAllocationIds],
    expectedReceiptId: baseQuote.receipt.id, expectedReceiptRevision: baseQuote.receipt.revision,
    correctedElectricityReadingMilliKwh: null,
  })
  const currentQuote = 'quoteError' in quoteResult ? null : quoteResult
  const quoteError = 'quoteError' in quoteResult ? quoteResult.quoteError : null
  const correctedTotalCents = selectedLines.reduce((total, line) => total + line.amountCents, 0)
  const removedTotalCents = payment.amountCents - correctedTotalCents
  const hasChanges = selectedAllocationIds.size < baseQuote.originalLines.length
  const canReview = Boolean(hasChanges && reason.trim().length >= 3 && currentQuote?.canReview && !saving && !quoteError)
  const rooms = paymentRooms(data, payment, occupancyDate)
  const targetDetails = new Map(baseQuote.targets.map(target => [target.targetId, target.detail]))
  const categories = [...new Set(baseQuote.originalLines.map(line => line.category))]
  const removedLines = baseQuote.originalLines.filter(line => !selectedAllocationIds.has(line.allocationId))
  const retainedLines = baseQuote.originalLines.filter(line => selectedAllocationIds.has(line.allocationId))

  function toggleAllocation(allocationId: string) {
    if (saving) return
    setSelectedAllocationIds(current => {
      const next = new Set(current)
      if (next.has(allocationId)) next.delete(allocationId)
      else next.add(allocationId)
      return next
    })
    setSubmitError('')
  }

  function review() {
    if (!canReview) return
    setStep('review')
    setSubmitError('')
  }

  async function confirm() {
    if (!canReview || saving) return
    const result = prepareUnifiedCorrection(data, {
      paymentId, reason, correctedAt: occupancyDate,
      retainedAllocationIds: [...selectedAllocationIds],
      expectedReceiptId: baseQuote.receipt.id, expectedReceiptRevision: baseQuote.receipt.revision,
      correctedElectricityReadingMilliKwh: null,
      settlementStatus: 'CORRECTED', moneyExchangeConfirmed: false,
    })
    if (!result.ok) {
      setSubmitError(correctionErrors[result.reason] ?? 'The correction could not be saved because the transaction changed or is no longer safe to correct.')
      return
    }
    setSaving(true)
    setSubmitError('')
    const warning = await persistSnapshot(result.data)
    if (warning) {
      setSaving(false)
      setSubmitError(`The correction was not saved. ${warning}`)
      return
    }
    const action = {
      type: 'payment/corrected' as const, paymentId,
      selectedCategories: [...new Set(baseQuote.originalLines.map(line => line.category))],
      correctedElectricityReadingMilliKwh: null,
      reason, settlementStatus: 'CORRECTED' as const, moneyExchangeConfirmed: false, correctedAt: occupancyDate,
      retainedAllocationIds: [...selectedAllocationIds],
      expectedReceiptId: baseQuote.receipt.id, expectedReceiptRevision: baseQuote.receipt.revision,
    }
    const payload = JSON.stringify(action)
    if (submission.current?.payload !== payload) submission.current = { payload, key: crypto.randomUUID() }
    const stored = await commitAction(action, submission.current.key)
    setSaving(false)
    if (!stored) {
      setSubmitError('The correction was not saved. Your selections and reason are still here. Refresh the transaction and try again.')
      return
    }
    setSaved({
      receiptNumber: result.receipt.receiptNumber, amountCents: result.receipt.amountCents,
      settlement: correctionSettlementText(result.correction), settlementAmountCents: result.correction.settlementAmountCents,
    })
    setStep('success')
    onSaved(`Payment corrected · ${result.receipt.receiptNumber}`)
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="payment-calculator edit-payment-dialog" onAnimationEnd={onAnimationEnd} onCloseAutoFocus={event => { event.preventDefault(); onReturnFocus() }}>
      {step === 'edit' && <form onSubmit={event => { event.preventDefault(); review() }}>
        <div className="correction-scroll-content">
        <div className="payment-calculator-heading">
          <span className="payment-eyebrow">CORRECT TRANSACTION · PHP</span>
          <DialogTitle className="mt-2 text-2xl">Correct this transaction.</DialogTitle>
          <DialogDescription className="mt-2">Keep the bills that were actually paid. Uncheck anything that was recorded incorrectly.</DialogDescription>
        </div>
        <div className="payment-calculator-body">
          <dl className="edit-payment-original">
            <div><dt>Room</dt><dd>{rooms.label}</dd></div>
            <div><dt>Original date</dt><dd>{formatDate(payment.paidOn)}</dd></div>
            <div><dt>Original receipt</dt><dd className="break-all">{baseQuote.receipt.receiptNumber} · Revision {baseQuote.receipt.revision}</dd></div>
            <div><dt>Original recorded total</dt><dd>{formatMoney(payment.amountCents)}</dd></div>
          </dl>

          <section className="mt-5" aria-labelledby="payment-allocation-selection">
            <h2 id="payment-allocation-selection" className="text-base font-semibold">Payment allocations</h2>
            <p className="mt-1 text-sm text-muted-foreground">Checkboxes start from the bills in this transaction. Unchecking a bill removes it from the corrected payment; the original receipt remains in history.</p>
            <div className="mt-4 grid gap-4">
              {categories.map(category => {
                const Icon = icons[category]
                const categoryLines = baseQuote.originalLines.filter(line => line.category === category)
                const originalCents = categoryLines.reduce((total, line) => total + line.amountCents, 0)
                const retainedCents = categoryLines.filter(line => selectedAllocationIds.has(line.allocationId)).reduce((total, line) => total + line.amountCents, 0)
                return <section key={category} className="rounded-xl border bg-card" aria-labelledby={`correction-category-${category}`}>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/40 px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="payment-category-icon"><Icon className="size-[18px]" aria-hidden="true" /></span>
                      <div><h3 id={`correction-category-${category}`} className="font-semibold">{CATEGORY_LABELS[category]}</h3><p className="text-xs text-muted-foreground">{categoryLines.length} paid allocation{categoryLines.length === 1 ? '' : 's'}</p></div>
                    </div>
                    <div className="text-right text-sm"><p className="text-muted-foreground">Category subtotal</p><p className="font-semibold tabular-nums">{formatMoney(retainedCents)} <span className="font-normal text-muted-foreground">of {formatMoney(originalCents)}</span></p></div>
                  </div>
                  <ul className="divide-y">
                    {categoryLines.map(line => {
                      const checked = selectedAllocationIds.has(line.allocationId)
                      const detail = line.periodLabel ?? targetDetails.get(line.targetId) ?? 'Room-level allocation'
                      return <li key={line.allocationId}>
                        <label className={checked ? 'correction-allocation-row flex cursor-pointer items-start gap-3 p-4' : 'correction-allocation-row flex cursor-pointer items-start gap-3 bg-muted/30 p-4'}>
                          <input type="checkbox" checked={checked} onChange={() => toggleAllocation(line.allocationId)} disabled={saving} className="mt-1 size-5 shrink-0" aria-label={`${CATEGORY_LABELS[category]} ${detail} ${formatMoney(line.amountCents)}`} />
                          <span className="min-w-0 flex-1">
                            <span className="block font-semibold">{detail}</span>
                            <span className="mt-0.5 block text-xs text-muted-foreground">{line.kind === 'RENT' ? 'Rent allocation' : 'Payment allocation'}</span>
                            {!checked && <span className="mt-1 block text-xs font-semibold text-amber-900">Will be removed from payment</span>}
                          </span>
                          <span className={checked ? 'shrink-0 font-semibold tabular-nums' : 'shrink-0 font-semibold tabular-nums text-muted-foreground line-through'}>{formatMoney(line.amountCents)}</span>
                        </label>
                      </li>
                    })}
                  </ul>
                </section>
              })}
            </div>
          </section>

          {reverseAll && <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-950">{fullReversalWarning} No refund or cash-out is created automatically.</p>}

          <div className="mt-5 grid gap-2">
            <label htmlFor="edit-correction-reason" className="text-sm font-semibold">Reason for correction</label>
            <input id="edit-correction-reason" list="correction-reasons" maxLength={200} value={reasonChoice} onChange={event => { setReasonChoice(event.target.value); setSubmitError('') }} placeholder="Why is this payment being corrected?" className="h-12 w-full rounded-xl border bg-card px-3" />
            <datalist id="correction-reasons">{correctionReasonOptions.map(value => <option key={value} value={value} />)}</datalist>
            <textarea aria-label="Correction details (optional)" maxLength={280} value={reasonDetails} onChange={event => { setReasonDetails(event.target.value); setSubmitError('') }} placeholder="Add details if needed" className="min-h-20 w-full rounded-xl border bg-card px-3 py-2" />
            {reason.trim().length < 3 && <p className="text-xs text-muted-foreground">A correction reason is required.</p>}
          </div>
          {!hasChanges && <p className="mt-3 text-sm text-muted-foreground">Uncheck at least one allocation to review a correction.</p>}
          {((quoteError && quoteError !== 'NO_CHANGES') || submitError) && <p role="alert" className="mt-3 text-sm text-destructive">{submitError ? commandError || submitError : quoteError ? correctionErrors[quoteError] : null}</p>}
        </div>
        </div>
        <div className="payment-total-panel">
          <div className="grid grid-cols-2 gap-3">
            <div><p className="text-xs opacity-85">Original recorded total</p><p className="text-lg font-semibold tabular-nums">{formatMoney(payment.amountCents)}</p></div>
            <div className="order-first col-span-2"><p className="text-xs opacity-85">Corrected recorded total</p><output aria-label="Corrected total" className="payment-total-value">{formatMoney(correctedTotalCents)}</output></div>
            <div><p className="text-xs opacity-85">Removed amount</p><output aria-label="Removed amount" className="text-lg font-semibold tabular-nums">{formatMoney(removedTotalCents)}</output></div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs"><span>{selectedAllocationIds.size} of {baseQuote.originalLines.length} allocation{baseQuote.originalLines.length === 1 ? '' : 's'} retained</span>{reverseAll && <span className="font-semibold">Full transaction reversal</span>}</div>
          <div className="mt-5 flex gap-3"><Button type="button" variant="ghost" className="payment-cancel" onClick={requestClose} disabled={saving}>Cancel</Button><Button type="submit" className="flex-1" disabled={!canReview}>Review Correction <Check className="size-4" aria-hidden="true" /></Button></div>
        </div>
      </form>}
      {step === 'review' && <div className="room-payment-confirm">
        <span className="payment-eyebrow">REVIEW CORRECTION</span>
        <DialogTitle className="mt-2 text-2xl">Confirm correction</DialogTitle>
        <DialogDescription className="mt-2">Review the retained and removed bills before saving. Nothing changes until you confirm.</DialogDescription>
        {reverseAll && <p role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-950">{fullReversalWarning}</p>}
        <dl className="room-payment-summary">
          <div><dt>Room</dt><dd>{rooms.label}</dd></div>
          <div><dt>Original transaction</dt><dd>{formatDate(payment.paidOn)} · {baseQuote.receipt.receiptNumber}</dd></div>
          <div><dt>Original recorded total</dt><dd>{formatMoney(payment.amountCents)}</dd></div>
          <div><dt>Corrected recorded total</dt><dd>{formatMoney(correctedTotalCents)}</dd></div>
          <div><dt>Removed amount</dt><dd>{formatMoney(removedTotalCents)}</dd></div>
          <div><dt>Remaining allocations</dt><dd>{retainedLines.length} of {baseQuote.originalLines.length}</dd></div>
        </dl>
        <section className="mt-4 rounded-xl border bg-card p-4" aria-labelledby="retained-allocations-title">
          <h2 id="retained-allocations-title" className="font-semibold">Retained payment allocations</h2>
          {retainedLines.length > 0 ? <ul className="mt-2 space-y-1 text-sm">{retainedLines.map(line => <li key={line.allocationId} className="flex flex-wrap justify-between gap-2"><span>{CATEGORY_LABELS[line.category]}{line.periodLabel ? ` · ${line.periodLabel}` : ''}</span><span className="font-semibold tabular-nums">{formatMoney(line.amountCents)}</span></li>)}</ul> : <p className="mt-2 font-semibold text-rose-900">No allocations retained. This is a full transaction reversal.</p>}
        </section>
        <section className="mt-3 rounded-xl border bg-card p-4" aria-labelledby="removed-allocations-title">
          <h2 id="removed-allocations-title" className="font-semibold">Removed payment allocations</h2>
          <ul className="mt-2 space-y-1 text-sm">{removedLines.map(line => <li key={line.allocationId} className="flex flex-wrap justify-between gap-2"><span>{CATEGORY_LABELS[line.category]}{line.periodLabel ? ` · ${line.periodLabel}` : ''}</span><span className="font-semibold tabular-nums line-through">{formatMoney(line.amountCents)}</span></li>)}</ul>
        </section>
        <section className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950" aria-labelledby="expected-billing-title">
          <h2 id="expected-billing-title" className="font-semibold">Expected billing changes</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{reverseAll
            ? <li>All affected obligations return to their outstanding or unpaid state.</li>
            : removedLines.map(line => <li key={`change-${line.allocationId}`}>{expectedBillingChange(line, false)}</li>)}</ul>
          <p className="mt-2 text-xs">Unchecked bills become unpaid or outstanding. No cash refund is created automatically; use the separate refund workflow if money was actually returned.</p>
        </section>
        <p className="mt-3 text-sm"><span className="text-muted-foreground">Reason:</span> {reason}</p>
        {submitError && <p role="alert" className="mt-3 text-sm text-destructive">{commandError || submitError}</p>}
        <div className="mt-5 flex flex-col gap-3 sm:flex-row"><Button variant="outline" onClick={() => setStep('edit')} disabled={saving}><ArrowLeft aria-hidden="true" />Back to Correction</Button><Button className="flex-1" onClick={confirm} disabled={saving || !canReview}>{saving ? 'Saving correction…' : 'Confirm & Save Correction'}</Button></div>
      </div>}
    </DialogContent>
  </Dialog>
}
