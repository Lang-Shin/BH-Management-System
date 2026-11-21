import { Wallet, Banknote, CircleDollarSign } from 'lucide-react'
import { PageHeader, PreviewNotice, StatCard } from '@/components/shared/page'
import { PaginatedDataTable } from '@/components/shared/table-pagination'
import { usePrototype } from '@/hooks/use-prototype'
import { creditRemaining, selectSummary } from '@/domain/calculations/summary'
import { DEMO_DATE, DEMO_PERIOD } from '@/data/fixtures/demo'
import { formatDate, formatMoney } from '@/lib/format'
import { PaymentsTransactionWorkspace } from './payments-transaction-workspace'

export default function Payments() {
  const { data } = usePrototype()
  const summary = selectSummary(data, DEMO_DATE, DEMO_PERIOD)

  return <>
    <PageHeader title="Payments & Receipts" description="See who paid, when they paid, and what the payment was for." />
    <PreviewNotice>These are sample records. Electricity payments are recorded from Billing or a room’s Pending Payments; other payment workflows will be added later.</PreviewNotice>
    <section className="mb-7 grid gap-5 xl:grid-cols-3" aria-label="Payments overview">
      <StatCard label="Money received" value={formatMoney(summary.received)} detail="All payments received in November." icon={Wallet} />
      <StatCard label="Advance payments" value={formatMoney(summary.credit)} detail="Money kept for a future bill." icon={CircleDollarSign} />
      <StatCard label="Partly paid bills" value={summary.partial} detail="November bills that still have an amount left to pay." icon={Banknote} />
    </section>
    <PaymentsTransactionWorkspace />
    <h2 className="mt-8 mb-2 text-xl font-semibold">Money paid in advance</h2><p className="mb-5 text-base text-muted-foreground">This money is kept for later. It has not yet been used to pay a bill.</p><PaginatedDataTable rows={data.tenantCredits} resetKey={data.tenantCredits.length} recordLabel="advance payments" caption="Advance payments" columns={[
      { key: 'tenant', label: 'Tenant', render: c => data.tenants.find(t => t.id === c.tenantId)?.name },
      { key: 'created', label: 'Date paid', render: c => formatDate(c.createdOn) },
      { key: 'original', label: 'Advance paid', align: 'right', render: c => formatMoney(c.amountCents) },
      { key: 'remaining', label: 'Still available', align: 'right', render: c => <span className="font-semibold">{formatMoney(creditRemaining(data, c, DEMO_DATE))}</span> },
    ]} />
  </>
}
