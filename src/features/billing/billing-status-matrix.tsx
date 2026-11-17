import { Text } from '@radix-ui/themes'
import type { PrototypeAppState } from '@/domain/types/models'
import { financialTotals } from '@/domain/calculations/room-finance'
import { unresolvedElectricity } from '@/domain/calculations/summary'
import { DataTable } from '@/components/shared/data-table'
import { StatusBadge } from '@/components/shared/status-badge'
import { CATEGORY_LABELS } from '@/lib/labels'
import { formatMoney } from '@/lib/format'
import { billingCategories, selectBillingRooms, type BillingRoomStatus } from './billing-room-status'

const roomStatusLabels: Record<BillingRoomStatus, { status: string; label?: string }> = {
  'PAID': { status: 'Paid' },
  'PARTLY PAID': { status: 'Partly paid', label: 'PARTLY PAID' },
  'NOT YET PAID': { status: 'Not yet paid', label: 'NOT YET PAID' },
}

function RoomStatus({ status }: { status: BillingRoomStatus }) {
  const { status: name, label } = roomStatusLabels[status]
  return <StatusBadge status={name} label={label} />
}

export function BillingStatusMatrix({ data, periodId, asOf, outstandingOnly, statusFilter = null }: { data: PrototypeAppState; periodId: string; asOf: string; outstandingOnly: boolean; statusFilter?: BillingRoomStatus | null }) {
  const rooms = selectBillingRooms(data, periodId, asOf, outstandingOnly).filter(room => !statusFilter || room.billingStatus === statusFilter)
  return <DataTable rows={rooms} caption="Who has paid" columns={[
    { key: 'room', label: 'Room', render: room => <div style={{ maxWidth: '20rem', whiteSpace: 'normal' }}><Text as="p" size="2" weight="medium">{room.context.label}</Text><Text as="p" size="1" color="gray">{room.charges.length} individual charges</Text></div> },
    ...billingCategories.map(category => ({ key: category, label: CATEGORY_LABELS[category], render: (room: typeof rooms[number]) => {
      const items = room.charges.filter(charge => charge.category === category)
      const awaitingReading = category === 'ELECTRICITY' && room.context.roomId
        ? unresolvedElectricity(data, asOf, periodId, room.context.roomId).length > 0
        : false
      if (awaitingReading) return <Text size="2" color="amber" weight="medium">AWAITING READING</Text>
      if (!items.length) return <Text size="2" color="gray">{category === 'WASHING_MACHINE' ? 'DID NOT AVAIL' : 'NO BILL'}</Text>
      const totals = financialTotals(data, items, asOf)
      if (totals.outstanding <= 0) return <Text size="2" color="gray">PAID</Text>
      if (category === 'ELECTRICITY') return <Text size="2" color="red" weight="medium">NOT YET PAID</Text>
      return <Text size="2" weight="medium" className="num">{formatMoney(totals.outstanding)}</Text>
    } })),
    { key: 'status', label: 'Status', render: room => <RoomStatus status={room.billingStatus} /> },
  ]} />
}
