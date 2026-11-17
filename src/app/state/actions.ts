import type { ChargeCategory, PrototypeData } from '@/domain/types/models'

export type PrototypeAction =
  | { type: 'tenant/noteUpdated'; tenantId: string; notes: string }
  | { type: 'room/statusToggled'; roomId: string }
  | { type: 'room/washingMachineUpdated'; roomId: string; enabled: boolean }
  | { type: 'electricity/paymentConfirmed'; obligationId: string; currentReadingMilliKwh: number; paidOn: string }
  | { type: 'room/paymentConfirmed'; roomId: string; periodId: string; selected: ChargeCategory[]; electricityReadingMilliKwh: number | null; asOf: string }
  | { type: 'demo/reset' }

export type StateAction = PrototypeAction | { type: 'data/loaded'; data: PrototypeData }
