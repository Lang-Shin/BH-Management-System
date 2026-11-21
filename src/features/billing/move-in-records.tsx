import type { MouseEvent } from 'react'
import { Check, ReceiptText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TablePagination } from '@/components/shared/table-pagination'
import { useTablePagination } from '@/components/shared/use-table-pagination'
import type { MoveInObligationView, MoveInSettlementStatus } from '@/domain/calculations/move-in'
import { formatDate, formatMoney } from '@/lib/format'

function Status({ value }: { value: MoveInSettlementStatus }) {
  return <span className="move-in-status" data-status={value}>{value}</span>
}

function Balance({ paid, required, remaining, status, terms }: {
  paid: number; required: number; remaining: number; status: MoveInSettlementStatus; terms?: string
}) {
  return <div className="move-in-balance-cell">
    <Status value={status} />
    <strong>{formatMoney(paid)}</strong>
    <span>of {formatMoney(required)}</span>
    {terms && <small>{terms}</small>}
    <small>{formatMoney(remaining)} left</small>
  </div>
}

/** One set of rows and actions: a spacious table on desktop, room cards on mobile. */
export function MoveInRecords({ views, resetKey, onRecord }: {
  views: MoveInObligationView[]
  resetKey: string
  onRecord: (view: MoveInObligationView, event: MouseEvent<HTMLButtonElement>) => void
}) {
  const pagination = useTablePagination(views, resetKey)
  return <>
    <div className="move-in-records-scroll" role="region" aria-label="Move-in advance and security deposit balances" tabIndex={0}>
      <table className="move-in-records-table" role="table">
        <caption className="sr-only">Room move-in payment records</caption>
        <colgroup><col className="move-in-room-column" /><col /><col /><col /><col className="move-in-action-column" /></colgroup>
        <thead role="rowgroup"><tr role="row">
          {['Room & payer', 'Advance', 'Security deposit', 'Overall', 'Action'].map(label => <th scope="col" role="columnheader" key={label}>{label}</th>)}
        </tr></thead>
        <tbody role="rowgroup">{pagination.visibleRows.map(view => <tr role="row" key={view.obligation.id}>
          <td role="cell" className="move-in-record-room"><div className="move-in-room-cell">
            <span>Room {view.room.name}</span><small>{view.payerName}</small><small>Since {formatDate(view.cycle.startedAt)}</small>
          </div></td>
          <td role="cell"><span className="move-in-mobile-label" aria-hidden="true">Advance</span><Balance paid={view.advancePaidCents} required={view.obligation.advanceRequiredCents} remaining={view.advanceRemainingCents} status={view.advanceStatus} /></td>
          <td role="cell"><span className="move-in-mobile-label" aria-hidden="true">Security deposit</span><Balance paid={view.depositPaidCents} required={view.obligation.depositRequiredCents} remaining={view.depositRemainingCents} status={view.depositStatus} terms={view.obligation.depositDisposition === 'NON_REFUNDABLE' ? 'Non-refundable' : 'Refundable — manual review'} /></td>
          <td role="cell" className="move-in-record-overall"><span className="move-in-mobile-label" aria-hidden="true">Overall settlement</span><div className="move-in-balance-cell"><Status value={view.status} /><strong>{formatMoney(view.totalRemainingCents)}</strong><small>Remaining balance</small></div></td>
          <td role="cell" className="move-in-record-action"><Button type="button" variant="outline" className="move-in-record-button" aria-label={view.cycle.status === 'CLOSED' ? `Review move-out settlement for room ${view.room.name}` : `Record move-in payment for room ${view.room.name}`} disabled={view.status === 'PAID' || view.cycle.status === 'CLOSED'} onClick={event => onRecord(view, event)}>
            {view.cycle.status === 'CLOSED' ? <><ReceiptText aria-hidden="true" />Settlement review</> : view.status === 'PAID' ? <><Check aria-hidden="true" />Fully settled</> : <><ReceiptText aria-hidden="true" />Record payment</>}
          </Button></td>
        </tr>)}</tbody>
      </table>
    </div>
    <TablePagination page={pagination.page} totalRecords={pagination.totalRecords} pageSize={pagination.pageSize} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} recordLabel="move-in balances" />
  </>
}
