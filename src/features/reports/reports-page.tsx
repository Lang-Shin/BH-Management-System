import { useRef, useState } from 'react'
import { ReceiptText, Wallet, CircleAlert, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/shared/status-badge'
import { roomHasPending, selectRoomFinance } from '@/domain/calculations/room-finance'
import { ROOM_PAYMENT_STATUS_LABELS } from '@/lib/labels'
import { roomReportCsv } from './room-report'
import { PendingPaymentsDialog } from '@/features/dashboard/pending-payments-dialog'
import { PageHeader, PreviewNotice, StatCard } from '@/components/shared/page'
import { AnimatedNumber } from '@/components/shared/animated-number'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DataTable } from '@/components/shared/data-table'
import { WorkflowPlaceholders } from '@/components/shared/workflow-placeholders'
import { ResetDemoButton } from '@/components/shared/reset-demo-button'
import { usePrototype } from '@/hooks/use-prototype'
import { selectSummary } from '@/domain/calculations/summary'
import { DEMO_DATE, DEMO_PERIOD } from '@/data/fixtures/demo'
import { formatDate, formatMoney } from '@/lib/format'
import { activeElectricityRate, activeRoomRentRate, activeWashingRate, activeWaterRate, ROOM_RATE_CATEGORY_IDS } from '@/domain/calculations/billing-rates'
import type { AuditEvent } from '@/domain/types/models'

const changeLabels: Record<AuditEvent['action'], string> = {
  DEMO_SEEDED: 'Sample records added', READING_CORRECTED: 'Meter reading corrected', CHARGE_CORRECTED: 'Bill corrected',
  PAYMENT_CORRECTED: 'Payment corrected', ALLOCATION_REVERSED: 'Payment removed from a bill',
  ELECTRICITY_PAYMENT_RECORDED: 'Electricity payment recorded',
  ROOM_PAYMENT_RECORDED: 'Room payment recorded',
}

export default function Reports() {
  const { data, storageWarning } = usePrototype()
  const [roomPeriod, setRoomPeriod] = useState(DEMO_PERIOD)
  const [pendingRoomId, setPendingRoomId] = useState<string | null>(null)
  const pendingTrigger = useRef<HTMLButtonElement | null>(null)
  const roomRows = selectRoomFinance(data, DEMO_DATE, roomPeriod)
  const allRoomRows = selectRoomFinance(data, DEMO_DATE)
  const pendingRoom = pendingRoomId ? allRoomRows.find(room => room.id === pendingRoomId) : undefined
  const roomTotals = selectSummary(data, DEMO_DATE, roomPeriod)
  const summary = selectSummary(data, DEMO_DATE, DEMO_PERIOD)
  const periods = data.billingPeriods.map(period => ({ ...period, summary: selectSummary(data, DEMO_DATE, period.id) }))
  const currentRate = activeElectricityRate(data, DEMO_DATE)
  const waterRate = activeWaterRate(data, DEMO_DATE)
  const washingRate = activeWashingRate(data, DEMO_DATE)
  const roomRates = ROOM_RATE_CATEGORY_IDS.map(categoryId => ({ categoryId, rate: activeRoomRentRate(data, categoryId, DEMO_DATE), roomCount: data.rooms.filter(room => room.categoryId === categoryId).length })).filter(item => item.rate)

  function downloadRoomReport() {
    const blob = new Blob(['\uFEFF', roomReportCsv(data, DEMO_DATE, roomPeriod)], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `bhms-room-summary-${roomPeriod}-${DEMO_DATE}.csv`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return <>
    <PageHeader title="Reports & Settings" description="See your monthly totals and find the house settings." />
    <PreviewNotice>The amounts shown here are for trying the app, not your actual earnings.</PreviewNotice>
    <section className="grid gap-5 xl:grid-cols-3" aria-label="Monthly money overview">
      <StatCard label="Money received" value={formatMoney(summary.received)} detail="All payments received in November." icon={Wallet} />
      <StatCard label="Already paid" value={formatMoney(summary.applied)} detail="Paid toward November’s bills." icon={ReceiptText} />
      <StatCard label={summary.unresolved > 0 ? 'Known outstanding' : 'Still to pay'} value={formatMoney(summary.outstanding)} detail={summary.unresolved > 0 ? `Known November amounts only; ${summary.unresolved} electricity ${summary.unresolved === 1 ? 'bill' : 'bills'} awaiting a meter reading.` : 'What tenants still owe for November.'} icon={CircleAlert} />
    </section>
    <section className="mt-8" aria-labelledby="monthly-reports"><h2 id="monthly-reports" className="mb-2 text-xl font-semibold">Monthly summary</h2><p className="mb-5 text-base text-muted-foreground">Money received may include payments for older bills or money paid in advance.</p><DataTable rows={periods} caption="Monthly summary" columns={[
      { key: 'period', label: 'Month', render: p => p.label },
      { key: 'billed', label: 'Total bills', align: 'right', render: p => formatMoney(p.summary.billed) },
      { key: 'applied', label: 'Paid for these bills', align: 'right', render: p => formatMoney(p.summary.applied) },
      { key: 'balance', label: 'Known still to pay', align: 'right', render: p => formatMoney(p.summary.outstanding) },
      { key: 'unresolved', label: 'Electricity awaiting reading', align: 'right', render: p => p.summary.unresolved > 0 ? `${p.summary.unresolved} bill${p.summary.unresolved === 1 ? '' : 's'}` : 'NONE' },
      { key: 'received', label: 'Money received', align: 'right', render: p => formatMoney(p.summary.received) },
    ]} /></section>
    <section className="mt-8" aria-labelledby="room-report-title">
      <h2 id="room-report-title" className="text-xl font-semibold">Room financial summary</h2>
      <p className="mt-2 text-sm text-muted-foreground">Individual charges grouped by historical room context, not joint liability. Total billed, total paid, and payment status describe the selected report month. Electricity without a current reading is unresolved and has no peso amount. Pending Payment checks every unpaid or unresolved billing period for the room. Unallocated advances are not counted as bill payments.</p>
      <div className="my-5 flex flex-wrap items-end justify-between gap-4"><div><label htmlFor="room-report-period" className="mb-2 block text-sm font-semibold">Report month</label><select id="room-report-period" value={roomPeriod} onChange={event => setRoomPeriod(event.target.value)} className="min-h-12 max-w-full rounded-lg border bg-card px-3">{data.billingPeriods.map(period => <option key={period.id} value={period.id}>{period.label}</option>)}</select></div><Button variant="outline" onClick={downloadRoomReport}><Download aria-hidden="true" />Download room CSV</Button></div>
      <DataTable rows={roomRows} caption="Room financial summary" columns={[
        { key: 'room', label: 'Room', render: row => <span className="font-semibold">{row.context.label}</span> },
        { key: 'billed', label: 'Total billed', align: 'right', render: row => formatMoney(row.billed) },
        { key: 'paid', label: 'Total paid', align: 'right', render: row => formatMoney(row.paid) },
        { key: 'pending', label: 'Pending payment', render: row => {
          const allPeriodRoom = allRoomRows.find(item => item.id === row.id)
          return allPeriodRoom && roomHasPending(allPeriodRoom)
            ? <Button variant="outline" aria-label={`View pending payments for ${row.context.label}`} onClick={event => { pendingTrigger.current = event.currentTarget; setPendingRoomId(row.id) }}>View Details</Button>
            : <span className="text-sm text-muted-foreground">NONE</span>
        } },
        { key: 'status', label: 'Payment status', render: row => <StatusBadge status={ROOM_PAYMENT_STATUS_LABELS[row.paymentStatus]} /> },
      ]} />
      <p className="mt-4 text-sm" aria-label="Room report reconciliation">All room/context totals: billed {formatMoney(roomTotals.billed)} · applied {formatMoney(roomTotals.applied)} · known outstanding {formatMoney(roomTotals.outstanding)}{roomTotals.unresolved > 0 ? ` · ${roomTotals.unresolved} electricity ${roomTotals.unresolved === 1 ? 'bill' : 'bills'} awaiting a meter reading (amount not included)` : ''}. Includes any room-needs-review rows. Total billed excludes uncalculated electricity. Pending Payment uses all unpaid or unresolved billing periods, while the other columns describe {data.billingPeriods.find(period => period.id === roomPeriod)?.label ?? 'the selected month'}. Cash received is reported separately in Monthly summary.</p>
      {pendingRoom && <PendingPaymentsDialog key={pendingRoom.id} data={data} room={pendingRoom} asOf={DEMO_DATE} onClose={() => setPendingRoomId(null)} onReturnFocus={() => pendingTrigger.current?.focus()} />}
    </section>
    <Card className="mt-8 shadow-none"><CardHeader><CardTitle>House settings</CardTitle><CardDescription>You can view these settings. Changing them will be added later.</CardDescription></CardHeader><CardContent><dl className="grid gap-6 text-base sm:grid-cols-2">{([
      ['Currency', 'Philippine peso (₱)'],
      ['Monthly rent', roomRates.map(item => `${formatMoney(item.rate!.monthlyRentCents)} (${item.roomCount} ${item.roomCount === 1 ? 'room' : 'rooms'})`).join(' · ')],
      ['When rent is due', 'To be confirmed'],
      ['Electricity price', currentRate ? <><AnimatedNumber value={formatMoney(currentRate.rateCentsPerKwh)} /> per kWh, starting {formatDate(currentRate.effectiveFrom)}</> : 'No price set'],
      ['Sharing the electricity bill', 'Who uses each meter and how to share the bill still need to be agreed'],
      ['Water and washing', <><AnimatedNumber value={formatMoney(waterRate?.rateCents ?? 0)} /> per tenant for water. Washing is optional at <AnimatedNumber value={formatMoney(washingRate?.rateCents ?? 0)} /> per room.</>],
    ] as const).map(([label, value]) => <div key={label} className="rounded-lg border bg-muted/40 p-4"><dt className="text-xs font-semibold text-muted-foreground">{label}</dt><dd className="mt-2 text-sm leading-relaxed font-medium">{value}</dd></div>)}</dl></CardContent></Card>
    <details open={Boolean(storageWarning)} className="mt-7 rounded-xl border bg-card p-5 sm:p-6"><summary className="min-h-12 cursor-pointer py-2 text-lg font-semibold">More settings and sample records</summary>
      <section className="mt-5" aria-labelledby="sample-records"><h2 id="sample-records" className="mb-3 text-xl font-semibold">Start again with sample records</h2><p className="mb-5 max-w-2xl text-base text-muted-foreground">Restore the original sample records and remove your saved notes and room changes. This is only for trying the app.</p><ResetDemoButton /></section>
      <section className="mt-7" aria-labelledby="audit-log"><h2 id="audit-log" className="mb-3 text-xl font-semibold">Record of changes</h2><DataTable rows={data.auditEvents} caption="Record of changes" columns={[
        { key: 'date', label: 'Date', render: a => formatDate(a.occurredOn) },
        { key: 'action', label: 'What changed', render: a => changeLabels[a.action] },
        { key: 'reason', label: 'Note', render: a => <span className="inline-block max-w-sm whitespace-normal leading-relaxed">{a.action === 'DEMO_SEEDED' ? 'Sample records were added so you can try the screens.' : a.reason}</span> },
      ]} /></section>
      <p className="mt-5 text-sm text-muted-foreground">Your changes are saved only in this browser. This is not a backup.</p>
    </details>
    <WorkflowPlaceholders title="More report tools" items={[
      { title: 'Print other reports', description: 'A room summary CSV is available above. Printing and other report formats will be available later.' },
      { title: 'Save a backup', description: 'Making a backup copy and bringing back saved records will be added later.' },
    ]} />
  </>
}
