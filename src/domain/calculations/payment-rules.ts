import type { PrototypeAppState } from '@/domain/types/models'
import { chargeBalance, issuedCharges } from './summary'
import { formatMoney } from '@/lib/format'

export function rentDueForTenant(data: PrototypeAppState, tenantId: string, periodId: string, asOf: string): number {
  return issuedCharges(data, asOf, periodId)
    .filter(charge => charge.category === 'RENT' && charge.tenantId === tenantId)
    .reduce((sum, charge) => sum + chargeBalance(data, charge, asOf), 0)
}

/** Rent is all-or-nothing. A blank amount means no rent is being paid in this entry. */
export function rentPaymentError(data: PrototypeAppState, tenantId: string, periodId: string, amountCents: number, asOf: string): string | null {
  if (amountCents === 0) return null
  const due = rentDueForTenant(data, tenantId, periodId, asOf)
  if (due === 0) return 'No unpaid room rent is assigned to this tenant for the selected month.'
  if (amountCents !== due) return `Room rent must be paid in full: ${formatMoney(due)}.`
  return null
}
