import { ReceiptText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAnimatedDialogClose } from '@/components/ui/use-animated-dialog-close'
import { StatusBadge } from '@/components/shared/status-badge'
import type { PrototypeAppState, Receipt } from '@/domain/types/models'
import { formatDate, formatMoney } from '@/lib/format'
import { CATEGORY_LABELS } from '@/lib/labels'
import { chargeRoom, paymentRooms } from '@/domain/calculations/room-finance'

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
  const allocationRoomIds = new Set(allocations.map(allocation => {
    const charge = data.charges.find(item => item.id === allocation.chargeId)
    return charge ? chargeRoom(data, charge).id : `review:${allocation.chargeId}`
  }))
  const allocationsSpanMultipleRooms = allocationRoomIds.size > 1
  const advance = data.tenantCredits.some(item => item.sourcePaymentId === receipt.paymentId)
  const correction = data.paymentCorrections.find(item => item.correctedReceiptId === receipt.id || item.originalReceiptId === receipt.id)
  const originalReceipt = correction && data.receipts.find(item => item.id === correction.originalReceiptId)
  const { open, requestClose, onOpenChange, onAnimationEnd } = useAnimatedDialogClose(onClose)

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="gap-4 sm:max-w-lg" onAnimationEnd={onAnimationEnd} onCloseAutoFocus={event => { event.preventDefault(); onReturnFocus() }}>
      <DialogHeader className="pr-6">
        <span className="mb-1 flex size-12 items-center justify-center rounded-2xl bg-accent text-primary"><ReceiptText className="size-6" aria-hidden="true" /></span>
        <DialogTitle>{receipt.state === 'SUPERSEDED' ? 'Superseded receipt' : receipt.revision > 1 ? 'Revised receipt' : 'Sample receipt'} · {receipt.receiptNumber}</DialogTitle>
        <DialogDescription>Halili BH · Receipt details from the sample records.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap items-center gap-2"><StatusBadge status={receipt.state === 'SUPERSEDED' ? 'Superseded' : receipt.state === 'ISSUED' ? (receipt.revision > 1 ? 'Corrected' : 'Recorded') : 'Voided'} /><span className="text-xs text-muted-foreground">Revision {receipt.revision}</span></div>
      {correction && <section className="transaction-correction" aria-label="Revised receipt correction details">
        <p className="font-semibold">Revised from {originalReceipt?.receiptNumber ?? 'the original receipt'}</p>
        <p className="mt-2 text-sm"><span className="text-muted-foreground">Reason:</span> {correction.reason}</p>
        <p className="mt-1 text-sm"><span className="text-muted-foreground">Corrected bill total:</span> {formatMoney(correction.correctedAmountCents)} · <span className="text-muted-foreground">Difference:</span> {formatMoney(Math.abs(correction.differenceCents))}</p>
        <p className="mt-2 text-sm font-semibold">{correction.settlementStatus === 'ADDITIONAL_PENDING' ? 'Additional payment is still pending; it is not included as received.' : correction.settlementStatus === 'REFUND_PENDING' ? 'Refund is still pending.' : correction.settlementStatus === 'REFUND_COMPLETED' ? 'Refund has been completed.' : correction.settlementStatus === 'ADDITIONAL_RECEIVED' ? 'Additional payment has been received.' : correction.settlementStatus === 'NO_MONEY_MOVED' ? 'Recording correction only; no money moved.' : 'No additional payment or refund required.'}</p>
      </section>}
      <dl className="grid min-w-0 grid-cols-2 gap-3 rounded-2xl border bg-muted/40 p-4 text-sm">
        <div className="col-span-2"><dt className="text-muted-foreground">Room context</dt><dd className="mt-1 font-semibold">{payment ? paymentRooms(data, payment, receipt.issuedOn, receipt.allocationIds).label : 'Room needs review'}</dd></div>
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
              <div className="min-w-0"><p className="font-semibold">{charge ? CATEGORY_LABELS[charge.category] : 'Bill'}{allocationsSpanMultipleRooms ? ` · ${charge ? chargeRoom(data, charge).label : 'Room needs review'}` : ''}</p>{charge?.category === 'ELECTRICITY' && <p className="mt-1 text-xs text-muted-foreground">Previous settled {charge.electricity.previousReadingMilliKwh / 1000} kWh → current {charge.electricity.currentReadingMilliKwh / 1000} kWh · {charge.electricity.consumptionMilliKwh / 1000} kWh × {formatMoney(charge.electricity.appliedRateCentsPerKwh)}/kWh</p>}{period && <p className="mt-1 text-xs text-muted-foreground">{period.label}</p>}<p className="mt-1 break-all text-xs text-muted-foreground">Charge: {allocation.chargeId} · Allocation: {allocation.id}</p>{allocation.state === 'REVERSED' && <p className="mt-1 text-xs text-muted-foreground">Allocation later reversed</p>}</div>
              <span className="font-semibold tabular-nums">{formatMoney(allocation.amountCents)}</span>
            </li>
          })}
        </ul> : <p className="rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground">{advance ? 'Advance payment — kept for a future bill' : 'No bill allocations were included when this receipt was issued.'}</p>}
      </section>
      <p className="text-xs text-muted-foreground">Demonstration preview · Not an official receipt</p>
      <DialogFooter><Button aria-label="Close receipt" onClick={requestClose}>Close</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
