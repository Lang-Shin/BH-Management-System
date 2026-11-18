import { ReceiptText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAnimatedDialogClose } from '@/components/ui/use-animated-dialog-close'
import type { Payment, PrototypeAppState } from '@/domain/types/models'
import { PaymentHistoryTable } from './payment-history-table'

export function TransactionHistoryDialog({ data, payments, asOf, onClose, onReturnFocus }: {
  data: PrototypeAppState
  payments: Payment[]
  asOf: string
  onClose: () => void
  onReturnFocus: () => void
}) {
  const { open, requestClose, onOpenChange, onAnimationEnd } = useAnimatedDialogClose(onClose)

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="transaction-history-dialog sm:max-w-5xl" onAnimationEnd={onAnimationEnd} onCloseAutoFocus={event => { event.preventDefault(); onReturnFocus() }}>
      <DialogHeader className="pr-6">
        <span className="transaction-history-icon"><ReceiptText aria-hidden="true" /></span>
        <DialogTitle>Transaction History</DialogTitle>
        <DialogDescription>All recorded payments. Choose See Transaction to inspect one; this list is read-only.</DialogDescription>
      </DialogHeader>
      <PaymentHistoryTable data={data} payments={payments} asOf={asOf} caption="All transactions" paginated recordLabel="transactions" />
      <DialogFooter><Button aria-label="Close transaction history" onClick={requestClose}>Close</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
