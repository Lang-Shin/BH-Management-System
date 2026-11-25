import { useMemo, useRef, useState } from 'react'
import { ChevronDown, CircleDollarSign, ReceiptText, ShieldCheck, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePrototype } from '@/hooks/use-prototype'
import { useOccupancyDate } from '@/hooks/use-occupancy-date'

import { activeMoveInPolicy } from '@/domain/calculations/move-in-policy'
import {
  moveInSummary, proposedMoveInAdjustment, selectMoveInObligations,
} from '@/domain/calculations/move-in'
import { formatMoney } from '@/lib/format'
import { MoveInPaymentDialog } from './move-in-payment-dialog'
import { MoveInRecords } from './move-in-records'

export const MOVE_IN_UI_STORAGE_KEY = 'bhms:ui:move-in-expanded:v1'

function initialExpanded() {
  try { return sessionStorage.getItem(MOVE_IN_UI_STORAGE_KEY) !== 'false' } catch { return true }
}

export function MoveInSection() {
  const { data, dispatch } = usePrototype()
  const occupancyDate = useOccupancyDate()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [expanded, setExpanded] = useState(initialExpanded)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const policy = activeMoveInPolicy(data)
  const views = useMemo(() => selectMoveInObligations(data, occupancyDate), [data, occupancyDate])
  const summary = useMemo(() => moveInSummary(data, occupancyDate), [data, occupancyDate])
  const selected = selectedId ? views.find(view => view.obligation.id === selectedId) : undefined
  const proposals = useMemo(() => data.occupancyCycles
    .filter(cycle => cycle.status === 'ACTIVE')
    .flatMap(cycle => {
      const room = data.rooms.find(item => item.id === cycle.roomId)
      const proposal = room ? proposedMoveInAdjustment(data, room, cycle) : null
      return room && proposal ? [{ cycle, room, proposal }] : []
    }), [data])
  const closedReviews = views.filter(view => view.cycle.status === 'CLOSED'
    && (view.depositPaidCents > 0 || view.totalRemainingCents > 0))

  function toggleExpanded() {
    const next = !expanded
    setExpanded(next)
    try { sessionStorage.setItem(MOVE_IN_UI_STORAGE_KEY, String(next)) } catch { /* UI preference is optional. */ }
  }

  return <section className="move-in-section" aria-labelledby="move-in-title" data-expanded={expanded}>
    <div className="move-in-heading">
      <div>
        <span className="move-in-eyebrow"><ShieldCheck aria-hidden="true" />Room-level</span>
        <h2 id="move-in-title" ref={headingRef} tabIndex={-1}>Move-in advance &amp; security deposit</h2>
      </div>
      <div className="move-in-heading-actions">
        <div className="move-in-heading-total"><span>Still to collect</span><strong>{formatMoney(summary.outstandingCents)}</strong><small>{summary.paidObligations} of {summary.obligations} fully settled</small></div>
        <Button type="button" variant="outline" className="move-in-toggle" aria-label={`${expanded ? 'Collapse' : 'Expand'} move-in advance and security deposit`} aria-expanded={expanded} aria-controls="move-in-details" onClick={toggleExpanded}><ChevronDown aria-hidden="true" /></Button>
      </div>
    </div>
    <div id="move-in-details" className="move-in-disclosure" data-expanded={expanded} aria-hidden={!expanded} inert={!expanded}>
    <div className="move-in-disclosure-clip"><div className="move-in-details-content">
    <div className="move-in-summary-grid">
      <div><span><Wallet aria-hidden="true" />Advance collected</span><strong>{formatMoney(summary.advanceCollectedCents)}</strong></div>
      <div><span><ShieldCheck aria-hidden="true" />Deposit held</span><strong>{formatMoney(summary.depositCollectedCents)}</strong></div>
      <div><span><ReceiptText aria-hidden="true" />Fully settled</span><strong>{summary.paidObligations} of {summary.obligations}</strong></div>
    </div>
    <section className="move-in-policy" aria-labelledby="move-in-policy-title">
      <div className="move-in-subheading"><div><h3 id="move-in-policy-title">Policy configuration</h3><p>Changes apply to future obligations. Existing charges and recorded terms stay intact.</p></div><span className="move-in-policy-version">Policy v{policy.version}</span></div>
      <div className="move-in-policy-fields">
      <div className="move-in-policy-field"><label htmlFor="move-in-advance-policy">Advance application policy</label><p id="move-in-advance-help">The mandatory one-month advance is the first anniversary rental period’s rent.</p>
      <select id="move-in-advance-policy" aria-describedby="move-in-advance-help" value="FIRST_MONTH" disabled>
        <option value="FIRST_MONTH">First rental period (mandatory)</option>
      </select></div>
      <div className="move-in-policy-field"><label htmlFor="move-in-deposit-policy">Security deposit terms</label><p id="move-in-deposit-help">Current policy is {policy.depositDisposition === 'NON_REFUNDABLE' ? 'non-refundable' : 'refundable with manual review'}. Existing deposits keep their recorded terms.</p>
      <select id="move-in-deposit-policy" aria-describedby="move-in-deposit-help" value={policy.depositDisposition} onChange={event => {
        setNotice('')
        dispatch({ type: 'moveIn/policyUpdated', depositDisposition: event.target.value as 'NON_REFUNDABLE' | 'MANUAL_REVIEW' })
        setNotice('Deposit policy updated for future obligations.')
      }}>
        <option value="NON_REFUNDABLE">Non-refundable</option>
        <option value="MANUAL_REVIEW">Refundable — review required</option>
      </select></div>
      </div>
      <p className="move-in-policy-static"><CircleDollarSign aria-hidden="true" />No deposit refund, forfeiture, or rental-income recognition is automatic. Deposits remain a separate room-level financial record.</p>
    </section>
    {notice && <p role="status" className="move-in-notice">{notice}</p>}
    {proposals.length > 0 && <div className="move-in-proposals" role="note">
      <strong>Transfer review proposals</strong>
      <p>A tenant moved between rooms at different rent snapshots. Review any difference manually; nothing has been posted.</p>
      <ul>{proposals.map(({ cycle, room, proposal }) => <li key={cycle.id}>
        Room {room.name}: previous {formatMoney(proposal.previousRentCents)} / current {formatMoney(proposal.currentRentCents)}.
        No advance or deposit top-up is collected. The original deposit stays unchanged; any paid-period rent difference requires manual review.
      </li>)}</ul>
    </div>}
    {closedReviews.length > 0 && <div className="move-in-proposals" role="note">
      <strong>Move-out deposit records</strong>
      <p>Closed occupancies keep their deposit history. No refund, forfeiture, or rental-income recognition has been posted.</p>
      <ul>{closedReviews.map(view => <li key={view.obligation.id}>
        Room {view.room.name}: {view.obligation.depositDisposition === 'NON_REFUNDABLE' ? 'non-refundable deposit' : 'deposit with manual review'} held {formatMoney(view.depositPaidCents)}; advance outstanding {formatMoney(view.advanceRemainingCents)}; deposit outstanding {formatMoney(view.depositRemainingCents)}.
      </li>)}</ul>
    </div>}
    <section className="move-in-records" aria-labelledby="move-in-records-title">
    <div className="move-in-subheading"><div><h3 id="move-in-records-title">Room payment records</h3><p>Advance, deposit, and settlement status for each room occupancy.</p></div></div>
    {views.length === 0
      ? <div className="move-in-empty"><ShieldCheck aria-hidden="true" /><p>No move-in obligation recorded yet. Existing occupied rooms keep their legacy tenancy without an invented deposit. A new tenant in a vacant room creates one room-level obligation.</p></div>
      : <MoveInRecords views={views} resetKey={`${views.length}:${summary.outstandingCents}`} onRecord={(view, event) => { setNotice(''); triggerRef.current = event.currentTarget; setSelectedId(view.obligation.id) }} />}
    </section>
    </div></div></div>
    {selected && <MoveInPaymentDialog key={selected.obligation.id} view={selected} onClose={() => { setSelectedId(null); window.setTimeout(() => { if (triggerRef.current && !triggerRef.current.disabled) triggerRef.current.focus(); else headingRef.current?.focus() }, 0) }} onSaved={setNotice} />}
  </section>
}
