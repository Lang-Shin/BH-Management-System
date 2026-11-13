import { useState } from 'react'
import { ReceiptText, CircleAlert, Wallet } from 'lucide-react'
import { PageHeader, PreviewNotice, StatCard } from '@/components/shared/page'
import { DataTable } from '@/components/shared/data-table'
import { StatusBadge } from '@/components/shared/status-badge'
import { Button } from '@/components/ui/button'
import { usePrototype } from '@/state/prototype-context'
import { invoiceBalance, invoiceStatus, invoiceTotal, selectSummary } from '@/state/selectors'
import { formatDate, formatMoney } from '@/lib/format'

export default function Billing() {
  const { data } = usePrototype()
  const [outstandingOnly, setOutstandingOnly] = useState(false)
  const summary = selectSummary(data)
  const invoices = outstandingOnly ? data.invoices.filter(invoice => invoiceBalance(data, invoice) > 0) : data.invoices
  return <>
    <PageHeader title="Billing" description="A first look at monthly billing visibility, using fictional November 2026 records." />
    <PreviewNotice>These sample invoices illustrate a future billing module. Invoice creation, utility allocation, and sending bills are reserved for later milestones.</PreviewNotice>
    <section className="mb-6 grid gap-4 sm:grid-cols-3" aria-label="Sample billing summary"><StatCard label="Total billed" value={formatMoney(summary.billed)} detail="22 sample monthly invoices" icon={ReceiptText} /><StatCard label="Sample collections" value={formatMoney(summary.collected)} detail="From fictional payment records" icon={Wallet} /><StatCard label="Outstanding" value={formatMoney(summary.outstanding)} detail={`${summary.overdue} overdue as of Nov 13, 2026`} icon={CircleAlert} /></section>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Sample invoices</h2><Button variant={outstandingOnly ? 'secondary' : 'outline'} aria-pressed={outstandingOnly} onClick={() => setOutstandingOnly(value => !value)}>{outstandingOnly ? 'Show all invoices' : 'Show outstanding only'}</Button></div>
    <DataTable rows={invoices} caption="Fictional monthly invoices" columns={[
      { key: 'id', label: 'Invoice', render: invoice => <span className="text-xs font-medium">{invoice.id}</span> },
      { key: 'tenant', label: 'Tenant', render: invoice => data.tenants.find(tenant => tenant.id === invoice.tenantId)?.name },
      { key: 'due', label: 'Due date', render: invoice => formatDate(invoice.dueDate) },
      { key: 'total', label: 'Total', render: invoice => formatMoney(invoiceTotal(invoice)) },
      { key: 'balance', label: 'Balance', render: invoice => formatMoney(invoiceBalance(data, invoice)) },
      { key: 'status', label: 'Status', render: invoice => <StatusBadge status={invoiceStatus(data, invoice)} /> },
    ]} />
  </>
}
