import type { ChargeCategory, ChargeStatus, RoomPaymentStatus, Tenant } from '@/domain/types/models'

export const CATEGORY_LABELS: Record<ChargeCategory, string> = {
  RENT: 'Rent', ELECTRICITY: 'Electricity', WATER: 'Water', WASHING_MACHINE: 'Washing machine',
  ADVANCE: 'Advance payment', SECURITY_DEPOSIT: 'Security deposit',
}
export const CHARGE_STATUS_LABELS: Record<ChargeStatus, string> = {
  UNPAID: 'Not yet paid', PARTIALLY_PAID: 'Partly paid', PAID: 'Paid',
}
export const ROOM_PAYMENT_STATUS_LABELS: Record<RoomPaymentStatus, string> = {
  NO_BILLS: 'No bills', NOT_YET_PAID: 'Not yet paid', PARTLY_PAID: 'Partly paid', PAID: 'Paid',
}

export const ACCOUNT_STATUS_LABELS: Record<string, string> = {
  Overdue: 'Late payment', Outstanding: 'Still to pay', 'Credit available': 'Paid in advance', Clear: 'Fully paid',
}

export const TENANT_STATUS_LABELS: Record<Tenant['status'], string> = {
  ACTIVE: 'Current tenant', MOVED_OUT: 'Moved out',
}
