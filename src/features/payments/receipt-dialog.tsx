import { Button, Dialog, Flex, Heading, Text } from '@radix-ui/themes'
import { StatusBadge } from '@/components/shared/status-badge'
import type { PrototypeAppState, Receipt } from '@/domain/types/models'
import { formatDate, formatMoney } from '@/lib/format'
import { CATEGORY_LABELS } from '@/lib/labels'
import { chargeRoom, paymentRooms } from '@/domain/calculations/room-finance'
import './payments.css'

export function ReceiptDialog({ data, receipt, onClose, onReturnFocus }: {
  data: PrototypeAppState
  receipt: Receipt
  onClose: () => void
  onReturnFocus: () => void
}) {
  const payment = data.payments.find(item => item.id === receipt.paymentId)
  const tenant = data.tenants.find(item => item.id === payment?.tenantId)
  // Use the receipt's issue-time allocation references, not the payment's live allocations.
  const allocations = data.paymentAllocations.filter(item => receipt.allocationIds.includes(item.id) && item.paymentId === receipt.paymentId)
  const allocationRoomIds = new Set(allocations.map(allocation => {
    const charge = data.charges.find(item => item.id === allocation.chargeId)
    return charge ? chargeRoom(data, charge).id : `review:${allocation.chargeId}`
  }))
  const allocationsSpanMultipleRooms = allocationRoomIds.size > 1
  const advance = data.tenantCredits.some(item => item.sourcePaymentId === receipt.paymentId)

  function close() { onClose(); setTimeout(onReturnFocus, 0) }

  return <Dialog.Root open onOpenChange={next => { if (!next) close() }}>
    <Dialog.Content maxWidth="34rem" onCloseAutoFocus={event => { event.preventDefault(); onReturnFocus() }}>
      <Dialog.Title size="5" mb="1">Sample receipt · {receipt.receiptNumber}</Dialog.Title>
      <Dialog.Description size="2" color="gray">Halili BH · Receipt details from the sample records.</Dialog.Description>
      <Flex mt="3"><StatusBadge status={receipt.state === 'ISSUED' ? 'Recorded' : 'Voided'} /></Flex>
      <dl className="receipt-facts">
        <div className="receipt-facts-wide"><Text asChild size="2" color="gray"><dt>Room context</dt></Text><dd><Text size="2" weight="bold">{payment ? paymentRooms(data, payment, receipt.issuedOn, receipt.allocationIds).label : 'Room needs review'}</Text></dd></div>
        <div style={{ minWidth: 0 }}><Text asChild size="2" color="gray"><dt>Received from</dt></Text><dd><Text size="2" weight="bold">{tenant?.name ?? 'Unknown tenant'}</Text></dd></div>
        <div><Text asChild size="2" color="gray"><dt>Receipt date</dt></Text><dd><Text size="2">{formatDate(receipt.issuedOn)}</Text></dd></div>
        <div><Text asChild size="2" color="gray"><dt>Payment method</dt></Text><dd><Text size="2">{payment ? payment.method === 'cash' ? 'Cash' : 'Bank transfer' : 'Not available'}</Text></dd></div>
        <div className="receipt-facts-wide receipt-facts-total"><Text asChild size="2" color="gray"><dt>Amount paid</dt></Text><dd><Text size="7" weight="bold" className="num">{formatMoney(receipt.amountCents)}</Text></dd></div>
      </dl>
      <section aria-labelledby="receipt-coverage-title" style={{ marginTop: 20 }}>
        <Heading as="h2" id="receipt-coverage-title" size="3">What the payment covered</Heading>
        {allocations.length > 0 ? <ul className="receipt-coverage">
          {allocations.map(allocation => {
            const charge = data.charges.find(item => item.id === allocation.chargeId)
            const period = data.billingPeriods.find(item => item.id === charge?.billingPeriodId)
            return <li key={allocation.id}>
              <div className="receipt-coverage-main">
                <Text as="p" size="2" weight="bold">{charge ? CATEGORY_LABELS[charge.category] : 'Bill'}{allocationsSpanMultipleRooms ? ` · ${charge ? chargeRoom(data, charge).label : 'Room needs review'}` : ''}</Text>
                {charge?.category === 'ELECTRICITY' && <Text as="p" size="1" color="gray">Previous settled {charge.electricity.previousReadingMilliKwh / 1000} kWh → current {charge.electricity.currentReadingMilliKwh / 1000} kWh · {charge.electricity.consumptionMilliKwh / 1000} kWh × {formatMoney(charge.electricity.appliedRateCentsPerKwh)}/kWh</Text>}
                {period && <Text as="p" size="1" color="gray">{period.label}</Text>}
                <Text as="p" size="1" color="gray" className="receipt-coverage-id">Charge: {allocation.chargeId} · Allocation: {allocation.id}</Text>
                {allocation.state === 'REVERSED' && <Text as="p" size="1" color="gray">Allocation later reversed</Text>}
              </div>
              <Text size="2" weight="bold" className="num">{formatMoney(allocation.amountCents)}</Text>
            </li>
          })}
        </ul> : <Text as="p" size="2" color="gray" mt="2">{advance ? 'Advance payment — kept for a future bill' : 'No bill allocations were included when this receipt was issued.'}</Text>}
      </section>
      <Text as="p" size="1" color="gray" mt="4">Demonstration preview · Not an official receipt</Text>
      <Flex mt="4" justify="end"><Button aria-label="Close receipt" onClick={close}>Close</Button></Flex>
    </Dialog.Content>
  </Dialog.Root>
}
