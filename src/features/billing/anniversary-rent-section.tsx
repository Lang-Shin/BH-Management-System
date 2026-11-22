import { CalendarDays, ReceiptText } from 'lucide-react'
import { usePrototype } from '@/hooks/use-prototype'
import { useOccupancyDate } from '@/hooks/use-occupancy-date'
import { selectAnniversaryRentReport } from '@/domain/calculations/rent-reporting'
import { formatDate, formatMoney } from '@/lib/format'
import { StatusBadge } from '@/components/shared/status-badge'

const statusLabel = { PAID: 'Paid', PARTIALLY_PAID: 'Partly paid', UNPAID: 'Unpaid' } as const

/** Rent uses the cycle anniversary; the utility billing period selector does not control it. */
export function AnniversaryRentSection() {
  const { data } = usePrototype()
  const occupancyDate = useOccupancyDate()
  const cycles = selectAnniversaryRentReport(data, occupancyDate)

  if (cycles.length === 0) return <section className="mt-8 rounded-xl border bg-card p-5 sm:p-6" aria-labelledby="anniversary-rent-title">
    <div className="flex items-start gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted"><CalendarDays className="size-5" aria-hidden="true" /></span><div>
      <h2 id="anniversary-rent-title" className="text-lg font-semibold">Anniversary rent periods</h2>
      <p className="mt-1 text-sm text-muted-foreground">No new anniversary cycle yet. Existing occupied rooms keep their legacy calendar billing until the room becomes vacant; new move-ins establish the rent anniversary.</p>
    </div></div>
  </section>

  return <section className="mt-8 rounded-xl border bg-card p-5 sm:p-6" aria-labelledby="anniversary-rent-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted"><CalendarDays className="size-5" aria-hidden="true" /></span>
        <div><h2 id="anniversary-rent-title" className="text-lg font-semibold">Anniversary rent periods</h2>
          <p className="mt-1 text-sm text-muted-foreground">Each period runs from the cycle anchor to the day before the next anniversary. End dates are exclusive.</p></div>
      </div>
      <span className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs font-medium"><ReceiptText className="size-4" aria-hidden="true" />Rent is separate from utility months</span>
    </div>
    <div className="mt-5 grid gap-5 lg:grid-cols-2">
      {cycles.map(cycle => <article key={cycle.cycleId} className="rounded-xl border bg-background/60 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><h3 className="font-semibold">Room {cycle.roomName}</h3><p className="text-xs text-muted-foreground">Anchor {formatDate(cycle.anchorDate)}</p></div>
          <div className="text-right text-sm"><span className="block text-xs text-muted-foreground">Outstanding</span><strong>{formatMoney(cycle.outstandingCents)}</strong></div>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[430px] text-sm">
            <caption className="sr-only">Anniversary rent periods for Room {cycle.roomName}</caption>
            <thead><tr className="border-b text-left text-xs text-muted-foreground"><th scope="col" className="py-2 pr-3 font-medium">Period</th><th scope="col" className="py-2 pr-3 font-medium">Rent</th><th scope="col" className="py-2 pr-3 font-medium">Payment</th><th scope="col" className="py-2 font-medium">Status</th></tr></thead>
            <tbody>{cycle.periods.map(line => <tr key={line.period.id} className="border-b last:border-0">
              <td className="py-2.5 pr-3"><span className="block">{formatDate(line.period.startDate)} – {formatDate(shiftBackOneDay(line.period.endDateExclusive))}</span><span className="text-xs text-muted-foreground">Due {formatDate(line.period.dueDate)}</span></td>
              <td className="py-2.5 pr-3 font-medium tabular-nums">{formatMoney(line.amountCents)}</td>
              <td className="py-2.5 pr-3"><span className="block tabular-nums">{formatMoney(line.paidCents)}</span>{line.coveredByAdvance && <span className="text-xs text-muted-foreground">Covered by advance</span>}</td>
              <td className="py-2.5"><StatusBadge status={line.status === 'PAID' ? 'Paid' : line.status === 'UNPAID' ? 'Unpaid' : 'Partly paid'} label={statusLabel[line.status]} /></td>
            </tr>)}</tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Billed {formatMoney(cycle.billedCents)} · Cash applied {formatMoney(cycle.cashAppliedCents)} · Advance applied {formatMoney(cycle.advanceAppliedCents)}</p>
      </article>)}
    </div>
  </section>
}

function shiftBackOneDay(value: string): string {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}
