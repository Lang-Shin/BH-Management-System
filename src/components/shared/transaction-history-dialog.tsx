import { Button, Dialog, Flex } from '@radix-ui/themes'
import type { Payment, PrototypeAppState } from '@/domain/types/models'
import { PaymentHistoryTable } from './payment-history-table'

export function TransactionHistoryDialog({ data, payments, asOf, onClose, onReturnFocus }: {
  data: PrototypeAppState
  payments: Payment[]
  asOf: string
  onClose: () => void
  onReturnFocus: () => void
}) {
  return <Dialog.Root open onOpenChange={next => { if (!next) onClose() }}>
    <Dialog.Content maxWidth="64rem" onCloseAutoFocus={event => { event.preventDefault(); onReturnFocus() }}>
      <Dialog.Title size="5" mb="1">Transaction History</Dialog.Title>
      <Dialog.Description size="2" color="gray" mb="4">All recorded payments. Choose See Transaction to inspect one; this list is read-only.</Dialog.Description>
      <PaymentHistoryTable data={data} payments={payments} asOf={asOf} caption="All transactions" />
      <Flex justify="end" mt="4">
        <Dialog.Close><Button aria-label="Close transaction history">Close</Button></Dialog.Close>
      </Flex>
    </Dialog.Content>
  </Dialog.Root>
}
