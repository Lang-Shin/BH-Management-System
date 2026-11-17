import { useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { Button, Text } from '@radix-ui/themes'
import { PageHeader, Section, StatStrip } from '@/components/shared/page'
import { AnimatedNumber } from '@/components/shared/animated-number'
import { DataTable } from '@/components/shared/data-table'
import { PaymentHistoryTable } from '@/components/shared/payment-history-table'
import { TransactionHistoryDialog } from '@/components/shared/transaction-history-dialog'
import { BillPaymentChart, RoomOccupancyChart } from './dashboard-analytics'
import { StatusBadge } from '@/components/shared/status-badge'
import { usePrototype } from '@/hooks/use-prototype'
import { selectSummary } from '@/domain/calculations/summary'
import { selectRoomDues, selectRoomFinance } from '@/domain/calculations/room-finance'
import { PaymentCalculator } from '@/features/billing/payment-calculator'
import { OutstandingBalances } from './outstanding-balances'
import { PendingPaymentsDialog } from './pending-payments-dialog'
import { DEMO_DATE, DEMO_PERIOD } from '@/data/fixtures/demo'
import { formatMoney } from '@/lib/format'
import { CHARGE_STATUS_LABELS } from '@/lib/labels'
import './dashboard.css'

export default function Dashboard() {
  const { data } = usePrototype()
  const summary = selectSummary(data, DEMO_DATE, DEMO_PERIOD)
  const upcoming = selectRoomDues(data, DEMO_DATE)
  const rooms = selectRoomFinance(data, DEMO_DATE)
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const billTrigger = useRef<HTMLButtonElement | null>(null)
  const historyTrigger = useRef<HTMLButtonElement | null>(null)
  const selectedRoom = rooms.find(room => room.id === selectedRoomId)
  const allPayments = data.payments.filter(p => p.state === 'RECORDED' && p.paidOn <= DEMO_DATE)
    .sort((a, b) => b.paidOn.localeCompare(a.paidOn))
  const recent = allPayments.slice(0, 5)
  const collectionRate = summary.billed > 0 ? summary.applied / summary.billed * 100 : 0
  const periodLabel = data.billingPeriods.find(period => period.id === DEMO_PERIOD)?.label ?? 'Sample billing period'
  const dueCount = Math.min(6, upcoming.length)

  return <>
    <PageHeader title="Overview" description="November 2026" action={<PaymentCalculator periodId={DEMO_PERIOD} periodLabel={periodLabel} label="Record payment" variant="solid" />} />
    <StatStrip label="Money overview" items={[
      { label: 'Total billed', value: formatMoney(summary.billed) },
      { label: 'Total collected', value: formatMoney(summary.applied) },
      { label: summary.unresolved > 0 ? 'Known outstanding' : 'Total outstanding', value: formatMoney(summary.outstanding), tone: summary.outstanding > 0 ? 'danger' : undefined, detail: summary.unresolved > 0 ? `Known amounts only; ${summary.unresolved} electricity ${summary.unresolved === 1 ? 'bill' : 'bills'} awaiting a meter reading.` : undefined },
      { label: 'Collection rate', value: `${collectionRate.toFixed(1)}%` },
    ]} />

    <OutstandingBalances data={data} asOf={DEMO_DATE} recordPayment={room => <PaymentCalculator periodId={DEMO_PERIOD} periodLabel={periodLabel} initialRoomId={room.roomId} label="Record payment" ariaLabel={`Record payment for ${room.label}`} variant="soft" />} />

    <Section title="Recent payments" action={<Button variant="ghost" color="gray" onClick={event => { historyTrigger.current = event.currentTarget; setHistoryOpen(true) }}>See All Transactions</Button>}>
      <PaymentHistoryTable data={data} payments={recent} compact caption="Recent payments" />
    </Section>

    <Section title="Upcoming due dates" description={`The next ${dueCount} room due-date groups to check. Choose Show Bill to see every pending month and category for that room.`}>
      <DataTable rows={upcoming.slice(0, 6)} caption="Bills due soon" columns={[
        { key: 'room', label: 'Room', render: c => <Text weight="medium">{c.context.label}</Text> },
        { key: 'bill', label: 'Bill for', render: c => <Button variant="ghost" color="gray" size="2" aria-label={`Show Bill for ${c.context.label}`} onClick={event => { billTrigger.current = event.currentTarget; setSelectedRoomId(c.context.id) }}>Show Bill</Button> },
        { key: 'period', label: 'Month', render: c => data.billingPeriods.find(period => period.id === c.periodId)?.label },
        { key: 'balance', label: 'Outstanding', align: 'right', render: c => c.unresolved > 0 && c.outstanding === 0
          ? <Text weight="medium">Amount pending calculation</Text>
          : <div><span>{formatMoney(c.outstanding)}</span>{c.unresolved > 0 && <Text as="p" size="1" color="gray">plus electricity awaiting reading</Text>}</div> },
        { key: 'status', label: 'Status', render: c => <StatusBadge status={CHARGE_STATUS_LABELS[c.status]} /> },
      ]} />
    </Section>

    <div className="dash-charts">
      <Section title="Rooms at a glance" action={<Button asChild variant="ghost" color="gray"><Link to="/rooms">View rooms</Link></Button>}>
        <div className="panel panel-pad enter"><RoomOccupancyChart summary={summary} /></div>
      </Section>
      <Section title="Bill payments" action={<Button asChild variant="ghost" color="gray"><Link to="/billing">View billing</Link></Button>}>
        <div className="panel panel-pad enter" style={{ '--enter-delay': '60ms' } as CSSProperties}>
          <BillPaymentChart summary={summary} />
          <div className="dash-chart-facts">
            <Text as="p" size="2"><AnimatedNumber value={summary.overdue} /> bills are past their due date.</Text>
            <Text as="p" size="2" color="gray" mt="1">Advance payments kept for later: <Text weight="bold" color="gray" highContrast><AnimatedNumber value={formatMoney(summary.credit)} /></Text>.</Text>
          </div>
        </div>
      </Section>
    </div>

    {selectedRoom && <PendingPaymentsDialog key={selectedRoom.id} data={data} room={selectedRoom} asOf={DEMO_DATE} onClose={() => setSelectedRoomId(null)} onReturnFocus={() => billTrigger.current?.focus()} />}
    {historyOpen && <TransactionHistoryDialog data={data} payments={allPayments} asOf={DEMO_DATE} onClose={() => setHistoryOpen(false)} onReturnFocus={() => historyTrigger.current?.focus()} />}
  </>
}
