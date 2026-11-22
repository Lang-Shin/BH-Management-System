import { useState, type FormEvent } from 'react'
import { Check, ReceiptText, ShieldCheck, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { usePrototype } from '@/hooks/use-prototype'
import { useOccupancyDate } from '@/hooks/use-occupancy-date'

import { prepareMoveInPayment, type MoveInCategory, type MoveInObligationView } from '@/domain/calculations/move-in'
import { formatMoney } from '@/lib/format'

export function MoveInPaymentDialog({ view, onClose, onSaved }: {
  view: MoveInObligationView
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const { data, dispatch, persistSnapshot } = usePrototype()
  const occupancyDate = useOccupancyDate()
  const initialSelection: MoveInCategory[] = [
    ...(view.advanceRemainingCents > 0 ? ['ADVANCE' as const] : []),
    ...(view.depositRemainingCents > 0 ? ['SECURITY_DEPOSIT' as const] : []),
  ]
  const [selected, setSelected] = useState<MoveInCategory[]>(initialSelection)
  const [paidOn, setPaidOn] = useState(occupancyDate)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState<{ receiptNumber: string; amountCents: number } | null>(null)
  const entryDateError = !paidOn ? 'Choose the date the money was received.'
    : paidOn < view.cycle.startedAt ? 'Payment date cannot be before the occupancy started.' : ''
  const totalCents = (selected.includes('ADVANCE') ? view.advanceRemainingCents : 0)
    + (selected.includes('SECURITY_DEPOSIT') ? view.depositRemainingCents : 0)
  const canSubmit = selected.length > 0 && !entryDateError && !saving

  function toggle(category: MoveInCategory) {
    setSelected(current => current.includes(category) ? current.filter(item => item !== category) : [...current, category])
    setError('')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const result = prepareMoveInPayment(data, { obligationId: view.obligation.id, paidOn, categories: selected })
    if (!result.ok) {
      setError(result.reason === 'NO_SELECTION' ? 'Select the advance, the security deposit, or both.'
        : result.reason === 'ALREADY_PAID' ? 'A selected category is already fully paid. Refresh the section and try again.'
        : 'This move-in payment could not be recorded. Review the selection and try again.')
      return
    }
    setSaving(true)
    setError('')
    const warning = await persistSnapshot(result.data)
    setSaving(false)
    if (warning) {
      setError(`Payment was not saved. ${warning}`)
      return
    }
    dispatch({ type: 'moveIn/paymentRecorded', obligationId: view.obligation.id, categories: selected, paidOn })
    setSuccess({ receiptNumber: result.receipt.receiptNumber, amountCents: result.payment.amountCents })
    onSaved(`Room-level move-in payment recorded. Receipt ${result.receipt.receiptNumber}.`)
  }

  return <Dialog open onOpenChange={next => { if (!next) onClose() }}>
    <DialogContent className="move-in-dialog" aria-describedby="move-in-payment-description">
      {success ? <div className="move-in-success">
        <span className="move-in-success-icon"><Check aria-hidden="true" /></span>
        <DialogTitle>Move-in payment saved.</DialogTitle>
        <DialogDescription id="move-in-payment-description">The room-level advance and deposit balances were updated for every authorized occupant.{selected.includes('ADVANCE') && ' The paid advance now settles the first anniversary rent period, so that rent must not be collected again.'}</DialogDescription>
        <dl className="move-in-success-details">
          <div><dt>Receipt</dt><dd>{success.receiptNumber}</dd></div>
          <div><dt>Amount received</dt><dd>{formatMoney(success.amountCents)}</dd></div>
          <div><dt>Room</dt><dd>Room {view.room.name}</dd></div>
          {view.firstRentObligation && <div><dt>First rent period</dt><dd>{view.firstRentObligation.issuedOn} · {formatMoney(view.firstRentObligation.amountCents)}</dd></div>}
        </dl>
        <p className="move-in-policy-note"><ReceiptText aria-hidden="true" />{view.obligation.depositDisposition === 'NON_REFUNDABLE' ? 'The security deposit remains a separate non-refundable record and is not recognized as rental income here.' : 'The security deposit remains a separate record subject to manual review; no automatic refund or income recognition is posted.'}</p>
        <Button onClick={onClose} className="w-full">Done</Button>
      </div> : <form onSubmit={submit}>
        <div className="move-in-dialog-heading">
          <span className="move-in-dialog-icon"><ShieldCheck aria-hidden="true" /></span>
          <div>
            <DialogTitle>Record a move-in payment.</DialogTitle>
            <DialogDescription id="move-in-payment-description">Select the room-level categories received. Each category is collected in full; advance and deposit may be recorded on different dates.</DialogDescription>
          </div>
        </div>
        <div className="move-in-dialog-body">
          <div className="move-in-dialog-summary">
            <div><span>Room</span><strong>Room {view.room.name}</strong></div>
            <div><span>Monthly rent snapshot</span><strong>{formatMoney(view.obligation.agreedMonthlyRentCents)}</strong></div>
            <div><span>Move-in date</span><strong>{view.cycle.startedAt}</strong></div>
          </div>
          <fieldset className="room-payment-options" aria-label="Move-in categories received">
            <legend className="sr-only">Move-in categories received</legend>
            <div className="room-payment-option">
              <label className="room-payment-option-label">
                <input type="checkbox" checked={selected.includes('ADVANCE')} disabled={view.advanceRemainingCents === 0} onChange={() => toggle('ADVANCE')} aria-label="Advance" />
                <span className="payment-category-icon"><Wallet className="size-[18px]" aria-hidden="true" /></span>
                <span className="min-w-0 flex-1"><span className="block font-semibold">Advance — first rent</span><span className="mt-0.5 block text-xs text-muted-foreground">{view.advanceRemainingCents === 0 ? 'Already paid and applied' : 'Settles the first anniversary period'}</span></span>
                <span className="shrink-0 text-right font-semibold tabular-nums">{view.advanceRemainingCents === 0 ? 'PAID' : formatMoney(view.advanceRemainingCents)}</span>
              </label>
            </div>
            <div className="room-payment-option">
              <label className="room-payment-option-label">
                <input type="checkbox" checked={selected.includes('SECURITY_DEPOSIT')} disabled={view.depositRemainingCents === 0} onChange={() => toggle('SECURITY_DEPOSIT')} aria-label="Security deposit" />
                <span className="payment-category-icon"><ShieldCheck className="size-[18px]" aria-hidden="true" /></span>
                <span className="min-w-0 flex-1"><span className="block font-semibold">{view.obligation.depositDisposition === 'NON_REFUNDABLE' ? 'Security deposit (non-refundable)' : 'Security deposit'}</span><span className="mt-0.5 block text-xs text-muted-foreground">{view.depositRemainingCents === 0 ? 'Already paid in full' : view.obligation.depositDisposition === 'NON_REFUNDABLE' ? 'Non-refundable under the boarding house’s stated policy' : 'Full category payment · manual review terms'}</span></span>
                <span className="shrink-0 text-right font-semibold tabular-nums">{view.depositRemainingCents === 0 ? 'PAID' : formatMoney(view.depositRemainingCents)}</span>
              </label>
            </div>
          </fieldset>
          <label className="move-in-field"><span>Payment date</span><input type="date" value={paidOn} onChange={event => { setPaidOn(event.target.value); setError('') }} aria-invalid={Boolean(entryDateError)} /><small>{entryDateError || 'Date the money was received.'}</small></label>
          <div className="move-in-total"><span>Total received</span><strong>{formatMoney(totalCents)}</strong></div>
          <p className="move-in-policy-note"><ReceiptText aria-hidden="true" />No partial category payments are accepted. A paid advance settles only the first anniversary rent period; the deposit remains separate. No future-month rent is collected here.</p>
          {error && <p role="alert" className="move-in-error">{error}</p>}
        </div>
        <div className="move-in-dialog-actions">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" disabled={!canSubmit}>{saving ? 'Saving...' : 'Record payment'}</Button>
        </div>
      </form>}
    </DialogContent>
  </Dialog>
}
