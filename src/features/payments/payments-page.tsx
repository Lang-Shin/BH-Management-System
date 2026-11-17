import { useRef, useState } from 'react'
import { Button, Heading, Text, TextField } from '@radix-ui/themes'
import { Search } from 'lucide-react'
import { EmptyState } from '@/components/shared/states'
import { PageHeader, PreviewNotice, Section, StatStrip } from '@/components/shared/page'
import { AnimatedNumber } from '@/components/shared/animated-number'
import { PaymentHistoryTable } from '@/components/shared/payment-history-table'
import { DataTable } from '@/components/shared/data-table'
import { StatusBadge } from '@/components/shared/status-badge'
import { WorkflowPlaceholders } from '@/components/shared/workflow-placeholders'
import { usePrototype } from '@/hooks/use-prototype'
import { creditRemaining, selectSummary } from '@/domain/calculations/summary'
import { DEMO_DATE, DEMO_PERIOD } from '@/data/fixtures/demo'
import { formatDate, formatMoney } from '@/lib/format'
import { ReceiptDialog } from './receipt-dialog'
import { paymentRooms } from '@/domain/calculations/room-finance'
import '@/components/shared/page-extras.css'
import './payments.css'

export default function Payments() {
  const { data } = usePrototype()
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const searchInput = useRef<HTMLInputElement>(null)
  const receiptTrigger = useRef<HTMLButtonElement | null>(null)
  const selectedReceipt = data.receipts.find(item => item.id === selectedReceiptId)
  const summary = selectSummary(data, DEMO_DATE, DEMO_PERIOD)
  const payments = data.payments.filter(p => p.state === 'RECORDED' && p.paidOn <= DEMO_DATE).sort((a, b) => b.paidOn.localeCompare(a.paidOn))
  const query = search.trim().toLocaleLowerCase()
  const filteredPayments = payments.filter(payment => !query || [
    data.tenants.find(tenant => tenant.id === payment.tenantId)?.name,
    paymentRooms(data, payment, DEMO_DATE).label,
    ...data.receipts.filter(item => item.paymentId === payment.id && item.state === 'ISSUED').map(item => item.receiptNumber),
  ].some(value => value?.toLocaleLowerCase().includes(query)))
  function clearSearch() { setSearch(''); searchInput.current?.focus() }
  const receipt = [...data.receipts].filter(r => r.state === 'ISSUED').sort((a, b) => b.issuedOn.localeCompare(a.issuedOn))[0]
  const receiptPayment = data.payments.find(p => p.id === receipt?.paymentId)

  return <>
    <PageHeader title="Payments & Receipts" description="See who paid, when they paid, and what the payment was for." />
    <PreviewNotice>These are sample records. Use Calculate payment in Billing to record rent, electricity, water, or washing payments. Payment history and receipts are view-only here.</PreviewNotice>
    <StatStrip label="Payments overview" items={[
      { label: 'Money received', value: formatMoney(summary.received) },
      { label: 'Advance payments', value: formatMoney(summary.credit) },
      { label: 'Partly paid bills', value: summary.partial },
    ]} />
    <Section title="Payment history">
      <div className="payments-toolbar">
        <div className="payments-toolbar-search">
          <label htmlFor="payment-history-search" className="sr-only">Find a payment</label>
          <TextField.Root ref={searchInput} id="payment-history-search" type="search" size="3" value={search} onChange={event => setSearch(event.target.value)} placeholder="Tenant, room, or receipt number" aria-describedby="payment-history-search-help">
            <TextField.Slot><Search size={16} aria-hidden="true" /></TextField.Slot>
          </TextField.Root>
          <span id="payment-history-search-help" className="sr-only">Search payment history by tenant, room, or receipt number.</span>
        </div>
        {search && <Button variant="ghost" color="gray" onClick={clearSearch}>Clear search</Button>}
      </div>
      <Text as="p" size="2" color="gray" role="status" aria-atomic="true" className="payments-count">Showing <AnimatedNumber value={filteredPayments.length} /> of <AnimatedNumber value={payments.length} /> payments</Text>
      {filteredPayments.length ? <PaymentHistoryTable data={data} payments={filteredPayments} /> : <EmptyState title={query ? 'No payments found' : 'No recorded payments yet'} description={query ? 'Try another tenant, room, or receipt number, or clear your search.' : 'Recorded payments will appear here after a payment is confirmed from Billing.'} action={query ? <Button variant="outline" color="gray" onClick={clearSearch}>Show all payments</Button> : undefined} />}
    </Section>
    <Section id="advance-title" title="Money paid in advance" description="This money is kept for later. It has not yet been used to pay a bill.">
      <DataTable rows={data.tenantCredits} caption="Advance payments" columns={[
        { key: 'tenant', label: 'Tenant', render: c => data.tenants.find(t => t.id === c.tenantId)?.name },
        { key: 'created', label: 'Date paid', render: c => formatDate(c.createdOn) },
        { key: 'original', label: 'Advance paid', align: 'right', render: c => formatMoney(c.amountCents) },
        { key: 'remaining', label: 'Still available', align: 'right', render: c => <Text weight="bold">{formatMoney(creditRemaining(data, c, DEMO_DATE))}</Text> },
      ]} />
    </Section>
    <details className="disclosure"><summary>View receipt list</summary>
      <div className="disclosure-body">
        <Text as="p" size="2" color="gray" mb="4">These receipt numbers are examples. Making or printing receipts will be added later.</Text>
        {receipt && <div className="panel panel-pad receipt-preview">
          <div className="receipt-preview-head"><Heading as="h3" size="3">Sample receipt preview</Heading><StatusBadge status="Recorded" /></div>
          <Text as="p" size="2" color="gray">Halili BH · {receipt.receiptNumber}</Text>
          <dl className="receipt-facts">
            <div><Text asChild size="2" color="gray"><dt>Received from</dt></Text><dd><Text size="2" weight="bold">{data.tenants.find(t => t.id === receiptPayment?.tenantId)?.name ?? 'Unknown tenant'}</Text></dd></div>
            <div><Text asChild size="2" color="gray"><dt>Date</dt></Text><dd><Text size="2">{formatDate(receipt.issuedOn)}</Text></dd></div>
            <div className="receipt-facts-wide receipt-facts-total"><Text asChild size="2" color="gray"><dt>Amount paid</dt></Text><dd><Text size="6" weight="bold" className="num"><AnimatedNumber value={formatMoney(receipt.amountCents)} /></Text></dd></div>
          </dl>
          <Text as="p" size="1" color="gray" mt="3">Demonstration preview · Not an official receipt</Text>
        </div>}
        <DataTable rows={data.receipts} caption="Sample receipts" columns={[
          { key: 'room', label: 'Room context', render: r => { const payment = data.payments.find(p => p.id === r.paymentId); return <Text weight="bold">{payment ? paymentRooms(data, payment, r.issuedOn, r.allocationIds).label : 'Room needs review'}</Text> } },
          { key: 'number', label: 'Receipt number', render: r => r.receiptNumber },
          { key: 'tenant', label: 'Received from', render: r => data.tenants.find(t => t.id === data.payments.find(p => p.id === r.paymentId)?.tenantId)?.name },
          { key: 'date', label: 'Receipt date', render: r => formatDate(r.issuedOn) },
          { key: 'amount', label: 'Amount paid', align: 'right', render: r => formatMoney(r.amountCents) },
          { key: 'actions', label: 'Actions', render: r => <Button variant="soft" color="gray" aria-label={`View receipt ${r.receiptNumber}`} onClick={event => { receiptTrigger.current = event.currentTarget; setSelectedReceiptId(r.id) }}>View receipt</Button> },
        ]} />
      </div>
    </details>
    <WorkflowPlaceholders title="More payment tools" items={[
      { title: 'Record advance payments', description: 'Use Calculate payment in Billing for existing room bills. Recording a new advance payment will be available later.' },
      { title: 'Use an advance payment', description: 'You will be able to choose which bill an advance payment pays for.' },
      { title: 'Print or send a receipt', description: 'Making a receipt for a tenant will be added later.' },
      { title: 'Correct a payment', description: 'Corrections will keep the original record and a note explaining the change.' },
    ]} />
    {selectedReceipt && <ReceiptDialog key={selectedReceipt.id} data={data} receipt={selectedReceipt} onClose={() => setSelectedReceiptId(null)} onReturnFocus={() => receiptTrigger.current?.focus()} />}
  </>
}
