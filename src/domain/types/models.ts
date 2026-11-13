/** Currency is PHP. Every authoritative monetary field is integer centavos. */
export type ChargeCategory = 'RENT' | 'ELECTRICITY' | 'WATER' | 'WASHING_MACHINE'
/** Derived from active allocations; absence of a charge means not applicable. */
export type ChargeStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID'

export interface Tenant {
  id: string
  name: string
  email: string
  phone: string
  address: string
  status: 'ACTIVE' | 'MOVED_OUT'
  notes: string
}

export interface Room {
  id: string
  name: string
  floor: number
  /** Number of beds for reference only; it does not decide whether the room is occupied. */
  capacity: number
  kind: 'PRIVATE' | 'SHARED'
  status: 'available' | 'maintenance'
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
  serialNumber: string
  ownership: 'UNCONFIRMED'
}

export interface MeterReading {
  id: string
  meterId: string
  readOn: string
  /** Scaled integer: 1000 milli-kWh = 1 kWh; not floating-point currency. */
  readingMilliKwh: number
  status: 'DRAFT' | 'CONFIRMED' | 'SUPERSEDED'
  confirmedBy: string | null
  correction: AuthorizedCorrection | null
}

export interface ElectricityRate {
  id: string
  rateCentsPerKwh: number
  effectiveFrom: string
  /** New effective-dated records replace rates; issued charges retain snapshots. */
  label: string
}

export interface BillingPeriod {
  id: string
  label: string
  startDate: string
  endDate: string
  status: 'OPEN' | 'CLOSED'
}

export interface ElectricityChargeBasis {
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

interface ChargeRecord {
  id: string
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
)

export interface Payment {
  id: string
  tenantId: string
  amountCents: number
  paidOn: string
  method: 'cash' | 'bank-transfer'
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
  state: 'ISSUED' | 'VOIDED'
}

export interface AuditEvent {
  id: string
  actorId: string
  occurredOn: string
  action: 'DEMO_SEEDED' | 'READING_CORRECTED' | 'CHARGE_CORRECTED' | 'PAYMENT_CORRECTED' | 'ALLOCATION_REVERSED'
  entityType: 'PROTOTYPE' | 'METER_READING' | 'CHARGE' | 'PAYMENT' | 'PAYMENT_ALLOCATION'
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
  electricityRates: ElectricityRate[]
  billingPeriods: BillingPeriod[]
  charges: Charge[]
  payments: Payment[]
  paymentAllocations: PaymentAllocation[]
  tenantCredits: TenantCredit[]
  receipts: Receipt[]
  auditEvents: AuditEvent[]
}

/** Existing prototype reducer/repository payload name; identical to the app state. */
export type PrototypeData = PrototypeAppState
