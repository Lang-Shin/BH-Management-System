import type { ChargeCategory, CorrectionSettlementStatus, PrototypeData } from '@/domain/types/models'
import type { RoomDraft } from '@/domain/calculations/room-management'

export type PrototypeAction =
  | { type: 'tenant/noteUpdated'; tenantId: string; notes: string }
  | { type: 'room/created'; draft: RoomDraft }
  | { type: 'room/updated'; roomId: string; draft: RoomDraft }
  | { type: 'room/deleted'; roomId: string }
  | { type: 'room/statusToggled'; roomId: string }
  | { type: 'room/washingMachineUpdated'; roomId: string; enabled: boolean }
  | { type: 'electricity/paymentConfirmed'; obligationId: string; currentReadingMilliKwh: number; paidOn: string }
  | { type: 'room/paymentConfirmed'; roomId: string; periodId: string; selected: ChargeCategory[]; electricityReadingMilliKwh: number | null; asOf: string }
  | { type: 'payment/corrected'; paymentId: string; selectedCategories: ChargeCategory[]; correctedElectricityReadingMilliKwh: number | null; reason: string; settlementStatus: CorrectionSettlementStatus | ''; moneyExchangeConfirmed: boolean; correctedAt: string }
  | { type: 'demo/reset' }

export type StateAction = PrototypeAction | { type: 'data/loaded'; data: PrototypeData }
