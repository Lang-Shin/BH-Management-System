import type { MoveInPolicy, PrototypeAppState } from '@/domain/types/models'

/** Policy v2 (Policy B): non-refundable deposits, still held without automatic income recognition. */
export const DEFAULT_MOVE_IN_POLICY: MoveInPolicy = {
  version: 2,
  advanceApplication: 'LAST_MONTH',
  depositDisposition: 'NON_REFUNDABLE',
  depositIncomeRecognition: 'NOT_RECOGNIZED',
  transferIncrease: 'PROPOSE_TOP_UP',
  transferDecrease: 'MANUAL_REVIEW',
  moveOutSettlement: 'MANUAL_REVIEW',
  shortStayAdvanceRefundDays: 7,
}

export function activeMoveInPolicy(data: PrototypeAppState): MoveInPolicy {
  return data.moveInPolicy ?? DEFAULT_MOVE_IN_POLICY
}
