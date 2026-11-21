import { useState, type FormEvent } from 'react'
import { Check, ReceiptText, ShieldCheck, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { usePrototype } from '@/hooks/use-prototype'
import { DEMO_DATE } from '@/data/fixtures/demo'
import { parseRateInput } from '@/domain/calculations/billing-rates'
import { prepareMoveInPayment, type MoveInObligationView } from '@/domain/calculations/move-in'
import { activeAssignments } from '@/domain/calculations/summary'
import { formatMoney } from '@/lib/format'

function parseOptionalMoney(value: string): number | null {
  if (value.trim() === '') return 0
  const parsed = parseRateInput(value)
  return parsed.ok ? parsed.cents : null
}

export function MoveInPaymentDialog({ view, onClose, onSaved }: {
  view: MoveInObligationView
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const { data, dispatch, persistSnapshot } = usePrototype()
  const [advance, setAdvance] = useState((view.advanceRemainingCents / 100).toFixed(2))
  const [deposit, setDeposit] = useState((view.depositRemainingCents / 100).toFixed(2))
  const [paidOn, setPaidOn] = useState(DEMO_DATE)
  const [method, setMethod] = useState<'cash' | 'bank-transfer'>('cash')
  const occupants = activeAssignments(data, paidOn).filter(assignment => assignment.roomId === view.room.id)
  const [payerTenantId, setPayerTenantId] = useState(occupants[0]?.tenantId ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState<{ receiptNumber: string; amountCents: number } | null>(null)
  const advanceCents = parseOptionalMoney(advance)
  const depositCents = parseOptionalMoney(deposit)
  const entryDateError = !paidOn ? 'Choose the date the money was received.'
    : paidOn < view.cycle.startedAt ? 'Payment date cannot be before the occupancy started.' : ''
  const canSubmit = Boolean(payerTenantId) && advanceCents !== null && depositCents !== null && !entryDateError && !saving

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (advanceCents === null || depositCents === null) {
      setError('Enter valid peso amounts with up to two decimal places.')
      return
    }
    const result = prepareMoveInPayment(data, {
      obligationId: view.obligation.id, payerTenantId, advanceCents, depositCents, paidOn, method,
    })
    if (!result.ok) {
      setError(result.reason === 'OVERPAYMENT' ? 'The selected amount is more than what is still owed for this category.'
        : result.reason === 'NO_SELECTION' ? 'Enter an advance amount, a deposit amount, or both.'
        : result.reason === 'PAYER_NOT_OCCUPANT' ? 'Choose a tenant assigned to this room for the selected date.'
        : 'This move-in payment could not be recorded. Review the amounts and try again.')
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
    dispatch({
      type: 'moveIn/paymentRecorded', obligationId: view.obligation.id, payerTenantId,
      advanceCents, depositCents, paidOn, method,
    })
    setSuccess({ receiptNumber: result.receipt.receiptNumber, amountCents: result.payment.amountCents })
    onSaved(`Move-in payment recorded. Receipt ${result.receipt.receiptNumber}.`)
  }

  return <Dialog open onOpenChange={next => { if (!next) onClose() }}>
    <DialogContent className="move-in-dialog" aria-describedby="move-in-payment-description">
      {success ? <div className="move-in-success">
        <span className="move-in-success-icon"><Check aria-hidden="true" /></span>
        <DialogTitle>Move-in payment saved.</DialogTitle>
        <DialogDescription id="move-in-payment-description">The room-level advance and deposit balances were updated.</DialogDescription>
        <dl className="move-in-success-details">
          <div><dt>Receipt</dt><dd>{success.receiptNumber}</dd></div>
          <div><dt>Amount received</dt><dd>{formatMoney(success.amountCents)}</dd></div>
          <div><dt>Room</dt><dd>Room {view.room.name}</dd></div>
        </dl>
        <p className="move-in-policy-note"><ReceiptText aria-hidden="true" />{view.obligation.depositDisposition === 'NON_REFUNDABLE' ? 'The security deposit remains a separate non-refundable record and is not recognized as rental income here.' : 'The security deposit remains a separate record subject to manual review; no automatic refund or income recognition is posted.'}</p>
        <Button onClick={onClose} className="w-full">Done</Button>
      </div> : <form onSubmit={submit}>
        <div className="move-in-dialog-heading">
          <span className="move-in-dialog-icon"><ShieldCheck aria-hidden="true" /></span>
          <div>
            <DialogTitle>Record a move-in payment.</DialogTitle>
            <DialogDescription id="move-in-payment-description">{view.obligation.depositDisposition === 'NON_REFUNDABLE' ? 'Advance and security deposit are tracked separately. The security deposit is non-refundable and does not become rent income automatically.' : 'Advance and security deposit are tracked separately. The deposit terms require manual review; no refund or income is posted automatically.'}</DialogDescription>
          </div>
        </div>
        <div className="move-in-dialog-body">
          <div className="move-in-dialog-summary">
            <div><span>Room</span><strong>Room {view.room.name}</strong></div>
            <div><span>Monthly rent snapshot</span><strong>{formatMoney(view.obligation.agreedMonthlyRentCents)}</strong></div>
            <div><span>Move-in date</span><strong>{view.cycle.startedAt}</strong></div>
          </div>
          {occupants.length > 1 && <label className="move-in-field"><span>Who is paying?</span>
            <select value={payerTenantId} onChange={event => setPayerTenantId(event.target.value)}>
              {occupants.map(assignment => <option key={assignment.id} value={assignment.tenantId}>{data.tenants.find(tenant => tenant.id === assignment.tenantId)?.name ?? assignment.tenantId}</option>)}
            </select>
            <small>The room obligation is owed once regardless of who pays.</small>
          </label>}
          <div className="move-in-amounts">
            <label className="move-in-field">
              <span className="move-in-field-label"><Wallet aria-hidden="true" />Advance</span>
              <span className="move-in-money-input"><span>PHP</span><input inputMode="decimal" value={advance} onChange={event => { setAdvance(event.target.value); setError('') }} aria-invalid={advanceCents === null} /></span>
              <small>{formatMoney(view.advanceRemainingCents)} still owed</small>
            </label>
            <label className="move-in-field">
              <span className="move-in-field-label"><ShieldCheck aria-hidden="true" />{view.obligation.depositDisposition === 'NON_REFUNDABLE' ? 'Security deposit (non-refundable)' : 'Security deposit'}</span>
              <span className="move-in-money-input"><span>PHP</span><input inputMode="decimal" value={deposit} onChange={event => { setDeposit(event.target.value); setError('') }} aria-invalid={depositCents === null} /></span>
              <small>{view.obligation.depositDisposition === 'NON_REFUNDABLE' ? 'Non-refundable · no automatic refund or rent-income recognition · ' : 'Manual review before any refund or deduction · '}{formatMoney(view.depositRemainingCents)} still owed</small>
            </label>
          </div>
          <div className="move-in-amounts">
            <label className="move-in-field"><span>Payment date</span><input type="date" value={paidOn} onChange={event => { setPaidOn(event.target.value); setError('') }} aria-invalid={Boolean(entryDateError)} /><small>{entryDateError || 'Date the money was received.'}</small></label>
            <label className="move-in-field"><span>Method</span><select value={method} onChange={event => setMethod(event.target.value as 'cash' | 'bank-transfer')}><option value="cash">Cash</option><option value="bank-transfer">Bank transfer</option></select></label>
          </div>
          <div className="move-in-total"><span>Total received</span><strong>{formatMoney((advanceCents ?? 0) + (depositCents ?? 0))}</strong></div>
          <p className="move-in-policy-note"><ReceiptText aria-hidden="true" />Only the selected advance and deposit amounts are applied. No future-month bill is paid or modified, and no deposit refund or rental income is posted.</p>
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
