import { Check, CircleDashed, Clock3 } from 'lucide-react'
import type { PrototypeAppState } from '@/domain/types/models'
import { financialTotals } from '@/domain/calculations/room-finance'
import { unresolvedElectricity } from '@/domain/calculations/summary'
import { PaginatedDataTable } from '@/components/shared/table-pagination'
import { CATEGORY_LABELS } from '@/lib/labels'
import { formatMoney } from '@/lib/format'
import { billingCategories, selectBillingRooms, type BillingRoomStatus } from './billing-room-status'

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

export function BillingStatusMatrix({ data, periodId, asOf, outstandingOnly, statusFilter = null }: { data: PrototypeAppState; periodId: string; asOf: string; outstandingOnly: boolean; statusFilter?: BillingRoomStatus | null }) {
  const rooms = selectBillingRooms(data, periodId, asOf, outstandingOnly).filter(room => !statusFilter || room.billingStatus === statusFilter)
  return <PaginatedDataTable rows={rooms} resetKey={`${periodId}:${outstandingOnly}:${statusFilter ?? 'ALL'}`} recordLabel="bills" caption="Who has paid" columns={[
    { key: 'room', label: 'Room', render: room => <div className="max-w-xs whitespace-normal"><p className="font-semibold">{room.context.label}</p><p className="mt-1 text-xs text-muted-foreground">{room.charges.length} issued {room.charges.length === 1 ? 'charge' : 'charges'}{room.projectedCharges.length > 0 && ` · ${room.projectedCharges.length} projected`}</p></div> },
    ...billingCategories.map(category => ({ key: category, label: CATEGORY_LABELS[category], render: (room: typeof rooms[number]) => {
      const items = room.charges.filter(charge => charge.category === category)
      const projected = room.projectedCharges.filter(charge => charge.category === category)
      const awaitingReading = category === 'ELECTRICITY' && room.context.roomId
        ? unresolvedElectricity(data, asOf, periodId, room.context.roomId).length > 0
        : false
      if (awaitingReading) return <AwaitingReadingLabel />
      if (!items.length && !projected.length) return <MissingCategoryLabel washing={category === 'WASHING_MACHINE'} />
      const totals = financialTotals(data, items, asOf)
      const outstanding = totals.outstanding + projected.reduce((sum, charge) => sum + charge.amountCents, 0)
      if (category === 'ELECTRICITY') return outstanding > 0 ? <UnsettledLabel /> : <PaidCategoryLabel />
      return outstanding > 0 ? <p className="font-semibold tabular-nums">{formatMoney(outstanding)}</p> : <PaidCategoryLabel />
    } })),
    { key: 'status', label: 'Status', render: room => <RoomStatus status={room.billingStatus} /> },
  ]} />
}
