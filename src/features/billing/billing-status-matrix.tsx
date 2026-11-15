import { Check, CircleDashed, Clock3 } from 'lucide-react'
import type { ChargeCategory, PrototypeAppState } from '@/domain/types/models'
import { financialTotals, selectRoomFinance } from '@/domain/calculations/room-finance'
import { DataTable } from '@/components/shared/data-table'
import { CATEGORY_LABELS } from '@/lib/labels'
import { formatMoney } from '@/lib/format'

const categories: ChargeCategory[] = ['RENT', 'ELECTRICITY', 'WATER', 'WASHING_MACHINE']

function PaidLabel() {
  return <span className="paid-indicator"><span className="paid-indicator-icon"><Check aria-hidden="true" /></span><span>Paid</span></span>
}

function PaidCategoryLabel() {
  return <span className="billing-paid-badge"><span aria-hidden="true" className="billing-paid-dot" />PAID</span>
}

function UnsettledLabel({ partial = false }: { partial?: boolean }) {
  const Icon = partial ? CircleDashed : Clock3
  return <span className="billing-state-pill" data-state={partial ? 'partial' : 'unpaid'}><span className="billing-state-icon"><Icon aria-hidden="true" /></span><span>{partial ? 'PARTLY PAID' : 'NOT PAID'}</span></span>
}

function NoBillLabel() {
  return <span className="text-sm text-muted-foreground">NO BILL</span>
}

function RoomStatus({ status }: { status: 'PAID' | 'PARTLY PAID' | 'NOT PAID' }) {
  if (status === 'PAID') return <PaidLabel />
  return <UnsettledLabel partial={status === 'PARTLY PAID'} />
}

function roomStatus(data: PrototypeAppState, room: ReturnType<typeof selectRoomFinance>[number], asOf: string): 'PAID' | 'PARTLY PAID' | 'NOT PAID' {
  const states = categories.flatMap(category => {
    const items = room.charges.filter(charge => charge.category === category)
    if (!items.length) return []
    return [financialTotals(data, items, asOf).outstanding === 0]
  })
  const paid = states.filter(Boolean).length
  if (states.length > 0 && paid === states.length) return 'PAID'
  if (paid > 0) return 'PARTLY PAID'
  return 'NOT PAID'
}

export function BillingStatusMatrix({ data, periodId, asOf, outstandingOnly }: { data: PrototypeAppState; periodId: string; asOf: string; outstandingOnly: boolean }) {
  const rooms = selectRoomFinance(data, asOf, periodId).filter(room => !outstandingOnly || room.outstanding > 0)
  return <DataTable rows={rooms} caption="Who has paid" columns={[
    { key: 'room', label: 'Room', render: room => <div className="max-w-xs whitespace-normal"><p className="font-semibold">{room.context.label}</p><p className="mt-1 text-xs text-muted-foreground">{room.charges.length} individual charges</p></div> },
    ...categories.map(category => ({ key: category, label: CATEGORY_LABELS[category], render: (room: typeof rooms[number]) => {
      const items = room.charges.filter(charge => charge.category === category)
      if (!items.length) return <NoBillLabel />
      const totals = financialTotals(data, items, asOf)
      if (category === 'ELECTRICITY') return totals.outstanding > 0 ? <UnsettledLabel /> : <PaidCategoryLabel />
      return totals.outstanding > 0 ? <p className="font-semibold tabular-nums">{formatMoney(totals.outstanding)}</p> : <PaidCategoryLabel />
    } })),
    { key: 'status', label: 'Status', render: room => <RoomStatus status={roomStatus(data, room, asOf)} /> },
  ]} />
}
