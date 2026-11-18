import { useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import type { ChargeCategory, Payment, PrototypeAppState } from '@/domain/types/models'
import { DataTable, type Column } from './data-table'
import { TablePagination } from './table-pagination'
import { useTablePagination } from './use-table-pagination'
import { formatDate, formatMoney } from '@/lib/format'
import { StatusBadge } from './status-badge'
import { paymentRooms } from '@/domain/calculations/room-finance'
import { DEMO_DATE } from '@/data/fixtures/demo'
import { Button } from '@/components/ui/button'
import { TransactionDialog } from './transaction-dialog'

const paymentCategories: { category: ChargeCategory; label: string }[] = [
  { category: 'RENT', label: 'Rent' },
  { category: 'ELECTRICITY', label: 'Electricity' },
  { category: 'WATER', label: 'Water' },
  { category: 'WASHING_MACHINE', label: 'Washing' },
]

function PaymentCategoryBoxes({ data, payment, asOf }: { data: PrototypeAppState; payment: Payment; asOf: string }) {
  const paidCategories = new Set(data.paymentAllocations
    .filter(allocation => allocation.paymentId === payment.id && allocation.state === 'ACTIVE' && allocation.allocatedOn <= asOf)
    .map(allocation => data.charges.find(charge => charge.id === allocation.chargeId)?.category)
    .filter((category): category is ChargeCategory => Boolean(category)))
  const categories = paymentCategories.filter(item => paidCategories.has(item.category))

  return <details className="dashboard-transaction-disclosure">
    <summary className="dashboard-transaction-summary"><span className="animated-forest-underline">See all transaction</span><ChevronDown aria-hidden="true" /></summary>
    {categories.length > 0 ? <ul className="dashboard-payment-checklist" aria-label={`Payment categories for ${payment.id}`}>
      {categories.map(({ category, label }) => <li
        key={category}
        data-category={category}
        data-paid="true"
        title={`${label}: paid toward this category in this transaction`}
        className="payment-checklist-row"
      >
        <span className="payment-checklist-square" aria-hidden="true"><Check /></span>
        <span className="payment-checklist-label">{label}</span>
        <span className="sr-only"> paid in this transaction</span>
      </li>
      )}
    </ul> : <p className="dashboard-payment-checklist text-sm text-muted-foreground">{data.tenantCredits.some(credit => credit.sourcePaymentId === payment.id) ? 'Advance payment — kept for a future bill' : 'No bill categories paid in this transaction.'}</p>}
  </details>
}

export function PaymentHistoryTable({ data, payments, caption = 'Payment history', compact = false, asOf = DEMO_DATE, transactionDisplay = 'button', onEditPayment, paginated = false, recordLabel = 'transactions' }: { data: PrototypeAppState; payments: Payment[]; caption?: string; compact?: boolean; asOf?: string; transactionDisplay?: 'button' | 'categories'; onEditPayment?: (payment: Payment, trigger: HTMLButtonElement) => void; paginated?: boolean; recordLabel?: string }) {
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null)
  const [transactionSession, setTransactionSession] = useState(0)
  const transactionTrigger = useRef<HTMLButtonElement | null>(null)
  const pagination = useTablePagination(payments)
  const selectedPayment = payments.find(payment => payment.id === selectedPaymentId)
  const visiblePayments = paginated ? pagination.visibleRows : payments
  const columns: Column<Payment>[] = [
    { key: 'room', label: 'Room', render: p => { const context = paymentRooms(data, p, asOf); return <div className="max-w-xs whitespace-normal"><p className="font-semibold">{context.label}</p>{(context.unallocated > 0 || context.allocations.some(item => item.context.roomId === null)) && <p className="mt-1 text-xs text-muted-foreground">{context.note}</p>}</div> } },
    { key: 'date', label: 'Date paid', render: p => formatDate(p.paidOn) },
    { key: 'amount', label: 'Amount paid', align: 'right', render: p => <span className="font-semibold tabular-nums">{formatMoney(p.amountCents)}</span> },
  ]
  if (!compact) columns.push(
    { key: 'status', label: 'Status', render: p => <StatusBadge status={p.correction ? 'Corrected' : 'Recorded'} /> },
    { key: 'receipt', label: 'Receipt number', render: p => <span className="text-sm">{data.receipts.find(r => r.paymentId === p.id && r.state === 'ISSUED')?.receiptNumber ?? 'No receipt yet'}</span> },
  )
  columns.push({ key: 'details', label: 'Transaction', render: p => transactionDisplay === 'categories'
    ? <PaymentCategoryBoxes data={data} payment={p} asOf={asOf} />
    : <Button variant="outline" aria-label={`See Transaction for ${paymentRooms(data, p, asOf).label}, ${formatDate(p.paidOn)}, ${formatMoney(p.amountCents)}`} onClick={event => { transactionTrigger.current = event.currentTarget; setSelectedPaymentId(p.id); setTransactionSession(session => session + 1) }}>See Transaction</Button> })
  return <>
    <DataTable rows={visiblePayments} caption={caption} columns={columns} />
    {paginated && payments.length > 0 && <TablePagination page={pagination.page} totalRecords={pagination.totalRecords} pageSize={pagination.pageSize} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} recordLabel={recordLabel} />}
    {selectedPayment && <TransactionDialog key={`${selectedPayment.id}:${transactionSession}`} data={data} payment={selectedPayment} asOf={asOf} onClose={() => setSelectedPaymentId(null)} onReturnFocus={() => transactionTrigger.current?.focus()} onEditPayment={onEditPayment ? (payment) => { if (transactionTrigger.current) onEditPayment(payment, transactionTrigger.current); setSelectedPaymentId(null) } : undefined} />}
  </>
}
