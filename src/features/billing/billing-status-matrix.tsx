import type { ChargeCategory, PrototypeAppState } from '@/domain/types/models'
import { financialTotals, selectRoomFinance } from '@/domain/calculations/room-finance'
import { DataTable } from '@/components/shared/data-table'
import { StatusBadge } from '@/components/shared/status-badge'
import { CATEGORY_LABELS } from '@/lib/labels'
import { formatMoney } from '@/lib/format'

const categories: ChargeCategory[] = ['RENT', 'ELECTRICITY', 'WATER', 'WASHING_MACHINE']

function PaidLabel() {
  return <StatusBadge status="Paid" label="PAID" />
}

function NotPaidLabel() {
  return <StatusBadge status="Not yet paid" label="NOT PAID" />
}

function NoBillLabel() {
  return <span className="text-sm text-muted-foreground">NO BILL</span>
}

function RoomStatus({ status }: { status: 'PAID' | 'PARTLY PAID' | 'NOT PAID' }) {
  if (status === 'PAID') return <StatusBadge status="Paid" label="PAID" />
  if (status === 'PARTLY PAID') return <StatusBadge status="Partly paid" label="PARTLY PAID" />
  return <StatusBadge status="Not yet paid" label="NOT PAID" />
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
      if (category === 'ELECTRICITY') return totals.outstanding > 0 ? <NotPaidLabel /> : <PaidLabel />
      return totals.outstanding > 0 ? <p className="font-semibold tabular-nums">{formatMoney(totals.outstanding)}</p> : <PaidLabel />
    } })),
    { key: 'status', label: 'Status', render: room => <RoomStatus status={roomStatus(data, room, asOf)} /> },
  ]} />
}
