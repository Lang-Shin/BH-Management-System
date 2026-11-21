import { useState } from 'react'
import { ArrowLeft, Check, Droplets, House, ShieldCheck, Wallet, WashingMachine, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useAnimatedDialogClose } from '@/components/ui/use-animated-dialog-close'
import { usePrototype } from '@/hooks/use-prototype'
import { parseMeterReadingMilliKwh } from '@/domain/calculations/electricity-calculation'
import { latestPaymentReceipt, buildPaymentCorrectionQuote, preparePaymentCorrection, correctionSettlementText } from '@/domain/calculations/payment-correction'
import { paymentRooms } from '@/domain/calculations/room-finance'
import type { ChargeCategory, CorrectionSettlementStatus } from '@/domain/types/models'
import { DEMO_DATE } from '@/data/fixtures/demo'
import { formatDate, formatMoney } from '@/lib/format'
import { CATEGORY_LABELS } from '@/lib/labels'

const icons = { RENT: House, ELECTRICITY: Zap, WATER: Droplets, WASHING_MACHINE: WashingMachine, ADVANCE: Wallet, SECURITY_DEPOSIT: ShieldCheck }
const correctionReasonOptions = ['Incorrect bill selected', 'Incorrect electricity reading', 'Incorrect recorded amount', 'Incorrect room or period']

export function EditPaymentDialog({ paymentId, onClose, onReturnFocus, onSaved }: {
  paymentId: string
  onClose: () => void
  onReturnFocus: () => void
  onSaved: (message: string) => void
}) {
  const { data, dispatch, persistSnapshot } = usePrototype()
  const payment = data.payments.find(item => item.id === paymentId)
  const receipt = payment ? latestPaymentReceipt(data, payment.id) : null
  const originalCategories = payment ? [...new Set(data.paymentAllocations
    .filter(allocation => allocation.paymentId === payment.id && allocation.state === 'ACTIVE')
    .map(allocation => data.charges.find(charge => charge.id === allocation.chargeId)?.category)
    .filter((category): category is ChargeCategory => Boolean(category)))] : []
  const electricityCharge = payment && originalCategories.includes('ELECTRICITY')
    ? data.charges.find(charge => charge.category === 'ELECTRICITY' && data.paymentAllocations.some(allocation => allocation.paymentId === payment.id && allocation.chargeId === charge.id && allocation.state === 'ACTIVE'))
    : undefined
  const originalElectricityReading = electricityCharge?.category === 'ELECTRICITY'
    ? data.meterReadings.find(reading => reading.id === electricityCharge.electricity.currentReadingId) : undefined
  const previousElectricityReading = electricityCharge?.category === 'ELECTRICITY'
    ? data.meterReadings.find(reading => reading.id === electricityCharge.electricity.previousReadingId) : undefined
  const [selected, setSelected] = useState<ChargeCategory[]>(originalCategories)
  const [reading, setReading] = useState(originalElectricityReading ? String(originalElectricityReading.readingMilliKwh / 1000) : '')
  const [reasonChoice, setReasonChoice] = useState('')
  const [reasonDetails, setReasonDetails] = useState('')
  const [settlement, setSettlement] = useState<CorrectionSettlementStatus | ''>('')
  const [settlementConfirmed, setSettlementConfirmed] = useState(false)
  const [step, setStep] = useState<'edit' | 'review' | 'success'>('edit')
  const [saving, setSaving] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [saved, setSaved] = useState<{ receiptNumber: string; amountCents: number; settlement: string; settlementAmountCents: number } | null>(null)
  const { open, requestClose, onOpenChange, onAnimationEnd } = useAnimatedDialogClose(onClose)
  if (!payment || !receipt) return null
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
  const selectedElectricity = selected.includes('ELECTRICITY')
  const parsedReading = reading === '' ? null : parseMeterReadingMilliKwh(reading)
  const readingError = selectedElectricity && reading !== '' && parsedReading === null
    ? 'Enter a non-negative reading with up to three decimal places.'
    : selectedElectricity && parsedReading !== null && previousElectricityReading && parsedReading <= previousElectricityReading.readingMilliKwh
      ? `Corrected reading must be higher than the previous settled reading (${previousElectricityReading.readingMilliKwh / 1000} kWh).`
      : null
  const reason = [reasonChoice, reasonDetails.trim()].filter(Boolean).join(' — ')
  const quote = buildPaymentCorrectionQuote(data, {
    paymentId, selectedCategories: selected,
    correctedElectricityReadingMilliKwh: selectedElectricity ? (readingError ? null : parsedReading) : null,
    reason, settlementStatus: settlement, correctedAt: DEMO_DATE,
  })
  if ('quoteError' in quote) return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="payment-calculator" onAnimationEnd={onAnimationEnd} onCloseAutoFocus={event => { event.preventDefault(); onReturnFocus() }}>
      <div className="payment-calculator-heading"><DialogTitle>Edit Payment</DialogTitle><DialogDescription className="mt-2">This transaction cannot be edited safely.</DialogDescription></div>
      <div className="payment-calculator-body"><p role="alert" className="text-sm text-destructive">{quote.quoteError === 'LATER_DEPENDENT_READING' ? 'A later settled electricity transaction depends on this reading. A reviewed historical adjustment is required.' : 'This transaction is no longer editable. Review the latest transaction or correction history.'}</p><Button className="mt-5" variant="outline" onClick={requestClose}>Close</Button></div>
    </DialogContent>
  </Dialog>
  const difference = quote.differenceCents
  const canReview = quote.canReview && !readingError
  const settlementReady = difference === 0
    ? true
    : difference > 0
      ? settlement === 'ADDITIONAL_RECEIVED' && settlementConfirmed
      : settlement === 'CORRECTED' || (settlement === 'REFUNDED' && settlementConfirmed)
  const rooms = paymentRooms(data, payment, DEMO_DATE)
  const periods = [...new Set(originalCategories.flatMap(category => data.paymentAllocations
    .filter(allocation => allocation.paymentId === payment.id && allocation.state === 'ACTIVE')
    .flatMap(allocation => {
      const charge = data.charges.find(item => item.id === allocation.chargeId && item.category === category)
      return charge ? [data.billingPeriods.find(period => period.id === charge.billingPeriodId)?.label ?? charge.billingPeriodId] : []
    })))]

  function toggle(category: ChargeCategory) {
    setSelected(current => current.includes(category) ? current.filter(item => item !== category) : [...current, category])
    setSettlement('')
    setSettlementConfirmed(false)
    setSubmitError('')
  }

  function review() {
    if (!canReview) return
    setSettlement(difference === 0 ? 'CORRECTED' : difference > 0 ? 'ADDITIONAL_RECEIVED' : '')
    setSettlementConfirmed(false)
    setStep('review')
    setSubmitError('')
  }

  async function confirm() {
    if (!settlementReady || saving) return
    const result = preparePaymentCorrection(data, {
      paymentId, selectedCategories: selected, correctedElectricityReadingMilliKwh: selectedElectricity ? parsedReading : null,
      reason, settlementStatus: settlement, moneyExchangeConfirmed: settlementConfirmed, correctedAt: DEMO_DATE,
    })
    if (!result.ok) {
      setSubmitError('The correction could not be saved because the transaction changed or is no longer safe to correct.')
      return
    }
    setSaving(true)
    setSubmitError('')
    const warning = await persistSnapshot(result.data)
    setSaving(false)
    if (warning) {
      setSubmitError(`The correction was not saved. ${warning}`)
      return
    }
    dispatch({
      type: 'payment/corrected', paymentId, selectedCategories: selected,
      correctedElectricityReadingMilliKwh: selectedElectricity ? parsedReading : null,
      reason, settlementStatus: settlement, moneyExchangeConfirmed: settlementConfirmed, correctedAt: DEMO_DATE,
    })
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
        <div className="payment-calculator-heading">
          <span className="payment-eyebrow">EDIT PAYMENT · PHP</span>
          <DialogTitle className="mt-2 text-2xl">Correct this transaction.</DialogTitle>
          <DialogDescription className="mt-2">Only the categories originally recorded in this transaction are shown. New bill payments must use Calculate Payment.</DialogDescription>
        </div>
        <div className="payment-calculator-body">
          <dl className="edit-payment-original">
            <div><dt>Room</dt><dd>{rooms.label}</dd></div>
            <div><dt>Original date</dt><dd>{formatDate(payment.paidOn)}</dd></div>
            <div><dt>Original receipt</dt><dd className="break-all">{receipt.receiptNumber} · Revision {receipt.revision}</dd></div>
            <div><dt>Billing period</dt><dd>{periods.join(' / ')}</dd></div>
            <div><dt>Original recorded amount</dt><dd>{formatMoney(payment.amountCents)}</dd></div>
          </dl>
          <fieldset className="room-payment-options">
            <legend className="sr-only">Categories in this transaction</legend>
            {quote.categories.map(option => {
              const Icon = icons[option.category]
              return <div key={option.category} className="room-payment-option">
                <label className="room-payment-option-label">
                  <input type="checkbox" checked={selected.includes(option.category)} onChange={() => toggle(option.category)} aria-label={CATEGORY_LABELS[option.category]} />
                  <span className="payment-category-icon"><Icon className="size-[18px]" aria-hidden="true" /></span>
                  <span className="min-w-0 flex-1"><span className="block font-semibold">{CATEGORY_LABELS[option.category]}</span><span className="mt-0.5 block text-xs text-muted-foreground">Originally recorded {formatMoney(option.originalAmountCents)}</span></span>
                  <span className="shrink-0 text-right font-semibold tabular-nums">{selected.includes(option.category) ? formatMoney(option.correctedAmountCents) : 'Removed'}</span>
                </label>
                {option.category === 'ELECTRICITY' && selected.includes('ELECTRICITY') && option.electricity && <div className="room-payment-electricity">
                  <p className="text-sm"><strong>Previous settled reading:</strong> {option.electricity.previousReading.readingMilliKwh / 1000} kWh</p>
                  <p className="text-sm"><strong>Originally recorded current reading:</strong> {option.electricity.originalCurrentReading.readingMilliKwh / 1000} kWh</p>
                  <p className="text-sm"><strong>Applied rate:</strong> {formatMoney(option.electricity.appliedRateCentsPerKwh)}/kWh</p>
                  <label htmlFor="edit-electricity-reading" className="mt-2 text-sm font-semibold">Corrected current reading (kWh)</label>
                  <input id="edit-electricity-reading" type="text" inputMode="decimal" value={reading} onChange={event => { setReading(event.target.value); setSettlement(''); setSubmitError('') }} className="electricity-reading-input" aria-invalid={Boolean(readingError)} aria-describedby={readingError ? 'edit-electricity-error' : undefined} />
                  <p className="text-xs text-muted-foreground">Original charge {formatMoney(option.originalAmountCents)} · Corrected charge {formatMoney(option.correctedAmountCents)}</p>
                  {option.electricity.laterDependentReading && <p className="text-xs font-semibold text-amber-900">A later settled reading depends on this interval. Changing the reading requires a reviewed historical adjustment and is blocked here.</p>}
                  {readingError && <p id="edit-electricity-error" role="alert" className="text-sm text-destructive">{readingError}</p>}
                </div>}
              </div>
            })}
          </fieldset>
          <div className="mt-5 grid gap-2">
            <label htmlFor="edit-correction-reason" className="text-sm font-semibold">Reason for correction</label>
            <input id="edit-correction-reason" list="correction-reasons" maxLength={200} value={reasonChoice} onChange={event => setReasonChoice(event.target.value)} placeholder="Select or enter a reason" className="h-12 w-full rounded-xl border bg-card px-3" />
            <datalist id="correction-reasons">{correctionReasonOptions.map(value => <option key={value} value={value} />)}</datalist>
            <textarea aria-label="Correction details (optional)" maxLength={280} value={reasonDetails} onChange={event => setReasonDetails(event.target.value)} placeholder="Add details if needed" className="min-h-20 w-full rounded-xl border bg-card px-3 py-2" />
            {reason.trim().length < 3 && <p className="text-xs text-muted-foreground">A reason is required before confirmation.</p>}
          </div>
          {difference !== 0 && <p className="mt-4 text-sm text-muted-foreground">{difference < 0 ? 'You will confirm whether money was actually returned before saving.' : 'You will confirm that the additional money was received before saving.'}</p>}
          {difference === 0 && <p className="mt-4 text-sm text-muted-foreground">No additional payment or refund required.</p>}
          {(quote.error || submitError) && selected.length > 0 && !readingError && <p role="alert" className="mt-3 text-sm text-destructive">{submitError || quote.error}</p>}
          {selected.length === 0 && <p role="alert" className="mt-3 text-sm text-destructive">Select at least one category. Reversing the entire transaction is not available from simple Edit Payment.</p>}
        </div>
        <div className="payment-total-panel">
          <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm opacity-85">Corrected total</p><output aria-label="Corrected total" className="payment-total-value">{formatMoney(quote.correctedTotalCents)}</output><p className="mt-1 text-xs">Original recorded {formatMoney(payment.amountCents)} · Difference {formatMoney(Math.abs(difference))}</p></div><span className="payment-total-tag">{selected.length} of {quote.categories.length} categories</span></div>
          <div className="mt-5 flex gap-3"><Button type="button" variant="ghost" className="payment-cancel" onClick={requestClose}>Cancel</Button><Button type="submit" className="flex-1" disabled={!canReview}>Review Correction <Check className="size-4" aria-hidden="true" /></Button></div>
        </div>
      </form>}
      {step === 'review' && <div className="room-payment-confirm">
        <span className="payment-eyebrow">REVIEW CORRECTION</span>
        <DialogTitle className="mt-2 text-2xl">Confirm correction</DialogTitle>
        <DialogDescription className="mt-2">Review the corrected categories and confirm any money exchange before saving.</DialogDescription>
        <dl className="room-payment-summary">
          <div><dt>Room</dt><dd>{rooms.label}</dd></div>
          <div><dt>Original transaction</dt><dd>{formatDate(payment.paidOn)} · {receipt.receiptNumber}</dd></div>
          <div><dt>Original amount</dt><dd>{formatMoney(payment.amountCents)}</dd></div>
          {quote.categories.map(option => <div key={option.category}><dt>{CATEGORY_LABELS[option.category]}</dt><dd>{selected.includes(option.category) ? formatMoney(option.correctedAmountCents) : 'Removed'}</dd></div>)}
          <div className="room-payment-summary-total"><dt>{difference === 0 ? 'No difference' : difference > 0 ? 'Additional payment' : 'Lower corrected amount'}</dt><dd>{formatMoney(Math.abs(difference))}</dd></div>
        </dl>

        {difference > 0 && <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4" aria-labelledby="additional-payment-title">
          <h2 id="additional-payment-title" className="font-semibold text-amber-950">Tenant must pay an additional {formatMoney(difference)} to the landlord.</h2>
          <p className="mt-1 text-sm text-amber-950/80">Confirm only after the tenant has actually paid. If the money has not changed hands, cancel and save nothing.</p>
          <label className="mt-3 flex items-start gap-2 text-sm font-medium text-amber-950">
            <input type="checkbox" checked={settlementConfirmed} onChange={event => setSettlementConfirmed(event.target.checked)} className="mt-0.5 size-4 shrink-0" />
            <span>I confirm that {formatMoney(difference)} has been received from the tenant.</span>
          </label>
        </section>}

        {difference < 0 && <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4" aria-labelledby="overpayment-title">
          <h2 id="overpayment-title" className="font-semibold text-amber-950">The corrected bill is lower by {formatMoney(Math.abs(difference))}.</h2>
          <fieldset className="mt-3">
            <legend className="text-sm font-semibold text-amber-950">What happened to the money?</legend>
            <label className="mt-2 flex items-start gap-2 text-sm text-amber-950">
              <input type="radio" name="overpayment-handling" checked={settlement === 'CORRECTED'} onChange={() => { setSettlement('CORRECTED'); setSettlementConfirmed(false) }} className="mt-0.5 size-4 shrink-0" />
              <span><strong className="block">Recorded amount was wrong — no extra money was collected.</strong><span className="block text-xs text-amber-950/80">Correct the record without creating a refund.</span></span>
            </label>
            <label className="mt-3 flex items-start gap-2 text-sm text-amber-950">
              <input type="radio" name="overpayment-handling" checked={settlement === 'REFUNDED'} onChange={() => { setSettlement('REFUNDED'); setSettlementConfirmed(false) }} className="mt-0.5 size-4 shrink-0" />
              <span><strong className="block">Landlord must return {formatMoney(Math.abs(difference))} to the tenant.</strong><span className="block text-xs text-amber-950/80">Choose this if the tenant actually paid more than the corrected bill.</span></span>
            </label>
          </fieldset>
          {settlement === 'REFUNDED' && <label className="mt-3 flex items-start gap-2 border-t border-amber-200 pt-3 text-sm font-medium text-amber-950">
            <input type="checkbox" checked={settlementConfirmed} onChange={event => setSettlementConfirmed(event.target.checked)} className="mt-0.5 size-4 shrink-0" />
            <span>I confirm that {formatMoney(Math.abs(difference))} has been returned to the tenant.</span>
          </label>}
          <p className="mt-2 text-xs text-amber-950/80">Do not confirm money as returned unless it has actually been handed back.</p>
        </section>}

        {difference === 0 && <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">No additional payment or refund required.</p>}

        <p className="mt-2 text-sm"><span className="text-muted-foreground">Reason:</span> {reason}</p>
        {submitError && <p role="alert" className="mt-3 text-sm text-destructive">{submitError}</p>}
        <div className="mt-5 flex gap-3"><Button variant="outline" onClick={() => setStep('edit')}><ArrowLeft aria-hidden="true" />Back</Button><Button className="flex-1" onClick={confirm} disabled={!settlementReady || saving}>{saving ? 'Saving correction…' : 'Confirm correction'}</Button></div>
      </div>}
    </DialogContent>
  </Dialog>
}
