import { ReceiptText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAnimatedDialogClose } from '@/components/ui/use-animated-dialog-close'
import { StatusBadge } from './status-badge'
import type { Payment, PrototypeAppState } from '@/domain/types/models'
import { paymentRooms } from '@/domain/calculations/room-finance'
import { formatDate, formatMoney } from '@/lib/format'
import { CATEGORY_LABELS } from '@/lib/labels'

export function TransactionDialog({ data, payment, asOf, onClose, onReturnFocus }: {
  data: PrototypeAppState
  payment: Payment
  asOf: string
  onClose: () => void
  onReturnFocus: () => void
}) {
  const context = paymentRooms(data, payment, asOf)
  const payer = data.tenants.find(tenant => tenant.id === payment.tenantId)?.name
  const receipt = data.receipts.find(item => item.paymentId === payment.id && item.state === 'ISSUED')?.receiptNumber
  const advance = data.tenantCredits.some(credit => credit.sourcePaymentId === payment.id)
  const { open, requestClose, onOpenChange, onAnimationEnd } = useAnimatedDialogClose(onClose)

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="transaction-dialog sm:max-w-lg" onAnimationEnd={onAnimationEnd} onCloseAutoFocus={event => { event.preventDefault(); onReturnFocus() }}>
      <DialogHeader className="transaction-dialog-heading">
        <span className="transaction-dialog-icon"><ReceiptText aria-hidden="true" /></span>
        <DialogTitle>Transaction Details</DialogTitle>
        <DialogDescription>Payment information for the selected room.</DialogDescription>
      </DialogHeader>

      <section className="transaction-summary" aria-label="Payment summary">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Room</p><p className="mt-1 text-xl font-bold">{context.label}</p></div>
          <StatusBadge status={payment.state === 'RECORDED' ? 'Recorded' : 'Voided'} />
        </div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">Date paid</dt><dd className="mt-1 font-semibold">{formatDate(payment.paidOn)}</dd></div>
          <div><dt className="text-muted-foreground">Payment method</dt><dd className="mt-1 font-semibold">{payment.method === 'cash' ? 'Cash' : 'Bank transfer'}</dd></div>
          <div><dt className="text-muted-foreground">Receipt number</dt><dd className="mt-1 break-all font-semibold">{receipt ?? 'No receipt yet'}</dd></div>
          <div><dt className="text-muted-foreground">Amount paid</dt><dd className="transaction-dialog-amount">{formatMoney(payment.amountCents)}</dd></div>
        </dl>
      </section>

      <p className="text-sm"><span className="text-muted-foreground">Paid by:</span> <strong className="font-semibold">{payer ?? 'Not recorded'}</strong></p>

      <section aria-labelledby="transaction-paid-title">
        <h2 id="transaction-paid-title" className="mb-3 font-semibold">What Was Paid</h2>
        {context.allocations.length > 0 && <ul className="transaction-lines">{context.allocations.map(allocation => {
          const charge = data.charges.find(item => item.id === allocation.chargeId)
          return <li key={allocation.id}>
            <div className="min-w-0"><p className="font-semibold">{charge ? CATEGORY_LABELS[charge.category] : 'Bill'}</p><p className="mt-0.5 break-words text-xs text-muted-foreground">{allocation.context.label}</p></div>
            <span className="shrink-0 font-semibold tabular-nums">{formatMoney(allocation.amountCents)}</span>
          </li>
        })}</ul>}
        {context.unallocated > 0 && <div className="transaction-unallocated">
          <div className="min-w-0"><p className="font-semibold">{context.allocations.length === 0 && advance ? 'Advance payment — Unallocated' : 'Unallocated amount'}</p><p className="mt-1 text-sm text-muted-foreground">This money is being held for future billing and is not yet applied to an issued bill.</p></div>
          <span className="shrink-0 font-semibold tabular-nums">{formatMoney(context.unallocated)}</span>
        </div>}
        {context.allocations.length === 0 && context.unallocated === 0 && <p className="rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground">No bill categories were allocated to this payment.</p>}
      </section>

      <p className="break-all text-xs text-muted-foreground">Payment ID: {payment.id}</p>
      <DialogFooter><Button onClick={requestClose}>Done</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
