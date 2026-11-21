import { useRef, useState } from 'react'
import { CircleDollarSign, ReceiptText, ShieldCheck, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePrototype } from '@/hooks/use-prototype'
import { DEMO_DATE } from '@/data/fixtures/demo'
import { activeMoveInPolicy } from '@/domain/calculations/move-in-policy'
import {
  moveInSummary, proposedMoveInAdjustment, selectMoveInObligations, type MoveInObligationView, type MoveInSettlementStatus,
} from '@/domain/calculations/move-in'
import { formatDate, formatMoney } from '@/lib/format'
import { PaginatedDataTable } from '@/components/shared/table-pagination'
import { MoveInPaymentDialog } from './move-in-payment-dialog'

function Status({ value }: { value: MoveInSettlementStatus }) {
  return <span className="move-in-status" data-status={value}>{value}</span>
}

export function MoveInSection() {
  const { data, dispatch } = usePrototype()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const policy = activeMoveInPolicy(data)
  const views = selectMoveInObligations(data, DEMO_DATE)
  const summary = moveInSummary(data, DEMO_DATE)
  const selected = selectedId ? views.find(view => view.obligation.id === selectedId) : undefined
  const proposals = data.occupancyCycles
    .filter(cycle => cycle.status === 'ACTIVE')
    .flatMap(cycle => {
      const room = data.rooms.find(item => item.id === cycle.roomId)
      const proposal = room ? proposedMoveInAdjustment(data, room, cycle) : null
      return room && proposal ? [{ cycle, room, proposal }] : []
    })
  const closedReviews = views.filter(view => view.cycle.status === 'CLOSED'
    && (view.depositPaidCents > 0 || view.totalRemainingCents > 0))
  const rows = views.map(view => ({ ...view, id: view.obligation.id }))

  return <section className="move-in-section" aria-labelledby="move-in-title">
    <div className="move-in-heading">
      <div>
        <span className="move-in-eyebrow"><ShieldCheck aria-hidden="true" />Room-level</span>
        <h2 id="move-in-title">Move-in advance &amp; security deposit</h2>
        <p>One advance and one deposit per room occupancy. They remain separate from monthly rent bills.</p>
      </div>
      <div className="move-in-heading-total"><span>Still to collect</span><strong>{formatMoney(summary.outstandingCents)}</strong></div>
    </div>
    <div className="move-in-summary-grid">
      <div><span><Wallet aria-hidden="true" />Advance collected</span><strong>{formatMoney(summary.advanceCollectedCents)}</strong></div>
      <div><span><ShieldCheck aria-hidden="true" />Deposit held</span><strong>{formatMoney(summary.depositCollectedCents)}</strong></div>
      <div><span><ReceiptText aria-hidden="true" />Fully settled</span><strong>{summary.paidObligations} of {summary.obligations}</strong></div>
    </div>
    <div className="move-in-policy">
      <div><span className="font-semibold">Advance application policy</span><p>New obligations store policy version {policy.version}. Changing the policy does not rewrite existing charges.</p></div>
      <label><span className="sr-only">Advance application policy</span><select value={policy.advanceApplication} onChange={event => {
        setNotice('')
        dispatch({ type: 'moveIn/policyUpdated', advanceApplication: event.target.value as 'FIRST_MONTH' | 'LAST_MONTH' | 'MANUAL' })
        setNotice('Advance policy updated for future obligations.')
      }}>
        <option value="LAST_MONTH">Apply to last month — review before use</option>
        <option value="FIRST_MONTH">Apply to first month — review before use</option>
        <option value="MANUAL">Manual review only</option>
      </select></label>
      <p className="move-in-policy-static"><CircleDollarSign aria-hidden="true" />Security deposits are held and always need manual review before refund, forfeit, or deduction.</p>
    </div>
    {notice && <p role="status" className="move-in-notice">{notice}</p>}
    {proposals.length > 0 && <div className="move-in-proposals" role="note">
      <strong>Transfer review proposals</strong>
      <p>A tenant moved between rooms at different rent snapshots. Review any difference manually; nothing has been posted.</p>
      <ul>{proposals.map(({ cycle, room, proposal }) => <li key={cycle.id}>
        Room {room.name}: previous {formatMoney(proposal.previousRentCents)} / current {formatMoney(proposal.currentRentCents)}.
        {proposal.kind === 'TOP_UP'
          ? ` Proposed advance top-up ${formatMoney(proposal.advanceTopUpCents)} and deposit top-up ${formatMoney(proposal.depositTopUpCents)}.`
          : ' Lower rent needs manual settlement review; no automatic adjustment.'}
      </li>)}</ul>
    </div>}
    {closedReviews.length > 0 && <div className="move-in-proposals" role="note">
      <strong>Move-out settlement review</strong>
      <p>Closed occupancies keep their advance and deposit history. No refund, forfeiture, or deduction has been posted.</p>
      <ul>{closedReviews.map(view => <li key={view.obligation.id}>
        Room {view.room.name}: deposit held {formatMoney(view.depositPaidCents)}; advance outstanding {formatMoney(view.advanceRemainingCents)}; deposit outstanding {formatMoney(view.depositRemainingCents)}.
      </li>)}</ul>
    </div>}
    {rows.length === 0
      ? <div className="move-in-empty"><ShieldCheck aria-hidden="true" /><p>No move-in obligation recorded yet. Existing occupied rooms keep their legacy tenancy without an invented deposit. A new tenant in a vacant room creates one room-level obligation.</p></div>
      : <PaginatedDataTable rows={rows} resetKey={`${views.length}:${summary.outstandingCents}`} recordLabel="move-in balances" caption="Move-in advance and security deposit balances" columns={[
        { key: 'room', label: 'Room & payer', render: view => <div className="move-in-room-cell"><span>Room {view.room.name}</span><small>{view.payerName} · since {formatDate(view.cycle.startedAt)}</small></div> },
        { key: 'advance', label: 'Advance', render: (view: MoveInObligationView) => <div className="move-in-balance-cell"><Status value={view.advanceStatus} /><span>{formatMoney(view.advancePaidCents)} of {formatMoney(view.obligation.advanceRequiredCents)}</span><small>{formatMoney(view.advanceRemainingCents)} left</small></div> },
        { key: 'deposit', label: 'Security deposit', render: (view: MoveInObligationView) => <div className="move-in-balance-cell"><Status value={view.depositStatus} /><span>{formatMoney(view.depositPaidCents)} of {formatMoney(view.obligation.depositRequiredCents)}</span><small>{formatMoney(view.depositRemainingCents)} left</small></div> },
        { key: 'status', label: 'Overall', render: (view: MoveInObligationView) => <div className="move-in-balance-cell"><Status value={view.status} /><small>{formatMoney(view.totalRemainingCents)} remaining</small></div> },
        { key: 'action', label: '', align: 'right', render: (view: MoveInObligationView) => <Button variant="outline" size="sm" aria-label={view.cycle.status === 'CLOSED' ? `Review move-out settlement for room ${view.room.name}` : `Record move-in payment for room ${view.room.name}`} disabled={view.status === 'PAID' || view.cycle.status === 'CLOSED'} onClick={event => { setNotice(''); triggerRef.current = event.currentTarget; setSelectedId(view.obligation.id) }}>{view.cycle.status === 'CLOSED' ? 'Settlement review' : 'Record payment'}</Button> },
      ]} />}
    {selected && <MoveInPaymentDialog key={selected.obligation.id} view={selected} onClose={() => { setSelectedId(null); window.setTimeout(() => triggerRef.current?.focus(), 0) }} onSaved={setNotice} />}
  </section>
}
