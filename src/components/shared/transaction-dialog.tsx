import { ReceiptText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAnimatedDialogClose } from '@/components/ui/use-animated-dialog-close'
import { StatusBadge } from './status-badge'
import type { Payment, PrototypeAppState } from '@/domain/types/models'
import { correctionSettlementText, isLegacyPendingCorrection } from '@/domain/calculations/payment-correction'
import { paymentRooms } from '@/domain/calculations/room-finance'
import { formatDate, formatMoney } from '@/lib/format'
import { TransactionPaidLines } from './transaction-paid-lines'

export function TransactionDialog({ data, payment, asOf, onClose, onReturnFocus, onEditPayment, title = 'Transaction Details', description = 'Payment information for the selected room.' }: {
  data: PrototypeAppState
  payment: Payment
  asOf: string
  onClose: () => void
  onReturnFocus: () => void
  onEditPayment?: (payment: Payment, trigger: HTMLButtonElement) => void
  title?: string
  description?: string
}) {
  const context = paymentRooms(data, payment, asOf)
  const payer = payment.scope === 'ROOM' ? 'Room-level payment' : data.tenants.find(tenant => tenant.id === payment.tenantId)?.name
  const receipt = [...data.receipts].filter(item => item.paymentId === payment.id).sort((a, b) => b.revision - a.revision)[0]?.receiptNumber
  const advance = data.tenantCredits.some(credit => credit.sourcePaymentId === payment.id)
  const correction = data.paymentCorrections.find(item => item.correctedPaymentId === payment.id || item.originalPaymentId === payment.id)
  const allocatedCents = data.paymentAllocations.filter(allocation => allocation.paymentId === payment.id && allocation.state === 'ACTIVE' && allocation.allocatedOn <= asOf)
    .reduce((sum, allocation) => sum + allocation.amountCents, 0)
  const editUnavailableReason = !onEditPayment ? null
    : payment.state !== 'RECORDED' ? 'Voided payments cannot be edited.'
      : correction ? 'This is a revised transaction. Review it in Correction History; a transaction can only be corrected once.'
        : context.allocations.length === 0 ? (advance ? 'Advance payments have no bill categories to correct.' : 'This transaction has no bill allocations to correct.')
          : allocatedCents !== payment.amountCents ? 'This transaction includes unallocated money, so it cannot be corrected safely from this dialog.'
            : data.paymentCorrections.some(item => item.originalPaymentId === payment.id) ? 'This transaction has already been corrected.'
              : null
  const { open, requestClose, onOpenChange, onAnimationEnd } = useAnimatedDialogClose(onClose)

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="transaction-dialog" onAnimationEnd={onAnimationEnd} onCloseAutoFocus={event => { event.preventDefault(); onReturnFocus() }}>
      <DialogHeader className="transaction-dialog-heading">
        <span className="transaction-dialog-icon"><ReceiptText aria-hidden="true" /></span>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>

      <section className="transaction-summary" aria-label="Payment summary">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Room</p><p className="mt-1 text-xl font-bold">{context.label}</p></div>
          <StatusBadge status={payment.state === 'VOIDED' ? 'Voided' : payment.correction ? 'Corrected' : 'Recorded'} />
        </div>
        <dl className="transaction-metadata mt-4 grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-muted-foreground">Date paid</dt><dd className="mt-1 font-semibold">{formatDate(payment.paidOn)}</dd></div>
          <div><dt className="text-muted-foreground">Receipt number</dt><dd className="mt-1 break-all font-semibold">{receipt ?? 'No receipt yet'}</dd></div>
          <div className="transaction-amount-section"><dt className="text-muted-foreground">Amount paid</dt><dd className="transaction-dialog-amount">{formatMoney(payment.amountCents)}</dd></div>
        </dl>
      </section>

      <p className="text-sm"><span className="text-muted-foreground">Paid by:</span> <strong className="font-semibold">{payer ?? 'Not recorded'}</strong></p>

      {correction && <section className="transaction-correction" aria-label="Payment correction summary">
        <h2 className="font-semibold">Correction</h2>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">Original recorded amount</dt><dd className="font-semibold">{formatMoney(correction.originalAmountCents)}</dd></div>
          <div><dt className="text-muted-foreground">Corrected bill total</dt><dd className="font-semibold">{formatMoney(correction.correctedAmountCents)}</dd></div>
          <div><dt className="text-muted-foreground">Difference</dt><dd className="font-semibold">{formatMoney(Math.abs(correction.differenceCents))}</dd></div>
          <div><dt className="text-muted-foreground">Money handling</dt><dd className={isLegacyPendingCorrection(correction.settlementStatus) ? 'font-semibold text-amber-900' : 'font-semibold'}>{correctionSettlementText(correction)}</dd></div>
          <div className="sm:col-span-2"><dt className="text-muted-foreground">Reason</dt><dd className="font-semibold">{correction.reason}</dd></div>
        </dl>
      </section>}

      <section aria-labelledby="transaction-paid-title">
        <h2 id="transaction-paid-title" className="mb-3 font-semibold">What Was Paid</h2>
        <TransactionPaidLines data={data} context={context} advance={advance} />
      </section>

      <p className="break-all text-xs text-muted-foreground">Payment ID: {payment.id}</p>
      <DialogFooter className="transaction-dialog-footer">
        {editUnavailableReason && <p className="transaction-edit-unavailable">{editUnavailableReason}</p>}
        {onEditPayment && !editUnavailableReason && <Button variant="outline" onClick={event => onEditPayment(payment, event.currentTarget)}>Edit Payment</Button>}
        <Button onFocus={event => event.currentTarget.scrollIntoView?.({ block: 'nearest' })} onClick={requestClose}>Done</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
