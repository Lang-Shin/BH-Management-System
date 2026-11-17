import { Button, Dialog, Flex, Heading, IconButton, Text } from '@radix-ui/themes'
import { X } from 'lucide-react'
import { StatusBadge } from './status-badge'
import type { Payment, PrototypeAppState } from '@/domain/types/models'
import { paymentRooms } from '@/domain/calculations/room-finance'
import { formatDate, formatMoney } from '@/lib/format'
import { CATEGORY_LABELS } from '@/lib/labels'
import './shared-parts.css'

export function TransactionDialog({ data, payment, asOf, onClose, onReturnFocus }: {
  data: PrototypeAppState
  payment: Payment
  asOf: string
  onClose: () => void
  onReturnFocus: () => void
}) {
  const context = paymentRooms(data, payment, asOf)
  const payer = data.tenants.find(tenant => tenant.id === payment.tenantId)?.name
  const receipt = data.receipts.find(item => item.paymentId === payment.id && item.state === 'ISSUED')?.receiptNumber
  const advance = data.tenantCredits.some(credit => credit.sourcePaymentId === payment.id)
  const allocationsSpanMultipleRooms = new Set(context.allocations.map(allocation => allocation.context.id)).size > 1

  return <Dialog.Root open onOpenChange={next => { if (!next) onClose() }}>
    <Dialog.Content maxWidth="34rem" onCloseAutoFocus={event => { event.preventDefault(); onReturnFocus() }}>
      <Flex justify="between" align="start" gap="3" mb="4">
        <div>
          <Dialog.Title size="5" mb="1">Transaction Details</Dialog.Title>
          <Dialog.Description size="2" color="gray">Payment information for the selected room.</Dialog.Description>
        </div>
        <Dialog.Close><IconButton variant="ghost" color="gray" aria-label="Close"><X size={18} aria-hidden="true" /></IconButton></Dialog.Close>
      </Flex>

      <section aria-label="Payment summary" className="panel panel-pad">
        <Flex justify="between" align="start" gap="3" wrap="wrap">
          <div>
            <Text as="p" size="2" color="gray">Room</Text>
            <Text as="p" size="5" weight="bold">{context.label}</Text>
          </div>
          <StatusBadge status={payment.state === 'RECORDED' ? 'Recorded' : 'Voided'} />
        </Flex>
        <dl className="kv" style={{ marginTop: 12 }}>
          <div><dt>Date paid</dt><dd>{formatDate(payment.paidOn)}</dd></div>
          <div><dt>Receipt number</dt><dd>{receipt ?? 'No receipt yet'}</dd></div>
          <div className="kv-total"><dt>Amount paid</dt><dd className="num">{formatMoney(payment.amountCents)}</dd></div>
        </dl>
      </section>

      <Text as="p" size="2" mt="4"><Text color="gray">Paid by:</Text> <Text weight="medium">{payer ?? 'Not recorded'}</Text></Text>

      <section aria-labelledby="transaction-paid-title" style={{ marginTop: 20 }}>
        <Heading as="h3" id="transaction-paid-title" size="3" mb="2">What Was Paid</Heading>
        {context.allocations.length > 0 && <ul className="row-list">{context.allocations.map(allocation => {
          const charge = data.charges.find(item => item.id === allocation.chargeId)
          return <li key={allocation.id} className="row" style={{ alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0 }}>
              <Text as="p" size="2" weight="medium">{charge ? CATEGORY_LABELS[charge.category] : 'Bill'}</Text>
              {allocationsSpanMultipleRooms && <Text as="p" size="1" color="gray">{allocation.context.label}</Text>}
              {charge?.category === 'ELECTRICITY' && <Text as="p" size="1" color="gray">{charge.electricity.previousReadingMilliKwh / 1000} → {charge.electricity.currentReadingMilliKwh / 1000} kWh · {charge.electricity.consumptionMilliKwh / 1000} kWh × {formatMoney(charge.electricity.appliedRateCentsPerKwh)}/kWh</Text>}
            </div>
            <Text size="2" weight="medium" className="num" style={{ flex: 'none' }}>{formatMoney(allocation.amountCents)}</Text>
          </li>
        })}</ul>}
        {context.unallocated > 0 && <div className="row" style={{ alignItems: 'flex-start', borderTop: context.allocations.length > 0 ? '1px solid var(--gray-5)' : undefined }}>
          <div style={{ minWidth: 0 }}>
            <Text as="p" size="2" weight="medium">{context.allocations.length === 0 && advance ? 'Advance payment — Unallocated' : 'Unallocated amount'}</Text>
            <Text as="p" size="1" color="gray">This money is being held for future billing and is not yet applied to an issued bill.</Text>
          </div>
          <Text size="2" weight="medium" className="num" style={{ flex: 'none' }}>{formatMoney(context.unallocated)}</Text>
        </div>}
        {context.allocations.length === 0 && context.unallocated === 0 && <Text as="p" size="2" color="gray">No bill categories were allocated to this payment.</Text>}
      </section>

      <Text as="p" size="1" color="gray" mt="4" style={{ overflowWrap: 'anywhere' }}>Payment ID: {payment.id}</Text>
      <Flex justify="end" mt="4">
        <Dialog.Close><Button onFocus={event => event.currentTarget.scrollIntoView?.({ block: 'nearest' })}>Done</Button></Dialog.Close>
      </Flex>
    </Dialog.Content>
  </Dialog.Root>
}
