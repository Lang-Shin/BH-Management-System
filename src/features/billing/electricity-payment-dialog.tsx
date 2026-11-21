import { useState } from 'react'
import { Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAnimatedDialogClose } from '@/components/ui/use-animated-dialog-close'
import { usePrototype } from '@/hooks/use-prototype'
import { calculateElectricityCharge, latestSettledReading, parseMeterReadingMilliKwh } from '@/domain/calculations/electricity-calculation'
import { activeElectricityRate } from '@/domain/calculations/billing-rates'
import { prepareElectricityPayment } from '@/domain/calculations/electricity-payment'
import { DEMO_DATE } from '@/data/fixtures/demo'
import { formatDate, formatMoney } from '@/lib/format'

function formatKwh(milliKwh: number) {
  return `${milliKwh / 1000} kWh`
}

function reasonMessage(reason: string, previousMilliKwh: number) {
  switch (reason) {
    case 'READING_BELOW_PREVIOUS': return `Current reading cannot be lower than the last settled reading (${formatKwh(previousMilliKwh)}).`
    case 'READING_NOT_ADVANCED': return 'The current reading must be higher than the last settled reading.'
    case 'READING_DATE_INVALID': return 'The payment date must be after the last settled reading date.'
    case 'RATE_NOT_FOUND': return 'No electricity rate applies to this payment date.'
    case 'INVALID_AMOUNT': return 'This reading produces an amount the prototype cannot represent safely.'
    case 'DUPLICATE_INTERVAL': return 'This meter interval was already billed.'
    case 'DUPLICATE_PAYMENT': return 'This electricity payment was already recorded.'
    case 'STALE_BASELINE': return 'The settled reading changed. Close this form and reopen it.'
    case 'OBLIGATION_NOT_FOUND': return 'This electricity obligation is no longer pending.'
    default: return 'This reading could not be confirmed.'
  }
}

export function ElectricityPaymentDialog({ obligationId, onClose, onReturnFocus, onConfirmed }: {
  obligationId: string
  onClose: () => void
  onReturnFocus: () => void
  onConfirmed: (receiptNumber: string) => void
}) {
  const { data, dispatch, persistSnapshot } = usePrototype()
  const [reading, setReading] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { open, requestClose, onOpenChange, onAnimationEnd } = useAnimatedDialogClose(onClose)
  const obligation = data.electricityBillObligations.find(item => item.id === obligationId)
  const room = data.rooms.find(item => item.id === obligation?.roomId)
  const previous = obligation ? latestSettledReading(data, obligation.meterId) : null
  const rate = activeElectricityRate(data, DEMO_DATE)
  const parsed = parseMeterReadingMilliKwh(reading)
  const calculation = obligation && parsed !== null
    ? calculateElectricityCharge(data, obligationId, { readingMilliKwh: parsed, readOn: DEMO_DATE })
    : null
  const error = reading === ''
    ? null
    : parsed === null
      ? 'Enter a non-negative reading with up to three decimal places, for example 325 or 325.125.'
      : calculation && !calculation.ok
        ? reasonMessage(calculation.reason, previous?.readingMilliKwh ?? 0)
        : null
  const canConfirm = Boolean(calculation?.ok)

  async function confirm() {
    if (!obligation || parsed === null || saving) return
    const result = prepareElectricityPayment(data, obligation.id, parsed, DEMO_DATE)
    if (!result.ok) {
      setSubmitError(reasonMessage(result.reason, previous?.readingMilliKwh ?? 0))
      return
    }
    setSaving(true)
    setSubmitError(null)
    const warning = await persistSnapshot(result.data)
    setSaving(false)
    if (warning) {
      setSubmitError(`Payment was not saved. ${warning}`)
      return
    }
    dispatch({ type: 'electricity/paymentConfirmed', obligationId: obligation.id, currentReadingMilliKwh: parsed, paidOn: DEMO_DATE })
    onConfirmed(result.receipt.receiptNumber)
    requestClose()
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="electricity-payment-dialog sm:max-w-lg" onAnimationEnd={onAnimationEnd} onCloseAutoFocus={event => { event.preventDefault(); onReturnFocus() }}>
      <DialogHeader className="pr-6">
        <span className="electricity-payment-icon"><Zap aria-hidden="true" /></span>
        <DialogTitle>Electricity payment · {room ? `Room ${room.name}` : 'Room needs review'}</DialogTitle>
        <DialogDescription>Enter the current meter reading when the tenant is ready to pay electricity.</DialogDescription>
      </DialogHeader>
      {!obligation || !previous ? <p role="alert" className="rounded-xl border bg-muted/40 p-4 text-sm">This electricity obligation is no longer pending. Close this form to refresh the room.</p> : <>
        <dl className="electricity-reading-summary" aria-label="Previous settled electricity reading">
          <div><dt>Last settled reading</dt><dd>{formatKwh(previous.readingMilliKwh)}</dd></div>
          <div><dt>Last settled date</dt><dd>{formatDate(previous.readOn)}</dd></div>
          <div><dt>Electricity rate</dt><dd>{rate ? `${formatMoney(rate.rateCentsPerKwh)} per kWh` : 'No rate available'}</dd></div>
        </dl>
        <label htmlFor="electricity-current-reading" className="block text-sm font-semibold">Current meter reading (kWh)</label>
        <input id="electricity-current-reading" type="text" inputMode="decimal" maxLength={14} value={reading} onChange={event => { setReading(event.target.value); setSubmitError(null) }} aria-invalid={Boolean(error)} aria-describedby={error ? 'electricity-reading-error' : 'electricity-reading-help'} className="electricity-reading-input" autoFocus />
        <p id="electricity-reading-help" className="text-xs text-muted-foreground">The calculation covers all consumption since the last settled reading. Nothing is saved until you confirm.</p>
        {error && <p id="electricity-reading-error" role="alert" className="text-sm text-destructive">{error}</p>}
        {calculation?.ok && <section className="electricity-calculation-preview" aria-label="Calculated electricity charge" aria-live="polite">
          <dl>
            <div><dt>Current reading</dt><dd>{formatKwh(calculation.currentReading.readingMilliKwh)}</dd></div>
            <div><dt>Consumption</dt><dd>{formatKwh(calculation.charge.electricity.consumptionMilliKwh)}</dd></div>
            <div><dt>Rate</dt><dd>{formatMoney(calculation.charge.electricity.appliedRateCentsPerKwh)} per kWh</dd></div>
          </dl>
          <p><span>Amount to collect</span><strong>{formatMoney(calculation.charge.amountCents)}</strong></p>
        </section>}
        {submitError && <p role="alert" className="text-sm text-destructive">{submitError}</p>}
      </>}
      <DialogFooter className="flex-col-reverse gap-2 sm:flex-row"><Button variant="outline" onClick={requestClose}>Cancel</Button><Button disabled={!canConfirm || saving} onClick={confirm}>{saving ? 'Saving payment…' : 'Confirm payment received'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
