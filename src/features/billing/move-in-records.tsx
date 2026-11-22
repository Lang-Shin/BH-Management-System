import type { MouseEvent } from 'react'
import { Check, ReceiptText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TablePagination } from '@/components/shared/table-pagination'
import { useTablePagination } from '@/components/shared/use-table-pagination'
import type { MoveInObligationView, MoveInSettlementStatus } from '@/domain/calculations/move-in'
import { formatMoney } from '@/lib/format'

function CategoryValue({ status, remainingCents }: { status: MoveInSettlementStatus; remainingCents: number }) {
  if (status === 'PAID') return <span className="move-in-status" data-status="PAID">PAID</span>
  if (status === 'REFUNDED') return <span className="move-in-status" data-status="REFUNDED">REFUNDED</span>
  return <span className="move-in-category-amount">{formatMoney(remainingCents)}</span>
}

function CategoryStatus({ status }: { status: MoveInSettlementStatus }) {
  if (status === 'PAID') return <span className="move-in-status" data-status="PAID">PAID</span>
  if (status === 'REFUNDED') return <span className="move-in-status" data-status="REFUNDED">REFUNDED</span>
  return <span className="text-xs text-muted-foreground">Outstanding</span>
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
          {['Room', 'First rent', 'Advance', 'Security deposit', 'Action'].map(label => <th scope="col" role="columnheader" key={label}>{label}</th>)}
        </tr></thead>
        <tbody role="rowgroup">{pagination.visibleRows.map(view => <tr role="row" key={view.obligation.id}>
          <td role="cell" className="move-in-record-room"><div className="move-in-room-cell">
            <span>Room {view.room.name}</span>
          </div></td>
          <td role="cell"><span className="move-in-mobile-label" aria-hidden="true">First rent</span>{view.firstRentObligation
            ? <><CategoryValue status={view.firstRentStatus} remainingCents={Math.max(0, view.firstRentObligation.amountCents - view.firstRentPaidCents)} />{view.firstRentStatus === 'PAID' && <span className="block text-xs text-muted-foreground">{view.advanceApplication ? 'Covered by advance' : 'Paid'}</span>}</>
            : <span className="text-xs text-muted-foreground">Legacy calendar billing</span>}</td>
          <td role="cell"><span className="move-in-mobile-label" aria-hidden="true">Advance</span><CategoryValue status={view.advanceStatus} remainingCents={view.advanceRemainingCents} /></td>
          <td role="cell"><span className="move-in-mobile-label" aria-hidden="true">Security deposit</span><span className="block font-medium tabular-nums">{formatMoney(view.obligation.depositRequiredCents)} original</span><CategoryStatus status={view.depositStatus} /></td>
          <td role="cell" className="move-in-record-action">
            {view.status === 'PAID'
              ? <span className="move-in-settled"><Check aria-hidden="true" />Settled</span>
              : <Button type="button" variant="outline" className="move-in-record-button" aria-label={view.cycle.status === 'CLOSED' ? `Review move-out settlement for room ${view.room.name}` : `Record move-in payment for room ${view.room.name}`} disabled={view.cycle.status === 'CLOSED'} onClick={event => onRecord(view, event)}>
                {view.cycle.status === 'CLOSED' ? <><ReceiptText aria-hidden="true" />Settlement review</> : <><ReceiptText aria-hidden="true" />Record payment</>}
              </Button>}
          </td>
        </tr>)}</tbody>
      </table>
    </div>
    <TablePagination page={pagination.page} totalRecords={pagination.totalRecords} pageSize={pagination.pageSize} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} recordLabel="move-in balances" />
  </>
}
