import type { PrototypeData } from '@/domain/types/models'

export type PrototypeAction =
  | { type: 'tenant/noteUpdated'; tenantId: string; notes: string }
  | { type: 'room/statusToggled'; roomId: string }
  | { type: 'electricity/paymentConfirmed'; obligationId: string; currentReadingMilliKwh: number; paidOn: string }
  | { type: 'demo/reset' }

export type StateAction = PrototypeAction | { type: 'data/loaded'; data: PrototypeData }
