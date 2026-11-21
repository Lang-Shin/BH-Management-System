import type { MoveInPolicy, PrototypeAppState } from '@/domain/types/models'

/** Versioned provisional policies. Changing this never rewrites existing obligations. */
export const DEFAULT_MOVE_IN_POLICY: MoveInPolicy = {
  version: 1,
  advanceApplication: 'LAST_MONTH',
  depositDisposition: 'MANUAL_REVIEW',
  transferIncrease: 'PROPOSE_TOP_UP',
  transferDecrease: 'MANUAL_REVIEW',
  moveOutSettlement: 'MANUAL_REVIEW',
}

export function activeMoveInPolicy(data: PrototypeAppState): MoveInPolicy {
  return data.moveInPolicy ?? DEFAULT_MOVE_IN_POLICY
}
