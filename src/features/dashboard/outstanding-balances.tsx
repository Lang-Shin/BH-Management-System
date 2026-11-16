import { useRef, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AnimatedNumber } from '@/components/shared/animated-number'
import { selectRoomFinance } from '@/domain/calculations/room-finance'
import type { PrototypeAppState } from '@/domain/types/models'
import { formatMoney } from '@/lib/format'
import { PendingPaymentsDialog } from './pending-payments-dialog'

export function OutstandingBalances({ data, asOf }: { data: PrototypeAppState; asOf: string }) {
  const rooms = selectRoomFinance(data, asOf).filter(room => room.outstanding > 0 || room.unresolved > 0)
    .sort((a, b) => b.outstanding - a.outstanding || b.unresolved - a.unresolved || a.id.localeCompare(b.id)).slice(0, 4)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const selected = rooms.find(room => room.id === selectedId)

  return <>
    <Card><CardHeader><CardTitle>Outstanding balances</CardTitle><CardDescription>Known room balances · electricity without a reading is separate</CardDescription></CardHeader><CardContent>
      <ul className="divide-y" aria-label="Outstanding room balances">{rooms.map(room => <li key={room.id} className="outstanding-room-row">
        <div className="min-w-0"><p className="text-base font-semibold">{room.context.label}</p><button type="button" className="pending-room-link" aria-label={`View pending payments for ${room.context.label}`} onClick={event => { trigger.current = event.currentTarget; setSelectedId(room.id) }}><span className="animated-forest-underline">View pending payments</span></button></div>
        <div className="shrink-0 text-right">{room.outstanding === 0 && room.unresolved > 0
          ? <p className="text-sm font-semibold">Amount pending calculation</p>
          : <p className="text-base font-bold tabular-nums"><AnimatedNumber value={formatMoney(room.outstanding)} /></p>}{room.unresolved > 0 && <p className="mt-1 text-xs font-semibold text-amber-900">{room.unresolved} electricity awaiting reading</p>}</div>
      </li>)}</ul>
      {rooms.length === 0 && <p className="text-sm text-muted-foreground">No outstanding balances.</p>}
    </CardContent></Card>
    {selected && <PendingPaymentsDialog key={selected.id} data={data} room={selected} asOf={asOf} onClose={() => setSelectedId(null)} onReturnFocus={() => trigger.current?.focus()} />}
  </>
}
