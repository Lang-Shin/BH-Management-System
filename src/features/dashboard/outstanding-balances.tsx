import { useRef, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AnimatedNumber } from '@/components/shared/animated-number'
import { selectRoomFinance } from '@/domain/calculations/room-finance'
import type { PrototypeAppState } from '@/domain/types/models'
import { formatMoney } from '@/lib/format'
import { PendingPaymentsDialog } from './pending-payments-dialog'

export function OutstandingBalances({ data, asOf }: { data: PrototypeAppState; asOf: string }) {
  const rooms = selectRoomFinance(data, asOf).filter(room => room.outstanding > 0)
    .sort((a, b) => b.outstanding - a.outstanding || a.id.localeCompare(b.id)).slice(0, 4)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const selected = rooms.find(room => room.id === selectedId)

  return <>
    <Card><CardHeader><CardTitle>Outstanding balances</CardTitle><CardDescription>Largest room balances · all issued bills</CardDescription></CardHeader><CardContent>
      <ul className="divide-y" aria-label="Outstanding room balances">{rooms.map(room => <li key={room.id} className="outstanding-room-row">
        <div className="min-w-0"><p className="text-base font-semibold">{room.context.label}</p><button type="button" className="pending-room-link" aria-label={`View pending payments for ${room.context.label}`} onClick={event => { trigger.current = event.currentTarget; setSelectedId(room.id) }}><span className="animated-forest-underline">View pending payments</span></button></div>
        <p className="shrink-0 text-base font-bold tabular-nums"><AnimatedNumber value={formatMoney(room.outstanding)} /></p>
      </li>)}</ul>
      {rooms.length === 0 && <p className="text-sm text-muted-foreground">No outstanding balances.</p>}
    </CardContent></Card>
    {selected && <PendingPaymentsDialog key={selected.id} data={data} room={selected} asOf={asOf} onClose={() => setSelectedId(null)} onReturnFocus={() => trigger.current?.focus()} />}
  </>
}
