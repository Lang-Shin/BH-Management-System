import { useRef, useState } from 'react'
import { Download } from 'lucide-react'
import { Button, Heading, Select, Text } from '@radix-ui/themes'
import { StatusBadge } from '@/components/shared/status-badge'
import { roomHasPending, selectRoomFinance } from '@/domain/calculations/room-finance'
import { ROOM_PAYMENT_STATUS_LABELS } from '@/lib/labels'
import { roomReportCsv } from './room-report'
import { PendingPaymentsDialog } from '@/features/dashboard/pending-payments-dialog'
import { PageHeader, PreviewNotice, Section, StatStrip } from '@/components/shared/page'
import { AnimatedNumber } from '@/components/shared/animated-number'
import { DataTable } from '@/components/shared/data-table'
import { WorkflowPlaceholders } from '@/components/shared/workflow-placeholders'
import { ResetDemoButton } from '@/components/shared/reset-demo-button'
import { usePrototype } from '@/hooks/use-prototype'
import { selectSummary } from '@/domain/calculations/summary'
import { DEMO_DATE, DEMO_PERIOD, DEMO_RATES } from '@/data/fixtures/demo'
import { formatDate, formatMoney } from '@/lib/format'
import { ROOM_RATE_CATEGORIES } from '@/lib/room-rates'
import type { AuditEvent } from '@/domain/types/models'
import '@/components/shared/page-extras.css'
import './reports.css'

const changeLabels: Record<AuditEvent['action'], string> = {
  DEMO_SEEDED: 'Sample records added', READING_CORRECTED: 'Meter reading corrected', CHARGE_CORRECTED: 'Bill corrected',
  PAYMENT_CORRECTED: 'Payment corrected', ALLOCATION_REVERSED: 'Payment removed from a bill',
  ELECTRICITY_PAYMENT_RECORDED: 'Electricity payment recorded',
  ROOM_PAYMENT_RECORDED: 'Room payment recorded',
}

export default function Reports() {
  const { data, storageWarning } = usePrototype()
  const [roomPeriod, setRoomPeriod] = useState(DEMO_PERIOD)
  const [downloadNotice, setDownloadNotice] = useState('')
  const [downloadFailed, setDownloadFailed] = useState(false)
  const [pendingRoomId, setPendingRoomId] = useState<string | null>(null)
  const pendingTrigger = useRef<HTMLButtonElement | null>(null)
  const roomRows = selectRoomFinance(data, DEMO_DATE, roomPeriod)
  const allRoomRows = selectRoomFinance(data, DEMO_DATE)
  const pendingRoom = pendingRoomId ? allRoomRows.find(room => room.id === pendingRoomId) : undefined
  const roomTotals = selectSummary(data, DEMO_DATE, roomPeriod)
  const summary = selectSummary(data, DEMO_DATE, DEMO_PERIOD)
  const periods = data.billingPeriods.map(period => ({ ...period, summary: selectSummary(data, DEMO_DATE, period.id) }))
  const currentRate = [...data.electricityRates].filter(r => r.effectiveFrom <= DEMO_DATE).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]

  function downloadRoomReport() {
    setDownloadNotice('')
    setDownloadFailed(false)
    let url: string | undefined
    try {
      const blob = new Blob(['﻿', roomReportCsv(data, DEMO_DATE, roomPeriod)], { type: 'text/csv;charset=utf-8;' })
      url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `bhms-room-summary-${roomPeriod}-${DEMO_DATE}.csv`
      link.click()
      setDownloadNotice('Room CSV download requested. Check your browser downloads.')
    } catch {
      setDownloadFailed(true)
      setDownloadNotice('The room CSV could not be prepared. Try downloading it again.')
    } finally {
      if (url) {
        const downloadUrl = url
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)
      }
    }
  }

  const settings: [string, React.ReactNode][] = [
    ['Currency', 'Philippine peso (₱)'],
    ['Monthly rent', ROOM_RATE_CATEGORIES.map(category => `${category.label} (${category.roomCount} ${category.roomCount === 1 ? 'room' : 'rooms'})`).join(' · ')],
    ['When rent is due', 'To be confirmed'],
    ['Electricity price', currentRate ? <><AnimatedNumber value={formatMoney(currentRate.rateCentsPerKwh)} /> per kWh, starting {formatDate(currentRate.effectiveFrom)}</> : 'No price set'],
    ['Sharing the electricity bill', 'Who uses each meter and how to share the bill still need to be agreed'],
    ['Water and washing', <><AnimatedNumber value={formatMoney(DEMO_RATES.waterCentsPerTenant)} /> per tenant for water. Washing is optional at <AnimatedNumber value={formatMoney(DEMO_RATES.washingCentsPerRoom)} /> per room.</>],
  ]

  return <>
    <PageHeader title="Reports & Settings" description="See your monthly totals and find the house settings." />
    <PreviewNotice>The amounts shown here are for trying the app, not your actual earnings.</PreviewNotice>
    <StatStrip label="Monthly money overview" items={[
      { label: 'Money received', value: formatMoney(summary.received) },
      { label: 'Already paid', value: formatMoney(summary.applied) },
      { label: summary.unresolved > 0 ? 'Known outstanding' : 'Still to pay', value: formatMoney(summary.outstanding), tone: summary.outstanding > 0 ? 'danger' : undefined,
        detail: summary.unresolved > 0 ? `Known November amounts only; ${summary.unresolved} electricity ${summary.unresolved === 1 ? 'bill' : 'bills'} awaiting a meter reading.` : undefined },
    ]} />
    <Section title="Monthly summary" description="Money received may include payments for older bills or money paid in advance.">
      <DataTable rows={periods} caption="Monthly summary" columns={[
        { key: 'period', label: 'Month', render: p => p.label },
        { key: 'billed', label: 'Total bills', align: 'right', render: p => formatMoney(p.summary.billed) },
        { key: 'applied', label: 'Paid for these bills', align: 'right', render: p => formatMoney(p.summary.applied) },
        { key: 'balance', label: 'Known still to pay', align: 'right', render: p => formatMoney(p.summary.outstanding) },
        { key: 'unresolved', label: 'Electricity awaiting reading', align: 'right', render: p => p.summary.unresolved > 0 ? `${p.summary.unresolved} bill${p.summary.unresolved === 1 ? '' : 's'}` : 'NONE' },
        { key: 'received', label: 'Money received', align: 'right', render: p => formatMoney(p.summary.received) },
      ]} />
    </Section>
    <Section title="Room financial summary" description="Individual charges grouped by historical room context, not joint liability. Total billed, total paid, and payment status describe the selected report month. Electricity without a current reading is unresolved and has no peso amount. Pending Payment checks every unpaid or unresolved billing period for the room. Unallocated advances are not counted as bill payments.">
      <div className="reports-toolbar">
        <div className="reports-toolbar-field">
          <Text as="label" htmlFor="room-report-period" size="2" weight="medium">Report month</Text>
          <Select.Root value={roomPeriod} onValueChange={setRoomPeriod}>
            <Select.Trigger id="room-report-period" variant="surface" color="gray" />
            <Select.Content>{data.billingPeriods.map(period => <Select.Item key={period.id} value={period.id}>{period.label}</Select.Item>)}</Select.Content>
          </Select.Root>
        </div>
        <Button variant="soft" color="gray" onClick={downloadRoomReport}><Download size={16} aria-hidden="true" />Download room CSV</Button>
      </div>
      <Text as="p" size="2" color={downloadFailed ? 'red' : 'gray'} role={downloadFailed ? 'alert' : 'status'} mb="3">{downloadNotice}</Text>
      <DataTable rows={roomRows} caption="Room financial summary" columns={[
        { key: 'room', label: 'Room', render: row => <Text weight="bold">{row.context.label}</Text> },
        { key: 'billed', label: 'Total billed', align: 'right', render: row => formatMoney(row.billed) },
        { key: 'paid', label: 'Total paid', align: 'right', render: row => formatMoney(row.paid) },
        { key: 'pending', label: 'Pending payment', render: row => {
          const allPeriodRoom = allRoomRows.find(item => item.id === row.id)
          return allPeriodRoom && roomHasPending(allPeriodRoom)
            ? <Button variant="soft" color="gray" aria-label={`View pending payments for ${row.context.label}`} onClick={event => { pendingTrigger.current = event.currentTarget; setPendingRoomId(row.id) }}>View Details</Button>
            : <Text size="2" color="gray">NONE</Text>
        } },
        { key: 'status', label: 'Payment status', render: row => <StatusBadge status={ROOM_PAYMENT_STATUS_LABELS[row.paymentStatus]} /> },
      ]} />
      <Text as="p" size="2" color="gray" mt="4" aria-label="Room report reconciliation">All room/context totals: billed {formatMoney(roomTotals.billed)} · applied {formatMoney(roomTotals.applied)} · known outstanding {formatMoney(roomTotals.outstanding)}{roomTotals.unresolved > 0 ? ` · ${roomTotals.unresolved} electricity ${roomTotals.unresolved === 1 ? 'bill' : 'bills'} awaiting a meter reading (amount not included)` : ''}. Includes any room-needs-review rows. Total billed excludes uncalculated electricity. Pending Payment uses all unpaid or unresolved billing periods, while the other columns describe {data.billingPeriods.find(period => period.id === roomPeriod)?.label ?? 'the selected month'}. Cash received is reported separately in Monthly summary.</Text>
      {pendingRoom && <PendingPaymentsDialog key={pendingRoom.id} data={data} room={pendingRoom} asOf={DEMO_DATE} onClose={() => setPendingRoomId(null)} onReturnFocus={() => pendingTrigger.current?.focus()} />}
    </Section>
    <Section id="house-settings" title="House settings" description="You can view these settings. Changing them will be added later.">
      <dl className="panel settings-list">{settings.map(([label, value]) => <div key={label} className="settings-row"><Text asChild size="2" color="gray"><dt>{label}</dt></Text><dd><Text size="2">{value}</Text></dd></div>)}</dl>
    </Section>
    <details open={Boolean(storageWarning)} className="disclosure"><summary>More settings and sample records</summary>
      <div className="disclosure-body">
        <section aria-labelledby="sample-records" style={{ marginTop: 16 }}>
          <Heading as="h2" id="sample-records" size="4">Start again with sample records</Heading>
          <Text as="p" size="2" color="gray" mt="1" mb="3" style={{ maxWidth: '40rem' }}>Restore the original sample records and remove your saved notes and room changes. This is only for trying the app.</Text>
          <ResetDemoButton />
        </section>
        <section style={{ marginTop: 32 }}>
          <Heading as="h2" size="4" mb="3">Record of changes</Heading>
          <DataTable rows={data.auditEvents} caption="Record of changes" columns={[
            { key: 'date', label: 'Date', render: a => formatDate(a.occurredOn) },
            { key: 'action', label: 'What changed', render: a => changeLabels[a.action] },
            { key: 'reason', label: 'Note', render: a => <span className="audit-note">{a.action === 'DEMO_SEEDED' ? 'Sample records were added so you can try the screens.' : a.reason}</span> },
          ]} />
        </section>
        <Text as="p" size="2" color="gray" mt="4">Your changes are saved only in this browser. This is not a backup.</Text>
      </div>
    </details>
    <WorkflowPlaceholders title="More report tools" items={[
      { title: 'Print other reports', description: 'A room summary CSV is available above. Printing and other report formats will be available later.' },
      { title: 'Save a backup', description: 'Making a backup copy and bringing back saved records will be added later.' },
    ]} />
  </>
}
