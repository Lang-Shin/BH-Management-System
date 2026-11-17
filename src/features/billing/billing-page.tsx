import { useState } from 'react'
import { Button, Text } from '@radix-ui/themes'
import { PageHeader, PreviewNotice, Section, StatStrip } from '@/components/shared/page'
import { AnimatedNumber } from '@/components/shared/animated-number'
import { DataTable } from '@/components/shared/data-table'
import { StatusBadge } from '@/components/shared/status-badge'
import { EmptyState } from '@/components/shared/states'
import { WorkflowPlaceholders } from '@/components/shared/workflow-placeholders'
import { usePrototype } from '@/hooks/use-prototype'
import { chargeBalance, chargePaid, chargeStatus, issuedCharges, selectSummary } from '@/domain/calculations/summary'
import { DEMO_DATE, DEMO_PERIOD } from '@/data/fixtures/demo'
import { formatDate, formatMoney } from '@/lib/format'
import { CATEGORY_LABELS, CHARGE_STATUS_LABELS } from '@/lib/labels'
import { BillingStatusMatrix } from './billing-status-matrix'
import { ElectricityPreview } from './electricity-preview'
import { PaymentCalculator } from './payment-calculator'
import { chargeRoom } from '@/domain/calculations/room-finance'
import { ChargeDetails } from '@/components/shared/charge-details'
import { BillingStatusChart } from './billing-status-chart'
import { selectBillingRooms } from './billing-room-status'
import { BillingFiltersMenu } from './billing-filters-menu'
import type { BillingRoomStatus } from './billing-room-status'
import '@/components/shared/shared-parts.css'
import './billing.css'

export default function Billing() {
  const { data } = usePrototype()
  const [periodId, setPeriodId] = useState(DEMO_PERIOD)
  const [statusFilter, setStatusFilter] = useState<BillingRoomStatus | null>(null)
  const summary = selectSummary(data, DEMO_DATE, periodId)
  const charges = issuedCharges(data, DEMO_DATE, periodId)
  const billingRooms = selectBillingRooms(data, periodId, DEMO_DATE, false)
  const filteredRoomCount = billingRooms.filter(room => !statusFilter || room.billingStatus === statusFilter).length
  const periodLabel = data.billingPeriods.find(period => period.id === periodId)?.label

  return <>
    <PageHeader title="Billing" />
    <PreviewNotice>Electricity bills are created only when you confirm a payment-time meter reading. Calculate Payment settles existing rent, water, washing, and electricity bills; other bill-generation and correction workflows will be added later.</PreviewNotice>
    <div className="billing-period">
      <Text as="label" htmlFor="billing-period" size="2" weight="medium">Choose a month</Text>
      <select id="billing-period" value={periodId} onChange={e => { setPeriodId(e.target.value); setStatusFilter(null) }} className="field-select">{data.billingPeriods.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
    </div>
    <StatStrip label="Bills overview" items={[
      { label: 'Total bills', value: formatMoney(summary.billed) },
      { label: 'Already paid', value: formatMoney(summary.applied) },
      { label: summary.unresolved > 0 ? 'Known outstanding' : 'Still to pay', value: formatMoney(summary.outstanding), tone: summary.outstanding > 0 ? 'danger' : undefined, detail: summary.unresolved > 0 ? <>Plus <AnimatedNumber value={summary.unresolved} /> electricity {summary.unresolved === 1 ? 'bill' : 'bills'} awaiting a meter reading.</> : undefined },
      { label: 'Bills past due', value: summary.overdue, tone: summary.overdue > 0 ? 'danger' : undefined },
    ]} />

    <Section title="Payment status by room">
      <div className="billing-table-toolbar">
        <div className="billing-table-filters"><BillingFiltersMenu value={statusFilter} onChange={setStatusFilter} />{statusFilter && <Button variant="ghost" color="gray" onClick={() => setStatusFilter(null)}>Clear filter</Button>}</div>
        <PaymentCalculator key={periodId} periodId={periodId} periodLabel={periodLabel ?? 'Sample billing period'} />
      </div>
      <Text as="p" role="status" aria-atomic="true" size="2" color="gray" mb="3">Showing <AnimatedNumber value={filteredRoomCount} /> of <AnimatedNumber value={billingRooms.length} /> billed rooms{statusFilter && ` · ${statusFilter}`}</Text>
      <div key={statusFilter ?? 'ALL'} className="billing-table-enter">
        {filteredRoomCount === 0 ? <EmptyState title={statusFilter ? 'No rooms match this filter' : 'No bills for this month'} description={statusFilter ? 'Choose another payment status or show all billed rooms for this month.' : 'Choose another month to review its room bills.'} action={statusFilter ? <Button variant="soft" color="gray" onClick={() => setStatusFilter(null)}>Show all billed rooms</Button> : <Button variant="soft" color="gray" onClick={() => document.getElementById('billing-period')?.focus()}>Choose a month</Button>} /> : <BillingStatusMatrix data={data} periodId={periodId} asOf={DEMO_DATE} outstandingOnly={false} statusFilter={statusFilter} />}
      </div>
    </Section>

    <BillingStatusChart key={periodId} rooms={billingRooms} periodLabel={periodLabel ?? 'Selected billing period'} outstandingOnly={false} />

    <details className="disclosure"><summary>View bill amounts and due dates</summary><div className="disclosure-body"><DataTable rows={charges} caption="Bill amounts and due dates" columns={[
      { key: 'room', label: 'Room', render: c => <Text weight="medium">{chargeRoom(data, c).label}</Text> },
      { key: 'tenant', label: 'Charge owner / ID', render: c => <div style={{ maxWidth: '20rem', whiteSpace: 'normal' }}><Text as="p" size="2">{data.tenants.find(t => t.id === c.tenantId)?.name}</Text><Text as="p" size="1" color="gray" style={{ overflowWrap: 'anywhere' }}>{c.id}</Text></div> },
      { key: 'bill', label: 'Bill for', render: c => CATEGORY_LABELS[c.category] },
      { key: 'amount', label: 'Bill amount', align: 'right', render: c => formatMoney(c.amountCents) },
      { key: 'paid', label: 'Paid', render: c => <div><Text as="p" size="2" className="num">{formatMoney(chargePaid(data, c.id, DEMO_DATE))}</Text><StatusBadge status={CHARGE_STATUS_LABELS[chargeStatus(data, c, DEMO_DATE)]} /></div> },
      { key: 'balance', label: 'Still to pay', align: 'right', render: c => <Text weight="medium">{formatMoney(chargeBalance(data, c, DEMO_DATE))}</Text> },
      { key: 'due', label: 'Pay by', render: c => <div>{formatDate(c.dueDate)}{c.dueDate < DEMO_DATE && chargeBalance(data, c, DEMO_DATE) > 0 && <div><StatusBadge status="Late payment" /></div>}</div> },
      { key: 'details', label: 'Allocations', render: c => <ChargeDetails data={data} charges={[c]} asOf={DEMO_DATE} /> },
    ]} /></div></details>
    <ElectricityPreview data={data} periodId={periodId} asOf={DEMO_DATE} />
    <WorkflowPlaceholders title="More billing tools" items={[
      { title: 'Make another bill type', description: 'Electricity uses the payment-time meter workflow. Adding rent, water, and optional washing bills will be available later.' },
      { title: 'Correct a bill', description: 'Corrections will keep a record of what changed and why. This tool is not available yet.' },
    ]} />
  </>
}
