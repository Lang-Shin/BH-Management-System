import { Wallet, Banknote, CircleDollarSign } from 'lucide-react'
import { PageHeader, PreviewNotice, StatCard } from '@/components/shared/page'
import { PaymentHistoryTable } from '@/components/shared/payment-history-table'
import { DataTable } from '@/components/shared/data-table'
import { WorkflowPlaceholders } from '@/components/shared/workflow-placeholders'
import { usePrototype } from '@/hooks/use-prototype'
import { creditRemaining, selectSummary } from '@/domain/calculations/summary'
import { DEMO_DATE, DEMO_PERIOD } from '@/data/fixtures/demo'
import { formatDate, formatMoney } from '@/lib/format'

export default function Payments() {
  const { data } = usePrototype()
  const summary = selectSummary(data, DEMO_DATE, DEMO_PERIOD)
  const payments = data.payments.filter(p => p.state === 'RECORDED' && p.paidOn <= DEMO_DATE).sort((a, b) => b.paidOn.localeCompare(a.paidOn))

  return <>
    <PageHeader title="Payments & Receipts" description="Read-only fictional payment history, independent category allocations, unapplied advances, and sample receipt references." />
    <PreviewNotice>Partial and advance payments below are seeded examples, not editable transactions. No payment recording, allocation, receipt issuance, or correction action is available.</PreviewNotice>
    <section className="mb-7 grid gap-4 sm:grid-cols-3" aria-label="Sample payment summary"><StatCard label="November cash received" value={formatMoney(summary.received)} detail="Includes prior-period payments and advances" icon={Wallet} /><StatCard label="Unapplied advance credit" value={formatMoney(summary.credit)} detail="Received money; not automatically allocated" icon={CircleDollarSign} /><StatCard label="Partially paid charges" value={summary.partial} detail="November category balances remain independent" icon={Banknote} /></section>
    <h2 className="mb-4 text-lg font-semibold">Sample payment history</h2><PaymentHistoryTable data={data} payments={payments} />
    <h2 className="mt-7 mb-4 text-lg font-semibold">Advance payment / tenant credit examples</h2><DataTable rows={data.tenantCredits} caption="Fictional advance payment credits" columns={[
      { key: 'tenant', label: 'Tenant', render: c => data.tenants.find(t => t.id === c.tenantId)?.name },
      { key: 'source', label: 'Source payment', render: c => c.sourcePaymentId },
      { key: 'created', label: 'Recorded', render: c => formatDate(c.createdOn) },
      { key: 'original', label: 'Original advance', render: c => formatMoney(c.amountCents) },
      { key: 'remaining', label: 'Unapplied credit', render: c => formatMoney(creditRemaining(data, c, DEMO_DATE)) },
    ]} />
    <h2 className="mt-7 mb-2 text-lg font-semibold">Digital receipt foundations</h2><p className="mb-4 text-sm text-muted-foreground">Fictional references and issuance snapshots only. These are not official receipts; there is no generation or download workflow.</p><DataTable rows={data.receipts} caption="Fictional receipt snapshots" columns={[
      { key: 'number', label: 'Demo receipt number', render: r => r.receiptNumber },
      { key: 'payment', label: 'Linked payment', render: r => r.paymentId },
      { key: 'date', label: 'Sample issue date', render: r => formatDate(r.issuedOn) },
      { key: 'amount', label: 'Amount snapshot', render: r => formatMoney(r.amountCents) },
      { key: 'allocations', label: 'Allocations at issue', render: r => r.allocationIds.length ? `${r.allocationIds.length} category allocation(s)` : 'Unallocated advance' },
    ]} />
    <WorkflowPlaceholders title="Payment workflow foundations" items={[
      { title: 'Payment recording and full payments', description: 'Future explicit entry and confirmation. No balances can be changed from this page.' },
      { title: 'Partial payments and category allocation', description: 'Allocate received money explicitly to rent, electricity, water, or washing charges, independently and on different dates.' },
      { title: 'Advance payments', description: 'Preserve money as tenant credit until explicitly allocated to an issued charge. The sample advance does not silently settle rent.' },
      { title: 'Digital receipts', description: 'Future receipt issuance will retain payment references and allocation snapshots. No receipt is generated here.' },
      { title: 'Authorized payment corrections', description: 'Future replacement and reversal records must preserve originals, reasons, actor references, and audit history. Editing or deleting financial history is not implemented.' },
    ]} />
  </>
}
