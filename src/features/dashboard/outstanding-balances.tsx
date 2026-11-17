import { useRef, useState, type ReactNode } from 'react'
import { Button, Flex, Text } from '@radix-ui/themes'
import { Section } from '@/components/shared/page'
import { AnimatedNumber } from '@/components/shared/animated-number'
import { selectRoomFinance } from '@/domain/calculations/room-finance'
import type { PrototypeAppState } from '@/domain/types/models'
import { formatMoney } from '@/lib/format'
import { PendingPaymentsDialog } from './pending-payments-dialog'

/** ecordPayment supplies the room-specific payment entry point; the list itself stays read-only. */
export function OutstandingBalances({ data, asOf, recordPayment }: { data: PrototypeAppState; asOf: string; recordPayment?: (room: { roomId: string; label: string }) => ReactNode }) {
  const rooms = selectRoomFinance(data, asOf).filter(room => room.outstanding > 0 || room.unresolved > 0)
    .sort((a, b) => b.outstanding - a.outstanding || b.unresolved - a.unresolved || a.id.localeCompare(b.id)).slice(0, 4)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const selected = rooms.find(room => room.id === selectedId)

  return <Section title="Outstanding balances" description="Known room balances · electricity without a reading is separate">
    {rooms.length > 0
      ? <div className="panel" style={{ padding: '0 20px' }}>
        <ul className="row-list" aria-label="Outstanding room balances">{rooms.map(room => <li key={room.id} className="row" style={{ flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <Text as="p" size="3" weight="bold">{room.context.label}</Text>
            {room.unresolved > 0 && <Text as="p" size="1" color="amber">{room.unresolved} electricity awaiting reading</Text>}
          </div>
          <Flex align="center" gap="3" wrap="wrap" justify="end">
            {room.outstanding === 0 && room.unresolved > 0
              ? <Text size="2" weight="medium">Amount pending calculation</Text>
              : <Text size="3" weight="bold" color="red" className="num"><AnimatedNumber value={formatMoney(room.outstanding)} /></Text>}
            <Button variant="ghost" color="gray" size="2" aria-label={`View pending payments for ${room.context.label}`} onClick={event => { trigger.current = event.currentTarget; setSelectedId(room.id) }}>View pending payments</Button>
            {recordPayment && room.context.roomId && recordPayment({ roomId: room.context.roomId, label: room.context.label })}
          </Flex>
        </li>)}</ul>
      </div>
      : <Text as="p" size="2" color="gray">No outstanding balances.</Text>}
    {selected && <PendingPaymentsDialog key={selected.id} data={data} room={selected} asOf={asOf} onClose={() => setSelectedId(null)} onReturnFocus={() => trigger.current?.focus()} />}
  </Section>
}
