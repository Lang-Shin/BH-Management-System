import type { ChargeCategory, ChargeStatus } from '@/domain/types/models'

export const CATEGORY_LABELS: Record<ChargeCategory, string> = {
  RENT: 'Rent', ELECTRICITY: 'Electricity', WATER: 'Water', WASHING_MACHINE: 'Washing machine',
}
export const CHARGE_STATUS_LABELS: Record<ChargeStatus, string> = {
  UNPAID: 'Unpaid', PARTIALLY_PAID: 'Partially paid', PAID: 'Paid',
}
