import { Button, Dialog, Flex, Heading, Text } from '@radix-ui/themes'
import { StatusBadge } from '@/components/shared/status-badge'
import type { PrototypeAppState } from '@/domain/types/models'
import type { RoomFinance } from '@/domain/calculations/room-finance'
import { CATEGORY_LABELS } from '@/lib/labels'
import { formatDate, formatMoney } from '@/lib/format'
import { pendingPaymentCategories } from './pending-payment-groups'
import { unresolvedElectricity } from '@/domain/calculations/summary'
import '@/components/shared/shared-parts.css'
import './dashboard.css'

const timingLabels = { earlier: 'Past month', current: 'Current month', upcoming: 'Upcoming month', review: 'Month needs review' }
const formatKwh = (milliKwh: number) => `${milliKwh / 1000} kWh`

export function PendingPaymentsDialog({ data, room, asOf, onClose, onReturnFocus }: {
  data: PrototypeAppState
  room: RoomFinance
  asOf: string
  onClose: () => void
  onReturnFocus: () => void
}) {
  const categories = pendingPaymentCategories(data, room.charges, asOf, room.context.roomId ?? undefined)
  const total = categories.reduce((sum, category) => sum + category.outstanding, 0)
  const unresolved = categories.reduce((sum, category) => sum + category.unresolved, 0)
  const count = categories.reduce((sum, category) => sum + category.chargeCount, 0)
  const pendingElectricity = room.context.roomId ? unresolvedElectricity(data, asOf, undefined, room.context.roomId)[0] : undefined
  const previousSettled = pendingElectricity ? data.meterReadings.find(reading => reading.id === pendingElectricity.previousReadingId) : undefined

  return <Dialog.Root open onOpenChange={next => { if (!next) onClose() }}>
    <Dialog.Content maxWidth="40rem" onCloseAutoFocus={event => { event.preventDefault(); onReturnFocus() }}>
      <Dialog.Title size="5" mb="1">{room.context.label} · Pending Payments</Dialog.Title>
      <Dialog.Description size="2" color="gray" mb="3">All unpaid billing periods — older unpaid months first.</Dialog.Description>
      {room.context.roomId === null && <Text as="p" size="1" color="gray" mb="3">The historical room needs review. Original charge records remain in Billing.</Text>}

      <div className="panel panel-pad pending-total">
        <div>
          <Text as="p" size="2" color="gray">{unresolved > 0 ? 'Known total still to pay' : 'Total still to pay'}</Text>
          <Text as="p" size="1" color="gray">{count} pending {count === 1 ? 'bill' : 'bills'}{unresolved > 0 ? ` · ${unresolved} awaiting meter reading` : ''} · As of {formatDate(asOf)} (sample)</Text>
          {unresolved > 0 && <Text as="p" size="1" color="gray">Excludes electricity awaiting calculation.</Text>}
        </div>
        <Text size="6" weight="bold" className="num" color={total > 0 ? 'red' : undefined}>{total > 0 ? formatMoney(total) : unresolved > 0 ? 'Amount pending calculation' : formatMoney(0)}</Text>
      </div>

      <div className="pending-body">
        {categories.length === 0 ? <Text as="p" role="status" size="2" color="gray" align="center" my="6">No pending payments for this room.</Text> : categories.map(category => {
          const status = category.unresolved > 0 ? 'Not yet paid' : category.months.some(month => month.status === 'PARTIALLY_PAID') ? 'Partly paid' : 'Not yet paid'
          return <section key={category.id} className="pending-category" aria-label={`${CATEGORY_LABELS[category.category]} pending payments`}>
            <div className="pending-category-head">
              <div style={{ minWidth: 0 }}>
                <Flex align="center" gap="2" wrap="wrap"><Heading as="h3" size="3">{CATEGORY_LABELS[category.category]}</Heading>{category.optional && <Text size="1" color="gray">Optional</Text>}</Flex>
                <Text as="p" size="1" color="gray">{category.months.length} pending {category.months.length === 1 ? 'month' : 'months'} · {status}</Text>
              </div>
              <div style={{ textAlign: 'right', flex: 'none' }}>
                <Text as="p" size="3" weight="bold" className="num">{category.outstanding > 0 ? formatMoney(category.outstanding) : category.unresolved > 0 ? 'Amount pending calculation' : formatMoney(0)}</Text>
                <Text as="p" size="1" color="gray">{category.unresolved > 0 ? 'plus unresolved electricity' : 'left to pay'}</Text>
              </div>
            </div>
            {category.category === 'ELECTRICITY' && category.unresolved > 0 && previousSettled && <div className="pending-note">
              <Text as="p" size="2"><Text weight="bold">Last settled reading:</Text> {formatKwh(previousSettled.readingMilliKwh)} · {formatDate(previousSettled.readOn)}</Text>
              <Text as="p" size="2">Enter a reading from Billing → Calculate payment.</Text>
            </div>}
            <details className="disclosure-inline">
              <summary>View bill details</summary>
              <ul className="row-list" aria-label={`${CATEGORY_LABELS[category.category]} pending months`}>{category.months.map(month => <li key={month.id} className="row" style={{ alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <Text as="p" size="2" weight="medium">{month.unresolved > 0 ? 'Cumulative electricity' : month.label}</Text>
                  <Text as="p" size="1" color="gray">{month.unresolved > 0 && previousSettled ? `Covers consumption since ${formatDate(previousSettled.readOn)}` : timingLabels[month.timing]}{month.overdue > 0 && month.unresolved === 0 ? ' · Past due' : ''}</Text>
                  <Text as="p" size="1" color="gray">{month.dueDates.length > 0 ? `Due ${month.dueDates.map(formatDate).join(' / ')}` : 'Due date not recorded'}{month.billed > 0 ? ` · Billed ${formatMoney(month.billed)}` : ''}{month.paid > 0 ? ` · Paid ${formatMoney(month.paid)}` : ''}{month.unresolved > 0 ? ` · Last settled ${formatKwh(previousSettled?.readingMilliKwh ?? 0)} · Current meter reading not entered` : ''}</Text>
                </div>
                <div style={{ textAlign: 'right', flex: 'none' }}>
                  <StatusBadge status={month.unresolved > 0 ? 'Not yet paid' : month.status === 'PARTIALLY_PAID' ? 'Partly paid' : 'Not yet paid'} />
                  {month.unresolved > 0 && month.outstanding === 0
                    ? <Text as="p" size="2" weight="bold" mt="1">Amount pending calculation</Text>
                    : <Text as="p" size="2" weight="bold" mt="1" className="num">{formatMoney(month.outstanding)} <Text size="1" weight="regular" color="gray">{month.unresolved > 0 ? 'known left' : 'left'}</Text></Text>}
                </div>
              </li>)}</ul>
              {category.optional && <Text as="p" size="1" color="gray" mt="2">Washing is optional. If this bill is not paid, the washing machine cannot be used.</Text>}
            </details>
          </section>
        })}
        <Text as="p" size="1" color="gray" mt="4">Fully paid months are hidden. Each category lists its older unpaid months first.{unresolved > 0 ? ` ${unresolved} electricity ${unresolved === 1 ? 'bill is' : 'bills are'} awaiting a meter reading ${unresolved === 1 ? 'and is' : 'and are'} not included in the known amount.` : ''} {categories.some(category => category.optional) ? 'Washing is optional and cannot be used while unpaid.' : 'Washing is optional. If a washing bill is not paid, the washing machine cannot be used.'}</Text>
      </div>
      <Flex justify="end" mt="4">
        <Dialog.Close><Button aria-label="Close pending payments">Close</Button></Dialog.Close>
      </Flex>
    </Dialog.Content>
  </Dialog.Root>
}
