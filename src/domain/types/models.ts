/** Currency is PHP. Every authoritative monetary field is integer centavos. */
export type ChargeCategory = 'RENT' | 'ELECTRICITY' | 'WATER' | 'WASHING_MACHINE' | 'ADVANCE' | 'SECURITY_DEPOSIT'
/** Derived from active allocations; absence of a charge means not applicable. */
export type ChargeStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID'
/** Owner-defined room status; distinct from an individual bill's settlement status. */
export type RoomPaymentStatus = 'NO_BILLS' | 'NOT_YET_PAID' | 'PARTLY_PAID' | 'PAID'

export interface Tenant {
  id: string
  name: string
  email: string
  phone: string
  address: string
  status: 'ACTIVE' | 'MOVED_OUT'
  notes: string
}

export type RoomCategoryId = 'RATE_3500' | 'RATE_4000' | 'RATE_5000'

export interface Room {
  id: string
  name: string
  floor: number
  /** Number of beds for reference only; it does not decide whether the room is occupied. */
  capacity: number
  kind: 'PRIVATE' | 'SHARED'
  status: 'available' | 'maintenance'
  categoryId: RoomCategoryId
  /** Current/future subscription; issued washing charges remain historical snapshots. */
  washingMachineEnabled: boolean
}

export interface RoomAssignment {
  id: string
  tenantId: string
  roomId: string
  startDate: string
  endDate: string | null
  /** Agreed amount, not a hardcoded per-bed or monthly billing policy. */
  agreedRentCents: number
}

/** A replacement record retains the original and links its authorization trail. */
export interface AuthorizedCorrection {
  supersedesId: string
  auditEventId: string
  authorizedBy: string
}

export interface ElectricityMeter {
  id: string
  label: string
  serialNumber: string | null
  /** Explicit association for newly initialized meters; legacy IDs remain readable. */
  roomId?: string
  ownership: 'UNCONFIRMED'
}

export interface MeterReading {
  id: string
  meterId: string
  readOn: string
  /** Scaled integer: 1000 milli-kWh = 1 kWh; not floating-point currency. */
  readingMilliKwh: number
  status: 'DRAFT' | 'INITIAL' | 'CONFIRMED' | 'SUPERSEDED'
  confirmedBy: string | null
  correction: AuthorizedCorrection | null
  /** Administrative baseline provenance; never a payment confirmation. */
  sourceNote?: string
  initializedOn?: string
}

export interface ElectricityRate {
  id: string
  rateCentsPerKwh: number
  effectiveFrom: string
  /** When the configuration change was recorded, distinct from its effective date. */
  recordedOn: string
  /** New effective-dated records replace rates; issued charges retain snapshots. */
  label: string
}

export interface RoomRentRate {
  id: string
  /** Stable category identity; the amount is never used as a room reference. */
  categoryId: RoomCategoryId
  monthlyRentCents: number
  effectiveFrom: string
  recordedOn: string
}

export interface UtilityRate {
  id: string
  rateCents: number
  effectiveFrom: string
  recordedOn: string
}

export interface BillingPeriod {
  id: string
  label: string
  startDate: string
  endDate: string
  status: 'OPEN' | 'CLOSED'
}

export interface ElectricityChargeBasis {
  /** Stable identifier for the settled meter interval, preventing duplicate consumption. */
  intervalId: string
  meterId: string
  previousReadingId: string
  currentReadingId: string
  previousReadingMilliKwh: number
  currentReadingMilliKwh: number
  consumptionMilliKwh: number
  rateId: string
  appliedRateCentsPerKwh: number
  appliedRateEffectiveFrom: string
}

/** An expected bill that is not a Charge until a current meter reading is entered. */
export interface ElectricityBillObligation {
  id: string
  roomId: string
  tenantId: string
  billingPeriodId: string
  meterId: string
  previousReadingId: string
  createdAt: string
  dueDate: string
  state: 'AWAITING_READING'
}

interface ChargeRecord {
  id: string
  /** Persisted historical room context for utilities; prevents transfers from reassigning old bills. */
  roomId?: string
  tenantId: string
  billingPeriodId: string
  description: string
  amountCents: number
  issuedOn: string
  dueDate: string
  state: 'ISSUED' | 'VOIDED'
  correction: AuthorizedCorrection | null
}

/** Issued amounts and electricity basis are historical snapshots, not live rates. */
export type Charge = ChargeRecord & (
  | { category: 'ELECTRICITY'; electricity: ElectricityChargeBasis }
  | { category: 'RENT'; roomAssignmentId: string; agreedRentCents: number }
  | { category: 'WATER' | 'WASHING_MACHINE'; entryMethod: 'MANUAL' }
  | { category: 'ADVANCE' | 'SECURITY_DEPOSIT'; moveInObligationId: string }
)

export type RentScheduleKind = 'ANNIVERSARY' | 'LEGACY_CALENDAR'
export type OccupancyCycleOrigin = 'NEW_MOVE_IN' | 'TRANSFER' | 'LEGACY' | 'SAME_DAY_REPLACEMENT'

/** One continuous period of occupancy for a room; a fully vacant room ends the cycle. */
export interface OccupancyCycle {
  id: string
  roomId: string
  startedAt: string
  endedAt: string | null
  status: 'ACTIVE' | 'CLOSED'
  /** New cycles use one immutable anniversary anchor. Imported cycles remain calendar-based. */
  rentSchedule: RentScheduleKind
  rentAnchorDate: string | null
  rentAnchorDay: number | null
  cycleOrigin: OccupancyCycleOrigin
  createdAt: string
  updatedAt: string
}

/** Inclusive-start, exclusive-end monthly window derived from a cycle's anniversary. */
export interface RentalPeriod {
  id: string
  occupancyCycleId: string
  roomId: string
  sequence: number
  startDate: string
  endDateExclusive: string
  dueDate: string
  status: 'OPEN' | 'CLOSED'
  origin: 'ANNIVERSARY' | 'LEGACY_CALENDAR'
}

/** Rent is recorded separately from calendar utility billing periods. */
export interface RentObligation {
  id: string
  occupancyCycleId: string
  rentalPeriodId: string
  roomId: string
  amountCents: number
  rateId: string
  rateEffectiveFrom: string
  rateSnapshotCents: number
  issuedOn: string
  dueDate: string
  source: 'REGULAR' | 'MOVE_IN_ADVANCE' | 'PREPAYMENT' | 'LEGACY_CALENDAR'
  state: 'ISSUED' | 'VOIDED'
  correction: AuthorizedCorrection | null
}

/** A non-cash settlement of the mandatory advance against the first rent period. */
export interface AdvanceApplication {
  id: string
  occupancyCycleId: string
  roomId: string
  advanceChargeId: string
  sourcePaymentId: string
  rentObligationId: string
  amountCents: number
  appliedOn: string
  state: 'ACTIVE' | 'REVERSED'
  reversalAuditEventId: string | null
}

export interface RentPrepayment {
  id: string
  paymentId: string
  occupancyCycleId: string
  roomId: string
  rentalPeriodIds: string[]
  periodCount: number
  totalCents: number
  rateCents: number
  rateLockedOn: string
  createdAt: string
  reviewState: 'NONE' | 'TRANSFER_REVIEW'
}

export type FinancialReviewType =
  | 'TRANSFER_RENT_DIFFERENCE'
  | 'TRANSFER_PREPAID_RENT'
  | 'PREPAID_RENT_EARLY_DEPARTURE'
  | 'LEGACY_ADVANCE_UNALLOCATED'
  | 'ADVANCE_APPLICATION_REVIEW'

export interface FinancialReviewCase {
  id: string
  type: FinancialReviewType
  roomId: string
  occupancyCycleId: string | null
  tenantId: string | null
  rentalPeriodId: string | null
  status: 'OPEN' | 'RESOLVED' | 'DISMISSED'
  note: string
  createdAt: string
  resolvedAt: string | null
}

/** One room-level advance/deposit requirement per occupancy cycle. */
export interface MoveInObligation {
  id: string
  occupancyCycleId: string
  roomId: string
  agreedMonthlyRentCents: number
  advanceRequiredCents: number
  depositRequiredCents: number
  advanceChargeId: string
  depositChargeId: string
  policyVersion: number
  depositDisposition: DepositDisposition
  depositIncomeRecognition: DepositIncomeRecognition
  createdAt: string
  status: 'OPEN'
}

export interface AdvanceRefund {
  id: string
  occupancyCycleId: string
  roomId: string
  tenantId: string
  advanceChargeId: string
  sourcePaymentId: string
  amountCents: number
  refundedOn: string
  reason: string
  policyVersion: number
  refundWindowDays: number
  auditEventId: string
}

export type DepositDisposition = 'NON_REFUNDABLE' | 'MANUAL_REVIEW'
/** Non-refundable terms do not authorize automatic income recognition in this prototype. */
export type DepositIncomeRecognition = 'NOT_RECOGNIZED'

export interface MoveInPolicy {
  version: number
  /** New policies always settle the first rental period; legacy values remain readable. */
  advanceApplication: 'FIRST_MONTH' | 'LAST_MONTH' | 'MANUAL'
  depositDisposition: DepositDisposition
  depositIncomeRecognition: DepositIncomeRecognition
  transferIncrease: 'REVIEW_ONLY'
  transferDecrease: 'REVIEW_ONLY'
  moveOutSettlement: 'MANUAL_REVIEW'
  shortStayAdvanceRefundDays: number
}

export type RoomChangeRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED'

/** A tenant request; approval uses the shared tenancy transfer service and never posts money. */
export interface RoomChangeRequest {
  id: string
  tenantId: string
  currentAssignmentId: string
  currentRoomId: string
  requestedRoomId: string
  requestedStartDate: string
  reason: string
  status: RoomChangeRequestStatus
  createdAt: string
  decidedAt: string | null
  decidedBy: string | null
  decisionReason: string | null
  approvedStartDate: string | null
  resultingAssignmentId: string | null
  billingReviewAcknowledged: boolean
  /** Approved mid-period transfers that require manual rent review. */
  billingReviewPeriodIds: string[]
}

export type PaymentScope = 'TENANT' | 'ROOM'

export interface Payment {
  id: string
  /** Room-level payments have no tenant payer; historical tenant payments keep their payer. */
  scope: PaymentScope
  tenantId: string | null
  roomId: string | null
  occupancyCycleId: string | null
  amountCents: number
  paidOn: string
  /** Room-level payments do not require an invented payment method. */
  method: 'cash' | 'bank-transfer' | null
  state: 'RECORDED' | 'VOIDED'
  correction: AuthorizedCorrection | null
}

export interface PaymentAllocation {
  id: string
  paymentId: string
  chargeId: string
  amountCents: number
  allocatedOn: string
  creditId: string | null
  state: 'ACTIVE' | 'REVERSED'
  reversalAuditEventId: string | null
}

/** Credit originates in received money; allocations consume it explicitly. */
export interface TenantCredit {
  id: string
  tenantId: string
  sourcePaymentId: string
  amountCents: number
  createdOn: string
}

export interface Receipt {
  id: string
  paymentId: string
  receiptNumber: string
  issuedOn: string
  amountCents: number
  /** Allocation IDs at issue time, not a live view of future allocations. */
  allocationIds: string[]
  state: 'ISSUED' | 'VOIDED' | 'SUPERSEDED'
  revision: number
  supersedesReceiptId: string | null
}

export type CorrectionSettlementStatus =
  | 'CORRECTED'
  | 'REFUNDED'
  | 'ADDITIONAL_RECEIVED'
  /** Legacy statuses remain readable so older saved demonstrations are never rewritten silently. */
  | 'NO_DIFFERENCE'
  | 'NO_MONEY_MOVED'
  | 'ADDITIONAL_PENDING'
  | 'REFUND_COMPLETED'
  | 'REFUND_PENDING'

export interface PaymentCorrection {
  id: string
  originalPaymentId: string
  correctedPaymentId: string
  originalReceiptId: string
  correctedReceiptId: string
  correctedAt: string
  correctedBy: string
  reason: string
  originalAmountCents: number
  correctedAmountCents: number
  differenceCents: number
  settlementStatus: CorrectionSettlementStatus
  settlementAmountCents: number
  originalCategories: ChargeCategory[]
  correctedCategories: ChargeCategory[]
  originalElectricityReadingMilliKwh: number | null
  correctedElectricityReadingMilliKwh: number | null
  auditEventId: string
}

export interface AuditEvent {
  id: string
  actorId: string
  occurredOn: string
  action: 'DEMO_SEEDED' | 'READING_CORRECTED' | 'CHARGE_CORRECTED' | 'PAYMENT_CORRECTED' | 'ALLOCATION_REVERSED' | 'ELECTRICITY_PAYMENT_RECORDED' | 'ROOM_PAYMENT_RECORDED' | 'MOVE_IN_PAYMENT_RECORDED' | 'MOVE_IN_POLICY_UPDATED' | 'METER_INITIALIZED' | 'ROOM_CHANGE_REQUESTED' | 'ROOM_CHANGE_CANCELLED' | 'ROOM_CHANGE_APPROVED' | 'ROOM_CHANGE_REJECTED' | 'ROOM_CHANGE_EXPIRED' | 'ROOM_CHANGE_RESERVATION_CANCELLED' | 'ROOM_CHANGE_RESCHEDULED' | 'ADVANCE_REFUNDED' | 'ADVANCE_APPLIED' | 'ADVANCE_APPLICATION_REVERSED' | 'RENT_PREPAYMENT_RECORDED' | 'FINANCIAL_REVIEW_OPENED' | 'WORKSPACE_RESET' | 'RENT_PERIODS_ENSURED'
  entityType: 'PROTOTYPE' | 'METER_READING' | 'CHARGE' | 'PAYMENT' | 'PAYMENT_ALLOCATION' | 'ROOM_CHANGE_REQUEST' | 'RENT_OBLIGATION' | 'ADVANCE_APPLICATION' | 'RENT_PREPAYMENT' | 'FINANCIAL_REVIEW_CASE'
  entityId: string
  reason: string
  /** Serialized before/after snapshots preserve a future correction trail. */
  beforeSnapshot: string | null
  afterSnapshot: string | null
}

export interface PrototypeAppState {
  tenants: Tenant[]
  rooms: Room[]
  roomAssignments: RoomAssignment[]
  electricityMeters: ElectricityMeter[]
  meterReadings: MeterReading[]
  electricityBillObligations: ElectricityBillObligation[]
  electricityRates: ElectricityRate[]
  roomRentRates: RoomRentRate[]
  waterRates: UtilityRate[]
  washingRates: UtilityRate[]
  billingPeriods: BillingPeriod[]
  charges: Charge[]
  payments: Payment[]
  paymentAllocations: PaymentAllocation[]
  tenantCredits: TenantCredit[]
  receipts: Receipt[]
  paymentCorrections: PaymentCorrection[]
  auditEvents: AuditEvent[]
  occupancyCycles: OccupancyCycle[]
  moveInObligations: MoveInObligation[]
  moveInPolicy: MoveInPolicy
  roomChangeRequests: RoomChangeRequest[]
  advanceRefunds: AdvanceRefund[]
  rentalPeriods: RentalPeriod[]
  rentObligations: RentObligation[]
  advanceApplications: AdvanceApplication[]
  rentPrepayments: RentPrepayment[]
  financialReviewCases: FinancialReviewCase[]
}

/** Existing prototype reducer/repository payload name; identical to the app state. */
export type PrototypeData = PrototypeAppState
