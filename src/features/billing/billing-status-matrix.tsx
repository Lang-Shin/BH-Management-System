import { Check, CircleDashed, Clock3 } from 'lucide-react'
import type { PrototypeAppState } from '@/domain/types/models'
import { financialTotals } from '@/domain/calculations/room-finance'
import { PaginatedDataTable } from '@/components/shared/table-pagination'
import { CATEGORY_LABELS } from '@/lib/labels'
import { formatMoney, formatShortDateRange } from '@/lib/format'
import { billingCategories, selectBillingRooms, type BillingRoom, type BillingRoomStatus } from './billing-room-status'

function PaidLabel() {
  return <span className="paid-indicator"><span className="paid-indicator-icon"><Check aria-hidden="true" /></span><span>Paid</span></span>
}

function PaidCategoryLabel() {
  return <span className="billing-paid-badge"><span aria-hidden="true" className="billing-paid-dot" />PAID</span>
}

function UnsettledLabel({ partial = false }: { partial?: boolean }) {
  const Icon = partial ? CircleDashed : Clock3
  return <span className="billing-state-pill" data-state={partial ? 'partial' : 'unpaid'}><span className="billing-state-icon"><Icon aria-hidden="true" /></span><span>{partial ? 'PARTLY PAID' : 'NOT YET PAID'}</span></span>
}

function MissingCategoryLabel({ washing = false }: { washing?: boolean }) {
  return <span className="text-sm text-muted-foreground">{washing ? 'DID NOT AVAIL' : 'NO BILL'}</span>
}

function AwaitingReadingLabel() {
  return <span className="text-sm font-semibold text-amber-900">AWAITING READING</span>
}

function RoomStatus({ status }: { status: BillingRoomStatus }) {
  if (status === 'PAID') return <PaidLabel />
  return <UnsettledLabel partial={status === 'PARTLY PAID'} />
}

function RentPeriodCell({ room }: { room: BillingRoom }) {
  const rent = room.rent
  if (rent.source === 'ANNIVERSARY') {
    if (rent.periods.length === 0) return <span className="text-sm text-muted-foreground" title="No anniversary rental period is due in the selected month.">No anniversary period</span>
    if (rent.periods.length === 1) {
      const period = rent.periods[0]!
      const label = formatShortDateRange(period.startDate, period.endDateExclusive)
      return <span title={`${label} · next period starts after the displayed end date`}>{label}</span>
    }
    const labels = rent.periods.map(period => formatShortDateRange(period.startDate, period.endDateExclusive))
    return <span title={labels.join(' · ')}>{rent.periods.length} periods due</span>
  }
  if (rent.source === 'LEGACY') return <span className="text-sm text-muted-foreground">Legacy calendar billing</span>
  return <span className="text-sm text-muted-foreground" aria-label="No anniversary rental period">—</span>
}

function RentCategoryCell({ room }: { room: BillingRoom }) {
  const rent = room.rent
  if (rent.status === 'NO_BILL') return <span className="text-sm text-muted-foreground">{rent.source === 'ANNIVERSARY' ? 'NO RENT DUE' : 'NO BILL'}</span>
  if (rent.outstandingCents === 0) return <PaidCategoryLabel />
  return <p className="font-semibold tabular-nums">{formatMoney(rent.outstandingCents)}</p>
}

export function BillingStatusMatrix({ data, periodId, asOf, outstandingOnly, statusFilter = null }: { data: PrototypeAppState; periodId: string; asOf: string; outstandingOnly: boolean; statusFilter?: BillingRoomStatus | null }) {
  const rooms = selectBillingRooms(data, periodId, asOf, outstandingOnly).filter(room => !statusFilter || room.billingStatus === statusFilter)
  return <PaginatedDataTable rows={rooms} resetKey={`${periodId}:${outstandingOnly}:${statusFilter ?? 'ALL'}`} recordLabel="bills" caption="Who has paid" columns={[
    { key: 'room', label: 'Room', render: room => <div className="max-w-xs whitespace-normal"><p className="font-semibold">{room.context.label}</p><p className="mt-1 text-xs text-muted-foreground">{room.issuedCount} issued {room.issuedCount === 1 ? 'charge' : 'charges'}{room.projectedCount > 0 && ` · ${room.projectedCount} projected`}</p></div> },
    { key: 'period', label: 'Period', render: room => <RentPeriodCell room={room} /> },
    ...billingCategories.map(category => ({ key: category, label: CATEGORY_LABELS[category], render: (room: BillingRoom) => {
      if (category === 'RENT') return <RentCategoryCell room={room} />
      const items = room.charges.filter(charge => charge.category === category)
      const projected = room.projectedCharges.filter(charge => charge.category === category)
      const awaitingReading = category === 'ELECTRICITY' && room.unresolved > 0
      if (awaitingReading) return <AwaitingReadingLabel />
      if (!items.length && !projected.length) return <MissingCategoryLabel washing={category === 'WASHING_MACHINE'} />
      const totals = financialTotals(data, [...items, ...projected], asOf)
      if (category === 'ELECTRICITY') return totals.outstanding > 0 ? <UnsettledLabel /> : <PaidCategoryLabel />
      return totals.outstanding > 0 ? <p className="font-semibold tabular-nums">{formatMoney(totals.outstanding)}</p> : <PaidCategoryLabel />
    } })),
    { key: 'status', label: 'Status', render: room => <RoomStatus status={room.billingStatus} /> },
  ]} />
}
