import type { PrototypeAppState } from '@/domain/types/models'
import type { PaymentRoomPresentation } from '@/domain/calculations/room-finance'
import { formatDate, formatMoney, formatShortDateRange } from '@/lib/format'
import { CATEGORY_LABELS } from '@/lib/labels'

/** Shared read-only transaction breakdown. A receipt can pass its historical allocation snapshot. */
export function TransactionPaidLines({ data, context, advance }: {
  data: PrototypeAppState
  context: PaymentRoomPresentation
  advance: boolean
}) {
  const multipleRooms = new Set(context.allocations.map(allocation => allocation.context.id)).size > 1
  return <>
    {context.allocations.length > 0 && <ul className="transaction-lines">{context.allocations.map(allocation => {
      const charge = data.charges.find(item => item.id === allocation.chargeId)
      const rent = data.rentObligations.find(item => item.id === allocation.chargeId)
      const rentalPeriod = rent ? data.rentalPeriods.find(item => item.id === rent.rentalPeriodId) : undefined
      const month = charge ? data.billingPeriods.find(item => item.id === charge.billingPeriodId) : undefined
      return <li key={allocation.id}>
        <div className="min-w-0"><p className="font-semibold">{rent ? 'Rent' : charge ? CATEGORY_LABELS[charge.category] : 'Bill'}</p>{rentalPeriod && <p className="text-xs text-muted-foreground">{formatShortDateRange(rentalPeriod.startDate, rentalPeriod.endDateExclusive)} · due {formatDate(rent!.dueDate)}</p>}{month && <p className="text-xs text-muted-foreground">Billing month: {month.label}</p>}{multipleRooms && <p className="mt-0.5 break-words text-xs text-muted-foreground">{allocation.context.label}</p>}{charge?.category === 'ELECTRICITY' && <p className="mt-1 text-xs text-muted-foreground">{charge.electricity.previousReadingMilliKwh / 1000} → {charge.electricity.currentReadingMilliKwh / 1000} kWh · {charge.electricity.consumptionMilliKwh / 1000} kWh × {formatMoney(charge.electricity.appliedRateCentsPerKwh)}/kWh</p>}</div>
        <span className="shrink-0 font-semibold tabular-nums">{formatMoney(allocation.amountCents)}</span>
      </li>
    })}</ul>}
    {context.unallocated > 0 && <div className="transaction-unallocated">
      <div className="min-w-0"><p className="font-semibold">{context.allocations.length === 0 && advance ? 'Advance payment — Unallocated' : 'Unallocated amount'}</p><p className="mt-1 text-sm text-muted-foreground">This money is being held for future billing and is not yet applied to an issued bill.</p></div>
      <span className="shrink-0 font-semibold tabular-nums">{formatMoney(context.unallocated)}</span>
    </div>}
    {context.allocations.length === 0 && context.unallocated === 0 && <p className="rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground">No bill categories were allocated to this payment.</p>}
  </>
}
