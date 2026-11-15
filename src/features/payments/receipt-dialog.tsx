import { ReceiptText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { StatusBadge } from '@/components/shared/status-badge'
import type { PrototypeAppState, Receipt } from '@/domain/types/models'
import { formatDate, formatMoney } from '@/lib/format'
import { CATEGORY_LABELS } from '@/lib/labels'

export function ReceiptDialog({ data, receipt, onClose, onReturnFocus }: {
  data: PrototypeAppState
  receipt: Receipt
  onClose: () => void
  onReturnFocus: () => void
}) {
  const payment = data.payments.find(item => item.id === receipt.paymentId)
  const tenant = data.tenants.find(item => item.id === payment?.tenantId)
  // Use the receipt's issue-time allocation references, not the payment's live allocations.
  const allocations = data.paymentAllocations.filter(item => receipt.allocationIds.includes(item.id) && item.paymentId === receipt.paymentId)
  const advance = data.tenantCredits.some(item => item.sourcePaymentId === receipt.paymentId)

  return <Dialog open onOpenChange={open => { if (!open) onClose() }}>
    <DialogContent className="gap-4 sm:max-w-lg" onCloseAutoFocus={event => { event.preventDefault(); onReturnFocus() }}>
      <DialogHeader className="pr-6">
        <span className="mb-1 flex size-12 items-center justify-center rounded-2xl bg-accent text-primary"><ReceiptText className="size-6" aria-hidden="true" /></span>
        <DialogTitle>Sample receipt · {receipt.receiptNumber}</DialogTitle>
        <DialogDescription>Halili BH · Receipt details from the sample records.</DialogDescription>
      </DialogHeader>
      <div><StatusBadge status={receipt.state === 'ISSUED' ? 'Recorded' : 'Voided'} /></div>
      <dl className="grid min-w-0 grid-cols-2 gap-3 rounded-2xl border bg-muted/40 p-4 text-sm">
        <div className="min-w-0"><dt className="text-muted-foreground">Received from</dt><dd className="mt-1 break-words font-semibold">{tenant?.name ?? 'Unknown tenant'}</dd></div>
        <div><dt className="text-muted-foreground">Receipt date</dt><dd className="mt-1">{formatDate(receipt.issuedOn)}</dd></div>
        <div><dt className="text-muted-foreground">Payment method</dt><dd className="mt-1">{payment ? payment.method === 'cash' ? 'Cash' : 'Bank transfer' : 'Not available'}</dd></div>
        <div className="col-span-2 min-w-0 border-t pt-4"><dt className="text-muted-foreground">Amount paid</dt><dd className="mt-1 break-words text-3xl font-bold tabular-nums">{formatMoney(receipt.amountCents)}</dd></div>
      </dl>
      <section aria-labelledby="receipt-coverage-title">
        <h2 id="receipt-coverage-title" className="mb-3 font-semibold">What the payment covered</h2>
        {allocations.length > 0 ? <ul className="divide-y rounded-xl border px-4">
          {allocations.map(allocation => {
            const charge = data.charges.find(item => item.id === allocation.chargeId)
            const period = data.billingPeriods.find(item => item.id === charge?.billingPeriodId)
            return <li key={allocation.id} className="flex flex-wrap justify-between gap-3 py-2 text-sm">
              <div><p className="font-semibold">{charge ? CATEGORY_LABELS[charge.category] : 'Bill'}</p>{period && <p className="mt-1 text-xs text-muted-foreground">{period.label}</p>}{allocation.state === 'REVERSED' && <p className="mt-1 text-xs text-muted-foreground">Allocation later reversed</p>}</div>
              <span className="font-semibold tabular-nums">{formatMoney(allocation.amountCents)}</span>
            </li>
          })}
        </ul> : <p className="rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground">{advance ? 'Advance payment — kept for a future bill' : 'No bill allocations were included when this receipt was issued.'}</p>}
      </section>
      <p className="text-xs text-muted-foreground">Demonstration preview · Not an official receipt</p>
      <DialogFooter><Button aria-label="Close receipt" onClick={onClose}>Close</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
