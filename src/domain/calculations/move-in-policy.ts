import type { MoveInPolicy, PrototypeAppState } from '@/domain/types/models'

/**
 * Policy v3: the mandatory advance is rent for the first anniversary period. Transfers never post
 * advance or deposit top-ups; deposits keep their original recorded amount.
 */
export const DEFAULT_MOVE_IN_POLICY: MoveInPolicy = {
  version: 3,
  advanceApplication: 'FIRST_MONTH',
  depositDisposition: 'NON_REFUNDABLE',
  depositIncomeRecognition: 'NOT_RECOGNIZED',
  transferIncrease: 'REVIEW_ONLY',
  transferDecrease: 'REVIEW_ONLY',
  moveOutSettlement: 'MANUAL_REVIEW',
  shortStayAdvanceRefundDays: 7,
}

export function activeMoveInPolicy(data: PrototypeAppState): MoveInPolicy {
  return data.moveInPolicy ?? DEFAULT_MOVE_IN_POLICY
}
