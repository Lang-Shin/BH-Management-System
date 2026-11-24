import { useState } from 'react'
import { Banknote, Check, RotateCcw, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { usePrototype } from '@/hooks/use-prototype'
import { useOccupancyDate } from '@/hooks/use-occupancy-date'
import {
  prepaidRefundCashOutCents, prepaidRefundSourceReceiptNumbers,
} from '@/domain/calculations/prepaid-rent-refund'
import type { PrepaidRentRefund } from '@/domain/types/models'
import { formatDate, formatMoney } from '@/lib/format'

type RefundMode = 'APPROVE' | 'COMPLETE' | 'REVERSE'

const statusLabel: Record<PrepaidRentRefund['status'], string> = {
  PROPOSED: 'Proposed', APPROVED: 'Approved', COMPLETED: 'Refund paid', REVERSED: 'Reversed',
}

export function PrepaidRentRefundsSection() {
  const { data, commitAction } = usePrototype()
  const occupancyDate = useOccupancyDate()
  const [selected, setSelected] = useState<{ refund: PrepaidRentRefund; mode: RefundMode } | null>(null)
  const [reason, setReason] = useState('')
  const [refundedOn, setRefundedOn] = useState(occupancyDate)
  const [entitlementConfirmed, setEntitlementConfirmed] = useState(false)
  const [cashReturned, setCashReturned] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const refunds = data.prepaidRentRefunds ?? []
  if (refunds.length === 0) return null
  const cashOut = prepaidRefundCashOutCents(data)

  function open(refund: PrepaidRentRefund, mode: RefundMode) {
    setSelected({ refund, mode })
    setReason(refund.reason)
    setRefundedOn(occupancyDate)
    setEntitlementConfirmed(false)
    setCashReturned(false)
    setError('')
  }

  async function submit() {
    if (!selected || saving) return
    if (selected.mode === 'REVERSE' && reason.trim().length < 3) { setError('Enter a reversal reason.'); return }
    if (selected.mode === 'APPROVE' && selected.refund.entitlementReviewRequired && !entitlementConfirmed) {
      setError('Confirm that you verified the prepaid funds belong to this tenant.')
      return
    }
    if (selected.mode === 'COMPLETE' && !cashReturned) {
      setError('Confirm that the refund cash was actually returned before recording completion.')
      return
    }
    setSaving(true); setError('')
    const action = selected.mode === 'APPROVE'
      ? { type: 'prepaidRefund/approved' as const, refundId: selected.refund.id, asOf: occupancyDate, reason: reason.trim(), entitlementConfirmed }
      : selected.mode === 'COMPLETE'
        ? { type: 'prepaidRefund/completed' as const, refundId: selected.refund.id, refundedOn, asOf: occupancyDate, reason: reason.trim() }
        : { type: 'prepaidRefund/reversed' as const, refundId: selected.refund.id, asOf: occupancyDate, reason: reason.trim() }
    const saved = await commitAction(action)
    setSaving(false)
    if (!saved) { setError('The refund change was not saved. Refresh and review the current records.'); return }
    setNotice(selected.mode === 'APPROVE' ? 'Prepaid rent refund approved. It is not cash returned yet.'
      : selected.mode === 'COMPLETE' ? 'Completed prepaid rent refund recorded as actual cash returned.'
        : 'Prepaid rent refund reversed through an audited adjustment.')
    setSelected(null)
  }

  return <>
    <section className="mt-8 rounded-2xl border bg-card p-5 sm:p-6" aria-labelledby="prepaid-refunds-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 id="prepaid-refunds-title" className="text-xl font-semibold">Prepaid rent refunds</h2><p className="mt-1 text-sm text-muted-foreground">Proposed and approved amounts are not cash returned. Completed refunds are actual cash outflows and never replace the original receipt.</p></div>
        <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-900"><Banknote aria-hidden="true" />{formatMoney(cashOut)} refunded</Badge>
      </div>
      {notice && <p role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[48rem] text-left text-sm" aria-label="Prepaid rent refunds">
          <thead><tr className="border-b"><th className="py-2 pr-3">Tenant / room</th><th className="py-2 pr-3">Move-out</th><th className="py-2 pr-3 text-right">Amount</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Original receipt</th><th className="py-2 pr-3">Reason</th><th className="py-2">Action</th></tr></thead>
          <tbody>{refunds.slice().sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)).map(refund => <tr key={refund.id} className="border-b last:border-0">
            <td className="py-3 pr-3"><strong className="block">{data.tenants.find(tenant => tenant.id === refund.tenantId)?.name ?? 'Tenant needs review'}</strong><span className="text-xs text-muted-foreground">Room {data.rooms.find(room => room.id === refund.roomId)?.name ?? refund.roomId}</span></td>
            <td className="py-3 pr-3">{formatDate(refund.moveOutDate)}</td>
            <td className="py-3 pr-3 text-right font-semibold">{formatMoney(refund.amountCents)}</td>
            <td className="py-3 pr-3"><Badge variant="outline">{statusLabel[refund.status]}</Badge>{refund.entitlementReviewRequired && <span className="mt-1 block text-xs font-medium text-amber-900">Entitlement: shared-room review</span>}{refund.refundedOn && <span className="mt-1 block text-xs text-muted-foreground">Actual {formatDate(refund.refundedOn)}</span>}</td>
            <td className="py-3 pr-3 max-w-48 break-words">{prepaidRefundSourceReceiptNumbers(data, refund).join(', ') || 'No receipt'}</td>
            <td className="py-3 pr-3 max-w-64 whitespace-normal">{refund.reason}{refund.reversalReason && <span className="mt-1 block text-xs text-muted-foreground">Reversed: {refund.reversalReason}</span>}</td>
            <td className="py-3">{refund.status === 'PROPOSED' && <Button size="sm" variant="outline" onClick={() => open(refund, 'APPROVE')}><ShieldCheck aria-hidden="true" />Approve</Button>}{refund.status === 'APPROVED' && <Button size="sm" variant="outline" onClick={() => open(refund, 'COMPLETE')}><Check aria-hidden="true" />Record refund</Button>}{refund.status === 'COMPLETED' && <Button size="sm" variant="outline" onClick={() => open(refund, 'REVERSE')}><RotateCcw aria-hidden="true" />Reverse</Button>}{refund.status === 'REVERSED' && <span className="text-xs text-muted-foreground">No action</span>}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
    {selected && <Dialog open onOpenChange={next => { if (!next) setSelected(null) }}>
      <DialogContent className="max-w-xl">
        <DialogTitle>{selected.mode === 'APPROVE' ? 'Approve prepaid rent refund' : selected.mode === 'COMPLETE' ? 'Complete prepaid rent refund' : 'Reverse prepaid rent refund'}</DialogTitle>
        <DialogDescription className="mt-2">{selected.mode === 'APPROVE' ? 'Approval reserves the refund but does not count cash as returned.' : selected.mode === 'COMPLETE' ? 'Only complete this after the actual cash has been handed back. The original receipt remains available.' : 'A reversal creates an audited adjustment and restores the covered prepaid rent where possible.'}</DialogDescription>
        <dl className="mt-4 grid gap-2 rounded-xl border bg-muted/40 p-3 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">Tenant</dt><dd className="font-semibold">{data.tenants.find(tenant => tenant.id === selected.refund.tenantId)?.name ?? 'Tenant needs review'}</dd></div>
          <div><dt className="text-muted-foreground">Amount</dt><dd className="font-semibold">{formatMoney(selected.refund.amountCents)}</dd></div>
          <div><dt className="text-muted-foreground">Move-out date</dt><dd className="font-semibold">{formatDate(selected.refund.moveOutDate)}</dd></div>
          <div><dt className="text-muted-foreground">Periods</dt><dd className="font-semibold">{selected.refund.allocations.length} allocation{selected.refund.allocations.length === 1 ? '' : 's'}</dd></div>
        </dl>
        {selected.mode === 'APPROVE' && selected.refund.entitlementReviewRequired && <label className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-950"><input type="checkbox" checked={entitlementConfirmed} onChange={event => setEntitlementConfirmed(event.target.checked)} className="mt-0.5 size-4 shrink-0" /><span>I verified that the prepaid rent belongs to this tenant and is not needed for a continuing shared-room occupancy.</span></label>}
        {selected.mode === 'COMPLETE' && <div className="mt-4 grid gap-3">
          <label className="grid gap-2 text-sm font-semibold">Actual refund date<input type="date" value={refundedOn} onChange={event => setRefundedOn(event.target.value)} className="min-h-11 rounded-xl border bg-background px-3 font-normal" /></label>
          <label className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-950"><input type="checkbox" checked={cashReturned} onChange={event => setCashReturned(event.target.checked)} className="mt-0.5 size-4 shrink-0" /><span>I confirm that {formatMoney(selected.refund.amountCents)} was actually returned to the tenant on this date.</span></label>
        </div>}
        {selected.mode !== 'COMPLETE' && <label className="mt-4 grid gap-2 text-sm font-semibold">{selected.mode === 'REVERSE' ? 'Reversal reason' : 'Approval note'}<textarea rows={2} maxLength={500} value={reason} onChange={event => { setReason(event.target.value); setError('') }} className="rounded-xl border bg-background p-3 font-normal" /></label>}
        {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
        <DialogFooter className="mt-5"><Button variant="outline" onClick={() => setSelected(null)} disabled={saving}>Cancel</Button><Button onClick={submit} disabled={saving}>{saving ? 'Saving...' : selected.mode === 'APPROVE' ? 'Approve refund' : selected.mode === 'COMPLETE' ? 'Complete refund' : 'Reverse refund'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>}
  </>
}
