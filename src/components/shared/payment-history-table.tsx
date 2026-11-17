import { useRef, useState } from 'react'
import { Button, Text } from '@radix-ui/themes'
import { Check } from 'lucide-react'
import type { ChargeCategory, Payment, PrototypeAppState } from '@/domain/types/models'
import { DataTable, type Column } from './data-table'
import { formatDate, formatMoney } from '@/lib/format'
import { StatusBadge } from './status-badge'
import { paymentRooms } from '@/domain/calculations/room-finance'
import { DEMO_DATE } from '@/data/fixtures/demo'
import { TransactionDialog } from './transaction-dialog'
import './shared-parts.css'

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

  return <details className="disclosure-inline">
    <summary>See all transaction</summary>
    {categories.length > 0 ? <ul className="row-list" aria-label={`Payment categories for ${payment.id}`}>
      {categories.map(({ category, label }) => <li
        key={category}
        data-category={category}
        data-paid="true"
        title={`${label}: paid toward this category in this transaction`}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}
      >
        <Check size={15} color="var(--accent-11)" aria-hidden="true" />
        <Text size="2">{label}</Text>
        <span className="sr-only"> paid in this transaction</span>
      </li>
      )}
    </ul> : <Text as="p" size="2" color="gray">{data.tenantCredits.some(credit => credit.sourcePaymentId === payment.id) ? 'Advance payment — kept for a future bill' : 'No bill categories paid in this transaction.'}</Text>}
  </details>
}

export function PaymentHistoryTable({ data, payments, caption = 'Payment history', compact = false, asOf = DEMO_DATE, transactionDisplay = 'button' }: { data: PrototypeAppState; payments: Payment[]; caption?: string; compact?: boolean; asOf?: string; transactionDisplay?: 'button' | 'categories' }) {
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null)
  const [transactionSession, setTransactionSession] = useState(0)
  const transactionTrigger = useRef<HTMLButtonElement | null>(null)
  const selectedPayment = payments.find(payment => payment.id === selectedPaymentId)
  const columns: Column<Payment>[] = [
    { key: 'room', label: 'Room', render: p => { const context = paymentRooms(data, p, asOf); return <div style={{ maxWidth: '20rem', whiteSpace: 'normal' }}><Text as="p" size="2" weight="medium">{context.label}</Text>{(context.unallocated > 0 || context.allocations.some(item => item.context.roomId === null)) && <Text as="p" size="1" color="gray">{context.note}</Text>}</div> } },
    { key: 'date', label: 'Date paid', render: p => formatDate(p.paidOn) },
    { key: 'amount', label: 'Amount paid', align: 'right', render: p => <Text weight="medium">{formatMoney(p.amountCents)}</Text> },
  ]
  if (!compact) columns.push(
    { key: 'status', label: 'Status', render: () => <StatusBadge status="Recorded" /> },
    { key: 'receipt', label: 'Receipt number', render: p => data.receipts.find(r => r.paymentId === p.id && r.state === 'ISSUED')?.receiptNumber ?? 'No receipt yet' },
  )
  columns.push({ key: 'details', label: 'Transaction', render: p => transactionDisplay === 'categories'
    ? <PaymentCategoryBoxes data={data} payment={p} asOf={asOf} />
    : <Button variant="soft" color="gray" size="1" aria-label={`See Transaction for ${paymentRooms(data, p, asOf).label}, ${formatDate(p.paidOn)}, ${formatMoney(p.amountCents)}`} onClick={event => { transactionTrigger.current = event.currentTarget; setSelectedPaymentId(p.id); setTransactionSession(session => session + 1) }}>See Transaction</Button> })
  return <>
    <DataTable rows={payments} caption={caption} columns={columns} />
    {selectedPayment && <TransactionDialog key={`${selectedPayment.id}:${transactionSession}`} data={data} payment={selectedPayment} asOf={asOf} onClose={() => setSelectedPaymentId(null)} onReturnFocus={() => transactionTrigger.current?.focus()} />}
  </>
}
