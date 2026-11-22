import type { ChargeCategory, CorrectionSettlementStatus, DepositDisposition, PrototypeData } from '@/domain/types/models'
import type { RatePlan } from '@/domain/calculations/billing-rates'
import type { RoomDraft } from '@/domain/calculations/room-management'
import type { TenantDraft } from '@/domain/calculations/tenant-management'
import type { MeterInitializationInput } from '@/domain/calculations/meter-initialization'
import type { RoomChangeRequestDraft } from '@/domain/calculations/room-change-requests'

export type PrototypeAction =
  | { type: 'tenant/noteUpdated'; tenantId: string; notes: string }
  | { type: 'tenant/created'; draft: TenantDraft }
  | { type: 'tenant/updated'; tenantId: string; draft: TenantDraft }
  | { type: 'tenant/movedOut'; tenantId: string }
  | { type: 'tenant/deleted'; tenantId: string }
  | { type: 'rates/planned'; plan: RatePlan }
  | { type: 'room/created'; draft: RoomDraft }
  | { type: 'room/updated'; roomId: string; draft: RoomDraft }
  | { type: 'room/deleted'; roomId: string }
  | { type: 'room/statusToggled'; roomId: string }
  | { type: 'room/washingMachineUpdated'; roomId: string; enabled: boolean }
  | { type: 'electricity/paymentConfirmed'; obligationId: string; currentReadingMilliKwh: number; paidOn: string }
  | ({ type: 'electricity/meterInitialized' } & MeterInitializationInput)
  | { type: 'room/paymentConfirmed'; roomId: string; periodId: string; selected: ChargeCategory[]; electricityReadingMilliKwh: number | null; asOf: string }
  | { type: 'payment/corrected'; paymentId: string; selectedCategories: ChargeCategory[]; correctedElectricityReadingMilliKwh: number | null; reason: string; settlementStatus: CorrectionSettlementStatus | ''; moneyExchangeConfirmed: boolean; correctedAt: string }
  | { type: 'moveIn/paymentRecorded'; obligationId: string; categories: ('ADVANCE' | 'SECURITY_DEPOSIT')[]; paidOn: string }
  | { type: 'moveIn/policyUpdated'; advanceApplication?: 'FIRST_MONTH' | 'LAST_MONTH' | 'MANUAL'; depositDisposition?: DepositDisposition }
  | { type: 'roomChange/requested'; draft: RoomChangeRequestDraft }
  | { type: 'roomChange/cancelled'; requestId: string; tenantId: string; reason: string }
  | { type: 'roomChange/approved'; requestId: string; effectiveDate: string; note: string; billingReviewAcknowledged: boolean; decidedAt: string }
  | { type: 'roomChange/rejected'; requestId: string; reason: string; decidedAt: string }
  | { type: 'demo/reset' }

export type StateAction = PrototypeAction | { type: 'data/loaded'; data: PrototypeData }
