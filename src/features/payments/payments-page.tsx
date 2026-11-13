import { Wallet, Banknote, Landmark } from 'lucide-react'
import { PageHeader, PreviewNotice, StatCard } from '@/components/shared/page'
import { DataTable } from '@/components/shared/data-table'
import { usePrototype } from '@/hooks/use-prototype'
import { formatDate, formatMoney } from '@/lib/format'

export default function Payments() {
  const { data } = usePrototype()
  const total = (method?: 'cash' | 'bank-transfer') => data.payments.filter(payment => !method || payment.method === method).reduce((sum, payment) => sum + payment.amountCents, 0)
  return <>
    <PageHeader title="Payments & Receipts" description="A simple, readable view of sample payments and the scope of a future receipt register." />
    <PreviewNotice>All payment records are fictional and read-only. Recording payments, issuing receipts, and payment gateway integration are outside this foundation milestone.</PreviewNotice>
    <section className="mb-7 grid gap-4 sm:grid-cols-3" aria-label="Sample payment summary"><StatCard label="Sample payments" value={formatMoney(total())} detail={`${data.payments.length} fictional records · November 2026`} icon={Wallet} /><StatCard label="Cash" value={formatMoney(total('cash'))} detail="Demonstration payment method" icon={Banknote} /><StatCard label="Bank transfer" value={formatMoney(total('bank-transfer'))} detail="Demonstration payment method" icon={Landmark} /></section>
    <h2 className="mb-4 font-semibold">Sample payment register</h2>
    <DataTable rows={[...data.payments].sort((a, b) => b.paidOn.localeCompare(a.paidOn))} caption="Fictional payment register" columns={[
      { key: 'id', label: 'Demo reference', render: payment => <span className="text-xs font-medium">{payment.id}</span> },
      { key: 'tenant', label: 'Tenant', render: payment => data.tenants.find(tenant => tenant.id === data.invoices.find(invoice => invoice.id === payment.invoiceId)?.tenantId)?.name },
      { key: 'date', label: 'Date', render: payment => formatDate(payment.paidOn) },
      { key: 'method', label: 'Method', render: payment => payment.method === 'cash' ? 'Cash' : 'Bank transfer' },
      { key: 'amount', label: 'Amount', render: payment => <span className="font-medium tabular-nums">{formatMoney(payment.amountCents)}</span> },
    ]} />
  </>
}
