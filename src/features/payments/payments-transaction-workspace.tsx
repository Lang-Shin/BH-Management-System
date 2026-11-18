import { useRef, useState } from 'react'
import { History, ReceiptText, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTable, type Column } from '@/components/shared/data-table'
import { EmptyState } from '@/components/shared/states'
import { TablePagination } from '@/components/shared/table-pagination'
import { useTablePagination } from '@/components/shared/use-table-pagination'
import { StatusBadge } from '@/components/shared/status-badge'
import { TransactionDialog } from '@/components/shared/transaction-dialog'
import { usePrototype } from '@/hooks/use-prototype'
import { currentCorrectionStatuses, isLegacyCorrectionStatus, isLegacyPendingCorrection, latestPaymentReceipt, legacyCorrectionStatuses } from '@/domain/calculations/payment-correction'
import { paymentRooms } from '@/domain/calculations/room-finance'
import type { CorrectionSettlementStatus, Payment, PaymentCorrection } from '@/domain/types/models'
import { DEMO_DATE } from '@/data/fixtures/demo'
import { formatDate, formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'
import { EditPaymentDialog } from '@/features/billing/edit-payment-dialog'

type WorkspaceTab = 'transactions' | 'corrections'
type TransactionStatus = 'ALL' | 'RECORDED' | 'CORRECTED'
type CorrectionStatusFilter = 'ALL' | CorrectionSettlementStatus

const correctionStatusLabels: Record<CorrectionSettlementStatus, string> = {
  CORRECTED: 'Corrected',
  REFUNDED: 'Refunded',
  ADDITIONAL_RECEIVED: 'Additional payment received',
  NO_DIFFERENCE: 'Corrected (legacy)',
  NO_MONEY_MOVED: 'Recording only (legacy)',
  REFUND_COMPLETED: 'Refunded (legacy)',
  REFUND_PENDING: 'Refund pending (legacy)',
  ADDITIONAL_PENDING: 'Additional pending (legacy)',
}

const correctionStatusOrder: CorrectionSettlementStatus[] = [...currentCorrectionStatuses, ...legacyCorrectionStatuses]
function CorrectionStatusBadge({ status }: { status: CorrectionSettlementStatus }) {
  const tone = isLegacyPendingCorrection(status)
    ? 'border-amber-200 bg-amber-50 text-amber-900'
    : status === 'ADDITIONAL_RECEIVED' || status === 'REFUNDED' || status === 'CORRECTED' || status === 'NO_DIFFERENCE' || status === 'REFUND_COMPLETED'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : 'border-border bg-muted text-foreground'
  return <Badge variant="outline" className={cn('max-w-full whitespace-normal text-center font-medium', tone)}><span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />{correctionStatusLabels[status]}</Badge>
}

function transactionReceipt(data: ReturnType<typeof usePrototype>['data'], payment: Payment) {
  return latestPaymentReceipt(data, payment.id)?.receiptNumber ?? 'No receipt yet'
}

export function PaymentsTransactionWorkspace() {
  const { data } = usePrototype()
  const [tab, setTab] = useState<WorkspaceTab>('transactions')
  const [search, setSearch] = useState('')
  const [month, setMonth] = useState('ALL')
  const [status, setStatus] = useState<TransactionStatus | CorrectionStatusFilter>('ALL')
  const [notice, setNotice] = useState('')
  const [selectedDialog, setSelectedDialog] = useState<{ paymentId: string; title: string; description: string } | null>(null)
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null)
  const transactionTrigger = useRef<HTMLButtonElement | null>(null)
  const transactionsTab = useRef<HTMLButtonElement | null>(null)
  const correctionsTab = useRef<HTMLButtonElement | null>(null)

  const selectedPayment = selectedDialog ? data.payments.find(payment => payment.id === selectedDialog.paymentId) : undefined
  const period = data.billingPeriods.find(item => item.id === month)
  const normalizedSearch = search.trim().toLowerCase()
  const inSelectedMonth = (date: string) => month === 'ALL' || Boolean(period && date >= period.startDate && date <= period.endDate)
  const recordedPayments = data.payments.filter(payment => payment.state === 'RECORDED' && payment.paidOn <= DEMO_DATE)
  const legacyPendingCorrections = data.paymentCorrections.filter(correction => isLegacyPendingCorrection(correction.settlementStatus))
  const availableCorrectionStatuses = correctionStatusOrder.filter(status => !isLegacyCorrectionStatus(status)
    || data.paymentCorrections.some(correction => correction.settlementStatus === status))

  const transactionRows = recordedPayments.filter(payment => {
    const receiptNumber = transactionReceipt(data, payment)
    const roomLabel = paymentRooms(data, payment, DEMO_DATE).label
    const effectiveStatus = payment.correction ? 'CORRECTED' : 'RECORDED'
    const matchesSearch = !normalizedSearch || `${receiptNumber} ${roomLabel}`.toLowerCase().includes(normalizedSearch)
    const matchesMonth = month === 'ALL' || inSelectedMonth(payment.paidOn)
      || data.paymentAllocations.some(allocation => allocation.paymentId === payment.id
        && data.charges.some(charge => charge.id === allocation.chargeId && charge.billingPeriodId === month))
    const matchesStatus = status === 'ALL' || status === effectiveStatus
    return matchesSearch && matchesMonth && matchesStatus
  }).sort((a, b) => b.paidOn.localeCompare(a.paidOn))

  const correctionRows = data.paymentCorrections.filter(correction => {
    const correctedPayment = data.payments.find(payment => payment.id === correction.correctedPaymentId)
    const correctedReceipt = data.receipts.find(receipt => receipt.id === correction.correctedReceiptId)
    const originalReceipt = data.receipts.find(receipt => receipt.id === correction.originalReceiptId)
    const roomLabel = correctedPayment ? paymentRooms(data, correctedPayment, DEMO_DATE).label : 'Room needs review'
    const matchesSearch = !normalizedSearch || `${correctedReceipt?.receiptNumber ?? ''} ${originalReceipt?.receiptNumber ?? ''} ${roomLabel}`.toLowerCase().includes(normalizedSearch)
    const matchesMonth = inSelectedMonth(correction.correctedAt)
    const matchesStatus = status === 'ALL' || status === correction.settlementStatus
    return matchesSearch && matchesMonth && matchesStatus
  }).sort((a, b) => b.correctedAt.localeCompare(a.correctedAt))

  const activeRows = tab === 'transactions' ? transactionRows : correctionRows
  const pagination = useTablePagination<Payment | PaymentCorrection>(activeRows)
  const visibleRows = pagination.visibleRows
  const hasFilters = normalizedSearch.length > 0 || month !== 'ALL' || status !== 'ALL'

  function switchTab(next: WorkspaceTab) {
    setTab(next)
    setSearch('')
    setMonth('ALL')
    setStatus('ALL')
    pagination.resetPage()
    setNotice('')
  }

  function resetFilters() {
    setSearch('')
    setMonth('ALL')
    setStatus('ALL')
    pagination.resetPage()
  }

  function openTransaction(payment: Payment, trigger: HTMLButtonElement) {
    transactionTrigger.current = trigger
    setSelectedDialog({ paymentId: payment.id, title: 'Transaction Details', description: 'Payment information for the selected room.' })
  }

  function openCorrection(correction: PaymentCorrection, trigger: HTMLButtonElement) {
    transactionTrigger.current = trigger
    setSelectedDialog({ paymentId: correction.correctedPaymentId, title: 'Correction Details', description: 'Review the revised receipt, reason, and money handling for this correction.' })
  }

  const transactionColumns: Column<Payment>[] = [
    { key: 'receipt', label: 'Receipt Number', render: payment => <span className="break-all font-semibold text-[var(--tint)]">{transactionReceipt(data, payment)}</span> },
    { key: 'room', label: 'Room', render: payment => <span className="font-semibold">{paymentRooms(data, payment, DEMO_DATE).label}</span> },
    { key: 'date', label: 'Date Paid', render: payment => formatDate(payment.paidOn) },
    { key: 'amount', label: 'Amount Paid', align: 'right', render: payment => <span className="font-semibold tabular-nums">{formatMoney(payment.amountCents)}</span> },
    { key: 'status', label: 'Status', render: payment => <StatusBadge status={payment.correction ? 'Corrected' : 'Recorded'} /> },
    { key: 'transaction', label: 'Transaction', render: payment => <Button variant="outline" size="sm" aria-label={`See Transaction for ${paymentRooms(data, payment, DEMO_DATE).label}, ${formatDate(payment.paidOn)}, ${formatMoney(payment.amountCents)}`} onClick={event => openTransaction(payment, event.currentTarget)}>See Transaction</Button> },
  ]

  const correctionColumns: Column<PaymentCorrection>[] = [
    { key: 'receipt', label: 'Receipt Number', render: correction => <span className="break-all font-semibold text-[var(--tint)]">{data.receipts.find(receipt => receipt.id === correction.correctedReceiptId)?.receiptNumber ?? 'No receipt'}</span> },
    { key: 'room', label: 'Room', render: correction => {
      const payment = data.payments.find(item => item.id === correction.correctedPaymentId)
      return <span className="font-semibold">{payment ? paymentRooms(data, payment, DEMO_DATE).label : 'Room needs review'}</span>
    } },
    { key: 'date', label: 'Correction Date', render: correction => formatDate(correction.correctedAt) },
    { key: 'original', label: 'Original Amount', align: 'right', render: correction => <span className="tabular-nums">{formatMoney(correction.originalAmountCents)}</span> },
    { key: 'corrected', label: 'Corrected Amount', align: 'right', render: correction => <span className="font-semibold tabular-nums">{formatMoney(correction.correctedAmountCents)}</span> },
    { key: 'status', label: 'Correction Status', render: correction => <CorrectionStatusBadge status={correction.settlementStatus} /> },
    { key: 'details', label: 'Details', render: correction => <Button variant="outline" size="sm" aria-label={`View correction for ${data.receipts.find(receipt => receipt.id === correction.correctedReceiptId)?.receiptNumber ?? correction.id}`} onClick={event => openCorrection(correction, event.currentTarget)}>View</Button> },
  ]

  const correctionsEmpty = tab === 'corrections' && data.paymentCorrections.length === 0

  return <section className="transaction-workspace" aria-labelledby="transaction-workspace-title">
    <div className="transaction-workspace-heading">
      <div>
        <span className="payment-eyebrow">PAYMENT WORKSPACE</span>
        <h2 id="transaction-workspace-title" className="mt-1 text-xl font-semibold">Transactions</h2>
        <p className="mt-1 text-sm text-muted-foreground">Review recorded payments, inspect their allocation details, and correct eligible transactions.</p>
      </div>
      <span className="transaction-workspace-count"><ReceiptText className="size-4" aria-hidden="true" />{transactionRows.length} recorded</span>
    </div>

    <div className="transaction-tabs" role="tablist" aria-label="Payment transaction views">
      <button ref={transactionsTab} id="transactions-tab" type="button" role="tab" aria-selected={tab === 'transactions'} aria-controls="transactions-panel" tabIndex={tab === 'transactions' ? 0 : -1} className="transaction-tab" onClick={() => switchTab('transactions')} onKeyDown={event => { if (event.key === 'ArrowRight') { switchTab('corrections'); requestAnimationFrame(() => correctionsTab.current?.focus()) } }}><ReceiptText className="size-4" aria-hidden="true" />Transactions<span className="transaction-tab-count">{transactionRows.length}</span></button>
      <button ref={correctionsTab} id="corrections-tab" type="button" role="tab" aria-selected={tab === 'corrections'} aria-controls="corrections-panel" tabIndex={tab === 'corrections' ? 0 : -1} className="transaction-tab" onClick={() => switchTab('corrections')} onKeyDown={event => { if (event.key === 'ArrowLeft') { switchTab('transactions'); requestAnimationFrame(() => transactionsTab.current?.focus()) } }}><History className="size-4" aria-hidden="true" />Correction History<span className="transaction-tab-count">{data.paymentCorrections.length}</span></button>
    </div>

    {notice && <p role="status" className="transaction-workspace-notice">{notice}</p>}

    <div className="transaction-toolbar">
      <label className="transaction-search" htmlFor="transaction-search"><Search className="size-4" aria-hidden="true" /><span className="sr-only">Search by room or receipt number</span><input id="transaction-search" type="search" value={search} onChange={event => { setSearch(event.target.value); pagination.resetPage() }} placeholder="Search room or receipt number" autoComplete="off" /></label>
      <label className="transaction-filter"><span>Billing month or date</span><select value={month} onChange={event => { setMonth(event.target.value); pagination.resetPage() }}><option value="ALL">All dates</option>{data.billingPeriods.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label className="transaction-filter"><span>Status</span><select value={status} onChange={event => { setStatus(event.target.value as TransactionStatus | CorrectionStatusFilter); pagination.resetPage() }}><option value="ALL">All statuses</option>{tab === 'transactions' ? <><option value="RECORDED">Recorded</option><option value="CORRECTED">Corrected</option></> : availableCorrectionStatuses.map(item => <option key={item} value={item}>{correctionStatusLabels[item]}</option>)}</select></label>
    </div>

    <div id="transactions-panel" role="tabpanel" aria-labelledby="transactions-tab" hidden={tab !== 'transactions'}>
      {tab === 'transactions' && (visibleRows.length > 0
        ? <DataTable rows={visibleRows as Payment[]} columns={transactionColumns} caption="Transactions" />
        : <EmptyState title={hasFilters ? 'No transactions match' : 'No transactions recorded'} description={hasFilters ? 'Try another room or receipt number, or clear the filters to see all payments.' : 'Recorded payments will appear here after they are saved from Billing.'} action={hasFilters ? <Button variant="outline" onClick={resetFilters}>Clear search and filters</Button> : undefined} />)}
    </div>

    <div id="corrections-panel" role="tabpanel" aria-labelledby="corrections-tab" hidden={tab !== 'corrections'}>
      {tab === 'corrections' && legacyPendingCorrections.length > 0 && <p role="status" className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{legacyPendingCorrections.length === 1 ? 'One older correction still has a pending settlement status.' : `${legacyPendingCorrections.length} older corrections still have pending settlement statuses.`} They are preserved unchanged and are not counted as completed. Review those records before treating any money as returned or received.</p>}
      {tab === 'corrections' && (visibleRows.length > 0
        ? <DataTable rows={visibleRows as PaymentCorrection[]} columns={correctionColumns} caption="Correction history" />
        : <EmptyState title={correctionsEmpty ? 'No corrections recorded yet' : 'No corrections match'} description={correctionsEmpty ? 'Corrections saved from an eligible transaction will appear here with the original and revised receipt totals.' : 'Try another room or receipt number, or clear the filters to see all corrections.'} action={!correctionsEmpty && hasFilters ? <Button variant="outline" onClick={resetFilters}>Clear search and filters</Button> : undefined} />)}
    </div>

    {activeRows.length > 0 && <TablePagination page={pagination.page} totalRecords={pagination.totalRecords} pageSize={pagination.pageSize} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} recordLabel={tab === 'transactions' ? 'transactions' : 'corrections'} />}

    {selectedPayment && <TransactionDialog key={`${selectedPayment.id}:${selectedDialog?.title}`} data={data} payment={selectedPayment} asOf={DEMO_DATE} title={selectedDialog?.title} description={selectedDialog?.description} onClose={() => setSelectedDialog(null)} onReturnFocus={() => transactionTrigger.current?.focus()} onEditPayment={selectedDialog?.title === 'Transaction Details' ? payment => { setSelectedDialog(null); setEditingPaymentId(payment.id) } : undefined} />}
    {editingPaymentId && <EditPaymentDialog paymentId={editingPaymentId} onClose={() => setEditingPaymentId(null)} onReturnFocus={() => { if (transactionTrigger.current?.isConnected) transactionTrigger.current.focus(); else transactionsTab.current?.focus() }} onSaved={setNotice} />}
  </section>
}
