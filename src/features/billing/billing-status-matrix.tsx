import type { ChargeCategory, PrototypeAppState } from '@/domain/types/models'
import { financialTotals, selectRoomFinance } from '@/domain/calculations/room-finance'
import { ChargeDetails } from '@/components/shared/charge-details'
import { DataTable } from '@/components/shared/data-table'
import { StatusBadge } from '@/components/shared/status-badge'
import { CATEGORY_LABELS } from '@/lib/labels'
import { formatMoney } from '@/lib/format'

const categories: ChargeCategory[] = ['RENT', 'ELECTRICITY', 'WATER', 'WASHING_MACHINE']

export function BillingStatusMatrix({ data, periodId, asOf, outstandingOnly }: { data: PrototypeAppState; periodId: string; asOf: string; outstandingOnly: boolean }) {
  const rooms = selectRoomFinance(data, asOf, periodId).filter(room => !outstandingOnly || room.outstanding > 0)
  return <DataTable rows={rooms} caption="Who has paid" columns={[
    { key: 'room', label: 'Room', render: room => <div className="max-w-xs whitespace-normal"><p className="font-semibold">{room.context.label}</p><p className="mt-1 text-xs text-muted-foreground">{room.charges.length} individual charges</p></div> },
    ...categories.map(category => ({ key: category, label: CATEGORY_LABELS[category], render: (room: typeof rooms[number]) => {
      const items = room.charges.filter(c => c.category === category)
      if (!items.length) return <span className="text-sm text-muted-foreground">No bill</span>
      const totals = financialTotals(data, items, asOf)
      return <div className="space-y-2"><p className="font-semibold tabular-nums">{formatMoney(totals.billed)}</p><StatusBadge status={totals.status === 'PAID' ? 'Paid' : totals.status === 'PARTIALLY_PAID' ? 'Partly paid' : 'Not yet paid'} />{totals.outstanding > 0 && <p className="text-sm text-muted-foreground">Left to pay: {formatMoney(totals.outstanding)}</p>}</div>
    } })),
    { key: 'details', label: 'Underlying charges', render: room => <ChargeDetails data={data} charges={room.charges} asOf={asOf} /> },
  ]} />
}
