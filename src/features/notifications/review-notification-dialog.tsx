import { ArrowLeftRight, ReceiptText, ShieldCheck, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { usePrototype } from '@/hooks/use-prototype'
import { useOccupancyDate } from '@/hooks/use-occupancy-date'
import { formatDate, formatMoney } from '@/lib/format'
import type { ReviewNotificationKind } from './select-notifications'
import { selectMoveInTransferReviews, selectMoveOutDepositReviews, selectRoomChangeBillingReviews } from './review-notifications'

const reviewMeta = {
  'move-in-transfer-review': {
    title: 'Move-in transfer rent reviews',
    description: 'These rooms changed rent snapshots during an active occupancy. Review any difference manually; nothing has been posted.',
    icon: ArrowLeftRight,
    note: 'No advance, deposit, rent, or payment record was changed automatically.',
  },
  'move-out-deposit-review': {
    title: 'Move-out deposit records',
    description: 'Closed occupancies keep their deposit history. No refund, forfeiture, or rental-income recognition has been posted.',
    icon: ShieldCheck,
    note: 'The full history remains available in Room payment records.',
  },
  'room-change-billing-review': {
    title: 'Room change billing review',
    description: 'Approved transfers affect room rent mid-period. Review any rent effect manually; no proration or duplicate rent was generated automatically.',
    icon: ReceiptText,
    note: 'This alert clears automatically when the transfer becomes effective.',
  },
} satisfies Record<ReviewNotificationKind, { title: string; description: string; icon: typeof Wallet; note: string }>

export function ReviewNotificationDialog({ kind, onClose }: {
  kind: ReviewNotificationKind | null
  onClose: () => void
}) {
  const { data } = usePrototype()
  const occupancyDate = useOccupancyDate()
  if (!kind) return null
  const meta = reviewMeta[kind]
  const Icon = meta.icon
  const transferReviews = kind === 'move-in-transfer-review' ? selectMoveInTransferReviews(data) : []
  const depositReviews = kind === 'move-out-deposit-review' ? selectMoveOutDepositReviews(data, occupancyDate) : []
  const roomChangeReviews = kind === 'room-change-billing-review' ? selectRoomChangeBillingReviews(data, occupancyDate) : []
  const itemCount = transferReviews.length + depositReviews.length + roomChangeReviews.length

  return <Dialog open onOpenChange={next => { if (!next) onClose() }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" aria-describedby="review-notification-description">
      <DialogHeader className="pr-6">
        <span className="financial-review-summary-icon"><Icon aria-hidden="true" /></span>
        <DialogTitle>{meta.title}</DialogTitle>
        <DialogDescription id="review-notification-description">{meta.description}</DialogDescription>
      </DialogHeader>
      {itemCount === 0
        ? <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">There are no review items remaining. This alert will disappear when the notification list refreshes.</p>
        : <div className="grid gap-3">
            {transferReviews.map(item => <article key={item.cycle.id} className="rounded-xl border bg-card p-4 text-sm">
              <h3 className="font-semibold">Room {item.room.name}</h3>
              <dl className="mt-3 grid gap-2 text-muted-foreground sm:grid-cols-2">
                <div><dt>Previous rent</dt><dd className="font-semibold text-foreground">{formatMoney(item.previousRentCents)}</dd></div>
                <div><dt>Current rent</dt><dd className="font-semibold text-foreground">{formatMoney(item.currentRentCents)}</dd></div>
              </dl>
              <p className="mt-3 text-muted-foreground">No advance or deposit top-up is collected. The original deposit stays unchanged; any paid-period rent difference requires manual review.</p>
            </article>)}
            {depositReviews.map(({ view }) => <article key={view.obligation.id} className="rounded-xl border bg-card p-4 text-sm">
              <h3 className="font-semibold">Room {view.room.name}</h3>
              <p className="mt-1 text-muted-foreground">{view.payerName}</p>
              <dl className="mt-3 grid gap-2 text-muted-foreground sm:grid-cols-3">
                <div><dt>Deposit held</dt><dd className="font-semibold text-foreground">{formatMoney(view.depositPaidCents)}</dd></div>
                <div><dt>Advance outstanding</dt><dd className="font-semibold text-foreground">{formatMoney(view.advanceRemainingCents)}</dd></div>
                <div><dt>Deposit outstanding</dt><dd className="font-semibold text-foreground">{formatMoney(view.depositRemainingCents)}</dd></div>
              </dl>
            </article>)}
            {roomChangeReviews.map(item => <article key={item.request.id} className="rounded-xl border bg-card p-4 text-sm">
              <h3 className="font-semibold">{item.tenantName}</h3>
              <p className="mt-1 text-muted-foreground">Room {item.fromRoomName} → Room {item.toRoomName}, effective {formatDate(item.effectiveDate)}</p>
              <p className="mt-2 text-muted-foreground">Billing review: {item.periodLabels.join(', ')}</p>
            </article>)}
          </div>}
      <p className="rounded-xl border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">{meta.note}</p>
      <DialogFooter><Button type="button" onClick={onClose}>Done</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
