import { ChevronDown, DoorOpen, Droplets, House, ShieldCheck, Wallet, WashingMachine, Zap } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAnimatedDialogClose } from '@/components/ui/use-animated-dialog-close'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/shared/status-badge'
import type { PrototypeAppState } from '@/domain/types/models'
import type { RoomFinance } from '@/domain/calculations/room-finance'
import { CATEGORY_LABELS } from '@/lib/labels'
import { formatDate, formatMoney } from '@/lib/format'
import { pendingPaymentCategories } from './pending-payment-groups'
import { unresolvedElectricity } from '@/domain/calculations/summary'
import { collectionCatalog } from '@/domain/calculations/payment-collection'

const icons = { RENT: House, ELECTRICITY: Zap, WATER: Droplets, WASHING_MACHINE: WashingMachine, ADVANCE: Wallet, SECURITY_DEPOSIT: ShieldCheck }
const timingLabels = { earlier: 'Past month', current: 'Current month', upcoming: 'Upcoming month', review: 'Month needs review' }
const formatKwh = (milliKwh: number) => `${milliKwh / 1000} kWh`

export function PendingPaymentsDialog({ data, room, asOf, onClose, onReturnFocus }: {
  data: PrototypeAppState
  room: RoomFinance
  asOf: string
  onClose: () => void
  onReturnFocus: () => void
}) {
  const roomId = room.context.roomId
  const projected = roomId && data.occupancyCycles.some(cycle => cycle.roomId === roomId && cycle.rentSchedule === 'ANNIVERSARY')
    ? collectionCatalog(data, roomId, asOf).flatMap(item => item.charge && !data.charges.some(charge => charge.id === item.charge!.id) ? [item.charge] : [])
    : []
  const categories = pendingPaymentCategories(data, [...room.charges, ...projected], asOf, roomId ?? undefined)
  const total = categories.reduce((sum, category) => sum + category.outstanding, 0)
  const unresolved = categories.reduce((sum, category) => sum + category.unresolved, 0)
  const count = categories.reduce((sum, category) => sum + category.chargeCount, 0)
  const pendingElectricity = room.context.roomId ? unresolvedElectricity(data, asOf, undefined, room.context.roomId)[0] : undefined
  const previousSettled = pendingElectricity ? data.meterReadings.find(reading => reading.id === pendingElectricity.previousReadingId) : undefined
  const { open, requestClose, onOpenChange, onAnimationEnd } = useAnimatedDialogClose(onClose)

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="pending-payments-dialog" onAnimationEnd={onAnimationEnd} onCloseAutoFocus={event => { event.preventDefault(); onReturnFocus() }}>
      <DialogHeader className="pending-dialog-heading">
        <div className="flex items-center gap-3 pr-5"><span className="pending-room-icon"><DoorOpen aria-hidden="true" /></span><DialogTitle>{room.context.label} · Pending Payments</DialogTitle></div>
        <DialogDescription>All unpaid billing periods — older unpaid months first.</DialogDescription>
        {room.context.roomId === null && <p className="text-xs text-muted-foreground">The historical room needs review. Original charge records remain in Billing.</p>}
        <div className="pending-total-summary"><div><p className="text-sm text-muted-foreground">{unresolved > 0 ? 'Known total still to pay' : 'Total still to pay'}</p><p className="mt-1 text-xs text-muted-foreground">{count} pending {count === 1 ? 'bill' : 'bills'}{unresolved > 0 ? ` · ${unresolved} awaiting meter reading` : ''} · As of {formatDate(asOf)} </p>{unresolved > 0 && <p className="mt-1 text-xs text-muted-foreground">Excludes electricity awaiting calculation.</p>}</div><p className="pending-total-amount">{total > 0 ? formatMoney(total) : unresolved > 0 ? 'Amount pending calculation' : formatMoney(0)}</p></div>
      </DialogHeader>
      <div className="pending-dialog-body">
        {categories.length === 0 ? <p role="status" className="py-8 text-center text-muted-foreground">No pending payments for this room.</p> : categories.map(category => {
          const Icon = icons[category.category]
          const status = category.unresolved > 0 ? 'Not yet paid' : category.months.some(month => month.status === 'PARTIALLY_PAID') ? 'Partly paid' : 'Not yet paid'
          return <section key={category.id} className="pending-payment-category" aria-label={`${CATEGORY_LABELS[category.category]} pending payments`}>
            <div className="pending-payment-item">
              <div className="pending-category-heading flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="pending-category-icon"><Icon className="size-[18px]" aria-hidden="true" /></span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{CATEGORY_LABELS[category.category]}</h2>{category.optional && <span className="pending-optional-badge">Optional</span>}</div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{category.months.length} pending {category.months.length === 1 ? 'month' : 'months'} · {status}</p>
                  </div>
                </div>
                <div className="pending-category-amount shrink-0 text-right">
                  <p className="pending-bill-amount">{category.outstanding > 0 ? formatMoney(category.outstanding) : category.unresolved > 0 ? 'Amount pending calculation' : formatMoney(0)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{category.unresolved > 0 ? 'plus unresolved electricity' : 'left to pay'}</p>
                </div>
              </div>
              {category.category === 'ELECTRICITY' && category.unresolved > 0 && previousSettled && <div className="pending-electricity-action">
                <p><span className="font-semibold">Last settled reading:</span> {formatKwh(previousSettled.readingMilliKwh)} · {formatDate(previousSettled.readOn)}</p>
                <p>Enter a reading from Billing → Calculate payment.</p>
              </div>}
              <details className="pending-month-details">
                <summary><span>View bill details</span><ChevronDown aria-hidden="true" /></summary>
                <ul aria-label={`${CATEGORY_LABELS[category.category]} pending months`}>{category.months.map(month => <li key={month.id} className="pending-month-row">
                  <div className="min-w-0"><p className="font-semibold">{month.unresolved > 0 ? `Cumulative electricity · ${month.label}` : month.label}</p><p className="mt-0.5 text-xs text-muted-foreground">{month.unresolved > 0 && previousSettled ? `Covers consumption since ${formatDate(previousSettled.readOn)}` : timingLabels[month.timing]}{month.overdue > 0 && month.unresolved === 0 ? ' · Past due' : ''}</p><p className="mt-1 text-xs text-muted-foreground">{month.dueDates.length > 0 ? `Due ${month.dueDates.map(formatDate).join(' / ')}` : 'Due date not recorded'}{month.billed > 0 ? ` · Billed ${formatMoney(month.billed)}` : ''}{month.paid > 0 ? ` · Paid ${formatMoney(month.paid)}` : ''}{month.unresolved > 0 ? previousSettled ? ` · Last settled ${formatKwh(previousSettled.readingMilliKwh)} · Current meter reading not entered` : ' · Verified initial meter reading required; no amount calculated' : ''}</p></div>
                  <div className="shrink-0 text-right"><StatusBadge status={month.unresolved > 0 ? 'Not yet paid' : month.status === 'PARTIALLY_PAID' ? 'Partly paid' : 'Not yet paid'} />
                    {month.unresolved > 0 && month.outstanding === 0
                      ? <p className="mt-1 text-sm font-bold">Amount pending calculation</p>
                      : <p className="pending-month-amount mt-1 text-sm font-bold tabular-nums">{formatMoney(month.outstanding)} <span className="text-xs font-normal text-muted-foreground">{month.unresolved > 0 ? 'known left' : 'left'}</span></p>}
                  </div>
                </li>)}</ul>
                {category.optional && <p className="pending-optional-note">Washing is optional. If this bill is not paid, the washing machine cannot be used.</p>}
              </details>
            </div>
          </section>
        })}
        <p className="mt-4 text-xs text-muted-foreground">Fully paid months are hidden. Each category lists its older unpaid months first.{unresolved > 0 ? ` ${unresolved} electricity ${unresolved === 1 ? 'bill is' : 'bills are'} awaiting a meter reading ${unresolved === 1 ? 'and is' : 'and are'} not included in the known amount.` : ''} {categories.some(category => category.optional) ? 'Washing is optional and cannot be used while unpaid.' : 'Washing is optional. If a washing bill is not paid, the washing machine cannot be used.'}</p>
      </div>
      <DialogFooter className="pending-dialog-footer"><Button aria-label="Close pending payments" onClick={requestClose}>Close</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
